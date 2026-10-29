// End-to-end journeys against a local stack (docs/development.md#end-to-end-journeys, ADR-0089).
import { defineConfig, devices } from '@playwright/test';

import { STACK_VARIABLES, readStack } from './src/stack.ts';

const stack = readStack(process.env);
const isCi = process.env['CI'] !== undefined;
const chromiumPath = process.env[STACK_VARIABLES.CHROMIUM_PATH]?.trim() ?? '';
/** What both stack processes get on top of this environment. */
const stackEnv = {
  [STACK_VARIABLES.SERVER_PORT]: String(stack.serverPort),
  [STACK_VARIABLES.CLIENT_PORT]: String(stack.clientPort),
};

export default defineConfig({
  testDir: 'journeys',
  // One worker: the journeys share one server, and a clock skip moves every room's time.
  workers: 1,
  fullyParallel: false,
  // A flaky journey is a failing journey.
  retries: 0,
  forbidOnly: isCi,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: stack.clientUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(chromiumPath === '' ? {} : { launchOptions: { executablePath: chromiumPath } }),
  },
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: 'tsx --conditions=@battleship/source src/server.ts',
      url: `${stack.serverUrl}/health`,
      env: stackEnv,
      reuseExistingServer: !isCi,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: 'pipe',
    },
    {
      // Builds core and the production bundle first: about half a minute.
      command: 'tsx src/client.ts',
      url: stack.clientUrl,
      env: stackEnv,
      reuseExistingServer: !isCi,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
