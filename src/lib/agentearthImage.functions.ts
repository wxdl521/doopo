// ====================================================================
//  AgentEarth —— OpenAI Images API compatible gateway
//
//  Base URL: https://maas.agentearth.ai/v1
//  Auth:     Authorization: Bearer ${AGENTEARTH_API_KEY}
//  Model:    earth/gpt-image-2-4k
// ====================================================================

import "./loadEnv";

const DEFAULT_BASE_URL = "https://maas.agentearth.ai/v1";
const DEFAULT_MODEL = "earth/gpt-image-2-4k";
const REQUEST_TIMEOUT_MS = 600_000;
const AGENTEARTH_PREFIX = "agentearth/";

export type AgentEarthImageInput = {
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  quality?: "auto" | "low" | "medium" | "high";
  referenceImages?: string[];
};

export type AgentEarthImageResult = {
  url: string;
  urls: string[];
  error: string | null;
  model: string;
};

export function isAgentEarthModel(modelId: string | null | undefined): boolean {
  return !!modelId && modelId.toLowerCase().startsWith(AGENTEARTH_PREFIX);
}

function getAgentEarthConfig() {
  return {
    apiKey: process.env.AGENTEARTH_API_KEY,
    baseUrl: (process.env.AGENTEARTH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

function upstreamModel(modelId: string): string {
  // UI 使用简短、稳定的供应商命名空间；请求时转换成 AgentEarth 的真实模型 ID。
  return modelId.replace(/^agentearth\/image2$/i, DEFAULT_MODEL).replace(/^agentearth\//i, "");
}

/** 文档支持 1024x1024、1024x1536、1536x1024；把项目内尺寸统一映射过来。 */
function normalizeAgentEarthSize(size: string | undefined): string {
  const s = (size || "").trim().toLowerCase().replace(/\*/g, "x");
  if (s === "1024x1024" || s === "1024x1536" || s === "1536x1024") return s;
  const dimensions = s.match(/^(\d+)x(\d+)$/);
  if (dimensions) {
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (width > height * 1.2) return "1536x1024";
    if (height > width * 1.2) return "1024x1536";
  }
  return "1024x1024";
}

async function referenceImageToBlob(url: string, index: number): Promise<{ blob: Blob; name: string }> {
  let blob: Blob;
  let mime = "image/png";
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error(`invalid data URL for reference image ${index + 1}`);
    mime = match[1] || mime;
    blob = new Blob([Buffer.from(match[2], "base64")], { type: mime });
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fetch reference image ${index + 1} failed: ${response.status}`);
    mime = response.headers.get("content-type") || mime;
    blob = await response.blob();
  }
  const extension = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  return { blob, name: `reference_${index + 1}.${extension}` };
}

/** AgentEarth Image2 generation/editing. All errors are returned as structured results. */
export async function callAgentEarthImage(
  input: AgentEarthImageInput,
): Promise<AgentEarthImageResult> {
  const { apiKey, baseUrl } = getAgentEarthConfig();
  const model = upstreamModel(input.model);
  const size = normalizeAgentEarthSize(input.size);
  const hasReferences = !!input.referenceImages?.length;
  const endpoint = hasReferences ? "/images/edits" : "/images/generations";
  const startedAt = Date.now();

  if (!apiKey) {
    return { url: "", urls: [], error: "AGENTEARTH_API_KEY not configured", model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let request: RequestInit;
    if (hasReferences) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", input.prompt);
      form.append("size", size);
      form.append("n", String(input.n ?? 1));
      form.append("quality", input.quality ?? "auto");
      for (let index = 0; index < input.referenceImages!.length; index++) {
        const { blob, name } = await referenceImageToBlob(input.referenceImages![index], index);
        // AgentEarth 文档的单图字段为 image；多图遵循 OpenAI Images 的 image[] 约定。
        form.append(index === 0 ? "image" : "image[]", blob, name);
      }
      request = {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      };
    } else {
      request = {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          n: input.n ?? 1,
          size,
          quality: input.quality ?? "auto",
          response_format: "url",
        }),
        signal: controller.signal,
      };
    }

    const response = await fetch(`${baseUrl}${endpoint}`, request);
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        url: "",
        urls: [],
        error: `[AgentEarth ${model}] ${response.status}: ${responseText.slice(0, 300)}`,
        model,
      };
    }

    let payload: any = {};
    try {
      payload = JSON.parse(responseText);
    } catch {}
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const urls = data
      .map((item: { url?: string; b64_json?: string }) =>
        item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ""),
      )
      .filter(Boolean);
    if (!urls.length) {
      return {
        url: "",
        urls: [],
        error: `[AgentEarth ${model}] no image returned: ${payload?.error?.message || responseText.slice(0, 200) || "empty data"}`,
        model,
      };
    }
    console.log(
      `[agentearth✓] model=${model} endpoint=${endpoint} images=${urls.length} dur=${Date.now() - startedAt}ms`,
    );
    return { url: urls[0], urls, error: null, model };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "AbortError" ? "timed out" : error.message) : "fetch failed";
    return { url: "", urls: [], error: `[AgentEarth ${model}] network: ${message}`, model };
  } finally {
    clearTimeout(timeout);
  }
}
