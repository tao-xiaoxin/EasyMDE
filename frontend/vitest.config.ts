import { defineConfig } from 'vitest/config';

const nodeUnitIncludes = [
  'frontend/src/contracts/**/*.test.ts',
  'frontend/src/domain/**/*.test.ts'
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node-unit',
          environment: 'node',
          include: nodeUnitIncludes,
          restoreMocks: true
        }
      },
      {
        test: {
          name: 'jsdom-unit',
          environment: 'jsdom',
          include: ['frontend/src/**/*.test.ts'],
          exclude: nodeUnitIncludes,
          restoreMocks: true,
          setupFiles: ['frontend/src/test/setup-dom.ts']
        }
      },
      {
        test: {
          name: 'jsdom-react',
          environment: 'jsdom',
          include: ['frontend/src/**/*.test.tsx'],
          restoreMocks: true,
          setupFiles: ['frontend/src/test/setup.ts']
        }
      }
    ]
  }
});
