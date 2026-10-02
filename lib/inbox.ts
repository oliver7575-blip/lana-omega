import type { SupabaseClient } from '@supabase/supabase-js'

/** Conversation ids with activity since this staff member last opened them. */
export async function unreadConversationIds(
  supabase: SupabaseClient,
  staffUserId: string,
  opts: { reservationsOnly?: boolean } = {}
): Promise<string[]> {
  let q = supabase
    .from('conversations')
    .select('id, guest_id, last_message_at')
    .neq('status', 'closed')
    .not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(500)
  if (opts.reservationsOnly) {
    const { data: gr } = await supabase.from('guest_reservations').select('guest_id')
    const ids = (gr ?? []).map((r) => r.guest_id as string)
    if (ids.length === 0) return []
    q = q.in('guest_id', ids)
  }
  const { data: convs } = await q
  if (!convs?.length) return []

  const { data: reads } = await supabase
    .from('conversation_reads')
    .select('conversation_id, read_at')
    .eq('staff_user_id', staffUserId)
    .in('conversation_id', convs.map((c) => c.id))
  const readAt = new Map((reads ?? []).map((r) => [r.conversation_id as string, r.read_at as string]))

  return convs
    .filter((c) => {
      const r = readAt.get(c.id as string)
      return !r || new Date(c.last_message_at as string) > new Date(r)
    })
    .map((c) => c.id as string)
}

export interface InboxRow {
  id: string
  channel: string
  status: string
  lastMessageAt: string | null
  guestName: string | null
  guestPhone: string | null
  preview: string
  reservationStatus: string | null
  unread: boolean
}

export async function loadInbox(
  supabase: SupabaseClient,
  staffUserId: string,
  opts: { q?: string; reservationsOnly?: boolean }
): Promise<{ rows: InboxRow[]; total: number }> {
  const { data: reservations } = await supabase
    .from('guest_reservations')
    .select('guest_id, status')
  const resByGuest = new Map((reservations ?? []).map((r) => [r.guest_id as string, (r.status as string) ?? null]))

  let guestFilter: string[] | null = null
  if (opts.reservationsOnly) guestFilter = [...resByGuest.keys()]

  const term = opts.q?.trim()
  let messageMatchConvIds: string[] = []
  if (term) {
    const safe = term.replace(/[%,()]/g, ' ')
    const { data: gs } = await supabase
      .from('guests')
      .select('id')
      .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`)
    const byGuest = (gs ?? []).map((g) => g.id as string)
    const { data: ms } = await supabase
      .from('messages')
      .select('conversation_id')
      .ilike('content', `%${safe}%`)
      .limit(300)
    messageMatchConvIds = [...new Set((ms ?? []).map((m) => m.conversation_id as string))]
    guestFilter = guestFilter ? guestFilter.filter((id) => byGuest.includes(id)) : byGuest
    if (guestFilter.length === 0 && messageMatchConvIds.length === 0) return { rows: [], total: 0 }
  }

  let q = supabase
    .from('conversations')
    .select('id, channel, status, guest_id, last_message_at', { count: 'exact' })
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)
  if (guestFilter && messageMatchConvIds.length) {
    const g = guestFilter.length ? `guest_id.in.(${guestFilter.join(',')}),` : ''
    q = q.or(`${g}id.in.(${messageMatchConvIds.join(',')})`)
  } else if (guestFilter) {
    if (guestFilter.length === 0) return { rows: [], total: 0 }
    q = q.in('guest_id', guestFilter)
  }
  const { data: convs, count } = await q
  if (!convs?.length) return { rows: [], total: 0 }

  const guestIds = [...new Set(convs.map((c) => c.guest_id).filter(Boolean))] as string[]
  const convIds = convs.map((c) => c.id as string)

  const [{ data: guests }, { data: msgs }, unread] = await Promise.all([
    supabase.from('guests').select('id, name, phone').in('id', guestIds.length ? guestIds : ['00000000-0000-0000-0000-000000000000']),
    supabase
      .from('messages')
      .select('conversation_id, sender_type, content, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(1500),
    unreadConversationIds(supabase, staffUserId),
  ])
  const guestById = new Map((guests ?? []).map((g) => [g.id as string, g]))
  const lastMsg = new Map<string, { sender_type: string; content: string }>()
  for (const m of msgs ?? []) {
    if (!lastMsg.has(m.conversation_id as string)) lastMsg.set(m.conversation_id as string, m as never)
  }
  const unreadSet = new Set(unread)

  const rows = convs.map((c) => {
    const g = c.guest_id ? guestById.get(c.guest_id as string) : undefined
    const m = lastMsg.get(c.id as string)
    const who = m ? (m.sender_type === 'lana' ? 'Lana: ' : m.sender_type === 'staff' ? 'Staff: ' : '') : ''
    return {
      id: c.id as string,
      channel: c.channel as string,
      status: c.status as string,
      lastMessageAt: (c.last_message_at as string) ?? null,
      guestName: (g?.name as string) ?? null,
      guestPhone: (g?.phone as string) ?? null,
      preview: m ? who + (m.content ?? '').replace(/\s+/g, ' ') : '',
      reservationStatus: c.guest_id ? (resByGuest.get(c.guest_id as string) ?? null) : null,
      unread: unreadSet.has(c.id as string),
    }
  })
  return { rows, total: count ?? rows.length }
}

/** "3h ago" style time for the inbox. */
export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "+525513674153" for display (guest phones are stored as digits). */
export function displayPhone(phone: string | null): string {
  if (!phone) return ''
  if (phone.startsWith('web:')) return 'Website chat'
  if (phone.startsWith('ig:')) return 'Instagram'
  return phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`
}
