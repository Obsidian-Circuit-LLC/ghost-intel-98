export interface ThemeDef { id: string; label: string; description: string; }
export const THEMES: ThemeDef[] = [
  { id: 'classic',  label: 'Classic',        description: 'The original teal-and-grey Ghost Intel 98 look.' },
  { id: 'amethyst', label: 'QUIET AMETHYST', description: 'Near-black midnight-purple compartment skin with a single glowing accent.' },
];
export const DEFAULT_THEME = 'classic';
export function isKnownTheme(id: string): boolean { return THEMES.some((t) => t.id === id); }
export function resolveTheme(id: string | undefined): string { return id && isKnownTheme(id) ? id : DEFAULT_THEME; }
