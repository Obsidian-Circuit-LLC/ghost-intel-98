# CCTV-over-Tor — `ga98cctv://` main-side proxy (redesign) + v3.21.0 finalisation

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Replaces the webview/player approach (Tasks 6–8 of the batch-2 plan) after it hit the `webviewTag:false` red-team lockdown. Keeps the `geoint.cctvOverTor` setting + Settings toggle already committed (T6).

**Goal:** Route CCTV stream viewing through Tor by serving every stream byte from a main-process proxy over a privileged `ga98cctv://` custom scheme — the renderer keeps its existing hls.js/`<img>`/`<video>` path. No `<webview>`, no reversal of the webviewTag decision, all egress main-side over the bgconn Tor SOCKS circuit.

**Architecture:** Mirror the existing `ga98media` privileged-scheme handler (`src/main/media/protocol.ts`). The handler decodes the origin URL, dials it through Tor via the existing `socksDial()` (`src/main/searchlight/tor-socks.ts`) + `https.request({createConnection})` (the `probe.ts` pattern), and streams the response back. HLS manifests are URL-rewritten so segments stay on the proxy. When Tor isn't bootstrapped the handler returns 503 and the renderer shows TOR NOT READY — never clearnet fallback.

## Global Constraints
- No new npm deps. Reuse `socksDial`, `https`, `hls.js`. Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF`.
- Tor SOCKS port: `getBgTor()?.isBootstrapped() ? .socksPort() : null`; null ⇒ 503 / refuse, never clearnet.
- Only `http(s)` origin URLs may be proxied; reject everything else. Cap body + time (reuse `limits.ts`).
- `webviewTag:false` and the `will-attach-webview` lockdown (`src/main/index.ts`) are NOT touched.
- Do not stage `native/dcs98-confine/Cargo.lock`.

---

### Task R1: Remove old mechanism + shared proxy helpers

**Files:**
- Delete: `resources/cctv-player/` (player.html, player.js, hls.min.js), `src/main/geoint/cctv-tor.ts` (session-proxy)
- Rewrite: `src/shared/cctv/tor.ts` → `src/shared/cctv/proxy.ts` (pure, no Electron/Node)
- Rewrite: `test/cctv-tor.test.ts` → `test/cctv-proxy.test.ts`
- Modify: any import of the removed symbols (`cctvPlayerUrl`, `resolveCctvSession`, `applyCctvTorProxy`, the player IPC) — grep and clean.

**Interfaces (produce, all pure):**
- `cctvProxyUrl(originUrl: string): string` → `ga98cctv://v1/` + `encodeURIComponent(originUrl)` as the single path segment. Throws if `originUrl` isn't `http(s)`.
- `parseCctvProxyRequest(requestUrl: string): string | null` → inverse; returns the decoded origin `http(s)` URL or `null` if malformed/disallowed.
- `cctvRoutableKind(kind: string): boolean` → true for `hls|http|mjpeg|mp4`, false for `youtube|webpage|rtsp`.
- `rewriteHlsManifest(manifest: string, baseOriginUrl: string): string` → for each non-comment URI line and each `URI="..."` attribute (EXT-X-KEY, EXT-X-MEDIA, EXT-X-STREAM-INF variants), resolve against `baseOriginUrl` and replace with `cctvProxyUrl(resolved)`. Comment/`#EXT` lines without a URI pass through unchanged.

- [ ] **Step 1 (test first):** `test/cctv-proxy.test.ts` — round-trip `parseCctvProxyRequest(cctvProxyUrl('https://h/a?b=c'))==='https://h/a?b=c'`; `cctvProxyUrl('file:///x')` throws; `parseCctvProxyRequest('ga98cctv://v1/'+encodeURIComponent('ftp://x'))===null`; `cctvRoutableKind('hls')===true`, `cctvRoutableKind('youtube')===false`; `rewriteHlsManifest` rewrites a relative segment `seg0.ts` and an absolute `https://cdn/x.ts` BOTH to `ga98cctv://` URLs, and leaves `#EXTINF:...` untouched.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Delete the old files; create `src/shared/cctv/proxy.ts` with the four functions. Use `new URL(line, baseOriginUrl)` for resolution.
- [ ] **Step 4:** Grep for old symbols and remove their imports/usages (the old `cctvTorStatus`/`applyCctvTorProxy` IPC + preload + register wiring). Leave the `geoint.cctvOverTor` SETTING and the Settings toggle in place.
- [ ] **Step 5:** Run the new test + `pnpm typecheck`. Expected PASS/clean.
- [ ] **Step 6:** Commit `refactor(geoint): replace CCTV webview approach with ga98cctv proxy helpers`.

---

### Task R2: `ga98cctv://` scheme + Tor proxy handler (main)

**Files:**
- Create: `src/main/geoint/cctv-proxy.ts`
- Modify: `src/main/index.ts` (add `ga98cctv` to the `registerSchemesAsPrivileged` array ~:24-28; call `registerCctvProxy()` after `app.whenReady`, beside the other `protocol.handle` registrations)
- Modify: `src/main/ipc/register.ts` + `src/shared/ipc-contracts.ts` + preload — add `geoint:cctvTorReady` → `boolean` (so the Viewer can show TOR NOT READY pre-emptively).

**Interfaces (produce):**
- `registerCctvProxy(): void` — registers `protocol.handle('ga98cctv', handler)`.
- `cctvTorReady(): boolean` — `getBgTor()?.isBootstrapped() ? true : false`.

