import type { SupabaseClient } from '@supabase/supabase-js'

export type ReadKind = 'email' | 'review'

/** Emails that need a person (not reviews, not automated mail) and are still "to handle". */
const EMAIL_NEEDS_ATTENTION = ['inquiry', 'reservation', 'billing', 'job', 'sales', 'other']

/** Ids this staff member has already opened. */
export async function readIds(supabase: SupabaseClient, staffId: string, kind: ReadKind): Promise<Set<string>> {
  const { data } = await supabase.from('item_reads').select('item_id').eq('staff_user_id', staffId).eq('kind', kind).limit(5000)
  return new Set((data ?? []).map((r) => r.item_id as string))
}

/** Sidebar bubbles: unread emails to handle, and unread reviews. */
export async function unreadCounts(supabase: SupabaseClient, staffId: string): Promise<{ emails: number; reviews: number }> {
  const [{ data: emails }, { data: reviews }, readEmails, readReviews] = await Promise.all([
    supabase.from('inbound_emails').select('id').in('category', EMAIL_NEEDS_ATTENTION).eq('status', 'new').limit(1000),
    supabase.from('reviews').select('id').eq('status', 'new').limit(1000),
    readIds(supabase, staffId, 'email'),
    readIds(supabase, staffId, 'review'),
  ])
  return {
    emails: (emails ?? []).filter((e) => !readEmails.has(e.id as string)).length,
    reviews: (reviews ?? []).filter((r) => !readReviews.has(r.id as string)).length,
  }
}
