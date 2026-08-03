// ====================================================================
// cameraDirection —— 转绘「导演镜头调度机制」纯函数内核
// 需求来源：《镜头调度机制》+《光线调度机制调整-20260804》一/二/四/五节
// 三层耦合：情绪 → 运镜意图 → 景别适配性检查；跳切只认场景与戏剧单元
// 光线调度：扁平 LUT 升级为 5 维原子参数矩阵（光比/色温/调色盘/质感衰减/
// 肤色保护），情绪微调 ±10% 硬钳，同场景光照方向突变强制回滚。
// 纯函数、零依赖，不接 UI、不接渲染链路。
// ====================================================================

/** 调度层景别六档枚举（分析层七档中的「大远景」在本层并入「远景」）。 */
export type ShotType = "特写" | "大特写" | "近景" | "中景" | "全景" | "远景";

/** 决策层可识别的六种情绪；无法识别的情绪走「保持原片运镜」兜底。 */
export type Emotion = "愤怒" | "暧昧" | "紧张" | "舒缓" | "震惊" | "悲伤";

export interface DirectionShot {
  shotNo: string;
  startMs: number;
  endMs: number;
  /** 物理空间命名，跨镜头必须一致（跳切红线的判定基准）。 */
  scene: string;
  shotType: ShotType;
  /** 主导情绪；允许任意字符串，未识别值由 resolveCameraMovement 兜底。 */
  emotion: string;
  action?: string;
  dialogue?: string;
}

export type Market = "kr" | "us" | "in" | "nordic" | "hk" | "jp";

// --------------------------------------------------------------------
// 第一层（决策层）：情绪 → 运镜意图
// --------------------------------------------------------------------

export const EMOTION_MOVEMENT_MAP: Record<Emotion, string> = {
  愤怒: "手持晃动+急速推近",
  暧昧: "缓慢环绕+呼吸感微动",
  紧张: "缓推+短切",
  舒缓: "横移+长镜头",
  震惊: "急推+定帧",
  悲伤: "缓降+固定",
};

export interface CameraMovementResult {
  /** 运镜指令；可能被适配性检查改写（如特写摇晃 → 固定机位微移）。 */
  movement: string;
  /** 适配后的景别；可能被升级（如全景推近 → 中景）。 */
  adjustedShotType: ShotType;
  /** 发生适配改写时的说明；未改写时为 undefined。 */
  note?: string;
}

const WIDE_SHOT_TYPES: ReadonlySet<ShotType> = new Set(["全景", "远景"]);
const TIGHT_SHOT_TYPES: ReadonlySet<ShotType> = new Set(["特写", "大特写"]);

/**
 * 情绪 → 运镜 → 景别适配性检查（三层耦合核心）。
 * 运镜是命令，景别是执行条件：推近类落在全景/远景上景深不够，
 * 景别为运镜让路升级为中景；环绕/摇晃类落在特写/大特写上会眩晕，
 * 锁定为固定机位微移。情绪无法识别时不发明运镜，保持原片。
 */
export function resolveCameraMovement(input: {
  emotion: string;
  shotType: ShotType;
}): CameraMovementResult {
  const { emotion, shotType } = input;
  const movement = EMOTION_MOVEMENT_MAP[emotion as Emotion];
  if (!movement) {
    return { movement: "保持原片运镜", adjustedShotType: shotType };
  }

  const isPushIn = movement.includes("急速推近") || movement.includes("急推");
  if (isPushIn && WIDE_SHOT_TYPES.has(shotType)) {
    return {
      movement,
      adjustedShotType: "中景",
      note: `景别为运镜让路：${shotType}升级为中景以承载推近`,
    };
  }

  const isShakeOrOrbit =
    movement.includes("环绕") ||
    movement.includes("摇晃") ||
    movement.includes("晃动");
  if (isShakeOrOrbit && TIGHT_SHOT_TYPES.has(shotType)) {
    return {
      movement: "固定机位微移",
      adjustedShotType: shotType,
      note: `${shotType}摇晃易眩晕，锁定为固定机位微移`,
    };
  }

  return { movement, adjustedShotType: shotType };
}

