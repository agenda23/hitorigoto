import type { ThreadMessage } from '@assistant-ui/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetricsStore } from './metrics'
import { NanoSessions, SUMMARY_PROMPT, SYSTEM_PROMPT } from './nano'

type Att = { content: { type: 'image'; image: string }[] }
const msg = (id: string, role: 'user' | 'assistant', text: string, attachments?: Att[]) =>
  ({ id, role, content: [{ type: 'text', text }], attachments }) as unknown as ThreadMessage

/** u1 a1 u2 a2 u3 a3 (+ the new user message u4 as the last item). */
const conversation = (turns: number) =>
  Array.from({ length: turns }, (_, i) => [msg(`u${i + 1}`, 'user', `text u${i + 1}`), msg(`a${i + 1}`, 'assistant', `text a${i + 1}`)]).flat()

async function run(sessions: NanoSessions, messages: ThreadMessage[], signal = new AbortController().signal) {
  let last = ''
  const gen = sessions.adapter().run({ messages, abortSignal: signal } as never) as AsyncGenerator<{ content: { text: string }[] }>
  for await (const r of gen) last = r.content[0].text
  return last
}

type ApiStyle = 'input' | 'context'

class FakeSession implements LMSession {
  usage: number
  quota = 1000
  destroyed = false
  prompts: (string | LMMessage[])[] = []
  oncontextoverflow: ((e: Event) => void) | null = null
  constructor(
    public options: LMCreateOptions,
    usage: number,
    private reply: (s: FakeSession, input: string | LMMessage[]) => string | Error | DOMException,
    style: ApiStyle = 'input',
  ) {
    this.usage = usage * 1000
    // Chrome 148-ish: inputUsage / inputQuota. Chrome 154+: contextUsage / contextWindow.
    const [u, q] = style === 'input' ? ['inputUsage', 'inputQuota'] : ['contextUsage', 'contextWindow']
    Object.defineProperty(this, u, { get: () => this.usage, enumerable: true })
    Object.defineProperty(this, q, { get: () => this.quota, enumerable: true })
  }
  get isSummarizer() {
    return Object.values(SUMMARY_PROMPT).includes(this.options.initialPrompts?.[0]?.content as string)
  }
  promptStreaming(input: string | LMMessage[]) {
    this.prompts.push(input)
    const r = this.reply(this, input)
    return new ReadableStream<string>({
      start(c) {
        if (typeof r !== 'string') return c.error(r) // Error or DOMException (a different realm under jsdom)
        c.enqueue(r)
        c.close()
      },
    })
  }
  async clone(): Promise<LMSession> {
    return this
  }
  destroy() {
    this.destroyed = true
  }
}

function installModel(opts: { usage?: (o: LMCreateOptions) => number; reply?: (s: FakeSession, input: string | LMMessage[]) => string | Error | DOMException; style?: ApiStyle } = {}) {
  const sessions: FakeSession[] = []
  vi.stubGlobal('LanguageModel', {
    create: async (o: LMCreateOptions) => {
      const s = new FakeSession(o, opts.usage?.(o) ?? 0.1, opts.reply ?? (s => (s.isSummarizer ? 'SUMMARY TEXT' : 'ok')), opts.style)
      sessions.push(s)
      return s
    },
  })
  return {
    sessions,
    chats: () => sessions.filter(s => !s.isSummarizer),
    summarizers: () => sessions.filter(s => s.isSummarizer),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('session cache', () => {
  it('reuses one session across consecutive turns', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'hi')])
    await run(s, [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'ok'), msg('u2', 'user', 'again')])
    expect(m.sessions).toHaveLength(1)
  })

  it('rebuilds from the message list when the history no longer matches (edit / regenerate)', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'hi')])
    await run(s, [msg('u1', 'user', 'edited'), msg('a1', 'assistant', 'x'), msg('u2', 'user', 'again')].slice(2))
    expect(m.sessions).toHaveLength(2)
    expect(m.sessions[0].destroyed).toBe(true)
  })

  it('reports usage and quota', async () => {
    installModel({ usage: () => 0.25 })
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'hi')])
    expect(s.getState()).toEqual({ phase: 'idle', used: 250, quota: 1000, error: null })
  })
})

