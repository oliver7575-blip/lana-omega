'use client'

import { HOLO_BG } from '@/components/cloudbeds/ui'

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050b1f]/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-[22px] border border-[#8fb4ff]/25 text-[#eaf0fb] shadow-[0_24px_64px_rgba(0,0,0,.5)]"
        style={{ background: HOLO_BG }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pb-3 pt-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-[#9fb3dc]">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-xl text-[#9fb3dc] hover:text-white" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-4 border-t border-[#8fb4ff]/25 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}
