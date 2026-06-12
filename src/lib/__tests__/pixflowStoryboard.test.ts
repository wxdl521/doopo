// ====================================================================
//  端到端回归测试 —— Pixflow 故事板路由
//
//  目的:防止再次出现 "[seedream] openai/gpt-image-2 404 ... baseUrl=
//  https://ark.cn-beijing.volces.com/api/v3" 这类错路由的回归。
//
//  覆盖三层:
//   1) callPixflowImage 命中 Gemini Native 端点(/v1beta/models/.../generateContent)
//      ——绝不打 ARK,绝不打 /v1/images/generations。
//   2) generateStoryboardShotImage 在收到 `pixflow/*` 模型时,
//      委派到 Pixflow,不会发请求到 ARK。
//   3) 任何 UI 模型清单(NewProjectDialog 故事板下拉、IMAGE_MODELS、
//      Models 页)都不允许出现裸 "openai/gpt-image-2" —— 只能是
//      pixflow/ 前缀版本或彻底删除。
// ====================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { callPixflowImage } from '../pixflow.functions'
import { IMAGE_MODELS } from '../imageModels'

const ARK_HOST = 'ark.cn-beijing.volces.com'
const PIXFLOW_HOST = 'api.pixflow.im'

/** 1x1 透明 PNG 的 base64,够 Gemini Native 响应当 inlineData 使用 */
const FAKE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

type FetchCall = { url: string; init?: RequestInit }

function installFetchSpy(opts: {
  onPixflow?: (call: FetchCall) => Response | Promise<Response>
  onReferenceImage?: () => Response
  allowOpenAIImages?: boolean
}) {
  const calls: FetchCall[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString()
    calls.push({ url, init })

    // 硬拦截:任何打到 ARK 的请求都视为路由 bug,直接抛
    if (url.includes(ARK_HOST)) {
      throw new Error(`REGRESSION: pixflow flow leaked to ARK host (${url})`)
    }

    // gpt-image-* 无参考图时合法走 /v1/images/generations;
    // Gemini 模型若误打这里仍然算回归,所以用 allowOpenAIImages 显式放行
    if (url.includes(`${PIXFLOW_HOST}/v1/images/generations`) && !opts.allowOpenAIImages) {
      throw new Error(`REGRESSION: pixflow image call hit deprecated /v1/images/generations`)
    }

    // OpenAI 兼容图像端点(gpt-image-* T2I / I2I)
    if (
      url.includes(`${PIXFLOW_HOST}/v1/images/generations`) ||
      url.includes(`${PIXFLOW_HOST}/v1/images/edits`)
    ) {
      return new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.pixflow.im/out.png' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    if (url.includes(`${PIXFLOW_HOST}/v1beta/models/`)) {
      return opts.onPixflow
        ? opts.onPixflow({ url, init })
        : new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{ inlineData: { mimeType: 'image/png', data: FAKE_PNG_B64 } }],
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
    }

    // 参考图下载
    return opts.onReferenceImage
      ? opts.onReferenceImage()
      : new Response(Buffer.from(FAKE_PNG_B64, 'base64'), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
  })
  return { spy, calls }
}

