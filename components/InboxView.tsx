import Link from 'next/link'
import { requireStaff } from '@/lib/staff-context'
import { displayPhone, loadInbox, timeAgo } from '@/lib/inbox'
import LiveRefresh from './LiveRefresh'
import InboxList from './InboxList'

const INTEGRATION_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  pms_cloudbeds: 'Cloudbeds',
  instagram: 'Instagram',
  email: 'Email',
  transcription_deepgram: 'Voice notes (Deepgram)',
  costs_anthropic: 'Claude costs',
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
      <LiveRefresh tables={['messages', 'conversations']} />
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

      <InboxList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.guestName?.trim() || '',
          channel: r.channel,
          reservationStatus: r.reservationStatus ?? null,
          phone: r.guestPhone ? displayPhone(r.guestPhone) : null,
          preview: r.preview,
          status: r.status,
          unread: r.unread,
          ago: timeAgo(r.lastMessageAt),
        }))}
      />
    </main>
  )
}
