---
name: messages-locale-translate
description: Translate locale resource files such as messages.js, messages.ts, and locale JSON maps between Turkish and English. Use this only for bulk i18n value translation. Preserve keys, placeholders, ICU syntax, object structure, ordering, escaping, comments unless asked, and all non-user-facing code. Do not use this for general UI refactors or non-locale files.
---

# messages-locale-translate

## Purpose

Use this skill only for locale/resource files such as:

- `frontend/src/i18n/messages.js`
- `messages.ts`
- `*.locale.json`
- nested translation maps
- files whose main purpose is storing user-facing text values

This skill is intentionally stricter than a general translation skill.

Its job is to translate **message values only** while protecting i18n structure.

---

## Hard rules

1. **Translate values only**
   - Never rename, rewrite, reorder, or “improve” message keys.
   - Never convert key style.
   - Never collapse or expand nesting.

2. **Preserve placeholders exactly**
   Keep these unchanged:
   - `{name}`
   - `{{name}}`
   - `${name}`
   - `%s`, `%d`
   - `:name`
   - `<0>...</0>`
   - ICU placeholders and selectors
   - plural/select syntax
   - escaped characters needed by the file format

3. **Preserve ICU and pluralization syntax**
   Examples that must remain structurally valid:
   - `{count, plural, one {...} other {...}}`
   - `{gender, select, male {...} female {...} other {...}}`

4. **Preserve structure exactly**
   - Keep object shape unchanged.
   - Keep arrays unchanged unless the task explicitly asks to translate array string values.
   - Keep commas, quotes, and escaping valid.
   - Keep export style unchanged.
   - Keep file syntax valid.

5. **Do not edit non-locale logic**
   - Do not rename imports or exports.
   - Do not refactor helper code in the same file.
   - Do not change surrounding logic even if the file mixes code and messages.

6. **Do not translate technical/internal constants**
   - Do not translate route paths, permission codes, API fields, enum values, account codes, status codes, or internal identifiers that happen to appear in the file unless they are clearly intended as user-facing labels.

7. **Consistency over creativity**
   - Use the same translation for repeated product terms.
   - Prefer existing repo terminology if nearby entries establish a standard.

---

## Default workflow

### Step 1: Confirm this is a locale/resource file
If the file is mainly a UI/source file with scattered strings, do not use this skill.
That case belongs to a broader translation skill.

### Step 2: Translate only user-facing values
Translate text intended for display to users:
- page titles
- button labels
- field labels
- helper text
- validation messages
- empty states
- toasts
- modal copy
- report labels

Do not alter machine-readable content.

### Step 3: Validate placeholders and syntax
Before finishing, verify:
- all keys unchanged
- all placeholders unchanged
- ICU syntax still valid
- file structure unchanged
- no accidental logic edits
- no mixed-language leftovers in the edited scope unless intentionally preserved

### Step 4: Check terminology consistency
For repeated business terms, use one consistent translation in the same file or locale block unless context clearly requires otherwise.

### Step 5: Report briefly
State:
- which file/section was translated
- that keys/placeholders/ICU syntax were preserved
- any ambiguous business terms needing a terminology decision

---

## Repo-specific terminology defaults

Use these defaults unless the file already establishes a different standard.

### Core actions
- `Kaydet` -> `Save`
- `Güncelle` -> `Update`
- `Sil` -> `Delete`
- `Onayla` -> `Approve`
- `Reddet` -> `Reject`
- `Taslak` -> `Draft`
- `Gönder` -> `Submit`
- `Uygula` -> `Apply`
- `İptal` -> `Cancel` or `Void` depending on accounting context
- `Kapat` -> `Close`

### ERP/accounting terms
- `cari` -> use the repo’s established term; otherwise prefer `counterparty` in generic master data context
- `belge` -> `document`
- `fiş` -> `entry`, `voucher`, or `document` based on context
- `hareket` -> `transaction`
- `mahsup` -> `settlement`, `offset`, or `clearing` based on feature meaning
- `mutabakat` -> `reconciliation`
- `dönem` -> `period`
- `kapanış` -> `close` or `period close`
- `avans` -> `advance`
- `tahakkuk` -> `accrual`
- `ertelenmiş gelir` -> `deferred revenue`
- `kur farkı` -> `FX difference`
- `değerleme` -> `revaluation`
- `tahsilat` -> `collection` or `receipt`
- `tediye` -> `payment` or `disbursement`

If a term is ambiguous, prefer consistency with nearby locale entries over a generic dictionary translation.

---

## Turkish -> English style

- Prefer concise product English.
- Avoid literal awkward phrasing.
- Keep labels short.
- Prefer enterprise/accounting wording where relevant.

## English -> Turkish style

- Prefer clear modern software Turkish.
- Keep labels short and operational.
- Avoid over-formal wording.

---

## What this skill must never do

Do not:
- rename keys
- sort keys unless explicitly requested
- refactor the file
- change placeholder syntax
- rewrite ICU message structure
- translate route strings or permission codes
- change account/status/internal codes
- “improve” wording outside the requested translation direction

---

## Completion note format

Use a short completion note like:

- translated locale values in the requested scope
- preserved keys, placeholders, ICU syntax, and structure
- flagged any ambiguous ERP/accounting terminology