// --------------------------------------------------------------------
// 第二层（跳切逻辑）：场景定生死，戏变给空间
// --------------------------------------------------------------------

export type SceneCutResult =
  | { type: "transition"; method: string }
  | { type: "llm_decide"; hint: string }
  | { type: "continuous"; hint: string };

/**
 * 跳切判断。物理场景变了必须转场；场景没变但戏剧任务变了，
 * 禁止用 if-else 判死，交给导演模型做叙事意图分析；
 * 场景没变戏也没变是绝对红线，禁止跳切。
 */
export function resolveSceneCut(input: {
  prevScene: string;
  scene: string;
  dramaChanged: boolean;
}): SceneCutResult {
  const { prevScene, scene, dramaChanged } = input;
  if (scene !== prevScene) {
    return { type: "transition", method: "叠化或闪白，保持动作连续" };
  }
  if (dramaChanged) {
    return {
      type: "llm_decide",
      hint: "交导演模型判断抽帧加速或慢放加音效冲击，禁止硬跳切",
    };
  }
  return { type: "continuous", hint: "禁止跳切" };
}

// --------------------------------------------------------------------
// 光线语言：原子参数矩阵（5 维），替代扁平 LUT
// 需求：《光线调度机制调整-20260804》一/二/四/五节
// --------------------------------------------------------------------

/**
 * 光照 5 维原子参数矩阵：
 * - contrastRatio / tempTint 为 -100~+100 数值（光比正=硬朗负=柔和；色温正=暖负=冷）；
 * - palette / textureRollOff / skinToneOffset 为文本描述（AI 直接可读的光影逻辑）。
 */
export interface LightingParams {
  /** 光比：主光与辅光的强度差（决定硬朗或柔和），-100~+100。 */
  contrastRatio: number;
  /** 色温偏移：全局色温（暖/冷）及洋红/绿色偏移，-100~+100。 */
  tempTint: number;
  /** 调色盘倾向：阴影、中间调、高光的独立色相映射。 */
  palette: { shadows: string; midtones: string; highlights: string };
  /** 质感衰减：高光区域柔化程度与暗部死黑裁剪阈值。 */
  textureRollOff: string;
  /** 肤色保护层：针对目标人群的肤色独立偏移（防变绿/变蜡黄）。 */
  skinToneOffset: string;
}

export interface LightingPreset {
  id: Market;
  /** i18n 预设名 key（restyle_setup_market_*）。 */
  nameKey: string;
  /** i18n 预设描述 key（restyle_setup_lighting_*_desc）。 */
  descriptionKey: string;
  params: LightingParams;
}

