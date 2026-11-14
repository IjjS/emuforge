import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Studio talks only to the engine on loopback; the dev and preview servers bind loopback too.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    passWithNoTests: true,
  },
});
