/**
 * SP-7 INTELREPORT — pure HTML builder.
 *
 * `buildIntelReportHtml(report)` renders an `IntelReport` (assembled deterministically by
 * `report.ts`) into a self-contained, offline, Win98-styled document: header → quarantined
 * source-stamped analyst-narrative block → Key Actors table → Findings → Methodology / provenance
 * appendix. No Electron, no fs, no network: like `services/report-html.ts` it is deterministic given
 * its input and unit-tests directly under node vitest.
 *
 * CHARTER — TRUST BOUNDARY: every untrusted value (entity values, finding claims, derived roles,
 * methodology objectives, and ESPECIALLY the model-narrative prose — a compromised model narrator
 * could emit markup) is HTML-escaped through the shared `esc` helper reused from
 * `services/report-html.ts` (never a second hand-rolled escaper). `rawRef` renders as opaque text,
 * never a clickable `file://` link (traversal / deanon). No external resource URLs → CSP-safe,
 * fully offline, no egress. No `Date.now()`/`Math.random()` here — time already entered the model as
 * the injected `generatedAt`.
 */
import { esc } from '../services/report-html';
import type {
  IntelReport,
  KeyActor,
  ReportFinding,
  MethodologyEntry,
  ProvenanceRef,
  NarrativeSections
} from '@shared/investigation-report';

/** One provenance ref as opaque chain-of-custody text: `transformId@version · createdAt · rawRef`. */
function provText(p: ProvenanceRef): string {
  const rel = p.relation ? ` · ${esc(p.relation)}` : '';
  return `<div class="prov">${esc(p.transformId)}@${esc(p.transformVersion)} · <span class="ts">${esc(p.createdAt)}</span>${rel} · <span class="raw">${esc(p.rawRef)}</span></div>`;
}

function evidenceCell(refs: ProvenanceRef[]): string {
  if (!refs.length) return '<span class="muted">— none —</span>';
  return refs.map(provText).join('');
}

function actorRow(a: KeyActor): string {
  const backing = a.findingBacked ? '' : ' <span class="muted">(graph-present, not finding-backed)</span>';
  return `<tr>
    <td><b>${esc(a.value)}</b> <span class="muted">[${esc(a.type)}]</span></td>
    <td>${esc(a.role)}</td>
    <td>${esc(a.confidence)}</td>
    <td>${esc(a.attribution)}${backing}</td>
    <td>${evidenceCell(a.evidence)}</td>
  </tr>`;
}

function findingRow(f: ReportFinding): string {
  const c = f.confidence;
  return `<div class="finding">
    <div class="claim">${esc(f.claim)}</div>
    <div class="muted">${esc(c.band)} · score ${esc(String(c.score))} · ${esc(c.attribution)} · <span class="ts">${esc(f.createdAt)}</span></div>
    <div class="ev">${evidenceCell(f.evidence)}</div>
  </div>`;
}

function methodBlock(m: MethodologyEntry): string {
  const stop = m.stopReason ? ` · stop: ${esc(m.stopReason)}` : '';
  const transforms = m.transformsUsed.length
    ? m.transformsUsed.map((t) => esc(t)).join(', ')
    : '<span class="muted">— none —</span>';
  return `<div class="run">
    <h3>Run ${esc(m.runId)}</h3>
    <p><b>Objective:</b> ${esc(m.objective) || '<span class="muted">—</span>'}</p>
    <table class="meta">
      <tr><th>Status</th><td>${esc(m.status)}${stop}</td></tr>
      <tr><th>Actions</th><td>${esc(String(m.actionCount))}</td></tr>
      <tr><th>Budget</th><td>pivots ${esc(String(m.budget.maxPivots))} · depth ${esc(String(m.budget.maxDepth))} · ${esc(String(m.budget.maxWallClockMs))} ms · ${esc(String(m.budget.maxTokens))} tokens</td></tr>
      <tr><th>Transforms</th><td>${transforms}</td></tr>
      <tr><th>Created</th><td><span class="ts">${esc(m.createdAt)}</span></td></tr>
    </table>
  </div>`;
}

/**
 * Analyst-narrative block — structurally quarantined and source-stamped. A `model` source is marked
 * non-reproducible (only this section; the tables stay bit-reproducible). Prose is escaped: a
 * compromised model narrator cannot inject markup.
 */
