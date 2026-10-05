import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pollInbox } from '@/lib/email-inbox'

export const maxDuration = 60

/** Every 5 minutes: reads each hotel's inbox and sorts new emails into Reviews / Email Inquiries. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: integrations } = await createServiceClient()
    .from('tenant_integrations')
    .select('tenant_id')
    .eq('integration_type', 'email')
    .eq('status', 'connected')
  const results = []
  for (const i of integrations ?? []) results.push(await pollInbox(i.tenant_id as string))
  return NextResponse.json({ results })
}
