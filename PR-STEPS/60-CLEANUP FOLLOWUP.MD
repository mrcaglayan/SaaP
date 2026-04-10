Tabii. Güncel repo’ya göre **redesign öncesi son mini cleanup PR tracker**’ını aşağıda çıkarıyorum.

Bu tracker’ın amacı:

* core legacy retirement’tan sonra kalan **stale legacy semantics** kalıntılarını temizlemek
* ama yeni redesign track’e girmeden önce
* **çalışan sistemi bozmayacak** kadar dar kapsamlı kalmak

---

# Final Pre-Redesign Cleanup Tracker

## Status

* Planned
* Repo-checked against updated post-cleanup snapshot
* Scope is **stale security-UX legacy semantics cleanup**
* This is **not** the redesign track yet

## Goal

Fresh-only security model backend’de temizlenmişken, frontend security admin yüzeylerinde kalan eski “legacy migration / cleanup / compatibility” dilini, filtrelerini, badge’lerini ve ölü dalları temizlemek.

Bu PR’dan sonra sistem:

* backend olarak fresh-only
* frontend dili olarak da fresh-only
  olmalı.

## Out of scope

Bu PR’da şunları yapma:

* sidebar IA redesign
* route regrouping
* new workbench/page redesign
* workflow governance redesign
* diagnostics redesign beyond stale legacy removal
* unrelated domain cleanup

---

# PR-FINAL-CLEANUP-01 — User assignments / workbench stale legacy cleanup

## Goal

User assignment ekranlarında kalan legacy-role mix mantığını ve migration-cleanup dilini kaldırmak.

## Files

* `frontend/src/pages/security/UserAssignmentsPage.jsx`
* `frontend/src/pages/security/UserAssignmentWorkbench.jsx`
* `frontend/src/pages/security/userAssignmentAuthorityPreview.js`

## Changes

### 1) `UserAssignmentsPage.jsx`

Kaldır:

* `hasLegacyRole`
* `hasComposableRole`
* `roleMixLabel`
* `hasLegacyAssignments`
* `LEGACY_PRESENT` filtre mantığı
* “Legacy present / Composable only” rozet mantığı
* “legacy role mix” referanslı helper/summary metinleri
* yeni atama formundaki şu metin:

  * “Legacy runtime roles are hidden here for new assignments...”

Sadeleştir:

* bundle row modelini fresh-only yap
* `getRoleCatalogEntry(role).legacy` tabanlı grouping/filtering’i kaldır
* `assignableRoleGroups` yalnızca mevcut assignable runtime/composable roller üzerinden beslensin

Dikkat:

* bu sayfa halen çalışmalı
* role seçim dropdown’ı boşalmamalı
* bundle/sourceType/preset/custom mantığı korunmalı

### 2) `UserAssignmentWorkbench.jsx`

Kaldır:

* role mix filter dropdown:

  * `Legacy or composable`
  * `Composable only`
  * `Legacy present`
* kullanıcı kartlarındaki:

  * `Legacy present`
  * `Composable only`
    badge’leri
* selected user detail içindeki amber legacy warning box
* compatibility cleanup / legacy cleanup / compatibility surgery copy’leri

Metin sadeleştirme:

* “raw role & package tools” box’ı kalabilir
* ama “compatibility cleanup” ve benzeri dil çıkarılmalı
* gerekirse metin şu tona çekilmeli:

  * preset-based normal path
  * direct/package/raw tools = advanced exception handling

### 3) `userAssignmentAuthorityPreview.js`

Kaldır / sadeleştir:

* `bundle.hasLegacyRole`
* `Legacy runtime mapping`
* role preview’de `legacy` / `legacyReason` kaynaklı ayrım
* source explanation’ı fresh model diline çek:

  * direct runtime role
  * workflow package
  * preset-derived package
  * business role label

## Acceptance

* User assignments yüzeyinde artık “legacy present”, “legacy runtime role”, “legacy cleanup” dili yok.
* Role mix filter tamamen kalkmış.
* Kullanıcı kartları ve detail panel fresh-only authority modeliyle konuşuyor.
* Yeni role assignment akışı bozulmuyor.

## Search Gate

Çalıştır:

```bash
rg -n "Legacy|legacy|LEGACY_PRESENT|hasLegacyRole|hasLegacyAssignments|roleMixLabel" \
frontend/src/pages/security/UserAssignmentsPage.jsx \
frontend/src/pages/security/UserAssignmentWorkbench.jsx \
frontend/src/pages/security/userAssignmentAuthorityPreview.js
```

Beklenen sonuç:

* yalnızca gerçekten kalması gereken teknik olmayan nötr metinler kalır
* ideal olarak sıfıra çok yakın olur

---

# PR-FINAL-CLEANUP-02 — Access debugger / diagnostics stale legacy cleanup

## Goal

Access debugger ve diagnostics summary artık migration/debug cleanup aracı gibi değil, fresh-only explainability aracı gibi konuşsun.

## Files

* `frontend/src/pages/security/AccessDebuggerPage.jsx`
* `frontend/src/pages/security/accessDiagnosticsSummary.js`

## Changes

### 1) `AccessDebuggerPage.jsx`

Kaldır:

* `Legacy mappings` mini stat
* `Legacy mapping used` paneli
* legacy mapping count / legacy mapping card rendering
* “brownfield runtime-role mappings” copy
* “compatibility-derived authority” copy
* `item.legacyReason` gösterimi

Sadeleştir:

* matching workflow packages paneli yalnızca aktif package sources üstünden anlatsın
* “Mapped from” kalacaksa bunu fresh source açıklamasına çevir:

  * direct package assignment
  * preset-derived package
  * runtime role source
* sayfa artık:

  * matching scopes
  * business role labels
  * workflow packages
  * blockers
  * notes
    üzerine odaklansın

### 2) `accessDiagnosticsSummary.js`

Kaldır:

* `usesLegacyMapping`
* `buildLegacyRuntimeMappings`
* `legacyMappings`
* `legacyReason`
* `Legacy runtime mapping` source label
* legacy cleanup note text

Sadeleştir:

* workflow package derivation tek bir fresh modelde toplansın
* summary shape’ından `legacyMappings` alanı çıkarılsın
* noteTexts içinde migration cleanup mesajı çıkarılsın

Dikkat:

* diagnostics summary consumer’ları kırılmamalı
* `AccessDebuggerPage.jsx` summary shape değişikliğine göre birlikte güncellenmeli

## Acceptance

* Access debugger’da legacy mapping kavramı kalmaz.
* Diagnostics summary çıktısı fresh-only explainability modeline döner.
* Scope/package blocker mantığı çalışmaya devam eder.

## Search Gate

```bash
rg -n "legacy|Legacy|usesLegacyMapping|legacyMappings|legacyReason|buildLegacyRuntimeMappings" \
frontend/src/pages/security/AccessDebuggerPage.jsx \
frontend/src/pages/security/accessDiagnosticsSummary.js
```

Beklenen sonuç:

* stale security-legacy explainability referansları kalkmış olur

---

# PR-FINAL-CLEANUP-03 — Access catalog stale legacy metadata cleanup

## Goal

Access catalog ve role catalog artık aktif ürün içinde legacy-aware davranmasın.

## Files

* `frontend/src/pages/security/AccessModelCatalogPage.jsx`
* `frontend/src/pages/security/roleCatalog.js`

## Changes

### 1) `AccessModelCatalogPage.jsx`

Kaldır / sadeleştir:

* `entry.legacy`
* `entry.legacyReason`
* `entry.legacyWarnings`
* `legacy` tone
* “Legacy” label return path
* entry theming’de amber legacy branch’leri
* legacy-specific card styling
* legacy-specific detail rendering

Dikkat:

* sayfa hâlâ role/package/business-role/access-model entry’lerini göstermeye devam etmeli
* sadece görünüm ve grouping mantığı fresh-only olmalı

### 2) `roleCatalog.js`

Kaldır:

* `legacyWarnings`
* `legacyReason`
* `legacy` property
* legacy sorting comments/behavior
* legacy preset alias / legacy runtime role traceability yorumları
* fresh olmayan açıklama metinleri:

  * “instead of reusing legacy broad controller roles”
  * “migration traceability still matters”
    vb.

Korunabilir:

