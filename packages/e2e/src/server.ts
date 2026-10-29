// The e2e server (ADR-0082): the production `createServer` on a skip clock, plus the control route that skips it.
// Started by Playwright's `webServer` (playwright.config.ts); never deployed: Render runs packages/server/dist/index.js.
// Usage: tsx --conditions=@battleship/source src/server.ts  (ports from the E2E_* variables, src/stack.ts)

import { createServer } from '@battleship/server/server';

import { SkipClock } from './skip-clock.ts';
import {
  CLOCK_ADVANCE_PATH,
  STACK_HOST,
  readStack,
  type ClockAdvanceRequest,
  type ClockAdvanceResponse,
} from './stack.ts';

/** The longest skip the control route accepts: one day, far below `setTimeout`'s 24-day limit on the next timer. */
const MAX_SKIP_MS = 86_400_000;

/** Where the stack listens; the client's origin is the only one allowed. */
const stack = readStack(process.env);
/** The server's only clock, skipped by the control route. */
const clock = new SkipClock();
/** The production server, as `packages/server/src/index.ts` builds it, on the skip clock. */
const app = createServer({
  allowedOrigins: [stack.clientUrl],
  // Warnings and errors only, so a run's output stays readable; `LOG_LEVEL=debug` shows every socket event.
  logger: { level: process.env['LOG_LEVEL'] ?? 'warn' },
  clock,
});

app.post<{ Body: ClockAdvanceRequest; Reply: ClockAdvanceResponse }>(
  CLOCK_ADVANCE_PATH,
  {
    schema: {
      body: {
        type: 'object',
        required: ['ms'],
        additionalProperties: false,
        properties: { ms: { type: 'integer', minimum: 1, maximum: MAX_SKIP_MS } },
      },
    },
  },
  (request) => ({ now: clock.advance(request.body.ms) }),
);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ port: stack.serverPort, host: STACK_HOST });
console.log(`e2e server on ${stack.serverUrl}, allowing ${stack.clientUrl}`);
