// Image helpers. Images stay on the device: they are handled as Blobs / data URLs only.
// (data URLs are used instead of blob: URLs so the CSP `img-src 'self' data:` needs no loosening,
// and `atob` is used instead of fetch(dataUrl) because `connect-src 'self'` forbids data: fetches.)

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function base64ToBlob(base64: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return new Blob([bytes], { type })
}

/** Returns null unless this is a base64 data URL of an allowed image type. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl)
  if (!m || !ALLOWED_IMAGE_TYPES.includes(m[1].toLowerCase())) return null
  try {
    return base64ToBlob(m[2], m[1].toLowerCase())
  } catch {
    return null
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return (await blobToDataUrl(blob)).replace(/^data:[^,]*,/, '')
}
