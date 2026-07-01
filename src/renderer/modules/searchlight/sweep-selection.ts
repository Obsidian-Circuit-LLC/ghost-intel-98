/**
 * Pure resolver for which sweep job the Sweep panel should display.
 *
 * selectedJobId is a single value in the store, but it must be interpreted against
 * the ACTIVE case: a pointer left over from a previously-active case must not blank
 * the panel. This returns the id to select — the existing selection when it belongs
 * to the current case, otherwise the case's most recent sweep, otherwise null.
 */
export function resolveSweepSelection(
  searches: { id: string }[],
  selectedJobId: string | null,
): string | null {
  if (selectedJobId && searches.some((s) => s.id === selectedJobId)) return selectedJobId;
  const last = searches[searches.length - 1];
  return last ? last.id : null;
}
