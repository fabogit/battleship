/**
 * Browser origins allowed by `ALLOWED_ORIGINS` (ADR-0021, ADR-0024).
 *
 * An entry is either an exact origin (`https://battleship.pages.dev`) or an `https` wildcard whose `*` stands for
 * exactly one subdomain label (`https://*.battleship.pages.dev`), so every Cloudflare Pages preview
 * (`<hash>.battleship.pages.dev`, `<branch>.battleship.pages.dev`) is accepted without redeploying the server.
 */

/** How every wildcard entry starts: `https` only, and the `*` takes the whole first label. */
const WILDCARD_PREFIX = 'https://*.';
/** One DNS label as browsers serialize it: lowercase letters, digits and inner hyphens. */
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
/** What a wildcard's `*` matches in an `Origin`: exactly one DNS label. */
const SINGLE_LABEL = new RegExp(`^${LABEL}$`);
/** A wildcard's suffix: two labels or more, so `https://*.dev` is refused. */
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
/** Shared hosting domains: a wildcard directly under them would admit every other tenant's site. */
const SHARED_SUFFIXES = new Set(['pages.dev', 'workers.dev', 'onrender.com']);

/**
 * Validates and normalizes one `ALLOWED_ORIGINS` entry, so a bad deploy fails at startup.
 * @param entry One trimmed, non-empty entry of the variable.
 * @returns The entry's URL origin (`https://example.com/` → `https://example.com`), or the wildcard lowercased and
 * without a trailing slash.
 * @throws When the entry is not a URL with an origin, or is a wildcard other than `https://*.<hostname>`, or a wildcard
 * directly under a shared hosting domain such as `pages.dev`.
 */
export function parseOriginEntry(entry: string): string {
  if (entry.includes('*')) {
    const suffix = entry.startsWith(WILDCARD_PREFIX)
      ? entry.slice(WILDCARD_PREFIX.length).replace(/\/$/, '').toLowerCase()
      : '';
    if (!HOSTNAME.test(suffix) || SHARED_SUFFIXES.has(suffix)) {
      throw new Error(
        `Invalid wildcard origin in ALLOWED_ORIGINS: "${entry}" (expected https://*.<project>.pages.dev)`,
      );
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
 * Tells whether a request's `Origin` header is admitted (ADR-0021).
 * @param origin The header, absent for same-origin and non-browser requests, which are always admitted.
 * @returns Whether the request may proceed.
 */
export type OriginMatcher = (origin: string | undefined) => boolean;

/**
 * Builds the predicate shared by the HTTP hook, `@fastify/cors` and the Socket.io handshake. A request without an
 * `Origin` header is not a browser cross-origin request, so CORS does not apply to it.
 * @param entries The entries as `parseOriginEntry` returns them.
 * @returns A matcher that admits an absent `Origin`, an exact entry, or `https://<one label>.<suffix>` for a wildcard
 * entry.
 */
export function createOriginMatcher(entries: readonly string[]): OriginMatcher {
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

/**
 * The CORS origin callback's answer, shared by `@fastify/cors` and Socket.io: reflect an allowed `Origin`, send no
 * CORS headers otherwise.
 * @param isOriginAllowed The matcher from `createOriginMatcher`.
 * @param origin The request's `Origin` header, absent for same-origin and non-browser requests.
 * @returns The origin to echo in `Access-Control-Allow-Origin`, or `false` for no CORS headers.
 */
export function corsOrigin(isOriginAllowed: OriginMatcher, origin: string | undefined): string | false {
  return isOriginAllowed(origin) ? (origin ?? false) : false;
}
