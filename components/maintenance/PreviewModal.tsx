'use client'

import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api, fmtDateTime } from './shared'

interface Item { id: string; scheduled_for: string; task_code: string; title: string; priority: string; staff: string; preview: string }

export default function PreviewModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [tz, setTz] = useState('America/Mexico_City')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<{ reminders: Item[]; timezone: string }>('/api/maintenance/preview')
      .then((r) => { setItems(r.reminders); setTz(r.timezone) })
      .catch((e) => setError(e.message))
  }, [])
  return (
    <Modal title="Preview reminders" subtitle="WhatsApp reminders scheduled for the next 24 hours." onClose={onClose}>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {!items && !error && <p className="text-sm text-navy/50">Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-navy/50">Nothing scheduled in the next 24 hours.</p>}
      <div className="space-y-2">
        {items?.map((r) => (
          <div key={r.id} className="rounded-xl border border-line bg-paper/40 px-4 py-3">
            <div className="flex justify-between text-xs text-navy/55">
              <span>{fmtDateTime(r.scheduled_for, tz)} · {r.staff}</span>
              {r.priority === 'urgent' && <span className="text-red-300">🚨 Urgent</span>}
            </div>
            <p className="mt-1 text-sm text-white">{r.preview}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-navy/45">
        Times can shift: reminders wait for quiet hours and days off, and are spaced out so nobody gets two at once.
      </p>
    </Modal>
  )
}
