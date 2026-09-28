import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decryptCredentials } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'

type CheckResult = { ok: boolean; detail?: string; error?: string }

async function checkWhatsApp(
  credentials: unknown,
  config: Record<string, string> | null
): Promise<CheckResult> {
  const phoneNumberId = config?.phone_number_id
  if (!phoneNumberId) return { ok: false, error: 'No phone_number_id configured' }

  const { access_token } = decryptCredentials<{ access_token: string }>(
    credentials as Parameters<typeof decryptCredentials>[0]
  )

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(8000),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `Meta API ${res.status}: ${text.slice(0, 300)}` }
  }

  const data = (await res.json()) as { display_phone_number?: string; verified_name?: string }
  return {
    ok: true,
    detail: [data.verified_name, data.display_phone_number].filter(Boolean).join(' · '),
  }
}

async function checkCloudbeds(
  credentials: unknown,
  config: Record<string, string> | null
): Promise<CheckResult> {
  const propertyId = config?.property_id
  if (!propertyId) return { ok: false, error: 'No property_id configured' }

  const { api_key } = decryptCredentials<{ api_key: string }>(
    credentials as Parameters<typeof decryptCredentials>[0]
  )

  // A deliberately fake confirmation number: "found: false" with no error
  // means the API was reachable and the key was accepted, which is all a
  // health check needs to know.
  const result = await lookupReservation(api_key, propertyId, '__healthcheck__')
  if (result.error) return { ok: false, error: result.error.slice(0, 300) }
  return { ok: true, detail: 'API reachable, key accepted' }
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { integrationType } = (await request.json()) as { integrationType?: string }

  if (integrationType !== 'whatsapp' && integrationType !== 'pms_cloudbeds') {
    return NextResponse.json(
      { error: 'Testing is not available for this integration yet' },
      { status: 400 }
    )
  }

  // RLS scopes this to the caller's own tenant automatically.
  const { data: row } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('integration_type', integrationType)
    .maybeSingle()

  if (!row || row.status !== 'connected' || !row.credentials) {
    return NextResponse.json({ error: 'This integration is not connected' }, { status: 400 })
  }

  let result: CheckResult
  try {
    result =
      integrationType === 'whatsapp'
        ? await checkWhatsApp(row.credentials, row.config as Record<string, string> | null)
        : await checkCloudbeds(row.credentials, row.config as Record<string, string> | null)
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : 'Check failed unexpectedly' }
  }

  const checkedAt = new Date().toISOString()

  // Health is recorded in its own columns and deliberately never touches
  // `status`: the inbound webhook only processes messages while
  // status = 'connected', so a failed test must not be able to switch off
  // real guest messaging.
  await supabase
    .from('tenant_integrations')
    .update({
      last_checked_at: checkedAt,
      last_check_ok: result.ok,
      last_error: result.ok ? null : (result.error ?? 'Unknown error'),
    })
    .eq('integration_type', integrationType)

  return NextResponse.json({ ...result, checkedAt })
}
