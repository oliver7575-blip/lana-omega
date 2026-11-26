'use client'

import { useEffect, useMemo, useState } from 'react'

interface Row {
  reservation_id: string
  guest_name: string | null
  source: string | null
  room_type: string | null
  arrival: string
  departure: string
  nights: number
  currency: string | null
  stay_subtotal: number | string | null
  addons: number | string | null
  fees: number | string | null
  taxes: number | string | null
  vat: number | string | null
  total: number | string | null
  tax_class: 'taxable' | 'non_taxable'
}

const num = (v: unknown) => Number(v ?? 0) || 0
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const todayIso = () => new Date().toISOString().slice(0, 10)

export default function SalesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [off, setOff] = useState<Set<string>>(new Set())
  const [showTaxable, setShowTaxable] = useState(true)
  const [showNon, setShowNon] = useState(true)
  const [openRoom, setOpenRoom] = useState<string | null>(null)
  // Channel rules, as percent of the room rate (payment fee: percent of the guest total). Editable.
  const [rates, setRates] = useState({ iva: 16, state: 3, commission: 15, fee: 4, ivaRet: 8, isrRet: 4, airIva: 8, airState: 3 })
  const setRate = (k: keyof typeof rates, v: string) => setRates((r) => ({ ...r, [k]: Number(v) || 0 }))

  useEffect(() => {
    fetch('/api/sales', { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.error ?? 'Could not load sales')
        setRows(j.rows ?? [])
        const first = (j.rows ?? [])[0]?.arrival as string | undefined
        setFrom(first ?? todayIso())
        setTo(todayIso())
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load sales'))
      .finally(() => setLoading(false))
  }, [])

  const rooms = useMemo(() => Array.from(new Set(rows.map((r) => r.room_type ?? 'Unassigned'))).sort(), [rows])
  const earliest = rows[0]?.arrival ?? ''
  const latest = rows.length ? rows[rows.length - 1].arrival : ''

  const inRange = useMemo(
    () => rows.filter((r) => (!from || r.arrival >= from) && (!to || r.arrival <= to)),
    [rows, from, to]
  )
  const selected = useMemo(
    () =>
      inRange.filter((r) => {
        if (off.has(r.room_type ?? 'Unassigned')) return false
        return r.tax_class === 'taxable' ? showTaxable : showNon
      }),
    [inRange, off, showTaxable, showNon]
  )

  const perRoom = useMemo(() => {
    return rooms.map((room) => {
      const mine = inRange.filter((r) => (r.room_type ?? 'Unassigned') === room && (r.tax_class === 'taxable' ? showTaxable : showNon))
      return {
        room,
        bookings: mine.length,
        nights: mine.reduce((s, r) => s + num(r.nights), 0),
        pretax: mine.filter((r) => r.tax_class === 'taxable').reduce((s, r) => s + num(r.total) - num(r.taxes) - num(r.vat), 0),
        taxes: mine.reduce((s, r) => s + num(r.taxes) + num(r.vat), 0),
        nonTaxable: mine.filter((r) => r.tax_class === 'non_taxable').reduce((s, r) => s + num(r.total), 0),
        total: mine.reduce((s, r) => s + num(r.total), 0),
      }
    })
  }, [rooms, inRange, showTaxable, showNon])

  const totals = useMemo(() => {
    const on = perRoom.filter((p) => !off.has(p.room))
    const sum = (k: 'bookings' | 'nights' | 'pretax' | 'taxes' | 'nonTaxable' | 'total') => on.reduce((s, p) => s + p[k], 0)
    return { bookings: sum('bookings'), nights: sum('nights'), pretax: sum('pretax'), taxes: sum('taxes'), nonTaxable: sum('nonTaxable'), total: sum('total') }
  }, [perRoom, off])

  const channel = useMemo(() => {
    const pc = (n: number) => n / 100
    const booking = selected
      .filter((r) => /booking/i.test(r.source ?? ''))
      .map((r) => {
        const room = num(r.stay_subtotal)
        const total = num(r.total)
        const iva = room * pc(rates.iva)
        const state = room * pc(rates.state)
        const commission = room * pc(rates.commission)
        const fee = total * pc(rates.fee)
        const ivaRet = room * pc(rates.ivaRet)
        const isrRet = room * pc(rates.isrRet)
        const received = total - commission - fee - ivaRet - isrRet
        const ivaFund = iva - ivaRet
        const left = received - ivaFund - state
        return { r, room, total, iva, state, commission, fee, ivaRet, isrRet, received, ivaFund, stateFund: state, left }
      })
    const airbnb = selected
      .filter((r) => /airbnb/i.test(r.source ?? ''))
      .map((r) => {
        const room = num(r.stay_subtotal)
        const total = num(r.total)
        const ivaFund = room * pc(rates.airIva)
        const stateFund = room * pc(rates.airState)
        return { r, room, total, ivaFund, stateFund, left: total - ivaFund - stateFund }
      })
    const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0)
    return { booking, airbnb, sum }
  }, [selected, rates])

  const toggleRoom = (room: string) =>
    setOff((s) => {
      const n = new Set(s)
      if (n.has(room)) n.delete(room)
      else n.add(room)
      return n
    })

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] transition ${on ? 'border-clay bg-clay/15 text-navy' : 'border-line text-navy/50 line-through'}`
  const input = 'rounded-md border border-line bg-paper px-2.5 py-1.5 text-[13px] text-navy focus:outline-none'
  const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-navy/60'
  const td = 'px-3 py-2 text-[13px] text-navy tabular-nums'

  const currency = rows.find((r) => r.currency)?.currency ?? 'MXN'

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-8">
      <h1 className="text-2xl font-semibold text-navy">Sales</h1>
      <p className="mt-1 text-[13px] text-navy/60">
        Confirmed bookings by check-in date, in {currency}. Cancelled, declined and discounted bookings are not counted.
      </p>

      {loading && <p className="mt-6 text-sm text-navy/60">Loading…</p>}
      {error && <p className="mt-6 text-sm text-red-300">{error}</p>}

      {!loading && !error && (
        <>
          <div className="mt-6 grid gap-4 rounded-xl border border-line p-4 md:grid-cols-[auto_1fr]">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[12px] text-navy/60">
                From
                <input type="date" className={`${input} mt-1 block`} value={from} min={earliest} max={to || latest} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-[12px] text-navy/60">
                To
                <input type="date" className={`${input} mt-1 block`} value={to} min={from || earliest} onChange={(e) => setTo(e.target.value)} />
              </label>
              <div className="flex gap-2 pb-0.5 text-[12px]">
                <button className="text-clay hover:underline" onClick={() => { setFrom(earliest); setTo(todayIso()) }}>All to today</button>
                <button className="text-clay hover:underline" onClick={() => { setFrom(earliest); setTo(latest) }}>Everything</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end" role="group" aria-label="Sales type">
              <button className={chip(showTaxable)} aria-pressed={showTaxable} onClick={() => setShowTaxable((v) => !v)}>Taxable</button>
              <button className={chip(showNon)} aria-pressed={showNon} onClick={() => setShowNon((v) => !v)}>Non-taxable</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2" role="group" aria-label="Rentals">
              {rooms.map((room) => (
                <button key={room} className={chip(!off.has(room))} aria-pressed={!off.has(room)} onClick={() => toggleRoom(room)}>
                  {room}
                </button>
              ))}
              <button className="ml-1 text-[12px] text-clay hover:underline" onClick={() => setOff(new Set())}>All on</button>
              <button className="text-[12px] text-clay hover:underline" onClick={() => setOff(new Set(rooms))}>All off</button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-navy/50">
            Data goes back to {earliest ? day(earliest) : '—'}, the first booking in the system. Dates later than today are future bookings.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Total sales', totals.total],
              ['Taxable before tax', totals.pretax],
              ['Taxes', totals.taxes],
              ['Non-taxable', totals.nonTaxable],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded-xl border border-line p-3">
                <div className="text-[11px] uppercase tracking-wide text-navy/60">{label}</div>
                <div className="mt-1 text-xl font-semibold text-navy tabular-nums">{money(v as number)}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[720px] border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Rental</th>
                  <th className={`${th} text-right`}>Bookings</th>
                  <th className={`${th} text-right`}>Nights</th>
                  <th className={`${th} text-right`}>Before tax</th>
                  <th className={`${th} text-right`}>Taxes</th>
                  <th className={`${th} text-right`}>Non-taxable</th>
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {perRoom.map((p) => {
                  const dim = off.has(p.room)
                  return (
                    <tr key={p.room} className={`border-b border-line/60 ${dim ? 'opacity-35' : 'cursor-pointer hover:bg-white/5'}`} onClick={() => !dim && setOpenRoom(openRoom === p.room ? null : p.room)}>
                      <td className={td}>{p.room}</td>
                      <td className={`${td} text-right`}>{p.bookings}</td>
                      <td className={`${td} text-right`}>{p.nights}</td>
                      <td className={`${td} text-right`}>{money(p.pretax)}</td>
                      <td className={`${td} text-right`}>{money(p.taxes)}</td>
                      <td className={`${td} text-right`}>{money(p.nonTaxable)}</td>
                      <td className={`${td} text-right font-semibold`}>{money(p.total)}</td>
                    </tr>
                  )
                })}
                <tr className="bg-white/5">
                  <td className={`${td} font-semibold`}>Total</td>
                  <td className={`${td} text-right font-semibold`}>{totals.bookings}</td>
                  <td className={`${td} text-right font-semibold`}>{totals.nights}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.pretax)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.taxes)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.nonTaxable)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {openRoom && (
            <div className="mt-5 overflow-x-auto rounded-xl border border-line">
              <div className="border-b border-line px-3 py-2 text-[13px] font-semibold text-navy">{openRoom}: bookings</div>
              <table className="w-full min-w-[640px] border-collapse">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th}>Check-in</th>
                    <th className={th}>Guest</th>
                    <th className={th}>Source</th>
                    <th className={`${th} text-right`}>Nights</th>
                    <th className={th}>Type</th>
                    <th className={`${th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.filter((r) => (r.room_type ?? 'Unassigned') === openRoom).map((r) => (
                    <tr key={r.reservation_id} className="border-b border-line/60">
                      <td className={td}>{day(r.arrival)}</td>
                      <td className={td}>{r.guest_name ?? ''}</td>
                      <td className={td}>{r.source ?? ''}</td>
                      <td className={`${td} text-right`}>{r.nights}</td>
                      <td className={td}>{r.tax_class === 'taxable' ? 'Taxable' : 'Non-taxable'}</td>
                      <td className={`${td} text-right`}>{money(num(r.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-navy/50">Click a rental row to see its bookings.</p>

          <h2 className="mt-10 text-lg font-semibold text-navy">What is left after channel costs and tax funds</h2>
          <p className="mt-1 text-[13px] text-navy/60">
            Uses the same dates, rentals and filters as above. Rates are percent of the room rate, except the payment fee, which is percent of the guest total. You can change them here.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 rounded-xl border border-line p-3">
            {([
              ['iva', 'Booking IVA'], ['state', 'State tax'], ['commission', 'Commission'], ['fee', 'Payment fee (of total)'],
              ['ivaRet', 'IVA retention'], ['isrRet', 'ISR retention'], ['airIva', 'Airbnb IVA kept'], ['airState', 'Airbnb state tax kept'],
            ] as [keyof typeof rates, string][]).map(([k, label]) => (
              <label key={k} className="text-[11px] text-navy/60">
                {label} %
                <input type="number" step="0.1" min="0" className={`${input} mt-1 block w-24`} value={rates[k]} onChange={(e) => setRate(k, e.target.value)} />
              </label>
            ))}
          </div>

          <h3 className="mt-6 text-[15px] font-semibold text-navy">Booking.com</h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Check-in</th>
                  <th className={th}>Guest</th>
                  <th className={th}>Rental</th>
                  <th className={`${th} text-right`}>Room rate</th>
                  <th className={`${th} text-right`}>Guest paid</th>
                  <th className={`${th} text-right`}>Commission</th>
                  <th className={`${th} text-right`}>Payment fee</th>
                  <th className={`${th} text-right`}>IVA ret.</th>
                  <th className={`${th} text-right`}>ISR ret.</th>
                  <th className={`${th} text-right`}>After Booking.com</th>
                  <th className={`${th} text-right`}>IVA fund</th>
                  <th className={`${th} text-right`}>State tax fund</th>
                  <th className={`${th} text-right`}>Left for us</th>
                </tr>
              </thead>
              <tbody>
                {channel.booking.map((b) => (
                  <tr key={b.r.reservation_id} className="border-b border-line/60">
                    <td className={td}>{day(b.r.arrival)}</td>
                    <td className={td}>{b.r.guest_name ?? ''}</td>
                    <td className={td}>{b.r.room_type ?? ''}</td>
                    <td className={`${td} text-right`}>{money(b.room)}</td>
                    <td className={`${td} text-right`}>{money(b.total)}</td>
                    <td className={`${td} text-right`}>{money(b.commission)}</td>
                    <td className={`${td} text-right`}>{money(b.fee)}</td>
                    <td className={`${td} text-right`}>{money(b.ivaRet)}</td>
                    <td className={`${td} text-right`}>{money(b.isrRet)}</td>
                    <td className={`${td} text-right`}>{money(b.received)}</td>
                    <td className={`${td} text-right`}>{money(b.ivaFund)}</td>
                    <td className={`${td} text-right`}>{money(b.stateFund)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(b.left)}</td>
                  </tr>
                ))}
                {channel.booking.length === 0 && (
                  <tr><td className={td} colSpan={13}>No Booking.com bookings in this selection.</td></tr>
                )}
                {channel.booking.length > 0 && (
                  <tr className="bg-white/5">
                    <td className={`${td} font-semibold`} colSpan={3}>Total ({channel.booking.length})</td>
                    {([
                      (b: (typeof channel.booking)[number]) => b.room, (b: (typeof channel.booking)[number]) => b.total,
                      (b: (typeof channel.booking)[number]) => b.commission, (b: (typeof channel.booking)[number]) => b.fee,
                      (b: (typeof channel.booking)[number]) => b.ivaRet, (b: (typeof channel.booking)[number]) => b.isrRet,
                      (b: (typeof channel.booking)[number]) => b.received, (b: (typeof channel.booking)[number]) => b.ivaFund,
                      (b: (typeof channel.booking)[number]) => b.stateFund, (b: (typeof channel.booking)[number]) => b.left,
                    ]).map((f, i) => (
                      <td key={i} className={`${td} text-right font-semibold`}>{money(channel.sum(channel.booking, f))}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 className="mt-6 text-[15px] font-semibold text-navy">Airbnb</h3>
          <p className="mt-1 text-[12px] text-navy/60">The reservation amount is what Airbnb pays after its fees and the 4% and 8% retentions, so only the tax funds are set aside.</p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Check-in</th>
                  <th className={th}>Guest</th>
                  <th className={th}>Rental</th>
                  <th className={`${th} text-right`}>Room rate</th>
                  <th className={`${th} text-right`}>Reservation amount</th>
                  <th className={`${th} text-right`}>IVA fund</th>
                  <th className={`${th} text-right`}>State tax fund</th>
                  <th className={`${th} text-right`}>Left for us</th>
                </tr>
              </thead>
              <tbody>
                {channel.airbnb.map((b) => (
                  <tr key={b.r.reservation_id} className="border-b border-line/60">
                    <td className={td}>{day(b.r.arrival)}</td>
                    <td className={td}>{b.r.guest_name ?? ''}</td>
                    <td className={td}>{b.r.room_type ?? ''}</td>
                    <td className={`${td} text-right`}>{money(b.room)}</td>
                    <td className={`${td} text-right`}>{money(b.total)}</td>
                    <td className={`${td} text-right`}>{money(b.ivaFund)}</td>
                    <td className={`${td} text-right`}>{money(b.stateFund)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(b.left)}</td>
                  </tr>
                ))}
                {channel.airbnb.length === 0 && (
                  <tr><td className={td} colSpan={8}>No Airbnb bookings in this selection.</td></tr>
                )}
                {channel.airbnb.length > 0 && (
                  <tr className="bg-white/5">
                    <td className={`${td} font-semibold`} colSpan={3}>Total ({channel.airbnb.length})</td>
                    {([
                      (b: (typeof channel.airbnb)[number]) => b.room, (b: (typeof channel.airbnb)[number]) => b.total,
                      (b: (typeof channel.airbnb)[number]) => b.ivaFund, (b: (typeof channel.airbnb)[number]) => b.stateFund,
                      (b: (typeof channel.airbnb)[number]) => b.left,
                    ]).map((f, i) => (
                      <td key={i} className={`${td} text-right font-semibold`}>{money(channel.sum(channel.airbnb, f))}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
