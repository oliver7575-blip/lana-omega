import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SignOutButton from '@/components/SignOutButton'

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
    .select('role, tenant_id')
    .eq('auth_uid', user.id)
    .single()

  let tenant: { name: string; status: string } | null = null
  if (staffRow?.tenant_id) {
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('name, status')
      .eq('id', staffRow.tenant_id)
      .single()
    tenant = tenantRow
  }

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Welcome to Lana Omega</h1>
      {staffRow ? (
        <>
          <p>
            Signed in as <strong>{user.email}</strong> ({staffRow.role})
          </p>
          <p>
            Tenant: <strong>{tenant?.name ?? '—'}</strong> — status: {tenant?.status ?? '—'}
          </p>
          <p>
            <a href="/integrations">Integrations</a>
            {' · '}
            <a href="/conversations">Conversations</a>
          </p>
          <SignOutButton />
        </>
      ) : (
        <p>Signed in, but no tenant record found for this account.</p>
      )}
    </main>
  )
}
