import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { monthCosts } from '@/lib/costs'

export const maxDuration = 60

/** ?month=YYYY-MM (defaults to the current month) */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: staff } = await supabase.from('staff_users').select('tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })

  const param = new URL(request.url).searchParams.get('month')
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : new Date().toISOString().slice(0, 7)
  return NextResponse.json(await monthCosts(staff.tenant_id as string, month))
}
