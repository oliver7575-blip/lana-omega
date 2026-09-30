'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface WaitlistEntry {
  id: string
  full_name: string
  email: string
  phone: string
  date_requested: string
  notes: string | null
  status: string
  created_at: string
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/waitlist')
      .then((res) => res.json())
      .then((json) => {
        setEntries(json.entries ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <main style={{ maxWidth: 720, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/cloudbeds">← Dashboard</Link>
      </p>
      <h1>Waitlist</h1>

      {loading && <p>Loading...</p>}
      {!loading && entries.length === 0 && <p style={{ color: 'rgba(231,233,240,0.55)' }}>No waitlist entries yet.</p>}

      {entries.map((entry) => (
        <div
          key={entry.id}
          style={{
            border: '1px solid #232a40',
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
          }}
        >
          <strong>{entry.full_name}</strong>{' '}
          <span style={{ color: 'rgba(231,233,240,0.55)', fontSize: 13 }}>
            — {new Date(entry.created_at).toLocaleString()}
          </span>
          <p style={{ margin: '8px 0' }}>
            Wants: <strong>{entry.date_requested}</strong>
          </p>
          <p style={{ margin: '4px 0', fontSize: 14 }}>
            {entry.email} · {entry.phone}
          </p>
          {entry.notes && <p style={{ margin: '8px 0', fontSize: 14 }}>Notes: {entry.notes}</p>}
          <span
            style={{
              display: 'inline-block',
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 4,
              background: entry.status === 'pending' ? 'rgba(245,158,11,0.15)' : '#232a40',
            }}
          >
            {entry.status}
          </span>
        </div>
      ))}
    </main>
  )
}
