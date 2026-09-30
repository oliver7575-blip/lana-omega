import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'
import { completeTask, loadEngineContext, type TaskRow } from '@/lib/maintenance-engine'

/** Bulk actions on selected tasks: { ids, action: 'mark_done' | 'delete' } */
export async function POST(request: Request) {
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { ids, action } = (await request.json()) as { ids?: string[]; action?: string }
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: 'Select at least one task' }, { status: 400 })
  const list = ids.slice(0, 200)
  if (action === 'delete') {
    const { error } = await c.supabase.from('maintenance_tasks').delete().in('id', list)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (action === 'mark_done') {
    const ctx = await loadEngineContext(c.tenantId)
    const { data: tasks } = await c.supabase.from('maintenance_tasks').select('*').in('id', list).in('status', ['scheduled', 'waiting', 'in_progress'])
    for (const t of tasks ?? []) await completeTask(ctx, t as TaskRow, { source: 'dashboard' })
    return NextResponse.json({ ok: true, count: (tasks ?? []).length })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
