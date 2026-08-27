// Visual style prompt fragments used by character / scene image generation.
//
// The `style` key matches the project's `style` field (see NewProjectDialog →
// styles array). Each entry contains:
//   - positive: a short English phrase describing the visual style to enforce
//   - negative: things that explicitly contradict the style (helps when the
//     upstream model supports negative prompts; otherwise we still include it
//     in the body as "AVOID:" so it acts as a soft negative)
//
// Keep phrases compact but specific (art medium + lighting + line treatment
// + palette). They're injected into genCharImage / genPanelImage prompts so
// every image in a project stays on-brand even across regenerations.

export type VisualStyleSpec = {
  positive: string;
  negative: string;
  /** Short Chinese label for UI display in toasts/logs */
  label: string;
};

export const PROJECT_STYLE_PROMPTS: Record<string, VisualStyleSpec> = {
  // 3D CG / Pixar-style 3D cartoon
  // 5 维度结构:渲染/光照/色彩/镜头/材质
  // negative 5-7 条具体反例,跨风格禁止漂移
  "3d-cg": {
    positive: [
      // 渲染
      "high-end 3D CG render, octane/cycles physically-based shading, smooth subsurface scattering on skin, soft global illumination, slightly stylized proportions, ultra-detailed polygon mesh",
      // 光照
      "cinematic 3-point studio lighting, soft warm key light from upper-left, cool fill light, gentle ambient occlusion, no harsh shadows, no blown-out highlights",
      // 色彩
      "rich cinematic color grading, balanced warm/cool tones, medium-to-high saturation, no flat color blocks, no neon saturation, no watercolor bleed",
      // 镜头
      "cinematic depth of field, 35-50mm lens equivalent, slight bokeh on background, eye-level or low angle framing, three-quarter view preferred over dead-on",
      // 材质
      "physically-based materials: skin shows pores, fabric shows weave, metal shows anisotropic reflections, glass shows refraction, no plasticine / clay / pixel texture",
    ].join("\n"),
    negative: [
      "2D flat illustration, anime line art, cel-shading, manga inking",
      "photorealistic photo, DSLR skin pores, real human photograph",
      "chibi proportions, oversized head, 2-head-tall body",
      "pixel art, low resolution, 8-bit, dithering",
      "watercolor wash, ink bleeding, sumi-e brush strokes",
      "sketch, pencil lines, unfinished look",
      "low-poly, faceted geometry, no shading",
    ].join(", "),
    label: "3D CG",
  },
  // Anime / Japanese-Korean animation
  "anime-jp": {
    positive: [
      // 渲染
      "modern anime key visual style, vibrant cel-shading with soft gradient fill, sharp clean line art, large expressive eyes, glossy hair highlights",
      // 光照
      "flat anime-style lighting with strong rim light on hair and shoulders, soft cel-shaded shadows, no photorealistic global illumination",
      // 色彩
      "vivid anime color palette, saturated but not neon, gradient sky backgrounds, distinct color zones for hair/eyes/clothing",
      // 镜头
      "2D composition, eye-level or slight low angle, dynamic but non-distorted pose, clean negative space, no cinematic depth-of-field blur",
      // 材质
      "smooth flat skin without pores, glossy hair with sharp highlight streaks, fabric rendered as flat color zones with simple shading",
    ].join("\n"),
    negative: [
      "3D render, octane shading, subsurface scattering, PBR materials",
      "photorealistic, DSLR photo, real human skin texture",
      "western cartoon, Pixar-style, soft 3D proportions",
      "chibi, super-deformed, 2-head-tall",
      "pixel art, voxel",
      "watercolor, sumi-e ink, oil painting",
      "low quality, jpeg artifacts, blurry",
    ].join(", "),
    label: "动漫-日韩",
  },
  // Pixar-style 3D cartoon
  pixar: {
    positive: [
      // 渲染
      "Pixar-style 3D character render, soft stylized proportions, large expressive eyes, exaggerated but appealing facial features, smooth rounded forms",
      // 光照
      "warm cinematic key light from upper-right, soft fill light, ambient occlusion in creases, subsurface scattering on skin, no harsh contrast",
      // 色彩
      "rich warm cinematic color grading, family-friendly saturation, complementary color schemes, soft pastel undertones",
      // 镜头
      "cinematic 3-point composition, gentle bokeh on background, eye-level framing, three-quarter character pose, no extreme angles",
      // 材质
      "soft skin without pores, smooth stylized fabric with subtle weave, glossy eyes with strong catchlight, hair rendered as soft chunks",
    ].join("\n"),
    negative: [
      "photorealistic, DSLR photo, real human skin with pores",
      "anime line art, cel-shading, 2D illustration",
      "chibi, super-deformed, 2-head-tall proportions",
      "dark gritty, horror, realistic gore",
      "pixel art, low resolution, low-poly faceted",
      "watercolor, sumi-e ink, rough sketch",
    ].join(", "),
    label: "3D-皮克斯卡通",
  },
  // Photorealistic — 融合真实真人皮肤质感描述
  realistic: {
    positive: [
      // 渲染
      "photorealistic portrait, anatomically accurate, real human skin texture, natural pores and skin grain retained, fine vellus hair (peach fuzz) on cheeks, subtle skin tone unevenness, minimal natural blemishes and minor imperfections, real makeup finish with natural texture, natural sebum/sheen on skin, soft specular highlights without excessive glare",
      // 光照
      "commercial photography grade lighting, cinematic Rembrandt or natural window lighting, soft falloff, soft key light with gentle fill, natural skin catchlight, no flat studio lighting, no cel-shading, no rim light glow",
      // 色彩
      "naturalistic color palette, accurate skin undertones (warm/cool/neutral), muted real-world saturation, slight color variation across skin areas, no over-saturation, no posterized color zones, no AI beauty filter color cast",
      // 镜头
      "shallow depth of field, 50-85mm prime lens look, bokeh on background, eye-level framing, natural body proportions, commercial portrait photography composition",
      // 材质
      "photographic skin with subsurface scattering, real fabric drape and weight, natural hair with individual strand detail, no plasticine / clay / pixel / cartoon shading, no wax figure appearance",
    ].join("\n"),
    negative: [
      "cartoon, anime, illustration, 2D drawing",
      "CGI, 3D render, octane shading, Pixar-style",
      "chibi, super-deformed, 2-head-tall",
      "painting, watercolor, sumi-e, oil brush",
      "over-smoothing, plastic skin, airbrushed, excessive blur, over-polished skin",
      "pixel art, low resolution, cel-shaded",
      "wax figure, mannequin, doll-like skin, plastic-looking skin",
      "AI beauty filter, beauty mode, beauty gaussian blur, excessive skin retouching",
      "no pores, poreless skin, glass skin, unrealistic smoothness",
    ].join(", "),
    label: "写实-真人",
  },
  // Wuxia / Chinese ink
  wuxia: {
    positive: [
      // 渲染
      "Chinese wuxia xianxia ink painting, flowing silk robes, dramatic sword poses, hand-painted brushwork with subtle color accents",
      // 光照
      "ethereal mist and atmospheric haze, dramatic backlight from cliff edges, ink-wash gradient shadows, no harsh direct light",
      // 色彩
      "muted ink palette with selective color accents (vermilion / jade green / gold), sumi-e black-grey-white base, rice paper warmth",
      // 镜头
      "classical Chinese landscape composition, layered foreground / midground / background, generous negative space, asymmetrical balance",
      // 材质
      "rice paper texture, ink bleeding at edges, brush stroke visibility, silk fabric with painted highlights, not photographic material",
    ].join("\n"),
    negative: [
      "modern clothing, neon lights, cyberpunk, sci-fi",
      "photorealistic photo, DSLR skin, real human",
      "cute chibi, kawaii, super-deformed",
      "3D render, octane, PBR, Pixar",
      "pixel art, 8-bit, low resolution",
      "manga line art, anime cel-shading",
    ].join(", "),
    label: "武侠水墨",
  },
  // Chibi / super-deformed
  chibi: {
    positive: [
      // 渲染
      "super-deformed chibi style, oversized head on small body, 2-3 head tall proportions, huge sparkling eyes, simplified facial features",
      // 光照
      "flat soft shading, gentle cel-shaded shadows, no harsh contrast, no realistic global illumination, no rim light",
      // 色彩
      "pastel kawaii palette, soft pinks / mints / sky blues / cream, low-to-medium saturation, no dark gritty tones",
      // 镜头
      "front-facing or three-quarter view, eye-level framing, simple clean background, generous white space, no dynamic angle",
      // 材质
      "flat clean rendering, bold outlines, smooth color fills, no photorealistic skin, no fabric texture detail",
    ].join("\n"),
    negative: [
      "realistic proportions, 7-8 head tall adult anatomy",
      "gritty, dark, mature, horror, gore",
      "photorealistic photo, DSLR, real human",
      "3D render, octane, PBR, Pixar",
      "pixel art, voxel, low-poly",
      "watercolor, sumi-e ink, rough brush",
    ].join(", "),
    label: "Q版萌系",
  },
  // Makoto Shinkai style
  shinkai: {
    positive: [
      // 渲染
      "Makoto Shinkai anime film style, hyper-detailed sky and atmospheric perspective, painterly background illustration, soft anime character render",
      // 光照
      "lens flare and bloom highlights, soft focus depth, dramatic golden hour / blue hour light, rim light on hair, no harsh shadow",
      // 色彩
      "warm/cool color contrast, vivid sky gradients (orange to cyan), pastel highlights, high saturation in sky zones, gentle desaturation in midground",
      // 镜头
      "cinematic anime framing, dramatic sky composition, character small in frame against vast environment, low angle emphasizing sky",
      // 材质
      "semi-photorealistic backgrounds, painterly texture, anime cel-shaded character with realistic light interaction, water and glass with detailed reflections",
    ].join("\n"),
    negative: [
      "chibi, super-deformed, 2-head-tall",
      "low detail, flat color, no atmospheric perspective",
      "dark gritty, horror, cyberpunk neon overload",
      "gritty realism, DSLR photo, real human",
      "3D render, octane, Pixar-style 3D",
      "pixel art, voxel, low resolution",
    ].join(", "),
    label: "新海诚风",
  },
  // Healing hand-drawn
  healing: {
    positive: [
      // 渲染
      "healing hand-drawn illustration style, soft watercolor washes, gentle line art, organic pencil-like outlines, slight paper texture",
      // 光照
      "warm sunlight streaming through leaves, soft dappled light, golden hour glow, no harsh contrast, no neon lighting",
      // 色彩
      "warm pastel palette, cream / mint / sky blue / blush pink, low saturation, watercolor gradient transitions between color zones",
      // 镜头
      "eye-level intimate framing, close to medium shot, characters within their environment, no extreme angle, no wide cinematic",
      // 材质
      "watercolor paper texture, soft brush stroke edges, slightly imperfect line work, fabric rendered as soft painted forms",
    ].join("\n"),
    negative: [
      "cyberpunk, dark, gritty, neon, sci-fi",
      "horror, gore, dark moody palette",
      "photorealistic photo, DSLR, real human",
      "3D render, octane, PBR, Pixar",
      "pixel art, voxel, low resolution",
      "manga line art, anime cel-shading",
    ].join(", "),
    label: "治愈手绘",
  },
  // Cyberpunk
  cyberpunk: {
    positive: [
      // 渲染
      "cyberpunk character concept, neon-lit urban night, holographic accents on clothing, chromatic aberration glow, futuristic streetwear with cybernetic details",
      // 光照
      "moody cinematic lighting, strong neon key lights in magenta/cyan, deep shadows, rim light from holographic signs, no natural sunlight",
      // 色彩
      "high-contrast neon palette, magenta + cyan + electric yellow accents on dark base, high saturation in lit zones, low-key base color",
      // 镜头
      "low angle hero shot, dramatic upward perspective, Dutch angle optional, neon signs and rain in foreground, bokeh on background lights",
      // 材质
      "reflective wet surfaces, glowing holographic decals, dark leather / vinyl / metallic fabric, cybernetic parts with internal glow",
    ].join("\n"),
    negative: [
      "medieval, pastoral, ancient, historical",
      "soft pastel, kawaii, cute chibi",
      "natural daylight, warm sunlight, golden hour",
      "photorealistic daylight photo, real human",
      "watercolor, sumi-e ink, traditional brush",
      "3D Pixar-style, family-friendly aesthetic",
    ].join(", "),
    label: "赛博朋克",
  },
  // Western comic
  comic: {
    positive: [
      // 渲染
      "western comic book illustration, bold clean ink outlines, halftone shading, dynamic pose, exaggerated foreshortening, Marvel/DC cover aesthetic",
      // 光照
      "comic book lighting, strong directional light with hard-edged shadows, rim light for separation, no smooth gradient ambient",
      // 色彩
      "saturated primary colors, bold red / blue / yellow zones, high contrast, no muted earth tones, no pastel",
      // 镜头
      "dramatic low angle or bird's eye, strong foreshortening, dynamic action pose, speed lines optional",
      // 材质
      "flat color zones with halftone dots, no realistic material texture, no 3D shading, no soft gradient fill",
    ].join("\n"),
    negative: [
      "manga line art, anime cel-shading, Japanese style",
      "photorealistic photo, DSLR, real human",
      "watercolor, sumi-e, traditional brush",
      "minimalist, flat design, vector icon",
      "3D render, octane, Pixar-style",
      "pixel art, low resolution, voxel",
    ].join(", "),
    label: "美漫风",
  },
  // Pixel art
  pixel: {
    positive: [
      // 渲染
      "16-bit pixel art sprite, limited 32-color palette, crisp non-anti-aliased pixels, dithering for shading, retro JRPG character portrait aesthetic",
      // 光照
      "flat color zone shading, no smooth gradient, no global illumination, dithering for transition zones, hard-edged light/shadow split",
      // 色彩
      "limited saturated retro palette, NES/SNES era color choices, no modern gradient ramps, no over-bright highlights",
      // 镜头
      "front-facing or three-quarter sprite pose, no perspective foreshortening, no cinematic depth of field, square pixel canvas",
      // 材质
      "pure pixel rendering, no anti-aliased curves, no vector graphics, no 3D shading, no painterly texture",
    ].join("\n"),
    negative: [
      "smooth gradients, soft anti-aliased curves",
      "photorealistic photo, DSLR, real human",
      "3D render, octane, PBR, Pixar",
      "vector graphics, minimalist flat design",
      "high resolution, 4K, photorealistic detail",
      "watercolor, oil painting, traditional brush",
    ].join(", "),
    label: "像素艺术",
  },
  // Claymation / clay stop-motion
  clay: {
    positive: [
      // 渲染
      "claymation stop-motion style, hand-sculpted clay figure, visible fingerprint textures, soft plasticine surface, slight asymmetry from hand sculpting",
      // 光照
      "miniature diorama lighting, soft practical lights, subtle shadows, warm tungsten feel, no harsh direct light",
      // 色彩
      "slightly desaturated plasticine palette, muted earth tones with accent colors, no neon, no photographic saturation",
      // 镜头
      "eye-level intimate framing, slight tilt-shift miniature feel, close to medium shot, no wide cinematic",
      // 材质
      "visible clay surface, fingerprint marks, slight sheen on plasticine, fabric rendered as soft molded forms, not real cloth",
    ].join("\n"),
    negative: [
      "smooth digital rendering, vector graphics, flat design",
      "photorealistic, DSLR, real human, real fabric",
      "anime line art, cel-shading, manga",
      "pixel art, voxel, low resolution",
      "watercolor, sumi-e, oil painting",
      "3D octane, PBR, Pixar-style smooth",
    ].join(", "),
    label: "黏土定格",
  },
};

