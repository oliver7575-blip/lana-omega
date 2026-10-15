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

  const newEndpointUrl = `https://admin.soiree.mx/api/webhooks/cloudbeds/${tenantId}`

  // Step 1: list existing subscriptions so we can find and remove any
  // pointing at the old vercel.app URL before creating a new one — this
  // avoids a duplicate subscription that would double-fire the webhook on
  // every new reservation.
  const listResponse = await fetch(
    `https://api.cloudbeds.com/api/v1.3/getWebhooks?propertyID=${encodeURIComponent(propertyId ?? '')}`,
    {
      method: 'GET',
      headers: { 'x-api-key': api_key },
    }
  )
  const listData = await listResponse.json()
  // Cloudbeds nests the actual endpoint URL at subscriptionData.url, not a
  // top-level endpointUrl field — confirmed against a real response after
  // an earlier version of this filter checked the wrong field and silently
  // matched nothing, leaving a stale subscription undeleted.
  const existingSubscriptions: { id?: string; subscriptionData?: { url?: string } }[] =
    listData?.data ?? []

  const staleSubscriptions = existingSubscriptions.filter((sub) =>
    (sub.subscriptionData?.url ?? '').includes('vercel.app')
  )

  const deletions: Record<string, unknown>[] = []
  for (const sub of staleSubscriptions) {
    if (!sub.id) continue
    const deleteResponse = await fetch(
      `https://api.cloudbeds.com/api/v1.3/deleteWebhook?subscriptionID=${encodeURIComponent(sub.id)}&propertyIDs=${encodeURIComponent(propertyId ?? '')}`,
      {
        method: 'DELETE',
        headers: { 'x-api-key': api_key },
      }
    )
    const deleteData = await deleteResponse.json()
    deletions.push({ subscriptionId: sub.id, status: deleteResponse.status, data: deleteData })
  }

  // Step 2: create the new subscription pointing at admin.soiree.mx.
  const body = new URLSearchParams({
    endpointUrl: newEndpointUrl,
    object: 'reservation',
    action: 'created',
  })

  const createResponse = await fetch(
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
  const createData = await createResponse.json()

  return NextResponse.json({
    existingSubscriptionsFound: existingSubscriptions,
    staleSubscriptionsRemoved: deletions,
    newSubscription: { status: createResponse.status, endpointUrl: newEndpointUrl, data: createData },
  })
}
