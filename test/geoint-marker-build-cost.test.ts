// @vitest-environment jsdom
/**
 * GeoINT marker build cost.
 *
 * FIELD REPORT (GhostExodus, 2026-08-20): GeoINT was consuming enough CPU to be noticeable, and
 * narrowing the timeline (fewer items in view) normalised it — i.e. the cost scales with the number
 * of markers. He had 428 located events.
 *
 * Markers are DOM elements, one per item. On top of that, a Popup was built for EVERY marker with
 * its DOM content constructed up front, though at most one popup is ever open. That is pure waste
 * proportional to the item count, and it is the part that can be removed without restructuring the
 * map layer.
 *
 * This asserts the waste is gone: popup CONTENT is built on demand, not per marker.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildPopupLazily } from '../src/renderer/modules/geoint/popup';

describe('popup content is built on demand', () => {
  it('does NOT build content when the marker is created', () => {
    const build = vi.fn(() => document.createElement('div'));
    buildPopupLazily(build);
    expect(build).not.toHaveBeenCalled();
  });

  it('builds content the first time the popup opens', () => {
    const build = vi.fn(() => document.createElement('div'));
    const open = buildPopupLazily(build);
    open();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds it only ONCE across repeated opens', () => {
    const build = vi.fn(() => document.createElement('div'));
    const open = buildPopupLazily(build);
    open(); open(); open();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('scales: 428 markers cost zero popup DOM until one is opened', () => {
    const build = vi.fn(() => document.createElement('div'));
    const openers = Array.from({ length: 428 }, () => buildPopupLazily(build));
    expect(build).not.toHaveBeenCalled();
    openers[7]!();
    expect(build).toHaveBeenCalledTimes(1);
  });
});
