---
status: superseded by ADR-0052
date: 2026-10-05
---

# ADR-0025: Client server URL

> Superseded by [ADR-0052](0052-server-url-build-variable.md): the URL now comes from a `SERVER_URL` build variable (#48).

The server URL lives in Angular environment files: `environment.ts` holds the Render URL for every Pages build (production and previews share one server), `environment.development.ts` points `ng serve`/`ng test` at `http://localhost:3000`. Planned switch to a `SERVER_URL` build-time variable (set on Pages and in CI, build fails when missing): #48.

## Considered options

- **Client server URL — environment files vs. a Pages environment variable:** a `SERVER_URL` variable passed to `ng build --define` keeps the URL out of the repo, so previews could target a staging server and forks could deploy against their own, all without a code change. It splits the configuration across Pages (Production and Preview) and CI, and an unset variable silently becomes `''` in the bundle, so the build must validate it. With a single server, environment files are enough for Phase 0. The variable is the intended end state, with fail-fast validation and `ng serve` keeping its local default through the `development` configuration (D25, #48).

## Links

- Added on 2026-10-05 during the Phase 0 client bootstrap ([#4](https://github.com/fabogit/battleship/issues/4)).
- Spec: [Development: Monorepo topology](../development.md#monorepo-topology) · [Deployment: Frontend (Cloudflare Pages)](../deployment.md#frontend-cloudflare-pages)
- Issues: [#48](https://github.com/fabogit/battleship/issues/48)
