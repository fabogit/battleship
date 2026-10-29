// Where the e2e stack listens (docs/development.md#end-to-end-journeys): read by the Playwright config, both stack
// entry points and the journeys' fixtures, so they all agree.

/** The environment variables the e2e stack reads, all optional (ADR-0043). */
export const STACK_VARIABLES = {
  /** The e2e server's port; `DEFAULT_SERVER_PORT` when unset. */
  SERVER_PORT: 'E2E_SERVER_PORT',
  /** The port the client bundle is served on; `DEFAULT_CLIENT_PORT` when unset. */
  CLIENT_PORT: 'E2E_CLIENT_PORT',
  /** A Chromium binary to run instead of the one `playwright install` downloads, e.g. `/usr/bin/chromium`. */
  CHROMIUM_PATH: 'E2E_CHROMIUM_PATH',
} as const;

/** One of the `STACK_VARIABLES`. */
export type StackVariable = (typeof STACK_VARIABLES)[keyof typeof STACK_VARIABLES];

/** Clear of the dev pair (3000/4200), the other worktrees' pairs (3100/4300) and the hub's (3200/4400). */
const DEFAULT_SERVER_PORT = 3900;

/** Clear of the dev, worktree and hub client ports, like `DEFAULT_SERVER_PORT`. */
const DEFAULT_CLIENT_PORT = 4900;

/**
 * Both servers listen on IPv4 loopback only, so the clock's control route is out of reach of other machines, and the
 * bundle names the same address the server listens on (`localhost` may resolve to `::1` first).
 */
export const STACK_HOST = '127.0.0.1';

/** The path of the control route that skips the e2e server's clock (ADR-0082); registered by `src/server.ts` only. */
export const CLOCK_ADVANCE_PATH = '/e2e/clock/advance';

/** The body of a `POST` to `CLOCK_ADVANCE_PATH`. */
export interface ClockAdvanceRequest {
  /** How far to skip, in ms: a positive integer. */
  readonly ms: number;
}

/** The reply to a `POST` to `CLOCK_ADVANCE_PATH`. */
export interface ClockAdvanceResponse {
  /** The server clock's time after the skip, in epoch ms. */
  readonly now: number;
}

/** The addresses of a running e2e stack. */
export interface Stack {
  /** The e2e server's port. */
  readonly serverPort: number;
  /** The port the client bundle is served on. */
  readonly clientPort: number;
  /** The server's base URL, baked into the bundle as `SERVER_URL`. */
  readonly serverUrl: string;
  /** The client's base URL, and the only origin the server allows. */
  readonly clientUrl: string;
}

/**
 * Reads the stack's ports from the environment.
 * @param env The process environment.
 * @returns The ports and the URLs built from them.
 * @throws When a port variable is set but is not a decimal integer between 1 and 65535; the message names it.
 */
export function readStack(env: NodeJS.ProcessEnv): Stack {
  const serverPort = parsePort(env, STACK_VARIABLES.SERVER_PORT, DEFAULT_SERVER_PORT);
  const clientPort = parsePort(env, STACK_VARIABLES.CLIENT_PORT, DEFAULT_CLIENT_PORT);
  return {
    serverPort,
    clientPort,
    serverUrl: `http://${STACK_HOST}:${String(serverPort)}`,
    clientUrl: `http://${STACK_HOST}:${String(clientPort)}`,
  };
}

/**
 * Parses one port variable.
 * @param env The process environment.
 * @param name The variable to read.
 * @param fallback The port when the variable is unset or blank.
 * @returns The variable's value, or the fallback.
 * @throws When the value is not a decimal integer between 1 and 65535.
 */
function parsePort(env: NodeJS.ProcessEnv, name: StackVariable, fallback: number): number {
  const value = env[name]?.trim() ?? '';
  if (value === '') {
    return fallback;
  }
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
  return port;
}
