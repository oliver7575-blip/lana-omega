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
    .select('id, conversation_id, category, urgency, summary, room, delivered, status, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ escalations: data ?? [], total: count ?? 0 })
}

/** Mark escalations read or unread: { ids: string[], status: 'read' | 'new' } */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { ids?: string[]; status?: string }
  if (!Array.isArray(body.ids) || body.ids.length === 0 || !['read', 'new'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'ids and status are required' }, { status: 400 })
  }
  const { error } = await supabase.from('escalations').update({ status: body.status }).in('id', body.ids.slice(0, 300))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
