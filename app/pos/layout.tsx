import Link from 'next/link'

/** Full-screen olive shell for the bar panel: sits over the admin sidebar so it feels like its own app on an iPad or phone. */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pos-shell fixed inset-0 z-[70] overflow-y-auto text-[#efeede]"
      style={{
        background: 'radial-gradient(1200px 600px at 10% -10%, #2b3219 0%, transparent 60%), radial-gradient(900px 500px at 100% 0%, #232a15 0%, transparent 55%), #12150d',
        paddingTop: 'env(safe-area-inset-top)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div className="mx-auto max-w-[1400px] px-4 pb-10 pt-4 md:px-6">
        <div className="mb-4 flex items-center justify-between text-xs">
          <Link href="/cloudbeds" className="text-[#9aa085] no-underline hover:text-[#efeede]">← Admin</Link>
        </div>
        {children}
      </div>
    </div>
  )
}