/** 右侧视频确认卡展示的中文风格指纹。与 positive 的五维顺序一一对应。 */
const EDITABLE_STYLE_FINGERPRINTS_ZH: Record<
  string,
  readonly [string, string, string, string, string]
> = {
  "3D CG": [
    "高端 3D CG 物理渲染，细腻网格与轻度风格化比例",
    "电影级三点布光：暖主光、冷辅光与柔和环境遮蔽",
    "电影级暖冷平衡调色，中高饱和，避免霓虹与平涂",
    "35–50mm 电影镜头感，浅景深，平视或低机位三分之四构图",
    "符合物理规律的皮肤、织物、金属和玻璃材质细节",
  ],
  "动漫-日韩": [
    "现代日韩动画主视觉，清晰线稿、柔和赛璐璐渐变与大而有神的眼睛",
    "动画式平面光照，发丝与肩部轮廓光，柔和赛璐璐阴影",
    "鲜明但不过曝的动漫配色，天空渐变，发色、眼睛和服装色区清晰",
    "二维构图，平视或微仰，姿势有动势但不夸张透视，保留干净留白",
    "无毛孔的平滑肤色、亮泽发丝与简洁分区着色的服装",
  ],
  "3D-皮克斯卡通": [
    "皮克斯式三维卡通造型：圆润、柔和、表情夸张且讨喜",
    "右上方暖主光、柔和补光和环境遮蔽，避免强烈反差",
    "温暖电影调色，亲和的中高饱和度与柔和粉彩底色",
    "电影化三分法构图，轻微背景虚化，平视三分之四角度，避免极端机位",
    "无毛孔的柔和皮肤、细微织物纹理、明亮眼神光和块状柔软发丝",
  ],
  "写实-真人": [
    "照片级真人渲染，解剖结构准确，保留自然毛孔、绒毛与轻微肌理",
    "商业人像级伦勃朗光或窗光，柔和过渡与自然眼神光",
    "自然肤色与真实世界的低饱和配色，避免过度磨皮、偏色和滤镜感",
    "50–85mm 定焦镜头感，浅景深，平视人像构图与自然比例",
    "真实皮肤次表面散射、自然垂坠布料和逐根发丝细节，避免蜡像感",
  ],
  武侠水墨: [
    "中式武侠仙侠水墨手绘，飘逸衣袂与有张力的动作姿态",
    "云雾氛围、崖边逆光与水墨渐层阴影，避免生硬直射光",
    "黑灰白水墨基调，点缀朱红、玉绿或金色，带宣纸暖色",
    "传统山水的前中后景层次与留白，非对称平衡构图",
    "宣纸纹理、边缘墨晕、可见笔触，以及绘制感丝绸高光",
  ],
  Q版萌系: [
    "大头小身的 Q 版比例，约两到三头身，大眼与简化五官",
    "柔和的平面赛璐璐阴影，避免硬反差、写实全局光和强轮廓光",
    "粉、薄荷、天蓝、奶油等柔和低中饱和的可爱配色",
    "平视正面或三分之四视角，简洁背景和充足留白，避免夸张机位",
    "干净粗线条与平滑色块，不表现写实皮肤或精密织物纹理",
  ],
  新海诚风: [
    "细腻动画电影质感，天空与空气透视高度精细，背景具绘画感",
    "金色或蓝色时刻光、柔焦与镜头光晕，发丝轮廓光，避免硬阴影",
    "暖冷对比、橙青天空渐变与高饱和天空，远景适度降饱和",
    "电影化动画构图：广阔环境中的小人物，低机位突出天空",
    "半写实绘画背景、赛璐璐人物与真实光照互动，水面和玻璃反射精细",
  ],
  治愈手绘: [
    "温柔手绘插画，水彩晕染、轻柔线稿与略带纸张感的铅笔轮廓",
    "树叶间暖阳与斑驳光，金色时刻氛围，避免硬反差和霓虹光",
    "奶油、薄荷、天蓝、腮红粉等低饱和暖粉彩，水彩自然过渡",
    "亲密的平视近中景，人物融入环境，避免极端机位与宽银幕夸张感",
    "水彩纸纹、柔软笔触边缘和略有不完美的线条，布料呈绘制感",
  ],
  赛博朋克: [
    "霓虹都市夜景下的赛博朋克概念设计，未来街头服饰和义体细节",
    "洋红与青色霓虹主光、深阴影与招牌轮廓光，避免自然日光",
    "暗底上的高对比洋红、青色和电光黄，高饱和仅聚焦于受光区域",
    "低机位英雄镜头，可选荷兰角，前景雨水与霓虹招牌形成背景散景",
    "湿润反光表面、发光全息贴片、皮革/乙烯基/金属与内部发光义体",
  ],
  美漫风: [
    "美式漫画书插画，粗而干净的墨线、网点阴影和夸张透视动作",
    "强方向性漫画光，硬边阴影与轮廓光，避免柔和渐变环境光",
    "高饱和红蓝黄主色与强对比，避免大地色和粉彩",
    "戏剧性低机位或俯视，强透视缩短与动态姿势，可使用速度线",
    "平面色块与网点材质，不使用写实材质、三维阴影或柔和渐变",
  ],
  像素艺术: [
    "16 位像素画，限定约 32 色，清晰无抗锯齿像素与抖动阴影",
    "硬边明暗分区与抖动过渡，避免平滑渐变和全局光照",
    "NES/SNES 时代的有限高饱和复古色板，避免现代渐变和过曝高光",
    "正面或三分之四精灵姿势，无强透视和电影景深，保持像素画布感",
    "纯像素化边缘，无矢量曲线、三维阴影或绘画笔触",
  ],
  黏土定格: [
    "手工黏土定格动画，略有不对称的塑形与可见指纹纹理",
    "微缩场景实景灯光，柔和实用光与细微阴影，带暖钨丝灯气质",
    "略去饱和的橡皮泥色板，以柔和大地色配点缀色，避免霓虹与摄影级饱和",
    "平视亲密近中景，轻微移轴的微缩感，避免宽广电影式机位",
    "可见黏土表面、指纹与微光泽，服装呈柔软塑形而非真实布料",
  ],
};

