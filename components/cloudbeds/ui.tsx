'use client'

import type { ReactNode } from 'react'

/** Shared look for every Cloudbeds window: gradient headers, soft fields, pill buttons. */

export const btn =
  'inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#8fb4ff]/25 bg-white/[0.06] px-3 text-[12.5px] font-medium text-[#eaf0fb] transition hover:bg-white/[0.12] disabled:opacity-60'

export const btnLg = btn.replace('h-[34px]', 'h-[38px]').replace('px-3', 'px-[18px]')

const priBase =
  'inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-5 text-[13px] font-semibold text-white transition hover:brightness-95 disabled:opacity-50'

export const priGreen = `${priBase} bg-gradient-to-b from-[#27ad86] to-[#1a8f6c] shadow-[0_4px_10px_rgba(31,157,120,.35),inset_0_1px_0_rgba(255,255,255,.25)]`
export const priBlue = `${priBase} bg-gradient-to-b from-[#3b78e6] to-[#2456b8] shadow-[0_4px_10px_rgba(47,102,208,.35),inset_0_1px_0_rgba(255,255,255,.25)]`
export const priRed = `${priBase} bg-gradient-to-b from-[#d9534f] to-[#b42318] shadow-[0_4px_10px_rgba(180,35,24,.3),inset_0_1px_0_rgba(255,255,255,.2)]`
export const priTeal = `${priBase} bg-gradient-to-b from-[#1ba08f] to-[#128c7e] shadow-[0_4px_10px_rgba(18,140,126,.35),inset_0_1px_0_rgba(255,255,255,.25)]`
export const priSlate = `${priBase} bg-gradient-to-b from-[#4a5568] to-[#2d3748] shadow-[0_4px_10px_rgba(45,55,72,.35),inset_0_1px_0_rgba(255,255,255,.2)]`

export const field =
  'h-9 w-full rounded-xl border border-[#8fb4ff]/25 bg-[#0f1c42]/60 px-3 text-[12.5px] font-normal text-[#eaf0fb] outline-none [color-scheme:dark] placeholder:text-[#8ea3cf] focus:border-[#3ccf8a] focus:ring-2 focus:ring-[#3ccf8a]/20'

export const area =
  'w-full resize-none rounded-[14px] border border-[#8fb4ff]/25 bg-[#0f1c42]/60 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#eaf0fb] outline-none [color-scheme:dark] placeholder:text-[#8ea3cf] focus:border-[#3ccf8a] focus:ring-2 focus:ring-[#3ccf8a]/20'

export const lbl = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[.12em] text-[#9fb3dc]'

export const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${on ? 'border-[#3ccf8a]/50 bg-[#3ccf8a]/20 font-semibold text-[#7be8b4]' : 'border-[#8fb4ff]/25 bg-white/[0.06] text-[#cfdcff] hover:bg-white/[0.12]'}`

export type Tone = 'blue' | 'teal' | 'red' | 'amber' | 'slate'

const HEADER: Record<Tone, string> = {
  blue: 'from-[#1d3a78]/80 to-[#16305f]/50',
  teal: 'from-[#14585a]/70 to-[#16305f]/50',
  red: 'from-[#7a2a3a]/70 to-[#16305f]/50',
  amber: 'from-[#7a5a1c]/70 to-[#16305f]/50',
  slate: 'from-[#3a4560]/70 to-[#16305f]/50',
}

export const headerGradient = (tone: Tone = 'blue') => `bg-gradient-to-r ${HEADER[tone]}`

/** A centred window with the gradient header. */
export function ModalShell({
  tone = 'blue', title, subtitle, onClose, children, widthClass = 'max-w-xl',
}: { tone?: Tone; title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; widthClass?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050b1f]/60 p-4" onClick={onClose}>
      <div style={{ background: HOLO_BG }} className={`max-h-[calc(100vh-2rem)] w-full ${widthClass} overflow-y-auto rounded-[22px] border border-[#8fb4ff]/25 text-[#eaf0fb] shadow-[0_24px_64px_rgba(0,0,0,.5)]`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center gap-3 px-6 py-4 text-white ${headerGradient(tone)}`}>
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight">{title}</p>
            {subtitle && <p className="mt-px truncate text-xs text-white/70">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/30 text-base leading-none text-white hover:bg-white/10">×</button>
        </div>
        <div className="space-y-3.5 px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

const PANEL: Record<'green' | 'teal' | 'red' | 'amber' | 'blue', string> = {
  green: 'border-[#3ccf8a]/40 from-[#3ccf8a]/15',
  teal: 'border-[#5fe0cf]/40 from-[#5fe0cf]/15',
  red: 'border-[#ff6b75]/40 from-[#ff6b75]/15',
  amber: 'border-[#f0b548]/40 from-[#f0b548]/15',
  blue: 'border-[#8fb4ff]/40 from-[#5b95f5]/15',
}

/** The tinted panel that opens inline under the action row of the reservation window. */
export function InlinePanel({
  tone, title, subtitle, onClose, children,
}: { tone: keyof typeof PANEL; title: ReactNode; subtitle?: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <div className={`space-y-2 rounded-xl border bg-gradient-to-b to-transparent to-60% p-3 ${PANEL[tone]}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold tracking-tight text-white">{title}</p>
          {subtitle && <p className="mt-px text-[12.5px] text-[#9fb3dc]">{subtitle}</p>}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close panel" className="ml-auto flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-[#8fb4ff]/30 bg-white/[0.06] text-base leading-none text-[#cfdcff] hover:bg-white/[0.12]">×</button>
        )}
      </div>
      {children}
    </div>
  )
}

/** The deep Soirée-blue grid background shared by the calendar and the side menu that slides over it. */
export const HOLO_BG =
  'repeating-radial-gradient(circle at 92% 8%,transparent 0,transparent 58px,rgba(143,180,255,.05) 58px,rgba(143,180,255,.05) 59px),' +
  'linear-gradient(rgba(143,180,255,.07) 1px,transparent 1px) 0 0/44px 44px,linear-gradient(90deg,rgba(143,180,255,.07) 1px,transparent 1px) 0 0/44px 44px,' +
  'radial-gradient(900px 520px at 0% 0%,rgba(70,120,240,.40),transparent 62%),radial-gradient(900px 520px at 100% 100%,rgba(100,80,220,.26),transparent 62%),linear-gradient(180deg,#1b3470,#12224a)'
