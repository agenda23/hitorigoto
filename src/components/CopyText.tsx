import { useState } from 'react'
import { useI18n } from '../lib/i18n'

/** Text that a web page cannot link to (e.g. chrome:// URLs), with a copy button. */
export function CopyText({ text }: { text: string }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <span className="inline-flex items-center gap-2">
      <code className="rounded-md bg-muted px-2 py-1 text-sm">{text}</code>
      <button
        type="button"
        className="rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:bg-foreground/5"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setDone(true))
        }}
      >
        {done ? t.copied : t.copy}
      </button>
    </span>
  )
}
