// Mock generators that return realistically structured workspace artifacts
// for the "校园恋爱短剧 第1集 · 广播室告白" demo episode.

export type Outline = {
  logline: string
  acts: { title: string; beats: string[] }[]
}

export type GenCharacter = {
  id: string
  name: string
  role: 'lead' | 'supporting' | 'villain'
  roleLabel: string
  age: number
  look: string
  personality: string
  motivation: string
  debutShot: string
  palette: string[]
  swatch: string
}

export type GenScene = {
  id: string
  index: number
  slug: string // INT. LOCATION - DAY
  location: string
  timeOfDay: 'DAY' | 'NIGHT' | 'DUSK' | 'DAWN'
  action: string
  beats: string[]
  dialogue: { role: string; line: string; parenthetical?: string }[]
}

export type StoryboardPanel = {
  id: string
  index: number
  sceneId: string
  shot: 'WS' | 'MS' | 'CU' | 'ECU' | 'OTS'
  camera: string
  action: string
  emotion: string
  durationSec: number
  gradient: string
}

export type TimelineClip = {
  id: string
  startSec: number
  durationSec: number
  label: string
  panelId?: string
}

export type TimelineTrack = {
  kind: 'video' | 'audio' | 'subtitle'
  label: string
  clips: TimelineClip[]
}

export type TimelineData = {
  totalSec: number
  tracks: TimelineTrack[]
  transitionsAt: number[] // seconds
}

const grad = (a: string, b: string) =>
  `linear-gradient(135deg, ${a}, ${b})`

// ---------------- Outline (canvas) ----------------
export function generateOutline(): Outline {
  return {
    logline:
      '高冷学霸林夏被暗恋三年的同桌江野无意间在校园广播里告白，一夜之间全校炸锅。',
    acts: [
      {
        title: '第一幕 · 日常与误会',
        beats: [
          '林夏在自习室独处，习惯性把江野的笔收好',
          '江野把作业本递错，碰到林夏冷脸，被同学嘲笑"又被打回票"',
          '广播站招新海报落在两人之间，埋下空间伏笔',
        ],
      },
      {
        title: '第二幕 · 暗恋曝光',
        beats: [
          '江野替朋友顶班播午间节目，没注意话筒未关',
          '在 BGM 间隙脱口而出"林夏其实笑起来很好看"',
          '全校广播同步外放，林夏在操场愣住，朋友疯狂尖叫',
        ],
      },
      {
        title: '第三幕 · 广播告白',
        beats: [
          '林夏冲上广播站，江野准备硬扛',
          '林夏抢过话筒，对全校说"那你别只说一半"',
          '镜头定格在两人对视，黑场，写下一集预告',
        ],
      },
    ],
  }
}

// ---------------- Script ----------------
export function generateScript(): GenScene[] {
  return [
    {
      id: 'sc-1',
      index: 1,
      slug: 'INT. 高三(2)班 自习室 — 黄昏',
      location: '高三(2)班 自习室',
      timeOfDay: 'DUSK',
      action:
        '夕阳从百叶窗斜切进来。林夏独自坐在靠窗位，整理桌面。她看到江野落下的钢笔，犹豫了一下，把它擦干净放进自己笔袋。',
      beats: ['建立林夏的克制', '埋下"钢笔"信物', '空教室的孤独感'],
      dialogue: [
        { role: '林夏', line: '（小声）……又忘东西。', parenthetical: '小声' },
      ],
    },
    {
      id: 'sc-2',
      index: 2,
      slug: 'INT. 校园广播站 — 午间',
      location: '校园广播站',
      timeOfDay: 'DAY',
      action:
        '江野慌慌张张推门进来，朋友把耳机塞给他就跑。江野戴上耳机，BGM 起，他对着稿子念了两段，松了口气，没注意话筒指示灯仍亮着。',
      beats: ['制造"忘关麦"的失误', '让江野放下防备', '为告白铺垫'],
      dialogue: [
        { role: '江野', line: '下面这首歌，送给所有在午休还睡不着的人。' },
        { role: '江野', line: '（低声自语）……林夏其实笑起来很好看。', parenthetical: '低声自语' },
      ],
    },
    {
      id: 'sc-3',
      index: 3,
      slug: 'EXT. 操场 — 同时',
      location: '操场',
      timeOfDay: 'DAY',
      action:
        '广播声从操场两侧的喇叭同时炸开。林夏正拎着水壶走过，整个人僵住。身边女生爆发出尖叫，全场目光转向她。',
      beats: ['暴露事件', '反应群像', '推动林夏做选择'],
      dialogue: [
        { role: '同学A', line: '等等，他刚才说的是哪个林夏？！' },
        { role: '林夏', line: '（深呼吸）……麻烦了。', parenthetical: '深呼吸' },
      ],
    },
    {
      id: 'sc-4',
      index: 4,
      slug: 'INT. 校园广播站 — 紧接上场',
      location: '校园广播站',
      timeOfDay: 'DAY',
      action:
        '林夏推门进来，江野僵在原地。两人对视三秒，林夏一把抢过话筒。',
      beats: ['情绪反转', '主动权转移', '留下钩子'],
      dialogue: [
        { role: '江野', line: '……我可以解释——' },
        { role: '林夏', line: '（对话筒）那你别只说一半。', parenthetical: '对话筒' },
      ],
    },
  ]
}

