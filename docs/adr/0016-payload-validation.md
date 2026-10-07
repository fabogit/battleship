---
status: accepted
date: 2026-10-03
---

# ADR-0016: Payload validation

Hand-written runtime guards in `core` (zero dependencies), applied by the server to every inbound message.

## Links

* Added on 2026-10-03 after the requirements analysis session.
* Refined by [ADR-0031](0031-payload-guard-strictness.md): guards parse into normalized copies and refuse extra properties.
