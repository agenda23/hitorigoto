import type { ChatModelAdapter, ThreadMessage } from '@assistant-ui/react'
import { sessionOptions } from './diagnostics'
import type { Lang } from './i18n'
import { dataUrlToBlob } from './images'
import { metrics, type MetricsStore } from './metrics'

export const SYSTEM_PROMPT: Record<Lang, string> = {
  ja: 'あなたは親切で簡潔なアシスタントです。日本語で答えてください。',
  en: 'You are a helpful, concise assistant. Answer in English.',
}
export const SUMMARY_PROMPT: Record<Lang, string> = {
  ja: 'あなたは会話を要約する係です。「これまでの要約」と「新しい会話」を統合し、事実・決定事項・固有名詞・ユーザーの意図を保ったまま、300 字以内の日本語で 1 つの要約にまとめてください。要約だけを出力してください。',
  en: 'You summarize conversations. Merge the "Summary so far" and the "New conversation" into one summary of at most 150 words, keeping facts, decisions, names and the user’s intent. Output only the summary.',
}
const SUMMARY_INTRO: Record<Lang, string> = {
  ja: '以下はこれまでの会話の要約です。会話の文脈として参照してください。',
  en: 'The following summarizes the conversation so far. Use it as context.',
}
const LABELS: Record<Lang, { summary: string; fresh: string; user: string; assistant: string }> = {
  ja: { summary: 'これまでの要約', fresh: '新しい会話', user: 'ユーザー', assistant: 'アシスタント' },
  en: { summary: 'Summary so far', fresh: 'New conversation', user: 'User', assistant: 'Assistant' },
}

/** What a user turn is called when it consists of an image only (the API rejects empty text parts). */
const IMAGE_ONLY_PROMPT: Record<Lang, string> = { ja: 'この画像について説明してください。', en: 'Describe this image.' }
const IMAGE_ONLY_HISTORY: Record<Lang, string> = { ja: '（画像を添付）', en: '(image attached)' }

/** Summarize once the context is this full (the spec's example threshold). */
export const COMPRESS_THRESHOLD = 0.8
/** How many of the latest messages stay verbatim; the smaller value is the last resort. */
export const KEEP_MESSAGES = [4, 2]
/**
 * The verbatim tail may also take at most this share of the context window (in estimated tokens),
 * matching `KEEP_MESSAGES`: a few very long messages would otherwise leave the rebuilt session
 * still nearly full and force another round of slow summarizing. At least the last two messages
 * (the latest turn) are always kept.
 */
export const TAIL_BUDGET = [0.4, 0.2]
const FALLBACK_WINDOW = 9216

/** Rough token estimate, deliberately on the high side (Japanese runs about 0.65 tokens per character). */
const estimateTokens = (text: string) => Math.ceil(text.length * 0.75)

export type SessionState = { phase: 'idle' | 'summarizing'; used: number; quota: number; /** Why the last run failed, for display. */ error: string | null }

const textOf = (m: ThreadMessage) => m.content.map(p => (p.type === 'text' ? p.text : '')).join('')

/** Blobs of the images attached to a user message. */
function imagesOf(m: ThreadMessage): Blob[] {
  const attachments = 'attachments' in m ? (m.attachments ?? []) : []
  return attachments.flatMap(a => (a.content ?? []).flatMap(c => (c.type === 'image' ? (dataUrlToBlob(c.image) ?? []) : [])))
}

// Past images are not replayed into rebuilt sessions: they would eat the small context window.
// An image-only user turn is kept as a short placeholder so user/assistant turns still alternate.
const toPrompts = (messages: readonly ThreadMessage[], lang: Lang): LMMessage[] =>
  messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: textOf(m) || (m.role === 'user' && imagesOf(m).length ? IMAGE_ONLY_HISTORY[lang] : '') }))
    .filter(p => p.content)

const describeError = (e: unknown) => (e instanceof Error || (typeof e === 'object' && e !== null && 'name' in e) ? `${(e as Error).name}: ${(e as Error).message}` : String(e))