/** 供用户编辑的视频提示词使用：中文呈现项目风格的五维指纹。 */
export function buildEditableStyleFingerprint(spec: VisualStyleSpec): string {
  const dimensions = ["渲染", "光照", "色彩", "镜头", "材质"] as const;
  const fingerprint = EDITABLE_STYLE_FINGERPRINTS_ZH[spec.label] ?? [
    "遵循自定义风格描述进行画面渲染",
    "使用与自定义风格一致的光照逻辑",
    "使用与自定义风格一致的色彩方案",
    "使用与自定义风格一致的镜头语言",
    "使用与自定义风格一致的材质表现",
  ];
  return [
    `风格：${spec.label}`,
    ...dimensions.map((dimension, index) => `• ${dimension}：${fingerprint[index]}`),
  ].join("\n");
}

/** Look up a project style, falling back to 'realistic' if the project style
 *  is empty / unknown. Returns the spec plus a stable label. */
export function resolveProjectStyle(
  projectStyle: string | null | undefined,
): VisualStyleSpec & { key: string } {
  const key = projectStyle || "realistic";
  if (key.startsWith("custom:")) {
    const customPrompt = key.slice("custom:".length).trim();
    return {
      key: "custom",
      label: "自定义风格",
      positive: customPrompt || PROJECT_STYLE_PROMPTS.realistic.positive,
      negative: PROJECT_STYLE_PROMPTS.realistic.negative,
    };
  }
  const spec = PROJECT_STYLE_PROMPTS[key] ?? PROJECT_STYLE_PROMPTS.realistic;
  return { key, ...spec };
}

