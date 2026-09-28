import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tasks, error } = await supabase
    .from('maintenance_tasks')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Split into two separate queries rather than a PostgREST embedded
  // relationship — matches the established fix for the RLS-embedding
  // gotcha found earlier in this project.
  const { data: staff } = await supabase.from('maintenance_staff').select('id, name')
  const staffMap = new Map((staff ?? []).map((s) => [s.id, s.name]))

  const enriched = (tasks ?? []).map((t) => ({
    ...t,
    assigned_to_name: t.assigned_to ? staffMap.get(t.assigned_to) ?? null : null,
  }))

  return NextResponse.json({ tasks: enriched })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('id, tenant_id')
    .eq('auth_uid', user.id)
    .single()
  if (!staffRow) return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })

  const body = (await request.json()) as {
    title?: string
    description?: string
    due_date?: string
    assigned_to?: string
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('maintenance_tasks')
    .insert({
      tenant_id: staffRow.tenant_id,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      due_date: body.due_date || null,
      assigned_to: body.assigned_to || null,
      created_by: staffRow.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    id?: string
    status?: string
    assigned_to?: string | null
  }
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const updates: { status?: string; assigned_to?: string | null } = {}
  if (body.status) updates.status = body.status
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('maintenance_tasks')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  return NextResponse.json({ task: data })
}
