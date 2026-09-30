export interface DashRow {
  reservationID: string
  guestName: string
  room: string
  arrivalTime: string | null
  status: string
  startDate: string
  endDate: string
}

export const statusLabel = (s: string) => s.replace(/_/g, ' ')

/** Colours used by Beta's Cloudbeds pages. */
export function statusColor(status: string) {
  switch (status) {
    case 'checked_in':
      return { bar: '#6ab77a', head: '#6ab77a' }
    case 'checked_out':
      return { bar: '#b8c1cc', head: '#94a3b8' }
    case 'not_confirmed':
      return { bar: '#f3c46b', head: '#e8b04b' }
    default:
      return { bar: '#7fc0e4', head: '#76b9df' }
  }
}

export const mxn = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `MX$${Math.round(n).toLocaleString('en-US')}`

export async function cbApi<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`)
  return json as T
}

/** "28/09/2026" for a YYYY-MM-DD date. */
export const dmy = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')
