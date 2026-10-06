import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'

export const maxDuration = 60

/**
 * READ-ONLY diagnostic for planning payment links. It only makes GET requests:
 * the property's payment gateway/capabilities, enabled payment methods, currency,
 * whether the API key is accepted by the Pay-by-Link endpoint (probed with a
 * made-up link id), and — optionally — the payment-related field names of one
 * reservation. Nothing is created, changed or charged.
 */

const V13 = 'https://api.cloudbeds.com/api/v1.3'
const PROBE_LINK_ID = '00000000-0000-4000-8000-000000000000'

interface Probe {
  ok: boolean
  status: number
  note?: string
  data?: unknown
}

async function probe(url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) })
    const text = await res.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    const message = body && typeof body === 'object' ? ((body as { message?: string; error?: string }).message ?? (body as { error?: string }).error) : undefined
    return { ok: res.ok, status: res.status, note: message ?? (res.ok ? undefined : text.slice(0, 160)), data: res.ok ? (body as { data?: unknown } | null)?.data ?? body : undefined }
  } catch (err) {
    return { ok: false, status: 0, note: err instanceof Error ? err.message : 'network error' }
  }
}

/** 404 for a made-up link id (or 200) means the key was accepted; 401/403 means rejected; anything else is inconclusive. */
function authState(p: Probe): { state: 'accepted' | 'rejected' | 'inconclusive'; status: number; note?: string } {
  const state = p.ok || p.status === 404 ? 'accepted' : p.status === 401 || p.status === 403 ? 'rejected' : 'inconclusive'
  return { state, status: p.status, note: p.note }
}

/** Keeps only money/payment-related fields — never guest names, emails or phones. */
function paymentFields(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 3) return value
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => paymentFields(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/balance|paid|collect|payment|source|status|total|currency|deposit|thirdParty|invoice|grandTotal|subTotal|taxes|fees/i.test(k)) {
      out[k] = paymentFields(v, depth + 1)
    }
  }
  return out
}

export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  // Owners and admins only.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: staff } = await supabase.from('staff_users').select('role').eq('auth_uid', user?.id ?? '').single()
  if (!['owner', 'admin'].includes((staff?.role as string) ?? '')) {
    return NextResponse.json({ error: 'Only owners or admins can run this check' }, { status: 403 })
  }

  const { apiKey, propertyId } = c.cb
  const key = { 'x-api-key': apiKey }
  const q = `propertyID=${encodeURIComponent(propertyId)}`
  const reservationId = (new URL(request.url).searchParams.get('reservationId') ?? '').trim()

  const [capabilities, methods, hotel, probeBearer, probeKeyHeader, reservation] = await Promise.all([
    probe(`${V13}/getPaymentsCapabilities?${q}`, key),
    probe(`${V13}/getPaymentMethods?${q}`, key),
    probe(`${V13}/getHotelDetails?${q}`, key),
    probe(`https://api.cloudbeds.com/payments/v2/pay-by-link/${PROBE_LINK_ID}`, { Authorization: `Bearer ${apiKey}`, 'X-Property-Id': propertyId, accept: 'application/json', 'Content-Type': 'application/json' }),
    probe(`https://api.cloudbeds.com/payments/v2/pay-by-link/${PROBE_LINK_ID}`, { 'x-api-key': apiKey, 'X-Property-Id': propertyId, accept: 'application/json', 'Content-Type': 'application/json' }),
    /^\d{6,}$/.test(reservationId) ? probe(`${V13}/getReservation?${q}&reservationID=${encodeURIComponent(reservationId)}`, key) : Promise.resolve(null),
  ])

  // Which booking sources exist, and how upcoming reservations split between direct and third-party (no guest data).
  const sourcesProbe = await probe(`${V13}/getSources?propertyIDs=${encodeURIComponent(propertyId)}`, key)
  const sourceList = sourcesProbe.ok
    ? ((sourcesProbe.data as Record<string, unknown>[]) ?? []).map((x) => ({ id: String(x.sourceID ?? ''), name: String(x.sourceName ?? ''), isThirdParty: Boolean(x.isThirdParty) }))
    : { ok: false, status: sourcesProbe.status, note: sourcesProbe.note }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: c.tz })
  const until = new Date(Date.now() + 120 * 86400000).toLocaleDateString('en-CA', { timeZone: c.tz })
  const upcoming = await probe(`${V13}/getReservations?${q}&checkInFrom=${today}&checkInTo=${until}&pageSize=100`, key)
  const rows = upcoming.ok ? ((upcoming.data as Record<string, unknown>[]) ?? []) : []
  const mix = new Map<string, { source: string; reservations: number; withThirdPartyId: number; withBalance: number }>()
  let directSample: string | null = null
  let thirdPartySample: string | null = null
  for (const r of rows) {
    const label = String(r.sourceName ?? r.source ?? r.sourceID ?? 'unknown')
    const m = mix.get(label) ?? { source: label, reservations: 0, withThirdPartyId: 0, withBalance: 0 }
    m.reservations++
    const hasTp = Boolean(String(r.thirdPartyIdentifier ?? '').trim())
    if (hasTp) m.withThirdPartyId++
    if (Number(r.balance ?? 0) > 0) m.withBalance++
    mix.set(label, m)
    const active = !['canceled', 'cancelled', 'no_show'].includes(String(r.status ?? '').toLowerCase())
    if (active && !hasTp && !directSample) directSample = String(r.reservationID ?? '')
    if (active && hasTp && !thirdPartySample) thirdPartySample = String(r.reservationID ?? '')
  }
  const bookingMix = upcoming.ok ? { ok: true, total: rows.length, bySource: [...mix.values()].sort((a, b) => b.reservations - a.reservations) } : { ok: false, status: upcoming.status, note: upcoming.note }
  const [directDetail, thirdPartyDetail] = await Promise.all([
    directSample ? probe(`${V13}/getReservation?${q}&reservationID=${encodeURIComponent(directSample)}`, key) : Promise.resolve(null),
    thirdPartySample ? probe(`${V13}/getReservation?${q}&reservationID=${encodeURIComponent(thirdPartySample)}`, key) : Promise.resolve(null),
  ])
  const samples = {
    withoutThirdPartyId: directDetail?.ok ? paymentFields(directDetail.data) : directDetail ? { error: directDetail.status } : 'none found',
    withThirdPartyId: thirdPartyDetail?.ok ? paymentFields(thirdPartyDetail.data) : thirdPartyDetail ? { error: thirdPartyDetail.status } : 'none found',
  }

  const hotelData = (hotel.data ?? {}) as Record<string, unknown>
  const currencyInfo = Object.fromEntries(Object.entries(hotelData).filter(([k]) => /currenc|timezone/i.test(k)))
  const methodsData = (methods.data ?? {}) as { methods?: { method?: string; name?: string }[] }

  return NextResponse.json({
    propertyId,
    capabilities,
    paymentMethods: methods.ok ? { ok: true, status: methods.status, methods: (methodsData.methods ?? []).map((m) => m.name ?? m.method) } : methods,
    currency: hotel.ok ? { ok: true, ...currencyInfo } : { ok: false, status: hotel.status, note: hotel.note },
    payByLinkAuth: { bearer: authState(probeBearer), apiKeyHeader: authState(probeKeyHeader) },
    sources: sourceList,
    bookingMix,
    samples,
    reservation: reservation ? { ok: reservation.ok, status: reservation.status, note: reservation.note, fields: reservation.ok ? paymentFields(reservation.data) : undefined } : null,
  })
}
