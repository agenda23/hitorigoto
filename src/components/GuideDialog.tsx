import { useEffect, useState, type KeyboardEvent } from 'react'
import { checkModel, type ModelState } from '../lib/diagnostics'
import { guideContent, type GuideSection, type ModelStatusKey } from '../lib/guide-content'
import { useI18n } from '../lib/i18n'
import { CopyText } from './CopyText'
import { Dialog } from './Dialog'

export type GuideTab = 'about' | 'setup' | 'usage'
const TABS: GuideTab[] = ['about', 'setup', 'usage']
const INTERNALS_URL = 'chrome://on-device-internals'

/** Label / explanation rows in a bordered table. */
function FactList({ facts }: { facts: [string, string][] }) {
  return (
    <dl className="divide-y divide-border rounded-xl border border-border">
      {facts.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[8.5rem_1fr] sm:gap-4">
          <dt className="font-medium">{k}</dt>
          <dd className="text-muted-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Sections({ sections }: { sections: GuideSection[] }) {
  return (
    <div className="space-y-5">
      {sections.map(s => (
        <section key={s.heading} id={s.id ? `guide-${s.id}` : undefined} className="scroll-mt-2 space-y-1.5">
          <h3 className="font-medium">{s.heading}</h3>
          {s.body && <p className="text-muted-foreground">{s.body}</p>}
          {s.facts && <FactList facts={s.facts} />}
          {s.items && (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {s.items.map(i => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

const statusKey = (state: ModelState | null): ModelStatusKey => (state ? state.kind : 'loading')
const dotClass: Record<ModelStatusKey, string> = {
  loading: 'bg-muted-foreground',
  available: 'bg-primary',
  downloadable: 'bg-muted-foreground',
  downloading: 'bg-muted-foreground',
  unavailable: 'bg-danger',
  'no-api': 'bg-danger',
}

function Setup() {
  const { lang } = useI18n()
  const c = guideContent[lang].setup
  const [state, setState] = useState<ModelState | null>(null)
  useEffect(() => {
    let alive = true
    void checkModel(lang).then(s => alive && setState(s))
    return () => {
      alive = false
    }
  }, [lang])
  const key = statusKey(state)

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">{c.intro}</p>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4" role="status" data-model-status={key}>
        <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dotClass[key]}`} aria-hidden="true" />
        <div>
          <p className="text-xs text-muted-foreground">{c.statusLabel}</p>
          <p>{c.status[key]}</p>
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="font-medium">{c.stepsHeading}</h3>
        <ol className="space-y-3">
          {c.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">{c.requirementsHeading}</h3>
        <FactList facts={c.requirements} />
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">{c.checkHeading}</h3>
        <p className="text-muted-foreground">{c.check}</p>
        <CopyText text={INTERNALS_URL} />
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">{c.troubleHeading}</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {c.trouble.map(t => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** First-run welcome and reference: what the app is, one-time setup (model download), and usage. */
export function GuideDialog({ tab, anchor, onTab, onClose }: { tab: GuideTab; anchor?: string; onTab: (t: GuideTab) => void; onClose: () => void }) {
  const { lang } = useI18n()
  const c = guideContent[lang]
  const index = TABS.indexOf(tab)
  const last = index === TABS.length - 1

  // Opened for one specific topic (e.g. from the sidebar): scroll to it once the tab is shown.
  useEffect(() => {
    if (anchor) document.getElementById(`guide-${anchor}`)?.scrollIntoView({ block: 'start' })
  }, [anchor, tab])

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = TABS[(index + step + TABS.length) % TABS.length]
    onTab(next)
    document.getElementById(`guide-tab-${next}`)?.focus()
  }

  return (
    <Dialog title={c.title} onClose={onClose}>
      <div className="space-y-5 text-sm leading-relaxed">
        <div role="tablist" aria-label={c.title} className="flex gap-1 border-b border-border" onKeyDown={onKeyDown}>
          {TABS.map((id, i) => (
            <button
              key={id}
              id={`guide-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls="guide-panel"
              tabIndex={tab === id ? 0 : -1}
              className={`-mb-px border-b-2 px-3 py-2 transition-colors ${tab === id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => onTab(id)}
            >
              <span className="mr-1.5 text-xs opacity-60">{i + 1}</span>
              {c.tabs[i]}
            </button>
          ))}
        </div>

        <div id="guide-panel" role="tabpanel" aria-labelledby={`guide-tab-${tab}`} className="min-h-72">
          {tab === 'about' && <Sections sections={c.about} />}
          {tab === 'setup' && <Setup />}
          {tab === 'usage' && <Sections sections={c.usage} />}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="hidden text-xs text-muted-foreground sm:block">{last ? c.closeHint : ''}</p>
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <button type="button" className="rounded-full border border-border px-4 py-1.5 transition-colors hover:bg-foreground/5" onClick={() => onTab(TABS[index - 1])}>
                {c.back}
              </button>
            )}
            {last ? (
              <button type="button" className="rounded-full bg-primary px-5 py-1.5 text-primary-foreground transition-opacity hover:opacity-90" onClick={onClose}>
                {c.start}
              </button>
            ) : (
              <button type="button" className="rounded-full bg-primary px-5 py-1.5 text-primary-foreground transition-opacity hover:opacity-90" onClick={() => onTab(TABS[index + 1])}>
                {c.next}
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
