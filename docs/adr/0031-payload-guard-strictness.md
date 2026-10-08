---
status: accepted
date: 2026-10-07
---

# ADR-0031: Payload guard strictness

The guards of [ADR-0016](0016-payload-validation.md) parse rather than narrow: each one takes `unknown` and returns a new, normalized copy of the payload, or `null` for `INVALID_PAYLOAD`. Room logic only ever sees that copy, so the nickname arrives already trimmed. The guards are strict: plain objects only, with exactly the declared properties, so an extra property is refused like a missing one, at every level. They check only what no room state could make valid (types, integer ranges, closed enums, string lengths, array sizes); everything that depends on the room keeps its domain error (`INVALID_RULES`, `STALE_RULES`, `INVALID_PLACEMENT`, `INVALID_TARGETS`). Array caps come from the fleet: at most `FLEET.length` ships in a draft and `FLEET.length` targets in a turn, the largest possible salvo. `FIRE` needs at least one target. Nicknames are measured in UTF-16 code units. One guard per command sits in `PAYLOAD_PARSERS`, typed over the command events so a command without a guard does not compile. Details in [Payload validation](../protocol.md#payload-validation) (#13).

## Considered options

- **Ignoring (stripping) extra properties:** tolerant of newer clients, but client and server ship from the same commit and `PROTOCOL_VERSION` already refuses mismatched clients ([ADR-0017](0017-protocol-versioning.md)). An extra property can only be a client bug or a hand-crafted message, and refusing it surfaces the bug instead of hiding it.
- **Type predicates (`isX(value): value is X`):** cannot normalize, so every handler would have to remember to trim the nickname, and room logic would hold the client's own objects.
- **Returning a failure reason:** the client gets `INVALID_PAYLOAD` either way; a reason per check doubles the guard code for debug logs alone.
- **Checking the exact target count or the remaining ships in the guard:** needs the room; the guard stays a pure function of the payload, and the engine already owns those rules.
- **Counting nickname length in code points or graphemes:** fairer to emoji, but the browser's `maxlength` counts UTF-16 code units, and the server and the input field must agree on what fits.
- **Accepting any object (class instances, custom prototypes):** `JSON.parse` never builds them, and a prototype could supply fields the payload does not own.

## Consequences

- A typo in a client field name fails loudly with `INVALID_PAYLOAD` in tests instead of reaching room logic.
- Adding an optional field to a payload is a protocol change for both sides at once, which `PROTOCOL_VERSION` already implies.
- The room id format had to be fixed for its guard: `ROOM_ID_LENGTH` and `ROOM_ID_ALPHABET` are now constants in core ([Constants](../domain.md#constants)).
- The handshake reuses the same checks: a malformed `session` is `SESSION_INVALID` ([Handshake](../protocol.md#handshake)).

## Links

- Added on 2026-10-07 for the protocol contract ([#13](https://github.com/fabogit/battleship/issues/13)).
- Spec: [Protocol: Payload validation](../protocol.md#payload-validation) · [Server: Hardening](../server.md#hardening)
- Refines: [ADR-0016](0016-payload-validation.md)
- Related: [ADR-0032](0032-fleet-placement.md) (placement validation, `INVALID_PLACEMENT`)
- Issues: [#13](https://github.com/fabogit/battleship/issues/13)
