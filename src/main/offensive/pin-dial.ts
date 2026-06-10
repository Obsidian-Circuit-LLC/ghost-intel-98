import { lookup as dnsLookup } from 'node:dns/promises';
import { connect, type Socket } from 'node:net';

type LookupFn = (host: string, opts: { all: true }) => Promise<{ address: string; family: number }[]>;

export async function resolveAll(host: string, lookup: LookupFn = dnsLookup as unknown as LookupFn): Promise<string[]> {
  const recs = await lookup(host, { all: true });
  return recs.map((r) => r.address);
}

export function dialPinned(ip: string, port: number, timeoutMs = 15000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: ip, port });
    const onErr = (e: Error): void => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => onErr(new Error('dial timeout')));
    sock.once('error', onErr);
    sock.once('connect', () => { sock.setTimeout(0); sock.removeListener('error', onErr); resolve(sock); });
  });
}
