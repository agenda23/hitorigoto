// Emits dist/sw.js from scripts/sw-template.js with the list of files to precache and a
// version derived from their contents, so a new build invalidates the old cache.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export default function swPlugin() {
  let publicDir = 'public'
  return {
    name: 'hitorigoto-sw',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
      const assets = new Set(['/', '/index.html'])
      for (const [file, chunk] of Object.entries(bundle)) {
        assets.add('/' + file)
        hash.update(file)
        if (chunk.type === 'asset') hash.update(chunk.source)
      }
      // Unhashed files from public/ (icons, manifest, favicon).
      for (const name of fs.readdirSync(publicDir).sort()) {
        if (name === '_headers' || name === 'sw.js') continue
        assets.add('/' + name)
        hash.update(fs.readFileSync(path.join(publicDir, name)))
      }
      const source = fs
        .readFileSync(path.resolve('scripts/sw-template.js'), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__ASSETS__', JSON.stringify([...assets].sort()))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
