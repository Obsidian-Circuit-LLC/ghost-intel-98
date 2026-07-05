// SP-7 INTELREPORT — the Narrator seam.
//
// Prose narrative is injected and boxed, positioned DOWNSTREAM of the facts: by the time `narrate()`
// runs, every claim/confidence/evidence ref is already fixed in the `IntelReport` model (assembled
// deterministically by `report.ts`). A narrator writes *around* facts it cannot alter.
//
// CHARTER — the report's facts are machine-derived from the ledger, never asserted by a model. The
// core `TemplateNarrator` is a deterministic restatement of the model's own numbers — it invents no
// entities and no numbers. A subsystem-2 `model` narrator is optional and rides the plugin; when it
// throws or is absent, `applyNarrative` falls back to `TemplateNarrator` so the report always renders
// offline with zero dependencies (spec §6 guardrail 4).
import type {
  IntelReport,
  NarrativeSections,
  Narrator
} from '@shared/investigation-report';

/** How many salience-ranked actors the template summary restates. */
const TOP_ACTOR_COUNT = 3;

/** Build the deterministic template summary: a pure restatement of the model's own counts, top
 *  salience-ranked actors, and highest-confidence finding. No invented entities or numbers — every
 *  value is read verbatim from the report the deterministic assembler produced. */
function buildSummary(report: IntelReport): string {
  const parts: string[] = [
    `Investigation of case ${report.caseId}: ${report.entityCount} entities, ${report.findingCount} findings.`
  ];

  // keyActors are already salience-desc from the assembler; restate the top few verbatim.
  const top = report.keyActors.slice(0, TOP_ACTOR_COUNT);
  if (top.length > 0) {
    const list = top
      .map((a) => `${a.value} (${a.role}, ${a.confidence}/${a.attribution})`)
      .join(', ');
    parts.push(`Top actors: ${list}.`);
  } else {
    parts.push('No key actors identified.');
  }

  // findings are already score-desc from the assembler; findings[0] is the highest-confidence one.
  const topFinding = report.findings[0];
  if (topFinding) {
    parts.push(`Highest-confidence finding: ${topFinding.claim} (${topFinding.confidence.band}).`);
  } else {
    parts.push('No findings recorded.');
  }

  return parts.join(' ');
}

/** Deterministic core fallback narrator. Restates the model's facts only; the same report yields a
 *  byte-identical `NarrativeSections`. `source` is always stamped `'template'`. */
export class TemplateNarrator implements Narrator {
  async narrate(report: IntelReport): Promise<NarrativeSections> {
    return { summary: buildSummary(report), source: 'template' };
  }
}

/** Attach a narrative to the report, boxed downstream of the facts. Uses the injected `narrator`
 *  when it succeeds; falls back to the deterministic `TemplateNarrator` when `narrator` is
 *  null/undefined OR throws/rejects (spec §6 guardrail 4 — narrative failure never fails the
 *  report). Returns a NEW report object; the input's fact fields are carried through unchanged. */
export async function applyNarrative(
  report: IntelReport,
  narrator?: Narrator | null
): Promise<IntelReport> {
  let narrative: NarrativeSections;
  if (narrator) {
    try {
      narrative = await narrator.narrate(report);
    } catch {
      narrative = await new TemplateNarrator().narrate(report);
    }
  } else {
    narrative = await new TemplateNarrator().narrate(report);
  }
  return { ...report, narrative };
}
