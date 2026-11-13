import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppFile } from '@/lib/whatsapp-send'

export const maxDuration = 60

const MAX_BYTES = 4 * 1024 * 1024 // stays under the hosting request-size limit

/** Staff sends a file (photo or document) to the guest on WhatsApp, with an optional caption. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const caption = String(form?.get('caption') ?? '').trim()
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The file is over 4 MB. Send a smaller one.' }, { status: 413 })

  const { data: conversation } = await supabase.from('conversations').select('id, tenant_id, channel, guest_id').eq('id', id).single()
  if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (conversation.channel !== 'whatsapp') return NextResponse.json({ error: 'Files can only be sent on WhatsApp chats' }, { status: 400 })

  // Files, like free text, only go out inside WhatsApp's 24-hour window.
  const { data: last } = await supabase
    .from('messages')
    .select('created_at')
    .eq('conversation_id', id)
    .eq('sender_type', 'guest')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastAt = last?.created_at ? new Date(last.created_at as string).getTime() : 0
  if (Date.now() - lastAt >= 24 * 3600_000) {
    return NextResponse.json({ error: "This guest hasn't written in 24 hours, so WhatsApp only allows the hello message. Files can be sent once they reply." }, { status: 409 })
  }

  const [{ data: guest }, { data: integration }] = await Promise.all([
    supabase.from('guests').select('phone').eq('id', conversation.guest_id).single(),
    supabase.from('tenant_integrations').select('credentials, config').eq('tenant_id', conversation.tenant_id).eq('integration_type', 'whatsapp').eq('status', 'connected').maybeSingle(),
  ])
  const phoneNumberId = (integration?.config as { phone_number_id?: string })?.phone_number_id
  if (!guest?.phone || !integration?.credentials || !phoneNumberId) {
    return NextResponse.json({ error: 'WhatsApp integration not fully configured' }, { status: 500 })
  }

  const deliveryResult = await sendWhatsAppFile(
    phoneNumberId,
    integration.credentials,
    guest.phone,
    { bytes: await file.arrayBuffer(), mime: file.type, filename: file.name || 'file' },
    caption || undefined
  )

  const content = `📎 ${file.name || 'file'}${caption ? `\n${caption}` : ''}`
  const { data: message, error } = await supabase
    .from('messages')
    .insert({ tenant_id: conversation.tenant_id, conversation_id: id, sender_type: 'staff', content })
    .select()
    .single()
  if (error || !message) return NextResponse.json({ error: `Failed to log the message: ${error?.message}`, deliveryResult }, { status: 500 })
  await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', id)

  return NextResponse.json({ message, deliveryResult })
}
