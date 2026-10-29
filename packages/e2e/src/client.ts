// The e2e client (docs/development.md#end-to-end-journeys): builds the production bundle against the e2e server and
// serves it as an SPA, as Cloudflare Pages does. Started by Playwright's `webServer` (playwright.config.ts).
// Usage: tsx src/client.ts  (ports from the E2E_* variables, src/stack.ts)

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STACK_HOST, readStack } from './stack.ts';

/** Where the bundle is built; Angular writes the files to serve under `browser/`. Gitignored, like every `dist/`. */
const OUTPUT_PATH = fileURLToPath(new URL('../dist/client', import.meta.url));

/** The served files: the bundle's `browser/` folder. */
const ROOT = join(OUTPUT_PATH, 'browser');

/** Content types of the files the bundle holds; anything else is served as bytes. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/**
 * Runs a pnpm command in the foreground, sharing this terminal.
 * @param args The arguments after `pnpm`.
 * @param env Variables to add to this process's environment.
 * @throws When the command cannot start or exits with a failure, so the stack never serves a stale bundle.
 */
function pnpm(args: readonly string[], env: NodeJS.ProcessEnv = {}): void {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}`);
  }
}

/** Where the stack listens; the bundle talks to its server. */
const stack = readStack(process.env);

// The production bundle reads core from dist/ (docs/development.md#resolving-battleshipcore), so core is built first.
pnpm(['--filter', '@battleship/core', 'build']);
pnpm(['--filter', '@battleship/client', 'build', '--output-path', OUTPUT_PATH], { SERVER_URL: stack.serverUrl });

/**
 * Serves the bundle: a file when the path names one, `index.html` for every other path, so `/r/<roomId>` deep links
 * and reloads work as on Pages. Paths are resolved inside `ROOT` and never leave it.
 */
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://e2e').pathname);
  const file = resolve(ROOT, `.${pathname}`);
  const index = join(ROOT, 'index.html');
  const candidates = file.startsWith(ROOT + sep) ? [file, index] : [index];
  void (async () => {
    for (const candidate of candidates) {
      try {
        const body = await readFile(candidate);
        response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(candidate)] ?? 'application/octet-stream' });
        response.end(body);
        return;
      } catch {
        // Not a file of the bundle: fall through to index.html.
      }
    }
    response.writeHead(404).end();
  })();
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}

server.listen(stack.clientPort, STACK_HOST, () => {
  console.log(`e2e client on ${stack.clientUrl}, talking to ${stack.serverUrl}`);
});
