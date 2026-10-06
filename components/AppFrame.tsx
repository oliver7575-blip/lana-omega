'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LiveRefresh from './LiveRefresh'
import {
  AlertIcon,
  DollarIcon,
  BedIcon,
  HammerIcon,
  StarIcon,
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
// Older pages with plain markup get Beta's dark theme through .legacy-dark.
const LEGACY = ['/settings', '/staff', '/waitlist', '/integrations', '/automations']

interface ShellInfo {
  email: string
  tenantName: string
  unreadReservations: number
  unreadEmails: number
  unreadReviews: number
  newEscalations: number
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [info, setInfo] = useState<ShellInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)

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
  }, [bare, pathname, tick])

  useEffect(() => setOpen(false), [pathname])

  if (pathname.startsWith('/login')) return <>{children}</>

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

  const isInbox = pathname.startsWith('/inbox') || pathname.startsWith('/conversations')
  const isReservations = pathname.startsWith('/reservations')
  const legacy = LEGACY.some((p) => pathname.startsWith(p))

  async function signOut() {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const item = (href: string, label: string, Icon: typeof MailIcon, active: boolean, badge?: number) => (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
        active ? 'bg-white/[0.05] text-white' : 'text-navy/80 hover:bg-white/[0.03] hover:text-navy'
      }`}
    >
      <Icon className="shrink-0 opacity-80" />
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="min-w-[1.25rem] rounded-full bg-[#ef4d3f] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  )

  const sub = (href: string, label: string, active: boolean, badge?: number) => (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg py-1 pl-3 pr-3 text-[12px] transition ${
        active ? 'text-white' : 'text-navy/70 hover:text-navy'
      }`}
    >
      <span>{label}</span>
      {badge ? (
        <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#ef4d3f] px-1.5 text-[11px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  )

  const sidebar = (
    <nav className="flex h-full flex-col px-3 py-6">
      <div className="mb-8 text-center">
        <p className="font-display text-base italic text-clay">Lana · admin</p>
        <p className="font-display text-[23px] uppercase italic tracking-tight text-white">
          {info?.tenantName ?? '\u00a0'}
        </p>
      </div>

      <div className="space-y-1">
        {item('/cloudbeds', 'Cloudbeds', BedIcon, pathname.startsWith('/cloudbeds'))}
        <div className="ml-8 border-l border-line pl-2">
          {sub('/cloudbeds', 'Dashboard', pathname === '/cloudbeds')}
          {sub('/cloudbeds/calendar', 'Calendar', pathname.startsWith('/cloudbeds/calendar'))}
        </div>
        {item('/inbox', 'Messages', MailIcon, isInbox)}
        <div className="ml-8 border-l border-line pl-2">
          {sub('/reservations', 'Reservations', isReservations, info?.unreadReservations)}
          {sub('/email-inquiries', 'Email Inquiries', pathname.startsWith('/email-inquiries'), info?.unreadEmails)}
        </div>
        {item('/escalations', 'Escalations', AlertIcon, pathname.startsWith('/escalations'), info?.newEscalations)}
        {item('/automations', 'Templates', TemplateIcon, pathname.startsWith('/automations'))}
        {item('/integrations', 'Integrations', ShareIcon, pathname.startsWith('/integrations'))}
        {item('/reviews', 'Reviews', StarIcon, pathname.startsWith('/reviews'), info?.unreadReviews)}
        {item('/maintenance', 'Maintenance', HammerIcon, pathname.startsWith('/maintenance'))}
      </div>

      <div className="my-4 border-t border-line" />

      <div className="space-y-1">
        {item('/waitlist', 'Waitlist', ListIcon, pathname.startsWith('/waitlist'))}
        {item('/staff', 'Staff', UsersIcon, pathname.startsWith('/staff'))}
        {item('/costs', 'Costs', DollarIcon, pathname.startsWith('/costs'))}
        {item('/settings', 'Settings', SettingsIcon, pathname.startsWith('/settings'))}
      </div>

      <div className="mt-auto border-t border-line pt-5">
        <p className="truncate text-xs text-navy/70">{info?.email ?? ''}</p>
        <button onClick={signOut} className="mt-1.5 text-xs text-clay hover:underline">
          Sign out
        </button>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-paper md:flex">
      <LiveRefresh tables={['messages', 'escalations']} onChange={() => setTick((t) => t + 1)} pollMs={60000} />
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
        <p className="font-display text-lg italic text-clay">Lana · admin</p>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-navy">
          <MenuIcon />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-line bg-surface transition-transform duration-200 md:sticky md:top-0 md:h-screen md:w-52 md:shrink-0 md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </aside>

      <div className="min-w-0 flex-1">
        {legacy ? (
          <div className="legacy-dark px-5 py-6 md:px-8">{children}</div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
