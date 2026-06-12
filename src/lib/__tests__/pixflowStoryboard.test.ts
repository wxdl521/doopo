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
import { generateStoryboardShotImage } from '../seedream.functions'
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
}) {
  const calls: FetchCall[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString()
    calls.push({ url, init })

    // 硬拦截:任何打到 ARK 的请求都视为路由 bug,直接抛
    if (url.includes(ARK_HOST)) {
      throw new Error(`REGRESSION: pixflow flow leaked to ARK host (${url})`)
    }

    // 老 OpenAI 兼容图像端点 —— 同样视为回归
    if (url.includes(`${PIXFLOW_HOST}/v1/images/generations`)) {
      throw new Error(`REGRESSION: pixflow image call hit deprecated /v1/images/generations`)
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

describe('generateStoryboardShotImage — 高层路由', () => {
  it('传 pixflow/* 模型时绝不打 ARK,产物来自 Pixflow', async () => {
    const { calls } = installFetchSpy({})

    // createServerFn 返回的对象是可调用的;TanStack v1 的 .handler() 注册后,
    // 模块导出本身就是 (opts) => Promise<result>。
    const fn = generateStoryboardShotImage as unknown as (opts: {
      data: Record<string, unknown>
    }) => Promise<{ ok: boolean; url?: string; error?: string }>

    const result = await fn({
      data: {
        plotText: '主角在雨夜走出咖啡店',
        shotType: 'MS',
        shotTypeLabel: '中景',
        action: '主角抬头望向天空,雨水打湿头发',
        camera: '',
        characterImageUrls: ['https://cdn.example.com/character-1.png'],
        characterNames: ['Alice'],
        sceneImageUrl: 'https://cdn.example.com/scene-rain.png',
        sceneLocation: '咖啡店门口',
        sceneTimeOfDay: '雨夜',
        model: 'pixflow/gemini-3.1-flash-image-preview',
        previewOnly: false,
      },
    })

    expect(result.ok).toBe(true)
    expect(result.url?.startsWith('data:image/')).toBe(true)
    expect(calls.some((c) => c.url.includes(ARK_HOST))).toBe(false)
    expect(calls.some((c) => c.url.includes('/v1beta/models/'))).toBe(true)
  })
})

describe('UI 模型清单 —— 不允许裸 openai/gpt-image-2', () => {
  it('IMAGE_MODELS 不应包含已下线的裸 id', () => {
    const ids = IMAGE_MODELS.map((m) => m.key)
    expect(ids).not.toContain('openai/gpt-image-2')
    expect(ids).not.toContain('openai/gpt-image-1-mini')
    // pixflow 前缀版本如果存在,也必须是带前缀的
    for (const id of ids) {
      if (id.includes('gpt-image-2') || id.includes('gpt-image-1-mini')) {
        expect(id.startsWith('pixflow/')).toBe(true)
      }
    }
  })

  it('NewProjectDialog 故事板下拉源码里不再含裸 openai/gpt-image-2', () => {
    const src = readFileSync(resolve(__dirname, '../../components/NewProjectDialog.tsx'), 'utf-8')
    // 允许出现 'pixflow/gpt-image-2' (带前缀);但不允许出现裸 'openai/gpt-image-2'
    // 用正则确保边界:前一个字符不是 / 或字母数字
    const bareMatches = src.match(/(?<![\w/])openai\/gpt-image-2/g) || []
    expect(bareMatches).toEqual([])
  })
})