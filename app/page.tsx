import InboxView from '@/components/InboxView'

export const dynamic = 'force-dynamic'

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  return <InboxView title="Inbox" basePath="/" q={q} />
}