/** Context usage / size, under either API generation (`contextUsage`/`contextWindow`, or `inputUsage`/`inputQuota`). */
const usageOf = (s: LMSession) => s.contextUsage ?? s.inputUsage ?? 0
const quotaOf = (s: LMSession) => s.contextWindow ?? s.inputQuota ?? 0

const isQuotaError = (e: unknown) => typeof e === 'object' && e !== null && (e as { name?: string }).name === 'QuotaExceededError'

type Cached = { session: LMSession; consumed: number }

/**
 * The app's own message list is the source of truth. A Nano session is only a cache: it is
 * reused while it has consumed exactly the messages before the new user turn, and rebuilt
 * from the messages otherwise (edit / regenerate / reload / abort / language change).
 *
 * When the context fills up (`inputUsage / inputQuota` above the threshold, or the model
 * reports a quota error), older turns are summarized and the session is rebuilt as
 * "summary + the latest few messages".
 */
export class NanoSessions {
  private cached: Cached | null = null
  private generation = 0
  /** The model reported a context overflow: it dropped early messages, so rebuild from our own list. */
  private overflowed = false
  /** Covers every message up to and including `upToId`. Valid only while that message is still in the history. */
  private summary: { text: string; upToId: string } | null = null
  /** Custom instructions (persona/tone/rules), appended to the base system prompt. */
  private preset: string | null = null
  /** Always-on instructions, applied regardless of the selected preset. */
  private globalInstruction: string | null = null
  private state: SessionState = { phase: 'idle', used: 0, quota: 0, error: null }
  private listeners = new Set<() => void>()

  /** How many times older turns were summarized (lets a run tell whether its setup included summarizing). */
  private summarizations = 0

  constructor(
    private lang: Lang,
    private images = false,
    private metricsStore: MetricsStore = metrics,
  ) {}

  // useSyncExternalStore contract
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  getState = () => this.state

  private setState(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(l => l())
  }

  private report(session: LMSession) {
    this.setState({ used: usageOf(session), quota: quotaOf(session) })
  }

  private ratio(session: LMSession) {
    const quota = quotaOf(session)
    return quota ? usageOf(session) / quota : 0
  }

  setLang(lang: Lang) {
    if (lang === this.lang) return
    this.lang = lang
    this.summary = null
    this.destroy()
  }

  /** Changes the custom instructions prepended to the system prompt. Keeps any existing summary. */
  setPreset(content: string | null) {
    const next = content?.trim() || null
    if (next === this.preset) return
    this.preset = next
    this.destroy()
  }

  /** Changes the always-on instructions. Keeps any existing summary. */
  setGlobalInstruction(content: string | null) {
    const next = content?.trim() || null
    if (next === this.globalInstruction) return
    this.globalInstruction = next
    this.destroy()
  }

  private create(options: Omit<LMCreateOptions, 'expectedInputs' | 'expectedOutputs'>) {
    if (typeof LanguageModel === 'undefined') throw new Error('LanguageModel is not available')
    return LanguageModel.create({ ...sessionOptions(this.lang, this.images), ...options })
  }

  /** Splits the history into the part covered by the current summary and the messages still sent verbatim. */
  private recentAfterSummary(history: readonly ThreadMessage[]) {
    if (this.summary) {
      const i = history.findIndex(m => m.id === this.summary!.upToId)
      if (i >= 0) return history.slice(i + 1)
      this.summary = null // the summarized part was edited away
    }
    return history
  }

  private async build(history: readonly ThreadMessage[], signal?: AbortSignal): Promise<Cached> {
    const recent = this.recentAfterSummary(history)
    const parts = [SYSTEM_PROMPT[this.lang]]
    if (this.globalInstruction) parts.push(this.globalInstruction)
    if (this.preset) parts.push(this.preset)
    if (this.summary) parts.push(`${SUMMARY_INTRO[this.lang]}\n${this.summary.text}`)
    const session = await this.create({ initialPrompts: [{ role: 'system', content: parts.join('\n\n') }, ...toPrompts(recent, this.lang)], signal })
    session.oncontextoverflow = () => {
      this.overflowed = true
    }
    this.report(session)
    return { session, consumed: history.length }
  }

