---
status: accepted
date: 2026-10-08
---

# ADR-0044: Code formatter

Prettier formats the whole repo: TypeScript, Angular templates, CSS, JSON, YAML and Markdown, with `printWidth: 120`, `singleQuote: true` and `trailingComma: "all"`, the style the code already followed by hand. Templates under `packages/client` use Prettier's `angular` parser, which understands the `@if`/`@for` control flow. JSON keys are sorted at every level (`prettier-plugin-sort-json`): `$schema`, `extends`, `name` and `label` first, the rest alphabetically. Husky + lint-staged run `prettier --write` on the staged files before every commit; CI runs `pnpm format:check`, since a hook can be skipped with `--no-verify`. Lint, typecheck and tests stay out of the hook to keep commits fast; `pnpm verify` runs every check before a pull request. The first run and the first key sort are formatting-only commits listed in `.git-blame-ignore-revs`. Details in [Development: Code conventions](../development.md#code-conventions) and [Local tooling](../development.md#local-tooling) (#86).

## Considered options

- **Biome:** one fast binary for formatting and linting, but it does not format Markdown yet (a formatter is in development) and its Angular template support is partial. Its linter has no equivalent of typescript-eslint's type-checked rules, so it would sit next to ESLint as a formatter only, the same place Prettier takes.
- **dprint:** fast, with its own plugins for TypeScript, JSON and Markdown. Angular templates, CSS and YAML need third-party plugins or `dprint-plugin-prettier`, which wraps Prettier: two tools and two configurations for what Prettier does alone.
- **No formatter (the previous state):** line wrapping and import layout were kept by hand and had drifted (#84, PR #85); every sweep and review spent time on them.
- **Markdown included vs. excluded:** the docs and ADRs are most of the repo's files. Prettier changes only their source (`-` list markers, aligned tables, `_` for emphasis) and never rewraps prose (`proseWrap: "preserve"`), so a later diff still shows the sentence that changed. Code blocks inside Markdown are left as written (`embeddedLanguageFormatting: "off"`): they are samples sized for reading, and reformatting them changed how `docs/domain.md` renders. GitHub's rendering (`gh api markdown -f mode=gfm`) of every `.md` file was identical before and after the first run.
- **JSON keys — sorted vs. as written:** sorted keys put a setting in a predictable place, and a new key has one place to go instead of wherever its author added it. A few keys stay first because they say what the rest is: `$schema`, `extends` (tsconfig), `name` (launch configurations) and `label` (tasks). Pure alphabetical order was rejected for burying them (`extends` below `compilerOptions`); sorting only the top level, for leaving `compilerOptions` and `angular.json` unsorted.
- **`package.json` sorted too:** rejected. The order of the `exports` conditions is significant (`@battleship/source` before `types`, `types` before `default`), and npm's conventional order (`name`, `version`, …, `scripts`, dependencies) is what readers expect. The plugin does not touch them: Prettier reads `package.json` with its `json-stringify` parser.

## Consequences

- No `eslint-config-prettier`: `js.configs.recommended` and `strictTypeChecked` carry no stylistic rule that conflicts with Prettier (checked with its CLI; `no-unexpected-multiline` is compatible).
- Not formatted (`.prettierignore`): files written by tools, namely `pnpm-lock.yaml`, `skills-lock.json`, `postman/` and `.postman/` (the Postman app, [ADR-0028](0028-local-tooling.md)). `.gitignore` is read too.
- The root `prepare` script installs the hook on every `pnpm install`, the filtered installs on Render and Cloudflare Pages included. It is `husky || true`: Husky exits 0 without `.git`, and `|| true` covers an install without dev dependencies (`--prod`), where the binary is missing. A broken hook setup therefore never fails an install; CI is the gate. `prepare` is a root script, not a dependency's install script, so `allowBuilds` is unchanged ([ADR-0026](0026-dependency-install-scripts.md)).
- `.git-blame-ignore-revs` holds full SHAs, so a pull request that adds a formatting commit is merged with "Create a merge commit": squash and rebase rewrite the SHA. GitHub reads the file by itself; `git blame` reads it once `blame.ignoreRevsFile` is set.
- Sorting moves a comment with the key that follows it, so a comment describes one key. Thematic groups of keys separated by blank lines do not survive (`tsconfig.base.json` lost them); arrays keep their order, so the order of `overrides`, `configurations` and `references` still means what it says.
- Prettier may change its output in a minor release. The lockfile pins the version CI runs; an upgrade that reformats files does so in a commit of its own, added to `.git-blame-ignore-revs`.

## Links

- Added on 2026-10-08 after the named constants sweep ([#84](https://github.com/fabogit/battleship/issues/84)).
- Spec: [Development: Code conventions](../development.md#code-conventions) · [Development: Local tooling](../development.md#local-tooling)
- Related: [ADR-0026](0026-dependency-install-scripts.md) (dependency install scripts) · [ADR-0028](0028-local-tooling.md) (local tooling)
- Issues: [#86](https://github.com/fabogit/battleship/issues/86)
