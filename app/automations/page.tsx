'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Field {
  key: string
  label: string
}
interface Mapping {
  name: string
  language: string
  header: string[]
  body: string[]
}
interface Purpose {
  key: string
  label: string
  help: string
  fields: Field[]
  mapping: Mapping | null
}
interface EmailTemplate {
  key: string
  label: string
  help: string
  enabled: boolean
  subject: string
  body_html: string
}
interface PickerTemplate {
  name: string
  language: string
  status: string
  headerText?: string
  body?: string
  headerVars: number
  bodyVars: number
  buttons: string[]
  usable: boolean
  reason?: string
}

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  background: '#fff',
}
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 14 }
const button: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
}
const primary: React.CSSProperties = { ...button, background: '#111827', color: '#fff', border: '1px solid #111827' }

// Sample values for previews.
const SAMPLE: Record<string, string> = {
  guest_first_name: 'Ana',
  guest_name: 'Ana García',
  check_in: '3 de octubre de 2026',
  check_out: '6 de octubre de 2026',
  reservation_id: '1234567890',
  room_type: 'Studio with Kitchen',
  property_name: 'Soirée',
  category: 'maintenance',
  room: '8',
  issue: 'The air conditioning is not cooling',
  urgency: 'normal',
  guest_phone: '+52 958 000 0000',
}

function fillVars(text: string | undefined, keys: string[]): string {
  return (text ?? '').replace(/\{\{(\d+)\}\}/g, (m, n: string) => {
    const key = keys[Number(n) - 1]
    return key ? `[${SAMPLE[key] ?? key}]` : m
  })
}

function renderEmail(text: string): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => SAMPLE[k] ?? '')
}

