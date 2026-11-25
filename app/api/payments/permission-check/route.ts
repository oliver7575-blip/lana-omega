import { NextResponse } from 'next/server'
import { paymentsCaller } from '@/lib/payments/caller'
import { createPayByLink } from '@/lib/payments/paylink'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'

/**
 * Safe test of the "create link" permission: asks Cloudbeds for a link on a
 * reservation number that cannot exist, so no link can result. 401/403 means the
 * API key lacks the permission; a validation/not-found answer means it has it.
 */
export async function GET() {
  const c = await paymentsCaller()
  if ('error' in c) return c.error
  if (!c.canManage) return NextResponse.json({ error: 'Only owners or admins can run this' }, { status: 403 })
  if (c.be.kind !== 'cloudbeds') {
    return NextResponse.json({ verdict: 'not_applicable', status: 0, message: `${c.be.label} payment links use the Stripe account connected to each rental in ${c.be.label}; there is no separate key permission to check.` })
  }
  const cbc = await cloudbedsForCaller()
  if ('error' in cbc) return cbc.error
  const r = await createPayByLink(cbc.cb, { reservationId: '0000000000000', amount: 10, description: 'Permission test (cannot create a link)', expiresAfterDays: 1 })
  if (r.ok) return NextResponse.json({ verdict: 'unexpected', note: 'Cloudbeds created a link for a non-existent reservation. Please tell the developer.', id: r.id })
  const verdict = r.status === 401 || r.status === 403 ? 'denied' : 'allowed'
  return NextResponse.json({ verdict, status: r.status, message: r.message })
}
