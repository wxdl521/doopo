import { describe, it, expect } from "vitest";
import { fetchMedia } from "../workspaceMedia.functions";

// 1x1 透明 PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("fetchMedia data: URL handling", () => {
  it("decodes base64 image/png data URL", async () => {
    const { buf, contentType } = await fetchMedia(`data:image/png;base64,${TINY_PNG_B64}`);
    expect(contentType).toBe("image/png");
    expect(buf.byteLength).toBeGreaterThan(0);
    // PNG magic: 89 50 4E 47
    const view = new Uint8Array(buf);
    expect(view[0]).toBe(0x89);
    expect(view[1]).toBe(0x50);
  });

  it("rejects non-base64 data URL", async () => {
    await expect(fetchMedia("data:text/plain,hello")).rejects.toThrow(/non-base64/);
  });

  it("rejects malformed data URL", async () => {
    await expect(fetchMedia("data:broken")).rejects.toThrow(/missing comma/);
  });
});
