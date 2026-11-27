import { NextResponse } from 'next/server'
import { posCaller } from '@/lib/pos-auth'

const clean = (b: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  if (typeof b.name === 'string') out.name = b.name.trim().slice(0, 80)
  if (typeof b.category === 'string') out.category = b.category.trim().slice(0, 40) || 'Drinks'
  if (b.price !== undefined) out.price = Math.max(0, Math.round(Number(b.price) * 100) / 100) || 0
  if (typeof b.active === 'boolean') out.active = b.active
  if (b.sort !== undefined) out.sort = Number(b.sort) || 0
  return out
}

export async function GET() {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { data, error } = await c.db.from('pos_items').select('id, name, category, price, active, sort').eq('tenant_id', c.tenantId).order('category').order('sort').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const body = clean(await req.json().catch(() => ({})))
  if (!body.name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const { data, error } = await c.db.from('pos_items').insert({ ...body, tenant_id: c.tenantId }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

export async function PATCH(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const raw = await req.json().catch(() => ({}))
  if (!raw.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await c.db.from('pos_items').update(clean(raw)).eq('id', raw.id).eq('tenant_id', c.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await c.db.from('pos_items').delete().eq('id', id).eq('tenant_id', c.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
