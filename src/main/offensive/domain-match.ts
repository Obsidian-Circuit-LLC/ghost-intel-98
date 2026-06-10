export function normalizeHost(host: string): string {
  let s = host.trim().toLowerCase();
  if (s.endsWith('.')) s = s.slice(0, -1);
  try {
    return new URL(`http://${s}`).hostname;
  } catch {
    return s;
  }
}

export function domainRuleMatches(rule: string, host: string): boolean {
  const h = normalizeHost(host).split('.').filter(Boolean);
  if (rule.startsWith('*.')) {
    const base = normalizeHost(rule.slice(2)).split('.').filter(Boolean);
    if (base.length === 0 || h.length <= base.length) return false;
    const suffix = h.slice(h.length - base.length);
    return suffix.length === base.length && suffix.every((l, i) => l === base[i]);
  }
  if (rule.includes('*')) return false;
  const r = normalizeHost(rule).split('.').filter(Boolean);
  return r.length === h.length && r.every((l, i) => l === h[i]);
}
