/**
 * Boot splash — the Ghost Intel 98 startup screen, shown once on launch BEFORE the lock/login
 * screen, while the startup jingle plays (the Win98 "booting" moment), with a Win9x-style
 * scrolling loading bar (cosmetic/indeterminate — see theme.css). Overlays everything
 * (z above the lock screen) and dismisses itself after a short hold, or on click. The auth
 * check + settings load run underneath, so by the time the splash fades out the lock screen
 * (or desktop) is already mounted behind it — no flash.
 */
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../state/store';
import { playBoot, playLegacyStartup } from '../audio/synth';
import splash from '../assets/boot-splash.jpg';

const HOLD_MS = 3200; // fully-visible time — long enough to cover the startup jingle
const FADE_MS = 450; // opacity fade-out before the splash is removed

export function SplashScreen({ onDone }: { onDone: () => void }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const [hiding, setHiding] = useState(false);
  const soundPlayed = useRef(false);
  const dismissed = useRef(false);

  // Play the startup jingle as the splash appears (image + sound together), exactly once,
  // honouring the existing sound settings. Moved here from App so the chime is tied to the
  // boot splash rather than to the first settings load.
  useEffect(() => {
    if (soundPlayed.current || !settings) return;
    soundPlayed.current = true;
    if (settings.startupSoundEnabled && settings.soundEnabled) {
      if (settings.legacySounds) playLegacyStartup();
      else playBoot();
    }
  }, [settings]);

  // Fade then unmount. Guarded so the hold-timer and a click can't double-fire it.
  const dismiss = (): void => {
    if (dismissed.current) return;
    dismissed.current = true;
    setHiding(true);
    window.setTimeout(onDone, FADE_MS);
  };

  // Auto-dismiss after the hold.
  useEffect(() => {
    const hold = window.setTimeout(dismiss, HOLD_MS);
    return () => window.clearTimeout(hold);
    // dismiss is stable for our purposes (guarded by refs); bind the hold once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="ga98-splash"
      role="img"
      aria-label="Ghost Intel 98 startup"
      onClick={dismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: `#000 url(${JSON.stringify(splash)}) center / cover no-repeat`,
        opacity: hiding ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`
      }}
    >
      <div className="ga98-splash-loader" aria-hidden="true">
        <div className="ga98-splash-loader-label">Starting Ghost Intel 98…</div>
        <div className="ga98-splash-bar">
          <div className="ga98-splash-bar-fill" />
        </div>
      </div>
    </div>
  );
}