// ---------------- Characters ----------------
export function generateCharacters(): GenCharacter[] {
  return [
    {
      id: 'gen-ch-linxia',
      name: '林夏',
      role: 'lead',
      roleLabel: '女主 · 高冷学霸',
      age: 17,
      look: '齐耳短发，校服外套半挂，常戴细框眼镜',
      personality: '克制、敏感、嘴硬心软',
      motivation: '想守住自己的节奏，又害怕错过江野',
      debutShot: '黄昏自习室，逆光剪影 + 钢笔特写',
      palette: ['#0f172a', '#475569', '#fbbf24', '#f8fafc'],
      swatch: grad('#1e293b', '#fbbf24'),
    },
    {
      id: 'gen-ch-jiangye',
      name: '江野',
      role: 'lead',
      roleLabel: '男主 · 阳光体育委员',
      age: 17,
      look: '运动外套挂在椅背，校服袖口随意卷起，发梢微乱',
      personality: '直球、迟钝、关键时刻爆发',
      motivation: '一直暗恋林夏，又怕被她讨厌',
      debutShot: '广播站推门进入，逆光面部半暗',
      palette: ['#0ea5e9', '#1e3a8a', '#fde68a', '#0f172a'],
      swatch: grad('#0ea5e9', '#1e3a8a'),
    },
    {
      id: 'gen-ch-mengmeng',
      name: '小萌',
      role: 'supporting',
      roleLabel: '配角 · 八卦闺蜜',
      age: 17,
      look: '高马尾，校服里藏着粉色卫衣',
      personality: '热情、嘴快、永远在线',
      motivation: '推林夏一把，顺便嗑一口糖',
      debutShot: '操场尖叫的中近景',
      palette: ['#ec4899', '#f472b6', '#fde68a'],
      swatch: grad('#ec4899', '#f472b6'),
    },
    {
      id: 'gen-ch-zhouxue',
      name: '周学姐',
      role: 'villain',
      roleLabel: '反派 · 广播站站长',
      age: 18,
      look: '黑色卫衣 + 工牌，常抱着资料夹',
      personality: '强势、控制欲强、表面公事公办',
      motivation: '维护广播站秩序，对江野的"私货"零容忍',
      debutShot: '广播站门口冷脸特写',
      palette: ['#1f2937', '#6b7280', '#ef4444'],
      swatch: grad('#1f2937', '#ef4444'),
    },
  ]
}

// ---------------- Storyboard ----------------
const sbGradients = [
  grad('#1e3a5f', '#0f172a'),
  grad('#7c2d12', '#1e1b4b'),
  grad('#0ea5e9', '#1e293b'),
  grad('#ec4899', '#1e1b4b'),
  grad('#fbbf24', '#1e293b'),
  grad('#10b981', '#0f172a'),
]

export function generateStoryboard(scenes: GenScene[]): StoryboardPanel[] {
  const shots: StoryboardPanel['shot'][] = ['WS', 'MS', 'CU', 'OTS', 'ECU']
  const panels: StoryboardPanel[] = []
  let i = 0
  scenes.forEach((sc) => {
    const count = sc.index === 2 ? 8 : 6 // scene 2 carries the broadcast beat
    for (let k = 0; k < count; k++) {
      const shot = shots[(i + k) % shots.length]
      panels.push({
        id: `pn-${sc.index}-${k + 1}`,
        index: ++i,
        sceneId: sc.id,
        shot,
        camera:
          shot === 'WS' ? '广角 24mm，机位低' :
          shot === 'CU' || shot === 'ECU' ? '85mm，浅景深' :
          shot === 'OTS' ? '过肩，35mm' : '中景 50mm',
        action: sc.beats[k % sc.beats.length],
        emotion: sc.index === 4 ? '紧绷 → 释放' : sc.index === 3 ? '震惊' : sc.index === 2 ? '松弛 → 失态' : '克制',
        durationSec: shot === 'ECU' ? 1.5 : shot === 'CU' ? 2 : shot === 'WS' ? 4 : 3,
        gradient: sbGradients[(i - 1) % sbGradients.length],
      })
    }
  })
  return panels
}

// ---------------- Timeline ----------------
export function generateTimeline(panels: StoryboardPanel[]): TimelineData {
  const videoClips: TimelineClip[] = []
  let cursor = 0
  panels.forEach((p) => {
    videoClips.push({
      id: `vc-${p.index}`,
      startSec: cursor,
      durationSec: p.durationSec,
      label: `SC${p.index} ${p.shot}`,
      panelId: p.id,
    })
    cursor += p.durationSec
  })
  const totalSec = cursor

  // Audio: a few BGM blocks
  const audioClips: TimelineClip[] = [
    { id: 'au-1', startSec: 0, durationSec: totalSec * 0.45, label: 'BGM · 安静钢琴' },
    { id: 'au-2', startSec: totalSec * 0.45, durationSec: totalSec * 0.25, label: 'SFX · 广播底噪' },
    { id: 'au-3', startSec: totalSec * 0.7, durationSec: totalSec * 0.3, label: 'BGM · 心跳鼓点' },
  ]

  // Subtitles: one per dialogue panel (approx)
  const subClips: TimelineClip[] = videoClips
    .filter((_, i) => i % 2 === 1)
    .map((c, i) => ({
      id: `sub-${i}`,
      startSec: c.startSec,
      durationSec: Math.min(c.durationSec, 2),
      label: `字幕 ${i + 1}`,
    }))

  // Transitions at scene boundaries (every 6 panels-ish)
  const transitionsAt: number[] = []
  let acc = 0
  panels.forEach((p, i) => {
    acc += p.durationSec
    if ((i + 1) % 6 === 0 && i < panels.length - 1) transitionsAt.push(acc)
  })

  return {
    totalSec,
    tracks: [
      { kind: 'video', label: '视频轨', clips: videoClips },
      { kind: 'audio', label: '音频轨', clips: audioClips },
      { kind: 'subtitle', label: '字幕轨', clips: subClips },
    ],
    transitionsAt,
  }
}
