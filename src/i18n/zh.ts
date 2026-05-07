export const zh = {
  // Nav
  nav_home: '首页',
  nav_models: '模型',
  nav_scripts: '剧本',
  nav_characters: '角色',
  nav_pricing: '价格',

  // Hero
  hero_title_line1: '让 AI',
  hero_title_line2: '成为你的创意伙伴',
  hero_subtitle: '探索最强大的 AI 模型，生成惊艳图片，编写专业剧本，塑造立体角色——全部免费。',
  hero_input_placeholder: '输入你的创意想法...',
  hero_send: '发送',
  hero_hint: '按 Enter 发送，Shift+Enter 换行',
  hero_chat_placeholder: '与 AI 对话...',

  // Models
  models_title: '精选模型',
  models_subtitle: '来自全球顶级提供商的强大模型，免费访问',
  models_provider: '提供商',
  models_context: '上下文',
  models_status_online: '在线',
  models_status_offline: '离线',
  models_try: '立即体验',
  models_filter_all: '全部',
  models_filter_image: '图片生成',
  models_filter_chat: '对话模型',
  models_filter_coding: '编程',

  // Characters
  characters_title: '角色设计',
  characters_subtitle: 'AI 驱动的角色创作工具，生成多视角 UID 图',
  char_style: '风格',
  char_style_vn: '视觉小说',
  char_style_chibi: 'Q版角色',
  char_style_gothic: '哥特风格',
  char_style_realistic: '写实风格',
  char_style_anime: '动漫风格',
  char_desc: '角色描述',
  char_desc_hint: '描述角色的外貌、性格、服装、场景...',
  char_generate: '开始生成',
  char_generating: '生成中...',
  char_view_front: '正面',
  char_view_side: '侧面',
  char_view_back: '背面',
  char_view_expression: '表情',
  char_view_accessory: '配饰',
  char_color_palette: '配色方案',
  char_copy_palette: '复制配色',
  char_copied: '已复制',
  char_download: '下载图片',
  char_no_generate: '描述角色后点击「开始生成」',

  // Scripts
  scripts_title: '剧本创作',
  scripts_subtitle: 'AI 帮你构思、撰写、优化剧本',
  script_type: '类型',
  script_type_micro: '微短剧',
  script_type_short: '短剧',
  script_type_feature: '长剧',
  script_type_ad: '广告脚本',
  script_genre: '题材',
  script_tone: '风格',
  script_tone_serious: '严肃',
  script_tone_comedy: '喜剧',
  script_tone_suspense: '悬疑',
  script_tone_romance: '爱情',
  script_tone_horror: '惊悚',
  script_theme: '主题/关键词',
  script_theme_hint: '例如：穿越、职场、复仇...',
  script_plot: '剧情概要',
  script_plot_hint: '简要描述剧情...',
  script_generate: '生成剧本',
  script_optimize: '优化剧本',
  script_expand: '扩展剧情',
  script_copy: '复制',
  script_copied: '已复制',
  script_clear: '清空',
  script_save: '保存',
  script_saved: '已保存',
  script_no_content: '输入主题和剧情概要后，点击「生成剧本」',

  // Pricing
  pricing_title: '免费使用',
  pricing_subtitle: '无需注册，无使用限制',
  pricing_feature_1: '无限次对话',
  pricing_feature_2: '无限次图片生成',
  pricing_feature_3: '无限次剧本创作',
  pricing_feature_4: '多模型切换',
  pricing_feature_5: '角色设计工具',

  // Footer
  footer_rights: '© 2025 Doopoo. All rights reserved.',
  footer_language: '语言',

  // Common
  common_refresh: '刷新',
  common_error: '出错了',
  common_retry: '重试',
  common_close: '关闭',
  common_save: '保存',
  common_cancel: '取消',
  common_confirm: '确认',
  common_loading: '加载中...',
  common_no_data: '暂无数据',

  // Theme
  theme_light: '浅色',
  theme_dark: '深色',
  theme_switch: '切换主题',
}

export type Translations = typeof zh
export const languages = ['中文', 'EN'] as const
export type Lang = 'zh' | 'en'
