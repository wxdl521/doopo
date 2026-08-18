// ====================================================================
// mp4Probe —— 纯 JS mp4 元数据解析（CF Workers 可跑,零依赖）
//
// 背景（2026-08 转码服务流复制 bug）：transcode.doopoo.ai 产出的裁剪片段
// nb_frames 声明与实际帧数不符（556 声明 vs 327 实际）,上游按声明帧数
// 抽帧读到不存在的帧 → 「unexpected internal error」。本文件解析
// mvhd/mdhd（时长/timescale,v0/v1 两版）与 stts（声明帧数）/stsz
// （真实样本数）,供裁剪产物入库前自检。
// ====================================================================

export interface Mp4Meta {
  /** 视频轨时长（秒,mdhd duration/timescale） */
  durationSec: number;
  /** stts 声明的帧数（time-to-sample 计数之和） */
  declaredFrames: number;
  /** stsz 真实样本数（sample table 行数） */
  actualFrames: number;
  /** actualFrames / durationSec */
  fps: number;
}

type Box = { type: string; contentStart: number; end: number };

/** 读一个 box 头（32/64 位 size;size=0 延伸到父末尾）;越界返回 null */
function readBox(view: DataView, offset: number, parentEnd: number): Box | null {
  if (offset + 8 > parentEnd || offset + 8 > view.byteLength) return null;
  let size = view.getUint32(offset);
  const type = String.fromCharCode(
    view.getUint8(offset + 4),
    view.getUint8(offset + 5),
    view.getUint8(offset + 6),
    view.getUint8(offset + 7),
  );
  let headerSize = 8;
  if (size === 1) {
    // 64 位 largesize
    if (offset + 16 > view.byteLength) return null;
    const large = view.getBigUint64(offset + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size === 0) {
    size = parentEnd - offset;
  }
  const end = Math.min(offset + size, parentEnd, view.byteLength);
  if (end < offset + headerSize) return null;
  return { type, contentStart: offset + headerSize, end };
}

/** 遍历容器 box 的子 box */
function* childBoxes(view: DataView, start: number, end: number): Generator<Box> {
  let cursor = start;
  while (cursor < end) {
    const box = readBox(view, cursor, end);
    if (!box) return;
    yield box;
    cursor = box.end;
  }
}

/** mdhd v0/v1:timescale 与 duration(v0=u32/u32 偏移 +12/+16;v1=u32/u64 偏移 +20/+24,内容起点算) */
function parseMdhd(view: DataView, box: Box): { timescale: number; duration: number } | null {
  const version = view.getUint8(box.contentStart);
  try {
    if (version === 1) {
      const timescale = view.getUint32(box.contentStart + 20);
      const duration = Number(view.getBigUint64(box.contentStart + 24));
      return timescale > 0 ? { timescale, duration } : null;
    }
    const timescale = view.getUint32(box.contentStart + 12);
    const duration = view.getUint32(box.contentStart + 16);
    return timescale > 0 ? { timescale, duration } : null;
  } catch {
    return null;
  }
}

/** stts:entry_count 后每行 {sample_count, sample_delta},声明帧数 = Σ sample_count */
function parseStts(view: DataView, box: Box): number | null {
  try {
    const entryCount = view.getUint32(box.contentStart + 4);
    let total = 0;
    for (let i = 0; i < entryCount; i++) {
      const at = box.contentStart + 8 + i * 8;
      if (at + 8 > box.end) return null;
      total += view.getUint32(at);
    }
    return total;
  } catch {
    return null;
  }
}

/** stsz:sample_count 字段即真实样本数（sample_size 常量/逐样本两种格式同字段） */
function parseStsz(view: DataView, box: Box): number | null {
  try {
    return view.getUint32(box.contentStart + 8);
  } catch {
    return null;
  }
}

/**
 * 解析 mp4 视频轨元数据。moov 在文件头/尾都支持（全量 buffer 传入,
 * 片段 2-15s 只有几 MB,不做流式）;非 mp4/截断/结构缺失返回 null
 * （调用方按「不可判定」放行,不阻断主流程）。
 */
export function probeMp4Metadata(buffer: ArrayBuffer): Mp4Meta | null {
  try {
    const view = new DataView(buffer);
    let moov: Box | null = null;
    for (const box of childBoxes(view, 0, view.byteLength)) {
      if (box.type === "moov") {
        moov = box;
        break;
      }
    }
    if (!moov) return null;
    for (const trak of childBoxes(view, moov.contentStart, moov.end)) {
      if (trak.type !== "trak") continue;
      let isVideo = false;
      let mdhd: { timescale: number; duration: number } | null = null;
      let declared: number | null = null;
      let actual: number | null = null;
      for (const mdia of childBoxes(view, trak.contentStart, trak.end)) {
        if (mdia.type !== "mdia") continue;
        for (const child of childBoxes(view, mdia.contentStart, mdia.end)) {
          if (child.type === "mdhd") mdhd = parseMdhd(view, child);
          if (child.type === "hdlr") {
            const handler = String.fromCharCode(
              view.getUint8(child.contentStart + 8),
              view.getUint8(child.contentStart + 9),
              view.getUint8(child.contentStart + 10),
              view.getUint8(child.contentStart + 11),
            );
            if (handler === "vide") isVideo = true;
          }
          if (child.type === "minf") {
            for (const stbl of childBoxes(view, child.contentStart, child.end)) {
              if (stbl.type !== "stbl") continue;
              for (const sample of childBoxes(view, stbl.contentStart, stbl.end)) {
                if (sample.type === "stts") declared = parseStts(view, sample);
                if (sample.type === "stsz") actual = parseStsz(view, sample);
              }
            }
          }
        }
      }
      if (isVideo && mdhd && mdhd.duration > 0 && declared != null && actual != null) {
        const durationSec = mdhd.duration / mdhd.timescale;
        return {
          durationSec,
          declaredFrames: declared,
          actualFrames: actual,
          fps: actual / durationSec,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type TrimMetaVerdict =
  | { ok: true; uncertain?: false; meta: Mp4Meta }
  /** 解析失败/不可判定:放行不阻断（宁可漏判不可误判） */
  | { ok: true; uncertain: true; reason: string }
  | { ok: false; error: string; declaredFrames: number; actualFrames: number };

/**
 * 裁剪产物元数据自检：
 * - stts 声明帧数与 stsz 真实样本数偏差 > max(5 帧, 2%) → 判不一致
 *   （流复制 bug 的典型形态:声明 556 / 实际 327）;
 * - 给了名义时长（请求区间）时再核 durationSec 偏差 > max(0.5s, 5%) 判不一致;
 * - 解析失败按「不可判定」放行（不阻断主流程）。
 */
export function verifyTrimmedClipMeta(
  buffer: ArrayBuffer,
  nominalDurationSec?: number,
): TrimMetaVerdict {
  const meta = probeMp4Metadata(buffer);
  if (!meta) {
    return { ok: true, uncertain: true, reason: "mp4 元数据解析失败（不可判定,放行）" };
  }
  const frameTolerance = Math.max(5, Math.ceil(meta.actualFrames * 0.02));
  if (Math.abs(meta.declaredFrames - meta.actualFrames) > frameTolerance) {
    return {
      ok: false,
      error: `裁剪产物元数据异常（声明 ${meta.declaredFrames} 帧/实际约 ${meta.actualFrames} 帧），请稍后重试或联系转码服务`,
      declaredFrames: meta.declaredFrames,
      actualFrames: meta.actualFrames,
    };
  }
  if (nominalDurationSec && nominalDurationSec > 0) {
    const durationTolerance = Math.max(0.5, nominalDurationSec * 0.05);
    if (Math.abs(meta.durationSec - nominalDurationSec) > durationTolerance) {
      return {
        ok: false,
        error: `裁剪产物时长异常（元数据 ${meta.durationSec.toFixed(2)}s/预期约 ${nominalDurationSec.toFixed(1)}s），请稍后重试或联系转码服务`,
        declaredFrames: meta.declaredFrames,
        actualFrames: meta.actualFrames,
      };
    }
  }
  return { ok: true, meta };
}
