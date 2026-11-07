import { CONCIERGE_MODEL } from './anthropic'
import { loadActiveNotes, type LiveNote } from './live-notes'
import { KNOWLEDGE_BASE_MAX_CHARS } from './knowledge-base'
import {
  ACTIVE_STATUSES,
  acknowledgeTask,
  completeTask,
  logEvent,
  requestHelp,
  sendStaffText,
  type EngineContext,
  type StaffRow,
  type TaskRow,
} from './maintenance-engine'

interface Interpretation {
  intent: 'done' | 'accept' | 'still' | 'help' | 'note' | 'report' | 'fixed' | 'unrelated'
  /** report: what is affected, e.g. "Room 1". */
  subject: string | null
  /** report: the fact in one short English sentence, written for guests' assistant. */
  fact: string | null
  daysValid: number
  /** report: a lasting fact about the property (not a temporary problem). */
  permanent: boolean
  /** fixed: numbers of the reported notes this clears. */
  resolves: number[]
  taskCode: string | null
  /** Who actually did the work, when it was not the sender (e.g. "Eliseo"). */
  doneBy: string | null
  /** The facts from the message, in one short Spanish sentence, for the task log. */
  note: string
  /** Short, warm acknowledgement to send back, in the staff member's language. */
  reply: string
}

const SYSTEM = `You read a WhatsApp message from a hotel maintenance team member who is answering about their open tasks. Staff may answer freely, in any words and any language. Decide what they mean.

Return ONLY a JSON object:
{"intent":"done|accept|still|help|note|report|fixed|unrelated","task_code":string|null,"done_by":string|null,"note":string,"reply":string,"subject":string|null,"fact":string|null,"days_valid":number,"permanent":boolean,"resolves":number[]}

- done: the task is finished. If someone OTHER than the sender did it (for example "Eliseo ya lo terminó", "lo hizo Abimael"), set done_by to that first name. If the sender did it, done_by is null.
- accept: they will do it. still: they are still working on it. help: they cannot do it and need someone else.
- note: they give information about the task but it is not finished (a delay, a missing part, a finding). Not for chit-chat.
- report: they tell Lana something about the state of the hotel that guests or colleagues should know, with no task involved (for example "El cuarto 1 no cuenta con agua caliente", "the pool is closed", "no water in the garden"). Set subject (e.g. "Room 1") and fact (one short, neutral English sentence, no names). days_valid: how many days it is likely to stay true (1 to 14, default 3). permanent: true ONLY when they state a lasting fact about how the property is built or run (for example "el cuarto 1 no tiene agua caliente, así está construido", "there is no AC in room 4"), not a breakdown that will be repaired. For a permanent fact, write fact as a neutral sentence for the knowledge base.
- fixed: they say a previously reported problem is solved (for example "ya hay agua caliente en el cuarto 1"). resolves: the numbers from the list of current reports that this clears.
- unrelated: nothing to do with their tasks or the state of the hotel (guest-style chat, questions about booking...).
- task_code: the 6-character code if they mention one, else pick the task from the list that the message is clearly about, else null.
- note: one short sentence in Spanish with the facts, written for the task log, e.g. "Eliseo terminó la tarea (lo reportó Abimael)". Never invent facts.
- reply: one or two short friendly sentences in the sender's language, confirming exactly what you recorded. If someone else finished it, say that you noted it was Eliseo. Do not promise anything else.`

