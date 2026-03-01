# KULLANIM_KILAVUZU_PRF13_EXECUTION_TRACKER.md

## PR-F13 Execution Tracker Kullanım Kilavuzu (Operator Surumu)

Surum: v2  
Tarih (UTC): 2026-03-02  
Kapsam: `10-EXECUTION TRACKER.md` adimlari `#1`-`#53`  
Hedef kitle: Solo owner / operator / release sorumlusu

Bu kilavuz teknik ve operasyon akislarini birlikte anlatir:
1. PR-F13 kapsaminda ne tamamlandi?
2. Hangi ekran/komut ne zaman calistirilir?
3. Neyi yapmazsan ne risk olusur?
4. Tek kisilik projede (solo mode) bu surec nasil sade kullanilir?

---

## 1) Bu Dokuman Ne Icin Var?

`10-EXECUTION TRACKER.md` cok degerli ama "is kaydi" formatinda.  
Bu dosya ise ayni kapsami "kullanim kilavuzu" formatinda verir:
- hangi adim hangi amaca hizmet eder
- hangi komutlar operasyonel olarak sirayla kullanilir
- cikti nasil yorumlanir
- steady-state nasil dogrulanir

Kisa ozet:
- Tracker = tarihce ve kanit
- Bu kilavuz = uygulama operasyonu

---

## 2) PR-F13 Kapsami Tam Olarak Nedir?

PR-F13, takipte kapanan `#1-#53` adimlarini tek fazda birlestirir:

1. F01 temel feature flag/readiness altyapisi
2. Subaccounts + Bank hardening + 102 alt hesap otomasyonu
3. Setup Wizard V2 + policy pack transaction-safe bootstrap
4. Workflow approvals + close/consolidation gate
5. Tax engine setup/runtime foundation
6. Canonical consolidation mapping
7. Backfill + rollout + release gate + operational smoke
8. GA sign-off otomasyonu ve solo owner closure

---

## 3) Ilgili Dosyalar Ne Ise Yariyor?

| Dosya | Amac | Ne zaman bakilir? |
|---|---|---|
| `10-EXECUTION TRACKER.md` | Tum adimlarin durum/evidence kaydi | "Bu adim yapildi mi?" sorusunda |
| `11-PR-F13-ROLLOUT-RUNBOOK.md` | Rollout sirasi ve rollback kurali | Canliya gecis veya yeni tenant onboarding |
| `12-PR-F13-PILOT-GA-SWITCH-PLAN.md` | Pilot -> GA faz/kanit tablosu | Faz ilerleme ve gate sonuc takibi |
| `13-PR-F13-GA-SIGNOFF-RECORD.md` | Sign-off / audit / final karar kaydi | Onay sureci ve ops komut referansi |

---

## 4) Uygulamada Gercekten Aktif Olanlar (Kodla Dogrulanmis)

### 4.1 UI rotalari

1. Sirket kurulum: `/app/ayarlar/sirket-ayarlari`
2. Workflow kurulum: `/app/ayarlar/workflow-kurulumu`
3. Banka tanim/provision: `/app/banka-tanimla`
4. Konsolidasyon raporlari: `/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari`

### 4.2 API rotalari

1. Onboarding: `/api/v1/onboarding/*`
2. Workflow: `/api/v1/workflows/*`
3. Tax: `/api/v1/tax/regimes|codes|rules|account-mappings|preview`
4. Bank accounts: `/api/v1/bank/accounts/*`
5. Consolidation: `/api/v1/consolidation/*`

### 4.3 Operasyon komutlari

1. `rollout:prf13-pilot`
2. `backfill:workflow-defaults`
3. `backfill:tax-regimes`
4. `backfill:tax-account-mappings`
5. `backfill:canonical-mappings`
6. `ops:prf13-signoff-status`
7. `ops:prf13-signoff-generate-outbox`
8. `ops:prf13-signoff-log-event`
9. `test:followup:prf13-release-gate`
10. `test:followup:prf13-operational-smoke`

Not:
- Bu PR-F13 kapsaminda tax setup API-first ilerliyor.
- Ayrica bir `TaxSetupPage` route'u bu kapsamda zorunlu degil.

---

