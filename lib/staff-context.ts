import { redirect } from 'next/navigation'
import { createClient } from './supabase/server'

/** Signed-in staff member for server pages (redirects to /login if signed out). */
export async function requireStaff() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staff } = await supabase
    .from('staff_users')
    .select('id, tenant_id, role, full_name, email')
    .eq('auth_uid', user.id)
    .single()

  const { data: tenant } = staff
    ? await supabase.from('tenants').select('name, timezone').eq('id', staff.tenant_id).single()
    : { data: null }

  return {
    supabase,
    user,
    staff: staff as { id: string; tenant_id: string; role: string; full_name: string | null; email: string | null } | null,
    timezone: (tenant?.timezone as string) || 'America/Mexico_City',
  }
}
