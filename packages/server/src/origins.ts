/**
 * Browser origins allowed by `ALLOWED_ORIGINS` (ADR-0021, ADR-0024).
 *
 * An entry is either an exact origin (`https://battleship.pages.dev`) or an `https` wildcard whose `*` stands for
 * exactly one subdomain label (`https://*.battleship.pages.dev`), so every Cloudflare Pages preview
 * (`<hash>.battleship.pages.dev`, `<branch>.battleship.pages.dev`) is accepted without redeploying the server.
 */

const WILDCARD_PREFIX = 'https://*.';
/** One DNS label as browsers serialize it: lowercase letters, digits and inner hyphens. */
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const SINGLE_LABEL = new RegExp(`^${LABEL}$`);
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
/** Shared hosting domains: a wildcard directly under them would admit every other tenant's site. */
const SHARED_SUFFIXES = new Set(['pages.dev', 'workers.dev', 'onrender.com']);

/** Validates and normalizes one `ALLOWED_ORIGINS` entry. Throws on anything else, so a bad deploy fails at startup. */
export function parseOriginEntry(entry: string): string {
  if (entry.includes('*')) {
    const suffix = entry.startsWith(WILDCARD_PREFIX)
      ? entry.slice(WILDCARD_PREFIX.length).replace(/\/$/, '').toLowerCase()
      : '';
    if (!HOSTNAME.test(suffix) || SHARED_SUFFIXES.has(suffix)) {
      throw new Error(`Invalid wildcard origin in ALLOWED_ORIGINS: "${entry}" (expected https://*.<project>.pages.dev)`);
    }
    return `${WILDCARD_PREFIX}${suffix}`;
  }
  const origin = URL.parse(entry)?.origin;
  if (origin === undefined || origin === 'null') {
    throw new Error(`Invalid origin in ALLOWED_ORIGINS: "${entry}"`);
  }
  return origin;
}

/**
 * Builds the predicate shared by the HTTP hook, `@fastify/cors` and the Socket.io handshake.
 * A request without an `Origin` header is not a browser cross-origin request, so CORS does not apply to it.
 */
export function createOriginMatcher(entries: readonly string[]): (origin: string | undefined) => boolean {
  const exact = new Set(entries.filter((entry) => !entry.startsWith(WILDCARD_PREFIX)));
  const suffixes = entries
    .filter((entry) => entry.startsWith(WILDCARD_PREFIX))
    .map((entry) => entry.slice(WILDCARD_PREFIX.length));

  return (origin) => {
    if (origin === undefined || exact.has(origin)) {
      return true;
    }
    if (!origin.startsWith('https://')) {
      return false;
    }
    const host = origin.slice('https://'.length);
    const dot = host.indexOf('.');
    // Exactly one label before the suffix, anchored at both ends: no extra labels, no port, no path.
    return dot > 0 && SINGLE_LABEL.test(host.slice(0, dot)) && suffixes.includes(host.slice(dot + 1));
  };
}
