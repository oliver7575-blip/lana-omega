import { createServiceClient } from './supabase/service'
import { sendWhatsAppMessage } from './whatsapp-send'
import { parseMaintenancePayload } from './maintenance-template'

interface StaffRow {
  id: string
  name: string
  phone: string
  unavailable_from: string | null
  unavailable_until: string | null
  weekly_days_off: number[]
}

interface TaskRow {
  id: string
  title: string
  location: string | null
  due_date: string | null
  status: string
  assigned_to: string | null
}

function isUnavailableToday(staff: StaffRow): boolean {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  if (staff.unavailable_from && staff.unavailable_until) {
    if (todayStr >= staff.unavailable_from && todayStr <= staff.unavailable_until) return true
  }
  if (staff.weekly_days_off.includes(today.getDay())) return true
  return false
}

export interface ButtonReplyResult {
  handled: boolean
  detail?: string
}

async function sendConfirmation(tenantId: string, toPhone: string, text: string) {
  const supabase = createServiceClient()
  const { data: whatsappIntegration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()

  if (whatsappIntegration?.status !== 'connected') return
  const phoneNumberId = (whatsappIntegration.config as { phone_number_id?: string })
    ?.phone_number_id
  if (!phoneNumberId) return

  try {
    await sendWhatsAppMessage(phoneNumberId, whatsappIntegration.credentials, toPhone, text)
  } catch {
    // Best-effort only — a failed confirmation must never undo the task
    // update that already happened before this runs.
  }
}

async function reassignTask(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  task: TaskRow,
  requestingWorkerId: string,
  requestingWorkerName: string
): Promise<boolean> {
  const { data: candidates } = await supabase
    .from('maintenance_staff')
    .select('id, name, phone, unavailable_from, unavailable_until, weekly_days_off')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .neq('id', requestingWorkerId)

  const eligible = ((candidates ?? []) as StaffRow[]).filter((staff) => !isUnavailableToday(staff))
  if (eligible.length === 0) return false

  const eligibleIds = eligible.map((s) => s.id)
  const { data: workloadRows } = await supabase
    .from('maintenance_tasks')
    .select('assigned_to')
    .eq('tenant_id', tenantId)
    .in('assigned_to', eligibleIds)
    .in('status', ['open', 'in_progress'])

  const counts = new Map<string, number>()
  for (const staff of eligible) counts.set(staff.id, 0)
  for (const row of (workloadRows ?? []) as { assigned_to: string }[]) {
    counts.set(row.assigned_to, (counts.get(row.assigned_to) ?? 0) + 1)
  }

  const [pick] = [...eligible].sort(
    (a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.name.localeCompare(b.name)
  )

  await supabase
    .from('maintenance_tasks')
    .update({ assigned_to: pick.id, last_reminded_at: null })
    .eq('id', task.id)

  await supabase.from('maintenance_task_events').insert({
    tenant_id: tenantId,
    task_id: task.id,
    event_type: 'reassigned_needs_help',
    detail: `${requestingWorkerName} asked for help; reassigned to ${pick.name}`,
    metadata: { previous_staff_id: requestingWorkerId, new_staff_id: pick.id },
  })

  return true
}

export async function processMaintenanceButtonReply(
  tenantId: string,
  fromPhone: string,
  buttonText: string
): Promise<ButtonReplyResult> {
  const supabase = createServiceClient()

  const { data: worker } = await supabase
    .from('maintenance_staff')
    .select('id, name, phone, unavailable_from, unavailable_until, weekly_days_off')
    .eq('tenant_id', tenantId)
    .eq('phone', fromPhone)
    .eq('active', true)
    .maybeSingle()

  if (!worker) {
    return { handled: false, detail: 'Not a recognized active maintenance staff number' }
  }

  // Taps on the template buttons carry a payload naming the exact task and
  // action ("mt:<task id>:done"). Map it back to the button label so the
  // rest of the flow is unchanged.
  const payload = parseMaintenancePayload(buttonText)
  if (payload) {
    buttonText = { accept: 'Acepto', help: 'Necesito Ayuda', done: 'Terminado' }[payload.action]
  }

  let candidatesQuery = supabase
    .from('maintenance_tasks')
    .select('id, title, location, due_date, status, assigned_to')
    .eq('tenant_id', tenantId)
    .eq('assigned_to', worker.id)
    .in('status', ['open', 'in_progress'])
  candidatesQuery = payload
    ? candidatesQuery.eq('id', payload.taskId)
    : candidatesQuery.not('last_reminded_at', 'is', null)
  const { data: candidates } = await candidatesQuery

  if (payload && (!candidates || candidates.length === 0)) {
    // The task was already finished, reassigned, or belongs to someone else.
    await sendConfirmation(
      tenantId,
      worker.phone,
      'Esa tarea ya no está asignada a ti o ya fue completada. Gracias.'
    )
    return { handled: true, detail: 'Payload task not open/assigned to this worker' }
  }

  if (!candidates || candidates.length !== 1) {
    if (candidates && candidates.length > 0) {
      await supabase.from('maintenance_task_events').insert({
        tenant_id: tenantId,
        task_id: candidates[0].id,
        event_type: 'ambiguous_reply',
        detail: `${worker.name} replied "${buttonText}" but ${candidates.length} candidate tasks matched (need exactly 1)`,
      })
    }
    return { handled: true, detail: 'Ambiguous or no matching task, no action taken' }
  }

  const task = candidates[0]
  const firstName = worker.name.split(' ')[0]

  if (buttonText === 'Terminado') {
    await supabase.from('maintenance_tasks').update({ status: 'done' }).eq('id', task.id)
    await supabase.from('maintenance_task_events').insert({
      tenant_id: tenantId,
      task_id: task.id,
      event_type: 'completed_via_whatsapp',
      detail: `${worker.name} marked this task done via WhatsApp`,
    })
    await sendConfirmation(tenantId, worker.phone, `✅ Anotado, gracias ${firstName}`)
    return { handled: true }
  }

  if (buttonText === 'Acepto') {
    await supabase.from('maintenance_task_events').insert({
      tenant_id: tenantId,
      task_id: task.id,
      event_type: 'acknowledged_via_whatsapp',
      detail: `${worker.name} acknowledged this task via WhatsApp`,
    })
    await sendConfirmation(tenantId, worker.phone, 'Entendido')
    return { handled: true }
  }

  if (buttonText === 'Necesito Ayuda') {
    const reassigned = await reassignTask(supabase, tenantId, task, worker.id, worker.name)
    // Matches Beta's real behavior: the requester gets the same reassuring
    // line either way, whether or not someone else was actually found.
    await sendConfirmation(
      tenantId,
      worker.phone,
      `Entiendo ${firstName}. Tomo nota y pido que alguien nos ayude con la tarea.`
    )
    if (!reassigned) {
      await supabase.from('maintenance_task_events').insert({
        tenant_id: tenantId,
        task_id: task.id,
        event_type: 'no_staff_available_for_reassignment',
        detail: `${worker.name} asked for help but no other active staff are currently available`,
      })
    }
    return { handled: true }
  }

  return { handled: true, detail: `Unrecognized reply: ${buttonText}` }
}
