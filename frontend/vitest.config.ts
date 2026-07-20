import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['frontend/src/**/*.test.ts', 'frontend/src/**/*.test.tsx'],
    restoreMocks: true,
    setupFiles: ['frontend/src/test/setup.ts']
  }
});
