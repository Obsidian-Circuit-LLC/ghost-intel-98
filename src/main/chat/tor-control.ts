/**
 * Minimal Tor control-protocol codec (control-spec) — pure command builders + reply parser, no
 * sockets. transport-tor.ts opens the control port, authenticates, and publishes/keeps a v3 onion
 * service with these. Unit-testable in isolation.
 *
 * The onion address is the user's stable network locator (it's in the invite + reused on reconnect),
 * so the service key is PERSISTED (ADD_ONION returns the key on first creation; later launches reload
 * it with ADD_ONION ED25519-V3:<key>). The key is stored vault-sealed by the engine, not here.
 */

export class TorControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TorControlError';
  }
}

const CRLF = '\r\n';

/** AUTHENTICATE using the hex of the control cookie file. */
export function buildAuthenticate(cookieHex: string): string {
  if (!/^[0-9a-fA-F]*$/.test(cookieHex)) throw new TorControlError('cookie must be hex');
  return `AUTHENTICATE ${cookieHex}${CRLF}`;
}

/** Create a NEW ephemeral v3 onion forwarding `virtPort` → `targetHost:targetPort`. The reply
 *  carries ServiceID (+ PrivateKey, which the caller persists). */
export function buildAddOnionNew(virtPort: number, targetHost: string, targetPort: number): string {
  validatePort(virtPort, 'virtPort');
  validatePort(targetPort, 'targetPort');
  return `ADD_ONION NEW:ED25519-V3 Port=${virtPort},${targetHost}:${targetPort}${CRLF}`;
}

/** Re-publish a previously-created onion from its stored key blob (no DiscardPK — we already have it). */
export function buildAddOnionFromKey(keyBlob: string, virtPort: number, targetHost: string, targetPort: number): string {
  validatePort(virtPort, 'virtPort');
  validatePort(targetPort, 'targetPort');
  if (!/^ED25519-V3:[A-Za-z0-9+/=]+$/.test(keyBlob)) throw new TorControlError('bad onion key blob');
  return `ADD_ONION ${keyBlob} Port=${virtPort},${targetHost}:${targetPort}${CRLF}`;
}

function validatePort(p: number, name: string): void {
  if (!Number.isInteger(p) || p < 1 || p > 0xffff) throw new TorControlError(`bad ${name}`);
}

export interface ControlReply {
  code: number;
  /** Data lines (the text after `<code>-` or `<code> `), in order. */
  lines: string[];
  ok: boolean; // 2xx
}

/**
 * Parse ONE complete control reply from `text`. Tor replies are sequences of `NNN-line` (mid) /
 * `NNN+line` (data block) ending in `NNN line` (final). Returns null if the reply isn't complete yet.
 */
export function parseReply(text: string): ControlReply | null {
  const lines = text.split(CRLF);
  // The final line is `NNN ...`; if we don't have a terminated final line yet, wait.
  let finalIdx = -1;
  for (let i = 0; i < lines.length - 1; i += 1) {
    // a line is "final" when its 4th char is a space (mid uses '-', data uses '+')
    if (/^\d{3} /.test(lines[i])) {
      finalIdx = i;
      break;
    }
  }
  if (finalIdx === -1) return null;
  const code = parseInt(lines[finalIdx].slice(0, 3), 10);
  const data: string[] = [];
  for (let i = 0; i <= finalIdx; i += 1) {
    const l = lines[i];
    if (/^\d{3}[-+ ]/.test(l)) data.push(l.slice(4));
    else data.push(l); // continuation of a data block
  }
  return { code, lines: data, ok: code >= 200 && code < 300 };
}

/** Extract ServiceID and (when present) PrivateKey from an ADD_ONION reply's data lines. */
export function parseAddOnionResult(reply: ControlReply): { serviceId: string; privateKey?: string } {
  if (!reply.ok) throw new TorControlError(`ADD_ONION failed: ${reply.code} ${reply.lines.join(' ')}`);
  let serviceId: string | undefined;
  let privateKey: string | undefined;
  for (const l of reply.lines) {
    if (l.startsWith('ServiceID=')) serviceId = l.slice('ServiceID='.length).trim();
    else if (l.startsWith('PrivateKey=')) privateKey = l.slice('PrivateKey='.length).trim();
  }
  if (!serviceId) throw new TorControlError('ADD_ONION reply missing ServiceID');
  return { serviceId, ...(privateKey ? { privateKey } : {}) };
}
