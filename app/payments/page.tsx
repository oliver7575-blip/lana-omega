'use client'

import { useCallback, useEffect, useState } from 'react'

interface Req {
  id: string
  reservation_id: string
  guest_name: string | null
  kind: 'deposit' | 'balance'
  amount: number | string
  currency: string
  status: string
  link_url: string | null
  link_status: string | null
  expires_at: string | null
  created_by: string
  error: string | null
  paid_at: string | null
  created_at: string
}

interface Lookup {
  found: boolean
  message?: string | null
  reservation?: { id: string; guestName: string; source: string; status: string; balance: number; paid: number; startDate: string; endDate: string }
  eligible?: boolean
  options?: { kind: 'deposit' | 'balance'; amount: number }[]
  code?: string | null
}

const money = (n: number | string) => `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`

const STATUS: Record<string, { label: string; cls: string }> = {
  creating: { label: 'Creating…', cls: 'bg-white/10 text-navy/70' },
  link_active: { label: 'Waiting for payment', cls: 'bg-amber-500/15 text-amber-200' },
  paid_unverified: { label: 'Paid — verifying', cls: 'bg-sky-500/15 text-sky-200' },
  paid: { label: 'Paid ✓', cls: 'bg-emerald-500/15 text-emerald-200' },
  expired: { label: 'Expired', cls: 'bg-white/10 text-navy/60' },
  cancelled: { label: 'Closed', cls: 'bg-white/10 text-navy/60' },
  failed: { label: 'Failed', cls: 'bg-red-500/15 text-red-200' },
  needs_review: { label: 'Needs review', cls: 'bg-red-500/15 text-red-200' },
}

