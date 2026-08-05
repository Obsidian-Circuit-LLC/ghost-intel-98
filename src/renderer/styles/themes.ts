export interface ThemeDef { id: string; label: string; description: string; }
export const THEMES: ThemeDef[] = [
  { id: 'classic',  label: 'Classic',        description: 'The original teal-and-grey Ghost Intel 98 look.' },
  { id: 'amethyst', label: 'QUIET AMETHYST', description: 'Near-black midnight-purple compartment skin with a single glowing accent.' },
];
export const DEFAULT_THEME = 'classic';
export function isKnownTheme(id: string): boolean { return THEMES.some((t) => t.id === id); }
export function resolveTheme(id: string | undefined): string { return id && isKnownTheme(id) ? id : DEFAULT_THEME; }

/**
 * LOCKED status/honesty tokens (Amendment 2, 2026-08-05). These are theme-AWARE but LOCKED:
 * defined in EVERY built-in theme block (base `:root` for classic + each skin's override block)
 * with legible, hue-consistent, contrast-gated values per surface — and excluded from any future
 * user-pack loader. That exclusion is the charter guarantee: a user skin can never recolour or
 * hide a status colour or an honesty stamp. The list is the 4 status FOREGROUND tokens + their 4
 * FILL counterparts (white-text chips/toast title-bars) + the 2 self-contained honesty tokens.
 */
export const LOCKED_TOKENS = [
  '--ga98-status-error',
  '--ga98-status-success',
  '--ga98-status-warning',
  '--ga98-status-info',
  '--ga98-status-error-fill',
  '--ga98-status-success-fill',
  '--ga98-status-warning-fill',
  '--ga98-status-info-fill',
  '--ga98-unverified',
  '--ga98-unverified-ink',
] as const;
