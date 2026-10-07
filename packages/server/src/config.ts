import { parseOriginEntry } from './origins.js';

/** Accepted `LOG_FORMAT` values, named like core's closed sets (ADR-0043). */
export const LOG_FORMATS = {
  /** One JSON object per line (Render). */
  JSON: 'json',
  /** Colored, human-readable lines via pino-pretty (local runs). */
  PRETTY: 'pretty',
} as const;

/** One of the `LOG_FORMATS`. */
export type LogFormat = (typeof LOG_FORMATS)[keyof typeof LOG_FORMATS];

/**
 * Pino levels. `info` (default) logs HTTP requests and socket connections; `debug` adds `/health` and every socket event
 * (docs/server.md#logging).
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/** Server settings read from the environment (docs/deployment.md#backend-render). */
export interface ServerConfig {
  /** TCP port to listen on, 1–65535; Render provides it. */
  readonly port: number;
  /** Browser origins admitted over HTTP and Socket.io: exact origins and `https://*.<domain>` wildcards (ADR-0021). */
  readonly allowedOrigins: readonly string[];
  /** How log lines are written. */
  readonly logFormat: LogFormat;
  /** Lowest Pino level that is written (docs/server.md#logging). */
  readonly logLevel: LogLevel;
}

/** Port used when `PORT` is unset, as in local runs. */
const DEFAULT_PORT = 3000;

/** Accepted `LOG_LEVEL` values, from the least to the most verbose, plus `silent`. */
const LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/**
 * Reads `PORT`, `ALLOWED_ORIGINS` (comma-separated), `LOG_FORMAT` and `LOG_LEVEL`, so a bad deploy fails at startup.
 * @param env The process environment, or a plain object in tests.
 * @returns The validated settings, with defaults for the optional variables.
 * @throws When `ALLOWED_ORIGINS` is missing or any variable is malformed; the message names the variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    port: parsePort(env['PORT']),
    allowedOrigins: parseOrigins(env['ALLOWED_ORIGINS']),
    logFormat: parseLogFormat(env['LOG_FORMAT']),
    logLevel: parseLogLevel(env['LOG_LEVEL']),
  };
}

/**
 * Parses `PORT`.
 * @param value The raw variable.
 * @returns The port, or `DEFAULT_PORT` when unset or blank.
 * @throws When it is not a decimal integer between 1 and 65535.
 */
function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  // Digits only: `Number` also accepts `0x10` and `1e3`. Port 0 would bind a random port that Render cannot reach.
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: "${value}"`);
  }
  return port;
}

/**
 * Normalizes each entry to its URL origin, so `https://example.com/` matches the browser's `Origin: https://example.com`.
 * Wildcard entries (`https://*.<project>.pages.dev`) are kept as patterns (ADR-0024).
 * @param value The raw comma-separated variable; blank entries are skipped.
 * @returns The normalized origins and patterns, never empty.
 * @throws When no entry is left, pointing to `.env.example`, or when an entry is not a valid origin.
 */
function parseOrigins(value: string | undefined): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map(parseOriginEntry);
  // Render's health check sends no `Origin`, so an empty list would deploy as healthy while every browser gets 403.
  if (origins.length === 0) {
    throw new Error(
      'ALLOWED_ORIGINS is not set: for local runs copy packages/server/.env.example to packages/server/.env; ' +
        'on Render set it in the dashboard',
    );
  }
  return origins;
}

/**
 * Parses `LOG_FORMAT`.
 * @param value The raw variable, matched case-sensitively.
 * @returns The format, or `json` when unset or blank.
 * @throws When it is neither `json` nor `pretty`.
 */
function parseLogFormat(value: string | undefined): LogFormat {
  if (value === undefined || value.trim() === '') {
    return LOG_FORMATS.JSON;
  }
  const formats = Object.values(LOG_FORMATS);
  const format = formats.find((candidate) => candidate === value);
  if (format === undefined) {
    throw new Error(`Invalid LOG_FORMAT: "${value}" (expected ${formats.join(' or ')})`);
  }
  return format;
}

/**
 * Parses `LOG_LEVEL`.
 * @param value The raw variable, matched case-sensitively.
 * @returns The level, or `info` when unset or blank.
 * @throws When it is not a Pino level name.
 */
function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value.trim() === '') {
    return 'info';
  }
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (level === undefined) {
    throw new Error(`Invalid LOG_LEVEL: "${value}" (expected one of ${LOG_LEVELS.join(', ')})`);
  }
  return level;
}
