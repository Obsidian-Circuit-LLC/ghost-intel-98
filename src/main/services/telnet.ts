/**
 * Minimal Telnet (RFC 854/855) option negotiation, enough for a usable interactive terminal:
 * agree to server ECHO + SGA (character-mode, server-side echo), refuse every other option,
 * and strip IAC command sequences out of the data stream so they don't render as garbage.
 * Stateful across socket chunks. The negotiation logic is pure + unit-tested; the socket
 * wiring lives in ssh.ts (the unified terminal-session layer).
 */
const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const OPT_ECHO = 1, OPT_SGA = 3;

export type TelnetPhase = 'data' | 'iac' | 'opt' | 'sb' | 'sb-iac';
export interface TelnetState { phase: TelnetPhase; cmd: number }

export function newTelnetState(): TelnetState {
  return { phase: 'data', cmd: 0 };
}

/** Feed a received chunk; returns the printable bytes to show and any negotiation bytes to
 *  send back to the server. */
export function processTelnet(state: TelnetState, chunk: Buffer): { out: Buffer; reply: Buffer } {
  const out: number[] = [];
  const reply: number[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const b = chunk[i];
    switch (state.phase) {
      case 'data':
        if (b === IAC) state.phase = 'iac';
        else out.push(b);
        break;
      case 'iac':
        if (b === IAC) { out.push(IAC); state.phase = 'data'; }          // escaped 0xFF literal
        else if (b === DO || b === DONT || b === WILL || b === WONT) { state.cmd = b; state.phase = 'opt'; }
        else if (b === SB) state.phase = 'sb';
        else state.phase = 'data';                                       // GA / NOP / etc. — ignore
        break;
      case 'opt': {
        const cmd = state.cmd;
        const opt = b;
        state.phase = 'data';
        if (cmd === WILL) reply.push(IAC, (opt === OPT_ECHO || opt === OPT_SGA) ? DO : DONT, opt);
        else if (cmd === DO) reply.push(IAC, opt === OPT_SGA ? WILL : WONT, opt);
        // DONT / WONT from the server: accept silently (no reply needed).
        break;
      }
      case 'sb':
        if (b === IAC) state.phase = 'sb-iac';
        break;
      case 'sb-iac':
        state.phase = b === SE ? 'data' : 'sb';
        break;
    }
  }
  return { out: Buffer.from(out), reply: Buffer.from(reply) };
}

/** Escape IAC (0xFF) in outbound user input per RFC 854. */
export function escapeTelnetOutput(buf: Buffer): Buffer {
  if (!buf.includes(IAC)) return buf;
  const esc: number[] = [];
  for (const b of buf) { esc.push(b); if (b === IAC) esc.push(IAC); }
  return Buffer.from(esc);
}
