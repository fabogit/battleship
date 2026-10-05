import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests run in Vite's SSR environment. Resolve @battleship/core from its sources, like tsconfig.json (D22);
  // the list replaces Vite's server defaults, so it repeats them.
  ssr: {
    resolve: {
      conditions: ['@battleship/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
