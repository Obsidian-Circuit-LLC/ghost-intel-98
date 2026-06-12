import { useCallback, useRef, useState } from 'react';

export const MAX_LIVE = 9;

/** Pure: given visible ids in most-recently-visible-first order, return the ≤max unique ids to keep live. */
export function admit(mruVisible: string[], max: number = MAX_LIVE): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of mruVisible) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Tracks which tiles are visible (MRU order) and exposes a stable `isLive(id)` capped at `max`. */
export function useLivePlayerBudget(max: number = MAX_LIVE): {
  setVisible: (id: string, visible: boolean) => void;
  isLive: (id: string) => boolean;
} {
  const orderRef = useRef<string[]>([]);
  const [live, setLive] = useState<string[]>([]);
  const setVisible = useCallback((id: string, visible: boolean) => {
    const next = orderRef.current.filter((x) => x !== id);
    if (visible) next.unshift(id);
    orderRef.current = next;
    setLive(admit(next, max));
  }, [max]);
  const isLive = useCallback((id: string) => live.includes(id), [live]);
  return { setVisible, isLive };
}