describe('custom instructions (preset)', () => {
  it('appends the preset content to the base system prompt', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    s.setPreset('関西弁で話す')
    await run(s, [msg('u1', 'user', 'hi')])
    const system = m.chats()[0].options.initialPrompts![0].content as string
    expect(system).toContain(SYSTEM_PROMPT.ja)
    expect(system).toContain('関西弁で話す')
  })

  it('omits the preset section entirely when none is set', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'hi')])
    expect(m.chats()[0].options.initialPrompts![0].content).toBe(SYSTEM_PROMPT.ja)
  })

  it('rebuilds the session when the preset changes', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'hi')])
    s.setPreset('be a pirate')
    await run(s, [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'ok'), msg('u2', 'user', 'again')])
    expect(m.sessions).toHaveLength(2)
    expect(m.sessions[0].destroyed).toBe(true)
  })

  it('setting the same preset again does not rebuild the cached session', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    s.setPreset('be a pirate')
    await run(s, [msg('u1', 'user', 'hi')])
    s.setPreset('be a pirate')
    s.setPreset(' be a pirate ') // trimmed to the same value
    await run(s, [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'ok'), msg('u2', 'user', 'again')])
    expect(m.sessions).toHaveLength(1)
  })

  it('an empty or whitespace-only preset is treated as "no preset"', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    s.setPreset('   ')
    await run(s, [msg('u1', 'user', 'hi')])
    expect(m.chats()[0].options.initialPrompts![0].content).toBe(SYSTEM_PROMPT.ja)
  })
})

describe('always-on global instruction', () => {
  it('applies regardless of the selected preset, ordered before it', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    s.setGlobalInstruction('be terse')
    s.setPreset('be a pirate')
    await run(s, [msg('u1', 'user', 'hi')])
    const system = m.chats()[0].options.initialPrompts![0].content as string
    expect(system).toBe(`${SYSTEM_PROMPT.ja}\n\nbe terse\n\nbe a pirate`)
  })

  it('applies even with no preset selected', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    s.setGlobalInstruction('be terse')
    await run(s, [msg('u1', 'user', 'hi')])
    expect(m.chats()[0].options.initialPrompts![0].content).toBe(`${SYSTEM_PROMPT.ja}\n\nbe terse`)
  })

  it('rebuilds the session when it changes, and a blank value clears it', async () => {
    const m = installModel()
    const s = new NanoSessions('ja')
    s.setGlobalInstruction('be terse')
    await run(s, [msg('u1', 'user', 'hi')])
    s.setGlobalInstruction('  ')
    await run(s, [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'ok'), msg('u2', 'user', 'again')])
    expect(m.sessions).toHaveLength(2)
    expect(m.chats()[1].options.initialPrompts![0].content).toBe(SYSTEM_PROMPT.ja)
  })
})

describe('context summarization', () => {
  const history = [...conversation(3), msg('u4', 'user', 'new question')]

  it('summarizes older turns when a rebuilt session is nearly full, keeping the latest four messages', async () => {
    const m = installModel({ usage: o => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.9) })
    const s = new NanoSessions('ja')
    const phases: string[] = []
    s.subscribe(() => phases.push(s.getState().phase))

    await run(s, history)

    expect(phases).toContain('summarizing')
    expect(phases.at(-1)).toBe('idle')
    // The summarizer saw only what is being folded away: u1 and a1.
    expect(String(m.summarizers()[0].prompts[0])).toContain('text u1')
    expect(String(m.summarizers()[0].prompts[0])).not.toContain('text u2')
    // The final chat session = system + summary, then u2 a2 u3 a3 verbatim.
    const final = m.chats().at(-1)!
    expect(final.options.initialPrompts![0].content).toContain('SUMMARY TEXT')
    expect(final.options.initialPrompts!.slice(1).map(p => p.content)).toEqual(['text u2', 'text a2', 'text u3', 'text a3'])
    expect(final.prompts).toEqual(['new question'])
  })

  it('summarizes before the next prompt when the cached session filled up during the last turn', async () => {
    const m = installModel({
      usage: o => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.5),
      reply: (s, input) => {
        if (s.isSummarizer) return 'SUMMARY TEXT'
        s.usage = 900 // every answer pushes the context over the threshold
        return `answer to ${String(input)}`
      },
    })
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'q1')])
    await run(s, [msg('u1', 'user', 'q1'), msg('a1', 'assistant', 'answer to q1'), msg('u2', 'user', 'q2')])
    expect(m.summarizers()).toHaveLength(0) // history was too short to be worth summarizing
    await run(s, [msg('u1', 'user', 'q1'), msg('a1', 'assistant', 'answer to q1'), msg('u2', 'user', 'q2'), msg('a2', 'assistant', 'answer to q2'), msg('u3', 'user', 'q3')])

    expect(m.summarizers()).toHaveLength(1)
    const final = m.chats().at(-1)!
    expect(final.options.initialPrompts![0].content).toContain('SUMMARY TEXT')
    expect(final.options.initialPrompts!.slice(1).map(p => p.content)).toEqual(['q2', 'answer to q2'])
    expect(final.prompts).toEqual(['q3'])
  })

  it('shrinks the verbatim tail when the latest messages are very long, so one summary is enough', async () => {
    // quota 1000, budget 0.4 => 400 estimated tokens; each long message is ~600.
    const long = 'あ'.repeat(800)
    const big = [msg('u1', 'user', 'early'), msg('a1', 'assistant', 'early answer'), msg('u2', 'user', long), msg('a2', 'assistant', long), msg('u3', 'user', long), msg('a3', 'assistant', long), msg('u4', 'user', 'new question')]
    const m = installModel({ usage: o => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.9) })
    const s = new NanoSessions('ja')
    await run(s, big)
    expect(m.summarizers()).toHaveLength(1)
    // Only the latest turn (u3, a3) stays verbatim, although four messages would be allowed.
    const final = m.chats().at(-1)!
    expect(final.options.initialPrompts!.slice(1).map(p => p.content)).toEqual([long, long])
  })


  it('folds a long transcript into the summary chunk by chunk', async () => {
    const m = installModel({ usage: o => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.9) })
    const s = new NanoSessions('ja')
    const long = 'あ'.repeat(4000) // budget = max(1500, quota * 0.5) = 1500 chars per chunk
    await run(s, [msg('u1', 'user', long), msg('a1', 'assistant', 'ok'), ...conversation(2), msg('u4', 'user', 'q')])
    expect(m.summarizers()[0].prompts.length).toBeGreaterThan(1)
  })

  it('on a quota error mid-prompt, summarizes and retries once', async () => {
    let failedOnce = false
    const m = installModel({
      reply: (s, input) => {
        if (s.isSummarizer) return 'SUMMARY TEXT'
        if (!failedOnce && input === 'new question') {
          failedOnce = true
          return new DOMException('too long', 'QuotaExceededError')
        }
        return 'recovered'
      },
    })
    const s = new NanoSessions('ja')
    expect(await run(s, history)).toBe('recovered')
    expect(m.summarizers()).toHaveLength(1)
    expect(m.chats()[0].destroyed).toBe(true)
  })

  it('rethrows other errors and drops the session', async () => {
    const m = installModel({ reply: () => new Error('boom') })
    const s = new NanoSessions('ja')
    await expect(run(s, [msg('u1', 'user', 'hi')])).rejects.toThrow('boom')
    expect(m.sessions[0].destroyed).toBe(true)
  })

  it('a language change drops the summary', async () => {
    const m = installModel({ usage: o => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.9) })
    const s = new NanoSessions('ja')
    await run(s, history)
    s.setLang('en')
    await run(s, history)
    // English rebuild starts from the full history again (and summarizes again with the English prompt).
    expect(JSON.stringify(m.chats().at(-1)!.options.initialPrompts)).toContain('SUMMARY TEXT')
    expect(m.summarizers().at(-1)!.options.initialPrompts![0].content).not.toBe(SUMMARY_PROMPT.ja)
  })
})