## 5) Tracker Gruplari ve Islevsel Karsiligi

| Tracker | Konu | Operator acisindan anlami |
|---|---|---|
| `#1-#3` | Feature flags + readiness | Tenant bazli ac/kapa + "hazir mi?" kontrolu |
| `#4-#14` | Bank/Subaccount hardening | Bank setup hatalarini productiona cikmadan azaltir |
| `#15-#19` | Setup wizard + policy packs | Company bootstrap standard ve tekrarlanabilir olur |
| `#20-#24` | Workflow approvals | Period close/consolidation icin onay zinciri zorunlu olur |
| `#25-#28` | Tax engine | Tax kural/mapping olmadan postlama riski azalir |
| `#29-#31` | Canonical mapping | Group consolidation mapping standard hale gelir |
| `#32-#35` | Backfill + rollout + gates | Fazli rollout guvenli sekilde uygulanir |
| `#36-#53` | Sign-off ops + solo closure | Go/No-Go audit izi ve operasyonel izlenebilirlik saglanir |

---

## 6) Baslamadan Once Kontrol Listesi

### 6.1 Teknik hazirlik

1. Backend calisiyor olmali.
2. DB baglantisi calismali.
3. Migration durum komutu hata vermemeli.
4. En az bir tenant user mevcut olmali (scriptlerde actor icin).

### 6.2 Operasyon hazirligi

1. Hangi tenant(lar)da rollout yapilacagi net olmali.
2. Hangi fazda (A/B/C) oldugun net olmali.
3. Komut ciktilari kayit altina alinmali (terminal log veya plan dosyasi).

### 6.3 Yetki/rol ozet

Bu PR-F13 akisinda en kritik permission gruplari:
1. `onboarding.company.setup`
2. `org.tree.read`
3. `bank.accounts.read` / `bank.accounts.write`
4. Workflow step bazli runtime izinler (`required_permission_code`)

Yapilmazsa ne olur?
1. UI gorunse bile create/update karar endpointleri 403 donebilir.
2. Workflow approve/reject aksiyonlari step izinine takilir.

---

## 7) Ana Isletim Akisi (Solo Owner Standardi)

## 7.1 Hizli durum kontrolu

```powershell
cd backend
npm run ops:prf13-signoff-status
```

Steady-state beklenen:
1. `finance_decision: APPROVED`
2. `product_decision: APPROVED`
3. `pending_roles: none`
4. `recommended_action: NO_ACTION`

### Bu kontrol ne zaman calistirilir?
1. Release oncesi
2. Release sonrasi smoke
3. Handover oncesi

---

## 8) Yeni Tenant veya Yeni Ortamda Sifirdan PR-F13 Akisi

## 8.1 Migration kontrolu

```powershell
cd backend
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status
```

Ne ise yarar?
- Gerekli PR-F13 migrationlari veritabaninda mevcut mu kontrol eder.

Yapilmazsa ne olur?
- Backfill scriptleri tablo bulamama veya constraint hatasi verebilir.

## 8.2 Backfill sirasi (onerilen)

```powershell
cd backend
npm run backfill:workflow-defaults -- --tenantId <TENANT_ID> --apply
npm run backfill:tax-regimes -- --tenantId <TENANT_ID> --apply
npm run backfill:tax-account-mappings -- --tenantId <TENANT_ID> --apply
npm run backfill:canonical-mappings -- --tenantId <TENANT_ID> --apply
```

Neden bu sira?
1. Workflow defaultlari close/consolidation gate'leri hazırlar.
2. Tax regimes tax code bagimliligini hazirlar.
3. Tax account mappings, regime/code altyapisina dayanir.
4. Canonical mappings group extraction standardini tamamlar.

Yapilmazsa ne olur?
1. Phase readiness dry-run'da blok gorursun.
2. Operational smoke testleri eksik setup nedeniyle fail olur.

## 8.3 Fazli feature rollout

```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID> --phase A --apply
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID> --phase B --apply
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID> --phase C --apply
```

Fazlar:
1. A: setup wizard + subaccounts + canonical mapping
2. B: A + workflow close/consolidation
3. C: B + tax engine

