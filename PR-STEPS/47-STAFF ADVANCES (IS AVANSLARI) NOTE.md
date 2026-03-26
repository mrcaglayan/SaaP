# 47 - STAFF ADVANCES (IS AVANSLARI) NOTE

## Status
- Note only
- Placeholder for a future follow-up track

## Purpose
Keep a reminder for a proper employee/staff advances flow (`is avanslari`) so the product can support issuing, tracking, settling, reconciling, and reporting staff advances cleanly across cash, bank, expense, payroll, and current-account contexts.

## Keep In Mind
- This is only a reminder note for now, not a detailed plan.
- The future scope likely needs clear separation between:
  - travel or operational advances
  - payroll-related advances
  - purchase/procurement-related advances
  - advances given in cash vs bank
- The final design should clarify:
  - who owns the balance
  - whether the employee becomes a counterparty/subledger party
  - how settlement against expenses works
  - how unspent returns are recorded
  - approval and audit expectations

## Likely Questions For Later
- Should staff advances live under cash, HR/payroll, expenses, or a dedicated module surface?
- Should settlement happen against expense claims, payroll deductions, or both?
- How should partial return / partial expense settlement work?
- What are the reporting and aging requirements?

## Non-Goals For This Note
- No steps
- No accounting design freeze yet
- No route/API definition yet
- No UI workflow definition yet
