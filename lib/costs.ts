import { createServiceClient } from './supabase/service'
import { decryptCredentials, type EncryptedPayload } from './crypto'

/** Daily spend in USD keyed by UTC date ("YYYY-MM-DD"). */
export type DailyCosts = Record<string, number>

export interface MonthCosts {
  month: string // "YYYY-MM"
  days: string[]
  claude: { available: boolean; error?: string; daily: DailyCosts; total: number; currency: string }
  meta: { available: boolean; error?: string; daily: DailyCosts; total: number; currency: string }
}

const sum = (d: DailyCosts) => Object.values(d).reduce((a, b) => a + b, 0)

/**
 * Claude: Anthropic Admin API cost report (needs ANTHROPIC_ADMIN_KEY, an
 * "sk-ant-admin…" key). Amounts are reported in cents.
 */
export async function claudeDaily(
  startIso: string,
  endIso: string,
  opts: { adminKey?: string; workspaceId?: string } = {}
): Promise<DailyCosts> {
  const key = opts.adminKey || process.env.ANTHROPIC_ADMIN_KEY
  const workspace = opts.workspaceId || process.env.ANTHROPIC_WORKSPACE_ID
  if (!key) throw new Error('Connect "Claude costs" under Integrations to show Claude costs')
  const out: DailyCosts = {}
  let page: string | undefined
  for (let i = 0; i < 5; i++) {
    const qs = new URLSearchParams({ starting_at: startIso, ending_at: endIso, bucket_width: '1d', limit: '31' })
    if (workspace) qs.append('group_by[]', 'workspace_id')
    if (page) qs.set('page', page)
    const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${qs}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Anthropic cost report failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as {
      data: { starting_at: string; results: { amount: string; workspace_id?: string | null }[] }[]
      has_more?: boolean
      next_page?: string
    }
    for (const bucket of json.data ?? []) {
      const day = bucket.starting_at.slice(0, 10)
      const cents = (bucket.results ?? [])
        .filter((r) => !workspace || r.workspace_id === workspace)
        .reduce((a, r) => a + Number(r.amount || 0), 0)
      out[day] = (out[day] ?? 0) + cents / 100
    }
    if (!json.has_more || !json.next_page) break
    page = json.next_page
  }
  return out
}

/**
 * Meta: WhatsApp Business Account pricing analytics (conversation/message charges).
 * Meta reports `cost` in whichever currency the WABA actually bills in — not
 * necessarily USD. The `currency` embedded in each pricing_analytics data point is
 * NOT reliable (seen reporting "USD" while the account's real balance and payment
 * history, in Meta Business Suite, are in MXN) — the WABA node's own top-level
 * `currency` field is the account's real billing currency, so that's what's used.
 */
export async function metaDaily(
  wabaId: string,
  accessToken: string,
  startIso: string,
  endIso: string
): Promise<{ daily: DailyCosts; currency: string | null }> {
  const start = Math.floor(Date.parse(startIso) / 1000)
  const end = Math.floor(Date.parse(endIso) / 1000)
  const pricingField = `pricing_analytics.start(${start}).end(${end}).granularity(DAILY)`
  const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}?fields=currency,${encodeURIComponent(pricingField)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Meta pricing analytics failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    currency?: string
    pricing_analytics?: { data?: { data_points?: { start: number; cost?: number; currency?: string }[] }[] }
  }
  const out: DailyCosts = {}
  let dataPointCurrency: string | null = null
  for (const group of json.pricing_analytics?.data ?? []) {
    for (const p of group.data_points ?? []) {
      const day = new Date(p.start * 1000).toISOString().slice(0, 10)
      out[day] = (out[day] ?? 0) + Number(p.cost ?? 0)
      if (p.currency) dataPointCurrency = p.currency
    }
  }
  // The WABA's own billing currency wins over whatever pricing_analytics claims.
  return { daily: out, currency: json.currency || dataPointCurrency }
}

/** One month's daily costs for a hotel, live from Anthropic and Meta, saved as snapshots. */
export async function monthCosts(tenantId: string, month: string): Promise<MonthCosts> {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const monthEnd = new Date(Date.UTC(y, m, 1))
  const now = new Date()
  const end = monthEnd < now ? monthEnd : now
  const startIso = start.toISOString()
  const endIso = new Date(Math.max(end.getTime(), start.getTime() + 60000)).toISOString()

  const days: string[] = []
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10))

  const db = createServiceClient()
  const result: MonthCosts = {
    month,
    days: days.reverse(),
    claude: { available: false, daily: {}, total: 0, currency: 'USD' },
    meta: { available: false, daily: {}, total: 0, currency: 'USD' },
  }

  const { data: admin } = await db
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'costs_anthropic')
    .maybeSingle()
  try {
    const adminKey =
      admin?.status === 'connected' && admin.credentials
        ? decryptCredentials<{ admin_key: string }>(admin.credentials as EncryptedPayload).admin_key
        : undefined
    result.claude.daily = await claudeDaily(startIso, endIso, {
      adminKey,
      workspaceId: (admin?.config as { workspace_id?: string } | null)?.workspace_id || undefined,
    })
    result.claude.available = true
  } catch (err) {
    result.claude.error = err instanceof Error ? err.message : 'Claude costs unavailable'
  }

  const { data: wa } = await db
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()
  const wabaId = (wa?.config as { waba_id?: string } | null)?.waba_id
  if (wa?.status === 'connected' && wa.credentials && wabaId) {
    try {
      const { access_token } = decryptCredentials<{ access_token: string }>(wa.credentials as EncryptedPayload)
      const { daily, currency } = await metaDaily(wabaId, access_token, startIso, endIso)
      result.meta.daily = daily
      if (currency) result.meta.currency = currency
      result.meta.available = true
    } catch (err) {
      result.meta.error = err instanceof Error ? err.message : 'Meta costs unavailable'
    }
  } else {
    result.meta.error = 'Connect WhatsApp (with its Business Account ID) to show Meta costs'
  }

  // Keep a daily record (and fall back to it if a provider is unreachable). The
  // currency is saved alongside each row — Meta's own billing currency, not assumed USD.
  const rows = [
    ...(result.claude.available
      ? Object.entries(result.claude.daily).map(([d, v]) => ({ provider: 'claude', d, v, currency: result.claude.currency }))
      : []),
    ...(result.meta.available
      ? Object.entries(result.meta.daily).map(([d, v]) => ({ provider: 'meta', d, v, currency: result.meta.currency }))
      : []),
  ]
  if (rows.length) {
    await db.from('cost_snapshots').upsert(
      rows.map((r) => ({
        tenant_id: tenantId,
        snapshot_date: r.d,
        provider: r.provider,
        daily_cost_usd: r.v,
        currency: r.currency,
        collected_at: new Date().toISOString(),
      })),
      { onConflict: 'tenant_id,snapshot_date,provider' }
    )
  }
  if (!result.claude.available || !result.meta.available) {
    const { data: saved } = await db
      .from('cost_snapshots')
      .select('provider, snapshot_date, daily_cost_usd, currency')
      .eq('tenant_id', tenantId)
      .gte('snapshot_date', days[days.length - 1] ?? month + '-01')
      .lte('snapshot_date', days[0] ?? month + '-31')
    for (const s of saved ?? []) {
      const target = s.provider === 'claude' ? result.claude : result.meta
      if (!target.available) {
        target.daily[s.snapshot_date as string] = Number(s.daily_cost_usd)
        if (s.currency) target.currency = s.currency as string
      }
    }
  }

  result.claude.total = sum(result.claude.daily)
  result.meta.total = sum(result.meta.daily)
  return result
}
