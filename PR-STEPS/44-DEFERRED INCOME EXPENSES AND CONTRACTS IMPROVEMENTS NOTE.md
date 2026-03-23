# 44 - DEFERRED INCOME EXPENSES AND CONTRACTS IMPROVEMENTS NOTE

## Status
- Note only
- Placeholder for a future follow-up track

## Purpose
Keep a reminder for improvements around deferred income, deferred expenses, and contract-linked periodization behavior (`gelecek aylara ait gelirler/giderler`, prepaid/deferred balances, and related contract improvements).

## Keep In Mind
- This is only a reminder note for now, not a step plan.
- The future work should review the current contract, revrec, prepaid, and deferred setup together instead of treating them as isolated screens.
- The track likely needs to revisit:
  - contract-driven schedule generation
  - deferred/prepaid setup UX
  - long/short split and reclass behavior
  - better reporting and drillback
  - easier setup validation for purpose mappings and account mappings
- Improvements should keep accounting-first behavior intact while reducing setup friction and ambiguity.

## Likely Questions For Later
- What should be owned by contracts vs revrec/deferred setup vs manual journal support?
- How should long-term vs short-term balances surface in UI and reports?
- Which flows should auto-generate schedules and which should stay manual?
- Where are the current biggest UX or contract gaps in deferred/prepaid handling?

## Non-Goals For This Note
- No steps
- No backend scope yet
- No migration or API design yet
- No release plan yet
