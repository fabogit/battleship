# Battleship Architecture Decision Record (ADR) & Implementation Specification

This document was split into topic documents and one file per decision (#69). Its history up to the split stays in git: `git log --follow docs/architecture_and_implementation_plan.md`.

| Old section                                             | New location                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Status (revision line)                                  | Dropped: history lives in git; each decision file records its date                                                             |
| §1. Context & Constraints                               | [Overview](overview.md)                                                                                                        |
| §1.1 Product Scope (v1)                                 | [Overview: Product scope (v1)](overview.md#product-scope-v1)                                                                   |
| §1.2 Design Principle: Good Faith                       | [Overview: Design principle: good faith](overview.md#design-principle-good-faith)                                              |
| §1.3 Technical Constraints                              | [Overview: Technical constraints](overview.md#technical-constraints)                                                           |
| §1.4 Hosting Facts That Shape the Design (Render Free)  | [Deployment: Hosting facts (Render Free)](deployment.md#hosting-facts-render-free)                                             |
| §2 Decision Summary (D1–D28)                            | [Architecture decisions](adr/README.md): one file per decision, D21 → [`adr/0021-origin-policy.md`](adr/0021-origin-policy.md) |
| §2.1 Alternatives Considered                            | "Considered options" in each decision file                                                                                     |
| §3. Monorepo Topology                                   | [Development: Monorepo topology](development.md#monorepo-topology)                                                             |
| §3.1 Resolving `@battleship/core` (D22)                 | [Development: Resolving `@battleship/core`](development.md#resolving-battleshipcore)                                           |
| §3.2 Local Tooling (D28)                                | [Development: Local tooling](development.md#local-tooling)                                                                     |
| §4. Deployment                                          | [Deployment](deployment.md)                                                                                                    |
| §4.1 Backend (Render Free Web Service)                  | [Deployment: Backend (Render)](deployment.md#backend-render)                                                                   |
| §4.2 Frontend (Cloudflare Pages)                        | [Deployment: Frontend (Cloudflare Pages)](deployment.md#frontend-cloudflare-pages)                                             |
| §4.3 Cold-Start Handling (client `ServerWakeService`)   | [Client: Cold-start handling](client.md#cold-start-handling)                                                                   |
| §5. Domain Specification (`packages/core`)              | [Domain](domain.md)                                                                                                            |
| §5.1 Constants (`constants.ts`)                         | [Domain: Constants](domain.md#constants)                                                                                       |
| §5.2 Domain Types (`types.ts`)                          | [Domain: Domain types](domain.md#domain-types)                                                                                 |
| §5.3 Rules (`rules.ts`)                                 | [Domain: Rules](domain.md#rules)                                                                                               |
| §5.4 Placement (`placement.ts`)                         | [Domain: Placement](domain.md#placement)                                                                                       |
| §5.5 Shot Engine (`engine.ts`)                          | [Domain: Shot engine](domain.md#shot-engine)                                                                                   |
| §6. Server Behaviour (`packages/server`)                | [Server](server.md)                                                                                                            |
| §6.1 Room State Machine                                 | [Server: Room state machine](server.md#room-state-machine)                                                                     |
| §6.2 Transition Rules                                   | [Server: Transition rules](server.md#transition-rules)                                                                         |
| §6.3 Sessions & Reconnection                            | [Server: Sessions & reconnection](server.md#sessions--reconnection)                                                            |
| §6.4 Hardening                                          | [Server: Hardening](server.md#hardening)                                                                                       |
| §6.5 Testability                                        | [Server: Testability](server.md#testability)                                                                                   |
| §7. Protocol Contract (`packages/core/src/protocol.ts`) | [Protocol](protocol.md)                                                                                                        |
| §7.1 Client → Server                                    | [Protocol: Client → server](protocol.md#client--server)                                                                        |
| §7.2 Server → Client                                    | [Protocol: Server → client](protocol.md#server--client)                                                                        |
| §7.3 Snapshot                                           | [Protocol: Snapshot](protocol.md#snapshot)                                                                                     |
| §7.4 Error Codes                                        | [Protocol: Error codes](protocol.md#error-codes)                                                                               |
| §8. Client Architecture (`packages/client`)             | [Client](client.md)                                                                                                            |
| §8.1 Reactive Model                                     | [Client: Reactive model](client.md#reactive-model)                                                                             |
| §8.2 Board & Interaction                                | [Client: Board & interaction](client.md#board--interaction)                                                                    |
| §8.3 Layout                                             | [Client: Layout](client.md#layout)                                                                                             |
| §9. Implementation Roadmap                              | [Roadmap: Implementation roadmap](roadmap.md#implementation-roadmap)                                                           |
| §9, "Review & consolidation" paragraph                  | [Roadmap: Review & consolidation](roadmap.md#review--consolidation)                                                            |
| §10. Open Risks                                         | [Roadmap: Open risks](roadmap.md#open-risks)                                                                                   |
