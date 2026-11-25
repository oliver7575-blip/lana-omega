import { createServiceClient } from '@/lib/supabase/service'
import { localDate } from '@/lib/tz'
import { reservationDetailLodgify } from '@/lib/lodgify-ops'

/** The arrival time someone actually gave (panel, Lana or an email) for a Lodgify booking; null when none. */
async function lodgifyArrival(tenantId: string, id: string): Promise<string | null> {
  const { data } = await createServiceClient().from('pms_arrival_times').select('arrival_time').eq('tenant_id', tenantId).eq('reservation_id', id).maybeSingle()
  return (data?.arrival_time as string | null) ?? null
}

export async function lodgifyDetail(l: { auth: Parameters<typeof reservationDetailLodgify>[0]; tz: string; tenantId: string }, id: string) {
  const reservation = await reservationDetailLodgify(l.auth, id, localDate(new Date(), l.tz))
  reservation.estimatedArrivalTime = await lodgifyArrival(l.tenantId, id)
  // Payments entered in the panel (Lodgify can't record them): added to what Lodgify says was paid.
  const { data: rows } = await createServiceClient()
    .from('pms_manual_payments')
    .select('id, amount, method, note, created_at')
    .eq('tenant_id', l.tenantId)
    .eq('reservation_id', id)
    .order('created_at', { ascending: true })
  const manualPayments = (rows ?? []).map((x) => ({ id: x.id as string, amount: Number(x.amount), method: x.method as string, note: (x.note as string | null) ?? null, createdAt: x.created_at as string }))
  const extra = manualPayments.reduce((n, x) => n + x.amount, 0)
  if (extra > 0 && !/airbnb|booking/i.test(reservation.source ?? '')) {
    reservation.breakdown.paid = (reservation.breakdown.paid ?? 0) + extra
    reservation.balance = reservation.balance === null ? null : Math.max(0, Math.round((reservation.balance - extra) * 100) / 100)
  }
  return { ...reservation, manualPayments }
}

