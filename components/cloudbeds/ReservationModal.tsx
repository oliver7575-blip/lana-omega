'use client'

import { useEffect, useState } from 'react'
import { cbApi, statusLabel } from './shared'
import { HELLO_TEXT } from '@/lib/hello-text'
import { openHistoryPopup } from './MessageHistoryPopup'
import { HOLO_BG, InlinePanel, area, btn, btnLg, chip, field, lbl, priBlue, priGreen, priRed, priTeal } from './ui'

type Json = Record<string, unknown>

/** "guestHomePhone" → "Home Phone". Strips a leading "guest" and splits camelCase. */
function humanize(key: string): string {
  const stripped = key.replace(/^guest/, '') || key
  const spaced = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  return spaced.trim() || key
}

function valueText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    const parts = v.map((item) => {
      if (item && typeof item === 'object') {
        const o = item as Json
        const label = (o.field ?? o.name ?? o.label) as string | undefined
        const val = (o.value ?? o.text) as string | undefined
        if (label !== undefined) return val !== undefined ? `${label}: ${val}` : String(label)
        return JSON.stringify(o)
      }
      return String(item)
    })
    return parts.join(' · ')
  }
  if (typeof v === 'object') return null // nested objects skipped — flat fields cover the common case
  return String(v)
}

/** Every field Cloudbeds holds on the guest's profile, shown as plain label/value rows. */
function GuestProfileFields({ profile }: { profile: Json }) {
  const rows = Object.entries(profile)
    .map(([k, v]) => [humanize(k), valueText(v)] as const)
    .filter(([, v]) => v !== null)
  if (rows.length === 0) return <p className="text-sm text-[#9fb3dc]">No further guest details on file.</p>
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9fb3dc]">{label}</p>
          <p className="text-sm text-[#eaf0fb]">{value}</p>
        </div>
      ))}
    </div>
  )
}

interface Detail {
  reservationID: string
  guestName: string
  status: string
  source: string | null
  startDate: string
  endDate: string
  adults: number
  children: number
  rooms: { roomName: string | null; roomTypeName: string; adults?: number; children?: number }[]
  total: number | null
  balance: number | null
  estimatedArrivalTime: string | null
  guestEmail: string | null
  guestPhone: string | null
  guestCountry: string | null
  dateCreated: string | null
  confirmationCode: string | null
  specialRequests: string | null
  breakdown: { subTotal: number | null; additionalItems: number | null; taxesFees: number | null; paid: number | null }
}

/** "MX" → "Mexico"; anything that isn't a 2-letter code is shown as is. */
function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

