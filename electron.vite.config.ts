import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const sharedAliases = {
  '@shared': resolve(__dirname, 'src/shared')
};

export default defineConfig({
  main: {
    // @noble/curves, @noble/post-quantum, and @noble/ciphers are ESM-only; the main bundle is CJS,
    // so they must be BUNDLED (not externalized) or require() of them throws ERR_REQUIRE_ESM at boot.
    // Any new @noble/* (or other ESM-only) main-process dependency MUST be added here.
    plugins: [externalizeDepsPlugin({ exclude: ['@noble/curves', '@noble/post-quantum', '@noble/ciphers'] })],
    resolve: { alias: sharedAliases },
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAliases },
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        ...sharedAliases,
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
});
