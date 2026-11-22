---
status: accepted
date: 2026-10-03
---

# ADR-0012: Rematch

Each player chooses `SAME_RULES` / `CHANGE_RULES` / `LEAVE`. `CHANGE_RULES` wins over `SAME_RULES`.

## Links

- Added on 2026-10-03 after the requirements analysis session.
- Implemented on 2026-11-22 ([#36](https://github.com/fabogit/battleship/issues/36)): `LEAVE` frees the seat at once and the other two choices stay changeable until the rematch resolves ([ADR-0123](0123-rematch-choices-and-leave.md)), which needs both seats connected ([ADR-0124](0124-rematch-needs-both-seats.md)); what the next match starts from is [ADR-0125](0125-what-a-rematch-starts-from.md), and the client's controls [ADR-0126](0126-leaving-the-page-at-game-over.md).
