// Character images (AI-generated mock)
import c1Master from '../assets/characters/c1/master.jpg'
import c1Front from '../assets/characters/c1/front.jpg'
import c1Side from '../assets/characters/c1/side.jpg'
import c1Back from '../assets/characters/c1/back.jpg'
import c1Expr from '../assets/characters/c1/expression.jpg'
import c2Master from '../assets/characters/c2/master.jpg'
import c2Front from '../assets/characters/c2/front.jpg'
import c2Side from '../assets/characters/c2/side.jpg'
import c2Back from '../assets/characters/c2/back.jpg'
import c2Expr from '../assets/characters/c2/expression.jpg'
import c3Master from '../assets/characters/c3/master.jpg'
import c3Front from '../assets/characters/c3/front.jpg'
import c3Side from '../assets/characters/c3/side.jpg'
import c3Back from '../assets/characters/c3/back.jpg'
import c3Expr from '../assets/characters/c3/expression.jpg'
import c4Master from '../assets/characters/c4/master.jpg'
import c4Front from '../assets/characters/c4/front.jpg'
import c4Side from '../assets/characters/c4/side.jpg'
import c4Back from '../assets/characters/c4/back.jpg'
import c4Expr from '../assets/characters/c4/expression.jpg'

export type AssetTab = 'character' | 'scene' | 'prop'

export type CharacterAsset = {
  id: string
  name: string
  emoji: string
  gradient: string
  cover: string
  views: { front: string; side: string; back: string; expression: string }
  role: string
  age: string
  personality: string
  style: string
  costume: string
  appearance: string
  background: string
  palette: string[]
  tags: string[]
  summary: string
}

export type SceneAsset = {
  id: string
  name: string
  emoji: string
  gradient: string
  time: string
  mood: string
  shot: string
  lighting: string
  sound: string
  reference: string
  tags: string[]
  summary: string
}

export type PropAsset = {
  id: string
  name: string
  emoji: string
  gradient: string
  owner: string
  appearance: string
  symbol: string
  material: string
  firstAppear: string
  lastAppear: string
  detail: string
  tags: string[]
  summary: string
}