function TemplateCard({
  purpose,
  canEdit,
  whatsappReady,
  loadList,
  onSaved,
}: {
  purpose: Purpose
  canEdit: boolean
  whatsappReady: boolean
  loadList: () => Promise<PickerTemplate[]>
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [list, setList] = useState<PickerTemplate[] | null>(null)
  const [selected, setSelected] = useState('')
  const [header, setHeader] = useState<string[]>([])
  const [body, setBody] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = list?.find((t) => `${t.name}|${t.language}` === selected)

  async function startEditing() {
    setError(null)
    setEditing(true)
    try {
      const templates = await loadList()
      setList(templates)
      if (purpose.mapping) {
        setSelected(`${purpose.mapping.name}|${purpose.mapping.language}`)
        setHeader(purpose.mapping.header)
        setBody(purpose.mapping.body)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load templates')
    }
  }

  function pick(value: string) {
    setSelected(value)
    const t = list?.find((x) => `${x.name}|${x.language}` === value)
    const first = purpose.fields[0]?.key ?? ''
    setHeader(Array.from({ length: t?.headerVars ?? 0 }, () => first))
    setBody(Array.from({ length: t?.bodyVars ?? 0 }, () => first))
  }

  async function save(mapping: Mapping | null) {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_template', purpose: purpose.key, mapping }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setError(json.error ?? 'Could not save')
      return
    }
    setEditing(false)
    onSaved()
  }

  const fieldLabel = (k: string) => purpose.fields.find((f) => f.key === k)?.label ?? k

  function varSelect(values: string[], set: (v: string[]) => void, index: number, prefix: string) {
    return (
      <label key={`${prefix}${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <code style={{ minWidth: 56 }}>
          {prefix}
          {`{{${index + 1}}}`}
        </code>
        <select
          value={values[index]}
          onChange={(e) => {
            const next = [...values]
            next[index] = e.target.value
            set(next)
          }}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          {purpose.fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{purpose.label}</h3>
      <p style={{ ...muted, margin: '0 0 12px' }}>{purpose.help}</p>

      {!editing && (
        <>
          {purpose.mapping ? (
            <div style={{ fontSize: 14, marginBottom: 12 }}>
              <div>
                Template: <strong>{purpose.mapping.name}</strong> ({purpose.mapping.language})
              </div>
              {[...purpose.mapping.header.map((k, i) => `Header {{${i + 1}}} → ${fieldLabel(k)}`),
                ...purpose.mapping.body.map((k, i) => `{{${i + 1}}} → ${fieldLabel(k)}`)].map((line) => (
                <div key={line} style={muted}>
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 14, color: '#b45309', margin: '0 0 12px' }}>
              {purpose.key === 'staff_escalation'
                ? 'No template chosen — staff alerts go out as plain text, which WhatsApp only delivers if that staff member messaged the hotel number in the last 24 hours.'
                : 'No template chosen — this WhatsApp message is not sent.'}
            </p>
          )}
          {canEdit && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={button} onClick={startEditing} disabled={!whatsappReady}>
                {purpose.mapping ? 'Change template' : 'Choose template'}
              </button>
              {purpose.mapping && (
                <button style={button} onClick={() => save(null)} disabled={busy}>
                  Stop using template
                </button>
              )}
            </div>
          )}
        </>
      )}

      {editing && (
        <div>
          {!list && !error && <p style={muted}>Loading your WhatsApp templates…</p>}
          {list && (
            <>
              <select
                value={selected}
                onChange={(e) => pick(e.target.value)}
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db', marginBottom: 12 }}
              >
                <option value="">Select an approved template…</option>
                {list.map((t) => (
                  <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={!t.usable}>
                    {t.name} · {t.language}
                    {t.usable ? '' : ` — ${t.reason}`}
                  </option>
                ))}
              </select>

              {chosen && (
                <>
                  <div
                    style={{
                      background: '#e7fce3',
                      borderRadius: 8,
                      padding: 12,
                      fontSize: 14,
                      whiteSpace: 'pre-wrap',
                      marginBottom: 12,
                    }}
                  >
                    {chosen.headerText && <strong>{fillVars(chosen.headerText, header)}{'\n'}</strong>}
                    {fillVars(chosen.body, body)}
                    {chosen.buttons.length > 0 && (
                      <div style={{ marginTop: 8, color: '#2563eb' }}>{chosen.buttons.join('  ·  ')}</div>
                    )}
                  </div>
                  {chosen.headerVars + chosen.bodyVars > 0 && (
                    <p style={{ ...muted, margin: '0 0 8px' }}>Choose what fills each variable:</p>
                  )}
                  {header.map((_, i) => varSelect(header, setHeader, i, 'Header '))}
                  {body.map((_, i) => varSelect(body, setBody, i, ''))}
                </>
              )}
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              style={primary}
              disabled={!chosen || busy}
              onClick={() =>
                chosen && save({ name: chosen.name, language: chosen.language, header, body })
              }
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button style={button} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 8 }}>{error}</p>}
    </div>
  )
}

function EmailCard({
  tpl,
  canEdit,
  variables,
  onSaved,
}: {
  tpl: EmailTemplate
  canEdit: boolean
  variables: string[]
  onSaved: () => void
}) {
  const [enabled, setEnabled] = useState(tpl.enabled)
  const [subject, setSubject] = useState(tpl.subject)
  const [body, setBody] = useState(tpl.body_html)
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  async function post(payload: Record<string, unknown>, okText: string) {
    setBusy(true)
    setMessage(null)
    const res = await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: tpl.key, subject, body_html: body, ...payload }),
    })
    const json = await res.json()
    setBusy(false)
    setMessage(res.ok ? okText : `Error: ${json.error}`)
    return res.ok
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{tpl.label}</h3>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Send this email
        </label>
      </div>
      <p style={{ ...muted, margin: '4px 0 12px' }}>{tpl.help}</p>

      <label style={{ fontSize: 14, fontWeight: 600 }}>Subject</label>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={!canEdit}
        style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db', margin: '4px 0 12px' }}
      />
      <label style={{ fontSize: 14, fontWeight: 600 }}>Message (HTML)</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!canEdit}
        rows={10}
        style={{
          width: '100%',
          padding: 8,
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontFamily: 'monospace',
          fontSize: 13,
          margin: '4px 0 4px',
        }}
      />
      <p style={{ ...muted, fontSize: 12, margin: '0 0 12px' }}>
        Variables: {variables.map((v) => `{{${v}}}`).join('  ')}
      </p>

      <button style={{ ...button, marginBottom: 12 }} onClick={() => setShowPreview(!showPreview)}>
        {showPreview ? 'Hide preview' : 'Preview'}
      </button>
      {showPreview && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 12 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', fontSize: 14 }}>
            <strong>{renderEmail(subject)}</strong>
          </div>
          <iframe
            title={`${tpl.key} preview`}
            sandbox=""
            srcDoc={`<div style="font-family:sans-serif;font-size:14px;padding:4px 12px">${renderEmail(body)}</div>`}
            style={{ width: '100%', height: 320, border: 0 }}
          />
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            style={primary}
            disabled={busy}
            onClick={async () => {
              if (await post({ action: 'save_email', enabled }, 'Saved.')) onSaved()
            }}
          >
            Save
          </button>
          <input
            placeholder="you@example.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db', minWidth: 200 }}
          />
          <button
            style={button}
            disabled={busy || !testTo}
            onClick={() => post({ action: 'test_email', to: testTo }, `Test sent to ${testTo}.`)}
          >
            Send test
          </button>
        </div>
      )}
      {message && (
        <p style={{ fontSize: 14, marginTop: 8, color: message.startsWith('Error') ? '#b91c1c' : '#047857' }}>
          {message}
        </p>
      )}
    </div>
  )
}

export default function AutomationsPage() {
  const [data, setData] = useState<{
    purposes: Purpose[]
    emailTemplates: EmailTemplate[]
    emailVariables: string[]
    postStayEnabled: boolean
    whatsappReady: boolean
    smtpConnected: boolean
    canEdit: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templateCache, setTemplateCache] = useState<PickerTemplate[] | null>(null)

  async function load() {
    const res = await fetch('/api/automations')
    const json = await res.json()
    if (!res.ok) setError(json.error ?? 'Could not load')
    else setData(json)
  }

  async function loadList(): Promise<PickerTemplate[]> {
    if (templateCache) return templateCache
    const res = await fetch('/api/automations?list=1')
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Could not load templates')
    setTemplateCache(json.templates)
    return json.templates
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <p>
        <Link href="/">← Dashboard</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>Automated messages</h1>
      <p style={muted}>
        Messages the concierge sends on its own. WhatsApp only delivers messages that start a
        conversation if they use a template Meta has approved, so each one needs a template chosen here.
      </p>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {!data && !error && <p>Loading…</p>}

      {data && (
        <>
          {!data.postStayEnabled && (
            <p style={{ ...muted, background: '#f9fafb', padding: 12, borderRadius: 6 }}>
              Post-stay messages are turned off. Turn them on in <Link href="/settings">Settings</Link>.
            </p>
          )}

          <h2 style={{ fontSize: 18, marginTop: 24 }}>WhatsApp templates</h2>
          {!data.whatsappReady && (
            <p style={{ color: '#b45309', fontSize: 14 }}>
              Connect WhatsApp (with its WhatsApp Business Account ID) under{' '}
              <Link href="/integrations">Integrations</Link> to choose templates.
            </p>
          )}
          {data.purposes.map((p) => (
            <TemplateCard
              key={p.key}
              purpose={p}
              canEdit={data.canEdit}
              whatsappReady={data.whatsappReady}
              loadList={loadList}
              onSaved={load}
            />
          ))}

          <h2 style={{ fontSize: 18, marginTop: 32 }}>Guest emails</h2>
          {!data.smtpConnected && (
            <p style={{ color: '#b45309', fontSize: 14 }}>
              Connect Email (SMTP) under <Link href="/integrations">Integrations</Link> before turning emails on.
            </p>
          )}
          {data.emailTemplates.map((t) => (
            <EmailCard
              key={t.key}
              tpl={t}
              canEdit={data.canEdit}
              variables={data.emailVariables}
              onSaved={load}
            />
          ))}
        </>
      )}
    </main>
  )
}
