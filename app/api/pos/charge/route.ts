import { NextResponse } from 'next/server'
import type { PosLine } from '@/lib/cloudbeds-pos'
import { createCharge } from '@/lib/pos-charge'
import { posCaller, posTestMode } from '@/lib/pos-auth'

export const maxDuration = 30

export async function GET() {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { data, error } = await c.db
    .from('pos_charges')
    .select('id, reservation_id, guest_name, room, items, total, currency, status, staff_email, error, created_at, voided_at, voided_lines')
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
  // Prices always come from the menu, never from the iPad.
  const ids = [...new Set(b.lines.map((l) => l.itemId))]
  const { data: menu } = await c.db.from('pos_items').select('id, name, category, price').eq('tenant_id', c.tenantId).eq('active', true).in('id', ids)
  const byId = new Map((menu ?? []).map((m) => [m.id as string, m]))
  const lines: PosLine[] = []
  for (const l of b.lines) {
    const item = byId.get(l.itemId)
    const qty = Math.floor(Number(l.quantity))
    if (!item || !(qty >= 1 && qty <= 50)) return NextResponse.json({ error: 'An item in the order is no longer on the menu.' }, { status: 400 })
    lines.push({ itemId: item.id as string, name: item.name as string, category: item.category as string, price: Number(item.price), quantity: qty })
  }
  return createCharge(c, { reservationId: b.reservationId, guestName: b.guestName, room: b.room, requestId: b.requestId, lines })
}
