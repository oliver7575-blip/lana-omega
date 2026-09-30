'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Keeps a page up to date without manual refreshes: listens for database
 * changes (Supabase Realtime) and re-renders. Polls as a safety net.
 */
export default function LiveRefresh({
  tables,
  onChange,
  pollMs = 20000,
}: {
  tables: string[]
  onChange?: () => void
  pollMs?: number
}) {
  const router = useRouter()
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => (cb.current ? cb.current() : router.refresh()), 400)
    }
    const supabase = createClient()
    const channel = supabase.channel(`live-${tables.join('-')}-${Math.random().toString(36).slice(2)}`)
    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    }
    channel.subscribe()
    const poll = setInterval(refresh, pollMs)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(channel)
    }
  }, [tables.join(','), pollMs]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
