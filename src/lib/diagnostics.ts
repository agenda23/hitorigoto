import type { Lang } from './i18n'

export type ModelState =
  | { kind: 'no-api' }
  | { kind: 'unavailable' }
  | { kind: 'downloadable' }
  | { kind: 'downloading' }
  | { kind: 'available' }

export function sessionOptions(lang: Lang, images = false) {
  return {
    expectedInputs: [
      { type: 'text' as const, languages: ['en', 'ja'] },
      ...(images ? [{ type: 'image' as const }] : []),
    ],
    expectedOutputs: [{ type: 'text' as const, languages: [lang] }],
  }
}

/** Image input is optional: it is offered only when the model reports it as immediately available. */
export async function checkImageSupport(lang: Lang): Promise<boolean> {
  if (typeof LanguageModel === 'undefined') return false
  try {
    return (await LanguageModel.availability(sessionOptions(lang, true))) === 'available'
  } catch {
    return false
  }
}

export async function checkModel(lang: Lang): Promise<ModelState> {
  if (typeof LanguageModel === 'undefined' || !('LanguageModel' in self)) return { kind: 'no-api' }
  try {
    return { kind: await LanguageModel.availability(sessionOptions(lang)) }
  } catch {
    return { kind: 'unavailable' }
  }
}

/** Starts the model download. Must be called from a user gesture (click / key press). */
export async function downloadModel(lang: Lang, onProgress: (ratio: number) => void): Promise<void> {
  if (typeof LanguageModel === 'undefined') throw new Error('LanguageModel is not available')
  const session = await LanguageModel.create({
    ...sessionOptions(lang),
    monitor(m) {
      m.addEventListener('downloadprogress', e => onProgress((e as Event & { loaded: number }).loaded))
    },
  })
  session.destroy()
}
