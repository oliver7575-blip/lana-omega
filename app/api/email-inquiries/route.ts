import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readIds } from '@/lib/item-reads'

const CATEGORIES = ['inquiry', 'reservation', 'billing', 'job', 'sales', 'other', 'automated', 'review']

/** Sorted incoming emails (everything except reviews; automated mail only on request). */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const showAutomated = new URL(request.url).searchParams.get('automated') === '1'
  let q = supabase
    .from('inbound_emails')
    .select('id, from_email, from_name, subject, body_text, received_at, category, summary, status')
    .neq('category', 'review')
    .order('received_at', { ascending: false })
    .limit(300)
  if (!showAutomated) q = q.neq('category', 'automated')
  const { data: staff } = await supabase.from('staff_users').select('id').eq('auth_uid', user.id).single()
  const [{ data, error }, { data: state }, reads] = await Promise.all([
    q,
    supabase.from('email_poll_state').select('last_polled_at, last_error').maybeSingle(),
    staff ? readIds(supabase, staff.id as string, 'email') : Promise.resolve(new Set<string>()),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const emails = (data ?? []).map((e) => ({ ...e, read: reads.has(e.id as string) }))
  return NextResponse.json({ emails, lastChecked: state?.last_polled_at ?? null, lastError: state?.last_error ?? null })
}

/** Mark handled / new, or move to another category (staff correcting the sorting). */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json()) as { id?: string; status?: string; category?: string }
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return NextResponse.json({ error: 'Unknown email' }, { status: 400 })
  const update: Record<string, string> = {}
  if (body.status === 'new' || body.status === 'done') update.status = body.status
  if (body.category && CATEGORIES.includes(body.category)) update.category = body.category
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  const { data: row, error } = await supabase.from('inbound_emails').update(update).eq('id', body.id).select('id, tenant_id, from_name, summary, received_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Moved to "review" by staff → also list it under Reviews.
  if (update.category === 'review' && row) {
    const { data: existing } = await supabase.from('reviews').select('id').eq('email_id', row.id).maybeSingle()
    if (!existing) {
      await supabase.from('reviews').insert({ tenant_id: row.tenant_id, source: 'email', platform: 'direct', guest_name: row.from_name, summary: row.summary, email_id: row.id, received_at: row.received_at })
    }
  }
  return NextResponse.json({ ok: true })
}
