# 1002 - CODEX PROMPTS LATER STEPS

## Status
- Ready-to-paste prompt file
- Intended for later Track 51 steps after the foundational `1001` sequence is substantially complete

## Purpose
Provide Codex prompts for the later Track 51 implementation slices that depend on the reporting and close-pack foundations stabilized by `1001`.

## Source Of Truth

Use these prompts with:

- `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md`
  - roadmap lock
- `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md`
  - implementation tracker
- `PR-STEPS/1001-CODEX-PROMPTS.md`
  - foundational prompt sequence that should be substantially complete first

## Use This File After

Use `1002` once the repo has a stable enough foundation from `1001`, especially:

- shared reporting contract and route/permission scaffolding
- real `Mizan`
- shared `Defter-i Kebir` ledger engine
- local close-pack domain foundation
- first-pass workflow / enforcement / reopen foundation

This file is intentionally later because these prompts assume the earlier seams now exist in real code, not only in roadmap notes.

## Current Later-Step Order

1. `RP04`
2. `RP05`
3. `RP07`
4. `RP10`
5. `RP11`
6. `RP12`
7. `RP13`

---

## Prompt 1 - `RP04` `Muavin` mode with dimensional and subledger filters

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.

Work only on `RP04` `Muavin` mode with dimensional and subledger filters.

Before changing code:
- verify the current shared `Defter-i Kebir` ledger engine now in the repo
- verify whether the cleanest implementation is:
  - a separate `/app/muavin` page
  - or a preset/mode over the same ledger page
- update `51A` if the real seams differ materially

Implement:
- `Muavin` as a reporting mode over the shared ledger-detail engine
- stronger filters for operating unit, subledger reference, source module/type, journal status, include reversed, and account range
- first-pass grouping/preset behavior aligned with Track 51
- consistent drillthrough behavior with the shared ledger engine

Constraints:
- do not create a second independent ledger engine
- do not broaden into reconciliation views yet
- update `51` only if a roadmap-level assumption is wrong

At the end:
- run relevant checks
- summarize files changed, mode approach chosen, filters added, and remaining gaps
```

---

## Prompt 2 - `RP05` Local `Bilanco` and `Gelir Tablosu`

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.

Work only on `RP05` local legal-entity `Bilanco` and `Gelir Tablosu`.

Before changing code:
- verify current consolidated statement seams in the repo
- verify whether any local statement foundation already exists
- update `51A` if the real seams differ materially

Implement:
- local `/app/bilanco`
- local `/app/gelir-tablosu`
- backend read surfaces needed for local statement outputs
- drillthrough path from statement row to account summary / ledger detail
- explicit first-pass statement semantics aligned with Track 51

Constraints:
- do not reuse consolidated statement semantics blindly
- do not broaden into BI or management reporting redesign
- keep local statement contracts aligned with posted local accounting basis
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, statement contract decisions, drillthrough status, and remaining gaps
```

---

## Prompt 3 - `RP07` Local close pack workspace, evidence pack, and report-launch integration

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.

Work only on `RP07` local close pack workspace, evidence pack, and report-launch integration.

Before changing code:
- verify the local close-pack domain now available in the repo
- verify reusable evidence, comment, and audit patterns from other modules
- update `51A` if the actual UI/domain seams differ materially

Implement:
- a local close workspace shell
- a local close pack detail shell with the required tabs
- report-launch integration into local report pages with prefilled scope
- first-pass evidence, comment, and audit surfaces
- close-context display in launched report headers where practical

Constraints:
- do not change the underlying close-pack status model in this step unless required
- do not broaden into full post-lock enforcement or reopen policy
- reuse existing evidence patterns where they fit
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, workspace behavior, report-launch behavior, and remaining gaps
```

---

## Prompt 4 - `RP10` OU / subledger reconciliation and exception reporting

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.

Work only on `RP10` OU / subledger reconciliation and exception reporting.

Before changing code:
- verify the current report family and exception/reconciliation UI seams in the repo
- identify which reconciliation slice is most realistic for the first implementation pass
- update `51A` if the real seams differ materially

Implement:
- one first-pass reconciliation / exception slice within the Track 51 report family
- drillthrough from exception/reconciliation rows to journal and source detail
- saved-variant or reusable filter behavior if practical in the existing report family

Constraints:
- do not try to implement every reconciliation type in one pass unless the repo seam is unusually clean
- keep OU as filter/grouping/reconciliation axis, not a separate accounting engine
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, which reconciliation slice was implemented, and what remains
```

---

## Prompt 5 - `RP11` Entity submitted/locked to consolidated drill-across

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.

Work only on `RP11` entity submitted/locked to consolidated drill-across reporting.

Before changing code:
- verify the current consolidation report seams and local report pages now available in the repo
- verify canonical mapping and member-breakdown seams
- update `51A` if the actual seams differ materially

Implement:
- drill-across from consolidated summary into meaningful member-level support detail
- member breakdown -> local report navigation chain
- navigation contracts that preserve mapping awareness and do not fake one-to-one local account lineage

Constraints:
- do not bypass the mapping layer
- do not pretend every consolidated row can drill directly to one local account
- keep local and consolidated filter semantics aligned
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, drill-across behavior, and remaining limitations
```

---

## Prompt 6 - `RP12` Close / consolidation checks, approvals, publish states, and report-based blockers

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.

Work only on `RP12` close / consolidation checks, approvals, publish states, and report-based blockers.

Before changing code:
- verify the current close-pack, entity-close, and consolidation seams in the repo
- identify which blocker/warning chain is realistic for the first implementation pass
- update `51A` if the real seams differ materially

Implement:
- first-pass report-backed warnings and/or blockers
- machine-readable reason codes
- clear operator drill paths from blocker -> report -> journal -> source
- explicit status progression support where the repo now has enough foundation

Constraints:
- do not build opaque hidden accounting logic
- keep every block explainable from posted truth and workflow state
- prefer a smaller set of solid, explainable gates over many partial ones
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, blocker logic added, and what remains deferred
```

---

## Prompt 7 - `RP13` Export, report fingerprinting, and performance hardening

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.

Work only on `RP13` export, report fingerprinting, and performance hardening.

Before changing code:
- verify the current Track 51 report family now available in the repo
- identify the most valuable first hardening slice:
  - export
  - fingerprinting
  - performance
- update `51A` if the actual seams differ materially

Implement:
- one first-pass hardening slice for the Track 51 report family
- keep report semantics unchanged
- add stable fingerprint, export, or performance behavior aligned with Track 51

Constraints:
- do not rewrite report semantics during hardening
- prefer additive hardening over redesign
- if performance work is partial, make the limitation explicit
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, hardening slice implemented, and remaining scale/audit gaps
```

---

## Usage Note

Use `1002` after the foundational `1001` sequence is stable enough that the later prompts can target real implemented seams rather than roadmap-only assumptions.

If implementation reveals a better seam:

- update `51A` first
- update `51` only if a roadmap-level lock or repo-fit statement is actually wrong

Do not start later prompts until the earlier foundational contracts they depend on are stable enough for reuse.
