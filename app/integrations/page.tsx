'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { INTEGRATIONS, type IntegrationType } from '@/lib/integrations'

interface IntegrationStatus {
  integration_type: IntegrationType
  status: 'disconnected' | 'connected' | 'error'
  config: Record<string, string> | null
  connected_at: string | null
  last_checked_at: string | null
  last_check_ok: boolean | null
  last_error: string | null
}

const TESTABLE: IntegrationType[] = ['whatsapp', 'pms_cloudbeds', 'transcription_deepgram', 'costs_anthropic']

export default function IntegrationsPage() {
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>({})
  const [loading, setLoading] = useState(true)
  const [openForm, setOpenForm] = useState<IntegrationType | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<IntegrationType | null>(null)
  const [testDetail, setTestDetail] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  async function loadStatuses() {
    const res = await fetch('/api/integrations')
    const json = await res.json()
    const map: Record<string, IntegrationStatus> = {}
    for (const row of json.integrations ?? []) {
      map[row.integration_type] = row
    }
    setStatuses(map)
    setLoading(false)
  }

  useEffect(() => {
    loadStatuses()
  }, [])

  function openConnectForm(type: IntegrationType) {
    setOpenForm(type)
    setFormValues({})
    setMessage(null)
  }

  async function handleConnect(type: IntegrationType) {
    setSaving(true)
    setMessage(null)

    const def = INTEGRATIONS.find((d) => d.type === type)!
    const credentials: Record<string, string> = {}
    const config: Record<string, string> = {}
    for (const field of def.credentialFields) {
      if (formValues[field.key]) credentials[field.key] = formValues[field.key]
    }
    for (const field of def.configFields) {
      if (formValues[field.key]) config[field.key] = formValues[field.key]
    }

    const res = await fetch('/api/integrations/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrationType: type, credentials, config }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
      return
    }
    setOpenForm(null)
    setTestDetail((prev) => ({ ...prev, [type]: '' }))
    setMessage('Connected successfully.')
    loadStatuses()
  }

  async function handleDisconnect(type: IntegrationType) {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/integrations/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrationType: type }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
      return
    }
    setMessage('Disconnected.')
    loadStatuses()
  }

  async function handleTest(type: IntegrationType) {
    setTesting(type)
    setMessage(null)
    try {
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationType: type }),
      })

      // Read as text first: a timeout or crash returns a non-JSON error
      // page, and parsing that directly is what used to freeze the button.
      const text = await res.text()
      let json: { ok?: boolean; detail?: string; error?: string } | null = null
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }

      if (!json) {
        setMessage(
          `Test failed: the server returned an unexpected response (HTTP ${res.status}). It may have timed out.`
        )
        return
      }
      if (!res.ok) {
        setMessage(`Error: ${json.error ?? `HTTP ${res.status}`}`)
        return
      }
      setTestDetail((prev) => ({ ...prev, [type]: json?.detail ?? '' }))
      await loadStatuses()
    } catch (err) {
      setMessage(`Test failed: ${err instanceof Error ? err.message : 'network error'}`)
    } finally {
      setTesting(null)
    }
  }

  if (loading) {
    return <main style={{ maxWidth: 640, margin: '80px auto' }}>Loading...</main>
  }

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      <h1>Integrations</h1>
      {message && <p>{message}</p>}
      {INTEGRATIONS.map((def) => {
        const status = statuses[def.type]
        const isConnected = status?.status === 'connected'
        const canTest = isConnected && TESTABLE.includes(def.type)
        const checked = status?.last_checked_at != null
        const healthy = status?.last_check_ok === true
        return (
          <div
            key={def.type}
            style={{ border: '1px solid #232a40', borderRadius: 8, padding: 16, marginBottom: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{def.label}</strong>
                <br />
                <span style={{ color: isConnected ? 'green' : 'rgba(231,233,240,0.55)' }}>
                  {isConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {canTest && (
                  <button disabled={testing !== null || saving} onClick={() => handleTest(def.type)}>
                    {testing === def.type ? 'Testing...' : 'Test connection'}
                  </button>
                )}
                {isConnected ? (
                  <button disabled={saving} onClick={() => handleDisconnect(def.type)}>
                    Disconnect
                  </button>
                ) : (
                  <button disabled={saving} onClick={() => openConnectForm(def.type)}>
                    Connect
                  </button>
                )}
              </div>
            </div>

            {isConnected && checked && (
              <div
                style={{
                  marginTop: 12,
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 13,
                  background: healthy ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                  color: healthy ? '#6ee7b7' : '#fca5a5',
                }}
              >
                {healthy ? '✓ Last check passed' : '✗ Last check failed'} ·{' '}
                {new Date(status.last_checked_at!).toLocaleString()}
                {healthy && testDetail[def.type] && <div>{testDetail[def.type]}</div>}
                {!healthy && status.last_error && (
                  <div style={{ marginTop: 4, wordBreak: 'break-word' }}>{status.last_error}</div>
                )}
              </div>
            )}
            {canTest && !checked && (
              <p style={{ fontSize: 12, color: 'rgba(231,233,240,0.55)', marginBottom: 0 }}>Not tested yet.</p>
            )}

            {openForm === def.type && (
              <div style={{ marginTop: 16 }}>
                {[...def.configFields, ...def.credentialFields].map((field) => (
                  <div key={field.key} style={{ marginBottom: 8 }}>
                    <label>{field.label}</label>
                    <br />
                    <input
                      type={field.type}
                      value={formValues[field.key] ?? ''}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      style={{ width: '100%', padding: 6 }}
                    />
                  </div>
                ))}
                <button disabled={saving} onClick={() => handleConnect(def.type)}>
                  {saving ? 'Saving...' : 'Save & Connect'}
                </button>
                <button onClick={() => setOpenForm(null)} style={{ marginLeft: 8 }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )
      })}
    </main>
  )
}
