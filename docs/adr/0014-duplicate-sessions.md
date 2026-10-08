---
status: accepted
date: 2026-10-03
---

# ADR-0014: Duplicate sessions

Latest connection wins; the previous socket is told `SESSION_REPLACED` and disconnected.

## Considered options

- **"First connection wins" vs. "latest wins":** on mobile a backgrounded tab leaves a zombie socket that the server only detects after the heartbeat timeout (~45 s); "first wins" would lock the returning player out. Latest wins chosen (D14).

## Links

- Added on 2026-10-03 after the requirements analysis session.
