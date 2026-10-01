import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@happier-dev/protocol/embed': fileURLToPath(new URL('../protocol/src/embed/index.ts', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
