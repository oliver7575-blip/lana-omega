import type { SupabaseClient } from '@supabase/supabase-js'
import { CONCIERGE_MODEL } from './anthropic'
import { createServiceClient } from './supabase/service'
import { samePhone } from './phone'
import { parseEscalationContacts } from './escalation-contacts'
import { buildKnowledgeBaseSection } from './knowledge-base'
import { addPermanentFact, buildLiveNotesSection } from './live-notes'
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
  /** A question Lana must ask the team member before acting (null when it is clear). */
  ask: string | null
  summary: string
  reply: string
}

const SYSTEM = `A hotel's assistant (Lana) escalated guest problems to a team member on WhatsApp. The team member has now written back in free text. Decide what it means and what must happen with it.

Return ONLY a JSON object:
{"intent":"answer|unrelated","escalation":number|null,"tell_guest":string|null,"subject":string|null,"fact":string|null,"permanent":boolean,"days_valid":number,"ask":string|null,"summary":string,"reply":string}

- answer: the message gives information about one of the escalations or about the hotel itself (a diagnosis, a status, a fix, a decision, a fact about the property).
- unrelated: it is about something else (for example a maintenance task, a greeting, a personal chat) and nothing should be forwarded or stored.
- escalation: the number of the escalation it answers (match by room, guest or topic). If unclear and there is only one recent escalation it is probably that one. null if it answers none.
- tell_guest: leave null unless ALL of these are true: the guest is waiting for, or asked about, exactly what this message answers; the information is useful to them; and it is safe to share (no internal blame, costs, security details or guesses). When in doubt, null. Then give the facts in one or two plain sentences, only what the team member actually said (no promises, no times unless they gave one, no staff names).
- fact / subject: only if the message states something worth remembering about the property (e.g. "Room 1 has no hot water, it was built that way"): fact is one neutral English sentence and subject is what it is about ("Room 1"). permanent is true ONLY when the team member clearly says it is lasting (built that way, always, by design). A report that could be either lasting or a fault ("room 1 has no hot water") is NOT clearly lasting: keep permanent false and use ask. A breakdown that will be repaired is not permanent (days_valid is how many days it likely stays true, 1 to 14). null fact if nothing to remember.
- ask: if you cannot tell something that decides what to do (is it lasting or a fault? which room? should the guest be told something that is not obviously safe to share?), write ONE short question to the team member, in their language. Otherwise null. Never ask more than you need.
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
      ask: str(j.ask, 300),
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
  const who = contact.key

  if (esc) {
    await db
      .from('escalations')
      .update({ staff_reply: text.slice(0, 1000), replied_at: new Date().toISOString(), replied_by: who })
      .eq('id', esc.id)
  }

  // Not sure what it means yet: ask instead of guessing. Nothing is saved or sent on.
  if (r.ask) {
    await askStaff(db, wa, {
      tenantId, phone: fromPhone, kind: 'escalation', escalationId: (esc?.id as string) ?? null, originalText: text, question: r.ask,
      draft: { subject: r.subject, fact: r.fact, permanent: r.permanent, daysValid: r.daysValid, tellGuest: r.tellGuest, asks: 1 },
    })
    return { handled: true }
  }

  const conv = esc?.conversation_id ? convById.get(esc.conversation_id as string) : undefined
  const done = await applyOutcome(db, tenantId, wa, tenant, {
    who, text, escalationId: (esc?.id as string) ?? null, conv, guest: guestOf(conv),
    fact: r.fact, subject: r.subject, permanent: r.permanent, daysValid: r.daysValid, tellGuest: r.tellGuest,
  })
  const fallback = done.informed
    ? 'Gracias, anotado. Ya le avisé al huésped.'
    : done.knowledge
      ? 'Gracias, anotado. Lo guardé en la información de Lana.'
      : 'Gracias, anotado.'
  await sendWhatsAppMessage(wa.phoneNumberId, wa.credentials, fromPhone, r.reply || fallback)
  return { handled: true }
}

type ConvRow = { id: string; channel: string; status: string; notes: string | null }
type GuestRow = { name: string | null; phone: string } | null

interface Outcome {
  who: string
  text: string
  escalationId: string | null
  conv?: ConvRow
  guest: GuestRow
  fact: string | null
  subject: string | null
  permanent: boolean
  daysValid: number
  tellGuest: string | null
}

/** Saves what is known and passes it on to the guest only when that is appropriate. */
async function applyOutcome(
  db: SupabaseClient,
  tenantId: string,
  wa: WhatsAppLine,
  tenant: { ai_persona_prompt: string | null; knowledge_base: string | null },
  o: Outcome
): Promise<{ knowledge: boolean; informed: boolean }> {
  let knowledge = false
  if (o.fact) {
    if (o.subject) {
      // Whatever was noted temporarily about the same subject is replaced.
      await db
        .from('lana_live_notes')
        .update({ resolved_at: new Date().toISOString(), resolved_by: o.permanent ? 'saved to the knowledge base' : 'replaced by a newer report' })
        .eq('tenant_id', tenantId)
        .is('resolved_at', null)
        .ilike('subject', o.subject)
    }
    if (o.permanent) await addPermanentFact(db, tenantId, o.subject, o.fact, o.who)
    else {
      await db.from('lana_live_notes').insert({
        tenant_id: tenantId, subject: o.subject, note: o.fact, reported_by: o.who, source_text: o.text.slice(0, 500),
        expires_at: new Date(Date.now() + o.daysValid * 86400_000).toISOString(),
      })
    }
    knowledge = true
  }

  let informed = false
  const { conv, guest } = o
  if (conv && o.tellGuest && guest?.phone) {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    await db
      .from('conversations')
      .update({ notes: [conv.notes, `[${stamp} UTC] ${o.who}: ${o.text.slice(0, 400)}`].filter(Boolean).join('\n') })
      .eq('id', conv.id)
    // Only while Lana has the conversation; a person who took over keeps control.
    if (conv.channel === 'whatsapp' && conv.status === 'active') {
      const msg = await composeGuestMessage(db, tenantId, conv.id, o.tellGuest, tenant)
      if (msg) {
        const sent = await sendWhatsAppMessage(wa.phoneNumberId, wa.credentials, guest.phone, msg)
        if (sent.success) {
          await db.from('messages').insert({ tenant_id: tenantId, conversation_id: conv.id, sender_type: 'lana', content: msg })
          await db.from('conversations').update({ lana_failed_at: null, silent_reason: null }).eq('id', conv.id)
          informed = true
        }
      }
    }
    if (o.escalationId && informed) await db.from('escalations').update({ guest_informed: true }).eq('id', o.escalationId)
  }
  return { knowledge, informed }
}

// ---------------------------------------------------------------------------
// Questions Lana asks the team, and their answers
// ---------------------------------------------------------------------------

interface AskInput {
  tenantId: string
  phone: string
  kind: 'escalation' | 'report'
  escalationId: string | null
  originalText: string
  question: string
  draft: Record<string, unknown>
}

/** Lana asks the team member one question and remembers what she was about to do. */
export async function askStaff(db: SupabaseClient, wa: WhatsAppLine, a: AskInput) {
  await db.from('staff_pending_questions').insert({
    tenant_id: a.tenantId, phone: a.phone, kind: a.kind, escalation_id: a.escalationId,
    original_text: a.originalText.slice(0, 1000), question: a.question, draft: a.draft,
  })
  await sendWhatsAppMessage(wa.phoneNumberId, wa.credentials, a.phone, a.question)
}

const RESOLVE_SYSTEM = `A hotel's assistant (Lana) asked a team member a clarifying question about something they told her. You get their original message, her question, what she had understood so far, and their answer.

