import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateReply } from '@/lib/anthropic'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'

interface InboundPayload {
  phoneNumberId: string
  from: string
  text: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<InboundPayload>
  const { phoneNumberId, from, text } = body

  if (!phoneNumberId || !from || !text) {
    return NextResponse.json(
      { error: 'phoneNumberId, from, and text are required' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { data: integration, error: integrationError } = await supabase
    .from('tenant_integrations')
    .select('tenant_id, status, credentials')
    .eq('integration_type', 'whatsapp')
    .eq('config->>phone_number_id', phoneNumberId)
    .maybeSingle()

  if (integrationError) {
    return NextResponse.json({ error: integrationError.message }, { status: 500 })
  }
  if (!integration) {
    return NextResponse.json(
      { error: 'No tenant found for this phone_number_id' },
      { status: 404 }
    )
  }
  if (integration.status !== 'connected') {
    return NextResponse.json(
      { error: "This tenant's WhatsApp integration is not currently connected" },
      { status: 409 }
    )
  }

  const tenantId = integration.tenant_id

  const { data: tenant } = await supabase
    .from('tenants')
    .select('ai_persona_prompt')
    .eq('id', tenantId)
    .single()

  const { data: guest, error: guestError } = await supabase
    .from('guests')
    .upsert({ tenant_id: tenantId, phone: from }, { onConflict: 'tenant_id,phone' })
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
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guest.id)
    .eq('channel', 'whatsapp')
    .neq('status', 'closed')
    .maybeSingle()

  let conversationId = existingConversation?.id

  if (!conversationId) {
    const { data: newConversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        guest_id: guest.id,
        channel: 'whatsapp',
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
      content: text,
    })
    .select()
    .single()

  if (messageError || !guestMessage) {
    return NextResponse.json(
      { error: `Failed to log message: ${messageError?.message}` },
      { status: 500 }
    )
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
    tenant?.ai_persona_prompt ??
    'You are a helpful, warm hotel concierge assistant. Answer guest questions clearly and concisely.'

  let replyText: string
  try {
    replyText = await generateReply(systemPrompt, claudeMessages)
  } catch (err) {
    return NextResponse.json({
      tenantId,
      guestId: guest.id,
      conversationId,
      messageId: guestMessage.id,
      aiError: err instanceof Error ? err.message : 'AI generation failed',
    })
  }

  const { data: aiMessage } = await supabase
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'lana',
      content: replyText,
    })
    .select()
    .single()

  const sendResult = await sendWhatsAppMessage(
    phoneNumberId,
    integration.credentials,
    from,
    replyText
  )

  return NextResponse.json({
    tenantId,
    guestId: guest.id,
    conversationId,
    messageId: guestMessage.id,
    aiReplyMessageId: aiMessage?.id ?? null,
    aiReplyText: replyText,
    whatsappSendResult: sendResult,
  })
}
