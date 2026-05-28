/**
 * Centralized, security-critical HTML sanitizer for the document viewer (DOCX / HTML / EML bodies).
 *
 * The renderer CSP allows img-src/media-src http(s), so an un-neutralized remote
 * <img>/<link>/<svg use>/srcset would beacon out — violating offline-first / no-egress.
 * This sanitizer therefore, beyond DOMPurify's XSS stripping:
 *  - removes every remote-loading attribute (src/srcset/poster/background/xlink:href) unless
 *    it is an inline `data:image/...` URI — so a sanitized fragment makes ZERO network requests;
 *  - drops href on <link>/<use> entirely;
 *  - rewrites anchors to href="#" + data-external so clicks route through the OS browser
 *    (see wireExternalLinks), never in-app navigation;
 *  - forbids inline `style` (can smuggle `url(remote)` background fetches) and event handlers.
 */
import DOMPurify from 'dompurify';

let hookInstalled = false;

function installHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    for (const attr of ['src', 'srcset', 'poster', 'background', 'xlink:href']) {
      if (el.hasAttribute(attr)) {
        const v = el.getAttribute(attr) ?? '';
        if (!/^data:image\//i.test(v)) el.removeAttribute(attr);
      }
    }
    const tag = el.tagName.toLowerCase();
    if ((tag === 'link' || tag === 'use') && el.hasAttribute('href')) el.removeAttribute('href');
    if (tag === 'a' && el.hasAttribute('href')) {
      const href = el.getAttribute('href') ?? '';
      if (/^https?:/i.test(href)) {
        el.setAttribute('data-external', href);
        el.setAttribute('href', '#');
        el.setAttribute('rel', 'noopener noreferrer');
        el.removeAttribute('target');
      } else {
        el.removeAttribute('href');
      }
    }
  });
}

export function sanitizeHtml(dirty: string): string {
  installHook();
  return DOMPurify.sanitize(dirty, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link', 'style'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseenter', 'onfocus'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-external'],
    USE_PROFILES: { html: true, svg: true }
  });
}

/** Route clicks on sanitized anchors (rewritten to href="#" + data-external) through the OS browser. */
export function wireExternalLinks(container: HTMLElement): (e: MouseEvent) => void {
  const handler = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement | null)?.closest('a[data-external]');
    if (a) {
      e.preventDefault();
      const url = a.getAttribute('data-external');
      if (url) void window.api.system.openExternal(url);
    }
  };
  container.addEventListener('click', handler);
  return handler;
}
