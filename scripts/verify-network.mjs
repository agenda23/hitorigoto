// Verifies the "0 bytes sent" guarantee: serves dist/ (with the _headers CSP, and again
// without it), drives it in headless Chrome over CDP, and fails on any non-localhost
// request or CSP violation, and runs a chat scenario against a mocked LanguageModel. Usage: npm run build && npm run verify:network
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve('dist')
const CHROME = process.env.CHROME_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => fs.existsSync(p))
if (!CHROME) throw new Error('Chrome not found. Set CHROME_PATH.')
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('dist/ missing. Run `npm run build` first.')

// Headers of the catch-all (`/*`) block only: indented lines up to the next path line.
const headers = {}
for (const line of fs.readFileSync(path.join(root, '_headers'), 'utf8').split(String.fromCharCode(10)).slice(1)) {
  if (!line.trim()) continue
  if (!/^\s/.test(line)) break
  const [k, v] = line.trim().split(/:\s(.+)/)
  headers[k] = v
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Stands in for Chrome's built-in model so the chat UI can be exercised in any Chrome.
// The reply embeds a remote image to prove it is never requested.
const MOCK_LANGUAGE_MODEL = `
  window.__creates = []
  window.__prompts = []
  window.LanguageModel = {
    availability: async () => 'available',
    params: async () => ({ defaultTemperature: 1, maxTemperature: 2, defaultTopK: 3, maxTopK: 8 }),
    create: async o => {
      window.__creates.push({ t: o && o.temperature, k: o && o.topK })
      return {
        inputUsage: 250,
        inputQuota: 1000,
        promptStreaming: input => {
          window.__prompts.push(Array.isArray(input)
            ? input.map(m => ({ role: m.role, parts: m.content.map(c => ({ type: c.type, isBlob: c.value instanceof Blob, mime: c.value && c.value.type })) }))
            : input)
          return new ReadableStream({
            async start(c) {
              for (const w of ['mock ', 'reply ', '![leak](https://leak.example.invalid/p.png?q=secret)']) { c.enqueue(w); await new Promise(r => setTimeout(r, 40)) }
              c.close()
            },
          })
        },
        destroy() {},
      }
    },
  }`

// The first-visit guide opens by itself once; every run except the first-run one marks it as seen.
const SEED_ONBOARDED = `localStorage.setItem('hitorigoto:onboarded', '1')`

// Legacy (pre-IndexedDB) history, seeded before the app loads to exercise the one-time migration.
const SEED_LEGACY = `
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('hitorigoto:index', JSON.stringify([{ id: 'legacy-1', title: 'legacy chat', updatedAt: 5, messageCount: 2 }]))
    localStorage.setItem('hitorigoto:thread:legacy-1', JSON.stringify({ id: 'legacy-1', title: 'legacy chat', createdAt: 1, updatedAt: 5, messages: [{ id: 'x1', role: 'user', text: 'old question', createdAt: 1 }, { id: 'x2', role: 'assistant', text: 'old answer', createdAt: 2 }] }))
    localStorage.setItem('hitorigoto:schemaVersion', '1')
  }`

function serve(withCsp) {
  const server = http.createServer((req, res) => {
    const u = req.url === '/' ? '/index.html' : req.url.split('?')[0]
    const f = path.join(root, u)
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream', ...(withCsp ? headers : {}) })
    res.end(fs.readFileSync(f))
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)))
}

