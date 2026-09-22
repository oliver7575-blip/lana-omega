import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ConversationsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, channel, status, guest_id, last_message_at, created_at')
    .order('last_message_at', { ascending: false, nullsFirst: false })

  const guestIds = [...new Set((conversations ?? []).map((c) => c.guest_id).filter(Boolean))]

  let guestsById: Record<string, { phone: string; name: string | null }> = {}
  if (guestIds.length > 0) {
    const { data: guests } = await supabase
      .from('guests')
      .select('id, phone, name')
      .in('id', guestIds)
    guestsById = Object.fromEntries((guests ?? []).map((g) => [g.id, g]))
  }

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Conversations</h1>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      {(conversations ?? []).length === 0 && <p>No conversations yet.</p>}
      {(conversations ?? []).map((c) => {
        const guest = c.guest_id ? guestsById[c.guest_id] : null
        return (
          <div
            key={c.id}
            style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, marginBottom: 12 }}
          >
            <Link href={`/conversations/${c.id}`}>
              <strong>{guest?.name || guest?.phone || 'Unknown guest'}</strong>
            </Link>
            <br />
            <span style={{ color: '#888' }}>
              {c.channel} · {c.status} · last message:{' '}
              {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—'}
            </span>
          </div>
        )
      })}
    </main>
  )
}
