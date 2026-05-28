// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../src/renderer/lib/sanitizeHtml';

describe('sanitizeHtml — XSS stripping', () => {
  it('removes script tags and inline event handlers', () => {
    const out = sanitizeHtml('<p onclick="steal()">hi</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('hi');
  });
  it('removes iframe/object/embed/form', () => {
    const out = sanitizeHtml('<iframe src="x"></iframe><object data="x"></object><embed src="x"><form></form>');
    expect(out).not.toMatch(/<iframe|<object|<embed|<form/i);
  });
  it('neutralizes javascript: hrefs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe('sanitizeHtml — no-egress (the load-bearing guarantee)', () => {
  it('strips remote <img src> so the fragment makes zero network requests', () => {
    const out = sanitizeHtml('<img src="https://evil.example/track.gif">');
    expect(out).not.toMatch(/https:\/\/evil\.example/);
    expect(out).not.toMatch(/src=/i);
  });
  it('strips srcset and background remote refs', () => {
    const out = sanitizeHtml('<img srcset="https://evil/x 1x"><div background="https://evil/y"></div>');
    expect(out).not.toMatch(/evil/);
  });
  it('keeps inline data:image sources', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const out = sanitizeHtml(`<img src="${data}">`);
    expect(out).toContain(data);
  });
  it('rewrites http(s) anchors to href="#" + data-external (routed via OS browser, no in-app nav)', () => {
    const out = sanitizeHtml('<a href="https://example.com/page">link</a>');
    expect(out).toMatch(/data-external="https:\/\/example\.com\/page"/);
    expect(out).toMatch(/href="#"/);
  });
  it('drops href on <link>', () => {
    const out = sanitizeHtml('<link rel="stylesheet" href="https://evil/style.css">');
    expect(out).not.toMatch(/evil/);
  });
});
