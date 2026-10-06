import { NextResponse } from 'next/server'
import { paymentsCaller } from '@/lib/payments/caller'
import { closePaymentRequest, pollPayment, type PaymentRequestRow } from '@/lib/payments/service'

export const maxDuration = 60

/** { action: 'recheck' | 'close' } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await paymentsCaller()
  if ('error' in c) return c.error
  if (!c.canManage) return NextResponse.json({ error: 'Only owners or admins can change payment links' }, { status: 403 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Unknown payment request' }, { status: 400 })
  const { action } = (await request.json().catch(() => ({}))) as { action?: string }
  const { data: row } = await c.supabase.from('payment_requests').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Payment request not found' }, { status: 404 })

  if (action === 'recheck') {
    const updated = await pollPayment(c.supabase, c.cb, c.ctx, row as PaymentRequestRow)
    return NextResponse.json({ request: updated })
  }
  if (action === 'close') {
    await closePaymentRequest(c.supabase, c.ctx, row as PaymentRequestRow, `staff:${c.staffId}`)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
