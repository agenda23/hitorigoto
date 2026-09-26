/** Saves text as a file using a blob URL (stays inside the browser; no network). */
export function download(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const safeFilename = (name: string) => name.replace(/[\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 80) || 'chat'
