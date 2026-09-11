import { describe, it, expect } from 'vitest';
import { cleanIpcErrorMessage } from '../src/renderer/modules/spectre/SpectreModule';

describe('Spectre error toast — strips the IPC bridge framing', () => {
  it('removes both wrapper layers, leaving only the reason a main-process handler threw', () => {
    // FIELD BUG, confirmed on video: this exact raw string is what rendered in the error toast
    // when a Tor-blocked query failed — the analyst read "Error invoking remote method..." as the
    // whole message, not the actual reason underneath it.
    const raw = "Error invoking remote method 'spectre:query': Error: [spectre:query] Tor is not ready — Spectre is blocked (no clearnet fallback). Open Spectre's own Settings tab (next to Map Search) and enable clearnet to use your real IP.";
    expect(cleanIpcErrorMessage(raw)).toBe(
      "Tor is not ready — Spectre is blocked (no clearnet fallback). Open Spectre's own Settings tab (next to Map Search) and enable clearnet to use your real IP.",
    );
  });

  it('leaves an already-plain message untouched', () => {
    expect(cleanIpcErrorMessage('Enter a place name or a "lat, lon" pair.')).toBe('Enter a place name or a "lat, lon" pair.');
  });
});
