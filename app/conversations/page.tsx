import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

const PAGE_SIZE = 20

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const { status: statusFilter, q, page: pageParam } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let matchingGuestIds: string[] | null = null
  if (q && q.trim()) {
    const { data: matchingGuests } = await supabase
      .from('guests')
      .select('id')
      .or(`name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%,email.ilike.%${q.trim()}%`)
    matchingGuestIds = (matchingGuests ?? []).map((g) => g.id)
  }

  let query = supabase
    .from('conversations')
    .select('id, channel, status, guest_id, last_message_at, created_at', { count: 'exact' })
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (statusFilter && ['active', 'human_takeover', 'closed'].includes(statusFilter)) {
    query = query.eq('status', statusFilter)
  } else {
    query = query.neq('status', 'closed')
  }

  if (matchingGuestIds !== null) {
    query = query.in(
      'guest_id',
      matchingGuestIds.length > 0 ? matchingGuestIds : ['00000000-0000-0000-0000-000000000000']
    )
  }

  const { data: conversations, count: totalCount } = await query.range(from, to)

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

  function buildHref(newStatus: string | undefined, newQ: string | undefined, newPage?: number) {
    const params = new URLSearchParams()
    if (newStatus) params.set('status', newStatus)
    if (newQ) params.set('q', newQ)
    if (newPage && newPage > 1) params.set('page', String(newPage))
    const qs = params.toString()
    return qs ? `/conversations?${qs}` : '/conversations'
  }

  const total = totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      <h1>Conversations</h1>

      <form method="get" style={{ marginBottom: 16 }}>
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by name, phone, or email..."
          style={{ width: '100%', padding: 8 }}
        />
      </form>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {filters.map((f) => {
          const isActive = (statusFilter ?? undefined) === f.value
          return (
            <Link
              key={f.label}
              href={buildHref(f.value, q)}
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

      {q && (
        <p style={{ fontSize: 13, color: '#888' }}>
          Searching for "{q}" —{' '}
          <Link href={buildHref(statusFilter, undefined)} style={{ color: '#1e3a8a' }}>
            clear
          </Link>
        </p>
      )}

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

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          {page > 1 ? (
            <Link href={buildHref(statusFilter, q, page - 1)}>← Previous</Link>
          ) : (
            <span />
          )}
          <span style={{ fontSize: 13, color: '#888' }}>
            Page {page} of {totalPages} · {total} total
          </span>
          {page < totalPages ? (
            <Link href={buildHref(statusFilter, q, page + 1)}>Next →</Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </main>
  )
}
