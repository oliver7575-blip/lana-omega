'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'

interface ChatMessage {
  role: 'guest' | 'lana'
  content: string
}

export default function WidgetTestPage() {
  const params = useParams()
  const slug = params.slug as string
  const [visitorId, setVisitorId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || !visitorId) return

    const userMessage = input.trim()
    setMessages((prev) => [...prev, { role: 'guest', content: userMessage }])
    setInput('')
    setLoading(true)
    setError(null)

    const res = await fetch(`/api/widget/${slug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, message: userMessage }),
    })
    const json = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(json.error)
      return
    }
    setMessages((prev) => [...prev, { role: 'lana', content: json.reply }])
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
          <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'guest' ? 'right' : 'left' }}>
            <div
              style={{
                display: 'inline-block',
                padding: '8px 12px',
                borderRadius: 8,
                maxWidth: '80%',
                background: m.role === 'guest' ? '#dbeafe' : '#f0f0f0',
                whiteSpace: 'pre-wrap',
                textAlign: 'left',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && <p style={{ color: '#888' }}>Typing...</p>}
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
        <button type="submit" disabled={loading}>
          Send
        </button>
      </form>
    </main>
  )
}