// ============================================================================
// 风格锁(2026/06) —— 跨角色/场景/分镜/故事板统一注入同一段"风格强约束"
// --------------------------------------------------------------------------
// 用户痛点:同 project 选了 3D CG,但角色 A 偏写实、角色 B 偏卡通、场景 C
// 偏 Q版,Seedream 在多次 T2I/I2I 调用间发挥不一致。
//
// 修法(分两步,本文件只做"标准化提示词"这一步):
//   1) PROJECT_STYLE_PROMPTS 里每个 style 的 positive 扩成 5 维度结构化
//      描述(渲染/光照/色彩/镜头/材质),negative 扩到 5-7 条具体反例。
//   2) 所有 prompt 入口(角色/场景/分镜/故事板)统一调用 buildStyleLock(),
//      拼出 [STYLE LOCK ...] 块,Seedream 看到后被强制按"指纹"生成。
//
// "参考图"那一步暂不做(参见 chat 讨论):纯 T2I 入口没 image 字段,塞其他
// 角色图会引导模型模仿人物而走偏,需要另准备"项目级无内容风格锚图",代价
// 高且不是当前阻塞。先用 prompt 标准化让 80% 漂移消失,留 20% 给后续
// 风格锚图叠 buff。
// ============================================================================

/** 5 维度标签 —— 顺序与 PROJECT_STYLE_PROMPTS 里 positive 行的顺序一一对应 */
const STYLE_DIMENSION_LABELS = ["渲染", "光照", "色彩", "镜头", "材质"] as const;

