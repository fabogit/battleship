import { parseOriginEntry } from './origins.js';

export interface ServerConfig {
  readonly port: number;
  readonly allowedOrigins: readonly string[];
}

const DEFAULT_PORT = 3000;

/** Reads `PORT` and `ALLOWED_ORIGINS` (comma-separated). Throws on malformed values so a bad deploy fails at startup. */
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
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT: "${value}"`);
  }
  return port;
}

/**
 * Normalizes each entry to its URL origin, so `https://example.com/` matches the browser's `Origin: https://example.com`.
 * Wildcard entries (`https://*.<project>.pages.dev`) are kept as patterns (ADR D24).
 */
function parseOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map(parseOriginEntry);
}
