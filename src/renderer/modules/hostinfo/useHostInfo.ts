import * as React from 'react';
import type { HostInfo } from '@shared/post-mvp-types';

/** On-demand host resolution: call run() (e.g. when a panel expands) → resolve via Tor (IPC). */
export function useHostInfo(streamUrl: string): { info: HostInfo | null; loading: boolean; run: (force?: boolean) => void } {
  const [info, setInfo] = React.useState<HostInfo | null>(null);
  const [loading, setLoading] = React.useState(false);
  const run = React.useCallback((force?: boolean) => {
    setLoading(true);
    void window.api.hostinfo.resolve(streamUrl, force ? { force: true } : undefined)
      .then((r) => setInfo(r as HostInfo))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [streamUrl]);
  return { info, loading, run };
}
