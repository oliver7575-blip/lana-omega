import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: statusFilter } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  let query = supabase
    .from('conversations')
    .select('id, channel, status, guest_id, last_message_at, created_at')
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (statusFilter && ['active', 'human_takeover', 'closed'].includes(statusFilter)) {
    query = query.eq('status', statusFilter)
  } else {
    // Default view: hide closed conversations unless explicitly asked for —
    // otherwise every closed thread piles up here forever with no way to
    // get them out of the way.
    query = query.neq('status', 'closed')
  }

  const { data: conversations } = await query

  const { count: takeoverCount } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'human_takeover')

  const guestIds = [...new Set((conversations ?? []).map((c) => c.guest_id).filter(Boolean))]

  let guestsById: Record<string, { phone: string; name: string | null }> = {}
  if (guestIds.length > 0) {
    const { data: guests } = await supabase
      .from('guests')
      .select('id, phone, name')
      .in('id', guestIds)
    guestsById = Object.fromEntries((guests ?? []).map((g) => [g.id, g]))
  }

  const filters: { label: string; value: string | undefined }[] = [
    { label: 'Open', value: undefined },
    { label: 'Active', value: 'active' },
    { label: `Needs staff${(takeoverCount ?? 0) > 0 ? ` (${takeoverCount})` : ''}`, value: 'human_takeover' },
    { label: 'Closed', value: 'closed' },
  ]

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      <h1>Conversations</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {filters.map((f) => {
          const isActive = (statusFilter ?? undefined) === f.value
          const href = f.value ? `/conversations?status=${f.value}` : '/conversations'
          return (
            <Link
              key={f.label}
              href={href}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                textDecoration: 'none',
                fontSize: 13,
                color: isActive ? 'white' : '#333',
                background: isActive
                  ? f.value === 'human_takeover'
                    ? '#b91c1c'
                    : '#1e3a8a'
                  : '#f0f0f0',
              }}
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      {(conversations ?? []).length === 0 && <p style={{ color: '#888' }}>No conversations here.</p>}
      {(conversations ?? []).map((c) => {
        const guest = c.guest_id ? guestsById[c.guest_id] : null
        return (
          <Link
            key={c.id}
            href={`/conversations/${c.id}`}
            style={{
              display: 'block',
              border: c.status === 'human_takeover' ? '1px solid #fca5a5' : '1px solid #ccc',
              background: c.status === 'human_takeover' ? '#fef2f2' : undefined,
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <strong>{guest?.name || guest?.phone || 'Unknown guest'}</strong>
            {c.status === 'human_takeover' && ' 🔴'}
            <br />
            <span style={{ color: '#888' }}>
              {c.channel} · {c.status} · last message:{' '}
              {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—'}
            </span>
          </Link>
        )
      })}
    </main>
  )
}
