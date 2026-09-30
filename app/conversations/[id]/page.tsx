import Link from 'next/link'
import { requireStaff } from '@/lib/staff-context'
import { displayPhone } from '@/lib/inbox'
import { decryptCredentials } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'
import {
  AssignmentSelect,
  Composer,
  GuestEditor,
  NotesEditor,
  ScrollToBottom,
  TakeOverButton,
} from '@/components/ConversationClient'

export const dynamic = 'force-dynamic'

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString()
  }
}

const SENDER: Record<string, string> = { guest: 'Guest', lana: 'Lana', staff: 'Staff' }

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, staff, timezone } = await requireStaff()

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, tenant_id, channel, status, guest_id, created_at, assigned_staff_id, notes')
    .eq('id', id)
    .single()

  if (!conversation || !staff) {
    return (
      <main className="px-10 py-10">
        <Link href="/" className="text-navy/60 hover:text-navy">← Back to Inbox</Link>
        <p className="mt-6 text-navy/70">Conversation not found.</p>
      </main>
    )
  }

  // Opening a conversation marks it as read for this staff member.
  await supabase.from('conversation_reads').upsert(
    { conversation_id: id, staff_user_id: staff.id, tenant_id: conversation.tenant_id, read_at: new Date().toISOString() },
    { onConflict: 'conversation_id,staff_user_id' }
  )

  const [{ data: guest }, { data: messages }, { data: staffList }, { data: escalations }, { data: saved }] =
    await Promise.all([
      conversation.guest_id
        ? supabase.from('guests').select('id, name, phone, email').eq('id', conversation.guest_id).single()
        : Promise.resolve({ data: null }),
      supabase
        .from('messages')
        .select('id, sender_type, content, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('staff_users').select('id, full_name, email').order('full_name'),
      supabase
        .from('escalations')
        .select('id, category, urgency, summary, status, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false }),
      conversation.guest_id
        ? supabase.from('guest_reservations').select('confirmation_number').eq('guest_id', conversation.guest_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  // The guest's reservation, live from Cloudbeds (and cached for the inbox pill).
  let reservation: Awaited<ReturnType<typeof lookupReservation>> | null = null
  if (saved?.confirmation_number) {
    const { data: cb } = await supabase
      .from('tenant_integrations')
      .select('status, credentials, config')
      .eq('integration_type', 'pms_cloudbeds')
      .maybeSingle()
    const propertyId = (cb?.config as { property_id?: string } | null)?.property_id
    if (cb?.status === 'connected' && propertyId) {
      try {
        const { api_key } = decryptCredentials<{ api_key: string }>(cb.credentials)
        reservation = await lookupReservation(api_key, propertyId, saved.confirmation_number as string)
        if (reservation.found) {
          await supabase
            .from('guest_reservations')
            .update({
              status: reservation.status ?? null,
              start_date: reservation.startDate ?? null,
              end_date: reservation.endDate ?? null,
              room_label: [reservation.roomTypeName, reservation.roomName].filter(Boolean).join(' · ') || null,
              synced_at: new Date().toISOString(),
            })
            .eq('guest_id', conversation.guest_id as string)
        }
      } catch {
        reservation = null
      }
    }
  }

  const name = guest?.name?.trim() || displayPhone(guest?.phone ?? null) || 'Guest'
  const statusPill =
    conversation.status === 'human_takeover'
      ? { label: 'human takeover', cls: 'bg-purple-500/15 text-purple-300' }
      : conversation.status === 'closed'
        ? { label: 'closed', cls: 'bg-white/10 text-navy/60' }
        : { label: 'new', cls: 'bg-[#1b2340] text-[#8dacff]' }

  return (
    <main className="flex min-h-screen flex-col md:h-screen">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-5 md:px-10">
        <div className="min-w-0">
          <Link href="/" className="text-sm text-navy/60 hover:text-navy">← Back to Inbox</Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="truncate font-display text-3xl italic text-white">{name}</h1>
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusPill.cls}`}>{statusPill.label}</span>
          </div>
          <p className="mt-1 text-navy/55">
            {conversation.channel} · started {fmt(conversation.created_at as string, timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
            {guest?.phone ? ` · ${displayPhone(guest.phone)}` : ''}
          </p>
        </div>
        <TakeOverButton conversationId={id} status={conversation.status as string} />
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_360px]">
        <section className="flex min-h-0 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-8 md:px-10">
            {(messages ?? []).map((m) => {
              const mine = m.sender_type !== 'guest'
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-6 py-3.5 text-[17px] leading-relaxed text-navy sm:max-w-[70%] ${
                      m.sender_type === 'guest' ? 'bg-surface' : m.sender_type === 'staff' ? 'bg-clay/15' : 'bg-[#1f2848]'
                    }`}
                  >
                    {m.content}
                  </div>
                  <p className="mt-1.5 text-sm text-navy/45">
                    {SENDER[m.sender_type as string] ?? m.sender_type} ·{' '}
                    {fmt(m.created_at as string, timezone, { day: 'numeric', month: 'short' })} at{' '}
                    {fmt(m.created_at as string, timezone, { hour: '2-digit', minute: '2-digit', hour12: false })}
                    {mine ? ' · ✓' : ''}
                  </p>
                </div>
              )
            })}
            <ScrollToBottom />
          </div>
          {conversation.status !== 'closed' && <Composer conversationId={id} channel={conversation.channel as string} />}
        </section>

        <aside className="space-y-9 overflow-y-auto border-t border-line px-6 py-8 lg:border-l lg:border-t-0 lg:px-8">
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-navy/50">Guest</h2>
            <p className="text-lg font-semibold text-white">{guest?.name || '—'}</p>
            {guest?.phone && <p className="text-lg text-navy/60">{displayPhone(guest.phone)}</p>}
            {guest?.email && <p className="text-navy/60">{guest.email}</p>}
            {guest && <GuestEditor guestId={guest.id as string} name={guest.name as string | null} email={guest.email as string | null} />}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-navy/50">Chat assignment</h2>
            <AssignmentSelect
              conversationId={id}
              value={conversation.assigned_staff_id as string | null}
              staff={(staffList ?? []).map((s) => ({ id: s.id as string, label: (s.full_name as string) || (s.email as string) }))}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-navy/50">Reservations</h2>
            {reservation?.found ? (
              <div className="rounded-xl border border-line px-5 py-4">
                <p className="text-lg font-semibold text-white">
                  {[reservation.roomTypeName, reservation.roomName ? `Room ${reservation.roomName}` : null].filter(Boolean).join(' · ') || 'Reservation'}
                </p>
                <p className="text-navy/70">
                  {reservation.startDate} → {reservation.endDate}
                </p>
                <p className="text-navy/55">
                  {(reservation.status ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())} · #{saved?.confirmation_number}
                </p>
                {typeof reservation.balance === 'number' && reservation.balance > 0 && (
                  <p className="mt-1 text-sm text-red-300">Balance due: {reservation.balance.toLocaleString('en-US')} MXN</p>
                )}
              </div>
            ) : (
              <p className="text-lg text-navy/60">None found.</p>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-navy/50">Escalations</h2>
            {(escalations ?? []).length === 0 ? (
              <p className="text-lg text-navy/60">None.</p>
            ) : (
              <div className="space-y-3">
                {(escalations ?? []).map((e) => (
                  <Link key={e.id} href="/escalations" className="block rounded-xl border border-line px-4 py-3 hover:bg-white/[0.03]">
                    <p className="text-sm">
                      <span className="text-clay">{e.category}</span>
                      <span className="ml-2 uppercase text-navy/45">{e.urgency}</span>
                    </p>
                    <p className="text-navy/80">{e.summary}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-navy/50">Notes</h2>
            <NotesEditor conversationId={id} value={conversation.notes as string | null} />
          </div>
        </aside>
      </div>
    </main>
  )
}
