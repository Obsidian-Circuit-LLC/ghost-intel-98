import { useEffect, useState } from 'react';

const cache = new Map<string, string | null>();

/** Lazily resolve bundled favicons for a set of site names. Returns a name→dataUri|null map. */
export function useFavicons(names: string[]): Record<string, string | null> {
  const [map, setMap] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    const missing = names.filter((n) => !cache.has(n));
    if (missing.length === 0) { setMap(Object.fromEntries(names.map((n) => [n, cache.get(n) ?? null]))); return; }
    (async () => {
      await Promise.all(missing.map(async (n) => { cache.set(n, await window.api.searchlight.favicon(n)); }));
      if (alive) setMap(Object.fromEntries(names.map((n) => [n, cache.get(n) ?? null])));
    })();
    return () => { alive = false; };
  }, [names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}
