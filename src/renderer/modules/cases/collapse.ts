/**
 * Per-category collapse state for the My Cases sidebar, persisted in
 * AppSettings.caseCategoryCollapsed. An ABSENT category key resolves to
 * collapsed (true) — fresh profiles and newly created categories start closed
 * ("closed by default"); an explicit `false` means the user expanded it.
 */
export type CollapseMap = Record<string, boolean>;

export function resolveCollapsed(map: CollapseMap, name: string): boolean {
  return map[name] ?? true;
}

/** Returns a NEW map with `name` flipped relative to its resolved state. */
export function toggleCollapsed(map: CollapseMap, name: string): CollapseMap {
  return { ...map, [name]: !resolveCollapsed(map, name) };
}
