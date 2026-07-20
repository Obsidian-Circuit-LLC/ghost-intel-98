// @vitest-environment jsdom
/**
 * Headless cascade guard for the modal-dialog height fix (GhostExodus: the Jukebox "Add station"
 * and Bookmarks "Add link" dialogs rendered full-height with giant inputs and tall OK/Cancel bars).
 *
 * Root cause: a modal dialog (`.ga98-dialog-veil > .window`) is a DOM descendant of the module's
 * draggable `.ga98-window-shell`, so `.ga98-window-shell .window { height: 100% }` (meant to size a
 * module's OWN window) also matched the dialog. Inside the full-viewport fixed veil that blew the
 * dialog up to full height. The fix re-anchors `.ga98-dialog-veil .window` to `height: fit-content`.
 * It works only because that rule sits AFTER the window-shell rule at equal specificity (source-order
 * tiebreak) — this test fails if the rule is removed OR moved before the window-shell rule.
 *
 * jsdom has no layout engine but does run selector matching + the cascade in getComputedStyle, so we
 * assert the *resolved declared* height, not geometry (the repo's standard CSS-regression technique).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/styles/theme.css'), 'utf8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
});

afterEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.innerHTML = '';
});

function nest(): HTMLElement {
  // .ga98-window-shell > .window(module) > .window-body > .ga98-dialog-veil > .window(dialog)
  document.body.innerHTML =
    '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
    '<div class="ga98-dialog-veil"><div class="window ga98-dialog-window" id="dlg">' +
    '<div class="window-body" id="dlgbody"></div></div></div>' +
    '</div></div></div>';
  return document.getElementById('dlg') as HTMLElement;
}

describe('modal dialog height cascade (GhostExodus full-height-dialog fix)', () => {
  it('a dialog .window inside a window-shell resolves to fit-content, not the shell rule\'s 100%', () => {
    const dlg = nest();
    // The window-shell rule would give height:100% (the bug); the veil override must win.
    expect(getComputedStyle(dlg).height).toBe('fit-content');
  });

  it('the module\'s own .window still fills its shell (fix did not touch non-dialog windows)', () => {
    document.body.innerHTML =
      '<div class="ga98-window-shell"><div class="window" id="modwin"></div></div>';
    const modwin = document.getElementById('modwin') as HTMLElement;
    expect(getComputedStyle(modwin).height).toBe('100%');
  });

  it('a content-heavy dialog body keeps flex:1 so it scrolls (override only touched height)', () => {
    nest();
    const body = document.getElementById('dlgbody') as HTMLElement;
    // .ga98-window-shell .window-body { flex: 1 } must still apply to the dialog body — the fix
    // deliberately did NOT override it, so mail/chat/net-explorer scrollable dialogs keep working.
    expect(getComputedStyle(body).flexGrow).toBe('1');
  });
});
