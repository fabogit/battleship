// Runs `ng build` or `ng serve` with the server URL from SERVER_URL, failing fast when it is missing or not allowed.
// Usage: node --env-file-if-exists=.env scripts/ng.ts <build|serve> [ng options]  (the `build`, `start` and `dev` scripts)
// SERVER_URL comes from the environment (Cloudflare Pages, CI) or, locally, from packages/client/.env (copy .env.example).
import { spawnSync } from 'node:child_process';

/** Global identifier the client reads the server URL from (src/build-defines.d.ts). */
const DEFINE_NAME = 'BUILD_SERVER_URL';

/** The Angular CLI commands that bake the server URL into the bundle. */
const NG_COMMANDS: readonly string[] = ['build', 'serve'];

/** Hosts a plain `http://` URL may point to: a server on this machine, reached from a page on this machine. */
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** A server URL that can go into the bundle. */
interface ValidServerUrl {
  ok: true;
  /** The URL as set, trimmed. */
  url: string;
}

/** Why the server URL cannot go into the bundle. */
interface InvalidServerUrl {
  ok: false;
  /** Message for the log, saying how to fix it. */
  error: string;
}

/**
 * Checks the `SERVER_URL` value: set, an absolute URL, and `https://` unless it points to this machine. A deployed
 * site is served over HTTPS, where a plain `ws://` connection is blocked as mixed content; `http://localhost` is what
 * `ng serve` and local builds talk to.
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
        'SERVER_URL is not set: locally copy packages/client/.env.example to packages/client/.env; ' +
        'on Cloudflare Pages set it in both the Production and the Preview environment.',
    };
  }
  if (!URL.canParse(url)) {
    return { ok: false, error: `SERVER_URL is not a valid URL: ${url}` };
  }
  const { protocol, hostname } = new URL(url);
  const isLocalHttp = protocol === 'http:' && LOCAL_HOSTS.includes(hostname);
  if (protocol !== 'https:' && !isLocalHttp) {
    return {
      ok: false,
      error: `SERVER_URL must start with https:// (http:// only for localhost, 127.0.0.1 or [::1]): ${url}`,
    };
  }
  return { ok: true, url };
}

const [command, ...ngOptions] = process.argv.slice(2);
if (command === undefined || !NG_COMMANDS.includes(command)) {
  console.error(`Usage: scripts/ng.ts <${NG_COMMANDS.join('|')}> [ng options]`);
  process.exit(1);
}

const serverUrl = parseServerUrl(process.env['SERVER_URL']);
if (!serverUrl.ok) {
  console.error(`Stopped. ${serverUrl.error}`);
  process.exit(1);
}

console.log(`ng ${command} against SERVER_URL=${serverUrl.url}`);
const ng = spawnSync('ng', [command, '--define', `${DEFINE_NAME}=${JSON.stringify(serverUrl.url)}`, ...ngOptions], {
  stdio: 'inherit',
});
if (ng.error !== undefined) {
  console.error(ng.error.message);
}
process.exit(ng.status ?? 1);
