// Storage abstraction. UI code only talks to HistoryRepository; the implementation is IndexedDB
// (history-idb.ts) with a localStorage fallback and a one-time migration (history-open.ts).
// Every method is async so the backend can change without touching the UI.

export type StoredMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  /** Ids of attached images (blobs live in the repository's image store). */
  images?: string[]
}
export type Draft = { temperature?: number; text: string }
/** One "compare drafts" run: the same prompt generated at several temperatures. */
export type DraftSet = { id: string; prompt: string; createdAt: number; drafts: Draft[] }
export type Thread = {
  id: string
  title: string
  /** True once the user renamed the thread: auto-titling must not overwrite it. */
  titleEdited?: boolean
  pinned?: boolean
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
  draftSets?: DraftSet[]
}
export type ThreadMeta = {
  id: string
  title: string
  pinned?: boolean
  updatedAt: number
  messageCount: number
  /** Image ids referenced by this thread (used to delete unreferenced blobs). */
  imageIds?: string[]
}
export type StoredImage = { id: string; blob: Blob }
/** Everything removed by `remove`, so the caller can offer "undo". */
export type Removed = { threads: Thread[]; images: StoredImage[] }
export type ImportStrategy = 'merge' | 'copy'
export type ImportResult = { added: number; merged: number; copied: number }
export type Usage = { used: number; limit: number }

export class HistoryQuotaError extends Error {
  constructor() {
    super('history quota exceeded')
    this.name = 'HistoryQuotaError'
  }
}

export interface HistoryRepository {
  /** False when the backend cannot store image blobs (localStorage fallback). */
  readonly supportsImages: boolean
  list(): Promise<ThreadMeta[]>
  get(id: string): Promise<Thread | null>
  all(): Promise<Thread[]>
  save(thread: Thread): Promise<void>
  /** Renaming marks the title as user-edited. */
  patch(id: string, changes: { title?: string; pinned?: boolean }): Promise<void>
  remove(ids: string[]): Promise<Removed>
  restore(removed: Removed): Promise<void>
  clear(): Promise<void>
  /** Full-text search over titles and message bodies. */
  search(query: string): Promise<ThreadMeta[]>
  usage(): Promise<Usage>
  putImage(image: StoredImage): Promise<void>
  getImage(id: string): Promise<Blob | null>
  importThreads(threads: Thread[], images: StoredImage[], strategy: ImportStrategy): Promise<ImportResult>
  /** Adds a draft set to a thread, creating a thread for it if needed. */
  addDraftSet(threadId: string, set: DraftSet, fallbackTitle: string): Promise<void>
  removeDraftSet(threadId: string, setId: string): Promise<void>
  subscribe(onChange: () => void): () => void
}

export const imageIdsOf = (t: Thread): string[] => [...new Set(t.messages.flatMap(m => m.images ?? []))]

export const toMeta = (t: Thread): ThreadMeta => {
  const imageIds = imageIdsOf(t)
  return {
    id: t.id,
    title: t.title,
    pinned: t.pinned || undefined,
    updatedAt: t.updatedAt,
    messageCount: t.messages.length,
    imageIds: imageIds.length ? imageIds : undefined,
  }
}

/** Logic shared by every backend, written against the primitive methods only. */
export abstract class BaseHistoryRepository implements HistoryRepository {
  abstract readonly supportsImages: boolean
  abstract list(): Promise<ThreadMeta[]>
  abstract get(id: string): Promise<Thread | null>
  abstract all(): Promise<Thread[]>
  abstract save(thread: Thread): Promise<void>
  abstract remove(ids: string[]): Promise<Removed>
  abstract restore(removed: Removed): Promise<void>
  abstract clear(): Promise<void>
  abstract usage(): Promise<Usage>
  abstract putImage(image: StoredImage): Promise<void>
  abstract getImage(id: string): Promise<Blob | null>
  abstract subscribe(onChange: () => void): () => void

  async patch(id: string, changes: { title?: string; pinned?: boolean }) {
    const thread = await this.get(id)
    if (!thread) return
    if (changes.title !== undefined) {
      thread.title = changes.title.trim() || thread.title
      thread.titleEdited = true
    }
    if (changes.pinned !== undefined) thread.pinned = changes.pinned || undefined
    await this.save(thread)
  }

  async search(query: string) {
    const q = query.trim().toLowerCase()
    const list = await this.list()
    if (!q) return list
    const hits = new Set(
      (await this.all())
        .filter(
          t =>
            t.title.toLowerCase().includes(q) ||
            t.messages.some(m => m.text.toLowerCase().includes(q)) ||
            t.draftSets?.some(s => s.prompt.toLowerCase().includes(q) || s.drafts.some(d => d.text.toLowerCase().includes(q))),
        )
        .map(t => t.id),
    )
    return list.filter(m => hits.has(m.id))
  }

