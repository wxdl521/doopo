/**
 * 2026/07:文件读取进度工具。
 *
 * 用途:上传 .docx / .txt / .json / .md 等本地文件时,为 UI 提供实时进度百分比。
 * 三个 upload 入口(项目导入、Zopia 剧本粘贴、剧本页导入)共用同一实现,
 * 避免各处自己 hook FileReader 造成 UX 不一致。
 *
 * 设计要点:
 *   - 用 FileReader.onprogress 拿到 loaded/total,回调 onProgress(0-100)。
 *   - .docx 走 arrayBuffer(mammoth 需要);.txt/.md/.json 走 text。
 *   - onProgress 只报告"读文件"阶段(0-90%);解析阶段(mammoth / JSON.parse)
 *     由调用方在拿到 buffer 后自行 setProgress(95→100),避免这里揽下解析责任。
 *   - 兼容 File.stream() 缺失的老浏览器;真的失败会 reject。
 */

export type ReadProgress = (percent: number) => void;

/** 读文件为纯文本(带进度)。用于 .txt / .md / .json。 */
export function readFileAsTextWithProgress(file: File, onProgress?: ReadProgress): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (!onProgress) return;
      if (e.lengthComputable && e.total > 0) {
        // 读文件占 0-90%,留 10% 给调用方做后续解析。
        onProgress(Math.min(90, Math.round((e.loaded / e.total) * 90)));
      }
    };
    reader.onload = () => {
      onProgress?.(90);
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("读取结果不是文本"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

/** 读文件为 ArrayBuffer(带进度)。用于 .docx(mammoth 需要 arrayBuffer)。 */
export function readFileAsArrayBufferWithProgress(
  file: File,
  onProgress?: ReadProgress,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (!onProgress) return;
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(90, Math.round((e.loaded / e.total) * 90)));
      }
    };
    reader.onload = () => {
      onProgress?.(90);
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error("读取结果不是 ArrayBuffer"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsArrayBuffer(file);
  });
}
