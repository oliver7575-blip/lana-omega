'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ConversationControls({
  conversationId,
  initialStatus,
}: {
  conversationId: string
  initialStatus: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleTakeover() {
    const newStatus = status === 'human_takeover' ? 'active' : 'human_takeover'
    const res = await fetch(`/api/conversations/${conversationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      setStatus(newStatus)
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim()) return

    setSending(true)
    setError(null)

    const res = await fetch(`/api/conversations/${conversationId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: reply }),
    })
    const json = await res.json()
    setSending(false)

    if (!res.ok) {
      setError(json.error)
      return
    }

    if (json.deliveryResult && json.deliveryResult.success === false) {
      setError(`Message saved, but delivery failed: ${json.deliveryResult.error}`)
    }

    setReply('')
    router.refresh()
  }

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
      <button
        onClick={toggleTakeover}
        style={{
          marginBottom: 12,
          background: status === 'human_takeover' ? '#fee2e2' : '#f0f0f0',
        }}
      >
        {status === 'human_takeover'
          ? '✓ You have taken over — click to hand back to AI'
          : 'Take over this conversation'}
      </button>

      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8 }}>
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply as staff..."
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={sending}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {status !== 'human_takeover' && (
        <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          Sending a reply here does not automatically pause the AI — take over first if you want
          the AI to stop auto-replying.
        </p>
      )}
    </div>
  )
}
