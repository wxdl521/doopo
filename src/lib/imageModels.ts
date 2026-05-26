export type ImageModelOption = { key: string; label: string }

export const IMAGE_MODELS: ImageModelOption[] = [
  { key: '', label: 'Gemini (auto)' },
  { key: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash 🟢' },
  { key: 'qwen-image-2.0-pro', label: 'Qwen Image 2.0 Pro 🟣' },
  { key: 'qwen-image-2.0', label: 'Qwen Image 2.0 🟣' },
  { key: 'qwen-image-max', label: 'Qwen Image Max 🟣' },
  { key: 'qwen-image-plus', label: 'Qwen Image Plus 🟣' },
  { key: 'wan2.6-t2i', label: 'Wan 2.6 🟠' },
  { key: 'wan2.5-t2i-preview', label: 'Wan 2.5 Preview 🟠' },
  { key: 'wan2.2-t2i-flash', label: 'Wan 2.2 Flash 🟠' },
  { key: 'wan2.2-t2i-plus', label: 'Wan 2.2 Plus 🟠' },
  { key: 'wanx2.1-t2i-turbo', label: 'Wanx 2.1 Turbo 🟠' },
  { key: 'wanx2.1-t2i-plus', label: 'Wanx 2.1 Plus 🟠' },
  { key: 'wanx2.0-t2i-turbo', label: 'Wanx 2.0 Turbo 🟠' },
]