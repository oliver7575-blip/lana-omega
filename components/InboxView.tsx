import Link from 'next/link'
import { requireStaff } from '@/lib/staff-context'
import { displayPhone, loadInbox, timeAgo } from '@/lib/inbox'

const INTEGRATION_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  pms_cloudbeds: 'Cloudbeds',
  instagram: 'Instagram',
  email: 'Email',
  transcription_deepgram: 'Voice notes (Deepgram)',
}

export default async function InboxView({
  title,
  basePath,
  reservationsOnly,
  q,
}: {
  title: string
  basePath: string
  reservationsOnly?: boolean
  q?: string
}) {
  const { supabase, staff } = await requireStaff()
  if (!staff) {
    return <p className="p-10 text-navy/70">Signed in, but no hotel is linked to this account.</p>
  }

  const [{ rows, total }, { data: failing }] = await Promise.all([
    loadInbox(supabase, staff.id, { q, reservationsOnly }),
    supabase
      .from('tenant_integrations')
      .select('integration_type')
      .eq('status', 'connected')
      .eq('last_check_ok', false),
  ])

  return (
    <main className="px-5 py-6 md:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl italic text-white sm:text-3xl">{title}</h1>
        <form method="get" action={basePath} className="w-full sm:w-auto sm:flex-1 sm:px-10">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by name or message..."
            className="mx-auto block w-full max-w-md rounded-full border border-line bg-surface px-4 py-1.5 text-sm text-navy outline-none placeholder:text-navy/40 focus:border-clay"
          />
        </form>
        <p className="shrink-0 text-sm text-navy/60">
          {total} conversation{total === 1 ? '' : 's'}
        </p>
      </div>

      {(failing ?? []).length > 0 && (
        <div className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 px-5 py-3 text-sm text-red-200">
          ⚠ Connection problem:{' '}
          {(failing ?? []).map((f) => INTEGRATION_LABELS[f.integration_type] ?? f.integration_type).join(', ')} failed its
          last check.{' '}
          <Link href="/integrations" className="underline">
            Review integrations
          </Link>
        </div>
      )}

      {q && (
        <p className="mb-4 text-sm text-navy/60">
          Results for “{q}” ·{' '}
          <Link href={basePath} className="text-clay hover:underline">
            clear
          </Link>
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.length === 0 && <p className="px-6 py-10 text-center text-sm text-navy/50">No conversations here.</p>}
        {rows.map((r) => {
          const name = r.guestName?.trim() || ''
          return (
            <Link
              key={r.id}
              href={`/conversations/${r.id}`}
              className="flex items-center gap-3 border-b border-line px-4 py-3 transition last:border-b-0 hover:bg-white/[0.03] sm:px-5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper font-display text-base italic text-white">
                {name ? name[0].toUpperCase() : ''}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {name && <span className="text-[15px] font-semibold text-white">{name}</span>}
                  <span className="text-[11px] uppercase tracking-wider text-navy/45">{r.channel}</span>
                  {r.reservationStatus && (
                    <span className="rounded-full bg-clay/15 px-2 py-0.5 text-[11px] text-clay">
                      {r.reservationStatus.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                {r.guestPhone && <p className="text-xs text-navy/55">{displayPhone(r.guestPhone)}</p>}
                <p className="truncate text-sm text-navy/85">{r.preview}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {r.status === 'human_takeover' ? (
                  <span className="rounded-full bg-purple-500/15 px-2.5 py-1 text-xs font-medium text-purple-300">
                    human takeover
                  </span>
                ) : r.unread ? (
                  <span className="rounded-full bg-[#1b2340] px-2.5 py-1 text-xs font-medium text-[#8dacff]">new</span>
                ) : null}
                <span className="text-xs text-navy/50">{timeAgo(r.lastMessageAt)}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </main>
  )
}
