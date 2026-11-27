import { NextResponse } from 'next/server'
import { createCharge } from '@/lib/pos-charge'
import { posCaller } from '@/lib/pos-auth'
import type { TabItem } from '../route'

export const maxDuration = 30

type Action =
  | { action: 'move'; toSlot: number }
  | { action: 'paid' }
  | { action: 'void' }
  | { action: 'charge'; reservationId?: string; guestName?: string; room?: string }

/** What can be done with one open tab: slide a table tab onto a room, mark it paid, void it, or charge a room tab to the guest's bill. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { id } = await params
  const b = (await req.json().catch(() => ({}))) as Action
  const { data: tab } = await c.db.from('pos_tabs').select('*').eq('id', id).eq('tenant_id', c.tenantId).eq('status', 'open').maybeSingle()
  if (!tab) return NextResponse.json({ error: 'This tab is already closed.' }, { status: 404 })
  const items = (tab.items as TabItem[]) ?? []
  const close = (status: string, note?: string) =>
    c.db.from('pos_tabs').update({ status, closed_at: new Date().toISOString(), note: note ?? null }).eq('id', id)

  if (b.action === 'void') {
    await close('void')
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'paid') {
    if (tab.kind !== 'table') return NextResponse.json({ error: 'Room tabs are charged to the room.' }, { status: 400 })
    await close('paid')
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'move') {
    const toSlot = Number(b.toSlot)
    if (tab.kind !== 'table' || !(toSlot >= 1 && toSlot <= 8)) return NextResponse.json({ error: 'Only a table tab can slide onto a room.' }, { status: 400 })
    const { data: room } = await c.db.from('pos_tabs').select('id, items').eq('tenant_id', c.tenantId).eq('kind', 'room').eq('slot', toSlot).eq('status', 'open').maybeSingle()
    const merged: TabItem[] = ((room?.items as TabItem[] | undefined) ?? []).map((i) => ({ ...i }))
    for (const it of items) {
      const hit = merged.find((m) => m.itemId === it.itemId)
      if (hit) hit.quantity += it.quantity
      else merged.push({ ...it })
    }
    if (room) {
      const { error } = await c.db.from('pos_tabs').update({ items: merged }).eq('id', room.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await c.db.from('pos_tabs').insert({ tenant_id: c.tenantId, kind: 'room', slot: toSlot, items: merged })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    await close('moved', `Moved to room ${toSlot}`)
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'charge') {
    if (tab.kind !== 'room') return NextResponse.json({ error: 'Slide a table tab onto a room first.' }, { status: 400 })
    if (!b.reservationId) return NextResponse.json({ error: 'Choose which guest this room belongs to.' }, { status: 400 })
    if (!items.length) return NextResponse.json({ error: 'The tab is empty.' }, { status: 400 })
    const resp = await createCharge(c, {
      reservationId: b.reservationId,
      guestName: b.guestName,
      room: b.room ?? `Room ${tab.slot}`,
      requestId: `tab-${id}`,
      lines: items.map((i) => ({ name: i.name, category: i.category, price: i.price, quantity: i.quantity })),
    })
    if (!resp.ok) return resp
    await close('charged')
    return NextResponse.json({ ok: true, ...(await resp.json()) })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
