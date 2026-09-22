import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Home() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('role, tenants(name, status)')
    .eq('auth_uid', user.id)
    .single()

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Welcome to Lana Omega</h1>
      {staffRow ? (
        <>
          <p>
            Signed in as <strong>{user.email}</strong> ({staffRow.role})
          </p>
          <p>
            Tenant: <strong>{staffRow.tenants?.[0]?.name}</strong> — status: {staffRow.tenants?.[0]?.status}
          </p>
        </>
      ) : (
        <p>Signed in, but no tenant record found for this account.</p>
      )}
    </main>
  )
}
