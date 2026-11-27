import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { voidSoldProduct } from '@/lib/cloudbeds-pos'
import { posCaller } from '@/lib/pos-auth'

export const maxDuration = 30

/**
 * Refund: body { line: n } refunds one line of the charge, no body refunds everything still standing.
 * For a posted charge each line is voided on the guest's Cloudbeds folio; a test charge is only marked.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { line?: number }
  const { data: ch } = await c.db.from('pos_charges').select('id, status, reservation_id, items, cloudbeds_response, voided_lines').eq('id', id).eq('tenant_id', c.tenantId).single()
  if (!ch) return NextResponse.json({ error: 'Charge not found' }, { status: 404 })
  if (ch.status === 'voided') return NextResponse.json({ ok: true })
  if (ch.status !== 'test' && ch.status !== 'posted') return NextResponse.json({ error: 'This charge was never posted, so there is nothing to refund.' }, { status: 400 })

  const count = Array.isArray(ch.items) ? (ch.items as unknown[]).length : 0
  const done = new Set<number>((ch.voided_lines as number[]) ?? [])
  const todo = typeof body.line === 'number' ? [body.line] : Array.from({ length: count }, (_, i) => i).filter((i) => !done.has(i))
  if (todo.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) return NextResponse.json({ error: 'Unknown line' }, { status: 400 })

  let failure: string | null = null
  if (ch.status === 'posted') {
    const r = (ch.cloudbeds_response ?? {}) as { lines?: { soldProductID: string | null }[]; soldProductIDs?: string[] }
    const ids: (string | null)[] = r.lines ? r.lines.map((l) => l.soldProductID) : (r.soldProductIDs ?? [])
    const cbc = await cloudbedsForCaller()
    if ('error' in cbc) return cbc.error
    for (const i of todo) {
      if (done.has(i)) continue
      if (!ids[i]) { failure = "Cloudbeds didn't return an item id for this line, so it can't be refunded here. Void it on the folio in Cloudbeds."; break }
      try {
        await voidSoldProduct(cbc.cb, ch.reservation_id as string, ids[i]!)
        done.add(i)
      } catch (err) {
        failure = `Cloudbeds did not refund it: ${err instanceof Error ? err.message : 'error'}`
        break
      }
    }
  } else {
    todo.forEach((i) => done.add(i))
  }

  const all = done.size >= count
  await c.db.from('pos_charges').update({ voided_lines: [...done].sort((a, b) => a - b), ...(all ? { status: 'voided', voided_at: new Date().toISOString() } : {}) }).eq('id', id)
  if (failure) return NextResponse.json({ error: failure }, { status: 502 })
  return NextResponse.json({ ok: true })
}