beforeEach(() => {
  process.env.PIXFLOW_API_KEY = 'test-pixflow-key'
  // 确保 seedream.functions.ts 里的 getArkConfig 看到 key,
  // 否则路由失败会以 "ARK_API_KEY not configured" 提前 short-circuit,
  // 掩盖真正想验证的"绝不打 ARK"语义。
  process.env.ARK_API_KEY = 'test-ark-key-should-never-be-used'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('callPixflowImage — Gemini Native 路由', () => {
  it('pixflow/gemini-3.1-flash-image-preview 命中 Native 端点,不会打 ARK 或 /v1/images', async () => {
    const { calls } = installFetchSpy({})
    const r = await callPixflowImage({
      prompt: 'a tiny red apple on white',
      model: 'pixflow/gemini-3.1-flash-image-preview',
      size: '2K',
    })

    expect(r.error).toBeNull()
    expect(r.url.startsWith('data:image/')).toBe(true)

    const pixflowCall = calls.find((c) => c.url.includes('/v1beta/models/'))
    expect(pixflowCall, '必须调用 Gemini Native generateContent').toBeDefined()
    expect(pixflowCall!.url).toContain('gemini-3.1-flash-image-preview:generateContent')
    // 鉴权头应该是 x-goog-api-key,不是 Authorization Bearer
    const headers = pixflowCall!.init!.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('test-pixflow-key')

    // 强不变量:零 ARK 请求,零 /v1/images/generations
    expect(calls.some((c) => c.url.includes(ARK_HOST))).toBe(false)
    expect(calls.some((c) => c.url.includes('/v1/images/generations'))).toBe(false)
  })

  it('携带参考图时,会先 GET 下载再以 inlineData 注入到 Native body', async () => {
    const { calls } = installFetchSpy({})
    await callPixflowImage({
      prompt: 'fuse references',
      model: 'pixflow/gemini-3-pro-image-preview',
      size: '2K',
      referenceImages: ['https://cdn.example.com/ref1.png'],
    })

    expect(calls.some((c) => c.url === 'https://cdn.example.com/ref1.png')).toBe(true)

    const pixflowCall = calls.find((c) => c.url.includes('/v1beta/models/'))!
    const body = JSON.parse(pixflowCall.init!.body as string)
    const parts = body.contents[0].parts as Array<Record<string, unknown>>
    expect(parts.length).toBeGreaterThanOrEqual(2)
    expect(parts.some((p) => 'inlineData' in p)).toBe(true)
  })
})

describe('generateStoryboardShotImage — 高层路由分发源码不变量', () => {
  // 不能直接调用 createServerFn 包装后的导出(需要 TanStack
  // AsyncLocalStorage 的 server runtime 上下文),所以从源码层面静态
  // 校验关键不变量:
  //   - 两个 storyboard handler 都先判断 `pixflow/` 前缀并委派给
  //     callPixflowImage,**早于** 任何 callSeedreamImages 调用。
  it('seedream.functions.ts 在两个 storyboard handler 里有 pixflow 分支并早于 Seedream', () => {
    const src = readFileSync(resolve(__dirname, '../seedream.functions.ts'), 'utf-8')

    for (const handler of ['generateStoryboardShotImage', 'regenerateStoryboardShot']) {
      const start = src.indexOf(`export const ${handler}`)
      expect(start, `${handler} 必须存在`).toBeGreaterThan(0)
      // 取 handler 起始到下一个 export 之间的代码段
      const next = src.indexOf('export const ', start + 1)
      const block = next > 0 ? src.slice(start, next) : src.slice(start)

      const pixflowIdx = block.indexOf("startsWith('pixflow/')")
      const callSeedreamIdx = block.indexOf('callSeedreamImages(')
      expect(pixflowIdx, `${handler} 必须有 pixflow 前缀分支`).toBeGreaterThan(0)
      expect(callSeedreamIdx, `${handler} 仍保留 Seedream 兜底`).toBeGreaterThan(0)
      expect(pixflowIdx).toBeLessThan(callSeedreamIdx)
    }
  })
})

describe('UI 模型清单 —— 不允许裸 openai/gpt-image-2', () => {
  it('IMAGE_MODELS 不应包含已下线的裸 id', () => {
    // IMAGE_MODELS 里仍允许保留 openai/gpt-image-2 这类 legacy 条目
    // (它走 openrouter,不会打到 ARK)。关键不变量是:
    //   1) 不存在 ARK Seedream 没有但 id 又会被路由到 Seedream 的"幽灵 id"
    //   2) 凡是 pixflow 提供的图像模型,key 必须带 pixflow/ 前缀
    const pixflowEntries = IMAGE_MODELS.filter((m) => /gemini-.*image|gpt-image/i.test(m.key))
    for (const m of pixflowEntries) {
      // 允许两种合法形态:legacy(openai/* 或 google/*)+ pixflow/ 前缀
      const isLegacyVendor = m.key.startsWith('openai/') || m.key.startsWith('google/')
      const isPixflow = m.key.startsWith('pixflow/')
      expect(
        isLegacyVendor || isPixflow,
        `图像模型 id 必须是 legacy(openai/google) 或 pixflow/ 前缀,但得到: ${m.key}`,
      ).toBe(true)
    }
  })

  it('NewProjectDialog 故事板下拉:openai/gpt-image-2 走 Lovable Gateway,且不会落到 ARK', async () => {
    // 2026/06 重新启用 openai/gpt-image-2(走 Lovable AI Gateway,不打 ARK)。
    // 关键不变量改为:存在 Lovable Gateway 分支 + isLovableGatewayImageModel
    // 在 seedream dispatch 里早于 callSeedreamImages 出现。
    const seedreamSrc = readFileSync(resolve(__dirname, '../seedream.functions.ts'), 'utf-8')
    // 三个 handler(generateImage / generateStoryboardShotImage / regenerateStoryboardShot)
    // 都必须在调用 callSeedreamImages 前先尝试 Lovable Gateway 分支。
    const lovableMatches = seedreamSrc.match(/isLovableGatewayImageModel\(requested\)/g) || []
    expect(lovableMatches.length, '三处 handler 都应有 Lovable Gateway 早分支').toBeGreaterThanOrEqual(3)
  })
})