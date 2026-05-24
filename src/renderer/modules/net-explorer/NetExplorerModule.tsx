/**
 * Net Explorer — internal browser using Electron's <webview> tag.
 * Address bar, back/forward/reload, and "save URL to current case" action.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaseSummary } from '@shared/types';
import { useSettings } from '../../state/store';

interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  getTitle(): string;
}

export function NetExplorerModule(): JSX.Element {
  const homepage = useSettings((s) => s.settings?.browser.homepage ?? 'about:blank');
  const [address, setAddress] = useState(homepage);
  const [currentUrl, setCurrentUrl] = useState(homepage);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [saveCase, setSaveCase] = useState('');
  const ref = useRef<WebviewElement | null>(null);

  useEffect(() => {
    void window.api.cases.list().then(setCases);
  }, []);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const onStart = (): void => setLoading(true);
    const onStop = (): void => setLoading(false);
    const onNav = (e: Event & { url?: string }): void => {
      const u = e.url ?? wv.getURL();
      setCurrentUrl(u);
      setAddress(u);
    };
    const onTitle = (e: Event & { title?: string }): void => setTitle(e.title ?? wv.getTitle());
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-navigate', onNav as EventListener);
    wv.addEventListener('did-navigate-in-page', onNav as EventListener);
    wv.addEventListener('page-title-updated', onTitle as EventListener);
    return () => {
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-navigate', onNav as EventListener);
      wv.removeEventListener('did-navigate-in-page', onNav as EventListener);
      wv.removeEventListener('page-title-updated', onTitle as EventListener);
    };
  }, []);

  const go = useCallback((u?: string) => {
    const wv = ref.current;
    if (!wv) return;
    const normalised = (u ?? address).match(/^https?:\/\//i) ? (u ?? address) : `https://${u ?? address}`;
    wv.src = normalised;
    setCurrentUrl(normalised);
  }, [address]);

  async function saveToCase(): Promise<void> {
    if (!saveCase) return;
    await window.api.cases.addLink(saveCase, currentUrl, title || currentUrl);
    alert('Link added to case.');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={() => ref.current?.goBack()}>‹</button>
        <button onClick={() => ref.current?.goForward()}>›</button>
        <button onClick={() => ref.current?.reload()}>↻</button>
        <input
          className="ga98-text"
          style={{ flex: 1 }}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        />
        <button onClick={() => go()}>Go</button>
        <select className="ga98-text" value={saveCase} onChange={(e) => setSaveCase(e.target.value)}>
          <option value="">(select case…)</option>
          {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button onClick={() => void saveToCase()} disabled={!saveCase}>Save URL to case</button>
      </div>
      <div style={{ flex: 1, background: '#fff', position: 'relative' }}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {(() => {
          // <webview> isn't in React's JSX intrinsics — use createElement with allowpopups disabled
          // to avoid TypeScript griping while keeping the actual tag.
          return (
            <webview
              ref={ref as unknown as React.RefObject<HTMLElement>}
              src={homepage}
              style={{ width: '100%', height: '100%', display: 'inline-flex' }}
              // @ts-expect-error: webview attributes aren't in React typings
              allowpopups="true"
              partition="persist:netexplorer"
            />
          );
        })()}
      </div>
      <div className="ga98-statusbar">
        <span>{loading ? 'Loading…' : 'Idle'}</span>
        <span style={{ flex: 1 }} />
        <span>{currentUrl}</span>
      </div>
    </div>
  );
}
