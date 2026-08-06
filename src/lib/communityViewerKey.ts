// 客户端安全的纯函数模块：匿名 viewerKey 哈希。
// 不得引入任何服务端依赖（community.functions.ts 会被客户端组件直接 import）。

function fnv1aHex(input: string): string {
  let out = "";
  for (let lane = 0; lane < 4; lane += 1) {
    let h = 0x811c9dc5 ^ (lane * 0x9e3779b9);
    for (let i = 0; i < input.length; i += 1) {
      h = Math.imul(h ^ input.charCodeAt(i), 0x01000193 + lane);
    }
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

export function buildAnonymousViewerKey(
  ip: string | null | undefined,
  ua: string | null | undefined,
): string {
  return `a:${fnv1aHex(`${ip ?? ""}|${ua ?? ""}`)}`;
}