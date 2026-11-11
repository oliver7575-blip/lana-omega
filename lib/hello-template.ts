import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMappedTemplate } from './message-templates'

/** The approved "hello" templates: first name in {{1}}, one reason sentence in {{2}}. Used for staff messages outside WhatsApp's 24-hour window. */
export const HELLO_TEMPLATES = {
  es: { name: 'soiree_contacto_template', language: 'es_MX', render: (n: string, r: string) => `Hola ${n}, te saludamos desde Soirée, en Zipolite! 🌴\n\n${r}\n\nEste es nuestro contacto directo por WhatsApp: escríbenos por aquí cuando lo necesites.` },
  en: { name: 'soiree_contacto_template_en', language: 'en', render: (n: string, r: string) => `Hi ${n}, this is Soirée in Zipolite! 🌴\n\n${r}\n\nThis is our direct WhatsApp contact: feel free to message us here whenever you need.` },
} as const

export type HelloLang = keyof typeof HELLO_TEMPLATES

/** Loads the connected WhatsApp integration of a tenant (number id + credentials). */
export async function loadWhatsApp(db: SupabaseClient, tenantId: string) {
  const { data: integration } = await db
    .from('tenant_integrations')
    .select('credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .eq('status', 'connected')
    .maybeSingle()
  const phoneNumberId = (integration?.config as { phone_number_id?: string } | null)?.phone_number_id
  if (!integration?.credentials || !phoneNumberId) return null
  return { credentials: integration.credentials, phoneNumberId }
}

/** Whether WhatsApp still allows free text: the guest wrote within the last 24 hours. */
export async function whatsappWindowOpen(db: SupabaseClient, conversationId: string): Promise<{ open: boolean; lastGuestText: string | null }> {
  const { data: last } = await db
    .from('messages')
    .select('content, created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'guest')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastAt = last?.created_at ? new Date(last.created_at as string).getTime() : 0
  return { open: Date.now() - lastAt < 24 * 3600_000, lastGuestText: (last?.content as string | undefined) ?? null }
}

/** Sends the hello template and records it in the conversation. */
export async function sendHelloTemplate(
  db: SupabaseClient,
  p: { tenantId: string; conversationId: string; phone: string; firstName: string; reason: string; lang: HelloLang }
): Promise<{ success: boolean; error?: string; text?: string }> {
  const wa = await loadWhatsApp(db, p.tenantId)
  if (!wa) return { success: false, error: 'WhatsApp integration not fully configured' }
  const t = HELLO_TEMPLATES[p.lang]
  const reason = p.reason.replace(/[\n\t]+/g, ' ').trim()
  const res = await sendMappedTemplate(
    wa.phoneNumberId,
    wa.credentials,
    p.phone,
    { name: t.name, language: t.language, header: [], body: ['first_name', 'reason'] },
    { first_name: p.firstName, reason }
  )
  if (!res.success) {
    const notApproved = /132001|does not exist|not approved/i.test(res.error ?? '')
    return { success: false, error: notApproved ? `The WhatsApp template "${t.name}" isn't approved yet in Meta, so it can't be sent.` : res.error ?? 'Could not send' }
  }
  const text = t.render(p.firstName, reason)
  await db.from('messages').insert({ tenant_id: p.tenantId, conversation_id: p.conversationId, sender_type: 'staff', content: text })
  await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', p.conversationId)
  return { success: true, text }
}
