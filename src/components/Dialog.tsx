import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../lib/i18n'

/** Minimal accessible modal: Escape / backdrop closes, focus moves in and is restored. */
export function Dialog({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const { t } = useI18n()
  const panel = useRef<HTMLDivElement>(null)
  // Keep the latest onClose without re-running the focus effect on every parent render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('keydown', esc)
      previous?.focus()
    }
  }, [])

  // Portal: the dialog must not live inside the composer <form>.
  return createPortal(
    <div className="fixed inset-0 z-40 grid place-items-center bg-foreground/40 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-soft outline-none ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl">{title}</h2>
          <button type="button" className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground" onClick={onClose}>
            {t.close}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
