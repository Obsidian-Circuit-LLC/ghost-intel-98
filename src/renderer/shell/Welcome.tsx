/**
 * First-run welcome flow. Three-step intro shown when settings.hasSeenWelcome === false.
 */

import { useState } from 'react';
import { useSettings } from '../state/store';
import { toast } from '../state/toasts';
import logoUrl from '../assets/logo.png';

const STEPS = [
  {
    title: 'Welcome to Ghost Intel 98',
    body: (
      <>
        <p>This is a Windows 98–inspired case-management desktop. Twelve modules covering case files, mail, browser, SSH, camera streams, AI assistance, and more — all local-first, no telemetry, no phone-home.</p>
        <p style={{ fontSize: 11, color: '#444' }}>Three-step intro. Click <b>Next</b> to continue or <b>Skip</b> to dismiss.</p>
      </>
    )
  },
  {
    title: 'Open programs from the Access menu',
    body: (
      <>
        <p>Click <b>Access</b> in the bottom-left to open the start menu. Every module is in there — My Cases, Notepad 98, Jukebox, GeoINT, Calendar, Mail, DialTerm (SSH), Net Explorer, EyeSpy, AI Assistant.</p>
        <p>You can also double-click desktop icons. Edit the menu from <b>Settings → Shortcuts</b> to add your own web-link shortcuts.</p>
      </>
    )
  },
  {
    title: 'A few keyboard shortcuts to know',
    body: (
      <>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li><kbd>Ctrl/⌘ + N</kbd> — New (case if Cases focused; note if Notepad focused)</li>
          <li><kbd>Ctrl/⌘ + S</kbd> — Save (Notepad)</li>
          <li><kbd>Ctrl/⌘ + W</kbd> — Close the focused window</li>
          <li><kbd>Ctrl/⌘ + Tab</kbd> — Cycle windows</li>
          <li><kbd>F1</kbd> — Open Settings</li>
        </ul>
        <p style={{ marginTop: 8 }}>You can drag files from Windows Explorer onto a case to attach them. Mail and AI credentials are encrypted by your OS keyring. Open <b>RTFM</b> from the Access menu any time for the full reference.</p>
      </>
    )
  }
];

export function Welcome(): JSX.Element | null {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const [step, setStep] = useState(0);
  const [persisting, setPersisting] = useState(false);
  const [dismissedLocally, setDismissedLocally] = useState(false);

  if (!settings || settings.hasSeenWelcome || dismissedLocally) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  async function persist(): Promise<void> {
    setPersisting(true);
    try {
      await patch({ hasSeenWelcome: true });
    } catch (err) {
      toast.error(
        `Could not save preference: ${(err as Error).message}. Welcome will return on next launch until disk space / permissions are fixed.`
      );
      // Round-3 audit fix: dismiss locally even on persist failure so the user
      // isn't stuck in a dead-loop staring at a welcome they keep "dismissing".
      setDismissedLocally(true);
    } finally {
      setPersisting(false);
    }
  }

  async function next(): Promise<void> {
    if (isLast) {
      await persist();
      return;
    }
    setStep(step + 1);
  }

  async function skip(): Promise<void> {
    await persist();
  }

  return (
    <div className="ga98-welcome-overlay">
      <div className="window ga98-welcome-window">
        <div className="title-bar">
          <div className="title-bar-text">Welcome — step {step + 1} of {STEPS.length}</div>
        </div>
        <div className="window-body" style={{ display: 'flex', gap: 16, padding: 16 }}>
          <img src={logoUrl} alt="" style={{ width: 96, height: 96, imageRendering: 'pixelated', alignSelf: 'flex-start' }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ marginTop: 0 }}>{current.title}</h3>
            {current.body}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #808080', justifyContent: 'flex-end' }}>
          <button onClick={() => void skip()} disabled={persisting}>Skip</button>
          <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || persisting}>‹ Back</button>
          <button onClick={() => void next()} disabled={persisting} autoFocus>{isLast ? (persisting ? 'Saving…' : 'Finish') : 'Next ›'}</button>
        </div>
      </div>
    </div>
  );
}
