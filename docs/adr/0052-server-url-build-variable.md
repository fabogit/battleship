---
status: accepted
date: 2026-10-08
---

# ADR-0052: Server URL as a build variable

The client reads its server URL from a `SERVER_URL` variable, set wherever the client is built or served, so the URL no longer lives in the repo and a preview or a fork can target another server without a code change. Supersedes [ADR-0025](0025-client-server-url.md). The client's `build`, `dev` and `start` scripts run `node --env-file-if-exists=.env scripts/ng.ts <build|serve>`: it takes `SERVER_URL` from the environment (Cloudflare Pages Production and Preview, the `ci` job) or, locally, from `packages/client/.env`, a copy of the committed `.env.example` (`http://localhost:3000`, the local server), the same pattern as the server's `.env`. A variable set in the environment wins over the file. The script stops when the value is missing, not a URL, or neither `https://` nor `http://` to `localhost`/`127.0.0.1`/`[::1]`, then runs `ng build` or `ng serve` with `--define BUILD_SERVER_URL=<JSON string>`; an unset define would otherwise leave the bundle without a URL and the build would pass. There is no fallback URL in `angular.json` or in the code: the value is always configured. The `SERVER_URL` injection token reads the define; unit tests override the token, so `ng test` needs no variable. Details in [Deployment: Frontend](../deployment.md#frontend-cloudflare-pages) and [Development: Local tooling](../development.md#local-tooling) (#48).

## Considered options

- **Environment files (ADR-0025):** `environment.ts` held the Render URL and `ng serve` swapped in a localhost copy. Enough for one server, but the URL lived in the repo, so a staging server for previews or a fork against its own server needed a code change.
- **Local builds — a `.env` file vs. a placeholder vs. failing everywhere:** a local production build only serves `pnpm verify` (the bundle is never deployed from a laptop), yet the check that protects Pages runs there too. A placeholder URL in `verify` (`https://server.invalid` when unset) would add no setup, but would bake a fake URL into a bundle that looks deployable and keep a second rule next to the real one. Failing everywhere would make every developer and agent export the variable before each `verify`. A `.env` file read by the build script keeps one rule (no URL, no build) and follows the server's `.env.example` → `.env` convention, at the cost of one copy per checkout or worktree.
- **One `.env` at the repo root for both packages:** one file to copy instead of two, but the packages share no variable (`PORT`, `ALLOWED_ORIGINS` and `LOG_*` for the server, `SERVER_URL` for the client) and deploy to different hosts with their own settings (Render, Cloudflare Pages). One `.env.example` per package lists exactly what its host needs; a shared file would also have moved the server's working setup. Revisit if a variable ever needs to be shared.
- **A `localhost` default in the `development` configuration vs. the `.env` for `ng serve` too:** a default in `angular.json` would let `ng serve` and `ng test` run with no setup, but it hard-codes one URL in the repo and makes the local server a silent fallback. Rejected by the user: the local URL is configured like every other, in `packages/client/.env`, and a missing value stops `ng serve` as it stops a build. Consequence: `http://` is accepted for `localhost`, `127.0.0.1` and `[::1]` (one `.env` serves both `ng serve` and `pnpm verify`); any other `http://` URL is refused, since a deployed site is served over HTTPS, where `ws://` is blocked as mixed content.
- **Define named `SERVER_URL`, like the variable:** rejected. The injection token in `server-url.ts` is also `SERVER_URL`, and a module-level binding would shadow the global that the bundler replaces. The global is `BUILD_SERVER_URL`, declared in `src/build-defines.d.ts` and read only by the token.

## Consequences

- Cloudflare Pages needs `SERVER_URL` in both the Production and the Preview environment; a missing one fails that build with a message saying so. Both point at the one Render server today ([ADR-0024](0024-preview-origins.md)).
- The `ci` job sets `SERVER_URL` in its `env`, so `pnpm build` there behaves like Pages.
- `packages/client/.env` is gitignored, like the server's. A new checkout or `git worktree` copies both `.env.example` files (or the existing `.env` files) before `pnpm dev` or `pnpm verify`.
- `scripts/ng.ts` is typechecked (`scripts/tsconfig.json`, Node types) and linted with the rest of the client.

## Links

- Added on 2026-10-08 during M1 ([#48](https://github.com/fabogit/battleship/issues/48)).
- Spec: [Deployment: Frontend (Cloudflare Pages)](../deployment.md#frontend-cloudflare-pages) · [Development: Local tooling](../development.md#local-tooling) · [Development: Monorepo topology](../development.md#monorepo-topology)
- Supersedes: [ADR-0025](0025-client-server-url.md) (client server URL)
- Related: [ADR-0024](0024-preview-origins.md) (preview origins)
- Issues: [#48](https://github.com/fabogit/battleship/issues/48)
