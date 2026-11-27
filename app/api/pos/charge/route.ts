import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { postRoomCharge, soldProductIds, type PosLine } from '@/lib/cloudbeds-pos'
import { posCaller, posTestMode } from '@/lib/pos-auth'

export const maxDuration = 30

export async function GET() {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { data, error } = await c.db
    .from('pos_charges')
    .select('id, reservation_id, guest_name, room, items, total, currency, status, staff_email, error, created_at, voided_at')
    .eq('tenant_id', c.tenantId)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ charges: data ?? [], testMode: await posTestMode(c.db, c.tenantId) })
}

interface Body {
  reservationId?: string
  guestName?: string
  room?: string
  /** Chosen on the iPad so a double tap or a retry can never charge twice. */
  requestId?: string
  lines?: { itemId: string; quantity: number }[]
}

export async function POST(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const b = (await req.json().catch(() => ({}))) as Body
  if (!b.reservationId || !b.requestId || !/^[A-Za-z0-9._~-]{8,64}$/.test(b.requestId) || !b.lines?.length) {
    return NextResponse.json({ error: 'Pick a guest and at least one item.' }, { status: 400 })
  }
  const referenceId = `pos-${b.requestId}`

  // A retry of the same sale returns the original result.
  const { data: existing } = await c.db.from('pos_charges').select('id, status, total').eq('tenant_id', c.tenantId).eq('reference_id', referenceId).maybeSingle()
  if (existing) return NextResponse.json({ id: existing.id, status: existing.status, total: existing.total, duplicate: true })

  // Prices always come from the menu, never from the iPad.
  const ids = [...new Set(b.lines.map((l) => l.itemId))]
  const { data: menu } = await c.db.from('pos_items').select('id, name, category, price').eq('tenant_id', c.tenantId).eq('active', true).in('id', ids)
  const byId = new Map((menu ?? []).map((m) => [m.id as string, m]))
  const lines: PosLine[] = []
  for (const l of b.lines) {
    const item = byId.get(l.itemId)
    const qty = Math.floor(Number(l.quantity))
    if (!item || !(qty >= 1 && qty <= 50)) return NextResponse.json({ error: 'An item in the order is no longer on the menu.' }, { status: 400 })
    lines.push({ name: item.name as string, category: item.category as string, price: Number(item.price), quantity: qty })
  }
  const total = Math.round(lines.reduce((s, l) => s + l.price * l.quantity, 0) * 100) / 100

  const record = {
    tenant_id: c.tenantId,
    reservation_id: b.reservationId,
    guest_name: b.guestName?.slice(0, 120) ?? null,
    room: b.room?.slice(0, 60) ?? null,
    items: lines,
    total,
    staff_email: c.email,
    reference_id: referenceId,
  }

  if (await posTestMode(c.db, c.tenantId)) {
    const { data, error } = await c.db.from('pos_charges').insert({ ...record, status: 'test' }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id: data.id, status: 'test', total })
  }

  const cbc = await cloudbedsForCaller()
  if ('error' in cbc) return cbc.error
  try {
    const resp = await postRoomCharge(cbc.cb, { reservationID: b.reservationId, referenceID: referenceId, lines, guestName: b.guestName })
    const { data, error } = await c.db.from('pos_charges').insert({ ...record, status: 'posted', cloudbeds_response: { ...resp, soldProductIDs: soldProductIds(resp) } }).select('id').single()
    if (error) return NextResponse.json({ error: `Posted to Cloudbeds but could not be logged: ${error.message}` }, { status: 500 })
    return NextResponse.json({ id: data.id, status: 'posted', total })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cloudbeds error'
    await c.db.from('pos_charges').insert({ ...record, status: 'failed', error: message.slice(0, 500) })
    return NextResponse.json({ error: `Cloudbeds did not accept the charge: ${message}` }, { status: 502 })
  }
}
