'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface StaffMember {
  id: string
  email: string
  full_name: string | null
  role: string
  created_at: string
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('staff')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function loadStaff() {
    setLoading(true)
    const res = await fetch('/api/staff')
    const json = await res.json()
    setStaff(json.staff ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadStaff()
  }, [])

  async function handleInvite() {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName, role }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
      return
    }
    setMessage(`Added ${email}.`)
    setShowForm(false)
    setEmail('')
    setPassword('')
    setFullName('')
    setRole('staff')
    loadStaff()
  }

  async function handleRemove(staffId: string, staffEmail: string) {
    if (!confirm(`Remove ${staffEmail}? This deletes their account entirely.`)) return
    setMessage(null)
    const res = await fetch('/api/staff', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId }),
    })
    const json = await res.json()
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
      return
    }
    setMessage(`Removed ${staffEmail}.`)
    loadStaff()
  }

  if (loading) {
    return <main style={{ maxWidth: 640, margin: '80px auto' }}>Loading...</main>
  }

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      <h1>Staff</h1>
      {message && <p>{message}</p>}

      {staff.map((s) => (
        <div
          key={s.id}
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 12,
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>{s.full_name || s.email}</strong> — {s.role}
            <br />
            <span style={{ color: '#888', fontSize: 13 }}>{s.email}</span>
          </div>
          <button onClick={() => handleRemove(s.id, s.email)}>Remove</button>
        </div>
      ))}

      {!showForm ? (
        <button onClick={() => setShowForm(true)} style={{ marginTop: 16 }}>
          + Invite staff member
        </button>
      ) : (
        <div style={{ marginTop: 16, border: '1px solid #ccc', borderRadius: 8, padding: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <label>Full name</label>
            <br />
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Email</label>
            <br />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Temporary password</label>
            <br />
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Role</label>
            <br />
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: 6 }}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <button disabled={saving} onClick={handleInvite}>
            {saving ? 'Adding...' : 'Add staff member'}
          </button>
          <button onClick={() => setShowForm(false)} style={{ marginLeft: 8 }}>
            Cancel
          </button>
        </div>
      )}
    </main>
  )
}
