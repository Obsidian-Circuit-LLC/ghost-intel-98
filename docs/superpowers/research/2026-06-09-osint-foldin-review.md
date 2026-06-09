# OSINT Fold-In Review — CT-OSINT-AI-Tools + deep-eye into the DCS98 OSINT plugin

**Date:** 2026-06-09. **Status:** analysis (pre-spec) for subsystem 2 (the closed, paid OSINT plugin).
**Method:** four parallel readers over `/home/ghostexodus` (CT-OSINT-AI-Tools = "GhostExodus OSINT Platform") and `/home/ghostexodus/deep-eye`, grounded in source, not READMEs.
**Decision inputs:** offensive suite is IN (operator, 2026-06-09); subscription value/payment parked (operator confers with GhostExodus).

---

## 1. License / provenance verdict (the gate that sank Shadowbroker)

| Project | License | Deps | Verdict |
|---|---|---|---|
| **CT-OSINT-AI-Tools (GhostExodus)** | None on file; operator's own original work | All permissive (Telethon/LlamaIndex MIT, ChromaDB/langdetect Apache, WeasyPrint/Jinja2 BSD); **no GPL/AGPL** | **Foldable.** Add an explicit LICENSE; readers found no copied third-party code. |
| **deep-eye** | MIT (`Copyright (c) 2025 Deep Eye Security`, fork of zakirkun/deep-eye) | All permissive; **no GPL/AGPL**; no vendored exploit code (original logic, standard OWASP vectors) | **Foldable.** |
| **Shadowbroker** | **AGPL-3.0 (fork)** + it's a server + live-feed ToS | — | **OUT** of the closed plugin (legal + architecture). |

**Shadowbroker entanglement, resolved:** deep-eye's `shadowbroker_client.py` + `hmac_auth.py` are MIT-clean original code that *call* an AGPL server over a network API. Under AGPL §13 that does **not** propagate AGPL to the client. So the bridge **client** can be folded in (kept optional/off); the AGPL **server** is never bundled. The bridge *capability* (Shodan/CT/geo pre-aggregation) simply requires a separately-run Shadowbroker instance the user points at — not our concern to ship. Keep the client behind a `--no-bridge`-equivalent gate, off by default.

**One IP cleanup:** add a LICENSE to CT-OSINT-AI-Tools and keep the private plugin repo's provenance clean (permissive/own-original only). Do not let Shadowbroker source touch it.

---

## 2. The TWO net-new platform capabilities this fold-in forces (load-bearing)

Both are extensions to the signed-plugin capability model from the platform we just built (`egress/secrets/case-storage/plugin-storage/entity-registry/timeline`). **Neither exists today.** They mean a **Platform v1.1 increment** before subsystem 2 can fully land.

