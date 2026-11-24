import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { getReservationNotes, getReservationRaw } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

/**
 * ?ids=1,2,3 → { flagged: [...ids that carry a guest special request or a staff note] }.
 * The calendar uses this for the little yellow dot. Cloudbeds' reservation list doesn't include
 * notes, so each reservation is looked up once and the answer is remembered for a few minutes.
 */
const TTL = 5 * 60 * 1000
const cache = new Map<string, { flag: boolean; at: number }>()

export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return NextResponse.json({ flagged: [] })
  const ids = [...new Set((new URL(request.url).searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))].slice(0, 80)
  const now = Date.now()
  const key = (id: string) => `${c.cb.propertyId}:${id}`
  const todo = ids.filter((id) => !((cache.get(key(id))?.at ?? 0) > now - TTL))

  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++]
      try {
        const [raw, notes] = await Promise.all([getReservationRaw(c.cb, id), getReservationNotes(c.cb, id).catch(() => [])])
        const req = [raw.specialRequests, raw.guestSpecialRequests].some((v) => typeof v === 'string' && v.trim())
        cache.set(key(id), { flag: req || notes.length > 0, at: Date.now() })
      } catch {
        /* leave it unflagged this time; it is retried on the next pass */
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  return NextResponse.json({ flagged: ids.filter((id) => cache.get(key(id))?.flag) })
}
