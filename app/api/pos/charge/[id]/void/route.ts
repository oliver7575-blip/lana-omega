import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { voidSoldProduct } from '@/lib/cloudbeds-pos'
import { posCaller } from '@/lib/pos-auth'

export const maxDuration = 30

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { id } = await params
  const { data: ch } = await c.db.from('pos_charges').select('id, status, reservation_id, cloudbeds_response').eq('id', id).eq('tenant_id', c.tenantId).single()
  if (!ch) return NextResponse.json({ error: 'Charge not found' }, { status: 404 })
  if (ch.status === 'voided') return NextResponse.json({ ok: true })

  if (ch.status === 'posted') {
    const ids = ((ch.cloudbeds_response as { soldProductIDs?: string[] } | null)?.soldProductIDs) ?? []
    if (!ids.length) {
      return NextResponse.json({ error: "Cloudbeds didn't return item ids for this charge, so it can't be voided here yet. Void it in Cloudbeds (reservation → folio)." }, { status: 409 })
    }
    const cbc = await cloudbedsForCaller()
    if ('error' in cbc) return cbc.error
    try {
      for (const sid of ids) await voidSoldProduct(cbc.cb, ch.reservation_id as string, sid)
    } catch (err) {
      return NextResponse.json({ error: `Cloudbeds did not void it: ${err instanceof Error ? err.message : 'error'}` }, { status: 502 })
    }
  }
  await c.db.from('pos_charges').update({ status: 'voided', voided_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ ok: true })
}
