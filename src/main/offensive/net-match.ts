import { isIP } from 'node:net';

export function normalizeIp(ip: string): string {
  let s = ip.trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (m) return m[1];
  return s;
}

function ipv4ToBig(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function ipv6ToBig(ip: string): bigint | null {
  if (ip.indexOf('::') !== ip.lastIndexOf('::')) return null;
  let head: string[] = [], tail: string[] = [];
  if (ip.includes('::')) {
    const [h, t] = ip.split('::');
    head = h ? h.split(':') : [];
    tail = t ? t.split(':') : [];
  } else {
    head = ip.split(':');
  }
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) return null;
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}

function ipToBig(ip: string): { v: bigint; bits: 32 | 128 } | null {
  const n = normalizeIp(ip);
  const fam = isIP(n);
  if (fam === 4) { const v = ipv4ToBig(n); return v === null ? null : { v, bits: 32 }; }
  if (fam === 6) { const v = ipv6ToBig(n); return v === null ? null : { v, bits: 128 }; }
  return null;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.lastIndexOf('/');
  if (slash < 0) return false;
  const base = ipToBig(cidr.slice(0, slash));
  const prefix = Number(cidr.slice(slash + 1));
  const target = ipToBig(ip);
  if (!base || !target || base.bits !== target.bits) return false;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > base.bits) return false;
  const shift = BigInt(base.bits - prefix);
  return (base.v >> shift) === (target.v >> shift);
}
