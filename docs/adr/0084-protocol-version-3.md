---
status: accepted
date: 2026-10-29
---

# ADR-0084: Protocol version 3 for rules negotiation

`PROTOCOL_VERSION` goes from 2 to 3 ([ADR-0017](0017-protocol-versioning.md)): `JOIN_ROOM` now moves a room to `RULES_NEGOTIATION` instead of `PLACEMENT`. No payload or snapshot field changes shape, and `rules`, `rulesVersion` and `hasConfirmedRules` were already in the snapshot. But a client built before the rules UI (#27) has no way out of the new phase: it shows its waiting screen and never sends `CONFIRM_RULES`, so both players would be stuck in a room that only their forfeits close. With version 3, a tab opened before the deploy is refused at the handshake with `PROTOCOL_MISMATCH` and asked to reload, which loads a client that can negotiate.

## Considered options

- **Keeping version 2**, since the wire format is unchanged: the server would accept old tabs into a phase they cannot leave. The version exists so that a client and a server that disagree on what the protocol means refuse each other ([ADR-0064](0064-game-over-snapshot-boards.md) bumped for an added field on the same grounds).
- **Skipping negotiation for version-2 clients:** two behaviours on one server, and a room whose players run different versions would have no consistent phase.

## Consequences

- #26 and #27 merge together. On its own, #26 would deploy a client that sends version 3 but has no rules screen, and every room would stop in `RULES_NEGOTIATION`.
- The Postman collection's `protocolVersion` variable, the `ECHO` example and `docs/domain.md` say 3; the core smoke test pins it.
- The browser client in this PR (before #27) shows its waiting screen during negotiation.

## Links

- Added on 2026-10-29 for rules negotiation ([#26](https://github.com/fabogit/battleship/issues/26)).
- Spec: [Domain: Constants](../domain.md#constants) · [Protocol: Handshake](../protocol.md#handshake)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning) · [ADR-0061](0061-handshake-checks.md) (handshake checks) · [ADR-0082](0082-rules-negotiation-commands.md)
- Issues: [#26](https://github.com/fabogit/battleship/issues/26) · [#27](https://github.com/fabogit/battleship/issues/27)
