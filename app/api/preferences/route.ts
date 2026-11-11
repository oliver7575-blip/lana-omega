import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Per-user view preferences, kept on the staff member's own record so they follow them across browsers.
const KEYS = new Set(['calendar_room_type_order'])

async function me() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: staff } = await supabase.from('staff_users').select('id, preferences').eq('auth_uid', user.id).single()
  if (!staff) return { error: NextResponse.json({ error: 'No staff record found' }, { status: 404 }) }
  return { supabase, id: staff.id as string, preferences: (staff.preferences ?? {}) as Record<string, unknown> }
}

export async function GET() {
  const c = await me()
  if ('error' in c) return c.error
  return NextResponse.json({ preferences: c.preferences })
}

export async function PUT(request: Request) {
  const c = await me()
  if ('error' in c) return c.error
  const { key, value } = (await request.json().catch(() => ({}))) as { key?: string; value?: unknown }
  if (!key || !KEYS.has(key)) return NextResponse.json({ error: 'Unknown preference' }, { status: 400 })
  if (key === 'calendar_room_type_order' && !(Array.isArray(value) && value.length <= 100 && value.every((v) => typeof v === 'string' && v.length < 64))) {
    return NextResponse.json({ error: 'Invalid value' }, { status: 400 })
  }
  const { error } = await c.supabase.from('staff_users').update({ preferences: { ...c.preferences, [key]: value } }).eq('id', c.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
