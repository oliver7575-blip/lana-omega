import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { createRoomBlock } from '@/lib/cloudbeds-ops'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Blocks dates on a room (or marks it out of service) from the calendar. */
export async function POST(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const b = (await request.json().catch(() => ({}))) as { roomID?: string; startDate?: string; endDate?: string; type?: string; reason?: string }
  if (!b.roomID) return NextResponse.json({ error: 'Choose the room to block.' }, { status: 400 })
  if (!DATE.test(b.startDate ?? '') || !DATE.test(b.endDate ?? '') || b.endDate! <= b.startDate!) return NextResponse.json({ error: 'Choose valid dates.' }, { status: 400 })
  try {
    await createRoomBlock(c.cb, {
      roomID: b.roomID,
      startDate: b.startDate!,
      endDate: b.endDate!,
      type: b.type === 'out_of_service' ? 'out_of_service' : 'blocked_dates',
      reason: b.reason,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
