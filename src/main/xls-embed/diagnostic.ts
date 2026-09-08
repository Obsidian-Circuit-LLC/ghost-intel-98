/**
 * A compact, pasteable account of what the station currently is.
 *
 * WHY THIS EXISTS. Three consecutive field reports of the same shape — "reverted back to not
 * scraping / no display pictures" — each investigated by reading code, each finding a real and
 * DIFFERENT defect (a store the embed never writes to; a missing post-navigation settle; a
 * superseded scraper). Three different causes behind one indistinguishable symptom means the
 * symptom cannot be diagnosed from a report, and the fourth report should not cost another round
 * of guessing.
 *
 * Two facts here are worth more than the rest:
 *
 *  - `with a picture` splits "the capture never saw a picture" from "the picture is stored and
 *    something downstream is not showing it". Those are opposite bugs with opposite fixes, and
 *    several releases have gone to the wrong one. A REMOTE reference means capture read it and the
 *    cache never localised it; zero of both means the scrape never saw it.
 *  - the version, because "reverted to a previous state" has a boring explanation this project has
 *    already hit once (v3.70.1, an installer that left a stale install in place) and nothing in the
 *    app has ever stated which build is running.
 *
 * Pure: no clock, no I/O, no electron. Everything it reports is passed in.
 */
import type { PersistedStationState } from './state-store';
import { activeCaseId, activeSettings } from './station-service';

export interface StationDiagnosticInput {
  /** The running build. */
  version: string;
  state: PersistedStationState;
  /** `connected` is the persisted auth COOKIE; `hasWindow` is an actual capture window for this
   *  campaign. They are not the same thing, and mistaking one for the other is a recorded trap. */
  session: { connected: boolean; hasWindow: boolean };
  tor: { connected: boolean; clearnetAcked: boolean };
}

/** Newest collection runs quoted in the report — enough to see a pattern, few enough to paste. */
const RUNS_SHOWN = 6;
/** A localised media reference (`x-media/<64 hex>`); anything else is still a remote URL. */
const LOCAL_MEDIA_REF = /^x-media\/[0-9a-f]{64}$/;

export function buildStationDiagnostic(input: StationDiagnosticInput): string {
  const s = input.state;
  const caseId = activeCaseId(s);
  const campaign = s.cases.find((c) => c.id === caseId);
  const lines: string[] = [];

  lines.push(`Ghost Intel 98 v${input.version} — X Listening Station diagnostic`);
  lines.push(`Campaign: ${campaign?.name ?? 'unknown'}`);
  lines.push(
    `X session — cookie: ${input.session.connected ? 'connected' : 'disconnected'} · ` +
      `capture window: ${input.session.hasWindow ? 'open' : 'none'}`,
  );
  lines.push(
    `Egress — Tor: ${input.tor.connected ? 'connected' : 'disconnected'} · ` +
      `clearnet opt-in: ${input.tor.clearnetAcked ? 'on' : 'off'}`,
  );

  // Images, per source, with the override resolved the way capture resolves it.
  const campaignImages = activeSettings(s).collectImages !== false;
  const sources = s.profiles.filter((p) => p.caseId === caseId);
  const imageBits = sources.map((p) => {
    const mode = p.imageMode ?? 'inherit';
    const effective = mode === 'on' ? true : mode === 'off' ? false : campaignImages;
    return `@${p.username} ${effective ? 'ON' : 'OFF'}${mode === 'inherit' ? '' : ` (${mode})`}`;
  });
  lines.push(
    `Images — campaign: ${campaignImages ? 'ON' : 'OFF'}` +
      (imageBits.length ? ` · ${imageBits.join(' · ')}` : ' · no sources'),
  );

  // The decisive counts.
  const posts = s.posts.filter((p) => p.caseId === caseId);
  const withPicture = posts.filter((p) => Boolean(p.avatar));
  const cached = withPicture.filter((p) => LOCAL_MEDIA_REF.test(String(p.avatar))).length;
  const remote = withPicture.length - cached;
  lines.push(`Findings: ${posts.length} · sources: ${sources.length}`);
  lines.push(
    `Findings with a picture: ${withPicture.length} of ${posts.length}` +
      (withPicture.length ? ` (${cached} cached, ${remote} not yet fetched)` : ''),
  );
  lines.push(
    `Follower/following rows: ${s.relationships.filter((r) => r.caseId === caseId).length} · ` +
      `entities: ${s.entities.filter((e) => e.caseId === caseId).length} · ` +
      `change events: ${s.changeEvents.filter((e) => e.caseId === caseId).length}`,
  );

  const runs = s.collectionRuns.filter((r) => r.caseId === caseId).slice(-RUNS_SHOWN).reverse();
  if (!runs.length) {
    lines.push('No collection runs recorded — nothing has attempted to collect in this campaign.');
  } else {
    lines.push(`Last ${runs.length} collection run(s), newest first:`);
    for (const r of runs) {
      lines.push(
        `  ${r.operation} @${r.username} — ${r.status} · observed=${r.observed} added=${r.added}` +
          ` passes=${r.passesCompleted}${r.stopReason ? ` · ${r.stopReason}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}
