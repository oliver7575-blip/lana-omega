import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// Meta's actual webhook shape is deeply nested; this handles the common
// single-message case. Meta's request signature (x-hub-signature-256)
// verification is NOT implemented yet — this route is safe to test with
// curl but must NOT be pointed at a real Meta webhook until that's added,
// since anyone who finds this URL could currently inject fake messages.
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

  // Resolve which tenant this WhatsApp number belongs to. This is the
  // core of multi-tenant inbound routing: the phone_number_id in the
  // webhook payload is matched against each tenant's own stored config,
  // never assumed or hardcoded.
  const { data: integration, error: integrationError } = await supabase
    .from('tenant_integrations')
    .select('tenant_id, status')
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
      { error: 'This tenant\'s WhatsApp integration is not currently connected' },
      { status: 409 }
    )
  }

  const tenantId = integration.tenant_id

  // Find or create the guest by phone, scoped to this tenant.
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

  // Find an existing active WhatsApp conversation for this guest, or start one.
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

  const { data: message, error: messageError } = await supabase
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'guest',
      content: text,
    })
    .select()
    .single()

  if (messageError || !message) {
    return NextResponse.json(
      { error: `Failed to log message: ${messageError?.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    tenantId,
    guestId: guest.id,
    conversationId,
    messageId: message.id,
  })
}
