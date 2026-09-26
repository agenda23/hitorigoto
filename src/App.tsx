import { useCallback, useEffect, useRef, useState } from 'react'
import { Chat } from './components/Chat'
import { DiagnosticsGate } from './components/DiagnosticsGate'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { checkImageSupport } from './lib/diagnostics'
import { download, safeFilename } from './lib/download'
import { ImportError, exportAll, parseImport, threadToMarkdown } from './lib/exchange'
import { HistoryQuotaError, imageIdsOf, type HistoryRepository, type ImportStrategy, type StoredImage, type Thread, type ThreadMeta, type Usage } from './lib/history'
import { GuideProvider } from './lib/guide-context'
import { HistoryProvider } from './lib/history-context'
import { openHistory, type OpenedHistory } from './lib/history-open'
import { I18nProvider, useI18n } from './lib/i18n'
import { blobToDataUrl } from './lib/images'

type Active = { id: string; temporary: boolean; initial: Thread | null; images: Record<string, string> }
type Toast = { message: string; undo?: () => void }
type PendingImport = { threads: Thread[]; images: StoredImage[]; conflicts: number }

const fresh = (temporary: boolean): Active => ({ id: crypto.randomUUID(), temporary, initial: null, images: {} })
const TOAST_MS = 7000

function Workspace({ opened }: { opened: OpenedHistory }) {
  const { t, lang } = useI18n()
  const repo: HistoryRepository = opened.repo
  const [version, setVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [threads, setThreads] = useState<ThreadMeta[]>([])
  const [usage, setUsage] = useState<Usage>({ used: 0, limit: 1 })
  const [active, setActive] = useState<Active>(() => fresh(false))
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768)
  const [toast, setToast] = useState<Toast | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [imageInput, setImageInput] = useState(false)
  const toastTimer = useRef<number>(0)

  const refresh = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => repo.subscribe(refresh), [repo, refresh])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [list, u] = await Promise.all([query ? repo.search(query) : repo.list(), repo.usage()])
      if (alive) {
        setThreads(list)
        setUsage(u)
      }
    })()
    return () => {
      alive = false
    }
  }, [repo, query, version])

  useEffect(() => {
    let alive = true
    void checkImageSupport(lang).then(ok => alive && setImageInput(ok))
    return () => {
      alive = false
    }
  }, [lang])

  const notify = useCallback((next: Toast) => {
    window.clearTimeout(toastTimer.current)
    setToast(next)
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  // One-time notices about where the history lives.
  useEffect(() => {
    const { migration, fallback } = opened
    if (migration && 'migrated' in migration && migration.migrated > 0) notify({ message: t.migrated(migration.migrated) })
    else if (migration && 'failed' in migration) notify({ message: t.migrationFailed })
    else if (fallback) notify({ message: t.storageFallback })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs a storage write; a full storage is reported instead of failing silently. */
  const guarded = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      if (!(e instanceof HistoryQuotaError)) throw e
      notify({ message: t.quotaError })
    }
    refresh()
  }

  const select = async (id: string) => {
    const thread = await repo.get(id)
    if (!thread) return refresh()
    const images: Record<string, string> = {}
    for (const imageId of imageIdsOf(thread)) {
      const blob = await repo.getImage(imageId)
      if (blob) images[imageId] = await blobToDataUrl(blob)
    }
    setActive({ id, temporary: false, initial: thread, images })
    refresh()
  }

  const remove = async (ids: string[]) => {
    const removed = await repo.remove(ids)
    if (ids.includes(active.id)) setActive(fresh(false))
    refresh()
    if (!removed.threads.length) return
    notify({
      message: removed.threads.length === 1 ? t.deletedToast(removed.threads[0].title) : t.deletedManyToast(removed.threads.length),
      undo: () => {
        setToast(null)
        void guarded(() => repo.restore(removed))
      },
    })
  }

  const removeAll = async () => {
    await repo.clear()
    setActive(fresh(false))
    setToast(null)
    refresh()
  }

  const applyImport = async (incoming: { threads: Thread[]; images: StoredImage[] }, strategy: ImportStrategy) => {
    setPendingImport(null)
    // A backend without image support (localStorage fallback) keeps the text and drops the images.
    const { threads: ts, images } = repo.supportsImages
      ? incoming
      : { threads: incoming.threads.map(th => ({ ...th, messages: th.messages.map(m => ({ ...m, images: undefined })) })), images: [] }
    await guarded(async () => {
      const r = await repo.importThreads(ts, images, strategy)
      notify({ message: t.importDone(r.added, r.merged, r.copied) })
    })
  }

  const importFile = async (file: File) => {
    try {
      const parsed = parseImport(await file.text())
      let conflicts = 0
      for (const th of parsed.threads) if (await repo.get(th.id)) conflicts++
      if (conflicts === 0) await applyImport(parsed, 'merge')
      else setPendingImport({ ...parsed, conflicts })
    } catch (e) {
      if (!(e instanceof ImportError)) throw e
      notify({ message: t.importFailed })
    }
  }

  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <Sidebar
          threads={threads}
          query={query}
          onQuery={setQuery}
          activeId={active.id}
          temporary={active.temporary}
          usage={usage}
          importConflicts={pendingImport ? pendingImport.conflicts : null}
          onSelect={id => void select(id)}
          onNew={() => setActive(fresh(false))}
          onTemp={() => setActive(fresh(true))}
          onDelete={ids => void remove(ids)}
          onDeleteAll={() => void removeAll()}
          onPin={(id, pinned) => void guarded(() => repo.patch(id, { pinned }))}
          onRename={(id, title) => void guarded(() => repo.patch(id, { title }))}
          onExportThread={id =>
            void repo.get(id).then(thread => {
              if (thread) download(`${safeFilename(thread.title)}.md`, 'text/markdown', threadToMarkdown(thread, { user: t.roleUser, assistant: t.roleAssistant, images: t.imageNote }))
            })
          }
          onExportAll={() => void exportAll(repo).then(json => download(`hitorigoto-${stamp()}.json`, 'application/json', json))}
          onImportFile={file => void importFile(file)}
          onResolveImport={strategy => (strategy && pendingImport ? void applyImport(pendingImport, strategy) : setPendingImport(null))}
        />
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header onToggleSidebar={() => setSidebarOpen(o => !o)} />
        <main className="min-h-0 flex-1">
          <Chat
            key={active.id}
            threadId={active.id}
            initial={active.initial}
            initialImages={active.images}
            temporary={active.temporary}
            imagesEnabled={imageInput && repo.supportsImages}
            onSaved={refresh}
          />
        </main>
        {toast && (
          <div className="absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background px-4 py-2 text-sm shadow-soft" role="status" aria-live="polite">
            <span>{toast.message}</span>
            {toast.undo && (
              <button type="button" className="font-medium text-primary hover:underline" onClick={toast.undo}>
                {t.undo}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Opens the history storage (migrating old localStorage data once) before showing the workspace. */
function HistoryBoot() {
  const { t } = useI18n()
  const [opened, setOpened] = useState<OpenedHistory | null>(null)
  useEffect(() => {
    let alive = true
    void openHistory().then(o => alive && setOpened(o))
    return () => {
      alive = false
    }
  }, [])
  if (!opened)
    return (
      <>
        <Header />
        <p className="p-6 text-muted-foreground" role="status">{t.loadingHistory}</p>
      </>
    )
  return (
    <HistoryProvider repo={opened.repo}>
      <Workspace opened={opened} />
    </HistoryProvider>
  )
}

export function App() {
  return (
    <I18nProvider>
      <GuideProvider>
        <div className="flex h-full flex-col">
          <DiagnosticsGate>
            <HistoryBoot />
          </DiagnosticsGate>
        </div>
      </GuideProvider>
    </I18nProvider>
  )
}
