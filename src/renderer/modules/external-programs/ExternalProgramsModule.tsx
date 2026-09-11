/**
 * Program Manager — "Manage Programs" from the Access menu's External Apps flyout.
 *
 * GhostExodus's ask, verbatim: a button that opens a folder (like Firefox Portable), users drop
 * executables into it, and Ghost Intel 98 indexes them so ANY app can be connected. This screen is
 * the indexed view: it never launches anything on its own (nothing here runs just because a scan
 * found it — see `externalPrograms/service.ts`), it only lists what the main process found and
 * lets the analyst launch one deliberately, open the drop folder, or force a re-scan.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ExternalProgramsScanResult } from '@shared/external-programs/types';
import { toast } from '../../state/toasts';

const EMPTY: ExternalProgramsScanResult = { programs: [], diagnostics: [] };

export function ExternalProgramsModule(): JSX.Element {
  const [scan, setScan] = useState<ExternalProgramsScanResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const load = useCallback(async (fn: () => Promise<ExternalProgramsScanResult>) => {
    setLoading(true);
    try {
      setScan(await fn());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(() => window.api.externalPrograms.list()); }, [load]);

  async function launch(id: string, name: string): Promise<void> {
    setLaunchingId(id);
    try {
      await window.api.externalPrograms.launch(id);
      toast.success(`Launched ${name}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunchingId(null);
    }
  }

  async function openFolder(): Promise<void> {
    try {
      await window.api.externalPrograms.openFolder();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="ga98-window-shell" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => { void openFolder(); }}>Open Programs Folder</button>
        <button type="button" disabled={loading} onClick={() => { void load(() => window.api.externalPrograms.refresh()); }}>
          {loading ? 'Refreshing…' : 'Refresh Programs'}
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--ga98-dim-soft)', padding: '0 6px' }}>
        Drop any .exe, .bat or .cmd (or a folder with an app.json) into the Programs folder and click Refresh — nothing
        here runs on its own just because it was found.
      </p>

      <div className="ga98-pane" style={{ flex: 1, overflow: 'auto', padding: 6 }}>
        {scan.programs.length === 0 && (
          <p style={{ color: 'var(--ga98-dim-soft)', fontSize: 11 }}>
            No programs found yet. Click "Open Programs Folder" and drop one in, then Refresh Programs.
          </p>
        )}
        <ul className="ga98-list" style={{ margin: 0 }}>
          {scan.programs.map((p) => (
            <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <strong>{p.name}</strong>
                {p.category && <span style={{ color: 'var(--ga98-dim-soft)' }}> · {p.category}</span>}
                <div style={{ fontSize: 11, color: 'var(--ga98-dim-soft)' }}>
                  {p.executableName}{p.description ? ` — ${p.description}` : ''}
                </div>
              </div>
              <button type="button" disabled={launchingId === p.id} onClick={() => { void launch(p.id, p.name); }}>
                {launchingId === p.id ? '…' : 'Launch'}
              </button>
            </li>
          ))}
        </ul>

        {scan.diagnostics.length > 0 && (
          <fieldset style={{ marginTop: 10 }}>
            <legend>Skipped</legend>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--ga98-warn)' }}>
              {scan.diagnostics.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </fieldset>
        )}
      </div>
    </div>
  );
}
