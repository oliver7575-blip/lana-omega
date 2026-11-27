'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface Item { id: string; name: string; category: string; price: number | string; active: boolean }
interface Guest { reservationID: string; guestName: string; room: string }
interface TabItem { itemId: string; name: string; category: string; price: number; quantity: number }
interface PosTable { slot: number; name: string; x?: number; y?: number }
interface Tab { id: string; kind: 'table' | 'room'; slot: number; items: TabItem[]; opened_at: string }
type Sel = { kind: 'table' | 'room'; slot: number }

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8]
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const tabTotal = (t?: Tab) => (t?.items ?? []).reduce((s, i) => s + i.price * i.quantity, 0)
const tabCount = (t?: Tab) => (t?.items ?? []).reduce((s, i) => s + i.quantity, 0)
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`)

// Olive palette
const C = {
  card: 'rgba(255,255,255,0.045)', line: 'rgba(210,220,160,0.16)', olive: '#8c9a3f', oliveHi: '#b3c25f', cream: '#efeede', mute: '#9aa085', ink: '#12150d',
}

/** Bar board: 8 rooms + 8 tables. Open a tab, add items, slide a table tab onto a room, charge the room. */
export default function PosPage() {
  const [items, setItems] = useState<Item[]>([])
  const [guests, setGuests] = useState<Guest[] | null>(null)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [tables, setTables] = useState<PosTable[]>([])
  const [adding, setAdding] = useState(false)
  const [arrange, setArrange] = useState(false)
  const [pos, setPos] = useState<Record<number, { x: number; y: number }>>({})
  const canvasRef = useRef<HTMLDivElement>(null)
  const arrRef = useRef<{ slot: number; offX: number; offY: number; tw: number; th: number } | null>(null)
  const [newName, setNewName] = useState('')
  const [testMode, setTestMode] = useState(true)
  const [sel, setSel] = useState<Sel | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [manual, setManual] = useState<Record<number, Guest>>({})
  const [sheet, setSheet] = useState(false)
  const [picker, setPicker] = useState<null | { for: 'guest' } | { for: 'slide'; tabId: string }>(null)
  const [search, setSearch] = useState('')
  const [confirmCharge, setConfirmCharge] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ tabId: string; slot: number; x: number; y: number; over: number | null } | null>(null)
  const dragRef = useRef<{ tabId: string; slot: number; sx: number; sy: number; moved: boolean } | null>(null)

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500) }

  const loadTabs = useCallback(async () => {
    const res = await fetch('/api/pos/tabs', { cache: 'no-store' })
    if (res.ok) setTabs((await res.json()).tabs)
  }, [])
  const loadGuests = useCallback(async () => {
    setGuestError(null)
    try {
      const res = await fetch('/api/pos/guests')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Could not load guests')
      setGuests(j.guests)
    } catch (e) {
      setGuests([])
      setGuestError(e instanceof Error ? e.message : 'Could not load guests')
    }
  }, [])

  useEffect(() => {
    fetch('/api/pos/menu').then((r) => r.json()).then((j) => setItems((j.items ?? []).filter((i: Item) => i.active)))
    fetch('/api/pos/settings').then((r) => r.json()).then((j) => setTestMode(j.testMode !== false))
    fetch('/api/pos/tables').then((r) => r.json()).then((j) => setTables(j.tables ?? []))
    loadTabs(); loadGuests()
    const t = setInterval(loadTabs, 8000) // other devices' changes show up
    return () => clearInterval(t)
  }, [loadTabs, loadGuests])

  const tableName = (slot: number) => tables.find((t) => t.slot === slot)?.name ?? `Table ${slot}`
  async function addTable() {
    const name = newName.trim()
    if (!name) return
    const res = await fetch('/api/pos/tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return setError(j.error ?? 'Could not add the table')
    setTables(j.tables); setAdding(false); setNewName(''); setError(null)
  }
  // Floor plan: saved position, else an automatic 3-across grid.
  const posOf = (t: PosTable, i: number) => {
    if (pos[t.slot]) return pos[t.slot]
    if (typeof t.x === 'number' && typeof t.y === 'number') return { x: t.x, y: t.y }
    const cols = 3, rows = Math.max(1, Math.ceil(tables.length / cols))
    return { x: (i % cols) / (cols - 1), y: rows > 1 ? Math.floor(i / cols) / (rows - 1) : 0 }
  }
  function arrDown(e: React.PointerEvent, slot: number) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    arrRef.current = { slot, offX: e.clientX - r.left, offY: e.clientY - r.top, tw: r.width, th: r.height }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  function arrMove(e: React.PointerEvent) {
    const a = arrRef.current, cv = canvasRef.current
    if (!a || !cv) return
    const cr = cv.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - cr.left - a.offX) / Math.max(1, cr.width - a.tw)))
    const y = Math.min(1, Math.max(0, (e.clientY - cr.top - a.offY) / Math.max(1, cr.height - a.th)))
    setPos((p) => ({ ...p, [a.slot]: { x, y } }))
  }
  async function arrUp() {
    const a = arrRef.current
    arrRef.current = null
    if (!a || !pos[a.slot]) return
    const { x, y } = pos[a.slot]
    setTables((ts) => ts.map((t) => (t.slot === a.slot ? { ...t, x, y } : t)))
    fetch('/api/pos/tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: a.slot, x, y }) })
  }
  const tabOf = (kind: 'table' | 'room', slot: number) => tabs.find((t) => t.kind === kind && t.slot === slot)
  const guestOfRoom = (slot: number): Guest | null =>
    manual[slot] ?? (guests ?? []).find((g) => new RegExp(`(^|\\D)${slot}(\\D|$)`).test(g.room)) ?? null

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items])
  const activeCat = category && categories.includes(category) ? category : categories[0] ?? null
  const shown = items.filter((i) => i.category === activeCat)
  const cur = sel ? tabOf(sel.kind, sel.slot) : undefined
  const curQty = (id: string) => cur?.items.find((i) => i.itemId === id)?.quantity ?? 0

  async function adjust(item: { id: string; name: string; category: string; price: number | string }, delta: 1 | -1) {
    if (!sel) return
    const { kind, slot } = sel
    // Instant on screen, then saved.
    setTabs((prev) => {
      const t = prev.find((x) => x.kind === kind && x.slot === slot)
      const list = (t?.items ?? []).map((i) => ({ ...i }))
      const hit = list.find((i) => i.itemId === item.id)
      if (hit) hit.quantity += delta
      else if (delta > 0) list.push({ itemId: item.id, name: item.name, category: item.category, price: Number(item.price), quantity: 1 })
      const next = list.filter((i) => i.quantity > 0)
      const others = prev.filter((x) => x !== t)
      return next.length ? [...others, { id: t?.id ?? 'pending', kind, slot, items: next, opened_at: t?.opened_at ?? new Date().toISOString() }] : others
    })
    await fetch('/api/pos/tabs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, slot, itemId: item.id, delta }) })
    loadTabs()
  }

  async function act(tabId: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/pos/tabs/${tabId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Something went wrong')
      await loadTabs()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function slide(tabId: string, fromSlot: number, toSlot: number) {
    if (await act(tabId, { action: 'move', toSlot })) {
      flash(`${tableName(fromSlot)} → Room ${toSlot}`)
      setPicker(null); setSel(null); setSheet(false)
    }
  }

  async function chargeRoom() {
    if (!sel || !cur) return
    const g = guestOfRoom(sel.slot)
    if (!g) { setError('Choose which guest this room belongs to.'); return }
    if (await act(cur.id, { action: 'charge', reservationId: g.reservationID, guestName: g.guestName, room: `Room ${sel.slot}` })) {
      flash(`${money(tabTotal(cur))} ${testMode ? 'saved as a TEST charge' : 'charged'} · Room ${sel.slot} · ${g.guestName}`)
      setConfirmCharge(false); setSel(null); setSheet(false)
    }
  }

  // --- drag a table tab onto a room (touch + mouse) ---
  function onDown(e: React.PointerEvent, t: Tab) {
    dragRef.current = { tabId: t.id, slot: t.slot, sx: e.clientX, sy: e.clientY, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 10) return
    d.moved = true
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-room-slot]') as HTMLElement | null
    setDrag({ tabId: d.tabId, slot: d.slot, x: e.clientX, y: e.clientY, over: el ? Number(el.dataset.roomSlot) : null })
  }
  function onUp(e: React.PointerEvent) {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (!d.moved) { setSel({ kind: 'table', slot: d.slot }); setError(null); return }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-room-slot]') as HTMLElement | null
    setDrag(null)
    if (el) slide(d.tabId, d.slot, Number(el.dataset.roomSlot))
  }

  const filtered = (guests ?? []).filter((g) => `${g.room} ${g.guestName}`.toLowerCase().includes(search.trim().toLowerCase()))
  const title = sel ? (sel.kind === 'table' ? tableName(sel.slot) : `Room ${sel.slot}`) : ''
  const selGuest = sel?.kind === 'room' ? guestOfRoom(sel.slot) : null
  const total = tabTotal(cur)
  const count = tabCount(cur)

  const tabPanel = sel && (
    <div className="flex flex-col gap-3">
      {sel.kind === 'room' && (
        <button onClick={() => { setPicker({ for: 'guest' }); setSearch('') }} className="rounded-xl px-4 py-3 text-left text-base" style={{ border: `1px solid ${C.line}`, background: C.card }}>
          {selGuest ? <><span style={{ color: C.mute }}>Guest </span><b>{selGuest.guestName}</b></> : <span style={{ color: C.mute }}>Choose the guest in this room…</span>}
        </button>
      )}
      <ul className="space-y-2">
        {(cur?.items ?? []).length === 0 && <li className="text-sm" style={{ color: C.mute }}>Tap items to add them to the tab.</li>}
        {(cur?.items ?? []).map((i) => (
          <li key={i.itemId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-base">{i.name}<span className="ml-2 text-sm" style={{ color: C.mute }}>{money(i.price * i.quantity)}</span></span>
            <span className="flex items-center gap-2">
              <RoundBtn onClick={() => adjust({ id: i.itemId, name: i.name, category: i.category, price: i.price }, -1)} label="−" />
              <span className="w-6 text-center text-base">{i.quantity}</span>
              <RoundBtn onClick={() => adjust({ id: i.itemId, name: i.name, category: i.category, price: i.price }, 1)} label="+" />
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between pt-3 text-xl font-semibold" style={{ borderTop: `1px solid ${C.line}` }}>
        <span>Total</span><span>{money(total)}</span>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {sel.kind === 'table' ? (
        <div className="grid grid-cols-2 gap-2">
          <Btn solid disabled={!cur || busy} onClick={() => cur && setPicker({ for: 'slide', tabId: cur.id })}>Slide to room →</Btn>
          <Btn disabled={!cur || busy} onClick={async () => { if (cur && await act(cur.id, { action: 'paid' })) { flash(`${tableName(sel.slot)} paid · ${money(total)}`); setSel(null); setSheet(false) } }}>Paid</Btn>
        </div>
      ) : (
        <Btn solid disabled={!cur || busy || !selGuest} onClick={() => { setError(null); setConfirmCharge(true) }}>Charge to room</Btn>
      )}
      {cur && (
        <button className="py-1 text-sm" style={{ color: C.mute }} onClick={async () => { if (confirm('Clear this tab? The items are discarded.') && await act(cur.id, { action: 'void' })) { setSel(null); setSheet(false) } }}>
          Clear tab
        </button>
      )}
    </div>
  )

  return (
    <main style={{ touchAction: 'manipulation' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.35em]" style={{ color: C.oliveHi }}>Escalón</p>
          <h1 className="font-display text-4xl italic" style={{ color: C.cream }}>Bar</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {testMode && <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(230,190,70,.16)', color: '#e8c872' }}>TEST MODE · not sent to Cloudbeds</span>}
          <Link href="/pos/manage" className="no-underline" style={{ color: C.mute }}>Menu · Charges · Mode</Link>
        </div>
      </header>
      {toast && <p className="mt-3 rounded-xl px-4 py-3 text-base" style={{ background: 'rgba(140,154,63,.2)', border: `1px solid ${C.olive}` }}>✓ {toast}</p>}
      {guestError && <p className="mt-3 text-sm text-red-300">Could not load checked-in guests: {guestError} <button className="underline" onClick={loadGuests}>Retry</button></p>}

      <Section title="Rooms" hint="Tap a room to add to its tab · drop a table here to move it over">
        {SLOTS.map((n) => {
          const t = tabOf('room', n); const g = guestOfRoom(n)
          return (
            <Tile key={n} data-room-slot={n} active={drag?.over === n} onClick={() => { setSel({ kind: 'room', slot: n }); setError(null) }}
              label={`Room ${n}`} sub={g ? g.guestName : 'No guest checked in'} dim={!g && !t} total={t ? tabTotal(t) : null} count={tabCount(t)} />
          )
        })}
      </Section>

      <section className="mt-7">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.25em]" style={{ color: C.oliveHi }}>Tables</h2>
          <span className="text-xs" style={{ color: C.mute }}>{arrange ? 'Drag a table to where it sits, then tap Done' : 'Start a tab at a table, then slide it onto a room'}</span>
          <span className="ml-auto flex gap-2">
            <button onClick={() => setArrange((v) => !v)} className="rounded-full px-4 py-2 text-sm font-semibold"
              style={arrange ? { background: C.olive, color: C.ink } : { background: C.card, border: `1px solid ${C.line}` }}>{arrange ? 'Done' : 'Arrange'}</button>
            <button onClick={() => { setAdding(true); setError(null) }} className="rounded-full px-4 py-2 text-sm font-semibold" style={{ background: C.card, border: `1px solid ${C.line}` }}>+ Add table</button>
          </span>
        </div>
        <div ref={canvasRef} className="relative w-full rounded-3xl [--tw:30%] sm:[--tw:22%] lg:[--tw:15%]"
          style={{ height: Math.max(360, Math.ceil(tables.length / 3) * 118 + 40), border: `1px ${arrange ? 'dashed' : 'solid'} ${arrange ? C.oliveHi : C.line}`, background: 'rgba(255,255,255,0.02)',
            backgroundImage: arrange ? 'radial-gradient(rgba(179,194,95,.25) 1px, transparent 1px)' : undefined, backgroundSize: '24px 24px' }}>
          {tables.map((tb, i) => {
            const n = tb.slot
            const t = tabOf('table', n)
            const p = posOf(tb, i)
            const box: React.CSSProperties = { position: 'absolute', width: 'var(--tw)', height: 96, left: `calc((100% - var(--tw)) * ${p.x})`, top: `calc((100% - 96px) * ${p.y})` }
            return arrange ? (
              <div key={n} className="select-none" style={{ ...box, touchAction: 'none', cursor: 'grab', zIndex: arrRef.current?.slot === n ? 5 : 1 }}
                onPointerDown={(e) => arrDown(e, n)} onPointerMove={arrMove} onPointerUp={arrUp} onPointerCancel={() => { arrRef.current = null }}>
                <Tile compact label={tb.name} sub="Drag me" dim total={t ? tabTotal(t) : null} count={tabCount(t)} table />
              </div>
            ) : (
              <div key={n} className="select-none" style={{ ...box, touchAction: t ? 'none' : 'auto', opacity: drag?.tabId === t?.id ? 0.35 : 1 }}
                onPointerDown={t ? (e) => onDown(e, t) : undefined} onPointerMove={t ? onMove : undefined} onPointerUp={t ? onUp : undefined} onPointerCancel={() => { dragRef.current = null; setDrag(null) }}>
                <Tile compact label={tb.name} sub={t ? 'Open · drag to a room' : 'Free'} dim={!t} total={t ? tabTotal(t) : null} count={tabCount(t)} table onClick={t ? undefined : () => { setSel({ kind: 'table', slot: n }); setError(null) }} />
              </div>
            )
          })}
        </div>
      </section>

      {adding && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 p-3 sm:items-center" onClick={() => setAdding(false)}>
          <div className="w-full max-w-md rounded-3xl p-5" style={{ background: '#1a1f12', border: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">New table</h3>
            <p className="mt-1 text-sm" style={{ color: C.mute }}>For example "Pool 1", "Lounge" or "Patio 2".</p>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTable()} placeholder="Name"
              className="mt-3 w-full rounded-xl bg-transparent px-4 py-3 text-base" style={{ border: `1px solid ${C.line}` }} />
            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Btn onClick={() => setAdding(false)}>Cancel</Btn>
              <Btn solid disabled={!newName.trim()} onClick={addTable}>Add</Btn>
            </div>
          </div>
        </div>
      )}

      {drag && (
        <div className="pointer-events-none fixed z-[90] rounded-2xl px-4 py-3 text-base font-semibold shadow-2xl" style={{ left: drag.x - 60, top: drag.y - 30, background: C.olive, color: C.ink }}>
          {tableName(drag.slot)}{drag.over ? ` → Room ${drag.over}` : ''}
        </div>
      )}

      {/* Tab screen */}
      {sel && (
        <div className="fixed inset-0 z-[80] overflow-y-auto" style={{ background: '#12150d' }}>
          <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-4 md:px-6 lg:pb-8" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
            <div className="flex items-center justify-between">
              <button onClick={() => { setSel(null); setSheet(false) }} className="rounded-full px-4 py-2 text-sm" style={{ background: C.card, border: `1px solid ${C.line}` }}>← Board</button>
              <h2 className="font-display text-3xl italic">{title}{selGuest ? <span className="ml-3 text-lg not-italic" style={{ color: C.mute }}>{selGuest.guestName}</span> : null}</h2>
              <span className="w-20" />
            </div>
            <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_360px]">
              <section>
                {items.length === 0 ? <p style={{ color: C.mute }}>No menu yet. Add items in <Link href="/pos/manage" className="underline">Menu</Link>.</p> : (
                  <>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {categories.map((c) => (
                        <button key={c} onClick={() => setCategory(c)} className="shrink-0 rounded-full px-5 py-3 text-base font-semibold"
                          style={c === activeCat ? { background: C.olive, color: C.ink } : { background: C.card, border: `1px solid ${C.line}` }}>{c}</button>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {shown.map((i) => (
                        <button key={i.id} onClick={() => adjust(i, 1)} className="relative flex min-h-[100px] flex-col justify-between rounded-2xl p-3 text-left active:scale-[0.98]"
                          style={{ background: C.card, border: `1px solid ${C.line}` }}>
                          <span className="text-base font-semibold leading-tight">{i.name}</span>
                          <span className="text-sm" style={{ color: C.oliveHi }}>{money(Number(i.price))}</span>
                          {curQty(i.id) > 0 && <span className="absolute right-2 top-2 rounded-full px-2.5 py-0.5 text-sm font-bold" style={{ background: C.olive, color: C.ink }}>{curQty(i.id)}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>
              <aside className="hidden h-fit rounded-3xl p-5 lg:sticky lg:top-4 lg:block" style={{ background: C.card, border: `1px solid ${C.line}` }}>{tabPanel}</aside>
            </div>
          </div>
          {!sheet && (
            <div className="fixed inset-x-0 bottom-0 p-3 lg:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
              <button onClick={() => setSheet(true)} className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-lg font-bold shadow-xl" style={{ background: C.olive, color: C.ink }}>
                <span>{title} · {count || 'empty'}</span><span>{money(total)}</span>
              </button>
            </div>
          )}
          {sheet && (
            <div className="fixed inset-0 z-[85] flex items-end bg-black/70 lg:hidden" onClick={() => setSheet(false)}>
              <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl p-4" style={{ background: '#1a1f12', border: `1px solid ${C.line}`, paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between"><b className="text-lg">{title}</b><button onClick={() => setSheet(false)} className="rounded-full px-4 py-2 text-sm" style={{ background: C.card }}>Close</button></div>
                {tabPanel}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pickers */}
      {picker && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 p-3 sm:items-center" onClick={() => setPicker(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl p-4" style={{ background: '#1a1f12', border: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()}>
            {picker.for === 'slide' ? (
              <>
                <h3 className="mb-3 text-lg font-semibold">Slide this tab to which room?</h3>
                <div className="grid grid-cols-2 gap-2">
                  {SLOTS.map((n) => { const g = guestOfRoom(n); const t = tabOf('room', n); return (
                    <button key={n} onClick={() => sel && slide(picker.tabId, sel.slot, n)} className="rounded-xl p-3 text-left" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                      <b>Room {n}</b><br /><span className="text-sm" style={{ color: C.mute }}>{g ? g.guestName : 'no guest'}{t ? ` · tab ${money(tabTotal(t))}` : ''}</span>
                    </button>) })}
                </div>
              </>
            ) : (
              <>
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search room or name" className="w-full rounded-xl bg-transparent px-4 py-3 text-base" style={{ border: `1px solid ${C.line}` }} />
                {guests === null && <p className="mt-3" style={{ color: C.mute }}>Loading guests…</p>}
                {guests && filtered.length === 0 && <p className="mt-3" style={{ color: C.mute }}>No checked-in guests found.</p>}
                <ul className="mt-2">
                  {filtered.map((g) => (
                    <li key={g.reservationID}>
                      <button onClick={() => { if (sel) setManual((m) => ({ ...m, [sel.slot]: g })); setPicker(null) }} className="flex w-full items-center justify-between py-4 text-left text-base" style={{ borderBottom: `1px solid ${C.line}` }}>
                        <span>{g.guestName}</span><b>{g.room}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {confirmCharge && sel && selGuest && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-3">
          <div className="w-full max-w-md rounded-3xl p-5" style={{ background: '#1a1f12', border: `1px solid ${C.line}` }}>
            <h2 className="text-xl font-semibold">Charge {money(total)}?</h2>
            <p className="mt-1 text-base" style={{ color: C.mute }}>To <b style={{ color: C.cream }}>Room {sel.slot}</b> · {selGuest.guestName}</p>
            <ul className="mt-3 space-y-1 text-sm">{(cur?.items ?? []).map((i) => <li key={i.itemId}>{i.quantity} × {i.name}</li>)}</ul>
            {testMode && <p className="mt-3 text-sm" style={{ color: '#e8c872' }}>Test mode: nothing is sent to Cloudbeds.</p>}
            {error && <p className="mt-3 text-base text-red-300">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Btn disabled={busy} onClick={() => setConfirmCharge(false)}>Back</Btn>
              <Btn solid disabled={busy} onClick={chargeRoom}>{busy ? 'Sending…' : error ? 'Try again' : 'Confirm'}</Btn>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.25em]" style={{ color: C.oliveHi }}>{title}</h2>
        <span className="text-xs" style={{ color: C.mute }}>{hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </section>
  )
}

function Tile({ label, sub, total, count, dim, active, table, compact, onClick, ...rest }: {
  label: string; sub: string; total: number | null; count: number; dim?: boolean; active?: boolean; table?: boolean; compact?: boolean; onClick?: () => void
} & Record<string, unknown>) {
  const open = total !== null
  return (
    <button {...(rest as object)} onClick={onClick} className={`relative flex w-full flex-col justify-between rounded-2xl text-left transition ${compact ? 'h-full p-3' : 'min-h-[112px] p-4'}`}
      style={{
        background: active ? 'rgba(179,194,95,.28)' : open ? 'rgba(140,154,63,.18)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? '#b3c25f' : open ? 'rgba(179,194,95,.55)' : 'rgba(210,220,160,.14)'}`,
        opacity: dim ? 0.6 : 1,
        transform: active ? 'scale(1.03)' : undefined,
      }}>
      <span className="flex items-center justify-between">
        <span className={`truncate font-semibold ${compact ? 'text-base' : 'text-lg'}`} style={{ color: '#efeede' }}>{label}</span>
        {open && <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: '#8c9a3f', color: '#12150d' }}>{count}</span>}
      </span>
      <span>
        <span className={`block truncate ${compact ? 'text-xs' : 'text-sm'}`} style={{ color: '#9aa085' }}>{sub}</span>
        {open && <span className={`block font-semibold ${compact ? 'text-base' : 'mt-1 text-lg'}`} style={{ color: '#b3c25f' }}>{money(total!)}</span>}
      </span>
    </button>
  )
}

function Btn({ children, solid, disabled, onClick }: { children: React.ReactNode; solid?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick} className="rounded-xl py-4 text-lg font-bold disabled:opacity-30"
      style={solid ? { background: C.olive, color: C.ink } : { background: C.card, border: `1px solid ${C.line}`, color: C.cream }}>
      {children}
    </button>
  )
}

function RoundBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} className="h-10 w-10 rounded-full text-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>{label}</button>
}
