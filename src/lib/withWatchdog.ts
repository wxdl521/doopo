// ====================================================================
// withWatchdog —— Promise 看门狗（纯函数,可单测）
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
