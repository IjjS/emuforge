import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Studio talks only to the engine on loopback; the dev and preview servers bind loopback too.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Browsers with `light-dark()`, so the CSS minifier keeps Studio's `color-scheme` as written instead of adding
    // custom properties of its own (`--lightningcss-*`) to the `studio` layer, whose custom properties are `--st-*`.
    cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    passWithNoTests: true,
  },
});
