/**
 * Tiny single-process async mutex. Serialises read-modify-write spans against the same key.
 *
 * v1.0.1 fix: previous version compared `locks.get(key) === prev.then(()=>next)`,
 * but `prev.then(...)` constructs a new Promise on each call — `===` was always false,
 * the Map never shrunk, and every key ever locked stayed there forever. We now capture
 * the tail Promise explicitly and compare against it.
 */

const locks = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  const tail = prev.then(() => gate);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Only clear the slot if nothing else queued behind us in the meantime.
    if (locks.get(key) === tail) locks.delete(key);
  }
}
