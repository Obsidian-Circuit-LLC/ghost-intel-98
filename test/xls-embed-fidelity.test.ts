// @vitest-environment node
/**
 * "Embedded verbatim" has to be CHECKABLE, or it is just a claim.
 *
 * The X Listening Station renderer is GhostExodus's own `src/main.tsx`, running unmodified inside
 * Ghost Intel 98. His original is vendored at `vendor/x-listening-station-v3.4.1/` and this test
 * diffs the embedded copy against it every run.
 *
 * It exists because of a specific, repeated failure: five consecutive releases re-derived his
 * behaviour from our port instead of his source, and the standing field complaint is that we keep
 * wrapping his app in our own signature. A comment promising fidelity would not have caught any of
 * that. A failing test will.
 *
 * The permitted differences are exactly five mechanical edits — four structurally unavoidable when
 * mounting a standalone app inside another app's React tree, plus one inert line referencing two
 * memos his `App()` declares but does not read (this project sets `noUnusedLocals`; his did not).
 * Everything else must be byte-identical, INCLUDING his stylesheet — which is still shipped
 * unchanged and is now CONFINED at mount time rather than edited (see scope-css.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const original = readFileSync(join(root, 'vendor/x-listening-station-v3.4.1/src/main.tsx'), 'utf8');
const embedded = readFileSync(join(root, 'src/renderer/modules/x-listening-embed/StationApp.tsx'), 'utf8');

/** Strip the embed's own header block so the comparison starts at his first line of code. */
function embeddedBody(): string {
  const marker = ' */\n';
  return embedded.slice(embedded.indexOf(marker) + marker.length);
}

/** The five permitted edits, applied to HIS file, should reproduce OURS exactly. */
function applyPermittedEdits(source: string): string {
  return source
    .replace(
      "import { StrictMode, useEffect, useMemo, useState } from 'react';",
      "import { useEffect, useMemo, useState } from 'react';"
    )
    .replace("import { createRoot } from 'react-dom/client';", '')
    // Edit 2: his stylesheet import is REMOVED, not repointed. Importing his sheet from here is
    // what leaked his global element rules (`*`, `body`, `button`, `input`…) across the whole app
    // in v3.73.0; StationShell injects the same file scoped to his container instead.
    .replace("import './styles.css';\n", "")
    .replace(/^function App\(\)/m, 'export function App()')
    .replace(/^createRoot\(.*$/m, '')
    // Edit 5: inert, behaviour-free, and inserted directly after his second unused memo.
    .replace(
      /^(\s*const postsById = useMemo.*)$/m,
      '$1\n  void activeCase; void postsById; // (embed edit 5) see header'
    );
}

describe('the embedded X Listening Station is GhostExodus\'s renderer, unmodified', () => {
  it('differs from his original by ONLY the five mechanical mount edits', () => {
    expect(embeddedBody()).toBe(applyPermittedEdits(original));
  });

  it('ships his stylesheet byte-for-byte', () => {
    const his = readFileSync(join(root, 'vendor/x-listening-station-v3.4.1/src/styles.css'), 'utf8');
    const ours = readFileSync(join(root, 'src/renderer/modules/x-listening-embed/station.css'), 'utf8');
    // No re-skin, no theme tokens substituted into his palette, no "while we're here" tidy-up.
    expect(ours).toBe(his);
  });

  it('keeps his single App component as the mount point', () => {
    expect(embeddedBody()).toMatch(/^export function App\(\)/m);
    // …and does not bootstrap its own React root inside ours. (Checked against the BODY: the
    // header comment names `createRoot` when listing the permitted edits.)
    expect(embeddedBody()).not.toMatch(/createRoot\(/);
  });

  it('still reaches the app only through window.xls', () => {
    // His UI talks to exactly one surface. If an embed edit ever reached around it — importing a
    // GI98 store, calling window.api directly — his renderer would no longer be his renderer, and
    // the boundary where all the hardening lives would have been bypassed.
    expect(embeddedBody()).not.toMatch(/window\.api\b/);
    expect(embeddedBody()).toMatch(/window\.xls\b/);
  });
});
