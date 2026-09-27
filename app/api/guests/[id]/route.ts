import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as { name?: string }
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  // RLS scopes this to the caller's own tenant automatically, same as
  // everywhere else — no explicit tenant_id check needed here.
  const { data: updated, error } = await supabase
    .from('guests')
    .update({ name: name || null })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Guest not found' }, { status: 404 })
  }

  return NextResponse.json({ guest: updated })
}
