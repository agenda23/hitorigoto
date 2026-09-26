import { useState } from 'react'
import { useI18n, type Lang } from '../lib/i18n'
import { useGuide } from '../lib/guide-context'
import { HelpIcon, ShieldIcon, SidebarIcon } from './icons'
import { VerifyDialog } from './VerifyDialog'

export function Header({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { t, lang, setLang } = useI18n()
  const [verifyOpen, setVerifyOpen] = useState(false)
  const guide = useGuide()
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-3">
      {onToggleSidebar && (
        <button
          type="button"
          className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label={t.toggleSidebar}
          title={t.toggleSidebar}
          onClick={onToggleSidebar}
        >
          <SidebarIcon />
        </button>
      )}
      <h1 className="font-serif text-lg">{t.appName}</h1>
      <div className="flex-1" />
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        aria-label={t.guideOpenLabel}
        title={t.guideOpenLabel}
        onClick={() => guide.open('about')}
      >
        <HelpIcon />
        <span className="hidden sm:inline">{t.guideOpen}</span>
      </button>
      <button
        type="button"
        className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground sm:flex"
        title={t.verifyOpen}
        aria-label={`${[t.badgeOnDevice, t.badgeOffline, t.badgeZeroSent].join(' · ')} — ${t.verifyOpen}`}
        onClick={() => setVerifyOpen(true)}
      >
        <ShieldIcon />
        {[t.badgeOnDevice, t.badgeOffline, t.badgeZeroSent].join(' · ')}
      </button>
      <select
        className="rounded-lg bg-transparent px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5"
        value={lang}
        aria-label={t.language}
        onChange={e => setLang(e.target.value as Lang)}
      >
        <option value="ja">日本語</option>
        <option value="en">English</option>
      </select>
      {verifyOpen && <VerifyDialog onClose={() => setVerifyOpen(false)} />}
    </header>
  )
}
