import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  SimpleImageAttachmentAdapter,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { Streamdown } from 'streamdown'
import { HistoryQuotaError, type DraftSet, type PromptPreset, type StoredMessage, type Thread } from '../lib/history'
import { useHistory } from '../lib/history-context'
import { useI18n } from '../lib/i18n'
import { MAX_IMAGE_BYTES, blobToDataUrl, dataUrlToBlob } from '../lib/images'
import { NanoSessions, type SessionState } from '../lib/nano'
import { DraftsDialog } from './DraftsDialog'
import { ArrowUpIcon, ColumnsIcon, CopyIcon, ImageIcon, RefreshIcon, StopIcon } from './icons'

// After the first token, 15 s of silence looks like a stall. Before it, the model may just be
// reading a long input (tens of seconds on-device), so be much more patient.
const STALL_AFTER_FIRST_TOKEN_MS = 15_000
const STALL_BEFORE_FIRST_TOKEN_MS = 120_000
const TITLE_MAX = 40

// Remote images are disabled in addition to the CSP: an LLM-emitted `![](https://…?q=…)`
// would otherwise make the browser issue a request (see CLAUDE.md).
const TextPart = memo(function TextPart({ text }: { text: string }) {
  const role = useAuiState(s => s.message.role)
  if (role === 'user') return <p className="whitespace-pre-wrap">{text}</p>
  return (
    <Streamdown disallowedElements={['img']} mode="streaming">
      {text}
    </Streamdown>
  )
})

const actionButton = 'grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

/** Data URL of an attachment: complete ones carry it, pending ones are read from the file. */
function useAttachmentUrl(attachment: { content?: readonly { type: string; image?: string }[]; file?: File }) {
  const fromContent = attachment.content?.find(c => c.type === 'image')?.image
  const [fromFile, setFromFile] = useState<string>()
  const file = attachment.file
  useEffect(() => {
    if (fromContent || !file) return
    let alive = true
    void blobToDataUrl(file).then(url => alive && setFromFile(url))
    return () => {
      alive = false
    }
  }, [fromContent, file])
  return fromContent ?? fromFile
}

function AttachmentThumb({ className }: { className: string }) {
  const { t } = useI18n()
  const attachment = useAuiState(s => s.attachment)
  const url = useAttachmentUrl(attachment)
  return url ? <img src={url} alt={t.imageAlt} className={className} /> : <span className={className} />
}

function ComposerAttachment() {
  const { t } = useI18n()
  return (
    <AttachmentPrimitive.Root className="group relative">
      <AttachmentThumb className="size-16 rounded-xl border border-border bg-muted object-cover" />
      <AttachmentPrimitive.Remove
        className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-xs text-background"
        aria-label={t.removeAttachment}
        title={t.removeAttachment}
      >
        ×
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  )
}

function MessageImage() {
  return (
    <AttachmentPrimitive.Root>
      <AttachmentThumb className="max-h-56 max-w-full rounded-xl border border-border object-contain" />
    </AttachmentPrimitive.Root>
  )
}

