# Battleship

Real-time 1v1 Battleship in the browser: create a private room, share the link and play a friend on desktop or mobile.

## Live

|                           | URL                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Client (Cloudflare Pages) | <https://battleship-ac7.pages.dev>                                                                              |
| Server (Render)           | <https://battleship-server-jumc.onrender.com> ([`/health`](https://battleship-server-jumc.onrender.com/health)) |

The server runs on Render's free tier and sleeps when idle: the first visit waits about 25 s while it wakes up. Until milestone M1 the client is a connection check, not the game yet (see the [roadmap](docs/roadmap.md)).

## Prerequisites

- **Node.js 24**, as pinned in [`.nvmrc`](.nvmrc); the root `engines` field asks for `>=24.15.0` and the install fails outside that range.
- **pnpm 11**, pinned by `packageManager` in [`package.json`](package.json). With `corepack enable`, the `pnpm` command runs exactly that version.

## Quick start

```bash
cp packages/server/.env.example packages/server/.env   # local PORT, ALLOWED_ORIGINS and log settings
pnpm install
pnpm dev   # server on http://localhost:3000 (try: curl localhost:3000/health), client on http://localhost:4200
```

`pnpm dev` restarts the server and reloads the client whenever server, core or client code changes. To run the built server, as production does: `pnpm build && pnpm --filter @battleship/server start`. Debug configurations for VS Code and the Postman collection are described in [Local tooling](docs/development.md#local-tooling).

## Checks

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

CI runs the same steps, in this order, on every pull request and on every push to `main` ([`ci.yml`](.github/workflows/ci.yml)); `pnpm verify` runs them all locally. A pre-commit hook formats the staged files with Prettier ([Local tooling](docs/development.md#local-tooling)).

## Docs

| Document                           | Contents                                                               |
| ---------------------------------- | ---------------------------------------------------------------------- |
| [Overview](docs/overview.md)       | Product scope, the good-faith principle, technical constraints         |
| [Development](docs/development.md) | Monorepo layout, how `@battleship/core` is resolved, local tooling     |
| [Deployment](docs/deployment.md)   | Render facts that shape the design, backend and frontend deploys       |
| [Domain](docs/domain.md)           | Constants, domain types, rules, placement, shot engine                 |
| [Server](docs/server.md)           | Room state machine, transition rules, sessions, hardening, testability |
| [Protocol](docs/protocol.md)       | Socket.io events, the snapshot, error codes                            |
| [Client](docs/client.md)           | Reactive model, board and interaction, layout, cold-start handling     |
| [Roadmap](docs/roadmap.md)         | Milestones, review & consolidation, open risks                         |
| [Decisions](docs/adr/README.md)    | One file per architecture decision, ADR-0001 to ADR-0028               |
| [Glossary](GLOSSARY.md)            | Domain terms and the words to avoid                                    |

## How work is tracked

- **Milestones:** GitHub [milestones](https://github.com/fabogit/battleship/milestones) M0–M5 follow the [roadmap](docs/roadmap.md#implementation-roadmap); each one ends with a [review & consolidation](docs/roadmap.md#review--consolidation) issue.
- **Board:** the [project board](https://github.com/users/fabogit/projects/3) shows every issue and its status.
- **Flow:** one issue → one branch → one pull request, which closes the issue.
- **CI:** required on `main`; a pull request merges only when it passes.
- **Docs:** a new decision gets a new file in [`docs/adr/`](docs/adr/README.md); a change to the specification edits its topic document.
