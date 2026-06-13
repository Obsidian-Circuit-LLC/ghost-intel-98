/**
 * Render error boundary around the GeoINT map. A throw inside the Leaflet map tree (a poisoned
 * cached item set, a tile/layer failure) would otherwise white-screen the whole module with no
 * way out. This catches it and shows a Win98-styled fallback with a single recovery action:
 * purge GeoINT state and reload. The purge is the same flow the Sources button runs.
 */

import { Component, type ReactNode } from 'react';

export class MapErrorBoundary extends Component<
  { children: ReactNode; onPurge: () => void | Promise<void> },
  { hasError: boolean; purging: boolean; message: string; stack: string }
> {
  state = { hasError: false, purging: false, message: '', stack: '' };

  static getDerivedStateFromError(err: unknown): { hasError: boolean; message: string; stack: string } {
    // Capture the actual error so the recovery UI can SHOW it. This stays ON-DEVICE — it is not
    // logged, sent, or persisted anywhere (no telemetry). Surfacing it is what lets a field report
    // include the real exception instead of a generic "the map broke", which is how a crash that
    // can't be reproduced off the user's machine actually gets diagnosed.
    const e = err as { message?: unknown; stack?: unknown };
    return {
      hasError: true,
      message: typeof e?.message === 'string' ? e.message : String(err),
      stack: typeof e?.stack === 'string' ? e.stack : ''
    };
  }

  componentDidCatch(): void {
    // Intentionally no off-device logging. The fallback UI (with the captured message) is the only
    // surface; the user can read it back to us. Nothing leaves the machine.
  }

  // Keep hasError TRUE until onPurge resolves. Clearing it first re-mounts the children
  // against still-poisoned data before the purge lands; React can treat a throw during that
  // recovery commit as an unrecoverable teardown. onPurge bumps the inner remount key, so by
  // the time hasError clears the children mount fresh against the already-purged state.
  handlePurge = async (): Promise<void> => {
    this.setState({ purging: true });
    try {
      await this.props.onPurge();
    } finally {
      this.setState({ hasError: false, purging: false });
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', fontSize: 12, maxWidth: '100%' }}>
        <p style={{ margin: 0 }}>The map hit an error.</p>
        {this.state.message && (
          <code style={{ background: '#fee', color: '#900', border: '1px solid #c99', padding: '2px 6px', fontSize: 11, maxWidth: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.message}
          </code>
        )}
        <button onClick={() => void this.handlePurge()} disabled={this.state.purging}>
          {this.state.purging ? 'Purging…' : 'Reset GeoINT (purge cache + tiles) & reload'}
        </button>
        {this.state.stack && (
          <details style={{ fontSize: 10, color: '#555', maxWidth: '100%' }}>
            <summary style={{ cursor: 'pointer' }}>Show error details (stays on this device)</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '4px 0 0', maxHeight: 180, overflow: 'auto' }}>{this.state.stack}</pre>
          </details>
        )}
      </div>
    );
  }
}
