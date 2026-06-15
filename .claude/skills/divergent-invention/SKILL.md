---
name: divergent-invention
description: Out-of-the-box creative ideation and invention engine. Generates novel, ambitious concepts by thinking in structures and systems, forcing cross-domain analogies between distant specialized fields, and integrating multiple disciplines to reach an envisioned dream or goal. Deliberately suspends assumed limits to maximize novelty and quantity of ideas before any judgment is applied. Use this whenever the user wants to brainstorm, invent, innovate, "think outside the box", find a radically different approach, cross-pollinate ideas between fields, imagine what a system could become, or break out of a stuck/conventional framing. Strongly prefer this skill when the user expresses a big vision, a "what if", a "dream" goal, or asks for ideas/possibilities/approaches rather than a single answer — even if they don't say "brainstorm". Pairs with zero-point-engineering, which builds and hardens what this skill invents.
---

# Divergent Invention

An engine for generating novel, ambitious, structurally-rich ideas. Its job is **divergence** — to widen the space of what's possible before anything narrows it. Quantity and novelty are the targets; judgment is deliberately deferred so it can't strangle ideas in the cradle.

This is the mirror twin of zero-point-engineering. That skill *converges* — it pins a goal and hardens a build. This one *diverges* — it expands what the goal could even be. Generate wide here; build with that one.

## The one rule that makes this work: separate generation from judgment

The fastest way to kill invention is to evaluate each idea as it arrives. "That won't work" spoken too early is how every session collapses back to the obvious. So this skill enforces a hard wall: **during generation, no idea is criticized, ranked, or filtered — not by you, not by the user.** Wild, half-formed, "impossible," and contradictory ideas all get written down. Evaluation, if it happens at all, is a separate later phase the user explicitly opts into.

When you catch yourself (or the user) saying "but that would require…", that's the signal you've slipped into judgment mode. Note the objection as a *constraint to design around later*, not a reason to drop the idea, and keep generating.

## Suspending limits — honestly

The user wants ideation that doesn't see limits to builds, suggestions, or goals. The right way to honor that is to suspend **assumed** limits aggressively while staying honest about **physical** ones — because unconstrained ideas that quietly violate physics aren't ambitious, they're noise, and they waste the user's time downstream.

The distinction:
- **Assumed limits** — "we don't have the budget," "nobody does it that way," "our current stack can't," "that's not our domain," "it's never been done." **Suspend all of these without hesitation.** They are exactly what's blocking the dream.
- **Physical/mathematical limits** — thermodynamics, the speed of light, cryptographic hardness assumptions, conservation laws, computational complexity floors. **Don't pretend these away** — instead, treat them as the *interesting part*: "if entropy can't come from the RNG, where else in the system could it come from?" turns a wall into a doorway.

So: generate freely, and when an idea leans on something physically unproven or speculative, **flag it** (a simple `[speculative: rests on X being true]`) rather than suppressing it. The flag lets the wild idea live *and* lets the downstream feasibility gate (in zero-point-engineering) know where to look. You lose nothing and keep the idea honest.

## The core engine: forced cross-domain analogy

The richest inventions come from collision between distant fields — biology informs networking, immune systems inform security, mycelial networks inform routing, origami informs deployable structures, jazz improvisation informs distributed consensus. This skill makes that collision **mandatory, every time**, rather than waiting for it to happen by luck.

