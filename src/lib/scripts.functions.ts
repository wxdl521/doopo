import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import type { SavedScript } from './scriptStorage'

const ScriptSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  plot: z.string().max(20000).optional().default(''),
  type: z.string().max(64).optional().default(''),
  genre: z.string().max(64).optional().default(''),
  tone: z.string().max(64).optional().default(''),
}).passthrough()

export const listScriptsRemote = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context
    const { data, error } = await supabase
      .from('scripts')
      .select('payload')
      .order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => r.payload as SavedScript)
  })

export const getScriptRemote = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().min(1).max(128) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context
    const { data: row, error } = await supabase
      .from('scripts')
      .select('payload')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (row?.payload as SavedScript | undefined) ?? null
  })

export const upsertScriptRemote = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ script: ScriptSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context
    const s = data.script as SavedScript
    const { error } = await supabase.from('scripts').upsert(
      {
        id: s.id,
        user_id: userId,
        title: s.title || '未命名剧本',
        type: s.type ?? null,
        genre: s.genre ?? null,
        tone: s.tone ?? null,
        payload: s as unknown as Record<string, unknown>,
      },
      { onConflict: 'id' },
    )
    if (error) throw new Error(error.message)
    return { ok: true as const }
  })

export const deleteScriptRemote = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().min(1).max(128) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context
    const { error } = await supabase.from('scripts').delete().eq('id', data.id)
    if (error) throw new Error(error.message)
    return { ok: true as const }
  })