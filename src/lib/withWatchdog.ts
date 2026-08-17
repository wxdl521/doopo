// ====================================================================
// withWatchdog / withLoadRetry —— Promise 看门狗与加载重试（纯函数,可单测）
//
// 根因（2026-08 verify-save-probe 实证）：工作区保存的任一上游调用挂死
// （persistMedia / saveWorkspaceData 无响应）时,savingWorkspace 互斥标志
// 永远不复位——后续保存全部在「防并发排队」早退（零请求发出）,顶栏
// 「保存中…」常亮,落盘只剩 beforeunload 兜底,浏览器崩溃即丢编辑。
// 看门狗强制 settle,让调用方的 finally 必然执行、标志必然复位。
// ====================================================================

/**
 * 看门狗包装：promise 在 timeoutMs 内未 settle 则以超时 reject。
 * 超时后原 promise 在后台继续 settle（Promise.race 已挂接 handler,不会
 * 产生 unhandled rejection）；调用方按超时失败收尾即可。
 */
export async function withWatchdog<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "watchdog timeout",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 加载请求自动重试：返回体无 workspaceData（失败）时延迟 1.5s 自动重试一次
 * （覆盖分镜结构/媒体两段大查询的偶发语句超时）。sleep 可注入便于测试。
 */
export async function withLoadRetry<T extends { workspaceData: unknown }>(
  load: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  const first = await load();
  if (first.workspaceData) return first;
  await sleep(1_500);
  return load();
}
