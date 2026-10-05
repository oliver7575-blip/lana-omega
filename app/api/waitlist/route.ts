import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: entries, error } = await supabase
    .from('waitlist_entries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ entries: entries ?? [] })
}

/** Deletes one waitlist entry (staff only; the database limits it to this hotel's entries). */
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Unknown entry' }, { status: 400 })
  }

  const { data, error } = await supabase.from('waitlist_entries').delete().eq('id', id).select('id')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data?.length) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
