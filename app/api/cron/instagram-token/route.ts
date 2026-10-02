import { NextResponse } from 'next/server'
import { renewInstagramTokens } from '@/lib/instagram-token'

export const maxDuration = 60

/** Daily: renews Instagram tokens that are a week or more old. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ results: await renewInstagramTokens() })
}
