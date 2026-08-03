// ====================================================================
// cameraDirection —— 转绘「导演镜头调度机制」纯函数内核
// 需求来源：《镜头调度机制》第一/二/三/四节 + 全景流程图
// 三层耦合：情绪 → 运镜意图 → 景别适配性检查；跳切只认场景与戏剧单元
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

export type Market = "kr" | "us" | "in";

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
// 光线语言包（目标市场 LUT，本土化的关键）
// --------------------------------------------------------------------

export const LIGHTING_LUTS: Record<Market, string[]> = {
  kr: ["阿宝色调", "柔光漫反射", "逆光位带圣光光晕", "阴影区加蓝"],
  us: [
    "高对比度",
    "硬光切边",
    "暗部死黑保留质感",
    "高光区保留细节（FilmLight 风格）",
  ],
  in: ["高饱和暖黄", "面部过曝半档", "眼白与牙齿单独提亮"],
};

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
}

/**
 * 生成单镜调度块文本，段落固定顺序：
 * 【运镜调度】→【转场指令】→【光线语言】→【服装引导】（可选）。
 */
export function buildDirectionBlock(input: DirectionBlockInput): string {
  const { shot, prevShot, market, clothingState, dramaChanged = false } = input;
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

  sections.push(`【光线语言】${LIGHTING_LUTS[market].join("；")}`);

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
