import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { deleteRoomBlock } from '@/lib/cloudbeds-ops'

/** Removes a block / out-of-service period from the calendar. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Unknown block' }, { status: 400 })
  try {
    await deleteRoomBlock(c.cb, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
