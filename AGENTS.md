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