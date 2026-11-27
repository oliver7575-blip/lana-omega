import { NextResponse } from 'next/server'
import { posCaller } from '@/lib/pos-auth'

export interface TabItem { itemId: string; name: string; category: string; price: number; quantity: number }

export async function GET() {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { data, error } = await c.db
    .from('pos_tabs')
    .select('id, kind, slot, items, reservation_id, guest_name, room_label, opened_at')
    .eq('tenant_id', c.tenantId)
    .eq('status', 'open')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tabs: data ?? [] })
}

/** Adds (+1) or removes (−1) one item on the open tab of a table or room; the tab is opened on the first item. */
export async function POST(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const b = (await req.json().catch(() => ({}))) as { kind?: string; slot?: number; itemId?: string; delta?: number }
  const slot = Number(b.slot)
  const delta = b.delta === -1 ? -1 : 1
  if ((b.kind !== 'table' && b.kind !== 'room') || !(slot >= 1 && slot <= 8) || !b.itemId) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const { data: tab } = await c.db.from('pos_tabs').select('id, items').eq('tenant_id', c.tenantId).eq('kind', b.kind).eq('slot', slot).eq('status', 'open').maybeSingle()
  const items: TabItem[] = ((tab?.items as TabItem[] | undefined) ?? []).map((i) => ({ ...i }))
  const existing = items.find((i) => i.itemId === b.itemId)

  if (existing) {
    existing.quantity += delta
  } else {
    if (delta < 0) return NextResponse.json({ ok: true })
    const { data: m } = await c.db.from('pos_items').select('id, name, category, price').eq('id', b.itemId).eq('tenant_id', c.tenantId).eq('active', true).maybeSingle()
    if (!m) return NextResponse.json({ error: 'That item is no longer on the menu.' }, { status: 400 })
    items.push({ itemId: m.id as string, name: m.name as string, category: m.category as string, price: Number(m.price), quantity: 1 })
  }
  const next = items.filter((i) => i.quantity > 0 && i.quantity <= 99)

  if (tab) {
    if (next.length === 0) await c.db.from('pos_tabs').delete().eq('id', tab.id)
    else await c.db.from('pos_tabs').update({ items: next }).eq('id', tab.id)
  } else if (next.length) {
    const { error } = await c.db.from('pos_tabs').insert({ tenant_id: c.tenantId, kind: b.kind, slot, items: next })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
