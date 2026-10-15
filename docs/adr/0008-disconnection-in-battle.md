---
status: accepted
date: 2026-10-03
---

# ADR-0008: Disconnection in battle

Match auto-pauses. The connected player can resume/re-pause. Pause freezes the turn timer. The disconnected player forfeits after 3 minutes (`DISCONNECT_FORFEIT_MS`) regardless of pause state.

## Links

- Added on 2026-10-03 after the requirements analysis session.
- Implemented on 2026-10-15 ([#23](https://github.com/fabogit/battleship/issues/23)): seat presence and the forfeit in [ADR-0072](0072-seat-presence.md), the pause in [ADR-0074](0074-pause.md); the turn timer it freezes lands with #30.
