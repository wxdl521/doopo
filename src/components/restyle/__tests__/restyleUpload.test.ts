import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIRECT_UPLOAD_MIN_BYTES,
  shouldUseDirectUpload,
  uploadFileDirect,
} from "../restyleUpload";
import {
  buildMentionables,
  isMentionableAttachment,
  resolveMentionedAttachmentIds,
} from "../restyleMentions";
import type { RestyleAttachment } from "../restyleStorage";

function makeFile(overrides: Partial<RestyleAttachment>): RestyleAttachment {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    name: "file",
    size: 0,
    type: "",
    lastModified: 0,
    ...overrides,
  };
}

describe("shouldUseDirectUpload", () => {
  it("routes every video to direct upload regardless of size", () => {
    expect(shouldUseDirectUpload({ type: "video/mp4", size: 1024 })).toBe(true);
    expect(shouldUseDirectUpload({ type: "video/quicktime", size: 200 * 1024 * 1024 })).toBe(true);
  });

  it("routes files larger than 4MB to direct upload", () => {
    expect(shouldUseDirectUpload({ type: "image/png", size: DIRECT_UPLOAD_MIN_BYTES + 1 })).toBe(
      true,
    );
  });

  it("keeps small images on the legacy base64 path", () => {
    expect(shouldUseDirectUpload({ type: "image/png", size: DIRECT_UPLOAD_MIN_BYTES })).toBe(
      false,
    );
    expect(shouldUseDirectUpload({ type: "image/jpeg", size: 500 * 1024 })).toBe(false);
  });
});

describe("restyle mentions", () => {  const files: RestyleAttachment[] = [
    makeFile({ id: "img-1", type: "image/png", name: "a.png" }),
    makeFile({ id: "vid-1", type: "video/mp4", name: "b.mp4" }),
    makeFile({ id: "folder-1", isFolder: true, name: "素材夹" }),
    makeFile({ id: "img-2", type: "image/jpeg", name: "c.jpg" }),
    makeFile({ id: "vid-2", type: "video/webm", name: "d.webm" }),
    makeFile({ id: "txt-1", type: "text/plain", name: "note.txt" }),
  ];

  it("only images and videos are mentionable", () => {
    expect(files.map(isMentionableAttachment)).toEqual([true, true, false, true, true, false]);
  });

  it("numbers image and video aliases separately in project order", () => {
    const mentionables = buildMentionables(files);
    expect(mentionables.map((item) => [item.alias, item.attachment.id])).toEqual([
      ["@image1", "img-1"],
      ["@video1", "vid-1"],
      ["@image2", "img-2"],
      ["@video2", "vid-2"],
    ]);
  });

  it("resolves @videoN / @imageN in text back to attachment ids", () => {
    const mentionables = buildMentionables(files);
    expect(resolveMentionedAttachmentIds("参考 @video1 和 @image2 生成", mentionables)).toEqual([
      "vid-1",
      "img-2",
    ]);
  });

  it("ignores unknown aliases and dedupes repeated mentions", () => {
    const mentionables = buildMentionables(files);
    expect(resolveMentionedAttachmentIds("@video9 @image1 @image1", mentionables)).toEqual([
      "img-1",
    ]);
    expect(resolveMentionedAttachmentIds("没有引用", mentionables)).toEqual([]);
  });

  it("matches aliases case-insensitively", () => {
    const mentionables = buildMentionables(files);
    expect(resolveMentionedAttachmentIds("@Video2", mentionables)).toEqual(["vid-2"]);
  });
});

// --------------------------------------------------------------------
// uploadFileDirect：XHR 永不 settle 的回归测试（signRead 异常 / 超时）
// --------------------------------------------------------------------

class FakeXHR {
  static instances: FakeXHR[] = [];
  /** send 后自动触发的回调（测试用来模拟 onload / ontimeout）。 */
  static autoRespond: ((xhr: FakeXHR) => void) | null = null;

  status = 200;
  responseText = "";
  timeout = 0;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } =
    { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  open(): void {}
  setRequestHeader(): void {}
  send(): void {
    FakeXHR.instances.push(this);
    const respond = FakeXHR.autoRespond;
    if (respond) setTimeout(() => respond(this), 0);
  }
}

function makeVideoFile(): File {
  return new File(["x"], "clip.mp4", { type: "video/mp4" });
}

const okPrepare = async () => ({
  ok: true,
  uploadUrl: "https://storage.example.com/upload-signed",
  path: "u1/uploads/restyle-v2/video/t-1.mp4",
});

describe("uploadFileDirect · settle 保障", () => {
  afterEach(() => {
    FakeXHR.instances = [];
    FakeXHR.autoRespond = null;
    vi.unstubAllGlobals();
  });

  it("上传成功后正常签发读地址", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    FakeXHR.autoRespond = (xhr) => xhr.onload?.();
    const result = await uploadFileDirect(makeVideoFile(), "id-1", okPrepare, async () => ({
      ok: true,
      url: "https://storage.example.com/read-signed",
    }));
    expect(result).toEqual({ ok: true, url: "https://storage.example.com/read-signed" });
  });

  it("signRead 抛异常时 resolve({ok:false})，Promise 不悬挂", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    FakeXHR.autoRespond = (xhr) => xhr.onload?.();
    const result = await uploadFileDirect(makeVideoFile(), "id-1", okPrepare, async () => {
      throw new Error("签名服务 502");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("签名服务 502");
  });

  it("设置了 30 分钟超时且 ontimeout 能 settle", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    FakeXHR.autoRespond = (xhr) => xhr.ontimeout?.();
    const result = await uploadFileDirect(makeVideoFile(), "id-1", okPrepare, async () => ({
      ok: true,
      url: "https://storage.example.com/unused",
    }));
    expect(FakeXHR.instances[0]!.timeout).toBe(30 * 60 * 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("超时");
  });

  it("网络错误 onerror 能 settle", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    FakeXHR.autoRespond = (xhr) => xhr.onerror?.();
    const result = await uploadFileDirect(makeVideoFile(), "id-1", okPrepare, async () => ({
      ok: true,
      url: "https://storage.example.com/unused",
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("网络中断");
  });
});
