'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AlertIcon,
  HammerIcon,
  ListIcon,
  MailIcon,
  MenuIcon,
  SettingsIcon,
  ShareIcon,
  TemplateIcon,
  UsersIcon,
} from './Icons'

// Pages shown without the sidebar.
const BARE = ['/login', '/signup', '/forgot-password', '/reset-password', '/resend-confirmation', '/widget-test']
// Older pages not yet rebuilt in the dark design: shown in a white panel,
// the way Beta shows its Cloudbeds pages.
const LIGHT_PANEL = ['/settings', '/staff', '/waitlist', '/integrations', '/automations', '/maintenance']

interface ShellInfo {
  email: string
  tenantName: string
  unreadReservations: number
  newEscalations: number
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [info, setInfo] = useState<ShellInfo | null>(null)
  const [open, setOpen] = useState(false)

  const bare = BARE.some((p) => pathname.startsWith(p))

  useEffect(() => {
    if (bare) return
    let stop = false
    const load = async () => {
      try {
        const res = await fetch('/api/shell', { cache: 'no-store' })
        if (res.ok && !stop) setInfo(await res.json())
      } catch {
        // The sidebar still works without the badge.
      }
    }
    load()
    const t = setInterval(load, 30000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [bare, pathname])

  useEffect(() => setOpen(false), [pathname])

  if (bare) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <p className="mb-1 font-display italic text-clay">Lana · staff access</p>
            <h1 className="font-display text-4xl uppercase italic tracking-tight text-navy">Lana</h1>
          </div>
          <div className="legacy-panel rounded-2xl border border-line bg-white p-6 shadow-sm">{children}</div>
        </div>
      </main>
    )
  }

  const isInbox = pathname === '/' || pathname.startsWith('/conversations')
  const isReservations = pathname.startsWith('/reservations')
  const light = LIGHT_PANEL.some((p) => pathname.startsWith(p))

  async function signOut() {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const item = (href: string, label: string, Icon: typeof MailIcon, active: boolean, badge?: number) => (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[17px] transition ${
        active ? 'bg-white/[0.05] text-white' : 'text-navy/80 hover:bg-white/[0.03] hover:text-navy'
      }`}
    >
      <Icon className="shrink-0 opacity-80" />
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="min-w-[1.25rem] rounded-full bg-red-500 px-1.5 text-center text-xs font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  )

  const sub = (href: string, label: string, active: boolean, badge?: number) => (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg py-2 pl-4 pr-3 text-[15px] transition ${
        active ? 'text-white' : 'text-navy/70 hover:text-navy'
      }`}
    >
      <span>{label}</span>
      {badge ? (
        <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-[#ef4d3f] px-2 text-xs font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  )

  const sidebar = (
    <nav className="flex h-full flex-col px-4 py-7">
      <div className="mb-10 text-center">
        <p className="font-display text-xl italic text-clay">Lana · admin</p>
        <p className="font-display text-3xl uppercase italic tracking-tight text-white">
          {info?.tenantName ?? '\u00a0'}
        </p>
      </div>

      <div className="space-y-1">
        {item('/', 'Messages', MailIcon, isInbox)}
        <div className="ml-5 border-l border-line">
          {sub('/reservations', 'Reservations', isReservations, info?.unreadReservations)}
        </div>
        {item('/escalations', 'Escalations', AlertIcon, pathname.startsWith('/escalations'), info?.newEscalations)}
        {item('/automations', 'Templates', TemplateIcon, pathname.startsWith('/automations'))}
        {item('/integrations', 'Integrations', ShareIcon, pathname.startsWith('/integrations'))}
        {item('/maintenance', 'Maintenance', HammerIcon, pathname.startsWith('/maintenance'))}
      </div>

      <div className="my-5 border-t border-line" />

      <div className="space-y-1">
        {item('/waitlist', 'Waitlist', ListIcon, pathname.startsWith('/waitlist'))}
        {item('/staff', 'Staff', UsersIcon, pathname.startsWith('/staff'))}
        {item('/settings', 'Settings', SettingsIcon, pathname.startsWith('/settings'))}
      </div>

      <div className="mt-auto border-t border-line pt-5">
        <p className="truncate text-sm text-navy/70">{info?.email ?? ''}</p>
        <button onClick={signOut} className="mt-2 text-sm text-clay hover:underline">
          Sign out
        </button>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-paper md:flex">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
        <p className="font-display text-lg italic text-clay">Lana · admin</p>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-navy">
          <MenuIcon />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-line bg-[#0d1222] transition-transform duration-200 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </aside>

      <div className="min-w-0 flex-1">
        {light ? (
          <div className="p-3 md:p-4">
            <div className="legacy-panel min-h-[calc(100vh-2rem)] rounded-2xl bg-[#f4f7fa] p-5 md:p-8">{children}</div>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
