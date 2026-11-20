'use client'

import { useEffect, useState } from 'react'

/** Local time at the property (24-hour HH:MM), ticking along next to the page title. */
export default function PropertyClock({ tz = 'America/Mexico_City', className = '' }: { tz?: string; className?: string }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const tick = () => setText(fmt.format(new Date()))
    tick()
    const t = setInterval(tick, 10_000)
    return () => clearInterval(t)
  }, [tz])
  if (!text) return null
  return (
    <span title="Local time at the property" className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-[#c9d6f0] ${className}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      {text}
    </span>
  )
}
