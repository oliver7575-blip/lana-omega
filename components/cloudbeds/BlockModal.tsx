'use client'

import { useState } from 'react'
import { cbApi } from './shared'

export interface BlockInfo {
  roomBlockID: string
  type: string
  roomID: string
  start: string
  end: string // last blocked night (inclusive)
  reason: string
}

function addDays(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** A block / out-of-service period: remove it, or swap it for a reservation on the same room and dates. */
export default function BlockModal({ block, roomName, roomTypeName, otherRooms, onClose, onRemoved }: {
  block: BlockInfo
  roomName: string
  roomTypeName: string
  /** Other rooms that share this block in Cloudbeds (removing it frees them too). */
  otherRooms: string[]
  onClose: () => void
  onRemoved: () => void
}) {
  const [confirm, setConfirm] = useState<'remove' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const service = block.type === 'out_of_service' || /service|servicio|mainten|repair|mantenim|reparaci/i.test(block.reason)
  const free = addDays(block.end, 1)
  const nights = Math.round((Date.parse(`${free}T12:00:00Z`) - Date.parse(`${block.start}T12:00:00Z`)) / 86400000)

  async function remove(then: () => void) {
    setBusy(true)
    setError(null)
    try {
      await cbApi(`/api/cloudbeds/blocks/${block.roomBlockID}`, 'DELETE')
      then()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the block')
      setBusy(false)
    }
  }

  const row = 'flex justify-between gap-4 border-b border-gray-100 py-2 text-sm last:border-0'
  const pill = service
    ? { bg: '#fde7c2', border: '#efc47a', text: '#7a4a05' }
    : { bg: '#e3e6ec', border: '#c5cad4', text: '#4a5262' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14213d]/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white text-[#14213d] shadow-[0_24px_64px_rgba(20,33,61,.28)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <p className="text-xl font-bold tracking-tight">{roomName}</p>
              <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: pill.bg, borderColor: pill.border, color: pill.text }}>
                {service ? 'Out of service' : 'Blocked'}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] text-gray-500">{roomTypeName}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-lg leading-none text-gray-600 hover:bg-gray-50" aria-label="Close">×</button>
        </div>

        <div className="px-6 py-4">
          <div className={row}><span className="text-gray-500">From</span><span className="font-medium">{nice(block.start)}</span></div>
          <div className={row}><span className="text-gray-500">Free again from</span><span className="font-medium">{nice(free)}</span></div>
          <div className={row}><span className="text-gray-500">Nights</span><span className="font-medium">{nights}</span></div>
          <div className={row}><span className="text-gray-500">Reason</span><span className="font-medium">{block.reason || '—'}</span></div>
          {otherRooms.length > 0 && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              This block also covers {otherRooms.join(', ')}. In Cloudbeds they share one block, so removing it frees them all.
            </p>
          )}
          {!block.roomBlockID && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">Cloudbeds didn&apos;t give this block an id, so it can only be removed in Cloudbeds.</p>}
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</p>}

          {confirm === 'remove' && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-800">Remove this block?</p>
              <p className="mt-1 text-sm text-red-900">{roomName} becomes bookable again for these dates.</p>
              <div className="mt-3 flex gap-2">
                <button disabled={busy} onClick={() => remove(onRemoved)} className="h-9 rounded-[10px] bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{busy ? 'Removing…' : 'Yes, remove block'}</button>
                <button disabled={busy} onClick={() => setConfirm(null)} className="h-9 rounded-[10px] border border-gray-300 bg-white px-4 text-sm font-semibold hover:bg-gray-50">Keep it</button>
              </div>
            </div>
          )}
          {!confirm && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button disabled={!block.roomBlockID} onClick={() => setConfirm('remove')} className="h-9 rounded-[10px] border border-red-300 px-4 text-[13px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">Remove block</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
