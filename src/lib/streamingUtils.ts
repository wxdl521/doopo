import { useEffect, useRef, useState } from "react";

export type StreamChunk = { delta: string } | { done: true; text: string } | { error: string };

// ============ 流式聚合工具（供 workspace 剧本生成复用）============

type PendingSlot = { buf: string; done: boolean };

/**
 * 逐字"打字机"渲染：把上游每次的大块 delta 拆成小片，平滑追加。
 * 返回 pendingRef（可直接修改）和 flushTimerRef，以及 ensureFlushTimer / appendDelta / finishBubble。
 */
export function useStreamingText(
  initialBubbles: { id: string; text: string; streaming?: boolean }[],
) {
  const pendingRef = useRef<Map<string, PendingSlot>>(new Map());
  const flushTimerRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  const ensureFlushTimer = () => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setInterval(() => {
      const map = pendingRef.current;
      if (map.size === 0) {
        if (flushTimerRef.current != null) window.clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
        return;
      }
      setTick((t) => t + 1);
    }, 24) as unknown as number;
  };

  const appendDelta = (id: string, delta: string) => {
    if (!delta) return;
    const map = pendingRef.current;
    const slot = map.get(id) ?? { buf: "", done: false };
    slot.buf += delta;
    map.set(id, slot);
    ensureFlushTimer();
  };

  const finishBubble = (id: string) => {
    const map = pendingRef.current;
    const slot = map.get(id);
    if (slot) {
      slot.done = true;
      ensureFlushTimer();
    }
  };

  const isPendingDone = (id: string) => {
    const slot = pendingRef.current.get(id);
    return slot ? slot.buf.length === 0 && slot.done : true;
  };

  const consume = async (
    stream: AsyncIterable<StreamChunk>,
    bubbleId: string,
    onText: (text: string) => void,
  ): Promise<{ ok: boolean; text: string }> => {
    let acc = "";
    try {
      for await (const chunk of stream) {
        if ("error" in chunk) {
          finishBubble(bubbleId);
          return { ok: false, text: acc };
        }
        if ("delta" in chunk) {
          acc += chunk.delta;
          appendDelta(bubbleId, chunk.delta);
        } else if ("done" in chunk) {
          if (chunk.text && chunk.text.length > acc.length) {
            const tail = chunk.text.slice(acc.length);
            if (tail) appendDelta(bubbleId, tail);
            acc = chunk.text;
          }
          onText(acc);
          finishBubble(bubbleId);
          return { ok: true, text: acc };
        }
      }
      onText(acc);
      finishBubble(bubbleId);
      return { ok: true, text: acc };
    } catch (e) {
      finishBubble(bubbleId);
      return { ok: false, text: acc };
    }
  };

  // 定时器清理
  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) {
        window.clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  return { pendingRef, flushTimerRef, appendDelta, finishBubble, isPendingDone, consume };
}
