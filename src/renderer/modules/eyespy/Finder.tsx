import { useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { countryFlag, type TreeNode, type CityEntry } from './tree';

export type FeedAction = 'add' | 'play' | 'edit' | 'setloc' | 'delete';

export function Finder({ tab, onTab, query, onQuery, tree, cities, feeds, selectedKey, onSelectNode, onFeedAction, onRefresh, onImport, importLabel }: {
  tab: 'countries' | 'cities';
  onTab: (t: 'countries' | 'cities') => void;
  query: string;
  onQuery: (q: string) => void;
  tree: TreeNode[];
  cities: CityEntry[];
  feeds: CameraStream[];
  selectedKey: string | null;
  onSelectNode: (n: TreeNode | null) => void;
  onFeedAction: (a: FeedAction, s: CameraStream) => void;
  onRefresh: () => void;
  onImport: () => void;
  importLabel: string;
}): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; s: CameraStream } | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 220 }}>
      <div style={{ display: 'flex' }}>
        <button data-selected={tab === 'countries'} onClick={() => onTab('countries')} style={{ flex: 1 }}>Countries</button>
        <button data-selected={tab === 'cities'} onClick={() => onTab('cities')} style={{ flex: 1 }}>Cities</button>
      </div>
      <input className="ga98-text" placeholder="Search countries, cities, cameras…" value={query} onChange={(e) => onQuery(e.target.value)} style={{ margin: 4 }} />
      <div className="ga98-list" style={{ flex: '1 1 40%', overflow: 'auto' }}>
        <div data-selected={selectedKey === null} onClick={() => onSelectNode(null)} style={{ cursor: 'pointer', padding: '2px 6px', fontWeight: 600 }}>All cameras</div>
        {tab === 'countries'
          ? tree.map((n) => <TreeRow key={n.key} node={n} depth={0} selectedKey={selectedKey} onSelect={onSelectNode} />)
          : cities.map((c) => <div key={`${c.country ?? ''}/${c.city}`} onClick={() => onSelectNode({ key: `${c.country?.trim() || 'Ungeocoded'}\0${c.region ?? ''}\0${c.city}`, label: c.city, level: 'city', count: c.count, streamIds: [], children: [], country: c.country, region: c.region, city: c.city })} style={{ cursor: 'pointer', padding: '2px 6px', display: 'flex' }}><span style={{ flex: 1 }}>{c.city}{c.country ? ` · ${c.country}` : ''}</span><span style={{ fontSize: 10, opacity: 0.65 }}>{c.count}</span></div>)}
      </div>
      <div className="ga98-list" style={{ flex: '1 1 60%', overflow: 'auto', borderTop: '1px solid #ccc' }}>
        {feeds.map((s) => (
          <div key={s.id} title={s.url} onClick={() => onFeedAction('add', s)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, s }); }} style={{ cursor: 'pointer', padding: '2px 6px' }}>
            <b>{s.label}</b> <span style={{ fontSize: 10, opacity: 0.6 }}>{s.kind}</span>
            {(s.city || s.country) && <div style={{ fontSize: 10, opacity: 0.6 }}>{[s.city, s.region, s.country].filter(Boolean).join(' · ')}</div>}
          </div>
        ))}
        {feeds.length === 0 && <div style={{ padding: 8, fontSize: 11, opacity: 0.6 }}>No feeds here. Import a list or add a stream.</div>}
      </div>
      {/* flexShrink:0 pins this action row so the Import button is always reachable — it must
          never be squeezed off-screen by a long feed/tree list above it. flexWrap lets the two
          buttons stack on a very narrow pane rather than clip. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, borderTop: '1px solid #ccc', flexShrink: 0 }}>
        <button onClick={onRefresh}>Refresh</button>
        <button onClick={onImport} style={{ flex: 1, minWidth: 120 }} title="Import a CSV/JSON/URL-list of your own feeds">{importLabel}</button>
      </div>
      {menu && <FeedMenu x={menu.x} y={menu.y} onPick={(a) => { onFeedAction(a, menu.s); setMenu(null); }} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TreeRow({ node, depth, selectedKey, onSelect }: { node: TreeNode; depth: number; selectedKey: string | null; onSelect: (n: TreeNode) => void }): JSX.Element {
  const [open, setOpen] = useState(depth === 0);
  const hasKids = node.children.length > 0;
  const flag = node.level === 'country' ? countryFlag(node.country) : '';
  return (
    <div>
      <div data-selected={selectedKey === node.key} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '2px 6px', paddingLeft: 6 + depth * 14 }} onClick={() => onSelect(node)}>
        {hasKids ? <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ width: 14 }}>{open ? '▾' : '▸'}</span> : <span style={{ width: 14, display: 'inline-block' }} />}
        <span style={{ flex: 1 }}>{flag ? `${flag} ` : ''}{node.label}</span>
        <span style={{ fontSize: 10, opacity: 0.65 }}>{node.count}</span>
      </div>
      {open && hasKids && node.children.map((c) => <TreeRow key={c.key} node={c} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect} />)}
    </div>
  );
}

function FeedMenu({ x, y, onPick, onClose }: { x: number; y: number; onPick: (a: FeedAction) => void; onClose: () => void }): JSX.Element {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
      <div className="ga98-menu" style={{ position: 'fixed', left: x, top: y, zIndex: 100, background: '#c0c0c0', border: '2px outset #fff' }}>
        {([['add', 'Add to active square'], ['play', 'Play full-screen'], ['edit', 'Edit…'], ['setloc', 'Set location…'], ['delete', 'Delete']] as [FeedAction, string][]).map(([a, label]) => (
          <div key={a} onClick={() => onPick(a)} style={{ padding: '3px 12px', cursor: 'pointer' }}>{label}</div>
        ))}
      </div>
    </>
  );
}
