// src/renderer/modules/eyespy/LocationTree.tsx
import { useState } from 'react';
import type { TreeNode } from './tree';

export function LocationTree({ nodes, selectedKey, query, onQuery, onSelect }: {
  nodes: TreeNode[];
  selectedKey: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (node: TreeNode | null) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <input className="ga98-text" placeholder="Search countries, cities, cameras…" value={query}
        onChange={(e) => onQuery(e.target.value)} style={{ margin: 4 }} />
      <div className="ga98-list" style={{ flex: 1, overflow: 'auto' }}>
        <div data-selected={selectedKey === null} onClick={() => onSelect(null)} style={{ cursor: 'pointer', padding: '2px 6px', fontWeight: 600 }}>
          All cameras
        </div>
        {nodes.map((n) => <Row key={n.key} node={n} depth={0} selectedKey={selectedKey} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

function Row({ node, depth, selectedKey, onSelect }: {
  node: TreeNode; depth: number; selectedKey: string | null; onSelect: (n: TreeNode) => void;
}): JSX.Element {
  const [open, setOpen] = useState(depth === 0);
  const hasKids = node.children.length > 0;
  return (
    <div>
      <div data-selected={selectedKey === node.key}
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '2px 6px', paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(node)}>
        {hasKids
          ? <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ width: 14, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
          : <span style={{ width: 14, display: 'inline-block' }} />}
        <span style={{ flex: 1 }}>{node.label}</span>
        <span style={{ fontSize: 10, opacity: 0.65 }}>{node.count}</span>
      </div>
      {open && hasKids && node.children.map((c) => <Row key={c.key} node={c} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect} />)}
    </div>
  );
}