/**
 * 把 VisualStyleSpec 拼成统一的"风格锁"段落,所有 5 个 Seedream 入口
 * (generateImage / regenerateCharacterLook / generateStoryboardShotImage /
 * regenerateStoryboardShot / generateStoryboardPitchDeck)+ 2 个客户端
 * prompt builder (processCharacter / genPanelImage)+ 1 个 bug 修复
 * (genSceneImage)都用这一段,确保跨调用风格统一。
 *
 * @param spec      - VisualStyleSpec(label + positive 多行 + negative)
 * @param ctx?      - 上下文(可选)。例如 'character' / 'scene' / 'panel' / 'deck'。
 *                    提示模型"这套规则适用于哪种图",减少漂移。
 */
export function buildStyleLock(
  spec: VisualStyleSpec,
  ctx?: "character" | "scene" | "panel" | "deck" | "reference" | "regen",
): string {
  const lines: string[] = [];
  lines.push(`[STYLE LOCK — 项目视觉风格强约束,适用对象:${ctx ?? "image"}]`);
  lines.push(`Style name: ${spec.label}`);
  lines.push("【风格指纹 —— 5 维度,每条都必须遵守】");
  const positiveLines = spec.positive
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  positiveLines.forEach((p, i) => {
    const label = STYLE_DIMENSION_LABELS[i] ?? `维度 ${i + 1}`;
    lines.push(`  • ${label}: ${p}`);
  });
  lines.push("【AVOID —— 严格禁止(出现任一 = 重画)】");
  lines.push(`  ${spec.negative}`);
  lines.push("【HARD CONSTRAINT】");
  lines.push("  整张图所有视觉元素(人物 / 场景 / 道具 / 背景)必须严格遵循上述 5 维度风格指纹,");
  lines.push("  共享同一套渲染技法、同一套色板、同一套光照方向、同一套镜头语言。");
  lines.push("  禁止风格漂移到任何其他 style(写实 / anime / 3D / 像素 / 水墨 / 漫画 等)。");
  return lines.join("\n");
}

