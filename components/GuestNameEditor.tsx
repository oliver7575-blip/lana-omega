'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function GuestNameEditor({
  guestId,
  initialName,
  initialEmail,
  fallbackLabel,
}: {
  guestId: string
  initialName: string | null
  initialEmail?: string | null
  fallbackLabel: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName ?? '')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch(`/api/guests/${guestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    })
    const json = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(json.error)
      return
    }

    setEditing(false)
    router.refresh()
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} style={{ display: 'inline-block' }}>
        <div style={{ marginBottom: 6 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Guest name"
            autoFocus
            style={{ padding: 4, fontSize: 'inherit', fontWeight: 'inherit', marginRight: 6 }}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            type="email"
            style={{ padding: 4, fontSize: 14, fontWeight: 'normal' }}
          />
        </div>
        <button type="submit" disabled={saving} style={{ fontSize: 13 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} style={{ fontSize: 13, marginLeft: 6 }}>
          Cancel
        </button>
        {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
      </form>
    )
  }

  return (
    <span>
      {initialName || fallbackLabel}{' '}
      <button
        onClick={() => setEditing(true)}
        style={{ fontSize: 12, color: 'rgba(231,233,240,0.55)', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        edit
      </button>
      {initialEmail && (
        <div style={{ fontSize: 13, color: 'rgba(231,233,240,0.55)', fontWeight: 'normal' }}>{initialEmail}</div>
      )}
    </span>
  )
}
