# Autonomous OSINT Investigator — Architecture &amp; Decomposition Design

**Date:** 2026-07-04
**Status:** Architecture design (whole-vision). This document defines the system architecture and decomposes it into ordered sub-projects; each sub-project (SP-N) gets its own spec → plan → build cycle. It is intentionally *not* an implementation plan.
**Belongs to:** the OSINT plugin suite (subsystem 2, signed/paid), standing on Ghost Intel 98 core primitives.
**Origin:** GhostExodus's "agentic OSINT investigator with a living graph" concept (a seed + objective → autonomous fan-out over OSINT tools/MCP → pivotable entity graph + confidence-scored report), reimagined to run **fully offline, over Tor, signed** rather than as a cloud SaaS.

---

## 1. Overview &amp; vision

An autonomous OSINT investigator that lives inside a Ghost Intel 98 **Case**. The user provides a **seed** (URL, username, email, domain, wallet, phone, IP…) and a plain-language **objective** ("find everything about these two URLs, fan out, write a report"). A free-form, **local-LLM** agent runs the investigation — driving OSINT transforms, growing a live entity graph, and producing a confidence-scored INTELREPORT — fully offline, over Tor, signed.

The competitive thesis (see the Ghost Intel 98 vs Maltego comparison, 2026-07-04): tools like Maltego and the reference SaaS route your selectors through hosted transform servers and need cloud API keys. This system delivers the same autonomous-graph-investigator capability with the investigation's **reasoning and egress kept on the user's machine and inside Tor** — sovereignty as the differentiator, not an afterthought.

## 2. Scope of this document

This is the **whole-vision architecture** plus a **build-order decomposition**. It does not fully specify any one component; it establishes the pipeline, the component boundaries, the agent/rails contract, the data/provenance model, the safety posture, the packaging boundary, and the ordered sub-projects. Each sub-project is specced and planned separately.

## 3. Key decisions (settled during brainstorming)

| Decision | Choice | Rationale / consequence |
|---|---|---|
| Design scope | **Whole-vision architecture first**, then decompose | The concept spans orchestrator + transforms + graph + report + pipeline — too much for one spec. |
| Autonomy model | **Free-form agent (ReAct-style) inside hard, deterministic rails** | Operator's call. Autonomy in *what to investigate*; invariants in *what it is physically allowed to do*. The rails (§6) make free-form safe. |
| Reasoning model driver | **Bundled stronger reasoning model** (local, offline) | Turnkey and sovereign — the investigation's reasoning never leaves the box. Weight lands on the **plugin suite's** distribution (§8), not the core installer. |
| Tool interface | **Native transform contract + optional gated MCP bridge** | Our signed, capability-gated transforms are the core substrate; user-trusted MCP servers can be bridged in, egress forced through the Tor/authorized-target rails, findings marked *unsigned* in provenance. |
| Core/plugin boundary | **Rails, graph, entity store, and the runtime *mechanism* in core; transforms, orchestrator, report, and the reasoning *model* in the plugin** | Even a buggy/compromised plugin cannot exceed core's deterministic rails. The paid value concentrates in subsystem 2. |

## 4. The pipeline

The reference's Intake → Understand → Investigate → Deliver → Portfolio, adapted to Ghost Intel 98 primitives. The pipeline is Case-native: entities live in the existing cross-case entity store; the graph is an evolved Mind's Eye; egress is the existing bundled Tor.

1. **Seed &amp; Objective** *(Intake)* — user supplies seed entities + objective + a **scope/budget** (max pivots / depth / wall-clock / tokens). Creates/uses a Case.
2. **Scope &amp; Plan** *(Understand)* — the agent parses the objective into an investigation frame (entity types that matter, definition of "done," initial hypotheses). A **scope gate** the user reviews/adjusts before anything is spent.
3. **Investigate** — the free-form agent loop (§6): choose pivots → run transforms → merge into the graph → score threat/confidence → reflect → repeat, until budget/scope is hit or the user stops. Findings stream live; the user's chat can **steer, veto, or inject** at any point.
4. **Deliver** — the **INTELREPORT**: a key-actors table (confidence + per-claim evidence provenance) + a narrative brief, exported via the existing `printToPDF` path.
5. **Portfolio** *(cross-case)* — compare entities/clusters against other cases ("what does this case share with others"), reusing the cross-case entity store.

## 5. Component architecture &amp; the core/plugin boundary

**Guiding principle: the rails live in core, the intelligence lives in the plugin.** Safety-critical enforcement is deterministic and core-owned; free-form reasoning, transforms, and the report are the paid plugin. This extends the existing "signature is the trust boundary, capability model is defense-in-depth."

