/** ContactBook — the From-contact library for the Reports module. Lists saved contacts and lets
 *  the operator add / edit / delete them (name, title, org, email, phone, address). "Use" hands a
 *  contact's id back to the editor as the report's From. Persistence is the encrypted main-process
 *  store via window.api.reports.contacts.* — a contact is plain-text data, never trusted markup,
 *  so every field round-trips as a bounded string (validator: ensureContact). */
import { useCallback, useEffect, useState } from 'react';
import type { Contact } from '@shared/reports-types';

function uid(): string { return crypto.randomUUID(); }

const FIELDS: { key: keyof Contact; label: string }[] = [
  { key: 'name', label: 'Contact name' },
  { key: 'title', label: 'Title' },
  { key: 'org', label: 'Organization' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
];

export function ContactBook(props: { onUse: (id: string) => void; onClose: () => void }): JSX.Element {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [draft, setDraft] = useState<Contact | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setContacts(await window.api.reports.contacts.list());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function addContact(): void { setDraft({ id: uid(), name: '' }); }
  function editContact(c: Contact): void { setDraft({ ...c }); }

  async function saveDraft(): Promise<void> {
    if (!draft) return;
    await window.api.reports.contacts.save(draft);
    setDraft(null);
    await refresh();
  }

  async function removeContact(id: string): Promise<void> {
    await window.api.reports.contacts.remove(id);
    if (draft?.id === id) setDraft(null);
    await refresh();
  }

  function setField(key: keyof Contact, value: string): void {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <div className="ga98-report-contactbook" role="dialog" aria-label="Contact book">
      <div className="ga98-report-contactbook-head">
        <strong>Contacts</strong>
        <button onClick={addContact}>Add contact</button>
        <button aria-label="Close contact book" onClick={props.onClose}>✕</button>
      </div>

      <ul className="ga98-report-contactbook-list">
        {contacts.map((c) => (
          <li key={c.id}>
            <span className="ga98-report-contact-name">{c.name || 'Unnamed'}</span>
            {c.org ? <span className="ga98-report-contact-org"> — {c.org}</span> : null}
            <button onClick={() => props.onUse(c.id)}>Use</button>
            <button onClick={() => editContact(c)}>Edit</button>
            <button aria-label="Delete contact" onClick={() => { void removeContact(c.id); }}>✕</button>
          </li>
        ))}
        {contacts.length === 0 ? <li className="ga98-report-contactbook-empty">No contacts yet.</li> : null}
      </ul>

      {draft ? (
        <div className="ga98-report-contact-editor">
          {FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <input
                aria-label={f.label}
                value={(draft[f.key] as string) ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            </label>
          ))}
          <div className="ga98-report-contact-editor-actions">
            <button onClick={() => { void saveDraft(); }}>Save contact</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
