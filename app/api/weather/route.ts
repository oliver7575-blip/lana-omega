import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Zipolite, Oaxaca. Open-Meteo is free and keyless; results are cached for 30 minutes.
const URL_ =
  'https://api.open-meteo.com/v1/forecast?latitude=15.666&longitude=-96.517' +
  '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
  '&timezone=America%2FMexico_City&forecast_days=6'

export interface WeatherDay { date: string; code: number; max: number; min: number; rain: number }
export interface WeatherData { now: { temp: number; code: number }; days: WeatherDay[] }

let cache: { at: number; data: WeatherData } | null = null

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return NextResponse.json(cache.data)
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`Weather service said ${res.status}: ${(await res.text()).slice(0, 120)}`)
    const j = await res.json()
    const d = j.daily
    const days: WeatherDay[] = (d.time as string[]).map((date, i) => ({
      date,
      code: Number(d.weather_code[i]),
      max: Number(d.temperature_2m_max[i]),
      min: Number(d.temperature_2m_min[i]),
      rain: Number(d.precipitation_probability_max[i] ?? 0),
    }))
    const out: WeatherData = { now: { temp: Number(j.current.temperature_2m), code: Number(j.current.weather_code) }, days }
    cache = { at: Date.now(), data: out }
    return NextResponse.json(out)
  } catch (e) {
    console.error('weather failed', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Weather unavailable' }, { status: 502 })
  }
}
