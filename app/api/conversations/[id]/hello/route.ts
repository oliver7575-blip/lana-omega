import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendMappedTemplate } from '@/lib/message-templates'

/** Staff "hello" to a guest outside WhatsApp's 24-hour window: the approved soiree_hello template with the guest's first name and one reason sentence. */
const TEMPLATES = {
  es: { name: 'soiree_hola_template', language: 'es_MX', render: (n: string, r: string) => `Hola ${n}, te saludamos desde Soirée, en Zipolite! 🌴\n\n${r}\n\nEste es nuestro contacto directo por WhatsApp: escríbenos por aquí cuando lo necesites.` },
  en: { name: 'soiree_hola_template_en', language: 'en', render: (n: string, r: string) => `Hi ${n}, this is Soirée in Zipolite! 🌴\n\n${r}\n\nThis is our direct WhatsApp contact: feel free to message us here whenever you need.` },
} as const

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { reason?: string; language?: string; firstName?: string }
  const reason = (body.reason ?? '').replace(/[\n\t]+/g, ' ').trim()
  const lang: 'es' | 'en' = body.language === 'es' ? 'es' : 'en'
  if (!reason) return NextResponse.json({ error: 'Write the reason for contacting the guest.' }, { status: 400 })

  const { data: conversation } = await supabase.from('conversations').select('id, tenant_id, channel, guest_id').eq('id', id).single()
  if (!conversation || conversation.channel !== 'whatsapp') return NextResponse.json({ error: 'WhatsApp conversation not found' }, { status: 404 })

  const { data: guest } = await supabase.from('guests').select('phone, name').eq('id', conversation.guest_id).single()
  const { data: integration } = await supabase
    .from('tenant_integrations')
    .select('credentials, config')
    .eq('tenant_id', conversation.tenant_id)
    .eq('integration_type', 'whatsapp')
    .eq('status', 'connected')
    .maybeSingle()
  const phoneNumberId = (integration?.config as { phone_number_id?: string } | null)?.phone_number_id
  if (!guest?.phone || !integration?.credentials || !phoneNumberId) {
    return NextResponse.json({ error: 'WhatsApp integration not fully configured' }, { status: 400 })
  }

  const t = TEMPLATES[lang]
  const firstName = (body.firstName || guest.name || '').toString().trim().split(/\s+/)[0] || (lang === 'es' ? 'hola' : 'there')
  const res = await sendMappedTemplate(
    phoneNumberId,
    integration.credentials,
    guest.phone as string,
    { name: t.name, language: t.language, header: [], body: ['first_name', 'reason'] },
    { first_name: firstName, reason }
  )
  if (!res.success) {
    const notApproved = /132001|does not exist|not approved/i.test(res.error ?? '')
    return NextResponse.json(
      { error: notApproved ? `The WhatsApp template "${t.name}" isn't approved yet in Meta, so it can't be sent.` : res.error ?? 'Could not send' },
      { status: 502 }
    )
  }

  const text = t.render(firstName, reason)
  await supabase.from('messages').insert({ tenant_id: conversation.tenant_id, conversation_id: id, sender_type: 'staff', content: text })
  await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ ok: true, text })
}
