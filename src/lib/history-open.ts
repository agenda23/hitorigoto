import { LocalStorageHistoryRepository, type HistoryRepository } from './history'
import { IndexedDbHistoryRepository, openDatabase } from './history-idb'

const MIGRATED_FLAG = 'migratedFromLocalStorage'

export type Migration = { migrated: number } | { failed: true } | null

/**
 * Copies legacy localStorage history into IndexedDB. The old data is deleted only after every
 * thread has been read back from IndexedDB, so a failure at any point loses nothing.
 */
export async function migrateFromLocalStorage(target: IndexedDbHistoryRepository, legacy = new LocalStorageHistoryRepository()): Promise<Migration> {
  if (!legacy.hasData() || (await target.getFlag(MIGRATED_FLAG))) return null
  try {
    const threads = await legacy.all()
    for (const t of threads) await target.save(t)
    for (const t of threads) if (!(await target.get(t.id))) throw new Error(`verification failed for ${t.id}`)
    await target.setFlag(MIGRATED_FLAG)
    await legacy.clear()
    return { migrated: threads.length }
  } catch {
    return { failed: true }
  }
}

export type OpenedHistory = { repo: HistoryRepository; migration: Migration; fallback: boolean }

/** Opens IndexedDB (migrating old data once), or falls back to localStorage without image support. */
export async function openHistory(): Promise<OpenedHistory> {
  try {
    const repo = new IndexedDbHistoryRepository(await openDatabase())
    return { repo, migration: await migrateFromLocalStorage(repo), fallback: false }
  } catch {
    return { repo: new LocalStorageHistoryRepository(), migration: null, fallback: true }
  }
}
