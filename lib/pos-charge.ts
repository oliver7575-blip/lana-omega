import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from './cloudbeds-caller'
import { postRoomCharge, type PosLine } from './cloudbeds-pos'
import { posLockedReservation, posTestMode, type PosCaller } from './pos-auth'

/**
 * Records a sale against a guest's room: in test mode it is only logged, live it is posted to the
 * Cloudbeds folio first. The requestId makes a retry return the first result instead of charging twice.
 */
export async function createCharge(
  c: PosCaller,
  a: { reservationId: string; guestName?: string | null; room?: string | null; requestId: string; lines: PosLine[] }
): Promise<NextResponse> {
  const referenceId = `pos-${a.requestId}`
  const { data: existing } = await c.db.from('pos_charges').select('id, status, total').eq('tenant_id', c.tenantId).eq('reference_id', referenceId).maybeSingle()
  if (existing) return NextResponse.json({ id: existing.id, status: existing.status, total: existing.total, duplicate: true })

  const total = Math.round(a.lines.reduce((s, l) => s + l.price * l.quantity, 0) * 100) / 100
  const record = {
    tenant_id: c.tenantId,
    reservation_id: a.reservationId,
    guest_name: a.guestName?.slice(0, 120) ?? null,
    room: a.room?.slice(0, 60) ?? null,
    items: a.lines,
    total,
    staff_email: c.email,
    reference_id: referenceId,
  }

  if (await posTestMode(c.db, c.tenantId)) {
    const { data, error } = await c.db.from('pos_charges').insert({ ...record, status: 'test' }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id: data.id, status: 'test', total })
  }

  const lock = await posLockedReservation(c.db, c.tenantId)
  if (lock && lock !== a.reservationId) {
    return NextResponse.json({ error: 'Live test lock is on: real charges are only allowed to the test reservation. Change this in Manage → Mode.' }, { status: 403 })
  }

  const cbc = await cloudbedsForCaller()
  if ('error' in cbc) return cbc.error
  try {
    const resp = await postRoomCharge(cbc.cb, { reservationID: a.reservationId, referenceID: referenceId, lines: a.lines, guestName: a.guestName })
    const { data, error } = await c.db.from('pos_charges').insert({ ...record, status: 'posted', cloudbeds_response: resp }).select('id').single()
    if (error) return NextResponse.json({ error: `Posted to Cloudbeds but could not be logged: ${error.message}` }, { status: 500 })
    return NextResponse.json({ id: data.id, status: 'posted', total })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cloudbeds error'
    await c.db.from('pos_charges').insert({ ...record, status: 'failed', error: message.slice(0, 500) })
    return NextResponse.json({ error: `Cloudbeds did not accept the charge: ${message}` }, { status: 502 })
  }
}
