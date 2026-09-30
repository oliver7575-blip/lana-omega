/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]))
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: weekdays[p.weekday as string] ?? 0,
  }
}

/** The instant when the wall clock in `tz` reads the given local time. */
export function fromZoned(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  // Start from the naive UTC guess and correct by the zone's offset (twice, for DST edges).
  let guess = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += Date.UTC(year, month - 1, day, hour, minute) - asUtc
  }
  return new Date(guess)
}

/** "YYYY-MM-DD" of an instant in a timezone. */
export function localDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Same local wall time, `days` calendar days later. */
export function addLocalDays(date: Date, days: number, tz: string): Date {
  const p = zonedParts(date, tz)
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return fromZoned(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), p.hour, p.minute, tz)
}

/** Same local wall time, `months` later (clamped to the month's last day). */
export function addLocalMonths(date: Date, months: number, tz: string): Date {
  const p = zonedParts(date, tz)
  const target = new Date(Date.UTC(p.year, p.month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return fromZoned(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(p.day, lastDay), p.hour, p.minute, tz)
}

/** Minutes since local midnight for "HH:MM". */
export function hhmmToMinutes(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
