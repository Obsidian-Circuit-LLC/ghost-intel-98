/**
 * Address Book — contacts, their photos, and who knows whom.
 *
 * Built to GhostExodus's spec: a bio picture and a drag-and-drop album, the fixed fields (name,
 * alias, occupation, skills, notes, thoughts), four REPEATABLE fields each with a plus button
 * (email / phone / URL / social), search, an always-alphabetised list, and common contacts chosen
 * from a dropdown.
 *
 * Two things are deliberately NOT decided here:
 *
 *   - ALPHABETISATION is the store's, not this component's. The list renders what `list()` returns,
 *     which is sorted by NAME regardless of alias ("alphabetized by Name despite if they have an
 *     alias"). Sorting again here would be a second opinion that could drift from the first.
 *   - COMMON CONTACTS are symmetric in the STORE. This screen sends the links for the contact being
 *     edited and re-reads; it never writes the other side itself. That is what makes the
 *     attribution retro-active without this component having to remember to do it — and it means a
 *     half-link cannot be created by any path through the UI.
 *
 * Photo bytes never live in the contact record: they go to the encrypted asset store and the record
 * keeps a ref, same as Journal Jots and Reports. Zero egress — nothing here fetches anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, ContactSummary } from '@shared/address-book';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';
import { ModuleBanner } from '../../components/ModuleBanner';
import banner from '../../assets/address-book-banner.png';
import bannerBlur from '../../assets/address-book-banner-blur.jpg';

const IMAGE_MIME = ['image/png', 'image/jpeg'];
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** The four repeatable fields, in his order. One definition drives the editor, so a fifth could be
 *  added without touching the layout. */
const MULTI_FIELDS = [
  { key: 'emails', label: 'Email', placeholder: 'name@example.org' },
  { key: 'phones', label: 'Phone', placeholder: '+44 …' },
  { key: 'urls', label: 'URL', placeholder: 'https://…' },
  { key: 'socials', label: 'Social Media', placeholder: '@handle' },
  { key: 'affiliations', label: 'Affiliation', placeholder: 'group, org, or collective' },
] as const;
type MultiKey = (typeof MULTI_FIELDS)[number]['key'];

/** A blank contact — every field present, so the editor is never driven by `undefined`. */
function emptyContact(): Contact {
  return {
    id: '', name: '', alias: '', emails: [''], phones: [''], urls: [''], socials: [''], affiliations: [''],
    occupation: '', skills: '', notes: '', thoughts: '',
    bioPicRef: null, photoRefs: [], commonContacts: [],
    createdAt: '', updatedAt: '',
  };
}

/** Read a dropped/picked image into the byte array the asset channel takes. */
async function readImage(file: File): Promise<{ bytes: number[]; mime: string } | null> {
  if (!IMAGE_MIME.includes(file.type)) {
    toast.warn(`${file.name}: only PNG and JPEG images can be added.`);
    return null;
  }
  if (file.size > MAX_ASSET_BYTES) {
    toast.warn(`${file.name} is too large (25 MB maximum).`);
    return null;
  }
  return { bytes: Array.from(new Uint8Array(await file.arrayBuffer())), mime: file.type };
}

