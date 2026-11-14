---
status: accepted
date: 2026-10-03
---

# ADR-0003: Rules editing

Both players may edit. Any edit resets both confirmations. Match proceeds when both confirm the same `rulesVersion`.

## Links

- Added on 2026-10-03 after the requirements analysis session.
- Implemented on 2026-10-29 ([#26](https://github.com/fabogit/battleship/issues/26)): the rules commands and the version counter in [ADR-0082](0082-rules-negotiation-commands.md).
- Amended on 2026-11-14 for the M3 review ([#54](https://github.com/fabogit/battleship/issues/54), F13): an edit that changes the rules increments `rulesVersion` and resets both confirmations; an edit to the rules already in place changes nothing, so the version and the confirmations stay ([ADR-0082](0082-rules-negotiation-commands.md)).
