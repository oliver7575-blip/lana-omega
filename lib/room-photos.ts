import { matchRoomType } from './cloudbeds'
import type { RoomPhotosResult } from './anthropic'
import type { PmsAdapter } from './pms'
import { createServiceClient } from './supabase/service'

const MAX_PHOTOS = 6
const MAX_FOCUS_PHOTOS = 4
const MAX_LABELLED = 16
const CACHE_MS = 10 * 60 * 1000
type PhotosData = Awaited<ReturnType<NonNullable<PmsAdapter['getRoomTypePhotos']>>>
const cache = new Map<string, { at: number; data: PhotosData }>()

export const PHOTO_FOCUS = ['bed', 'bathroom', 'balcony_terrace', 'pool', 'view', 'kitchen', 'living_area', 'entrance_exterior'] as const
type Label = (typeof PHOTO_FOCUS)[number] | 'other'
const LABELS: Label[] = [...PHOTO_FOCUS, 'other']

/**
 * Looks at photos (one request) and labels each by what it mainly shows. Photos are fetched by Anthropic from
 * their public URLs. Returns null when it can't be done, so the caller falls back to sending the plain set.
 */
async function labelWithVision(urls: string[]): Promise<Label[] | null> {
  try {
    const content: unknown[] = []
    urls.forEach((u, i) => {
      content.push({ type: 'text', text: `Photo ${i + 1}:` })
      content.push({ type: 'image', source: { type: 'url', url: u } })
    })
    content.push({
      type: 'text',
      text: `Label each photo above by what it mainly shows, using ONLY these labels: ${LABELS.join(', ')}. "bed" = the bedroom/bed; "balcony_terrace" = a balcony or terrace; "entrance_exterior" = the building, door or stairs outside. Reply with ONLY a JSON array of ${urls.length} strings, one per photo, in order.`,
    })
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content }] }),
    })
    if (!response.ok) {
      console.error('[room-photos] labelling failed', response.status, (await response.text()).slice(0, 200))
      return null
    }
    const data = (await response.json()) as { content?: { type: string; text?: string }[] }
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ')
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as unknown[]
    if (!Array.isArray(arr) || arr.length !== urls.length) return null
    return arr.map((x) => (LABELS.includes(x as Label) ? (x as Label) : 'other'))
  } catch (e) {
    console.error('[room-photos] labelling error', e)
    return null
  }
}

/** Labels for these photos: remembered ones from the database, the rest looked at once and then remembered. */
async function labelsFor(cacheKey: string, urls: string[]): Promise<Map<string, Label> | null> {
  const db = createServiceClient()
  const known = new Map<string, Label>()
  const { data } = await db.from('room_photo_labels').select('url, label').eq('cache_key', cacheKey).in('url', urls)
  for (const r of data ?? []) known.set(r.url as string, r.label as Label)
  const missing = urls.filter((u) => !known.has(u))
  if (missing.length) {
    const labels = await labelWithVision(missing)
    if (!labels) return known.size === urls.length ? known : null
    const rows = missing.map((u, i) => ({ cache_key: cacheKey, url: u, label: labels[i] }))
    await db.from('room_photo_labels').upsert(rows, { onConflict: 'cache_key,url' })
    rows.forEach((r) => known.set(r.url, r.label))
  }
  return known
}

/**
 * Builds the concierge's room-photos tool for one connected property.
 * Undefined when the hotel's PMS can't supply room photos.
 */
export function buildRoomPhotosTool(pms: PmsAdapter) {
  const fetchPhotos = pms.getRoomTypePhotos?.bind(pms)
  if (!fetchPhotos) return undefined
  return {
    getRoomPhotos: async (roomType: string, focus?: string): Promise<RoomPhotosResult> => {
      let entry = cache.get(pms.cacheKey)
      if (!entry || Date.now() - entry.at > CACHE_MS) {
        entry = { at: Date.now(), data: await fetchPhotos() }
        if (entry.data.success) cache.set(pms.cacheKey, entry)
      }
      const { success, roomTypes, error } = entry.data
      if (!success) return { found: false, error: error ?? 'Could not load room photos' }

      const available = roomTypes.filter((r) => r.photos.length > 0).map((r) => r.roomTypeName)
      const match = matchRoomType(roomType, roomTypes)
      if (!match || match.photos.length === 0) {
        return { found: false, availableRoomTypes: available }
      }

      // A specific angle was asked for (bathroom, balcony…): send only the photos that show it.
      if (focus && (PHOTO_FOCUS as readonly string[]).includes(focus)) {
        const pool = match.photos.slice(0, MAX_LABELLED)
        const labels = await labelsFor(pms.cacheKey, pool)
        if (labels) {
          const hits = pool.filter((u) => labels.get(u) === focus).slice(0, MAX_FOCUS_PHOTOS)
          if (hits.length) return { found: true, roomTypeName: match.roomTypeName, photoCount: hits.length, photoUrls: hits, focus }
          const shown = [...new Set(pool.map((u) => labels.get(u)).filter((l) => l && l !== 'other'))]
          return { found: true, roomTypeName: match.roomTypeName, photoCount: 0, focus, noPhotoOfThat: true, photosShow: shown as string[] }
        }
        // Couldn't look at the photos: fall through and send the general set.
      }
      const photoUrls = match.photos.slice(0, MAX_PHOTOS)
      return { found: true, roomTypeName: match.roomTypeName, photoCount: photoUrls.length, photoUrls }
    },
  }
}