For any goal, deliberately pull from domains *far* from the obvious one and ask what each would do with the problem. A working palette to rotate through (don't limit to these):

- **Biological / evolutionary** — immune systems, swarms, mycelium, metabolism, symbiosis, morphogenesis, ecosystems.
- **Physical / natural** — phase transitions, resonance, self-organization, crystallography, fluid dynamics, optics.
- **Mathematical / structural** — topology, category theory, graph structure, information theory, geometry, group theory.
- **Social / economic** — markets, game theory, governance, gift economies, reputation systems, guilds.
- **Artistic / craft** — music theory, narrative structure, architecture, choreography, textile/weaving, improvisation.
- **Mythic / ritual / linguistic** — symbol systems, ritual structure, grammar, oral tradition, alchemy, cosmology.
- **Engineering from other industries** — aerospace, surgery, logistics, brewing, semiconductor fab, theatre rigging.

The move is not decoration ("it's like a beehive!"). It's **structural transfer**: identify the *mechanism* that makes the distant system work, then map that mechanism onto the goal. "Beehive" is a label; "decentralized quorum-sensing where individual agents commit to a decision only after a threshold of correlated signals" is a transferable structure. Always go for the structure.

## Thinking in structures and systems

Generate at the level of *systems and their integration*, not isolated features. For any concept, push on:

- **Composition** — what are the parts, and what new behavior emerges from their interaction that none has alone?
- **Cross-development** — what two things, built together, make each other more than the sum? Where do two of the user's existing systems *integrate* into a capability neither has?
- **Substrate inversion** — what if the thing we treat as the platform is actually the product, or vice versa?
- **Latent capability** — what does this system *almost* already do, that a small structural change would unlock?
- **Scale shifts** — what happens to the idea at 1000× or 1/1000th the size, speed, or count?

Look explicitly across the user's own portfolio of systems and specialized fields for integration opportunities — the dream is often reached by *connecting things that already exist* in a way no one has wired together yet.

---

## The workflow

Track these as todos. The human-involvement level is selectable — pick the mode up front (or let the user choose), and note which you're running.

### Choose the collaboration mode

- **Autonomous** — present a finished slate of developed concepts. Best when the user wants to be surprised or is time-poor. Run all phases, surface the result.
- **Collaborative** *(default)* — check in at two points: after divergence (to react to the raw idea space) and at selection (to pick what to develop). Best balance for most sessions.
- **Co-create** — frequent back-and-forth throughout; the user builds the idea space *with* you, riffing in real time. Best when the user has strong intuitions and wants to steer.

If unsure, ask once, then proceed.

### Phase 1 — Frame the dream (not the problem)

State the goal in its most *ambitious* form, not its safe form. If the user gave a modest framing, reflect back the bigger version: "the dream underneath this looks like X — am I aiming at that?" Capture the dream, the user's existing systems/fields in play, and any *true* physical constraints (kept as design material, not walls). Keep this light — it's a launchpad, not a charter.

### Phase 2 — Diverge hard (generation, no judgment)

Generate a large volume of ideas with the judgment wall fully up. Use the cross-domain engine on every pass: rotate through distant domains and force structural transfer from each. Push for *quantity and spread* — many directions, not one refined direction. Include the wild, the half-formed, the "probably impossible" (flagged `[speculative]` where physics is at stake).

If subagents are available, fan out — assign different domain lenses to different subagents so the idea space is genuinely diverse rather than variations on one mind's first instinct. If not, rotate the lenses yourself, deliberately resetting between them so each starts fresh.

Aim for breadth across *kinds* of ideas: incremental, adjacent, radical, and absurd. The absurd ones often carry the seed of the radical-but-viable ones — keep them.

**In collaborative/co-create mode, pause here** and show the raw idea space before any narrowing.

### Phase 3 — Cross-pollinate & combine

Now collide the ideas *with each other*. The best concepts are often hybrids: take idea 4's mechanism and idea 19's substrate and see what the fusion does. Explicitly look for integrations across the user's existing systems and across the distant domains already surfaced. Generate a second wave of *combinatorial* ideas — this wave is frequently where the real invention is.

Still no judgment. Combination is still generation.

### Phase 4 — Surface structure & latent developments

For the idea space as a whole, name the *structural patterns* that recur, and the **latent developments** — capabilities or product/research directions that fall out of these ideas that weren't part of the original ask. These emergent directions are often the highest-value output: the dream the user didn't know to ask for.

### Phase 5 — Triage (only if the user opts in)

Generation is the product. Evaluation is optional and *separate*. If the user wants to narrow, only now lift the judgment wall — and even here, judge gently and on the right axis. Useful lenses:

- **Novelty** — how far from the obvious?
- **Generativity** — does it open *more* doors, or close the question?
- **Latent reach** — what else does it unlock if it works?
- **Excitement** — which ones does the user actually *want* to be real? (This matters more than it sounds — energy carries projects.)

Sort into: **pursue now**, **park (promising, not yet)**, and **seed vault** (keep for later cross-pollination). Avoid hard-killing ideas; "not yet" preserves optionality.

### Phase 6 — Hand off to building (optional)

For anything the user wants to make real, prep the handoff to **zero-point-engineering**: carry over the chosen concept, its structural description, the cross-domain mechanism it borrows, and crucially the `[speculative]` flags — those become the first entries in that skill's feasibility gate. This is the seam where wild ideation meets honest building, and it's deliberate: invention here, hardening there.

---

## Output discipline

- During generation, capture *everything* — a messy, long, unfiltered idea list is a successful Phase 2, not a failure. Don't pre-polish.
- Keep the idea space as a durable artifact (a file) so nothing's lost and the seed vault persists across sessions.
- Make the cross-domain source visible for each idea — half the value is seeing *which distant field* a structure came from, because it suggests where to mine next.
- Flag `[speculative]` honestly but lightly; the flag protects the idea, it doesn't demote it.
- Resist the gravity toward the obvious. If a generation pass produced only sensible, adjacent ideas, it failed — push further out and run it again.

## When NOT to use this

When the user wants *a* answer, not *many* possibilities — a decision, a fix, a single recommendation, a factual lookup. Forcing divergence onto someone who wants convergence is just as annoying as the reverse. If they want it built and hardened rather than imagined wide, that's zero-point-engineering's job, not this one.