Neden fazli?
- Bir kerede her seyi acmak yerine, bagimliliklari kontrollu acarsin.

## 8.4 Gate ve smoke

```powershell
cd backend
npm run test:followup:prf13-release-gate
npm run test:followup:prf13-operational-smoke -- --tenantIds <TENANT_ID_1,TENANT_ID_2>
$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate
```

Ne ise yarar?
1. Regression kapsami PASS mi?
2. Runtime akislar (workflow gate + consolidation + tax) calisiyor mu?

Yapilmazsa ne olur?
- "Flag acildi ama runtime'da patliyor" riski artar.

---

## 9) PR-F13 Komut Referansi (Parametreli)

## 9.1 `rollout:prf13-pilot`

Temel:
```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds 1,2 --phase A
```

Sik parametreler:
1. `--tenantIds <id1,id2>` zorunlu
2. `--tenantId <id>` tekrarli eklenebilir
3. `--phase A|B|C`
4. `--effectiveOn YYYY-MM-DD`
5. `--updatedByUserId <id>`
6. `--apply`
7. `--force`
8. `--limit <N>`

Dry-run ve apply farki:
1. Dry-run: plan basar, yazmaz
2. Apply: `tenant_features` kayitlarini yazar

## 9.2 `backfill:workflow-defaults`

Ornek:
```powershell
cd backend
npm run backfill:workflow-defaults -- --tenantId 1 --effectiveFrom 2026-03-01 --apply
```

Parametreler:
1. `--tenantId`
2. `--groupCompanyId`
3. `--createdByUserId`
4. `--effectiveFrom`
5. `--limit`
6. `--apply`

## 9.3 `backfill:tax-regimes`

Ornek:
```powershell
cd backend
npm run backfill:tax-regimes -- --tenantId 1 --effectiveFrom 2026-03-01 --apply
```

Parametreler:
1. `--tenantId`
2. `--countryId`
3. `--countryIso2`
4. `--createdByUserId`
5. `--effectiveFrom`
6. `--limit`
7. `--apply`

## 9.4 `backfill:tax-account-mappings`

Ornek:
```powershell
cd backend
npm run backfill:tax-account-mappings -- --tenantId 1 --effectiveOn 2026-03-01 --apply
```

Parametreler:
1. `--tenantId`
2. `--legalEntityId`
3. `--regimeId`
4. `--effectiveOn`
5. `--limit`
6. `--apply`

## 9.5 `backfill:canonical-mappings`

Ornek:
```powershell
cd backend
npm run backfill:canonical-mappings -- --tenantId 1 --groupId 1 --apply
```

Parametreler:
1. `--tenantId`
2. `--groupId`
3. `--limit`
4. `--apply`

---

## 10) Sign-Off Operasyon Akisi (Detayli)

Bu bolum `13-PR-F13-GA-SIGNOFF-RECORD.md` ile birlikte calisir.

## 10.1 Durum hesaplama

```powershell
cd backend
npm run ops:prf13-signoff-status
```

Opsiyonel zaman simulasyonu:
```powershell
cd backend
npm run ops:prf13-signoff-status -- --asOf "2026-03-02 06:31:54 UTC"
```

## 10.2 Outbox dosyasi uretme

```powershell
cd backend
npm run ops:prf13-signoff-generate-outbox
```

Dry-run:
```powershell
cd backend
npm run ops:prf13-signoff-generate-outbox -- --dryRun
```

Opsiyonel:
1. `--asOf "<UTC timestamp>"`
2. `--outDir <path>`
3. `--dryRun`

## 10.3 Olay loglama (audit tablolari icin)

Temel:
```powershell
cd backend
npm run ops:prf13-signoff-log-event -- --event initial_prepared --role both --channel outbox://backend/outbox/prf13-signoff
```

Sent event ornegi (proof zorunlu):
```powershell
cd backend
npm run ops:prf13-signoff-log-event -- --event initial_sent --role both --channel email --proof "<delivery-proof>"
```

Parametreler:
1. `--event` (zorunlu)
2. `--role` `finance|product|both`
3. `--channel`
4. `--proof` (`*_sent` icin zorunlu)
5. `--actor` (opsiyonel, default `Engineering`)
6. `--timestamp` (opsiyonel)
7. `--dryRun`

