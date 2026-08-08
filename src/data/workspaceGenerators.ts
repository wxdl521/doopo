// Mock generators that return realistically structured workspace artifacts
// for the demo workspace.

export type Outline = {
  logline: string;
  acts: { title: string; beats: string[] }[];
};

export type GenCharacterLook = {
  /** unique id, used as image storage key. Convention: ${characterId}::${id} */
  id: string;
  /** 短标签,如 "医生"、"穿越"、"默认";用于卡片标题 "男主角-医生" */
  label: string;
  faceDescription: string;
  bodyDescription: string;
  clothingDescription: string;
  /** 已生成的形象图 URL(同步持久化到 charImages,key=${characterId}::${id}) */
  imageUrl?: string;
};

export type GenCharacter = {
  /**
   * 2026/06 改造:从 `episodeIndex: number` 改为 `episodes: number[]`。
   * 跨集 = 同一个 GenCharacter + 多集出现。
   * UI 默认按 selectedEpisodeIndex 过滤 `c.episodes.includes(...)`。
   * 老数据加载时:typeof c.episodes === 'undefined' → 转 [c.episodeIndex]。
   */
  episodes: number[];
  id: string;
  name: string;
  role: "lead" | "supporting" | "villain";
  roleLabel: string;
  age: number;
  gender: string;
  faceDescription: string;
  bodyDescription: string;
  clothingDescription: string;
  personality: string;
  palette: string[];
  swatch: string;
  mbti?: string;
  keyProp?: string;
  relations?: { targetId: string; label: string; summary: string }[];
  /**
   * 同角色不同造型/身份/服装下的"变体卡片"(已废弃 2026/06 —— 改成"多形象拆分为
   * 独立角色",各自有独立 name "林晚 · 医生"、"林晚 · 日常")。保留字段是为
   * 了兼容老数据(老数据加载进来如果 c.looks 有值仍能正常显示/操作),新流程
   * 下 AI 不再输出 looks 数组,这个字段在新角色上永远 undefined。
   */
  looks?: GenCharacterLook[];
  /**
   * 2026/06:同真人的多个形象(医生/日常/学生...)的"分身组 id"。多个独立角色
   * 如果共享同一个 siblingGroupId,表示它们是同一个真人的不同切面 —— 脸和
   * 身材必须保持一致。
   *
   * 生成流程:
   *   - 组内第一个生成的(还没有同组其他角色出图)→ 走 T2I,作为锚图
   *   - 后续生成的 → 走 I2I,拿同组已生成的图作 reference,锁脸锁身材
   *
   * 命名约定:AI 输出时用 `g-<真名>-<hash>` 或类似稳定的 id,确保同一集里
   * 同一真人的所有形象共享一个 groupId。同一真人跨集也建议保持一致(便于
   * 后续跨集复用锚图)。
   */
  siblingGroupId?: string;
  /**
   * 2026/06:跨集身份锚点 —— 同一真人在所有集(ep1, ep2, ep3)都共享同一个
   * matchKey,不论他/她有几个形象(医生/学生)。
   *
   * 客户端规则:
   *   - AI 在 character-extract / character 阶段必须填(必填字段,带 schema pattern 校验)
   *   - 命名建议: "<真名>-<3位hex>",例如 "陆深-a3f"
   *   - 跨集匹配优先级 1(matchKey > siblingGroupId > name 前缀)
   *   - 旧数据加载时: c.matchKey 缺失 → 兜底 = c.id(老 id 自身就是稳定锚)
   */
  matchKey: string;
  /**
   * 2026/06:per-episode 服装 / roleLabel override。
   * 脸 / 身材 / 人格 / palette 永远共享(同人同脸是基本要求);
   * 但允许每集穿不同衣服(ep1 医生穿白大褂、ep5 医生穿西装)或不同身份称谓
   * (ep1 "林夏 医生"、ep3 "林夏 患者")。
   *
   * 读: getEffectiveClothing(c, ep) / getEffectiveRoleLabel(c, ep)
   * 写: mergeExtractedCharacters 在跨集 clothing 变化时自动填
   */
  perEpisodeClothingOverrides?: Record<
    number,
    {
      clothingDescription?: string;
      roleLabel?: string;
    }
  >;
  /**
   * 2026/07:角色参考音频签名 URL(供视频生成 reference_audio 用)。
   * 角色级 —— 同一角色的所有造型/look 共用同一段声音(声音与形象无关)。
   * 上传后随 workspace_data 持久化;点「保存到资产」时同步进 characters.reference_audio_url。
   */
  referenceAudioUrl?: string;
};

