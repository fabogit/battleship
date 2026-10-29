---
status: accepted
date: 2026-10-29
---

# ADR-0085: Salvo refused until it is implemented

Until salvo mode lands with #32 (M4), `validateRules` refuses `isSalvoModeEnabled: true` with the violation `SALVO_NOT_IMPLEMENTED`, so `UPDATE_RULES` answers `INVALID_RULES` and the room keeps its rules and `rulesVersion`. The exclusivity with extra turn on hit ([ADR-0010](0010-salvo-vs-extra-turn.md)) is checked first and keeps its own violation, `SALVO_WITH_EXTRA_TURN`. Extra turn on hit stays allowed: the engine already resolves it in standard mode. #32 drops the violation, the check and the test that pins it, and nothing else in the negotiation changes.

The reason is the server process. The core engine throws on salvo (`shotsAllowed`, and so `resolveTurn`) until #32. Once rules can be negotiated (#26), two clients could agree on salvo. The room would then throw at the second `CONFIRM_PLACEMENT`, before any `FIRE`: `startBattle` succeeds, and the `STATE` projection calls `shotsAllowed`. The ack has already gone out at that point. On 2026-10-29, 02:30 UTC (03:30 CET), with `tsx src/index.ts` on port 3000 and two `socket.io-client` players, that throw left the Socket.io listener (`Socket.emitUntyped`) as an uncaught exception. Node printed the stack and exited with code 1, every connection closed with `transport close`, and a third client could no longer connect. The server registers no `uncaughtException` handler and no room handler catches. On Render the process restarts, and every room in memory is lost.

## Considered options

- **Leaving salvo negotiable and catching in the handlers:** the room would be stuck in a phase the engine cannot play, and a catch-all hides the next bug of the same kind. Whether the handlers should be guarded at all is a separate question for the hub, not this decision.
- **Refusing salvo in the room logic instead of `validateRules`:** the client (#27) runs `validateRules` to disable controls, so the check in core keeps the client and the server in agreement, and #32 removes it in one place.
- **Dropping the field from the guard (`INVALID_PAYLOAD`):** the payload shape is the final protocol. A guard that changes when #32 lands would be a protocol change, and `INVALID_PAYLOAD` would tell the client its message is malformed when it only asks for something not available yet.

## Consequences

- #27 shows salvo as unavailable, with `validateRules` as the source.
- The server never holds a room whose rules have salvo on, so no handler reaches the throwing engine path through rules negotiation.
- #32 lifts the refusal: a line in its scope says so.

## Links

- Added on 2026-10-29 for rules negotiation ([#26](https://github.com/fabogit/battleship/issues/26)), at the hub's request.
- Spec: [Domain: Rules](../domain.md#rules) · [Server: Rules negotiation](../server.md#rules-negotiation)
- Related: [ADR-0010](0010-salvo-vs-extra-turn.md) (salvo vs. extra turn) · [ADR-0082](0082-rules-negotiation-commands.md) (rules negotiation commands) · [ADR-0033](0033-turn-resolution.md) (turn resolution)
- Issues: [#26](https://github.com/fabogit/battleship/issues/26) · [#32](https://github.com/fabogit/battleship/issues/32) (salvo mode) · [#27](https://github.com/fabogit/battleship/issues/27) (rules UI)
