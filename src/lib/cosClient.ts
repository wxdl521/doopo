// ====================================================================
// 腾讯云 COS + CDN 客户端封装（服务端专用）
//
// 统一把项目生成的图片/视频/音频上传到腾讯云 COS，通过 CDN 域名对外分发。
// 未配置 COS_* Secret 时，uploadToCos 返回 { ok: false, fallback: true }，
// 调用方回落到 Supabase Storage 逻辑，实现无痛灰度。
//
// 需要的 Secrets：
//   COS_SECRET_ID    腾讯云 API 密钥 ID
//   COS_SECRET_KEY   腾讯云 API 密钥
//   COS_BUCKET       COS 桶名（形如 doopoo-media-1300000000）
//   COS_REGION       桶所在地域（如 ap-shanghai）
//   COS_CDN_HOST     CDN 加速域名（如 cdn.doopoo.ai，不带协议不带 /）
// ====================================================================

import COS from "cos-nodejs-sdk-v5";

let _client: COS | null = null;
let _configChecked = false;
let _configOk = false;

function getConfig() {
  return {
    secretId: process.env.COS_SECRET_ID,
    secretKey: process.env.COS_SECRET_KEY,
    bucket: process.env.COS_BUCKET,
    region: process.env.COS_REGION,
    cdnHost: (process.env.COS_CDN_HOST || "").replace(/^https?:\/\//, "").replace(/\/+$/, ""),
  };
}

export function isCosConfigured(): boolean {
  if (_configChecked) return _configOk;
  const { secretId, secretKey, bucket, region, cdnHost } = getConfig();
  _configOk = !!(secretId && secretKey && bucket && region && cdnHost);
  _configChecked = true;
  return _configOk;
}

function getClient(): COS {
  if (_client) return _client;
  const { secretId, secretKey } = getConfig();
  _client = new COS({ SecretId: secretId!, SecretKey: secretKey! });
  return _client;
}

export function getCdnHost(): string {
  return getConfig().cdnHost;
}

export type UploadResult =
  | { ok: true; url: string; key: string }
  | { ok: false; fallback: boolean; error: string };

/**
 * 上传对象到 COS，返回 CDN URL。
 * key 应为不以 / 开头的对象键，例如：{userId}/{workspaceId}/videos/xxx.mp4
 */
export async function uploadToCos(
  key: string,
  body: Buffer | ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<UploadResult> {
  if (!isCosConfigured()) {
    return { ok: false, fallback: true, error: "COS 未配置" };
  }
  const { bucket, region, cdnHost } = getConfig();
  const buf = body instanceof Buffer ? body : Buffer.from(body as ArrayBuffer);
  const cleanKey = key.replace(/^\/+/, "");
  try {
    await new Promise<void>((resolve, reject) => {
      getClient().putObject(
        {
          Bucket: bucket!,
          Region: region!,
          Key: cleanKey,
          Body: buf,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return {
      ok: true,
      key: cleanKey,
      url: `https://${cdnHost}/${cleanKey.split("/").map(encodeURIComponent).join("/")}`,
    };
  } catch (e: any) {
    return { ok: false, fallback: false, error: e?.message ?? String(e) };
  }
}

/** 判断 URL 是否已由 CDN 分发（或直连 COS 桶域名）。 */
export function isCosCdnUrl(url: string): boolean {
  if (!url) return false;
  const { cdnHost, bucket, region } = getConfig();
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (cdnHost && host === cdnHost.toLowerCase()) return true;
    if (bucket && region && host === `${bucket}.cos.${region}.myqcloud.com`.toLowerCase()) {
      return true;
    }
    // 兼容 COS accelerate 域名
    if (bucket && host === `${bucket}.cos.accelerate.myqcloud.com`.toLowerCase()) return true;
  } catch {
    return false;
  }
  return false;
}
