// @vitest-environment node
/**
 * The X Listening Station the app mounts is GhostExodus's embedded renderer, not the earlier port.
 *
 * The swap is one import in `register-builtins.tsx`, which makes it exactly the kind of change a
 * later edit can quietly undo. This pins it.
 *
 * The port's source is deliberately still in the tree for this release: it is unmounted (so it
 * tree-shakes out of the bundle) and still covered by its own tests, which keeps a one-line revert
 * available if the embed misbehaves in the field. Given this module's history — five consecutive
 * releases chasing one bug — that revert is worth more than the tidiness of deleting it before
 * anyone has run the embed on a real machine. It goes once the field confirms the embed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const registry = readFileSync(
  join(process.cwd(), 'src/renderer/modules/register-builtins.tsx'),
  'utf8'
);

describe('the mounted X Listening Station', () => {
  it('is the embedded renderer', () => {
    // The registry mounts the SHELL, which wraps his App and confines his stylesheet to it.
    expect(registry).toMatch(/from '\.\/x-listening-embed\/StationShell'/);
  });

  it('is NOT the earlier port', () => {
    expect(registry).not.toMatch(/from '\.\/x-listening\/XListeningModule'/);
  });

  it('mounts his App with no caseId prop — his app owns its own campaign selection', () => {
    // The port was driven by the app's active case. His app selects its campaign through
    // window.xls, so passing one would be this app reaching into his state model again.
    expect(registry).toMatch(/<XListeningStation \/>/);
  });
});
