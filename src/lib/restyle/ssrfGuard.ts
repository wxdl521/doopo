// ====================================================================
// ssrfGuard —— 服务端拉取外部 URL（模型产出链接 / 用户提供的媒体地址）
// 前的 SSRF 收敛：仅允许 https 公网地址，拒绝环回 / 内网 / 保留段；
// 并在 arrayBuffer 之前按 Content-Length 拦截超大负载。
// ====================================================================

/**
 * 主机名是否指向环回 / 内网 / 保留地址。
 * 只做字面量与前缀判断（不做 DNS 解析）：localhost / *.local / *.internal、
 * IPv4 环回 127/8、私网 10/8 · 172.16/12 · 192.168/16、链路本地 169.254/16、
 * 0/8（含 0.0.0.0）、IPv6 环回 ::1。
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/** 校验并返回 https 公网 URL；不合规时抛错（错误文案可直接回给调用方）。 */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("下载地址不是合法 URL");
  }
  if (url.protocol !== "https:") throw new Error("下载地址仅允许 https 协议");
  if (isPrivateHostname(url.hostname)) throw new Error("下载地址不允许指向内网或本机");
  return url;
}

/** Content-Length 超过 maxBytes 时抛错：在 arrayBuffer 之前拦截超大负载。 */
export function assertContentLengthWithin(res: Response, maxBytes: number): void {
  const header = res.headers.get("content-length");
  if (!header) return;
  const length = Number(header);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error(
      `文件体积 ${(length / 1024 / 1024).toFixed(1)}MB 超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`,
    );
  }
}
