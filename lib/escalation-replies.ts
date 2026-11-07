import type { SupabaseClient } from '@supabase/supabase-js'
import { CONCIERGE_MODEL } from './anthropic'
import { createServiceClient } from './supabase/service'
import { samePhone } from './phone'
import { parseEscalationContacts } from './escalation-contacts'
import { buildKnowledgeBaseSection } from './knowledge-base'
import { buildLiveNotesSection } from './live-notes'
import { addPermanentFact } from './maintenance-freetext'
import { sendWhatsAppMessage } from './whatsapp-send'
import type { EncryptedPayload } from './crypto'

export interface WhatsAppLine {
  phoneNumberId: string
  credentials: EncryptedPayload
}

interface Interpretation {
  intent: 'answer' | 'unrelated'
  escalation: number | null
  /** What the guest should be told, as plain facts (Lana words it in the guest's language). */
  tellGuest: string | null
  subject: string | null
  fact: string | null
  permanent: boolean
  daysValid: number
  summary: string
  reply: string
}

const SYSTEM = `A hotel's assistant (Lana) escalated guest problems to a team member on WhatsApp. The team member has now written back in free text. Decide what it means and what must happen with it.

Return ONLY a JSON object:
{"intent":"answer|unrelated","escalation":number|null,"tell_guest":string|null,"subject":string|null,"fact":string|null,"permanent":boolean,"days_valid":number,"summary":string,"reply":string}

- answer: the message gives information about one of the escalations or about the hotel itself (a diagnosis, a status, a fix, a decision, a fact about the property).
- unrelated: it is about something else (for example a maintenance task, a greeting, a personal chat) and nothing should be forwarded or stored.
- escalation: the number of the escalation it answers (match by room, guest or topic). If unclear and there is only one recent escalation it is probably that one. null if it answers none.
- tell_guest: the facts the guest should hear, in one or two plain sentences, only what the team member actually said (no promises, no times unless they gave one, no staff names). null if there is nothing the guest needs to be told.
- fact / subject: if the message states something worth remembering about the property (e.g. "Room 1 has no hot water, it was built that way"), fact is one neutral English sentence and subject is what it is about ("Room 1"). permanent is true only for lasting facts about how the property is built or run; a breakdown that will be repaired is not permanent (then days_valid is how many days it likely stays true, 1 to 14). null fact if nothing to remember.
- summary: one short sentence for the escalation log, in English.
- reply: one or two friendly sentences back to the team member, in their language, saying exactly what you did (for example that you told the guest and saved the fact). Do not promise anything else.`

