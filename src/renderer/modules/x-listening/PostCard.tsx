/**
 * X Listening Station — rich PostCard (Task I1).
 *
 * The single, extracted card reused by every feed surface (Dashboard RECENT CAPTURES, LIVE FEED,
 * SEARCH results). Enterprise v3.4.1 PostCard anatomy — reskinned onto the two-tier `--ga98-*`
 * palette (classic + QUIET AMETHYST) and rebuilt onto the hardened GI98 seams:
 *
 *   author avatar (LOCAL avatar data-URI / initial fallback) · display name · @handle · kind tag ·
 *   "VIA @source" (monitored indirectly) · timestamp · preset MATCH rows · post text with preset
 *   highlighting · a media strip of ≤3 LOCAL thumbnails (resolved via the `mediaRead` channel,
 *   "MEDIA NOT RETRIEVED" fallback — never a remote URL) · a metrics row (metricsRaw where present,
 *   derived integer otherwise) · a provenance row (FIRST/LAST observed, availability badge, short
 *   per-post SHA-256) · actions — OPEN REAL THREAD (E1 `openInX('thread')`, Tor-gated MAIN-side),
 *   VERIFY LIVE (A1 `verifyPost` — HIDDEN for a synthetic/demo record) and an ANALYST NOTES toggle
 *   that opens an inline note list with add / edit / delete over the existing notes IPC.
 *
 * Hardening preserved: media is rendered ONLY from local `mediaRefs` via `mediaRead` (no remote
 * fetch, no broken-image); open-in-X + verify are delegated to the caller's Tor-gated handlers;
 * synthetic records never expose VERIFY LIVE. Defensive throughout (optional-chain, guarded IPC),
 * reduced-motion-safe, ADHD-friendly (one-click actions, immediate per-card busy feedback).
 *
 * Renderer-quarantine clean: imports only renderer-owned TYPES (`XPostRow`/`XNoteRow`) from the
 * module — never `src/main/**`. Type-only imports are erased at build time, so there is no runtime
 * import cycle with the module that renders this component.
 */
import { Fragment, useEffect, useState } from 'react';
import { displayXHandle } from '@shared/x-listening-source';
import type { XPostRow, XNoteRow } from './XListeningModule';

const POST_KIND_LABEL: Record<XPostRow['kind'], string> = {
  post: 'POST',
  reply: 'REPLY',
  repost: 'REPOST',
  comment: 'COMMENT',
};

