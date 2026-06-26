# SOCMINT Module — Draft Design Spec (v0.1, for operator review)

Status: DESIGN/RESEARCH ONLY. No source written. All library/ToS/Tor claims below are carried forward from Phase-1 primary-source reads; items the Phase-1 agents could not verify are marked **[UNVERIFIED]** and must not be treated as settled. All codebase anchors are the ones the integration agent returned; none are invented.

> Produced by the `socmint-design-research` ultracode workflow (8 agents: 5 parallel investigators → 2 adversarial reviewers → 1 synthesizer), 2026-06-26. See [[socmint-tooling-preference]].

## 1. Honest per-platform verdict

**Telegram — LEAD (workable, fragile dependency).** This is the only platform whose steady-state egress can satisfy the charter. Public-channel monitoring works via the GramJS user-MTProto API using a *join-then-filter-locally* architecture: global search (`messages.searchGlobal` / `channels.searchPosts`) is now monetized behind Telegram Stars (verified at `core.telegram.org/api/search`), so systematic monitoring must join each channel and apply keyword matching locally in-process. SOCKS5/Tor is supported in principle — GramJS ships a pure-JS `socks ^2.6.2` production dependency (verified in its `package.json`) — but reliability is **[UNVERIFIED]**: open issue #730 ("Proxy Socks5 doesn't work", Oct 2024) is unresolved with an inaccessible comment thread, and the beta API docs contradict the FAQ on whether the `proxy` param accepts SOCKS5 at all. The library is maintained slowly (last npm release v2.26.22, 2025-02-12; last commit 2024-12-26; ~16–18 months stale as of 2026-06-26; 291 open issues), so the collector must be swap-ready toward `mtcute` (v0.30.1, 2026-06-13, TS-native) — whose own SOCKS5 support is **[UNVERIFIED]**. Legal footing is the strongest of the three (public broadcast, hiQ-style posture) but Telegram's Content-Licensing/AI-Scraping terms create real contractual/ban risk, and unofficial-client accounts are explicitly placed "under observation" (verified at `core.telegram.org/api/obtaining_api_id`).

**Twitter/X — FRAGILE (defer; clearnet-only, rots on a 2–4 week cadence).** Every viable path requires authenticated burner accounts hitting X's internal GraphQL API via a Python sidecar (`twscrape` v0.19.1, 2026-06-26 — no maintained pure-JS equivalent was found; that absence is **[UNVERIFIED]** as definitive). Tor is hostile and effectively blocked: the Tor Project forum thread (fetched, runs to May 2025) reports total access failure over Tor exits; the "still hostile in June 2026" read is an **inference from trajectory, not a fresh datapoint [UNVERIFIED]**. The official API is paywalled (no free tier; pay-per-read ~$0.005/post). GraphQL `doc_ids` rotate every 2–4 weeks, breaking the scraper, and the documented worst-case failure is *silent truncation/redirect rather than an error* — which for evidentiary casework means an analyst reads absence-of-results as evidence-of-absence. Account-burn rate is real but has **no verified numeric threshold [UNVERIFIED]**.

**WhatsApp — NARROW MONITORING (recommend cut, not merely defer).** There is no public corpus and no search; the only capability is *receiving messages from groups the linked burner account has already joined* (Baileys `@whiskeysockets/baileys`, latest confirmed v7.0.0-rc13 May 2026; reported v7.4.4 June 2026 **[UNVERIFIED]** — npm returned 403). That makes "monitoring" an act of **participation**: the burner number appears in the target group's member list, visible to admins — observable, not passive. Tor is "configurable, not reliable, increases ban risk" (exit-IP datacenter flagging; circuit rotation triggers abnormal-IP detection). It is a clear ToS violation under clauses (a)(b)(c), ban timeline is weeks, and the session artifact is a live supply-chain target (the "lotusbail" token-harvesting fork, Dec 2025, is **[UNVERIFIED]** — Register article not fetched). The read-only "<2% ban over 12 months" figure is a single commercial blog with undisclosed methodology **[UNVERIFIED]**.

## 2. Recommended v1 scope

