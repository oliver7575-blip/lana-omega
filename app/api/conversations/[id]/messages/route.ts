import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** The latest messages of a conversation, oldest first — for the pop-up message history on the reservation window. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: conv } = await supabase.from('conversations').select('status, channel').eq('id', id).maybeSingle()
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_type, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: (data ?? []).reverse(), status: (conv?.status as string) ?? 'active', channel: (conv?.channel as string) ?? 'whatsapp' })
}
