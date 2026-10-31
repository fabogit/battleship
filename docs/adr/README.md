# Architecture decisions

One file per decision, numbered in order. `Dnn` in older notes, issues and commits is `ADR-00nn` here (D21 → [ADR-0021](0021-origin-policy.md)).

| ADR                                                     | Title                                      | Status                 |
| ------------------------------------------------------- | ------------------------------------------ | ---------------------- |
| [ADR-0001](0001-team-play.md)                           | Team play                                  | Accepted, 2026-10-03   |
| [ADR-0002](0002-who-starts.md)                          | Who starts                                 | Accepted, 2026-10-03   |
| [ADR-0003](0003-rules-editing.md)                       | Rules editing                              | Accepted, 2026-10-03   |
| [ADR-0004](0004-stale-confirmation-protection.md)       | Stale-confirmation protection              | Accepted, 2026-10-03   |
| [ADR-0005](0005-placement-sync.md)                      | Placement sync                             | Accepted, 2026-10-03   |
| [ADR-0006](0006-placement-completion.md)                | Placement completion                       | Accepted, 2026-10-03   |
| [ADR-0007](0007-random-placement.md)                    | Random placement                           | Accepted, 2026-10-03   |
| [ADR-0008](0008-disconnection-in-battle.md)             | Disconnection in battle                    | Accepted, 2026-10-03   |
| [ADR-0009](0009-afk.md)                                 | AFK                                        | Accepted, 2026-10-03   |
| [ADR-0010](0010-salvo-vs-extra-turn.md)                 | Salvo vs. extra turn                       | Accepted, 2026-10-03   |
| [ADR-0011](0011-game-over.md)                           | Game over                                  | Accepted, 2026-10-03   |
| [ADR-0012](0012-rematch.md)                             | Rematch                                    | Accepted, 2026-10-03   |
| [ADR-0013](0013-session-persistence.md)                 | Session persistence                        | Accepted, 2026-10-03   |
| [ADR-0014](0014-duplicate-sessions.md)                  | Duplicate sessions                         | Accepted, 2026-10-03   |
| [ADR-0015](0015-protocol-shape.md)                      | Protocol shape                             | Accepted, 2026-10-03   |
| [ADR-0016](0016-payload-validation.md)                  | Payload validation                         | Accepted, 2026-10-03   |
| [ADR-0017](0017-protocol-versioning.md)                 | Protocol versioning                        | Accepted, 2026-10-03   |
| [ADR-0018](0018-i18n.md)                                | i18n                                       | Accepted, 2026-10-03   |
| [ADR-0019](0019-backend-deploy.md)                      | Backend deploy                             | Accepted, 2026-10-03   |
| [ADR-0020](0020-delivery.md)                            | Delivery                                   | Accepted, 2026-10-03   |
| [ADR-0021](0021-origin-policy.md)                       | Origin policy                              | Accepted, 2026-10-04   |
| [ADR-0022](0022-workspace-type-resolution.md)           | Workspace type resolution                  | Accepted, 2026-10-04   |
| [ADR-0023](0023-socket-io-integration.md)               | Socket.io integration                      | Accepted, 2026-10-04   |
| [ADR-0024](0024-preview-origins.md)                     | Preview origins                            | Accepted, 2026-10-04   |
| [ADR-0025](0025-client-server-url.md)                   | Client server URL                          | Superseded by ADR-0052 |
| [ADR-0026](0026-dependency-install-scripts.md)          | Dependency install scripts                 | Accepted, 2026-10-05   |
| [ADR-0027](0027-shutdown-signals.md)                    | Shutdown signals                           | Accepted, 2026-10-05   |
| [ADR-0028](0028-local-tooling.md)                       | Local tooling                              | Accepted, 2026-10-05   |
| [ADR-0029](0029-watch-mode.md)                          | Watch mode                                 | Accepted, 2026-10-07   |
| [ADR-0030](0030-random-number-generation.md)            | Random number generation                   | Accepted, 2026-10-07   |
| [ADR-0031](0031-payload-guard-strictness.md)            | Payload guard strictness                   | Accepted, 2026-10-07   |
| [ADR-0032](0032-fleet-placement.md)                     | Fleet placement                            | Accepted, 2026-10-07   |
| [ADR-0033](0033-turn-resolution.md)                     | Turn resolution                            | Accepted, 2026-10-07   |
| [ADR-0034](0034-shot-history.md)                        | Shot history                               | Accepted, 2026-10-07   |
| [ADR-0035](0035-command-acks.md)                        | Command acks                               | Accepted, 2026-10-07   |
| [ADR-0036](0036-countdown-resync.md)                    | Countdown resync                           | Accepted, 2026-10-07   |
| [ADR-0037](0037-room-transition-shape.md)               | Room transition shape                      | Accepted, 2026-10-07   |
| [ADR-0038](0038-snapshot-projection.md)                 | Snapshot projection                        | Accepted, 2026-10-07   |
| [ADR-0039](0039-room-registry.md)                       | Room registry                              | Accepted, 2026-10-07   |
| [ADR-0040](0040-cell-names.md)                          | Cell names                                 | Accepted, 2026-10-07   |
| [ADR-0041](0041-board-keyboard-navigation.md)           | Board keyboard navigation                  | Accepted, 2026-10-07   |
| [ADR-0042](0042-board-cell-size.md)                     | Board cell size                            | Accepted, 2026-10-07   |
| [ADR-0043](0043-named-constants.md)                     | Named constants for closed string sets     | Accepted, 2026-10-07   |
| [ADR-0044](0044-code-formatter.md)                      | Code formatter                             | Accepted, 2026-10-08   |
| [ADR-0045](0045-socket-seat-binding.md)                 | Socket seat binding                        | Accepted, 2026-10-08   |
| [ADR-0046](0046-commands-ahead-of-room-logic.md)        | Commands ahead of their room logic         | Accepted, 2026-10-08   |
| [ADR-0047](0047-reply-order.md)                         | Reply order                                | Accepted, 2026-10-08   |
| [ADR-0048](0048-echo-smoke-check.md)                    | ECHO as the smoke check                    | Accepted, 2026-10-08   |
| [ADR-0049](0049-room-route.md)                          | One room route for both players            | Accepted, 2026-10-08   |
| [ADR-0050](0050-entry-before-connection.md)             | Room entry before the connection           | Accepted, 2026-10-08   |
| [ADR-0051](0051-signal-forms.md)                        | Signal Forms                               | Accepted, 2026-10-08   |
| [ADR-0052](0052-server-url-build-variable.md)           | Server URL as a build variable             | Accepted, 2026-10-08   |
| [ADR-0053](0053-placement-taps.md)                      | Placement by taps                          | Accepted, 2026-10-08   |
| [ADR-0054](0054-placement-draft-sync.md)                | Placement draft on the client              | Accepted, 2026-10-08   |
| [ADR-0055](0055-isolated-client-tests.md)               | Isolated client test files                 | Accepted, 2026-10-08   |
| [ADR-0056](0056-target-draft.md)                        | Targets by taps                            | Accepted, 2026-10-10   |
| [ADR-0057](0057-battle-layout.md)                       | Battle layout                              | Accepted, 2026-10-10   |
| [ADR-0058](0058-game-over-boards.md)                    | Game-over boards                           | Superseded by ADR-0064 |
| [ADR-0059](0059-jsdoc-enforced-by-lint.md)              | JSDoc on every declaration                 | Accepted, 2026-10-10   |
| [ADR-0060](0060-nickname-characters.md)                 | Nickname characters                        | Accepted, 2026-10-11   |
| [ADR-0061](0061-handshake-checks.md)                    | Handshake checks                           | Accepted, 2026-10-13   |
| [ADR-0062](0062-protocol-version-query.md)              | Protocol version in the query              | Accepted, 2026-10-13   |
| [ADR-0063](0063-session-rebinding.md)                   | Session rebinding                          | Accepted, 2026-10-13   |
| [ADR-0064](0064-game-over-snapshot-boards.md)           | Game-over snapshot boards                  | Accepted, 2026-10-13   |
| [ADR-0065](0065-clock-and-room-timers.md)               | Clock and room timers                      | Accepted, 2026-10-13   |
| [ADR-0066](0066-rate-limit-and-message-size.md)         | Rate limit and message size                | Accepted, 2026-10-13   |
| [ADR-0067](0067-client-address.md)                      | Client address behind the proxy            | Accepted, 2026-10-13   |
| [ADR-0068](0068-postman-replay-test.md)                 | Postman messages replayed by a server test | Accepted, 2026-10-13   |
| [ADR-0069](0069-session-storage-layout.md)              | Session storage layout                     | Accepted, 2026-10-13   |
| [ADR-0070](0070-client-handshake-refusals.md)           | Handshake refusals and resync              | Accepted, 2026-10-13   |
| [ADR-0071](0071-milestone-versioning.md)                | Versions and tags per milestone            | Accepted, 2026-10-14   |
| [ADR-0072](0072-seat-presence.md)                       | Seat presence and disconnect forfeit       | Accepted, 2026-10-15   |
| [ADR-0073](0073-room-lifecycle-with-forfeits.md)        | Room lifecycle with forfeits               | Accepted, 2026-10-15   |
| [ADR-0074](0074-pause.md)                               | Pause                                      | Accepted, 2026-10-15   |
| [ADR-0075](0075-client-connection-states.md)            | Client connection states                   | Accepted, 2026-10-15   |
| [ADR-0076](0076-refused-seat-explanation.md)            | Explaining a refused seat                  | Accepted, 2026-10-15   |
| [ADR-0077](0077-opponent-presence-banner.md)            | Opponent presence banner                   | Accepted, 2026-10-15   |
| [ADR-0078](0078-leaving-before-the-match.md)            | Leaving before the match                   | Accepted, 2026-10-15   |
| [ADR-0079](0079-share-dialog.md)                        | Share dialog                               | Accepted, 2026-10-16   |
| [ADR-0080](0080-leave-room-beside-the-heading.md)       | "Leave room" beside the heading            | Accepted, 2026-10-22   |
| [ADR-0081](0081-one-proxy-hop-on-render.md)             | One trusted proxy hop on Render            | Accepted, 2026-10-22   |
| [ADR-0082](0082-rules-negotiation-commands.md)          | Rules negotiation commands                 | Accepted, 2026-10-29   |
| [ADR-0083](0083-rules-kept-when-a-seat-is-freed.md)     | Rules kept when a seat is freed            | Accepted, 2026-10-29   |
| [ADR-0084](0084-protocol-version-3.md)                  | Protocol version 3 for rules negotiation   | Accepted, 2026-10-29   |
| [ADR-0085](0085-salvo-refused-until-implemented.md)     | Salvo refused until it is implemented      | Accepted, 2026-10-29   |
| [ADR-0086](0086-rules-edits-sent-at-once.md)            | Rules edits sent at once                   | Accepted, 2026-10-29   |
| [ADR-0087](0087-rules-controls-as-native-inputs.md)     | Rules controls as native inputs            | Accepted, 2026-10-29   |
| [ADR-0088](0088-rules-change-notices.md)                | Rules change notices                       | Accepted, 2026-10-29   |
| [ADR-0089](0089-e2e-time-control.md)                    | Time control in the end-to-end suite       | Accepted, 2026-10-29   |
| [ADR-0090](0090-placement-timer.md)                     | Placement timer                            | Accepted, 2026-10-29   |
| [ADR-0091](0091-fleet-completion-at-the-deadline.md)    | Fleet completion at the deadline           | Accepted, 2026-10-29   |
| [ADR-0092](0092-dice-roll-at-match-start.md)            | Dice roll at the start of every match      | Accepted, 2026-10-31   |
| [ADR-0093](0093-dice-animation.md)                      | The dice animation is the starter's turn   | Accepted, 2026-10-31   |
| [ADR-0094](0094-dice-roll-on-reconnect.md)              | The dice roll on reconnect                 | Accepted, 2026-10-31   |
| [ADR-0095](0095-moving-on-frees-a-lone-waiting-seat.md) | Moving on frees a lone waiting seat        | Accepted, 2026-10-31   |
| [ADR-0096](0096-waiting-ttl.md)                         | Waiting TTL                                | Accepted, 2026-10-31   |
| [ADR-0097](0097-room-closed-notice.md)                  | Room-closed notice                         | Accepted, 2026-10-31   |
| [ADR-0098](0098-closed-room-view.md)                    | The closed-room view                       | Accepted, 2026-10-31   |
| [ADR-0104](0104-room-failure-containment.md)            | Room failure containment                   | Accepted, 2026-10-31   |
| [ADR-0105](0105-server-error-on-the-wire.md)            | `SERVER_ERROR` on the wire                 | Accepted, 2026-10-31   |

A new decision gets the next number in a new file here; a change to the specification edits its topic document (see [Review & consolidation](../roadmap.md#review--consolidation)).
