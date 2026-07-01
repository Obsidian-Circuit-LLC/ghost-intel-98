/**
 * Spec for opening the SEPARATE X / Twitter window from SOCMINT. X is clearnet-quarantine;
 * SOCMINT is Tor-routed. This opens the existing 'x' module — it never embeds it — so the
 * quarantine boundary stays intact (operator decision 2026-07-01).
 */
export interface XLaunchSpec { module: 'x'; title: 'X / Twitter'; props?: { caseId: string }; }

export function xLaunchSpec(caseId?: string): XLaunchSpec {
  const id = caseId?.trim();
  return id ? { module: 'x', title: 'X / Twitter', props: { caseId: id } }
            : { module: 'x', title: 'X / Twitter' };
}
