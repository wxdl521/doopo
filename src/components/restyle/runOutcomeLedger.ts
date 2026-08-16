// ====================================================================
// runOutcomeLedger —— 渲染 run 成败台账（同步读写，与 React 状态彻底解耦）
//
// 根因（772bbb2 线上诊断「本轮台账：空」，渲染明明成功）：此前记账写在
// setProjects / setState 的 updater 里——updater 由 React 在渲染阶段才执行
// （更新队列非空时不即时求值），本轮最后一次 completeRenderAttachment 的
// 记账必然晚于 completeRenderQueue 收尾的同步读取；且 updater 有纯度约束
// （并发/StrictMode 下可能重复或延迟调用），副作用本不应放在其中。
// 台账因此独立成这个微型模块：record / snapshot / reset 全部同步，
// 只允许在事件处理/异步函数体里直接调用，禁止放进任何 setState updater。
// ====================================================================

import type { RenderRunOutcome } from "./renderRunSummary";

export type RunOutcomeLedger = {
  /**
   * run 起跑前重置。时序契约：下一 run 的 reset 必须晚于上一 run 的收尾读取
   * （completeRenderQueue 在 try 里读完台账,finally 的 finishRun→drain 才会
   * 拉起下一 run 触发 reset）——调用方（RestyleStudio）保证该顺序。
   */
  reset(projectId: string): void;
  /** 同步记账：未 reset 的项目自动建账（兜底,正常路径 run 起跑时已 reset）。 */
  record(projectId: string, outcome: RenderRunOutcome): void;
  /** 同步读取：无记录返回空数组（返回内部数组快照副本,调用方改不动账本）。 */
  snapshot(projectId: string): RenderRunOutcome[];
};

export function createRunOutcomeLedger(): RunOutcomeLedger {
  const map = new Map<string, RenderRunOutcome[]>();
  return {
    reset: (projectId) => {
      map.set(projectId, []);
    },
    record: (projectId, outcome) => {
      const list = map.get(projectId);
      if (list) list.push(outcome);
      else map.set(projectId, [outcome]);
    },
    snapshot: (projectId) => [...(map.get(projectId) ?? [])],
  };
}
