---
status: accepted
date: 2026-10-14
---

# ADR-0071: Versions and tags per milestone

The workspace had no version and no tag: the four `package.json` files said `0.0.0` after two closed milestones.

- **One version for the whole workspace:** the root and the three packages carry the same number. Nothing is published to a registry, so a package has no release of its own.
- **0.x until the game is stable:** each closed milestone raises the minor version, `0.(n+1).0` for `Mn`. `1.0.0` waits for a stable protocol and rules (M3, or M5 at the latest), since SemVer reads `1.0.0` as a stable public interface and M0 was a deploy spike with no protocol yet.
- **The tag goes on the commit that closes the milestone:** an annotated `vX.Y.Z` tag, named after the milestone (`M0 · Deploy spike`). That is the merge of the last PR of the milestone's review issue, whether or not the `package.json` files already say the new version: the tag says when the version arrived, and the files may follow in a later commit. When it can, that last PR carries the bump. A GitHub Release with short notes that link the retro comment follows the tag.
- **Applied backwards for M0 and M1:** `v0.1.0` marks M0 on `c153fb5` (merge of #67) and `v0.2.0` marks M1 on `2858f51` (merge of #99). History is not rewritten, so both commits still say `0.0.0` in the `package.json` files; the bump to `0.2.0` landed afterwards in #104. `git describe` and the tag list give the real history, and the files catch up from `0.3.0` on.

| Milestone           | Version | Commit                                   |
| ------------------- | ------- | ---------------------------------------- |
| M0 · Deploy spike   | v0.1.0  | `c153fb5` (#67), files still at `0.0.0`  |
| M1 · Vertical slice | v0.2.0  | `2858f51` (#99), files bumped in #104    |
| M2 · Resilience     | v0.3.0  | merge of the #53 close-out PR, with bump |

`PROTOCOL_VERSION` ([ADR-0017](0017-protocol-versioning.md)) is a separate number: it changes when the wire contract does, not at a milestone.

## Considered options

- **`v1.0.0` after M0:** M0 had no game and no protocol, so the number would promise a stability that M1 then broke.
- **`v1.0.0` after M1:** the first playable build, but the protocol still moves in M2 and M3 (pause, forfeit, timers).
- **Changesets or a version per package:** the packages are private and always ship together; a single number costs nothing to keep.
- **Tagging the commit that bumps the files:** it would date M1 after the first M2 merges (#100–#102), and a bump commit placed after the fact is not the state that the milestone delivered.

## Consequences

- Each `Mn · Review & consolidation` issue gets one more step: bump, tag, release ([Roadmap › Review & consolidation](../roadmap.md#review--consolidation)).
- A tag can sit on a commit whose `package.json` files show an older version (M0, M1). The tag is the authority for when a version arrived.

## Links

- Spec: [Development: Versions](../development.md#versions) · [Roadmap › Review & consolidation](../roadmap.md#review--consolidation)
- Related: [ADR-0017](0017-protocol-versioning.md) (protocol versioning)