  /** Builds a session; if the history does not fit, or nearly fills the context, summarizes first. */
  private async buildFitting(history: readonly ThreadMessage[], signal?: AbortSignal): Promise<Cached> {
    const smallest = KEEP_MESSAGES[KEEP_MESSAGES.length - 1]
    let entry: Cached
    try {
      entry = await this.build(history, signal)
    } catch (e) {
      if (!isQuotaError(e) || history.length <= smallest) throw e
      return this.compress(history, signal)
    }
    if (this.ratio(entry.session) > COMPRESS_THRESHOLD && history.length > smallest) {
      entry.session.destroy()
      return this.compress(history, signal)
    }
    return entry
  }

  /** Summarizes older turns, then rebuilds the session from "summary + recent messages". */
  private async compress(history: readonly ThreadMessage[], signal?: AbortSignal): Promise<Cached> {
    this.destroy()
    this.overflowed = false
    this.setState({ phase: 'summarizing' })
    try {
      for (let k = 0; k < KEEP_MESSAGES.length; k++) {
        const cut = this.tailStart(history, k)
        if (cut <= 0 || cut >= history.length) continue
        const summarizedUpTo = this.summary ? history.findIndex(m => m.id === this.summary!.upToId) + 1 : 0
        if (cut > summarizedUpTo) {
          const text = await this.summarize(this.summary?.text ?? '', history.slice(summarizedUpTo, cut), signal)
          this.summary = { text, upToId: history[cut - 1].id }
          this.summarizations++
        }
        const entry = await this.build(history, signal)
        if (this.ratio(entry.session) <= COMPRESS_THRESHOLD || k === KEEP_MESSAGES.length - 1) return entry
        entry.session.destroy()
      }
      return await this.build(history, signal)
    } finally {
      this.setState({ phase: 'idle' })
    }
  }

  /** Index where the verbatim tail starts: at most KEEP_MESSAGES[k] messages within the token budget, on a user turn. */
  private tailStart(history: readonly ThreadMessage[], k: number) {
    const budget = TAIL_BUDGET[k] * (this.state.quota || FALLBACK_WINDOW)
    const estimate = (from: number) => history.slice(from).reduce((n, m) => n + estimateTokens(textOf(m)), 0)
    let cut = Math.max(0, history.length - KEEP_MESSAGES[k])
    while (cut < history.length - 2 && estimate(cut) > budget) cut++
    while (cut < history.length && history[cut].role !== 'user') cut++
    return cut
  }

  private async summarize(previous: string, messages: readonly ThreadMessage[], signal?: AbortSignal): Promise<string> {
    const L = LABELS[this.lang]
    const session = await this.create({ initialPrompts: [{ role: 'system', content: SUMMARY_PROMPT[this.lang] }], signal })
    try {
      // Fold the transcript into the summary chunk by chunk so each request fits the context.
      const budget = Math.max(1500, Math.floor((quotaOf(session) || 4000) * 0.5))
      const lines = messages.flatMap(m => ((m.role === 'user' || m.role === 'assistant') && textOf(m) ? [`${m.role === 'user' ? L.user : L.assistant}: ${textOf(m)}`] : []))
      const chunks: string[] = []
      let current = ''
      for (const line of lines) {
        for (let i = 0; i < line.length; i += budget) {
          const part = line.slice(i, i + budget)
          if (current && current.length + part.length > budget) {
            chunks.push(current)
            current = ''
          }
          current += (current ? '\n' : '') + part
        }
      }
      if (current) chunks.push(current)

      let running = previous
      for (const chunk of chunks) {
        let out = ''
        for await (const piece of session.promptStreaming(`${running ? `${L.summary}:\n${running}\n\n` : ''}${L.fresh}:\n${chunk}`, { signal })) out += piece
        running = out.trim() || running
      }
      return running
    } finally {
      session.destroy()
    }
  }

