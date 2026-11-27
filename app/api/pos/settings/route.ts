import { NextResponse } from 'next/server'
import { posCaller, posLockedReservation, posTestMode } from '@/lib/pos-auth'

export async function GET() {
  const c = await posCaller()
  if ('error' in c) return c.error
  return NextResponse.json({ testMode: await posTestMode(c.db, c.tenantId), lockReservationId: await posLockedReservation(c.db, c.tenantId) })
}

/** { lockReservationId: "123" | null } limits live charges to that one reservation. { live: true } sends charges to Cloudbeds for real; { live: false } goes back to test mode. */
export async function PUT(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const body = (await req.json().catch(() => ({}))) as { live?: boolean; lockReservationId?: string | null }
  const { data } = await c.db.from('tenants').select('channel_settings').eq('id', c.tenantId).single()
  const next: Record<string, unknown> = { ...((data?.channel_settings as Record<string, unknown>) ?? {}) }
  if (typeof body.live === 'boolean') next.pos_live = body.live
  if ('lockReservationId' in body) {
    if (body.lockReservationId) next.pos_lock_reservation = String(body.lockReservationId).slice(0, 40)
    else delete next.pos_lock_reservation
  }
  const { error } = await c.db.from('tenants').update({ channel_settings: next }).eq('id', c.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ testMode: next.pos_live !== true, lockReservationId: (next.pos_lock_reservation as string | undefined) ?? null })
}