// ============================================================================
// 模型解析 —— 2026 Seedream 迁移后
// ============================================================================
//
// 历史背景(2026 之前):NewProjectDialog 早先把 sceneModel 默认值设成
// `qwen-image-max`,但用户订阅里没有 qwen-image-max(qwen.md 里可用的是
// qwen-image-2.0 / 2.0-pro / wan2.7-image / wan2.7-image-pro)。老项目里
// sceneModel 是 `qwen-image-max` 会直接被 DashScope 400 掉。
//
// 2026 之后:默认走火山方舟 ARK 的 Doubao Seedream(`doubao-seedream-5-0-260128`),
// 统一支持 T2I + I2I(没有 qwen-image-2.0-pro 那种"I2I-only"坑)。
// legacy Qwen / Wan 仍作为用户手动兜底层保留。
//
// `resolveImageModel` 在调用前把无效/已弃用的 model 映射到实际可用的等价物,
// 同时区分 T2I(只吃文本)和 I2I(吃图+文本)两种用途。
// ============================================================================

/** Seedream 默认 model(同时支持 T2I 和 I2I) */
const SEEDREAM_DEFAULT = "doubao-seedream-5-0-260128";
const SEEDREAM_I2I_DEFAULT = "doubao-seedream-5-0-260128";

/** 已知会 400 的旧/无效 T2I model 列表(Qwen 时期遗物) */
const DEPRECATED_T2I_MODELS = new Set<string>([
  "qwen-image-max",
  "qwen-image-max-2025-12-30",
  "qwen-image-2.0-pro",
  "qwen-image-2.0-pro-2026-04-22",
  "qwen-image-2.0-pro-2026-03-03",
]);

