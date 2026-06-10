import type { BackgroundConnectionManager } from './manager';
let instance: BackgroundConnectionManager | null = null;
export function setBgConnManager(m: BackgroundConnectionManager): void { instance = m; }
export function getBgConnManager(): BackgroundConnectionManager | null { return instance; }
export function _resetBgConnSingletonForTest(): void { instance = null; }
