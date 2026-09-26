import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { GuideDialog, type GuideTab } from '../components/GuideDialog'

const SEEN_KEY = 'hitorigoto:onboarded'

const hasSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}
const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* storage unavailable: the guide simply shows again next time */
  }
}

type Guide = { open: (tab?: GuideTab, anchor?: string) => void }
const Ctx = createContext<Guide | null>(null)

/**
 * Owns the guide modal. It opens by itself once on the first visit (remembered in localStorage,
 * which "delete all history" deliberately leaves alone), and from the header / diagnostic screens.
 */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; tab: GuideTab; anchor?: string }>({ open: false, tab: 'about' })

  const open = useCallback((tab: GuideTab = 'about', anchor?: string) => setState({ open: true, tab, anchor }), [])
  const close = useCallback(() => {
    markSeen()
    setState(s => ({ ...s, open: false }))
  }, [])

  useEffect(() => {
    if (!hasSeen()) open('about')
  }, [open])

  const value = useMemo(() => ({ open }), [open])
  return (
    <Ctx.Provider value={value}>
      {children}
      {state.open && <GuideDialog tab={state.tab} anchor={state.anchor} onTab={tab => setState(s => ({ ...s, tab, anchor: undefined }))} onClose={close} />}
    </Ctx.Provider>
  )
}

export function useGuide() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGuide must be used inside GuideProvider')
  return v
}