describe('Chrome 154+ API names (contextUsage / contextWindow / oncontextoverflow)', () => {
  const history = [...conversation(3), msg('u4', 'user', 'new question')]
  const summaryAware = (o: LMCreateOptions) => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.9)

  it('reports usage for the gauge', async () => {
    installModel({ style: 'context', usage: () => 0.4 })
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'hi')])
    expect(s.getState()).toEqual({ phase: 'idle', used: 400, quota: 1000, error: null })
  })

  it('summarizes when the context is nearly full', async () => {
    const m = installModel({ style: 'context', usage: summaryAware })
    const s = new NanoSessions('ja')
    await run(s, history)
    expect(m.summarizers()).toHaveLength(1)
    expect(m.chats().at(-1)!.options.initialPrompts![0].content).toContain('SUMMARY TEXT')
  })

  it('rebuilds with a summary after the model reports an overflow (it drops early messages silently)', async () => {
    const m = installModel({
      style: 'context',
      usage: o => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.5),
      reply: (s, input) => {
        if (s.isSummarizer) return 'SUMMARY TEXT'
        if (input === 'q2') s.oncontextoverflow?.(new Event('contextoverflow')) // usage stays low: only the event says so
        return 'answer'
      },
    })
    const s = new NanoSessions('ja')
    await run(s, [msg('u1', 'user', 'q1')])
    await run(s, [msg('u1', 'user', 'q1'), msg('a1', 'assistant', 'answer'), msg('u2', 'user', 'q2')])
    expect(m.summarizers()).toHaveLength(0)
    await run(s, [msg('u1', 'user', 'q1'), msg('a1', 'assistant', 'answer'), msg('u2', 'user', 'q2'), msg('a2', 'assistant', 'answer'), msg('u3', 'user', 'q3')])
    expect(m.summarizers()).toHaveLength(1)
    expect(m.chats().at(-1)!.options.initialPrompts![0].content).toContain('SUMMARY TEXT')
  })
})

