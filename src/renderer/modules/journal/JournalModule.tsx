/**
 * Journal Jots — a PIN-gated personal journal. A list of entries on the left, an editor on the
 * right with a date header. Entries are consolidated INSIDE the Journal app (the journal store);
 * they are never written to a case or the Briefcase. Persisted encrypted-at-rest when login is on.
 *
 * The 4-digit PIN is a rate-limited convenience gate on top of already-vault-encrypted storage —
 * NOT the data's encryption key (see src/main/storage/journal.ts). On mount we ask the main process
 * whether a PIN exists: if not, we force a "set a PIN" screen; if so, we show the lock screen and
 * only reveal the journal after verifyPin succeeds. Zero egress.
 */

import { useCallback, useEffect, useState } from 'react';
import type { JournalEntrySummary, JournalBlock } from '@shared/types';
import type { ReportBlock } from '@shared/reports-types';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';
import { TextBlock } from '../reports/blocks/TextBlock';
import { ImageBlock } from '../reports/blocks/ImageBlock';
import { sanitizeReportHtml } from '../reports/rich-text';
import { useClearnetLinkOpener } from '../ai-assistant/useClearnetLinkOpener';
import journalBanner from '../../assets/journal-jots-banner.png';
import journalBook from '../../assets/journal-jots-book.png';

