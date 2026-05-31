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