async function interpret(staff: StaffRow, text: string, tasks: TaskRow[], notes: LiveNote[]): Promise<Interpretation | null> {
  const list = tasks.map((t) => `#${t.task_code} ${t.title}${t.location ? ` (${t.location})` : ''} [${t.status}]`).join('\n') || '(none)'
  try {
    const noteList = notes.map((n, i) => `${i + 1}. ${n.subject ? `${n.subject}: ` : ''}${n.note}`).join('\n') || '(none)'
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CONCIERGE_MODEL,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Sender: ${staff.name}\nTheir open tasks:\n${list}\n\nCurrent reports about the hotel:\n${noteList}\n\n<message>\n${text.slice(0, 1500)}\n</message>` }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = (await res.json()) as { content?: { text?: string }[] }
    if (!res.ok) return null
    const raw = (data.content ?? []).map((b) => b.text ?? '').join('')
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    const intents = ['done', 'accept', 'still', 'help', 'note', 'report', 'fixed', 'unrelated']
    if (!intents.includes(j.intent)) return null
    return {
      intent: j.intent,
      taskCode: typeof j.task_code === 'string' ? j.task_code.replace('#', '').toUpperCase() : null,
      doneBy: typeof j.done_by === 'string' && j.done_by.trim() ? j.done_by.trim().slice(0, 60) : null,
      note: String(j.note ?? '').slice(0, 400),
      subject: typeof j.subject === 'string' && j.subject.trim() ? j.subject.trim().slice(0, 80) : null,
      fact: typeof j.fact === 'string' && j.fact.trim() ? j.fact.trim().slice(0, 300) : null,
      daysValid: Math.min(14, Math.max(1, Number(j.days_valid) || 3)),
      permanent: j.permanent === true,
      resolves: Array.isArray(j.resolves) ? j.resolves.map(Number).filter((n: number) => Number.isInteger(n)) : [],
      reply: String(j.reply ?? '').slice(0, 400),
    }
  } catch (err) {
    console.error('[maintenance-freetext] interpretation failed', err)
    return null
  }
}

/**
 * A free-form message from a maintenance team member (not a button or keyword).
 * Returns true when it was about their tasks and has been recorded and answered.
 */
export async function handleFreeTextReply(ctx: EngineContext, staff: StaffRow, text: string): Promise<boolean> {
  const { data } = await ctx.db
    .from('maintenance_tasks')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .in('status', ['waiting', 'in_progress'])
    .eq('assigned_to', staff.id)
    .order('last_reminded_at', { ascending: false })
  const mine = (data ?? []) as TaskRow[]

  // They may name a task code that is not theirs (e.g. reporting for a colleague).
  const codes = Array.from(text.toUpperCase().matchAll(/#?\b([0-9A-F]{6})\b/g), (m) => m[1])
  let tasks = mine
  if (codes.length) {
    const { data: named } = await ctx.db
      .from('maintenance_tasks').select('*').eq('tenant_id', ctx.tenantId).in('task_code', codes).in('status', ACTIVE_STATUSES as unknown as string[])
    tasks = [...mine, ...((named ?? []) as TaskRow[]).filter((t) => !mine.some((m) => m.id === t.id))]
  }
  const notes = await loadActiveNotes(ctx.tenantId, ctx.db)
  const result = await interpret(staff, text, tasks, notes)
  if (!result || result.intent === 'unrelated') return false

  // Reports about the hotel itself: Lana learns them (no task needed).
  if (result.intent === 'report' || result.intent === 'fixed') {
    const first = staff.name.split(' ')[0]
    await ctx.db.from('maintenance_messages').insert({
      tenant_id: ctx.tenantId, staff_id: staff.id, task_id: null, direction: 'inbound', content: text, delivery_status: 'received',
    })
    if (result.intent === 'report' && result.fact && result.permanent) {
      await addPermanentFact(ctx, result.subject, result.fact, staff.name)
    } else if (result.intent === 'report' && result.fact) {
      // A newer report on the same subject replaces the older one.
      if (result.subject) {
        await ctx.db
          .from('lana_live_notes')
          .update({ resolved_at: new Date().toISOString(), resolved_by: 'replaced by a newer report' })
          .eq('tenant_id', ctx.tenantId)
          .is('resolved_at', null)
          .ilike('subject', result.subject)
      }
      await ctx.db.from('lana_live_notes').insert({
        tenant_id: ctx.tenantId,
        subject: result.subject,
        note: result.fact,
        reported_by: staff.name,
        source_text: text.slice(0, 500),
        expires_at: new Date(Date.now() + result.daysValid * 86400_000).toISOString(),
      })
    } else if (result.intent === 'fixed') {
      const ids = result.resolves.map((n) => notes[n - 1]?.id).filter(Boolean) as string[]
      if (ids.length) {
        await ctx.db
          .from('lana_live_notes')
          .update({ resolved_at: new Date().toISOString(), resolved_by: staff.name })
          .in('id', ids)
      }
    } else {
      return false
    }
    await sendStaffText(ctx, staff, null, result.reply || `Anotado, gracias ${first}`)
    return true
  }

  if (!tasks.length) return false

  const task = tasks.find((t) => t.task_code === result.taskCode) ?? (tasks.length === 1 ? tasks[0] : null)
  await ctx.db.from('maintenance_messages').insert({
    tenant_id: ctx.tenantId, staff_id: staff.id, task_id: task?.id ?? null, direction: 'inbound', content: text, delivery_status: 'received',
  })
  if (!task) {
    await sendStaffText(ctx, staff, null,
      `Gracias ${staff.name.split(' ')[0]}. ¿De qué tarea hablas? Responde con el código, por ejemplo: ${tasks[0].task_code} TERMINADO`)
    return true
  }

  const first = staff.name.split(' ')[0]
  const byOther = result.doneBy && result.doneBy.toLowerCase() !== first.toLowerCase() ? result.doneBy : null
  const detail = result.note || text.slice(0, 300)
  const meta = { free_text: text.slice(0, 500), reported_by: staff.name, done_by: byOther ?? staff.name }

  if (result.intent === 'done') {
    await completeTask(ctx, task, {
      source: 'whatsapp',
      text: byOther ? `Terminada por ${byOther} (reportado por ${staff.name}). “${text.slice(0, 200)}”` : `Terminada por ${staff.name}. “${text.slice(0, 200)}”`,
    })
    await logEvent(ctx, task.id, 'staff_note', detail, meta)
  } else if (result.intent === 'accept') {
    await acknowledgeTask(ctx, task, detail)
  } else if (result.intent === 'help') {
    await requestHelp(ctx, task, staff, detail)
  } else {
    await logEvent(ctx, task.id, 'staff_note', detail, meta)
  }
  await sendStaffText(ctx, staff, task.id, result.reply || `Anotado #${task.task_code}, gracias ${first}`)
  return true
}

const FACTS_HEADING = '# Team-confirmed facts'

/** A lasting fact told by staff goes into the knowledge base itself, so it never expires. */
async function addPermanentFact(ctx: EngineContext, subject: string | null, fact: string, reportedBy: string) {
  const { data } = await ctx.db.from('tenants').select('knowledge_base').eq('id', ctx.tenantId).single()
  const kb = ((data?.knowledge_base as string | null) ?? '').trimEnd()
  const line = `- ${subject ? `**${subject}**: ` : ''}${fact}`
  if (kb.includes(line)) return
  const next = kb.includes(FACTS_HEADING)
    ? kb.replace(FACTS_HEADING, `${FACTS_HEADING}\n${line}`)
    : `${kb}${kb ? '\n\n' : ''}${FACTS_HEADING}\n${line}`
  if (next.length > KNOWLEDGE_BASE_MAX_CHARS) {
    console.error('[maintenance-freetext] knowledge base is full, fact not saved')
    return
  }
  await ctx.db.from('tenants').update({ knowledge_base: next }).eq('id', ctx.tenantId)
  await ctx.db.from('lana_live_notes').insert({
    tenant_id: ctx.tenantId, subject, note: fact, reported_by: reportedBy, resolved_at: new Date().toISOString(), resolved_by: 'saved to the knowledge base',
  })
}
