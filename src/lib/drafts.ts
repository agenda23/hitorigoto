// Multi-draft generation: the same prompt run several times at different temperatures.
// There is no per-request cost or rate limit on-device, so this is a feature a SaaS can't offer.
import { sessionOptions } from './diagnostics'
import type { Lang } from './i18n'
import { SYSTEM_PROMPT } from './nano'

/**
 * Used when the browser has no `LanguageModel.params()` (e.g. Chrome 154). The values are accepted
 * without error, but on such browsers the model may ignore them, so the UI says so.
 */
export const FALLBACK_PARAMS: LMParams = { defaultTemperature: 1, maxTemperature: 2, defaultTopK: 3, maxTopK: 8 }

const LOW = 0.2
const HIGH = 1.5

/** Spreads `count` temperatures from conservative to adventurous, within the model's limits. */
export function draftTemperatures(count: number, params: LMParams | null): (number | undefined)[] {
  // Without params() the API rejects a lone temperature, so let the model use its defaults.
  if (!params) return Array.from({ length: count }, () => undefined)
  if (count <= 1) return [params.defaultTemperature]
  const high = Math.min(params.maxTemperature, HIGH)
  const low = Math.min(LOW, high)
  return Array.from({ length: count }, (_, i) => Math.round((low + ((high - low) * i) / (count - 1)) * 10) / 10)
}

export type DraftState = { temperature?: number; text: string; status: 'waiting' | 'running' | 'done' | 'error' | 'stopped' }

/** Runs the drafts one after another (a small on-device model should not be loaded in parallel). */
export async function generateDrafts(opts: {
  prompt: string
  lang: Lang
  temperatures: (number | undefined)[]
  topK?: number
  signal: AbortSignal
  onUpdate: (index: number, state: DraftState) => void
}): Promise<void> {
  const { prompt, lang, temperatures, topK, signal, onUpdate } = opts
  if (typeof LanguageModel === 'undefined') throw new Error('LanguageModel is not available')
  temperatures.forEach((temperature, i) => onUpdate(i, { temperature, text: '', status: 'waiting' }))
  for (let i = 0; i < temperatures.length; i++) {
    const temperature = temperatures[i]
    if (signal.aborted) {
      onUpdate(i, { temperature, text: '', status: 'stopped' })
      continue
    }
    let text = ''
    onUpdate(i, { temperature, text, status: 'running' })
    let session: LMSession | undefined
    try {
      session = await LanguageModel.create({
        ...sessionOptions(lang),
        initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT[lang] }],
        ...(temperature !== undefined && topK !== undefined ? { temperature, topK } : {}),
        signal,
      })
      for await (const chunk of session.promptStreaming(prompt, { signal })) {
        text += chunk
        onUpdate(i, { temperature, text, status: 'running' })
      }
      onUpdate(i, { temperature, text, status: 'done' })
    } catch {
      onUpdate(i, { temperature, text, status: signal.aborted ? 'stopped' : 'error' })
    } finally {
      session?.destroy()
    }
  }
}
