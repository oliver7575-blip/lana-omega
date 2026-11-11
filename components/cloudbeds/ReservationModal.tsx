'use client'

import { useEffect, useState } from 'react'
import { cbApi, statusLabel } from './shared'

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

export default function ReservationModal({ id, today, onClose, onChanged }: {
  id: string
  today: string
  onClose: () => void
  onChanged?: () => void
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
      setMsg(ok)
      onChanged?.()
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
  const canCheckIn = r && ['confirmed', 'not_confirmed'].includes(r.status) && r.startDate <= today
  const label = 'mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14213d]/40 p-4" onClick={onClose}>
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white text-[#14213d] shadow-[0_24px_64px_rgba(20,33,61,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="truncate text-xl font-bold tracking-tight">{r ? r.guestName : 'Loading…'}</p>
              {r && (
                <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: pill.bg, borderColor: pill.border, color: pill.text }}>{statusLabel(r.status)}</span>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-gray-500">#{id}{r?.source ? ` · ${r.source}` : ''}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-lg leading-none text-gray-600 hover:bg-gray-50" aria-label="Close">×</button>
        </div>

        {error && <p className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {msg && <p className="mx-6 mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}

        {r && (
          <div className="grid gap-0 sm:grid-cols-[250px_1fr]">
            <div className="space-y-3.5 border-b border-gray-200 bg-[#fbfbfc] px-6 py-5 text-sm sm:rounded-bl-2xl sm:border-b-0 sm:border-r">
              <div>
                <p className={label}>Guest</p>
                <p>{r.guestName || '—'}</p>
                {r.guestPhone && (
                  <p>
                    <button onClick={() => openQuick('whatsapp')} title="Send a WhatsApp message"
                      className={`hover:underline ${quick === 'whatsapp' ? 'font-semibold text-[#128c7e]' : 'text-[#3b6fe0]'}`}>{r.guestPhone}</button>
                    <button onClick={() => openQuick('whatsapp')} title="Send a WhatsApp message" className="ml-2 inline-block rounded-full border border-gray-300 px-1.5 py-0 align-middle text-[8px] font-medium uppercase leading-[14px] tracking-wide text-gray-500 hover:border-[#128c7e] hover:text-[#128c7e]">message</button>
                  </p>
                )}
                {r.guestEmail && (
                  <p className="break-all">
                    <button onClick={() => openQuick('email')} title="Send an email"
                      className={`break-all text-left hover:underline ${quick === 'email' ? 'font-semibold text-[#128c7e]' : 'text-[#3b6fe0]'}`}>{r.guestEmail}</button>
                    <button onClick={() => openQuick('email')} title="Send an email" className="ml-2 inline-block rounded-full border border-gray-300 px-1.5 py-0 align-middle text-[8px] font-medium uppercase leading-[14px] tracking-wide text-gray-500 hover:border-[#128c7e] hover:text-[#128c7e]">email</button>
                  </p>
                )}
                {r.guestCountry && <p>{countryName(r.guestCountry)}</p>}
                {!r.guestPhone && !r.guestEmail && <p className="text-gray-500">No contact details</p>}
              </div>
              <div>
                <p className={label}>Source</p>
                <p>{r.source ?? '—'}</p>
                {r.confirmationCode && <p className="break-all text-gray-500">{r.confirmationCode}</p>}
              </div>
              <div><p className={label}>Booked on</p><p>{r.dateCreated ? r.dateCreated.slice(0, 10) : '—'}</p></div>
              <div><p className={label}>Check-in / Out</p><p>{r.startDate} – {r.endDate}</p></div>
              <div><p className={label}>Guests</p><p>{r.adults + r.children}</p></div>
              <div><p className={label}>Room</p><p>{r.rooms.map((x) => x.roomName ?? `${x.roomTypeName} (unassigned)`).join(', ') || '—'}</p></div>
              <div>
                <p className={label}>Price</p>
                {(() => {
                  const m = (n: number | null) => `MXN ${n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                  const b = r.breakdown
                  const paid = b.paid ?? (r.total !== null && r.balance !== null ? r.total - r.balance : null)
                  const line = (k: string, v: string, strong = false) => (
                    <p className={`flex justify-between gap-2 ${strong ? 'mt-1 border-t border-gray-200 pt-1 font-semibold' : ''}`}><span className={strong ? '' : 'text-gray-500'}>{k}</span><span>{v}</span></p>
                  )
                  return (
                    <div className="mt-0.5">
                      {b.subTotal !== null && line('Room', m(b.subTotal))}
                      {b.additionalItems !== null && b.additionalItems !== 0 && line('Extras', m(b.additionalItems))}
                      {b.taxesFees !== null && line('Taxes & fees', m(b.taxesFees))}
                      {line('Grand total', m(r.total), true)}
                      {line('Paid', m(paid))}
                    </div>
                  )
                })()}
              </div>
              <div>
                <p className={label}>Balance Due</p>
                <p className={r.balance && r.balance > 0 ? 'text-red-600' : ''}>MXN {r.balance?.toLocaleString('en-US') ?? '—'}</p>
              </div>
            </div>
            <div className="px-6 py-5">
              <div className="flex flex-nowrap gap-1.5 border-b border-gray-200 pb-4">
                {canCheckIn && (
                  <button disabled={busy} onClick={() => act({ action: 'check_in' }, 'Checked in.')}
                    className="h-9 rounded-[10px] border border-[#2f66d0] whitespace-nowrap px-3 text-xs font-semibold text-[#2f66d0] hover:bg-blue-50 disabled:opacity-60">
                    Check in
                  </button>
                )}
                <button disabled={payBusy} onClick={createPaymentLinkNow}
                  className="h-9 rounded-[10px] border border-gray-300 whitespace-nowrap px-3 text-xs font-semibold text-[#14213d] hover:bg-gray-50 disabled:opacity-60">
                  {payBusy ? 'Creating…' : 'Create Payment Link'}
                </button>
                {canCancel && (
                  <button disabled={busy} onClick={() => setConfirmCancel(true)}
                    className="h-9 rounded-[10px] border border-red-300 whitespace-nowrap px-3 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                    Cancel Reservation
                  </button>
                )}
              </div>

              {confirmCancel && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-800">Are you sure you want to cancel this reservation?</p>
                  <p className="mt-1 text-sm text-red-900">
                    {r.guestName} · {r.startDate} – {r.endDate} · #{id}
                  </p>
                  <p className={`mt-2 rounded-md px-3 py-2 text-sm ${isThirdParty ? 'bg-amber-100 font-semibold text-amber-900' : 'bg-white text-gray-700'}`}>
                    {isThirdParty ? 'This is an OTA / third-party booking' + (r.source ? ` (${r.source})` : '') + '. ' : ''}
                    Reservations made through an OTA or other third party (Airbnb, Booking.com, Expedia…) must also be cancelled directly with them. Cancelling here does not cancel it on their platform.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} onClick={cancelReservation}
                      className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                      {busy ? 'Cancelling…' : 'Yes, cancel reservation'}
                    </button>
                    <button disabled={busy} onClick={() => setConfirmCancel(false)}
                      className="rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-[#14213d] hover:bg-gray-50">
                      Keep reservation
                    </button>
                  </div>
                </div>
              )}

              {(pay || payError) && (
                <div className="mt-4 rounded-2xl border border-[#c9d6f5] bg-[#f3f6fe] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">{pay ? `Payment link · MXN ${pay.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Payment link'}</p>
                    <button onClick={() => { setPay(null); setPayError(null) }} className="text-lg leading-none text-gray-500 hover:text-gray-800" aria-label="Close">×</button>
                  </div>
                  {payError && <p className="text-sm text-red-600">{payError}</p>}
                  {pay && (
                    <>
                      <div className="flex gap-2">
                        <input id="pay-link-input" readOnly value={pay.url} onFocus={(e) => e.currentTarget.select()}
                          className="min-w-0 flex-1 rounded-[10px] border border-gray-300 bg-white px-2 py-1.5 text-xs outline-none" />
                        <button onClick={copyPaymentLink} className="rounded-md bg-[#1f9d78] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#188a69]">
                          {copied ? 'Copied ✓' : 'Copy link'}
                        </button>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {([['Email', pay.email], ['WhatsApp', pay.whatsapp]] as const).map(([k, s]) => (
                          <li key={k} className={s.status === 'sent' ? 'text-emerald-700' : s.status === 'failed' ? 'text-red-600' : 'text-gray-500'}>
                            <b>{k}:</b> {s.status === 'sent' ? '✓ ' : s.status === 'failed' ? '✗ ' : '– '}{s.detail}
                          </li>
                        ))}
                      </ul>
                      {pay.reused && <p className="mt-1 text-[11px] text-gray-500">A link for this balance already existed, so it was sent again.</p>}
                    </>
                  )}
                </div>
              )}

              {quick && (
                <div className="mt-4 rounded-2xl border border-[#b7e0d8] bg-[#f0faf7] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">
                      {quick === 'whatsapp' ? `WhatsApp to ${r.guestName.split(' ')[0] || 'guest'} · ${r.guestPhone}` : `Email to ${r.guestName.split(' ')[0] || 'guest'} · ${r.guestEmail}`}
                    </p>
                    <button onClick={() => setQuick(null)} className="text-lg leading-none text-gray-500 hover:text-gray-800" aria-label="Close">×</button>
                  </div>
                  {quick === 'whatsapp' && waInfo && !waInfo.windowOpen && (
                    <div className="mb-2 rounded-md bg-white px-3 py-2 text-xs text-gray-700">
                      <p>
                        This guest hasn&apos;t written in the last 24 hours, so this goes out as Soirée&apos;s approved hello message. Write the reason in one sentence.
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-gray-500">Language</span>
                        {(['es', 'en'] as const).map((l) => (
                          <button key={l} onClick={() => setHelloLang(l)}
                            className={`rounded-full border px-2 py-0.5 ${helloLang === l ? 'border-[#128c7e] bg-[#128c7e] text-white' : 'border-gray-300'}`}>{l === 'es' ? 'Español' : 'English'}</button>
                        ))}
                        <span className="ml-2 text-gray-500">Reasons</span>
                        {HELLO_REASONS[helloLang].map((x) => (
                          <button key={x.label} onClick={() => setQuickText(x.text)} className="rounded-full border border-gray-300 px-2 py-0.5 hover:bg-gray-50">{x.label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {quick === 'email' && (
                    <input value={quickSubject} onChange={(e) => setQuickSubject(e.target.value)} placeholder="Subject"
                      className="mb-2 w-full rounded-[10px] border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-[#128c7e]" />
                  )}
                  <textarea value={quickText} onChange={(e) => setQuickText(e.target.value)} rows={4} autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendQuick() }}
                    placeholder={quick === 'whatsapp' ? (waInfo && !waInfo.windowOpen ? 'Why are you writing? One short sentence.' : 'Write a message… (sent as staff, like on the Messages page)') : 'Write the email…'}
                    className="w-full resize-none rounded-[10px] border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#128c7e]" />
                  {quick === 'email' && (
                    <div className="mt-2 rounded-md border border-dashed border-gray-300 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                          <input type="checkbox" checked={sigOn} onChange={(e) => setSigOn(e.target.checked)} /> Signature
                        </label>
                        <button onClick={() => setSigEdit((v) => !v)} className="text-xs text-[#3b6fe0] hover:underline">{sigEdit ? 'Done' : sig ? 'Edit' : 'Add'}</button>
                      </div>
                      {sigEdit ? (
                        <>
                          <textarea value={sig} onChange={(e) => setSig(e.target.value)} rows={4} placeholder={SIGNATURE_SUGGESTION}
                            className="mt-1.5 w-full resize-none rounded-[10px] border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-[#128c7e]" />
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
                  <div className="mt-2 flex items-center gap-3">
                    <button disabled={quickBusy || !quickText.trim() || (quick === 'email' && !quickSubject.trim())} onClick={sendQuick}
                      className="rounded-full bg-[#128c7e] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0f776b] disabled:opacity-50">
                      {quickBusy ? 'Sending…' : quick === 'whatsapp' ? 'Send WhatsApp' : 'Send email'}
                    </button>
                    {quickMsg && <p className={`text-sm ${quickMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{quickMsg.text}</p>}
                  </div>
                </div>
              )}

              {(r.specialRequests || notes.length > 0) && (
                <div className="mt-4 space-y-2">
                  {r.specialRequests && (
                    <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Special requests</p>
                      <p className="whitespace-pre-wrap">{r.specialRequests}</p>
                    </div>
                  )}
                  {notes.length > 0 && (
                    <div>
                      <p className="mb-1 text-sm font-semibold">Notes</p>
                      <div className="max-h-40 space-y-1.5 overflow-y-auto">
                        {notes.map((n, i) => (
                          <div key={i} className="rounded-xl bg-gray-50 px-3 py-2 text-sm">
                            <p className="whitespace-pre-wrap">{n.text}</p>
                            <p className="mt-0.5 text-[11px] text-gray-500">{[n.author, n.date.slice(0, 16)].filter(Boolean).join(' · ')}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="mb-1.5 mt-4 text-sm font-semibold">Estimated arrival time</p>
              <div className="flex gap-2">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  className="w-28 rounded-[10px] border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-[#3b6fe0]" />
                <button disabled={busy || !time} onClick={() => act({ action: 'arrival_time', time }, 'Arrival time updated.')}
                  className="rounded-[10px] bg-[#1f9d78] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#188a69] disabled:opacity-50">
                  Update
                </button>
              </div>

              <details className="mt-4 border-t border-gray-200 pt-3">
                <summary className="cursor-pointer text-sm font-semibold">Quick Edit</summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-600">Arrival
                    <input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)}
                      className="mt-1 w-full rounded-[10px] border border-gray-300 px-2 py-1.5 text-sm text-[#14213d] outline-none focus:border-[#3b6fe0]" />
                  </label>
                  <label className="text-xs text-gray-600">Departure
                    <input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)}
                      className="mt-1 w-full rounded-[10px] border border-gray-300 px-2 py-1.5 text-sm text-[#14213d] outline-none focus:border-[#3b6fe0]" />
                  </label>
                </div>
                <button disabled={busy || (checkin === r.startDate && checkout === r.endDate)}
                  onClick={() => act({ action: 'dates', checkin, checkout }, 'Stay dates saved.')}
                  className="mt-3 w-full rounded-[10px] bg-[#1f9d78] py-2 text-sm font-semibold text-white hover:bg-[#188a69] disabled:opacity-50">
                  Save stay dates
                </button>
              </details>

              <details className="mt-4 border-t border-gray-200 pt-3" onToggle={(e) => e.currentTarget.open && loadGuest()}>
                <summary className="cursor-pointer text-sm font-semibold">Guest details</summary>
                <div className="mt-3">
                  {guestLoading && <p className="text-sm text-gray-500">Loading…</p>}
                  {guestError && <p className="text-sm text-red-600">{guestError}</p>}
                  {guestProfile && <GuestProfileFields profile={guestProfile} />}
                </div>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
