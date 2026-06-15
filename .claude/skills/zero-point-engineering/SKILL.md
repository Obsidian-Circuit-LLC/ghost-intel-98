---
name: zero-point-engineering
description: Expert-level reverse-engineering and build-to-goal workflow. Takes a stated end-goal, designs full specifications for it via parallel expert subagents, then reverse-engineers the goal back to zero-point (first principles) to discover optimal paths, efficiency gains, better components/OS-level choices, and latent features. Builds the complete working map, enters plan mode, executes to project success, then red-teams (and optionally black-teams) the result with smoke tests, fuzzing, and debugging until it is production-ready. Use this whenever the user wants to architect-and-build a non-trivial system, says things like "reverse engineer", "build to goal", "zero-point", "design the spec then build it", "red team / black team it", "find a better way to achieve X", or wants a goal decomposed into a buildable, hardened deliverable. Strongly prefer this skill for ambitious multi-component projects even if the user doesn't name it explicitly.
---

# Zero-Point Engineering

A disciplined workflow for turning a stated goal into a hardened, working build by (1) specifying what success means, (2) reverse-engineering it to first principles to find better paths, (3) mapping the full system, (4) planning, (5) building, and (6) adversarially testing until ready.

The defining move of this skill is the **inversion**: rather than building forward from the current state and hoping it reaches the goal, you first define the goal completely, then reason *backward* from it to zero-point. This surfaces options that forward iteration never finds.

## Operating principles

- **Goal-first, then invert.** Never start building until the goal's success criteria are written down and the backward decomposition has been done. Forward-only work is how projects accrete accidental complexity.
- **Parallelize the divergent phases, serialize the convergent ones.** Spec design, path discovery, and red-teaming are breadth problems → fan out subagents. Synthesis, planning, and the build are coherence problems → one mind holds the thread.
- **Falsify, don't confirm.** Every spec and every "better path" is a hypothesis. Try to break it before trusting it. The red/black team phase is not a formality at the end — its mindset runs throughout.
- **Map before plan, plan before build.** The working map is the artifact that makes the plan honest.
- **Right-size the ceremony.** Six phases with multi-subagent fan-out is correct for a hardened system and absurd for a CLI utility. Match the weight of the process to the weight of the goal (see "Right-sizing" below). The inversion and the adversarial close are the parts that must never be dropped; everything else scales.

## Subagent availability

This skill leans on parallel subagents. **If subagents are available** (Claude Code with the Task tool, or Cowork), fan out as described. **If they are not** (Claude.ai), run each "subagent" pass yourself in sequence, holding each role distinctly — adopt the lens fully, write the output, then switch. The phases are identical; only the parallelism changes. Note which mode you're in at the start so the user knows what to expect.

## Right-sizing the process

Before Phase 1, take one beat to size the effort to the goal. This is a quick judgment, not a phase:

- **Light** (well-bounded, single-component, low blast radius): 2-3 spec lenses, a compressed inversion, red team = smoke + boundary tests, no black team. Phases still run, just thin.
- **Standard** (multi-component, real robustness/efficiency stakes): the full six phases as written, ~4-6 spec lenses.
- **Heavy** (high-stakes, adversarial environment, costly to get subtly wrong): full fan-out, deep inversion, and prompt the user about black-teaming (see Phase 6).

State the chosen size in one line at the start so the user can overrule it. When unsure, default to Standard.

## Assumption ledger

