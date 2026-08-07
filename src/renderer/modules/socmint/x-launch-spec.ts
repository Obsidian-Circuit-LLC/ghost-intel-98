/**
 * Spec for opening the SEPARATE X Listening Station window from SOCMINT. X is
 * clearnet-quarantine; SOCMINT is Tor-routed. This opens the existing
 * 'x-listening-station' module — it never embeds it — so the quarantine boundary
 * stays intact (operator decision 2026-07-01; retargeted R1 2026-08-05).
 */
export interface XLaunchSpec { module: 'x-listening-station'; title: 'X Listening Station'; props?: { caseId: string }; }

export function xLaunchSpec(caseId?: string): XLaunchSpec {
  const id = caseId?.trim();
  return id ? { module: 'x-listening-station', title: 'X Listening Station', props: { caseId: id } }
            : { module: 'x-listening-station', title: 'X Listening Station' };
}
