// @vitest-environment jsdom
/**
 * X — behavioral coverage of the STATIC in-page extraction scripts.
 *
 * `X_POST_SCRIPT`, `USER_CELL_SCRIPT`, `X_PAGE_STATE_SCRIPT` (extract.ts) are the strings
 * the hardened capture window runs via `executeJavaScript` against a live x.com DOM. Every
 * other X test exercises the pure NORMALIZERS on synthetic `RawPost`/`RawUserCell` input —
 * the scripts themselves (their selectors, regexes, URL building, filtering, and the
 * display-name honesty rule) had ZERO behavioral coverage. Here each script is `eval`'d
 * against a REAL captured-DOM fixture (a saved x.com post / UserCell / timeline HTML
 * snippet) inside jsdom, and the extracted fields are asserted — so a selector/regex
 * regression in the actual scraped code is caught, not just a normalizer change.
 *
 * jsdom does not implement `innerText` (the scripts read it for the tweet body and the
 * UserCell line-split). A block-aware `innerText` shim over `textContent` is installed
 * so the fixtures line-break the way a browser renders them; it is a test-harness
 * approximation, not production code.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

import {
  X_POST_SCRIPT,
  USER_CELL_SCRIPT,
  X_PAGE_STATE_SCRIPT,
  normalizePost,
  normalizeUserCell,
} from '../src/main/x-listening/extract';
import type { RawPost, RawUserCell, NormalizeContext } from '../src/main/x-listening/extract';

// ---- innerText shim (block-aware, over textContent) --------------------

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DD', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
]);

function computeInnerText(node: Node): string {
  let text = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      text += child.nodeValue ?? '';
    } else if (child.nodeType === 1) {
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
    get(this: HTMLElement) {
      return computeInnerText(this);
    },
  });
});

/** Run a static in-page script string against the current jsdom document (indirect eval → global scope). */
function runInPage<T>(script: string): T {
  // eslint-disable-next-line no-eval
  return (0, eval)(script) as T;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ---- fixtures (trimmed but real x.com DOM shapes) ----------------------

const POST_HTML = `
<div data-testid="primaryColumn">
  <article data-testid="tweet">
    <div data-testid="socialContext">Pinned</div>
    <div class="row">
      <a href="/target/status/1789000000000000001" role="link">
        <time datetime="2026-08-06T11:59:00.000Z">2h</time>
      </a>
    </div>
    <div data-testid="tweetText"><span>Visible tweet body </span><span>&amp; a link</span></div>
    <div class="media"><img src="https://pbs.twimg.com/media/ABCDEF123.jpg" alt="Image"/></div>
    <div role="group">
      <button data-testid="reply" aria-label="12 replies. Reply"></button>
      <button data-testid="retweet" aria-label="3 reposts. Repost"></button>
      <button data-testid="like" aria-label="1,234 likes. Like"></button>
      <a data-testid="analytics" aria-label="45.6K views. View post analytics"></a>
    </div>
  </article>
  <article data-testid="tweet">
    <div class="row"><a href="/other/status/999"><time datetime="2026-08-06T10:00:00.000Z">4h</time></a></div>
    <div data-testid="tweetText"></div>
  </article>
</div>`;

const REPOST_HTML = `
<article data-testid="tweet">
  <div data-testid="socialContext">You reposted</div>
  <div class="row"><a href="/origauthor/status/222"><time datetime="2026-08-06T09:00:00.000Z">5h</time></a></div>
  <div data-testid="tweetText">Original post by someone else</div>
</article>`;

const REPLY_HTML = `
<article data-testid="tweet">
  <div class="context">Replying to <span>@someone</span></div>
  <div class="row"><a href="/target/status/333"><time datetime="2026-08-06T08:00:00.000Z">6h</time></a></div>
  <div data-testid="tweetText">A reply body</div>
</article>`;

const USERCELL_HTML = `
<div data-testid="primaryColumn">
  <div data-testid="UserCell">
    <a href="/alice"><img src="https://pbs.twimg.com/profile_images/1/a.jpg" alt=""/></a>
    <div>
      <div><span>Alice Analyst</span></div>
      <div><span>@alice</span></div>
      <div role="button">Follow</div>
    </div>
    <div>Threat intel analyst - opinions my own</div>
  </div>
  <div data-testid="UserCell">
    <a href="/bob"><img src="https://pbs.twimg.com/profile_images/2/b.jpg" alt=""/></a>
    <div>
      <div><span>@bob</span></div>
      <div role="button">Follow</div>
    </div>
  </div>
</div>`;

const CTX: NormalizeContext = {
  caseId: 'case-a',
  jobId: 'job-1',
  collectorVersion: 'x-listening/1.0.0',
  harvestedAt: '2026-08-06T12:00:00.000Z',
  channelId: 'target',
  channelLabel: '@target timeline',
};

// ---- X_POST_SCRIPT against a real post DOM -----------------------------

describe('X_POST_SCRIPT against a captured tweet-article DOM', () => {
  it('extracts the visible post fields and FILTERS a text-less article', () => {
    document.body.innerHTML = POST_HTML;
    const posts = runInPage<RawPost[]>(X_POST_SCRIPT);

    // Two articles are present; the second has no visible text → filtered out.
    expect(posts).toHaveLength(1);
    const p = posts[0];
    expect(p.id).toBe('1789000000000000001');
    expect(p.username).toBe('target');
    expect(p.url.endsWith('/target/status/1789000000000000001')).toBe(true);
    expect(p.text).toBe('Visible tweet body & a link'); // spans joined, entity decoded
    expect(p.createdAt).toBe('2026-08-06T11:59:00.000Z');
    expect(p.isReply).toBe(false);
    expect(p.isRepost).toBe(false);
    // Metric aria-labels are read VERBATIM by the in-page `metric()` helper.
    expect(p.metricsRaw.replies).toBe('12 replies. Reply');
    expect(p.metricsRaw.reposts).toBe('3 reposts. Repost');
    expect(p.metricsRaw.likes).toBe('1,234 likes. Like');
    expect(p.metricsRaw.views).toBe('45.6K views. View post analytics');
    // Media is the remote pbs.twimg.com/media src at capture time (resolved to data: downstream).
    expect(p.media).toEqual(['https://pbs.twimg.com/media/ABCDEF123.jpg']);
  });

  it('feeds the pure normalizer end-to-end — honesty stamps + rounded-metric flag survive the real DOM', () => {
    document.body.innerHTML = POST_HTML;
    const p = runInPage<RawPost[]>(X_POST_SCRIPT)[0];
    const item = normalizePost(p, CTX);
    expect(item.verified).toBe(false);
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.metrics.likes.raw).toBe('1,234');
    expect(item.metrics.likes.approx).toBe(false); // exact count, not rounded
    expect(item.metrics.views.raw).toBe('45.6K');
    expect(item.metrics.views.approx).toBe(true); // rounded display
    // The remote media URL is dropped by the data:-only filter — never stored.
    expect(item.media).toEqual([]);
  });

  it('detects a repost from the socialContext', () => {
    document.body.innerHTML = REPOST_HTML;
    const p = runInPage<RawPost[]>(X_POST_SCRIPT)[0];
    expect(p.isRepost).toBe(true);
    expect(p.username).toBe('origauthor');
    expect(p.socialContext).toBe('You reposted');
  });

  it('detects a reply from the "Replying to" body text', () => {
    document.body.innerHTML = REPLY_HTML;
    const p = runInPage<RawPost[]>(X_POST_SCRIPT)[0];
    expect(p.isReply).toBe(true);
    expect(p.id).toBe('333');
  });
});