Return ONLY a JSON object:
{"outcome":"resolved|unrelated|ask_again","subject":string|null,"fact":string|null,"permanent":boolean,"days_valid":number,"tell_guest":string|null,"ask":string|null,"reply":string}

- unrelated: the message does not answer her question (new topic, another task...). Nothing is changed.
- resolved: the answer settles it. fact (one neutral English sentence) and subject as before; permanent is true ONLY if they clearly say it is lasting; otherwise false with days_valid (1 to 14) for how long it likely stays true. fact null if there is nothing worth remembering.
- ask_again: only if the answer is still unclear; ask is one short question. Use sparingly.
- tell_guest: null unless the guest is waiting for exactly this, it is useful and safe to share, and you are sure; then one or two plain sentences with only what the team said (no promises, no times unless given, no names).
- reply: one or two friendly sentences to the team member in their language saying what you did.`

/** A team member answering a question Lana asked. */
export async function processPendingAnswer(
  tenantId: string,
  fromPhone: string,
  text: string,
  wa: WhatsAppLine,
  db: SupabaseClient = createServiceClient()
): Promise<{ handled: boolean }> {
  const { data: rows } = await db
    .from('staff_pending_questions')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('resolved_at', null)
    .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5)
  const pending = (rows ?? []).find((r) => samePhone(r.phone as string, fromPhone))
  if (!pending) return { handled: false }
  const draft = (pending.draft ?? {}) as Record<string, unknown>

  let r: Record<string, unknown> | null = null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CONCIERGE_MODEL,
        max_tokens: 500,
        system: RESOLVE_SYSTEM,
        messages: [{
          role: 'user',
          content: `Original message: ${pending.original_text}