describe('run metrics', () => {
  it('records timing and usage numbers, never the content', async () => {
    installModel({ usage: () => 0.25 })
    const store = new MetricsStore(null)
    await run(new NanoSessions('ja', false, store), [msg('u1', 'user', 'top secret question')])
    const [r] = store.runs()
    expect(r).toMatchObject({ ok: true, chars: 2, images: 0, used: 250, quota: 1000, summarized: false })
    expect(r.firstTokenMs).not.toBeNull()
    expect(r.setupMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('flags a run whose setup included summarizing', async () => {
    installModel({ usage: o => (JSON.stringify(o.initialPrompts).includes('SUMMARY TEXT') ? 0.3 : 0.9) })
    const store = new MetricsStore(null)
    await run(new NanoSessions('ja', false, store), [...conversation(3), msg('u4', 'user', 'new question')])
    expect(store.runs()[0].summarized).toBe(true)
  })

  it('records a failed run as not ok, with no first token', async () => {
    installModel({ reply: () => new Error('boom') })
    const store = new MetricsStore(null)
    await expect(run(new NanoSessions('ja', false, store), [msg('u1', 'user', 'hi')])).rejects.toThrow('boom')
    expect(store.runs()[0]).toMatchObject({ ok: false, firstTokenMs: null, chars: 0 })
  })

  it('does not record a run the user aborted', async () => {
    installModel({ reply: () => new Error('aborted') })
    const store = new MetricsStore(null)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(run(new NanoSessions('ja', false, store), [msg('u1', 'user', 'hi')], ctrl.signal)).rejects.toThrow()
    expect(store.runs()).toEqual([])
  })
})

describe('image input', () => {
  const png = 'data:image/png;base64,AAAA'

  it('sends the attached image to the model as a Blob and declares image input', async () => {
    const m = installModel()
    const s = new NanoSessions('ja', true)
    await run(s, [msg('u1', 'user', 'what is this?', [{ content: [{ type: 'image', image: png }] }])])
    const input = m.sessions[0].prompts[0] as LMMessage[]
    expect(m.sessions[0].options.expectedInputs).toContainEqual({ type: 'image' })
    expect(input[0].role).toBe('user')
    const parts = input[0].content as LMContentPart[]
    expect(parts[0]).toEqual({ type: 'text', value: 'what is this?' })
    expect(parts[1].type).toBe('image')
    expect((parts[1] as { value: Blob }).value.type).toBe('image/png')
  })

  it('ignores non-image or malformed attachments and does not declare image input when disabled', async () => {
    const m = installModel()
    const s = new NanoSessions('ja', false)
    await run(s, [msg('u1', 'user', 'hi', [{ content: [{ type: 'image', image: 'data:text/html;base64,AAAA' }] }])])
    expect(m.sessions[0].prompts[0]).toBe('hi')
    expect(m.sessions[0].options.expectedInputs).not.toContainEqual({ type: 'image' })
  })

  it('does not replay past images into a rebuilt session', async () => {
    const m = installModel()
    const s = new NanoSessions('ja', true)
    await run(s, [msg('u1', 'user', 'look', [{ content: [{ type: 'image', image: png }] }]), msg('a1', 'assistant', 'ok'), msg('u2', 'user', 'and now?')])
    expect(m.sessions[0].options.initialPrompts!.slice(1)).toEqual([
      { role: 'user', content: 'look' },
      { role: 'assistant', content: 'ok' },
    ])
  })
  it('sends a default text with an image-only turn instead of an empty text part', async () => {
    const m = installModel()
    const s = new NanoSessions('ja', true)
    await run(s, [msg('u1', 'user', '', [{ content: [{ type: 'image', image: png }] }])])
    const parts = (m.sessions[0].prompts[0] as LMMessage[])[0].content as LMContentPart[]
    expect(parts[0]).toEqual({ type: 'text', value: 'この画像について説明してください。' })
    expect(parts.every(p => p.type !== 'text' || p.value.trim() !== '')).toBe(true)
  })

  it('keeps an image-only past turn as a placeholder so roles keep alternating in a rebuilt session', async () => {
    const m = installModel()
    const s = new NanoSessions('en', true)
    await run(s, [msg('u1', 'user', '', [{ content: [{ type: 'image', image: png }] }]), msg('a1', 'assistant', 'A cat.'), msg('u2', 'user', 'and now?')])
    expect(m.sessions[0].options.initialPrompts!.slice(1)).toEqual([
      { role: 'user', content: '(image attached)' },
      { role: 'assistant', content: 'A cat.' },
    ])
  })

  it('records why a run failed and clears it on the next run', async () => {
    let fail = true
    installModel({ reply: () => (fail ? new DOMException('image not supported', 'NotSupportedError') : 'ok') })
    const s = new NanoSessions('ja', true)
    await expect(run(s, [msg('u1', 'user', 'hi')])).rejects.toThrow()
    expect(s.getState().error).toBe('NotSupportedError: image not supported')
    fail = false
    await run(s, [msg('u1', 'user', 'hi')])
    expect(s.getState().error).toBeNull()
  })
})