function Message() {
  const { t } = useI18n()
  const role = useAuiState(s => s.message.role)
  if (role === 'user')
    return (
      <MessagePrimitive.Root className="ml-auto flex max-w-[80%] flex-col items-end gap-2">
        <div className="flex flex-wrap justify-end gap-2 empty:hidden">
          <MessagePrimitive.Attachments components={{ Attachment: MessageImage }} />
        </div>
        <div className="rounded-3xl bg-user-bubble px-4 py-2.5 leading-relaxed empty:hidden">
          <MessagePrimitive.Parts components={{ Text: TextPart }} />
        </div>
      </MessagePrimitive.Root>
    )
  return (
    <MessagePrimitive.Root className="leading-relaxed">
      <MessagePrimitive.Parts components={{ Text: TextPart }} />
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="mt-1 -ml-2 flex gap-0.5">
        <ActionBarPrimitive.Copy className={actionButton} aria-label={t.copyMessage} title={t.copyMessage}>
          <CopyIcon />
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload className={actionButton} aria-label={t.regenerate} title={t.regenerate}>
          <RefreshIcon />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

function EmptyState() {
  const { t } = useI18n()
  const aui = useAui()
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 pb-16 text-center">
      <h2 className="font-serif text-3xl sm:text-4xl">{t.greeting}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t.tagline}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {t.suggestions.map(sg => (
          <button
            key={sg.label}
            type="button"
            className="rounded-full border border-border px-4 py-1.5 text-sm transition-colors hover:bg-muted"
            onClick={() => {
              aui.composer().setText(sg.prompt)
              document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
            }}
          >
            {sg.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Shows what is happening while waiting (thinking / summarizing / stalled / error) and the context gauge. */
function RunStatus({ session }: { session: SessionState }) {
  const { t } = useI18n()
  const isRunning = useAuiState(s => s.thread.isRunning)
  const last = useAuiState(s => s.thread.messages.at(-1))
  const textLength = last?.role === 'assistant' ? last.content.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0) : 0
  const failed = last?.role === 'assistant' && last.status?.type === 'incomplete' && last.status.reason === 'error'

  // State (not refs): when the phase or the text changes, the very next render must already see the
  // reset, otherwise time spent summarizing briefly counts as "no response" for the next wait.
  const [startedAt, setStartedAt] = useState(0)
  const [lastChange, setLastChange] = useState(0)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!isRunning) return
    const t = Date.now()
    setStartedAt(t)
    setLastChange(t)
    setNow(t)
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [isRunning])
  useEffect(() => {
    const t = Date.now()
    setLastChange(t)
    setNow(t)
  }, [textLength, session.phase])

  const summarizing = isRunning && session.phase === 'summarizing'
  let message = ''
  if (summarizing) message = t.summarizing
  else if (isRunning) {
    const elapsed = Math.floor((now - startedAt) / 1000)
    if (now - lastChange > (textLength > 0 ? STALL_AFTER_FIRST_TOKEN_MS : STALL_BEFORE_FIRST_TOKEN_MS)) message = t.stalled
    else if (textLength === 0) message = elapsed >= 3 ? t.thinkingElapsed(elapsed) : t.thinking
  } else if (failed) message = t.runError

  const pct = session.quota ? Math.min(100, Math.round((session.used / session.quota) * 100)) : null

  return (
    <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
      <div role="status" aria-live="polite">
        {isRunning && textLength === 0 && (
          <span className="mr-2 inline-flex gap-1" aria-hidden="true">
            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:150ms]" />
            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:300ms]" />
          </span>
        )}
        {message}
        {!isRunning && failed && session.error && <span className="ml-2 font-mono break-all" data-run-error>{session.error}</span>}
        {isRunning && <span className="ml-2 opacity-70">{t.onDeviceWorking}</span>}
      </div>
      {pct !== null && (
        <div className="flex shrink-0 items-center gap-2" title={t.contextGaugeTitle} data-context-gauge>
          <span>{t.contextGauge(pct)}</span>
          <span className="h-1 w-12 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
            <span className={`block h-full rounded-full ${pct > 80 ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${Math.max(2, pct)}%` }} />
          </span>
        </div>
      )}
    </div>
  )
}

type DraftHandlers = {
  sets: DraftSet[]
  onSaveSet: (set: DraftSet) => void
  onDeleteSet: (id: string) => void
  /** Adds the prompt and a draft to the conversation as a user / assistant message pair. */
  onAdopt: (prompt: string, text: string) => void
}

function Composer({ imagesEnabled, drafts }: { imagesEnabled: boolean; drafts: DraftHandlers }) {
  const { t } = useI18n()
  const aui = useAui()
  const isRunning = useAuiState(s => s.thread.isRunning)
  const text = useAuiState(s => s.composer.text)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const round = 'grid size-9 shrink-0 place-items-center rounded-full transition-opacity'
  const iconButton = 'grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-40'
  return (
    <ComposerPrimitive.Root className="flex flex-col gap-2 rounded-3xl border border-border bg-background py-2 pr-2 pl-3 shadow-soft transition-colors focus-within:border-muted-foreground/50">
      {imagesEnabled && (
        <div className="flex flex-wrap gap-2 pt-1 pl-1 empty:hidden">
          <ComposerPrimitive.Attachments components={{ Attachment: ComposerAttachment }} />
        </div>
      )}
      <div className="flex items-end gap-2">
        <button type="button" className={iconButton} aria-label={t.draftsOpen} title={t.draftsOpen} disabled={isRunning} onClick={() => setDraftsOpen(true)}>
          <ColumnsIcon />
        </button>
        {imagesEnabled && (
          <ComposerPrimitive.AddAttachment className={iconButton} aria-label={t.attachImage} title={t.attachImage} disabled={isRunning}>
            <ImageIcon />
          </ComposerPrimitive.AddAttachment>
        )}
        <ComposerPrimitive.Input
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-1.5 leading-relaxed outline-none placeholder:text-muted-foreground"
          placeholder={t.composerPlaceholder}
          rows={1}
          autoFocus
        />
        {isRunning ? (
          <ComposerPrimitive.Cancel className={`${round} bg-foreground text-background`} aria-label={t.stop} title={t.stop}>
            <StopIcon />
          </ComposerPrimitive.Cancel>
        ) : (
          <ComposerPrimitive.Send className={`${round} bg-primary text-primary-foreground disabled:opacity-30`} aria-label={t.send} title={t.send}>
            <ArrowUpIcon />
          </ComposerPrimitive.Send>
        )}
      </div>
      {draftsOpen && (
        <DraftsDialog
          initialPrompt={text}
          sets={drafts.sets}
          onSaveSet={drafts.onSaveSet}
          onDeleteSet={drafts.onDeleteSet}
          onClose={() => setDraftsOpen(false)}
          onUse={draft => {
            aui.composer().setText(draft)
            document.querySelector<HTMLTextAreaElement>('textarea:not([role])')?.focus()
          }}
          onAdopt={drafts.onAdopt}
        />
      )}
    </ComposerPrimitive.Root>
  )
}

