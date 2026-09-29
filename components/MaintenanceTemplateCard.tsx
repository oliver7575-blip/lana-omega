'use client'

import { useEffect, useState } from 'react'

interface TemplateInfo {
  exists: boolean
  id?: string
  status?: string
  rejectedReason?: string | null
  body?: string
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  APPROVED: { bg: '#dcfce7', fg: '#166534', label: 'Approved — reminders are sent with this template' },
  PENDING: { bg: '#fef9c3', fg: '#854d0e', label: 'Waiting for Meta review' },
  IN_APPEAL: { bg: '#fef9c3', fg: '#854d0e', label: 'In appeal' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b', label: 'Rejected by Meta' },
  PAUSED: { bg: '#fee2e2', fg: '#991b1b', label: 'Paused by Meta' },
  DISABLED: { bg: '#fee2e2', fg: '#991b1b', label: 'Disabled by Meta' },
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const raw = await res.text()
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function preview(body: string) {
  return body
    .replace('{{1}}', 'Juan')
    .replace('{{2}}', 'Revisar aire acondicionado')
    .replace('{{3}}', 'Cuarto 5')
    .replace('{{4}}', 'Hoy')
}

export default function MaintenanceTemplateCard() {
  const [loading, setLoading] = useState(true)
  const [template, setTemplate] = useState<TemplateInfo | null>(null)
  const [buttons, setButtons] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/maintenance/template')
    const json = await readJson(res)
    setLoading(false)
    if (!json) {
      setError(`Unexpected response (HTTP ${res.status}).`)
      return
    }
    if (!res.ok) {
      setError((json.error as string) ?? `HTTP ${res.status}`)
      return
    }
    const info = json.template as TemplateInfo
    setTemplate(info)
    setButtons((json.buttons as string[]) ?? [])
    setCanEdit(Boolean(json.canEdit))
    setBody(info.body ?? (json.defaultBody as string) ?? '')
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit() {
    const verb = template?.exists ? 'Resubmit' : 'Submit'
    if (
      template?.exists &&
      template.status === 'APPROVED' &&
      !confirm(
        'This sends the edited template to Meta for review again. Reminders keep using the approved version until the new one is approved. Meta allows about one edit per day. Continue?'
      )
    ) {
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    const res = await fetch('/api/maintenance/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    const json = await readJson(res)
    setSaving(false)
    if (!json || !res.ok) {
      setError((json?.error as string) ?? `${verb} failed (HTTP ${res.status}).`)
      return
    }
    setMessage(
      `${json.created ? 'Submitted' : 'Resubmitted'} to Meta — status: ${json.status}. Approval usually takes minutes to a few hours; use Refresh to check.`
    )
    load()
  }

  const style = template?.status ? STATUS_STYLE[template.status] : undefined

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>WhatsApp reminder template</h2>
        <button onClick={load} disabled={loading || saving}>
          {loading ? 'Checking...' : 'Refresh'}
        </button>
      </div>
      <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
        Staff reminders are sent with this Meta-approved message, so they arrive even if the staff
        member hasn't written to you recently. Every edit must be approved by Meta again.
      </p>

      {error && <p style={{ color: '#991b1b' }}>{error}</p>}

      {!loading && template && (
        <>
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              fontSize: 14,
              marginBottom: 12,
              background: style?.bg ?? '#f3f4f6',
              color: style?.fg ?? '#374151',
            }}
          >
            {template.exists ? (
              <>
                <strong>{template.status}</strong> · {style?.label ?? 'See WhatsApp Manager'}
                {template.rejectedReason && <div>Reason: {template.rejectedReason}</div>}
              </>
            ) : (
              <>
                <strong>Not submitted yet</strong> · reminders can't be sent until this template is
                submitted and approved.
              </>
            )}
          </div>

          <label>
            <strong>Message text</strong>
          </label>
          <div style={{ fontSize: 12, color: '#888', margin: '4px 0' }}>
            Must keep all four placeholders exactly once: {'{{1}}'} staff first name · {'{{2}}'}{' '}
            task · {'{{3}}'} location · {'{{4}}'} due.
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!canEdit || saving}
            rows={8}
            style={{ width: '100%', padding: 8, fontFamily: 'monospace', fontSize: 13 }}
          />

          <div style={{ fontSize: 12, color: '#888', margin: '8px 0 4px' }}>Preview</div>
          <div
            style={{
              background: '#dcf8c6',
              borderRadius: 8,
              padding: 10,
              whiteSpace: 'pre-wrap',
              fontSize: 14,
              maxWidth: 360,
            }}
          >
            {preview(body)}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, maxWidth: 360, flexWrap: 'wrap' }}>
            {buttons.map((b) => (
              <span
                key={b}
                style={{
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 13,
                  color: '#0369a1',
                }}
              >
                {b}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            The three buttons are fixed — they drive the task updates.
          </div>

          {canEdit && (
            <div style={{ marginTop: 12 }}>
              <button onClick={handleSubmit} disabled={saving}>
                {saving
                  ? 'Sending to Meta...'
                  : template.exists
                    ? 'Save & resubmit for approval'
                    : 'Submit for approval'}
              </button>
            </div>
          )}
          {message && <p style={{ color: '#166534' }}>{message}</p>}
        </>
      )}
    </div>
  )
}
