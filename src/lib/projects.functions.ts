import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

const ProjectInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200).optional(),
  aspect: z.string().max(20).optional(),
  storyboardModel: z.string().max(100).optional(),
  sceneModel: z.string().max(100).optional(),
  videoModel: z.string().max(100).optional(),
  audio: z.enum(['auto', 'on', 'off']).optional(),
  workflow: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  customCover: z.string().max(2000).nullable().optional(),
})

export type ProjectConfigRow = {
  id: string
  name: string
  aspect: string
  storyboardModel: string
  sceneModel: string
  videoModel: string
  audio: 'auto' | 'on' | 'off'
  workflow: string
  style: string
  customCover: string | null
}

export const upsertProject = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProjectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context
    const row = {
      id: data.id,
      user_id: userId,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.aspect !== undefined && { aspect: data.aspect }),
      ...(data.storyboardModel !== undefined && { storyboard_model: data.storyboardModel }),
      ...(data.sceneModel !== undefined && { scene_model: data.sceneModel }),
      ...(data.videoModel !== undefined && { video_model: data.videoModel }),
      ...(data.audio !== undefined && { audio: data.audio }),
      ...(data.workflow !== undefined && { workflow: data.workflow }),
      ...(data.style !== undefined && { style: data.style }),
      ...(data.customCover !== undefined && { custom_cover: data.customCover }),
    }
    const { error } = await supabase.from('projects').upsert(row, { onConflict: 'id' })
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  })

export const getProject = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context
    const { data: row, error } = await supabase
      .from('projects')
      .select('id,name,aspect,storyboard_model,scene_model,video_model,audio,workflow,style,custom_cover')
      .eq('id', data.id)
      .maybeSingle()
    if (error) return { project: null, error: error.message }
    if (!row) return { project: null, error: null as string | null }
    const project: ProjectConfigRow = {
      id: row.id,
      name: row.name,
      aspect: row.aspect,
      storyboardModel: row.storyboard_model,
      sceneModel: row.scene_model,
      videoModel: row.video_model,
      audio: row.audio as 'auto' | 'on' | 'off',
      workflow: row.workflow,
      style: row.style,
      customCover: row.custom_cover,
    }
    return { project, error: null as string | null }
  })

// ===== Workspace data persistence =====

export const saveWorkspaceData = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().min(1).max(64),
      workspaceData: z.record(z.string(), z.unknown()),
      completedStages: z.array(z.string()),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context
    const { error } = await supabase
      .from('projects')
      .update({
        workspace_data: data.workspaceData as any,
        completed_stages: data.completedStages,
      })
      .eq('id', data.id)
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const, error: null as string | null }
  })

export const loadWorkspaceData = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context
    const { data: row, error } = await supabase
      .from('projects')
      .select('workspace_data,completed_stages')
      .eq('id', data.id)
      .maybeSingle()
    if (error) return { workspaceData: null as Record<string, string> | null, completedStages: null as string[] | null, error: error.message }
    if (!row) return { workspaceData: null as Record<string, string> | null, completedStages: null as string[] | null, error: null as string | null }
    return {
      workspaceData: (row.workspace_data ?? {}) as unknown as Record<string, string>,
      completedStages: (row.completed_stages ?? []) as string[],
      error: null as string | null,
    }
  })