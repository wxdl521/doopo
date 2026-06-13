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

/**
 * 把 ISO 时间戳转成中文相对时间(刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / N 周前 / N 个月前)
 * 用于 Projects / Home 等"最近项目"区。
 */
export function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = 60_000, hr = 60 * min, day = 24 * hr, week = 7 * day
  if (diff < min) return '刚刚'
  if (diff < hr) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hr)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < week) return `${Math.floor(diff / day)} 天前`
  if (diff < 4 * week) return `${Math.floor(diff / week)} 周前`
  return `${Math.floor(diff / (30 * day))} 个月前`
}
