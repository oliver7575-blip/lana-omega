import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as { content?: string }
  const { content } = body

  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id, tenant_id, channel, guest_id')
    .eq('id', id)
    .single()

  if (conversationError || !conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { data: message, error: messageError } = await supabase
    .from('messages')
    .insert({
      tenant_id: conversation.tenant_id,
      conversation_id: id,
      sender_type: 'staff',
      content: content.trim(),
    })
    .select()
    .single()

  if (messageError || !message) {
    return NextResponse.json(
      { error: `Failed to send message: ${messageError?.message}` },
      { status: 500 }
    )
  }

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', id)

  // Actually deliver the reply for channels that need an explicit outbound
  // send. WhatsApp requires this; widget conversations are read by the
  // guest on their next poll of the same page, so no outbound push is
  // needed there (a real-time push is a reasonable future improvement,
  // out of scope for this first version).
  let deliveryResult: { success: boolean; error?: string } | null = null

  if (conversation.channel === 'whatsapp') {
    const { data: guest } = await supabase
      .from('guests')
      .select('phone')
      .eq('id', conversation.guest_id)
      .single()

    const { data: integration } = await supabase
      .from('tenant_integrations')
      .select('credentials, config')
      .eq('tenant_id', conversation.tenant_id)
      .eq('integration_type', 'whatsapp')
      .eq('status', 'connected')
      .maybeSingle()

    const phoneNumberId = (integration?.config as { phone_number_id?: string })?.phone_number_id

    if (guest?.phone && integration?.credentials && phoneNumberId) {
      deliveryResult = await sendWhatsAppMessage(
        phoneNumberId,
        integration.credentials,
        guest.phone,
        content.trim()
      )
    } else {
      deliveryResult = { success: false, error: 'WhatsApp integration not fully configured' }
    }
  }

  return NextResponse.json({ message, deliveryResult })
}
