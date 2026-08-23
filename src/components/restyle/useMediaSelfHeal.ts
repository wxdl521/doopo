// ====================================================================
//  媒体自愈：<img> / <video> 加载失败时，若地址指向 workspace-media
//  （7 天签名 URL，过期即 403），先重签一次再重试，仍失败才算真失效。
//
//  用事件捕获在容器上统一处理，避免给每个渲染点单独接 onError。
// ====================================================================

import { useEffect, type RefObject } from "react";
import { isWorkspaceMediaUrl, resignSingleUrl } from "./resignMediaClient";

export function useMediaSelfHeal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const tried = new Set<string>();

    const handler = (event: Event) => {
      const el = event.target as HTMLImageElement | HTMLVideoElement | null;
      if (!el || (el.tagName !== "IMG" && el.tagName !== "VIDEO")) return;
      const src = el.getAttribute("src");
      if (!src || tried.has(src) || !isWorkspaceMediaUrl(src)) return;
      tried.add(src);
      void resignSingleUrl(src).then((healed) => {
        if (!healed || !el.isConnected) return;
        el.setAttribute("src", healed);
        if (el.tagName === "VIDEO") (el as HTMLVideoElement).load();
      });
    };

    // 媒体 error 事件不冒泡，必须用捕获阶段。
    root.addEventListener("error", handler, true);
    return () => root.removeEventListener("error", handler, true);
  }, [ref]);
}
