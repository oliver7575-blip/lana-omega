'use client'

import type { ReactNode } from 'react'

/** Shared look for every Cloudbeds window: gradient headers, soft fields, pill buttons. */

export const btn =
  'inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#dde2ea] bg-white px-3 text-[12.5px] font-medium text-[#1b2a3d] shadow-[0_1px_2px_rgba(16,24,40,.05)] transition hover:bg-gray-50 disabled:opacity-60'

export const btnLg = btn.replace('h-[34px]', 'h-[38px]').replace('px-3', 'px-[18px]')

const priBase =
  'inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-5 text-[13px] font-semibold text-white transition hover:brightness-95 disabled:opacity-50'

export const priGreen = `${priBase} bg-gradient-to-b from-[#27ad86] to-[#1a8f6c] shadow-[0_4px_10px_rgba(31,157,120,.35),inset_0_1px_0_rgba(255,255,255,.25)]`
export const priBlue = `${priBase} bg-gradient-to-b from-[#3b78e6] to-[#2456b8] shadow-[0_4px_10px_rgba(47,102,208,.35),inset_0_1px_0_rgba(255,255,255,.25)]`
export const priRed = `${priBase} bg-gradient-to-b from-[#d9534f] to-[#b42318] shadow-[0_4px_10px_rgba(180,35,24,.3),inset_0_1px_0_rgba(255,255,255,.2)]`
export const priTeal = `${priBase} bg-gradient-to-b from-[#1ba08f] to-[#128c7e] shadow-[0_4px_10px_rgba(18,140,126,.35),inset_0_1px_0_rgba(255,255,255,.25)]`
export const priSlate = `${priBase} bg-gradient-to-b from-[#4a5568] to-[#2d3748] shadow-[0_4px_10px_rgba(45,55,72,.35),inset_0_1px_0_rgba(255,255,255,.2)]`

export const field =
  'h-9 w-full rounded-xl border border-[#dde2ea] bg-white px-3 text-[12.5px] font-normal text-[#14213d] shadow-[inset_0_1px_2px_rgba(16,24,40,.04)] outline-none focus:border-[#1f9d78] focus:ring-2 focus:ring-[#1f9d78]/15'

export const area =
  'w-full resize-none rounded-[14px] border border-[#dde2ea] bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#14213d] shadow-[inset_0_1px_2px_rgba(16,24,40,.04)] outline-none focus:border-[#1f9d78] focus:ring-2 focus:ring-[#1f9d78]/15'

export const lbl = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[.06em] text-[#7a8394]'

export const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${on ? 'border-[#c3e5db] bg-[#e6f5f0] font-semibold text-[#0e5f47]' : 'border-[#dde2ea] bg-white text-[#475467] hover:bg-gray-50'}`

export type Tone = 'blue' | 'teal' | 'red' | 'amber' | 'slate'

const HEADER: Record<Tone, string> = {
  blue: 'from-[#0f2742] via-[#1b4d6b] to-[#1f7a6a]',
  teal: 'from-[#0b3d36] via-[#0f6a5e] to-[#128c7e]',
  red: 'from-[#4a1620] to-[#8a2a35]',
  amber: 'from-[#5a3a0c] to-[#a8741c]',
  slate: 'from-[#2a2f3a] to-[#4a5163]',
}

export const headerGradient = (tone: Tone = 'blue') => `bg-gradient-to-r ${HEADER[tone]}`

/** A centred window with the gradient header. */
export function ModalShell({
  tone = 'blue', title, subtitle, onClose, children, widthClass = 'max-w-xl',
}: { tone?: Tone; title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; widthClass?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14213d]/45 p-4" onClick={onClose}>
      <div className={`max-h-[calc(100vh-2rem)] w-full ${widthClass} overflow-y-auto rounded-[22px] bg-white text-[#14213d] shadow-[0_24px_64px_rgba(20,33,61,.32)]`} onClick={(e) => e.stopPropagation()}>
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
  green: 'border-[#c3e5db] from-[#f0faf6] shadow-[0_10px_30px_rgba(31,157,120,.12)]',
  teal: 'border-[#c9e6df] from-[#f2faf8] shadow-[0_10px_30px_rgba(18,140,126,.12)]',
  red: 'border-[#f1c9c4] from-[#fff4f2] shadow-[0_10px_30px_rgba(180,35,24,.10)]',
  amber: 'border-[#f0d9a0] from-[#fff8e6] shadow-[0_10px_30px_rgba(168,116,28,.12)]',
  blue: 'border-[#cddcf7] from-[#f3f7ff] shadow-[0_10px_30px_rgba(47,102,208,.10)]',
}

/** The tinted panel that opens inline under the action row of the reservation window. */
export function InlinePanel({
  tone, title, subtitle, onClose, children,
}: { tone: keyof typeof PANEL; title: ReactNode; subtitle?: ReactNode; onClose?: () => void; children: ReactNode }) {
  return (
    <div className={`space-y-2 rounded-xl border bg-gradient-to-b to-white to-40% p-3 ${PANEL[tone]}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold tracking-tight">{title}</p>
          {subtitle && <p className="mt-px text-[12.5px] text-[#667085]">{subtitle}</p>}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close panel" className="ml-auto flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-base leading-none text-[#667085] hover:bg-gray-50">×</button>
        )}
      </div>
      {children}
    </div>
  )
}
