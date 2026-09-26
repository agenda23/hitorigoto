// Minimal typings for Chrome's Prompt API (`LanguageModel`). The API surface differs across
// Chrome versions, so everything is feature-detected at runtime.
type LMAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'
type LMRole = 'system' | 'user' | 'assistant'

type LMContentPart = { type: 'text'; value: string } | { type: 'image'; value: Blob }
interface LMMessage {
  role: LMRole
  content: string | LMContentPart[]
}

interface LMCreateOptions {
  initialPrompts?: LMMessage[]
  temperature?: number
  topK?: number
  expectedInputs?: { type: 'text' | 'image'; languages?: string[] }[]
  expectedOutputs?: { type: 'text'; languages?: string[] }[]
  signal?: AbortSignal
  monitor?: (m: EventTarget) => void
}

interface LMSession {
  readonly inputUsage?: number
  readonly inputQuota?: number
  promptStreaming(input: string | LMMessage[], options?: { signal?: AbortSignal }): ReadableStream<string>
  clone(options?: { signal?: AbortSignal }): Promise<LMSession>
  destroy(): void
}

interface LMParams {
  defaultTemperature: number
  maxTemperature: number
  defaultTopK: number
  maxTopK: number
}

interface LMStatic {
  params?(): Promise<LMParams | null>
  availability(options?: Omit<LMCreateOptions, 'signal' | 'monitor' | 'initialPrompts'>): Promise<LMAvailability>
  create(options?: LMCreateOptions): Promise<LMSession>
}

declare var LanguageModel: LMStatic | undefined
