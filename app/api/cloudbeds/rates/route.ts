import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { setRoomRate } from '@/lib/cloudbeds-ops'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Changes the nightly price of a room category for one night or a date range (end date inclusive). */
export async function PUT(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const b = (await request.json().catch(() => ({}))) as { rateID?: string; startDate?: string; endDate?: string; rate?: number }
  const rate = Number(b.rate)
  if (!b.rateID) return NextResponse.json({ error: 'This category has no editable base rate.' }, { status: 400 })
  if (!DATE.test(b.startDate ?? '') || !DATE.test(b.endDate ?? '') || b.endDate! < b.startDate!) return NextResponse.json({ error: 'Choose valid dates.' }, { status: 400 })
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000000) return NextResponse.json({ error: 'Enter a valid price.' }, { status: 400 })
  try {
    await setRoomRate(c.cb, { rateID: b.rateID, startDate: b.startDate!, endDate: b.endDate!, rate })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
