import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'

export async function GET() {
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { data: events } = await c.supabase
    .from('maintenance_task_events')
    .select('id, task_id, event_type, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(20)
  const ids = [...new Set((events ?? []).map((e) => e.task_id))]
  const { data: tasks } = ids.length
    ? await c.supabase.from('maintenance_tasks').select('id, title').in('id', ids)
    : { data: [] }
  const title = new Map((tasks ?? []).map((t) => [t.id, t.title]))
  return NextResponse.json({
    events: (events ?? []).map((e) => ({ ...e, task_title: title.get(e.task_id) ?? 'Deleted task' })),
  })
}
