import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateReply } from '@/lib/anthropic'
import { decryptCredentials } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'

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

  // Widget visitors have no phone number — reuse the guests table's phone
  // column (a plain text field, not actually validated as a real phone
  // number anywhere) with a synthetic "web:<visitorId>" identifier instead.
  // This keeps guests/conversations/messages generic across every channel,
  // as the schema was already designed for (conversations.channel already
  // allows 'widget' as a valid value).
  const syntheticPhone = `web:${visitorId}`

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
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guest.id)
    .eq('channel', 'widget')
    .neq('status', 'closed')
    .maybeSingle()

  let conversationId = existingConversation?.id

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