  async importThreads(threads: Thread[], images: StoredImage[], strategy: ImportStrategy): Promise<ImportResult> {
    const result: ImportResult = { added: 0, merged: 0, copied: 0 }
    for (const image of images) await this.putImage(image)
    for (const incoming of threads) {
      const existing = await this.get(incoming.id)
      if (!existing) {
        await this.save(incoming)
        result.added++
      } else if (strategy === 'copy') {
        await this.save({ ...incoming, id: crypto.randomUUID(), title: `${incoming.title} (copy)`, titleEdited: true })
        result.copied++
      } else {
        const byId = new Map(existing.messages.map(m => [m.id, m]))
        for (const m of incoming.messages) if (!byId.has(m.id)) byId.set(m.id, m)
        const sets = new Map((existing.draftSets ?? []).map(s => [s.id, s]))
        for (const s of incoming.draftSets ?? []) if (!sets.has(s.id)) sets.set(s.id, s)
        await this.save({
          ...existing,
          title: incoming.updatedAt > existing.updatedAt && !existing.titleEdited ? incoming.title : existing.title,
          pinned: existing.pinned || incoming.pinned,
          updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
          messages: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt),
          draftSets: sets.size ? [...sets.values()].sort((a, b) => a.createdAt - b.createdAt) : undefined,
        })
        result.merged++
      }
    }
    return result
  }

  async addDraftSet(threadId: string, set: DraftSet, fallbackTitle: string) {
    const now = Date.now()
    const thread: Thread = (await this.get(threadId)) ?? {
      id: threadId,
      title: set.prompt.replace(/\s+/g, ' ').trim().slice(0, 40) || fallbackTitle,
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    thread.draftSets = [...(thread.draftSets ?? []).filter(s => s.id !== set.id), set]
    thread.updatedAt = now
    await this.save(thread)
  }

  async removeDraftSet(threadId: string, setId: string) {
    const thread = await this.get(threadId)
    if (!thread?.draftSets) return
    thread.draftSets = thread.draftSets.filter(s => s.id !== setId)
    if (!thread.draftSets.length) thread.draftSets = undefined
    await this.save(thread)
  }
}

const PREFIX = 'hitorigoto:'
const KEEP_ON_CLEAR = [PREFIX + 'lang', PREFIX + 'onboarded']
const SCHEMA_VERSION = 1
/** Chrome allows about 5 MiB of UTF-16 code units per origin. */
export const STORAGE_LIMIT = 5 * 1024 * 1024
const isQuota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)

/** localStorage backend: the fallback when IndexedDB is unavailable, and the migration source. */
export class LocalStorageHistoryRepository extends BaseHistoryRepository {
  readonly supportsImages = false

  private readIndex(): ThreadMeta[] {
    try {
      const raw = localStorage.getItem(PREFIX + 'index')
      return raw ? (JSON.parse(raw) as ThreadMeta[]) : []
    } catch {
      return []
    }
  }

  private write(key: string, value: string) {
    try {
      localStorage.setItem(PREFIX + key, value)
    } catch (e) {
      if (isQuota(e)) throw new HistoryQuotaError()
      throw e
    }
  }

  /** True when there is legacy history to migrate. */
  hasData() {
    return localStorage.getItem(PREFIX + 'index') !== null
  }

  async list() {
    return this.readIndex().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string) {
    try {
      const raw = localStorage.getItem(PREFIX + 'thread:' + id)
      return raw ? (JSON.parse(raw) as Thread) : null
    } catch {
      return null
    }
  }

  async all() {
    return (await Promise.all(this.readIndex().map(m => this.get(m.id)))).flatMap(t => t ?? [])
  }

  async save(thread: Thread) {
    const key = 'thread:' + thread.id
    const previous = localStorage.getItem(PREFIX + key)
    this.write(key, JSON.stringify(thread))
    try {
      this.write('index', JSON.stringify([...this.readIndex().filter(m => m.id !== thread.id), toMeta(thread)]))
      this.write('schemaVersion', String(SCHEMA_VERSION))
    } catch (e) {
      // Keep body and index consistent when the index write fails.
      if (previous === null) localStorage.removeItem(PREFIX + key)
      else localStorage.setItem(PREFIX + key, previous)
      throw e
    }
  }

  async remove(ids: string[]): Promise<Removed> {
    const threads = (await Promise.all(ids.map(id => this.get(id)))).flatMap(t => t ?? [])
    ids.forEach(id => localStorage.removeItem(PREFIX + 'thread:' + id))
    const gone = new Set(ids)
    this.write('index', JSON.stringify(this.readIndex().filter(m => !gone.has(m.id))))
    return { threads, images: [] }
  }

  async restore(removed: Removed) {
    for (const t of removed.threads) await this.save(t)
  }

  async clear() {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX) && !KEEP_ON_CLEAR.includes(k)) keys.push(k)
    }
    keys.forEach(k => localStorage.removeItem(k))
  }

  async usage(): Promise<Usage> {
    let used = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) used += k.length + (localStorage.getItem(k)?.length ?? 0)
    }
    return { used, limit: STORAGE_LIMIT }
  }

  async putImage(): Promise<void> {
    throw new Error('images are not supported by the localStorage backend')
  }

  async getImage() {
    return null
  }

  subscribe(onChange: () => void) {
    const h = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith(PREFIX)) onChange()
    }
    window.addEventListener('storage', h)
    return () => window.removeEventListener('storage', h)
  }
}
