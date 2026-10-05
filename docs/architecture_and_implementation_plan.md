# Battleship Architecture Decision Record (ADR) & Implementation Specification

This document was split into topic documents and one file per decision (#69). Its history up to the split stays in git: `git log --follow docs/architecture_and_implementation_plan.md`.

| Old section | New location |
|---|---|
| Status (revision line) | Dropped: history lives in git; each decision file records its date |
| §1 | [1. Context & Constraints](overview.md#1-context--constraints) |
| §1.1 | [1.1 Product Scope (v1)](overview.md#11-product-scope-v1) |
| §1.2 | [1.2 Design Principle: Good Faith](overview.md#12-design-principle-good-faith) |
| §1.3 | [1.3 Technical Constraints](overview.md#13-technical-constraints) |
| §1.4 | [1.4 Hosting Facts That Shape the Design (Render Free)](deployment.md#14-hosting-facts-that-shape-the-design-render-free) |
| §2 Decision Summary (D1–D28) | [adr/README.md](adr/README.md): one file per decision, D21 → [`adr/0021-origin-policy.md`](adr/0021-origin-policy.md) |
| §2.1 Alternatives Considered | "Considered options" in each decision file |
| §3 | [3. Monorepo Topology](development.md#3-monorepo-topology) |
| §3.1 | [3.1 Resolving `@battleship/core` (D22)](development.md#31-resolving-battleshipcore-d22) |
| §3.2 | [3.2 Local Tooling (D28)](development.md#32-local-tooling-d28) |
| §4 | [4. Deployment](deployment.md#4-deployment) |
| §4.1 | [4.1 Backend (Render Free Web Service)](deployment.md#41-backend-render-free-web-service) |
| §4.2 | [4.2 Frontend (Cloudflare Pages)](deployment.md#42-frontend-cloudflare-pages) |
| §4.3 | [4.3 Cold-Start Handling (client `ServerWakeService`)](client.md#43-cold-start-handling-client-serverwakeservice) |
| §5 | [5. Domain Specification (`packages/core`)](domain.md#5-domain-specification-packagescore) |
| §5.1 | [5.1 Constants (`constants.ts`)](domain.md#51-constants-constantsts) |
| §5.2 | [5.2 Domain Types (`types.ts`)](domain.md#52-domain-types-typests) |
| §5.3 | [5.3 Rules (`rules.ts`)](domain.md#53-rules-rulests) |
| §5.4 | [5.4 Placement (`placement.ts`)](domain.md#54-placement-placementts) |
| §5.5 | [5.5 Shot Engine (`engine.ts`)](domain.md#55-shot-engine-enginets) |
| §6 | [6. Server Behaviour (`packages/server`)](server.md#6-server-behaviour-packagesserver) |
| §6.1 | [6.1 Room State Machine](server.md#61-room-state-machine) |
| §6.2 | [6.2 Transition Rules](server.md#62-transition-rules) |
| §6.3 | [6.3 Sessions & Reconnection](server.md#63-sessions--reconnection) |
| §6.4 | [6.4 Hardening](server.md#64-hardening) |
| §6.5 | [6.5 Testability](server.md#65-testability) |
| §7 | [7. Protocol Contract (`packages/core/src/protocol.ts`)](protocol.md#7-protocol-contract-packagescoresrcprotocolts) |
| §7.1 | [7.1 Client → Server](protocol.md#71-client--server) |
| §7.2 | [7.2 Server → Client](protocol.md#72-server--client) |
| §7.3 | [7.3 Snapshot](protocol.md#73-snapshot) |
| §7.4 | [7.4 Error Codes](protocol.md#74-error-codes) |
| §8 | [8. Client Architecture (`packages/client`)](client.md#8-client-architecture-packagesclient) |
| §8.1 | [8.1 Reactive Model](client.md#81-reactive-model) |
| §8.2 | [8.2 Board & Interaction](client.md#82-board--interaction) |
| §8.3 | [8.3 Layout](client.md#83-layout) |
| §9 | [9. Implementation Roadmap](roadmap.md#9-implementation-roadmap) |
| §10 | [10. Open Risks](roadmap.md#10-open-risks) |
