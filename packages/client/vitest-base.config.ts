import { defineConfig } from 'vitest/config';

// Extra Vitest options for `ng test` (angular.json "runnerConfig"); the builder supplies the rest.
export default defineConfig({
  resolve: {
    // The test bundle leaves packages external, so Vitest resolves @battleship/core: read its sources (D22).
    conditions: ['@battleship/source'],
  },
});
