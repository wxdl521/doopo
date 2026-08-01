// ====================================================================
//  scriptTags -- 剧本题材 / 风格标签库
//
//  参考红果短剧的短剧标签体系整理，按创作方向分组，供剧本智能体
//  (ScriptComposer) 的下拉多选使用。
//
//  - value 为稳定英文键，会写入已保存剧本数据，**不要修改已有 value**
//  - zh / en 为展示文案（标签数量多，直接内联，避免 i18n 文件膨胀）
//  - locked 标签保留 🔒 交互，不可勾选
// ====================================================================

export type ScriptTagDef = {
  value: string;
  zh: string;
  en: string;
  locked?: boolean;
};

export type ScriptTagGroup = {
  id: string;
  zh: string;
  en: string;
  tags: ScriptTagDef[];
};

export const SCRIPT_GENRE_GROUPS: ScriptTagGroup[] = [
  {
    id: "urban",
    zh: "都市爽剧",
    en: "Urban",
    tags: [
      { value: "Urban", zh: "都市", en: "Urban" },
      { value: "WarGod", zh: "战神", en: "War God" },
      { value: "SonInLaw", zh: "赘婿", en: "Live-in Son-in-law" },
      { value: "Counterattack", zh: "逆袭", en: "Counterattack" },
      { value: "FaceSlap", zh: "打脸", en: "Face-slapping" },
      { value: "HiddenIdentity", zh: "扮猪吃虎", en: "Hidden Identity" },
      { value: "DivineDoctor", zh: "神医", en: "Divine Doctor" },
      { value: "SoldierKing", zh: "兵王", en: "Soldier King" },
      { value: "CEO", zh: "总裁", en: "CEO" },
      { value: "RichFamily", zh: "豪门", en: "Rich Family" },
      { value: "Workplace", zh: "职场", en: "Workplace" },
      { value: "Startup", zh: "创业", en: "Startup" },
    ],
  },
  {
    id: "emotion",
    zh: "情感",
    en: "Romance & Family",
    tags: [
      { value: "Romance", zh: "爱情", en: "Romance" },
      { value: "SweetPet", zh: "甜宠", en: "Sweet Romance" },
      { value: "AngstRomance", zh: "虐恋", en: "Angsty Romance" },
      { value: "MarriageFirst", zh: "先婚后爱", en: "Marriage First, Love Later" },
      { value: "WinBackWife", zh: "追妻火葬场", en: "Winning Her Back" },
      { value: "Reunion", zh: "破镜重圆", en: "Rekindled Love" },
      { value: "SecretCrush", zh: "暗恋", en: "Secret Crush" },
      { value: "MutualLove", zh: "双向奔赴", en: "Mutual Love" },
      { value: "Marriage", zh: "婚姻", en: "Marriage" },
      { value: "InLaws", zh: "婆媳", en: "In-laws" },
      { value: "FamilyDrama", zh: "家庭伦理", en: "Family Drama" },
    ],
  },
  {
    id: "highconcept",
    zh: "脑洞",
    en: "High Concept",
    tags: [
      { value: "Rebirth", zh: "重生", en: "Rebirth" },
      { value: "Transmigration", zh: "穿越", en: "Time Travel" },
      { value: "SystemCheat", zh: "系统", en: "System Cheat" },
      { value: "InfiniteFlow", zh: "无限流", en: "Infinite Flow" },
      { value: "TimeLoop", zh: "时间循环", en: "Time Loop" },
      { value: "Apocalypse", zh: "末世", en: "Apocalypse" },
      { value: "Supernatural", zh: "灵异", en: "Supernatural" },
      { value: "QuickTransmigration", zh: "快穿", en: "Quick Transmigration" },
    ],
  },
  {
    id: "costume",
    zh: "古装",
    en: "Period Costume",
    tags: [
      { value: "Costume", zh: "古装", en: "Costume" },
      { value: "PalaceIntrigue", zh: "宫斗", en: "Palace Intrigue" },
      { value: "HouseholdIntrigue", zh: "宅斗", en: "Household Intrigue" },
      { value: "PowerScheme", zh: "权谋", en: "Political Scheming" },
      { value: "Jianghu", zh: "江湖", en: "Jianghu" },
      { value: "Wuxia", zh: "武侠", en: "Wuxia" },
      { value: "FarmingLife", zh: "种田", en: "Farming Life" },
      { value: "Empress", zh: "女帝", en: "Empress" },
      { value: "Historical", zh: "历史", en: "Historical" },
    ],
  },
  {
    id: "xianxia",
    zh: "玄幻仙侠",
    en: "Xianxia & Fantasy",
    tags: [
      { value: "Xuanhuan", zh: "玄幻", en: "Xuanhuan" },
      { value: "Xianxia", zh: "仙侠", en: "Xianxia" },
      { value: "Cultivation", zh: "修真", en: "Cultivation" },
      { value: "Superpower", zh: "异能", en: "Superpowers" },
      { value: "Mythology", zh: "神话", en: "Mythology" },
      { value: "Fantasy", zh: "奇幻", en: "Fantasy" },
    ],
  },
  {
    id: "crime",
    zh: "悬疑犯罪",
    en: "Mystery & Crime",
    tags: [
      { value: "Thriller", zh: "惊悚", en: "Thriller" },
      { value: "Mystery", zh: "悬疑", en: "Mystery" },
      { value: "Deduction", zh: "推理", en: "Deduction" },
      { value: "Crime", zh: "犯罪", en: "Crime" },
      { value: "CaseFile", zh: "罪案", en: "Case Files" },
      { value: "Espionage", zh: "谍战", en: "Espionage" },
      { value: "Psychological", zh: "心理", en: "Psychological" },
      { value: "Horror", zh: "恐怖", en: "Horror" },
    ],
  },
  {
    id: "life",
    zh: "题材向",
    en: "General",
    tags: [
      { value: "Sci-Fi", zh: "科幻", en: "Sci-Fi" },
      { value: "Comedy", zh: "喜剧", en: "Comedy" },
      { value: "Drama", zh: "剧情", en: "Drama" },
      { value: "Period", zh: "年代", en: "Period" },
      { value: "Military", zh: "军旅", en: "Military" },
      { value: "Rural", zh: "乡村", en: "Rural" },
      { value: "Campus", zh: "校园", en: "Campus" },
      { value: "Youth", zh: "青春", en: "Youth" },
      { value: "CuteBaby", zh: "萌宝", en: "Cute Kids" },
      { value: "FamilyBond", zh: "亲情", en: "Family Bonds" },
      { value: "Inspirational", zh: "励志", en: "Inspirational" },
      { value: "Healing", zh: "治愈", en: "Healing" },
    ],
  },
  {
    id: "restricted",
    zh: "受限题材",
    en: "Restricted",
    tags: [
      { value: "Violence", zh: "暴力", en: "Violence", locked: true },
      { value: "Erotic", zh: "情色", en: "Erotic", locked: true },
    ],
  },
];

