# Ghost Intel 98 — v3.22.0

## SOCMINT collectors activated

The three SOCMINT collectors are now **live-wired into the gated IPC** — the real libraries are installed, bundled, boot-verified, and reachable from the app (no longer sealed stubs):

- **Telegram** — `@mtcute/node` (MTProto), public-channel join-then-filter.
- **WhatsApp** — `@whiskeysockets/baileys`, monitoring-only (the burner is a visible group member by design), pairing-code linking.
- **X / Twitter** — `twscrape` via a Python sidecar (separate clearnet trust domain).

All three normalize into the shared `HarvestedItem` pipeline (encrypted per-case store, exact-id dedup, local-Ollama relevance ranking, analyst labels).

## Security posture (the load-bearing part)

- **Egress gated OFF by default.** Nothing connects until you explicitly enable it (`settings.socmint.networkEnabled`; X additionally requires `settings.x.clearnetAcknowledged`).
- **Gate-before-egress, adversarially verified.** No collector `connect()` / Baileys socket / `requestPairingCode` can run before the gate check — confirmed by a dedicated red-team pass and a contract test.
- **Fail-closed transport.** In Tor mode the collector refuses (throws) when Tor isn't bootstrapped — never a silent clearnet fallback. Tor routing uses **`socks5h://`** so hostnames resolve *inside* the circuit (no clearnet DNS deanonymization side-channel). Per-burner SOCKS credentials give each identity its own `IsolateSOCKSAuth` circuit.
- **Supply-chain verified (§5.5).** Baileys pinned by integrity hash against the genuine `@whiskeysockets/baileys` (not the December-2025 `lotusbail` malicious clone); no install-time scripts; X dependencies pinned with `--require-hashes`.
- **Secrets** (burner sessions, API ids, X cookies) live only in the encrypted `secretStore`, are never echoed to the renderer, and are scrubbed from error logs. AI ranking stays loopback-only. The X module is import-quarantined from the Tor/Telegram transport (enforced by a sentinel test).

## Honest caveats — read before operating

- **Not live-smoked against the real platforms.** Everything is mock-tested + boot-verified; it has **not** been run against live Telegram/WhatsApp/X — that requires your own burner accounts/credentials and is the field step you perform. Treat first live use as a smoke test.
- **The X twscrape sidecar binary is not bundled.** Build it yourself (`scripts/build-twscrape-runner`) after reviewing the pinned requirements; the X collector reports "sidecar not installed" until you do.
- **Burner provisioning is yours** (Telegram SIM + `my.telegram.org`, WhatsApp burner phone for pairing, X account cookies). WhatsApp monitoring means your burner number is visible in every group it joins — that is inherent to the platform, not a bug.
- **Developer note:** the new `socmint:monitorItem` main→renderer stream carries raw attacker-controlled fields; any future renderer consumer **must** render them as `textContent` only.

## Quality

- **1,972 tests passing**, TypeScript strict, clean `pnpm build`. ESM externalization verified — `@mtcute/node` and `@whiskeysockets/baileys` (both ESM-only) load in the packaged main process with no `ERR_REQUIRE_ESM`.
- Also includes the Searchlight readability tweak (black input text on a light field, midnight-purple results) from v3.21.x.

## Install

Windows NSIS installer attached.
SHA-256: `600350cc0553fd3ddb714331554dfff9af16b3ff8047c949ed3660b8d37582ca`
Size: 887,577,133 bytes (846.5 MB)
