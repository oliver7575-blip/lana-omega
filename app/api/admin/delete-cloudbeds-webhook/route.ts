import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'

// One-off/standing cleanup tool: deletes a specific Cloudbeds webhook
// subscription by ID. Built after the sibling subscribe-cloudbeds-webhook
// route's stale-subscription filter checked the wrong response field
// (endpointUrl instead of the real subscriptionData.url) and left the old
// vercel.app subscription (aa3939ff2477335cf26ed82a5380ac87) undeleted
// alongside the new admin.soiree.mx one.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const tenantId = searchParams.get('tenantId') ?? 'f6598de8-83f0-4a06-add7-e1d4e80cab7a'
  const subscriptionId = searchParams.get('subscriptionId')

  if (!subscriptionId) {
    return NextResponse.json({ error: 'subscriptionId query param is required' }, { status: 400 })
  }

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

  const deleteResponse = await fetch(
    `https://api.cloudbeds.com/api/v1.3/deleteWebhook?subscriptionID=${encodeURIComponent(subscriptionId)}&propertyIDs=${encodeURIComponent(propertyId ?? '')}`,
    {
      method: 'DELETE',
      headers: { 'x-api-key': api_key },
    }
  )
  const deleteData = await deleteResponse.json()

  const listResponse = await fetch(
    `https://api.cloudbeds.com/api/v1.3/getWebhooks?propertyID=${encodeURIComponent(propertyId ?? '')}`,
    {
      method: 'GET',
      headers: { 'x-api-key': api_key },
    }
  )
  const listData = await listResponse.json()

  return NextResponse.json({
    deleted: { subscriptionId, status: deleteResponse.status, data: deleteData },
    remainingSubscriptions: listData?.data ?? [],
  })
}