/** 该用户的 T2I 可用 model(Seedream + Qwen/Wan 兜底) */
const VALID_T2I_MODELS = new Set<string>([
  SEEDREAM_DEFAULT,
  "qwen-image-2.0",
  "qwen-image",
  "qwen-image-plus",
  "wan2.7-image",
  "wan2.7-image-pro",
  "wan2.6-t2i",
  "wan2.5-t2i-preview",
  "wan2.2-t2i-flash",
  "wanx2.1-t2i-turbo",
  "wanx2.1-t2i-plus",
  // 2026/06:补 Gemini(走 OpenRouter) + GPT-Image-2(走 Pixflow 直连)。
  // Gemini 3.1 Flash Image 支持 T2I,跟 Qwen Plus / Wan 一样是 T2I 兜底。
  "google/gemini-3.1-flash-image-preview",
  "openai/gpt-image-2",
  "openai/gpt-image-1-mini",
  // Pixflow gateway 前缀(api.pixflow.im,OpenAI 兼容)
  "pixflow/gpt-image-2",
  "pixflow/gemini-3-pro-image-preview",
  "pixflow/gemini-3.1-flash-image-preview",
  "pixflow/gemini-3.1-flash-image",
  "pixflow/gemini-3-flash",
  "pixflow/gemini-3.5-flash",
  // Tokenflash gateway 前缀(tokenflash.cn,OpenAI 兼容)
  "tokenflash/gpt-image-2",
  // Revora gateway 前缀(revora.vip,OpenAI 兼容)
  "revora/gpt-image-2-high",
  "revora/gpt-image-2-medium",
  "revora/gpt-image-2-low",
  // 汇流 Confluo gateway
  "confluo/gpt-image-2",
  // 灵梦 Lingmeng gateway
  "lingmeng/gpt-image-2",
  // AIGCFamily gateway 前缀
  "aigcfamily/gpt-image-2",
  // Azure OpenAI 直连
  "azure/gpt-image-2",
  "azure2/gpt-image-2",
  "azure3/gpt-image-2",
  "azure0716/gpt-image-2",
  // 晶美 APIM 并发生图网关（此前缺白名单,选了被静默 fallback 到 Seedream）
  "azure-image2/gpt-image-2",
  // OneToken gateway
  "onetoken/gpt-image-2",
  // OTU gateway
  "otu/gpt-image-2",
  // AI Tokenvibe gateway
  "aitokenvibe/gpt-image-2",
  // 天鸿智算 gateway
  "thhtcloud/gpt-image-2",
  // ailinzi gateway
  "ailinzi/gpt-image-2",
  // TokenHub gateway
  "tokenhub/gpt-image-2",
  // AgentEarth gateway
  "agentearth/image2",
  // Nagora gateway (Azure渠道)
  "nagora/gpt-image-2",
  // Lovable gateway 模型
  "lovable/google/gemini-3-flash-preview",
  "lovable/google/gemini-3.1-flash-image-preview",
  "lovable/openai/gpt-image-2",
]);

