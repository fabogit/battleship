// The journeys' Playwright fixtures (docs/development.md#end-to-end-journeys): one browser context per player, page
// and console errors that fail the journey, and the server clock's skip (ADR-0089).

import { test as base, expect, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';

import { CLOCK_ADVANCE_PATH, readStack, type ClockAdvanceRequest } from './stack.ts';

/** One player of a journey: their own browser context, as a separate device would be. */
export interface Player {
  /** The nickname the player types; journeys build the expected texts from it. */
  readonly nickname: string;
  /** The player's browser: its storage holds their session, so a new page in it is the same player. */
  readonly context: BrowserContext;
  /** The player's tab; replaced when a journey reopens the room in a new one. */
  page: Page;
}

/** What the journeys get on top of Playwright's own fixtures. */
export interface JourneyFixtures {
  /**
   * Opens a new player in a browser context of their own, with one blank page. Every page and console error in that
   * context is recorded, and the journey fails at its end if there was any.
   * @param nickname The player's nickname.
   * @param options Context options on top of the project's, e.g. a viewport, touch or a color scheme.
   * @returns The player.
   */
  readonly openPlayer: (nickname: string, options?: BrowserContextOptions) => Promise<Player>;
  /**
   * Skips the e2e server's clock forward, running every room timer the skip passes (ADR-0089). The pages keep their
   * own clocks: they learn the outcome from the `STATE` events those timers send.
   * @param ms How far to skip, in ms.
   */
  readonly skipServerClock: (ms: number) => Promise<void>;
}

/** Where the stack listens, as the Playwright config started it. */
const stack = readStack(process.env);

/** `test` with the journey fixtures. */
export const test = base.extend<JourneyFixtures>({
  openPlayer: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const errors: string[] = [];
    await use(async (nickname, options = {}) => {
      const context = await browser.newContext({ ...options, baseURL: stack.clientUrl });
      contexts.push(context);
      context.on('weberror', (error) => {
        errors.push(`${nickname}, page error: ${error.error().message}`);
      });
      context.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(`${nickname}, console error: ${message.text()}`);
        }
      });
      return { nickname, context, page: await context.newPage() };
    });
    await Promise.all(contexts.map((context) => context.close()));
    expect(errors, 'no page or console errors').toEqual([]);
  },
  skipServerClock: async ({ request }, use) => {
    await use(async (ms) => {
      const body: ClockAdvanceRequest = { ms };
      const response = await request.post(`${stack.serverUrl}${CLOCK_ADVANCE_PATH}`, { data: body });
      expect(response.ok(), `clock skip of ${String(ms)} ms: ${await response.text()}`).toBe(true);
    });
  },
});

export { expect };
