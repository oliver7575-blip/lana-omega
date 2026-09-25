import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
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

  if (!staffRow) {
    return (
      <main style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h1>Welcome to Lana Omega</h1>
        <p>Signed in, but no tenant record found for this account.</p>
        <SignOutButton />
      </main>
    )
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, status')
    .eq('id', staffRow.tenant_id)
    .single()

  const { count: activeCount } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')

  const { count: takeoverCount } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'human_takeover')

  const { data: recentConversations } = await supabase
    .from('conversations')
    .select('id, channel, status, guest_id, last_message_at')
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(5)

  const guestIds = [...new Set((recentConversations ?? []).map((c) => c.guest_id).filter(Boolean))]

  let guestsById: Record<string, { phone: string; name: string | null }> = {}
  if (guestIds.length > 0) {
    const { data: guests } = await supabase
      .from('guests')
      .select('id, phone, name')
      .in('id', guestIds)
    guestsById = Object.fromEntries((guests ?? []).map((g) => [g.id, g]))
  }

  return (
    <main style={{ maxWidth: 640, margin: '60px auto', fontFamily: 'sans-serif' }}>
      <h1>{tenant?.name ?? 'Welcome to Lana Omega'}</h1>
      <p style={{ color: '#888' }}>
        Signed in as <strong>{user.email}</strong> ({staffRow.role}) · Status: {tenant?.status}
      </p>

      <div style={{ display: 'flex', gap: 16, margin: '24px 0' }}>
        <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, flex: 1 }}>
          <div style={{ fontSize: 28, fontWeight: 'bold' }}>{activeCount ?? 0}</div>
          <div style={{ color: '#888', fontSize: 13 }}>Active conversations</div>
        </div>
        <div
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 16,
            flex: 1,
            background: (takeoverCount ?? 0) > 0 ? '#fee2e2' : undefined,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 'bold' }}>{takeoverCount ?? 0}</div>
          <div style={{ color: '#888', fontSize: 13 }}>Awaiting staff reply</div>
        </div>
      </div>

      <p>
        <Link href="/integrations">Integrations</Link>
        {' · '}
        <Link href="/conversations">Conversations</Link>
        {' · '}
        <Link href="/settings">Settings</Link>
        {' · '}
        <Link href="/staff">Staff</Link>
      </p>

      <h2 style={{ marginTop: 32, fontSize: 18 }}>Recent conversations</h2>
      {(recentConversations ?? []).length === 0 && (
        <p style={{ color: '#888' }}>No conversations yet.</p>
      )}
      {(recentConversations ?? []).map((c) => {
        const guest = c.guest_id ? guestsById[c.guest_id] : null
        return (
          <Link
            key={c.id}
            href={`/conversations/${c.id}`}
            style={{
              display: 'block',
              border: '1px solid #ccc',
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <strong>{guest?.name || guest?.phone || 'Unknown guest'}</strong>
            <br />
            <span style={{ color: '#888', fontSize: 13 }}>
              {c.channel} · {c.status}
              {c.status === 'human_takeover' && ' 🔴'}
              {c.last_message_at ? ` · ${new Date(c.last_message_at).toLocaleString()}` : ''}
            </span>
          </Link>
        )
      })}

      <div style={{ marginTop: 24 }}>
        <SignOutButton />
      </div>
    </main>
  )
}
