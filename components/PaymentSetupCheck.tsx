'use client'

import { useState } from 'react'

interface Probe {
  ok: boolean
  status: number
  note?: string
  data?: unknown
}
interface AuthState {
  state: 'accepted' | 'rejected' | 'inconclusive'
  status: number
  note?: string
}
interface Result {
  error?: string
  propertyId?: string
  capabilities?: Probe
  paymentMethods?: { ok?: boolean; status?: number; methods?: (string | undefined)[]; note?: string }
  currency?: Record<string, unknown>
  payByLinkAuth?: { bearer: AuthState; apiKeyHeader: AuthState }
  sources?: { id: string; name: string; isThirdParty: boolean }[] | { ok: false; status: number; note?: string }
  bookingMix?: { ok: boolean; total?: number; bySource?: { source: string; reservations: number; withThirdPartyId: number; withBalance: number }[]; status?: number; note?: string }
  samples?: { withoutThirdPartyId: unknown; withThirdPartyId: unknown }
  reservation?: { ok: boolean; status: number; note?: string; fields?: unknown } | null
}

function verdict(r: Result): { tone: 'good' | 'info' | 'warn'; title: string; text: string } {
  const cap = r.capabilities
  if (!cap) return { tone: 'warn', title: 'No result', text: 'The check did not return anything.' }
  if (!cap.ok) {
    return {
      tone: 'warn',
      title: 'Cloudbeds key cannot read payment settings',
      text:
        cap.status === 401 || cap.status === 403
          ? 'Cloudbeds refused the request. The API key most likely has no payment permissions. A new key with payment scopes must be created (scopes cannot be added to an existing key).'
          : `Cloudbeds returned an error (${cap.status})${cap.note ? `: ${cap.note}` : ''}.`,
    }
  }
  const d = (cap.data ?? {}) as { cloudbedsPayments?: boolean; payByLink?: boolean; gateway?: string }
  if (d.cloudbedsPayments && d.payByLink) {
    return { tone: 'good', title: 'Path A is available: Cloudbeds Pay-by-Link', text: `Your property uses Cloudbeds Payments (${d.gateway ?? 'Stripe-powered'}) and Pay-by-Link is enabled.` }
  }
  if (d.cloudbedsPayments) {
    return { tone: 'info', title: 'Cloudbeds Payments is on, but Pay-by-Link is not enabled', text: 'Pay-by-Link may need to be switched on or the merchant account approved by Cloudbeds. Until then, Path B (Stripe Checkout) applies.' }
  }
  return { tone: 'info', title: 'Path B applies: Stripe Checkout + recording in the folio', text: `Cloudbeds Pay-by-Link is not available for your gateway${d.gateway ? ` (${d.gateway})` : ''}.` }
}

function authText(a?: AuthState): string {
  if (!a) return '—'
  if (a.state === 'accepted') return `accepted (HTTP ${a.status})`
  if (a.state === 'rejected') return `REJECTED (HTTP ${a.status})${a.note ? `: ${a.note}` : ''}`
  return `inconclusive (HTTP ${a.status})${a.note ? `: ${a.note}` : ''}`
}

const TONE = {
  good: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  info: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  warn: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
}

