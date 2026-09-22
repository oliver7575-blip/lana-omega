'use client'

import { useEffect, useState } from 'react'
import { INTEGRATIONS, type IntegrationType } from '@/lib/integrations'

interface IntegrationStatus {
  integration_type: IntegrationType
  status: 'disconnected' | 'connected' | 'error'
  config: Record<string, string> | null
  connected_at: string | null
}

export default function IntegrationsPage() {
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>({})
  const [loading, setLoading] = useState(true)
  const [openForm, setOpenForm] = useState<IntegrationType | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function loadStatuses() {
    setLoading(true)
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
    const res = await fetch('/api/integrations/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrationType: type, credentials: formValues }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
      return
    }
    setOpenForm(null)
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

  if (loading) {
    return <main style={{ maxWidth: 640, margin: '80px auto' }}>Loading...</main>
  }

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Integrations</h1>
      {message && <p>{message}</p>}
      {INTEGRATIONS.map((def) => {
        const status = statuses[def.type]
        const isConnected = status?.status === 'connected'
        return (
          <div
            key={def.type}
            style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, marginBottom: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{def.label}</strong>
                <br />
                <span style={{ color: isConnected ? 'green' : '#888' }}>
                  {isConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <div>
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

            {openForm === def.type && (
              <div style={{ marginTop: 16 }}>
                {def.credentialFields.map((field) => (
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
