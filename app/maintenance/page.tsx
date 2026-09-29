'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import MaintenanceTemplateCard from '@/components/MaintenanceTemplateCard'

interface StaffMember {
  id: string
  name: string
  phone: string
  active: boolean
}

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  due_date: string | null
  assigned_to: string | null
  assigned_to_name: string | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  open: '#fef3c7',
  in_progress: '#dbeafe',
  done: '#d1fae5',
}

export default function MaintenancePage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const [staffName, setStaffName] = useState('')
  const [staffPhone, setStaffPhone] = useState('')
  const [addingStaff, setAddingStaff] = useState(false)

  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [taskAssignee, setTaskAssignee] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  async function loadAll() {
    const [staffRes, tasksRes] = await Promise.all([
      fetch('/api/maintenance/staff'),
      fetch('/api/maintenance/tasks'),
    ])
    const staffJson = await staffRes.json()
    const tasksJson = await tasksRes.json()
    setStaff(staffJson.staff ?? [])
    setTasks(tasksJson.tasks ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault()
    if (!staffName.trim() || !staffPhone.trim()) return
    setAddingStaff(true)
    await fetch('/api/maintenance/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: staffName, phone: staffPhone }),
    })
    setStaffName('')
    setStaffPhone('')
    setAddingStaff(false)
    loadAll()
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    if (!taskTitle.trim()) return
    setAddingTask(true)
    await fetch('/api/maintenance/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: taskTitle,
        description: taskDescription,
        due_date: taskDueDate || undefined,
        assigned_to: taskAssignee || undefined,
      }),
    })
    setTaskTitle('')
    setTaskDescription('')
    setTaskDueDate('')
    setTaskAssignee('')
    setAddingTask(false)
    loadAll()
  }

  async function handleUpdateStatus(taskId: string, status: string) {
    await fetch('/api/maintenance/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, status }),
    })
    loadAll()
  }

  async function handleReassign(taskId: string, assignedTo: string) {
    await fetch('/api/maintenance/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, assigned_to: assignedTo || null }),
    })
    loadAll()
  }

  if (loading) {
    return <main style={{ maxWidth: 800, margin: '80px auto' }}>Loading...</main>
  }

  return (
    <main style={{ maxWidth: 800, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      <h1>Maintenance</h1>

      <MaintenanceTemplateCard />

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Staff roster</h2>
        <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
          Maintenance staff don't need a login — just a name and phone number so tasks can be
          assigned to them.
        </p>

        {staff.length === 0 && <p style={{ color: '#888' }}>No staff on the roster yet.</p>}
        {staff.map((s) => (
          <div key={s.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            {s.name} — {s.phone}
          </div>
        ))}

        <form onSubmit={handleAddStaff} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            placeholder="Name"
            style={{ flex: 1, padding: 8 }}
          />
          <input
            value={staffPhone}
            onChange={(e) => setStaffPhone(e.target.value)}
            placeholder="+52 ..."
            style={{ flex: 1, padding: 8 }}
          />
          <button type="submit" disabled={addingStaff}>
            {addingStaff ? 'Adding...' : 'Add'}
          </button>
        </form>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>New task</h2>
        <form onSubmit={handleAddTask}>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Title, e.g. Fix AC in Room 5"
            style={{ width: '100%', padding: 8, marginBottom: 8 }}
          />
          <textarea
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder="Details (optional)"
            rows={2}
            style={{ width: '100%', padding: 8, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="date"
              value={taskDueDate}
              onChange={(e) => setTaskDueDate(e.target.value)}
              style={{ flex: 1, padding: 8 }}
            />
            <select
              value={taskAssignee}
              onChange={(e) => setTaskAssignee(e.target.value)}
              style={{ flex: 1, padding: 8 }}
            >
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={addingTask}>
            {addingTask ? 'Creating...' : 'Create task'}
          </button>
        </form>
      </div>

      <h2 style={{ fontSize: 18 }}>Tasks</h2>
      {tasks.length === 0 && <p style={{ color: '#888' }}>No tasks yet.</p>}
      {tasks.map((t) => (
        <div key={t.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong>{t.title}</strong>
              {t.due_date && (
                <span style={{ color: '#888', fontSize: 13 }}> — due {t.due_date}</span>
              )}
            </div>
            <span
              style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 4,
                background: STATUS_COLORS[t.status] ?? '#e5e7eb',
              }}
            >
              {t.status}
            </span>
          </div>
          {t.description && <p style={{ fontSize: 14, margin: '8px 0' }}>{t.description}</p>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <select
              value={t.status}
              onChange={(e) => handleUpdateStatus(t.id, e.target.value)}
              style={{ padding: 4 }}
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
            <select
              value={t.assigned_to ?? ''}
              onChange={(e) => handleReassign(t.id, e.target.value)}
              style={{ padding: 4 }}
            >
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </main>
  )
}
