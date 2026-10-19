import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Right-side sheet on desktop, full-height sheet on mobile. Esc / backdrop closes. */
export default function Sheet({ open, onClose, title, subtitle, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/60" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={cn('flex h-full w-full animate-slide-in-right flex-col border-l border-border bg-popover shadow-2xl', wide ? 'max-w-2xl' : 'max-w-lg')}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0"><h2 className="font-display text-lg font-semibold">{title}</h2>{subtitle && <p className="mt-0.5 break-words text-xs text-muted-foreground">{subtitle}</p>}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="pb-safe border-t border-border px-5 py-3">{footer}</footer>}
      </section>
    </div>
  )
}
