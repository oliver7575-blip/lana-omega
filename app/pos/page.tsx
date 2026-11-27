'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

interface Item { id: string; name: string; category: string; price: number | string; active: boolean }
interface Guest { reservationID: string; guestName: string; room: string }

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`)

/** Bar order screen, built for an iPad: pick items, pick the room, charge it. */
export default function PosPage() {
  const [items, setItems] = useState<Item[]>([])
  const [guests, setGuests] = useState<Guest[] | null>(null)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [testMode, setTestMode] = useState(true)
  const [category, setCategory] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [guest, setGuest] = useState<Guest | null>(null)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [requestId, setRequestId] = useState(newRequestId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const loadGuests = useCallback(async () => {
    setGuestError(null)
    try {
      const res = await fetch('/api/pos/guests')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load guests')
      setGuests(json.guests)
    } catch (e) {
      setGuests([])
      setGuestError(e instanceof Error ? e.message : 'Could not load guests')
    }
  }, [])

  useEffect(() => {
    fetch('/api/pos/menu').then((r) => r.json()).then((j) => setItems((j.items ?? []).filter((i: Item) => i.active)))
    fetch('/api/pos/settings').then((r) => r.json()).then((j) => setTestMode(j.testMode !== false))
    loadGuests()
  }, [loadGuests])

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items])
  const activeCat = category && categories.includes(category) ? category : categories[0] ?? null
  const shown = items.filter((i) => i.category === activeCat)
  const lines = items.filter((i) => cart[i.id] > 0).map((i) => ({ item: i, qty: cart[i.id] }))
  const total = lines.reduce((s, l) => s + Number(l.item.price) * l.qty, 0)
  const count = lines.reduce((s, l) => s + l.qty, 0)

  const add = (id: string, d: number) => setCart((c) => {
    const n = Math.max(0, (c[id] ?? 0) + d)
    const next = { ...c, [id]: n }
    if (!n) delete next[id]
    return next
  })

  const filtered = (guests ?? []).filter((g) => `${g.room} ${g.guestName}`.toLowerCase().includes(search.trim().toLowerCase()))

  async function charge() {
    if (!guest || !lines.length) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pos/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          reservationId: guest.reservationID,
          guestName: guest.guestName,
          room: guest.room,
          lines: lines.map((l) => ({ itemId: l.item.id, quantity: l.qty })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not charge')
      setDone(`${money(json.total)} ${json.status === 'test' ? 'saved as a TEST charge' : 'charged'} to ${guest.room} · ${guest.guestName}`)
      setCart({})
      setGuest(null)
      setConfirming(false)
      setRequestId(newRequestId())
      setTimeout(() => setDone(null), 6000)
    } catch (e) {
      // The same requestId is kept, so pressing Charge again can never double-charge.
      setError(e instanceof Error ? e.message : 'Could not charge')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Bar</h1>
        <Link href="/pos/manage" className="text-sm text-white/70 underline">Menu · Charges · Mode</Link>
      </div>
      {testMode && (
        <p className="mt-2 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm text-amber-200">
          TEST MODE — charges are saved here but not sent to Cloudbeds.
        </p>
      )}
      {done && <p className="mt-2 rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 py-2 text-base text-emerald-200">✓ {done}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <section>
          {items.length === 0 ? (
            <p className="text-white/70">No menu yet. Add items in <Link href="/pos/manage" className="underline">Menu</Link>.</p>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {categories.map((c) => (
                  <button key={c} onClick={() => setCategory(c)}
                    className={`shrink-0 rounded-full px-5 py-3 text-base font-semibold ${c === activeCat ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((i) => (
                  <button key={i.id} onClick={() => add(i.id, 1)}
                    className="relative flex min-h-[96px] flex-col justify-between rounded-2xl border border-white/15 bg-white/[0.06] p-3 text-left active:bg-white/20">
                    <span className="text-base font-semibold leading-tight">{i.name}</span>
                    <span className="text-sm text-white/70">{money(Number(i.price))}</span>
                    {cart[i.id] > 0 && <span className="absolute right-2 top-2 rounded-full bg-emerald-400 px-2 py-0.5 text-sm font-bold text-black">{cart[i.id]}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <aside className="h-fit rounded-2xl border border-white/15 bg-black/20 p-4 lg:sticky lg:top-4">
          <button onClick={() => { setPicking(true); setSearch('') }}
            className="w-full rounded-xl border border-white/25 px-4 py-3 text-left text-base">
            {guest ? <><b>{guest.room}</b> · {guest.guestName}</> : <span className="text-white/70">Choose room / guest…</span>}
          </button>

          <ul className="mt-3 space-y-2">
            {lines.length === 0 && <li className="text-sm text-white/60">Tap items to add them.</li>}
            {lines.map(({ item, qty }) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-base">{item.name}</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => add(item.id, -1)} className="h-10 w-10 rounded-full bg-white/10 text-xl" aria-label="Remove one">−</button>
                  <span className="w-5 text-center text-base">{qty}</span>
                  <button onClick={() => add(item.id, 1)} className="h-10 w-10 rounded-full bg-white/10 text-xl" aria-label="Add one">+</button>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-lg font-semibold">
            <span>Total ({count})</span><span>{money(total)}</span>
          </div>
          <button disabled={!guest || !lines.length} onClick={() => { setError(null); setConfirming(true) }}
            className="mt-3 w-full rounded-xl bg-emerald-400 py-4 text-lg font-bold text-black disabled:opacity-30">
            Charge to room
          </button>
          {lines.length > 0 && <button onClick={() => setCart({})} className="mt-2 w-full py-2 text-sm text-white/60">Clear order</button>}
        </aside>
      </div>

      {picking && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={() => setPicking(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/20 bg-[#0d1b3d] p-4" onClick={(e) => e.stopPropagation()}>
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search room or name"
              className="w-full rounded-xl border border-white/25 bg-transparent px-4 py-3 text-base" />
            {guests === null && <p className="mt-3 text-white/70">Loading guests…</p>}
            {guestError && <p className="mt-3 text-red-300">{guestError} <button onClick={loadGuests} className="underline">Retry</button></p>}
            {guests && !guestError && filtered.length === 0 && <p className="mt-3 text-white/70">No checked-in guests found.</p>}
            <ul className="mt-2 divide-y divide-white/10">
              {filtered.map((g) => (
                <li key={g.reservationID}>
                  <button onClick={() => { setGuest(g); setPicking(false) }} className="flex w-full items-center justify-between py-4 text-left text-base">
                    <span>{g.guestName}</span><b>{g.room}</b>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {confirming && guest && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#0d1b3d] p-5">
            <h2 className="text-xl font-semibold">Charge {money(total)}?</h2>
            <p className="mt-1 text-base text-white/80">To <b>{guest.room}</b> · {guest.guestName}</p>
            <ul className="mt-3 space-y-1 text-sm text-white/80">
              {lines.map(({ item, qty }) => <li key={item.id}>{qty} × {item.name}</li>)}
            </ul>
            {testMode && <p className="mt-3 text-sm text-amber-200">Test mode: nothing is sent to Cloudbeds.</p>}
            {error && <p className="mt-3 text-base text-red-300">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirming(false)} disabled={busy} className="flex-1 rounded-xl bg-white/10 py-3 text-base">Back</button>
              <button onClick={charge} disabled={busy} className="flex-1 rounded-xl bg-emerald-400 py-3 text-base font-bold text-black disabled:opacity-50">
                {busy ? 'Sending…' : error ? 'Try again' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