export default function PaymentsPage() {
  const [rows, setRows] = useState<Req[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reservation, setReservation] = useState('')
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string; url?: string } | null>(null)
  const [permission, setPermission] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/payments', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        setRows(j.requests ?? [])
        setCanManage(Boolean(j.canManage))
        setLoading(false)
      })
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [load])

  async function doLookup() {
    setMessage(null)
    setLookup(null)
    setBusy('lookup')
    const res = await fetch(`/api/payments/lookup?reservationId=${encodeURIComponent(reservation.trim())}`, { cache: 'no-store' })
    setLookup(await res.json())
    setBusy(null)
  }

  async function create(kind: 'deposit' | 'balance') {
    setBusy(kind)
    setMessage(null)
    const res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: reservation.trim(), kind }) })
    const j = await res.json()
    setBusy(null)
    if (!res.ok) return setMessage({ tone: 'err', text: j.error ?? 'Could not create the link' })
    setMessage({ tone: 'ok', text: j.reused ? 'This link already exists and is still valid:' : 'Link created. Send it to the guest:', url: j.request.link_url })
    load()
  }

  async function act(id: string, action: 'recheck' | 'close') {
    if (action === 'close' && !confirm('Close this request here?\n\nCloudbeds cannot cancel links created from Omega, so the link may stay payable until it expires.')) return
    setBusy(id)
    await fetch(`/api/payments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    setBusy(null)
    load()
  }

  async function checkPermission() {
    setBusy('perm')
    setPermission(null)
    const res = await fetch('/api/payments/permission-check', { cache: 'no-store' })
    const j = await res.json()
    setBusy(null)
    setPermission(
      j.verdict === 'allowed'
        ? `✓ The API key is allowed to create payment links (Cloudbeds answered ${j.status}: ${j.message}).`
        : j.verdict === 'denied'
          ? `✗ Cloudbeds refused (${j.status}): the API key lacks permission to create payment links. A new key with payment permissions is needed.`
          : (j.error ?? j.note ?? 'Unexpected result')
    )
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <h1 className="font-serif text-4xl italic text-white">Payments</h1>
      <p className="mt-1 text-sm text-navy/55">
        Secure payment links for <strong>direct bookings</strong> (Website/Booking Engine). Cloudbeds hosts the payment page and posts the payment to the reservation itself. Booking.com / Airbnb and other travel-platform
        reservations never get a link; Walk-In and other manual reservations are handled by Billing.
      </p>

      {canManage && (
        <section className="mt-6 rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[13px] font-semibold text-white">Create a payment link</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={reservation}
              onChange={(e) => setReservation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && reservation.trim() && doLookup()}
              placeholder="Cloudbeds reservation number"
              className="min-w-[240px] flex-1 rounded-md border border-line bg-black/20 px-2 py-1.5 text-sm text-white"
            />
            <button type="button" disabled={!reservation.trim() || busy === 'lookup'} onClick={doLookup} className="rounded-md border border-line px-3 py-1.5 text-sm text-navy hover:bg-line/40">
              {busy === 'lookup' ? 'Looking up…' : 'Look up'}
            </button>
          </div>

          {lookup && !lookup.found && <p className="mt-3 text-sm text-amber-200">{lookup.message}</p>}
          {lookup?.found && lookup.reservation && (
            <div className="mt-3 text-sm text-navy/85">
              <p>
                <span className="font-semibold text-white">{lookup.reservation.guestName}</span> · {lookup.reservation.source} · {lookup.reservation.status} · {lookup.reservation.startDate} → {lookup.reservation.endDate}
              </p>
              <p className="text-navy/60">Balance in Cloudbeds: {money(lookup.reservation.balance)} · paid: {money(lookup.reservation.paid)}</p>
              {lookup.eligible ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {lookup.options?.map((o) => (
                    <button key={o.kind} type="button" disabled={busy !== null} onClick={() => create(o.kind)} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                      {busy === o.kind ? 'Creating…' : `Create ${o.kind} link — ${money(o.amount)}`}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-200">No link: {lookup.message}</p>
              )}
            </div>
          )}

          {message && (
            <div className={`mt-3 rounded-md px-2 py-1.5 text-sm ${message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-red-500/10 text-red-200'}`}>
              <p>{message.text}</p>
              {message.url && (
                <p className="mt-1 break-all">
                  <a href={message.url} target="_blank" rel="noreferrer" className="underline">{message.url}</a>{' '}
                  <button type="button" onClick={() => copy(message.url!)} className="ml-2 rounded border border-line px-2 py-0.5 text-xs">Copy</button>
                </p>
              )}
            </div>
          )}

          <div className="mt-3 border-t border-line pt-2">
            <button type="button" disabled={busy === 'perm'} onClick={checkPermission} className="text-xs text-navy/70 underline hover:text-white">
              {busy === 'perm' ? 'Checking…' : 'Check that the Cloudbeds key may create links (creates nothing)'}
            </button>
            {permission && <p className="mt-1 text-xs text-navy/80">{permission}</p>}
          </div>
        </section>
      )}

      {loading && <p className="mt-6 text-sm text-navy/55">Loading…</p>}
      {!loading && rows.length === 0 && <p className="mt-6 text-sm text-navy/55">No payment links yet.</p>}

      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-wide text-navy/50">
            <tr><th className="px-3 py-2">Created</th><th className="px-3 py-2">Reservation</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, cls: 'bg-white/10 text-navy/70' }
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2 text-navy/70">{new Date(r.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}<span className="block text-[11px] text-navy/40">{r.created_by}</span></td>
                  <td className="px-3 py-2"><span className="text-white">#{r.reservation_id}</span><span className="block text-xs text-navy/55">{r.guest_name}</span></td>
                  <td className="px-3 py-2 capitalize text-navy/80">{r.kind}</td>
                  <td className="px-3 py-2 text-white">{money(r.amount)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
                    {r.error && <span className="mt-1 block max-w-[260px] text-[11px] text-red-300">{r.error}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-navy/60">{r.expires_at ? new Date(r.expires_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    {r.link_url && r.status === 'link_active' && <button type="button" onClick={() => copy(r.link_url!)} className="mr-2 text-clay hover:underline">Copy link</button>}
                    {canManage && ['link_active', 'paid_unverified', 'needs_review'].includes(r.status) && (
                      <>
                        <button type="button" disabled={busy === r.id} onClick={() => act(r.id, 'recheck')} className="mr-2 text-navy/80 hover:text-white">Recheck</button>
                        <button type="button" disabled={busy === r.id} onClick={() => act(r.id, 'close')} className="text-red-300/80 hover:text-red-300">Close</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
