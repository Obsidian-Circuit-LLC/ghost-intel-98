import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Headless unit/integration tests for main-process logic (validators, storage,
// metadata extraction, search, CSV, the HTML sanitizer). No Electron runtime —
// pure modules are imported directly. Per-file environment override (`// @vitest-environment
// jsdom`) is used for the DOM-dependent sanitizer tests.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main')
    }
  },
  // Automatic JSX runtime so React component tests (*.test.tsx) don't need React in scope;
  // has no effect on the JSX-free *.test.ts files.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup-mlkem.ts'], // install the in-process ML-KEM-1024 provider for chat crypto
    globals: false
  }
});