/** Read-only check: which payment gateway Cloudbeds uses and whether the API key can use Pay-by-Link. */
export default function PaymentSetupCheck() {
  const [reservationId, setReservationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function run() {
    setBusy(true)
    setResult(null)
    const qs = reservationId.trim() ? `?reservationId=${encodeURIComponent(reservationId.trim())}` : ''
    try {
      const res = await fetch(`/api/cloudbeds/payments-check${qs}`, { cache: 'no-store' })
      setResult(await res.json())
    } catch {
      setResult({ error: 'Could not run the check.' })
    }
    setBusy(false)
  }

  const v = result && !result.error ? verdict(result) : null

  return (
    <section className="mb-6 rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-[13px] font-semibold text-white">Payment setup check (read-only)</p>
      <p className="mt-0.5 text-[11.5px] text-navy/55">
        Finds out which payment gateway Cloudbeds uses and whether the API key can create payment links. It only reads; nothing is charged or changed.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={reservationId}
          onChange={(e) => setReservationId(e.target.value)}
          placeholder="Optional: a Cloudbeds reservation number to inspect its balance fields"
          className="min-w-[260px] flex-1 rounded-md border border-line bg-black/20 px-2 py-1 text-[12px] text-white"
        />
        <button type="button" disabled={busy} onClick={run}>
          {busy ? 'Checking…' : 'Run check'}
        </button>
      </div>

      {result?.error && <p className="mt-2 text-[12px] text-red-300">{result.error}</p>}

      {v && result && (
        <div className="mt-3 space-y-2 text-[12px]">
          <div className={`rounded-lg border px-3 py-2 ${TONE[v.tone]}`}>
            <p className="font-semibold">{v.title}</p>
            <p className="mt-0.5">{v.text}</p>
          </div>
          <div className="grid gap-1 text-navy/80">
            <p><span className="text-navy/50">Property:</span> {result.propertyId}</p>
            <p><span className="text-navy/50">Payment settings (getPaymentsCapabilities):</span> HTTP {result.capabilities?.status}{result.capabilities?.ok ? '' : ' — failed'}</p>
            <pre className="overflow-auto rounded bg-black/25 p-2 text-[11px]">{JSON.stringify(result.capabilities?.ok ? result.capabilities.data : { status: result.capabilities?.status, note: result.capabilities?.note }, null, 2)}</pre>
            <p><span className="text-navy/50">Enabled payment methods:</span> {result.paymentMethods?.ok ? (result.paymentMethods.methods ?? []).filter(Boolean).join(', ') || '—' : `not readable (HTTP ${result.paymentMethods?.status})`}</p>
            <p><span className="text-navy/50">Currency / time zone:</span> {JSON.stringify(result.currency)}</p>
            <p><span className="text-navy/50">Pay-by-Link endpoint, key sent as Bearer token:</span> {authText(result.payByLinkAuth?.bearer)}</p>
            <p><span className="text-navy/50">…key sent as x-api-key header:</span> {authText(result.payByLinkAuth?.apiKeyHeader)}</p>
            <p className="mt-1"><span className="text-navy/50">Booking sources (names only):</span> {Array.isArray(result.sources) ? result.sources.map((x) => `${x.name}${x.isThirdParty ? ' (3rd party)' : ''}`).join(', ') || '—' : 'not readable'}</p>
            {result.bookingMix?.ok && (
              <div className="overflow-auto">
                <p className="text-navy/50">Upcoming reservations (next 120 days): {result.bookingMix.total}</p>
                <table className="mt-1 w-full text-left text-[11.5px]">
                  <thead><tr className="text-navy/50"><th className="pr-3">Source</th><th className="pr-3">Reservations</th><th className="pr-3">With platform number</th><th>With balance &gt; 0</th></tr></thead>
                  <tbody>{(result.bookingMix.bySource ?? []).map((m) => (<tr key={m.source}><td className="pr-3">{m.source}</td><td className="pr-3">{m.reservations}</td><td className="pr-3">{m.withThirdPartyId}</td><td>{m.withBalance}</td></tr>))}</tbody>
                </table>
              </div>
            )}
            {result.samples && (
              <>
                <p className="mt-1 text-navy/50">Sample payment fields — a reservation without a platform number:</p>
                <pre className="overflow-auto rounded bg-black/25 p-2 text-[11px]">{JSON.stringify(result.samples.withoutThirdPartyId, null, 2)}</pre>
                <p className="text-navy/50">…and one with a platform number:</p>
                <pre className="overflow-auto rounded bg-black/25 p-2 text-[11px]">{JSON.stringify(result.samples.withThirdPartyId, null, 2)}</pre>
              </>
            )}
            {result.reservation && (
              <>
                <p><span className="text-navy/50">Reservation payment fields:</span> {result.reservation.ok ? '' : `failed (HTTP ${result.reservation.status}${result.reservation.note ? `: ${result.reservation.note}` : ''})`}</p>
                {result.reservation.ok && <pre className="overflow-auto rounded bg-black/25 p-2 text-[11px]">{JSON.stringify(result.reservation.fields, null, 2)}</pre>}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
