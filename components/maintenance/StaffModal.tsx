'use client'

import { useState } from 'react'
import Modal from './Modal'
import { api, inputCls, labelCls, type Staff } from './shared'

const DAYS: { label: string; value: number }[] = [
  { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 }, { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 }, { label: 'Sun', value: 0 },
]

interface Form {
  name: string
  phone: string
  language: string
  specialties: string
  quiet_hours_start: string
  quiet_hours_end: string
  weekly_days_off: number[]
  unavailable_from: string
  unavailable_until: string
  active: boolean
}

const EMPTY: Form = {
  name: '', phone: '+52', language: 'es', specialties: '', quiet_hours_start: '21:00', quiet_hours_end: '07:00',
  weekly_days_off: [], unavailable_from: '', unavailable_until: '', active: true,
}

function toForm(s: Staff): Form {
  return {
    name: s.name, phone: `+${s.phone}`, language: s.language ?? 'es', specialties: (s.specialties ?? []).join(', '),
    quiet_hours_start: (s.quiet_hours_start ?? '21:00').slice(0, 5), quiet_hours_end: (s.quiet_hours_end ?? '07:00').slice(0, 5),
    weekly_days_off: s.weekly_days_off ?? [], unavailable_from: s.unavailable_from ?? '', unavailable_until: s.unavailable_until ?? '',
    active: s.active,
  }
}

export default function StaffModal({ staff, timezone, onClose, onChanged }: {
  staff: Staff[]
  timezone: string
  onClose: () => void
  onChanged: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date())
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body = { ...form, unavailable_from: form.unavailable_from || null, unavailable_until: form.unavailable_until || null }
      if (editingId) await api(`/api/maintenance/staff/${editingId}`, 'PATCH', body)
      else await api('/api/maintenance/staff', 'POST', body)
      setEditingId(null)
      setForm(EMPTY)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    }
    setSaving(false)
  }

  async function toggle(s: Staff) {
    await api(`/api/maintenance/staff/${s.id}`, 'PATCH', { active: !s.active })
    onChanged()
  }

  async function remove(s: Staff) {
    if (!confirm(`Remove ${s.name}? Their open tasks go back to the staff pool.`)) return
    await api(`/api/maintenance/staff/${s.id}`, 'DELETE')
    onChanged()
  }

  return (
    <Modal
      title={editingId ? 'Edit maintenance staff' : 'Add maintenance staff'}
      subtitle="Register the number used for assigned maintenance reminders."
      onClose={onClose}
      footer={
        <>
          <button onClick={editingId ? () => { setEditingId(null); setForm(EMPTY) } : onClose} className="text-sm text-navy/70 hover:text-navy">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-clay px-5 py-2 text-sm font-semibold text-white hover:bg-clay/90 disabled:opacity-60">
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add staff member'}
          </button>
        </>
      }
    >
      <div className="mb-5 space-y-2">
        {staff.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-paper/40 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{s.name}</p>
              <p className="text-xs text-navy/55">+{s.phone}</p>
            </div>
            <button onClick={() => toggle(s)} aria-label="Available" className={`relative h-6 w-11 rounded-full transition ${s.active ? 'bg-[#35b876]' : 'bg-slate-600'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${s.active ? 'translate-x-[22px]' : 'translate-x-0.5'} left-0`} />
            </button>
            <button onClick={() => { setEditingId(s.id); setForm(toForm(s)) }} className="text-sm text-navy/70 hover:text-navy">Edit</button>
            <button onClick={() => remove(s)} className="text-sm text-red-300 hover:text-red-200">Remove</button>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <div>
          <label className={labelCls}>Full name *</label>
          <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>WhatsApp number *</label>
          <input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Language</label>
            <select className={inputCls} value={form.language} onChange={(e) => set('language', e.target.value)}>
              <option value="es">Spanish</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Specialties</label>
            <input className={inputCls} placeholder="Electrical, pool" value={form.specialties} onChange={(e) => set('specialties', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Quiet hours start (hotel time — now {now})</label>
            <input type="time" className={inputCls} value={form.quiet_hours_start} onChange={(e) => set('quiet_hours_start', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Quiet hours end</label>
            <input type="time" className={inputCls} value={form.quiet_hours_end} onChange={(e) => set('quiet_hours_end', e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-navy/50">Non-urgent reminders pause during these hours. Urgent tasks send regardless.</p>

        <div>
          <label className={labelCls}>Weekly days off</label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = form.weekly_days_off.includes(d.value)
              return (
                <button
                  key={d.value}
                  onClick={() => set('weekly_days_off', on ? form.weekly_days_off.filter((x) => x !== d.value) : [...form.weekly_days_off, d.value])}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-clay bg-clay/15 text-clay' : 'border-line text-navy/70 hover:border-navy/30'}`}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-navy/50">
            Standing weekly days off (e.g. every Tuesday). Reminders skip these days entirely and resume the next available day, urgent included.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Days off from (hotel dates)</label>
            <input type="date" className={inputCls} value={form.unavailable_from} onChange={(e) => set('unavailable_from', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Days off until</label>
            <input type="date" className={inputCls} value={form.unavailable_until} onChange={(e) => set('unavailable_until', e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-navy/50">
          All reminders (including urgent) pause for this range and resume automatically the next morning. Leave blank if none scheduled.
        </p>

        <label className="flex items-center gap-2.5 text-sm text-navy/85">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="h-4 w-4 accent-clay" />
          Available for new tasks and reminders
        </label>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  )
}
