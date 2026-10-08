---
status: accepted
date: 2026-10-05
---

# ADR-0026: Dependency install scripts

pnpm 11 fails the install on unreviewed dependency build scripts, so `pnpm-workspace.yaml` lists them in `allowBuilds`: only `esbuild` runs its script; `lmdb`, `msgpackr-extract` and `@parcel/watcher` (Angular build tooling) use their prebuilt binaries. New entries are reviewed when they appear.

## Considered options

- **Dependency install scripts — allow all vs. deny all vs. per package:** allowing every script (`dangerouslyAllowAllBuilds`) gives up the supply-chain protection pnpm 11 enables by default; denying all would also skip esbuild's binary check. The native packages Angular pulls in ship prebuilt binaries as optional dependencies, so their scripts are only a compile-from-source fallback (D26).

## Links

- Added on 2026-10-05 during the Phase 0 client bootstrap ([#4](https://github.com/fabogit/battleship/issues/4)).
- Spec: [Development: Monorepo topology](../development.md#monorepo-topology)
