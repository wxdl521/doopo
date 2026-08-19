// ====================================================================
// providerProbe 测试（后台「测试连接」分型探测策略 + 三分类判定）
// ====================================================================
import { describe, expect, it } from "vitest";
import { classifyProbeStatus, probePlanFor } from "../providerProbe";

describe("probePlanFor（按供应商分型的探测策略）", () => {
  it("jieyun：剥掉 /api/v3 后探测根下 /v1/models", () => {
    expect(probePlanFor("jieyun", "https://jieyun.cc/api/v3")).toEqual({
      url: "https://jieyun.cc/v1/models",
      reachabilityOnly: false,
      note: undefined,
    });
  });

  it("tokenpony：{base}/v1/models（实测存在）", () => {
    expect(probePlanFor("tokenpony", "https://api.tokenpony.cn").url).toBe(
      "https://api.tokenpony.cn/v1/models",
    );
  });

  it("azure-image2（APIM）:/openai/v1/models;azure 系官方资源:/openai/models?api-version", () => {
    expect(
      probePlanFor("azure-image2", "https://jingmeiapimanage.azure-api.net/jingmeiapim").url,
    ).toBe("https://jingmeiapimanage.azure-api.net/jingmeiapim/openai/v1/models");
    expect(probePlanFor("azure2", "https://res.example.com").url).toBe(
      "https://res.example.com/openai/models?api-version=2024-02-01",
    );
  });

  it("jingmei（/models 实测不存在）与 jimeng（AK/SK 签名）→ 仅连通性探测", () => {
    const jingmei = probePlanFor(
      "jingmei",
      "https://admin-1321-resource.services.ai.azure.com/api/projects/admin-1321",
    );
    expect(jingmei.reachabilityOnly).toBe(true);
    expect(jingmei.note).toContain("仅验证连通性");
    expect(probePlanFor("jimeng", "https://visual.volcengineapi.com").reachabilityOnly).toBe(true);
  });

  it("ARK 协议族：base 含 /api/v3 直接用,缺的补上;topenrouter 带未实测提示", () => {
    expect(probePlanFor("ark", "https://ark.cn-beijing.volces.com/api/v3").url).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/models",
    );
    expect(probePlanFor("shuci", "http://token.ds.cyberpeace.cn").url).toBe(
      "http://token.ds.cyberpeace.cn/api/v3/models",
    );
    expect(probePlanFor("topenrouter", "https://tp-api.chinadatapay.com:8000").note).toContain(
      "人工确认",
    );
  });

  it("未知供应商回退 /v1/models + 人工确认提示", () => {
    const plan = probePlanFor("some-new-vendor", "https://api.example.com/");
    expect(plan.url).toBe("https://api.example.com/v1/models");
    expect(plan.note).toContain("人工确认");
  });
});

describe("classifyProbeStatus（通过/认证失败/不可达三分类）", () => {
  it("2xx 通过;reachabilityOnly 下任何 HTTP 响应都算服务活着", () => {
    expect(classifyProbeStatus(200, false).outcome).toBe("ok");
    expect(classifyProbeStatus(404, true).outcome).toBe("ok");
    expect(classifyProbeStatus(404, true).message).toContain("仅验证连通性");
  });

  it("401/403 = 认证失败（引导检查密钥）", () => {
    for (const status of [401, 403]) {
      const r = classifyProbeStatus(status, false);
      expect(r.outcome).toBe("auth-fail");
      expect(r.message).toContain("请检查密钥");
    }
  });

  it("网络错误/404 = 不可达（引导检查地址）", () => {
    expect(classifyProbeStatus(null, false).message).toContain("请检查接口地址");
    expect(classifyProbeStatus(404, false).outcome).toBe("unreachable");
    expect(classifyProbeStatus(500, false).outcome).toBe("unreachable");
  });
});
