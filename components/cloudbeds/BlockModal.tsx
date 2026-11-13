'use client'

import { useState } from 'react'
import { cbApi } from './shared'
import { ModalShell, btnLg, priRed, btn } from './ui'

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

  const row = 'flex justify-between gap-4 border-b border-[#eef0f4] py-2 text-sm last:border-0'

  return (
    <ModalShell tone="slate" title={roomName} subtitle={<>{roomTypeName} · <span className="font-semibold">{service ? 'Out of service' : 'Blocked'}</span></>} onClose={onClose} widthClass="max-w-md">
      <div>
        <div className={row}><span className="text-gray-500">From</span><span className="font-medium">{nice(block.start)}</span></div>
        <div className={row}><span className="text-gray-500">Free again from</span><span className="font-medium">{nice(free)}</span></div>
        <div className={row}><span className="text-gray-500">Nights</span><span className="font-medium">{nights}</span></div>
        <div className={row}><span className="text-gray-500">Reason</span><span className="font-medium">{block.reason || '—'}</span></div>
      </div>
      {otherRooms.length > 0 && (
        <p className="rounded-xl border border-[#f4e3a8] bg-[#fff9e8] px-3 py-2 text-[12.5px] text-[#6b4a0a]">
          This block also covers {otherRooms.join(', ')}. In Cloudbeds they share one block, so removing it frees them all.
        </p>
      )}
      {!block.roomBlockID && <p className="rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">Cloudbeds didn&apos;t give this block an id, so it can only be removed in Cloudbeds.</p>}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</p>}

      {confirm === 'remove' && (
        <div className="rounded-2xl border border-[#f1c9c4] bg-[#fff4f2] p-3.5">
          <p className="text-sm font-bold text-[#8a2a22]">Remove this block?</p>
          <p className="mt-1 text-sm text-[#8a2a22]">{roomName} becomes bookable again for these dates.</p>
          <div className="mt-3 flex justify-end gap-2.5">
            <button disabled={busy} onClick={() => setConfirm(null)} className={btnLg}>Keep it</button>
            <button disabled={busy} onClick={() => remove(onRemoved)} className={priRed}>{busy ? 'Removing…' : 'Yes, remove block'}</button>
          </div>
        </div>
      )}
      {!confirm && (
        <div className="flex flex-wrap justify-end gap-2">
          <button disabled={!block.roomBlockID} onClick={() => setConfirm('remove')} className={`${btn} !border-[#f3cfcb] !text-[#b42318]`}>Remove block</button>
        </div>
      )}
    </ModalShell>
  )
}