/** 内置 6 档预设库：韩/美/印/北欧/港风/日系（文档第二节视觉语法）。 */
export const LIGHTING_PRESETS: Record<Market, LightingPreset> = {
  kr: {
    id: "kr",
    nameKey: "restyle_setup_market_kr",
    descriptionKey: "restyle_setup_lighting_kr_desc",
    params: {
      contrastRatio: 30,
      tempTint: 20,
      palette: {
        shadows: "加蓝，青蓝倾向",
        midtones: "偏粉暖，柔和过渡",
        highlights: "奶油状扩散，逆光位带圣光光晕",
      },
      textureRollOff: "高光奶油状扩散，暗部柔和不死黑",
      skinToneOffset: "偏粉白，亚洲肤色保护防变绿变黄",
    },
  },
  us: {
    id: "us",
    nameKey: "restyle_setup_market_us",
    descriptionKey: "restyle_setup_lighting_us_desc",
    params: {
      contrastRatio: 70,
      tempTint: 10,
      palette: {
        shadows: "深黑保留质感（低感光度）",
        midtones: "偏青，低饱和",
        highlights: "保留细节（FilmLight 风格）",
      },
      textureRollOff: "暗部死黑保留质感，高光锐化不溢出",
      skinToneOffset: "偏古铜，欧美肤色保护",
    },
  },
  in: {
    id: "in",
    nameKey: "restyle_setup_market_in",
    descriptionKey: "restyle_setup_lighting_in_desc",
    params: {
      contrastRatio: 20,
      tempTint: 60,
      palette: {
        shadows: "偏橙红",
        midtones: "高饱和暖黄",
        highlights: "面部轻微过曝，眼白与牙齿单独提亮",
      },
      textureRollOff: "高光轻微过曝溢出，暗部暖橙不压死黑",
      skinToneOffset: "偏暖金，深肤色提亮防变蜡黄",
    },
  },
  nordic: {
    id: "nordic",
    nameKey: "restyle_setup_market_nordic",
    descriptionKey: "restyle_setup_lighting_nordic_desc",
    params: {
      contrastRatio: -30,
      tempTint: -60,
      palette: {
        shadows: "冷灰，不压死黑",
        midtones: "大面积冷灰中间调，极低饱和度",
        highlights: "阴冷白，收敛不溢出",
      },
      textureRollOff: "整体低反差平滑，数字感干净",
      skinToneOffset: "偏冷白，去饱和防红润",
    },
  },
  hk: {
    id: "hk",
    nameKey: "restyle_setup_market_hk",
    descriptionKey: "restyle_setup_lighting_hk_desc",
    params: {
      contrastRatio: 50,
      tempTint: -10,
      palette: {
        shadows: "死黑，带朦胧柔光镜效果",
        midtones: "青橙/青红强反差，大面积杂色光斑",
        highlights: "霓虹洋红与青蓝溢出",
      },
      textureRollOff: "暗部死黑，高光霓虹光晕柔化",
      skinToneOffset: "中性偏暖，防霓虹杂光染绿",
    },
  },
  jp: {
    id: "jp",
    nameKey: "restyle_setup_market_jp",
    descriptionKey: "restyle_setup_lighting_jp_desc",
    params: {
      contrastRatio: -20,
      tempTint: -10,
      palette: {
        shadows: "浅灰轻提，不死黑",
        midtones: "高明度低饱和",
        highlights: "过曝半档，柔和漫反射",
      },
      textureRollOff: "高光柔化漫反射，暗部轻提不死黑",
      skinToneOffset: "偏透明蓝，日系透明感保护",
    },
  },
};

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

function describeContrast(value: number): string {
  if (value >= 40) return "硬朗高反差";
  if (value >= 10) return "柔和大光比";
  if (value <= -20) return "低反差柔光";
  return "自然反差";
}

function describeTemp(value: number): string {
  if (value >= 30) return "强暖调";
  if (value > 0) return "偏暖";
  if (value <= -30) return "强冷调";
  if (value < 0) return "偏冷";
  return "中性";
}

/**
 * 5 维参数一行式渲染：调度块【光线语言】段与渲染日志共用口径，
 * 形如「光比+30；色温+20；调色盘[阴影…/中间调…/高光…]；质感衰减[…]；肤色保护[…]」。
 */
export function formatLightingParams(params: LightingParams): string {
  return [
    `光比${signed(params.contrastRatio)}`,
    `色温${signed(params.tempTint)}`,
    `调色盘[阴影${params.palette.shadows}/中间调${params.palette.midtones}/高光${params.palette.highlights}]`,
    `质感衰减[${params.textureRollOff}]`,
    `肤色保护[${params.skinToneOffset}]`,
  ].join("；");
}

/**
 * 兼容导出：由 params 生成的一行式简述（供现有面板/分析提示词沿用）。
 * 新代码请直接使用 LIGHTING_PRESETS / resolveLighting。
 */
export const LIGHTING_LUTS: Record<Market, string[]> = Object.fromEntries(
  Object.values(LIGHTING_PRESETS).map((preset) => [
    preset.id,
    [
      `光比${signed(preset.params.contrastRatio)}（${describeContrast(preset.params.contrastRatio)}）`,
      `色温${signed(preset.params.tempTint)}（${describeTemp(preset.params.tempTint)}）`,
      `阴影${preset.params.palette.shadows.split("，")[0]}`,
      preset.params.textureRollOff.split("，")[0],
      `肤色${preset.params.skinToneOffset.split("，")[0]}`,
    ],
  ]),
) as Record<Market, string[]>;

