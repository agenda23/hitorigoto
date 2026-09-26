// Export / import of history. Import files are untrusted input: everything is validated and
// re-built field by field rather than trusted as-is.
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, base64ToBlob, blobToBase64 } from './images'
import { imageIdsOf, type Draft, type DraftSet, type HistoryRepository, type StoredImage, type StoredMessage, type Thread } from './history'

const FORMAT = 'hitorigoto-export'
/** v1: threads only. v2: adds draft sets and embedded images. */
const FORMAT_VERSION = 2
const MAX_TITLE = 200
const MAX_TEXT = 1_000_000

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

type ExportedImage = { type: string; data: string }

/** Serializes every thread, embedding the images they reference as base64. */
export async function exportAll(repo: HistoryRepository): Promise<string> {
  const threads = await repo.all()
  const images: Record<string, ExportedImage> = {}
  for (const id of new Set(threads.flatMap(imageIdsOf))) {
    const blob = await repo.getImage(id)
    if (blob) images[id] = { type: blob.type, data: await blobToBase64(blob) }
  }
  return JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), threads, images }, null, 2)
}

export function threadToMarkdown(thread: Thread, labels: { user: string; assistant: string; images: (n: number) => string }): string {
  const body = thread.messages
    .map(m => `## ${labels[m.role]}\n\n${m.images?.length ? `${labels.images(m.images.length)}\n\n` : ''}${m.text}`)
    .join('\n\n')
  return `# ${thread.title}\n\n${body}\n`
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, max = MAX_TEXT) => {
  if (typeof v !== 'string') throw new ImportError('invalid string')
  return v.slice(0, max)
}

function parseMessage(v: unknown, imageIds: Set<string>): StoredMessage {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.text !== 'string' || !finite(v.createdAt) || (v.role !== 'user' && v.role !== 'assistant'))
    throw new ImportError('invalid message')
  const images = Array.isArray(v.images) ? v.images.filter((id): id is string => typeof id === 'string' && imageIds.has(id)) : []
  return { id: v.id, role: v.role, text: str(v.text), createdAt: v.createdAt as number, images: images.length ? images : undefined }
}

function parseDraftSet(v: unknown): DraftSet {
  if (!isObject(v) || typeof v.id !== 'string' || !finite(v.createdAt) || !Array.isArray(v.drafts)) throw new ImportError('invalid draft set')
  const drafts: Draft[] = v.drafts.map(d => {
    if (!isObject(d)) throw new ImportError('invalid draft')
    return { text: str(d.text), temperature: finite(d.temperature) ? (d.temperature as number) : undefined }
  })
  return { id: v.id, prompt: str(v.prompt), createdAt: v.createdAt as number, drafts }
}

function parseThread(v: unknown, imageIds: Set<string>): Thread {
  if (!isObject(v) || typeof v.id !== 'string' || !v.id || typeof v.title !== 'string' || !Array.isArray(v.messages) || !finite(v.createdAt) || !finite(v.updatedAt))
    throw new ImportError('invalid thread')
  const draftSets = Array.isArray(v.draftSets) ? v.draftSets.map(parseDraftSet) : []
  return {
    id: v.id,
    title: v.title.slice(0, MAX_TITLE),
    titleEdited: v.titleEdited === true || undefined,
    pinned: v.pinned === true || undefined,
    createdAt: v.createdAt as number,
    updatedAt: v.updatedAt as number,
    messages: v.messages.map(m => parseMessage(m, imageIds)),
    draftSets: draftSets.length ? draftSets : undefined,
  }
}

function parseImages(v: unknown): StoredImage[] {
  if (v === undefined) return []
  if (!isObject(v)) throw new ImportError('invalid images')
  return Object.entries(v).map(([id, img]) => {
    if (!isObject(img) || typeof img.type !== 'string' || typeof img.data !== 'string' || !ALLOWED_IMAGE_TYPES.includes(img.type)) throw new ImportError('invalid image')
    // Base64 expands by 4/3: reject oversized images before decoding.
    if (img.data.length > (MAX_IMAGE_BYTES * 4) / 3 + 8) throw new ImportError('image too large')
    try {
      return { id, blob: base64ToBlob(img.data, img.type) }
    } catch {
      throw new ImportError('invalid image data')
    }
  })
}

/** Parses the text of an exported JSON file. Throws ImportError if it is not a valid export. */
export function parseImport(text: string): { threads: Thread[]; images: StoredImage[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportError('not JSON')
  }
  if (!isObject(data) || data.format !== FORMAT || (data.version !== 1 && data.version !== 2) || !Array.isArray(data.threads)) throw new ImportError('not a Hitorigoto export')
  const images = data.version === 2 ? parseImages(data.images) : []
  const ids = new Set(images.map(i => i.id))
  return { threads: data.threads.map(t => parseThread(t, ids)), images }
}
