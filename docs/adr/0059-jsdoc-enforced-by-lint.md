---
status: accepted
date: 2026-10-10
---

# ADR-0059: JSDoc on every declaration, enforced by lint

Every declaration in `src/` and `scripts/` of `core`, `server` and `client` carries a JSDoc block, exported or not: functions, classes and their constructors, methods, accessors and fields (injected services and private signals included), module-level constants, interfaces and type aliases with their members, and each value of a closed string set ([ADR-0043](0043-named-constants.md)). A block says what the signature does not: purpose, units, ranges and invariants, side effects (timers, emits, signal writes), when it throws, and the doc section or ADR behind it. `@param`, `@returns` and `@throws` have descriptions and no types, and the public `core` API (placement, engine, validation guards, the seeded generator) has `@example`s. `eslint-plugin-jsdoc` enforces it in `eslint.config.js`, so `pnpm lint` and CI fail on a missing block. Test and config files are left out: test names document behaviour. Details in [Development: Code conventions](../development.md#code-conventions) (#68).

## Considered options

- **Convention without lint (the state through M1):** new code followed it once #68 was filed, but nothing checked the older code. On `main` before this pass, the rules below found 96 declarations without a block, 9 blocks missing a description, a `@param` or a `@returns`, and 17 descriptions that only repeated the name. Review notices a bad comment but rarely an absent one.
- **Exported-only coverage (`publicOnly: true`):** half the work, but most of the reasoning lives in private code: the backtracking and `Occupancy` behind fleet placement, the room transitions, the guards' helpers, and the backing signals of the client stores, where the comment says who writes them and when.
- **A generated docs site (TypeDoc):** not needed for now. The readers are the people changing the code, and editors already show the JSDoc on hover; the specification is `docs/`. A site could be generated from the same comments later.
- **Leaving "restates the name" to review alone:** `jsdoc/informative-docs` catches the mechanical case (`@param roomId The room's id.`), so it is on; review still judges the rest, such as a description that restates the type.

## Consequences

- On top of `flat/recommended-typescript-error` and `require-jsdoc`: `require-description` (an empty block, or one with tags only, does not count) and `informative-docs`. `require-throws-type`, part of the preset, is off: `@throws` says when, the type is TypeScript's.
- `require-jsdoc` runs with `enableFixer: false`: `eslint --fix` would otherwise insert empty blocks.
- A destructured parameter is documented as a whole (`@param coordinate`, not `coordinate.x`): its fields are documented on their type. A getter needs no `@returns`: it reads like a property, so its description says what it returns.
- Not declarations, and so not checked: local variables and callbacks inside functions, and inline object types in casts or type arguments. The members of `CLIENT_EVENTS` and `SERVER_EVENTS` are exempt too, since `satisfies` ties each key to its event in `ClientToServerEvents` and `ServerToClientEvents`, where every event is documented.
- Comments are stripped from the bundle: the client's `main-*.js` was byte-identical before and after the documentation pass.
- `eslint-plugin-jsdoc` is pinned to `^65.2.2`. 65.2.3 and 65.2.4 were published the same day, inside pnpm 11's one-day `minimumReleaseAge`, and a newer version would have needed a `minimumReleaseAgeExclude` entry; the next dependency update picks them up.

## Links

- Added on 2026-10-10 for the documentation pass at the end of M1 ([#68](https://github.com/fabogit/battleship/issues/68)).
- Spec: [Development: Code conventions](../development.md#code-conventions)
- Related: [ADR-0043](0043-named-constants.md) (closed string sets, documented value by value), [ADR-0044](0044-code-formatter.md) (Prettier formats, ESLint checks)
- Issues: [#68](https://github.com/fabogit/battleship/issues/68)
