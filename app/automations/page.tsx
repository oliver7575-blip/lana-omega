'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import MaintenanceTemplateCard from '@/components/MaintenanceTemplateCard'

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
  border: '1px solid #232a40',
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  background: '#141a2e',
}
const muted: React.CSSProperties = { color: 'rgba(231,233,240,0.55)', fontSize: 14 }
const button: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid #232a40',
  background: '#141a2e',
  cursor: 'pointer',
  fontSize: 14,
}
const primary: React.CSSProperties = { ...button, background: '#e0806f', color: '#fff', border: '1px solid #e0806f' }

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

/**
 * Puts each paragraph / line break on its own line so the HTML is easy to
 * read and edit. Whitespace between tags doesn't change how an email looks.
 */
function formatHtml(html: string): string {
  return html
    .replace(/>\s*\n\s*</g, '><')
    .replace(/(<\/(p|div|h[1-6]|li|ul|ol|table|tr)>)\s*/gi, '$1\n')
    .replace(/(<br\s*\/?>)\s*/gi, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
          style={{ padding: 6, borderRadius: 6, border: '1px solid #232a40' }}
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
            <p style={{ fontSize: 14, color: '#fcd34d', margin: '0 0 12px' }}>
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
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #232a40', marginBottom: 12 }}
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
                      background: '#1f3b2d',
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
                      <div style={{ marginTop: 8, color: '#93c5fd' }}>{chosen.buttons.join('  ·  ')}</div>
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
      {error && <p style={{ color: '#fca5a5', fontSize: 14, marginTop: 8 }}>{error}</p>}
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
  const [body, setBody] = useState(formatHtml(tpl.body_html))
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
        style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #232a40', margin: '4px 0 12px' }}
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
          border: '1px solid #232a40',
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
        <div style={{ border: '1px solid #232a40', borderRadius: 6, marginBottom: 12 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #232a40', fontSize: 14 }}>
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
            style={{ padding: 8, borderRadius: 6, border: '1px solid #232a40', minWidth: 200 }}
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
        <p style={{ fontSize: 14, marginTop: 8, color: message.startsWith('Error') ? '#fca5a5' : '#6ee7b7' }}>
          {message}
        </p>
      )}
    </div>
  )
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={on ? { background: '#34d399', boxShadow: '0 0 4px #34d399' } : { border: '1px solid rgba(231,233,240,0.3)' }}
    />
  )
}