---

## 11) `recommended_action` Degerleri Nasil Okunur?

| Aksiyon | Anlam | Operator ne yapar? |
|---|---|---|
| `NO_ACTION` | Bekleyen onay yok | Islem gerekmez |
| `WAIT` | Pencere gelmemis veya zaten gonderilmis | Bekle, tekrar status bak |
| `SEND_INITIAL_REQUESTS` | Ilk istek zamani geldi, gonderim kaydi yok | Outbox uret + gonder + `initial_sent` logla |
| `CONFIRM_INITIAL_SEND` | Ilk istek hazir ama sent log yok | `initial_sent` olayini proof ile logla |
| `SEND_REMINDER_1` | 1. hatirlatma penceresi acik | Outbox uret + gonder + `reminder1_sent` logla |
| `CONFIRM_REMINDER_1_SEND` | Reminder1 hazir ama sent log yok | `reminder1_sent` logla |
| `SEND_REMINDER_2_ESCALATE` | 2. hatirlatma/escalation penceresi acik | Outbox uret + gonder + uygun sent log |
| `CONFIRM_REMINDER_2_ESCALATION_SEND` | Reminder2/escalation hazir ama sent log yok | `reminder2_sent` veya `escalation_sent` logla |
| `OVERDUE_ESCALATE` | Son tarih gecmis ve hala pending | Escalation uygula + sent logla |
| `CONFIRM_ESCALATION_SEND` | Escalation hazir ama sent log yok | `escalation_sent` logla |

Not:
- Script, `*_prepared` baglamindan `--role` ve `--channel` degerini `recommended_command` icinde otomatik onerir.

---

## 12) Solo Owner vs Team Mode

## 12.1 Team mode (klasik)

1. Finance approver ayri kisi
2. Product approver ayri kisi
3. Dispatch-reminder-escalation kaniti ayrica takip edilir

## 12.2 Solo mode (bu repo durumu)

1. Dis onay bagimliligi yok
2. Finance/Product onayi owner tarafindan self-approval
3. Final karar `GO` olarak kayda gecilir
4. Status beklenen: `pending_roles: none`, `NO_ACTION`

Neden yine sign-off otomasyonu var?
- Denetlenebilirlik icin: karar, zaman, olay izi kayitli kalir.

---

## 13) Outbox Dosyalari Ne Icin Vardi?

`backend/outbox/prf13-signoff/*.txt` dosyalari:
1. Gercek uygulama runtime bagimliligi degil
2. Operasyonel mesaj artefakti
3. Reminder/escalation metinlerinin versiyonlu kaniti

Silinir mi?
1. Audit ihtiyaci yoksa temizlenebilir
2. Audit gerekiyorsa arsivlenmesi daha dogru

---

## 14) Ekran Bazli Kisa Kullanim (PR-F13 Ilgili)

## 14.1 `/app/ayarlar/sirket-ayarlari`

Ne zaman kullanilir?
- Yeni legal entity/company bootstrap yaparken.

Neden kritik?
- Setup Wizard V2 ve policy-pack bootstrap burada.

Yapilmazsa:
- Sonraki workflow/tax/canonical readiness eksik kalir.

## 14.2 `/app/ayarlar/workflow-kurulumu`

Ne zaman kullanilir?
- Approval zinciri tanimi/atamasi guncellenirken.

Neden kritik?
- Period close ve consolidation gate buraya bagli.

Yapilmazsa:
- Close/finalize endpointleri approval nedeniyle bloklanabilir.

## 14.3 `/app/banka-tanimla`

Ne zaman kullanilir?
- Bank account master ve 102 child account provisioning yaparken.

Neden kritik?
- OU/legal entity/durum/GL policy kontrolleri burada devreye girer.

Yapilmazsa:
- Bank posting ve reconciliation baglantilarinda setup hatalari artar.

## 14.4 `/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari`

Ne zaman kullanilir?
- Yillik consolidation rapor cikisi ve son kontrol.

Neden kritik?
- Canonical mapping + workflow gate sonucunu isletimsel olarak dogrular.

Yapilmazsa:
- GA kararindan once "rapor kalitesi" dogrulamasi eksik kalir.

