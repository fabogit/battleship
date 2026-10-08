---
status: accepted
date: 2026-10-08
---

# ADR-0046: Commands ahead of their room logic

The server listens to every command of the protocol from the start, and each one passes its core guard first. The commands whose room logic has not landed yet (`UPDATE_RULES`, `CONFIRM_RULES` (#26), `SET_PAUSED` (#23), `SURRENDER` (#35), `REMATCH_CHOICE` (#36), `LEAVE_ROOM` (#23)) are then refused with `NOT_ALLOWED`, whatever the room's phase. Each issue that adds the room logic replaces the refusal with the real handler. Details in [Server: Socket handlers](../server.md#socket-handlers) (#15).

## Considered options

- **No listener until the room logic lands:** the client would get no ack and wait `ACK_TIMEOUT_MS` for `NO_ACK` ([ADR-0035](0035-command-acks.md)), which it reads as a dead connection, and the payload would never meet its guard.
- **The code each command will answer in the final protocol** (`WRONG_PHASE` for the rules commands, since no room is ever in `RULES_NEGOTIATION`; `NOT_ALLOWED` for `SET_PAUSED`, since no opponent is ever disconnected; …): accurate for some, invented for `SURRENDER` and `LEAVE_ROOM`, which every later phase accepts. One code for all keeps the handlers trivial until each is replaced.
- **A new error code (`NOT_IMPLEMENTED`):** the error codes are a closed contract the client maps to messages ([ADR-0031](0031-payload-guard-strictness.md)); a code that only lives for a few milestones is not worth a protocol change.

## Consequences

- The client (#17, #20) must not offer these actions before their issue lands; if it does, the player sees the `NOT_ALLOWED` message.

## Links

- Added on 2026-10-08 for the socket handlers ([#15](https://github.com/fabogit/battleship/issues/15)).
- Spec: [Server: Socket handlers](../server.md#socket-handlers) · [Protocol: Client → server](../protocol.md#client--server)
- Related: [ADR-0031](0031-payload-guard-strictness.md) (guards before room logic) · [ADR-0035](0035-command-acks.md) (command acks)
- Issues: [#15](https://github.com/fabogit/battleship/issues/15) · [#23](https://github.com/fabogit/battleship/issues/23) · [#26](https://github.com/fabogit/battleship/issues/26) · [#35](https://github.com/fabogit/battleship/issues/35) · [#36](https://github.com/fabogit/battleship/issues/36)
