import { NextResponse } from 'next/server'
import { paymentsCaller } from '@/lib/payments/caller'
import { createPaymentLink } from '@/lib/payments/service'

export const maxDuration = 60

/** Recent payment links (newest first). */
export async function GET() {
  const c = await paymentsCaller()
  if ('error' in c) return c.error
  const { data, error } = await c.supabase.from('payment_requests').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [], canManage: c.canManage })
}

/** Staff creates a link: { reservationId, kind: 'deposit' | 'balance' }. The amount is decided by the rules, never by the caller. */
export async function POST(request: Request) {
  const c = await paymentsCaller()
  if ('error' in c) return c.error
  if (!c.canManage) return NextResponse.json({ error: 'Only owners or admins can create payment links' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { reservationId?: string; kind?: string }
  const reservationId = String(body.reservationId ?? '').trim()
  if (!/^\d{6,}$/.test(reservationId) || (body.kind !== 'deposit' && body.kind !== 'balance')) {
    return NextResponse.json({ error: 'Enter a Cloudbeds reservation number and choose deposit or balance' }, { status: 400 })
  }
  const result = await createPaymentLink(c.supabase, c.cb, c.ctx, { reservationId, kind: body.kind, createdBy: 'staff', staffUserId: c.staffId })
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 422 })
  return NextResponse.json({ request: result.request, reused: result.reused })
}
