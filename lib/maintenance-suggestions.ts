import type { SupabaseClient } from '@supabase/supabase-js'
import { CONCIERGE_MODEL } from './anthropic'
import { createServiceClient } from './supabase/service'
import { loadEngineContext } from './maintenance-engine'
import { notifyStaff } from './escalation'
import { findEscalationContact, parseEscalationContacts } from './escalation-contacts'
import { zonedParts } from './tz'

/** Weekly digest goes out Monday at or after this local hour. */
const SEND_WEEKDAY = 1
const SEND_FROM_HOUR = 9

const SIGNAL_EVENTS = [
  'staff_note',
  'reply_needs_help',
  'reassigned_needs_help',
  'escalation_required',
  'missed_rolled_forward',
  'carried_over',
  'reply_completed',
]

const SYSTEM = `You help the owner of a small hotel improve the recurring maintenance tasks that Lana (the hotel's assistant) sends to the team on WhatsApp. You are given what the team actually said and did about tasks over the last 7 days.

Suggest up to 5 concrete tweaks to tasks, only where the evidence supports them. Examples: a task keeps being done by someone else (change the assignee), is always late or rolled forward (move the time or the frequency), staff report a missing part or a unclear instruction (edit the description), a task keeps asking for help (split it or add someone), a task is no longer needed.

Rules:
- Every suggestion must cite the task code and what staff said or did. Never invent facts or numbers.
- One suggestion per task. Skip weak or one-off signals.
- You only suggest. Nothing is changed automatically.
- Write in English, plain and short. Format each as: "1) #CODE Title: what to change, and why (evidence)."
- If nothing is worth suggesting, return the single word NONE.
Return only the numbered list (or NONE).`

interface EventRow {
  task_id: string
  event_type: string
  detail: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

export async function runWeeklyTaskSuggestions(): Promise<{ tenantId: string; sent: boolean; reason?: string }[]> {
  const db = createServiceClient()
  const { data: tenants } = await db.from('tenants').select('id, task_suggestions_sent_at')
  const out: { tenantId: string; sent: boolean; reason?: string }[] = []
  for (const t of tenants ?? []) {
    try {
      out.push({ tenantId: t.id as string, ...(await digestForTenant(db, t.id as string, t.task_suggestions_sent_at as string | null)) })
    } catch (err) {
      console.error('[task-suggestions] failed', t.id, err)
      out.push({ tenantId: t.id as string, sent: false, reason: 'error' })
    }
  }
  return out
}

async function digestForTenant(db: SupabaseClient, tenantId: string, lastSent: string | null, force = false): Promise<{ sent: boolean; reason?: string }> {
  const ctx = await loadEngineContext(tenantId, db)
  const p = zonedParts(new Date(), ctx.tz)
  if (!force) {
    if (p.weekday !== SEND_WEEKDAY || p.hour < SEND_FROM_HOUR) return { sent: false, reason: 'not the time yet' }
    if (lastSent && Date.now() - new Date(lastSent).getTime() < 6 * 86400_000) return { sent: false, reason: 'already sent this week' }
  }
  // Claim this week first so overlapping runs cannot send it twice.
  await db.from('tenants').update({ task_suggestions_sent_at: new Date().toISOString() }).eq('id', tenantId)

  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data: events } = await db
    .from('maintenance_task_events')
    .select('task_id, event_type, detail, created_at, metadata')
    .eq('tenant_id', tenantId)
    .in('event_type', SIGNAL_EVENTS)
    .gte('created_at', since)
    .order('created_at')
    .limit(400)
  const rows = (events ?? []) as EventRow[]
  if (!rows.length) return { sent: false, reason: 'no signals this week' }

  const ids = [...new Set(rows.map((r) => r.task_id))]
  const [{ data: tasks }, { data: staff }] = await Promise.all([
    db.from('maintenance_tasks').select('id, task_code, title, location, assigned_to, recurrence_rule, due_at, priority, parent_task_id').in('id', ids),
    db.from('maintenance_staff').select('id, name').eq('tenant_id', tenantId),
  ])
  const staffName = new Map((staff ?? []).map((s) => [s.id as string, s.name as string]))
  const taskById = new Map((tasks ?? []).map((t) => [t.id as string, t]))

  const lines: string[] = []
  for (const id of ids) {
    const t = taskById.get(id)
    if (!t) continue
    const ev = rows.filter((r) => r.task_id === id)
    lines.push(
      `#${t.task_code} ${t.title}${t.location ? ` (${t.location})` : ''} · ${t.recurrence_rule} · assigned: ${staffName.get(t.assigned_to as string) ?? 'nobody'}\n` +
        ev.map((e) => `  - ${e.event_type}: ${String(e.detail ?? '').slice(0, 220)}`).join('\n')
    )
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: CONCIERGE_MODEL,
      max_tokens: 900,
      system: SYSTEM,
      messages: [{ role: 'user', content: `<last_7_days>\n${lines.join('\n').slice(0, 12000)}\n</last_7_days>` }],
    }),
    signal: AbortSignal.timeout(40000),
  })
  const data = (await res.json()) as { content?: { text?: string }[] }
  if (!res.ok) {
    await db.from('tenants').update({ task_suggestions_sent_at: lastSent }).eq('id', tenantId) // try again next run
    return { sent: false, reason: 'AI call failed' }
  }
  const text = (data.content ?? []).map((b) => b.text ?? '').join('').trim()
  if (!text || /^NONE\b/i.test(text)) return { sent: false, reason: 'nothing worth suggesting' }

  const body = `Weekly task suggestions from Lana\n${text}`
  const { data: tenant } = await db.from('tenants').select('escalation_contacts, message_templates').eq('id', tenantId).single()
  const contacts = parseEscalationContacts(tenant?.escalation_contacts)
  const contact = findEscalationContact(contacts, 'oliver') ?? contacts[0]
  let delivered = false
  if (contact && ctx.whatsapp) {
    const r = await notifyStaff(
      ctx.whatsapp.phoneNumberId,
      ctx.whatsapp.credentials,
      contact.phone,
      'Maintenance',
      { category: 'weekly task suggestions', summary: text.replace(/\s*\n\s*/g, ' ').slice(0, 900), urgency: 'low' },
      tenant?.message_templates,
      'Lana'
    )
    delivered = r.success
  }
  await db.from('task_suggestion_digests').insert({ tenant_id: tenantId, body, delivered })
  return { sent: delivered, reason: delivered ? undefined : 'saved but not delivered' }
}
