# 51 - PROMPT B

## Status
- Ready-to-paste prompt file
- Intended for later Track 51 steps after the foundational `51 Prompt A` sequence is substantially complete

## Purpose
Provide Codex prompts for the later Track 51 implementation slices that depend on the reporting and close-pack foundations stabilized by `51 Prompt A`.

## Source Of Truth

Use these prompts with:

- `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md`
  - roadmap lock
- `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md`
  - implementation tracker
- `PR-STEPS/51-PROMPT-A.md`
  - foundational prompt sequence that should be substantially complete first

## Use This File After

Use `51 Prompt B` once the repo has a stable enough foundation from `51 Prompt A`, especially:

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
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP04` `Muavin` mode with dimensional and subledger filters.

Before changing code:
- verify the current shared `Defter-i Kebir` ledger engine now in the repo
- verify whether the cleanest implementation is:
  - a separate `/app/muavin` page
  - or a preset/mode over the same ledger page
- verify whether `/app/muavin` already has router, sidebar, and i18n seams in the repo; if not, treat that surfacing as part of the work rather than assuming it exists
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
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

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
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

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
- keep business/UI labels such as `CENTRAL/HQ` separate from implementation enums if the repo still uses `CENTRAL`
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
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

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
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP11` entity submitted/locked to consolidated drill-across reporting.

Before changing code:
- verify the current consolidation report seams and local report pages now available in the repo
- verify canonical mapping and member-breakdown seams
- verify whether existing consolidated trial-balance/summary endpoints should be surfaced in the same reporting flow instead of adding parallel seams
- if revisiting `RP11` after the first shipped slice, treat richer consolidated support detail as additive hardening on the same flow rather than a separate product plan
- update `51A` if the actual seams differ materially

Implement:
- drill-across from consolidated summary into meaningful member-level support detail
- member breakdown -> local report navigation chain
- navigation contracts that preserve mapping awareness and do not fake one-to-one local account lineage
- where local-base support values are shown, keep source/functional-currency context explicit and do not label mixed-currency support rows as if they were one reporting-currency amount

Constraints:
- do not bypass the mapping layer
- do not pretend every consolidated row can drill directly to one local account
- keep local and consolidated filter semantics aligned, including any compatibility mapping between current repo field names and Track 51 canonical names
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
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP12` close / consolidation checks, approvals, publish states, and report-based blockers.

Before changing code:
- verify the current close-pack, entity-close, and consolidation seams in the repo
- identify which blocker/warning chain is realistic for the first implementation pass
- verify whether existing consolidated summary/trial-balance and workflow-instance surfaces can be reused for operator drill paths before adding new parallel endpoints
- verify whether existing year-end REVREC controls can be extended into closing-period vs next-period opening continuity checks before adding a parallel control surface
- update `51A` if the real seams differ materially

Implement:
- first-pass report-backed warnings and/or blockers
- closing-period vs next-period opening continuity checks where applicable, including REVREC deferred/accrual carry-forward and residual reclass closure
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

## Prompt 6B - `RP12` Follow-up blocker / publish completion

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on unresolved `RP12` blocker / publish completion work that remains after the first shipped `RP12` slice.

Before changing code:
- verify the live `RP12` seams already implemented in the repo and recorded in `51A`
- identify which still-deferred `RP12` items are worth pulling forward now:
  - broader end-to-end close / publish blocking across the existing pack / entity / consolidation chain
  - richer consolidation publish math checks
  - whether REVREC continuity mismatches remain warning-only or should become hard blockers
- prefer extending the live `RP12` review-gate seams instead of adding a second blocker engine
- update `51A` if the real seams differ materially

Implement:
- one deeper `RP12` follow-up slice
- strengthen close / publish blocking only where the repo already has explainable posted-truth inputs
- add machine-readable reason codes and operator drill paths for any newly enforced gate
- if REVREC continuity is promoted beyond warning mode, make that policy explicit in code and tracker notes

Constraints:
- keep ownership under `RP12`; do not reframe this as `RP13` hardening
- do not introduce opaque formula-based publish checks that operators cannot trace to reports, journals, workflow state, or source rows
- prefer a small number of strong gates over broad partial enforcement
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize which deferred `RP12` items were closed, which remain open, and whether REVREC continuity is still warning-only or now blocking
```

---

