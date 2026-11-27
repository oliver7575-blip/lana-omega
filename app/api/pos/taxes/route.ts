import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'

export const maxDuration = 30

/** Read-only: shows the taxes and fees set up in Cloudbeds, so the bar POS can match them. Posts nothing. */
export async function GET() {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const { apiKey, propertyId } = c.cb
  const res = await fetch(`https://api.cloudbeds.com/api/v1.3/getTaxesAndFees?propertyID=${propertyId}`, {
    headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000), cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  return NextResponse.json({ http: res.status, response: json })
}