async function drive(url, port, withCsp, seedLegacy = false, firstRun = false) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hitorigoto-verify-'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  try {
    let page
    for (let i = 0; i < 60 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page') } catch {}
      if (!page) await sleep(250)
    }
    if (!page) throw new Error('Chrome did not start')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => (ws.onopen = r))
    let id = 0
    const pending = new Map()
    const external = [], violations = [], errors = [], checks = []
    let fileChooser = null
    ws.onmessage = e => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return }
      if (m.method === 'Network.requestWillBeSent') {
        const u = new URL(m.params.request.url)
        if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol !== 'data:' && u.protocol !== 'blob:') external.push(m.params.request.url)
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.args[0]?.value === 'CSPVIOLATION') {
        violations.push(m.params.args.slice(1).map(a => a.value).join(' '))
      } else if (m.method === 'Page.fileChooserOpened') {
        fileChooser = m.params
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
      }
    }
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    await send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('securitypolicyviolation', e => console.log('CSPVIOLATION', e.violatedDirective, e.blockedURI))` })
    await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_LANGUAGE_MODEL })
    if (seedLegacy) await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_LEGACY })
    if (!firstRun) await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_ONBOARDED })
    await send('Page.navigate', { url }); await sleep(3000)
    const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result?.value
    const send_ = text => evaluate(`(()=>{const t=document.querySelector('textarea');if(!t)return false;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}));t.form.requestSubmit();return true})()`)
    const click = re => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^(${re})$/.test(b.textContent.trim()));if(!b)return false;b.click();return true})()`)
    const idbAll = store => evaluate(`new Promise((res, rej) => { const o = indexedDB.open('hitorigoto'); o.onerror = () => rej(o.error); o.onsuccess = () => { const db = o.result; const r = db.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); r.onsuccess = () => { db.close(); res(r.result.map(x => x && x.blob instanceof Blob ? { id: x.id, blob: true } : x)) } } })`)
    const idbCount = async store => (await idbAll(store)).length
    const stored = () => idbCount('index')
    const check = (name, ok) => checks.push({ name, ok: !!ok })

    if (firstRun) {
      const dialogLabel = () => evaluate(`document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null`)
      const seen = () => evaluate(`localStorage.getItem('hitorigoto:onboarded')`)
      check('guide opens by itself on the first visit', /Hitorigoto/.test((await dialogLabel()) ?? ''))
      check('guide has three tabs', (await evaluate(`document.querySelectorAll('[role=tab]').length`)) === 3)
      check('guide is not marked as seen before it is closed', (await seen()) === null)
      await evaluate(`document.getElementById('guide-tab-setup').click()`); await sleep(500)
      check('setup tab shows the live model status', await evaluate(`document.querySelector('[data-model-status]')?.getAttribute('data-model-status') === 'available'`))
      check('setup tab lists requirements and steps', await evaluate(`document.querySelectorAll('[role=tabpanel] dl > div').length >= 5 && document.querySelectorAll('[role=tabpanel] ol > li').length === 4`))
      check('setup tab offers the chrome:// address to copy', await evaluate(`document.querySelector('[role=tabpanel]').innerText.includes('on-device-internals')`))
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
      await evaluate(`document.getElementById('guide-tab-setup').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`); await sleep(300)
      check('arrow keys move between tabs', await evaluate(`document.getElementById('guide-tab-usage').getAttribute('aria-selected') === 'true'`))
      await click('Get started|はじめる'); await sleep(400)
      check('closing the guide removes it and remembers it', (await dialogLabel()) === null && (await seen()) === '1')
      await send('Page.navigate', { url }); await sleep(2500)
      check('guide does not open again on the next visit', (await dialogLabel()) === null)
      await evaluate(`[...document.querySelectorAll('button')].find(b => /^(Open the usage guide|使い方ガイドを開く)/.test(b.getAttribute('aria-label') || '')).click()`); await sleep(400)
      check('header button reopens the guide', /Hitorigoto/.test((await dialogLabel()) ?? ''))
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(300)
      check('Escape closes the guide', (await dialogLabel()) === null)
      await click('How history is stored|履歴の仕組みを見る'); await sleep(500)
      check('sidebar link opens the usage tab at the history section', await evaluate(`document.getElementById('guide-tab-usage').getAttribute('aria-selected') === 'true' && !!document.getElementById('guide-history') && document.getElementById('guide-history').innerText.includes('IndexedDB')`))
      check('history section lists what/when/where/erased', await evaluate(`document.querySelectorAll('#guide-history dl > div').length === 7`))
      ws.close()
      return { external, violations, errors, checks }
    }

    if (seedLegacy) {
      await sleep(1000)
      check('legacy history migrated to IndexedDB', (await idbAll('index')).some(m => m.id === 'legacy-1'))
      check('legacy localStorage history cleared after migration', await evaluate(`localStorage.getItem('hitorigoto:index') === null && localStorage.getItem('hitorigoto:thread:legacy-1') === null`))
      check('migration notice shown', await evaluate(`/IndexedDB/.test(document.body.innerText)`))
      await evaluate(`[...document.querySelectorAll('nav button')].find(b => b.title === 'legacy chat').click()`); await sleep(800)
      check('migrated chat is readable', await evaluate(`document.body.innerText.includes('old answer')`))
      ws.close()
      return { external, violations, errors, checks }
    }

    // Scenario against a mocked LanguageModel: chat, persistence, temporary chat, delete-all.
    check('composer rendered', await evaluate(`!!document.querySelector('textarea')`))
    await send_('hello'); await sleep(2000)
    check('assistant reply rendered', await evaluate(`document.body.innerText.includes('mock reply')`))
    check('remote image not rendered', await evaluate(`!document.querySelector('img[src*="leak.example.invalid"]')`))
    check('thread saved after run', (await stored()) === 1)
    check('context gauge shows usage', await evaluate(`/25%/.test(document.querySelector('[data-context-gauge]')?.innerText ?? '')`))
    const clickLabel = re => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^(${re})/.test(b.getAttribute('aria-label')||''));if(!b)return false;b.click();return true})()`)
    const setInput = (selector, value) => evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});if(!i)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
    const index = () => idbAll('index')
    const sidebarText = () => evaluate(`document.querySelector('nav')?.innerText ?? ''`)
    const importFile = async (file) => {
      const { root } = await send('DOM.getDocument')
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
      await send('DOM.setFileInputFiles', { nodeId, files: [file] })
    }

    // Phase 2: rename, pin, search, delete + undo, import (new / conflicting).
    await clickLabel('More actions|その他の操作'); await sleep(200)
    await click('Rename|名前を変更'); await sleep(200)
    await setInput('input:not([type])', 'renamed chat')
    await evaluate(`(()=>{const i=document.querySelector('input:not([type])');i.focus();i.blur()})()`); await sleep(300)
    check('rename persisted', (await index())[0]?.title === 'renamed chat')
    await clickLabel('More actions|その他の操作'); await sleep(200)
    await click('Pin|ピン留め'); await sleep(300)
    check('pin persisted', (await index())[0]?.pinned === true)
    await setInput('input[type=search]', 'zzzz-no-match'); await sleep(300)
    check('search with no hits', /No matches|見つかりませんでした/.test(await sidebarText()))
    await setInput('input[type=search]', 'MOCK REPLY'); await sleep(300)
    check('search matches message body', (await sidebarText()).includes('renamed chat'))
    await setInput('input[type=search]', ''); await sleep(200)
    await clickLabel('More actions|その他の操作'); await sleep(200)
    await click('Delete this chat|このチャットを削除'); await sleep(300)
    check('delete removes thread', (await stored()) === 0)
    await click('Undo|元に戻す'); await sleep(300)
    check('undo restores thread', (await stored()) === 1)
    const file = path.join(os.tmpdir(), `hitorigoto-import-${process.pid}.json`)
    const incoming = { id: 'imported-1', title: 'imported chat', createdAt: 1, updatedAt: 2, messages: [{ id: 'm1', role: 'user', text: 'hi', createdAt: 1 }] }
    fs.writeFileSync(file, JSON.stringify({ format: 'hitorigoto-export', version: 1, exportedAt: '2026-01-01T00:00:00Z', threads: [incoming] }))
    await importFile(file); await sleep(500)
    check('import adds new thread', (await stored()) === 2)
    await importFile(file); await sleep(500)
    check('import conflict asks merge/copy', /Merge|マージ/.test(await sidebarText()))
    await click('Save as copy|別名で保存'); await sleep(400)
    check('import copy adds a second thread', (await stored()) === 3)
    fs.rmSync(file)
    const before = await stored()

    await click('Temporary chat|一時チャット'); await sleep(300)
    await send_('secret draft'); await sleep(2000)
    check('temporary chat not saved', (await stored()) === before)
    await click('Delete all history|全履歴を削除'); await sleep(200)
    await click('Delete|削除する'); await sleep(300)
    check('delete-all clears history', (await idbCount('index')) === 0 && (await idbCount('threads')) === 0 && (await idbCount('images')) === 0)

    // Phase 3: multi-draft comparison and the verification dialog.
    await clickLabel('Compare drafts|複数案で比較'); await sleep(300)
    await evaluate(`(()=>{const t=document.querySelector('[role=dialog] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'draft me');t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await click('Generate|生成'); await sleep(4000)
    check('three drafts rendered', (await evaluate(`[...document.querySelectorAll('[data-draft]')].filter(a=>a.innerText.includes('mock reply')).length`)) === 3)
    const temps = await evaluate(`window.__creates.slice(-3).map(c=>c.t+'/'+c.k)`)
    check('drafts use distinct temperatures with topK', JSON.stringify(temps) === JSON.stringify(['0.2/3', '0.9/3', '1.5/3']))
    await sleep(500)
    check('draft set saved with the chat', (await idbAll('threads')).some(t => t.draftSets?.length === 1 && t.draftSets[0].drafts.length === 3))
    await click('Add to chat|会話に追加'); await sleep(600)
    check('adopted draft appears in the conversation', await evaluate(`document.body.innerText.includes('draft me') && document.body.innerText.includes('mock reply')`))
    check('adopted messages are saved and keep the draft set', (await idbAll('threads')).some(t => t.messages.length === 2 && t.draftSets?.length === 1))
    await clickLabel('Compare drafts|複数案で比較'); await sleep(300)
    check('earlier drafts are listed', (await evaluate(`document.querySelectorAll('[data-draft-history] li').length`)) === 1)
    await click('Show|表示'); await sleep(300)
    await click('Use in composer|入力欄へ'); await sleep(300)
    check('draft can be moved into the composer', await evaluate(`document.querySelector('form textarea').value.includes('mock reply')`))
    await clickLabel('On-device|オンデバイス'); await sleep(600)
    if (withCsp) {
      await click('Try an external connection|外部への接続を試す'); await sleep(1000)
      check('verify dialog: self-test reports blocked', await evaluate(`/connect-src/.test(document.querySelector('[role=dialog]').innerText) && /Blocked|ブロックされました/.test(document.querySelector('[role=dialog]').innerText)`))
    } else {
      check('verify dialog: no header on a server without CSP', await evaluate(`/cannot be read|確認できません/.test(document.querySelector('[role=dialog]').innerText)`))
    }
    await click('Close|閉じる'); await sleep(200)

    // Phase 4: image input (stored in IndexedDB, sent to the model as a Blob, survives reload).
    const png = path.join(os.tmpdir(), `hitorigoto-${process.pid}.png`)
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    await send('Page.setInterceptFileChooserDialog', { enabled: true })
    await evaluate(`(()=>{const t=document.querySelector('form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await clickLabel('Attach an image|画像を添付')
    for (let i = 0; i < 30 && !fileChooser; i++) await sleep(100)
    check('file chooser opened by the attach button', !!fileChooser)
    if (fileChooser) await send('DOM.setFileInputFiles', { files: [png], backendNodeId: fileChooser.backendNodeId })
    await sleep(700)
    check('attachment thumbnail shown in the composer', await evaluate(`!!document.querySelector('form img[src^="data:image/png"]')`))
    await send_('what is this'); await sleep(2500)
    fs.rmSync(png)
    const lastPrompt = JSON.stringify(await evaluate(`window.__prompts.at(-1)`))
    check('image sent to the model as a Blob', /"type":"image"/.test(lastPrompt) && /"isBlob":true/.test(lastPrompt) && lastPrompt.includes('image/png'))
    check('image stored in IndexedDB', (await idbCount('images')) === 1)
    check('sent image shown in the conversation', await evaluate(`!!document.querySelector('img[src^="data:image/png"]')`))
    await send('Page.navigate', { url }); await sleep(2500)
    await evaluate(`[...document.querySelectorAll('nav button')].find(b => b.title === 'draft me').click()`); await sleep(1000)
    check('image survives a reload', await evaluate(`!!document.querySelector('img[src^="data:image/png"]')`))
    await send('Page.setInterceptFileChooserDialog', { enabled: false })

    // PWA: the Service Worker takes over, and the app still loads with the network cut.
    check('service worker active', await evaluate(`navigator.serviceWorker.ready.then(r => !!r.active)`))
    await send('Page.navigate', { url }); await sleep(1500)
    check('page controlled by service worker', await evaluate(`!!navigator.serviceWorker.controller`))
    check('static files precached', await evaluate(`caches.keys().then(async ks => { const c = await caches.open(ks[0]); return (await c.keys()).length >= 5 })`))
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await send('Page.navigate', { url }); await sleep(2000)
    check('loads offline', await evaluate(`!!document.querySelector('textarea')`))
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    // The dialog's self-test deliberately hits a non-existent host; it must be blocked, not sent.
    const selfTestRequests = external.filter(u => u.includes('example.invalid'))
    const selfTestViolations = violations.filter(v => v.includes('example.invalid'))
    if (selfTestRequests.length || selfTestViolations.length) check('self-test request blocked by CSP', selfTestViolations.length >= 1)
    ws.close()
    return {
      external: external.filter(u => !selfTestRequests.includes(u)),
      violations: violations.filter(v => !selfTestViolations.includes(v)),
      errors,
      checks,
    }
  } finally { chrome.kill() }
}

let failed = false
for (const [label, withCsp, port, seedLegacy, firstRun] of [['CSP on', true, 9341, false], ['CSP off', false, 9342, false], ['Legacy migration', true, 9343, true], ['First run', true, 9344, false, true]]) {
  const server = await serve(withCsp)
  const r = await drive(`http://127.0.0.1:${server.address().port}/`, port, withCsp, seedLegacy, firstRun)
  server.close()
  const failedChecks = r.checks.filter(c => !c.ok)
  const ok = r.external.length === 0 && r.violations.length === 0 && r.errors.length === 0 && failedChecks.length === 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  external=${r.external.length} cspViolations=${r.violations.length} pageErrors=${r.errors.length} checks=${r.checks.length - failedChecks.length}/${r.checks.length}`)
  for (const x of [...r.external.map(u => `external request: ${u}`), ...r.violations.map(v => `CSP violation: ${v}`), ...r.errors.map(e => `page error: ${e}`), ...failedChecks.map(c => `check failed: ${c.name}`)]) console.log('   ', x)
  failed ||= !ok
}
process.exit(failed ? 1 : 0)
