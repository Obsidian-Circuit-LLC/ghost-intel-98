/**
 * ReportView — pure React render of an assembled SP-7 `IntelReport` (spec §5).
 *
 * CHARTER: the report is rendered as Win98 React components, NEVER an embedded HTML doc / iframe —
 * the renderer CSP/`frame-src` is a security boundary (`[[dcs98-csp-framesrc-plugin-invariant]]`).
 * React escapes every interpolated value by construction, so the model-narrative prose and any
 * untrusted entity/finding text cannot inject markup. Evidence `rawRef` is a chain-of-custody
 * pointer and renders as opaque TEXT, never a clickable `<a>` (traversal / deanon). Confidence and
 * attribution surface as plain word-badges — the raw salience/degree/score floats never reach the
 * screen. A `findingBacked:false` actor is labelled honestly; a capped actor tail gets a truncation
 * footer (no silent cap). A `model`-source narrative carries the non-reproducible marker; the tables
 * stay machine-derived and reproducible. Pure and deterministic given its input.
 */

import type {
  IntelReport,
  KeyActor,
  ReportFinding,
  MethodologyEntry,
  ProvenanceRef,
  NarrativeSections,
} from '@shared/investigation-report';

function Badge({ kind, children }: { kind: string; children: string }): JSX.Element {
  return <span className={`report-view__badge report-view__badge--${kind}`}>{children}</span>;
}

/** One provenance ref as opaque chain-of-custody text: `transformId@version · createdAt · rawRef`. */
function ProvRef({ p }: { p: ProvenanceRef }): JSX.Element {
  return (
    <div className="report-view__prov">
      <span className="report-view__prov-transform">
        {p.transformId}@{p.transformVersion}
      </span>{' '}
      · <span className="report-view__prov-ts">{p.createdAt}</span>
      {p.relation ? <> · {p.relation}</> : null} ·{' '}
      <span className="report-view__prov-raw">{p.rawRef}</span>
    </div>
  );
}

function Evidence({ refs }: { refs: ProvenanceRef[] }): JSX.Element {
  if (refs.length === 0) return <span className="report-view__muted">— none —</span>;
  return (
    <>
      {refs.map((p) => (
        <ProvRef key={p.evidenceId} p={p} />
      ))}
    </>
  );
}

function ActorRow({ a }: { a: KeyActor }): JSX.Element {
  return (
    <tr data-entity-id={a.entityId}>
      <td>
        <b>{a.value}</b> <span className="report-view__muted">[{a.type}]</span>
      </td>
      <td>{a.role}</td>
      <td>
        <Badge kind={`conf-${a.confidence}`}>{a.confidence}</Badge>
      </td>
      <td>
        <Badge kind={`attr-${a.attribution}`}>{a.attribution}</Badge>
        {a.findingBacked ? null : (
          <span className="report-view__muted"> (graph-present, not finding-backed)</span>
        )}
      </td>
      <td>
        <Evidence refs={a.evidence} />
      </td>
    </tr>
  );
}

function Finding({ f }: { f: ReportFinding }): JSX.Element {
  const c = f.confidence;
  return (
    <div className="report-view__finding">
      <div className="report-view__finding-claim">{f.claim}</div>
      <div className="report-view__muted">
        <Badge kind={`conf-${c.band}`}>{c.band}</Badge> · <Badge kind={`attr-${c.attribution}`}>{c.attribution}</Badge>{' '}
        · <span className="report-view__prov-ts">{f.createdAt}</span>
      </div>
      <div className="report-view__finding-ev">
        <Evidence refs={f.evidence} />
      </div>
    </div>
  );
}