class LimitedImageAdapter extends SimpleImageAttachmentAdapter {
  constructor(private onTooLarge: () => void) {
    super()
    this.accept = 'image/png,image/jpeg,image/webp,image/gif'
  }
  override async add(state: { file: File }) {
    if (state.file.size > MAX_IMAGE_BYTES) {
      this.onTooLarge()
      throw new Error('image too large')
    }
    return super.add(state)
  }
}

const toInitial = (thread: Thread | null, imageUrls: Record<string, string>): ThreadMessageLike[] =>
  (thread?.messages ?? []).map(m => ({
    id: m.id,
    role: m.role,
    content: [{ type: 'text' as const, text: m.text }],
    createdAt: new Date(m.createdAt),
    ...(m.role === 'user' && m.images?.length
      ? {
          attachments: m.images.flatMap(id =>
            imageUrls[id]
              ? [{ id, type: 'image', name: 'image', contentType: /^data:([^;]+)/.exec(imageUrls[id])?.[1], status: { type: 'complete' as const }, content: [{ type: 'image' as const, image: imageUrls[id] }] }]
              : [],
          ),
        }
      : {}),
  }))

type Props = {
  threadId: string
  /** Existing thread to resume, or null for a new one. */
  initial: Thread | null
  /** Data URLs of the images referenced by `initial`, by image id. */
  initialImages: Record<string, string>
  /** Temporary chats are never written to storage. */
  temporary: boolean
  /** Whether the model accepts image input (and the storage can keep images). */
  imagesEnabled: boolean
  /** Saved system-prompt presets, selectable for this thread. */
  presets: PromptPreset[]
  /** Always-on instructions, applied regardless of the selected preset ('' when unset). */
  globalInstruction: string
  onSaved: () => void
}

