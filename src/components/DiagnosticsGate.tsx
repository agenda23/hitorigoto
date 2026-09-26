import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { checkModel, downloadModel, type ModelState } from '../lib/diagnostics'
import { useI18n } from '../lib/i18n'
import { useGuide } from '../lib/guide-context'
import { CopyText } from './CopyText'
import { Header } from './Header'

const INTERNALS_URL = 'chrome://on-device-internals'

function Card({ title, children }: { title: string; children: ReactNode }) {
  const guide = useGuide()
  const { t } = useI18n()
  return (
    <>
      <Header />
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <section className="mx-auto my-10 max-w-xl space-y-4 rounded-2xl border border-border bg-muted/40 p-6 leading-relaxed">
          <h2 className="font-serif text-2xl">{title}</h2>
          {children}
          <button type="button" className="text-sm text-primary underline-offset-4 hover:underline" onClick={() => guide.open('setup')}>
            {t.guideSetupLink}
          </button>
        </section>
      </div>
    </>
  )
}

/** Renders children only once the on-device model is available; otherwise explains why not. */
export function DiagnosticsGate({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<ModelState | null>(null)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)

  const recheck = useCallback(async () => setState(await checkModel(lang)), [lang])
  useEffect(() => {
    void recheck()
  }, [recheck])

  const startDownload = () => {
    setFailed(false)
    setProgress(0)
    setState({ kind: 'downloading' })
    downloadModel(lang, setProgress).then(recheck, () => {
      setFailed(true)
      void recheck()
    })
  }

  if (!state)
    return (
      <>
        <Header />
        <p className="p-6 text-muted-foreground" role="status">{t.diagChecking}</p>
      </>
    )
  if (state.kind === 'available') return <>{children}</>

  const checkAddress = (
    <p className="space-y-2 text-sm text-muted-foreground">
      {t.diagStateCheck}
      <br />
      <CopyText text={INTERNALS_URL} />
    </p>
  )
  const note = <p className="text-sm text-muted-foreground">{t.cannotFallback}</p>

  if (state.kind === 'no-api')
    return (
      <Card title={t.diagNoApiTitle}>
        <p>{t.diagNoApiBody}</p>
        {note}
      </Card>
    )
  if (state.kind === 'downloadable')
    return (
      <Card title={t.diagDownloadableTitle}>
        <p>{t.diagDownloadableBody}</p>
        {failed && <p role="alert">{t.diagDownloadFailed}</p>}
        <button type="button" className="rounded-full bg-primary px-5 py-2 text-primary-foreground transition-opacity hover:opacity-90" onClick={startDownload}>
          {t.diagDownload}
        </button>
        {checkAddress}
        {note}
      </Card>
    )
  if (state.kind === 'downloading')
    return (
      <Card title={t.diagDownloadingTitle}>
        <progress className="h-2 w-full accent-primary" max={1} value={progress} aria-label={t.diagDownloadingTitle} />
        <p role="status" aria-live="polite">{Math.round(progress * 100)}%</p>
        {checkAddress}
        {note}
      </Card>
    )
  return (
    <Card title={t.diagUnavailableTitle}>
      <p>{t.diagUnavailableLead}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {t.req.map(r => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {checkAddress}
      <button type="button" className="rounded-full border border-border px-4 py-1.5 text-sm transition-colors hover:bg-foreground/5" onClick={() => void recheck()}>
        {t.diagRecheck}
      </button>
      {note}
    </Card>
  )
}
