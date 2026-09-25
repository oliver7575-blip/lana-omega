'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'

interface ChatMessage {
  sender_type: 'guest' | 'lana' | 'staff'
  content: string
  created_at: string
}

export default function WidgetTestPage() {
  const params = useParams()
  const slug = params.slug as string
  const [visitorId, setVisitorId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const storageKey = `widget-visitor-${slug}`
    let id = localStorage.getItem(storageKey)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(storageKey, id)
    }
    setVisitorId(id)
  }, [slug])

  async function fetchHistory(id: string) {
    const res = await fetch(`/api/widget/${slug}/chat?visitorId=${id}`)
    const json = await res.json()
    if (res.ok) {
      setMessages(json.messages ?? [])
    }
  }

  // Load real history on mount (fixes losing the conversation on refresh),
  // then poll every 4 seconds to pick up anything added from elsewhere —
  // most importantly, a staff reply sent from the dashboard during human
  // takeover, which otherwise never reaches this page at all.
  useEffect(() => {
    if (!visitorId) return
    fetchHistory(visitorId)
    const interval = setInterval(() => fetchHistory(visitorId), 4000)
    return () => clearInterval(interval)
  }, [visitorId, slug])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || !visitorId) return

    const userMessage = input.trim()
    setInput('')
    setSending(true)
    setError(null)

    const res = await fetch(`/api/widget/${slug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, message: userMessage }),
    })
    const json = await res.json()
    setSending(false)

    if (!res.ok) {
      setError(json.error)
      return
    }

    // Refetch full history right away rather than hand-appending just this
    // one exchange — keeps this view and the polling path using the exact
    // same source of truth instead of two slightly different code paths.
    fetchHistory(visitorId)
  }

  return (
    <main style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 18 }}>Chat with {slug}</h1>
      <div
        style={{
          border: '1px solid #ccc',
          borderRadius: 8,
          height: 400,
          overflowY: 'auto',
          padding: 12,
          marginBottom: 12,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{ marginBottom: 10, textAlign: m.sender_type === 'guest' ? 'right' : 'left' }}
          >
            <div
              style={{
                display: 'inline-block',
                padding: '8px 12px',
                borderRadius: 8,
                maxWidth: '80%',
                background:
                  m.sender_type === 'guest'
                    ? '#dbeafe'
                    : m.sender_type === 'staff'
                      ? '#dcfce7'
                      : '#f0f0f0',
                whiteSpace: 'pre-wrap',
                textAlign: 'left',
              }}
            >
              {m.sender_type === 'staff' && (
                <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Staff</div>
              )}
              {m.content}
            </div>
          </div>
        ))}
        {sending && <p style={{ color: '#888' }}>Sending...</p>}
        <div ref={bottomRef} />
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={sending}>
          Send
        </button>
      </form>
    </main>
  )
}
