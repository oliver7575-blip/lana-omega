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

  // endpointUrl/object/action go in the request BODY as form-urlencoded data
  // (matches Cloudbeds's own real curl example exactly, --data-urlencode).
  // propertyID goes in the URL query string instead — the docs explicitly
  // call that one out as a separate, URL-only parameter for multi-property
  // accounts.
  const body = new URLSearchParams({
    endpointUrl,
    object: 'reservation',
    action: 'created',
  })

  const response = await fetch(
    `https://api.cloudbeds.com/api/v1.3/postWebhook?propertyID=${encodeURIComponent(propertyId ?? '')}`,
    {
      method: 'POST',
      headers: {
        'x-api-key': api_key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }
  )

  const data = await response.json()

  return NextResponse.json({ status: response.status, endpointUrl, data })
}
