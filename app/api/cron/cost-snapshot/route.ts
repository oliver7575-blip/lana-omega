import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { monthCosts } from '@/lib/costs'

export const maxDuration = 60

/** Daily: saves each hotel's month-to-date costs, so history survives provider limits. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: tenants } = await createServiceClient().from('tenants').select('id')
  const month = new Date().toISOString().slice(0, 7)
  const results = []
  for (const t of tenants ?? []) {
    const r = await monthCosts(t.id as string, month)
    results.push({ tenantId: t.id, claude: r.claude.total, meta: r.meta.total, errors: [r.claude.error, r.meta.error].filter(Boolean) })
  }
  return NextResponse.json({ month, results })
}