/** Resolve an asset ref to a data URL for display, once per ref. */
function useAssetUrls(refs: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const wanted = refs.join('|');
  useEffect(() => {
    let alive = true;
    const missing = refs.filter((r) => r && !urls[r]);
    if (!missing.length) return;
    void (async () => {
      const next: Record<string, string> = {};
      for (const ref of missing) {
        const got = await window.api.addressBook.getAsset(ref);
        if (!got) continue;
        // Built in the renderer from bytes the main process decrypted — nothing is fetched.
        const blob = new Blob([new Uint8Array(got.bytes)], { type: got.mime });
        next[ref] = URL.createObjectURL(blob);
      }
      if (alive && Object.keys(next).length) setUrls((prev) => ({ ...prev, ...next }));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return urls;
}

export function AddressBookModule(): JSX.Element {
  const [rows, setRows] = useState<ContactSummary[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Contact>(emptyContact);
  const [dirty, setDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bioInput = useRef<HTMLInputElement>(null);
  const albumInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (q: string) => {
    setRows(await window.api.addressBook.search(q));
  }, []);

  useEffect(() => { void refresh(query); }, [query, refresh]);

  const open = useCallback(async (id: string) => {
    const contact = await window.api.addressBook.read(id);
    if (!contact) { toast.error('That contact could not be read.'); return; }
    // Show one empty row per repeatable field so the plus button is not needed for the first entry.
    setDraft({
      ...contact,
      emails: contact.emails.length ? contact.emails : [''],
      phones: contact.phones.length ? contact.phones : [''],
      urls: contact.urls.length ? contact.urls : [''],
      socials: contact.socials.length ? contact.socials : [''],
      affiliations: contact.affiliations.length ? contact.affiliations : [''],
    });
    setSelectedId(id);
    setDirty(false);
  }, []);

  function startNew(): void {
    setDraft(emptyContact());
    setSelectedId(null);
    setDirty(true);
  }

  function edit<K extends keyof Contact>(key: K, value: Contact[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  function editMulti(key: MultiKey, index: number, value: string): void {
    setDraft((d) => ({ ...d, [key]: d[key].map((v, i) => (i === index ? value : v)) }));
    setDirty(true);
  }

  function addMulti(key: MultiKey): void {
    setDraft((d) => ({ ...d, [key]: [...d[key], ''] }));
    setDirty(true);
  }

  function removeMulti(key: MultiKey, index: number): void {
    setDraft((d) => {
      const next = d[key].filter((_, i) => i !== index);
      return { ...d, [key]: next.length ? next : [''] };
    });
    setDirty(true);
  }

  async function saveDraft(): Promise<void> {
    if (!draft.name.trim()) { toast.warn('A contact needs a name.'); return; }
    const saved = await window.api.addressBook.save({
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name, alias: draft.alias,
      emails: draft.emails, phones: draft.phones, urls: draft.urls, socials: draft.socials,
      affiliations: draft.affiliations,
      occupation: draft.occupation, skills: draft.skills,
      notes: draft.notes, thoughts: draft.thoughts,
      bioPicRef: draft.bioPicRef, photoRefs: draft.photoRefs,
      commonContacts: draft.commonContacts,
    });
    await refresh(query);
    await open(saved.id);
    toast.success(`Saved ${saved.name}.`);
  }

  async function deleteContact(): Promise<void> {
    if (!draft.id) return;
    const ok = await confirmDialog(
      `Delete ${draft.name}?\n\nTheir photos and every connection to them are removed too. This cannot be undone.`,
      'Delete contact',
    );
    if (!ok) return;
    await window.api.addressBook.delete(draft.id);
    setDraft(emptyContact());
    setSelectedId(null);
    setDirty(false);
    await refresh(query);
  }

  async function attachBioPic(file: File | undefined): Promise<void> {
    if (!file) return;
    const read = await readImage(file);
    if (!read) return;
    edit('bioPicRef', await window.api.addressBook.putAsset(read.bytes, read.mime));
  }

  async function attachPhotos(files: FileList | File[]): Promise<void> {
    const added: string[] = [];
    for (const file of Array.from(files)) {
      const read = await readImage(file);
      if (!read) continue;
      added.push(await window.api.addressBook.putAsset(read.bytes, read.mime));
    }
    if (added.length) setDraft((d) => { setDirty(true); return { ...d, photoRefs: [...d.photoRefs, ...added] }; });
  }

  const assetRefs = useMemo(
    () => [draft.bioPicRef, ...draft.photoRefs].filter((r): r is string => Boolean(r)),
    [draft.bioPicRef, draft.photoRefs],
  );
  const assetUrls = useAssetUrls(assetRefs);

  /** Everyone except the contact being edited — the dropdown must not offer a self-link. */
  const linkable = rows.filter((r) => r.id !== draft.id && !draft.commonContacts.includes(r.id));
  const nameOf = (id: string): string => rows.find((r) => r.id === id)?.name ?? 'Unknown contact';

  return (
    <div className="ga98-window-shell" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ModuleBanner variant="addressbook" src={banner} blurSrc={bannerBlur} alt="Address Book" />
      <div className="ga98-split" style={{ flex: 1, minHeight: 0 }}>
        <div className="ga98-pane" style={{ width: 230, flex: '0 0 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 4, padding: 4 }}>
            <button type="button" onClick={startNew} title="Add a new contact">New</button>
            <input
              aria-label="Search contacts"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <div className="ga98-ab-list-head" title="Every contact, sorted by name">
            {query.trim()
              ? `${rows.length} match${rows.length === 1 ? '' : 'es'}`
              : `All contacts (${rows.length}) · A→Z`}
          </div>
          <ul className="ga98-list" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
            {rows.length === 0 && (
              <li style={{ color: 'var(--ga98-dim-soft)', fontSize: 11 }}>
                {query.trim() ? 'No contact matches that.' : 'No contacts yet. Click New.'}
              </li>
            )}
            {rows.map((r) => (
              <li
                key={r.id}
                className={r.id === selectedId ? 'selected' : ''}
                onClick={() => { void open(r.id); }}
                style={{ cursor: 'pointer' }}
              >
                <strong>{r.name}</strong>
                {r.alias && <span style={{ color: 'var(--ga98-dim-soft)' }}> “{r.alias}”</span>}
                {r.occupation && <div style={{ fontSize: 11, color: 'var(--ga98-dim-soft)' }}>{r.occupation}</div>}
              </li>
            ))}
          </ul>
        </div>

        <div className="ga98-pane ga98-ab-editor" style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 8 }}>
          {!dirty && !selectedId ? (
            <p style={{ color: 'var(--ga98-dim-soft)' }}>Select a contact, or click New to add one.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ textAlign: 'center' }}>
                  <div className="ga98-ab-biopic">
                    {draft.bioPicRef && assetUrls[draft.bioPicRef]
                      ? <img src={assetUrls[draft.bioPicRef]} alt={`${draft.name || 'Contact'} bio picture`} />
                      : <span>No photo</span>}
                  </div>
                  <input
                    ref={bioInput} type="file" accept="image/png,image/jpeg" hidden
                    onChange={(e) => { void attachBioPic(e.target.files?.[0]); e.target.value = ''; }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button type="button" onClick={() => bioInput.current?.click()}>Bio pic</button>
                    {draft.bioPicRef && <button type="button" onClick={() => edit('bioPicRef', null)}>Clear</button>}
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
                  <label>Name<input value={draft.name} onChange={(e) => edit('name', e.target.value)} /></label>
                  <label>Alias<input value={draft.alias} onChange={(e) => edit('alias', e.target.value)} /></label>
                  <label>Occupation<input value={draft.occupation} onChange={(e) => edit('occupation', e.target.value)} /></label>
                  <label>Skills<input value={draft.skills} onChange={(e) => edit('skills', e.target.value)} /></label>
                </div>
              </div>

              {MULTI_FIELDS.map((field) => (
                <fieldset key={field.key} style={{ marginTop: 8 }}>
                  <legend>{field.label}</legend>
                  {draft[field.key].map((value, i) => (
                    <div key={i} className="ga98-ab-row">
                      <input
                        value={value}
                        placeholder={field.placeholder}
                        aria-label={`${field.label} ${i + 1}`}
                        onChange={(e) => editMulti(field.key, i, e.target.value)}
                      />
                      <button type="button" title={`Remove this ${field.label.toLowerCase()}`} onClick={() => removeMulti(field.key, i)}>−</button>
                    </div>
                  ))}
                  <button type="button" title={`Add another ${field.label.toLowerCase()}`} onClick={() => addMulti(field.key)}>+</button>
                </fieldset>
              ))}

              <fieldset style={{ marginTop: 8 }}>
                <legend>Notes</legend>
                <textarea rows={4} value={draft.notes} onChange={(e) => edit('notes', e.target.value)} style={{ width: '100%' }} />
              </fieldset>
              <fieldset>
                <legend>Thoughts</legend>
                <textarea rows={3} value={draft.thoughts} onChange={(e) => edit('thoughts', e.target.value)} style={{ width: '100%' }} />
              </fieldset>

              <fieldset>
                <legend>Common contacts</legend>
                {draft.commonContacts.length === 0 && (
                  <p style={{ color: 'var(--ga98-dim-soft)', fontSize: 11, margin: '0 0 4px' }}>
                    Nobody linked yet. Adding someone here links them back to this contact too.
                  </p>
                )}
                <ul className="ga98-list" style={{ margin: '0 0 4px' }}>
                  {draft.commonContacts.map((id) => (
                    <li key={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span>{nameOf(id)}</span>
                      <button
                        type="button"
                        title="Unlink — removes the connection from both contacts"
                        onClick={() => edit('commonContacts', draft.commonContacts.filter((x) => x !== id))}
                      >−</button>
                    </li>
                  ))}
                </ul>
                <select
                  aria-label="Add a common contact"
                  value=""
                  disabled={!draft.id || linkable.length === 0}
                  title={draft.id ? 'Link another contact' : 'Save this contact first, then link others to it'}
                  onChange={(e) => { if (e.target.value) edit('commonContacts', [...draft.commonContacts, e.target.value]); }}
                >
                  <option value="">{draft.id ? 'Add a common contact…' : 'Save first, then link'}</option>
                  {linkable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </fieldset>

              <fieldset
                className={dragging ? 'ga98-ab-album dragging' : 'ga98-ab-album'}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); void attachPhotos(e.dataTransfer.files); }}
              >
                <legend>Photos</legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {draft.photoRefs.map((ref) => (
                    <div key={ref} className="ga98-ab-photo">
                      {assetUrls[ref] && <img src={assetUrls[ref]} alt="" />}
                      <button
                        type="button"
                        title="Remove this photo from the album"
                        onClick={() => edit('photoRefs', draft.photoRefs.filter((x) => x !== ref))}
                      >×</button>
                    </div>
                  ))}
                  {draft.photoRefs.length === 0 && (
                    <p style={{ color: 'var(--ga98-dim-soft)', fontSize: 11, margin: 0 }}>
                      Drag photos here, or use Add photos.
                    </p>
                  )}
                </div>
                <input
                  ref={albumInput} type="file" accept="image/png,image/jpeg" multiple hidden
                  onChange={(e) => { if (e.target.files) void attachPhotos(e.target.files); e.target.value = ''; }}
                />
                <button type="button" style={{ marginTop: 6 }} onClick={() => albumInput.current?.click()}>Add photos</button>
              </fieldset>

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button type="button" onClick={() => { void saveDraft(); }}>Save</button>
                {draft.id && <button type="button" className="ga98-danger" onClick={() => { void deleteContact(); }}>Delete</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
