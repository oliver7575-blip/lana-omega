import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { addDays, dashList } from '@/lib/cloudbeds-ops'
import { localDate } from '@/lib/tz'

export const maxDuration = 60

/** ?tab=arrivals|departures|stayovers|inhouse&day=today|tomorrow */
export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const url = new URL(request.url)
  const tab = url.searchParams.get('tab') ?? 'arrivals'
  if (!['arrivals', 'departures', 'stayovers', 'inhouse'].includes(tab)) {
    return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  }
  const today = localDate(new Date(), c.tz)
  const day = url.searchParams.get('day') === 'tomorrow' ? addDays(today, 1) : today
  try {
    return NextResponse.json({ day, rows: await dashList(c.cb, tab as 'arrivals', day) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
