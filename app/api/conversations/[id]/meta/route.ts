import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Chat assignment and internal notes for a conversation. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { assigned_staff_id?: string | null; notes?: string }
  const updates: { assigned_staff_id?: string | null; notes?: string | null } = {}
  if (body.assigned_staff_id !== undefined) updates.assigned_staff_id = body.assigned_staff_id || null
  if (typeof body.notes === 'string') {
    if (body.notes.length > 5000) return NextResponse.json({ error: 'Notes are too long' }, { status: 400 })
    updates.notes = body.notes.trim() || null
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  // RLS keeps this to the caller's own hotel.
  const { data, error } = await supabase.from('conversations').update(updates).eq('id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
