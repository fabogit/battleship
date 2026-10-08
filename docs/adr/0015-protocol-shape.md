---
status: accepted
date: 2026-10-03
---

# ADR-0015: Protocol shape

Snapshot-driven: the server pushes a full per-player `STATE` snapshot after every change; a few extra events exist purely for animations.

## Considered options

- **Event deltas vs. snapshots:** state is tiny (< 5 KB); snapshots make reconnection and client state trivial and remove a whole class of desync bugs (D15).

## Links

- Added on 2026-10-03 after the requirements analysis session.
