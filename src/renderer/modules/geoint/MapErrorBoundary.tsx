/**
 * Render error boundary around the GeoINT map. A throw inside the Leaflet map tree (a poisoned
 * cached item set, a tile/layer failure) would otherwise white-screen the whole module with no
 * way out. This catches it and shows a Win98-styled fallback with a single recovery action:
 * purge GeoINT state and reload. The purge is the same flow the Sources button runs.
 */

import { Component, type ReactNode } from 'react';

export class MapErrorBoundary extends Component<
  { children: ReactNode; onPurge: () => void | Promise<void> },
  { hasError: boolean; purging: boolean }
> {
  state = { hasError: false, purging: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Swallow — the fallback UI is the recovery surface; nothing is logged off-device.
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
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
        <p style={{ margin: 0 }}>The map hit an error.</p>
        <button onClick={() => void this.handlePurge()} disabled={this.state.purging}>
          {this.state.purging ? 'Purging…' : 'Purge GeoINT cache & reload'}
        </button>
      </div>
    );
  }
}
