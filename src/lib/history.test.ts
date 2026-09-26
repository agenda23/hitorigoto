import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryQuotaError, LocalStorageHistoryRepository, type DraftSet, type HistoryRepository, type StoredImage, type Thread } from './history'
import { IndexedDbHistoryRepository, openDatabase } from './history-idb'
import { migrateFromLocalStorage } from './history-open'

const msg = (id: string, role: 'user' | 'assistant', text: string, createdAt: number, images?: string[]) => ({ id, role, text, createdAt, images })
const thread = (id: string, over: Partial<Thread> = {}): Thread => ({
  id,
  title: `title ${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  messages: [msg(`${id}-1`, 'user', `hello ${id}`, 1000), msg(`${id}-2`, 'assistant', `reply ${id}`, 1500)],
  ...over,
})
const draftSet = (id: string, prompt = 'prompt'): DraftSet => ({ id, prompt, createdAt: 5, drafts: [{ temperature: 0.2, text: 'a' }, { temperature: 1.5, text: 'b' }] })
// jsdom's Blob cannot be structured-cloned by fake-indexeddb; Node's can.
const image = (id: string): StoredImage => ({ id, blob: new NodeBlob(['png-bytes'], { type: 'image/png' }) as unknown as Blob })

let idbCounter = 0
const backends: [string, () => Promise<HistoryRepository>][] = [
  ['localStorage', async () => new LocalStorageHistoryRepository()],
  [
    'IndexedDB',
    async () => {
      // A fresh database per test.
      const original = indexedDB.open.bind(indexedDB)
      const name = `hitorigoto-test-${idbCounter++}`
      vi.spyOn(indexedDB, 'open').mockImplementation((_n, v) => original(name, v))
      const repo = new IndexedDbHistoryRepository(await openDatabase())
      vi.restoreAllMocks()
      return repo
    },
  ],
]

beforeEach(() => localStorage.clear())

describe.each(backends)('%s repository', (_name, make) => {
  let repo: HistoryRepository
  beforeEach(async () => {
    repo = await make()
  })

  it('lists newest first and keeps the pinned flag in the index', async () => {
    await repo.save(thread('a', { updatedAt: 1 }))
    await repo.save(thread('b', { updatedAt: 3, pinned: true }))
    const list = await repo.list()
    expect(list.map(m => m.id)).toEqual(['b', 'a'])
    expect(list[0].pinned).toBe(true)
  })

  it('remove returns the deleted threads so they can be restored', async () => {
    await repo.save(thread('a'))
    await repo.save(thread('b'))
    const removed = await repo.remove(['a', 'b'])
    expect(removed.threads.map(t => t.id).sort()).toEqual(['a', 'b'])
    expect(await repo.list()).toEqual([])
    await repo.restore(removed)
    expect(await repo.list()).toHaveLength(2)
  })

  it('patch: rename marks the title as edited; pin toggles; empty rename ignored', async () => {
    await repo.save(thread('a'))
    await repo.patch('a', { title: '  new name ' })
    await repo.patch('a', { pinned: true })
    const t = (await repo.get('a'))!
    expect(t.title).toBe('new name')
    expect(t.titleEdited).toBe(true)
    expect((await repo.list())[0].pinned).toBe(true)
    await repo.patch('a', { pinned: false })
    expect((await repo.list())[0].pinned).toBeUndefined()
    await repo.patch('a', { title: '   ' })
    expect((await repo.get('a'))!.title).toBe('new name')
  })

  it('search matches titles, bodies and draft text case-insensitively', async () => {
    await repo.save(thread('a', { title: 'Cooking notes' }))
    await repo.save(thread('b', { messages: [msg('m', 'user', 'about the WEATHER', 1)] }))
    await repo.save(thread('c', { messages: [], draftSets: [draftSet('s', 'write about VOLCANOES')] }))
    expect((await repo.search('cooking')).map(m => m.id)).toEqual(['a'])
    expect((await repo.search('weather')).map(m => m.id)).toEqual(['b'])
    expect((await repo.search('volcanoes')).map(m => m.id)).toEqual(['c'])
    expect(await repo.search('nothing')).toEqual([])
    expect(await repo.search('  ')).toHaveLength(3)
  })

  it('clear removes all threads', async () => {
    await repo.save(thread('a'))
    await repo.clear()
    expect(await repo.list()).toEqual([])
    expect(await repo.get('a')).toBeNull()
  })

  it('draft sets: create a thread if needed, keep messages, remove', async () => {
    await repo.addDraftSet('new', draftSet('s1', 'a long prompt about something'), 'untitled')
    let t = (await repo.get('new'))!
    expect(t.messages).toEqual([])
    expect(t.title).toBe('a long prompt about something')
    expect(t.draftSets).toHaveLength(1)

    await repo.save({ ...t, messages: [msg('m1', 'user', 'hi', 1)] })
    await repo.addDraftSet('new', draftSet('s2'), 'untitled')
    t = (await repo.get('new'))!
    expect(t.messages).toHaveLength(1)
    expect(t.draftSets!.map(s => s.id)).toEqual(['s1', 's2'])

    await repo.removeDraftSet('new', 's1')
    await repo.removeDraftSet('new', 's2')
    expect((await repo.get('new'))!.draftSets).toBeUndefined()
  })

  describe('import strategies', () => {
    it('adds new threads', async () => {
      expect(await repo.importThreads([thread('a')], [], 'merge')).toEqual({ added: 1, merged: 0, copied: 0 })
    })

    it('merge unions messages and draft sets, keeping the user’s rename and pin', async () => {
      await repo.save(thread('a', { title: 'mine', titleEdited: true, pinned: true, draftSets: [draftSet('s1')] }))
      const incoming = thread('a', { title: 'theirs', updatedAt: 9000, messages: [msg('a-1', 'user', 'hello a', 1000), msg('a-3', 'user', 'later', 3000)], draftSets: [draftSet('s2')] })
      expect(await repo.importThreads([incoming], [], 'merge')).toEqual({ added: 0, merged: 1, copied: 0 })
      const t = (await repo.get('a'))!
      expect(t.messages.map(m => m.id)).toEqual(['a-1', 'a-2', 'a-3'])
      expect(t.draftSets!.map(s => s.id)).toEqual(['s1', 's2'])
      expect(t.title).toBe('mine')
      expect(t.pinned).toBe(true)
      expect(t.updatedAt).toBe(9000)
    })

    it('copy saves a colliding thread under a new id', async () => {
      await repo.save(thread('a'))
      expect(await repo.importThreads([thread('a')], [], 'copy')).toEqual({ added: 0, merged: 0, copied: 1 })
      expect(await repo.list()).toHaveLength(2)
      expect((await repo.get('a'))!.title).toBe('title a')
    })
  })
})

describe('localStorage repository specifics', () => {
  it('counts only this app’s keys in usage()', async () => {
    const repo = new LocalStorageHistoryRepository()
    localStorage.setItem('other', 'x'.repeat(1000))
    const before = (await repo.usage()).used
    await repo.save(thread('a'))
    const after = (await repo.usage()).used
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThan(1000)
  })

  it('clear keeps the language and onboarding preferences only', async () => {
    const repo = new LocalStorageHistoryRepository()
    localStorage.setItem('hitorigoto:lang', 'en')
    localStorage.setItem('hitorigoto:onboarded', '1')
    localStorage.setItem('unrelated', 'x')
    await repo.save(thread('a'))
    await repo.clear()
    expect(Object.keys(localStorage).sort()).toEqual(['hitorigoto:lang', 'hitorigoto:onboarded', 'unrelated'])
  })

  it('throws HistoryQuotaError and leaves storage consistent', async () => {
    const repo = new LocalStorageHistoryRepository()
    await repo.save(thread('a'))
    const real = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'hitorigoto:index') throw new DOMException('full', 'QuotaExceededError')
      return real.call(this, k, v)
    })
    await expect(repo.save(thread('b'))).rejects.toThrow(HistoryQuotaError)
    spy.mockRestore()
    expect(await repo.get('b')).toBeNull()
    expect((await repo.list()).map(m => m.id)).toEqual(['a'])
  })

  it('does not support images', async () => {
    const repo = new LocalStorageHistoryRepository()
    expect(repo.supportsImages).toBe(false)
    await expect(repo.putImage()).rejects.toThrow()
  })
})

describe('IndexedDB images', () => {
  let repo: HistoryRepository
  beforeEach(async () => {
    repo = await backends[1][1]()
  })

  it('stores and reads blobs', async () => {
    await repo.putImage(image('i1'))
    expect((await repo.getImage('i1'))?.type).toBe('image/png')
    expect(await repo.getImage('missing')).toBeNull()
  })

  it('deletes images only when no other thread references them, and undo restores them', async () => {
    await repo.putImage(image('shared'))
    await repo.putImage(image('only-a'))
    await repo.save(thread('a', { messages: [msg('a1', 'user', 'x', 1, ['shared', 'only-a'])] }))
    await repo.save(thread('b', { messages: [msg('b1', 'user', 'y', 1, ['shared'])] }))

    const removed = await repo.remove(['a'])
    expect(removed.images.map(i => i.id)).toEqual(['only-a'])
    expect(await repo.getImage('only-a')).toBeNull()
    expect(await repo.getImage('shared')).not.toBeNull()

    await repo.restore(removed)
    expect(await repo.getImage('only-a')).not.toBeNull()
    expect((await repo.get('a'))!.messages[0].images).toEqual(['shared', 'only-a'])
  })

  it('clear removes images too', async () => {
    await repo.putImage(image('i1'))
    await repo.clear()
    expect(await repo.getImage('i1')).toBeNull()
  })
})

describe('migration from localStorage', () => {
  const seed = async () => {
    const legacy = new LocalStorageHistoryRepository()
    await legacy.save(thread('a', { pinned: true }))
    await legacy.save(thread('b'))
    return legacy
  }
  const target = async () => (await backends[1][1]()) as IndexedDbHistoryRepository

  it('copies threads, sets the flag and clears localStorage', async () => {
    const legacy = await seed()
    const idb = await target()
    expect(await migrateFromLocalStorage(idb, legacy)).toEqual({ migrated: 2 })
    expect((await idb.list()).map(m => m.id).sort()).toEqual(['a', 'b'])
    expect((await idb.get('a'))!.pinned).toBe(true)
    expect(legacy.hasData()).toBe(false)
    expect(await idb.getFlag('migratedFromLocalStorage')).toBe(true)
  })

  it('does nothing when there is no legacy data or it already ran', async () => {
    const idb = await target()
    expect(await migrateFromLocalStorage(idb, new LocalStorageHistoryRepository())).toBeNull()
    const legacy = await seed()
    await migrateFromLocalStorage(idb, legacy)
    await seed()
    expect(await migrateFromLocalStorage(idb, legacy)).toBeNull()
  })

  it('keeps localStorage untouched when copying fails', async () => {
    const legacy = await seed()
    const idb = await target()
    vi.spyOn(idb, 'save').mockRejectedValueOnce(new Error('disk full'))
    expect(await migrateFromLocalStorage(idb, legacy)).toEqual({ failed: true })
    expect(legacy.hasData()).toBe(true)
    expect((await legacy.list()).map(m => m.id).sort()).toEqual(['a', 'b'])
    expect(await idb.getFlag('migratedFromLocalStorage')).toBe(false)
  })
})
