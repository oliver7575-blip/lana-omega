import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Lana's reply (Cloudbeds lookups + AI) can take a while.
export const maxDuration = 60

/**
 * "Hand to Lana and answer": hands the conversation back to Lana and has her
 * answer the newest guest message right away.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS scopes this to the caller's own hotel — a conversation from another
  // hotel simply isn't found.
  const { data: updated, error } = await supabase
    .from('conversations')
    .update({ status: 'active' })
    .eq('id', id)
    .select('id, channel')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  if (updated.channel !== 'whatsapp') {
    return NextResponse.json({ handedBack: true, answered: false, reason: 'Answering right away works for WhatsApp only' })
  }

  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ handedBack: true, answered: false, reason: 'Server is missing CRON_SECRET' })
  }

  try {
    const res = await fetch(`${new URL(request.url).origin}/api/whatsapp/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ answerConversationId: id }),
      signal: AbortSignal.timeout(55000),
    })
    const text = await res.text()
    let outcome: { answered?: boolean; reason?: string } = {}
    try {
      outcome = JSON.parse(text)
    } catch {
      outcome = { answered: false, reason: `Unexpected response (${res.status})` }
    }
    return NextResponse.json({ handedBack: true, answered: Boolean(outcome.answered), reason: outcome.reason })
  } catch (err) {
    return NextResponse.json({
      handedBack: true,
      answered: false,
      reason: err instanceof Error ? err.message : 'Could not reach Lana',
    })
  }
}
