'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function SettingsPage() {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/tenant')
      .then((res) => res.json())
      .then((json) => {
        if (json.tenant) {
          setName(json.tenant.name)
          setPrompt(json.tenant.ai_persona_prompt)
          setStatus(json.tenant.status)
          setRole(json.role)
        }
        setLoading(false)
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ai_persona_prompt: prompt }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
      return
    }
    setMessage('Saved.')
  }

  if (loading) {
    return <main style={{ maxWidth: 640, margin: '80px auto' }}>Loading...</main>
  }

  const canEdit = role === 'owner' || role === 'admin'

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      <h1>Settings</h1>
      <p style={{ color: '#888' }}>Status: {status}</p>

      {!canEdit && (
        <p style={{ color: '#b45309' }}>
          Your role ({role}) can view these settings but only an owner or admin can edit them.
        </p>
      )}

      <div style={{ marginBottom: 16 }}>
        <label>
          <strong>Hotel name</strong>
        </label>
        <br />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          style={{ width: '100%', padding: 8, marginTop: 4 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label>
          <strong>AI persona &amp; policies</strong>
        </label>
        <br />
        <span style={{ fontSize: 13, color: '#888' }}>
          This is the full system prompt guiding your AI concierge — persona, tone, policies, and
          key facts, all in one place.
        </span>
        <br />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!canEdit}
          rows={20}
          style={{ width: '100%', padding: 8, marginTop: 4, fontFamily: 'monospace', fontSize: 13 }}
        />
      </div>

      {canEdit && (
        <button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      )}
      {message && <p>{message}</p>}
    </main>
  )
}