export interface LightingResult {
  /** 生效预设。 */
  preset: LightingPreset;
  /** 本镜实际生效的 5 维参数（情绪微调 / 一致性回滚之后）。 */
  params: LightingParams;
  /** 微调或回滚原因；无任何调整时为 undefined。 */
  note?: string;
}

/** 情绪微调幅度硬钳 ±10%（文档第四节：色温/光比微调幅度限制在 ±10% 内）。 */
export const EMOTION_LIGHTING_MAX_DELTA = 10;

const clampDelta = (delta: number): number =>
  Math.max(-EMOTION_LIGHTING_MAX_DELTA, Math.min(EMOTION_LIGHTING_MAX_DELTA, delta));

/** 情绪 → 色温/光比微调（弹性规则）；未识别情绪不动。 */
const EMOTION_LIGHTING_TWEAKS: Record<
  string,
  { contrastDelta: number; tempDelta: number }
> = {
  愤怒: { contrastDelta: 10, tempDelta: -10 },
  恐怖: { contrastDelta: 10, tempDelta: -10 },
  紧张: { contrastDelta: 10, tempDelta: -10 },
  暧昧: { contrastDelta: -10, tempDelta: 10 },
  浪漫: { contrastDelta: -10, tempDelta: 10 },
};

/** 阴影描述中的色相大类（用于主光方位/色调翻转的简化判定）。 */
const SHADOW_HUE_CLASSES = ["青", "蓝", "橙", "红", "黄", "绿", "紫", "粉", "金", "灰", "黑"];

function shadowHueClass(shadows: string): string | undefined {
  return SHADOW_HUE_CLASSES.find((hue) => shadows.includes(hue));
}

const cloneParams = (params: LightingParams): LightingParams => ({
  ...params,
  palette: { ...params.palette },
});

/**
 * 单镜光照解算：预设 5 维参数 → 情绪微调（±10% 硬钳）→ 同场景一致性校验。
 * 硬规则：prevLighting 存在时，若色温方向（tempTint 符号）或阴影色相大类
 * 发生翻转，判定为穿帮，回滚为 prevLighting 并附 note。
 */
export function resolveLighting(input: {
  preset: LightingPreset;
  emotion: string;
  prevLighting?: LightingParams;
}): LightingResult {
  const { preset, emotion, prevLighting } = input;
  const params = cloneParams(preset.params);

  let note: string | undefined;
  const tweak = EMOTION_LIGHTING_TWEAKS[emotion];
  if (tweak) {
    const contrastDelta = clampDelta(tweak.contrastDelta);
    const tempDelta = clampDelta(tweak.tempDelta);
    params.contrastRatio += contrastDelta;
    params.tempTint += tempDelta;
    note = `情绪「${emotion}」微调：光比${signed(contrastDelta)}/色温${signed(tempDelta)}`;
  }

  if (prevLighting) {
    const tempFlipped =
      prevLighting.tempTint !== 0 &&
      params.tempTint !== 0 &&
      Math.sign(prevLighting.tempTint) !== Math.sign(params.tempTint);
    const prevHue = shadowHueClass(prevLighting.palette.shadows);
    const nextHue = shadowHueClass(params.palette.shadows);
    const hueFlipped = prevHue !== undefined && nextHue !== undefined && prevHue !== nextHue;
    if (tempFlipped || hueFlipped) {
      return {
        preset,
        params: cloneParams(prevLighting),
        note: "相邻镜头光照方向突变，已回滚保持缓变",
      };
    }
  }

  return { preset, params, note };
}

// --------------------------------------------------------------------
// 调度块文本组装
// --------------------------------------------------------------------

export interface DirectionBlockInput {
  shot: DirectionShot;
  /** 首镜可不传；不传时省略【转场指令】段。 */
  prevShot?: DirectionShot;
  market: Market;
  /** 当前着装状态描述（软引导，不锁定服装编号）。 */
  clothingState?: string;
  /** 同场景下戏剧任务是否变化（如谈判→打斗），默认 false。 */
  dramaChanged?: boolean;
  /**
   * 同场戏前一镜的实际光照参数（一致性硬规则的判定基准）；
   * 仅在同一场戏内传递，跨场景换光合法、不传。
   */
  prevLighting?: LightingParams;
}