export type GenScene = {
  /** 该场景所属的集数(从该集剧本中提取)。 */
  episodeIndex: number;
  id: string;
  index: number;
  slug: string; // INT. LOCATION - DAY
  location: string;
  timeOfDay: "DAY" | "NIGHT" | "DUSK" | "DAWN";
  action: string;
  beats: string[];
  dialogue: { role: string; line: string; parenthetical?: string }[];
};

/**
 * 2026/06:道具 —— 在本集中会根据剧情进行移动的物体。
 * 由 AI 从当集剧本中自动提取，与角色/场景并列。
 */
export type GenProp = {
  /** 该道具所属的集数。 */
  episodeIndex: number;
  id: string;
  name: string;
  /** 道具的外观描述（颜色、形状、材质等）。 */
  description: string;
  /** 在本集中的移动/变化方式（谁拿走了它、它去了哪里、发生了什么变化）。 */
  movementDescription: string;
  /** 关键剧情节点（该道具在哪些重要时刻出现/被使用）。 */
  keyMoments: string[];
  /** 配色，用于卡片标识。 */
  palette: string[];
  /** 卡片背景渐变。 */
  swatch: string;
};

export type StoryboardPanel = {
  id: string;
  index: number;
  sceneId: string;
  shot: "WS" | "MS" | "CU" | "ECU" | "OTS";
  camera: string;
  action: string;
  emotion: string;
  durationSec: number;
  gradient: string;
};

// ====================================================================
//  分镜(Storyboard Group)—— 由 AI 根据"当集剧情"切分的多组分镜
//  -----------------------------------------------------------------
//  区别于旧的 StoryboardPanel(单镜头),StoryboardGroup 是"一段剧情 +
//  1~3 个镜头"的有机组合,每个镜头一张分镜图。
//  -----------------------------------------------------------------
//  - plotText        : 从当集剧本切出来的原始剧情描述(一段话)
//  - startSec/endSec : 该分镜在整集中的起止时间(秒),AI 生成
//  - sceneId         : 关联的场景 ID(可选,AI 推断)
//  - characterIds    : 该分镜涉及的角色 ID 列表(AI 推断)
//  - shots[]         : 该分镜下的 1~3 个镜头,每个镜头一张图
//
//  StoryboardShot 字段:
//  - shotType        : 镜头景别 WS(远)/ MS(中)/ CU(近)/ ECU(特)/ OTS(过肩)
//  - shotTypeLabel   : 中文标签 "远景" / "中景" / "近景" / "特写" / "过肩"
//  - action          : 该镜头描述"什么人做什么"
//  - camera          : 摄像机说明(机位 / 角度 / 焦段)
//  - imageUrl?       : 多图融合生成的图片 URL
//  - busy?           : 客户端 UI 用的生成中标记(不入库)
// ====================================================================

export type ShotType = "WS" | "MS" | "CU" | "ECU" | "OTS";

export const SHOT_TYPE_LABEL: Record<ShotType, string> = {
  WS: "远景",
  MS: "中景",
  CU: "近景",
  ECU: "特写",
  OTS: "过肩",
};

