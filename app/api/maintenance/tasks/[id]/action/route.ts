import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'
import { completeTask, loadEngineContext, logEvent, processReminder, type TaskRow } from '@/lib/maintenance-engine'

/** Row actions: send_now, mark_done, ack_escalation, resolve_escalation. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { data: task } = await c.supabase.from('maintenance_tasks').select('*').eq('id', id).maybeSingle()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  const { action } = (await request.json()) as { action?: string }
  const ctx = await loadEngineContext(c.tenantId)

  if (action === 'mark_done') {
    await completeTask(ctx, task as TaskRow, { source: 'dashboard' })
    return NextResponse.json({ ok: true })
  }
  if (action === 'send_now') {
    if (!['scheduled', 'waiting', 'in_progress'].includes(task.status as string)) {
      return NextResponse.json({ error: 'This task is not open' }, { status: 400 })
    }
    await c.supabase.from('maintenance_reminders').update({ status: 'cancelled' }).eq('task_id', id).eq('status', 'pending')
    if (task.escalation_status === 'required') {
      await c.supabase.from('maintenance_tasks').update({ escalation_status: 'acknowledged' }).eq('id', id)
    }
    const { data: r } = await c.supabase
      .from('maintenance_reminders')
      .insert({ tenant_id: c.tenantId, task_id: id, scheduled_for: new Date().toISOString() })
      .select('id')
      .single()
    const outcome = await processReminder(ctx, { id: r!.id as string, task_id: id }, { force: true })
    if (outcome.result !== 'sent') {
      return NextResponse.json({ error: outcome.detail ?? `Reminder ${outcome.result}` }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }
  if (action === 'ack_escalation' || action === 'resolve_escalation') {
    const status = action === 'ack_escalation' ? 'acknowledged' : 'resolved'
    await c.supabase.from('maintenance_tasks').update({ escalation_status: status }).eq('id', id)
    await logEvent(ctx, id, action === 'ack_escalation' ? 'escalation_acknowledged' : 'escalation_resolved',
      `Escalation ${status} by dashboard staff`)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
