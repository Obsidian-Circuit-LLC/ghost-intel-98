/**
 * Per-case entities pane. Entities live in a global cross-case registry; this links them to
 * the current case with a Family/Associates/Other bucket, optional ties to the case's
 * attachments, and a cross-case lookup ("which other cases reference this entity").
 */
import { useEffect, useState } from 'react';
import type { AttachmentMeta, EntityRecord, EntityRelationship, EntityType, ResolvedEntity } from '@shared/types';
import { ENTITY_TYPES, ENTITY_RELATIONSHIPS } from '@shared/types';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { ChatSharePicker, type ShareTarget } from '../../components/ChatSharePicker';

const BUCKETS: { key: EntityRelationship | 'untagged'; label: string }[] = [
  { key: 'family', label: 'Family' },
  { key: 'associate', label: 'Associates' },
  { key: 'other', label: 'Other' },
  { key: 'untagged', label: 'Untagged' }
];

export function EntitiesSection({ caseId, entities, attachments, onRefresh }: {
  caseId: string;
  entities: ResolvedEntity[];
  attachments: AttachmentMeta[];
  onRefresh(): void | Promise<void>;
}): JSX.Element {
  const [type, setType] = useState<EntityType>('person');
  const [value, setValue] = useState('');
  const [rel, setRel] = useState<EntityRelationship | ''>('');
  const [registry, setRegistry] = useState<EntityRecord[]>([]);
  const [linkExistingId, setLinkExistingId] = useState('');

  useEffect(() => { void window.api.entities.listAll().then(setRegistry).catch(() => undefined); }, [entities]);

  async function addNew(): Promise<void> {
    if (!value.trim()) return;
    try {
      const e = await window.api.entities.create({ type, value: value.trim() });
      await window.api.entities.linkToCase(caseId, e.id, rel ? { relationship: rel } : {});
      await window.api.cases.addTimeline(caseId, { kind: 'entity', message: `Linked entity: ${e.value}` });
      setValue(''); setRel('');
      await onRefresh();
    } catch (err) { toast.error(`Add failed: ${(err as Error).message}`); }
  }

  async function linkExisting(): Promise<void> {
    if (!linkExistingId) return;
    try {
      await window.api.entities.linkToCase(caseId, linkExistingId, rel ? { relationship: rel } : {});
      const e = registry.find((x) => x.id === linkExistingId);
      await window.api.cases.addTimeline(caseId, { kind: 'entity', message: `Linked entity: ${e?.value ?? linkExistingId}` });
      setLinkExistingId(''); setRel('');
      await onRefresh();
    } catch (err) { toast.error(`Link failed: ${(err as Error).message}`); }
  }

  const linkedIds = new Set(entities.map((e) => e.entity.id));
  const linkable = registry.filter((e) => !linkedIds.has(e.id));

  return (
    <fieldset>
      <legend>Entities</legend>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        <select className="ga98-text" value={type} onChange={(e) => setType(e.target.value as EntityType)}>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="ga98-text" placeholder="Value (name, email, wallet…)" value={value}
          onChange={(e) => setValue(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <select className="ga98-text" value={rel} onChange={(e) => setRel(e.target.value as EntityRelationship | '')}>
          <option value="">(no bucket)</option>
          {ENTITY_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button disabled={!value.trim()} onClick={() => void addNew()}>Add new</button>
      </div>
      {linkable.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <select className="ga98-text" value={linkExistingId} onChange={(e) => setLinkExistingId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Link an existing entity (cross-case)…</option>
            {linkable.map((e) => <option key={e.id} value={e.id}>{e.type}: {e.value}</option>)}
          </select>
          <button disabled={!linkExistingId} onClick={() => void linkExisting()}>Link</button>
        </div>
      )}
      {entities.length === 0 ? <p style={{ color: '#666' }}>No entities linked.</p> : BUCKETS.map((b) => {
        const items = entities.filter((e) => (e.relationship ?? 'untagged') === b.key);
        if (items.length === 0) return null;
        return (
          <div key={b.key} style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 'bold', opacity: 0.7 }}>{b.label}</div>
            <ul className="ga98-list">
              {items.map((e) => <EntityRow key={e.entity.id} caseId={caseId} item={e} attachments={attachments} onRefresh={onRefresh} />)}
            </ul>
          </div>
        );
      })}
    </fieldset>
  );
}

function EntityRow({ caseId, item, attachments, onRefresh }: {
  caseId: string;
  item: ResolvedEntity;
  attachments: AttachmentMeta[];
  onRefresh(): void | Promise<void>;
}): JSX.Element {
  const [otherCases, setOtherCases] = useState<{ caseId: string; title: string }[] | null>(null);
  const [sharing, setSharing] = useState(false);

  async function showCrossCase(): Promise<void> {
    try {
      const cases = await window.api.entities.casesForEntity(item.entity.id);
      setOtherCases(cases.filter((c) => c.caseId !== caseId));
    } catch { setOtherCases([]); }
  }

  function entitySummary(): string {
    const e = item.entity;
    const lines = [`Case entity — ${e.type}: ${e.value}`];
    if (e.aliases.length) lines.push(`aliases: ${e.aliases.join(', ')}`);
    if (e.notes.trim()) lines.push(`notes: ${e.notes.trim()}`);
    return lines.join('\n');
  }

  async function shareTo(t: ShareTarget): Promise<void> {
    setSharing(false);
    try {
      const text = entitySummary();
      if (t.kind === 'group') await window.api.chat.sendGroup(t.id, text);
      else await window.api.chat.send(t.id, text);
      toast.info(`Shared entity to ${t.name}`);
    } catch (e) { toast.error(`Share failed: ${(e as Error).message}`); }
  }

  return (
    <li style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b>{item.entity.value}</b> <span style={{ fontSize: 10, opacity: 0.6 }}>[{item.entity.type}]</span>
          {item.attachmentFileNames.length > 0 && <span style={{ fontSize: 10, opacity: 0.6 }}> · {item.attachmentFileNames.length} file</span>}
        </span>
        <select className="ga98-text" value={item.relationship ?? ''} title="Bucket" onChange={async (e) => {
          await window.api.entities.setRelationship(caseId, item.entity.id, (e.target.value || null) as EntityRelationship | null);
          await onRefresh();
        }}>
          <option value="">(untagged)</option>
          {ENTITY_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {attachments.length > 0 && (
          <select className="ga98-text" value="" title="Tie to an attachment" onChange={async (e) => {
            if (!e.target.value) return;
            await window.api.entities.linkToCase(caseId, item.entity.id, { attachmentFileNames: [e.target.value] });
            await onRefresh();
          }}>
            <option value="">＋file</option>
            {attachments.map((a) => <option key={a.fileName} value={a.fileName}>{a.originalName}</option>)}
          </select>
        )}
        <button onClick={() => void showCrossCase()} title="Other cases with this entity">⤢</button>
        <button onClick={() => setSharing(true)} title="Share a summary of this entity to a chat contact or group">📤</button>
        <button onClick={async () => {
          const ok = await confirmDialog(`Unlink "${item.entity.value}" from this case? The entity stays in the registry.`, 'Unlink entity');
          if (!ok) return;
          await window.api.entities.unlinkFromCase(caseId, item.entity.id);
          await onRefresh();
        }}>×</button>
      </div>
      {otherCases && (
        <div style={{ fontSize: 11, background: '#f4f4f4', border: '1px solid #d0d0d0', margin: '4px 0 0 8px', padding: 6 }}>
          {otherCases.length === 0 ? 'Not referenced in any other case.' : <>Also in: {otherCases.map((c) => c.title).join(', ')}</>}
        </div>
      )}
      {sharing && (
        <ChatSharePicker
          title={`Share "${item.entity.value}" to…`}
          allowGroups
          onPick={(t) => void shareTo(t)}
          onClose={() => setSharing(false)}
        />
      )}
    </li>
  );
}
