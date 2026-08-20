/**
 * Builds a Leaflet map-popup element from UNTRUSTED feed content (RSS/Atom/GeoJSON
 * titles + links), using DOM nodes — never interpolated HTML strings. The title is set
 * via textContent (no HTML parsing, so markup in a feed title cannot execute), and a link
 * is rendered only when it is a real http(s) URL, blocking javascript:/data:/other schemes.
 * Returns an HTMLElement, which Leaflet's bindPopup accepts directly.
 *
 * Security: feed content is remote/attacker-controllable; this is the XSS choke point for
 * map popups. Kept in its own module so it is unit-testable without loading Leaflet.
 */
export function buildPopup(title: string, link?: string): HTMLElement {
  const root = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = title;
  root.appendChild(b);
  if (link) {
    try {
      const u = new URL(link);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        root.appendChild(document.createElement('br'));
        const a = document.createElement('a');
        a.href = u.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'open';
        root.appendChild(a);
      }
    } catch {
      /* not a parseable URL — omit the link entirely */
    }
  }
  return root;
}

/**
 * Defer a popup's DOM construction until it is first opened.
 *
 * Markers are DOM elements, one per item, and a Popup was previously built for every marker with its
 * content constructed up front — although at most one popup is ever open. At a few hundred located
 * events that is a few hundred subtrees created and retained for nothing, and the cost scales exactly
 * with the item count the operator observed driving CPU (narrowing the timeline normalised it).
 *
 * Returns an idempotent opener: the content is built on the first call and reused thereafter.
 */
export function buildPopupLazily(build: () => HTMLElement): () => HTMLElement {
  let content: HTMLElement | null = null;
  return () => {
    if (!content) content = build();
    return content;
  };
}