From Phase 1 onward, maintain a running **assumption ledger** — every assumption any phase makes (especially the charter's UNDECIDED items and the Phase-3 feasibility bets). Each entry: what's assumed, which phase made it, and whether it's since been confirmed, killed, or still open. The Phase 6 readiness report reconciles this ledger against the *original* charter so drift is visible — nothing should silently stay "undecided" through to a shipped build.

---

## The six phases

Track these as todos so none are skipped. Do not collapse phases — the value is in their separation.

### Phase 1 — Goal capture & success definition

Before anything else, pin down what "done" means. Interview the user only as much as needed; infer aggressively from context, then confirm assumptions inline.

Produce a short **Goal Charter**:
- **Goal statement** — one or two sentences, unambiguous.
- **Success criteria** — observable, testable conditions. "Works" is not a criterion; "handles 10k concurrent connections at <50ms p99" is.
- **Constraints** — hard limits: platform, language, budget, security posture, dependencies that must/must-not be used, deadlines.
- **Non-goals** — explicitly out of scope, to prevent sprawl.
- **Threat/quality bar** — how adversarial does the final test need to be? (Internal tool vs. intelligence-grade differ enormously.)

If the goal is vague, that's fine — name the ambiguity in the charter rather than papering over it. A charter that says "RNG source: UNDECIDED — see Phase 2" is honest and useful.

### Phase 2 — Parallel spec design (divergent)

Fan out **expert spec subagents**, each designing the full specification of a system that would achieve the goal *functionally and successfully*. The point of multiplicity is divergence: different expert lenses produce different viable architectures, and the best final design is usually a synthesis.

Spawn one subagent per relevant expert domain. Choose domains from the goal — typical sets:
- **Architecture/systems** — overall structure, component boundaries, data flow.
- **Domain expert** — the specific field (crypto, trading, OS internals, RF, ML, etc.).
- **Platform/OS** — target OS, kernel/userspace split, hardware constraints, build toolchain.
- **Interfaces/protocols** — APIs, wire formats, IPC, ABI.
- **Security/adversary** — attack surface and trust boundaries, considered *at design time*.
- **Performance/efficiency** — hot paths, memory, concurrency model.

Give each subagent the Goal Charter and this instruction:

```
You are the <domain> expert. Design a complete, buildable specification for a
system that achieves this goal, optimized through YOUR domain's lens. Assume the
other domains are being covered by peers — go deep, not broad. Output:
1. Your proposed design/spec for the components in your domain.
2. The 3-5 decisions you're most confident about and why.
3. The 3-5 decisions that are risky, tradeoff-laden, or that you'd want to
   challenge another domain on.
4. Anything in the goal that your domain says is harder/easier than it looks.
Goal Charter: <charter>
```

Collect all specs. Do **not** merge yet — keep them distinct for Phase 3.

### Phase 3 — Reverse-engineer to zero-point (the inversion)

This is the core phase. For each candidate spec, work *backward*:

1. **Decompose to zero-point.** Strip the design down to its irreducible first principles — the actual physical/mathematical/logical requirements the goal imposes, independent of any particular implementation. Ask: *what does this goal fundamentally require, before any tooling choices?* Everything above zero-point is a choice, and every choice is a place to find a better path.

2. **Walk the dependency graph backward** from "goal achieved" to "nothing exists yet." At each node ask:
   - Is this component necessary, or an artifact of how we approached it forward?
   - Is there a lower-level, more efficient, or more robust substrate? (Better OS primitive, better algorithm, hardware offload, a standard that already solves this.)
   - Does inverting the dependency unlock a feature we didn't ask for but should want?

3. **Path & efficiency discovery (parallel).** Fan out subagents to hunt specifically for:
   - **Shorter paths** — ways to reach the goal with fewer components/steps.
   - **Efficiency enhancements** — algorithmic, memory, concurrency, I/O, power.
   - **Better OS / platform components** — superior primitives, libraries, kernel features, hardware capabilities than the forward design assumed.
   - **Latent features** — capabilities that fall out "for free" from a better substrate, which could become product features or new developments.
   Each returns a ranked list with the evidence/reasoning for each find, and a confidence level. Treat surprising finds skeptically — verify before adopting.

4. **Feasibility gate (mandatory before anything enters the canonical spec).** Backward reasoning from a goal is exactly the setup that produces confident, elegant, *wrong* designs — clever is not the same as real. So every path or feature you intend to adopt must pass through this gate first. For each candidate, write:
   - the **falsifiable assumption** it rests on (the physics/math/platform claim that must be true for it to work),
   - **what evidence would kill it**, and
   - the **result of actually checking** — a quick proof, a citation, a spike/prototype, or an honest "unverified, proceeding on assumption."
   Anything that can't clear the gate either gets demoted to the deferred list or recorded as an open item in the assumption ledger — it does **not** silently enter the build. This gate is the guardrail that keeps the inversion honest; do not skip it to save time.

5. **Conflict resolution.** The Phase-2 experts will have produced *mutually incompatible* designs (e.g. security wants an air gap, performance wants shared memory). Synthesis is not "merge the persuasive bits" — that just hands the design to whoever wrote best. Instead, surface every cross-domain conflict explicitly as a list, decide each one *against the charter's priorities and constraints* (not against rhetorical force), and record the losing option as a **deferred alternative** rather than deleting it — it may matter if an assumption later flips. State the deciding rationale for each.

6. **Synthesize the canonical design — or pivot.** Take the gated, conflict-resolved choices into one coherent architecture. Output a single **Canonical Spec** plus a **discovery log** (paths/features found, adopted vs. deferred, with each adoption's feasibility-gate result).
   **The kill/pivot option is legitimate and expected.** If the zero-point analysis shows the goal is infeasible as stated, or that the *real* goal is different from the stated one, this phase may return "this is the wrong goal, here's why" and loop back to Phase 1 instead of forcing a build. Surfacing that early is one of the most valuable outcomes this skill can produce — do not push forward into a doomed build to avoid the awkward conversation.

### Phase 4 — The working map

Build the complete **working map** of the system as it will actually be built: every component, its responsibility, its dependencies (in and out), its interfaces, its build/test status. This is the source of truth the plan is checked against.

Represent it explicitly — a dependency diagram (Mermaid or similar) plus a component table. The map must make the *whole* system visible at once; if it can't fit on one view, the architecture is probably under-factored and that's worth flagging.

### Phase 5 — Plan mode & build

Enter **plan mode**: produce an ordered, dependency-respecting build plan derived from the map — what gets built first, what unblocks what, where the integration seams are, and what the verification checkpoint is after each milestone. Present the plan to the user for approval before building anything substantial. (In Claude Code, use actual plan mode if available.)

Then **build to goal**: execute the plan milestone by milestone. After each milestone, check the build against (a) the working map and (b) the success criteria in the charter. Keep the map updated as reality diverges from plan — it will, and the map must stay true.

### Phase 6 — Red team, black team, harden (divergent → convergent)

The goal isn't "it runs," it's "it's ready for use." Adversarially test until it is.

**Red team (against the spec — known internals).** Fan out subagents that attack the build with full knowledge of its design:
- **Smoke tests** — does the basic happy path actually work, end to end?
- **Boundary & edge cases** — limits, empty/malformed input, concurrency, resource exhaustion.
- **Fuzzing** — throw structured-random input at every interface.
- **Failure injection** — kill dependencies, corrupt state, induce partial failures.
- **Security review** — the attack surface mapped in Phase 2, now against real code.
Each returns concrete findings with reproduction steps and severity.

**Black team (against the goal — zero internal knowledge) — opt-in.** Black-teaming means spawning subagents that know *only the goal and the public interface*, not the internals, and try to defeat it as a real-world adversary would. It catches assumptions the design baked in invisibly, but it's expensive and unnecessary for low-bar internal tools. **Do not run it automatically.** Instead, prompt the user: surface that the build is at a state where black-teaming is possible, summarize what it would cost and what it would catch, and let them decide. Run it only on explicit confirmation. (If the charter's threat/quality bar is clearly high, recommend it in that prompt; if clearly low, note that it's probably unnecessary.)

**Debug & converge.** Triage findings by severity and fix them. After each fix, re-run the test that caught it **and the full prior passing suite** — a fix isn't done until the offending test passes *and nothing previously green has regressed*. Watch specifically for the classic failure where fixing finding A silently reopens finding B; the regression gate is the full suite, not just the latest test. Loop Phase 6 until: smoke tests pass, the full suite is green, no open high-severity findings remain, and every charter success criterion is demonstrably met.

Produce a final **readiness report**: criteria met, tests passed, findings fixed, the reconciled assumption ledger (every assumption now confirmed/killed/accepted-as-residual-risk), known residual risks, and anything deferred to a future version.

---

## Output discipline

- Keep the Goal Charter, Canonical Spec, working map, and readiness report as durable artifacts (files), not buried in chat. They're what the user keeps.
- Show the discovery log prominently — the better-paths-and-latent-features finds are often the highest-value output of the whole process.
- Don't skip phases to save time. If the user wants a fast pass, compress *within* phases (fewer subagents, terser specs) rather than dropping the inversion or the hardening — those are the parts that distinguish this from just building forward.

## When NOT to use this

For a small, well-understood task with an obvious implementation, this is overkill — just build it. The skill earns its weight when the goal is ambitious, the best path is non-obvious, efficiency or robustness matters, or the cost of shipping something subtly wrong is high.