* `GroupApPostExtension` gibi business-future açıklamalar, ama legacy referansı olmadan

Sadeleştir:

* `getRoleCatalogEntry()` dönen nesne shape’i fresh-only hale gelsin
* consumer’lar artık `legacy` alanı beklememeli
* runtime mapping/commentary metinleri güncellensin

## Acceptance

* Access catalog UI’da legacy amber styling kalmaz.
* Role catalog data model’i fresh-only hale gelir.
* Catalog/detail ekranları hâlâ çalışır.
* `GroupApPostExtension` açıklaması legacy kıyasına dayanmadan okunur.

## Search Gate

```bash
rg -n "legacy|Legacy|legacyWarnings|legacyReason|Sorts roles into.*legacy|migration traceability" \
frontend/src/pages/security/AccessModelCatalogPage.jsx \
frontend/src/pages/security/roleCatalog.js
```

Beklenen sonuç:

* canlı ürün davranışını etkileyen legacy metadata kalmaz

---

# PR-FINAL-CLEANUP-04 — Backend alias cleanup

## Goal

Backend’de artık kullanılmayan compatibility alias export’larını temizlemek.

## Files

* `backend/src/services/systemRoles.service.js`

## Changes

Kaldır:

* `buildCompatibilitySystemRoleDefinitions`
* `getCompatibilityBootstrapRoleCodes`
* `ensureCompatibilitySystemRolesForTenant`
* `assignCompatibilityBootstrapRolesToUser`

Çünkü güncel repo taramasında bunların tek referansı kendi export satırları.

Dikkat:

* kaldırmadan önce bir son grep ile gerçekten tüketici kalmadığını doğrula

## Acceptance

* `systemRoles.service.js` yalnızca aktif fresh-only API isimlerini export eder
* hiçbir backend/frontend/script import’u kırılmaz

## Search Gate

```bash
rg -n "buildCompatibilitySystemRoleDefinitions|getCompatibilityBootstrapRoleCodes|ensureCompatibilitySystemRolesForTenant|assignCompatibilityBootstrapRolesToUser" \
backend/src backend/scripts frontend/src
```

Beklenen sonuç:

* yalnızca `systemRoles.service.js` içindeki alias export satırları çıkıyorsa güvenle silinebilir

---

# Recommended order

1. **PR-FINAL-CLEANUP-01** — User assignments / workbench stale legacy cleanup
2. **PR-FINAL-CLEANUP-02** — Access debugger / diagnostics stale legacy cleanup
3. **PR-FINAL-CLEANUP-03** — Access catalog stale legacy metadata cleanup
4. **PR-FINAL-CLEANUP-04** — Backend alias cleanup

Bu sıra daha güvenli çünkü:

* önce UI semantics cleanup olur
* sonra diagnostics shape cleanup gelir
* sonra catalog data shape sadeleşir
* en son backend alias’lar kaldırılır

---

# Important implementation notes

## 1) Bu PR’lar redesign değildir

Bu turda:

* yeni sidebar yapısı kurma
* top-level “Kullanıcı ve Erişim Yönetimi” yapısı kurma
* workbench’leri yeniden parçalama

yapma.

Bu sadece:
**“redesign öncesi zemini tamamen temizleme”** işi.

## 2) `legacy` kelimesi her yerde sıfır olmak zorunda değil

Eğer docs içinde historical note kalırsa problem değil.

Ama canlı ürün kodunda şunlar gitmeli:

* user-facing labels
* filters
* warnings
* stats
* compatibility cleanup messaging
* dead conditional branches

## 3) `GroupApPostExtension` iş mantığını bozma

Bu sayfada legacy referansını kaldırmak doğru, ama business feature’ın kendisini sırf adı yüzünden silme.

---

# Final acceptance

Bu final pre-redesign cleanup tamamlanmış sayılır, eğer:

* User assignments tarafında legacy-role mix kavramı kalmaz
* Access debugger tarafında legacy mapping paneli kalmaz
* Access catalog tarafında legacy styling/metadata kalmaz
* Backend system role servisi yalnızca aktif fresh-only export’lar bırakır
* Ürün dili artık migration cleanup ürünü gibi değil, fresh steady-state security admin ürünü gibi konuşur

