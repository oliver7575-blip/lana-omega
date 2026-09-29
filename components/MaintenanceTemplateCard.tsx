'use client'

import { useEffect, useState } from 'react'

interface TemplateInfo {
  exists: boolean
  id?: string
  name?: string
  language?: string
  status?: string
  rejectedReason?: string | null
  body?: string
  buttons?: string[]
}

interface TemplateListItem extends TemplateInfo {
  compatible: boolean
  reason?: string
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

function Bubble({ body, buttons }: { body: string; buttons: string[] }) {
  return (
    <>
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
        {buttons.map((b, i) => (
          <span
            key={`${b}-${i}`}
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
    </>
  )
}

const ROLE_LABELS = ['= accept', '= need help', '= done']

export default function MaintenanceTemplateCard() {
  const [loading, setLoading] = useState(true)
  const [template, setTemplate] = useState<TemplateInfo | null>(null)
  const [usingCustom, setUsingCustom] = useState(false)
  const [buttons, setButtons] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [body, setBody] = useState('')
  const [defaultBody, setDefaultBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [list, setList] = useState<TemplateListItem[]>([])

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
    setUsingCustom(Boolean(json.usingCustom))
    setButtons((json.buttons as string[]) ?? [])
    setCanEdit(Boolean(json.canEdit))
    setDefaultBody((json.defaultBody as string) ?? '')
    setBody(info.body ?? (json.defaultBody as string) ?? '')
  }

  useEffect(() => {
    load()
  }, [])

  async function post(payload: Record<string, unknown>) {
    const res = await fetch('/api/maintenance/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await readJson(res)
    return { ok: res.ok && !!json, json, status: res.status }
  }

  async function handleSubmit() {
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
    const { ok, json, status } = await post({ action: 'submit', body })
    setSaving(false)
    if (!ok) {
      setError((json?.error as string) ?? `Submit failed (HTTP ${status}).`)
      return
    }
    setMessage(
      `${json!.created ? 'Submitted' : 'Resubmitted'} to Meta — status: ${json!.status}. Approval usually takes minutes to a few hours; use Refresh to check.`
    )
    load()
  }

  async function openPicker() {
    setPickerOpen(true)
    setPickerLoading(true)
    setPickerError(null)
    const res = await fetch('/api/maintenance/template?list=1')
    const json = await readJson(res)
    setPickerLoading(false)
    if (!json || !res.ok) {
      setPickerError((json?.error as string) ?? `Could not load templates (HTTP ${res.status}).`)
      return
    }
    setList((json.templates as TemplateListItem[]) ?? [])
  }

  async function handleSelect(t: TemplateListItem) {
    setSaving(true)
    setError(null)
    setMessage(null)
    const { ok, json, status } = await post({ action: 'select', name: t.name, language: t.language })
    setSaving(false)
    if (!ok) {
      setPickerError((json?.error as string) ?? `Could not select (HTTP ${status}).`)
      return
    }
    setPickerOpen(false)
    setMessage(`Reminders will now use "${t.name}" (${t.language}).`)
    load()
  }

  async function handleUseDefault() {
    setSaving(true)
    setError(null)
    setMessage(null)
    const { ok, json, status } = await post({ action: 'use_default' })
    setSaving(false)
    if (!ok) {
      setError((json?.error as string) ?? `Could not switch (HTTP ${status}).`)
      return
    }
    setMessage("Switched back to Omega's own reminder template.")
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
        Staff reminders are sent with a Meta-approved message, so they arrive even if the staff
        member hasn't written to you recently. Use Omega's own template below, or pick one your
        WhatsApp account already has approved.
      </p>

      {error && <p style={{ color: '#991b1b' }}>{error}</p>}

      {!loading && template && (
        <>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            In use:{' '}
            <strong>
              {usingCustom ? `${template.name} (${template.language}) — your own template` : "Omega's template"}
            </strong>
          </div>

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
            ) : usingCustom ? (
              <>
                <strong>Not found</strong> · the selected template no longer exists in your
                WhatsApp account. Pick another one or switch back to Omega's template.
              </>
            ) : (
              <>
                <strong>Not submitted yet</strong> · reminders can't be sent until this template is
                submitted and approved.
              </>
            )}
          </div>

          {usingCustom ? (
            <>
              <div style={{ fontSize: 12, color: '#888', margin: '8px 0 4px' }}>Preview</div>
              <Bubble body={template.body ?? ''} buttons={buttons} />
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                Buttons are used by position: 1st = accept, 2nd = need help, 3rd = done. Edit this
                template in WhatsApp Manager if needed.
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button onClick={openPicker} disabled={saving}>
                    Choose a different template
                  </button>
                  <button onClick={handleUseDefault} disabled={saving}>
                    Use Omega's template instead
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <label>
                <strong>Message text</strong>
              </label>
              <div style={{ fontSize: 12, color: '#888', margin: '4px 0' }}>
                Must keep all four placeholders exactly once: {'{{1}}'} staff first name ·{' '}
                {'{{2}}'} task · {'{{3}}'} location · {'{{4}}'} due.
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canEdit || saving}
                rows={8}
                style={{ width: '100%', padding: 8, fontFamily: 'monospace', fontSize: 13 }}
              />

              <div style={{ fontSize: 12, color: '#888', margin: '8px 0 4px' }}>Preview</div>
              <Bubble body={body} buttons={buttons} />
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                The three buttons are fixed — they drive the task updates.
              </div>

              {canEdit && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button onClick={handleSubmit} disabled={saving}>
                    {saving
                      ? 'Working...'
                      : template.exists
                        ? 'Save & resubmit for approval'
                        : 'Submit for approval'}
                  </button>
                  {body !== defaultBody && (
                    <button onClick={() => setBody(defaultBody)} disabled={saving} type="button">
                      Reset to default text
                    </button>
                  )}
                  <button onClick={openPicker} disabled={saving}>
                    Use an existing approved template
                  </button>
                </div>
              )}
            </>
          )}
          {message && <p style={{ color: '#166534' }}>{message}</p>}
        </>
      )}

      {pickerOpen && (
        <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Templates in your WhatsApp account</strong>
            <button onClick={() => setPickerOpen(false)} type="button">
              Close
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#888', margin: '4px 0 8px' }}>
            Usable templates are approved and have {'{{1}}'} name · {'{{2}}'} task · {'{{3}}'}{' '}
            location · {'{{4}}'} due, plus 3 quick-reply buttons (accept, need help, done — in that
            order).
          </div>
          {pickerLoading && <p style={{ color: '#888' }}>Loading templates...</p>}
          {pickerError && <p style={{ color: '#991b1b' }}>{pickerError}</p>}
          {!pickerLoading && !pickerError && list.length === 0 && (
            <p style={{ color: '#888' }}>No templates found in this WhatsApp account.</p>
          )}
          {list.map((t) => (
            <div
              key={`${t.name}-${t.language}`}
              style={{
                border: '1px solid #eee',
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
                opacity: t.compatible ? 1 : 0.55,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <strong>{t.name}</strong>{' '}
                  <span style={{ fontSize: 12, color: '#888' }}>
                    {t.language} · {t.status}
                  </span>
                </div>
                {t.compatible && canEdit && (
                  <button onClick={() => handleSelect(t)} disabled={saving}>
                    Use this
                  </button>
                )}
              </div>
              {!t.compatible && (
                <div style={{ fontSize: 12, color: '#991b1b', marginTop: 4 }}>{t.reason}</div>
              )}
              {t.body && (
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 6, color: '#444' }}>
                  {t.body}
                </div>
              )}
              {t.compatible && t.buttons && (
                <div style={{ fontSize: 12, color: '#0369a1', marginTop: 6 }}>
                  {t.buttons.map((b, i) => `${b} ${ROLE_LABELS[i] ?? ''}`).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
