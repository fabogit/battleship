---
status: accepted
date: 2026-10-14
---

# ADR-0071: Versions and tags per milestone

The workspace had no version and no tag: the four `package.json` files said `0.0.0` after two closed milestones.

- **One version for the whole workspace:** the root and the three packages carry the same number. Nothing is published to a registry, so a package has no release of its own.
- **0.x until the game is stable:** each closed milestone raises the minor version, `0.(n+1).0` for `Mn`. `1.0.0` waits for a stable protocol and rules (M3, or M5 at the latest), since SemVer reads `1.0.0` as a stable public interface and M0 was a deploy spike with no protocol yet.
- **The tag goes on the commit that closes the milestone:** an annotated `vX.Y.Z` tag, named after the milestone (`M0 · Deploy spike`). The review issue's last PR bumps the four `package.json` files, and the tag goes on its merge commit. A GitHub Release with short notes that link the retro comment follows the tag.
- **Applied backwards once:** `v0.1.0` marks M0 on `c153fb5` (merge of #67), without touching the files: history is not rewritten, so that commit still says `0.0.0`. `v0.2.0` marks M1 and is the first tag that matches its `package.json` files.

| Milestone           | Version | Commit                                  |
| ------------------- | ------- | --------------------------------------- |
| M0 · Deploy spike   | v0.1.0  | `c153fb5` (#67), files still at `0.0.0` |
| M1 · Vertical slice | v0.2.0  | merge of the PR that bumps the files    |
| M2 · Resilience     | v0.3.0  | merge of the #53 close-out PR           |

`PROTOCOL_VERSION` ([ADR-0017](0017-protocol-versioning.md)) is a separate number: it changes when the wire contract does, not at a milestone.

## Considered options

- **`v1.0.0` after M0:** M0 had no game and no protocol, so the number would promise a stability that M1 then broke.
- **`v1.0.0` after M1:** the first playable build, but the protocol still moves in M2 and M3 (pause, forfeit, timers).
- **Changesets or a version per package:** the packages are private and always ship together; a single number costs nothing to keep.
- **Moving `v0.1.0` to a commit with bumped files:** a bump commit placed after the fact would not be the state that M0 delivered.

## Consequences

- Each `Mn · Review & consolidation` issue gets one more step: bump, tag, release ([Roadmap › Review & consolidation](../roadmap.md#review--consolidation)).
- M1 was closed on 2026-10-13 and #100–#102 (M2 work) are already on `main`, so the `v0.2.0` tag marks the merge of the bump PR and not the end of M1 itself; the M1 end state is `2858f51` (#99).

## Links

- Spec: [Development: Versions](../development.md#versions) · [Roadmap › Review & consolidation](../roadmap.md#review--consolidation)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning)
