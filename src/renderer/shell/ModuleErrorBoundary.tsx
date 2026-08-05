/**
 * Render error boundary around a single module's tree in the shell's host slot. A throw
 * during a module's render or mount (a poisoned prop, a bad lazy import, a component bug)
 * would otherwise unwind past ModuleHost and white-screen the whole desktop with no way
 * out. This catches it and shows a CONTAINED Win98-styled panel with the actual error
 * message and a Close/dismiss affordance, instead of rethrowing.
 *
 * The captured error stays ON-DEVICE — it is not logged off-box, sent, or persisted (no
 * telemetry). console.warn is the only trace, so the message the user reads back is the
 * diagnostic surface. Modeled on modules/geoint/MapErrorBoundary.tsx.
 *
 * Recovery: `moduleKey` identifies which module occupies the slot. When it changes (the
 * user opens a DIFFERENT module in the same host), the error state resets so the new
 * module mounts clean rather than inheriting the previous crash's fallback.
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  moduleKey: string;
  /** When provided (by ModuleHost), the fallback offers a real "Close window" action that
   *  tears down the host window. Without it, only "Retry" is shown. This is what makes the
   *  Close affordance actually close a deterministically-crashing tool instead of merely
   *  clearing the error and re-throwing on the next render. */
  onClose?: () => void;
}

interface State {
  hasError: boolean;
  message: string;
  key: string;
}

export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', key: this.props.moduleKey };

  static getDerivedStateFromError(err: unknown): Partial<State> {
    const e = err as { message?: unknown };
    return {
      hasError: true,
      message: typeof e?.message === 'string' ? e.message : String(err)
    };
  }

  // Reset the error when the module occupying this slot changes. Deriving from props keeps
  // the reset in the same render pass the new module mounts in, so it never briefly shows
  // the stale fallback for the newly-opened module.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.moduleKey !== state.key) {
      return { hasError: false, message: '', key: props.moduleKey };
    }
    return null;
  }

  componentDidCatch(err: unknown): void {
    // On-device only. No off-box logging, no telemetry — console.warn is the sole trace.
    const e = err as { message?: unknown };
    console.warn(
      '[ModuleErrorBoundary] module render crashed:',
      typeof e?.message === 'string' ? e.message : String(err)
    );
  }

  // "Retry" — clear the error and re-attempt render. Recovers a transient failure; for a
  // deterministic crash the child throws again and the panel returns (an honest retry).
  retry = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="window ga98-dialog-window" role="alert" style={{ margin: 12, maxWidth: '100%' }}>
        <div className="title-bar">
          <div className="title-bar-text">Module error</div>
        </div>
        <div className="window-body" style={{ padding: 12 }}>
          <p style={{ marginTop: 0 }}>This tool failed to load.</p>
          {this.state.message && (
            <code
              style={{
                display: 'block',
                // Parity-exact purpose tokens mirroring MapErrorBoundary (this boundary was modeled
                // on it): the ORIGINAL classic literals were bg #fee / text #900 / border #c99. Routing
                // to the LOCKED status tier (#9a1621) had shifted the classic text+border hue; these
                // three tokens carry the byte-exact classic literal and an amethyst-legible variant.
                background: 'var(--ga98-error-surface)',
                color: 'var(--ga98-danger-ink)',
                border: '1px solid var(--ga98-error-border-soft)',
                padding: '2px 6px',
                fontSize: 11,
                maxWidth: '100%',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {this.state.message}
            </code>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
            <button onClick={this.retry}>Retry</button>
            {this.props.onClose && <button onClick={this.props.onClose}>Close window</button>}
          </div>
        </div>
      </div>
    );
  }
}
