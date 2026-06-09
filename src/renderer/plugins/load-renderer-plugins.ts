import * as React from 'react';
import { registerModule } from '../state/registry';
import type { VerifiedPluginInfo } from '../../shared/plugin-types';

export function installPluginBridge(): void {
  const api = (window as unknown as { apiPlugins?: unknown }).apiPlugins;
  (window as unknown as { dcs98Plugin: unknown }).dcs98Plugin = { React, registerModule, api };
}

export type ChunkImporter = (url: string) => Promise<unknown>;

export async function importPluginChunks(
  plugins: VerifiedPluginInfo[],
  importer: ChunkImporter = (url) => import(/* @vite-ignore */ url)
): Promise<void> {
  for (const p of plugins) {
    try {
      await importer(`dcs98-plugin://${p.id}/${p.renderer}`);
    } catch (e) {
      console.error(`[plugin:${p.id}] renderer chunk failed to load`, e);
    }
  }
}
