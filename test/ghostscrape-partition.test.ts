/**
 * GhostScrape Task 1 (v3.27.0 W3): per-job non-persistent session partition.
 *
 * Each scrape job runs in its OWN in-memory Electron session partition
 * (`ghostscrape-<jobId>`, NO `persist:` prefix → GC'd when the job window
 * closes) instead of the shared `persist:ghostscrape` jar. This closes the
 * credential race where concurrent jobs shared one cookie jar.
 *
 * partitionForJob is the pure helper under test: distinct jobIds must yield
 * distinct partition strings, and the string must never be persistent.
 */

import { describe, it, expect } from 'vitest';
import { partitionForJob } from '../src/main/x/ghostscrape/browser';

describe('partitionForJob', () => {
  it('derives the partition name from the jobId', () => {
    expect(partitionForJob('abc123')).toBe('ghostscrape-abc123');
  });

  it('yields distinct partitions for two distinct jobIds', () => {
    const a = partitionForJob('job-A');
    const b = partitionForJob('job-B');
    expect(a).not.toBe(b);
  });

  it('is NON-persistent — never carries the persist: prefix', () => {
    // A `persist:` prefix would give Electron an on-disk jar shared across
    // jobs — exactly the leak this task removes.
    expect(partitionForJob('anything')).not.toMatch(/^persist:/);
  });
});