function uid(): string { return crypto.randomUUID(); }
function fmtBytes(n: number): string { return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`; }
function isFourDigits(s: string): boolean { return /^[0-9]{4}$/.test(s); }

const IMAGE_MIME = ['image/png', 'image/jpeg'];

/** Defense-in-depth scheme guard for the delegated anchor-click handler below. sanitizeReportHtml
 *  already strips any href that isn't http/https/mailto on write AND on the read-side pass this
 *  module runs (sanitizeBlocksForDisplay), so a non-openable href should never actually reach a
 *  rendered anchor — this check exists so a click can never route to openExternal with a scheme
 *  sanitize didn't intend to allow. */
function isOpenableHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

/** A fresh, empty entry starts with one empty text block, mirroring ReportEditor's "always a typable
 *  body" seed. */
function emptyBlocks(): JournalBlock[] { return [{ id: uid(), kind: 'text', html: '' }]; }

// Read-side sanitize (defense-in-depth): every stored text block's html is re-run through
// sanitizeReportHtml before it is seeded into the editor for display, so a tampered journal.json
// can't smuggle a live onerror/javascript: href past main (main has no DOM to sanitize with) into
// the renderer's contentEditable. TextBlock ALSO sanitizes on every edit — this covers the read path
// TextBlock's own write-side sanitize doesn't touch.
function sanitizeBlocksForDisplay(blocks: JournalBlock[]): JournalBlock[] {
  return blocks.map((b) => (b.kind === 'text' ? { ...b, html: sanitizeReportHtml(b.html) } : b));
}

type Gate = 'loading' | 'set-pin' | 'locked' | 'open';

export function JournalModule(): JSX.Element {
  const [gate, setGate] = useState<Gate>('loading');
  // The open policy for hyperlinks clicked inside a text block: scheme-guarded (main-side
  // validateExternalUrl) + a one-time clearnet-IP-exposure acknowledgement, same as Q's replies.
  const openLink = useClearnetLinkOpener();

  // PIN-screen state.
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');

  // Journal state (only meaningful once unlocked).
  const [entries, setEntries] = useState<JournalEntrySummary[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState('Untitled');
  const [blocks, setBlocks] = useState<JournalBlock[]>(emptyBlocks());
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // ref → data URL cache for image blocks, resolved from the encrypted journal-assets store.
  const [assets, setAssets] = useState<Record<string, string>>({});

  useEffect(() => {
    void window.api.journal.hasPin().then((has) => setGate(has ? 'locked' : 'set-pin'));
  }, []);

  const refresh = useCallback(async () => { setEntries(await window.api.journal.list()); }, []);
  useEffect(() => { if (gate === 'open') void refresh(); }, [gate, refresh]);

  // ---- PIN flows -------------------------------------------------------------------------------

  async function submitSetPin(): Promise<void> {
    setPinError('');
    if (!isFourDigits(pin)) { setPinError('PIN must be exactly 4 digits.'); return; }
    if (pin !== pinConfirm) { setPinError('The two PINs do not match.'); return; }
    try {
      await window.api.journal.setPin(pin);
      setPin(''); setPinConfirm('');
      setGate('open');
      toast.success('Journal PIN set.');
    } catch (err) { setPinError((err as Error).message); }
  }

  async function submitUnlock(): Promise<void> {
    setPinError('');
    if (!isFourDigits(pin)) { setPinError('PIN must be exactly 4 digits.'); return; }
    try {
      const ok = await window.api.journal.verifyPin(pin);
      if (!ok) { setPinError('Incorrect PIN — or too many attempts; wait and try again.'); setPin(''); return; }
      setPin('');
      setGate('open');
    } catch (err) { setPinError((err as Error).message); }
  }

  // ---- entry flows -----------------------------------------------------------------------------

  // Resolve every image block's assetRef into the local data-URL cache — mirrors ReportsModule's
  // loadAssetsFor exactly (main has no DOM; the renderer is where a ref becomes a displayable src).
  const loadAssetsFor = useCallback(async (bs: JournalBlock[]): Promise<Record<string, string>> => {
    const refs = new Set<string>();
    for (const b of bs) if (b.kind === 'image') refs.add(b.assetRef);
    const map: Record<string, string> = {};
    for (const ref of refs) {
      const a = await window.api.journal.getAsset(ref);
      if (a) map[ref] = a.dataUrl;
    }
    return map;
  }, []);

  const openEntry = useCallback(async (entryId: string) => {
    try {
      const e = await window.api.journal.read(entryId);
      if (!e) return;
      const displayBlocks = sanitizeBlocksForDisplay(e.blocks ?? emptyBlocks());
      setId(e.id); setTitle(e.title); setBlocks(displayBlocks); setCreatedAt(e.createdAt); setDirty(false);
      setAssets(await loadAssetsFor(displayBlocks));
    } catch (err) { toast.error(`Open failed: ${(err as Error).message}`); }
  }, [loadAssetsFor]);

  function newEntry(): void {
    setId(null); setTitle('Untitled'); setBlocks(emptyBlocks()); setCreatedAt(null); setDirty(false); setAssets({});
  }

  async function save(): Promise<void> {
    const eid = id ?? uid();
    try {
      const saved = await window.api.journal.save({ id: eid, title: title.trim() || 'Untitled', blocks });
      setId(saved.id); setCreatedAt(saved.createdAt); setDirty(false);
      await refresh();
      toast.success('Entry saved.');
    } catch (err) { toast.error(`Save failed: ${(err as Error).message}`); }
  }

  // ---- block mutators ----------------------------------------------------------------------------

  function addTextBlock(): void {
    setBlocks((prev) => [...prev, { id: uid(), kind: 'text', html: '' }]);
    setDirty(true);
  }

  function updateTextBlock(blockId: string, html: string): void {
    setBlocks((prev) => prev.map((b) => (b.id === blockId && b.kind === 'text' ? { ...b, html } : b)));
    setDirty(true);
  }

  function updateImageBlock(blockId: string, p: Partial<Extract<ReportBlock, { kind: 'image' }>>): void {
    setBlocks((prev) => prev.map((b) => (b.id === blockId && b.kind === 'image' ? { ...b, ...p } : b)));
    setDirty(true);
  }

  function removeBlock(blockId: string): void {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    setDirty(true);
  }

  // Encrypt one image's bytes into the journal-assets store, cache its preview URL, and append a
  // photo block — mirrors ReportsModule's addPhotoBytes (bytes never sit in journal.json, only the
  // assetRef does).
  const addPhotoBytes = useCallback(async (bytes: number[], mime: string): Promise<void> => {
    const ref = await window.api.journal.putAsset(bytes, mime);
    const a = await window.api.journal.getAsset(ref);
    if (a) setAssets((prev) => ({ ...prev, [ref]: a.dataUrl }));
    const block: JournalBlock = { id: uid(), kind: 'image', assetRef: ref, widthPct: 60, caption: '' };
    setBlocks((prev) => [...prev, block]);
    setDirty(true);
  }, []);

  async function addPhoto(file: File): Promise<void> {
    if (!IMAGE_MIME.includes(file.type)) {
      toast.error('Could not add photo — only PNG/JPEG images are supported.');
      return;
    }
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      await addPhotoBytes(bytes, mime);
    } catch {
      toast.error('Could not add photo — image must be a PNG/JPEG under 25 MB.');
    }
  }

  async function del(entryId: string): Promise<void> {
    const ok = await confirmDialog('Delete this journal entry?', 'Delete entry');
    if (!ok) return;
    try {
      await window.api.journal.delete(entryId);
      if (id === entryId) newEntry();
      await refresh();
      toast.success('Deleted.');
    } catch (err) { toast.error(`Delete failed: ${(err as Error).message}`); }
  }

  // Delegated anchor-click handler for the block editor. TextBlock's contentEditable body is raw
  // DOM (dangerouslySetInnerHTML), so a link click is NOT a React-managed per-anchor onClick — this
  // single listener on the block-list container catches every click inside every text block.
  // preventDefault stops the Electron window from navigating to the href in-app; the click is then
  // routed through the same scheme-guarded, clearnet-ack-gated opener used everywhere else in the
  // app (openLink → window.api.system.openExternal, main-side validateExternalUrl re-checks).
  function onBlocksClick(e: React.MouseEvent<HTMLDivElement>): void {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute('href') || '';
    // sanitizeReportHtml already stripped anything but http/https/mailto — this is defense-in-depth.
    if (!isOpenableHref(href)) return;
    openLink(href);
  }

  // ---- render ----------------------------------------------------------------------------------

  if (gate === 'loading') {
    return <div className="ga98-pane" style={{ padding: 12, color: 'var(--ga98-dim-soft)' }}>Opening your journal…</div>;
  }

  if (gate === 'set-pin' || gate === 'locked') {
    const setting = gate === 'set-pin';
    const submit = setting ? submitSetPin : submitUnlock;
    return (
      <div className="ga98-journal-unlock">
        <div className="ga98-journal-unlock-form" style={{ width: 260 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
            {setting ? 'Set a 4-digit journal PIN' : 'Enter your journal PIN'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ga98-dim-strong)', marginBottom: 10 }}>
            The PIN locks this journal from casual access. Your entries are encrypted at rest by the
            app vault — the PIN is a convenience gate, not the encryption key.
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input
              className="ga98-text"
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="4-digit PIN"
              style={{ width: '100%', marginBottom: 6 }}
            />
            {setting && (
              <input
                className="ga98-text"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder="confirm PIN"
                style={{ width: '100%', marginBottom: 6 }}
              />
            )}
            {pinError && <div style={{ color: 'var(--ga98-neg-ink)', fontSize: 11, marginBottom: 6 }}>{pinError}</div>}
            <button type="submit" style={{ width: '100%' }}>{setting ? 'Set PIN & Open' : 'Unlock'}</button>
          </form>
        </div>
        <div className="ga98-journal-unlock-art">
          <img src={journalBook} alt="Journal Jots" />
        </div>
      </div>
    );
  }

  // gate === 'open'
  const headerDate = createdAt ? new Date(createdAt).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }) : new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="ga98-journal">
      <img src={journalBanner} alt="Journal Jots" className="ga98-module-banner" />
      <div className="ga98-split" style={{ height: '100%' }}>
        <div className="ga98-pane" style={{ width: 200, flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 4, padding: 4 }}>
            <button onClick={newEntry} title="Start a new entry">New</button>
          </div>
          <ul className="ga98-list" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
            {entries.length === 0 && <li style={{ color: 'var(--ga98-dim-soft)', fontSize: 11 }}>Empty. Click New, write, then Save.</li>}
            {entries.map((e) => (
              <li key={e.id} data-selected={e.id === id} title={`${fmtBytes(e.bytes)} · ${new Date(e.updatedAt).toLocaleString()}`}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => void openEntry(e.id)}>{e.title}</span>
                <button onClick={() => void del(e.id)} style={{ minWidth: 0, padding: '0 5px' }} title="Delete">×</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div className="ga98-toolbar">
            <input className="ga98-text" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="entry title" style={{ flex: 1 }} />
            <button onClick={() => void save()}>{dirty ? 'Save *' : 'Save'}</button>
            {id && <button onClick={() => void del(id)} title="Delete this entry">Delete</button>}
          </div>
          <div style={{ padding: '4px 6px', fontSize: 11, color: 'var(--ga98-dim-deep)', borderBottom: '1px solid #808080', fontStyle: 'italic' }}>
            {headerDate}
          </div>
          <div className="ga98-toolbar ga98-report-toolbar">
            <button type="button" onClick={addTextBlock}>+ Text</button>
            <label className="ga98-report-addphoto">
              <span>+ Photo</span>
              <input
                aria-label="Add photo"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f); e.target.value = ''; }}
              />
            </label>
          </div>
          <div className="ga98-journal-blocks" onClick={onBlocksClick}>
            {blocks.map((b) => (
              <div key={b.id} className="ga98-journal-block">
                {b.kind === 'text' ? (
                  <TextBlock block={b} onChange={(html) => updateTextBlock(b.id, html)} />
                ) : (
                  <ImageBlock
                    block={b}
                    src={assets[b.assetRef]}
                    onChange={(p) => updateImageBlock(b.id, p)}
                    onRemove={() => removeBlock(b.id)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