async function interpret(contactKey: string, text: string, list: string): Promise<Interpretation | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CONCIERGE_MODEL,
        max_tokens: 600,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Recent escalations sent to this team member (${contactKey}):\n${list}\n\n<message>\n${text.slice(0, 1500)}\n</message>` }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = (await res.json()) as { content?: { text?: string }[] }
    if (!res.ok) return null
    const raw = (data.content ?? []).map((b) => b.text ?? '').join('')
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    if (j.intent !== 'answer' && j.intent !== 'unrelated') return null
    const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
    return {
      intent: j.intent,
      escalation: Number.isInteger(Number(j.escalation)) && j.escalation !== null ? Number(j.escalation) : null,
      tellGuest: str(j.tell_guest, 500),
      subject: str(j.subject, 80),
      fact: str(j.fact, 300),
      permanent: j.permanent === true,
      daysValid: Math.min(14, Math.max(1, Number(j.days_valid) || 3)),
      summary: str(j.summary, 300) ?? text.slice(0, 200),
      reply: str(j.reply, 400) ?? '',
    }
  } catch (err) {
    console.error('[escalation-replies] interpretation failed', err)
    return null
  }
}

/** Lana writes the next message to the guest, in the guest's language, from what the team said. */
async function composeGuestMessage(
  db: SupabaseClient,
  tenantId: string,
  conversationId: string,
  tellGuest: string,
  tenant: { ai_persona_prompt: string | null; knowledge_base: string | null }
): Promise<string | null> {
  const { data: msgs } = await db
    .from('messages')
    .select('sender_type, content')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['guest', 'lana', 'staff'])
    .order('created_at', { ascending: false })
    .limit(8)
  const history = (msgs ?? []).reverse().map((m) => `${m.sender_type === 'guest' ? 'Guest' : 'Hotel'}: ${String(m.content ?? '').slice(0, 400)}`).join('\n')
  const system =
    (tenant.ai_persona_prompt ?? 'You are a warm, helpful hotel concierge.') +
    buildKnowledgeBaseSection(tenant.knowledge_base) +
    (await buildLiveNotesSection(tenantId)) +
    `\n\nTASK\nOur team has just answered the guest's issue. Write the next WhatsApp message to the guest, in the language the guest has been writing in. Pass on the team's information honestly and warmly in one to three short sentences. Do not mention staff names, do not promise anything the team did not say (no times unless they gave one), and do not repeat apologies already given. Output only the message.`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CONCIERGE_MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: `Conversation so far:\n${history}\n\nWhat the team told us:\n${tellGuest}` }],
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = (await res.json()) as { content?: { text?: string }[] }
    if (!res.ok) return null
    return (data.content ?? []).map((b) => b.text ?? '').join('').trim() || null
  } catch (err) {
    console.error('[escalation-replies] guest message failed', err)
    return null
  }
}

/**
 * A free-text message from someone Lana escalates to (Settings → escalation contacts).
 * Their comment is treated as information: it is saved on the escalation, sent on to
 * the guest when the guest needs to hear it, and kept in Lana's knowledge when it is a
 * fact about the hotel. Returns handled=false when it is about something else.
 */
export async function processEscalationReply(
  tenantId: string,
  fromPhone: string,
  text: string,
  wa: WhatsAppLine,
  db: SupabaseClient = createServiceClient()
): Promise<{ handled: boolean }> {
  const { data: tenant } = await db
    .from('tenants')
    .select('escalation_contacts, ai_persona_prompt, knowledge_base')
    .eq('id', tenantId)
    .single()
  const contact = parseEscalationContacts(tenant?.escalation_contacts).find((c) => samePhone(c.phone, fromPhone))
  if (!contact || !tenant) return { handled: false }

  const { data: escs } = await db
    .from('escalations')
    .select('id, conversation_id, guest_id, room, summary, created_at, staff_reply')
    .eq('tenant_id', tenantId)
    .eq('category', contact.key)
    .gte('created_at', new Date(Date.now() - 48 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(6)
  if (!escs?.length) return { handled: false }

  const convIds = escs.map((e) => e.conversation_id).filter(Boolean) as string[]
  const { data: convs } = convIds.length
    ? await db.from('conversations').select('id, channel, status, notes, guests(name, phone)').in('id', convIds)
    : { data: [] }
  type Conv = { id: string; channel: string; status: string; notes: string | null; guests: { name: string | null; phone: string } | { name: string | null; phone: string }[] | null }
  const convById = new Map(((convs ?? []) as unknown as Conv[]).map((c) => [c.id, c]))
  const guestOf = (c?: Conv) => (Array.isArray(c?.guests) ? c?.guests[0] : c?.guests) ?? null

  const list = escs
    .map((e, i) => {
      const g = guestOf(convById.get(e.conversation_id as string))
      return `${i + 1}. ${e.room ? `Room ${e.room}` : 'no room'}${g?.name ? ` · guest ${g.name}` : ''} · ${String(e.created_at).slice(0, 16)} UTC · ${String(e.summary).slice(0, 220)}${e.staff_reply ? ' [already answered]' : ''}`
    })
    .join('\n')

  const r = await interpret(contact.key, text, list)
  if (!r || r.intent === 'unrelated') return { handled: false }

  const esc = r.escalation ? escs[r.escalation - 1] : escs.length === 1 ? escs[0] : null
  const conv = esc?.conversation_id ? convById.get(esc.conversation_id as string) : undefined
  const guest = guestOf(conv)
  const who = contact.description ? contact.key : contact.key
  const done: string[] = []

  if (esc) {
    await db
      .from('escalations')
      .update({ staff_reply: text.slice(0, 1000), replied_at: new Date().toISOString(), replied_by: who })
      .eq('id', esc.id)
    done.push('escalation')
  }

  // Lasting fact -> knowledge base; temporary one -> live note.
  if (r.fact) {
    if (r.permanent) await addPermanentFact(db, tenantId, r.subject, r.fact, who)
    else {
      await db.from('lana_live_notes').insert({
        tenant_id: tenantId, subject: r.subject, note: r.fact, reported_by: who, source_text: text.slice(0, 500),
        expires_at: new Date(Date.now() + r.daysValid * 86400_000).toISOString(),
      })
    }
    done.push('knowledge')
  }

  // Tell the guest (only while Lana has the conversation; a person who took over keeps control).
  let informed = false
  if (conv && r.tellGuest && guest?.phone) {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const note = `[${stamp} UTC] ${who}: ${text.slice(0, 400)}`
    await db.from('conversations').update({ notes: [conv.notes, note].filter(Boolean).join('\n') }).eq('id', conv.id)
    if (conv.channel === 'whatsapp' && conv.status === 'active') {
      const msg = await composeGuestMessage(db, tenantId, conv.id, r.tellGuest, tenant)
      if (msg) {
        const sent = await sendWhatsAppMessage(wa.phoneNumberId, wa.credentials, guest.phone, msg)
        if (sent.success) {
          await db.from('messages').insert({ tenant_id: tenantId, conversation_id: conv.id, sender_type: 'lana', content: msg })
          await db.from('conversations').update({ lana_failed_at: null, silent_reason: null }).eq('id', conv.id)
          informed = true
          done.push('guest')
        }
      }
    }
    if (esc && informed) await db.from('escalations').update({ guest_informed: true }).eq('id', esc.id)
  }

  const fallback = informed
    ? 'Gracias, anotado. Ya le avisé al huésped.'
    : done.includes('knowledge')
      ? 'Gracias, anotado. Lo guardé en la información de Lana.'
      : 'Gracias, anotado.'
  await sendWhatsAppMessage(wa.phoneNumberId, wa.credentials, fromPhone, r.reply || fallback)
  return { handled: true }
}
