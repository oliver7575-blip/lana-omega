import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** { ids: string[], read: boolean } — marks conversations read/unread for the signed-in staff member. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: staff } = await supabase.from('staff_users').select('id, tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })

  const { ids, read } = (await request.json()) as { ids?: string[]; read?: boolean }
  const list = (ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500)
  if (!list.length || typeof read !== 'boolean') return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  if (read) {
    const now = new Date().toISOString()
    const { error } = await supabase.from('conversation_reads').upsert(
      list.map((id) => ({ conversation_id: id, staff_user_id: staff.id, tenant_id: staff.tenant_id, read_at: now })),
      { onConflict: 'conversation_id,staff_user_id' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase.from('conversation_reads').delete().eq('staff_user_id', staff.id).in('conversation_id', list)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
