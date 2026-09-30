import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'
import { loadEngineContext, reminderPreview, type StaffRow, type TaskRow } from '@/lib/maintenance-engine'

/** Reminders due in the next 24 hours, with the message each person will get. */
export async function GET() {
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const until = new Date(Date.now() + 24 * 3600000).toISOString()
  const { data: reminders } = await c.supabase
    .from('maintenance_reminders')
    .select('id, task_id, scheduled_for')
    .eq('status', 'pending')
    .lte('scheduled_for', until)
    .order('scheduled_for')
    .limit(100)
  const taskIds = [...new Set((reminders ?? []).map((r) => r.task_id))]
  const [{ data: tasks }, { data: staff }] = await Promise.all([
    taskIds.length ? c.supabase.from('maintenance_tasks').select('*').in('id', taskIds) : Promise.resolve({ data: [] }),
    c.supabase.from('maintenance_staff').select('*'),
  ])
  const ctx = await loadEngineContext(c.tenantId)
  const taskById = new Map((tasks ?? []).map((t) => [t.id, t as TaskRow]))
  const staffById = new Map((staff ?? []).map((s) => [s.id, s as StaffRow]))
  return NextResponse.json({
    timezone: ctx.tz,
    reminders: (reminders ?? [])
      .filter((r) => taskById.has(r.task_id))
      .map((r) => {
        const t = taskById.get(r.task_id)!
        const s = t.assigned_to ? staffById.get(t.assigned_to) ?? null : null
        return {
          id: r.id,
          scheduled_for: r.scheduled_for,
          task_code: t.task_code,
          title: t.title,
          priority: t.priority,
          staff: s?.name ?? 'Auto-assign at send time',
          preview: reminderPreview(t, s, ctx.tz),
        }
      }),
  })
}
