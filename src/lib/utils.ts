import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 2026/06:稳定的字符串 hash (djb2 变种),用于把 matchKey 派生为稳定的
 * 8 hex 短 id(`mc-${hash.slice(0, 8)}`)。
 * 不用于加密,只用于"同一个字符串多次调用结果一致"这个语义。
 */
export function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
