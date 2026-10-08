---
status: accepted
date: 2026-10-05
---

# ADR-0028: Local tooling

Manual checks live in a Postman collection committed through Postman Native Git (Collection v3 YAML under `postman/`, workspace link in `.postman/`); every issue that adds a REST route or a Socket.IO event updates it. `.vscode/` is committed: debug configurations for server, client and their tests, and a YAML schema override for `postman/`. Details in [Local tooling](../development.md#local-tooling) (#61).

## Considered options

- **Postman collection — cloud workspace with JSON export vs. Native Git files:** the free plan cannot export a multi-protocol collection, the Postman API only manages HTTP collections, and the v2.1 JSON format cannot hold Socket.IO requests. Native Git writes the collection as YAML files in the repo, so requests are diffed and reviewed with the code. A long-polling Socket.IO flow driven as plain HTTP requests (runnable in the Collection Runner) was tried and dropped: the server tests already cover both transports (D28).

## Links

- Added on 2026-10-05 for local tooling: Postman collection and VS Code configuration ([#61](https://github.com/fabogit/battleship/issues/61)).
- Spec: [Development: Local tooling](../development.md#local-tooling) · [Development: Monorepo topology](../development.md#monorepo-topology)
- Issues: [#61](https://github.com/fabogit/battleship/issues/61)
