import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from './supabase/service'
import { loadEngineContext } from './maintenance-engine'
import { notifyStaff } from './escalation'
import { findEscalationContact, parseEscalationContacts, type EscalationContact } from './escalation-contacts'
import { zonedParts } from './tz'

// ---------------------------------------------------------------------------
// Settings (defaults chosen with the hotel)
// ---------------------------------------------------------------------------

/** A guest waiting on staff this long gets one alert to the team. */
export const WAITING_ALERT_HOURS = 2
/** The inbox badge turns red after this long. */
export const WAITING_URGENT_HOURS = 24
/** Staff alerts are only sent between these local hours. */
const ALERT_FROM_HOUR = 8
const ALERT_TO_HOUR = 22
/** Lana's AI outage alert is sent at most this often. */
const OUTAGE_ALERT_COOLDOWN_MIN = 60

// ---------------------------------------------------------------------------
// Guest fallback message, in the guest's language
// ---------------------------------------------------------------------------

export type Lang = 'es' | 'en' | 'sv'

export function detectLang(text: string): Lang {
  const t = ` ${text.toLowerCase()} `
  const count = (re: RegExp) => (t.match(re) ?? []).length
  const es = count(/ (hola|gracias|buenas?|quiero|tienen|disponible|para|favor|habitaci[oó]n|cu[aá]nto|noche|d[ií]as?|reserva|con|una?|los|las|del|que|por|est[aá]|puedo|saber|ma[nñ]ana|d[oó]nde) /g) + count(/[¿¡ñ]/g) * 2
  const sv = count(/ (hej|tack|jag|vi|och|inte|har|finns|ni|rum|natt|boka|vill|kan|f[oö]r|med|det|en|ett|mycket) /g) + count(/[åäö]/g)
  const en = count(/ (hi|hello|thanks|thank|please|we|you|the|and|room|night|nights|book|booking|available|do|have|is|are|for|with|can|would|like) /g)
  if (es >= 2 && es >= en && es >= sv) return 'es'
  if (sv >= 2 && sv > en && sv > es) return 'sv'
  return 'en'
}

export const FALLBACK_TEXT: Record<Lang, string> = {
  es: 'Disculpa, tengo un problema para responderte en este momento 🙏 Ya avisé a nuestro equipo y te escribirán en breve.',
  en: "Sorry, I'm having trouble replying right now 🙏 I've let our team know and they'll write to you shortly.",
  sv: 'Förlåt, jag har problem att svara just nu 🙏 Jag har meddelat vårt team och de hör av sig inom kort.',
}

// ---------------------------------------------------------------------------
// Silent exits
// ---------------------------------------------------------------------------

/** Records why Lana did not answer (or clears it with null once she has). */
export async function markSilent(db: SupabaseClient, conversationId: string, reason: string | null) {
  await db.from('conversations').update({ silent_reason: reason }).eq('id', conversationId)
}

// ---------------------------------------------------------------------------
// Bot-to-bot loops
// ---------------------------------------------------------------------------

const BOT_PATTERNS =
  /(do not reply|no-?reply|automated (message|assistant|response|reply)|virtual assistant|chat ?bot|\bi am a bot\b|asistente virtual|mensaje autom[aá]tico|\bpress \d\b|presione \d|marque \d|how can i help you today|en qu[eé] puedo ayudarle)/i

