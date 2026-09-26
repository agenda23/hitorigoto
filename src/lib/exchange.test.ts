import { describe, expect, it } from 'vitest'
import { ImportError, exportAll, parseImport, threadToMarkdown } from './exchange'
import type { HistoryRepository, Thread } from './history'

const msg = (id: string, role: 'user' | 'assistant', text: string, images?: string[]) => ({ id, role, text, createdAt: 1, images })
const thread = (id: string, over: Partial<Thread> = {}): Thread => ({
  id,
  title: `title ${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  messages: [msg(`${id}-1`, 'user', `hello ${id}`), msg(`${id}-2`, 'assistant', `reply ${id}`)],
  ...over,
})

const file = (over: Record<string, unknown>) => JSON.stringify({ format: 'hitorigoto-export', version: 2, threads: [], images: {}, ...over })
const PNG_B64 = btoa('png-bytes')

describe('export / import round trip', () => {
  it('embeds referenced images and restores them, dropping references to missing ones', async () => {
    const t = thread('a', { messages: [msg('m1', 'user', 'look', ['img1', 'gone'])], draftSets: [{ id: 's', prompt: 'p', createdAt: 3, drafts: [{ temperature: 0.2, text: 'x' }] }] })
    const repo = {
      all: async () => [t],
      getImage: async (id: string) => (id === 'img1' ? new Blob(['png-bytes'], { type: 'image/png' }) : null),
    } as unknown as HistoryRepository

    const parsed = parseImport(await exportAll(repo))
    expect(parsed.images.map(i => i.id)).toEqual(['img1'])
    expect(parsed.images[0].blob.type).toBe('image/png')
    expect(parsed.threads[0].messages[0].images).toEqual(['img1'])
    expect(parsed.threads[0].draftSets).toEqual(t.draftSets)
  })

  it('still accepts version 1 files (threads only)', () => {
    const v1 = JSON.stringify({ format: 'hitorigoto-export', version: 1, threads: [thread('a')] })
    expect(parseImport(v1).threads).toHaveLength(1)
  })
})

describe('import validation', () => {
  it.each([
    ['not json', '{'],
    ['wrong format', JSON.stringify({ format: 'other', version: 2, threads: [] })],
    ['wrong version', file({ version: 99 })],
    ['bad thread', file({ threads: [{ id: 1 }] })],
    ['bad role', file({ threads: [thread('a', { messages: [{ id: 'x', role: 'system', text: 't', createdAt: 1 } as never] })] })],
    ['bad draft set', file({ threads: [{ ...thread('a'), draftSets: [{ id: 's' }] }] })],
    ['image with a disallowed type', file({ images: { i: { type: 'image/svg+xml', data: PNG_B64 } } })],
    ['image that is not base64', file({ images: { i: { type: 'image/png', data: '***' } } })],
    ['oversized image', file({ images: { i: { type: 'image/png', data: 'A'.repeat(15_000_000) } } })],
  ])('rejects %s', (_name, text) => {
    expect(() => parseImport(text)).toThrow(ImportError)
  })

  it('drops unknown fields and truncates huge titles', () => {
    const evil = { ...thread('a', { title: 'x'.repeat(5000) }), __proto__: { polluted: 1 }, extra: 'ignored' }
    const [t] = parseImport(file({ threads: [evil] })).threads
    expect(t.title).toHaveLength(200)
    expect('extra' in t).toBe(false)
  })
})

describe('threadToMarkdown', () => {
  const labels = { user: 'You', assistant: 'AI', images: (n: number) => `[${n} image(s)]` }
  it('renders messages', () => {
    expect(threadToMarkdown(thread('a'), labels)).toBe('# title a\n\n## You\n\nhello a\n\n## AI\n\nreply a\n')
  })
  it('notes attached images', () => {
    expect(threadToMarkdown(thread('a', { messages: [msg('m', 'user', 'see', ['i1', 'i2'])] }), labels)).toContain('## You\n\n[2 image(s)]\n\nsee')
  })
})