/** I2I(图生图)可用的 model(Seedream + Qwen/Wan 兜底) */
const VALID_I2I_MODELS = new Set<string>([
  SEEDREAM_I2I_DEFAULT,
  "qwen-image-2.0-pro",
  "qwen-image-plus",
  "wan2.7-image-pro",
  "wan2.6-t2i",
  "wanx2.1-t2i-plus",
  // 2026/06:Gemini 走 OpenRouter(modalities:image),GPT-Image 走 Pixflow
  // /v1/images/edits(OpenAI Images 协议 + multipart)。seedream.functions.ts
  // 委派到 regenerateImageI2I,路由选择看 openrouterImage.functions.ts。
  "google/gemini-3.1-flash-image-preview",
  "openai/gpt-image-2",
  "openai/gpt-image-1-mini",
  "pixflow/gpt-image-2",
  "pixflow/gemini-3-pro-image-preview",
  "pixflow/gemini-3.1-flash-image-preview",
  "pixflow/gemini-3.1-flash-image",
  "pixflow/gemini-3-flash",
  "pixflow/gemini-3.5-flash",
  "tokenflash/gpt-image-2",
  "revora/gpt-image-2-high",
  "revora/gpt-image-2-medium",
  "revora/gpt-image-2-low",
  "confluo/gpt-image-2",
  "lingmeng/gpt-image-2",
  // AIGC Family 网关仅支持 T2I(无 /v1/images/edits),不列入 I2I
  "azure/gpt-image-2",
  "azure2/gpt-image-2",
  "azure3/gpt-image-2",
  "azure0716/gpt-image-2",
  "azure-image2/gpt-image-2",
  "onetoken/gpt-image-2",
  "otu/gpt-image-2",
  "aitokenvibe/gpt-image-2",
  "thhtcloud/gpt-image-2",
  "ailinzi/gpt-image-2",
  "tokenhub/gpt-image-2",
  "agentearth/image2",
  "nagora/gpt-image-2",
  "lovable/google/gemini-3-flash-preview",
  "lovable/google/gemini-3.1-flash-image-preview",
  "lovable/openai/gpt-image-2",
  "claude360/gpt-image-2",
  "shuci/gpt-image-2",
]);

/** 已知的模型前缀列表 */
const KNOWN_MODEL_PREFIXES = [
  "pixflow/",
  "tokenflash/",
  "revora/",
  "confluo/",
  "aigcfamily/",
  "claude360/",
  "shuci/",
  "azure/",
  "azure2/",
  "azure3/",
  "azure0716/",
  "azure-image2/",
  "onetoken/",
  "otu/",
  "aitokenvibe/",
  "thhtcloud/",
  "ailinzi/",
  "tokenhub/",
  "agentearth/",
  "nagora/",
  "lovable/",
  "openrouter/",
  "gemini:",
  "openai:",
  "anthropic:",
  "claude:",
  "deepseek:",
  "meta:",
  "llama:",
  "mistral:",
  "xai:",
  "grok:",
  "qwen:",
];

/**
 * 检查 model 是否有已知前缀
 */
function hasKnownPrefix(model: string): boolean {
  return KNOWN_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/**
 * 把 sceneModel 解析成 T2I 可用的 model。
 * 找不到 / 已知无效 / I2I-only → fallback 到 Seedream 默认。
 */
export function resolveT2IModel(sceneModel: string | null | undefined): string {
  const m = (sceneModel || "").trim();
  if (!m) return SEEDREAM_DEFAULT;
  if (DEPRECATED_T2I_MODELS.has(m)) return SEEDREAM_DEFAULT;
  if (VALID_T2I_MODELS.has(m)) return m;
  // 如果有已知前缀，直接返回该模型（不在白名单里也让服务器处理）
  if (hasKnownPrefix(m)) return m;
  // 未知 model:保守 fallback,不在服务器上乱试
  return SEEDREAM_DEFAULT;
}

/**
 * 把 sceneModel 解析成 I2I 可用的 model。
 * 找不到 / 已知无效 / 只支持 T2I 的 → fallback 到 Seedream 默认(I2I 兼容)。
 */
export function resolveI2IModel(sceneModel: string | null | undefined): string {
  const m = (sceneModel || "").trim();
  // OneToken 当前仅接入了 /images/generations 文生图接口，不能携带参考图。
  // 场景多视图、角色修改等 I2I 流程必须回退到已验证支持参考图的 Seedream，
  // 不能静默生成一张与图1无关的新图。
  if (m.toLowerCase().startsWith("onetoken/")) return SEEDREAM_I2I_DEFAULT;
  if (VALID_I2I_MODELS.has(m)) return m;
  // 如果有已知前缀，直接返回该模型
  if (hasKnownPrefix(m)) return m;
  return SEEDREAM_I2I_DEFAULT;
}