export const SCRIPT_TONES: ScriptTagDef[] = [
  { value: "Serious", zh: "严肃", en: "Serious" },
  { value: "Suspense", zh: "悬疑", en: "Suspenseful" },
  { value: "Lighthearted", zh: "轻松搞笑", en: "Lighthearted" },
  { value: "Hotblooded", zh: "热血", en: "Hot-blooded" },
  { value: "Warm", zh: "温情", en: "Warm" },
  { value: "Dark", zh: "暗黑", en: "Dark" },
  { value: "Satisfying", zh: "爽感强", en: "Highly Satisfying" },
  { value: "Realistic", zh: "写实", en: "Realistic" },
  { value: "Absurd", zh: "荒诞", en: "Absurd" },
  { value: "TwistHeavy", zh: "高能反转", en: "Twist-heavy" },
];

/** 扁平化的全部题材标签（含 locked）。 */
export const ALL_SCRIPT_GENRES: ScriptTagDef[] = SCRIPT_GENRE_GROUPS.flatMap((g) => g.tags);

/** 风格分组（下拉面板里与题材分组一起展示）。 */
export const SCRIPT_TONE_GROUP: ScriptTagGroup = {
  id: "tone",
  zh: "风格",
  en: "Tone",
  tags: SCRIPT_TONES,
};

export function scriptTagLabel(tag: ScriptTagDef, lang: string): string {
  return lang === "zh" ? tag.zh : tag.en;
}

export function scriptGroupLabel(group: ScriptTagGroup, lang: string): string {
  return lang === "zh" ? group.zh : group.en;
}