export default function AutomationsPage() {
  const [data, setData] = useState<{
    purposes: Purpose[]
    emailTemplates: EmailTemplate[]
    emailVariables: string[]
    postStayEnabled: boolean
    maintenanceStatus: string | null
    whatsappReady: boolean
    smtpConnected: boolean
    canEdit: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templateCache, setTemplateCache] = useState<PickerTemplate[] | null>(null)
  const [tab, setTab] = useState('new_reservation')

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

  const categories: { key: string; label: string; help: string; wa?: string; email?: string; maintenance?: boolean }[] = [
    { key: 'new_reservation', label: 'New reservation', help: 'Sent as soon as a new booking arrives from Cloudbeds.', wa: 'new_reservation', email: 'new_reservation' },
    { key: 'arrival', label: 'Arrival information', help: 'Sent 2 days before check-in, or right away for last-minute bookings.', wa: 'arrival_reminder', email: 'arrival_reminder' },
    { key: 'post_stay', label: 'Post-stay feedback', help: 'Sent the day after check-out, when post-stay messages are on in Settings.', wa: 'post_stay', email: 'post_stay' },
    { key: 'staff', label: 'Staff alerts', help: 'Sent to staff when Lana escalates a guest issue.', wa: 'staff_escalation' },
    { key: 'maintenance', label: 'Maintenance reminders', help: 'Sent to maintenance staff for each task, with Acepto / Necesito ayuda / Terminado buttons.', maintenance: true },
  ]
  const current = categories.find((c) => c.key === tab) ?? categories[0]
  const waDone = (key?: string) => Boolean(key && data?.purposes.find((p) => p.key === key)?.mapping)
  const emailOn = (key?: string) => Boolean(key && data?.emailTemplates.find((t) => t.key === key)?.enabled)

  // Status marks: green bullet = set up. Green text = nothing else needed;
  // red text = still needs its "send" box ticked (email tick, or post-stay switch).
  const GREEN = '#6ee7b7'
  const RED = '#fca5a5'
  const emailReady = (key?: string) => {
    const t = data?.emailTemplates.find((x) => x.key === key)
    return Boolean(t && t.subject.trim() && t.body_html.trim())
  }
  function itemsFor(c: (typeof categories)[number]) {
    const postStayOff = c.key === 'post_stay' && !data?.postStayEnabled
    const list: { label: string; configured: boolean; textColor: string }[] = []
    if (c.maintenance) {
      list.push({ label: 'WhatsApp template', configured: data?.maintenanceStatus === 'APPROVED', textColor: GREEN })
    }
    if (c.wa) {
      list.push({ label: 'WhatsApp template', configured: waDone(c.wa), textColor: postStayOff ? RED : GREEN })
    }
    if (c.email) {
      list.push({ label: 'Email', configured: emailReady(c.email), textColor: emailOn(c.email) && !postStayOff ? GREEN : RED })
    }
    return list
  }

  return (
    <main>
      <h1>Templates</h1>
      <p style={muted}>
        Messages Lana sends on her own, grouped by when they go out. WhatsApp only delivers messages that start a
        conversation if they use a template Meta has approved.
      </p>
      {error && <p style={{ color: '#fca5a5' }}>{error}</p>}
      {!data && !error && <p>Loading…</p>}

      {data && (
        <div className="mt-5 flex flex-col gap-6 lg:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-56 lg:flex-col">
            {categories.map((c) => {
              const active = c.key === current.key
              return (
                <a
                  key={c.key}
                  href={`#${c.key}`}
                  onClick={(e) => { e.preventDefault(); setTab(c.key) }}
                  className={`block shrink-0 rounded-lg px-3 py-2 text-sm no-underline ${active ? 'bg-surface text-white' : 'text-navy/70 hover:bg-white/[0.03]'}`}
                  style={{ color: active ? '#fff' : undefined, textDecoration: 'none' }}
                >
                  <span className="block font-semibold">{c.label}</span>
                  <span className="mt-0.5 block space-y-0.5">
                    {itemsFor(c).map((it) => (
                      <span key={it.label} className="flex items-center gap-1.5 text-[11.5px]" style={{ color: it.textColor }}>
                        <Dot on={it.configured} />
                        {it.label}
                      </span>
                    ))}
                  </span>
                </a>
              )
            })}
          </nav>

          <section className="min-w-0 flex-1">
            <h2 style={{ fontSize: 18 }}>{current.label}</h2>
            <p style={muted}>{current.help}</p>
            {current.key === 'post_stay' && !data.postStayEnabled && (
              <p style={{ ...muted, background: '#141a2e', padding: 12, borderRadius: 6 }}>
                Post-stay messages are turned off. Turn them on in <Link href="/settings">Settings</Link>.
              </p>
            )}

            {current.wa && (
              <>
                <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-navy/50">WhatsApp</h3>
                {!data.whatsappReady && (
                  <p style={{ color: '#fcd34d', fontSize: 14 }}>
                    Connect WhatsApp (with its WhatsApp Business Account ID) under <Link href="/integrations">Integrations</Link> to choose templates.
                  </p>
                )}
                {data.purposes.filter((p) => p.key === current.wa).map((p) => (
                  <TemplateCard key={p.key} purpose={p} canEdit={data.canEdit} whatsappReady={data.whatsappReady} loadList={loadList} onSaved={load} />
                ))}
              </>
            )}

            {current.email && (
              <>
                <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-navy/50">Email</h3>
                {!data.smtpConnected && (
                  <p style={{ color: '#fcd34d', fontSize: 14 }}>
                    Connect Email (SMTP) under <Link href="/integrations">Integrations</Link> before turning emails on.
                  </p>
                )}
                {data.emailTemplates.filter((t) => t.key === current.email).map((t) => (
                  <EmailCard key={t.key} tpl={t} canEdit={data.canEdit} variables={data.emailVariables} onSaved={load} />
                ))}
              </>
            )}

            {current.maintenance && (
              <div className="mt-4">
                <MaintenanceTemplateCard />
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
