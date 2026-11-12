import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMappedTemplate } from './message-templates'
import { fetchTemplates } from './maintenance-template'

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
  const cfg = integration?.config as { phone_number_id?: string; waba_id?: string } | null
  const phoneNumberId = cfg?.phone_number_id
  if (!integration?.credentials || !phoneNumberId) return null
  return { credentials: integration.credentials, phoneNumberId, wabaId: cfg?.waba_id }
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
  // Look the template up in Meta: its real language code and status decide whether (and how) it can be sent.
  let language: string = t.language
  let bodyNames: string[] | undefined
  if (wa.wabaId) {
    try {
      const found = (await fetchTemplates(wa.wabaId, wa.credentials, t.name)).filter((x) => x.name === t.name)
      if (found.length === 0) return { success: false, error: `Meta has no template called "${t.name}" on this WhatsApp account.` }
      const approved = found.filter((x) => x.status === 'APPROVED')
      if (approved.length === 0) return { success: false, error: `The WhatsApp template "${t.name}" is ${found.map((x) => `${x.status.toLowerCase()} (${x.language})`).join(', ')} in Meta, so it can't be sent yet.` }
      const pick = approved.find((x) => x.language === t.language) ?? approved[0]
      language = pick.language
      if (pick.parameter_format === 'NAMED') {
        const body = pick.components?.find((c) => c.type === 'BODY')?.text ?? ''
        const names = [...body.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1])
        if (names.length === 2) bodyNames = names
      }
    } catch {
      // Meta lookup failed: fall back to the built-in settings and let the send report any problem.
    }
  }
  const res = await sendMappedTemplate(
    wa.phoneNumberId,
    wa.credentials,
    p.phone,
    { name: t.name, language, header: [], body: ['first_name', 'reason'] },
    { first_name: p.firstName, reason },
    { bodyNames }
  )
  if (!res.success) {
    return { success: false, error: res.error ?? 'Could not send' }
  }
  const text = t.render(p.firstName, reason)
  await db.from('messages').insert({ tenant_id: p.tenantId, conversation_id: p.conversationId, sender_type: 'staff', content: text })
  await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', p.conversationId)
  return { success: true, text }
}
