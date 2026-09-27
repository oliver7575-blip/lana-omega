'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function GuestNameEditor({
  guestId,
  initialName,
  fallbackLabel,
}: {
  guestId: string
  initialName: string | null
  fallbackLabel: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch(`/api/guests/${guestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
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
      <form onSubmit={handleSave} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Guest name"
          autoFocus
          style={{ padding: 4, fontSize: 'inherit', fontWeight: 'inherit' }}
        />
        <button type="submit" disabled={saving} style={{ fontSize: 13 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} style={{ fontSize: 13 }}>
          Cancel
        </button>
        {error && <span style={{ color: 'red', fontSize: 13 }}>{error}</span>}
      </form>
    )
  }

  return (
    <span>
      {initialName || fallbackLabel}{' '}
      <button
        onClick={() => setEditing(true)}
        style={{ fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        edit
      </button>
    </span>
  )
}
