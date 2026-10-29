---
status: accepted
date: 2026-10-03
---

# ADR-0006: Placement completion

When both have confirmed, a start countdown of `min(5 s, remaining placement time)` runs; either player can unlock during it. At the placement deadline the server auto-completes and locks unconfirmed fleets.

## Links

- Added on 2026-10-03 after the requirements analysis session.
- Implemented on 2026-10-29 ([#28](https://github.com/fabogit/battleship/issues/28)): one `PLACEMENT` room timer ([ADR-0090](0090-placement-timer.md)), and completion from the current draft with the server's `Rng` ([ADR-0091](0091-fleet-completion-at-the-deadline.md)).