### 2a. `authorized-target-egress` (a.k.a. `raw-scan-egress`) — for the offensive engine
DCS98's egress gate deliberately **rejects loopback/private/link-local** targets (SSRF defense, correct for OSINT). But authorized pentesting's most common targets **are** internal/private/loopback. So:
- A capability **separate** from `egress`, that **permits private/loopback targets** — but **only** for targets inside a loaded **engagement ScopeManifest** (expiry-mandatory, include/exclude by domain/CIDR/ASN). deep-eye's `core/scope_manifest.py` + `core/scope_enforcer.py` are clean, tested, stdlib+PyYAML — port or import directly.
- **Per-request** scope enforcement, not startup-only. *deep-eye's current model is a startup gate; `--no-bridge` removes auth entirely; the crawler can wander off-scope.* DCS98 must supply the continuous invariant — this is the responsible-use control **we own**.
- Every probe appended to DCS98's **immutable timeline** as a tamper-evident audit record (target, attack type, payload hash, status, finding). The timeline is the right home for pentest audit, far better than deep-eye's plaintext log file.
- A human-readable **authorization prompt**: "This plugin will send attack traffic to <target> under engagement <id>, expiring <date>. Confirm?"
- Tor: opt-out for offensive (attack traffic over Tor is hostile to the network + slow); offer direct-to-target or a dedicated pentest proxy (Burp/ZAP) which pentesters want anyway. Rate-limiting must be enforced (deep-eye has the config knob but doesn't honor it; the API tester fires 100 reqs, auth tester 20 — disclose before scan).

### 2b. `persistent-background-connection` — for Telegram monitoring
Telethon/MTProto holds a **durable, authenticated, non-anonymous** connection tied to a **real phone number + session file** — categorically different from the platform's SSRF-hardened single-request egress, and from Tor workflows (must be compartmented). Needs: a distinct secret category in the vault (`api_id`/`api_hash`/phone/session), an onboarding flow (creds → OTP → session), and an explicit "this is NOT anonymous" labeling. Highest-value new data source; most operationally sensitive.

---

## 3. Integration shape

### CT-OSINT-AI-Tools (GhostExodus) — mostly CHERRY-PICK to TS
Almost every engine is a thin Ollama-HTTP wrapper + pure logic, portable into DCS98 main/TS against bundled Ollama + the existing vault/timeline/entity registry. Highest-value, in order:
1. **Threat classifier IP** — the `ghostexodus.Modelfile` system prompt + 4 few-shot examples (CONTEST/Prevent framing, JSON-only schema, grievance-vs-operational distinction). This is the most transferable IP. Bundle the Modelfile, register with Ollama on first run (`/api/create`), or run the system prompt against the default model. ~half-day TS wrapper.
2. **Keyword/severity engine + alert rules** (KEYWORD + FREQUENCY triggers) — pure data + arithmetic, mechanical port.
3. **Entity extractor + co-occurrence graph** — regex + LLM-alias extraction → co-occurrence edges; fits DCS98's typed entity registry (use DCS98's storage, not GhostExodus's flat JSON-blob `linked_entities`).
4. **Stylometry** (TTR, trigrams, cadence, emoji ratio, cosine) — ~130 lines pure logic; `langdetect`→`franc` (npm).
5. **Evidence bundle format** (manifest.json + chain_of_custody.txt + standalone verify script) — portable design pattern. **Upgrade opportunity:** GhostExodus's "legally defensible" claim is overstated (SHA-256 over *mutable* SQLite + *mutable* audit log; no signature/WORM/timestamp/Merkle). DCS98's vault + immutable timeline + **our new PQ-hybrid signing** can make this *genuinely* tamper-evident — a real differentiator.
6. **INTELREPORT** multi-section LLM synthesis — port the Ollama sections; PDF renderer is a later decision.
7. **Timeline/temporal analytics** (posting frequency, severity stacking, hourly-UTC TZ inference) — small, keep.
- **BUNDLE (Python subprocess):** only the **Telegram collector** (Telethon has no mature TS equivalent) — needs capability 2b.
- **DROP:** ChromaDB + LlamaIndex (DCS98 has its own pure-JS vector store; carry only the `get_temporal_cluster` metadata-filter pattern + the retrieve-top-k→LLM RAG shape), multi-user RBAC (DCS98 is single-user vault), SMTP/ntfy egress (use DCS98 native), no-case-object model (DCS98's per-case model is superior).

### deep-eye — SPLIT (recon cherry-pick, offensive bundle)
- **CHERRY-PICK to TS (~600 lines, no complex state):** CT-log enum (`crt.sh`), DNS intel (MX/SPF/DMARC/NS), Wayback check, cloud-bucket probing, tech fingerprint, the **HMAC bridge client**, and the **scope manifest/enforcer** (the best piece — port it; it's the heart of 2a). *Note the advertised stubs that don't work: WHOIS, SSL, email-harvest, breach-check, Google-dorks-execution — don't promise those.*
- **BUNDLE (Python subprocess):** the **offensive engine** — `core/vulnerability_scanner.py` (1281 lines) + 5 module testers (api/auth/file_upload/business_logic/websocket) + obfuscator + AI payload generator. ~3,500 lines of tested attack logic; porting = 2,500+ lines + real regression risk + zero capability gain. Drive it as `python deep_eye.py -u <target> --config <generated>`, Ollama-only (cloud providers disabled), stream JSON → DCS98 case storage. Bundle a minimal CPython (PyInstaller/embedded venv). The offensive catalog is largely **real** (SQLi/XSS/cmdi/SSTI/XXE/traversal/CSRF/CORS/CRLF/host-header/deser/authn-bypass/JWT/API-top-10/file-upload-shells/business-logic/race-conditions). Payload gen via bundled Ollama is the right local posture.
- **DROP:** all cloud AI providers (Ollama-only — charter), dead deps (selenium, scikit-learn, numpy, pandas, shodan-SDK, aiohttp, the unused `ollama` SDK), deep-eye's unsigned importlib plugin system, the collaboration module, the interactive-report Chart.js **CDN** call.
- **Bugs to patch on fold-in:** `WebSocketTester.test()` AttributeError (calls `.test()`, method is `.test_websocket()`); `_check_ssrf` is a stub (blind-SSRF/OOB needs an OAST server — don't advertise it); rate-limit config is not honored.

**Net plugin shape:** a TS/Electron-main orchestrator + TS-native recon/intelligence engines + a **bundled CPython** running deep-eye's scanner (and the Telethon collector) as subprocesses over loopback, all behind the signed-plugin trust boundary. Hybrid, but coherent: DCS98 already bundles Ollama/Tor/ExifTool, so bundled-runtime is an established pattern. **Sign/checksum the bundled `deep_eye.py` as part of the plugin artifact** (the plugin's own hashed bytes cover it).

---

## 4. The product picture (is it "better than Maltego"?)

Combined: local-AI threat classification + entity correlation + stylometry + tamper-evident (PQ-signed) evidence + Telegram monitoring (GhostExodus) + recon + a full authorized offensive engine (deep-eye), on DCS98's Win98 shell + encrypted vault + immutable timeline + signed-plugin platform + Tor + bundled local AI + case management. That is materially **beyond** Maltego's collection-only model — it adds a *brain* (local LLM analysis), *evidence integrity*, *case/collaboration*, and *offense*, with no paid-API dependency and clean IP. The wedge holds.

---

## 5. Sequencing recommendation

1. **Merge the platform** (feat/plugin-platform → main) — foundation.
2. **Platform v1.1 increment:** design + build the two new capabilities — `authorized-target-egress` (scope-manifest-gated, per-request-enforced, timeline-audited, authorization-prompt UX) and `persistent-background-connection` (Telegram). These are platform-level (public core) and must land before the plugin can fully use them. The offensive capability especially needs design → red-team → review **before** integration code (dual-use; the authorization model is the load-bearing safety control).
3. **Subsystem-2 spec → plan → build** (private repo): the OSINT plugin — CT-tools cherry-picks + deep-eye recon (TS) + bundled-Python offensive/Telegram, signed with the **offline release key** (replace the dev `PINNED_KEYSETS`).
4. **Parked:** subscription value + payment vehicle (operator + GhostExodus) — the offline-signed-update model remains the charter-compatible candidate; revisit when they've conferred.

## 6. Honest caveats carried forward
- GhostExodus evidence integrity is weaker than its "legally defensible" claim (mutable store, no signature/WORM/timestamp) — fixable, and an upgrade via our PQ signing.
- deep-eye has non-functional advertised features (WHOIS/SSL/email/breach/dorks stubs, blind-SSRF stub) and a couple of runtime bugs — scope the plugin's promises to what actually works.
- deep-eye scope enforcement is startup-only with a `--no-bridge` bypass — DCS98 must own per-request enforcement + audit. This is non-negotiable for shipping offense responsibly.
- Telegram is authenticated, non-anonymous egress tied to a real number — compartment from Tor workflows; label clearly.
