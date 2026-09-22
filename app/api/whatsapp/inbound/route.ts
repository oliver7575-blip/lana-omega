import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateReply } from '@/lib/anthropic'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { verifyMetaSignature } from '@/lib/verify-webhook'
import { decryptCredentials } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'

// Meta calls this once when you register the webhook, to confirm you
// control this endpoint before it starts sending real traffic.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

interface ExtractedMessage {
  phoneNumberId: string
  from: string
  text: string
}

// Meta's real webhook payload is deeply nested and can carry non-message
// events too (delivery receipts, status updates). Our own curl tests use a
// flat shape for convenience. Support both; return null for anything that
// isn't an inbound text message (Meta expects a 200 either way, not an error).
function extractMessage(body: Record<string, unknown>): ExtractedMessage | null {
  if (body.entry) {
    const entry = (body.entry as unknown[])?.[0] as Record<string, unknown> | undefined
    const changes = entry?.changes as unknown[] | undefined
    const value = (changes?.[0] as Record<string, unknown> | undefined)?.value as
      | Record<string, unknown>
      | undefined
    const metadata = value?.metadata as Record<string, unknown> | undefined
    const messages = value?.messages as Record<string, unknown>[] | undefined
    const message = messages?.[0]
    const phoneNumberId = metadata?.phone_number_id as string | undefined

    if (message && phoneNumberId && message.type === 'text') {
      const textObj = message.text as { body?: string } | undefined
      return {
        phoneNumberId,
        from: message.from as string,
        text: textObj?.body ?? '',
      }
    }
    return null
  }

  if (body.phoneNumberId && body.from && body.text) {
    return {
      phoneNumberId: body.phoneNumberId as string,
      from: body.from as string,
      text: body.text as string,
    }
  }

  return null
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const appSecret = process.env.META_APP_SECRET

  if (!appSecret) {
    return NextResponse.json({ error: 'META_APP_SECRET not configured' }, { status: 500 })
  }
  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const parsedBody = JSON.parse(rawBody) as Record<string, unknown>
  const extracted = extractMessage(parsedBody)

  if (!extracted) {
    // Not an inbound text message (could be a status/delivery event, or a
    // non-text message type we don't handle yet). Acknowledge with 200 so
    // Meta doesn't keep retrying.
    return NextResponse.json({ ignored: true })
  }

  const { phoneNumberId, from, text } = extracted

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
    replyText = await generateReply(systemPrompt, claudeMessages, reservationTool)
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
