// ====================================================================
//  回归测试 —— characters / scenes / props 资产保存的 RLS 安全性
//
//  背景:旧表把 `id` 当成全局主键,不同用户/旧项目偶然生成同一个 id 时,
//  直接 supabase.upsert(...) 会命中别人那一行并尝试 UPDATE,从而触发
//  "new row violates row-level security policy (USING expression) for table
//  'characters'"。
//
//  修复方式:saveOwnAssetRecord 必须
//    1) 先按 (user_id, id) 做 UPDATE —— 永远不会更新别人的行;
//    2) 没命中时再 INSERT 自己的新行;
//    3) INSERT 撞 23505 时按 (user_id, id) 兜底 UPDATE,而不是裸 upsert。
//
//  本测试通过 mock supabase 客户端,断言上述调用形状不再回退到 upsert,
//  并且 update / insert 的过滤条件始终被 user_id 包裹。
// ====================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Call = {
  table: string
  op: 'update' | 'insert' | 'upsert'
  payload: any
  filters: Record<string, unknown>
}

const calls: Call[] = []

/**
 * 行为可配置的假 supabase 客户端:
 *  - updateBehaviour: 决定 .update().eq().eq().select().maybeSingle() 的返回值
 *  - insertBehaviour: 决定 .insert() 的返回值
 * 任何 .upsert() 调用都视为回归失败 —— 我们绝不允许再走 upsert 路径。
 */
function makeFakeSupabase(opts: {
  updateResult: () => { data: any; error: any }
  insertResult: () => { error: any }
}) {
  return {
    from(table: string) {
      return {
        update(payload: any) {
          const filters: Record<string, unknown> = {}
          const builder: any = {
            eq(col: string, val: unknown) {
              filters[col] = val
              return builder
            },
            select() {
              return builder
            },
            async maybeSingle() {
              calls.push({ table, op: 'update', payload, filters })
              return opts.updateResult()
            },
            // 没有 .select().maybeSingle() 的兜底分支(23505 重试用):
            then(resolve: (v: any) => void) {
              calls.push({ table, op: 'update', payload, filters })
              resolve(opts.updateResult())
            },
          }
          return builder
        },
        async insert(payload: any) {
          calls.push({ table, op: 'insert', payload, filters: {} })
          return opts.insertResult()
        },
        upsert() {
          calls.push({ table, op: 'upsert', payload: null, filters: {} })
          throw new Error('REGRESSION: saveOwnAssetRecord must not use .upsert()')
        },
      }
    },
  }
}

let fakeSupabase: ReturnType<typeof makeFakeSupabase>

vi.mock('@/integrations/supabase/client', () => ({
  get supabase() {
    return fakeSupabase
  },
}))

import { saveOneCharacter, saveCharacters } from '../assetsStorage'
import type { GenCharacter } from '@/data/workspaceGenerators'

const SAMPLE: GenCharacter = {
  id: 'shared-character-id',
  name: '院长',
  role: 'support',
  roleLabel: '配角',
  age: '50',
  faceDescription: '',
  bodyDescription: '',
  clothingDescription: '',
  personality: '',
  palette: ['#000'],
  swatch: 'linear-gradient(...)',
  mbti: null,
  keyProp: null,
} as unknown as GenCharacter

beforeEach(() => {
  calls.length = 0
})

describe('assetsStorage RLS regression', () => {
  it('用户 A 已占用同一个 id 时,用户 B 保存只更新自己的行,不会触发跨用户 UPDATE', async () => {
    // update 未命中(因为这个 id 属于别的用户),走 insert 分支
    fakeSupabase = makeFakeSupabase({
      updateResult: () => ({ data: null, error: null }),
      insertResult: () => ({ error: null }),
    })

    const res = await saveOneCharacter(SAMPLE, 'user-B', 'https://x/cover.png')
    expect(res.ok).toBe(true)

    // 必须先尝试 UPDATE,且过滤条件同时包含 user_id 和 id
    expect(calls[0]).toMatchObject({
      table: 'characters',
      op: 'update',
      filters: { user_id: 'user-B', id: 'shared-character-id' },
    })
    // 没命中后才能 INSERT —— payload 必须带正确的 user_id
    expect(calls[1]).toMatchObject({
      table: 'characters',
      op: 'insert',
      payload: expect.objectContaining({ user_id: 'user-B', id: 'shared-character-id' }),
    })
    // 绝对不能出现 upsert
    expect(calls.some((c) => c.op === 'upsert')).toBe(false)
  })

  it('update 命中自己的行时直接返回 ok,不会再 INSERT', async () => {
    fakeSupabase = makeFakeSupabase({
      updateResult: () => ({ data: { id: 'shared-character-id' }, error: null }),
      insertResult: () => ({ error: { message: 'should not be called' } }),
    })

    const res = await saveOneCharacter(SAMPLE, 'user-A', 'https://x/cover.png')
    expect(res.ok).toBe(true)
    expect(calls.length).toBe(1)
    expect(calls[0].op).toBe('update')
  })

  it('RLS 拒绝(USING expression)时,错误被捕获返回,不抛出', async () => {
    fakeSupabase = makeFakeSupabase({
      updateResult: () => ({
        data: null,
        error: {
          message:
            'new row violates row-level security policy (USING expression) for table "characters"',
          code: '42501',
        },
      }),
      insertResult: () => ({ error: null }),
    })

    const res = await saveOneCharacter(SAMPLE, 'user-B')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/row-level security/i)
    // 出错后不应该再走 insert
    expect(calls.length).toBe(1)
  })

  it('批量 saveCharacters 也走 per-row 的 update→insert 形态,而非 upsert', async () => {
    fakeSupabase = makeFakeSupabase({
      updateResult: () => ({ data: null, error: null }),
      insertResult: () => ({ error: null }),
    })

    const a = { ...SAMPLE, id: 'a' } as GenCharacter
    const b = { ...SAMPLE, id: 'b' } as GenCharacter
    const res = await saveCharacters([a, b], 'user-B')
    expect(res.error).toBeNull()

    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(0)
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(2)
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(2)
    for (const c of calls) {
      if (c.op === 'update') {
        expect(c.filters.user_id).toBe('user-B')
      }
      if (c.op === 'insert') {
        expect(c.payload.user_id).toBe('user-B')
      }
    }
  })
})