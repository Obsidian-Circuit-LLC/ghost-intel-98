/**
 * Renders the assistant-pane markdown AST as React elements. No dangerouslySetInnerHTML — all text
 * is rendered as React children, so any literal HTML in model output is escaped (no XSS).
 */
import type { CSSProperties, ReactNode } from 'react';
import { parseMarkdown, type Inline } from './markdown';
import { safeHref } from '../../util/safe-href';

const LINK_STYLE: CSSProperties = { color: '#0000cc', textDecoration: 'underline' };

/** Callback invoked when a link is clicked. The URL passed has already been through safeHref. */
type OnLinkClick = (safeUrl: string) => void;

function renderInline(nodes: Inline[], onLinkClick?: OnLinkClick): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return <span key={i}>{n.v}</span>;
      case 'bold': return <strong key={i}>{renderInline(n.children, onLinkClick)}</strong>;
      case 'italic': return <em key={i}>{renderInline(n.children, onLinkClick)}</em>;
      case 'code': return <code key={i} style={{ fontFamily: 'monospace', background: '#eee', padding: '0 2px' }}>{n.v}</code>;
      case 'link': {
        // safeHref is the SINGLE render-time choke-point: a non-http/https or userinfo-bearing
        // href renders as INERT TEXT (no anchor), so a hostile [x](javascript:…) is never navigable.
        const safe = safeHref(n.href);
        if (safe === null) return <span key={i}>{renderInline(n.children, onLinkClick)}</span>;
        // Real href gives hover-preview + right-click Copy-Link; preventDefault stops in-app
        // renderer navigation, and the click is routed to onLinkClick (the clearnet-ack open policy).
        //
        // onAuxClick guards the MIDDLE-CLICK (mouse-wheel) vector: a middle click fires `auxclick`,
        // NOT `click`, so onClick never runs. Left unguarded, Chromium issues a new-window request
        // for the real href, which Electron routes to the main window's setWindowOpenHandler — that
        // handler calls shell.openExternal directly, opening the URL over the CLEARNET with the
        // operator's real IP and NO clearnet-ack consent, silently skipping the entire OpSec gate.
        // preventDefault cancels that new-window request; the middle button (1) then routes through
        // the same clearnet-ack open policy as a left click so behaviour is consistent and gated.
        return (
          <a
            key={i}
            href={safe}
            title={`${safe} — opens in your clearnet browser`}
            onClick={(e) => { e.preventDefault(); onLinkClick?.(safe); }}
            onAuxClick={(e) => { e.preventDefault(); if (e.button === 1) onLinkClick?.(safe); }}
            style={LINK_STYLE}
          >
            {renderInline(n.children, onLinkClick)}
            <span aria-hidden>↗</span>
          </a>
        );
      }
      default: { const _exhaustive: never = n; return _exhaustive; }
    }
  });
}

export function MarkdownView({ text, onLinkClick }: { text: string; onLinkClick?: OnLinkClick }): JSX.Element {
  const blocks = parseMarkdown(text);
  return (
    <div style={{ fontSize: 13 }}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return <div key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>{renderInline(b.children, onLinkClick)}</div>;
          case 'h':
            return <div key={i} style={{ fontWeight: 'bold', fontSize: b.level <= 2 ? 15 : 14, margin: '4px 0 2px' }}>{renderInline(b.children, onLinkClick)}</div>;
          case 'ul':
            return <ul key={i} style={{ margin: '0 0 6px', paddingLeft: 20 }}>{b.items.map((it, j) => <li key={j}>{renderInline(it, onLinkClick)}</li>)}</ul>;
          default: { const _exhaustive: never = b; return _exhaustive; }
        }
      })}
    </div>
  );
}
