import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { countryFlag, type TreeNode, type CityEntry } from './tree';

export type FeedAction = 'add' | 'play' | 'edit' | 'setloc' | 'delete' | 'resolve';

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
  // Collapse-all: a monotonic counter. Bumping it signals every TreeRow to close (see TreeRow's
  // effect). A counter (not a boolean) so repeat clicks re-fire even when some rows were reopened.
  const [collapseN, setCollapseN] = useState(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 220, fontSize: 13 }}>
      <div style={{ display: 'flex' }}>
        <button data-selected={tab === 'countries'} onClick={() => onTab('countries')} style={{ flex: 1 }}>Countries</button>
        <button data-selected={tab === 'cities'} onClick={() => onTab('cities')} style={{ flex: 1 }}>Cities</button>
      </div>
      <input className="ga98-text" placeholder="Search countries, cities, cameras…" value={query} onChange={(e) => onQuery(e.target.value)} style={{ margin: 4 }} />
      {tab === 'countries' && (
        <div style={{ padding: '0 4px 4px' }}>
          <button onClick={() => setCollapseN((n) => n + 1)} title="Collapse every expanded country and region">⊟ Collapse all</button>
        </div>
      )}
      {/* tree and feed lists split the height evenly (50/50) so the location tree gets as much room
          as the feed list below it. */}
      <div className="ga98-list" style={{ flex: '1 1 50%', overflow: 'auto' }}>
        <div data-selected={selectedKey === null} onClick={() => onSelectNode(null)} style={{ cursor: 'pointer', padding: '2px 6px', fontWeight: 600 }}>All cameras</div>
        {tab === 'countries'
          ? tree.map((n) => <TreeRow key={n.key} node={n} depth={0} selectedKey={selectedKey} onSelect={onSelectNode} collapseSignal={collapseN} />)
          : cities.map((c) => <div key={`${c.country ?? ''}/${c.city}`} onClick={() => onSelectNode({ key: `${c.country?.trim() || 'Ungeocoded'}\0${c.region ?? ''}\0${c.city}`, label: c.city, level: 'city', count: c.count, streamIds: [], children: [], country: c.country, region: c.region, city: c.city })} style={{ cursor: 'pointer', padding: '2px 6px', display: 'flex' }}><span style={{ flex: 1 }}>{c.city}{c.country ? ` · ${c.country}` : ''}</span><span style={{ fontSize: 10, opacity: 0.65 }}>{c.count}</span></div>)}
      </div>
      <div className="ga98-list" style={{ flex: '1 1 50%', overflow: 'auto', borderTop: '1px solid #ccc' }}>
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
        <button onClick={onImport} style={{ flex: 1, minWidth: 120 }} title={'Import your own feeds — JSON array of {url,label,country,region,city,lat,lon}, a nested Country→Region→City JSON tree, or a CSV with a header row. Include country/region/city to auto-file them under the tree. See docs/EYESPY_IMPORT_FORMAT.md.'}>{importLabel}</button>
      </div>
      {menu && <FeedMenu x={menu.x} y={menu.y} onPick={(a) => { onFeedAction(a, menu.s); setMenu(null); }} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TreeRow({ node, depth, selectedKey, onSelect, collapseSignal }: { node: TreeNode; depth: number; selectedKey: string | null; onSelect: (n: TreeNode) => void; collapseSignal: number }): JSX.Element {
  const [open, setOpen] = useState(depth === 0);
  // Close this row whenever the parent bumps collapseSignal. Skip the initial mount run so the
  // depth-0 default-open state survives first render — only an actual "Collapse all" click closes it.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setOpen(false);
  }, [collapseSignal]);
  const hasKids = node.children.length > 0;
  const flag = node.level === 'country' ? countryFlag(node.country) : '';
  return (
    <div>
      <div data-selected={selectedKey === node.key} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '2px 6px', paddingLeft: 6 + depth * 14 }} onClick={() => onSelect(node)}>
        {hasKids ? <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ width: 14 }}>{open ? '▾' : '▸'}</span> : <span style={{ width: 14, display: 'inline-block' }} />}
        <span style={{ flex: 1 }}>{flag ? `${flag} ` : ''}{node.label}</span>
        <span style={{ fontSize: 10, opacity: 0.65 }}>{node.count}</span>
      </div>
      {open && hasKids && node.children.map((c) => <TreeRow key={c.key} node={c} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect} collapseSignal={collapseSignal} />)}
    </div>
  );
}

function FeedMenu({ x, y, onPick, onClose }: { x: number; y: number; onPick: (a: FeedAction) => void; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // Clamp the menu fully into the viewport. Right-clicking a feed low in the (long) list put the
  // menu's bottom items (Set location, Delete) below the window edge — unreachable. After mount we
  // measure the menu and shift it up/left so the whole thing stays on-screen (the standard
  // context-menu flip). Start at the cursor; correct on the first layout pass.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 4;
    // The 98 taskbar is a fixed bar at the bottom of the app, OUTSIDE this menu's stacking flow.
    // window.innerHeight includes the area it occupies, so clamping to innerHeight alone tucked the
    // menu's lowest items ("Set location…", "Delete") behind the taskbar. Reserve its height so the
    // whole menu sits above it. Read the live CSS var (fallback 32px) rather than hard-coding.
    const taskbar = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ga98-taskbar-height'), 10) || 32;
    const left = Math.max(pad, Math.min(x, window.innerWidth - width - pad));
    const top = Math.max(pad, Math.min(y, window.innerHeight - taskbar - height - pad));
    setPos({ left, top });
  }, [x, y]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
      <div ref={ref} className="ga98-menu" style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 100, background: '#c0c0c0', border: '2px outset #fff' }}>
        {([['add', 'Add to active square'], ['play', 'Play full-screen'], ['edit', 'Edit…'], ['setloc', 'Set location…'], ['delete', 'Delete'], ['resolve', 'Resolve host (IP/DNS)']] as [FeedAction, string][]).map(([a, label]) => (
          <div key={a} onClick={() => onPick(a)} style={{ padding: '3px 12px', cursor: 'pointer' }}>{label}</div>
        ))}
      </div>
    </>
  );
}
