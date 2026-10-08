---
status: accepted
date: 2026-10-03
---

# ADR-0019: Backend deploy

Native Node build on Render with filtered install (no Docker in v1). Docker multi-stage image with `pnpm deploy` kept as fallback.

## Considered options

- **Dockerfile vs. native build on Render:** Docker gives reproducibility and portability to other hosts, but a pnpm monorepo image needs `pnpm deploy` and extra config, and builds are slower on the free tier. Native build is simpler and sufficient as long as the install is filtered to the server and its dependencies; Docker remains the fallback if Phase 0 hits a blocker or we need to leave Render (D19).

## Links

- Added on 2026-10-03 after the requirements analysis session.
