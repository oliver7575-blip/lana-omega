import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const maxDuration = 30

/**
 * Sales ledger for the signed-in hotel: one row per booking that counts as revenue
 * (confirmed, no discount), dated by check-in. The page filters it instantly.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: staff } = await supabase.from('staff_users').select('tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return NextResponse.json({ error: 'No tenant' }, { status: 404 })

  const db = createServiceClient()
  const rows: Record<string, unknown>[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await db
      .from('booking_revenue')
      .select('reservation_id, guest_name, source, room_type, arrival, departure, nights, currency, stay_subtotal, addons, fees, taxes, vat, total, tax_class')
      .eq('tenant_id', staff.tenant_id)
      .eq('counts_as_revenue', true)
      .order('arrival', { ascending: true })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  const { data: syncedAt } = await db
    .from('booking_revenue')
    .select('synced_at')
    .eq('tenant_id', staff.tenant_id)
    .order('synced_at', { ascending: false })
    .limit(1)
  return NextResponse.json({ rows, syncedAt: syncedAt?.[0]?.synced_at ?? null })
}
