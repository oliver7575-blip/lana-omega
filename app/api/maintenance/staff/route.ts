import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizePhone } from '@/lib/phone'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('maintenance_staff')
    .select('*')
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('tenant_id')
    .eq('auth_uid', user.id)
    .single()
  if (!staffRow) return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })

  const body = (await request.json()) as { name?: string; phone?: string }
  if (!body.name?.trim() || !body.phone?.trim()) {
    return NextResponse.json({ error: 'name and phone are required' }, { status: 400 })
  }
  // Stored digits-only (with country code), the same form WhatsApp uses.
  const phone = normalizePhone(body.phone)
  if (phone.length < 8) {
    return NextResponse.json(
      { error: 'Enter the full phone number including country code, e.g. +52 958 123 4567' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('maintenance_staff')
    .insert({ tenant_id: staffRow.tenant_id, name: body.name.trim(), phone })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}
