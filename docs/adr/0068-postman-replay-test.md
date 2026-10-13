---
status: accepted
date: 2026-10-13
---

# ADR-0068: Postman messages replayed by a server test

`packages/server/test/postman.test.ts` loads every `postman/**/*.message.yaml` and sends it through `socket.io-client` against the in-process test server, so a saved message that no longer matches the protocol fails `pnpm test`. The replay is a list of steps in the test, in the order the collection's descriptions give: each step names a Socket.IO request by its file name (the name Postman shows) and either one of its saved messages with the ack it must get, compared with `toEqual`, or no message and the `connect_error` its connection must end with. A refusal is an expectation like any other: `CREATE_ROOM — invalid payload` expects `{ ok: false, error: 'INVALID_PAYLOAD' }`, and `ECHO — foreign origin` expects its connection to fail. Requests connect over WebSocket, as Postman does, with their headers, and `{{variables}}` come from the collection (`protocolVersion` included) and the `localhost` environment, `baseUrl` pointing at the test server; a step can copy a field of its ack into a variable, as the manual flow copies `roomId`. A second test fails when a saved message, or a Socket.IO request, has no step, so a new message cannot go unchecked (#24, #52).

## Considered options

- **The expectation in the message file** (a description, or a custom field): one place to edit, but Postman's YAML for a Socket.IO message has no description, and the app may drop fields it does not know when it saves the file.
- **Expectations derived from file names** (`— invalid payload` means `INVALID_PAYLOAD`): no table to keep, but a naming convention nobody can see from Postman, and silent when a name does not match.
- **Each message on its own fresh connection:** independent steps, but most messages need a seat, a room or the other player's move first; the replay plays the match the collection describes.
- **Running the collection with `postman-cli`:** the Collection Runner does not run Socket.IO requests, and `collection lint` does not read the saved messages ([Development: Local tooling](../development.md#local-tooling)).

## Consequences

- A new or changed message needs a step in the replay, with the reply it is meant to get. A message meant to be refused states the refusal; a request whose handshake must fail states its `connect_error` message: `ECHO — wrong protocol version` expects `PROTOCOL_MISMATCH` ([ADR-0061](0061-handshake-checks.md)), `ECHO — foreign origin` the refused upgrade.
- Every Socket.IO request carries `?protocolVersion={{protocolVersion}}` ([ADR-0062](0062-protocol-version-query.md)), and the replay waits for each connection to open, so a request that loses the version fails at its first step with `PROTOCOL_MISMATCH`; a test replays the collection with the version stripped to prove it.
- The replay connects over WebSocket only; long polling stays covered by the other server tests.
- `yaml` is a dev dependency of the server.
- The risk "Postman messages are not linted" in the roadmap is resolved.

## Links

- Added on 2026-10-13 for server hardening ([#24](https://github.com/fabogit/battleship/issues/24)), from the M1 review ([#52](https://github.com/fabogit/battleship/issues/52)).
- Spec: [Development: Local tooling](../development.md#local-tooling)
- Related: [ADR-0028](0028-local-tooling.md) (the Postman collection)
- Issues: [#24](https://github.com/fabogit/battleship/issues/24), [#52](https://github.com/fabogit/battleship/issues/52), [#22](https://github.com/fabogit/battleship/issues/22) (handshake messages)
