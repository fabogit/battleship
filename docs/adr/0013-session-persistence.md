---
status: accepted
date: 2026-10-03
---

# ADR-0013: Session persistence

`localStorage`, one entry per room with expiry, behind a `SessionStore` abstraction (swappable for native app).

## Considered options

* **`sessionStorage` vs. `localStorage`:** `sessionStorage` is per-tab; on mobile, re-opening the room link (e.g. from WhatsApp) opens a new tab and the player could not rejoin their own match. `localStorage` chosen (D13).

## Links

* Added on 2026-10-03 after the requirements analysis session.
