/**
 * Convert an image URL to a base64 data URL.
 *
 * Used as a fallback when Supabase Storage persistence fails.
 * The resulting data URL can be stored directly in the database
 * so the image survives page refreshes.
 */

export async function urlToBase64(url: string): Promise<string | null> {
  // Already a data URL — return as-is
  if (url.startsWith('data:')) return url

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`)
    const blob = await res.blob()
    return new Promise<string | null>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('FileReader failed'))
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