// ---- USER_CELL_SCRIPT against a real followers DOM ---------------------

describe('USER_CELL_SCRIPT against a captured UserCell DOM', () => {
  it('extracts handle, display name, bio, and profile link from a full cell', () => {
    document.body.innerHTML = USERCELL_HTML;
    const cells = runInPage<RawUserCell[]>(USER_CELL_SCRIPT);
    expect(cells).toHaveLength(2);

    const alice = cells[0];
    expect(alice.username).toBe('alice');
    expect(alice.displayName).toBe('Alice Analyst');
    expect(alice.bio).toBe('Threat intel analyst - opinions my own');
    expect(alice.url.endsWith('/alice')).toBe(true);
    expect(alice.avatar).toBe('https://pbs.twimg.com/profile_images/1/a.jpg');
  });

  it('records an ABSENT display name honestly — NEVER falls back to the @handle', () => {
    document.body.innerHTML = USERCELL_HTML;
    const bob = runInPage<RawUserCell[]>(USER_CELL_SCRIPT)[1];
    expect(bob.username).toBe('bob');
    // The in-page script leaves display name '' when no name line is visible.
    expect(bob.displayName).toBe('');
    expect(bob.displayName).not.toBe('bob');
    expect(bob.displayName).not.toBe('@bob');
  });

  it('feeds the normalizer end-to-end — the absent name becomes an OMITTED field, remote avatar dropped', () => {
    document.body.innerHTML = USERCELL_HTML;
    const [alice, bob] = runInPage<RawUserCell[]>(USER_CELL_SCRIPT);

    const a = normalizeUserCell(alice);
    expect(a).not.toBeNull();
    expect(a!.handle).toBe('@alice');
    expect(a!.displayName).toBe('Alice Analyst');
    expect(a!.avatar).toBeUndefined(); // remote profile_images URL dropped

    const b = normalizeUserCell(bob);
    expect(b).not.toBeNull();
    expect(b!.handle).toBe('@bob');
    // Honesty: an unobserved display name is omitted, not the @handle.
    expect(b!.displayName).toBeUndefined();
  });
});

// ---- X_PAGE_STATE_SCRIPT against a rendered page ------------------------

describe('X_PAGE_STATE_SCRIPT against a rendered page', () => {
  it('reports the visible article count and a bounded slice of body text', () => {
    document.body.innerHTML = POST_HTML;
    const state = runInPage<{ url: string; text: string; articles: number }>(X_PAGE_STATE_SCRIPT);
    expect(state.articles).toBe(2); // both tweet articles counted (pre-filter)
    expect(typeof state.url).toBe('string');
    expect(state.text.length).toBeLessThanOrEqual(5000);
    expect(state.text).toContain('Visible tweet body');
  });

  it('reports zero articles on a page with no tweets', () => {
    document.body.innerHTML = '<div>Sign in to X</div>';
    const state = runInPage<{ text: string; articles: number }>(X_PAGE_STATE_SCRIPT);
    expect(state.articles).toBe(0);
    expect(state.text).toContain('Sign in to X');
  });
});
