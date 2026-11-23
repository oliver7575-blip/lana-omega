'use client'
import { useEffect, useState } from 'react'
import type { WeatherData } from '@/app/api/weather/route'

const LINE = 'border-[#8fb4ff]/25'

function describe(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: '☀️', text: 'Sunny' }
  if (code === 1) return { icon: '🌤️', text: 'Mostly sunny' }
  if (code === 2) return { icon: '⛅', text: 'Partly cloudy' }
  if (code === 3) return { icon: '☁️', text: 'Cloudy' }
  if (code === 45 || code === 48) return { icon: '🌫️', text: 'Fog' }
  if (code >= 51 && code <= 57) return { icon: '🌦️', text: 'Drizzle' }
  if (code >= 61 && code <= 67) return { icon: '🌧️', text: 'Rain' }
  if (code >= 80 && code <= 82) return { icon: '🌦️', text: 'Showers' }
  if (code >= 95) return { icon: '⛈️', text: 'Thunderstorm' }
  return { icon: '🌤️', text: 'Fair' }
}

const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

/** Current weather and the next five days for Zipolite. */
export default function WeatherCard() {
  const [w, setW] = useState<WeatherData | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/weather').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { if (alive) { setW(j); setErr(false) } }).catch(() => { if (alive) setErr(true) })
    load()
    const t = setInterval(load, 30 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const shell = `rounded-2xl border ${LINE} p-4`
  const bg = { background: 'rgba(22,40,92,.5)' }
  if (!w) return <div className={shell} style={bg}><p className="py-3 text-center text-[12.5px] text-[#9fb3dc]">{err ? 'Weather unavailable right now' : 'Loading weather…'}</p></div>

  const now = describe(w.now.code)
  const today = w.days[0]
  const next = w.days.slice(1, 6)
  return (
    <div className={`${shell} flex flex-col gap-4 md:flex-row md:items-center md:gap-6`} style={bg}>
      <div className="md:min-w-[190px]">
        <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#9fb3dc]">Zipolite · now</p>
        <div className="flex items-center gap-3">
          <span className="text-[44px] leading-none">{now.icon}</span>
          <span className="text-[44px] font-bold leading-none tracking-tight text-white">{Math.round(w.now.temp)}°</span>
        </div>
        <p className="mt-1 text-[12.5px] text-[#9fb3dc]">{now.text}{today ? ` · Today ${Math.round(today.max)}° / ${Math.round(today.min)}°` : ''}</p>
      </div>
      <div className="grid flex-1 grid-cols-5 gap-2">
        {next.map((d) => {
          const x = describe(d.code)
          return (
            <div key={d.date} className="rounded-xl bg-white/[0.05] px-1 py-2.5 text-center">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#9fb3dc]">{dayName(d.date)}</p>
              <p className="my-1 text-[22px] leading-none" title={x.text}>{x.icon}</p>
              <p className="text-[13px]"><b>{Math.round(d.max)}°</b> <span className="text-[#7b8aa8]">{Math.round(d.min)}°</span></p>
              <p className="mt-1 text-[10.5px] text-[#8fb4ff]">💧 {Math.round(d.rain)}%</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
