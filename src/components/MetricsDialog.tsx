import { useState, useSyncExternalStore } from 'react'
import { useI18n } from '../lib/i18n'
import { metrics, summarize, tokensPerSecond, type RunMetric } from '../lib/metrics'
import { Dialog } from './Dialog'

const SHOWN_RUNS = 20

/** Debug panel: how long the model took, from local records only (spec §7.1). */
export function MetricsDialog({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n()
  const runs = useSyncExternalStore(metrics.subscribe, metrics.runs)
  const [copied, setCopied] = useState(false)
  const s = summarize(runs)
  const recent = [...runs].reverse().slice(0, SHOWN_RUNS)

  const stats: [string, string][] = [
    [t.metricsStats.runs, String(s.count)],
    [t.metricsStats.firstMedian, s.firstTokenMedianMs === null ? '–' : t.metricsSec(s.firstTokenMedianMs)],
    [t.metricsStats.firstP90, s.firstTokenP90Ms === null ? '–' : t.metricsSec(s.firstTokenP90Ms)],
    [t.metricsStats.speed, s.tokensPerSecMedian === null ? '–' : t.metricsSpeed(s.tokensPerSecMedian)],
    [t.metricsStats.setup, s.setupMedianMs === null ? '–' : t.metricsSec(s.setupMedianMs)],
    [t.metricsStats.summaries, String(s.summarizations)],
  ]

  const flags = (r: RunMetric) => [r.summarized && t.metricsFlags.summarized, r.images > 0 && t.metricsFlags.image, !r.ok && t.metricsFlags.failed].filter(Boolean).join(' · ')

  return (
    <Dialog title={t.metricsTitle} onClose={onClose} wide>
      <div className="space-y-5 text-sm leading-relaxed">
        <p className="text-muted-foreground">{t.metricsIntro}</p>

        {runs.length === 0 ? (
          <p className="rounded-xl bg-muted px-4 py-3" data-metrics-empty>{t.metricsEmpty}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-metrics-summary>
              {stats.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {s.firstTokenP90Ms !== null && <p className="rounded-xl bg-muted px-4 py-3">{t.metricsAdvice((s.firstTokenP90Ms / 1000).toFixed(1))}</p>}

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[40rem] text-left text-xs" data-metrics-table>
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    {t.metricsCols.map(c => (
                      <th key={c} className="px-3 py-2 font-medium">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recent.map(r => {
                    const speed = tokensPerSecond(r)
                    return (
                      <tr key={r.at}>
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(r.at).toLocaleTimeString(lang)}</td>
                        <td className="px-3 py-2">{t.metricsSec(r.setupMs)}</td>
                        <td className="px-3 py-2">{r.firstTokenMs === null ? '–' : t.metricsSec(r.firstTokenMs)}</td>
                        <td className="px-3 py-2">{t.metricsSec(r.genMs)}</td>
                        <td className="px-3 py-2">{r.chars}</td>
                        <td className="px-3 py-2">{speed === null ? '–' : t.metricsSpeed(speed)}</td>
                        <td className="px-3 py-2">{r.quota ? `${Math.round((r.used / r.quota) * 100)}%` : '–'}</td>
                        <td className="px-3 py-2">{flags(r)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">{t.metricsEstimateNote}</p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full border border-border px-4 py-1.5 transition-colors hover:bg-foreground/5"
                onClick={() => void navigator.clipboard?.writeText(JSON.stringify(runs, null, 2)).then(() => setCopied(true))}
              >
                {copied ? t.copied : t.metricsCopy}
              </button>
              <button type="button" className="rounded-full border border-border px-4 py-1.5 text-danger transition-colors hover:bg-foreground/5" onClick={() => metrics.clear()}>
                {t.metricsClear}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
