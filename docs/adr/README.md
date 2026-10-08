# Architecture decisions

One file per decision, numbered in order. `Dnn` in older notes, issues and commits is `ADR-00nn` here (D21 → [ADR-0021](0021-origin-policy.md)).

| ADR                                               | Title                                  | Status                 |
| ------------------------------------------------- | -------------------------------------- | ---------------------- |
| [ADR-0001](0001-team-play.md)                     | Team play                              | Accepted, 2026-10-03   |
| [ADR-0002](0002-who-starts.md)                    | Who starts                             | Accepted, 2026-10-03   |
| [ADR-0003](0003-rules-editing.md)                 | Rules editing                          | Accepted, 2026-10-03   |
| [ADR-0004](0004-stale-confirmation-protection.md) | Stale-confirmation protection          | Accepted, 2026-10-03   |
| [ADR-0005](0005-placement-sync.md)                | Placement sync                         | Accepted, 2026-10-03   |
| [ADR-0006](0006-placement-completion.md)          | Placement completion                   | Accepted, 2026-10-03   |
| [ADR-0007](0007-random-placement.md)              | Random placement                       | Accepted, 2026-10-03   |
| [ADR-0008](0008-disconnection-in-battle.md)       | Disconnection in battle                | Accepted, 2026-10-03   |
| [ADR-0009](0009-afk.md)                           | AFK                                    | Accepted, 2026-10-03   |
| [ADR-0010](0010-salvo-vs-extra-turn.md)           | Salvo vs. extra turn                   | Accepted, 2026-10-03   |
| [ADR-0011](0011-game-over.md)                     | Game over                              | Accepted, 2026-10-03   |
| [ADR-0012](0012-rematch.md)                       | Rematch                                | Accepted, 2026-10-03   |
| [ADR-0013](0013-session-persistence.md)           | Session persistence                    | Accepted, 2026-10-03   |
| [ADR-0014](0014-duplicate-sessions.md)            | Duplicate sessions                     | Accepted, 2026-10-03   |
| [ADR-0015](0015-protocol-shape.md)                | Protocol shape                         | Accepted, 2026-10-03   |
| [ADR-0016](0016-payload-validation.md)            | Payload validation                     | Accepted, 2026-10-03   |
| [ADR-0017](0017-protocol-versioning.md)           | Protocol versioning                    | Accepted, 2026-10-03   |
| [ADR-0018](0018-i18n.md)                          | i18n                                   | Accepted, 2026-10-03   |
| [ADR-0019](0019-backend-deploy.md)                | Backend deploy                         | Accepted, 2026-10-03   |
| [ADR-0020](0020-delivery.md)                      | Delivery                               | Accepted, 2026-10-03   |
| [ADR-0021](0021-origin-policy.md)                 | Origin policy                          | Accepted, 2026-10-04   |
| [ADR-0022](0022-workspace-type-resolution.md)     | Workspace type resolution              | Accepted, 2026-10-04   |
| [ADR-0023](0023-socket-io-integration.md)         | Socket.io integration                  | Accepted, 2026-10-04   |
| [ADR-0024](0024-preview-origins.md)               | Preview origins                        | Accepted, 2026-10-04   |
| [ADR-0025](0025-client-server-url.md)             | Client server URL                      | Superseded by ADR-0052 |
| [ADR-0026](0026-dependency-install-scripts.md)    | Dependency install scripts             | Accepted, 2026-10-05   |
| [ADR-0027](0027-shutdown-signals.md)              | Shutdown signals                       | Accepted, 2026-10-05   |
| [ADR-0028](0028-local-tooling.md)                 | Local tooling                          | Accepted, 2026-10-05   |
| [ADR-0029](0029-watch-mode.md)                    | Watch mode                             | Accepted, 2026-10-07   |
| [ADR-0030](0030-random-number-generation.md)      | Random number generation               | Accepted, 2026-10-07   |
| [ADR-0031](0031-payload-guard-strictness.md)      | Payload guard strictness               | Accepted, 2026-10-07   |
| [ADR-0032](0032-fleet-placement.md)               | Fleet placement                        | Accepted, 2026-10-07   |
| [ADR-0033](0033-turn-resolution.md)               | Turn resolution                        | Accepted, 2026-10-07   |
| [ADR-0034](0034-shot-history.md)                  | Shot history                           | Accepted, 2026-10-07   |
| [ADR-0035](0035-command-acks.md)                  | Command acks                           | Accepted, 2026-10-07   |
| [ADR-0036](0036-countdown-resync.md)              | Countdown resync                       | Accepted, 2026-10-07   |
| [ADR-0037](0037-room-transition-shape.md)         | Room transition shape                  | Accepted, 2026-10-07   |
| [ADR-0038](0038-snapshot-projection.md)           | Snapshot projection                    | Accepted, 2026-10-07   |
| [ADR-0039](0039-room-registry.md)                 | Room registry                          | Accepted, 2026-10-07   |
| [ADR-0040](0040-cell-names.md)                    | Cell names                             | Accepted, 2026-10-07   |
| [ADR-0041](0041-board-keyboard-navigation.md)     | Board keyboard navigation              | Accepted, 2026-10-07   |
| [ADR-0042](0042-board-cell-size.md)               | Board cell size                        | Accepted, 2026-10-07   |
| [ADR-0043](0043-named-constants.md)               | Named constants for closed string sets | Accepted, 2026-10-07   |
| [ADR-0044](0044-code-formatter.md)                | Code formatter                         | Accepted, 2026-10-08   |
| [ADR-0045](0045-socket-seat-binding.md)           | Socket seat binding                    | Accepted, 2026-10-08   |
| [ADR-0046](0046-commands-ahead-of-room-logic.md)  | Commands ahead of their room logic     | Accepted, 2026-10-08   |
| [ADR-0047](0047-reply-order.md)                   | Reply order                            | Accepted, 2026-10-08   |
| [ADR-0048](0048-echo-smoke-check.md)              | ECHO as the smoke check                | Accepted, 2026-10-08   |
| [ADR-0049](0049-room-route.md)                    | One room route for both players        | Accepted, 2026-10-08   |
| [ADR-0050](0050-entry-before-connection.md)       | Room entry before the connection       | Accepted, 2026-10-08   |
| [ADR-0051](0051-signal-forms.md)                  | Signal Forms                           | Accepted, 2026-10-08   |
| [ADR-0052](0052-server-url-build-variable.md)     | Server URL as a build variable         | Accepted, 2026-10-08   |

A new decision gets the next number in a new file here; a change to the specification edits its topic document (see [Review & consolidation](../roadmap.md#review--consolidation)).
