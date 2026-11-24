import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { lodgifyFetch } from '@/lib/lodgify'
import { getBookingRaw, getPropertyRaw, listPropertiesRaw, listRoomsRaw, listUpcomingRaw, listWebhooks } from '@/lib/lodgify'
import { pmsForTenant } from '@/lib/pms'

/**
 * CRON_SECRET-gated diagnostics for a tenant's Lodgify connection — shows
 * the RAW Lodgify JSON (to confirm real field names) next to what Lana
 * would see after mapping.
 *
 *   GET /api/debug/lodgify-raw?tenantId=<uuid>              → first 3 upcoming bookings + webhooks
 *   GET /api/debug/lodgify-raw?tenantId=<uuid>&id=<booking> → one booking
 *   GET …&lookup=<any confirmation number> → what Lana's lookup returns
 *   GET …&phone=<number>                  → what Lana's phone match returns
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const tenantId = params.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: integration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_lodgify')
    .maybeSingle()
  if (!integration?.credentials) return NextResponse.json({ error: 'No Lodgify integration for this tenant' }, { status: 404 })

  const { api_key } = decryptCredentials<{ api_key: string }>(integration.credentials as EncryptedPayload)
  const propertyId = (integration.config as { property_id?: string } | null)?.property_id
  const auth = { apiKey: api_key, propertyId }
  const pms = await pmsForTenant(supabase, tenantId)

  // Experiment: how does Lodgify take a custom price on a quote? ?quotetest=new|<bookingId>&shape=1..4&amount=N
  const qt = params.get('quotetest')
  if (qt) {
    const { createBookingLodgify } = await import('@/lib/lodgify-ops')
    const shape = Number(params.get('shape') ?? '1')
    const amountN = Number(params.get('amount') ?? '3000')
    let bid = qt
    if (qt === 'newtotal') {
      const made = await createBookingLodgify(auth, { propertyId: '739470', start: '2027-09-05', end: '2027-09-07', adults: 2, children: 0, firstName: 'Total', lastName: 'Test', email: 'oliver7575@aol.com', country: 'MX', total: amountN * 2, skipQuote: true })
      const after = await getBookingRaw(auth, made.id)
      const d = (after.ok ? after.data : null) as Record<string, unknown> | null
      return NextResponse.json({ bookingId: made.id, status: d?.status, total: d?.total_amount, subtotals: d?.subtotals, quote: d?.quote })
    }
    if (qt === 'new') {
      const made = await createBookingLodgify(auth, { propertyId: '739470', start: '2027-09-01', end: '2027-09-03', adults: 2, children: 0, firstName: 'Quote', lastName: 'Test', email: 'oliver7575@aol.com', country: 'MX' })
      bid = made.id
    }
    const custom = [
      { amount: amountN, currency_code: 'MXN' },
      amountN,
      { amount: amountN },
      { price_per_day: amountN },
    ][shape - 1]
    const q = await lodgifyFetch(auth, `/v1/reservation/booking/${bid}/quote`, {
      method: 'POST',
      body: JSON.stringify({ is_policy_active: false, room_types: [{ room_type_id: 806586, custom_fee_amount: custom }] }),
    })
    const after = await getBookingRaw(auth, bid)
    const d = (after.ok ? after.data : null) as Record<string, unknown> | null
    return NextResponse.json({ bookingId: bid, shape, quote: q, status: d?.status, total: d?.total_amount, subtotals: d?.subtotals, quoteStatus: (d?.quote as Record<string, unknown> | null)?.status })
  }
  const listName = params.get('list')
  if (listName) {
    const { listBookings, guestOf, amount } = await import('@/lib/lodgify')
    const all = await listBookings(auth, 'stayFilter=All')
    const rows = (all.ok ? all.rows : []) as Record<string, unknown>[]
    return NextResponse.json(rows.filter((b) => String(guestOf(b).name ?? '').toLowerCase().includes(listName.toLowerCase())).map((b) => ({ id: b.id, status: b.status, arrival: b.arrival, departure: b.departure, total: amount(b.total_amount), source: b.source, created: b.created_at })))
  }
  const deleteId = params.get('delete')
  if (deleteId === '24525237') {
    // One-off: permanently delete a test booking that Lodgify will not let the API cancel.
    const d = await lodgifyFetch(auth, `/v1/reservation/booking/${deleteId}`, { method: 'DELETE' })
    return NextResponse.json({ deleted: d, after: await getBookingRaw(auth, deleteId) })
  }
  const declineId = params.get('decline')
  if (declineId) {
    const { cancelBookingLodgify } = await import('@/lib/lodgify-ops')
    try {
      await cancelBookingLodgify(auth, declineId)
      return NextResponse.json({ ok: true, after: await getBookingRaw(auth, declineId) })
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const ratesProp = params.get('rates')
  if (ratesProp) {
    const rt = params.get('roomTypeId') ?? ''
    const from = params.get('from') ?? new Date().toISOString().slice(0, 10)
    const to = params.get('to') ?? from
    return NextResponse.json(await lodgifyFetch(auth, `/v2/rates/calendar?houseId=${ratesProp}&roomTypeId=${rt}&startDate=${from}&endDate=${to}`))
  }
  const propId = params.get('rooms')
  if (propId) {
    const [rooms, property] = await Promise.all([listRoomsRaw(auth, propId), getPropertyRaw(auth, propId)])
    return NextResponse.json({ rooms, property })
  }
  const id = params.get('id')
  if (id) {
    const [raw, mapped] = await Promise.all([getBookingRaw(auth, id), pms?.lookupReservation(id)])
    return NextResponse.json({ raw, mapped })
  }
  const lookup = params.get('lookup')
  if (lookup) return NextResponse.json({ lookup, mapped: await pms?.lookupReservation(lookup) })
  const phone = params.get('phone')
  if (phone) return NextResponse.json({ phone, mapped: await pms?.findReservationByPhone(phone) })

  const [properties, upcoming, webhooks] = await Promise.all([
    listPropertiesRaw(auth),
    listUpcomingRaw(auth, 3),
    listWebhooks(auth),
  ])
  const props = properties.ok
    ? ((Array.isArray(properties.data) ? properties.data : ((properties.data as { items?: unknown[] })?.items ?? [])) as {
        id?: number
        name?: string
      }[]).map((p) => ({ id: p.id, name: p.name }))
    : properties
  return NextResponse.json({ status: integration.status, propertyId: propertyId ?? null, properties: props, upcoming, webhooks })
}
