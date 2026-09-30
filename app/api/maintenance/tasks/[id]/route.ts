import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'
import { cleanTask, type TaskInput } from '@/lib/maintenance-tasks'
import { completeTask, loadEngineContext, logEvent, scheduleReminder, type TaskRow } from '@/lib/maintenance-engine'

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { data: task } = await c.supabase.from('maintenance_tasks').select('*').eq('id', id).maybeSingle()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  const [{ data: reminders }, { data: messages }, { data: events }] = await Promise.all([
    c.supabase.from('maintenance_reminders').select('id, scheduled_for, sent_at, status, error_message').eq('task_id', id).order('scheduled_for', { ascending: false }),
    c.supabase.from('maintenance_messages').select('id, direction, content, delivery_status, created_at').eq('task_id', id).order('created_at', { ascending: false }),
    c.supabase.from('maintenance_task_events').select('id, event_type, detail, created_at').eq('task_id', id).order('created_at', { ascending: false }),
  ])
  return NextResponse.json({ task, reminders: reminders ?? [], messages: messages ?? [], events: events ?? [] })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { data: existing } = await c.supabase.from('maintenance_tasks').select('*').eq('id', id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  const ctx = await loadEngineContext(c.tenantId)
  const body = (await request.json()) as TaskInput & { status?: string }

  // Status changes from the dashboard's status menu.
  if (body.status && body.status !== existing.status) {
    if (body.status === 'done') {
      await completeTask(ctx, existing as TaskRow, { source: 'dashboard' })
    } else if (['scheduled', 'waiting', 'in_progress', 'cancelled'].includes(body.status)) {
      await c.supabase.from('maintenance_tasks').update({ status: body.status, updated_at: new Date().toISOString() }).eq('id', id)
      if (body.status === 'cancelled') {
        await c.supabase.from('maintenance_reminders').update({ status: 'cancelled' }).eq('task_id', id).eq('status', 'pending')
      }
      await logEvent(ctx, id, 'status_changed', `Status changed to ${body.status.replace('_', ' ')}`)
    } else {
      return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  const { values, error } = cleanTask(body, true, ctx.tz)
  if (error) return NextResponse.json({ error }, { status: 400 })
  if (Object.keys(values!).length === 0) return NextResponse.json({ ok: true })
  const { error: dbError } = await c.supabase
    .from('maintenance_tasks')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  // A new due time replaces the reminder schedule.
  if (values!.due_at && values!.due_at !== existing.due_at && ['scheduled', 'waiting', 'in_progress'].includes(existing.status)) {
    await c.supabase.from('maintenance_reminders').update({ status: 'cancelled' }).eq('task_id', id).eq('status', 'pending')
    const due = new Date(values!.due_at as string)
    await scheduleReminder(ctx, id, due.getTime() > Date.now() ? due : new Date())
  }
  if (values!.assigned_to !== undefined && values!.assigned_to !== existing.assigned_to) {
    const { data: s } = values!.assigned_to
      ? await c.supabase.from('maintenance_staff').select('name').eq('id', values!.assigned_to as string).single()
      : { data: null }
    await logEvent(ctx, id, 'assigned', s ? `Assigned to ${s.name} from the dashboard` : 'Unassigned — back in the staff pool')
  }
  await logEvent(ctx, id, 'edited', 'Task edited from the dashboard')
  return NextResponse.json({ ok: true })
}

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { error } = await c.supabase.from('maintenance_tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
