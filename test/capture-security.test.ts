import { describe, it, expect, vi } from 'vitest';

import {
  guardExternalUrl,
  csvCell,
  escapeField,
  remoteMediaToDataUri
} from '../src/main/capture/security';

describe('guardExternalUrl', () => {
  it('rejects a javascript: scheme', () => {
    expect(guardExternalUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects a file: scheme', () => {
    expect(guardExternalUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects a data: scheme (only http/https pass through)', () => {
    expect(guardExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects an unparseable string', () => {
    expect(guardExternalUrl('not a url at all')).toBeNull();
  });

  it('returns an https URL unchanged', () => {
    expect(guardExternalUrl('https://t.me/x')).toBe('https://t.me/x');
  });

  it('returns an http URL unchanged', () => {
    expect(guardExternalUrl('http://example.com/a')).toBe('http://example.com/a');
  });
});

describe('csvCell', () => {
  it('neutralizes a leading = formula with an apostrophe prefix inside the quoted cell', () => {
    const c = csvCell('=HYPERLINK("x")');
    // The cell is quote-wrapped; the very first content char is the guard apostrophe.
    expect(c.startsWith('"')).toBe(true);
    expect(c.slice(1).startsWith("'=")).toBe(true);
    // A spreadsheet must never see a bare leading '=' — the raw formula head is neutralized.
    expect(c.startsWith('"=')).toBe(false);
  });

  it('guards every dangerous lead char (= + - @ tab CR)', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const c = csvCell(`${lead}danger`);
      expect(c.slice(1).startsWith(`'${lead}`)).toBe(true);
    }
  });

  it('leaves an ordinary value unchanged but quotes it', () => {
    expect(csvCell('bio')).toBe('"bio"');
  });

  it('doubles interior quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('does not guard a value whose dangerous char is not first', () => {
    expect(csvCell('a=b')).toBe('"a=b"');
  });
});

describe('escapeField', () => {
  it('HTML-escapes & < > in order', () => {
    expect(escapeField('<b>&')).toBe('&lt;b&gt;&amp;');
  });

  it('escapes quotes and apostrophes', () => {
    expect(escapeField(`"'`)).toBe('&quot;&#039;');
  });

  it('does not double-escape an ampersand it just introduced', () => {
    expect(escapeField('a < b')).toBe('a &lt; b');
  });
});

describe('remoteMediaToDataUri', () => {
  const mkWin = (impl: (js: string) => Promise<unknown>) =>
    ({ webContents: { executeJavaScript: vi.fn((js: string) => impl(js)) } });

  it('returns a data: URI produced inside the capture page', async () => {
    const win = mkWin(() => Promise.resolve('data:image/png;base64,AAAA'));
    const out = await remoteMediaToDataUri(win, 'https://pbs.twimg.com/a.png');
    expect(out).toBe('data:image/png;base64,AAAA');
  });

  it('never returns a remote http result even if the page hands one back', async () => {
    const win = mkWin(() => Promise.resolve('http://evil.example/x.png'));
    const out = await remoteMediaToDataUri(win, 'https://pbs.twimg.com/a.png');
    expect(out).toBeNull();
  });

  it('returns null when the page fetch fails', async () => {
    const win = mkWin(() => Promise.resolve(null));
    const out = await remoteMediaToDataUri(win, 'https://pbs.twimg.com/a.png');
    expect(out).toBeNull();
  });

  it('refuses an OFF-HOST media URL — no page fetch, returns null (deanon beacon guard)', async () => {
    const exec = vi.fn(() => Promise.resolve('data:image/png;base64,AAAA'));
    const win = { webContents: { executeJavaScript: exec } };
    const out = await remoteMediaToDataUri(win, 'https://evil.example/profile_images/beacon.png');
    expect(out).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it('allows the X media CDN hosts (pbs/abs.twimg.com, x.com, twitter.com)', async () => {
    for (const url of [
      'https://pbs.twimg.com/media/a.jpg',
      'https://abs.twimg.com/b.png',
      'https://x.com/c.png',
      'https://twitter.com/d.png'
    ]) {
      const exec = vi.fn(() => Promise.resolve('data:image/png;base64,AAAA'));
      const win = { webContents: { executeJavaScript: exec } };
      const out = await remoteMediaToDataUri(win, url);
      expect(out).toBe('data:image/png;base64,AAAA');
      expect(exec).toHaveBeenCalledOnce();
    }
  });

  it('returns null and never runs page JS for a non-http(s) scheme', async () => {
    const exec = vi.fn(() => Promise.resolve('data:whatever'));
    const win = { webContents: { executeJavaScript: exec } };
    const out = await remoteMediaToDataUri(win, 'javascript:alert(1)');
    expect(out).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes the URL into the page as a JSON-encoded literal (no raw interpolation)', async () => {
    let seenJs = '';
    const win = mkWin((js) => {
      seenJs = js;
      return Promise.resolve('data:image/png;base64,AAAA');
    });
    await remoteMediaToDataUri(win, 'https://pbs.twimg.com/a.png?x=1&y=2');
    expect(seenJs).toContain(JSON.stringify('https://pbs.twimg.com/a.png?x=1&y=2'));
  });

  it('returns null when executeJavaScript throws', async () => {
    const win = mkWin(() => Promise.reject(new Error('page gone')));
    const out = await remoteMediaToDataUri(win, 'https://pbs.twimg.com/a.png');
    expect(out).toBeNull();
  });
});
