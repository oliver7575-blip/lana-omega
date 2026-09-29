import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateReply } from '@/lib/anthropic'
import { buildKnowledgeBaseSection, KNOWLEDGE_BASE_MAX_CHARS } from '@/lib/knowledge-base'

export const maxDuration = 30

interface PlaygroundMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Same bar as editing the persona itself: owner or admin only. Every call
  // here is a real paid AI request, so it is not open to every staff role.
  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('role')
    .eq('auth_uid', user.id)
    .single()

  if (!staffRow || !['owner', 'admin'].includes(staffRow.role)) {
    return NextResponse.json(
      { error: 'Only owners or admins can test the concierge' },
      { status: 403 }
    )
  }

  const body = (await request.json()) as {
    prompt?: string
    knowledgeBase?: string
    messages?: PlaygroundMessage[]
  }
  const { prompt, knowledgeBase, messages } = body

  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) {
    return NextResponse.json(
      { error: 'The persona text must be between 1 and 20,000 characters' },
      { status: 400 }
    )
  }

  if (knowledgeBase !== undefined && (typeof knowledgeBase !== 'string' || knowledgeBase.length > KNOWLEDGE_BASE_MAX_CHARS)) {
    return NextResponse.json(
      { error: `The knowledge base must be under ${KNOWLEDGE_BASE_MAX_CHARS.toLocaleString('en-US')} characters` },
      { status: 400 }
    )
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages are required' }, { status: 400 })
  }
  if (messages.length > 20) {
    return NextResponse.json(
      { error: 'This test chat is getting long. Use Reset to start a new one.' },
      { status: 400 }
    )
  }

  const valid = messages.every(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0 &&
      m.content.length <= 2000
  )
  if (!valid || messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json(
      { error: 'Messages must start and end with a guest message, each under 2,000 characters' },
      { status: 400 }
    )
  }

  try {
    // No tools are passed on purpose: this tests persona and policies
    // only, and nothing here touches guests, conversations or messages,
    // so no real data is written.
    const result = await generateReply(prompt + buildKnowledgeBaseSection(knowledgeBase), messages)
    return NextResponse.json({ reply: result.text })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 500 }
    )
  }
}
