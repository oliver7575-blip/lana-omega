import { CONCIERGE_MODEL } from './anthropic'
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
  intent: 'done' | 'accept' | 'still' | 'help' | 'note' | 'unrelated'
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
{"intent":"done|accept|still|help|note|unrelated","task_code":string|null,"done_by":string|null,"note":string,"reply":string}

- done: the task is finished. If someone OTHER than the sender did it (for example "Eliseo ya lo terminó", "lo hizo Abimael"), set done_by to that first name. If the sender did it, done_by is null.
- accept: they will do it. still: they are still working on it. help: they cannot do it and need someone else.
- note: they give information about the task but it is not finished (a delay, a missing part, a finding). Not for chit-chat.
- unrelated: nothing to do with their tasks.
- task_code: the 6-character code if they mention one, else pick the task from the list that the message is clearly about, else null.
- note: one short sentence in Spanish with the facts, written for the task log, e.g. "Eliseo terminó la tarea (lo reportó Abimael)". Never invent facts.
- reply: one or two short friendly sentences in the sender's language, confirming exactly what you recorded. If someone else finished it, say that you noted it was Eliseo. Do not promise anything else.`

async function interpret(staff: StaffRow, text: string, tasks: TaskRow[]): Promise<Interpretation | null> {
  const list = tasks.map((t) => `#${t.task_code} ${t.title}${t.location ? ` (${t.location})` : ''} [${t.status}]`).join('\n') || '(none)'
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CONCIERGE_MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Sender: ${staff.name}\nTheir open tasks:\n${list}\n\n<message>\n${text.slice(0, 1500)}\n</message>` }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = (await res.json()) as { content?: { text?: string }[] }
    if (!res.ok) return null
    const raw = (data.content ?? []).map((b) => b.text ?? '').join('')
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    const intents = ['done', 'accept', 'still', 'help', 'note', 'unrelated']
    if (!intents.includes(j.intent)) return null
    return {
      intent: j.intent,
      taskCode: typeof j.task_code === 'string' ? j.task_code.replace('#', '').toUpperCase() : null,
      doneBy: typeof j.done_by === 'string' && j.done_by.trim() ? j.done_by.trim().slice(0, 60) : null,
      note: String(j.note ?? '').slice(0, 400),
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
  if (!tasks.length) return false

  const result = await interpret(staff, text, tasks)
  if (!result || result.intent === 'unrelated') return false

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