/**
 * 生成单镜调度块文本，段落固定顺序：
 * 【运镜调度】→【转场指令】→【光线语言】→【服装引导】（可选）。
 */
export function buildDirectionBlock(input: DirectionBlockInput): string {
  const { shot, prevShot, market, clothingState, dramaChanged = false, prevLighting } = input;
  const cam = resolveCameraMovement({
    emotion: shot.emotion,
    shotType: shot.shotType,
  });

  const sections: string[] = [];

  const movementParts = [
    `情绪「${shot.emotion}」→ ${cam.movement}`,
    `景别：${cam.adjustedShotType}`,
  ];
  if (cam.note) movementParts.push(cam.note);
  sections.push(`【运镜调度】${movementParts.join("；")}`);

  if (prevShot) {
    const cut = resolveSceneCut({
      prevScene: prevShot.scene,
      scene: shot.scene,
      dramaChanged,
    });
    const detail =
      cut.type === "transition"
        ? `转场：${cut.method}`
        : cut.type === "llm_decide"
          ? `戏变待导演模型判断：${cut.hint}`
          : `连续：${cut.hint}`;
    sections.push(`【转场指令】${detail}`);
  }

  // 【光线语言】渲染 5 维原子参数（光比/色温/调色盘/质感衰减/肤色保护逐条），
  // 情绪微调或一致性回滚的 note 附在段尾。
  const lighting = resolveLighting({
    preset: LIGHTING_PRESETS[market],
    emotion: shot.emotion,
    prevLighting,
  });
  const lightingLine = `【光线语言】${formatLightingParams(lighting.params)}`;
  sections.push(lighting.note ? `${lightingLine}；${lighting.note}` : lightingLine);

  if (clothingState) {
    sections.push(
      `【服装引导】角色仅锚定面部特征与体型骨架；当前着装：${clothingState}；` +
        "允许模型随光影与动作自然调整衣物质感，不锁定服装编号",
    );
  }

  return sections.join("\n");
}

// --------------------------------------------------------------------
// 补镜触发点（P2 用，本阶段只交付纯函数）
// --------------------------------------------------------------------

export type InsertShot =
  | {
      kind: "closeup";
      afterShotNo: string;
      reason: "情绪高点补特写";
      insertDurationSec: 0.5;
    }
  | {
      kind: "establishing";
      beforeShotNo: string;
      reason: "场景转换补空镜";
      insertDurationSec: 1;
    };

const CLOSEUP_TRIGGER_EMOTIONS: ReadonlySet<string> = new Set(["震惊", "落泪"]);
const CLOSEUP_TRIGGER_SHOT_TYPES: ReadonlySet<ShotType> = new Set([
  "中景",
  "全景",
  "远景",
]);

/**
 * 扫描镜头序列，找出两类补镜触发点：
 * A 类：情绪高点（震惊/落泪）落在非特写景别 → 补大特写，插在该镜之后；
 * B 类：相邻镜头场景切换 → 补空镜，插在两个场景之间。
 */
export function findInsertShots(shots: DirectionShot[]): InsertShot[] {
  const inserts: InsertShot[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (
      CLOSEUP_TRIGGER_EMOTIONS.has(shot.emotion) &&
      CLOSEUP_TRIGGER_SHOT_TYPES.has(shot.shotType)
    ) {
      inserts.push({
        kind: "closeup",
        afterShotNo: shot.shotNo,
        reason: "情绪高点补特写",
        insertDurationSec: 0.5,
      });
    }
    if (i > 0 && shots[i - 1].scene !== shot.scene) {
      inserts.push({
        kind: "establishing",
        beforeShotNo: shot.shotNo,
        reason: "场景转换补空镜",
        insertDurationSec: 1,
      });
    }
  }
  return inserts;
}