export const characterAssets: CharacterAsset[] = [
  {
    id: 'c1', name: '林夏', emoji: '🌸',
    gradient: 'from-rose-400/40 via-pink-300/30 to-amber-200/30',
    cover: c1Master,
    views: { front: c1Front, side: c1Side, back: c1Back, expression: c1Expr },
    role: '女主角', age: '17', personality: '温柔、敏感、坚定',
    style: 'Visual Novel / 校园清新',
    costume: '海军蓝水手服 + 白色领巾，校徽别在左胸口袋',
    appearance: '身高 162cm，长直黑发配齐刘海，深紫色瞳孔，皮肤偏白；总是抱着一本写满诗句的小笔记。',
    background: '海风高中三年级文学社社员，从小被母亲一人带大，将所有心事都写进诗里；在新生报到那天遇到陈昱后开始第一次悄悄喜欢一个人。',
    palette: ['#1B2A4E', '#F5C6CB', '#F9E4D4', '#7A4F6D', '#FFFFFF'],
    tags: ['校园', '清新', '文艺'],
    summary: '海风高中三年级，热爱写诗，暗恋陈昱却始终未敢表白。',
  },
  {
    id: 'c2', name: '陈昱', emoji: '🏀',
    gradient: 'from-sky-400/40 via-cyan-300/30 to-emerald-200/30',
    cover: c2Master,
    views: { front: c2Front, side: c2Side, back: c2Back, expression: c2Expr },
    role: '男主角', age: '17', personality: '阳光、直率、好胜',
    style: 'Visual Novel / 运动少年',
    costume: '白色篮球背心 7 号 + 海军蓝运动短裤 + 白色高帮球鞋',
    appearance: '身高 183cm，短而蓬松的黑发，深棕瞳孔，肩宽腿长；右手腕常戴一条褪色的红绳。',
    background: '校篮球队队长，三岁丧父，跟随母亲在海风镇长大；用篮球与玩笑掩盖自己的细腻，是少数能让林夏笑出声的人。',
    palette: ['#0E1E36', '#FFFFFF', '#E8732C', '#3A6FB0', '#C8392F'],
    tags: ['篮球队长', '校草', '阳光'],
    summary: '校篮球队长，外表洒脱内心细腻，总在不经意间留意林夏。',
  },
  {
    id: 'c3', name: '苏婉', emoji: '💋',
    gradient: 'from-fuchsia-500/40 via-purple-400/30 to-indigo-300/30',
    cover: c3Master,
    views: { front: c3Front, side: c3Side, back: c3Back, expression: c3Expr },
    role: '反派 / 学姐', age: '18', personality: '高傲、心机、缺爱',
    style: 'Visual Novel / 大小姐',
    costume: '深紫色双排扣西装外套 + 白衬衫 + 红色蝴蝶结 + 高跟乐福鞋',
    appearance: '身高 168cm，栗棕色大波浪长发，红色瞳孔，唇形分明；指甲永远涂着深红，胸前挂着一枚银色挂坠。',
    background: '学生会主席，父母常年缺席的"完美大小姐"；将对爱的渴望转化为对控制的迷恋，不允许任何人靠近陈昱。',
    palette: ['#3F1E45', '#C8392F', '#9F6B5C', '#F2E2C9', '#0B0B0F'],
    tags: ['学生会主席', '反派', '复杂'],
    summary: '学生会主席，外人眼中完美无缺，暗中阻挠女主接近陈昱。',
  },
  {
    id: 'c4', name: '老周', emoji: '📚',
    gradient: 'from-amber-500/40 via-orange-300/30 to-yellow-200/30',
    cover: c4Master,
    views: { front: c4Front, side: c4Side, back: c4Back, expression: c4Expr },
    role: '支线 / 班主任', age: '42', personality: '幽默、唠叨、温暖',
    style: 'Visual Novel / 写实暖色',
    costume: '棕色针织背心 + 米白衬衫 + 卷起的袖口 + 棕色西裤',
    appearance: '身高 172cm，微胖，鬓角已花白，圆框金属眼镜，常年口袋里揣着红笔与一本卷边的语文课本。',
    background: '海风高中高三 2 班班主任兼语文老师，膝下无儿；把每一届学生都当作自己的孩子，是青春故事里的"定海神针"。',
    palette: ['#5A3E2B', '#D9C2A4', '#FFFFFF', '#7A8C6E', '#222222'],
    tags: ['班主任', '搞笑', '导师'],
    summary: '语文兼班主任，看似严厉实则护短，是青春故事里的"定海神针"。',
  },
]

export const sceneAssets: SceneAsset[] = [
  {
    id: 's1', name: '海风高中操场', emoji: '🌅',
    gradient: 'from-orange-400/40 via-rose-300/30 to-purple-300/30',
    time: '傍晚 17:30', mood: '青春、热血、淡淡心动', shot: '广角 + 跟拍',
    lighting: '低角度橙红色逆光，长投影，云层带紫红渐变',
    sound: '球鞋摩擦地面 / 远处加油声 / 微风穿过树叶',
    reference: '《灌篮高手》全国大赛日落篇 / 《Your Name》黄昏戏',
    tags: ['户外', '夕阳', '校园'],
    summary: '橙红色夕阳洒在跑道上，篮球落地的声响与远处加油声交织。',
  },
  {
    id: 's2', name: '图书馆三楼靠窗', emoji: '📖',
    gradient: 'from-amber-300/40 via-yellow-200/30 to-stone-200/30',
    time: '午后 14:00', mood: '安静、专注、隐秘心事', shot: '中近景 + 自然光',
    lighting: '侧窗自然光，木质书桌上有斑驳光影',
    sound: '翻书声 / 窗外蝉鸣 / 远处脚步',
    reference: '《言叶之庭》凉亭场景 / 《情书》图书馆借书卡',
    tags: ['室内', '安静', '学习'],
    summary: '阳光斜射在木质书桌上，能听见纸张翻动与窗外蝉鸣。',
  },
  {
    id: 's3', name: '樱花林小径', emoji: '🌸',
    gradient: 'from-pink-400/40 via-rose-200/30 to-fuchsia-200/30',
    time: '清晨 06:40 雨', mood: '浪漫、忧郁、暧昧', shot: '低角度跟随 + 浅景深',
    lighting: '阴雨天柔和灰光，樱花瓣反射粉色微光',
    sound: '细雨打叶 / 伞下脚步 / 远处校钟',
    reference: '《秒速五厘米》开篇樱花段落',
    tags: ['户外', '雨', '浪漫'],
    summary: '小雨打在樱花瓣上，地面落瓣成毯，伞下两人沉默并行。',
  },
  {
    id: 's4', name: '教学楼天台', emoji: '🌃',
    gradient: 'from-indigo-500/40 via-blue-400/30 to-slate-300/30',
    time: '深夜 23:10', mood: '孤独、释放、坦白', shot: '仰拍 + 城市夜景虚化',
    lighting: '冷色调月光 + 远处城市暖黄灯火',
    sound: '夜风声 / 远处车流 / 心跳特写',
    reference: '《青春猪头少年》天台告白 / 《CLANNAD》夜戏',
    tags: ['户外', '夜景', '高潮戏'],
    summary: '城市灯火在远处铺开，风吹动两人的校服，最适合一次告白。',
  },
]

