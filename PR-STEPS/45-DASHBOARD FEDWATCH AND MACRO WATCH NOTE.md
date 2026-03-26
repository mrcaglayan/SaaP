# 45 - DASHBOARD FEDWATCH AND MACRO WATCH NOTE

## Status
- Note only
- Placeholder for a future follow-up track

## Purpose
Keep a reminder for dashboard-level macro watch surfaces, including a possible FedWatch-style panel/card and related market or policy watch signals that may help finance users monitor the external context from the main dashboard.

## Keep In Mind
- This is only a reminder note for now, not a scoped implementation plan.
- Clarify later whether the feature is:
  - informational only
  - alerting-oriented
  - tenant-configurable
  - role-based by finance/admin users
- Clarify data-source policy before implementation:
  - external API/source choice
  - refresh cadence
  - caching and failure behavior
  - what happens when data is stale or unavailable
- Decide whether the dashboard should show:
  - rate expectations only
  - calendar/events only
  - compact macro summary widgets
  - links to deeper analysis/report pages

## Likely Questions For Later
- Is this US-only FedWatch, or should it evolve into a broader central-bank/macro watch module?
- Should it be a dashboard widget, a standalone page, or both?
- Should users be able to hide/reorder it?
- How much historical context should be shown?

## Non-Goals For This Note
- No steps
- No backend/API design yet
- No UI spec yet
- No source/vendor commitment yet
