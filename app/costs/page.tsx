'use client'

import { useCallback, useEffect, useState } from 'react'

interface Provider { available: boolean; error?: string; daily: Record<string, number>; total: number }
interface Data { month: string; days: string[]; claude: Provider; meta: Provider }

const usd = (n: number) => `$${n.toFixed(2)}`

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

export default function CostsPage() {
  const current = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(current)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setData(null)
    setError(null)
    try {
      const res = await fetch(`/api/costs?month=${month}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load costs')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load costs')
    }
  }, [month])

  useEffect(() => { load() }, [load])

  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const isCurrent = month === current

  const card = (title: string, p: Provider | undefined) => (
    <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-4">
      <div>
        <p className="font-semibold text-white">{title} cost {isCurrent ? 'this month' : `in ${monthLabel}`}</p>
        <p className="text-sm text-navy/55">
          {!p ? 'Loading…' : p.available ? (isCurrent ? 'Live month-to-date total' : 'Month total') : p.error ?? 'Unavailable'}
        </p>
      </div>
      <p className="text-2xl font-semibold text-white">{p ? usd(p.total) : '—'}</p>
    </div>
  )

  return (
    <main className="px-5 py-6 md:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl italic text-white">Costs</h1>
            <p className="text-sm text-navy/60">Month-to-date spend and the daily record, per provider.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-navy hover:bg-line/40">←</button>
            <span className="min-w-[8.5rem] text-center text-navy/80">{monthLabel}</span>
            <button disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-navy hover:bg-line/40 disabled:opacity-30">→</button>
          </div>
        </div>

        {error && <p className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm text-red-200">{error}</p>}

        <div className="mb-6 space-y-3">
          {card('Meta', data?.meta)}
          {card('Claude', data?.claude)}
          {data && (
            <div className="flex items-center justify-between rounded-2xl border border-clay/30 bg-clay/5 px-6 py-3">
              <p className="font-semibold text-white">Total</p>
              <p className="text-xl font-semibold text-clay">{usd(data.meta.total + data.claude.total)}</p>
            </div>
          )}
        </div>

        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="font-semibold text-white">Daily breakdown</h2>
            <p className="text-sm text-navy/55">Days in UTC, as reported by Anthropic and Meta. Saved daily.</p>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr] border-b border-line px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[.13em] text-navy/50">
            <span>Date</span><span className="text-right">Meta</span><span className="text-right">Claude</span><span className="text-right">Total</span>
          </div>
          {!data && !error && <p className="px-6 py-8 text-center text-sm text-navy/50">Loading…</p>}
          {data?.days.map((d) => {
            const meta = data.meta.daily[d] ?? 0
            const claude = data.claude.daily[d] ?? 0
            return (
              <div key={d} className="grid grid-cols-[1fr_1fr_1fr_1fr] border-b border-line px-6 py-2.5 text-sm last:border-0">
                <span className="text-navy/85">{d}</span>
                <span className="text-right text-navy/85">{usd(meta)}</span>
                <span className="text-right text-navy/85">{usd(claude)}</span>
                <span className="text-right text-white">{usd(meta + claude)}</span>
              </div>
            )
          })}
        </section>
      </div>
    </main>
  )
}
