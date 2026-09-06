// @vitest-environment jsdom
/**
 * The page-side follower accumulator, against a virtualizing list.
 *
 * THE BUG THIS EXISTS TO CATCH. X removes a `UserCell` from the DOM once it scrolls out of view.
 * A per-pass `querySelectorAll('[data-testid="UserCell"]')` therefore sees only the current
 * viewport and loses every row that appeared and vanished between two passes. That is why
 * GhostExodus replaced his own per-pass reader with a MutationObserver accumulator, and why this
 * port — which carried the per-pass reader from his SUPERSEDED v2.3.0 source — could scroll a
 * follower list of thousands and persist almost none of it.
 *
 * `readVisibleUserCells`, the function our `USER_CELL_SCRIPT` was ported from, does not exist
 * anywhere in his v3.4.1 source.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  X_NETWORK_COLLECTOR_INSTALL_SCRIPT,
  X_NETWORK_COLLECTOR_READ_SCRIPT,
  USER_CELL_SCRIPT,
  type XNetworkCollectorState,
  type RawUserCell,
} from '../src/main/x-listening/extract';

const BLOCK = new Set(['DIV', 'SPAN', 'LI', 'SECTION', 'ARTICLE', 'MAIN', 'P']);
function computeInnerText(node: Node): string {
  let text = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) text += child.nodeValue ?? '';
    else if (child.nodeType === 1) {
      const el = child as Element;
      if (el.tagName === 'BR') { text += '\n'; return; }
      const inner = computeInnerText(el);
      text += BLOCK.has(el.tagName) ? `\n${inner}\n` : inner;
    }
  });
  return text;
}
beforeAll(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return computeInnerText(this); },
  });
});

function runInPage<T>(script: string): T {
  // eslint-disable-next-line no-eval
  return (0, eval)(script) as T;
}

/** One follower row in the shape x.com renders. */
function cellHtml(username: string, displayName: string): string {
  return `
    <div data-testid="UserCell">
      <a href="/${username}"><img src="https://pbs.twimg.com/profile_images/1/${username}.jpg"></a>
      <div><span>${displayName}</span></div>
      <div><span>@${username}</span></div>
    </div>`;
}

/** Render exactly the rows a virtualized list would currently have mounted. */
function renderViewport(usernames: string[]): void {
  const col = document.querySelector('[data-testid="primaryColumn"]')!;
  col.innerHTML = usernames.map((u) => cellHtml(u, `${u} display`)).join('');
}

/** jsdom delivers MutationObserver callbacks as a microtask. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '<div data-testid="primaryColumn"></div>';
  delete (window as unknown as Record<string, unknown>).__ga98NetworkCollector;
});

describe('the accumulator keeps rows that have scrolled out of the DOM', () => {
  it('retains every row across viewports the old per-pass read would have lost', async () => {
    renderViewport(['alice', 'bob']);
    runInPage<number>(X_NETWORK_COLLECTOR_INSTALL_SCRIPT);

    // Scroll: the first pair is unmounted, a new pair mounts. This is what X actually does.
    renderViewport(['carol', 'dave']);
    await flush();
    renderViewport(['erin', 'frank']);
    await flush();

    const state = runInPage<XNetworkCollectorState>(X_NETWORK_COLLECTOR_READ_SCRIPT);
    expect(state.rows.map((r) => r.username).sort()).toEqual(['alice', 'bob', 'carol', 'dave', 'erin', 'frank']);
    expect(state.count).toBe(6);

    // The read the port had been using sees only what is mounted right now — the whole defect.
    const visibleOnly = runInPage<RawUserCell[]>(USER_CELL_SCRIPT);
    expect(visibleOnly.map((r) => r.username)).toEqual(['erin', 'frank']);
  });

  it('dedups by handle, case-insensitively, and preserves first-seen order', async () => {
    renderViewport(['alice']);
    runInPage<number>(X_NETWORK_COLLECTOR_INSTALL_SCRIPT);
    renderViewport(['ALICE', 'bob']);
    await flush();

    const state = runInPage<XNetworkCollectorState>(X_NETWORK_COLLECTOR_READ_SCRIPT);
    expect(state.count).toBe(2);
    expect(state.rows.map((r) => r.username.toLowerCase())).toEqual(['alice', 'bob']);
  });

  it('reads the real fields, and never fabricates a display name from the handle', async () => {
    document.querySelector('[data-testid="primaryColumn"]')!.innerHTML = `
      <div data-testid="UserCell">
        <a href="/nameless"><img src="https://pbs.twimg.com/profile_images/1/n.jpg"></a>
        <div><span>@nameless</span></div>
      </div>`;
    runInPage<number>(X_NETWORK_COLLECTOR_INSTALL_SCRIPT);

    const row = runInPage<XNetworkCollectorState>(X_NETWORK_COLLECTOR_READ_SCRIPT).rows[0];
    expect(row.username).toBe('nameless');
    expect(row.url).toBe(new URL('/nameless', location.origin).href);
    // HONESTY divergence from his source, which falls back to the handle: a display name that was
    // never observed must be recorded as absent, not invented.
    expect(row.displayName).toBe('');
  });

  it('reports an empty state instead of throwing when the collector is gone', () => {
    const state = runInPage<XNetworkCollectorState>(X_NETWORK_COLLECTOR_READ_SCRIPT);
    expect(state.count).toBe(0);
    expect(state.rows).toEqual([]);
  });
});