const SPANISH_COUNTRIES = ['MX', 'ES', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR']

/** Reasons that fit the second blank of the "hello" template, one plain sentence each. */
const HELLO_REASONS: Record<'es' | 'en', { label: string; text: string }[]> = {
  es: [
    { label: 'After a call', text: 'Como quedamos en nuestra llamada, te escribimos para que tengas nuestro contacto.' },
    { label: 'Upcoming stay', text: 'Te escribimos por tu próxima estancia con nosotros.' },
    { label: 'Follow-up', text: 'Te escribimos para dar seguimiento a tu consulta.' },
    { label: 'Introduction', text: 'Queremos presentarnos antes de tu llegada.' },
  ],
  en: [
    { label: 'After a call', text: "As we agreed on our call, we're writing so you have our contact." },
    { label: 'Upcoming stay', text: "We're writing about your upcoming stay with us." },
    { label: 'Follow-up', text: "We're following up on your inquiry." },
    { label: 'Introduction', text: "We'd like to introduce ourselves before your arrival." },
  ],
}

const SIGNATURE_SUGGESTION = 'Oliver\nSoirée · Zipolite, Oaxaca\nsoiree.mx'

interface PaymentLinkResult {
  url: string
  amount: number
  reused: boolean
  email: { status: 'sent' | 'skipped' | 'failed'; detail: string }
  whatsapp: { status: 'sent' | 'skipped' | 'failed'; detail: string }
}

interface Note { author: string; date: string; text: string }

/** Booking source pill: Booking.com blue, Airbnb pink, walk-in light green, anything else light grey. */
function sourceStyle(source: string): React.CSSProperties {
  const s = source.toLowerCase()
  if (s.includes('booking.com')) return { background: '#0b4aa8', borderColor: '#0b4aa8', color: '#ffffff' }
  if (s.includes('airbnb')) return { background: '#ffe4ea', borderColor: '#fbb6c4', color: '#d6335a' }
  if (s.includes('walk')) return { background: '#e4f6ee', borderColor: '#bfe6d6', color: '#0e6b4a' }
  return { background: '#f1f3f6', borderColor: '#dde1e8', color: '#4a5262' }
}

export default function ReservationModal({ id, today, onClose, onChanged, onCheckedOut, onBalance }: {
  id: string
  today: string
  onClose: () => void
  onChanged?: () => void
  /** Called with a short message when a check-in or check-out succeeds; the window then closes itself. */
  onCheckedOut?: (text: string) => void
  /** Called with the new balance after a payment or refund is recorded. */
  onBalance?: (reservationID: string, balance: number | null) => void
}) {
  const [r, setR] = useState<Detail | null>(null)
  const [link, setLink] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  // Quick message bubble opened from the phone number (WhatsApp) or the email address.
  const [payBusy, setPayBusy] = useState(false)
  const [pay, setPay] = useState<PaymentLinkResult | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [quick, setQuick] = useState<'whatsapp' | 'email' | null>(null)
  const [quickText, setQuickText] = useState('')
  const [quickSubject, setQuickSubject] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const [sigDefault, setSigDefault] = useState('')
  const [sig, setSig] = useState('')
  const [sigOn, setSigOn] = useState(true)
  const [sigEdit, setSigEdit] = useState(false)
  const [sigCanEdit, setSigCanEdit] = useState(false)
  const [sigLoaded, setSigLoaded] = useState(false)
  const [waInfo, setWaInfo] = useState<{ conversationId: string; windowOpen: boolean; language: string | null } | null>(null)
  const [helloLang, setHelloLang] = useState<'es' | 'en'>('en')
  const [quickMsg, setQuickMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [time, setTime] = useState('')
  const [checkin, setCheckin] = useState('')
  const [checkout, setCheckout] = useState('')
  const [guestProfile, setGuestProfile] = useState<Json | null>(null)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [guestLoading, setGuestLoading] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmPayLink, setConfirmPayLink] = useState(false)
  const [confirmCheckOut, setConfirmCheckOut] = useState(false)
  // Add a payment / refund (Cloudbeds payment methods)
  const [mpKind, setMpKind] = useState<'payment' | 'refund' | null>(null)
  const [mpAmount, setMpAmount] = useState('')
  const [mpMethod, setMpMethod] = useState('')
  const [mpNote, setMpNote] = useState('')
  const [mpMethods, setMpMethods] = useState<{ code: string; name: string }[] | null>(null)
  const [mpBusy, setMpBusy] = useState(false)
  const [mpErr, setMpErr] = useState<string | null>(null)

  function openMoney(kind: 'payment' | 'refund') {
    if (!r) return
    setConfirmPayLink(false)
    setQuick(null)
    setPay(null)
    setPayError(null)
    setMpKind(kind)
    setMpErr(null)
    setMpNote('')
    const suggest = kind === 'payment' ? (r.balance && r.balance > 0 ? r.balance : 0) : (r.breakdown.paid ?? 0)
    setMpAmount(suggest > 0 ? String(Math.round(suggest * 100) / 100) : '')
    if (!mpMethods) {
      cbApi<{ paymentMethods: { code: string; name: string }[] }>('/api/cloudbeds/availability?options=1')
        .then((o) => {
          setMpMethods(o.paymentMethods)
          const cash = o.paymentMethods.find((m) => /cash|efectivo/i.test(m.code + m.name)) ?? o.paymentMethods[0]
          if (cash) setMpMethod((cur) => cur || cash.code)
        })
        .catch(() => setMpMethods([]))
    }
  }

  async function submitMoney() {
    if (!mpKind) return
    setMpBusy(true)
    setMpErr(null)
    try {
      const j = await cbApi<{ reservation: Detail }>(`/api/cloudbeds/reservation/${id}/payment`, 'POST', { kind: mpKind, amount: Number(mpAmount), method: mpMethod, note: mpNote })
      apply(j.reservation)
      // Cloudbeds can return the old balance for a moment, so work it out from what was just recorded as well.
      const amt = Number(mpAmount)
      const before = r?.balance ?? null
      const expected = before === null ? null : mpKind === 'refund' ? before + amt : Math.max(0, before - amt)
      const returned = j.reservation.balance
      onBalance?.(id, expected === null ? returned : mpKind === 'refund' ? Math.max(expected, returned ?? 0) : Math.min(expected, returned ?? expected))
      const text = `${mpKind === 'refund' ? 'Refund' : 'Payment'} of MXN ${Number(mpAmount).toLocaleString('en-US')} recorded.`
      setMpKind(null)
      onChanged?.()
      if (onCheckedOut) {
        onCheckedOut(`${j.reservation.guestName}: ${text.charAt(0).toLowerCase()}${text.slice(1).replace(/\.$/, '')}.`)
        onClose()
        return
      }
      setMsg(text)
    } catch (e) {
      setMpErr(e instanceof Error ? e.message : 'Cloudbeds error')
    }
    setMpBusy(false)
  }

  function apply(d: Detail) {
    setR(d)
    setTime(d.estimatedArrivalTime ?? '')
    setCheckin(d.startDate)
    setCheckout(d.endDate)
  }

  useEffect(() => {
    cbApi<{ reservation: Detail; link: string; notes?: Note[] }>(`/api/cloudbeds/reservation/${id}`)
      .then((j) => { apply(j.reservation); setLink(j.link); setNotes(j.notes ?? []) })
      .catch((e) => setError(e.message))
  }, [id])

  async function act(body: Record<string, string>, ok: string) {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const j = await cbApi<{ reservation: Detail }>(`/api/cloudbeds/reservation/${id}`, 'POST', body)
      apply(j.reservation)
      onChanged?.()
      if (['check_out', 'check_in', 'dates', 'arrival_time', 'cancel'].includes(String(body.action))) {
        onCheckedOut?.(`${j.reservation.guestName}: ${ok.replace(/\.$/, '').toLowerCase()}.`)
        onClose()
        return
      }
      setMsg(ok)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cloudbeds error')
    }
    setBusy(false)
  }

  function loadGuest() {
    if (guestProfile || guestLoading) return
    setGuestLoading(true)
    setGuestError(null)
    cbApi<{ profile: Json }>(`/api/cloudbeds/reservation/${id}/guest`)
      .then((j) => setGuestProfile(j.profile))
      .catch((e) => setGuestError(e instanceof Error ? e.message : 'Could not load guest details'))
      .finally(() => setGuestLoading(false))
  }

  async function createPaymentLinkNow() {
    setConfirmPayLink(false)
    setMpKind(null)
    setQuick(null)
    setPayBusy(true)
    setPayError(null)
    setPay(null)
    setCopied(false)
    try {
      setPay(await cbApi<PaymentLinkResult>(`/api/cloudbeds/reservation/${id}/payment-link`, 'POST', {}))
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Could not create the payment link')
    }
    setPayBusy(false)
  }

  async function copyPaymentLink() {
    if (!pay) return
    try {
      await navigator.clipboard.writeText(pay.url)
    } catch {
      const el = document.getElementById('pay-link-input') as HTMLInputElement | null
      el?.select()
      document.execCommand('copy')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openQuick(kind: 'whatsapp' | 'email') {
    setConfirmPayLink(false)
    setMpKind(null)
    setPay(null)
    setPayError(null)
    setQuick((q) => (q === kind ? null : kind))
    setQuickMsg(null)
    if (kind === 'email' && !sigLoaded) {
      fetch('/api/email-signature')
        .then((res) => res.json())
        .then((j: { signature?: string; canEdit?: boolean }) => {
          setSigDefault(j.signature ?? '')
          setSig(j.signature ?? '')
          setSigCanEdit(Boolean(j.canEdit))
        })
        .catch(() => {})
        .finally(() => setSigLoaded(true))
    }
    if (kind === 'whatsapp' && !waInfo) {
      // Is the 24-hour window open? Decides between free text and the approved template.
      cbApi<{ conversationId: string; windowOpen: boolean; language: string | null }>(`/api/cloudbeds/reservation/${id}/conversation`)
        .then((j) => {
          setWaInfo(j)
          const byCountry = r?.guestCountry && SPANISH_COUNTRIES.includes(r.guestCountry.toUpperCase()) ? 'es' : 'en'
          setHelloLang(j.language === 'es' ? 'es' : j.language === 'en' || j.language === 'sv' ? 'en' : byCountry)
        })
        .catch((e) => setQuickMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not open this guest’s chat' }))
    }
  }

  async function sendQuick() {
    if (!quick || !quickText.trim() || (quick === 'email' && !quickSubject.trim())) return
    setQuickBusy(true)
    setQuickMsg(null)
    try {
      if (quick === 'whatsapp') {
        const conv = waInfo ?? (await cbApi<{ conversationId: string; windowOpen: boolean; language: string | null }>(`/api/cloudbeds/reservation/${id}/conversation`))
        if (conv.windowOpen) {
          // Same path as the Messages page: a staff reply into the guest's conversation.
          const res = await fetch(`/api/conversations/${conv.conversationId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: quickText }),
          })
          const j = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(j.error ?? 'Could not send')
          if (j.deliveryResult && j.deliveryResult.success === false) {
            setQuickMsg({ ok: false, text: `Saved, but WhatsApp didn't deliver it: ${j.deliveryResult.error}` })
            setQuickBusy(false)
            return
          }
          setQuickMsg({ ok: true, text: 'Sent on WhatsApp.' })
        } else {
          // Outside the 24-hour window: the approved "hello" template, with the text as its reason sentence.
          const res = await fetch(`/api/conversations/${conv.conversationId}/hello`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: quickText, language: helloLang, firstName: r?.guestName.split(' ')[0] }),
          })
          const j = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(j.error ?? 'Could not send')
          setQuickMsg({ ok: true, text: 'Sent on WhatsApp as the Soirée hello message.' })
        }
      } else {
        const j = await cbApi<{ to: string }>(`/api/cloudbeds/reservation/${id}/email`, 'POST', { subject: quickSubject, body: quickText, signature: sigOn ? sig : '' })
        setQuickMsg({ ok: true, text: `Email sent to ${j.to}.` })
      }
      setQuickText('')
      if (quick === 'email') setQuickSubject('')
    } catch (e) {
      setQuickMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not send' })
    }
    setQuickBusy(false)
  }

  async function saveSignatureDefault() {
    setQuickBusy(true)
    try {
      const res = await fetch('/api/email-signature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not save the signature')
      setSigDefault(sig.trim())
      setSigEdit(false)
      setQuickMsg({ ok: true, text: 'Signature saved as the default.' })
    } catch (e) {
      setQuickMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save the signature' })
    }
    setQuickBusy(false)
  }

  async function cancelReservation() {
    await act({ action: 'cancel' }, 'Reservation canceled.')
    setConfirmCancel(false)
  }

  const pill = (() => {
    const k = (r?.status ?? '').toLowerCase()
    if (k === 'checked_in' || k === 'in_house') return { bg: '#cdeee1', border: '#8fd3b8', text: '#0e4d38' }
    if (k === 'checked_out') return { bg: '#e6e9ef', border: '#c5cad4', text: '#4a5262' }
    if (k === 'not_confirmed') return { bg: '#fdeccb', border: '#f0c978', text: '#7a4a05' }
    if (k === 'canceled' || k === 'cancelled') return { bg: '#fde0e0', border: '#f0a9a9', text: '#7a1b1b' }
    return { bg: '#d6e4fb', border: '#9bbbf0', text: '#17356b' }
  })()
  const canCancel = r && !['canceled', 'cancelled', 'checked_out', 'no_show'].includes(r.status)
  const isThirdParty = Boolean(r && (r.confirmationCode || /booking\.com|airbnb|expedia|agoda|vrbo|homeaway|hostelworld|tripadvisor|trip\.com|despegar|hotels\.com|google|kayak|trivago/i.test(r.source ?? '')))
  const canCheckOut = r && ['checked_in', 'in_house'].includes(r.status)
  const canCheckIn = r && ['confirmed', 'not_confirmed'].includes(r.status) && r.startDate <= today
  const bt = '!h-[26px] !px-2 !text-[11px]'
  const nights = r ? Math.max(1, Math.round((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86400000)) : 0
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const money = (n: number | null) => `MXN ${n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  const owes = Boolean(r && r.balance && r.balance > 0)
  const panelOpen = Boolean(r && (mpKind || (confirmCheckOut && owes) || confirmCancel || confirmPayLink || pay || payError || quick))
  const firstName = r?.guestName.split(' ')[0] || 'guest'
  const roomNames = r ? r.rooms.map((x) => x.roomName ?? `${x.roomTypeName} (unassigned)`).join(', ') || '—' : ''
  const roomTypes = r ? Array.from(new Set(r.rooms.map((x) => x.roomTypeName).filter(Boolean))).join(', ') : ''
  const roomDigit = r?.rooms[0]?.roomName ? (r.rooms[0].roomName.match(/\d+/)?.[0] ?? r.rooms[0].roomName.slice(0, 3)) : '–'
  const bd = r?.breakdown
  const paidAmt = r ? (bd?.paid ?? (r.total !== null && r.balance !== null ? r.total - r.balance : null)) : null
  const card = 'rounded-xl border border-[#8fb4ff]/25 bg-[#0f1c42]/40 px-3 py-2.5'
  const row = 'flex justify-between gap-3 py-[2px] text-[12px]'
  const rowL = 'flex items-baseline gap-3 py-[2px] text-[12px]'
  const lblL = 'w-[52px] shrink-0 text-[#9fb3dc]'
  const mini = 'rounded-lg border border-[#8fb4ff]/25 px-2.5 py-2'
  const chipSm = 'mr-2 inline-block rounded-full border border-[#8fb4ff]/35 px-1.5 align-middle text-[8px] font-medium uppercase leading-[14px] tracking-wide text-[#9fb3dc] hover:border-[#128c7e] hover:text-[#5fe0cf]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050b1f]/60 p-4" onClick={onClose}>
      <div style={{ zoom: 0.9, background: HOLO_BG }} className="flex max-h-[calc((100vh-2rem)/0.9)] w-full max-w-[700px] flex-col overflow-y-auto rounded-3xl border border-[#8fb4ff]/25 text-[#eaf0fb] shadow-[0_30px_80px_rgba(0,0,0,.55)]" onClick={(e) => e.stopPropagation()}>
        {/* Banner */}
        <div className="relative shrink-0 border-b border-[#8fb4ff]/20 bg-gradient-to-br from-[#2a4f9c]/55 via-[#1d3a78]/45 to-[#16305f]/30 px-5 pb-3 pt-3.5 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {r && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold capitalize">{statusLabel(r.status)}</span>}
              {r?.source && <span className="rounded-full border px-3 py-[3px] text-xs font-semibold" style={sourceStyle(r.source)}>{r.source}</span>}
              {r?.confirmationCode && <span className="ml-1 truncate text-[12px] uppercase tracking-wide text-[#b7c9d8]">{r.source || 'Booking'} no. <b className="font-semibold text-white">{r.confirmationCode}</b></span>}
            </div>
            <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/30 text-lg leading-none text-white hover:bg-white/10">×</button>
          </div>
          <p className="mt-1.5 truncate text-[21px] font-bold leading-tight tracking-tight">{r ? r.guestName : 'Loading…'}{r && <span title="Reservation number inside Cloudbeds" className="ml-2.5 text-[12px] font-medium uppercase tracking-wide text-[#b7c9d8]">#{id}</span>}</p>
          {r && (
            <>
              <div className="mt-2 flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-[#b7c9d8]">
                <span>Booked {r.dateCreated ? r.dateCreated.slice(0, 10) : '—'} · {r.adults} adult{r.adults === 1 ? '' : 's'}{r.children ? ` · ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}</span>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white">· Arrival
                  <input type="text" inputMode="numeric" maxLength={5} placeholder="--:--" value={time} aria-label="Estimated arrival time"
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, '').slice(0, 4)
                      setTime(d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d)
                    }}
                    className="h-[22px] w-[60px] rounded-md border border-white/30 bg-white/10 px-1 text-center text-[12px] font-bold text-white outline-none placeholder:text-white/50 focus:border-white/60" />
                  {time !== (r.estimatedArrivalTime ?? '') && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && (
                    <button disabled={busy} onClick={() => act({ action: 'arrival_time', time }, 'Arrival time updated.')} className="rounded-full bg-white/90 px-2 py-px text-[10.5px] font-bold text-[#14264f] hover:bg-white disabled:opacity-60">Save</button>
                  )}
                </span>
              </p>
              <div className="mt-2.5 flex items-center gap-2.5">
                <div><p className="text-[9.5px] font-semibold tracking-[.08em] text-[#9fb8ca]">CHECK-IN</p><p className="text-[14px] font-bold">{fmtDay(r.startDate)}</p></div>
                <div className="flex flex-1 items-center">
                  <i className="block h-2.5 w-2.5 rounded-full bg-[#4ade9f]" />
                  <i className="block h-0.5 flex-1 bg-white/30" />
                  <span className="whitespace-nowrap rounded-full bg-white/15 px-3 py-[3px] text-xs font-semibold">{nights} night{nights === 1 ? '' : 's'}</span>
                  <i className="block h-0.5 flex-1 bg-white/30" />
                  <i className="block h-2.5 w-2.5 rounded-full border-2 border-white" />
                </div>
                <div className="text-right"><p className="text-[9.5px] font-semibold tracking-[.08em] text-[#9fb8ca]">CHECK-OUT</p><p className="text-[14px] font-bold">{fmtDay(r.endDate)}</p></div>
              </div>
              </div>
              {/* Balance */}
              <div className="flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-[#8fb4ff]/30 bg-[#0f1c42]/70 px-3 py-1.5 text-white shadow-[0_10px_26px_rgba(0,0,0,.3)] sm:justify-start">
                <div>
                  <p className={`text-[9.5px] font-bold tracking-[.06em] ${owes ? 'text-[#ff6b75]' : 'text-[#3ccf8a]'}`}>{owes ? 'BALANCE DUE' : 'PAID IN FULL'}</p>
                  <p className={`text-[16px] font-bold tracking-tight ${owes ? 'text-[#ff6b75]' : 'text-[#3ccf8a]'}`}>MXN {(r.balance ?? 0).toLocaleString('en-US')}</p>
                </div>
                <button onClick={() => openMoney('payment')}
                  className={`h-[28px] whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold text-white transition ${mpKind === 'payment' ? 'bg-[#0e5f47] ring-4 ring-[#1f9d78]/25' : 'bg-gradient-to-b from-[#27ad86] to-[#1a8f6c] shadow-[0_4px_10px_rgba(31,157,120,.35),inset_0_1px_0_rgba(255,255,255,.25)] hover:brightness-95'}`}>
                  + Add payment
                </button>
              </div>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mx-5 mt-2.5 rounded-xl border border-[#ff6b75]/40 bg-[#ff6b75]/15 px-3 py-2 text-sm text-[#ffb3b8]">
            <p>{error}</p>
            {/balance/i.test(error) && (
              <p className="mt-1 text-[13px] text-[#ffd0d4]">
                Cloudbeds won&apos;t let an outside app check out a guest with an open balance (only its own screen has the &ldquo;check out anyway&rdquo; step).
                Either clear the balance first, or{' '}
                {link ? <a href={link} target="_blank" rel="noreferrer" className="font-semibold underline">open this reservation in Cloudbeds</a> : 'open it in Cloudbeds'} and check out there.
              </p>
            )}
          </div>
        )}
        {msg && <p className="mx-5 mt-2.5 rounded-xl border border-[#3ccf8a]/40 bg-[#3ccf8a]/15 px-3 py-2 text-sm text-[#7be8b4]">{msg}</p>}

        {r && (
          <div className="flex flex-col gap-3 px-5 pb-4 pt-4">
            {/* Action row */}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {canCheckIn && (
                <button disabled={busy} onClick={() => act({ action: 'check_in' }, 'Checked in.')} className={`${btn} ${bt} !border-[#8fb4ff]/40 !bg-[#5b95f5]/20 !text-[#8fb4ff]`}>✓ Check in</button>
              )}
              {canCheckOut && (
                <button disabled={busy} onClick={() => (r.balance && r.balance > 0 ? setConfirmCheckOut(true) : act({ action: 'check_out' }, 'Checked out.'))} className={`${btn} ${bt} !border-[#ff6b75]/45 !text-[#ff6b75]`}>Check out</button>
              )}
              <button disabled={payBusy} onClick={() => { setMpKind(null); setQuick(null); setPay(null); setPayError(null); setConfirmPayLink((v) => !v) }} className={`${btn} ${bt} ${pay || confirmPayLink ? '!border-[#3ccf8a]/70 !bg-[#3ccf8a]/35' : '!border-[#3ccf8a]/45 !bg-[#3ccf8a]/20'} !text-[#7be8b4]`}>
                🔗 {payBusy ? 'Creating…' : 'Payment link'}
              </button>
              <button onClick={() => openMoney('refund')} className={`${btn} ${bt} !text-[#ff9aa0] ${mpKind === 'refund' ? '!border-[#ff6b75]/70 !bg-[#ff6b75]/20' : ''}`}>↩ Refund</button>
              {r.guestPhone && (
                <button onClick={() => (quick === 'whatsapp' ? setQuick(null) : openQuick('whatsapp'))}
                  className={quick === 'whatsapp' ? `${btn} ${bt} !border-[#128c7e] !bg-[#128c7e] !text-white shadow-[0_3px_8px_rgba(18,140,126,.35)]` : `${btn} ${bt} !border-[#8fb4ff]/40 !text-[#8fb4ff]`}>
                  💬 Message
                </button>
              )}
              {r.guestEmail && (
                <button onClick={() => (quick === 'email' ? setQuick(null) : openQuick('email'))}
                  className={quick === 'email' ? `${btn} ${bt} !border-[#2456b8] !bg-[#2456b8] !text-white shadow-[0_3px_8px_rgba(36,86,184,.35)]` : `${btn} ${bt} !border-[#8fb4ff]/40 !text-[#8fb4ff]`}>
                  ✉ Email
                </button>
              )}
              <button onClick={() => openHistoryPopup({ reservationId: id, guestName: r.guestName })} className={`${btn} ${bt} !border-[#8fb4ff]/40 !text-[#8fb4ff]`}>Message history</button>
              <span className="flex-1" />
              {canCancel && (
                <button disabled={busy} onClick={() => setConfirmCancel(true)} className={`${btn} ${bt} !border-[#ff6b75]/45 !bg-[#ff6b75]/10 !text-[#ff6b75]`}>Cancel reservation</button>
              )}
            </div>

            {/* Add payment / refund */}
            {mpKind && (
              <InlinePanel tone={mpKind === 'refund' ? 'red' : 'green'} title={mpKind === 'refund' ? 'Refund a payment' : 'Add a payment'}
                subtitle={mpKind === 'refund' ? <>Paid <b>{money(paidAmt)}</b></> : <>Balance due <b className="text-[#ff6b75]">{money(r.balance)}</b></>}
                onClose={() => setMpKind(null)}>
                <div className="grid grid-cols-2 gap-3">
                  <label className={lbl}>Amount (MXN)
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={mpAmount} onChange={(e) => setMpAmount(e.target.value)} autoFocus
                      className={`${field} mt-1.5 !h-11 !text-[17px] !font-semibold normal-case tracking-normal`} />
                  </label>
                  <label className={lbl}>Payment method
                    <select value={mpMethod} onChange={(e) => setMpMethod(e.target.value)} disabled={!mpMethods} className={`${field} mt-1.5 !h-11 normal-case tracking-normal`}>
                      {!mpMethods && <option>Loading…</option>}
                      {mpMethods?.length === 0 && <option value="">No methods found</option>}
                      {mpMethods?.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
                    </select>
                  </label>
                </div>
                {mpKind === 'payment' && owes && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button className={chip(Number(mpAmount) === r.balance)} onClick={() => setMpAmount(String(r.balance))}>Full balance</button>
                    <button className={chip(false)} onClick={() => setMpAmount(String(Math.round(((r.balance ?? 0) / 2) * 100) / 100))}>50%</button>
                    {r.total !== null && nights > 0 && <button className={chip(false)} onClick={() => setMpAmount(String(Math.round(((r.total ?? 0) / nights) * 100) / 100))}>1 night</button>}
                    <span className="ml-auto text-[12.5px] text-[#9fb3dc]">Remaining after: <b className="text-[#3ccf8a]">{money(Math.max(0, (r.balance ?? 0) - (Number(mpAmount) || 0)))}</b></span>
                  </div>
                )}
                <label className={lbl}>{mpKind === 'refund' ? 'Reason (optional)' : 'Note (optional)'}
                  <input value={mpNote} onChange={(e) => setMpNote(e.target.value)} placeholder={mpKind === 'refund' ? 'Reason for the refund' : 'e.g. paid at the front desk'} className={`${field} mt-1.5 normal-case tracking-normal`} />
                </label>
                {mpKind === 'refund' && <p className="rounded-xl border border-[#ff6b75]/40 bg-[#ff6b75]/15 px-3 py-2 text-[12.5px] leading-snug text-[#ffb3b8]">This records the refund in Cloudbeds only. It does not send money back to the guest, so return it yourself (card, transfer or cash).</p>}
                {mpErr && <p className="text-sm text-[#ff9aa0]">{mpErr}</p>}
                <div className="flex justify-end gap-2.5">
                  <button onClick={() => setMpKind(null)} className={btnLg}>Cancel</button>
                  <button disabled={mpBusy || !mpMethod || !(Number(mpAmount) > 0)} onClick={submitMoney} className={mpKind === 'refund' ? priRed : priGreen}>
                    {mpBusy ? 'Saving…' : mpKind === 'refund' ? 'Record refund' : 'Record payment'}
                  </button>
                </div>
              </InlinePanel>
            )}

            {/* Check out with balance */}
            {confirmCheckOut && owes && (
              <InlinePanel tone="amber" title="This guest still has a balance due" subtitle={<>{money(r.balance)} outstanding</>} onClose={() => setConfirmCheckOut(false)}>
                <p className="rounded-xl border border-[#f0b548]/40 bg-[#f0b548]/15 px-3 py-2 text-[13px] leading-snug text-[#f5d58a]">
                  {r.guestName} owes <b>MXN {r.balance!.toLocaleString('en-US')}</b>. Check out anyway? The balance stays open on the reservation in Cloudbeds.
                </p>
                <div className="flex flex-wrap justify-end gap-2.5">
                  <button onClick={() => setConfirmCheckOut(false)} className={btnLg}>Back</button>
                  <button onClick={() => { setConfirmCheckOut(false); createPaymentLinkNow() }} className={btnLg}>Send payment link instead</button>
                  <button disabled={busy} onClick={() => { setConfirmCheckOut(false); act({ action: 'check_out' }, 'Checked out with the balance still open.') }} className={priRed}>Yes, check out anyway</button>
                </div>
              </InlinePanel>
            )}

            {/* Cancel */}
            {confirmCancel && (
              <InlinePanel tone="red" title="Cancel this reservation?" subtitle={`${r.guestName} · ${r.startDate} – ${r.endDate} · #${id}`} onClose={() => setConfirmCancel(false)}>
                <p className={`rounded-xl px-3 py-2 text-[13px] leading-snug ${isThirdParty ? 'border border-[#f0b548]/40 bg-[#f0b548]/15 font-semibold text-[#f5d58a]' : 'border border-[#ff6b75]/40 bg-[#0f1c42]/40 text-[#ffb3b8]'}`}>
                  {isThirdParty ? 'This is an OTA / third-party booking' + (r.source ? ` (${r.source})` : '') + '. ' : ''}
                  Reservations made through an OTA or other third party (Airbnb, Booking.com, Expedia…) must also be cancelled directly with them. Cancelling here does not cancel it on their platform.
                </p>
                <div className="flex justify-end gap-2.5">
                  <button disabled={busy} onClick={() => setConfirmCancel(false)} className={btnLg}>Keep reservation</button>
                  <button disabled={busy} onClick={cancelReservation} className={priRed}>{busy ? 'Cancelling…' : 'Yes, cancel reservation'}</button>
                </div>
              </InlinePanel>
            )}

            {/* Confirm payment link */}
            {confirmPayLink && (
              <InlinePanel tone="blue" title="Generate a payment link?" subtitle={<>For the balance of <b>{money(r.balance)}</b></>} onClose={() => setConfirmPayLink(false)}>
                <p className="rounded-xl border border-[#8fb4ff]/30 bg-[#0f1c42]/40 px-3 py-2 text-[12.5px] leading-snug text-[#cfdcff]">
                  This creates a payment link for {r.guestName} and sends it to the guest by email and WhatsApp where contact details are on file.
                </p>
                <div className="flex justify-end gap-2.5">
                  <button onClick={() => setConfirmPayLink(false)} className={btnLg}>Cancel</button>
                  <button disabled={payBusy} onClick={createPaymentLinkNow} className={priBlue}>{payBusy ? 'Creating…' : 'Yes, generate link'}</button>
                </div>
              </InlinePanel>
            )}

            {/* Payment link */}
            {(pay || payError) && (
              <InlinePanel tone="blue" title={pay ? `Payment link · MXN ${pay.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Payment link'} onClose={() => { setPay(null); setPayError(null) }}>
                {payError && <p className="text-sm text-[#ff9aa0]">{payError}</p>}
                {pay && (
                  <>
                    <div className="flex gap-2">
                      <input id="pay-link-input" readOnly value={pay.url} onFocus={(e) => e.currentTarget.select()} className={`${field} min-w-0 flex-1 !bg-[#0f1c42]/60 !text-xs !text-[#8fb4ff]`} />
                      <button onClick={copyPaymentLink} className={priGreen}>{copied ? 'Copied ✓' : 'Copy link'}</button>
                    </div>
                    <ul className="space-y-0.5 text-xs">
                      {([['Email', pay.email], ['WhatsApp', pay.whatsapp]] as const).map(([k, s]) => (
                        <li key={k} className={s.status === 'sent' ? 'text-[#7be8b4]' : s.status === 'failed' ? 'text-[#ff9aa0]' : 'text-[#9fb3dc]'}>
                          <b>{k}:</b> {s.status === 'sent' ? '✓ ' : s.status === 'failed' ? '✗ ' : '– '}{s.detail}
                        </li>
                      ))}
                    </ul>
                    {pay.reused && <p className="rounded-xl bg-[#0f1c42]/60 px-3 py-2 text-[12.5px] text-[#9fb3dc]">A link for this balance already existed, so it was sent again.</p>}
                  </>
                )}
              </InlinePanel>
            )}

            {/* Message */}
            {quick && (
              <InlinePanel tone="teal" title={
                <span className="inline-flex rounded-full bg-white/10 p-[3px]">
                  {r.guestPhone && <button onClick={() => quick !== 'whatsapp' && openQuick('whatsapp')} className={`rounded-full px-4 py-1.5 text-[12.5px] ${quick === 'whatsapp' ? 'bg-white/90 font-semibold text-[#14264f] shadow' : 'font-medium text-[#9fb3dc]'}`}>WhatsApp</button>}
                  {r.guestEmail && <button onClick={() => quick !== 'email' && openQuick('email')} className={`rounded-full px-4 py-1.5 text-[12.5px] ${quick === 'email' ? 'bg-white/90 font-semibold text-[#14264f] shadow' : 'font-medium text-[#9fb3dc]'}`}>Email</button>}
                </span>
              } subtitle={<>to <b className="font-semibold text-[#eaf0fb]">{quick === 'whatsapp' ? r.guestPhone : r.guestEmail}</b> · {firstName}</>} onClose={() => setQuick(null)}>
                {quick === 'whatsapp' && waInfo && !waInfo.windowOpen && (
                  <>
                    <p className="text-[12.5px] text-[#9fb3dc]">This guest hasn&apos;t written in the last 24 hours, so this goes out as Soirée&apos;s approved hello message. Write the reason in one sentence.</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {(['es', 'en'] as const).map((l) => (
                        <button key={l} onClick={() => setHelloLang(l)} className={chip(helloLang === l)}>{l === 'es' ? 'Español' : 'English'}</button>
                      ))}
                      <span className="mx-1 h-4 w-px bg-white/20" />
                      <span className="text-xs text-[#9fb3dc]">Reason</span>
                      {HELLO_REASONS[helloLang].map((x) => (
                        <button key={x.label} onClick={() => setQuickText(x.text)} className={chip(quickText === x.text)}>{x.label}</button>
                      ))}
                    </div>
                  </>
                )}
                {quick === 'email' && (
                  <input value={quickSubject} onChange={(e) => setQuickSubject(e.target.value)} placeholder="Subject" className={field} />
                )}
                <textarea value={quickText} onChange={(e) => setQuickText(e.target.value)} rows={4} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendQuick() }}
                  placeholder={quick === 'whatsapp' ? (waInfo && !waInfo.windowOpen ? 'Why are you writing? One short sentence.' : 'Write a message… (sent as staff, like on the Messages page)') : 'Write the email…'}
                  className={area} />
                {quick === 'whatsapp' && waInfo && !waInfo.windowOpen && (
                  <div className="rounded-[14px] border border-[#3ccf8a]/40 bg-[#3ccf8a]/15 px-3.5 py-3">
                    <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[.07em] text-[#7be8b4]">This is exactly what the guest will receive</p>
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#d5f5e6]">
                      {HELLO_TEXT[helloLang](firstName, quickText.replace(/[\n\t]+/g, ' ').trim() || (helloLang === 'es' ? '[tu motivo aquí]' : '[your reason here]'))}
                    </p>
                  </div>
                )}
                {quick === 'email' && (
                  <div className="rounded-[14px] border border-dashed border-[#8fb4ff]/35 bg-[#0f1c42]/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-[#9fb3dc]">
                        <input type="checkbox" checked={sigOn} onChange={(e) => setSigOn(e.target.checked)} /> Signature
                      </label>
                      <button onClick={() => setSigEdit((v) => !v)} className="text-xs font-semibold text-[#5fe0cf] hover:underline">{sigEdit ? 'Done' : sig ? 'Edit' : 'Add'}</button>
                    </div>
                    {sigEdit ? (
                      <>
                        <textarea value={sig} onChange={(e) => setSig(e.target.value)} rows={4} placeholder={SIGNATURE_SUGGESTION} className={`${area} mt-1.5`} />
                        {!sig.trim() && (
                          <button onClick={() => setSig(SIGNATURE_SUGGESTION)} className="mt-1 text-xs font-semibold text-[#5fe0cf] hover:underline">Use this suggestion</button>
                        )}
                        <div className="mt-1 flex items-center gap-3 text-xs">
                          {sigCanEdit && sig.trim() !== sigDefault && (
                            <button disabled={quickBusy} onClick={saveSignatureDefault} className="font-semibold text-[#5fe0cf] hover:underline">Save as default for everyone</button>
                          )}
                          <span className="text-[#9fb3dc]">Changes here apply to this email only unless you save them.</span>
                        </div>
                      </>
                    ) : sigOn && sig ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-[#9fb3dc]">{sig}</p>
                    ) : !sig ? (
                      <p className="mt-1 text-xs text-[#8ea3cf]">No signature yet.</p>
                    ) : null}
                  </div>
                )}
                <div className="flex items-center justify-end gap-3">
                  {quickMsg && <p className={`mr-auto text-sm ${quickMsg.ok ? 'text-[#7be8b4]' : 'text-[#ff9aa0]'}`}>{quickMsg.text}</p>}
                  <button disabled={quickBusy || !quickText.trim() || (quick === 'email' && !quickSubject.trim())} onClick={sendQuick} className={quick === 'whatsapp' ? priTeal : priBlue}>
                    {quickBusy ? 'Sending…' : quick === 'whatsapp' ? 'Send WhatsApp ➤' : 'Send email ➤'}
                  </button>
                </div>
              </InlinePanel>
            )}

            {panelOpen ? (
              /* Collapsed summary while a panel is open */
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#9fb3dc]">Room</p><p className="mt-0.5 text-[13.5px] font-semibold">{roomNames}</p></div>
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#9fb3dc]">Total</p><p className="mt-0.5 text-[13.5px] font-semibold">{money(r.total)}</p></div>
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#9fb3dc]">Paid</p><p className="mt-0.5 text-[13.5px] font-semibold text-[#3ccf8a]">{money(paidAmt)}</p></div>
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#9fb3dc]">Arrival</p><p className="mt-0.5 text-[13.5px] font-semibold">{r.estimatedArrivalTime || '—'}</p></div>
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {/* Room */}
                <div className={card}>
                  <p className={lbl}>{r.rooms.length > 1 ? `Rooms (${r.rooms.length})` : 'Room'}</p>
                  <div className="space-y-2">
                    {(r.rooms.length ? r.rooms : [{ roomName: null, roomTypeName: '—' } as Detail['rooms'][number]]).map((x, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="flex h-8 min-w-[32px] shrink-0 items-center justify-center rounded-lg bg-[#5b95f5]/25 px-1.5 text-[14px] font-bold text-[#8fb4ff]">
                          {x.roomName ? (x.roomName.match(/\d+/)?.[0] ?? x.roomName.slice(0, 3)) : '–'}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold">{x.roomName ?? 'Not assigned'}</p>
                          <p className="truncate text-[11px] text-[#9fb3dc]">{x.roomTypeName}</p>
                        </div>
                        {r.rooms.length > 1 && (
                          <p className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-[#cfdcff]">
                            {(x.adults ?? 0) + (x.children ?? 0)} guest{(x.adults ?? 0) + (x.children ?? 0) === 1 ? '' : 's'}
                            {(x.children ?? 0) > 0 ? ` · ${x.adults ?? 0}A ${x.children}C` : ''}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-[#8fb4ff]/15 pt-2">
                    <div className={row}><span className="text-[#9fb3dc]">Guests</span><span>{r.adults} adult{r.adults === 1 ? '' : 's'} · {r.children} child{r.children === 1 ? '' : 'ren'}</span></div>
                  </div>
                </div>

                {/* Price */}
                <div className={card}>
                  <div className="flex justify-between"><p className={lbl}>Price breakdown</p><span className={`text-xs font-semibold ${owes ? 'text-[#ff6b75]' : 'text-[#3ccf8a]'}`}>{owes ? 'Unpaid' : 'Paid'}</span></div>
                  {bd?.subTotal != null && <div className={row}><span className="text-[#9fb3dc]">Room · {nights} night{nights === 1 ? '' : 's'}</span><span>{money(bd.subTotal)}</span></div>}
                  {bd?.additionalItems != null && bd.additionalItems !== 0 && <div className={row}><span className="text-[#9fb3dc]">Extras</span><span>{money(bd.additionalItems)}</span></div>}
                  {bd?.taxesFees != null && <div className={row}><span className="text-[#9fb3dc]">Taxes &amp; fees</span><span>{money(bd.taxesFees)}</span></div>}
                  <div className={`${row} mt-1 border-t border-[#8fb4ff]/25 pt-2.5 font-bold`}><span>Grand total</span><span>{money(r.total)}</span></div>
                  <div className={row}><span className="text-[#9fb3dc]">Paid</span><span className="font-semibold text-[#3ccf8a]">{money(paidAmt)}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/10"><i className="block h-full rounded-full bg-[#1f9d78]" style={{ width: `${r.total ? Math.min(100, Math.max(0, ((paidAmt ?? 0) / r.total) * 100)) : 0}%` }} /></div>
                </div>

                {/* Guest */}
                <div className={card}>
                  <p className={lbl}>Guest</p>
                  {r.guestPhone && (
                    <div className={rowL}><span className={lblL}>Phone</span>
                      <span><button onClick={() => openQuick('whatsapp')} title="Send a WhatsApp message" className={chipSm}>message</button>
                        <button onClick={() => openQuick('whatsapp')} title="Send a WhatsApp message" className="font-medium text-[#8fb4ff] hover:underline">{r.guestPhone}</button></span>
                    </div>
                  )}
                  {r.guestEmail && (
                    <div className={rowL}><span className={lblL}>Email</span>
                      <span className="min-w-0 break-all"><button onClick={() => openQuick('email')} title="Send an email" className={chipSm}>email</button>
                        <button onClick={() => openQuick('email')} title="Send an email" className="break-all font-medium text-[#8fb4ff] hover:underline">{r.guestEmail}</button></span>
                    </div>
                  )}
                  {r.guestCountry && <div className={rowL}><span className={lblL}>Country</span><span>{countryName(r.guestCountry)}</span></div>}
                  {!r.guestPhone && !r.guestEmail && <p className="py-1 text-sm text-[#9fb3dc]">No contact details</p>}
                </div>

                {/* Requests & notes */}
                <div className={card}>
                  <p className={lbl}>Requests &amp; notes</p>
                  {r.specialRequests ? (
                    <div className="rounded-[10px] border border-[#f0b548]/40 bg-[#f0b548]/15 px-3 py-2.5 text-[13px] leading-snug">
                      <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-[#f0b548]">Special request</p>
                      <p className="whitespace-pre-wrap">{r.specialRequests}</p>
                    </div>
                  ) : notes.length === 0 ? <p className="text-[13px] text-[#8ea3cf]">No special requests</p> : null}
                  {notes.length > 0 ? (
                    <div className={`${r.specialRequests ? "mt-2" : ""} max-h-32 space-y-1.5 overflow-y-auto`}>
                      {notes.map((n, i) => (
                        <div key={i} className="rounded-[10px] bg-white/[0.06] px-3 py-2 text-[13px]">
                          <p className="whitespace-pre-wrap">{n.text}</p>
                          <p className="mt-0.5 text-[11px] text-[#9fb3dc]">{[n.author, n.date.slice(0, 16)].filter(Boolean).join(' · ')}</p>
                        </div>
                      ))}
                    </div>
                  ) : r.specialRequests ? <p className="mt-2 text-xs text-[#8ea3cf]">No internal notes yet</p> : null}
                </div>
              </div>
            )}

            <details className="rounded-xl border border-[#8fb4ff]/25 px-3 py-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-[#cfdcff]">Quick edit · stay dates</summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className={lbl}>Arrival
                  <input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} className={`${field} mt-1.5 normal-case tracking-normal`} />
                </label>
                <label className={lbl}>Departure
                  <input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} className={`${field} mt-1.5 normal-case tracking-normal`} />
                </label>
              </div>
              <button disabled={busy || (checkin === r.startDate && checkout === r.endDate)}
                onClick={() => act({ action: 'dates', checkin, checkout }, 'Stay dates saved.')}
                className={`${priGreen} mt-3 w-full`}>
                Save stay dates
              </button>
            </details>

            {link && (
              <div className="flex justify-end border-t border-[#8fb4ff]/15 pt-3">
                <a href={link} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-[#8ea3cf] hover:text-[#eaf0fb]">Open in Cloudbeds ↗</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
