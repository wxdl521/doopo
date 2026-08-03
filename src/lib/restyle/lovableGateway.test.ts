// callLovableChat 空正文重试与 reasoning 诊断（注入假 fetch，不触网）
import { afterEach, describe, expect, it, vi } from "vitest";
import { callLovableChat } from "./lovableGateway";

process.env.LOVABLE_API_KEY = "test-key";

function gatewayResponse(content: string, usage: Record<string, unknown> = {}, finishReason = "stop") {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ finish_reason: finishReason, message: { content, role: "assistant" } }],
      usage,
    }),
    text: async () => "",
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("callLovableChat · 空正文重试", () => {
  it("默认带 reasoning_effort=none", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => gatewayResponse("{\"a\":1}"));
    vi.stubGlobal("fetch", fetchMock);
    await callLovableChat({ model: "google/gemini-3.6-flash", messages: [{ role: "user", content: "hi" }] });
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.reasoning_effort).toBe("none");
  });

  it("空正文 + 全 reasoning token → 触发重试，重试抬高 token 并追加指令", async () => {
    const empty = gatewayResponse("", { completion_tokens: 2168, completion_tokens_details: { reasoning_tokens: 2168 } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(gatewayResponse("{\"assets\":[]}"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await callLovableChat({
      model: "google/gemini-3.6-flash",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 5_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(retryBody.max_completion_tokens).toBeGreaterThanOrEqual(12_000);
    const lastMsg = retryBody.messages.at(-1);
    expect(lastMsg.content).toContain("不要输出任何思考过程");
    expect(result.ok).toBe(true);
  });

  it("重试仍为空 → 错误带 finish_reason 与 token 诊断", async () => {
    const empty = gatewayResponse("", { completion_tokens: 2168, completion_tokens_details: { reasoning_tokens: 2168 } });
    const fetchMock = vi.fn(async () => empty);
    vi.stubGlobal("fetch", fetchMock);
    const result = await callLovableChat({ model: "google/gemini-3.6-flash", messages: [{ role: "user", content: "hi" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("finish_reason=stop");
      expect(result.error).toContain("reasoning_tokens=2168");
    }
  });

  it("首次就有正文 → 不重试", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => gatewayResponse("{\"a\":1}"));
    vi.stubGlobal("fetch", fetchMock);
    await callLovableChat({ model: "google/gemini-3.6-flash", messages: [{ role: "user", content: "hi" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