function narrativeBlock(n: NarrativeSections): string {
  const model = n.source === 'model';
  const stamp = model
    ? `<p class="stamp warn">Source: model${n.model ? ` (${esc(n.model)})` : ''} — non-reproducible interpretation. The tables below remain machine-derived and reproducible.</p>`
    : `<p class="stamp">Source: template — deterministic restatement of the model's own numbers.</p>`;
  const perActor = n.perActor
    ? Object.entries(n.perActor)
        .map(([id, prose]) => `<p><b>${esc(id)}:</b> ${esc(prose)}</p>`)
        .join('')
    : '';
  return `<section class="analyst">
    <h2>Analyst narrative — interpretation, not evidence</h2>
    ${stamp}
    ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
    ${perActor}
  </section>`;
}

export function buildIntelReportHtml(report: IntelReport): string {
  const scopeBadge = report.scope === 'run'
    ? `run-scoped${report.runId ? ` (${esc(report.runId)})` : ''}`
    : 'case-wide';

  const narrative = report.narrative ? narrativeBlock(report.narrative) : '';

  const actorRows = report.keyActors.length
    ? report.keyActors.map(actorRow).join('')
    : '<tr><td colspan="5" class="muted">— no actors —</td></tr>';

  const tail = report.actorTail.shown < report.actorTail.total
    ? `<p class="foot muted">Showing ${esc(String(report.actorTail.shown))} of ${esc(String(report.actorTail.total))} actors, ranked by salience — ${esc(String(report.actorTail.total - report.actorTail.shown))} lower-salience actors not shown.</p>`
    : '';

  const findings = report.findings.length
    ? report.findings.map(findingRow).join('')
    : '<p class="muted">— no findings —</p>';

  const methodology = report.methodology.length
    ? report.methodology.map(methodBlock).join('')
    : '<p class="muted">— no runs —</p>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>INTELREPORT · ${esc(report.caseId)}</title>
<style>
  body { font-family: "Segoe UI", Tahoma, sans-serif; font-size: 13px; color: #000; margin: 24px; background: #fff; }
  h1 { font-size: 20px; border-bottom: 2px solid #000080; padding-bottom: 4px; }
  h2 { font-size: 15px; background: #000080; color: #fff; padding: 3px 6px; margin-top: 20px; }
  h3 { font-size: 13px; margin: 12px 0 4px; }
  table.meta { border-collapse: collapse; margin: 8px 0; }
  table.meta th { text-align: left; padding: 2px 10px 2px 0; vertical-align: top; width: 90px; color: #444; }
  table.actors { border-collapse: collapse; width: 100%; margin: 8px 0; }
  table.actors th, table.actors td { border: 1px solid #808080; padding: 3px 6px; text-align: left; vertical-align: top; }
  table.actors th { background: #c0c0c0; }
  .muted { color: #888; }
  .ts { color: #666; font-size: 11px; }
  .prov { font-family: "Courier New", monospace; font-size: 11px; }
  .raw { color: #555; }
  .finding { border-left: 3px solid #000080; padding: 2px 8px; margin: 8px 0; }
  .claim { font-weight: bold; }
  .ev { margin-top: 2px; }
  section.analyst { border: 1px dashed #808080; background: #f4f4f4; padding: 4px 12px; margin: 14px 0; }
  section.analyst h2 { background: #808080; }
  .stamp { font-size: 11px; color: #444; margin: 4px 0; }
  .stamp.warn { color: #800000; font-weight: bold; }
  .run { margin: 10px 0; }
  .foot { font-size: 11px; margin: 4px 0; }
</style></head><body>
  <h1>INTELREPORT</h1>
  <table class="meta">
    <tr><th>Case</th><td>${esc(report.caseId)}</td></tr>
    <tr><th>Scope</th><td>${scopeBadge}</td></tr>
    <tr><th>Generated</th><td><span class="ts">${esc(report.generatedAt)}</span></td></tr>
    <tr><th>Entities</th><td>${esc(String(report.entityCount))}</td></tr>
    <tr><th>Findings</th><td>${esc(String(report.findingCount))}</td></tr>
  </table>
  ${narrative}
  <h2>Key Actors</h2>
  <table class="actors">
    <thead><tr><th>Actor</th><th>Role</th><th>Confidence</th><th>Attribution</th><th>Evidence</th></tr></thead>
    <tbody>${actorRows}</tbody>
  </table>
  ${tail}
  <h2>Findings</h2>
  ${findings}
  <h2>Methodology &amp; provenance</h2>
  ${methodology}
  <hr><p class="muted">Ghost Intel 98 · INTELREPORT · facts machine-derived from the ledger · ${esc(report.caseId)}</p>
</body></html>`;
}
