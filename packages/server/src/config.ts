import { parseOriginEntry } from './origins.js';

export interface ServerConfig {
  readonly port: number;
  readonly allowedOrigins: readonly string[];
}

const DEFAULT_PORT = 3000;

/** Reads `PORT` and `ALLOWED_ORIGINS` (comma-separated). Throws on missing or malformed values so a bad deploy fails at startup. */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    port: parsePort(env['PORT']),
    allowedOrigins: parseOrigins(env['ALLOWED_ORIGINS']),
  };
}

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
 * Wildcard entries (`https://*.<project>.pages.dev`) are kept as patterns (ADR D24).
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
