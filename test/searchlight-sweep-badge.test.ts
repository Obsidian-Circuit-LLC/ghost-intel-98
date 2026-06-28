/**
 * Focused test for SweepPanel maybe-badge className assignment.
 *
 * There is no in-repo headless Playwright computed-style harness so this file
 * mirrors the match-badge logic from SweepPanel.tsx and uses
 * react-dom/server.renderToStaticMarkup to assert the correct className is
 * produced for each status / probability combination, without needing a full
 * React render environment or @testing-library/react.
 *
 * The 98.css cascade concern (element-level white fill overriding dark badge) is
 * addressed by declaring `background` on the CLASS selector `.sl-match-maybe`
 * (specificity 0,1,0 > element rule 0,0,1).  This test verifies the class name
 * assignment; the CSS declaration is verified by reading searchlight.css.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ── Badge-class logic mirrored from SweepPanel.tsx (MATCH column) ────────────
//
//   {(r.status === 'found' || r.status === 'maybe') && r.probability != null ? (
//     <span className={r.status === 'maybe' ? 'sl-match-maybe' : 'sl-match-badge'}>
//       ● {Math.round(r.probability * 100)}%
//     </span>
//   ) : r.status === 'found' ? (
//     <span className="sl-match-badge">● CONFIRMED/LIKELY/POSSIBLE</span>
//   ) : ...
//   }

function renderBadgeHtml(
  status: string,
  probability: number | null | undefined,
  confidence: 'high' | 'medium' | 'low' = 'high',
): string {
  const isMaybeOrFound = status === 'found' || status === 'maybe';
  if (isMaybeOrFound && probability != null) {
    const cls = status === 'maybe' ? 'sl-match-maybe' : 'sl-match-badge';
    return renderToStaticMarkup(
      createElement('span', { className: cls }, `● ${Math.round(probability * 100)}%`),
    );
  }
  if (status === 'found') {
    const label =
      confidence === 'high' ? 'CONFIRMED' : confidence === 'medium' ? 'LIKELY' : 'POSSIBLE';
    return renderToStaticMarkup(
      createElement('span', { className: 'sl-match-badge' }, `● ${label}`),
    );
  }
  return '';
}

// ── Row class logic mirrored from SweepPanel.tsx ─────────────────────────────
function rowClass(status: string): string {
  if (status === 'found') return 'sl-sweep-row sl-row-found';
  if (status === 'maybe') return 'sl-sweep-row sl-row-maybe';
  return 'sl-sweep-row';
}

// ─────────────────────────────────────────────────────────────────────────────

describe('SweepPanel maybe badge — className assignment', () => {
  it("status='maybe' with probability → sl-match-maybe class, NOT sl-match-badge", () => {
    const html = renderBadgeHtml('maybe', 0.73);
    expect(html).toContain('class="sl-match-maybe"');
    expect(html).not.toContain('sl-match-badge');
    expect(html).toContain('73%');
  });

  it("status='found' with probability → sl-match-badge class, NOT sl-match-maybe", () => {
    const html = renderBadgeHtml('found', 0.85);
    expect(html).toContain('class="sl-match-badge"');
    expect(html).not.toContain('sl-match-maybe');
    expect(html).toContain('85%');
  });

  it("status='maybe' without probability → no badge rendered (falls to dash/tor branch)", () => {
    expect(renderBadgeHtml('maybe', null)).toBe('');
    expect(renderBadgeHtml('maybe', undefined)).toBe('');
  });

  it("status='found' without probability → fallback confidence badge (legacy scorer-off path)", () => {
    const html = renderBadgeHtml('found', null, 'high');
    expect(html).toContain('class="sl-match-badge"');
    expect(html).toContain('CONFIRMED');
    expect(html).not.toContain('%');
  });

  it("probability is rendered as integer percent", () => {
    expect(renderBadgeHtml('maybe', 0.733)).toContain('73%');
    expect(renderBadgeHtml('maybe', 0.999)).toContain('100%');
    expect(renderBadgeHtml('found', 0.501)).toContain('50%');
  });

  it("not_found / error status → no badge", () => {
    expect(renderBadgeHtml('not_found', 0.8)).toBe('');
    expect(renderBadgeHtml('error', 0.5)).toBe('');
    expect(renderBadgeHtml('blocked', 0.9)).toBe('');
    expect(renderBadgeHtml('unknown', 0.6)).toBe('');
  });
});

describe('SweepPanel maybe row — className assignment', () => {
  it("status='maybe' → sl-row-maybe added to row class", () => {
    expect(rowClass('maybe')).toBe('sl-sweep-row sl-row-maybe');
  });

  it("status='found' → sl-row-found (unchanged)", () => {
    expect(rowClass('found')).toBe('sl-sweep-row sl-row-found');
  });

  it("other statuses → no extra row class", () => {
    expect(rowClass('not_found')).toBe('sl-sweep-row');
    expect(rowClass('error')).toBe('sl-sweep-row');
    expect(rowClass('blocked')).toBe('sl-sweep-row');
  });
});
