'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface Item { id: string; name: string; category: string; price: number | string; active: boolean }
interface Charge {
  id: string; reservation_id: string; guest_name: string | null; room: string | null
  items: { name: string; quantity: number; price: number }[]; total: number | string
  status: 'test' | 'posted' | 'failed' | 'voided'; staff_email: string | null; error: string | null; created_at: string
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const input = 'rounded-lg border border-white/25 bg-transparent px-3 py-2 text-base'
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' })

export default function PosManagePage() {
  const [tab, setTab] = useState<'menu' | 'charges' | 'mode'>('menu')
  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Bar · Manage</h1>
        <Link href="/pos" className="text-sm text-white/70 underline">← Back to the order screen</Link>
      </div>
      <div className="mt-3 flex gap-2">
        {(['menu', 'charges', 'mode'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${tab === t ? 'bg-white text-black' : 'bg-white/10'}`}>{t}</button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'menu' && <MenuTab />}
        {tab === 'charges' && <ChargesTab />}
        {tab === 'mode' && <ModeTab />}
      </div>
    </main>
  )
}

function MenuTab() {
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', category: 'Drinks', price: '' })

  const load = useCallback(async () => {
    const res = await fetch('/api/pos/menu')
    const j = await res.json()
    if (!res.ok) setError(j.error ?? 'Could not load')
    else setItems(j.items)
  }, [])
  useEffect(() => { load() }, [load])

  async function call(method: string, body?: unknown, qs = '') {
    setError(null)
    const res = await fetch(`/api/pos/menu${qs}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not save')
    await load()
  }

  const categories = [...new Set(items.map((i) => i.category))]
  return (
    <div>
      {error && <p className="mb-2 text-red-300">{error}</p>}
      <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault()
        if (!draft.name.trim()) return
        await call('POST', { name: draft.name, category: draft.category || 'Drinks', price: Number(draft.price) || 0 })
        setDraft({ ...draft, name: '', price: '' })
      }}>
        <input className={`${input} min-w-[180px] flex-1`} placeholder="Item name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className={`${input} w-36`} placeholder="Category" list="pos-cats" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
        <datalist id="pos-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <input className={`${input} w-28`} placeholder="Price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        <button className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-black">Add</button>
      </form>

      {categories.map((c) => (
        <section key={c} className="mt-5">
          <h3 className="text-sm uppercase tracking-wide text-white/60">{c}</h3>
          <ul className="mt-2 space-y-2">
            {items.filter((i) => i.category === c).map((i) => (
              <ItemRow key={i.id} item={i} onSave={(patch) => call('PATCH', { id: i.id, ...patch })} onDelete={() => { if (confirm(`Delete ${i.name}?`)) call('DELETE', undefined, `?id=${i.id}`) }} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ItemRow({ item, onSave, onDelete }: { item: Item; onSave: (p: Partial<Item>) => void; onDelete: () => void }) {
  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState(item.category)
  const [price, setPrice] = useState(String(item.price))
  const dirty = name !== item.name || category !== item.category || Number(price) !== Number(item.price)
  return (
    <li className={`flex flex-wrap items-center gap-2 ${item.active ? '' : 'opacity-50'}`}>
      <input className={`${input} min-w-[160px] flex-1`} value={name} onChange={(e) => setName(e.target.value)} />
      <input className={`${input} w-32`} value={category} onChange={(e) => setCategory(e.target.value)} />
      <input className={`${input} w-24`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      {dirty && <button onClick={() => onSave({ name, category, price: Number(price) || 0 })} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black">Save</button>}
      <button onClick={() => onSave({ active: !item.active })} className="rounded-lg bg-white/10 px-3 py-2 text-sm">{item.active ? 'Hide' : 'Show'}</button>
      <button onClick={onDelete} className="rounded-lg px-2 py-2 text-sm text-red-300">Delete</button>
    </li>
  )
}

function ChargesTab() {
  const [charges, setCharges] = useState<Charge[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const res = await fetch('/api/pos/charge')
    const j = await res.json()
    if (!res.ok) setError(j.error ?? 'Could not load')
    else setCharges(j.charges)
  }, [])
  useEffect(() => { load() }, [load])

  async function voidIt(id: string) {
    if (!confirm('Void this charge?')) return
    setError(null)
    const res = await fetch(`/api/pos/charge/${id}/void`, { method: 'POST' })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not void')
    load()
  }

  const badge: Record<Charge['status'], string> = {
    test: 'bg-amber-300/20 text-amber-200', posted: 'bg-emerald-300/20 text-emerald-200', failed: 'bg-red-300/20 text-red-200', voided: 'bg-white/10 text-white/60',
  }
  return (
    <div>
      {error && <p className="mb-2 text-red-300">{error}</p>}
      {charges.length === 0 && <p className="text-white/70">No charges yet.</p>}
      <ul className="space-y-2">
        {charges.map((c) => (
          <li key={c.id} className="rounded-xl border border-white/15 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base"><b>{c.room ?? '—'}</b> · {c.guest_name}</span>
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${badge[c.status]}`}>{c.status}</span>
                <b className={c.status === 'voided' ? 'line-through opacity-60' : ''}>{money(Number(c.total))}</b>
              </span>
            </div>
            <p className="mt-1 text-sm text-white/70">{c.items.map((l) => `${l.quantity} × ${l.name}`).join(', ')}</p>
            <p className="mt-1 text-xs text-white/50">{when(c.created_at)}{c.staff_email ? ` · ${c.staff_email}` : ''}</p>
            {c.error && <p className="mt-1 text-sm text-red-300">{c.error}</p>}
            {(c.status === 'test' || c.status === 'posted') && <button onClick={() => voidIt(c.id)} className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm">Void</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ModeTab() {
  const [testMode, setTestMode] = useState<boolean | null>(null)
  useEffect(() => { fetch('/api/pos/settings').then((r) => r.json()).then((j) => setTestMode(j.testMode !== false)) }, [])
  async function set(live: boolean) {
    const msg = live
      ? 'Go LIVE? Every charge will be posted to the guest\'s room bill in Cloudbeds.'
      : 'Switch back to TEST mode? Charges will no longer be sent to Cloudbeds.'
    if (!confirm(msg)) return
    const res = await fetch('/api/pos/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ live }) })
    const j = await res.json()
    if (res.ok) setTestMode(j.testMode)
  }
  if (testMode === null) return <p>Loading…</p>
  return (
    <div className="max-w-xl">
      <p className="text-base">Mode: <b className={testMode ? 'text-amber-200' : 'text-emerald-200'}>{testMode ? 'TEST (nothing is sent to Cloudbeds)' : 'LIVE (charges go to the room bill)'}</b></p>
      <p className="mt-2 text-sm text-white/70">
        Keep test mode on until one real charge has been posted to a test reservation and checked in Cloudbeds (item name, price, taxes, and that it appears on the bill).
      </p>
      <button onClick={() => set(testMode)} className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-black">
        {testMode ? 'Go live' : 'Back to test mode'}
      </button>
    </div>
  )
}