**v1 = Telegram only. X deferred. WhatsApp cut from the roadmap (not deferred).** The operator's prior (Telegram-only v1, X/WhatsApp deferred) is adopted and strengthened on WhatsApp.

The skeptic's load-bearing objection is correct and I am not overturning it: "SOCMINT" is not one capability behind one schema and one gate. Telegram is open-broadcast OSINT, Tor-routable in steady state, free, pure-JS, legally defensible. X and WhatsApp are auth-walled closed corpora that require clearnet, burner-account ToS violations, and (WhatsApp) visible infiltration. Folding all three under one module name + one `settings.socmint.networkEnabled` flag + one normalized schema launders two charter exceptions (clearnet egress) into a runtime toggle that will be flipped under operational pressure — and the charter reserves clearnet-exception decisions to the operator. So the architecture must make the asymmetry **visible**, not paper over it.

Concretely:
- Ship a **Telegram module** in its own settings namespace (`settings.telegram.networkEnabled`, off by default).
- WhatsApp: **drop.** It is the worst fit on every charter axis (participation-deanon, Tor-flaky, ToS, "don't become interesting") and is not open-corpus OSINT. If a future case genuinely needs it, it is a bespoke, case-scoped operator decision — not a standing capability.
- X: **defer**, and only ever re-enter as a *separate, explicitly clearnet trust-domain module* with its own settings namespace, its own egress code path (never sharing Telegram's transport or `safe-fetch`), persisted operator acknowledgement, and a hard rule that empty/truncated results surface as an error state, never as "no results."

I am also trimming the AI layer for v1 (see §3.6): **embedding-based relevance ranking only.** LLM entity extraction is deferred to a later, advisory-only iteration. Both reviewers independently flagged the extraction path as a fabrication/poisoning surface and the determinism claim as false; the irreducible v1 value is collection + local keyword filter + deterministic exact-id dedup.

## 3. Architecture (Telegram v1)

### 3.1 Collector service (main process only)
A new singleton under `src/main/socmint/` (or `src/main/telegram/`), following the services convention the integration agent documented: module-level export, module-scope state, lifecycle teardown wired into `src/main/index.ts:389-398` (alongside the existing `cancelAllAiStreams` / `chat.shutdown` / `localAi.stop` teardown). The collector exposes a thin interface — `join`, `backfill`, `subscribe`, `filterLocal` — so GramJS can be swapped for mtcute without touching the schema or IPC. Event-handler callbacks marshal to the renderer via `ipcMain`/`ipcRenderer`; no library code runs in the renderer.

Collection model: authenticated user account joins each monitored public channel; real-time stream via `addEventHandler` + `NewMessage` scoped to joined channel IDs; backfill via `channels.getMessages` (≤100/call, paginated, 1–2s spacing per the clura.ai rate guidance); keyword matching is a **local string/literal predicate in Node**, never `new RegExp()` on untrusted text (MEMORY.md ReDoS invariant). `FloodWaitError` is respected via GramJS `floodSleepThreshold`; no `GetParticipants`/member extraction is ever called.

### 3.2 Egress gating (off by default)
Follow the existing pattern exactly: gate at the IPC boundary in `src/main/ipc/register.ts` (egress checks already present at `:1189`, `:1202`, `:1265`), reading `settingsStore.read()` and checking `telegram.networkEnabled`. Add the boolean to `AppSettings` in `src/shared/types.ts` (the `networkEnabled` fields live at `:406,426,440,465`; new field initializes `false`). Settings persisted via `src/main/storage/json-fs.ts:896-920`. Renderer-side gates are insufficient — the main-process IPC check is the boundary.

### 3.3 Tor routing — hard transport binding, not a boolean
The red-teamer's critical point is adopted as an invariant: the gate boolean controls *whether* egress happens, not *over what transport*. The collector must construct its client with the Tor proxy **unconditionally set** and must **refuse to connect** (CCTV-proxy-style abort, mirroring `src/main/geoint/cctv-proxy.ts:339-343` which 503s when Tor is down) whenever `getBgTor().isBootstrapped()` is false — never connect without the proxy, never silently fall back to clearnet. Tor instance/lifecycle via `src/main/bgconn/tor-singleton.ts` (`getBgTor`/`setBgTor`); the SOCKS dial seam is `src/main/searchlight/tor-socks.ts:6 socksDial(host, port, socksPort)`.

**Stream isolation (new requirement).** `socksDial`'s `buildGreeting()` currently opens the SOCKS5 tunnel with no username/password, so distinct identities can share a circuit/exit and become correlatable. Each burner identity must be assigned a distinct SOCKS username/password pair so Tor's `IsolateSOCKSAuth` gives it its own circuit; the circuit is pinned for the session lifetime (mid-session rotation is itself a ban signal) and never shared between identities. Whether GramJS's bundled `socks` client actually forwards per-identity SOCKS auth must be **empirically verified [UNVERIFIED]** before lock. Note the SSRF caveat the integration agent flagged: `safeFetch` re-checks per hop but DNS-rebind (TTL=0) between check and connect is unmitigated — IP-pinning is needed for any fetch path.

### 3.4 Secret storage (burner sessions)
Use the existing `secretStore` (`src/main/secrets/index.ts:127-152`, three methods `get`/`set`/`delete`, Electron `safeStorage` backend with vault DEK wrapping at lines 104,122-124, file `secrets.enc`). Store encrypted, namespaced like the geoint layer-key convention (`geoint.LAYER_ID.key` at `register.ts:1204`): the StringSession (`client.session.save()`), the `API_ID`/`API_HASH` pair (static, per-phone-number, from `my.telegram.org`), the per-identity SOCKS auth pair, and the fixed device-fingerprint fields. `settings.json` holds only reference strings, never plaintext secrets. Session strings must never be live in two clients at once (a ban signal) — add a single-flight lock via the existing `withLock`/mutex (`src/main/util/mutex.ts`), with teardown in the before-quit lifecycle.

### 3.5 Normalized HarvestedItem schema + persistence
Define `HarvestedItem` in the existing `src/shared/post-mvp-types.ts` extension file (home of `GeoItem`, `CameraStream`) so main and renderer import it without a new IPC boundary. Canonical fields: deterministic `id` = SHA-256 of `platform:channelId:messageId` (reuse the `createHash` pattern at `src/main/services/memory/chunker.ts:22`); `platform`; `authorHandle` + `authorId`; `text`; optional `mediaType`/`mediaRef`; `channelId` + `channelLabel`; `messageId`; `publishedAt` (ISO from platform — never `Date.now()`); `harvestedAt`; `url` (permalink); `provenance{collectorVersion, jobId, caseId, keyword?}`. AI-populated fields (`relevanceScore`) are absent on raw harvest and filled in-place.

Persistence mirrors `src/main/geoint/case-events.ts`: a new `src/main/socmint/store.ts` maintains two secure-fs-backed, vault-encrypted sidecars per case in `caseDir/<caseId>/` — `socmint-items.json` and `socmint-jobs.json` (job metadata including **model name + Ollama version + quantization**, per §4). Use `secureWriteFile`/`secureReadFile` (`src/main/storage/secure-fs.ts:41,73`, atomic temp-then-rename, no plaintext intermediate) and wrap every read-modify-write in `withLock`. Exact-`id` dedup is deterministic and free — check membership before append.

### 3.6 Ollama layer (v1: ranking only)
Relevance ranking reuses the local embedding path, no chat-completion: `embed([keyword, ...items.map(i=>i.text)])` against `embeddings.ts` (`POST /api/embeddings`, `nomic-embed-text`, loopback `LOCAL_AI_ENDPOINT=http://127.0.0.1:11434` from `src/main/services/local-ai-paths.ts`), then `cosine()` (`src/main/services/memory/store.ts:58`), sorted descending with ties broken by `id` ascending. SSRF guard `validateAiEndpoint()` (`src/main/security/validate.ts:38`) permits loopback for Ollama. **Hard-pin both the endpoint and a `provider==='ollama'` assertion** for all SOCMINT AI calls (refuse if `s.ai.*` resolves to a cloud endpoint), and add a test that fails if SOCMINT ever resolves `s.ai.endpoint` — harvested investigative content must never ship to a third-party LLM. Bound per-item text length and embed in fixed-size, content-independent batches so one adversarial mega-item cannot dominate batch numerics. Near-dup is **advisory only** — collapse visually, never auto-hide; exact-id dedup remains primary.

**Determinism honesty:** do not characterize embedding ranking or any LLM output as deterministic. Ollama/llama.cpp output varies across GPU/CPU, version, quantization, and batch composition; `seed`/`temperature` (a) only take effect inside an `options:{}` object and (b) do not guarantee reproducibility regardless. Record model + runtime + quantization in `socmint-jobs.json`; achieve any required determinism *outside* the LLM (exact-id dedup, hashing).

### 3.7 Module registration & case-graph feed
Register per the integration anchors: import + adapter + `registerModule(...)` at `src/renderer/modules/register-builtins.tsx:41,179-181,220`; add the `ModuleKey` literal at `src/renderer/state/store.ts:14-45`; shortcut via `src/shared/types.ts:503-512` or `src/renderer/shell/Desktop.tsx:14-23`. HarvestedItems feed the case graph through the same per-case sidecar pattern geoint uses — items become nodes/leads the analyst reviews; **no extracted value auto-pivots collection** (see §4).

## 4. OpSec & Charter

The charter invariants and the red-teamer's findings converge on a small set of hard rules. Each is stated as an invariant with its mitigation.

**Treat every HarvestedItem field as hostile at the renderer boundary (critical — stored XSS / UI-injection).** `text`, `authorHandle`, `channelLabel`, `url`, `mediaRef` are fully attacker-controlled by the channel operator. Render `text` as `textContent` only — never `dangerouslySetInnerHTML` or markdown-to-HTML without a sanitizer+allowlist; scheme-guard `url` to http/https (reuse `isPublicHttpUrl` semantics, `validate.ts:637`) before building any anchor; normalize or escape bidi-override/confusable codepoints in handles/labels so a homoglyph handle cannot misattribute who said what in the evidentiary record; sanitize `mediaRef` to a basename (strip separators and `..`) at the save boundary so an attacker filename cannot traverse out of `caseDir/<caseId>/`. Route this design through the commit security-review hook, not a task review — MEMORY.md records that a prior per-task review missed exactly this class.

**No collector or renderer ever auto-fetches a URL extracted from harvested content (important — "beacon in the bait" deanon/SSRF).** Permalinks and embedded links are display-only and scheme-guarded. Media is saved only from the platform's own CDN over the collector's Tor transport, with sanitized basenames. If link-preview is ever wanted it is an explicit per-item analyst action over the same per-identity Tor circuit, through `safeFetch` with IP-pinning to close the DNS-rebind window.

**Transport is hard-bound per module; never silently fall back to clearnet (critical).** Telegram collector refuses to connect without the Tor proxy (§3.3). The X module, if ever built, is a quarantined clearnet trust domain with a separate egress path and persisted operator acknowledgement — it never shares `safe-fetch` or any transport with the Telegram collector. The gate boolean is not the anonymity boundary; the transport binding is.

**Per-burner Tor stream isolation (critical).** No two identities share a circuit/exit (§3.3). A shared poisoned/blocked exit otherwise burns multiple SIMs at once, and each burn forces a clearnet SMS re-registration — the one step Tor cannot protect, so burn-rate is proportional to deanon-exposure. On any FloodWait/ban signal: pin circuit and exponential-backoff; never rotate exit (rotation signals).

**Phone number is the irreducible deanon anchor.** Telegram auth requires a phone number embedded in the session and visible to Telegram regardless of Tor. Mitigation is a genuine burner SIM with no identity linkage (physical SIM preferred; VoIP is ban-flagged). One burner identity per monitored channel where correlation matters.

**Credential-acquisition ceremony is OpSec-gated (important, not covered in Phase-1).** `API_ID`/`API_HASH` from `my.telegram.org` must be obtained over Tor from a clean browser unlinked to the operator — acquired from an attributable session, the static `API_ID` is a permanent deanon anchor independent of all later Tor routing. The initial SMS ceremony is clearnet and must originate from a device/IP with no operator linkage. Device-fingerprint fields (`deviceModel`/`systemVersion`/`appVersion`/`langCode`) are set to a plausible fixed real-client signature per identity and stored with the session so they never drift; default GramJS values are recognizable as unofficial.

**Supply-chain and at-rest integrity.** Pin the Telegram library by integrity hash in `package-lock.json` and verify package name/scope at install (the WhatsApp "lotusbail" incident is **[UNVERIFIED]** but the threat class is real). Session/StringSession material is written only via `secureWriteFile` (atomic, no plaintext intermediate).

**No-log invariant.** `HarvestedItem.text`, all secretStore-backed values (StringSession, `API_ID`/`HASH`, SOCKS auth), and burner phone numbers never reach logs, crash dumps, or `settings.json`. Errors surfaced to the renderer are scrubbed. Provenance (collectorVersion, jobId, caseId, model+runtime) lives in the encrypted sidecar, not in app logs.

**Charter-conflict honesty.** Read-only join-then-filter-locally minimizes both detection and harm, but Telegram's Content-Licensing/AI-Scraping terms plausibly treat systematic OSINT monitoring as outside "ordinary, legitimate, intended use." This is contractual/ban risk (account + `API_ID` revocation), not criminal exposure for authorized casework — a known residual risk to design around, not eliminate. If the Ollama layer is ever *trained* on harvested data, that triggers the separate AI-scraping prohibition; v1 does inference only, no training (see §6).

## 5. Decisions needed from the operator

These are the genuine scoping choices only the operator can make. Stated mutually exclusive where possible.

1. **v1 platform scope.** Confirm **Telegram-only v1** (my recommendation), OR direct a broader v1. If broader, which platforms and under what exception.

2. **WhatsApp disposition.** (a) **Cut from roadmap** (my recommendation), OR (b) defer as a possible future module, OR (c) keep in scope now — accepting visible burner-in-member-list participation, weeks-long ban timeline, clear ToS violation, and Tor-flaky egress as a documented charter exception.

3. **X disposition.** (a) **Defer**, re-entering only as a separate operator-authorized clearnet trust-domain module (my recommendation), OR (b) cut entirely, OR (c) build now as a quarantined clearnet module — accepting the per-account clearnet+phone deanon at signup, the 2–4 week silent-breakage maintenance tax, and a Python sidecar runtime.

4. **Burner-account provisioning model.** Physical burner SIM per identity (lower ban-risk, higher logistics) vs. virtual/VoIP numbers (flagged, higher ban-risk) — and one-identity-per-channel vs. shared-identity (correlation tradeoff). Who provisions, and the acquisition-ceremony discipline (Tor + clean browser for `my.telegram.org`; clean device/IP for SMS).

5. **Tor posture per platform.** Telegram: **Tor-required** (refuse-on-unbootstrapped) is my recommendation — confirm, vs. Tor-preferred-with-operator-override. For any future X/WhatsApp module, an explicit clearnet exception must be authorized and persisted before code exists.

6. **AI layer scope for v1.** Confirm **embedding-based relevance ranking only**, with LLM entity extraction deferred (my recommendation), OR authorize advisory-only LLM extraction now (every entity rendered as a pointer to its exact source span, analyst-confirmed, never a stored fact, never re-injected into matching logic) — noting the LLM path is not deterministic and can fabricate entities.

7. **Library lock + empirical validation gate.** Approve a pre-lock empirical test of SOCKS5-over-Tor against live Telegram (resolving issue #730 and the FAQ-vs-docs contradiction) and a GramJS-vs-mtcute decision behind the swap-ready collector interface, before any implementation plan is finalized.

8. **Targeted-model track (see §6).** Confirm whether v1 should include the cheap *label-capture hook* (analyst accept/reject + entity corrections persisted to the encrypted sidecar) that makes a future local fine-tune possible — recommended, since it is near-free in v1 and the only thing that makes a later fine-tune defensible — while the fine-tune itself stays deferred to v2+.

## 6. Addendum — deferred targeted-model track (operator question, 2026-06-26)

The operator asked whether a small targeted local model could be trained for the SOCMINT AI layer. Recommendation: **yes, but as a measured v2+ track, not v1** — and not "trained in Ollama" (Ollama serves; training is external — LoRA via unsloth/axolotl/llama-factory → GGUF → `ollama create` from a pinned Modelfile).

**v1 stays training-free.** Hard entities (URLs, @handles, BTC/XMR/ETH addresses, phone, email) come out via deterministic regex + checksum validation — exact and reproducible, which the charter wants and which an LLM both hallucinates and misses. Soft relevance is handled by the embedding-cosine ranking of §3.6. Schema-reliable structured output, when LLM extraction is later enabled, is obtained via grammar/`format:json`-constrained decoding — not by fine-tuning.

**Why fine-tuning is a v2+ payoff, not a v1 premise:**
- A fine-tune is only defensible when a held-out eval shows measured uplift over the off-the-shelf baseline (charter: no "this is better" without measurement). That eval set cannot exist until the module has run against real casework and the analyst's accept/reject + entity corrections have been captured as labels. Hence Decision 8: build the cheap label-capture hook in v1; the labels accumulate for free.
- **OpSec / memorization (load-bearing):** a model fine-tuned on real case material memorizes that material into its weights. Such an artifact must therefore stay strictly operator-local — trained on-device, **never bundled into the installer or distributed** — or it would leak sensitive case content via the model. This argues for a future on-device fine-tuning capability, never a shipped pre-trained SOCMINT model.
- The genuine payoff, once the eval justifies it: a LoRA'd 1–3B matching an 8B on the narrow relevance/extraction task gives lower latency and higher concurrency for bulk stream processing — a real win for monitoring many channels, but the payoff, not the starting point.

Training data provenance also re-triggers Telegram's AI-scraping prohibition (§4 "Charter-conflict honesty"): inference-only is the v1 posture; any training-on-harvested-data is a separate operator decision.

## 7. Transport & Library-Lock Recommendation (resolves §5 decision 7)

*Resolves the three open transport questions via three primary-source probes (GramJS source + issue threads; mtcute/fuman source; Tor manual + our own bgconn/dial source), `socmint-transport-derisk` ultracode workflow, 2026-06-26. Read-only research; no code modified.*

### 7.1 Verdict: MTProto client over our embedded Tor SOCKS5 — GO-WITH-CAVEAT
Mechanically sound from source for *both* candidate libraries; the only remaining gap is a live network confirmation, not a design unknown.

Verified from source:
- **Tor isolation primitive (source-verified).** `IsolateSOCKSAuth` maps a distinct SOCKS5 `(user,pass)` to a distinct circuit, is on by default, and is set explicitly on our embedded bgconn Tor at `src/main/bgconn/torrc.ts:8` (`SocksPort 127.0.0.1:<port> IsolateSOCKSAuth IsolateDestAddr`). A grep for `NoIsolate*` across `src/` returned nothing — nothing disables it.
- **Per-connection SOCKS auth forwarded by both libraries (source-verified).** GramJS hands `proxy.username`/`password` to `SocksClient.createConnection({proxy:{userId,password}})` per SOCKS5 socket (`gramjs/extensions/PromisedNetSockets.ts`), via the maintained bundled `socks` package (RFC 1929 sub-negotiation present, unchanged 2.6.1→2.8.9). mtcute forwards `user`/`password` through `@fuman/net` `connectV5()` (`buildSocks5Auth` on method `0x02`).
- **Issue #730 resolved = documentation bug, not capability bug.** GramJS dispatches on key-presence (`"MTProxy" in proxy`), so the docs' `MTProxy:false` SOCKS5 example wrongly routes into the MTProxy path and throws (separate issue #771). Correct SOCKS5 config carries **no `MTProxy` field at all**: `{ip,port,socksType:5,username,password,timeout}`. SOCKS5 works.

Could not verify (carry forward — gates GO→unconditional, all closable by the §7.4 smoke test, none requiring redesign): no live packet-capture of zero-clearnet-egress; GramJS `useWSS` default may bypass the SOCKS path (must set `useWSS:false`); mtcute SOCKS5 reply ATYP `0x03` handling unconfirmed (low risk); **Telegram's own Tor-exit tolerance / burner-ban behavior is a policy risk independent of transport correctness, not settleable from source**; Tor method-selection when both no-auth and userpass are offered (convention says creds win as isolation token).

### 7.2 Library lock — do not lock from docs; smoke-test both, then lock **mtcute** if both pass
| Factor | GramJS (`telegram` 2.26.22) | mtcute (`@mtcute/node` 0.30.1) |
|---|---|---|
| SOCKS5 + per-conn auth | Forwarded, source-verified | Forwarded, source-verified |
| Stream isolation | Yes (one client per burner) | Yes (one client per burner) |
| Maintenance | last commit 2024-12-26 (~18mo stale), 323 open issues, JS-with-types | v0.30.1 2026-06-13 (~monthly), 18 open issues, TS-native |
| Docs for our path | actively *wrong* for SOCKS5 (#730/#771) | incomplete but source-confirmed |
| Footgun | `useWSS` may bypass SOCKS; key-presence `MTProxy` dispatch | `BNDADDR` ATYP `0x03` possibly unhandled |

mtcute is healthier on every measured metric and TS-native; the countervailing risk is **single-maintainer bus-factor-1** (the whole `@fuman/*` chain is one author). Keep the spec's swap-ready `join/backfill/subscribe/filterLocal` interface so the lock stays cheap to reverse.

### 7.3 Stream isolation — the load-bearing finding
**Telegram connects to a small fixed set of DC IPs, so `IsolateDestAddr` will NOT separate two burners hitting the same DC — only `IsolateSOCKSAuth` with distinct per-identity credentials does.** Whichever library is locked *must* forward a per-burner SOCKS `(user,pass)`, or all burners collapse onto shared circuits regardless of torrc. The repo already implements this pattern to reuse, not reinvent: `src/main/plugins/tor-egress.ts:67-115` (`socksConnect` with `buildGreeting({auth:true})`), RFC 1929 codec in `src/main/chat/socks5.ts:26-28,40,49`, credential minting at `src/main/bgconn/lane.ts:8` (`newSocksCreds`) / `tor-egress.ts:41,49` (per-burner instead of per-case). Dial the bgconn instance (`src/main/index.ts:325-335`), **not** the chat Tor (`src/main/chat/transport-tor.ts:57` emits a bare SocksPort with no isolation flags, dials no-auth).

The Telegram client owns its own socket — it does **not** use our `socksDial()`; we pass per-burner creds into the library's native proxy param:
- GramJS: `proxy:{ip:'127.0.0.1',port:bgSocksPort,socksType:5,username:'<burner-id>',password:'<circuit-secret>',timeout:5}`, `useWSS:false`, no `MTProxy` field.
- mtcute: `transport:new SocksProxyTcpTransport({host:'127.0.0.1',port:bgSocksPort,version:5,user:'<burner-id>',password:'<circuit-secret>'})`.

One client per burner; DC redirects reuse the same creds → same circuit (desired; mid-session rotation is a ban signal). (Our own `socksDial`/`buildGreeting` at `src/main/searchlight/tor-socks.ts:14` sends no-auth today and is **not** on the Telegram path — only relevant if we ever isolate that lane separately.)

### 7.4 Minimal live smoke test (converts UNVERIFIED → settled; unblocks the lock)
1. Start embedded bgconn Tor (existing `IsolateSOCKSAuth` torrc).
2. Two clients, one per burner, at `127.0.0.1:<bgSocksPort>`, identical except creds `(id-A,pw-A)` vs `(id-B,pw-B)`; GramJS `useWSS:false`.
3. `connect()` both; for one, `getSelf()`/join a public channel and pull a few messages (end-to-end MTProto over Tor).
4. **Isolation:** via Tor control port `GETINFO circuit-status` confirm distinct circuits for distinct creds, same circuit for identical creds — **repeat against the same DC IP** to prove it's `IsolateSOCKSAuth`, not `IsolateDestAddr`.
5. **No leak:** `tcpdump` during connect *and* a forced DC redirect; zero SYNs to `149.154.x.x`/`91.108.x.x` (settles `useWSS` bypass + the #730 leak question).
6. **(mtcute)** capture Tor's raw SOCKS5 reply, confirm `connect.ts` handles the ATYP Tor sends.

Steps 4–5 passing closes `works_inferred`→`works_verified` and locks the library (→ mtcute unless a defect surfaces). The one item this does **not** settle is Telegram's Tor-exit tolerance / ban behavior — track as a standing policy risk, not a transport question.
