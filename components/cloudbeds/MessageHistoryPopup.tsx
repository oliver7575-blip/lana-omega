'use client'

import { createRoot, type Root } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cbApi } from './shared'
import { btn, chip, headerGradient, priTeal } from './ui'

interface Msg { id: string; sender_type: string; content: string; created_at: string }
interface Conv { conversationId: string; windowOpen: boolean; language: string | null }
interface Props { reservationId: string; guestName: string }

const WHO: Record<string, string> = { guest: 'Guest', staff: 'Staff', lana: 'Lana' }

function Popup({ reservationId, guestName, onClose }: Props & { onClose: () => void }) {
  const [conv, setConv] = useState<Conv | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [lang, setLang] = useState<'es' | 'en'>('en')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState('active')
  const [channel, setChannel] = useState('whatsapp')
  const [ctlBusy, setCtlBusy] = useState<null | 'take' | 'hand' | 'answer'>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const load = useCallback(async (c: Conv) => {
    try {
      const res = await fetch(`/api/conversations/${c.conversationId}/messages`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Could not load messages')
      setMsgs(j.messages as Msg[])
      if (typeof j.status === 'string') setStatus(j.status)
      if (typeof j.channel === 'string') setChannel(j.channel)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load messages')
    }
  }, [])

  useEffect(() => {
    let alive = true
    cbApi<Conv>(`/api/cloudbeds/reservation/${reservationId}/conversation`)
      .then((c) => {
        if (!alive) return
        setConv(c)
        setLang(c.language === 'es' ? 'es' : 'en')
        load(c)
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : 'Could not open the conversation'))
    return () => { alive = false }
  }, [reservationId, load])

  // Keep the history fresh while the pop-up is open.
  useEffect(() => {
    if (!conv) return
    const t = setInterval(() => load(conv), 8000)
    return () => clearInterval(t)
  }, [conv, load])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

  async function send() {
    if (!conv || !text.trim() || busy) return
    setBusy(true)
    setNote(null)
    try {
      const url = conv.windowOpen ? `/api/conversations/${conv.conversationId}/reply` : `/api/conversations/${conv.conversationId}/hello`
      const body = conv.windowOpen ? { content: text } : { reason: text, language: lang, firstName: guestName.split(' ')[0] }
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not send')
      if (j.deliveryResult && j.deliveryResult.success === false) {
        setNote({ ok: false, text: `Saved, but WhatsApp didn't deliver it: ${j.deliveryResult.error}` })
      } else {
        setNote({ ok: true, text: 'Sent.' })
      }
      setText('')
      await load(conv)
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not send' })
    }
    setBusy(false)
  }

  async function setConvStatus(next: 'active' | 'human_takeover') {
    if (!conv || ctlBusy) return
    setCtlBusy(next === 'human_takeover' ? 'take' : 'hand')
    setNote(null)
    try {
      const res = await fetch(`/api/conversations/${conv.conversationId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not change who is handling this chat')
      setStatus(next)
      setNote({ ok: true, text: next === 'active' ? 'Handed back to Lana.' : 'You have taken over.' })
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not change who is handling this chat' })
    }
    setCtlBusy(null)
  }

  async function lanaAnswers() {
    if (!conv || ctlBusy) return
    setCtlBusy('answer')
    setNote({ ok: true, text: 'Lana is answering…' })
    try {
      const res = await fetch(`/api/conversations/${conv.conversationId}/answer`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not hand over')
      setStatus('active')
      setNote(j.answered ? { ok: true, text: 'Lana answered the last message.' } : { ok: false, text: `Handed to Lana. ${j.reason ?? 'Nothing was sent.'}` })
      await load(conv)
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not hand over' })
    }
    setCtlBusy(null)
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    const box = e.currentTarget.parentElement!.getBoundingClientRect()
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.current.dy)),
    })
  }

  const style: React.CSSProperties = pos ? { left: pos.x, top: pos.y } : { right: 24, bottom: 24 }

  return (
    <div style={{ position: 'fixed', zIndex: 70, width: 360, maxHeight: 'min(560px, calc(100vh - 32px))', ...style }}
      className="flex flex-col overflow-hidden rounded-[20px] bg-white text-[#14213d] shadow-[0_20px_60px_rgba(8,12,24,.38)] ring-1 ring-black/5">
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null }}
        className={`flex cursor-move touch-none select-none items-center gap-3 px-4 py-3 text-white ${headerGradient('teal')}`}>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold">{guestName}</p>
          <p className="text-[11px] text-white/70">Message history · WhatsApp</p>
        </div>
        <button onClick={onClose} aria-label="Close message history" className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/30 text-base leading-none text-white hover:bg-white/10">×</button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-[#eef0f4] bg-white px-3 py-2">
        <span className={`rounded-full px-2.5 py-[3px] text-[11px] font-semibold ${status === 'human_takeover' ? 'bg-[#efe6fb] text-[#5b2ea6]' : status === 'closed' ? 'bg-[#eef0f4] text-[#667085]' : 'bg-[#e0f3ec] text-[#0e5f47]'}`}>
          {status === 'human_takeover' ? 'You are handling' : status === 'closed' ? 'Closed' : 'Lana is handling'}
        </span>
        <span className="flex-1" />
        {status === 'human_takeover'
          ? <button disabled={!conv || !!ctlBusy} onClick={() => setConvStatus('active')} className={`${btn} !h-[26px] !px-2.5 !text-[11px]`}>{ctlBusy === 'hand' ? '…' : 'Hand to Lana'}</button>
          : <button disabled={!conv || !!ctlBusy || status === 'closed'} onClick={() => setConvStatus('human_takeover')} className={`${btn} !h-[26px] !px-2.5 !text-[11px] !border-[#e1d3f6] !text-[#5b2ea6]`}>{ctlBusy === 'take' ? '…' : 'Take over'}</button>}
        {channel === 'whatsapp' && (
          <button disabled={!conv || !!ctlBusy} onClick={lanaAnswers} title="Hands the chat to Lana and has her answer the guest's last message now"
            className={`${btn} !h-[26px] !px-2.5 !text-[11px] !border-[#c3e5db] !bg-[#e6f5f0] !text-[#0e5f47]`}>{ctlBusy === 'answer' ? 'Answering…' : 'Lana answers last'}</button>
        )}
      </div>

      <div className="min-h-[220px] flex-1 space-y-2 overflow-y-auto bg-[#f6f8f9] px-3.5 py-3">
        {!conv && !err && <p className="py-8 text-center text-[13px] text-[#8a93a3]">Loading…</p>}
        {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</p>}
        {conv && msgs.length === 0 && !err && <p className="py-8 text-center text-[13px] text-[#8a93a3]">No messages yet.</p>}
        {msgs.map((m) => {
          const mine = m.sender_type !== 'guest'
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${mine ? (m.sender_type === 'lana' ? 'rounded-br-md bg-[#e3e8f4]' : 'rounded-br-md bg-[#d7f0e6]') : 'rounded-bl-md bg-white shadow-sm'}`}>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className="mt-0.5 text-[10px] text-[#7a8394]">{WHO[m.sender_type] ?? m.sender_type} · {new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="space-y-2 border-t border-[#eef0f4] bg-white p-3">
        {conv && !conv.windowOpen && (
          <div className="space-y-1.5">
            <p className="text-[11.5px] leading-snug text-[#667085]">The guest hasn&apos;t written in 24 hours, so this goes out as Soirée&apos;s hello message. Write the reason in one sentence.</p>
            <div className="flex gap-1.5">
              {(['es', 'en'] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={chip(lang === l)}>{l === 'es' ? 'Español' : 'English'}</button>)}
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} disabled={!conv}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={conv?.windowOpen === false ? 'Why are you writing? One short sentence.' : 'Write a message…'}
            className="min-w-0 flex-1 resize-none rounded-[14px] border border-[#dde2ea] px-3 py-2 text-[13px] outline-none focus:border-[#128c7e] focus:ring-2 focus:ring-[#128c7e]/15" />
          <button disabled={!conv || !text.trim() || busy} onClick={send} className={`${priTeal} !h-9 !px-4 !text-[12.5px]`}>{busy ? '…' : 'Send'}</button>
        </div>
        {note && <p className={`text-[12px] ${note.ok ? 'text-emerald-700' : 'text-red-600'}`}>{note.text}</p>}
      </div>
    </div>
  )
}

let host: HTMLDivElement | null = null
let root: Root | null = null

function close() {
  root?.unmount()
  host?.remove()
  root = null
  host = null
}

/** Opens the message history as its own floating window — it lives outside the reservation window, so that can be closed or changed while this stays. */
export function openHistoryPopup(p: Props) {
  if (typeof document === 'undefined') return
  if (!host) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  root!.render(<Popup key={p.reservationId} {...p} onClose={close} />)
}
