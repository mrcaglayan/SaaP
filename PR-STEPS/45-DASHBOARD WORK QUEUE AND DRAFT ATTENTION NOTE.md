# 45 - DASHBOARD WORK QUEUE AND DRAFT ATTENTION NOTE

## Status
- Note only
- Placeholder for a future follow-up track

## Purpose
Keep a reminder for a dashboard-level work queue / attention center so users can see operational items that are waiting, blocked, draft, or require follow-up without hunting through modules one by one.

## Keep In Mind
- This is only a reminder note for now, not a scoped implementation plan.
- The future surface should likely cover both personal and role-based workload signals.
- The goal is not only alerts, but actionable queue visibility.
- Candidate queue items may include:
  - draft CARI documents
  - draft fixed assets awaiting activation
  - pending approvals or blocked postings
  - readiness/setup blockers
  - open reconciliation or settlement exceptions
  - period-close blockers
- The design should distinguish:
  - "needs my action"
  - "watchlist / informational"
  - "system/setup blockers"
- Clarify later whether the queue is:
  - tenant-wide
  - role-filtered
  - user-assigned
  - widget-based vs full worklist page

## Likely Questions For Later
- Which modules are first-class queue sources?
- Should dashboard items deep-link directly into filtered lists or specific records?
- How should urgency, aging, ownership, and due dates be shown?
- Should drafts and blockers be unified in one queue or split into separate dashboard cards?
- What should be real-time versus refreshed on interval?

## Non-Goals For This Note
- No steps
- No backend event/notification design yet
- No queue schema or ownership model yet
- No UI layout freeze yet
