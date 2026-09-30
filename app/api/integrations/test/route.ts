import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'

// Give the function room to finish: without this, a slow external call can
// hit the platform's default limit and die without recording anything.
export const maxDuration = 30

type CheckResult = { ok: boolean; detail?: string; error?: string }

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

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
  const result = await withTimeout(
    lookupReservation(api_key, propertyId, '__healthcheck__'),
    10000,
    'Cloudbeds request'
  )
  if (result.error) return { ok: false, error: result.error.slice(0, 300) }
  return { ok: true, detail: 'API reachable, key accepted' }
}

async function checkDeepgram(credentials: unknown): Promise<CheckResult> {
  const { api_key } = decryptCredentials<{ api_key: string }>(
    credentials as Parameters<typeof decryptCredentials>[0]
  )

  // Listing the key's projects is a free, read-only call: a 200 means the
  // key exists and Deepgram accepts it.
  const res = await fetch('https://api.deepgram.com/v1/projects', {
    headers: { Authorization: `Token ${api_key}` },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `Deepgram API ${res.status}: ${text.slice(0, 300)}` }
  }

  const data = (await res.json()) as { projects?: { name?: string }[] }
  const name = data.projects?.[0]?.name
  return { ok: true, detail: name ? `Key accepted · project "${name}"` : 'Key accepted' }
}

async function checkAnthropicAdmin(credentials: EncryptedPayload): Promise<CheckResult> {
  const { admin_key } = decryptCredentials<{ admin_key: string }>(credentials)
  const since = new Date(Date.now() - 2 * 86400000).toISOString()
  const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(since)}&limit=1`, {
    headers: { 'x-api-key': admin_key, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `Anthropic Admin API ${res.status}: ${text.slice(0, 300)}` }
  }
  return { ok: true, detail: 'Admin key accepted — Claude costs will show on the Costs page' }
}

const TESTABLE_TYPES = ['whatsapp', 'pms_cloudbeds', 'transcription_deepgram', 'costs_anthropic']

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { integrationType } = (await request.json()) as { integrationType?: string }

  if (!integrationType || !TESTABLE_TYPES.includes(integrationType)) {
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
        : integrationType === 'transcription_deepgram'
          ? await checkDeepgram(row.credentials)
          : integrationType === 'costs_anthropic'
            ? await checkAnthropicAdmin(row.credentials)
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
