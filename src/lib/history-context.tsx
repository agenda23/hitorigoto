import { createContext, useContext, type ReactNode } from 'react'
import type { HistoryRepository } from './history'

const Ctx = createContext<HistoryRepository | null>(null)

export function HistoryProvider({ repo, children }: { repo: HistoryRepository; children: ReactNode }) {
  return <Ctx.Provider value={repo}>{children}</Ctx.Provider>
}

export function useHistory() {
  const repo = useContext(Ctx)
  if (!repo) throw new Error('useHistory must be used inside HistoryProvider')
  return repo
}
