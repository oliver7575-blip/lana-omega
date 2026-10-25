'use client'

import { useState } from 'react'
import { cbApi, type ReservationRoomRef } from './shared'

interface DetailRoom {
  subReservationID: string
  reservationRoomID: string | null
  roomID: string | null
  roomTypeID: string
  roomTypeName: string
  roomName: string | null
}
interface AvailableRoom {
  id: string
  name: string
}

/** A room number badge that opens a menu of other free rooms of the same type to move the reservation into. */
export default function RoomCell({ reservationID, room, onChanged }: {
  reservationID: string
  room: ReservationRoomRef
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<AvailableRoom[] | null>(null)
  const [target, setTarget] = useState<DetailRoom | null>(null)
  const [busy, setBusy] = useState(false)

  async function openPicker() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setOptions(null)
    try {
      const detail = await cbApi<{ reservation: { rooms: DetailRoom[] } }>(`/api/cloudbeds/reservation/${reservationID}`)
      const match =
        (room.roomID && detail.reservation.rooms.find((r) => r.roomID === room.roomID)) ||
        detail.reservation.rooms.find((r) => r.roomTypeID === room.roomTypeID)
      if (!match) throw new Error("Couldn't find this room on the reservation.")
      setTarget(match)
      const avail = await cbApi<{ rooms: AvailableRoom[] }>(
        `/api/cloudbeds/reservation/${reservationID}/available-rooms?roomTypeID=${encodeURIComponent(match.roomTypeID)}`
      )
      setOptions(avail.rooms)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load available rooms')
    }
    setLoading(false)
  }

  async function pick(newRoomID: string) {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await cbApi(`/api/cloudbeds/reservation/${reservationID}`, 'POST', {
        action: 'assign_room',
        subReservationID: target.subReservationID,
        reservationRoomID: target.reservationRoomID ?? '',
        newRoomID,
      })
      setOpen(false)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the room')
    }
    setBusy(false)
  }

  return (
    <span className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`rounded border px-1.5 py-0.5 text-xs transition hover:bg-white/[0.06] ${
          room.roomName ? 'border-line text-clay' : 'border-dashed border-line text-navy/40'
        }`}
      >
        {room.roomName ?? 'Unassigned'}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-44 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 shadow-xl">
            {loading && <p className="px-2 py-1 text-xs text-navy/50">Loading…</p>}
            {error && <p className="px-2 py-1 text-xs text-red-300">{error}</p>}
            {options?.length === 0 && <p className="px-2 py-1 text-xs text-navy/50">No other rooms free for these dates</p>}
            {options?.map((o) => (
              <button
                key={o.id}
                disabled={busy}
                onClick={() => pick(o.id)}
                className="block w-full rounded px-2 py-1 text-left text-xs text-navy hover:bg-white/[0.08] disabled:opacity-50"
              >
                {o.name}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}