### Core (Ghost Intel 98, MIT) — present unless marked NEW
- **Case + cross-case entity store** (`src/main/storage/entities.ts`) — substrate the graph and report read/write.
- **Investigation graph canvas** — an evolution of **Mind's Eye** (cluster color, role-shape encoding, threat-score filter, co-occurrence edges, hide-junk, live streaming). *NEW work, core module.*
- **Bundled Tor egress** + the `authorized-target-egress` capability — the egress rail. *Present.*
- **Reasoning-runtime *mechanism*** — the model-agnostic plumbing to spawn a bundled Ollama on its own loopback port pointed at a model directory, plus a `reasoning-runtime` capability a plugin can request. Reuses the `local-ai` / `embed-runtime` pattern (and the v3.30.0 lessons: gate on the *correct* bundle marker, honest health that verifies the model is loaded). **No model blob ships in core.** *NEW, small, core.*
- **Rails / Budget guard** — deterministic enforcement of Tor-only egress, authorized-target gating, and a hard scope/cost ceiling, enforced *outside* the LLM. *NEW, core hooks.*
- **Q chat** as the human-on-rails surface, **`printToPDF`** export, **secure-fs** vault, **plugin platform + capabilities** — all present.

### OSINT plugin suite (subsystem 2, signed, paid) — the novel/value layer
- **Transform contract + registry + provenance ledger** — the typed transform interface (input entity → output entities/edges + evidence), the registry, the append-only evidence/finding/run model, and the deterministic confidence scorer.
- **Native transform pack** — passive Tor transforms (WHOIS/RDAP, DNS, TLS cert, web fetch/scrape, username sweep via Searchlight, breach/infostealer, …), each capability-declared.
- **MCP bridge** — wraps a user-trusted MCP server's tools as transforms; egress forced through the Tor/authorized-target rails; findings marked unsigned in provenance.
- **Free-form orchestrator** (the agent loop) — the crown jewel.
- **INTELREPORT generator** — key-actors table + narrative brief from the graph + ledger.
- **The reasoning model** — the multi-GB weight (see §8), supplied by the plugin, served via core's runtime mechanism.

**New capabilities likely required:** `reasoning-runtime` (access the bundled model) and an explicit MCP-trust flow. `authorized-target-egress` already exists.

## 6. The free-form agent loop + the hard rails (the crux)

The synthesis that makes a free-form *local-model* agent trustworthy for casework: **the agent reasons freely about *what to investigate*, but every fact is grounded in a real tool output, and every safety limit is enforced deterministically outside the model.**