export function Chat({ threadId, initial, initialImages, temporary, imagesEnabled, presets, globalInstruction, onSaved }: Props) {
  const { t, lang } = useI18n()
  const repo = useHistory()
  const [notice, setNotice] = useState<'save' | 'image' | null>(null)
  const [draftSets, setDraftSets] = useState<DraftSet[]>(initial?.draftSets ?? [])
  const [presetId, setPresetId] = useState<string | null>(initial?.presetId ?? null)
  // A preset can be deleted elsewhere while this thread has it selected: fall back to "none".
  const activePresetId = presets.some(p => p.id === presetId) ? presetId : null
  const activePresetContent = presets.find(p => p.id === activePresetId)?.content ?? null
  // Read from the save() closure below without re-subscribing on every preset change.
  const presetIdRef = useRef(activePresetId)
  presetIdRef.current = activePresetId
  const sessions = useMemo(() => new NanoSessions(lang, imagesEnabled), []) // eslint-disable-line react-hooks/exhaustive-deps
  const session = useSyncExternalStore(sessions.subscribe, sessions.getState)
  const initialMessages = useMemo(() => toInitial(initial, initialImages), [initial, initialImages])
  const adapters = useMemo(() => (imagesEnabled ? { attachments: new LimitedImageAdapter(() => setNotice('image')) } : undefined), [imagesEnabled])
  const runtime = useLocalRuntime(useMemo(() => sessions.adapter(), [sessions]), { initialMessages, adapters })

  // All writes for this thread go through one queue, so read-modify-write cycles never interleave.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(job).catch(e => {
      if (e instanceof HistoryQuotaError) setNotice('save')
      else console.error(e)
    })
  }, [])

  useEffect(() => {
    sessions.setLang(lang)
  }, [sessions, lang])

  useEffect(() => {
    sessions.setPreset(activePresetContent)
  }, [sessions, activePresetContent])

  useEffect(() => {
    sessions.setGlobalInstruction(globalInstruction)
  }, [sessions, globalInstruction])

  useEffect(() => {
    if (!initial) void sessions.warmup()
    return () => sessions.destroy()
  }, [sessions, initial])

  // Persist after every completed run (never mid-stream).
  useEffect(() => {
    if (temporary) return
    const savedImages = new Map<string, string[]>((initial?.messages ?? []).flatMap(m => (m.images?.length ? [[m.id, m.images] as [string, string[]]] : [])))
    let lastSaved = ''
    const save = async () => {
      const state = runtime.thread.getState()
      if (state.isRunning) return
      const messages: StoredMessage[] = []
      for (const m of state.messages) {
        if (m.role !== 'user' && m.role !== 'assistant') continue
        const text = m.content.map(p => (p.type === 'text' ? p.text : '')).join('')
        let images = savedImages.get(m.id)
        if (m.role === 'user' && !images) {
          const blobs = (m.attachments ?? []).flatMap(a => a.content.flatMap(c => (c.type === 'image' ? (dataUrlToBlob(c.image) ?? []) : [])))
          if (blobs.length) {
            images = []
            for (const blob of blobs) {
              const id = crypto.randomUUID()
              await repo.putImage({ id, blob })
              images.push(id)
            }
            savedImages.set(m.id, images)
          }
        }
        if (text || images?.length) messages.push({ id: m.id, role: m.role, text, createdAt: m.createdAt.getTime(), images })
      }
      const key = JSON.stringify(messages)
      if (!messages.length || key === lastSaved) return
      const firstUser = messages.find(m => m.role === 'user')?.text.replace(/\s+/g, ' ').trim() ?? ''
      // Keep user edits (rename / pin / draft sets) made since this chat was opened.
      const existing = await repo.get(threadId)
      await repo.save({
        id: threadId,
        title: existing?.titleEdited ? existing.title : firstUser.slice(0, TITLE_MAX) || t.untitled,
        titleEdited: existing?.titleEdited,
        pinned: existing?.pinned,
        presetId: presetIdRef.current ?? undefined,
        createdAt: existing?.createdAt ?? initial?.createdAt ?? messages[0].createdAt,
        updatedAt: Date.now(),
        messages,
        draftSets: existing?.draftSets,
      })
      lastSaved = key
      setNotice(n => (n === 'save' ? null : n))
      onSaved()
    }
    return runtime.thread.subscribe(() => {
      if (!runtime.thread.getState().isRunning) enqueue(save)
    })
  }, [runtime, repo, temporary, threadId, initial, onSaved, enqueue, t.untitled])

  const drafts: DraftHandlers = {
    // Two back-to-back `append` calls would attach both messages to the same parent, so the
    // thread is replaced in one step with "existing messages + the new pair" (no model run).
    onAdopt: (prompt, text) => {
      const existing: ThreadMessageLike[] = runtime.thread.getState().messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        ...(m.role === 'user' ? { attachments: m.attachments } : {}),
      }))
      runtime.thread.reset([
        ...existing,
        { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], createdAt: new Date() },
        { id: crypto.randomUUID(), role: 'assistant', content: [{ type: 'text', text }], createdAt: new Date(), status: { type: 'complete', reason: 'stop' } },
      ])
    },
    sets: draftSets,
    onSaveSet: set => {
      setDraftSets(prev => [...prev.filter(s => s.id !== set.id), set])
      if (!temporary)
        enqueue(async () => {
          await repo.addDraftSet(threadId, set, t.untitled)
          onSaved()
        })
    },
    onDeleteSet: id => {
      setDraftSets(prev => prev.filter(s => s.id !== id))
      if (!temporary)
        enqueue(async () => {
          await repo.removeDraftSet(threadId, id)
          onSaved()
        })
    },
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full flex-col">
        {presets.length > 0 && (
          <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-1.5 px-4 pt-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">
              <span>{t.presetActiveLabel}</span>
              <select
                className="rounded-lg border border-border bg-transparent px-2 py-1 text-foreground"
                value={activePresetId ?? ''}
                onChange={e => setPresetId(e.target.value || null)}
              >
                <option value="">{t.presetsNone}</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-8">
            <ThreadPrimitive.Empty>
              <EmptyState />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>{() => <Message />}</ThreadPrimitive.Messages>
          </div>
        </ThreadPrimitive.Viewport>
        <div className="mx-auto w-full max-w-3xl space-y-1 px-4 pb-3">
          {temporary && <p className="text-center text-xs text-muted-foreground">{t.tempChatNote}</p>}
          {notice === 'save' && <p className="text-center text-xs text-danger" role="alert">{t.quotaError}</p>}
          {notice === 'image' && <p className="text-center text-xs text-danger" role="alert">{t.imageTooLarge}</p>}
          <RunStatus session={session} />
          <Composer imagesEnabled={imagesEnabled} drafts={drafts} />
          <p className="pt-1 text-center text-xs text-muted-foreground">{t.verifyHint}</p>
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
