# 修复:参考音频上传格式归一化(ARK 报 "audio format not valid")

## 根因

用户把 `.m4a` 文件**改后缀**成 `.mp3` 后上传。改后缀不会转码,文件字节仍是 AAC,
但浏览器按后缀把 `File.type` 报成 `audio/mpeg`。链路:

1. `readAsDataURL` → `data:audio/mpeg;base64,<其实是 AAC 的字节>`
2. [uploadImage.functions.ts:30-43](src/lib/uploadImage.functions.ts#L30-L43) 按 MIME 存成 `.mp3` / `Content-Type: audio/mpeg`
3. ARK 拉到 URL,按声明 `audio/mpeg` 走 MP3 解码,实际是 AAC → 解不开
   → `content[4] ... audio format ... is not valid`(400)

不是模型问题(2.0 支持参考音频),也不是 URL 不可达(上传走 Supabase 签名 URL,公网可访问),
纯粹是**声明的格式与真实字节不一致**。

## 方案:上传时归一化为 WAV

在 `handleUploadAudio`(浏览器端)用 Web Audio API 按真实字节解码、重新编码成
16-bit PCM WAV 再上传。`AudioContext.decodeAudioData` 按**内容字节**解码,忽略文件名/
MIME 谎报,所以改名文件(m4a→mp3)也能正确解出。WAV 无损(更适合音色克隆)、且 ARK
(ffmpeg 后端)必定支持,作为统一中间格式最稳。**无需新增依赖。**

> 备选:编码成 MP3(与官方文档示例一致),但需引入 `@breezystack/lamejs`。WAV 无依赖、
> 无损、实现更简单,推荐 WAV。若你更想严格对齐文档示例可改 MP3。

## 改动清单

### 1. 新增 `src/lib/audioWav.ts`(浏览器端工具)

导出 `audioFileToWavDataUrl(file: File, opts?: { maxSeconds?: number }): Promise<string>`:

- `new (window.AudioContext || webkitAudioContext)()` → `decodeAudioData(file.arrayBuffer())`
  → `AudioBuffer`(按真实字节解码)
- 下混为单声道;截断到前 `maxSeconds` 秒(默认 30s,语音克隆/背景音都够用,且 WAV
  体积 ≤ ~3MB@48kHz)
- `encodeWav()`:写 44 字节 RIFF/WAVE/fmt /data 头 + 16-bit PCM 数据
- `bytesToBase64()`(分块 `fromCharCode` 避免栈溢出)→ 返回 `data:audio/wav;base64,...`
- `decodeAudioData` 失败抛错;`typeof window === "undefined"` 守卫(SSR 不调用即可)
- `ctx.close()` 释放资源(finally)

### 2. 修改 `src/routes/workspace.$workspaceId.tsx` `handleUploadAudio`(:2077)

- 顶部 `import { audioFileToWavDataUrl } from "../lib/audioWav";`
- 把 `readAsDataURL(file)`(产出可能谎报 MIME 的 data URL)替换为
  `audioFileToWavDataUrl(file)`(产出真实 `audio/wav` data URL)
- 保留 25MB 原始体积守卫
- catch 分支改用新 i18n 键 `t.char_audio_decode_failed`(原为通用"上传失败")

### 3. i18n:在 `char_audio_too_large` 后新增

- `src/i18n/zh.ts`: `char_audio_decode_failed: "音频解析失败,请用 mp3/wav/m4a 等常见格式",`
- `src/i18n/en.ts`: `char_audio_decode_failed: "Could not parse audio. Use a common format (mp3/wav/m4a).",`

### 不需要改的地方

- `uploadImage.functions.ts`:`audio/wav` 已能被正则 `audio\/\w+` 匹配,ext=`wav`,
  存为 `.wav` / `audio/wav` ✓(顺带:`x-wav`/`x-m4a` 带连字符仍会匹配失败,但归一化后
  只会是 `audio/wav`,不受影响)
- `videoGenerate.functions.ts`:audio URL 走 Supabase https,`persistDataUriUrl` 直通,
  归一化在更上游完成,无需改

## 已存量数据

Supabase 里已有的"改名 mp3"坏文件不会自动修复;用户重新上传即得到干净 WAV。
新上传一律修复。

## 验证

- 用同一份「m4a 改后缀 mp3」文件重新上传 → 不再报 format invalid,ARK 正常受理
- 正常 mp3 / wav 上传 → 仍正常(且统一存为 wav)
- 传一个非音频文件(如 txt)→ toast `char_audio_decode_failed`,不崩
- `bun run lint` / tsc 0 错误

## 影响面

仅角色参考音频上传路径。预设音色(`public/voice-styles/*.mp3`,本来就是真 mp3)、
图片/视频上传路径不受影响。