---

## 15) Sik Karsilasilan Durumlar ve Cozum

## 15.1 `recommended_action: CONFIRM_INITIAL_SEND` ama dosya uretilmiyor

Sebep:
- Sistem zaten initial mesajin hazir oldugunu goruyor, duplicate outbox uretmiyor.

Cozum:
1. Gercek gonderim yaptiysan `initial_sent` olayini `--proof` ile logla.
2. Sonra status tekrar calistir.

## 15.2 `Missing --proof for *_sent events`

Sebep:
- `*_sent` eventlerinde kanit zorunlu.

Cozum:
1. `--proof "<message-id veya link>"` ekleyip tekrar calistir.

## 15.3 Rollout apply `BLOCKED_READINESS`

Sebep:
- Faz gereklilikleri (workflow/tax/canonical) eksik.

Cozum:
1. Eksik backfill/setup adimini tamamla.
2. Tekrar dry-run yap.
3. Gerekirse kontrollu `--force` kullan.

## 15.4 Backfill dry-run PASS ama apply sonucu beklenenden az

Sebep:
- Kismi scope (tenant/country/legalEntity/regime/group filter) veya eksik actor user.

Cozum:
1. Script parametrelerini genislet.
2. Tenant user varligini dogrula.
3. Limit filtresini kontrol et.

## 15.5 `NO_ACTION` gorunuyor ama outbox klasorunde reminder dosyasi var

Sebep:
- Dosya varligi gecmiste hazirlanan artefakti gosterir; guncel aksiyon hesaplamasi status scriptinden gelir.

Cozum:
1. Karari her zaman `ops:prf13-signoff-status` ciktisina gore ver.

---

## 16) Operasyon Rutin Onerisi

## 16.1 Release adayi rutini

1. `test:followup:prf13-release-gate`
2. `RELEASE_GATE_ONLY_STAGES=FOLLOWUP_PRF13` ile release gate
3. `ops:prf13-signoff-status`
4. Plan/record dokumanlarinda evidence satiri guncelle

## 16.2 Yeni tenant rutini

1. Migration status
2. Backfill sirasi
3. Phase A -> B -> C rollout
4. Operational smoke
5. Evidence kaydi

## 16.3 Handover rutini

1. Tracker `Current Next Action` kontrol
2. GA switch plan karar bolumu kontrol
3. Sign-off record karar/timestamp kontrol
4. Status komutu ile steady-state kaniti

---

## 17) Evidence Yazma Standarti (Pratik)

Her operasyon satirinda su 5 bilgi olursa sonraki kisi zorlanmaz:
1. Komut
2. UTC zaman
3. Sonuc (`PASS`, `APPLIED`, `WAIT`, vb.)
4. Etkilenen tenant(lar)
5. Referans dosya/satir

Ornek:
```text
2026-03-02 07:10:00 UTC | tenant=2 | command=rollout:prf13-pilot phase C --apply | result=APPLIED | evidence=12-PR-F13-PILOT-GA-SWITCH-PLAN.md
```

---

## 18) Bu Kilavuzun Kapsami Disindaki Moduller

PR-F13 kapanmis olsa da asagidaki alanlar ayri feature track ister:
1. Stok modulu
2. Demirbas/fixed assets modulu
3. Genel raporlar bolumundeki placeholder ekranlar

Neden ayri?
- Bu moduller PR-F13 tracker adimlari icinde "done scope" olarak tanimlanmadi.

---

## 19) Hizli Devralma Checklisti (Final)

1. `10-EXECUTION TRACKER.md` tum satirlar `DONE` mi?
2. `12-PR-F13-PILOT-GA-SWITCH-PLAN.md` karar `GO` mu?
3. `13-PR-F13-GA-SIGNOFF-RECORD.md` finance/product `APPROVED` mi?
4. `cd backend && npm run ops:prf13-signoff-status` sonucu:
   - `pending_roles: none`
   - `recommended_action: NO_ACTION`
5. Son release adayi icin PR-F13 gate testleri PASS mi?

Tum cevaplar "evet" ise PR-F13 execution tracker kapsaminda operasyon kapanmistir ve dokumantasyon devralmaya hazirdir.

