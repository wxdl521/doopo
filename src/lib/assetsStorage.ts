import { supabase } from '@/integrations/supabase/client'
import type { GenCharacter, GenScene } from '@/data/workspaceGenerators'
import type { Tables, Json } from '@/integrations/supabase/types'

export type DbCharacter = Tables<'characters'>
export type DbScene = Tables<'scenes'>

export async function saveCharacters(chars: GenCharacter[], userId: string) {
  const records = chars.map((c) => ({
    id: c.id,
    user_id: userId,
    name: c.name,
    role: c.role,
    role_label: c.roleLabel,
    age: c.age,
    look: [c.faceDescription, c.bodyDescription, c.clothingDescription]
      .filter(Boolean)
      .join(' / '),
    personality: c.personality,
    motivation: null,
    debut_shot: null,
    palette: c.palette,
    mbti: c.mbti ?? null,
    key_prop: c.keyProp ?? null,
    gradient: c.swatch,
  }))
  return supabase.from('characters').upsert(records)
}

export async function loadCharacters(userId: string) {
  return supabase.from('characters').select('*').eq('user_id', userId)
}

export async function saveScenes(scenes: GenScene[], userId: string) {
  const records = scenes.map((s) => ({
    id: s.id,
    user_id: userId,
    name: s.slug.split('—')[0].trim() || s.location,
    location: s.location,
    time_of_day: s.timeOfDay,
    action: s.action,
    beats: s.beats,
    dialogue: s.dialogue as unknown as Json,
    gradient: null,
  }))
  return supabase.from('scenes').upsert(records)
}

export async function loadScenes(userId: string) {
  return supabase.from('scenes').select('*').eq('user_id', userId)
}