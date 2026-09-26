import { BaseHistoryRepository, HistoryQuotaError, toMeta, type Removed, type StoredImage, type Thread, type ThreadMeta, type Usage } from './history'

const DB_NAME = 'hitorigoto'
const DB_VERSION = 1
const CHANNEL = 'hitorigoto-history'

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError'))
  })

const mapError = (e: unknown) => (e instanceof DOMException && e.name === 'QuotaExceededError' ? new HistoryQuotaError() : e)

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'))
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      db.createObjectStore('threads', { keyPath: 'id' })
      db.createObjectStore('index', { keyPath: 'id' })
      db.createObjectStore('images', { keyPath: 'id' })
      db.createObjectStore('meta', { keyPath: 'key' })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
    open.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

/**
 * IndexedDB backend. Stores: `threads` (bodies), `index` (list metadata, so the sidebar never
 * loads bodies), `images` (Blobs) and `meta` (flags such as the localStorage migration).
 */
export class IndexedDbHistoryRepository extends BaseHistoryRepository {
  readonly supportsImages = true
  private channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)

  constructor(private db: IDBDatabase) {
    super()
    // Best effort: ask the browser not to evict this origin's storage under pressure.
    void navigator.storage?.persist?.()
  }

  private notify() {
    this.channel?.postMessage('changed')
  }

  async list(): Promise<ThreadMeta[]> {
    const metas = (await req(this.db.transaction('index').objectStore('index').getAll())) as ThreadMeta[]
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string) {
    return ((await req(this.db.transaction('threads').objectStore('threads').get(id))) as Thread | undefined) ?? null
  }

  async all() {
    return (await req(this.db.transaction('threads').objectStore('threads').getAll())) as Thread[]
  }

  async save(thread: Thread) {
    try {
      const tx = this.db.transaction(['threads', 'index'], 'readwrite')
      tx.objectStore('threads').put(thread)
      tx.objectStore('index').put(toMeta(thread))
      await finished(tx)
    } catch (e) {
      throw mapError(e)
    }
    this.notify()
  }

  async remove(ids: string[]): Promise<Removed> {
    const tx = this.db.transaction(['threads', 'index', 'images'], 'readwrite')
    const threads = (await Promise.all(ids.map(id => req(tx.objectStore('threads').get(id) as IDBRequest<Thread | undefined>)))).flatMap(t => t ?? [])
    ids.forEach(id => {
      tx.objectStore('threads').delete(id)
      tx.objectStore('index').delete(id)
    })
    // Delete only images that no remaining thread references (imported copies share image ids).
    const gone = new Set(ids)
    const remaining = ((await req(tx.objectStore('index').getAll())) as ThreadMeta[]).filter(m => !gone.has(m.id))
    const stillUsed = new Set(remaining.flatMap(m => m.imageIds ?? []))
    const orphanIds = [...new Set(threads.flatMap(t => t.messages.flatMap(m => m.images ?? [])))].filter(id => !stillUsed.has(id))
    const images = (await Promise.all(orphanIds.map(id => req(tx.objectStore('images').get(id) as IDBRequest<StoredImage | undefined>)))).flatMap(i => i ?? [])
    orphanIds.forEach(id => tx.objectStore('images').delete(id))
    await finished(tx)
    this.notify()
    return { threads, images }
  }

  async restore(removed: Removed) {
    try {
      const tx = this.db.transaction(['threads', 'index', 'images'], 'readwrite')
      removed.images.forEach(i => tx.objectStore('images').put(i))
      removed.threads.forEach(t => {
        tx.objectStore('threads').put(t)
        tx.objectStore('index').put(toMeta(t))
      })
      await finished(tx)
    } catch (e) {
      throw mapError(e)
    }
    this.notify()
  }

  async clear() {
    const tx = this.db.transaction(['threads', 'index', 'images'], 'readwrite')
    ;['threads', 'index', 'images'].forEach(s => tx.objectStore(s).clear())
    await finished(tx)
    this.notify()
  }

  async usage(): Promise<Usage> {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {}
    return { used: usage, limit: quota }
  }

  async putImage(image: StoredImage) {
    try {
      const tx = this.db.transaction('images', 'readwrite')
      tx.objectStore('images').put(image)
      await finished(tx)
    } catch (e) {
      throw mapError(e)
    }
  }

  async getImage(id: string) {
    const image = (await req(this.db.transaction('images').objectStore('images').get(id))) as StoredImage | undefined
    return image?.blob ?? null
  }

  async getFlag(key: string): Promise<boolean> {
    const row = (await req(this.db.transaction('meta').objectStore('meta').get(key))) as { value: boolean } | undefined
    return row?.value === true
  }

  async setFlag(key: string) {
    const tx = this.db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put({ key, value: true })
    await finished(tx)
  }

  subscribe(onChange: () => void) {
    if (!this.channel) return () => {}
    const listener = () => onChange()
    this.channel.addEventListener('message', listener)
    return () => this.channel?.removeEventListener('message', listener)
  }
}
