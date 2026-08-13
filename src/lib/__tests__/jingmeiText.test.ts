import { describe, expect, it } from "vitest";
import { jingmeiEndpoint } from "../arkText";
import {
  providerAuthHeaders,
  providerTuning,
  resolveProvider,
} from "../restyle/lovableGateway";
import { pickModel } from "../scriptAgent.functions";

describe("jingmei 文本渠道(Azure AI Foundry 项目端点)", () => {
  it("resolveProvider 解析 jingmei: 前缀:剥前缀直连 v1 端点", () => {
    const config = resolveProvider("jingmei:gpt-5.5");
    expect(config.provider).toBe("jingmei");
    expect(config.model).toBe("gpt-5.5");
    expect(config.endpoint).toBe(
      "https://admin-1321-resource.services.ai.azure.com/api/projects/admin-1321/openai/v1/chat/completions",
    );
    expect(resolveProvider("jingmei:gpt-5.6-sol").model).toBe("gpt-5.6-sol");
  });

  it("providerAuthHeaders:jingmei 用 api-key 头,其余渠道 Bearer", () => {
    const jingmei = resolveProvider("jingmei:gpt-5.5");
    const jingmeiHeaders = providerAuthHeaders({ ...jingmei, apiKey: "k123" });
    expect(jingmeiHeaders["api-key"]).toBe("k123");
    expect(jingmeiHeaders.Authorization).toBeUndefined();

    for (const id of ["ark:deepseek-v4-pro-260425", "qwen:qwen3.6-plus", "lovable:openai/gpt-5.5"]) {
      const headers = providerAuthHeaders({ ...resolveProvider(id), apiKey: "k123" });
      expect(headers.Authorization).toBe("Bearer k123");
      expect(headers["api-key"]).toBeUndefined();
    }
  });

  it("providerTuning:jingmei 推理模型只发 max_completion_tokens(不带 temperature)", () => {
    const tuning = providerTuning(resolveProvider("jingmei:gpt-5.5"), 12_000);
    expect(tuning).toEqual({ max_completion_tokens: 12_000 });
    expect(tuning.temperature).toBeUndefined();
    expect(tuning.max_tokens).toBeUndefined();
  });

  it("providerTuning:jingmei 分窗路径透传 reasoning_effort=low 压推理耗时", () => {
    const tuning = providerTuning(resolveProvider("jingmei:gpt-5.5"), 5_000, {
      reasoningEffort: "low",
    });
    expect(tuning).toEqual({ max_completion_tokens: 5_000, reasoning_effort: "low" });
  });

  it("supportsJsonMode:jingmei 省略 response_format(Foundry v1 未实测该参数)", () => {
    expect(resolveProvider("jingmei:gpt-5.5").supportsJsonMode).toBe(false);
    expect(resolveProvider("ark:deepseek-v4-pro-260425").supportsJsonMode).toBe(true);
    expect(resolveProvider("qwen:qwen3.6-plus").supportsJsonMode).toBe(true);
    expect(resolveProvider("lovable:openai/gpt-5.5").supportsJsonMode).toBe(true);
  });

  it("jingmeiEndpoint 支持 JINGMEI_BASE_URL 覆盖并剥尾斜杠", () => {
    const original = process.env.JINGMEI_BASE_URL;
    try {
      process.env.JINGMEI_BASE_URL = "https://example.com/api/projects/p1/";
      expect(jingmeiEndpoint()).toBe(
        "https://example.com/api/projects/p1/openai/v1/chat/completions",
      );
    } finally {
      if (original === undefined) delete process.env.JINGMEI_BASE_URL;
      else process.env.JINGMEI_BASE_URL = original;
    }
  });

  it("script 链 pickModel 同样识别 jingmei: 前缀", () => {
    expect(pickModel("jingmei:gpt-5.5")).toEqual({ provider: "jingmei", model: "gpt-5.5" });
    expect(pickModel("jingmei:gpt-5.6-sol")).toEqual({ provider: "jingmei", model: "gpt-5.6-sol" });
  });
});
