import { useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { FALLBACK_PARAMS, draftTemperatures, generateDrafts, type DraftState } from '../lib/drafts'
import type { DraftSet } from '../lib/history'
import { useI18n } from '../lib/i18n'
import { Dialog } from './Dialog'

const MAX_COUNT = 4

type Props = {
  initialPrompt: string
  /** Earlier runs saved with this chat, oldest first. */
  sets: DraftSet[]
  onSaveSet: (set: DraftSet) => void
  onDeleteSet: (id: string) => void
  onClose: () => void
  /** Puts a draft into the composer. */
  onUse: (text: string) => void
  /** Adds the prompt and a draft to the conversation as a user / assistant message pair. */
  onAdopt: (prompt: string, text: string) => void
}

/** Same input, several temperatures, side by side. Runs are saved with the chat and can be reopened. */
export function DraftsDialog({ initialPrompt, sets, onSaveSet, onDeleteSet, onClose, onUse, onAdopt }: Props) {
  const { t, lang } = useI18n()
  const [prompt, setPrompt] = useState(initialPrompt)
  const [count, setCount] = useState(3)
  const [drafts, setDrafts] = useState<DraftState[]>([])
  const [running, setRunning] = useState(false)
  const [params, setParams] = useState<LMParams | null>(null)
  const controller = useRef<AbortController | null>(null)
  // The prompt the visible drafts were generated from (the textarea may have been edited since).
  const shownPrompt = useRef(initialPrompt)

  useEffect(() => {
    void LanguageModel?.params?.().then(setParams, () => {})
    return () => controller.current?.abort()
  }, [])

  const run = async () => {
    const ctrl = new AbortController()
    controller.current = ctrl
    setRunning(true)
    shownPrompt.current = prompt
    const latest: DraftState[] = []
    try {
      await generateDrafts({
        prompt,
        lang,
        temperatures: draftTemperatures(count, params ?? FALLBACK_PARAMS),
        topK: (params ?? FALLBACK_PARAMS).defaultTopK,
        signal: ctrl.signal,
        onUpdate: (i, state) => {
          latest[i] = state
          setDrafts(prev => Object.assign([...prev], { [i]: state }))
        },
      })
    } finally {
      setRunning(false)
      // Save whatever was produced, so closing the dialog no longer loses it.
      const produced = latest.filter(d => d.text)
      if (produced.length) onSaveSet({ id: crypto.randomUUID(), prompt, createdAt: Date.now(), drafts: produced.map(d => ({ temperature: d.temperature, text: d.text })) })
    }
  }

  const show = (set: DraftSet) => {
    setPrompt(set.prompt)
    shownPrompt.current = set.prompt
    setDrafts(set.drafts.map(d => ({ ...d, status: 'done' as const })))
  }

  const statusText = (s: DraftState['status']) => ({ waiting: t.draftsWaiting, running: t.draftsRunning, done: '', error: t.draftsError, stopped: t.draftsStopped })[s]
  const newestFirst = [...sets].reverse()

  return (
    <Dialog title={t.draftsTitle} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t.draftsIntro}</p>
        {!params && <p className="text-xs text-muted-foreground" data-temp-note>{t.draftsTempNote}</p>}
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t.draftsPrompt}</span>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-xl border border-border bg-transparent px-3 py-2 leading-relaxed outline-none focus:border-muted-foreground/60"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            {t.draftsCount}
            <select className="rounded-lg border border-border bg-transparent px-2 py-1" value={count} disabled={running} onChange={e => setCount(Number(e.target.value))}>
              {Array.from({ length: MAX_COUNT - 1 }, (_, i) => i + 2).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {running ? (
            <button type="button" className="rounded-full bg-foreground px-5 py-1.5 text-sm text-background" onClick={() => controller.current?.abort()}>
              {t.draftsStop}
            </button>
          ) : (
            <button type="button" className="rounded-full bg-primary px-5 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40" disabled={!prompt.trim()} onClick={() => void run()}>
              {t.draftsGenerate}
            </button>
          )}
          {running && <span className="text-xs text-muted-foreground" role="status" aria-live="polite">{t.onDeviceWorking}</span>}
        </div>

        {drafts.length > 0 && (
          <div className={`grid gap-3 ${drafts.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            {drafts.map((d, i) => (
              <article key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-4" data-draft>
                <header className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t.draftsDraftN(i + 1)}</span>
                  <span>{d.temperature !== undefined ? t.draftsTemp(d.temperature) : ''}</span>
                </header>
                <div className="min-h-16 flex-1 text-sm leading-relaxed">
                  <Streamdown disallowedElements={['img']} mode="streaming">{d.text}</Streamdown>
                  {statusText(d.status) && <p className="text-xs text-muted-foreground">{statusText(d.status)}</p>}
                </div>
                {d.text && d.status !== 'running' && (
                  <footer className="flex flex-wrap gap-2">
                    <button type="button" className="rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:bg-foreground/5" onClick={() => void navigator.clipboard?.writeText(d.text)}>
                      {t.copy}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:bg-foreground/5"
                      onClick={() => {
                        onUse(d.text)
                        onClose()
                      }}
                    >
                      {t.draftsUse}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:bg-foreground/5"
                      onClick={() => {
                        onAdopt(shownPrompt.current, d.text)
                        onClose()
                      }}
                    >
                      {t.draftsAdopt}
                    </button>
                  </footer>
                )}
              </article>
            ))}
          </div>
        )}

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">{t.draftsHistory}</h3>
          {newestFirst.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.draftsNoHistory}</p>
          ) : (
            <ul className="space-y-1" data-draft-history>
              {newestFirst.map(set => (
                <li key={set.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-foreground/5">
                  <span className="min-w-0 flex-1 truncate" title={set.prompt}>{set.prompt}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t.draftsSetCount(set.drafts.length)} · {new Date(set.createdAt).toLocaleDateString(lang)}
                  </span>
                  <button type="button" className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-foreground/5 disabled:opacity-40" disabled={running} onClick={() => show(set)}>
                    {t.draftsShow}
                  </button>
                  <button type="button" className="shrink-0 rounded-lg px-2 py-1 text-xs text-danger hover:bg-foreground/5" onClick={() => onDeleteSet(set.id)}>
                    {t.draftsDelete}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  )
}
