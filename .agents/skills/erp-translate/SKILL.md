---
name: erp-translate
description: Translate ERP/accounting user-facing text, i18n values, labels, validation messages, help text, comments, docs, and email templates between Turkish and English for this repo. Preserve keys, placeholders, identifiers, permissions, route paths, API fields, accounting codes, and code behavior. Use this for messages.js, page labels, sidebar text, form text, and finance terminology normalization.
---

# erp-translate

## Purpose

Use this skill for translation and localization tasks in this ERP-style codebase, especially when editing:

- `frontend/src/i18n/messages.js`
- page titles and labels
- sidebar/menu text
- form labels and placeholders
- validation and toast messages
- modal text
- comments and markdown docs
- notification and email templates

This skill is optimized for **Turkish ↔ English** translation in a business/accounting product.

---

## Non-negotiable preservation rules

1. **Do not change behavior**
   - Never change business logic.
   - Never change calculations, posting behavior, workflow rules, permission behavior, API calls, route behavior, or component behavior.

2. **Do not rename technical identifiers**
   - Do not rename:
     - variable names
     - function names
     - component names
     - constants
     - enum members
     - permission codes
     - route paths
     - API field names
     - database column names
     - message keys
     - object property names
     - file names
   - In i18n files, translate **values only**, never keys.

3. **Preserve placeholders exactly**
   Keep these unchanged:
   - `{name}`
   - `{{name}}`
   - `${name}`
   - `%s`, `%d`
   - `:name`
   - `<0>...</0>`
   - ICU/pluralization syntax
   - HTML tags and markdown links

4. **Preserve accounting/system codes**
   - Never translate account codes, journal codes, document status codes, currency codes, tax codes, workflow states, or internal family/type codes unless the task explicitly requests it.

5. **Preserve structure and syntax**
   - Keep JSON / JS / TS / JSX / Markdown valid.
   - Keep escaping valid.
   - Keep indentation and formatting style consistent.
   - Do not convert short labels into long prose unless explicitly requested.

---

## Default operating mode

When invoked, follow this sequence:

### 1. Detect file type
Classify the target as one of:
- i18n resource file
- UI source file
- sidebar/navigation config
- validation/messages file
- docs/markdown
- comments
- mixed file

### 2. Translate only what is user-facing
In code files, translate only strings intended for humans:
- headings
- button labels
- field labels
- empty states
- tooltips
- error messages
- success messages
- helper text
- column labels
- filter labels
- email copy

Do **not** translate internal-only strings unless explicitly asked.

### 3. Keep terminology consistent
Prefer the wording already used nearby in the repo.
If the same concept appears repeatedly, translate it the same way unless context clearly requires a different term.

### 4. Validate before finishing
Check for:
- unchanged keys
- unchanged placeholders
- unchanged identifiers
- valid syntax
- no accidental logic edits
- consistent finance terminology

### 5. Report briefly
At the end, summarize:
- what files/sections were translated
- that keys/placeholders/logic were preserved
- any ambiguous business terms that may need a product decision

---

## File-specific rules

### A) `messages.js` / locale maps / JSON i18n resources
- Translate values only.
- Never rename keys.
- Keep nested structure unchanged.
- Keep interpolation syntax untouched.
- Keep capitalization style sensible for UI.

### B) `sidebarConfig.js` or navigation definitions
- Translate visible menu labels only.
- Never change route paths, permission names, icon keys, or structural config.

### C) React/Vue/UI source files
- Translate visible strings only.
- Do not change prop names, component names, hooks, or imports.
- Preserve JSX expressions exactly.

### D) Validation and toast messages
- Keep messages concise and actionable.
- Preserve placeholders.
- Do not weaken important warnings or approval language.

### E) Comments and docs
- Translate prose clearly.
- Preserve code fences, inline code, lists, headings, and links.
- Do not translate code examples unless asked.

---

## Repo-specific terminology policy

Use these defaults unless surrounding repo language clearly standardizes something else.

### Core UI verbs
- `Kaydet` -> `Save`
- `Güncelle` -> `Update`
- `Sil` -> `Delete`
- `Onayla` -> `Approve`
- `Reddet` -> `Reject`
- `İptal` -> `Cancel` or `Void` depending on accounting context
- `Taslak` -> `Draft`
- `Kapat` -> `Close`
- `Yeniden Aç` -> `Reopen`
- `Gönder` -> `Submit`
- `Uygula` -> `Apply`

### Common ERP/accounting nouns
- `cari` -> prefer the project’s chosen domain term; otherwise use:
  - `counterparty` for generic master/account context
  - `customer/vendor` if the screen is role-specific
  - `receivable/payable` only when the accounting meaning is explicit
- `cari kart` -> `counterparty card` or `customer/vendor card` based on module context
- `belge` -> `document`
- `fiş` -> `entry`, `voucher`, or `document` depending on actual context
- `hareket` -> `transaction` or `movement` depending on screen meaning
- `mahsup` -> `offset`, `settlement`, or `clearing` depending on accounting context
- `mutabakat` -> `reconciliation` or `confirmation` depending on workflow meaning
- `dönem` -> `period`
- `kapanış` -> `close` or `period close`
- `açılış` -> `opening`
- `avans` -> `advance`
- `tahakkuk` -> `accrual`
- `ertelenmiş gelir` -> `deferred revenue`
- `gelecek aylara ait giderler` -> `prepaid expenses`
- `gelir tahakkuku` -> `accrued revenue`
- `gider tahakkuku` -> `accrued expense`
- `kur farkı` -> `FX difference` or `foreign exchange difference`
- `değerleme` -> `revaluation` when FX/accounting context applies
- `iş ortaklığı / şube / iştirak` -> translate contextually; do not guess without surrounding module meaning

### Collections / payments
- `tahsilat` -> `collection` or `receipt` depending on UI style
- `tediye` -> `payment` or `disbursement` depending on context
- `ödeme` -> `payment`
- `iade` -> `return` or `refund`
- `mahsup et` -> `apply`, `offset`, or `settle` depending on feature semantics

### Workflow / control language
- `iş akışı` -> `workflow`
- `onay bekliyor` -> `pending approval`
- `onaylandı` -> `approved`
- `reddedildi` -> `rejected`
- `kilitli dönem` -> `locked period`
- `çalışma bağlamı` -> `working context`

---

## Translation style rules

### Turkish -> English
- Prefer concise professional product English.
- Avoid literal awkward wording.
- Keep button labels short.
- Prefer enterprise/accounting wording over casual wording.

### English -> Turkish
- Prefer clear modern Turkish used in business software.
- Keep UI strings short and operational.
- Avoid over-formal or academic translation.

---

## Ambiguity rules

If a term is ambiguous:
1. choose the safest neutral translation
2. prefer consistency with nearby repo terminology
3. do not invent new domain terminology
4. mention the ambiguous term in the completion note

Common ambiguous terms in this repo class:
- cari
- fiş
- mahsup
- mutabakat
- hareket
- dönem
- kapanış
- avans

---

## What this skill must never do

Do not:
- refactor code during translation
- rename keys for style reasons
- translate permission codes or route paths
- translate database/API field names
- change business/accounting semantics
- silently rewrite product copy beyond the requested scope
- standardize unrelated files unless explicitly asked

---

## Expected completion note

When done, respond with a short note like:

- translated the requested user-facing strings
- preserved keys, placeholders, identifiers, and logic
- flagged any ambiguous ERP/accounting terms that may need a product terminology decision