## Prompt 7 - `RP13` Export, report fingerprinting, and performance hardening

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP13` export, report fingerprinting, and performance hardening.

Before changing code:
- verify the current Track 51 report family now available in the repo
- identify the most valuable first hardening slice:
  - export
  - fingerprinting
  - performance
- if unresolved blocker / publish governance items still remain and they are not clearly additive hardening, use `Prompt 6B` first instead of silently absorbing them into `RP13`
- if the current repo now has a live `RP11` consolidated drill-across flow, treat richer consolidated support detail hardening as an eligible `RP13` slice when that yields better audit/review durability than unrelated generic export work
- update `51A` if the actual seams differ materially

Implement:
- one first-pass hardening slice for the Track 51 report family
- keep report semantics unchanged
- add stable fingerprint, export, or performance behavior aligned with Track 51
- if the chosen hardening slice touches consolidated drill-across, preserve explicit local-base vs translated/reporting-currency context and support consolidated -> member -> local drill-chain evidence cleanly

Constraints:
- do not rewrite report semantics during hardening
- prefer additive hardening over redesign
- if performance work is partial, make the limitation explicit
- do not change consolidation math merely to improve support-detail labeling, drill clarity, or export evidence
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, hardening slice implemented, and remaining scale/audit gaps
```

---

## Prompt 7B - `RP13` Persisted export snapshots and audit retention

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on the next `RP13` audit-durability slice: persisted export snapshots and reproducible report evidence.

Before changing code:
- verify the live frontend-only fingerprint/export seam already implemented for Track 51
- verify whether the repo already has reusable snapshot/export/audit storage seams before adding a dedicated new table
- verify which Track 51 report surfaces are realistic for the first persisted-snapshot pass
- update `51A` if the actual seams differ materially

Implement:
- one first-pass persisted export snapshot seam for the Track 51 report family
- stable server-side stored fingerprint/checksum or equivalent immutable export evidence
- enough metadata to reproduce what report instance was exported/reviewed
- keep local-base vs translated/reporting-currency context explicit where consolidated support detail is involved

Constraints:
- do not change report semantics or consolidation math
- prefer reusing existing export/evidence/audit storage seams over inventing a second retention subsystem
- keep the first pass narrow and explainable
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, persisted evidence behavior added, and what still remains frontend-only
```

---

## Prompt 7C - `RP13` Wider report-family rollout and performance hardening

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on the remaining `RP13` additive hardening work: wider Track 51 rollout of export/fingerprint behavior and/or one measured performance slice.

Before changing code:
- verify which Track 51 report pages still do not share the current RP13 export/fingerprint pattern
- identify whether the highest-value next pass is:
  - wider rollout across `Mizan` / `Defter-i Kebir` / statements / reconciliation
  - or one measured performance improvement on the heaviest current Track 51 surface
- if choosing performance, identify one concrete hotspot first instead of doing generic cleanup
- update `51A` if the actual seams differ materially

Implement:
- one additive `RP13` follow-up slice
- if choosing wider rollout, preserve each report's existing semantics and evidence context
- if choosing performance, keep the optimization measurable and make any remaining limitations explicit
- if touching consolidated support detail, preserve explicit local-base vs translated/reporting-currency context and the consolidated -> member -> local drill-chain evidence

Constraints:
- do not absorb unresolved `RP12` governance work into this prompt
- do not rewrite report semantics during hardening
- prefer reuse of the existing export/fingerprint helpers over page-by-page bespoke logic
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, which report-family surfaces were hardened, and what scale/performance gaps still remain
```

---

## Prompt 7D - `RP13` Remaining rollout / performance closure

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on the remaining additive `RP13` hardening that still stays open after `Prompt 7C`.

Before changing code:
- verify which `RP13` items were actually closed by `Prompt 7C`
- identify what still remains open from the two intended `RP13` dimensions:
  - wider Track 51 report-family rollout of export/fingerprint behavior
  - one measured performance improvement on a real current hotspot
- if one dimension was already materially covered in `7C`, treat `7D` as the follow-up for the other dimension instead of redoing the same slice
- if both dimensions still remain partial, choose the higher-value remaining slice and record the residual explicitly in `51A`
- update `51A` if the actual seams differ materially

Implement:
- one more additive `RP13` closing slice
- if `7C` focused on wider rollout, use `7D` for one measured performance improvement or the highest-value remaining rollout residue
- if `7C` focused on performance, use `7D` for the highest-value remaining report-family rollout
- preserve existing report semantics, export meaning, and evidence context
- if touching consolidated support detail, preserve explicit local-base vs translated/reporting-currency context and the consolidated -> member -> local drill-chain evidence

Constraints:
- do not absorb unresolved `RP12` governance work into this prompt
- do not rewrite report semantics during hardening
- prefer reuse of the existing export/fingerprint helpers and persisted-snapshot seam over bespoke page-specific hardening
- if performance work is partial, make the measured limitation explicit rather than implying the whole page family is optimized
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize what `7D` closed, what `RP13` still leaves optional, and whether the remaining residue is rollout-only, performance-only, or both
```

---

## Usage Note

Use `51 Prompt B` after the foundational `51 Prompt A` sequence is stable enough that the later prompts can target real implemented seams rather than roadmap-only assumptions.

If implementation reveals a better seam:

- update `51A` first
- update `51` only if a roadmap-level lock or repo-fit statement is actually wrong

Do not start later prompts until the earlier foundational contracts they depend on are stable enough for reuse.