export type StoryboardShot = {
  id: string;
  shotType: ShotType;
  shotTypeLabel: string;
  action: string;
  camera: string;
  /** 运镜方式:推/拉/摇/移/跟/升/降/固定 + 方向/幅度。AI 生成,可选。 */
  cameraMovement?: string;
  /** 本镜头内人物的走位/动线路径。AI 生成,可选。 */
  characterBlocking?: string;
  /**
   * 2026/06:每个 shot 自己的时间范围(秒,绝对值,在当集时间轴上)。
   * 之前只在 group 层级有 startSec/endSec,shot 是均分的;现在 shot 也有自己的区间,
   * UI 上每张分镜卡片可以显示 "Xs → Ys · Zs",更直观。
   */
  startSec?: number;
  endSec?: number;
  /**
   * 2026/08(台词驱动密度规则):本 shot 说出口的台词原文(完整引用,带角色名)。
   * 无台词的 shot(听者反应/动作特写/空镜)省略该字段。
   */
  dialogue?: string;
  /**
   * 2026/08(台词驱动密度规则):镜头角色——
   * action=说话人/主动作镜头;reaction=听者反应/反打镜头;insert=情绪特写/动作特写/空镜。
   * 对话组中 reaction+insert 占比应 ≥40%。
   */
  shotRole?: "action" | "reaction" | "insert";
  imageUrl?: string;
  /**
   * 用户在分镜里为该 shot 涉及的每个角色指定的 reference 形象(imageKey)。
   *   - key: 角色 id
   *   - value: imageKey(默认 look 用 c.id,其他 look 用 `${c.id}::${lk.id}`)
   *
   * 没设或为 undefined → 客户端用角色默认 look 的最新图作为 fallback,
   * 行为与旧版一致,完全向后兼容旧数据。
   */
  characterRefs?: Record<string, string>;
  /**
   * 2026/06:每个 shot 自己的角色列表(覆盖 group.characterIds)。
   *   - 没设 / 为 undefined / 为空数组 → fallback 到 group.characterIds
   *   - 显式设值(包括空数组)→ 该 shot 严格用 shot.characterIds,**不继承 group**
   *
   * 用途:同一组分镜里某几帧只出现 1 个角色、其他帧是 2 个角色对话,
   *      之前要"按 group 共享角色集合"只能把所有角色都塞进去让 I2I
   *      "猜"哪些在画面里 —— 现在可以每帧精确指定。
   */
  characterIds?: string[];
  /**
   * 2026/06:每个 shot 自己的场景(覆盖 group.sceneId)。
   *   - 没设或为 undefined → fallback 到 group.sceneId
   *   - 显式设 null(显式 "无场景")→ 该 shot 不传 sceneImageUrl 给 server
   *
   * 用途:转场分镜 —— 一帧在室内、下一帧在室外,但还在同一组剧情里。
   */
  sceneId?: string | null;
};

export type StoryboardGroup = {
  /** 该分镜组所属的集数(由 runEnterStoryboard 从当前选中的 episode 写入)。 */
  episodeIndex: number;
  id: string;
  index: number;
  plotText: string;
  startSec: number;
  endSec: number;
  sceneId?: string;
  sceneLocation?: string;
  characterIds: string[];
  /** 2026/06:本组场景 id 列表(多选),与 GroupSceneEditor 配合 */
  sceneIds?: string[];
  /** 2026/06:本组道具 id 列表,与 GroupPropEditor 配合 */
  propIds?: string[];
  /**
   * 2026/07:分镜描述(镜头分解 + 台词/剧情),覆盖视频生成提示词里的
   * [SHOT BREAKDOWN - for additional sequence hints] 段。
   *   - undefined = 未编辑,展示/生成时用自动算的默认值(镜头分解 + plotText)
   *   - 显式设值 = 用户编辑后的版本,视频生成直接用这段
   */
  shotBreakdownText?: string;
  shots: StoryboardShot[];
  /** 2026/07:该组 spoken 台词估算说完秒数(4字/秒)。用于台词可说完性兜底/警告。 */
  estDialogueSec?: number;
  /** 台词超出单视频 15s 硬上限的秒数(>0 表示该组台词一个视频说不完,需拆组/精简)。 */
  dialogueOverloadSec?: number;
  /** 2026/08:台词驱动密度校验警告(台词句数明显多于 shot 数;UI 暂不展示,仅记录)。 */
  shotDensityWarning?: string;
};

export type TimelineClip = {
  id: string;
  startSec: number;
  durationSec: number;
  label: string;
  panelId?: string;
};

export type TimelineTrack = {
  kind: "video" | "audio" | "subtitle";
  label: string;
  clips: TimelineClip[];
};

export type TimelineData = {
  totalSec: number;
  tracks: TimelineTrack[];
  transitionsAt: number[]; // seconds
};

