// @vitest-environment jsdom
/**
 * TG — behavioral coverage of the STATIC in-page extraction scripts.
 *
 * `TG_MESSAGE_SCRIPT`, `TG_MEMBER_SCRIPT`, and `TG_PROFILE_SCRIPT` (extract.ts) are the
 * strings the hardened capture window runs via `executeJavaScript` against a live
 * Telegram-Web DOM. Every OTHER Telegram test exercises the pure NORMALIZERS on synthetic
 * `RawMessage`/`RawMember`/`RawProfile` input, and asserts only that the script SOURCE
 * carries no `${…}` — the scripts' own selectors, regexes, visibility filtering, href
 * parsing, and the display-name honesty rule had ZERO behavioral coverage (the exact gap
 * the X module already closes in `x-listening-extract-scripts.test.ts`). Here each script
 * is `eval`'d against a REAL captured-DOM fixture inside jsdom and the extracted fields are
 * asserted — so a selector/regex regression in the actual scraped code is caught, not just
 * a normalizer change.
 *
 * The Telegram scripts read layout + `innerText` the way a browser renders them:
 *   - `vis(e)` gates on `offsetWidth || offsetHeight || getClientRects().length`;
 *   - member/profile roots are filtered on `getBoundingClientRect().width`;
 *   - member/profile display-name and status lines are split out of a block-rendered
 *     `innerText`.
 * jsdom implements none of these, so a block-aware `innerText` shim (over `textContent`)
 * and a fixed-size layout shim are installed. Both are test-harness approximations of a
 * real render, never production code.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

import {
  TG_MESSAGE_SCRIPT,
  TG_MEMBER_SCRIPT,
  TG_PROFILE_SCRIPT,
  normalizeMessage,
  normalizeMember,
  normalizeProfile,
  type RawMessage,
  type RawMember,
  type RawProfile,
  type TgNormalizeContext,
} from '../src/main/socmint/telegram-hunter/extract';

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
  const proto = window.HTMLElement.prototype;
  Object.defineProperty(proto, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return computeInnerText(this);
    },
  });
  // Layout shim: make every element count as VISIBLE and give roots a stable width so the
  // member/profile root-size filters (width > 220 / 180..850) admit the fixture containers.
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return 300; } });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return 100; } });
  Object.defineProperty(proto, 'getClientRects', {
    configurable: true,
    value() { return [{ width: 300, height: 100 }]; },
  });
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    value() { return { width: 300, height: 100, top: 0, left: 0, right: 300, bottom: 100, x: 0, y: 0 }; },
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

const CTX: TgNormalizeContext = {
  caseId: 'case-a',
  jobId: 'job-1',
  collectorVersion: 'telegram-hunter/1.0.0',
  harvestedAt: '2026-08-07T12:00:00.000Z',
  channelId: 'Operators Group',
  channelLabel: 'Operators Group',
};

// ---- TG_MESSAGE_SCRIPT against a captured message DOM ------------------

const MESSAGES_HTML = `
<h2 class="chat-title">Operators Group</h2>
<div class="message-bubble" data-message-id="msg-42">
  <div class="sender-name"><a href="https://t.me/jane_op">Jane Doe</a></div>
  <span class="time">Aug 7 at 11:59</span>
  <div class="text-content">Ping the ops channel https://t.me/joinchat/xyz</div>
  <img class="avatar" src="https://web.telegram.org/a/avatar.jpg"/>
</div>
<div class="message-bubble">
  <div class="sender-name"><a href="https://t.me/alice_op">Alice Ops</a></div>
  <span class="time">Aug 7 at 12:01</span>
  <div class="text-content">Alice joined the group</div>
</div>
<div class="message-bubble" data-message-id="msg-77">
  <a href="https://t.me/anon_handle" class="pfp-link"></a>
  <span class="time">Aug 7 at 12:05</span>
  <div class="text-content">anon body, no visible sender name</div>
</div>`;

describe('TG_MESSAGE_SCRIPT against a captured message DOM', () => {
  it('extracts messageId, handle, profile URL, timestamp, links, and the (remote) avatar SRC', () => {
    document.body.innerHTML = MESSAGES_HTML;
    const msgs = runInPage<RawMessage[]>(TG_MESSAGE_SCRIPT);
    // Three visible bubbles, each carrying text → all three captured.
    expect(msgs).toHaveLength(3);

    const m = msgs[0];
    expect(m.messageId).toBe('msg-42');
    expect(m.authorUsername).toBe('@jane_op');
    expect(m.authorProfileUrl).toBe('https://t.me/jane_op');
    expect(m.timestamp).toBe('Aug 7 at 11:59');
    expect(m.chat).toBe('Operators Group');
    // links() pulled the t.me invite out of the visible body, deduped.
    expect(m.links).toContain('https://t.me/joinchat/xyz');
    // The in-page script returns the REMOTE avatar SRC verbatim; host-restricted
    // resolution to a data: thumbnail is the collector's job (and normalize drops remote).
    expect(m.avatar).toBe('https://web.telegram.org/a/avatar.jpg');
    // An ordinary message carries no service-event marker.
    expect(m.eventType).toBe('');
  });

  it('flags a service line (join/leave/pin) via the eventType regex', () => {
    document.body.innerHTML = MESSAGES_HTML;
    const msgs = runInPage<RawMessage[]>(TG_MESSAGE_SCRIPT);
    const service = msgs.find((x) => x.text.includes('joined the group'));
    expect(service).toBeTruthy();
    expect(service!.eventType).toBe('SERVICE EVENT');
  });

  it('derives the handle from the profile anchor href when no sender name is shown — display name left blank', () => {
    document.body.innerHTML = MESSAGES_HTML;
    const anon = runInPage<RawMessage[]>(TG_MESSAGE_SCRIPT).find((x) => x.messageId === 'msg-77');
    expect(anon).toBeTruthy();
    // A `t.me/anon_handle` profile anchor yields the handle even with no sender node…
    expect(anon!.authorUsername).toBe('@anon_handle');
    // …and the display name is NOT fabricated (no visible sender name → '').
    expect(anon!.author).toBe('');
  });

  it('feeds normalizeMessage end-to-end — honesty stamps survive, the remote avatar is DROPPED', () => {
    document.body.innerHTML = MESSAGES_HTML;
    const raw = runInPage<RawMessage[]>(TG_MESSAGE_SCRIPT)[0];
    const item = normalizeMessage(raw, CTX);
    expect(item.verified).toBe(false);
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.platform).toBe('telegram');
    expect(item.authorHandle).toBe('@jane_op');
    expect(item.authorDisplay).toBe('Jane Doe');
    // The remote avatar SRC never survives storage (data:-only filter).
    expect(item.avatar).toBeUndefined();

    const anonRaw = runInPage<RawMessage[]>(TG_MESSAGE_SCRIPT).find((x) => x.messageId === 'msg-77')!;
    // Honesty: an unobserved display name is OMITTED, never backfilled from the @handle.
    expect(normalizeMessage(anonRaw, CTX).authorDisplay).toBeUndefined();
  });
});

// ---- TG_MEMBER_SCRIPT against a captured member list DOM --------------

const MEMBERS_HTML = `
<h2 class="chat-title">Operators Group</h2>
<div class="members-list">
  <div class="ListItem">
    <img class="avatar" src="https://web.telegram.org/a/al.jpg"/>
    <div class="name">Alice Ops</div>
    <div class="username">@alice_op</div>
    <div class="status">admin · online</div>
  </div>
  <div class="ListItem">
    <div class="username">@bob_op</div>
    <div class="status">last seen recently</div>
  </div>
</div>`;

describe('TG_MEMBER_SCRIPT against a captured member-list DOM', () => {
  it('extracts handle, display name, status, and the (remote) avatar SRC from a full row', () => {
    document.body.innerHTML = MEMBERS_HTML;
    const members = runInPage<RawMember[]>(TG_MEMBER_SCRIPT);
    const alice = members.find((x) => x.username === '@alice_op');
    expect(alice).toBeTruthy();
    expect(alice!.displayName).toBe('Alice Ops');
    expect(alice!.context).toBe('Operators Group');
    expect(alice!.profileUrl).toBe('https://t.me/alice_op');
    expect(alice!.status).toContain('admin');
    expect(alice!.avatar).toBe('https://web.telegram.org/a/al.jpg');
  });

  it('records an ABSENT member display name honestly — never the @handle', () => {
    document.body.innerHTML = MEMBERS_HTML;
    const bob = runInPage<RawMember[]>(TG_MEMBER_SCRIPT).find((x) => x.username === '@bob_op');
    expect(bob).toBeTruthy();
    // The only non-@ line ("last seen recently") is excluded by the status filter → ''.
    expect(bob!.displayName).toBe('');
    expect(bob!.displayName).not.toBe('bob_op');
    expect(bob!.displayName).not.toBe('@bob_op');
  });

  it('feeds normalizeMember end-to-end — remote avatar dropped, absent name omitted', () => {
    document.body.innerHTML = MEMBERS_HTML;
    const members = runInPage<RawMember[]>(TG_MEMBER_SCRIPT);
    const aliceRaw = members.find((x) => x.username === '@alice_op')!;
    const bobRaw = members.find((x) => x.username === '@bob_op')!;

    const alice = normalizeMember(aliceRaw, { capturedAt: '2026-08-07T12:00:00.000Z' });
    expect(alice.handle).toBe('@alice_op');
    expect(alice.displayName).toBe('Alice Ops');
    expect(alice.avatar).toBeUndefined(); // remote SRC dropped

    const bob = normalizeMember(bobRaw, { capturedAt: '2026-08-07T12:00:00.000Z' });
    expect(bob.handle).toBe('@bob_op');
    expect(bob.displayName).toBeUndefined(); // unobserved name omitted, not the @handle
  });
});

// ---- TG_PROFILE_SCRIPT against a captured profile-panel DOM -----------

const PROFILE_HTML = `
<h2 class="chat-title">Operators Group</h2>
<div class="profile-panel">
  <img class="avatar" src="https://web.telegram.org/a/jane.jpg"/>
  <div class="name">Jane Doe</div>
  <div class="username">@jane_op</div>
  <div class="bio">Threat intel — opinions my own</div>
  <div class="status">last seen recently</div>
</div>`;

describe('TG_PROFILE_SCRIPT against a captured profile-panel DOM', () => {
  it('extracts the visible display name, handle, status, and the (remote) avatar SRC', () => {
    document.body.innerHTML = PROFILE_HTML;
    const profile = runInPage<RawProfile | null>(TG_PROFILE_SCRIPT);
    expect(profile).not.toBeNull();
    expect(profile!.username).toBe('@jane_op');
    expect(profile!.displayName).toBe('Jane Doe');
    expect(profile!.profileUrl).toBe('https://t.me/jane_op');
    expect(profile!.status).toContain('last seen');
    expect(profile!.bio).toContain('Threat intel');
    expect(profile!.avatar).toBe('https://web.telegram.org/a/jane.jpg');
  });

  it('feeds normalizeProfile end-to-end — creation date ALWAYS unavailable, remote avatar dropped', () => {
    document.body.innerHTML = PROFILE_HTML;
    const raw = runInPage<RawProfile>(TG_PROFILE_SCRIPT);
    const p = normalizeProfile(raw, { capturedAt: '2026-08-07T12:00:00.000Z' });
    expect(p.handle).toBe('@jane_op');
    expect(p.displayName).toBe('Jane Doe');
    // Honesty: Telegram Web exposes no reliable creation date — never inferred.
    expect(p.accountCreationDate).toBeNull();
    expect(p.accountCreationLabel).toContain('Unavailable');
    // The remote avatar SRC never survives storage (data:-only filter).
    expect(p.avatar).toBeUndefined();
  });

  it('returns null when no user panel is visible (no fabricated profile)', () => {
    document.body.innerHTML = '<div class="profile-panel">Just some group settings text here</div>';
    const profile = runInPage<RawProfile | null>(TG_PROFILE_SCRIPT);
    expect(profile).toBeNull();
  });
});
