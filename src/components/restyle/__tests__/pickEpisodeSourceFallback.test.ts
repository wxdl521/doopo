import { describe, expect, it } from "vitest";
import { pickEpisodeSourceFallback } from "../RestyleStudio";
import type { RestyleAttachment } from "../restyleStorage";

const file = (over: Partial<RestyleAttachment>): RestyleAttachment =>
  ({ id: "x", name: "a.mp4", type: "video/mp4", size: 1, ...over }) as RestyleAttachment;

const oldSource = file({ id: "old", episode: "EP01", url: "blob:http://localhost/dead" });

describe("pickEpisodeSourceFallback（原片失效回绑）", () => {
  it("同集、有持久 URL 的重传源片被选中", () => {
    const reuploaded = file({ id: "new", episode: "EP01", url: "https://cdn.example.com/ep01.mp4" });
    const picked = pickEpisodeSourceFallback([oldSource, reuploaded], oldSource);
    expect(picked?.id).toBe("new");
  });

  it("排除自身、blob URL 与非视频文件", () => {
    const blobVideo = file({ id: "b", episode: "EP01", url: "blob:dead" });
    const image = file({ id: "img", episode: "EP01", type: "image/png", url: "https://cdn.example.com/i.png" });
    expect(pickEpisodeSourceFallback([oldSource, blobVideo, image], oldSource)).toBeUndefined();
  });

  it("集不匹配时不回绑到其他集的源片", () => {
    const otherEp = file({ id: "ep2", episode: "EP02", url: "https://cdn.example.com/ep02.mp4" });
    expect(pickEpisodeSourceFallback([oldSource, otherEp], oldSource)).toBeUndefined();
  });

  it("来源无集标记时接受任意持久源片", () => {
    const noEp = file({ id: "src", url: "blob:dead" });
    const any = file({ id: "ok", episode: "EP03", url: "https://cdn.example.com/x.mp4" });
    expect(pickEpisodeSourceFallback([noEp, any], noEp)?.id).toBe("ok");
  });
});
