// @vitest-environment jsdom
/**
 * Task 6 — ReportView (pure) + ReportPanel (spec §5).
 *
 * ReportView renders an assembled `IntelReport` as Win98 React — NEVER an embedded HTML doc /
 * iframe (the renderer CSP/frame-src is a security boundary). Key-actors table with plain badges
 * (not raw scores), an honest `findingBacked:false` label, a truncation footer when the actor tail
 * is capped, findings with evidence as TEXT (no `<a href>` — `rawRef` is a chain-of-custody pointer,
 * never a clickable link), a methodology/provenance appendix, and a quarantined source-stamped
 * narrative whose `model` source carries the non-reproducible marker.
 *
 * ReportPanel drives it: a scope toggle (This case / This run when a runId is in play), a primary
 * Generate button that calls report.generate(caseId, {runId?}) per scope, ReportView preview, and an
 * Export PDF action calling report.save(caseId, {runId?}). Empty model → empty state.
 *
 * No @testing-library — React 18 createRoot inside act() against a jsdom container, mocked
 * window.api, mirroring x-ghostscrape-cases-sidebar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportView } from '../src/renderer/modules/investigation-graph/ReportView';
import { ReportPanel } from '../src/renderer/modules/investigation-graph/ReportPanel';
import type {
  IntelReport,
  KeyActor,
  ReportFinding,
  MethodologyEntry,
} from '@shared/investigation-report';

const CASE_UUID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = 'run-7';

const ACTOR_BACKED: KeyActor = {
  entityId: 'e1',
  type: 'domain',
  value: 'evil.tld',
  role: 'command-and-control',
  cluster: 0,
  salience: 9.5,
  degree: 4,
  confidence: 'high',
  attribution: 'attributed',
  findingBacked: true,
  evidence: [
    {
      evidenceId: 'ev1',
      transformId: 'whois',
      transformVersion: '1.0.0',
      createdAt: '2026-07-05T00:00:00.000Z',
      rawRef: 'blob:abc123def',
      relation: 'resolves-to',
    },
  ],
  findingIds: ['f1'],
};

const ACTOR_UNBACKED: KeyActor = {
  entityId: 'e2',
  type: 'ip',
  value: '203.0.113.9',
  role: 'host',
  cluster: 0,
  salience: 3.2,
  degree: 1,
  confidence: 'low',
  attribution: 'unattributed',
  findingBacked: false,
  evidence: [],
  findingIds: [],
};

const FINDING: ReportFinding = {
  id: 'f1',
  claim: 'evil.tld resolves to attacker-controlled infrastructure',
  confidence: { band: 'high', attribution: 'attributed', score: 0.91 },
  evidence: [
    {
      evidenceId: 'ev1',
      transformId: 'whois',
      transformVersion: '1.0.0',
      createdAt: '2026-07-05T00:00:00.000Z',
      rawRef: 'blob:abc123def',
    },
  ],
  createdAt: '2026-07-05T00:00:00.000Z',
};

const METHOD: MethodologyEntry = {
  runId: RUN_ID,
  objective: 'Map the infrastructure behind evil.tld',
  budget: { maxPivots: 20, maxDepth: 3, maxWallClockMs: 180_000, maxTokens: 150_000 },
  status: 'done',
  stopReason: 'budget-exhausted',
  actionCount: 12,
  transformsUsed: ['dns', 'whois'],
  createdAt: '2026-07-05T00:00:00.000Z',
};

function makeReport(over: Partial<IntelReport> = {}): IntelReport {
  return {
    caseId: CASE_UUID,
    scope: 'case',
    generatedAt: '2026-07-05T00:00:00.000Z',
    entityCount: 2,
    findingCount: 1,
    keyActors: [ACTOR_BACKED, ACTOR_UNBACKED],
    actorTail: { shown: 2, total: 5 },
    findings: [FINDING],
    methodology: [METHOD],
    narrative: {
      summary: 'The domain is the pivot of the campaign.',
      source: 'model',
      model: 'llama3.1',
      perActor: { e1: 'evil.tld anchors the observed infrastructure.' },
    },
    ...over,
  };
}

const EMPTY_REPORT: IntelReport = {
  caseId: CASE_UUID,
  scope: 'case',
  generatedAt: '2026-07-05T00:00:00.000Z',
  entityCount: 0,
  findingCount: 0,
  keyActors: [],
  actorTail: { shown: 0, total: 0 },
  findings: [],
  methodology: [],
};

let container: HTMLDivElement;
let root: Root;
let generate: ReturnType<typeof vi.fn>;
let save: ReturnType<typeof vi.fn>;

function installApi(): void {
  generate = vi.fn().mockResolvedValue(makeReport());
  save = vi.fn().mockResolvedValue('/home/desirae/INTELREPORT-11111111.pdf');
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    investigation: {
      report: { generate, save },
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ReportView (pure)
// ---------------------------------------------------------------------------

describe('ReportView', () => {
  function render(report: IntelReport): void {
    act(() => {
      root.render(<ReportView report={report} />);
    });
  }

  it('renders the key-actors table with confidence/attribution as plain badges (not raw scores)', () => {
    render(makeReport());
    const view = container.querySelector('.report-view') as HTMLElement;
    expect(view).not.toBeNull();
    const text = view.textContent ?? '';
    expect(text).toContain('evil.tld');
    expect(text).toContain('command-and-control');
    // Bands render as words, not the underlying float salience/degree.
    expect(text).toContain('high');
    expect(text).toContain('attributed');
    expect(text).not.toContain('9.5'); // raw salience never surfaces
  });

  it('shows the findingBacked:false actor honestly', () => {
    render(makeReport());
    const text = container.textContent ?? '';
    expect(text).toContain('203.0.113.9');
    expect(/graph-present|not finding-backed/i.test(text)).toBe(true);
  });

  it('renders a truncation footer when actorTail.shown < total', () => {
    render(makeReport({ actorTail: { shown: 2, total: 5 } }));
    const foot = container.querySelector('.report-view__actor-tail');
    expect(foot).not.toBeNull();
    expect(foot!.textContent).toMatch(/2\s*of\s*5/i);
  });

  it('omits the truncation footer when nothing is capped', () => {
    render(makeReport({ actorTail: { shown: 2, total: 2 } }));
    expect(container.querySelector('.report-view__actor-tail')).toBeNull();
  });

  it('renders evidence provenance as text — never a clickable link (rawRef is not a URL)', () => {
    render(makeReport());
    const view = container.querySelector('.report-view') as HTMLElement;
    expect(view.querySelector('a')).toBeNull(); // no anchors anywhere in the report
    const text = view.textContent ?? '';
    expect(text).toContain('whois@1.0.0');
    expect(text).toContain('blob:abc123def'); // rawRef surfaced as opaque text
  });

  it('renders findings with claim + confidence band (evidence as text)', () => {
    render(makeReport());
    const finding = container.querySelector('.report-view__finding') as HTMLElement;
    expect(finding).not.toBeNull();
    expect(finding.textContent).toContain('evil.tld resolves to attacker-controlled infrastructure');
    expect(finding.textContent).toContain('high');
  });

  it('renders the methodology/provenance appendix', () => {
    render(makeReport());
    const text = container.textContent ?? '';
    expect(text).toContain('Map the infrastructure behind evil.tld');
    expect(text).toContain('budget-exhausted');
    expect(text).toContain('whois');
    expect(text).toContain('dns');
  });

  it('stamps a model-source narrative with the non-reproducible marker', () => {
    render(makeReport());
    const narr = container.querySelector('.report-view__narrative') as HTMLElement;
    expect(narr).not.toBeNull();
    expect(/non-reproducible/i.test(narr.textContent ?? '')).toBe(true);
    expect(narr.textContent).toContain('llama3.1');
  });

  it('a template-source narrative does NOT carry the non-reproducible marker', () => {
    render(
      makeReport({ narrative: { summary: 'restated numbers', source: 'template' } }),
    );
    const narr = container.querySelector('.report-view__narrative') as HTMLElement;
    expect(/non-reproducible/i.test(narr.textContent ?? '')).toBe(false);
  });

  it('renders the empty state when there are no entities and no findings', () => {
    render(EMPTY_REPORT);
    const empty = container.querySelector('.report-view__empty');
    expect(empty).not.toBeNull();
    expect(/nothing to report yet/i.test(empty!.textContent ?? '')).toBe(true);
    // No actors table in the empty state.
    expect(container.querySelector('.report-view__actors')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ReportPanel
// ---------------------------------------------------------------------------

describe('ReportPanel', () => {
  it('Generate (default case scope, no runId) calls report.generate(caseId) and renders the report', async () => {
    await act(async () => {
      root.render(<ReportPanel caseId={CASE_UUID} />);
    });
    await flush();

    await act(async () => {
      buttonByText(container, /generate/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(generate).toHaveBeenCalledWith(CASE_UUID);
    expect(container.querySelector('.report-view')).not.toBeNull();
    expect(container.textContent).toContain('evil.tld');
  });

  it('when a runId is present the panel defaults to run scope and Generate passes {runId}', async () => {
    await act(async () => {
      root.render(<ReportPanel caseId={CASE_UUID} runId={RUN_ID} />);
    });
    await flush();

    await act(async () => {
      buttonByText(container, /generate/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(generate).toHaveBeenCalledWith(CASE_UUID, { runId: RUN_ID });
  });

  it('the scope toggle switches which runId (if any) is passed to generate', async () => {
    await act(async () => {
      root.render(<ReportPanel caseId={CASE_UUID} runId={RUN_ID} />);
    });
    await flush();

    // Switch to "This case".
    await act(async () => {
      buttonByText(container, /this case/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await act(async () => {
      buttonByText(container, /generate/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(generate).toHaveBeenLastCalledWith(CASE_UUID);
  });

  it('without a runId the "This run" toggle is disabled', async () => {
    await act(async () => {
      root.render(<ReportPanel caseId={CASE_UUID} />);
    });
    await flush();

    const thisRun = buttonByText(container, /this run/i);
    expect(thisRun.disabled).toBe(true);
  });

  it('Export calls report.save with the scoped opts', async () => {
    await act(async () => {
      root.render(<ReportPanel caseId={CASE_UUID} runId={RUN_ID} />);
    });
    await flush();

    // Generate first so there is something to export.
    await act(async () => {
      buttonByText(container, /generate/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    await act(async () => {
      buttonByText(container, /export/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(save).toHaveBeenCalledWith(CASE_UUID, { runId: RUN_ID });
  });

  it('renders the empty state when the generated report has no entities or findings', async () => {
    generate.mockResolvedValue(EMPTY_REPORT);
    await act(async () => {
      root.render(<ReportPanel caseId={CASE_UUID} />);
    });
    await flush();

    await act(async () => {
      buttonByText(container, /generate/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(/nothing to report yet/i.test(container.textContent ?? '')).toBe(true);
  });
});