Lana's question: ${pending.question}
Understood so far: ${JSON.stringify(draft)}

Their answer:
<message>
${text.slice(0, 1000)}
</message>`,
        }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = (await res.json()) as { content?: { text?: string }[] }
    if (res.ok) {
      const raw = (data.content ?? []).map((b) => b.text ?? '').join('')
      r = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    }
  } catch (err) {
    console.error('[escalation-replies] resolve failed', err)
  }
  if (!r || r.outcome === 'unrelated') return { handled: false }

  const asks = Number(draft.asks ?? 1)
  if (r.outcome === 'ask_again' && typeof r.ask === 'string' && asks < 2) {
    await db.from('staff_pending_questions').update({ resolved_at: new Date().toISOString() }).eq('id', pending.id)
    await askStaff(db, wa, {
      tenantId, phone: fromPhone, kind: pending.kind as 'escalation' | 'report', escalationId: pending.escalation_id as string | null,
      originalText: `${pending.original_text}\n${text}`, question: r.ask, draft: { ...draft, asks: asks + 1 },
    })
    return { handled: true }
  }
  await db.from('staff_pending_questions').update({ resolved_at: new Date().toISOString() }).eq('id', pending.id)

  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const fact = str(r.fact, 300)
  const subject = str(r.subject, 80)
  let conv: ConvRow | undefined
  let guest: GuestRow = null
  if (pending.escalation_id) {
    const { data: esc } = await db.from('escalations').select('conversation_id').eq('id', pending.escalation_id).single()
    if (esc?.conversation_id) {
      const { data: c } = await db.from('conversations').select('id, channel, status, notes, guests(name, phone)').eq('id', esc.conversation_id).single()
      if (c) {
        conv = c as unknown as ConvRow
        const g = (c as unknown as { guests: GuestRow | GuestRow[] }).guests
        guest = (Array.isArray(g) ? g[0] : g) ?? null
      }
    }
  }
  const { data: tenant } = await db.from('tenants').select('ai_persona_prompt, knowledge_base').eq('id', tenantId).single()
  const done = await applyOutcome(db, tenantId, wa, { ai_persona_prompt: tenant?.ai_persona_prompt ?? null, knowledge_base: tenant?.knowledge_base ?? null }, {
    who: 'team', text: `${pending.original_text} / ${text}`, escalationId: pending.escalation_id as string | null, conv, guest,
    fact, subject, permanent: r.permanent === true, daysValid: Math.min(14, Math.max(1, Number(r.days_valid) || 3)),
    tellGuest: str(r.tell_guest, 500),
  })
  const fallback = done.informed ? 'Gracias, anotado. Ya le avisé al huésped.' : done.knowledge ? 'Gracias, anotado en la información de Lana.' : 'Gracias, anotado.'
  await sendWhatsAppMessage(wa.phoneNumberId, wa.credentials, fromPhone, str(r.reply, 400) ?? fallback)
  return { handled: true }
}