const grad = (a: string, b: string) => `linear-gradient(135deg, ${a}, ${b})`;

// ---------------- Outline (canvas) ----------------
export function generateOutline(): Outline {
  return {
    logline: "高冷学霸林夏被暗恋三年的同桌江野无意间在校园广播里告白，一夜之间全校炸锅。",
    acts: [
      {
        title: "第一幕 · 日常与误会",
        beats: [
          "林夏在自习室独处，习惯性把江野的笔收好",
          '江野把作业本递错，碰到林夏冷脸，被同学嘲笑"又被打回票"',
          "广播站招新海报落在两人之间，埋下空间伏笔",
        ],
      },
      {
        title: "第二幕 · 暗恋曝光",
        beats: [
          "江野替朋友顶班播午间节目，没注意话筒未关",
          '在 BGM 间隙脱口而出"林夏其实笑起来很好看"',
          "全校广播同步外放，林夏在操场愣住，朋友疯狂尖叫",
        ],
      },
      {
        title: "第三幕 · 广播告白",
        beats: [
          "林夏冲上广播站，江野准备硬扛",
          '林夏抢过话筒，对全校说"那你别只说一半"',
          "镜头定格在两人对视，黑场，写下一集预告",
        ],
      },
    ],
  };
}

// ---------------- Script ----------------
export function generateScript(): GenScene[] {
  return [
    {
      episodeIndex: 1,
      id: "sc-1",
      index: 1,
      slug: "INT. 高三(2)班 自习室 — 黄昏",
      location: "高三(2)班 自习室",
      timeOfDay: "DUSK",
      action:
        "夕阳从百叶窗斜切进来。林夏独自坐在靠窗位，整理桌面。她看到江野落下的钢笔，犹豫了一下，把它擦干净放进自己笔袋。",
      beats: ["建立林夏的克制", '埋下"钢笔"信物', "空教室的孤独感"],
      dialogue: [{ role: "林夏", line: "（小声）……又忘东西。", parenthetical: "小声" }],
    },
    {
      episodeIndex: 1,
      id: "sc-2",
      index: 2,
      slug: "INT. 校园广播站 — 午间",
      location: "校园广播站",
      timeOfDay: "DAY",
      action:
        "江野慌慌张张推门进来，朋友把耳机塞给他就跑。江野戴上耳机，BGM 起，他对着稿子念了两段，松了口气，没注意话筒指示灯仍亮着。",
      beats: ['制造"忘关麦"的失误', "让江野放下防备", "为告白铺垫"],
      dialogue: [
        { role: "江野", line: "下面这首歌，送给所有在午休还睡不着的人。" },
        { role: "江野", line: "（低声自语）……林夏其实笑起来很好看。", parenthetical: "低声自语" },
      ],
    },
    {
      episodeIndex: 1,
      id: "sc-3",
      index: 3,
      slug: "EXT. 操场 — 同时",
      location: "操场",
      timeOfDay: "DAY",
      action:
        "广播声从操场两侧的喇叭同时炸开。林夏正拎着水壶走过，整个人僵住。身边女生爆发出尖叫，全场目光转向她。",
      beats: ["暴露事件", "反应群像", "推动林夏做选择"],
      dialogue: [
        { role: "同学A", line: "等等，他刚才说的是哪个林夏？！" },
        { role: "林夏", line: "（深呼吸）……麻烦了。", parenthetical: "深呼吸" },
      ],
    },
    {
      episodeIndex: 1,
      id: "sc-4",
      index: 4,
      slug: "INT. 校园广播站 — 紧接上场",
      location: "校园广播站",
      timeOfDay: "DAY",
      action: "林夏推门进来，江野僵在原地。两人对视三秒，林夏一把抢过话筒。",
      beats: ["情绪反转", "主动权转移", "留下钩子"],
      dialogue: [
        { role: "江野", line: "……我可以解释——" },
        { role: "林夏", line: "（对话筒）那你别只说一半。", parenthetical: "对话筒" },
      ],
    },
  ];
}

