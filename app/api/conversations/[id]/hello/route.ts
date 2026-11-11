import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendHelloTemplate } from '@/lib/hello-template'

/** Staff "hello" to a guest outside WhatsApp's 24-hour window: the approved template with the guest's first name and one reason sentence. */
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
  if (!guest?.phone) return NextResponse.json({ error: 'WhatsApp integration not fully configured' }, { status: 400 })

  const firstName = (body.firstName || guest.name || '').toString().trim().split(/\s+/)[0] || (lang === 'es' ? 'hola' : 'there')
  const res = await sendHelloTemplate(supabase, { tenantId: conversation.tenant_id as string, conversationId: id, phone: guest.phone as string, firstName, reason, lang })
  if (!res.success) return NextResponse.json({ error: res.error ?? 'Could not send' }, { status: 502 })
  return NextResponse.json({ ok: true, text: res.text })
}