### The loop (free-form ReAct)
- **Perceive** — each turn the orchestrator hands the model a **bounded** view (never the whole graph): the objective, a summary of key/frontier entities (retrieved via embeddings so context stays small), recent findings, remaining budget, and the typed list of available transforms.
- **Reason + Act** — the model freely chooses one action: *run transform T on entity E*, ask the human a question, mark a hypothesis confirmed/refuted, or declare done. Actions use a **validated structured protocol**; on a parse miss, repair-retry, then fall back to a single-directive parse (the pattern proven in Q's web search). The model may only pick from **registered** transforms — it cannot invent a tool name.
- **Observe + Merge** — the chosen transform runs *through the rails*, returns typed entities + evidence; the orchestrator dedups, merges into the graph with provenance, rescores, decrements budget.
- **Reflect + Repeat** — periodic free-form reflection (converging? what's unexplored?) until a stop condition.

### The hard rails (deterministic, outside the LLM — the model cannot argue with these)
1. **Egress** — transforms reach the network only through bundled Tor; the agent holds no raw socket, only transform *names*. No clearnet path exists for autonomous transforms.
2. **Authorized-target** — any *active* transform requires the target in a **human-set scope allowlist**; the agent cannot expand scope.
3. **Budget** — hard ceiling on pivots / depth / wall-clock / tokens; the guard hard-stops at zero regardless of the model's intent — the backstop against free-form scope blowout.
4. **Dedup / no-progress** — never re-run the same transform on the same entity; N turns with no new entities → force reflect or stop.
5. **Human veto** — pause/resume/stop, edit scope, focus/ignore, answer questions via Q chat; optional "approve before active/expensive transforms."
6. **Hallucination guard (trust keystone)** — entities and edges enter the graph **only** from a transform's actual output, never from the model asserting them. The model proposes pivots; it cannot fabricate a node.
7. **Provenance** — confidence is *computed from tool-output signals*, not the model's say-so; every node/edge carries its source transform + raw-output reference.

### Stop conditions
Budget exhausted · frontier empty · objective satisfied (agent declares done, guard sanity-checks) · human stop → then **Deliver**.

### Failure handling
Transform error → recorded as a failed lead, agent informed, continues · model parse failure → repair-retry then skip-turn · circling → dedup rail + no-progress detector · unregistered/unauthorized action → rejected by the guard, fed back as an error.

## 7. Data &amp; provenance model

Extends the existing entity store rather than forking it. **Facts and confidence come from evidence; narrative comes from the model.**

- **Entity** *(existing `EntityRecord`, extended)* — id, type, canonical value, **+ cluster id, role, threat/relevance score, first/last-seen, origin run**. Cross-case global + per-case links.
- **Edge** *(existing relationship/link, extended)* — typed relation **carrying provenance + confidence**.
- **Evidence record** *(NEW, append-only)* — run id, transform id+version, input entity, outputs produced, a **reference to the raw tool output** (encrypted at rest), timestamp, and machine-readable **signals** (e.g. "RDAP registrant field present," "2 independent sources," "TLS SAN match," "phone country ≠ claimed location").
- **Finding** *(NEW)* — a report-level claim, backed by ≥1 evidence records, with a **computed** confidence band + attribution status (attributed / unattributed / unconfirmed).
- **Run** *(NEW)* — one autonomous investigation: seeds, objective, scope/budget, the **append-only action audit log**, stop reason, graph snapshot + report link.

**Confidence is machine-derived.** A deterministic scorer maps evidence signals → confidence band + attribution (source authority, corroboration count, field completeness, cross-reference matches, contradiction flags). The model may *narrate* a hunch; the report's confidence value comes from the ledger, and a model/ledger disagreement is itself flagged.

**Flow:** transform → typed entities/edges + evidence record → orchestrator dedups/merges into the graph with provenance, recomputes affected confidences → graph streams live → at Deliver, the report generator injects *facts + confidence + evidence citations from the ledger* and asks the model only for connecting *prose*. Every report claim links back to its evidence (chain-of-custody).

**Audit / determinism:** the action log makes a run fully reconstructable and any transform re-runnable; scoring/merge are deterministic given the same evidence, even though Tor network outputs are not — honoring the charter's determinism-in-critical-paths where we control it.

## 8. Packaging &amp; distribution boundary

The heavy reasoning model belongs to the **OSINT plugin suite's distribution, not the Ghost Intel 98 core installer.**

- **Core (Ghost Intel 98 installer)** gains only the small, model-agnostic **reasoning-runtime mechanism** — port/health/lifecycle management for a loopback Ollama pointed at a model directory. **No model blob.** The free core app does not balloon; users without the OSINT plugin carry no reasoning model.
- **The OSINT plugin suite** supplies the **reasoning model** itself. The multi-GB weight lands on the plugin's distribution, correctly attributing cost to the paid subsystem.

**Open sub-decision (resolved first in SP-1):** since plugins are signed packages placed in `userData/plugins/`, embedding a multi-GB model *inside* a signed plugin package is likely unwieldy. The choice is **plugin-package-embedded model vs. a side-loaded, integrity-checked "reasoning model pack"** the plugin manifest references (the plugin stays a lean signed package; the model is a separate verified drop-in the user places once). Current lean: the side-loaded pack, with **hardware tiers** (a lighter model for modest machines, a heavier one for capable hardware) — GhostExodus currently runs a 4B, so tiering and honest hardware guidance matter.

## 9. Charter &amp; safety

- **Tor-only egress, hard.** Autonomous transforms have **no clearnet path at all** (unlike Q's opt-in clearnet web-search fallback — autonomous fan-out over clearnet is too large a deanon surface to gate by a toggle). Per-case/per-run circuit isolation via the existing `IsolateSOCKSAuth` credential derivation.
- **Passive by default; active needs approval.** Passive transforms never touch the target directly. Active transforms require the target in the human-set scope allowlist + pace-limiting.
- **Reasoning stays on the box.** The bundled local reasoning model means the objective, selectors, and hypotheses never leave the machine — the sovereignty differentiator. The remote-model option was rejected for this reason.
- **Prompt injection is contained by design.** Transform outputs are attacker-controllable, so they are wrapped as **untrusted DATA behind the per-request fence** already built for web search — never instructions. Because the rails live *outside* the model, a hijacked agent still cannot reach clearnet, exceed budget, or expand the authorized-target allowlist; the hallucination guard means injected "facts" never become nodes. Injection can waste budget; it cannot cause harm beyond the rails.
- **Signed vs unsigned provenance.** Native transforms are PQ-signed in the plugin. MCP-bridged tools are user-added and unsigned by us — their findings are **marked unsigned in the provenance ledger** so an analyst (or a court) always knows which evidence came from an untrusted source.
- **Encrypted at rest, no telemetry.** All run data — graph, evidence, raw outputs, audit log, report — in the secure-fs vault (AES-256-GCM); none of the agent's activity is reported anywhere.

## 10. Build-order decomposition (the deliverable)

Nine sub-projects, each its own spec → plan → build, ordered so contracts and runtime come first, the risky autonomous core lands after its dependencies are proven, and **usable value appears before the free-form agent exists.**

**Phase 0 — Foundations (contracts + runtime)**
- **SP-1 · Bundled reasoning runtime** — core's loopback-Ollama runtime mechanism (v3.30.0 lessons applied), plus the reasoning-model packaging decision (§8: embed vs side-load pack) and hardware tiers. *Standalone, testable.*
- **SP-2 · Transform contract + registry + provenance ledger** — the keystone: typed transform interface, registry, append-only evidence/finding/run model extending `entities.ts`, and the deterministic confidence scorer. Transforms callable directly, no agent yet. *Every later phase depends on this contract.*

**Phase 1 — Make it do real work (parallelizable; depend only on SP-2's data model)**
- **SP-3 · Native transform starter pack** — real passive Tor transforms (WHOIS/RDAP, DNS, TLS cert, web fetch/scrape, username sweep via Searchlight), each capability-declared and emitting evidence.
- **SP-4 · Investigation graph canvas** — Mind's Eye evolved (cluster color, role-shape, threat-score filter, co-occurrence edges, hide-junk, live streaming).

> **After Phase 1: a usable *manual* Maltego-like investigation graph** — run transforms by hand, watch them populate the graph — shipping value even if the free-form agent proves hard.

**Phase 2 — The autonomous core**
- **SP-5 · Rails / Budget guard** — standalone deterministic enforcement (egress, authorized-target allowlist, hard budget, dedup/no-progress, hallucination guard). *Testable in isolation.*
- **SP-6 · Free-form orchestrator** — the ReAct loop (bounded perceive → validated action protocol w/ directive fallback → act-through-rails → merge → reflect → stop), streaming + human-on-rails via Q chat. De-risked because SP-1/2/3/5 are proven. **Includes an injection/hijack test proving the rails hold.**

**Phase 3 — Deliverable, extensibility, scale**
- **SP-7 · INTELREPORT generator** — key-actors table (ledger-sourced confidence/evidence) + model-written narrative, export via `printToPDF`.
- **SP-8 · MCP bridge** — wrap user-trusted MCP tools as transforms; egress forced through Tor rails; unsigned-provenance marking.
- **SP-9 · Cross-case / Portfolio** — compare entities/clusters across cases; reuses the cross-case entity store.

The pipeline UI stages land across these (Investigate in SP-4, Intake/scope-gate in SP-6, Deliver in SP-7, Portfolio in SP-9).

## 11. Open decisions (to resolve in the named sub-project)
- **Reasoning model packaging + tier** (SP-1): embed-in-plugin vs side-loaded pack; which models per hardware tier; exact model(s). Lean: side-loaded pack, tiered.
- **MCP-trust flow** (SP-8): how a user marks an MCP server trusted, and how its unsigned provenance surfaces in the report.
- **Scope-gate UX** (SP-6): how much the user pre-approves vs approves in-flight.

## 12. Risks &amp; honest caveats
- **Free-form autonomy on a *local* model is the central reliability risk.** Even a bundled stronger model will underperform frontier cloud models; expect frequent rail-hits and human corrections. Mitigations: bounded perceive, validated action protocol with directive fallback, no-progress detection, and Phase-1 usable-without-the-agent value.
- **Tor latency vs. fan-out.** Each pivot is a Tor circuit; large runs are slow. Mitigations: bounded concurrency, per-source caching, the hard budget, and passive-by-default.
- **Confidence honesty.** Machine-derived confidence is only as good as the signal rules; over-claiming certainty is worse than none for casework. The ledger-wins rule + contradiction flags are the guardrail.
- **Model weight vs. reach.** The bundled model gates who can run autonomous mode on modest hardware (GhostExodus runs a 4B). Hardware tiering + a usable manual mode without the agent keep the tool valuable regardless.

## 13. Success criteria
- From a seed + objective, an autonomous run produces a populated entity graph and a confidence-scored INTELREPORT with per-claim evidence provenance — **fully offline, all egress over Tor.**
- The rails hold under an adversarial/prompt-injection test: a malicious transform output cannot cause clearnet egress, scope expansion, budget overrun, or a fabricated graph node.
- Every report claim is reconstructable from the append-only audit log; a transform can be re-run to verify.
- Phase 1 alone delivers a usable manual investigation graph.

## 14. Charter alignment summary
Offline-first (reasoning + storage local), Tor-only egress for all autonomous transforms, no telemetry / no phone-home, PQ-signed plugin with capability-gated transforms, encrypted-at-rest, deterministic where correctness depends on it (scoring/merge/audit), unsigned MCP findings clearly attributed. The free-form autonomy the operator chose is bounded by rails that are invariants, not prompts.
