'use client'

import { useEffect, useState } from 'react'

const ROWS = [
  { key: 'whatsapp', label: 'WhatsApp', help: 'Lana replies to guest WhatsApp messages. When off, messages still arrive in the Inbox for staff.' },
  { key: 'widget', label: 'Website chat', help: 'Lana answers in the chat on your website. When off, visitors are told the chat is offline.' },
  { key: 'instagram', label: 'Instagram', help: 'Lana replies to Instagram direct messages. When off, messages still arrive in the Inbox for staff.' },
] as const

/** Beta-style on/off switches per guest messaging channel. */
export default function ChannelSwitches() {
  const [state, setState] = useState<{ whatsapp: boolean; widget: boolean; instagram: boolean; canEdit: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/channels', { cache: 'no-store' }).then(async (r) => (r.ok ? setState(await r.json()) : setError('Could not load channels')))
  }, [])

  async function toggle(key: 'whatsapp' | 'widget' | 'instagram') {
    if (!state) return
    const enabled = !state[key]
    if (!enabled && !confirm(`Turn off Lana on ${key === 'whatsapp' ? 'WhatsApp' : key === 'instagram' ? 'Instagram' : 'the website chat'}?`)) return
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
    </section>
  )
}