/** True when this chat looks like Lana talking to another automated system. */
export async function looksLikeBotLoop(db: SupabaseClient, conversationId: string): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data } = await db
    .from('messages')
    .select('sender_type, content')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['guest', 'lana'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(40)
  const rows = data ?? []
  const lanaCount = rows.filter((m) => m.sender_type === 'lana').length
  if (lanaCount >= 6) return true
  if (lanaCount < 3) return false
  const guest = rows.filter((m) => m.sender_type === 'guest').map((m) => String(m.content ?? ''))
  if (guest.some((t) => BOT_PATTERNS.test(t))) return true
  const seen = new Map<string, number>()
  for (const t of guest) {
    const k = t.toLowerCase().replace(/\W+/g, ' ').trim()
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen.values()].some((n) => n >= 3)
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

type Whatsapp = { phoneNumberId: string; credentials: Parameters<typeof notifyStaff>[1] }

function pickContact(contacts: EscalationContact[], keys: string[]): EscalationContact | undefined {
  for (const k of keys) {
    const c = findEscalationContact(contacts, k)
    if (c) return c
  }
  return contacts[0]
}

async function tenantContacts(db: SupabaseClient, tenantId: string) {
  const { data } = await db.from('tenants').select('escalation_contacts, message_templates').eq('id', tenantId).single()
  return { contacts: parseEscalationContacts(data?.escalation_contacts), templates: data?.message_templates }
}

/** Why the AI call failed, in words the team can act on. */
export function describeAiError(message: string): string {
  if (/credit balance|billing|insufficient/i.test(message)) return 'se agotó el saldo de crédito de Anthropic. Recarga aquí: https://platform.claude.com/settings/billing'
  if (/\b429\b|rate.?limit|overloaded|\b529\b/i.test(message)) return 'la IA está saturada o limitada por el momento (se reintentará sola).'
  if (/\b401\b|\b403\b|api key|authentication/i.test(message)) return 'la clave de la IA fue rechazada. Revisa ANTHROPIC_API_KEY en Vercel.'
  return `error de la IA (${message.replace(/\s+/g, ' ').slice(0, 120)}).`
}

/**
 * One alert per outage (not per guest) telling the team Lana cannot answer.
 * Returns true when an alert was sent.
 */
export async function alertAiOutage(
  db: SupabaseClient,
  tenantId: string,
  wa: Whatsapp,
  errorMessage: string,
  guestName: string | null
): Promise<boolean> {
  const { data: t } = await db.from('tenants').select('ai_outage_alerted_at').eq('id', tenantId).single()
  const last = t?.ai_outage_alerted_at ? new Date(t.ai_outage_alerted_at as string).getTime() : 0
  if (Date.now() - last < OUTAGE_ALERT_COOLDOWN_MIN * 60_000) return false

  // Claim the slot first so concurrent failures send a single alert.
  const claim = await db
    .from('tenants')
    .update({ ai_outage_alerted_at: new Date().toISOString() })
    .eq('id', tenantId)
    .eq('ai_outage_alerted_at', (t?.ai_outage_alerted_at as string | null) ?? null)
    .select('id')
  if (!claim.data?.length && last) return false

  const since = new Date(Date.now() - 60 * 60_000).toISOString()
  const { data: affected } = await db
    .from('conversations')
    .select('guests(name)')
    .eq('tenant_id', tenantId)
    .gte('lana_failed_at', since)
  const names = new Set<string>()
  if (guestName) names.add(guestName)
  for (const a of affected ?? []) {
    const g = (a as unknown as { guests?: { name?: string | null } | { name?: string | null }[] }).guests
    const n = Array.isArray(g) ? g[0]?.name : g?.name
    if (n) names.add(n)
  }
  const { contacts, templates } = await tenantContacts(db, tenantId)
  const contact = pickContact(contacts, ['oliver', 'admin', 'maintenance'])
  if (!contact) return false
  const summary =
    `Lana no puede responder: ${describeAiError(errorMessage)}` +
    (names.size ? ` Huéspedes afectados: ${[...names].slice(0, 8).join(', ')}.` : '') +
    ' Cuando se restablezca, Lana contestará los pendientes automáticamente.'
  const res = await notifyStaff(wa.phoneNumberId, wa.credentials, contact.phone, 'Sistema', { category: 'alerta', summary, urgency: 'urgent' }, templates, 'Lana')
  return res.success
}

// ---------------------------------------------------------------------------
// Watchdog (runs every 5 minutes)
// ---------------------------------------------------------------------------

interface WatchdogResult {
  tenantId: string
  retried: number
  alerted: number
}

export async function runLanaWatchdog(origin: string): Promise<WatchdogResult[]> {
  const db = createServiceClient()
  const { data: tenants } = await db.from('tenants').select('id')
  const out: WatchdogResult[] = []
  for (const t of tenants ?? []) {
    try {
      out.push(await watchTenant(db, t.id as string, origin))
    } catch (err) {
      console.error('[lana-watchdog] tenant failed', t.id, err)
    }
  }
  return out
}

async function watchTenant(db: SupabaseClient, tenantId: string, origin: string): Promise<WatchdogResult> {
  const result: WatchdogResult = { tenantId, retried: 0, alerted: 0 }
  const ctx = await loadEngineContext(tenantId, db)
  const now = Date.now()

  const { data: convs } = await db
    .from('conversations')
    .select('id, status, lana_failed_at, waiting_alerted_at, automated_sender, silent_reason, guests(name)')
    .eq('tenant_id', tenantId)
    .eq('channel', 'whatsapp')
    .neq('status', 'closed')
    .gte('last_message_at', new Date(now - 24 * 3600_000).toISOString())
    .limit(200)
  if (!convs?.length) return result

  const { data: msgs } = await db
    .from('messages')
    .select('conversation_id, sender_type, content, created_at')
    .in('conversation_id', convs.map((c) => c.id as string))
    .in('sender_type', ['guest', 'lana', 'staff'])
    .gte('created_at', new Date(now - 48 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(3000)
  const byConv = new Map<string, { sender_type: string; content: string; created_at: string }[]>()
  for (const m of msgs ?? []) {
    const k = m.conversation_id as string
    if (!byConv.has(k)) byConv.set(k, [])
    byConv.get(k)!.push(m as never)
  }

  const p = zonedParts(new Date(), ctx.tz)
  const daytime = p.hour >= ALERT_FROM_HOUR && p.hour < ALERT_TO_HOUR
  const { contacts, templates } = await tenantContacts(db, tenantId)
  const contact = pickContact(contacts, ['reservations', 'front_desk', 'reception'])
  const secret = process.env.CRON_SECRET
  const retryIds: string[] = []

  for (const c of convs) {
    const failedAt = c.lana_failed_at ? new Date(c.lana_failed_at as string).getTime() : 0
    // Ignore the apology Lana sent when her AI failed: the guest is still waiting.
    const list = (byConv.get(c.id as string) ?? []).filter(
      (m) => !(failedAt && m.sender_type === 'lana' && new Date(m.created_at).getTime() >= failedAt - 5000)
    )
    if (!list.length || list[0].sender_type !== 'guest') continue
    let since = new Date(list[0].created_at).getTime()
    for (const m of list) {
      if (m.sender_type !== 'guest') break
      since = new Date(m.created_at).getTime()
    }
    const waitMin = (now - since) / 60_000
    const guestRel = (c as unknown as { guests?: { name?: string | null } | { name?: string | null }[] }).guests
    const guestName = (Array.isArray(guestRel) ? guestRel[0]?.name : guestRel?.name) ?? 'Huésped'

    // 1. Lana's turn: answer what is still waiting.
    const retryable =
      c.status === 'active' &&
      !c.automated_sender &&
      waitMin >= 3 &&
      (c.silent_reason == null || failedAt > 0) &&
      (!failedAt || now - failedAt < 6 * 3600_000)
    if (retryable && retryIds.length < 8 && secret) {
      retryIds.push(c.id as string)
      continue
    }

    // 2. A person's turn: nobody on the team has answered.
    const staffTurn = c.status === 'human_takeover' || (failedAt > 0 && now - failedAt >= 6 * 3600_000)
    const alerted = c.waiting_alerted_at ? new Date(c.waiting_alerted_at as string).getTime() : 0
    if (staffTurn && waitMin >= WAITING_ALERT_HOURS * 60 && waitMin <= 24 * 60 && alerted < since && daytime && contact && ctx.whatsapp && result.alerted < 5) {
      const hours = Math.floor(waitMin / 60)
      const last = String(list[0].content ?? '').replace(/\s+/g, ' ').slice(0, 160)
      const res = await notifyStaff(
        ctx.whatsapp.phoneNumberId,
        ctx.whatsapp.credentials,
        contact.phone,
        'Inbox',
        {
          category: 'huésped esperando',
          summary: `${guestName} lleva ${hours} h sin respuesta del equipo. Último mensaje: “${last}”. Abrir: ${origin}/conversations/${c.id}`,
          urgency: waitMin >= WAITING_URGENT_HOURS * 60 ? 'urgent' : 'normal',
        },
        templates,
        guestName
      )
      if (res.success) {
        await db.from('conversations').update({ waiting_alerted_at: new Date().toISOString() }).eq('id', c.id)
        result.alerted++
      }
    }
  }
  // Retries run side by side so a slow one cannot eat the whole run.
  await Promise.all(
    retryIds.map(async (id) => {
      try {
        await fetch(`${origin}/api/whatsapp/inbound`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ answerConversationId: id }),
          signal: AbortSignal.timeout(40_000),
        })
        result.retried++
      } catch (err) {
        console.error('[lana-watchdog] retry failed', id, err)
      }
    })
  )
  return result
}

