import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateReply } from '@/lib/anthropic'
import { decryptCredentials } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'

const RATE_LIMIT_WINDOW_MINUTES = 10
const RATE_LIMIT_MAX_MESSAGES = 15

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const visitorId = searchParams.get('visitorId')

  if (!visitorId) {
    return NextResponse.json({ error: 'visitorId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: tenant } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
  if (!tenant) {
    return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })
  }

  const syntheticPhone = `web:${visitorId}`

  const { data: guest } = await supabase
    .from('guests')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('phone', syntheticPhone)
    .maybeSingle()

  if (!guest) {
    return NextResponse.json({ conversationId: null, messages: [] })
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('guest_id', guest.id)
    .eq('channel', 'widget')
    .neq('status', 'closed')
    .maybeSingle()

  if (!conversation) {
    return NextResponse.json({ conversationId: null, messages: [] })
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('sender_type, content, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ conversationId: conversation.id, messages: messages ?? [] })
}

interface WidgetChatRequest {
  visitorId: string
  message: string
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = (await request.json()) as Partial<WidgetChatRequest>
  const { visitorId, message } = body

  if (!visitorId || !message) {
    return NextResponse.json({ error: 'visitorId and message are required' }, { status: 400 })
  }

  if (message.length > 2000) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, ai_persona_prompt, status')
    .eq('slug', slug)
    .maybeSingle()

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })
  }

  const tenantId = tenant.id
  const syntheticPhone = `web:${visitorId}`

  // Rate limit BEFORE creating anything or calling the AI — this is a fully
  // public, unauthenticated endpoint that triggers a real paid Anthropic API
  // call per message, so it needs abuse protection independent of everything
  // else. Counts this visitor's own guest messages across ALL their widget
  // conversations for this tenant in the trailing window, via a join rather
  // than trusting a single conversation ID (which the caller could omit or
  // spoof around otherwise).
  const { data: existingGuestForLimit } = await supabase
    .from('guests')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', syntheticPhone)
    .maybeSingle()

  if (existingGuestForLimit) {
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
    ).toISOString()

    const { data: recentConversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('guest_id', existingGuestForLimit.id)
      .eq('channel', 'widget')

    const conversationIds = (recentConversations ?? []).map((c) => c.id)

    if (conversationIds.length > 0) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', conversationIds)
        .eq('sender_type', 'guest')
        .gte('created_at', windowStart)

      if ((count ?? 0) >= RATE_LIMIT_MAX_MESSAGES) {
        return NextResponse.json(
          { error: "You're sending messages too quickly — please wait a few minutes and try again." },
          { status: 429 }
        )
      }
    }
  }

  const { data: cloudbedsIntegration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()

  const reservationTool =
    cloudbedsIntegration?.status === 'connected'
      ? {
          lookupReservation: async (confirmationNumber: string) => {
            const { api_key } = decryptCredentials<{ api_key: string }>(
              cloudbedsIntegration.credentials
            )
            const propertyId = (cloudbedsIntegration.config as { property_id?: string })
              ?.property_id
            if (!propertyId) {
              return { found: false, error: 'No property_id configured for this tenant' }
            }
            return lookupReservation(api_key, propertyId, confirmationNumber)
          },
        }
      : undefined

  const { data: guest, error: guestError } = await supabase
    .from('guests')
    .upsert({ tenant_id: tenantId, phone: syntheticPhone }, { onConflict: 'tenant_id,phone' })
    .select()
    .single()

  if (guestError || !guest) {
    return NextResponse.json(
      { error: `Failed to upsert guest: ${guestError?.message}` },
      { status: 500 }
    )
  }

  const { data: existingConversation } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guest.id)
    .eq('channel', 'widget')
    .neq('status', 'closed')
    .maybeSingle()

  let conversationId = existingConversation?.id
  let conversationStatus = existingConversation?.status

  if (!conversationId) {
    const { data: newConversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        guest_id: guest.id,
        channel: 'widget',
        status: 'active',
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (conversationError || !newConversation) {
      return NextResponse.json(
        { error: `Failed to create conversation: ${conversationError?.message}` },
        { status: 500 }
      )
    }
    conversationId = newConversation.id
    conversationStatus = newConversation.status
  } else {
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
  }

  const { data: guestMessage, error: messageError } = await supabase
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'guest',
      content: message,
    })
    .select()
    .single()

  if (messageError || !guestMessage) {
    return NextResponse.json(
      { error: `Failed to log message: ${messageError?.message}` },
      { status: 500 }
    )
  }

  if (conversationStatus === 'human_takeover') {
    return NextResponse.json({
      conversationId,
      reply: "A member of our team is handling your conversation directly and will reply shortly.",
      humanTakeover: true,
    })
  }

  const { data: history } = await supabase
    .from('messages')
    .select('sender_type, content')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['guest', 'lana'])
    .order('created_at', { ascending: true })

  const claudeMessages = (history ?? []).map((m) => ({
    role: m.sender_type === 'guest' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))

  const systemPrompt =
    tenant.ai_persona_prompt ??
    'You are a helpful, warm hotel concierge assistant. Answer guest questions clearly and concisely.'

  let replyText: string
  try {
    replyText = await generateReply(systemPrompt, claudeMessages, reservationTool)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 500 }
    )
  }

  await supabase.from('messages').insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    sender_type: 'lana',
    content: replyText,
  })

  return NextResponse.json({ conversationId, reply: replyText })
}
