import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'
import { cleanStaff, type StaffInput } from '@/lib/maintenance-staff'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { values, error } = cleanStaff((await request.json()) as StaffInput, true)
  if (error) return NextResponse.json({ error }, { status: 400 })
  const { data, error: dbError } = await c.supabase.from('maintenance_staff').update(values!).eq('id', id).select().single()
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  // Their open tasks go back to the pool (assigned_to is cleared automatically).
  const { error } = await c.supabase.from('maintenance_staff').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