// ---------------- Characters ----------------
export function generateCharacters(): GenCharacter[] {
  return [
    {
      episodes: [1],
      id: "gen-ch-linxia",
      matchKey: "林夏-test",
      name: "林夏",
      role: "lead",
      roleLabel: "女主 · 高冷学霸",
      age: 17,
      gender: "女",
      faceDescription: "清秀瓜子脸，细框眼镜，齐耳短发乌黑柔顺，皮肤白皙，眼神清冷",
      bodyDescription: "身高 165cm，体型纤细，姿态挺拔，常微微低头看书",
      clothingDescription: "校服外套半挂在肩上，内搭白色衬衫，下着深蓝色百褶裙，脚穿白色帆布鞋",
      personality: "克制、敏感、嘴硬心软",
      palette: ["#0f172a", "#475569", "#fbbf24", "#f8fafc"],
      swatch: grad("#1e293b", "#fbbf24"),
      mbti: "INFP",
      keyProp: "钢笔",
      relations: [
        { targetId: "gen-ch-jiangye", label: "暗恋", summary: "互相试探，谁都不肯先开口" },
        { targetId: "gen-ch-mengmeng", label: "闺蜜", summary: "被小萌一路推着往前走" },
        { targetId: "gen-ch-zhouxue", label: "压制", summary: "被周学姐当反面典型盯上" },
      ],
    },
    {
      episodes: [1],
      id: "gen-ch-jiangye",
      matchKey: "江野-test",
      name: "江野",
      role: "lead",
      roleLabel: "男主 · 阳光体育委员",
      age: 17,
      gender: "男",
      faceDescription: "阳光帅气，剑眉星目，短发微乱，肤色健康偏黑，笑起来露出整齐牙齿",
      bodyDescription: "身高 180cm，体型健壮，肩宽腰窄，姿态放松随意",
      clothingDescription: "运动外套挂在椅背，校服袖口随意卷起，下着运动裤，脚穿篮球鞋",
      personality: "直球、迟钝、关键时刻爆发",
      palette: ["#0ea5e9", "#1e3a8a", "#fde68a", "#0f172a"],
      swatch: grad("#0ea5e9", "#1e3a8a"),
      mbti: "ESFP",
      keyProp: "广播稿",
      relations: [
        { targetId: "gen-ch-linxia", label: "暗恋", summary: "迟钝直球，把告白稿藏在广播稿里" },
        { targetId: "gen-ch-zhouxue", label: "上下级", summary: "被站长抓现行，差点关广播" },
        { targetId: "gen-ch-mengmeng", label: "同盟", summary: "被小萌偷偷传纸条提醒" },
      ],
    },
    {
      episodes: [1],
      id: "gen-ch-mengmeng",
      matchKey: "小萌-test",
      name: "小萌",
      role: "supporting",
      roleLabel: "配角 · 八卦闺蜜",
      age: 17,
      gender: "女",
      faceDescription: "圆脸可爱，大眼睛灵动，高马尾扎起，皮肤粉嫩，表情丰富",
      bodyDescription: "身高 160cm，体型娇小，动作活泼，喜欢蹦跳",
      clothingDescription: "校服里藏着粉色卫衣，下着短裙，脚穿白色运动鞋，常挂便签条",
      personality: "热情、嘴快、永远在线",
      palette: ["#ec4899", "#f472b6", "#fde68a"],
      swatch: grad("#ec4899", "#f472b6"),
      mbti: "ENFP",
      keyProp: "便签条",
      relations: [
        { targetId: "gen-ch-linxia", label: "闺蜜", summary: "24 小时同步播报林夏心情" },
        { targetId: "gen-ch-jiangye", label: "助攻", summary: "偷偷给江野递信号" },
      ],
    },
    {
      episodes: [1],
      id: "gen-ch-zhouxue",
      matchKey: "周学姐-test",
      name: "周学姐",
      role: "villain",
      roleLabel: "反派 · 广播站站长",
      age: 18,
      gender: "女",
      faceDescription: "冷峻面容，高颧骨，黑发扎成利落马尾，眼神锐利，表情严肃",
      bodyDescription: "身高 170cm，体型高挑，姿态挺拔，走路带风",
      clothingDescription: "黑色卫衣外搭工牌，常抱着资料夹，下着黑色长裤，脚穿黑色靴子",
      personality: "强势、控制欲强、表面公事公办",
      palette: ["#1f2937", "#6b7280", "#ef4444"],
      swatch: grad("#1f2937", "#ef4444"),
      mbti: "ENTJ",
      keyProp: "资料夹",
      relations: [
        { targetId: "gen-ch-jiangye", label: "压制", summary: "盯紧江野的每一次开麦" },
        { targetId: "gen-ch-linxia", label: "警告", summary: '把林夏列入"重点观察"' },
      ],
    },
  ];
}

