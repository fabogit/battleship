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
