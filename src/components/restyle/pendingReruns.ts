// ====================================================================
// pendingReruns —— 返工待办队列操作（纯函数，可单测）
//
// 渲染忙时点名的局部返工按项目排队，任一 run 收尾（finishRun 统一触发）
// 自动取出下一个开跑。入队去重：同 episode + segmentId 已在队列时不重复。
// ====================================================================

/** 队列元素的最小形态（RestyleRerunRequest 只需 episode/segmentId 参与去重）。 */
export interface PendingRerunLike {
  conversationId: string;
  rerun: { episode?: string; segmentId?: string };
}

/** 同 episode + segmentId 是否已在队列中（严格只入队一次）。 */
export function isPendingRerun<T extends PendingRerunLike>(
  queue: readonly T[],
  rerun: { episode?: string; segmentId?: string },
): boolean {
  return queue.some(
    (item) => item.rerun.episode === rerun.episode && item.rerun.segmentId === rerun.segmentId,
  );
}

/** FIFO 出队：取队首元素并返回剩余队列；空队列返回 undefined 与原数组。 */
export function shiftPendingRerun<T>(queue: readonly T[] | undefined): {
  item: T | undefined;
  rest: T[];
} {
  if (!queue?.length) return { item: undefined, rest: [] };
  const [item, ...rest] = queue;
  return { item, rest };
}