// ---------------- Storyboard ----------------
const sbGradients = [
  grad("#1e3a5f", "#0f172a"),
  grad("#7c2d12", "#1e1b4b"),
  grad("#0ea5e9", "#1e293b"),
  grad("#ec4899", "#1e1b4b"),
  grad("#fbbf24", "#1e293b"),
  grad("#10b981", "#0f172a"),
];

export function generateStoryboard(scenes: GenScene[]): StoryboardPanel[] {
  const shots: StoryboardPanel["shot"][] = ["WS", "MS", "CU", "OTS", "ECU"];
  const panels: StoryboardPanel[] = [];
  let i = 0;
  scenes.forEach((sc) => {
    const count = sc.index === 2 ? 8 : 6; // scene 2 carries the broadcast beat
    for (let k = 0; k < count; k++) {
      const shot = shots[(i + k) % shots.length];
      panels.push({
        id: `pn-${sc.index}-${k + 1}`,
        index: ++i,
        sceneId: sc.id,
        shot,
        camera:
          shot === "WS"
            ? "广角 24mm，机位低"
            : shot === "CU" || shot === "ECU"
              ? "85mm，浅景深"
              : shot === "OTS"
                ? "过肩，35mm"
                : "中景 50mm",
        action: sc.beats[k % sc.beats.length],
        emotion:
          sc.index === 4
            ? "紧绷 → 释放"
            : sc.index === 3
              ? "震惊"
              : sc.index === 2
                ? "松弛 → 失态"
                : "克制",
        durationSec: shot === "ECU" ? 1.5 : shot === "CU" ? 2 : shot === "WS" ? 4 : 3,
        gradient: sbGradients[(i - 1) % sbGradients.length],
      });
    }
  });
  return panels;
}

// ---------------- Timeline ----------------
export function generateTimeline(panels: StoryboardPanel[]): TimelineData {
  const videoClips: TimelineClip[] = [];
  let cursor = 0;
  panels.forEach((p) => {
    videoClips.push({
      id: `vc-${p.index}`,
      startSec: cursor,
      durationSec: p.durationSec,
      label: `SC${p.index} ${p.shot}`,
      panelId: p.id,
    });
    cursor += p.durationSec;
  });
  const totalSec = cursor;

  // Audio: a few BGM blocks
  const audioClips: TimelineClip[] = [
    { id: "au-1", startSec: 0, durationSec: totalSec * 0.45, label: "BGM · 安静钢琴" },
    {
      id: "au-2",
      startSec: totalSec * 0.45,
      durationSec: totalSec * 0.25,
      label: "SFX · 广播底噪",
    },
    { id: "au-3", startSec: totalSec * 0.7, durationSec: totalSec * 0.3, label: "BGM · 心跳鼓点" },
  ];

  // Subtitles: one per dialogue panel (approx)
  const subClips: TimelineClip[] = videoClips
    .filter((_, i) => i % 2 === 1)
    .map((c, i) => ({
      id: `sub-${i}`,
      startSec: c.startSec,
      durationSec: Math.min(c.durationSec, 2),
      label: `字幕 ${i + 1}`,
    }));

  // Transitions at scene boundaries (every 6 panels-ish)
  const transitionsAt: number[] = [];
  let acc = 0;
  panels.forEach((p, i) => {
    acc += p.durationSec;
    if ((i + 1) % 6 === 0 && i < panels.length - 1) transitionsAt.push(acc);
  });

  return {
    totalSec,
    tracks: [
      { kind: "video", label: "视频轨", clips: videoClips },
      { kind: "audio", label: "音频轨", clips: audioClips },
      { kind: "subtitle", label: "字幕轨", clips: subClips },
    ],
    transitionsAt,
  };
}
