import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, channel, status, guest_id')
    .eq('id', id)
    .single()

  if (!conversation) {
    return (
      <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <p>Conversation not found.</p>
        <Link href="/conversations">← Back to conversations</Link>
      </main>
    )
  }

  let guest: { phone: string; name: string | null } | null = null
  if (conversation.guest_id) {
    const { data: guestRow } = await supabase
      .from('guests')
      .select('phone, name')
      .eq('id', conversation.guest_id)
      .single()
    guest = guestRow
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('id, sender_type, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/conversations">← Back to conversations</Link>
      </p>
      <h1>{guest?.name || guest?.phone || 'Unknown guest'}</h1>
      <p style={{ color: '#888' }}>
        {conversation.channel} · {conversation.status}
      </p>

      <div style={{ marginTop: 24 }}>
        {(messages ?? []).map((m) => (
          <div
            key={m.id}
            style={{ marginBottom: 12, textAlign: m.sender_type === 'guest' ? 'left' : 'right' }}
          >
            <div
              style={{
                display: 'inline-block',
                padding: '8px 12px',
                borderRadius: 8,
                maxWidth: '80%',
                background:
                  m.sender_type === 'guest'
                    ? '#f0f0f0'
                    : m.sender_type === 'lana'
                      ? '#dbeafe'
                      : '#dcfce7',
                whiteSpace: 'pre-wrap',
              }}
            >
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                {m.sender_type} · {new Date(m.created_at).toLocaleString()}
              </div>
              {m.content}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