function formatMetric(n: number | undefined): string {
  if (n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n);
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Case-insensitive, regex-safe preset highlighting. Splits on a single capture group so matched
 *  spans land on odd indices (no stateful `lastIndex` re-test). Escapes every term — an untrusted
 *  search string can never form a catastrophic pattern. */
function highlight(text: string, terms: readonly string[] | undefined): React.ReactNode {
  const clean = (terms ?? []).map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return text;
  const escaped = clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark className="xls-hl" key={i}>
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * Resolve ONE cached LOCAL media ref (media.ts `cacheRemoteMedia`) to a displayable `data:` URI on
 * demand via the real `mediaRead` channel — the renderer never receives raw vault bytes, only what
 * the channel hands back. A pending/missed ref (malformed, locked vault, not-yet-cached, or a
 * minimal harness lacking the channel) renders "MEDIA NOT RETRIEVED", never a broken-image icon or
 * a remote fetch. Ported from the Enterprise `MediaThumb` fallback (main.tsx:138-142).
 */
export function XPostMediaThumb({ caseId, mediaRef }: { caseId: string; mediaRef: string }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Defensive: a minimal harness may lack the channel — guard before the real call, but keep
        // the literal `window.api.xListening.mediaRead(...)` call site (the whole-module seam test
        // scans for it). Renders "MEDIA NOT RETRIEVED" when the channel is absent or returns null.
        if (typeof window.api?.xListening?.mediaRead !== 'function') return;
        const dataUri = await window.api.xListening.mediaRead({ caseId, ref: mediaRef });
        if (active) setSrc(dataUri ?? null);
      } catch (err) {
        if (active) console.warn('[XListening] mediaRead:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [caseId, mediaRef]);
  if (!src) return <div className="xls-media-missing">MEDIA NOT RETRIEVED</div>;
  return <img className="xls-media-thumb" src={src} alt="Archived X media" />;
}

export interface PostCardProps {
  post: XPostRow;
  /** Active campaign id — required to resolve LOCAL media thumbs via `mediaRead`. */
  caseId: string;
  /** Analyst notes attached to THIS post (findingId === post.id). M11: unbounded per post —
   *  the inline panel appends new notes and edits/deletes each one independently by note id. */
  notes: XNoteRow[];
  /** This post is mid-verification (VERIFY LIVE) — disables its button. */
  verifying?: boolean;
  /** OPEN REAL THREAD — the caller wires this to the Tor-gated `openInX('thread', post.url)`. */
  onOpenThread: (post: XPostRow) => void;
  /** VERIFY LIVE — the caller wires this to A1's `verifyPost`. Never shown for a synthetic post. */
  onVerify: (postId: string) => void;
  /** APPEND a new analyst note to this post (M11) through the notes IPC. */
  onAddNote: (findingId: string, text: string) => Promise<void> | void;
  /** EDIT one existing analyst note in place, by note id (M11). */
  onUpdateNote: (noteId: string, text: string) => Promise<void> | void;
  /** Delete one analyst note through the notes IPC, by note id (M11). */
  onDeleteNote: (noteId: string) => Promise<void> | void;
  /** Preset keywords to highlight in the post text (Search passes the active query). */
  highlightTerms?: string[];
  /** Names of highlight presets that matched this post → rendered as MATCH rows. */
  presetNames?: string[];
}

/** Stable key for a note: its own id, or (a legacy record's) findingId. Mirrors the store's
 *  `xNoteKey` — a pre-M11 note held at most one per finding, so `findingId` is a safe key. */
function noteKey(note: XNoteRow): string {
  return note.id ?? note.findingId;
}

export function PostCard({
  post,
  caseId,
  notes,
  verifying = false,
  onOpenThread,
  onVerify,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  highlightTerms,
  presetNames,
}: PostCardProps): JSX.Element {
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // M11: which note is mid-edit (by note id) — many notes per post, each edited independently.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);

  const kind = post.kind;
  const kindLabel = POST_KIND_LABEL[kind] ?? String(kind).toUpperCase();
  // `authorHandle` is stored WITH its '@' (extract.ts), but handles also reach the UI bare from other
  // layers — so format idempotently rather than assuming a convention. Prefixing a second '@' is what
  // rendered "@@ADanielHill" in the field A/B against his build.
  const handleLabel = displayXHandle(post.authorHandle);
  const displayName = post.displayName || handleLabel;
  // "VIA @source": the post surfaced through a monitored source (channelId/sourceUsername) whose
  // handle differs from the actual author — the indirect-observation marker (Enterprise parity).
  const rawSource = (post.sourceUsername ?? post.channelId ?? '').replace(/^@+/, '').trim();
  const monitoredVia =
    !!rawSource && rawSource.toLowerCase() !== String(post.authorHandle ?? '').toLowerCase();

  const firstObserved = post.firstObservedAt ?? post.publishedAt;
  const lastObserved = post.lastObservedAt ?? post.verifiedAt ?? post.harvestedAt ?? post.publishedAt;
  const availability = post.availability; // 'available' | 'unavailable' | undefined
  const availabilityLabel = availability ? availability.toUpperCase() : 'OBSERVED';
  const shortHash = post.evidenceHash ? `${post.evidenceHash.slice(0, 10)}…` : '—';

  const metrics = post.metrics;
  const metricsRaw = post.metricsRaw;
  const metricCell = (raw: string | undefined, derived: number | undefined): string =>
    raw && raw.trim() ? raw : formatMetric(derived);

  const avatarSrc = post.avatar && post.avatar.startsWith('data:') ? post.avatar : null;
  // The monogram must be the ACCOUNT's initial, not the '@' — taking charAt(0) of the stored handle
  // put an '@' in every avatar-less card (visible in his A/B video).
  const initial = (String(post.authorHandle ?? '').replace(/^@+/, '') || '?').charAt(0).toUpperCase();

  const mediaRefs = (post.mediaRefs ?? []).slice(0, 3);

  const addNote = async () => {
    const text = draft.trim();
    if (!text) return;
    setNoteBusy(true);
    try {
      await onAddNote(post.id, text);
      setDraft('');
    } finally {
      setNoteBusy(false);
    }
  };
  const saveEdit = async (noteId: string) => {
    const text = editingText.trim();
    if (!text) return;
    setNoteBusy(true);
    try {
      await onUpdateNote(noteId, text);
      setEditingId(null);
      setEditingText('');
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <article className={`xls-post-card xls-kind-${kind}`} key={post.id}>
      <div className="xls-post-head">
        <div className="xls-post-avatar" aria-hidden="true">
          {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{initial}</span>}
        </div>
        <div className="xls-post-identity">
          <strong className="xls-post-displayname">{displayName}</strong>
          <span className="xls-post-username">{handleLabel}</span>
          <span className="xls-kind">{kindLabel}</span>
          {monitoredVia && <span className="xls-via">VIA @{rawSource}</span>}
          {post.synthetic && <span className="xls-marker xls-marker-demo">DEMO</span>}
        </div>
        <time className="xls-post-time">{formatWhen(post.publishedAt)}</time>
      </div>

      {(presetNames?.length ?? 0) > 0 && (
        <div className="xls-preset-match-row">
          {presetNames!.map((name) => (
            <span className="xls-preset-match" key={name}>
              MATCH: {name}
            </span>
          ))}
        </div>
      )}

      <p className="xls-post-text">{highlight(post.text ?? '', highlightTerms)}</p>

      {mediaRefs.length > 0 && (
        <div className="xls-media-strip">
          {mediaRefs.map((ref, i) => (
            <XPostMediaThumb key={`${post.id}-${ref}-${i}`} caseId={caseId} mediaRef={ref} />
          ))}
        </div>
      )}

      <div className="xls-metrics">
        <span title="Replies">↩ {metricCell(metricsRaw?.replies, metrics?.replies)}</span>
        <span title="Reposts">⟳ {metricCell(metricsRaw?.reposts, metrics?.reposts)}</span>
        <span title="Likes">♥ {metricCell(metricsRaw?.likes, metrics?.likes)}</span>
        <span title="Views">◉ {metricCell(metricsRaw?.views, metrics?.views)}</span>
      </div>

      <div className="xls-provenance-row">
        <span>FIRST {formatWhen(firstObserved)}</span>
        <span>LAST {formatWhen(lastObserved)}</span>
        <span
          className={`xls-availability xls-availability-${availability ?? 'observed'}`}
          title="Live-verification state — OBSERVED until VERIFY LIVE re-checks the original URL."
        >
          {availabilityLabel}
        </span>
        <span className="xls-stamp" title={post.evidenceHash}>
          SHA-256 {shortHash}
        </span>
      </div>

      <div className="xls-post-actions">
        <div className="xls-post-buttons">
          {/* Synthetic/demo records expose NO network-window action (spec Global Constraint: "no
              network window for demo"). Both OPEN REAL THREAD and VERIFY LIVE — the two actions that
              reach x.com over Tor — are gated on !synthetic; the demo-URL format is only a
              defence-in-depth backstop, never the primary gate. Local-only actions (notes) stay. */}
          {!post.synthetic && (
            <button
              type="button"
              className="xls-btn"
              title="Open this post's real X thread in a hardened Tor-gated in-app window."
              onClick={() => onOpenThread(post)}
            >
              OPEN REAL THREAD
            </button>
          )}
          {!post.synthetic && (
            <button
              type="button"
              className="xls-btn"
              disabled={verifying}
              title="Re-open this post's real X URL over Tor and check whether it still exists or was edited."
              onClick={() => onVerify(post.id)}
            >
              {verifying ? 'VERIFYING…' : 'VERIFY LIVE'}
            </button>
          )}
          <button
            type="button"
            className="xls-text-button"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((v) => !v)}
          >
            {notesOpen ? 'HIDE ANALYST NOTES' : `ANALYST NOTES (${notes.length})`}
          </button>
        </div>
        {post.url && (
          <span className="xls-post-permalink" title={post.url}>
            {post.url}
          </span>
        )}
      </div>

      {notesOpen && (
        <div className="xls-notes-inline">
          <div className="xls-note-list">
            {notes.map((note) => {
              const key = noteKey(note);
              return (
                <article className="xls-note-entry" key={key}>
                  {editingId === key ? (
                    <>
                      <textarea
                        className="xls-input"
                        aria-label="Edit analyst note"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                      />
                      <div className="xls-note-actions">
                        <button
                          type="button"
                          className="xls-btn xls-btn-primary"
                          disabled={noteBusy || !editingText.trim()}
                          onClick={() => void saveEdit(key)}
                        >
                          SAVE EDIT
                        </button>
                        <button
                          type="button"
                          className="xls-btn"
                          onClick={() => {
                            setEditingId(null);
                            setEditingText('');
                          }}
                        >
                          CANCEL
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="xls-note-body">{note.text}</p>
                      <div className="xls-note-meta">
                        <span className="xls-count">UPDATED {formatWhen(note.savedAt)}</span>
                        <div className="xls-note-actions">
                          <button
                            type="button"
                            className="xls-text-button"
                            onClick={() => {
                              setEditingId(key);
                              setEditingText(note.text);
                            }}
                          >
                            EDIT
                          </button>
                          <button
                            type="button"
                            className="xls-text-button xls-danger-text"
                            disabled={noteBusy}
                            onClick={() => void onDeleteNote(key)}
                          >
                            DELETE
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
            {notes.length === 0 && (
              <div className="xls-empty">No investigative notes attached to this record.</div>
            )}
          </div>
          {/* M11: the composer is ALWAYS available — a post carries unbounded notes (his
              multi-note model), so a new note appends rather than replacing the prior one. */}
          <div className="xls-note-compose">
            <textarea
              className="xls-input"
              aria-label="Add analyst note"
              placeholder="Assessment, source caveat, verification step, or follow-up action…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="button"
              className="xls-btn xls-btn-primary"
              disabled={noteBusy || !draft.trim()}
              onClick={() => void addNote()}
            >
              ADD NOTE
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
