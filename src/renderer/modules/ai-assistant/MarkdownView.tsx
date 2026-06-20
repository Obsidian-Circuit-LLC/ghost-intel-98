/**
 * Renders the assistant-pane markdown AST as React elements. No dangerouslySetInnerHTML — all text
 * is rendered as React children, so any literal HTML in model output is escaped (no XSS).
 */
import type { ReactNode } from 'react';
import { parseMarkdown, type Inline } from './markdown';

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return <span key={i}>{n.v}</span>;
      case 'bold': return <strong key={i}>{renderInline(n.children)}</strong>;
      case 'italic': return <em key={i}>{renderInline(n.children)}</em>;
      case 'code': return <code key={i} style={{ fontFamily: 'monospace', background: '#eee', padding: '0 2px' }}>{n.v}</code>;
      default: { const _exhaustive: never = n; return _exhaustive; }
    }
  });
}

export function MarkdownView({ text }: { text: string }): JSX.Element {
  const blocks = parseMarkdown(text);
  return (
    <div style={{ fontSize: 13 }}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return <div key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>{renderInline(b.children)}</div>;
          case 'h':
            return <div key={i} style={{ fontWeight: 'bold', fontSize: b.level <= 2 ? 15 : 14, margin: '4px 0 2px' }}>{renderInline(b.children)}</div>;
          case 'ul':
            return <ul key={i} style={{ margin: '0 0 6px', paddingLeft: 20 }}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
          default: { const _exhaustive: never = b; return _exhaustive; }
        }
      })}
    </div>
  );
}
