import { NextResponse } from 'next/server'
import { maintenanceCaller } from '@/lib/maintenance-auth'
import { cleanStaff, type StaffInput } from '@/lib/maintenance-staff'

export async function GET() {
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { data, error } = await c.supabase.from('maintenance_staff').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff: data ?? [] })
}

export async function POST(request: Request) {
  const c = await maintenanceCaller()
  if ('error' in c) return c.error
  const { values, error } = cleanStaff((await request.json()) as StaffInput, false)
  if (error) return NextResponse.json({ error }, { status: 400 })
  const { data, error: dbError } = await c.supabase
    .from('maintenance_staff')
    .insert({ tenant_id: c.tenantId, active: true, ...values })
    .select()
    .single()
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}
