// ====================================================================
//  供应商密钥加密工具（服务端专用）
//
//  WebCrypto AES-256-GCM：
//    - 密钥材料来自环境变量 PROVIDER_KEY_ENC_SECRET（随机 64 位，仅服务端可读），
//      经 SHA-256 派生为 256bit AES-GCM key
//    - 密文格式 `v1:<iv_b64>:<ct_b64>`（iv 12 字节随机）
//    - 密钥只在服务端解密使用；任何返回前端的结构只带 api_key_hint（****尾4位）
//
//  兼容 Cloudflare Workers 与 Node（vitest）：均走 globalThis.crypto.subtle。
// ====================================================================

const VERSION_PREFIX = "v1";
const IV_BYTES = 12;

let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function getSecret(): string {
  const secret = process.env.PROVIDER_KEY_ENC_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "PROVIDER_KEY_ENC_SECRET 未配置或过短（需 >= 16 字符的随机串），无法加解密供应商密钥",
    );
  }
  return secret;
}

async function getKey(): Promise<CryptoKey> {
  const secret = getSecret();
  // env 变更（如本地轮换密钥）时重新派生，避免沿用旧密钥
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = (async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  })();
  cachedKey = { secret, key };
  // 密钥派生失败时不要缓存 rejected Promise，下次调用重试
  key.catch(() => {
    if (cachedKey?.key === key) cachedKey = null;
  });
  return key;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(value, "base64");
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 明文 -> `v1:<iv_b64>:<ct_b64>` */
export async function encryptProviderSecret(plain: string): Promise<string> {
  if (!plain) throw new Error("encryptProviderSecret: 明文为空");
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${VERSION_PREFIX}:${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

/** `v1:<iv_b64>:<ct_b64>` -> 明文。格式不符或解密失败时抛错。 */
export async function decryptProviderSecret(cipher: string): Promise<string> {
  const parts = (cipher || "").split(":");
  if (parts.length !== 3 || parts[0] !== VERSION_PREFIX) {
    throw new Error("decryptProviderSecret: 密文格式非法（期望 v1:<iv_b64>:<ct_b64>）");
  }
  const key = await getKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parts[1]) },
    key,
    fromBase64(parts[2]),
  );
  return new TextDecoder().decode(plain);
}

/** 界面展示用尾 4 位掩码：`****1234`；不足 4 位全掩码。 */
export function apiKeyHint(plain: string): string {
  if (!plain) return "";
  return plain.length > 4 ? `****${plain.slice(-4)}` : "****";
}