export const propAssets: PropAsset[] = [
  {
    id: 'p1', name: '蓝色发卡', emoji: '🎀',
    gradient: 'from-sky-400/40 via-blue-300/30 to-cyan-200/30',
    owner: '林夏', appearance: '第 1、5、12 集', symbol: '初见 / 暗恋的信物',
    material: '亚克力 + 镀银金属', firstAppear: '第 1 集 02:14 操场', lastAppear: '第 12 集 38:52 天台',
    detail: '深海蓝主体 + 一颗白色小贝壳挂饰，背面刻有 "L.X." 缩写。',
    tags: ['信物', '高频'],
    summary: '陈昱在新生报到日捡到，归还时第一次记住了林夏的名字。',
  },
  {
    id: 'p2', name: '旧吉他', emoji: '🎸',
    gradient: 'from-amber-600/40 via-orange-400/30 to-yellow-200/30',
    owner: '陈昱', appearance: '第 3、8 集', symbol: '父亲遗物 / 内心柔软',
    material: '云杉木 + 玫瑰木指板', firstAppear: '第 3 集 21:08 天台', lastAppear: '第 8 集 47:30 卧室',
    detail: '琴身右下角有一处烧痕，琴颈贴着一张泛黄的便签写着"给小昱"。',
    tags: ['情感线', '父亲线'],
    summary: '只在天台独自弹奏，是男主拒绝示弱的另一面。',
  },
  {
    id: 'p3', name: '樱花书签', emoji: '🍃',
    gradient: 'from-pink-300/40 via-rose-200/30 to-emerald-200/30',
    owner: '林夏 → 陈昱', appearance: '第 6、11、12 集', symbol: '暗恋的具象 / 最终交付',
    material: '压制樱花 + 透明树脂', firstAppear: '第 6 集 09:02 图书馆', lastAppear: '第 12 集 42:11 操场',
    detail: '夹在《海子诗选》第 87 页，背面用极小的字写着 "如果有一天…"。',
    tags: ['信物', '收尾'],
    summary: '林夏夹在书里写满未送出的话，最后一集随书一起交到陈昱手中。',
  },
  {
    id: 'p4', name: '银色挂坠', emoji: '🔮',
    gradient: 'from-slate-400/40 via-zinc-300/30 to-purple-300/30',
    owner: '苏婉', appearance: '第 2、9 集', symbol: '反派的脆弱来源',
    material: '925 银 + 黑曜石', firstAppear: '第 2 集 14:55 学生会办公室', lastAppear: '第 9 集 33:20 雨夜',
    detail: '心型小盒可打开，内部嵌有母亲与幼年苏婉的合照，盒盖刻字 "To my Wan"。',
    tags: ['反派线', '伏笔'],
    summary: '母亲留下的唯一物件，揭示苏婉行为背后真正的孤独。',
  },
]

export function getAssetById(tab: AssetTab, id: string) {
  if (tab === 'character') return characterAssets.find(c => c.id === id)
  if (tab === 'scene') return sceneAssets.find(s => s.id === id)
  if (tab === 'prop') return propAssets.find(p => p.id === id)
  return undefined
}
