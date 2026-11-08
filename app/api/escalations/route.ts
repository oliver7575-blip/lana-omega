import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, count, error } = await supabase
    .from('escalations')
    .select('id, conversation_id, category, urgency, summary, room, delivered, status, created_at, handled_at, handled_by, staff_reply, replied_at, replied_by, guest_informed', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ escalations: data ?? [], total: count ?? 0 })
}

/**
 * Update escalations:
 *  - { ids, status: 'read' | 'new' } marks them read or unread
 *  - { ids, handled: true | false } marks them handled (also read) or moves them back to "to handle"
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { ids?: string[]; status?: string; handled?: boolean }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids are required' }, { status: 400 })
  }
  const ids = body.ids.slice(0, 300)

  if (typeof body.handled === 'boolean') {
    const patch = body.handled
      ? { handled_at: new Date().toISOString(), handled_by: user.email ?? 'staff', status: 'read' }
      : { handled_at: null, handled_by: null }
    const { error } = await supabase.from('escalations').update(patch).in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!['read', 'new'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'status or handled is required' }, { status: 400 })
  }
  const { error } = await supabase.from('escalations').update({ status: body.status }).in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
