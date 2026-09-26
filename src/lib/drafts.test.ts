import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_PARAMS, draftTemperatures, generateDrafts, type DraftState } from './drafts'

const params: LMParams = { defaultTemperature: 1, maxTemperature: 2, defaultTopK: 3, maxTopK: 8 }

describe('draftTemperatures', () => {
  it('spreads from low to high', () => {
    expect(draftTemperatures(3, params)).toEqual([0.2, 0.9, 1.5])
  })
  it('never exceeds the model maximum', () => {
    expect(draftTemperatures(3, { ...params, maxTemperature: 1 })).toEqual([0.2, 0.6, 1])
    expect(Math.max(...(draftTemperatures(4, { ...params, maxTemperature: 0.1 }) as number[]))).toBeLessThanOrEqual(0.1)
  })
  it('uses the default for a single draft', () => {
    expect(draftTemperatures(1, params)).toEqual([1])
  })
  it('the fallback range (used when the browser has no params()) spreads the same way', () => {
    expect(draftTemperatures(3, FALLBACK_PARAMS)).toEqual([0.2, 0.9, 1.5])
  })
  it('leaves temperature to the model when params() is unavailable', () => {
    expect(draftTemperatures(3, null)).toEqual([undefined, undefined, undefined])
  })
})

describe('generateDrafts', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubModel = (reply: (n: number) => string[] | Error) => {
    const created: LMCreateOptions[] = []
    let destroyed = 0
    vi.stubGlobal('LanguageModel', {
      create: async (o: LMCreateOptions) => {
        const n = created.push(o)
        return {
          promptStreaming: () => {
            const r = reply(n)
            return new ReadableStream<string>({
              start(c) {
                if (r instanceof Error) return c.error(r)
                r.forEach(x => c.enqueue(x))
                c.close()
              },
            })
          },
          destroy: () => void destroyed++,
        }
      },
    })
    return { created, destroyed: () => destroyed }
  }

  it('runs sequentially, passes temperature + topK, and destroys every session', async () => {
    const m = stubModel(n => [`draft`, `${n}`])
    const last: Record<number, DraftState> = {}
    await generateDrafts({ prompt: 'p', lang: 'ja', temperatures: [0.2, 1.5], topK: 3, signal: new AbortController().signal, onUpdate: (i, s) => (last[i] = s) })
    expect(m.created.map(o => [o.temperature, o.topK])).toEqual([[0.2, 3], [1.5, 3]])
    expect(last[0]).toMatchObject({ text: 'draft1', status: 'done', temperature: 0.2 })
    expect(last[1]).toMatchObject({ text: 'draft2', status: 'done' })
    expect(m.destroyed()).toBe(2)
  })

  it('does not pass a lone temperature', async () => {
    const m = stubModel(() => ['x'])
    await generateDrafts({ prompt: 'p', lang: 'en', temperatures: [undefined], topK: 3, signal: new AbortController().signal, onUpdate: () => {} })
    expect(m.created[0]).not.toHaveProperty('temperature')
  })

  it('marks a failing draft as error and continues with the next', async () => {
    stubModel(n => (n === 1 ? new Error('boom') : ['ok']))
    const last: Record<number, DraftState> = {}
    await generateDrafts({ prompt: 'p', lang: 'ja', temperatures: [0.2, 0.9], topK: 3, signal: new AbortController().signal, onUpdate: (i, s) => (last[i] = s) })
    expect(last[0].status).toBe('error')
    expect(last[1]).toMatchObject({ status: 'done', text: 'ok' })
  })

  it('marks remaining drafts as stopped after abort', async () => {
    stubModel(() => ['x'])
    const ctrl = new AbortController()
    ctrl.abort()
    const last: Record<number, DraftState> = {}
    await generateDrafts({ prompt: 'p', lang: 'ja', temperatures: [0.2, 0.9], topK: 3, signal: ctrl.signal, onUpdate: (i, s) => (last[i] = s) })
    expect(last[0].status).toBe('stopped')
    expect(last[1].status).toBe('stopped')
  })
})
