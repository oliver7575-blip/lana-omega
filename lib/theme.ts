'use client'
import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const EVENT = 'soiree-theme'

export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

/** Switches the whole panel and remembers the choice here and on the staff member's account. */
export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem('theme', theme) } catch {}
  window.dispatchEvent(new Event(EVENT))
  fetch('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'theme', value: theme }) }).catch(() => {})
}

/** Picks up the account's saved theme (so it follows them to another device). */
export async function syncThemeFromAccount() {
  try {
    const r = await fetch('/api/preferences')
    if (!r.ok) return
    const j = await r.json()
    const t = j.preferences?.theme
    if ((t === 'light' || t === 'dark') && t !== getTheme()) {
      document.documentElement.dataset.theme = t
      try { localStorage.setItem('theme', t) } catch {}
      window.dispatchEvent(new Event(EVENT))
    }
  } catch {}
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb) },
    getTheme,
    () => 'dark' as Theme
  )
}

// Status / accent colours are bright on the dark blue; on the off-white they need a deeper shade to stay readable.
const DEEPER: Record<string, string> = {
  '#3ccf8a': '#178a63', '#f0b548': '#b4750f', '#a58cff': '#6a4fd0', '#5b95f5': '#2f62c9', '#7fd6ff': '#1b7fb5',
  '#ff6b75': '#c6313c', '#8793a6': '#5f6b7e', '#5fa386': '#2f7d5f', '#d6a950': '#9a7218', '#5f84c4': '#3a62a8', '#7e8a9f': '#5f6b7e',
}
/** The colour as it should be drawn in the current theme. */
export function tone(color: string, theme: Theme): string {
  return theme === 'light' ? DEEPER[color.toLowerCase()] ?? color : color
}
