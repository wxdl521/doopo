/**
 * Legacy data migration for renamed fields.
 *
 * Historical names → current names:
 *   - "ZoClaw" / "zoClaw" / "doClaw" / "zoclaw" / "doclaw"  →  "DooClaw" / "dooclaw"
 *   - "资产库"                                                →  "资产"
 *
 * Runs once per browser (guarded by a localStorage flag) to upgrade any
 * persisted strings/JSON in localStorage so user history doesn't break
 * after the rename. Safe to call multiple times.
 */

const MIGRATION_FLAG = 'doopoo_legacy_migration_v2'

// Order matters: longer / more-specific first.
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/ZoClaw/g, 'DooClaw'],
  [/zoClaw/g, 'DooClaw'],
  [/doClaw/g, 'DooClaw'],
  [/zoclaw/g, 'dooclaw'],
  [/doclaw/g, 'dooclaw'],
  [/资产库/g, '资产'],
]

/** Normalize a single string value (used by app code reading legacy fields). */
export function normalizeLegacyText(value: string): string {
  let out = value
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to)
  return out
}

/** Recursively normalize any string inside a parsed JSON value. */
export function normalizeLegacyDeep<T>(value: T): T {
  if (typeof value === 'string') return normalizeLegacyText(value) as unknown as T
  if (Array.isArray(value)) return value.map((v) => normalizeLegacyDeep(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[normalizeLegacyText(k)] = normalizeLegacyDeep(v)
    }
    return out as unknown as T
  }
  return value
}

/** One-shot migration: rewrites every localStorage entry in place. */
export function runLegacyMigration(): void {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(MIGRATION_FLAG)) return

    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k) keys.push(k)
    }

    for (const key of keys) {
      const raw = window.localStorage.getItem(key)
      if (raw == null) continue

      let next = raw
      // Try JSON first so we rewrite nested strings too.
      try {
        const parsed = JSON.parse(raw)
        const migrated = normalizeLegacyDeep(parsed)
        const serialized = JSON.stringify(migrated)
        if (serialized !== raw) next = serialized
      } catch {
        // Not JSON — treat as plain string.
        const migrated = normalizeLegacyText(raw)
        if (migrated !== raw) next = migrated
      }

      if (next !== raw) window.localStorage.setItem(key, next)

      // Also migrate the key name itself if it carries legacy tokens.
      const newKey = normalizeLegacyText(key)
      if (newKey !== key && window.localStorage.getItem(newKey) == null) {
        window.localStorage.setItem(newKey, window.localStorage.getItem(key) ?? '')
        window.localStorage.removeItem(key)
      }
    }

    window.localStorage.setItem(MIGRATION_FLAG, '1')
  } catch {
    // Storage may be unavailable (private mode, quota). Fail silently —
    // runtime reads still go through normalizeLegacyText where needed.
  }
}
