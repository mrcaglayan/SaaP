# AGENTS.md

## Repo translation policy
- For translation tasks, preserve code behavior, business logic, keys, placeholders, identifiers, route paths, permission codes, API fields, account codes, and status codes.
- In locale files such as `frontend/src/i18n/messages.js`, translate values only; never rename keys.
- Prefer concise enterprise UI wording.
- Keep ERP/accounting terminology consistent across nearby files.
- Do not rename technical identifiers during localization work.
- In sidebar or route config files, translate only visible labels; never change route or permission structure.
- For ambiguous finance terms like `cari`, `fiş`, `mahsup`, and `mutabakat`, prefer existing repo terminology over generic translation.
- Do not refactor mixed code while translating.

## Documentation policy
- Add JSDoc to exported non-trivial functions, hooks, route handlers, validators, and service methods you create or materially modify.
- Add inline comments for non-obvious business rules, accounting logic, readiness gates, reversal paths, rollout guards, and compatibility branches.
- Do not add comments for obvious code.

## Analysis classification policy
- When reviewing plans, prompts, trackers, or roadmap docs, classify findings explicitly.
- Use `Conflict / plan gap` only when the roadmap, prompt set, or tracker likely needs a change now.
- Use `Deferred item already covered` for work that is unfinished in the current step but is already expected in later planned steps.
- Use `Optional hardening` for useful improvements that are not blockers and do not mean the plan is wrong.
- Do not describe intentionally deferred roadmap items as generic "gaps" without clarifying whether they already belong to a later step.
