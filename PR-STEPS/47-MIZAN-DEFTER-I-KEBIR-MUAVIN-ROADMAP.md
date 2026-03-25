# 47 - MIZAN / DEFTER-I KEBIR / MUAVIN ROADMAP

## Status
- Roadmap note
- Planned follow-up track

## Purpose
Define a practical roadmap for GL summary-to-detail reporting so finance users can move from account balances to journal movement detail and subledger drilldown without leaving the reporting flow.

## Product Direction
- `Mizan Raporu` should be the summary surface.
- Clicking an account row should open ledger detail directly.
- `Defter-i Kebir` and `Muavin` should share the same core ledger engine.
- The difference between them should be report mode and filter defaults, not completely separate logic.

## Core Principle
- One source of truth for account movement detail.
- Many entry points:
  - direct menu entry
  - drillthrough from `Mizan`
  - drillthrough from journals or account-oriented workflows

## V1
Goal: make the feature genuinely usable.

- Build one standalone ledger-detail page.
- Route candidate:
  - `/app/defter-i-kebir`
- Add drillthrough from `Mizan` summary rows into that page with filters prefilled.
- Minimum filters:
  - legal entity
  - book
  - date range or fiscal period range
  - account
- Minimum columns:
  - date
  - journal no
  - document/reference no
  - description
  - debit
  - credit
  - running balance
- Minimum actions:
  - open journal
  - open source document when link exists
- Opening balance behavior:
  - show opening balance before the selected start date
  - then show in-range movements with running balance

## V2
Goal: make it feel like a proper ERP reporting workspace.

- Add `Muavin` mode on the same ledger engine.
- Route candidates:
  - `/app/defter-i-kebir`
  - `/app/muavin`
- Add stronger filters:
  - operating unit
  - subledger reference
  - source module
  - status / include reversed handling
- Add account-range support, not only single-account view.
- Add export support:
  - CSV
  - print-friendly layout
- Add better drillthrough:
  - account row from `Mizan` opens detail
  - journal row opens journal detail
  - source link opens invoice/payment/fixed asset where available
- Add report presets:
  - GL detail
  - subledger-oriented detail
  - posted-only default

## V3
Goal: add finance control and reconciliation value.

- Add reconciliation-oriented views:
  - GL vs CARI control account drilldown
  - GL vs cash register / session drilldown
  - GL vs fixed asset subledger drilldown
- Add exception views:
  - missing subledger ref
  - postings to unexpected OU
  - postings to parent/non-posting accounts
  - unusual reversals
- Add subtotal/grouping options:
  - by month
  - by source module
  - by OU
  - by subledger ref
- Add saved filter variants per report mode.
- Add role-friendly close support:
  - accountant review
  - audit support
  - period-close supporting evidence

## V4
Goal: make the reporting layer scalable and enterprise-grade.

- Add performance hardening for large history volumes:
  - opening balance snapshots
  - incremental balance tables
  - async export jobs for large date ranges
- Add multi-book comparison support:
  - management vs statutory
  - local vs tax if applicable later
- Add consolidated drill-across concepts where relevant:
  - summary balance
  - local ledger detail
  - source transaction lineage
- Add stronger audit trail support:
  - report parameter fingerprint
  - source lineage chain
  - report evidence bundles for close/review packs

## Recommended Delivery Order
1. Implement real `Mizan Raporu` summary page.
2. Implement one shared ledger-detail page with running balance.
3. Wire `Mizan` row click to ledger-detail page.
4. Add `Defter-i Kebir` menu entry to that shared detail page.
5. Add `Muavin` mode as the same page with stronger filters and presets.

## Why This Shape
- It avoids building 3 disconnected reports.
- It keeps summary and detail aligned.
- It matches how accountants usually work:
  - see balance
  - click account
  - inspect movements
  - open source record

## Non-Goals For V1
- no BI/data-warehouse layer
- no advanced anomaly scoring
- no heavy multi-company comparison yet
- no separate engine for every report name

## Open Questions For Later
- Should `Muavin` be a separate route or just a preset of the same detail page?
- Should date filtering be period-based, date-based, or both?
- Should running balance be shown in base currency only or also transaction currency where relevant?
- How should reversed/cancelled journal history appear in report detail?
