/**
 * Resolving a display picture in the embedded station.
 *
 * THE BUG THIS EXISTS TO FIX (shipped in v3.73.0): GhostExodus's model stores an avatar as the
 * REMOTE URL his scraper read off the page — `img[src*="profile_images"]` → `src`. The v3.73.0
 * handler handed that value straight to `readCachedMedia`, whose first line is
 * `if (!MEDIA_REF_RE.test(ref)) return null` with `MEDIA_REF_RE = /^x-media\/[0-9a-f]{64}$/`. A
 * remote URL never matches, so every avatar resolved to null and the station could not display a
 * picture at all, on any machine.
 *
 * It is the sixth failure of this one feature, and the first caused by porting his model correctly
 * and then breaking the READ path by assuming our own ref format. Both directions are now pinned by
 * tests.
 *
 * Localisation is a charter requirement, not a nicety: remote media is never inlined into the UI.
 * A remote URL is host-anchored to the media allowlist, fetched through the X session window (the
 * same Tor-gated partition the capture uses — no window means no fetch, fail closed), written to
 * the encrypted media cache, and the LOCAL ref is handed back so the caller can write it onto his
 * records and never fetch it again.
 */
import { MEDIA_HOST_ALLOWLIST } from '../capture/security';

/** A ref that is already local — the shape `readCachedMedia` accepts. */
const LOCAL_REF_RE = /^x-media\/[0-9a-f]{64}$/;

export interface AvatarDeps {
  /** Read an already-cached local ref back as a data: URI. */
  readCached(caseId: string, ref: string): Promise<string | null>;
  /** Fetch + cache a remote URL through the hardened media path; null when it cannot be had. */
  cacheRemote(caseId: string, url: string): Promise<{ ref: string } | null>;
  /** Is there an X session window to route the fetch through? */
  hasSession(caseId: string): boolean;
}

export interface AvatarRequest {
  caseId: string;
  /** Whatever his record carries: a local ref, a remote URL, or nothing. */
  ref: string | undefined;
  /**
   * The URL his UI hands over — `getAvatarDataUrl(username, preferredUrl)` — read straight off the
   * page it is rendering. Tried FIRST, because it is the freshest thing anyone has: a row can be on
   * screen before its record carries an avatar at all, which is exactly when the stored-record-only
   * lookup returned null and the picture never appeared. It is scraped input, so it passes the same
   * host allowlist as everything else.
   */
  preferred?: string | undefined;
  /** Called with the LOCAL ref once a remote avatar has been localised, so it is fetched once. */
  onLocalised?: (localRef: string) => void;
}

/** True only for an http(s) URL whose host is on the media allowlist (exact host, not substring). */
function allowedRemote(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  // Anchored equality — a substring check would let `evil.com/?x=pbs.twimg.com` through, which is
  // the exact SSRF shape flagged in his source during the security review.
  if (!MEDIA_HOST_ALLOWLIST.includes(host)) return null;
  return url.toString();
}

export async function resolveAvatarDataUri(
  req: AvatarRequest,
  deps: AvatarDeps
): Promise<string | null> {
  const ref = String(req.ref ?? '').trim();
  const preferred = String(req.preferred ?? '').trim();

  // 1. Already localised — read it straight back, no egress at all.
  if (LOCAL_REF_RE.test(ref)) return deps.readCached(req.caseId, ref);

  // 2. Whatever remote URLs we have, freshest first. His UI's preferred URL beats the stored one
  //    because a row can be rendering before its record has an avatar; the stored value is the
  //    fallback, not the other way round.
  for (const candidate of [preferred, ref]) {
    if (!candidate) continue;
    const remote = allowedRemote(candidate);
    if (!remote) continue;

    // No session window means no Tor-gated partition to fetch through. Fail closed and let his UI
    // fall back to a monogram rather than reaching for the network some other way.
    if (!deps.hasSession(req.caseId)) return null;

    const cached = await deps.cacheRemote(req.caseId, remote);
    if (cached?.ref) {
      req.onLocalised?.(cached.ref);
      return deps.readCached(req.caseId, cached.ref);
    }
  }

  // 3. A stored local ref is still worth trying if the fetches came to nothing.
  if (ref && LOCAL_REF_RE.test(ref)) return deps.readCached(req.caseId, ref);
  return null;
}
