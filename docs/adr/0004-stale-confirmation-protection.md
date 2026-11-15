---
status: accepted
date: 2026-10-03
---

# ADR-0004: Stale-confirmation protection

Monotonic `rulesVersion` counter (replaces FNV-1a hash).

## Considered options

- **Rules hash (FNV-1a) vs. version counter:** same protection; the hash requires identical canonical serialization on client and server. Counter chosen (D4).

## Links

- Added on 2026-10-03 after the requirements analysis session.
- Implemented on 2026-10-29 ([#26](https://github.com/fabogit/battleship/issues/26)): the rules commands and the version counter in [ADR-0082](0082-rules-negotiation-commands.md).
