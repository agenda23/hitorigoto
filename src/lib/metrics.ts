// Local-only response-time metrics (spec §7.1): numbers about each run, never its content.
// They live in localStorage on this device and are shown in the debug panel; nothing is sent.

export type RunMetric = {
  at: number
  /** Time to get a ready session (building it, and summarizing if the context was full). */
  setupMs: number
  /** Whether that setup included summarizing. */
  summarized: boolean
  /** From sending the prompt to the first streamed text: mostly the model reading the input. */
  firstTokenMs: number | null
  /** From the first to the last streamed text. */
  genMs: number
  chars: number
  /** Context usage after the run, and the window size (0 when the browser does not report them). */
  used: number
  quota: number
  images: number
  ok: boolean
}

const KEY = 'hitorigoto:metrics'
const MAX_RUNS = 100

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export class MetricsStore {
  private cache: RunMetric[] | null = null
  private listeners = new Set<() => void>()

  constructor(private storage: Storage | null) {}

  // useSyncExternalStore contract: `runs` returns the same array until something changes.
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  runs = (): RunMetric[] => {
    if (!this.cache) {
      try {
        const parsed: unknown = JSON.parse(this.storage?.getItem(KEY) ?? '[]')
        this.cache = Array.isArray(parsed) ? (parsed as RunMetric[]) : []
      } catch {
        this.cache = []
      }
    }
    return this.cache
  }

  add(run: RunMetric) {
    this.set([...this.runs(), run].slice(-MAX_RUNS))
  }

  clear() {
    this.set([])
  }

  private set(runs: RunMetric[]) {
    this.cache = runs
    try {
      this.storage?.setItem(KEY, JSON.stringify(runs))
    } catch {
      /* metrics are best effort: keep them in memory when storage is full or unavailable */
    }
    this.listeners.forEach(l => l())
  }
}

const browserStorage = (): Storage | null => {
  try {
    return localStorage
  } catch {
    return null
  }
}

export const metrics = new MetricsStore(browserStorage())

/** Rough token estimate (deliberately high; see nano.ts). Only used to give a speed figure. */
export const estimateTokens = (chars: number) => Math.ceil(chars * 0.75)

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

/** Estimated tokens per second while streaming; null when the run was too short to mean anything. */
export const tokensPerSecond = (r: RunMetric) => (r.ok && r.genMs >= 300 && r.chars >= 20 ? estimateTokens(r.chars) / (r.genMs / 1000) : null)

export type MetricsSummary = {
  count: number
  firstTokenMedianMs: number | null
  firstTokenP90Ms: number | null
  tokensPerSecMedian: number | null
  setupMedianMs: number | null
  summarizations: number
}

export function summarize(runs: RunMetric[]): MetricsSummary {
  const ok = runs.filter(r => r.ok)
  const firstTokens = ok.flatMap(r => (r.firstTokenMs === null ? [] : [r.firstTokenMs]))
  const speeds = ok.flatMap(r => tokensPerSecond(r) ?? [])
  return {
    count: runs.length,
    firstTokenMedianMs: percentile(firstTokens, 50),
    firstTokenP90Ms: percentile(firstTokens, 90),
    tokensPerSecMedian: percentile(speeds, 50),
    setupMedianMs: percentile(runs.map(r => r.setupMs), 50),
    summarizations: runs.filter(r => r.summarized).length,
  }
}
