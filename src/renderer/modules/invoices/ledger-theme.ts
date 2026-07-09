/** Ghost Ledger 98 midnight-purple palette + a WCAG contrast guard. The palette lives here (not only
 *  in CSS) so a unit test can prove every text/surface pair meets AA — readability is a requirement. */
export const LEDGER = {
  base: '#1a0f2e',   // module background
  panel: '#241539',  // fieldsets / table header
  inset: '#12081f',  // input fills
  text: '#ece6f7',   // lavender-white body text
  accent: '#7c4dff', // violet accent / focus
  border: '#5a3aa8', // violet borders
} as const;

/** WCAG relative luminance of an #rrggbb color. */
export function relLum(hex: string): number {
  const n = hex.replace('#', '');
  const c = [0, 2, 4]
    .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** WCAG contrast ratio (1..21), order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
