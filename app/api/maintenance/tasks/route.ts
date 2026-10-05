import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'
import { cleanTask, type TaskInput } from '@/lib/maintenance-tasks'
import { loadEngineContext, logEvent, newTaskCode, scheduleReminder } from '@/lib/maintenance-engine'

async function tenantTz(supabase: Awaited<ReturnType<typeof maintenanceCaller>> & object) {
  if ('error' in supabase) return 'America/Mexico_City'
  const { data } = await supabase.supabase.from('tenants').select('timezone').eq('id', supabase.tenantId).single()
  return (data?.timezone as string) || 'America/Mexico_City'
}

export async function GET() {
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const [{ data: active }, { data: recent }, { count: completedAll }] = await Promise.all([
    c.supabase.from('maintenance_tasks').select('*').in('status', ['scheduled', 'waiting', 'in_progress', 'on_hold']).order('due_at').limit(500),
    c.supabase
      .from('maintenance_tasks')
      .select('*')
      .in('status', ['done', 'cancelled'])
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(300),
    c.supabase.from('maintenance_tasks').select('id', { count: 'exact', head: true }).eq('status', 'done'),
  ])
  const all = [...(active ?? []), ...(recent ?? [])]
  return NextResponse.json({
    tasks: all,
    timezone: await tenantTz(c),
    stats: {
      open: (active ?? []).filter((t) => t.status !== 'on_hold').length,
      inProgress: (active ?? []).filter((t) => t.status === 'in_progress').length,
      needAttention: (active ?? []).filter((t) => t.escalation_status === 'required').length,
      completed: completedAll ?? 0,
    },
  })
}

export async function POST(request: Request) {
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const tz = await tenantTz(c)
  const body = (await request.json()) as TaskInput
  const onHold = Boolean(body.on_hold)
  const { values, error } = cleanTask(body, false, tz)
  if (error) return NextResponse.json({ error }, { status: 400 })

  const ctx = await loadEngineContext(c.tenantId)
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error: dbError } = await c.supabase
      .from('maintenance_tasks')
      .insert({ tenant_id: c.tenantId, task_code: newTaskCode(), status: onHold ? 'on_hold' : 'scheduled', created_by: c.staffUserId, ...values })
      .select()
      .single()
    if (dbError?.code === '23505') continue
    if (dbError || !data) return NextResponse.json({ error: dbError?.message ?? 'Could not save' }, { status: 500 })
    if (onHold) {
      await logEvent(ctx, data.id as string, 'created', 'Follow-up task created — on hold until another task starts it')
    } else {
      const due = new Date(data.due_at as string)
      await scheduleReminder(ctx, data.id as string, due.getTime() > Date.now() ? due : new Date())
      await logEvent(ctx, data.id as string, 'created', 'Task created from the dashboard')
    }
    return NextResponse.json({ task: data })
  }
  return NextResponse.json({ error: 'Could not create a task code, try again' }, { status: 500 })
}
