'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

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

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordMessage(null)

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setChangingPassword(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)

    if (error) {
      setPasswordError(error.message)
      return
    }

    setPasswordMessage('Password updated.')
    setNewPassword('')
    setConfirmPassword('')
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    const res = await fetch('/api/tenant', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName }),
    })
    const json = await res.json()
    setDeleting(false)
    if (!res.ok) {
      setDeleteError(json.error)
      return
    }
    router.push('/login')
  }

  if (loading) {
    return <main style={{ maxWidth: 640, margin: '80px auto' }}>Loading...</main>
  }

  const canEdit = role === 'owner' || role === 'admin'
  const canDelete = role === 'owner'

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

      <div style={{ marginTop: 48, borderTop: '1px solid #eee', paddingTop: 16 }}>
        <h2>Your account</h2>
        <form onSubmit={handleChangePassword}>
          <div style={{ marginBottom: 8 }}>
            <label>New password (min 8 characters)</label>
            <br />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ width: '100%', padding: 8 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Confirm new password</label>
            <br />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{ width: '100%', padding: 8 }}
            />
          </div>
          {passwordError && <p style={{ color: 'red' }}>{passwordError}</p>}
          {passwordMessage && <p style={{ color: 'green' }}>{passwordMessage}</p>}
          <button type="submit" disabled={changingPassword}>
            {changingPassword ? 'Updating...' : 'Change password'}
          </button>
        </form>
      </div>

      {canDelete && (
        <div style={{ marginTop: 48, borderTop: '1px solid #f0c0c0', paddingTop: 16 }}>
          <h2 style={{ color: '#b91c1c' }}>Danger zone</h2>
          {!showDeleteForm ? (
            <button onClick={() => setShowDeleteForm(true)} style={{ color: '#b91c1c' }}>
              Delete this hotel account
            </button>
          ) : (
            <div>
              <p>
                This permanently deletes <strong>{name}</strong>, every staff account, every
                integration, and every guest conversation. This cannot be undone.
              </p>
              <p>
                Type <strong>{name}</strong> to confirm:
              </p>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                style={{ width: '100%', padding: 8, marginBottom: 8 }}
              />
              {deleteError && <p style={{ color: 'red' }}>{deleteError}</p>}
              <button
                onClick={handleDelete}
                disabled={deleting || confirmName !== name}
                style={{ color: '#b91c1c' }}
              >
                {deleting ? 'Deleting...' : 'Permanently delete'}
              </button>
              <button onClick={() => setShowDeleteForm(false)} style={{ marginLeft: 8 }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
