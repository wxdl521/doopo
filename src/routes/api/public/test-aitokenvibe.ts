import { createFileRoute } from "@tanstack/react-router";

const BASE = "https://api.aitokenvibe.com";

async function tryCall(path: string, body: unknown, key: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, body: json ?? text.slice(0, 2000) };
}

export const Route = createFileRoute("/api/public/test-aitokenvibe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = process.env.aitokenvibe || process.env.AITOKENVIBE;
        if (!key) return new Response("Missing aitokenvibe secret", { status: 500 });

        const url = new URL(request.url);
        const model = url.searchParams.get("model") || "gpt-image-2";
        const prompt =
          url.searchParams.get("prompt") || "A cute orange cat sitting on a wooden table";

        const results: Record<string, unknown> = {};

        // 1. Standard OpenAI images/generations
        results["images/generations"] = await tryCall(
          "/v1/images/generations",
          {
            model,
            prompt,
            n: 1,
            size: "1024x1024",
          },
          key,
        );

        // 2. Chat completions (vision-style) fallback
        results["chat/completions"] = await tryCall(
          "/v1/chat/completions",
          {
            model,
            messages: [{ role: "user", content: prompt }],
          },
          key,
        );

        // 3. List models
        const mres = await fetch(`${BASE}/v1/models`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        const mtext = await mres.text();
        let mjson: unknown = null;
        try {
          mjson = JSON.parse(mtext);
        } catch {}
        results["models"] = { status: mres.status, body: mjson ?? mtext.slice(0, 2000) };

        return new Response(JSON.stringify(results, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
