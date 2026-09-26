import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ThreadMeta, Usage } from '../lib/history'
import { useGuide } from '../lib/guide-context'
import { useI18n } from '../lib/i18n'
import { CheckIcon, DownloadIcon, GhostIcon, MoreIcon, PencilIcon, PinIcon, PlusIcon, SearchIcon, TrashIcon, UploadIcon } from './icons'

export type SidebarProps = {
  threads: ThreadMeta[]
  query: string
  onQuery: (q: string) => void
  activeId: string
  temporary: boolean
  usage: Usage
  /** Number of imported chats whose ID already exists, while waiting for the user's choice. */
  importConflicts: number | null
  onSelect: (id: string) => void
  onNew: () => void
  onTemp: () => void
  onDelete: (ids: string[]) => void
  onDeleteAll: () => void
  onPin: (id: string, pinned: boolean) => void
  onRename: (id: string, title: string) => void
  onExportThread: (id: string) => void
  onExportAll: () => void
  onImportFile: (file: File) => void
  onResolveImport: (strategy: 'merge' | 'copy' | null) => void
}

const row = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-foreground/5'
const smallBtn = 'flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-xs transition-colors hover:bg-foreground/5'
const KB = 1024
const formatBytes = (n: number) => {
  if (n >= KB ** 3) return `${(n / KB ** 3).toFixed(1)}GB`
  if (n >= KB ** 2) return `${(n / KB ** 2).toFixed(n >= 10 * KB ** 2 ? 0 : 1)}MB`
  return `${Math.max(0, Math.round(n / KB))}KB`
}

