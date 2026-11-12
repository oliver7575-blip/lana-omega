'use client'

import { useEffect, useState } from 'react'
import { cbApi, statusLabel } from './shared'
import { HELLO_TEXT } from '@/lib/hello-text'
import { InlinePanel, area, btn, btnLg, chip, field, lbl, priBlue, priGreen, priRed, priTeal } from './ui'

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
  if (rows.length === 0) return <p className="text-sm text-gray-500">No further guest details on file.</p>
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-sm text-[#14213d]">{value}</p>
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
  rooms: { roomName: string | null; roomTypeName: string }[]
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
  const [confirmCheckOut, setConfirmCheckOut] = useState(false)
  // Add a payment / refund (Cloudbeds payment methods)
  const [mpKind, setMpKind] = useState<'payment' | 'refund' | null>(null)
  const [mpAmount, setMpAmount] = useState('')
  const [mpMethod, setMpMethod] = useState('')
  const [mpNote, setMpNote] = useState('')
  const [mpMethods, setMpMethods] = useState<{ code: string; name: string }[] | null>(null)
  const [mpBusy, setMpBusy] = useState(false)
  const [mpErr, setMpErr] = useState<string | null>(null)

  const [histBusy, setHistBusy] = useState(false)
  const [histErr, setHistErr] = useState<string | null>(null)
  // Opens this guest's logged conversation on the Messages page.
  async function openHistory() {
    setHistBusy(true)
    setHistErr(null)
    try {
      const conv = await cbApi<{ conversationId: string }>(`/api/cloudbeds/reservation/${id}/conversation`)
      window.location.assign(`/conversations/${conv.conversationId}`)
    } catch (e) {
      setHistErr(e instanceof Error ? e.message : 'Could not open the message history')
      setHistBusy(false)
    }
  }

  function openMoney(kind: 'payment' | 'refund') {
    if (!r) return
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
      if (['check_out', 'check_in', 'dates', 'arrival_time'].includes(String(body.action))) {
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
  const panelOpen = Boolean(r && (mpKind || (confirmCheckOut && owes) || confirmCancel || pay || payError || quick))
  const firstName = r?.guestName.split(' ')[0] || 'guest'
  const roomNames = r ? r.rooms.map((x) => x.roomName ?? `${x.roomTypeName} (unassigned)`).join(', ') || '—' : ''
  const roomTypes = r ? Array.from(new Set(r.rooms.map((x) => x.roomTypeName).filter(Boolean))).join(', ') : ''
  const roomDigit = r?.rooms[0]?.roomName ? (r.rooms[0].roomName.match(/\d+/)?.[0] ?? r.rooms[0].roomName.slice(0, 3)) : '–'
  const bd = r?.breakdown
  const paidAmt = r ? (bd?.paid ?? (r.total !== null && r.balance !== null ? r.total - r.balance : null)) : null
  const card = 'rounded-xl border border-[#e6e9f0] bg-white px-3 py-2.5'
  const row = 'flex justify-between gap-3 py-[2px] text-[12px]'
  const rowL = 'flex items-baseline gap-3 py-[2px] text-[12px]'
  const lblL = 'w-[52px] shrink-0 text-[#667085]'
  const mini = 'rounded-lg border border-[#e6e9f0] px-2.5 py-2'
  const chipSm = 'mr-2 inline-block rounded-full border border-[#d0d5dd] px-1.5 align-middle text-[8px] font-medium uppercase leading-[14px] tracking-wide text-[#667085] hover:border-[#128c7e] hover:text-[#128c7e]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14213d]/45 p-4" onClick={onClose}>
      <div style={{ zoom: 0.9 }} className="flex max-h-[calc((100vh-2rem)/0.9)] w-full max-w-[700px] flex-col overflow-y-auto rounded-3xl bg-white text-[#14213d] shadow-[0_30px_80px_rgba(8,12,24,.45)]" onClick={(e) => e.stopPropagation()}>
        {/* Banner */}
        <div className="relative shrink-0 bg-gradient-to-br from-[#0f2742] via-[#1b4d6b] to-[#1f7a6a] px-5 pb-3 pt-3.5 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {r && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold capitalize">{statusLabel(r.status)}</span>}
              {r?.source && <span className="rounded-full border px-3 py-[3px] text-xs font-semibold" style={sourceStyle(r.source)}>{r.source}</span>}
              {r?.confirmationCode && <span className="ml-1 truncate text-[12px] uppercase tracking-wide text-[#b7c9d8]">{r.source || 'Booking'} no. <b className="font-semibold text-white">{r.confirmationCode}</b></span>}
            </div>
            <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/30 text-lg leading-none text-white hover:bg-white/10">×</button>
          </div>
          <p className="mt-1.5 truncate text-[21px] font-bold leading-tight tracking-tight">{r ? r.guestName : 'Loading…'}{r && <span title="Reservation number inside Cloudbeds" className="ml-2.5 text-[12px] font-medium uppercase tracking-wide text-[#b7c9d8]">Res. #{id}</span>}</p>
          {r && (
            <>
              <div className="mt-2 flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-[#b7c9d8]">
                <span>Booked {r.dateCreated ? r.dateCreated.slice(0, 10) : '—'} · {r.adults} adult{r.adults === 1 ? '' : 's'}{r.children ? ` · ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}</span>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white">· Arrival
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Estimated arrival time"
                    className="h-[22px] w-[80px] rounded-md border border-white/30 bg-white/10 px-1 text-[12px] font-bold text-white outline-none [color-scheme:dark] focus:border-white/60" />
                  {time !== (r.estimatedArrivalTime ?? '') && time && (
                    <button disabled={busy} onClick={() => act({ action: 'arrival_time', time }, 'Arrival time updated.')} className="rounded-full bg-white/90 px-2 py-px text-[10.5px] font-bold text-[#0e5f47] hover:bg-white disabled:opacity-60">Save</button>
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
              <div className="flex shrink-0 items-center justify-between gap-4 rounded-2xl bg-white px-3 py-1.5 text-[#14213d] shadow-[0_10px_26px_rgba(8,12,24,.25)] sm:justify-start">
                <div>
                  <p className={`text-[9.5px] font-bold tracking-[.06em] ${owes ? 'text-[#b42318]' : 'text-[#0e6b4a]'}`}>{owes ? 'BALANCE DUE' : 'PAID IN FULL'}</p>
                  <p className={`text-[16px] font-bold tracking-tight ${owes ? 'text-[#b42318]' : 'text-[#0e6b4a]'}`}>MXN {(r.balance ?? 0).toLocaleString('en-US')}</p>
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
          <div className="mx-5 mt-2.5 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{error}</p>
            {/balance/i.test(error) && (
              <p className="mt-1 text-[13px] text-red-800">
                Cloudbeds won&apos;t let an outside app check out a guest with an open balance (only its own screen has the &ldquo;check out anyway&rdquo; step).
                Either clear the balance first, or{' '}
                {link ? <a href={link} target="_blank" rel="noreferrer" className="font-semibold underline">open this reservation in Cloudbeds</a> : 'open it in Cloudbeds'} and check out there.
              </p>
            )}
          </div>
        )}
        {msg && <p className="mx-5 mt-2.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}

        {r && (
          <div className="flex flex-col gap-3 px-5 pb-4 pt-4">
            {/* Action row */}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {canCheckIn && (
                <button disabled={busy} onClick={() => act({ action: 'check_in' }, 'Checked in.')} className={`${btn} ${bt} !border-[#c9d9f7] !bg-[#f3f7ff] !text-[#2456b8]`}>✓ Check in</button>
              )}
              {canCheckOut && (
                <button disabled={busy} onClick={() => (r.balance && r.balance > 0 ? setConfirmCheckOut(true) : act({ action: 'check_out' }, 'Checked out.'))} className={`${btn} ${bt} !border-[#f3cfcb] !text-[#b42318]`}>Check out</button>
              )}
              <button disabled={payBusy} onClick={createPaymentLinkNow} className={`${btn} ${bt} ${pay ? '!border-[#9fd4c5] !bg-[#d9f0ea]' : '!border-[#c3e5db] !bg-[#e6f5f0]'} !text-[#0e5f47]`}>
                🔗 {payBusy ? 'Creating…' : 'Payment link'}
              </button>
              <button onClick={() => openMoney('refund')} className={`${btn} ${bt} !text-[#a3362b] ${mpKind === 'refund' ? '!border-[#e8aaa3] !bg-[#fff0ee]' : ''}`}>↩ Refund</button>
              {(r.guestPhone || r.guestEmail) && (
                <button onClick={() => (quick ? setQuick(null) : openQuick(r.guestPhone ? 'whatsapp' : 'email'))}
                  className={quick ? `${btn} ${bt} !border-[#128c7e] !bg-[#128c7e] !text-white shadow-[0_3px_8px_rgba(18,140,126,.35)]` : `${btn} ${bt} !border-[#c9d9f7] !text-[#2456b8]`}>
                  💬 Message
                </button>
              )}
              <button disabled={histBusy} onClick={openHistory} className={`${btn} ${bt} !border-[#c9d9f7] !text-[#2456b8]`}>{histBusy ? 'Opening…' : 'Message history'}</button>
              <span className="flex-1" />
              {canCancel && (
                <button disabled={busy} onClick={() => setConfirmCancel(true)} className={`${btn} ${bt} !border-[#f3cfcb] !bg-[#fffafa] !text-[#b42318]`}>Cancel reservation</button>
              )}
            </div>
            {histErr && <p className="text-xs text-red-600">{histErr}</p>}

            {/* Add payment / refund */}
            {mpKind && (
              <InlinePanel tone={mpKind === 'refund' ? 'red' : 'green'} title={mpKind === 'refund' ? 'Refund a payment' : 'Add a payment'}
                subtitle={mpKind === 'refund' ? <>Paid <b>{money(paidAmt)}</b></> : <>Balance due <b className="text-[#b42318]">{money(r.balance)}</b></>}
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
                    <span className="ml-auto text-[12.5px] text-[#667085]">Remaining after: <b className="text-[#0e6b4a]">{money(Math.max(0, (r.balance ?? 0) - (Number(mpAmount) || 0)))}</b></span>
                  </div>
                )}
                <label className={lbl}>{mpKind === 'refund' ? 'Reason (optional)' : 'Note (optional)'}
                  <input value={mpNote} onChange={(e) => setMpNote(e.target.value)} placeholder={mpKind === 'refund' ? 'Reason for the refund' : 'e.g. paid at the front desk'} className={`${field} mt-1.5 normal-case tracking-normal`} />
                </label>
                {mpKind === 'refund' && <p className="rounded-xl border border-[#f6d3cd] bg-[#fff4f2] px-3 py-2 text-[12.5px] leading-snug text-[#8a2a22]">This records the refund in Cloudbeds only. It does not send money back to the guest, so return it yourself (card, transfer or cash).</p>}
                {mpErr && <p className="text-sm text-red-700">{mpErr}</p>}
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
                <p className="rounded-xl border border-[#f4e3a8] bg-[#fff9e8] px-3 py-2 text-[13px] leading-snug text-[#6b4a0a]">
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
                <p className={`rounded-xl px-3 py-2 text-[13px] leading-snug ${isThirdParty ? 'border border-[#f4e3a8] bg-[#fff9e8] font-semibold text-[#6b4a0a]' : 'border border-[#f6d3cd] bg-white text-[#8a2a22]'}`}>
                  {isThirdParty ? 'This is an OTA / third-party booking' + (r.source ? ` (${r.source})` : '') + '. ' : ''}
                  Reservations made through an OTA or other third party (Airbnb, Booking.com, Expedia…) must also be cancelled directly with them. Cancelling here does not cancel it on their platform.
                </p>
                <div className="flex justify-end gap-2.5">
                  <button disabled={busy} onClick={() => setConfirmCancel(false)} className={btnLg}>Keep reservation</button>
                  <button disabled={busy} onClick={cancelReservation} className={priRed}>{busy ? 'Cancelling…' : 'Yes, cancel reservation'}</button>
                </div>
              </InlinePanel>
            )}

            {/* Payment link */}
            {(pay || payError) && (
              <InlinePanel tone="blue" title={pay ? `Payment link · MXN ${pay.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Payment link'} onClose={() => { setPay(null); setPayError(null) }}>
                {payError && <p className="text-sm text-red-600">{payError}</p>}
                {pay && (
                  <>
                    <div className="flex gap-2">
                      <input id="pay-link-input" readOnly value={pay.url} onFocus={(e) => e.currentTarget.select()} className={`${field} min-w-0 flex-1 !bg-[#f6f8fb] !text-xs !text-[#2456b8]`} />
                      <button onClick={copyPaymentLink} className={priGreen}>{copied ? 'Copied ✓' : 'Copy link'}</button>
                    </div>
                    <ul className="space-y-0.5 text-xs">
                      {([['Email', pay.email], ['WhatsApp', pay.whatsapp]] as const).map(([k, s]) => (
                        <li key={k} className={s.status === 'sent' ? 'text-emerald-700' : s.status === 'failed' ? 'text-red-600' : 'text-gray-500'}>
                          <b>{k}:</b> {s.status === 'sent' ? '✓ ' : s.status === 'failed' ? '✗ ' : '– '}{s.detail}
                        </li>
                      ))}
                    </ul>
                    {pay.reused && <p className="rounded-xl bg-[#f6f8fb] px-3 py-2 text-[12.5px] text-[#667085]">A link for this balance already existed, so it was sent again.</p>}
                  </>
                )}
              </InlinePanel>
            )}

            {/* Message */}
            {quick && (
              <InlinePanel tone="teal" title={
                <span className="inline-flex rounded-full bg-[#e8eef0] p-[3px]">
                  {r.guestPhone && <button onClick={() => quick !== 'whatsapp' && openQuick('whatsapp')} className={`rounded-full px-4 py-1.5 text-[12.5px] ${quick === 'whatsapp' ? 'bg-white font-semibold text-[#0e5f47] shadow-[0_1px_3px_rgba(16,24,40,.12)]' : 'font-medium text-[#667085]'}`}>WhatsApp</button>}
                  {r.guestEmail && <button onClick={() => quick !== 'email' && openQuick('email')} className={`rounded-full px-4 py-1.5 text-[12.5px] ${quick === 'email' ? 'bg-white font-semibold text-[#0e5f47] shadow-[0_1px_3px_rgba(16,24,40,.12)]' : 'font-medium text-[#667085]'}`}>Email</button>}
                </span>
              } subtitle={<>to <b className="font-semibold text-[#14213d]">{quick === 'whatsapp' ? r.guestPhone : r.guestEmail}</b> · {firstName}</>} onClose={() => setQuick(null)}>
                {quick === 'whatsapp' && waInfo && !waInfo.windowOpen && (
                  <>
                    <p className="text-[12.5px] text-[#667085]">This guest hasn&apos;t written in the last 24 hours, so this goes out as Soirée&apos;s approved hello message. Write the reason in one sentence.</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {(['es', 'en'] as const).map((l) => (
                        <button key={l} onClick={() => setHelloLang(l)} className={chip(helloLang === l)}>{l === 'es' ? 'Español' : 'English'}</button>
                      ))}
                      <span className="mx-1 h-4 w-px bg-[#dfe5e3]" />
                      <span className="text-xs text-[#7a8394]">Reason</span>
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
                  <div className="rounded-[14px] border border-[#cfe8dc] bg-[#e9f5ef] px-3.5 py-3">
                    <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[.07em] text-[#5b8f7c]">This is exactly what the guest will receive</p>
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#1f3a31]">
                      {HELLO_TEXT[helloLang](firstName, quickText.replace(/[\n\t]+/g, ' ').trim() || (helloLang === 'es' ? '[tu motivo aquí]' : '[your reason here]'))}
                    </p>
                  </div>
                )}
                {quick === 'email' && (
                  <div className="rounded-[14px] border border-dashed border-[#d0d5dd] bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                        <input type="checkbox" checked={sigOn} onChange={(e) => setSigOn(e.target.checked)} /> Signature
                      </label>
                      <button onClick={() => setSigEdit((v) => !v)} className="text-xs font-semibold text-[#128c7e] hover:underline">{sigEdit ? 'Done' : sig ? 'Edit' : 'Add'}</button>
                    </div>
                    {sigEdit ? (
                      <>
                        <textarea value={sig} onChange={(e) => setSig(e.target.value)} rows={4} placeholder={SIGNATURE_SUGGESTION} className={`${area} mt-1.5`} />
                        {!sig.trim() && (
                          <button onClick={() => setSig(SIGNATURE_SUGGESTION)} className="mt-1 text-xs font-semibold text-[#128c7e] hover:underline">Use this suggestion</button>
                        )}
                        <div className="mt-1 flex items-center gap-3 text-xs">
                          {sigCanEdit && sig.trim() !== sigDefault && (
                            <button disabled={quickBusy} onClick={saveSignatureDefault} className="font-semibold text-[#128c7e] hover:underline">Save as default for everyone</button>
                          )}
                          <span className="text-gray-500">Changes here apply to this email only unless you save them.</span>
                        </div>
                      </>
                    ) : sigOn && sig ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{sig}</p>
                    ) : !sig ? (
                      <p className="mt-1 text-xs text-gray-400">No signature yet.</p>
                    ) : null}
                  </div>
                )}
                <div className="flex items-center justify-end gap-3">
                  {quickMsg && <p className={`mr-auto text-sm ${quickMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{quickMsg.text}</p>}
                  <button disabled={quickBusy || !quickText.trim() || (quick === 'email' && !quickSubject.trim())} onClick={sendQuick} className={quick === 'whatsapp' ? priTeal : priBlue}>
                    {quickBusy ? 'Sending…' : quick === 'whatsapp' ? 'Send WhatsApp ➤' : 'Send email ➤'}
                  </button>
                </div>
              </InlinePanel>
            )}

            {panelOpen ? (
              /* Collapsed summary while a panel is open */
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#7a8394]">Room</p><p className="mt-0.5 text-[13.5px] font-semibold">{roomNames}</p></div>
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#7a8394]">Total</p><p className="mt-0.5 text-[13.5px] font-semibold">{money(r.total)}</p></div>
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#7a8394]">Paid</p><p className="mt-0.5 text-[13.5px] font-semibold text-[#0e6b4a]">{money(paidAmt)}</p></div>
                <div className={mini}><p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#7a8394]">Arrival</p><p className="mt-0.5 text-[13.5px] font-semibold">{r.estimatedArrivalTime || '—'}</p></div>
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {/* Room */}
                <div className={card}>
                  <p className={lbl}>Room</p>
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e3edff] text-[15px] font-bold text-[#1d4ed8]">{roomDigit}</div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold">{roomNames}</p>
                      <p className="truncate text-[11px] text-[#667085]">{roomTypes || '—'}{r.rooms.some((x) => !x.roomName) ? ' · not assigned' : ' · assigned'}</p>
                    </div>
                  </div>
                  <div className="mt-2 border-t border-[#eef0f4] pt-2">
                    <div className={row}><span className="text-[#667085]">Guests</span><span>{r.adults} adult{r.adults === 1 ? '' : 's'} · {r.children} child{r.children === 1 ? '' : 'ren'}</span></div>
                  </div>
                </div>

                {/* Price */}
                <div className={card}>
                  <div className="flex justify-between"><p className={lbl}>Price breakdown</p><span className={`text-xs font-semibold ${owes ? 'text-[#b42318]' : 'text-[#0e6b4a]'}`}>{owes ? 'Unpaid' : 'Paid'}</span></div>
                  {bd?.subTotal != null && <div className={row}><span className="text-[#667085]">Room · {nights} night{nights === 1 ? '' : 's'}</span><span>{money(bd.subTotal)}</span></div>}
                  {bd?.additionalItems != null && bd.additionalItems !== 0 && <div className={row}><span className="text-[#667085]">Extras</span><span>{money(bd.additionalItems)}</span></div>}
                  {bd?.taxesFees != null && <div className={row}><span className="text-[#667085]">Taxes &amp; fees</span><span>{money(bd.taxesFees)}</span></div>}
                  <div className={`${row} mt-1 border-t border-[#e6e9f0] pt-2.5 font-bold`}><span>Grand total</span><span>{money(r.total)}</span></div>
                  <div className={row}><span className="text-[#667085]">Paid</span><span className="font-semibold text-[#0e6b4a]">{money(paidAmt)}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[#f3d9d5]"><i className="block h-full rounded-full bg-[#1f9d78]" style={{ width: `${r.total ? Math.min(100, Math.max(0, ((paidAmt ?? 0) / r.total) * 100)) : 0}%` }} /></div>
                </div>

                {/* Guest */}
                <div className={card}>
                  <p className={lbl}>Guest</p>
                  {r.guestPhone && (
                    <div className={rowL}><span className={lblL}>Phone</span>
                      <span><button onClick={() => openQuick('whatsapp')} title="Send a WhatsApp message" className={chipSm}>message</button>
                        <button onClick={() => openQuick('whatsapp')} title="Send a WhatsApp message" className="font-medium text-[#1d4ed8] hover:underline">{r.guestPhone}</button></span>
                    </div>
                  )}
                  {r.guestEmail && (
                    <div className={rowL}><span className={lblL}>Email</span>
                      <span className="min-w-0 break-all"><button onClick={() => openQuick('email')} title="Send an email" className={chipSm}>email</button>
                        <button onClick={() => openQuick('email')} title="Send an email" className="break-all font-medium text-[#1d4ed8] hover:underline">{r.guestEmail}</button></span>
                    </div>
                  )}
                  {r.guestCountry && <div className={rowL}><span className={lblL}>Country</span><span>{countryName(r.guestCountry)}</span></div>}
                  {!r.guestPhone && !r.guestEmail && <p className="py-1 text-sm text-gray-500">No contact details</p>}
                </div>

                {/* Requests & notes */}
                <div className={card}>
                  <p className={lbl}>Requests &amp; notes</p>
                  {r.specialRequests ? (
                    <div className="rounded-[10px] border border-[#f4e3a8] bg-[#fff9e8] px-3 py-2.5 text-[13px] leading-snug">
                      <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-[#a8741c]">Special request</p>
                      <p className="whitespace-pre-wrap">{r.specialRequests}</p>
                    </div>
                  ) : <p className="text-[13px] text-[#8a93a3]">No special requests</p>}
                  {notes.length > 0 ? (
                    <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto">
                      {notes.map((n, i) => (
                        <div key={i} className="rounded-[10px] bg-gray-50 px-3 py-2 text-[13px]">
                          <p className="whitespace-pre-wrap">{n.text}</p>
                          <p className="mt-0.5 text-[11px] text-gray-500">{[n.author, n.date.slice(0, 16)].filter(Boolean).join(' · ')}</p>
                        </div>
                      ))}
                    </div>
                  ) : <p className="mt-2 text-xs text-[#8a93a3]">No internal notes yet</p>}
                </div>
              </div>
            )}

            <details className="rounded-xl border border-[#e6e9f0] px-3 py-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-[#475467]">Quick edit · stay dates</summary>
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
              <div className="flex justify-end border-t border-[#eef0f4] pt-3">
                <a href={link} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-[#98a2b3] hover:text-[#475467]">Open in Cloudbeds ↗</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
