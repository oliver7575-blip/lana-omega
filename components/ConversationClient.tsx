'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export function TakeOverButton({ conversationId, status }: { conversationId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function set(next: string) {
    if (next === 'closed' && !confirm('Close this conversation? A new message from this guest starts a fresh one.')) return
    setBusy(true)
    await fetch(`/api/conversations/${conversationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    setBusy(false)
    router.refresh()
  }

  if (status === 'closed') {
    return (
      <button
        disabled={busy}
        onClick={() => set('active')}
        className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-white transition hover:bg-clay disabled:opacity-60"
      >
        Reopen
      </button>
    )
  }
  return (
    <div className="flex items-center gap-4">
      <button onClick={() => set('closed')} disabled={busy} className="text-xs text-navy/50 hover:text-navy">
        Close
      </button>
      <button
        disabled={busy}
        onClick={() => set(status === 'human_takeover' ? 'active' : 'human_takeover')}
        className={`rounded-full px-5 py-2 text-sm font-medium text-white transition disabled:opacity-60 ${
          status === 'human_takeover' ? 'bg-purple-500/30 hover:bg-purple-500/40' : 'bg-ink hover:bg-clay'
        }`}
      >
        {status === 'human_takeover' ? 'Hand back to Lana' : 'Take over'}
      </button>
    </div>
  )
}

/** Keeps the message list scrolled to the newest message. */
export function ScrollToBottom() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'end' })
  }, [])
  return <div ref={ref} />
}

export function Composer({ conversationId, channel }: { conversationId: string; channel: string }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!text.trim()) return
    setSending(true)
    setError(null)
    const res = await fetch(`/api/conversations/${conversationId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    })
    const json = await res.json().catch(() => ({}))
    setSending(false)
    if (!res.ok) {
      setError(json.error ?? 'Could not send')
      return
    }
    if (json.deliveryResult && json.deliveryResult.success === false) {
      setError(`Saved, but WhatsApp didn't deliver it: ${json.deliveryResult.error}`)
    }
    setText('')
    router.refresh()
  }

  return (
    <div className="border-t border-line px-5 py-4 md:px-8">
      <div className="flex items-end gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
          rows={2}
          placeholder={`Reply as staff (sends via ${channel === 'whatsapp' ? 'WhatsApp' : 'the website chat'})...`}
          className="min-h-[64px] flex-1 resize-none rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-navy outline-none placeholder:text-navy/40 focus:border-clay"
        />
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className="rounded-full bg-surface px-5 py-2.5 text-sm font-medium text-navy transition hover:bg-clay hover:text-white disabled:text-navy/40 disabled:hover:bg-surface"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  )
}

export function AssignmentSelect({
  conversationId,
  value,
  staff,
}: {
  conversationId: string
  value: string | null
  staff: { id: string; label: string }[]
}) {
  const [current, setCurrent] = useState(value ?? '')
  return (
    <select
      value={current}
      onChange={async (e) => {
        setCurrent(e.target.value)
        await fetch(`/api/conversations/${conversationId}/meta`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_staff_id: e.target.value || null }),
        })
      }}
      className="w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-navy outline-none focus:border-clay"
    >
      <option value="">Unassigned</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  )
}

export function NotesEditor({ conversationId, value }: { conversationId: string; value: string | null }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value ?? '')
  const [saved, setSaved] = useState(value ?? '')

  async function save() {
    await fetch(`/api/conversations/${conversationId}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: text }),
    })
    setSaved(text.trim())
    setEditing(false)
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="w-full text-left text-sm text-navy/60 hover:text-navy">
        {saved ? <span className="whitespace-pre-wrap text-navy/85">{saved}</span> : 'None.'}
      </button>
    )
  }
  return (
    <div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-navy outline-none focus:border-clay"
      />
      <div className="mt-2 flex gap-3">
        <button onClick={save} className="rounded-full bg-ink px-4 py-1.5 text-sm text-white hover:bg-clay">
          Save
        </button>
        <button onClick={() => { setText(saved); setEditing(false) }} className="text-sm text-navy/60 hover:text-navy">
          Cancel
        </button>
      </div>
    </div>
  )
}

export function GuestEditor({
  guestId,
  name,
  email,
}: {
  guestId: string
  name: string | null
  email: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [n, setN] = useState(name ?? '')
  const [e, setE] = useState(email ?? '')

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="mt-1 text-xs text-navy/40 hover:text-clay">
        Edit guest
      </button>
    )
  }
  return (
    <div className="mt-2 space-y-2">
      <input value={n} onChange={(ev) => setN(ev.target.value)} placeholder="Name"
        className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-navy outline-none focus:border-clay" />
      <input value={e} onChange={(ev) => setE(ev.target.value)} placeholder="Email"
        className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-navy outline-none focus:border-clay" />
      <div className="flex gap-3">
        <button
          onClick={async () => {
            await fetch(`/api/guests/${guestId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: n, email: e }),
            })
            setEditing(false)
            router.refresh()
          }}
          className="rounded-full bg-ink px-4 py-1.5 text-sm text-white hover:bg-clay"
        >
          Save
        </button>
        <button onClick={() => setEditing(false)} className="text-sm text-navy/60 hover:text-navy">
          Cancel
        </button>
      </div>
    </div>
  )
}
