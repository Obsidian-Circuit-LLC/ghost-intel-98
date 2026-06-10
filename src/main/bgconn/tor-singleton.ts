import type { BgconnTor } from './tor';
let instance: BgconnTor | null = null;
export function setBgTor(t: BgconnTor): void { instance = t; }
export function getBgTor(): BgconnTor | null { return instance; }
export function _resetBgTorForTest(): void { instance = null; }
