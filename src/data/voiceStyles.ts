/**
 * 预设声音风格库(2026/07 新增)
 *
 * 每种风格对应 public/voice-styles/ 下的一段短音频。
 * 用户在角色卡 Popover 里选预设 → 绑定到 c.referenceAudioUrl,
 * 视频生成时作为 Seedance reference_audio 传给后端(音色克隆)。
 *
 * 音频用 Edge TTS 生成(中文)。扩充风格:加 mp3 到 public/voice-styles/ + 在下面加一项。
 * 注意:audioUrl 是相对路径,buildVideoGenPayload 收集时会拼成绝对 URL
 * (Seedance 在云端,需要公网可访问的完整 URL)。dev 下拼出来是 http://localhost/...,
 * 后端 generateVideo 里的 persistAudioUrl 会把它下载转存到 Supabase 拿公网签名 URL,
 * 所以 dev 也能用预设音色克隆。
 */
export type VoiceStyle = {
  id: string;
  /** 显示名 */
  name: string;
  /** 音色描述 */
  description: string;
  /** 音频相对路径(public 静态资源);视频生成时前端拼成绝对 URL */
  audioUrl: string;
  /** 2026/08 音色自动匹配用结构化标注:性别 */
  gender: "male" | "female";
  /** 2026/08 音色自动匹配用结构化标注:年龄段(junior 少年/young 青年/adult 成年/senior 老年) */
  ageGroup: "junior" | "young" | "adult" | "senior";
};

export const VOICE_STYLES: VoiceStyle[] = [
  {
    id: "xiaoxiao",
    name: "温暖女声",
    description: "晓晓 · 温暖亲和",
    audioUrl: "/voice-styles/xiaoxiao.mp3",
    gender: "female",
    ageGroup: "adult",
  },
  {
    id: "xiaoyi",
    name: "活泼少女",
    description: "晓伊 · 活泼明快",
    audioUrl: "/voice-styles/xiaoyi.mp3",
    gender: "female",
    ageGroup: "young",
  },
  {
    id: "yunyang",
    name: "专业男声",
    description: "云扬 · 沉稳播音",
    audioUrl: "/voice-styles/yunyang.mp3",
    gender: "male",
    ageGroup: "adult",
  },
  {
    id: "yunxi",
    name: "年轻男声",
    description: "云希 · 清朗年轻",
    audioUrl: "/voice-styles/yunxi.mp3",
    gender: "male",
    ageGroup: "young",
  },
  {
    id: "yunjian",
    name: "浑厚男声",
    description: "云健 · 浑厚有力",
    audioUrl: "/voice-styles/yunjian.mp3",
    gender: "male",
    ageGroup: "senior",
  },
  {
    id: "yunxia",
    name: "少年男声",
    description: "云夏 · 清亮少年",
    audioUrl: "/voice-styles/yunxia.mp3",
    gender: "male",
    ageGroup: "junior",
  },
];
