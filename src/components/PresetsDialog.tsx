import { useEffect, useState } from 'react'
import type { PromptPreset } from '../lib/history'
import { useHistory } from '../lib/history-context'
import { useI18n } from '../lib/i18n'
import { Dialog } from './Dialog'
import { PencilIcon, TrashIcon } from './icons'

type Editing = { kind: 'preset'; id: string | null; name: string; content: string } | { kind: 'global'; content: string }

const rowIconButton = 'grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground'

/** Manage the model's system-prompt instructions: one always-on slot, plus named per-chat presets. */
export function PresetsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const repo = useHistory()
  const [presets, setPresets] = useState<PromptPreset[] | null>(null)
  const [globalInstruction, setGlobalInstructionState] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [confirmDeletePreset, setConfirmDeletePreset] = useState<string | null>(null)
  const [confirmDeleteGlobal, setConfirmDeleteGlobal] = useState(false)

  const refresh = () => {
    void repo.listPresets().then(setPresets)
    void repo.getGlobalInstruction().then(setGlobalInstructionState)
  }
  useEffect(refresh, [repo])

  const savePreset = async (edit: Extract<Editing, { kind: 'preset' }>) => {
    if (!edit.name.trim()) return
    const now = Date.now()
    const existing = presets?.find(p => p.id === edit.id)
    await repo.savePreset({ id: edit.id ?? crypto.randomUUID(), name: edit.name.trim(), content: edit.content.trim(), createdAt: existing?.createdAt ?? now, updatedAt: now })
    setEditing(null)
    refresh()
  }

  const removePreset = async (id: string) => {
    setConfirmDeletePreset(null)
    await repo.removePreset(id)
    refresh()
  }

  const saveGlobal = async (content: string) => {
    if (!content.trim()) return
    await repo.setGlobalInstruction(content)
    setEditing(null)
    refresh()
  }

  const removeGlobal = async () => {
    setConfirmDeleteGlobal(false)
    await repo.setGlobalInstruction('')
    refresh()
  }

  if (editing) {
    const isGlobal = editing.kind === 'global'
    const canSave = isGlobal ? editing.content.trim().length > 0 : editing.name.trim().length > 0
    return (
      <Dialog title={t.presetsTitle} onClose={onClose}>
        <div className="space-y-4">
          {editing.kind === 'preset' && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t.presetsNamePlaceholder}</span>
              <input
                autoFocus
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder={t.presetsNamePlaceholder}
                className="w-full rounded-xl border border-border bg-transparent px-3 py-2 outline-none focus:border-muted-foreground/60"
              />
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t.presetsContentPlaceholder}</span>
            <textarea
              autoFocus={isGlobal}
              value={editing.content}
              onChange={e => setEditing({ ...editing, content: e.target.value })}
              placeholder={t.presetsContentPlaceholder}
              rows={6}
              className="w-full resize-y rounded-xl border border-border bg-transparent px-3 py-2 leading-relaxed outline-none focus:border-muted-foreground/60"
            />
            <span className="block text-xs text-muted-foreground">{t.presetsChars(editing.content.length)}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t.presetsLengthHint}</p>
          {!canSave && <p className="text-xs text-danger">{isGlobal ? t.globalInstructionRequired : t.presetsNameRequired}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full bg-primary px-5 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={!canSave}
              onClick={() => void (isGlobal ? saveGlobal(editing.content) : savePreset(editing))}
            >
              {t.presetsSave}
            </button>
            <button type="button" className="rounded-full border border-border px-5 py-1.5 text-sm hover:bg-foreground/5" onClick={() => setEditing(null)}>
              {t.presetsCancel}
            </button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title={t.presetsTitle} onClose={onClose}>
      <div className="space-y-6">
        {/* Always-on instructions come first and stand apart: unlike presets, there is exactly one, no
            selection is needed, and it takes effect immediately. */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t.globalInstructionTitle}</h3>
          <p className="text-xs text-muted-foreground">{t.globalInstructionIntro}</p>
          {globalInstruction === null ? null : globalInstruction ? (
            confirmDeleteGlobal ? (
              <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2" role="alertdialog" aria-label={t.presetsDelete}>
                <span className="min-w-0 flex-1 text-xs">{t.globalInstructionDeleteConfirm}</span>
                <button type="button" className="shrink-0 rounded-lg bg-danger px-2.5 py-1 text-xs text-background" onClick={() => void removeGlobal()}>
                  {t.confirmYes}
                </button>
                <button type="button" className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-foreground/5" onClick={() => setConfirmDeleteGlobal(false)}>
                  {t.confirmNo}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={globalInstruction}>{globalInstruction}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{t.presetsChars(globalInstruction.length)}</span>
                <button type="button" className={rowIconButton} aria-label={t.presetsEdit} title={t.presetsEdit} onClick={() => setEditing({ kind: 'global', content: globalInstruction })}>
                  <PencilIcon />
                </button>
                <button type="button" className={`${rowIconButton} text-danger`} aria-label={t.presetsDelete} title={t.presetsDelete} onClick={() => setConfirmDeleteGlobal(true)}>
                  <TrashIcon />
                </button>
              </div>
            )
          ) : (
            <button type="button" className="rounded-full border border-border px-5 py-1.5 text-sm transition-colors hover:bg-foreground/5" onClick={() => setEditing({ kind: 'global', content: '' })}>
              {t.globalInstructionAdd}
            </button>
          )}
        </section>

        <hr className="border-border" />

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t.presetsSectionTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.presetsIntro}</p>
          </div>

          {presets === null ? null : presets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.presetsEmpty}</p>
          ) : (
            <ul className="space-y-1" data-presets-list>
              {presets.map(p => (
                <li key={p.id} className="rounded-lg px-2 py-1.5 text-sm hover:bg-foreground/5">
                  {confirmDeletePreset === p.id ? (
                    <div className="flex items-center gap-2" role="alertdialog" aria-label={t.presetsDelete}>
                      <span className="min-w-0 flex-1 truncate text-xs">{t.presetsDeleteConfirm(p.name)}</span>
                      <button type="button" className="shrink-0 rounded-lg bg-danger px-2.5 py-1 text-xs text-background" onClick={() => void removePreset(p.id)}>
                        {t.confirmYes}
                      </button>
                      <button type="button" className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-foreground/5" onClick={() => setConfirmDeletePreset(null)}>
                        {t.confirmNo}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t.presetsChars(p.content.length)}</span>
                      <button
                        type="button"
                        className={rowIconButton}
                        aria-label={t.presetsEdit}
                        title={t.presetsEdit}
                        onClick={() => setEditing({ kind: 'preset', id: p.id, name: p.name, content: p.content })}
                      >
                        <PencilIcon />
                      </button>
                      <button type="button" className={`${rowIconButton} text-danger`} aria-label={t.presetsDelete} title={t.presetsDelete} onClick={() => setConfirmDeletePreset(p.id)}>
                        <TrashIcon />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="rounded-full border border-border px-5 py-1.5 text-sm transition-colors hover:bg-foreground/5"
            onClick={() => setEditing({ kind: 'preset', id: null, name: '', content: '' })}
          >
            {t.presetsNew}
          </button>
        </section>
      </div>
    </Dialog>
  )
}
