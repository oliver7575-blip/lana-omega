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

type Rates = { iva: number; state: number; commission: number; fee: number; ivaRet: number; isrRet: number; airIva: number; airState: number }

/** One booking's money split. Booking.com and Airbnb follow the channel rules; other bookings owe the taxes charged on them. */
function calcFor(r: Row, rates: Rates) {
  const pc = (n: number) => n / 100
  const isAirbnb = /airbnb/i.test(r.source ?? '')
  const isBooking = /booking/i.test(r.source ?? '')
  const ota = isAirbnb || isBooking
  const room = num(r.stay_subtotal)
  const total = num(r.total)
  const charged = num(r.taxes) + num(r.vat)
  const taxes = ota ? room * pc(rates.iva + rates.state) : charged
  const taxesPaid = ota ? room * pc(rates.ivaRet + rates.isrRet) : 0
  const taxesOwed = isAirbnb ? room * pc(rates.airIva + rates.airState) : isBooking ? room * pc(rates.iva - rates.ivaRet + rates.state) : charged
  const commission = isBooking ? room * pc(rates.commission) : 0
  const fee = isBooking ? total * pc(rates.fee) : 0
  const subtotal = total - taxesOwed
  const left = isBooking ? total - taxesPaid - commission - fee - taxesOwed : subtotal
  return { isAirbnb, isBooking, ota, total, taxes, taxesPaid, taxesOwed, commission, fee, subtotal, left }
}

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
  const [rates, setRates] = useState<Rates>({ iva: 16, state: 3, commission: 15, fee: 4, ivaRet: 8, isrRet: 4, airIva: 8, airState: 3 })
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
      const c = mine.map((r) => calcFor(r, rates))
      const add = (f: (x: ReturnType<typeof calcFor>) => number) => c.reduce((s, x) => s + f(x), 0)
      return {
        room,
        bookings: mine.length,
        nights: mine.reduce((s, r) => s + num(r.nights), 0),
        pretax: mine.filter((r) => r.tax_class === 'taxable').reduce((s, r) => s + num(r.total) - num(r.taxes) - num(r.vat), 0),
        nonTaxable: mine.filter((r) => r.tax_class === 'non_taxable').reduce((s, r) => s + num(r.total), 0),
        subtotal: add((x) => x.subtotal),
        total: add((x) => x.total),
        taxes: add((x) => x.taxes),
        taxesPaid: add((x) => x.taxesPaid),
        commission: add((x) => x.commission),
        fee: add((x) => x.fee),
        left: add((x) => x.left),
      }
    })
  }, [rooms, inRange, showTaxable, showNon, rates])

  const totals = useMemo(() => {
    const on = perRoom.filter((p) => !off.has(p.room))
    const sum = (k: 'bookings' | 'nights' | 'pretax' | 'nonTaxable' | 'subtotal' | 'total' | 'taxes' | 'taxesPaid' | 'commission' | 'fee' | 'left') => on.reduce((s, p) => s + p[k], 0)
    return {
      bookings: sum('bookings'), nights: sum('nights'), pretax: sum('pretax'), nonTaxable: sum('nonTaxable'), subtotal: sum('subtotal'),
      total: sum('total'), taxes: sum('taxes'), taxesPaid: sum('taxesPaid'), commission: sum('commission'), fee: sum('fee'), left: sum('left'),
    }
  }, [perRoom, off])

  const channel = useMemo(() => {
    const rows = selected
      .filter((r) => /booking|airbnb/i.test(r.source ?? ''))
      .map((r) => {
        const c = calcFor(r, rates)
        return { r, source: c.isAirbnb ? 'Airbnb' : 'Booking.com', ...c }
      })
    const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((s, x) => s + f(x), 0)
    return { rows, sum }
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
            <table className="w-full min-w-[960px] border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Rental</th>
                  <th className={`${th} text-right`}>Bookings</th>
                  <th className={`${th} text-right`}>Nights</th>
                  <th className={`${th} text-right`}>Subtotal</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Taxes</th>
                  <th className={`${th} text-right`}>Taxes paid</th>
                  <th className={`${th} text-right`}>Commission</th>
                  <th className={`${th} text-right`}>Payment fee</th>
                  <th className={`${th} text-right`}>Left for us</th>
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
                      <td className={`${td} text-right`}>{money(p.subtotal)}</td>
                      <td className={`${td} text-right font-semibold`}>{money(p.total)}</td>
                      <td className={`${td} text-right`}>{money(p.taxes)}</td>
                      <td className={`${td} text-right`}>{money(p.taxesPaid)}</td>
                      <td className={`${td} text-right`}>{money(p.commission)}</td>
                      <td className={`${td} text-right`}>{money(p.fee)}</td>
                      <td className={`${td} text-right font-semibold`}>{money(p.left)}</td>
                    </tr>
                  )
                })}
                <tr className="bg-white/5">
                  <td className={`${td} font-semibold`}>Total</td>
                  <td className={`${td} text-right font-semibold`}>{totals.bookings}</td>
                  <td className={`${td} text-right font-semibold`}>{totals.nights}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.subtotal)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.total)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.taxes)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.taxesPaid)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.commission)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.fee)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(totals.left)}</td>
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
          <p className="mt-3 text-[11px] text-navy/50">Click a rental row to see its bookings. Total includes the taxes still owed; Subtotal is Total minus those taxes. Rates are set in the box under the channel breakdown.</p>

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

          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Taxes</th>
                  <th className={`${th} text-right`}>Taxes paid</th>
                  <th className={`${th} text-right`}>Taxes owed</th>
                  <th className={`${th} text-right`}>Commission</th>
                  <th className={`${th} text-right`}>Payment fee</th>
                  <th className={`${th} text-right`}>Left for us</th>
                  <th className={th}>Source</th>
                  <th className={`${th} text-right`}>Nights</th>
                  <th className={th}>Check-in</th>
                  <th className={th}>Guest</th>
                  <th className={th}>Rental</th>
                </tr>
              </thead>
              <tbody>
                {channel.rows.map((b) => (
                  <tr key={b.r.reservation_id} className="border-b border-line/60">
                    <td className={`${td} text-right font-semibold`}>{money(b.total)}</td>
                    <td className={`${td} text-right`}>{money(b.taxes)}</td>
                    <td className={`${td} text-right`}>{money(b.taxesPaid)}</td>
                    <td className={`${td} text-right`}>{money(b.taxesOwed)}</td>
                    <td className={`${td} text-right`}>{b.source === 'Airbnb' ? '—' : money(b.commission)}</td>
                    <td className={`${td} text-right`}>{b.source === 'Airbnb' ? '—' : money(b.fee)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(b.left)}</td>
                    <td className={td}>{b.source}</td>
                    <td className={`${td} text-right`}>{b.r.nights}</td>
                    <td className={td}>{day(b.r.arrival)}</td>
                    <td className={td}>{b.r.guest_name ?? ''}</td>
                    <td className={td}>{b.r.room_type ?? ''}</td>
                  </tr>
                ))}
                {channel.rows.length === 0 && (
                  <tr><td className={td} colSpan={12}>No Booking.com or Airbnb bookings in this selection.</td></tr>
                )}
                {channel.rows.length > 0 && (
                  <tr className="bg-white/5">
                    <td className={`${td} text-right font-semibold`}>{money(channel.sum((b) => b.total))}</td>
                    <td className={`${td} text-right font-semibold`}>{money(channel.sum((b) => b.taxes))}</td>
                    <td className={`${td} text-right font-semibold`}>{money(channel.sum((b) => b.taxesPaid))}</td>
                    <td className={`${td} text-right font-semibold`}>{money(channel.sum((b) => b.taxesOwed))}</td>
                    <td className={`${td} text-right font-semibold`}>{money(channel.sum((b) => b.commission))}</td>
                    <td className={`${td} text-right font-semibold`}>{money(channel.sum((b) => b.fee))}</td>
                    <td className={`${td} text-right font-semibold`}>{money(channel.sum((b) => b.left))}</td>
                    <td className={`${td} font-semibold`}>Total ({channel.rows.length})</td>
                    <td className={`${td} text-right font-semibold`}>{channel.sum((b) => num(b.r.nights))}</td>
                    <td className={td} colSpan={3} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-navy/50">
            Taxes = IVA 16% + state tax 3% on the room rate. Taxes paid = IVA 8% + ISR 4% retained. Taxes owed = what is still ours to pay (IVA 8% + state tax 3%). Commission is on the room rate; payment fee is on the guest total. For Airbnb the total is already after its retentions and fees, so Taxes paid is shown for reference and is not taken off again; its own fees are not visible, so Commission and Payment fee are blank.
          </p>
        </>
      )}
    </div>
  )
}
