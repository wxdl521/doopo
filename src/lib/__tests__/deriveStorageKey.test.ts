// ====================================================================
// deriveStorageKeyFromSignedUrl（过期签名 URL 救活:对象 key 嵌在路径里）
// ====================================================================
import { describe, expect, it } from "vitest";
import { deriveStorageKeyFromSignedUrl } from "../restyleMedia.functions";

const HOST = "https://abc.supabase.co";

describe("deriveStorageKeyFromSignedUrl", () => {
  it("签名 URL（sign + token 参数）提取对象 key", () => {
    expect(
      deriveStorageKeyFromSignedUrl(
        `${HOST}/storage/v1/object/sign/workspace-media/u1/uploads/restyle-v2/video/a-123.mp4?token=eyJhbGc&x=1`,
      ),
    ).toBe("u1/uploads/restyle-v2/video/a-123.mp4");
  });

  it("公共 URL（public 前缀）同样提取", () => {
    expect(
      deriveStorageKeyFromSignedUrl(
        `${HOST}/storage/v1/object/public/workspace-media/u1/frames/f1.png`,
      ),
    ).toBe("u1/frames/f1.png");
  });

  it("路径含特殊字符（空格/中文）解码", () => {
    expect(
      deriveStorageKeyFromSignedUrl(
        `${HOST}/storage/v1/object/sign/workspace-media/u1/%E8%A7%86%E9%A2%91%201.mp4?token=t`,
      ),
    ).toBe("u1/视频 1.mp4");
  });

  it("非本桶/外部链接/畸形返回 null", () => {
    expect(deriveStorageKeyFromSignedUrl(`${HOST}/storage/v1/object/sign/other-bucket/x.mp4`)).toBeNull();
    expect(deriveStorageKeyFromSignedUrl("https://cdn.example.com/a.mp4")).toBeNull();
    expect(deriveStorageKeyFromSignedUrl("not-a-url")).toBeNull();
    expect(deriveStorageKeyFromSignedUrl("")).toBeNull();
    expect(deriveStorageKeyFromSignedUrl(`${HOST}/storage/v1/object/sign/workspace-media/`)).toBeNull();
  });
});