function ItemMenu({ open, onOpenChange, children, label }: { open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode; label: string }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const r = btn.current!.getBoundingClientRect()
    setPos({ top: r.bottom + 176 > window.innerHeight ? Math.max(8, r.top - 176) : r.bottom + 4, left: Math.max(8, r.right - 208) })
    const close = (e: Event) => {
      if (!(e.target instanceof Node) || !(e.target as Element).closest?.('[data-item-menu]')) onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open, onOpenChange])

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-item-menu
        className={`absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-opacity group-hover:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 ${open ? 'opacity-100' : 'opacity-0'}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div
          data-item-menu
          role="menu"
          className="fixed z-30 w-52 rounded-xl border border-border bg-background p-1 text-sm shadow-soft"
          style={{ top: pos.top, left: pos.left }}
        >
          {children}
        </div>
      )}
    </>
  )
}

const menuItem = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-foreground/5'

export function Sidebar(p: SidebarProps) {
  const { t } = useI18n()
  const guide = useGuide()
  const [confirmAll, setConfirmAll] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)

  const pinned = p.threads.filter(th => th.pinned)
  const others = p.threads.filter(th => !th.pinned)
  const usageRatio = Math.min(1, p.usage.used / p.usage.limit)
  const nearFull = usageRatio > 0.8

  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const renderRow = (th: ThreadMeta) => {
    const active = !p.temporary && th.id === p.activeId
    if (renamingId === th.id)
      return (
        <li key={th.id} className="px-1 py-0.5">
          <input
            autoFocus
            defaultValue={th.title}
            aria-label={t.rename}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-muted-foreground/60"
            onFocus={e => e.currentTarget.select()}
            onBlur={e => {
              p.onRename(th.id, e.currentTarget.value)
              setRenamingId(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenamingId(null)
            }}
          />
        </li>
      )
    return (
      <li key={th.id} className="group relative">
        <button
          type="button"
          className={`${row} ${selecting ? '' : 'pr-9'} ${active ? 'bg-foreground/10' : ''}`}
          aria-pressed={selecting ? selected.has(th.id) : undefined}
          onClick={() => (selecting ? toggle(th.id) : p.onSelect(th.id))}
          title={th.title}
        >
          {selecting && (
            <span className={`grid size-4 shrink-0 place-items-center rounded border ${selected.has(th.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'}`} aria-hidden="true">
              {selected.has(th.id) && <CheckIcon />}
            </span>
          )}
          {th.pinned && !selecting && <span className="shrink-0 text-muted-foreground"><PinIcon /></span>}
          <span className="truncate">{th.title}</span>
        </button>
        {!selecting && (
          <ItemMenu open={menuId === th.id} onOpenChange={o => setMenuId(o ? th.id : null)} label={`${t.moreActions}: ${th.title}`}>
            <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuId(null); p.onPin(th.id, !th.pinned) }}>
              <PinIcon />{th.pinned ? t.unpin : t.pin}
            </button>
            <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuId(null); setRenamingId(th.id) }}>
              <PencilIcon />{t.rename}
            </button>
            <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuId(null); p.onExportThread(th.id) }}>
              <DownloadIcon />{t.exportMarkdown}
            </button>
            <button type="button" role="menuitem" className={`${menuItem} text-danger`} onClick={() => { setMenuId(null); p.onDelete([th.id]) }}>
              <TrashIcon />{t.deleteThread}
            </button>
          </ItemMenu>
        )}
      </li>
    )
  }

  return (
    <nav className="flex h-full w-64 shrink-0 flex-col bg-sidebar">
      <div className="space-y-1 p-2 pt-3">
        <button type="button" className={row} onClick={p.onNew}>
          <PlusIcon />
          <span>{t.newChat}</span>
        </button>
        <button type="button" className={`${row} ${p.temporary ? 'bg-foreground/10' : ''}`} aria-pressed={p.temporary} onClick={p.onTemp}>
          <GhostIcon />
          <span>{t.tempChat}</span>
        </button>
      </div>

      <div className="px-3 pb-1">
        <label className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-sm focus-within:border-muted-foreground/60">
          <span className="text-muted-foreground"><SearchIcon /></span>
          <input
            type="search"
            value={p.query}
            onChange={e => p.onQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="flex items-center justify-between px-5 pt-2 pb-1">
        <h2 className="text-xs font-medium text-muted-foreground">{t.historyHeading}</h2>
        {p.threads.length > 0 && (
          <button type="button" className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
            {selecting ? t.selectDone : t.select}
          </button>
        )}
      </div>

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {p.threads.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{p.query ? t.searchNoResults : t.noHistory}</li>}
        {pinned.length > 0 && <li className="px-3 pt-1 text-xs text-muted-foreground">{t.pinnedHeading}</li>}
        {pinned.map(renderRow)}
        {pinned.length > 0 && others.length > 0 && <li className="px-3 pt-2 text-xs text-muted-foreground">{t.historyHeading}</li>}
        {others.map(renderRow)}
      </ul>

      {selecting && selected.size > 0 && (
        <div className="px-3 pt-2">
          <button
            type="button"
            className="w-full rounded-lg bg-danger px-3 py-2 text-sm text-background"
            onClick={() => {
              p.onDelete([...selected])
              stopSelecting()
            }}
          >
            {t.deleteSelected(selected.size)}
          </button>
        </div>
      )}

      <div className="space-y-2.5 border-t border-border p-3 text-sm">
        <div className="space-y-1" title={t.usageLabel(formatBytes(p.usage.used), formatBytes(p.usage.limit))}>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t.dataHeading}</span>
            <span>{t.usageLabel(formatBytes(p.usage.used), formatBytes(p.usage.limit))}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usageRatio * 100)} aria-label={t.dataHeading}>
            <div className={`h-full rounded-full ${nearFull ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${Math.max(1, usageRatio * 100)}%` }} />
          </div>
          {nearFull && <p className="text-xs text-danger" role="alert">{t.usageWarn}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={smallBtn} title="JSON" onClick={p.onExportAll}>
            <DownloadIcon />{t.exportAll}
          </button>
          <button type="button" className={smallBtn} onClick={() => fileInput.current?.click()}>
            <UploadIcon />{t.importFile}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={t.importFile}
            onChange={e => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) p.onImportFile(file)
            }}
          />
        </div>

        {p.importConflicts !== null && (
          <div className="space-y-2 rounded-lg border border-border bg-background/60 p-3" role="alertdialog" aria-label={t.importFile}>
            <p className="text-xs">{t.importConflictTitle(p.importConflicts)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground" onClick={() => p.onResolveImport('merge')}>{t.importMerge}</button>
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-foreground/5" onClick={() => p.onResolveImport('copy')}>{t.importCopy}</button>
              <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5" onClick={() => p.onResolveImport(null)}>{t.importCancel}</button>
            </div>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t.storageWarn}{' '}
          <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => guide.open('usage', 'history')}>
            {t.guideHistoryLink}
          </button>
        </p>
        {confirmAll ? (
          <div className="space-y-2 rounded-lg border border-danger/40 p-3" role="alertdialog" aria-label={t.deleteAll}>
            <p className="text-xs">{t.deleteAllConfirm}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-danger px-3 py-1.5 text-xs text-background"
                onClick={() => {
                  setConfirmAll(false)
                  p.onDeleteAll()
                }}
              >
                {t.confirmYes}
              </button>
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-foreground/5" onClick={() => setConfirmAll(false)}>
                {t.confirmNo}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={`${row} text-danger`} onClick={() => setConfirmAll(true)}>
            <TrashIcon />
            <span>{t.deleteAll}</span>
          </button>
        )}
      </div>
    </nav>
  )
}
