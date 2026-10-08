// Production build: reads SERVER_URL and passes it to `ng build --define`, failing fast when it is missing or not https.
// Usage: pnpm --filter @battleship/client build [ng build options]
// SERVER_URL comes from the environment (Cloudflare Pages, CI) or, locally, from packages/client/.env (copy .env.example).
import { spawnSync } from 'node:child_process';

/** Global identifier the client reads the server URL from (src/build-defines.d.ts). */
const DEFINE_NAME = 'BUILD_SERVER_URL';

/** A server URL that can go into the bundle. */
interface ValidServerUrl {
  ok: true;
  /** The URL as set, trimmed. */
  url: string;
}

/** Why the server URL cannot go into the bundle. */
interface InvalidServerUrl {
  ok: false;
  /** Message for the build log, saying how to fix it. */
  error: string;
}

/**
 * Checks the `SERVER_URL` value: set, an absolute URL, and `https://` (Pages serves over HTTPS, so `ws://` would be
 * blocked as mixed content).
 *
 * @param value The raw `SERVER_URL` value, `undefined` when unset.
 * @returns The trimmed URL, or the reason it is rejected.
 */
function parseServerUrl(value: string | undefined): ValidServerUrl | InvalidServerUrl {
  const url = value?.trim() ?? '';
  if (url === '') {
    return {
      ok: false,
      error:
        'SERVER_URL is not set: for local builds copy packages/client/.env.example to packages/client/.env; ' +
        'on Cloudflare Pages set it in both the Production and the Preview environment.',
    };
  }
  if (!URL.canParse(url)) {
    return { ok: false, error: `SERVER_URL is not a valid URL: ${url}` };
  }
  if (new URL(url).protocol !== 'https:') {
    return { ok: false, error: `SERVER_URL must start with https:// (the site is served over HTTPS): ${url}` };
  }
  return { ok: true, url };
}

const serverUrl = parseServerUrl(process.env['SERVER_URL']);
if (!serverUrl.ok) {
  console.error(`Build stopped. ${serverUrl.error}`);
  process.exit(1);
}

console.log(`Building against SERVER_URL=${serverUrl.url}`);
const build = spawnSync(
  'ng',
  ['build', '--define', `${DEFINE_NAME}=${JSON.stringify(serverUrl.url)}`, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
if (build.error !== undefined) {
  console.error(build.error.message);
}
process.exit(build.status ?? 1);