**Handler contract:**
- Parse origin via `parseCctvProxyRequest(request.url)`. If `null` → `new Response('bad request', {status:400})`.
- `port = getBgTor()?.isBootstrapped() ? .socksPort() : null`. If `null` → `new Response('tor unavailable', {status:503})`.
- `const socket = await socksDial(originHost, originPort, port)`; then `https.request({ createConnection:()=>socket, servername:host, method: request.method==='HEAD'?'HEAD':'GET', path, headers:{ 'User-Agent':UA, Range: request.headers.get('range') ?? undefined, Connection:'close' } })`. Pass `Range` through for `<video>`/mp4 seeking.
- If the response is an HLS manifest (path ends `.m3u8` OR content-type matches `mpegurl`): buffer it (capped via `limits.ts`), `rewriteHlsManifest(text, originUrl)`, return a `Response` with `content-type: application/vnd.apple.mpegurl`.
- Otherwise stream the body: `new Response(Readable.toWeb(res), { status: res.statusCode, headers: pick(res.headers, ['content-type','content-length','content-range','accept-ranges','cache-control']) })`. Apply a time cap; on socket error return 502.
- Never fall back to a direct (non-Tor) fetch.

- [ ] **Step 1:** Create `cctv-proxy.ts` implementing `registerCctvProxy()` + `cctvTorReady()` per the contract above (reuse `socksDial`, the `httpsRequest` pattern from `probe.ts`, and `Readable.toWeb`).
- [ ] **Step 2:** `index.ts` — add `{ scheme:'ga98cctv', privileges:{ stream:true, supportFetchAPI:true, secure:true, standard:true } }` to the privileged array, and call `registerCctvProxy()` after ready.
- [ ] **Step 3:** Wire `geoint:cctvTorReady` IPC (channel const + signature + `safeHandle(... , () => cctvTorReady())` + preload bridge).
- [ ] **Step 4:** `pnpm typecheck`. Expected clean. (Network behaviour is smoke-verified.)
- [ ] **Step 5:** Commit `feat(geoint): ga98cctv Tor proxy scheme + handler (main-side egress only)`.

---

### Task R3: CSP + EyeSpy Viewer integration

**Files:**
- Modify: `src/renderer/index.html` (CSP `img-src`/`media-src`/`connect-src`: add `ga98cctv:`)
- Modify: `src/renderer/modules/eyespy/Viewer.tsx`

**Interfaces:** Consumes `cctvProxyUrl`, `cctvRoutableKind` from `@shared/cctv/proxy`; `window.api.geoint.cctvTorReady()`; `geoint.cctvOverTor` via `useSettings`.

- [ ] **Step 1:** CSP — append `ga98cctv:` to `img-src`, `media-src`, and `connect-src` (hls.js fetches manifests/segments via fetch/XHR → `connect-src`). No other directive changes.
- [ ] **Step 2:** Viewer — read `cctvOverTor`. When **off**, the existing render path is unchanged.
- [ ] **Step 3:** When **on** and `cctvRoutableKind(stream.kind)`: on mount `await window.api.geoint.cctvTorReady()`; if false → render a `TOR NOT READY` placeholder, do not load. If true → compute `const src = cctvProxyUrl(stream.url)` and feed THAT to hls.js `loadSource`/`<video src>`/`<img src>` (replacing `stream.url` in those branches only when the Tor path is active).
- [ ] **Step 4:** When **on** and NOT routable (`youtube`/`webpage`/`rtsp`): render a "Not Tor-routable — disable CCTV-over-Tor to view" notice instead of silently loading clearnet.
- [ ] **Step 5:** `pnpm typecheck` + `pnpm test` (full). Expected clean/PASS.
- [ ] **Step 6:** Commit `feat(eyespy): view CCTV over Tor via ga98cctv proxy + CSP`.

---

### Task R4: Version + docs (no merge/publish)

**Files:** `package.json` (→ `3.21.0`), `RELEASE_NOTES_v3.21.0.md` (new), `README.md`.

- [ ] **Step 1:** Bump version to `3.21.0`.
- [ ] **Step 2:** Draft `RELEASE_NOTES_v3.21.0.md` — W1–W6, noting: Maigret already bundled (no change); AIS already worked, ADS-B was the failure (now backed-off); CCTV-over-Tor via `ga98cctv://` main-side proxy (full segment routing incl. HLS-manifest rewrite; youtube/webpage not Tor-routable; live video over Tor may be slow); PDF dep-free. SHA/size placeholders (operator fills at release).
- [ ] **Step 3:** README — Status entry (v3.21.0 above v3.20.0), version strings, install line, test count (after green).
- [ ] **Step 4:** `pnpm typecheck` + `pnpm test`. Expected clean/PASS.
- [ ] **Step 5:** Commit `release: v3.21.0 — batch 2 + CCTV-over-Tor proxy (docs only; merge/publish gated)`.

## Self-review
- Mechanism swap is total: old session-proxy/player files deleted in R1; no webviewTag touch.
- Security focus for the whole-branch review: the `ga98cctv` handler is the new attack surface — SSRF (only http(s); over Tor the exit resolves, so LAN SSRF is out of band, but still reject non-http(s)); no clearnet fallback on Tor-down; manifest rewrite leaves no absolute https segment un-proxied; body/time caps; handler returns errors, never throws into the protocol layer.
- Type consistency: `cctvProxyUrl`/`parseCctvProxyRequest` round-trip; `ga98cctv://v1/` prefix fixed; `cctvRoutableKind` kind set matches the Viewer branches.
