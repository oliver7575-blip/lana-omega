'use client'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pb-3 pt-5">
          <div>
            <h2 className="font-display text-2xl italic text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-navy/60">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-xl text-navy/50 hover:text-navy" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-4 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}
