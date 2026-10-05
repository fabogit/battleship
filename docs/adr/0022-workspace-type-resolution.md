---
status: accepted
date: 2026-10-04
---

# ADR-0022: Workspace type resolution

Typecheck, lint, tests and `ng serve` resolve `@battleship/core` from its sources through a `"@battleship/source"` export condition, so changes to core need no rebuild. Production builds (server `tsconfig.build.json`, client `production` configuration) keep reading `dist/`. CI runs typecheck → lint → test → build. Per-consumer setup in [§3](../development.md#3-monorepo-topology) (#46).

## Considered options

* **`dist/` typings vs. source export condition vs. TypeScript project references:** `dist/` needs no config and tests the same artefact Render runs, but core must be rebuilt after every change. A `"@battleship/source"` condition removes the rebuild at the cost of configuring every consumer (tsconfig, Vitest, Angular) while keeping production builds on `dist/`. Project references (`tsc -b`) add `composite`/build-info constraints that Angular CLI and Vitest ignore anyway. The source condition was chosen once the client consumed core; production builds still use `dist/`, so the artefact Render runs is unchanged (D22, #46).

## History

As recorded on 2026-10-04, the decision read:

> For now dependents read `@battleship/core` through its `dist/` typings, so CI runs `build` before `typecheck`/`lint`. Planned switch to a source export condition (live types) once the client consumes core: #46.

and its alternative ended with "`dist/` now, source condition when the client lands (D22, #46)." Switched on 2026-10-05 to a source export condition for `@battleship/core` ([#46](https://github.com/fabogit/battleship/issues/46)).

## Links

* Added on 2026-10-04 during the Phase 0 server spike ([#3](https://github.com/fabogit/battleship/issues/3)).
* Spec: [3. Monorepo Topology](../development.md#3-monorepo-topology) · [3.1 Resolving `@battleship/core` (D22)](../development.md#31-resolving-battleshipcore-d22)
* Issues: [#46](https://github.com/fabogit/battleship/issues/46)