function Methodology({ m }: { m: MethodologyEntry }): JSX.Element {
  return (
    <div className="report-view__run" data-run-id={m.runId}>
      <h4 className="report-view__run-title">Run {m.runId}</h4>
      <p>
        <b>Objective:</b> {m.objective || <span className="report-view__muted">—</span>}
      </p>
      <table className="report-view__meta">
        <tbody>
          <tr>
            <th>Status</th>
            <td>
              {m.status}
              {m.stopReason ? ` · stop: ${m.stopReason}` : ''}
            </td>
          </tr>
          <tr>
            <th>Actions</th>
            <td>{m.actionCount}</td>
          </tr>
          <tr>
            <th>Budget</th>
            <td>
              pivots {m.budget.maxPivots} · depth {m.budget.maxDepth} · {m.budget.maxWallClockMs} ms ·{' '}
              {m.budget.maxTokens} tokens
            </td>
          </tr>
          <tr>
            <th>Transforms</th>
            <td>
              {m.transformsUsed.length > 0 ? (
                m.transformsUsed.join(', ')
              ) : (
                <span className="report-view__muted">— none —</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Created</th>
            <td className="report-view__prov-ts">{m.createdAt}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Analyst-narrative block — structurally quarantined and source-stamped. A `model` source is marked
 * non-reproducible (only this section; the tables stay bit-reproducible).
 */
function Narrative({ n }: { n: NarrativeSections }): JSX.Element {
  const isModel = n.source === 'model';
  return (
    <section className="report-view__narrative">
      <h3 className="report-view__narrative-title">Analyst narrative — interpretation, not evidence</h3>
      {isModel ? (
        <p className="report-view__stamp report-view__stamp--warn">
          Source: model{n.model ? ` (${n.model})` : ''} — non-reproducible interpretation. The tables
          below remain machine-derived and reproducible.
        </p>
      ) : (
        <p className="report-view__stamp">
          Source: template — deterministic restatement of the model&rsquo;s own numbers.
        </p>
      )}
      {n.summary ? <p>{n.summary}</p> : null}
      {n.perActor
        ? Object.entries(n.perActor).map(([id, prose]) => (
            <p key={id}>
              <b>{id}:</b> {prose}
            </p>
          ))
        : null}
    </section>
  );
}

export function ReportView({ report }: { report: IntelReport }): JSX.Element {
  const isEmpty =
    report.entityCount === 0 &&
    report.findingCount === 0 &&
    report.keyActors.length === 0 &&
    report.findings.length === 0;

  if (isEmpty) {
    return (
      <div className="report-view report-view--empty">
        <p className="report-view__empty">
          Nothing to report yet — run an investigation or add entities to the graph.
        </p>
      </div>
    );
  }

  const scopeLabel =
    report.scope === 'run' ? `run-scoped${report.runId ? ` (${report.runId})` : ''}` : 'case-wide';
  const capped = report.actorTail.shown < report.actorTail.total;

  return (
    <div className="report-view">
      <h2 className="report-view__title">INTELREPORT</h2>
      <table className="report-view__meta">
        <tbody>
          <tr>
            <th>Case</th>
            <td>{report.caseId}</td>
          </tr>
          <tr>
            <th>Scope</th>
            <td>{scopeLabel}</td>
          </tr>
          <tr>
            <th>Generated</th>
            <td className="report-view__prov-ts">{report.generatedAt}</td>
          </tr>
          <tr>
            <th>Entities</th>
            <td>{report.entityCount}</td>
          </tr>
          <tr>
            <th>Findings</th>
            <td>{report.findingCount}</td>
          </tr>
        </tbody>
      </table>

      {report.narrative ? <Narrative n={report.narrative} /> : null}

      <h3 className="report-view__section-title">Key Actors</h3>
      <table className="report-view__actors">
        <thead>
          <tr>
            <th>Actor</th>
            <th>Role</th>
            <th>Confidence</th>
            <th>Attribution</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {report.keyActors.length > 0 ? (
            report.keyActors.map((a) => <ActorRow key={a.entityId} a={a} />)
          ) : (
            <tr>
              <td colSpan={5} className="report-view__muted">
                — no actors —
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {capped ? (
        <p className="report-view__actor-tail report-view__muted">
          Showing {report.actorTail.shown} of {report.actorTail.total} actors, ranked by salience —{' '}
          {report.actorTail.total - report.actorTail.shown} lower-salience actors not shown.
        </p>
      ) : null}

      <h3 className="report-view__section-title">Findings</h3>
      {report.findings.length > 0 ? (
        report.findings.map((f) => <Finding key={f.id} f={f} />)
      ) : (
        <p className="report-view__muted">— no findings —</p>
      )}

      <h3 className="report-view__section-title">Methodology &amp; provenance</h3>
      {report.methodology.length > 0 ? (
        report.methodology.map((m) => <Methodology key={m.runId} m={m} />)
      ) : (
        <p className="report-view__muted">— no runs —</p>
      )}
    </div>
  );
}
