import { defineConfig } from 'vitest/config';

/**
 * The worker compiles with NodeNext, so its own sources import each other with
 * a `.js` extension. Vitest loads the TypeScript directly, so that extension is
 * mapped back at resolve time rather than changing the worker's build setup.
 */
const workerSourceExtension = {
  find: /^(\.{1,2}\/.*)\.js$/,
  replacement: '$1',
};

export default defineConfig({
  resolve: { alias: [workerSourceExtension] },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          globals: false,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globals: false,
          // Integration tests share one Postgres schema, so they run serially.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
    ],
  },
});
