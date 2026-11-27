import { NextResponse } from 'next/server'
import { posCaller } from '@/lib/pos-auth'
import { getTables, saveTables } from '@/lib/pos-tables'

const MAX_TABLES = 40
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 30) : '')

export async function GET() {
  const c = await posCaller()
  if ('error' in c) return c.error
  return NextResponse.json({ tables: await getTables(c.db, c.tenantId) })
}

/** { name } adds a table (e.g. "Pool 1"); { slot, name } renames one. */
export async function POST(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const b = (await req.json().catch(() => ({}))) as { slot?: number; name?: string; x?: number; y?: number }
  const name = cleanName(b.name)
  const tables = await getTables(c.db, c.tenantId)
  let next: typeof tables
  if (b.slot) {
    if (!tables.some((t) => t.slot === b.slot)) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    const moved = typeof b.x === 'number' && typeof b.y === 'number'
    if (!name && !moved) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
    const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
    next = tables.map((t) => (t.slot === b.slot ? { ...t, ...(name ? { name } : {}), ...(moved ? { x: clamp(b.x!), y: clamp(b.y!) } : {}) } : t))
  } else {
    if (!name) return NextResponse.json({ error: 'Give the table a name.' }, { status: 400 })
    if (tables.length >= MAX_TABLES) return NextResponse.json({ error: `Up to ${MAX_TABLES} tables.` }, { status: 400 })
    if (tables.some((t) => t.name.toLowerCase() === name.toLowerCase())) return NextResponse.json({ error: 'A table with that name already exists.' }, { status: 400 })
    const slot = Math.max(0, ...tables.map((t) => t.slot)) + 1
    if (slot > 99) return NextResponse.json({ error: 'No more table numbers available.' }, { status: 400 })
    next = [...tables, { slot, name }]
  }
  const err = await saveTables(c.db, c.tenantId, next)
  if (err) return NextResponse.json({ error: err }, { status: 500 })
  return NextResponse.json({ tables: next })
}

/** Removes a table, only while it has no open tab. */
export async function DELETE(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const slot = Number(new URL(req.url).searchParams.get('slot'))
  const tables = await getTables(c.db, c.tenantId)
  if (!tables.some((t) => t.slot === slot)) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  const { data: open } = await c.db.from('pos_tabs').select('id').eq('tenant_id', c.tenantId).eq('kind', 'table').eq('slot', slot).eq('status', 'open').maybeSingle()
  if (open) return NextResponse.json({ error: 'This table has an open tab. Move it to a room, mark it paid or clear it first.' }, { status: 409 })
  const next = tables.filter((t) => t.slot !== slot)
  const err = await saveTables(c.db, c.tenantId, next)
  if (err) return NextResponse.json({ error: err }, { status: 500 })
  return NextResponse.json({ tables: next })
}
