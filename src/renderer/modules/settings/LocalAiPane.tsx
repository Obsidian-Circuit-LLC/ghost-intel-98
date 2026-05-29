/**
 * LocalAiPane — "Set up local AI" wizard for Settings → AI.
 * Derives display state from boolean fields (runtimeUp, modelPresent, bundled),
 * never from the `state` string.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocalAi } from '../../state/store';
import { toast } from '../../state/toasts';

function cleanError(msg: string): string {
  // Strip a leading "[channel-name] " prefix, the same approach SecurityPane uses.
  return msg.replace(/^\[[^\]]+\]\s*/, '');
}

export function LocalAiPane(): JSX.Element {
  const status   = useLocalAi((s) => s.status);
  const progress = useLocalAi((s) => s.progress);
  const refresh  = useLocalAi((s) => s.refresh);
  const setup    = useLocalAi((s) => s.setup);

  const [busy, setBusy] = useState(false);

  const doRefresh = useCallback(() => { void refresh(); }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  const doSetup = useCallback(async (mode: 'online' | 'bundled') => {
    setBusy(true);
    try {
      await setup(mode);
      toast.success('Local AI enabled.');
    } catch (err) {
      toast.error(cleanError((err as Error).message));
    } finally {
      setBusy(false);
    }
  }, [setup]);

  // Progress line shown while a setup is in flight.
  function ProgressLine(): JSX.Element | null {
    if (!busy || !progress) return null;
    const msg = (progress.receivedBytes != null && progress.totalBytes)
      ? `${Math.round((progress.receivedBytes / progress.totalBytes) * 100)}%`
      : (progress.message ?? 'Working…');
    return <p style={{ fontSize: 11, color: '#555', marginTop: 6 }}>{msg}</p>;
  }

  // Attribution line shown whenever a setup action is offered.
  const Attribution = (
    <p style={{ fontSize: 10, color: '#888', marginTop: 8 }}>
      Built with Llama. Llama&nbsp;3.1 is licensed under the Llama&nbsp;3.1 Community License,
      &copy;&nbsp;Meta Platforms,&nbsp;Inc.
    </p>
  );

  // --- null: still checking ---
  if (status === null) {
    return (
      <fieldset>
        <legend>Local AI</legend>
        <p style={{ margin: '4px 0' }}>Checking…</p>
      </fieldset>
    );
  }

  const { runtimeUp, modelPresent, bundled } = status;

  // --- runtime up + model present: fully ready ---
  if (runtimeUp && modelPresent) {
    return (
      <fieldset>
        <legend>Local AI</legend>
        <p style={{ margin: '4px 0', color: '#006400' }}>
          &#10003; Local AI is ready (llama3.1).
        </p>
        <div className="field-row" style={{ marginTop: 8 }}>
          <button onClick={doRefresh} disabled={busy}>Re-check</button>
        </div>
      </fieldset>
    );
  }

  // --- runtime up but model missing ---
  if (runtimeUp && !modelPresent) {
    return (
      <fieldset>
        <legend>Local AI</legend>
        <p style={{ margin: '4px 0' }}>
          A local Ollama is running but the llama3.1 model is not installed.
        </p>
        {!bundled && (
          <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
            Clicking "Install model" will download llama3.1 from the internet (a few GB, one time).
          </p>
        )}
        {Attribution}
        <div className="field-row" style={{ marginTop: 8 }}>
          <button
            onClick={() => void doSetup(bundled ? 'bundled' : 'online')}
            disabled={busy}
          >
            {busy ? 'Installing…' : 'Install model'}
          </button>
        </div>
        <ProgressLine />
      </fieldset>
    );
  }

  // --- runtime not up, bundled build ---
  if (!runtimeUp && bundled) {
    return (
      <fieldset>
        <legend>Local AI</legend>
        <p style={{ margin: '4px 0' }}>
          This build includes a bundled local AI. Click to enable.
        </p>
        {Attribution}
        <div className="field-row" style={{ marginTop: 8 }}>
          <button onClick={() => void doSetup('bundled')} disabled={busy}>
            {busy ? 'Enabling…' : 'Enable local AI'}
          </button>
        </div>
        <ProgressLine />
      </fieldset>
    );
  }

  // --- runtime not up, no bundled assets: guide the user to install the runtime ---
  // Automatic runtime download is not wired yet (it needs the pinned Ollama release from the
  // bundled-track work). Until then, installing Ollama is a one-click step; once it is running,
  // pressing Re-check moves to the "Install model" path above, which DOES pull llama3.1 and
  // configure the app automatically. Fully automatic / offline-bundled setup ships in a later build.
  return (
    <fieldset>
      <legend>Local AI</legend>
      <p style={{ margin: '4px 0' }}>
        Run AI features entirely on your machine, with no data sent to any cloud service.
      </p>
      <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
        No local runtime detected. Install Ollama (a free, one-click installer), then press
        <strong> Re-check</strong> — Ghost Access 98 will download the llama3.1 model and
        configure itself. (Fully automatic and offline-bundled setup arrive in a later build.)
      </p>
      {Attribution}
      <div className="field-row" style={{ marginTop: 8, gap: 6 }}>
        <button onClick={() => void window.api.system.openExternal('https://ollama.com/download')} disabled={busy}>
          Get Ollama
        </button>
        <button onClick={doRefresh} disabled={busy}>Re-check</button>
      </div>
      <ProgressLine />
    </fieldset>
  );
}
