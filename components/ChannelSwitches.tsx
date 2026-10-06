'use client'

import { useEffect, useState } from 'react'

const ROWS = [
  { key: 'whatsapp', label: 'WhatsApp', help: 'Lana replies to guest WhatsApp messages. When off, messages still arrive in the Inbox for staff.' },
  { key: 'widget', label: 'Website chat', help: 'Lana answers in the chat on your website. When off, visitors are told the chat is offline.' },
  { key: 'instagram', label: 'Instagram', help: 'Lana replies to Instagram direct messages. When off, messages still arrive in the Inbox for staff.' },
  { key: 'email_replies', label: 'Email replies', help: 'Lana answers guests who email their arrival time. When off, the time is still saved to Cloudbeds but no email is sent.' },
] as const

type ChannelKey = (typeof ROWS)[number]['key']

/** Beta-style on/off switches per guest messaging channel. */
export default function ChannelSwitches() {
  const [state, setState] = useState<(Record<ChannelKey, boolean> & { canEdit: boolean }) | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/channels', { cache: 'no-store' }).then(async (r) => (r.ok ? setState(await r.json()) : setError('Could not load channels')))
  }, [])

  async function toggle(key: ChannelKey) {
    if (!state) return
    const enabled = !state[key]
    if (!enabled && !confirm(`Turn off Lana on ${key === 'whatsapp' ? 'WhatsApp' : key === 'instagram' ? 'Instagram' : key === 'email_replies' ? 'email replies' : 'the website chat'}?`)) return
    setState({ ...state, [key]: enabled })
    const res = await fetch('/api/channels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: key, enabled }),
    })
    if (!res.ok) {
      setState({ ...state })
      setError((await res.json().catch(() => ({}))).error ?? 'Could not save')
    }
  }

  return (
    <section className="mb-6">
      <h2 className="!mb-1 text-[14px] font-semibold text-white">Guest channels</h2>
      <p className="mb-2.5 text-[12px] text-navy/55">Turn Lana on or off for each guest messaging channel.</p>
      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}
      <div className="space-y-2">
        {ROWS.map((r) => {
          const on = Boolean(state?.[r.key])
          const disabled = !state?.canEdit
          return (
            <div key={r.key} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-2.5">
              <div>
                <p className="text-[13px] font-semibold text-white">{r.label}</p>
                <p className="text-[11.5px] text-navy/55">{r.help}</p>
              </div>
              <button
                type="button"
                disabled={disabled || !state}
                onClick={() => toggle(r.key)}
                aria-label={`${r.label} ${on ? 'on' : 'off'}`}
                style={{ background: on ? '#35b876' : '#475069', border: 'none', padding: 0, borderRadius: 9999 }}
                className="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40"
              >
                <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          )
        })}
      </div>
      <WhatsAppDelivery />
    </section>
  )
}

/** "Is Meta delivering this number's WhatsApp messages to Omega?" with start/stop. */
function WhatsAppDelivery() {
  const [info, setInfo] = useState<{ subscribed: boolean | null; apps: { id: string; name: string }[]; canEdit: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await fetch('/api/whatsapp/subscription', { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setInfo(j)
      setError(null)
    } else setError(j.error ?? 'Could not check WhatsApp delivery')
  }
  useEffect(() => {
    load()
  }, [])

  async function change(start: boolean) {
    const msg = start
      ? 'Start receiving this number\'s WhatsApp messages in Omega?\n\nOnly do this once Beta\'s Make scenarios are switched off, or guests will get two replies.'
      : 'Stop receiving this number\'s WhatsApp messages in Omega?\n\nUse this to switch back to Beta (turn its Make scenarios on again).'
    if (!confirm(msg)) return
    setBusy(true)
    const res = await fetch('/api/whatsapp/subscription', { method: start ? 'POST' : 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j.error ?? 'Meta refused the change')
    await load()
    setBusy(false)
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-surface px-4 py-2.5">
      <p className="text-[13px] font-semibold text-white">WhatsApp delivery to Omega</p>
      {error && <p className="text-[11.5px] text-red-300">{error}</p>}
      {!info && !error && <p className="text-[11.5px] text-navy/55">Checking with Meta…</p>}
      {info && (
        <>
          <p className="text-[11.5px] text-navy/55">
            {info.subscribed
              ? '✓ Meta is sending this number\'s messages to Omega.'
              : 'Meta is not sending this number\'s messages to Omega yet.'}
            {info.apps.length > 0 && <> Apps receiving them: {info.apps.map((a) => a.name || a.id).join(', ')}.</>}
          </p>
          {info.canEdit && (
            <div className="mt-1.5">
              {info.subscribed ? (
                <button type="button" disabled={busy} onClick={() => change(false)}>Stop receiving (switch back to Beta)</button>
              ) : (
                <button type="button" disabled={busy} onClick={() => change(true)}>Start receiving messages on this number</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
