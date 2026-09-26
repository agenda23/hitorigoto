import { describe, expect, it, vi } from 'vitest'
import { MetricsStore, percentile, summarize, tokensPerSecond, type RunMetric } from './metrics'

const run = (over: Partial<RunMetric> = {}): RunMetric => ({ at: 1, setupMs: 10, summarized: false, firstTokenMs: 1000, genMs: 2000, chars: 200, used: 100, quota: 1000, images: 0, ok: true, ...over })

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data }
}

describe('percentile', () => {
  it('handles empty, single and ordered inputs', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([7], 90)).toBe(7)
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
  })
})

describe('tokensPerSecond', () => {
  it('estimates from characters and generation time', () => {
    expect(tokensPerSecond(run({ chars: 200, genMs: 2000 }))).toBe(75) // 150 tokens / 2 s
  })
  it('is null for runs too short to mean anything, and for failures', () => {
    expect(tokensPerSecond(run({ genMs: 100 }))).toBeNull()
    expect(tokensPerSecond(run({ chars: 5 }))).toBeNull()
    expect(tokensPerSecond(run({ ok: false }))).toBeNull()
  })
})

describe('summarize', () => {
  it('reports medians, the 90th percentile and how often summarizing ran', () => {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => run({ firstTokenMs: n * 1000, summarized: n === 10, setupMs: n }))
    const s = summarize(runs)
    expect(s.count).toBe(10)
    expect(s.firstTokenMedianMs).toBe(5000)
    expect(s.firstTokenP90Ms).toBe(9000)
    expect(s.summarizations).toBe(1)
    expect(s.setupMedianMs).toBe(5)
  })
  it('ignores failed runs for speeds and is empty-safe', () => {
    expect(summarize([run({ ok: false, firstTokenMs: null })]).firstTokenMedianMs).toBeNull()
    expect(summarize([])).toMatchObject({ count: 0, firstTokenMedianMs: null, tokensPerSecMedian: null })
  })
})

describe('MetricsStore', () => {
  it('persists, keeps only the latest runs, and clears', () => {
    const mem = memory()
    const store = new MetricsStore(mem)
    for (let i = 0; i < 105; i++) store.add(run({ at: i }))
    expect(store.runs()).toHaveLength(100)
    expect(store.runs()[0].at).toBe(5)
    expect(new MetricsStore(mem).runs()).toHaveLength(100) // reloaded from storage
    store.clear()
    expect(store.runs()).toEqual([])
    expect(JSON.parse(mem.data.get('hitorigoto:metrics')!)).toEqual([])
  })

  it('returns a stable array until something changes (useSyncExternalStore needs that) and notifies', () => {
    const store = new MetricsStore(memory())
    const a = store.runs()
    expect(store.runs()).toBe(a)
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.add(run())
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.runs()).not.toBe(a)
    off()
    store.add(run())
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('survives corrupt data and a missing or full storage', () => {
    const corrupt = memory()
    corrupt.data.set('hitorigoto:metrics', '{not json')
    expect(new MetricsStore(corrupt).runs()).toEqual([])
    const noStorage = new MetricsStore(null)
    noStorage.add(run())
    expect(noStorage.runs()).toHaveLength(1)
    const full = new MetricsStore({ getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError') }, removeItem: () => {} })
    expect(() => full.add(run())).not.toThrow()
    expect(full.runs()).toHaveLength(1)
  })
})
