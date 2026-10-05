'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface Review {
  id: string
  source: 'email' | 'whatsapp' | 'instagram' | 'widget'
  platform: string | null
  guest_name: string | null
  rating: number | null
  rating_scale: number | null
  sentiment: 'positive' | 'neutral' | 'negative' | null
  review_text: string | null
  summary: string | null
  conversation_id: string | null
  received_at: string
  status: 'new' | 'done'
  inbound_emails: { from_email: string | null; from_name: string | null; subject: string | null; body_text: string | null } | null
}

const SOURCE: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', instagram: 'Instagram', widget: 'Website chat' }
const PLATFORM: Record<string, string> = { booking: 'Booking.com', airbnb: 'Airbnb', google: 'Google', tripadvisor: 'TripAdvisor', expedia: 'Expedia', direct: 'Direct' }
const SENTIMENT: Record<string, string> = {
  positive: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  neutral: 'border-white/15 bg-white/5 text-navy/70',
  negative: 'border-red-400/30 bg-red-500/10 text-red-200',
}

/** A rating on a 5-point scale, so Booking's /10 and Airbnb's /5 can be compared. */
function outOfFive(r: Review): number | null {
  if (r.rating == null) return null
  const scale = r.rating_scale || (r.rating > 5 ? 10 : 5)
  return Math.max(0, Math.min(5, (r.rating / scale) * 5))
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'new' | 'done'>('new')
  const [mood, setMood] = useState<'all' | 'positive' | 'neutral' | 'negative'>('all')
  const [openEmail, setOpenEmail] = useState<string | null>(null)

  useEffect(() => {
    const load = () => fetch('/api/reviews').then((r) => r.json()).then((j) => { setReviews(j.reviews ?? []); setLoading(false) })
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  async function patch(id: string, change: { status?: string; delete?: boolean }) {
    if (change.delete && !confirm('Delete this review from the list?')) return
    setReviews((list) => (change.delete ? list.filter((r) => r.id !== id) : list.map((r) => (r.id === id ? ({ ...r, ...change } as Review) : r))))
    await fetch('/api/reviews', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...change }) })
  }

  const stats = useMemo(() => {
    const rated = reviews.map(outOfFive).filter((x): x is number => x != null)
    return {
      total: reviews.length,
      avg: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
      positive: reviews.filter((r) => r.sentiment === 'positive').length,
      negative: reviews.filter((r) => r.sentiment === 'negative').length,
    }
  }, [reviews])
  const visible = reviews.filter((r) => r.status === view && (mood === 'all' || r.sentiment === mood))

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <h1 className="font-serif text-4xl italic text-white">Reviews</h1>
      <p className="mt-1 text-sm text-navy/55">Guest reviews and feedback — from booking sites and guest emails, and from what guests tell Lana on WhatsApp, Instagram and the website chat.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Reviews', String(stats.total)],
          ['Average', stats.avg != null ? `${stats.avg.toFixed(1)} / 5` : '—'],
          ['Positive', String(stats.positive)],
          ['Negative', String(stats.negative)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-navy/50">{k}</p>
            <p className="mt-1 text-2xl text-white">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'positive', 'neutral', 'negative'] as const).map((m) => (
            <button key={m} onClick={() => setMood(m)} className={`rounded-full border px-3 py-1 text-xs capitalize ${mood === m ? 'border-clay bg-clay/15 text-white' : 'border-line text-navy/60 hover:text-navy'}`}>
              {m}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-line p-0.5">
          {(['new', 'done'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-xs ${view === v ? 'bg-surface text-white' : 'text-navy/50 hover:text-navy'}`}>
              {v === 'new' ? 'New' : 'Handled'}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="mt-6 text-sm text-navy/55">Loading…</p>}
      {!loading && visible.length === 0 && <p className="mt-6 text-sm text-navy/55">No reviews here yet.</p>}

      <div className="mt-4 space-y-3">
        {visible.map((r) => {
          const stars = outOfFive(r)
          return (
            <div key={r.id} className={`rounded-xl border p-4 ${SENTIMENT[r.sentiment ?? 'neutral']}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{r.guest_name || 'Guest'}</p>
                  <p className="text-xs text-navy/55">
                    {[PLATFORM[r.platform ?? ''] ?? r.platform, `via ${SOURCE[r.source]}`, new Date(r.received_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {r.rating != null && (
                  <div className="text-right">
                    <p className="text-lg leading-none text-amber-300">{'★'.repeat(Math.round(stars ?? 0))}<span className="text-white/15">{'★'.repeat(5 - Math.round(stars ?? 0))}</span></p>
                    <p className="mt-1 text-xs text-navy/55">{r.rating}{r.rating_scale ? ` / ${r.rating_scale}` : ''}</p>
                  </div>
                )}
              </div>
              {r.review_text && <p className="mt-3 whitespace-pre-wrap text-sm text-navy/90">“{r.review_text}”</p>}
              {r.summary && <p className="mt-2 text-xs text-navy/55">{r.summary}</p>}
              {openEmail === r.id && r.inbound_emails && (
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/25 p-3 font-sans text-xs text-navy/80">
                  {r.inbound_emails.subject}{'\n\n'}{r.inbound_emails.body_text}
                </pre>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                {r.conversation_id && <Link href={`/conversations/${r.conversation_id}`} className="text-clay hover:underline">Open conversation</Link>}
                {r.inbound_emails && (
                  <button onClick={() => setOpenEmail(openEmail === r.id ? null : r.id)} className="text-clay hover:underline">
                    {openEmail === r.id ? 'Hide email' : 'Show email'}
                  </button>
                )}
                <button onClick={() => patch(r.id, { status: r.status === 'new' ? 'done' : 'new' })} className="text-navy/70 hover:text-white">
                  {r.status === 'new' ? 'Mark handled' : 'Mark as new'}
                </button>
                <button onClick={() => patch(r.id, { delete: true })} className="ml-auto text-red-300/80 hover:text-red-300">Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
