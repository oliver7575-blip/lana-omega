import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const tenantId = searchParams.get('tenantId') ?? 'f6598de8-83f0-4a06-add7-e1d4e80cab7a'

  const supabase = createServiceClient()

  const { data: cloudbedsIntegration } = await supabase
    .from('tenant_integrations')
    .select('credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()

  if (!cloudbedsIntegration) {
    return NextResponse.json({ error: 'No Cloudbeds integration found for this tenant' }, { status: 404 })
  }

  const { api_key } = decryptCredentials<{ api_key: string }>(cloudbedsIntegration.credentials)
  const propertyId = (cloudbedsIntegration.config as { property_id?: string })?.property_id

  const endpointUrl = `https://lana-omega-soiree-lana.vercel.app/api/webhooks/cloudbeds/${tenantId}`

  const params = new URLSearchParams({
    endpointUrl,
    object: 'reservation',
    action: 'created',
    propertyID: propertyId ?? '',
  })

  const response = await fetch(
    `https://api.cloudbeds.com/api/v1.3/postWebhook?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'x-api-key': api_key },
    }
  )

  const data = await response.json()

  return NextResponse.json({ status: response.status, endpointUrl, data })
}
