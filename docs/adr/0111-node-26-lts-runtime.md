---
status: accepted
date: 2026-11-18
---

# ADR-0111: Node 26 LTS as the runtime

The workspace, CI and both hosts run **Node 26**, the LTS line that became Active LTS with 26.13.0 on 2026-10-28; the repository moves off Node 24 before the M4 feature work starts. The pin has three layers, each with its own precision:

- **`.nvmrc`: the major, `26`.** CI (`node-version-file`) and Render read it, so one file moves both, and a patch release needs no commit.
- **Root `engines.node`: `>=26.13.0 <27.0.0`.** The floor is the first LTS release, so no non-LTS 26.x passes the install, where `engineStrict` in `pnpm-workspace.yaml` enforces it. The four packages have no `engines` field, as before.
- **Cloudflare Pages `NODE_VERSION`: exact, `26.13.1`.** The Pages image resolved a bare `24` to 24.13.1, below Angular 22's floor, and its resolution of `26` cannot be trusted either; the value is set by hand in the Production and the Preview environments and bumped when the `engines` floor moves ([Deployment: Cloudflare Pages](../deployment.md#cloudflare-pages)).

Why now: Angular 22 declares `^22.22.3 || ^24.15.0 || >=26.0.0` for `@angular/build`, `@angular/cli`, `@angular/core` and `@angular/compiler-cli`, so 26 is supported; Node 24 stops being the Active LTS line; and a runtime move is cheapest before the M4 features add code and tests to it. `pnpm verify` and `pnpm e2e` ran green on 26.13.1 with the counts of the Node 24 baseline, and no code changed.

**`@types/node` follows the Node major in `.nvmrc`:** the catalog entry is `^26.6.6`, and the library refresh ([#110](https://github.com/fabogit/battleship/issues/110)) keeps it on that major instead of taking the newest published one.

## Considered options

- **Stay on Node 24 until M5:** nothing is broken on 24, and the move would cost nothing later either. But 24 leaves Active LTS, the M4 features would be written against a runtime the repository leaves right after, and the check ("does everything run on 26?") has the same price now as then, with a smaller codebase.
- **An exact version in `.nvmrc`** (`26.13.1`): every host would run the same patch. It would also make each Node patch release a commit, and Render and CI already resolve the major to a current 26.x; only Pages needs the exact value, for the reason above.
- **A floor of `26.0.0`** (what Angular declares): it admits the 26.x releases before the line became LTS, which are not the ones the repository was verified on. `26.13.0` is the first LTS release, the oldest the repository can claim to support.

## Consequences

- Moving to the next LTS major is the same change: `.nvmrc`, the `engines` range, the `@types/node` catalog entry, `NODE_VERSION` on Pages.
- With `engineStrict`, a build whose Node falls outside `engines` fails at install, in both directions: Pages Production must be switched to `26.13.1` right before the merge of the move (Preview before the PR's build), and a Node 24 machine has to run `fnm use` first.
- Render redeploys on the merge (its build filters include the root files); its deploy log must show a 26.x at or above the floor. If it resolves lower, the fix is an exact version in `.nvmrc`.
- Measurements recorded under Node 24 in older decisions (the fleet generation time in [ADR-0032](0032-fleet-placement.md)) stay as measured.

## Links

- Added on 2026-11-18 for the move to Node 26 ([#143](https://github.com/fabogit/battleship/issues/143)).
- Spec: [Deployment](../deployment.md) · [Overview](../overview.md)
- Related: [ADR-0019](0019-backend-deploy.md) (backend deploy) · [ADR-0020](0020-delivery.md) (delivery)
- Issues: [#143](https://github.com/fabogit/battleship/issues/143) · [#110](https://github.com/fabogit/battleship/issues/110) (library refresh)