  /** Warms up an empty session while the user is still typing. */
  async warmup() {
    if (this.cached) return
    const generation = this.generation
    try {
      const entry = await this.build([])
      // destroy() ran while the model was loading: this session is stale.
      if (generation !== this.generation || this.cached) entry.session.destroy()
      else this.cached = entry
    } catch {
      /* the first real run reports the error */
    }
  }

  destroy() {
    this.generation++
    this.cached?.session.destroy()
    this.cached = null
  }

  /** Stores timing numbers for the debug panel (never the content). */
  private recordRun(r: { tStart: number; tPrompt: number; setupMs: number; summarizationsBefore: number; firstAt: number | null; out: string; images: number; ok: boolean }) {
    const end = performance.now()
    const session = this.cached?.session
    this.metricsStore.add({
      at: Date.now(),
      setupMs: Math.round(r.setupMs),
      summarized: this.summarizations > r.summarizationsBefore,
      firstTokenMs: r.firstAt === null ? null : Math.round(r.firstAt - r.tPrompt),
      genMs: r.firstAt === null ? 0 : Math.round(end - r.firstAt),
      chars: r.out.length,
      used: session ? usageOf(session) : 0,
      quota: session ? quotaOf(session) : 0,
      images: r.images,
      ok: r.ok,
    })
  }

  adapter(): ChatModelAdapter {
    const self = this
    const smallest = KEEP_MESSAGES[KEEP_MESSAGES.length - 1]
    return {
      async *run({ messages, abortSignal }) {
        const history = messages.slice(0, -1)
        const last = messages[messages.length - 1]
        const blobs = imagesOf(last)
        const text = textOf(last).trim() || (blobs.length ? IMAGE_ONLY_PROMPT[self.lang] : '')
        self.setState({ error: null })
        const input: string | LMMessage[] = blobs.length
          ? [{ role: 'user', content: [{ type: 'text', value: text }, ...blobs.map(value => ({ type: 'image' as const, value }))] }]
          : text

        const tStart = performance.now()
        const summarizationsBefore = self.summarizations
        try {
          if (!self.cached || self.cached.consumed !== history.length) {
            self.destroy()
            self.cached = await self.buildFitting(history, abortSignal)
          } else if ((self.overflowed || self.ratio(self.cached.session) > COMPRESS_THRESHOLD) && history.length > smallest) {
            self.cached = await self.compress(history, abortSignal)
          }
        } catch (e) {
          if (!abortSignal.aborted) {
            self.setState({ error: describeError(e) })
            self.recordRun({ tStart, tPrompt: performance.now(), setupMs: performance.now() - tStart, summarizationsBefore, firstAt: null, out: '', images: blobs.length, ok: false })
          }
          throw e
        }
        let setupMs = performance.now() - tStart

        for (let attempt = 0; ; attempt++) {
          const entry = self.cached!
          const tPrompt = performance.now()
          let firstAt: number | null = null
          let out = ''
          try {
            for await (const chunk of entry.session.promptStreaming(input, { signal: abortSignal })) {
              firstAt ??= performance.now()
              out += chunk
              yield { content: [{ type: 'text' as const, text: out }] }
            }
            entry.consumed = history.length + 2
            self.report(entry.session)
            self.recordRun({ tStart, tPrompt, setupMs, summarizationsBefore, firstAt, out, images: blobs.length, ok: true })
            return
          } catch (e) {
            // The context overflowed mid-conversation: summarize and retry once.
            if (attempt === 0 && !abortSignal.aborted && isQuotaError(e) && history.length > smallest) {
              const tCompress = performance.now()
              self.cached = await self.compress(history, abortSignal)
              setupMs += performance.now() - tCompress
              continue
            }
            // An aborted or failed prompt leaves the session in an unknown state: rebuild next time.
            self.destroy()
            if (!abortSignal.aborted) {
              self.setState({ error: describeError(e) })
              self.recordRun({ tStart, tPrompt, setupMs, summarizationsBefore, firstAt, out, images: blobs.length, ok: false })
            }
            throw e
          }
        }
      },
    }
  }
}
