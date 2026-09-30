import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { addDays, calendar, cloudbedsLinks } from '@/lib/cloudbeds-ops'
import { localDate } from '@/lib/tz'

export const maxDuration = 60

/** ?start=YYYY-MM-DD&days=19 (defaults: yesterday, 19 days — like Beta) */
export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const url = new URL(request.url)
  const today = localDate(new Date(), c.tz)
  const startParam = url.searchParams.get('start')
  const start = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : addDays(today, -1)
  const days = Math.min(35, Math.max(7, Number(url.searchParams.get('days')) || 19))
  try {
    const data = await calendar(c.cb, start, days)
    return NextResponse.json({ today, links: { newReservation: cloudbedsLinks(c.cb.propertyId).newReservation }, ...data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
