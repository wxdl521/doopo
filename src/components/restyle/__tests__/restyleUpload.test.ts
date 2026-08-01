import { describe, expect, it } from "vitest";
import { DIRECT_UPLOAD_MIN_BYTES, shouldUseDirectUpload } from "../restyleUpload";
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

describe("restyle mentions", () => {
  const files: RestyleAttachment[] = [
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
