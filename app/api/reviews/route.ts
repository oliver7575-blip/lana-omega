import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Reviews from email (OTA notifications, guest emails) and from chats. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase
    .from('reviews')
    .select('*, inbound_emails(from_email, from_name, subject, body_text)')
    .order('received_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reviews: data ?? [] })
}

/** Mark a review handled / new, or delete it. */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json()) as { id?: string; status?: string; delete?: boolean }
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: 'Unknown review' }, { status: 400 })
  if (body.delete) {
    const { error } = await supabase.from('reviews').delete().eq('id', body.id)
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
  }
  if (body.status !== 'new' && body.status !== 'done') return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
  const { error } = await supabase.from('reviews').update({ status: body.status }).eq('id', body.id)
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true })
}
