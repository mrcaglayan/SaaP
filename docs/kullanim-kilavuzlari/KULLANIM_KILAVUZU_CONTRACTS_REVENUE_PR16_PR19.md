# KULLANIM_KILAVUZU_CONTRACTS_REVENUE_PR16_PR19.md

## SAAP Contracts + Periodization + Counterparty Mapping Kilavuzu (PR-16/17/18/19)

Surum: v1  
Tarih: 2026-02-25  
Kapsam:
- `/app/contracts`
- `/app/gelecek-yillar-gelirleri`
- Counterparty ekranlarindaki AR/AP hesap esleme alanlari (`Alici/Satici kart` ekranlari)

Bu kilavuz finans, muhasebe, operasyon ve denetim ekipleri icin yazildi.  
Amac: "Hangi secenek ne icin var, secmezsem ne olur, hata olursa nasil okumaliyim?" sorularina net cevap vermek.

---

## 1. PR-16/17/18/19 neyi cozer?

- PR-16: Sozlesme (contract) omurgasi, durum yonetimi, belge baglama.
- PR-17: Gelecek donem gelir/gider dagitim motoru (DEFREV, PREPAID, ACCRUAL).
- PR-18: Contracts + Revenue ekranlarinin operasyonel UI akisi ve yetkiye gore fetch-gating.
- PR-19: Cari kart bazli AR/AP kontrol hesap esleme ve postingte cozum sirasi.

Kisa is etkisi:
- Sozlesme bazli tahakkuk/erteleme surecleri izlenebilir olur.
- Subledger -> GL baglantisi denetlenebilir olur.
- Yetki yoksa sistem gereksiz fetch yapmaz, kontrolsuz erisim azalir.
- Musteri/tedarikciye ozel kontrol hesaplari ile daha dogru muhasebe dagitimi yapilir.

---

## 2. Yetki matrisi (kim ne yapar?)

Route seviyesinde:
- `contract.read`: Contracts ekranina giris/listeleme
- Revenue route acilisi: `revenue.schedule.read` veya `revenue.run.read` veya `revenue.report.read`

Action seviyesinde:
- Contracts:
  - `contract.upsert`
  - `contract.activate`
  - `contract.suspend`
  - `contract.close`
  - `contract.cancel`
  - `contract.link_document`
- Revenue:
  - `revenue.schedule.generate`
  - `revenue.run.create`
  - `revenue.run.post`
  - `revenue.run.reverse`
- Picker bagimli read izinleri:
  - Counterparty picker: `cari.card.read`
  - Hesap picker: `gl.account.read`
  - Belge picker (contract-scoped): `contract.link_document`

Not:
- Izin yoksa ilgili buton ya pasif olur ya da section gizlenir.
- PR-18 kurali geregi section gizliyse arka planda unauthorized fetch yapilmaz.

---

## 3. PR-16 Contracts Kilavuzu

## 3.1 Contract durumlari ve gecisleri

Durumlar:
- `DRAFT`
- `ACTIVE`
- `SUSPENDED`
- `CLOSED`
- `CANCELLED`

Izinli gecisler:
- `DRAFT -> ACTIVE` (Activate)
- `SUSPENDED -> ACTIVE` (Activate)
- `ACTIVE -> SUSPENDED` (Suspend)
- `ACTIVE -> CLOSED` (Close)
- `SUSPENDED -> CLOSED` (Close)
- `DRAFT -> CANCELLED` (Cancel)

Ne olur?
- Uygun olmayan durumda buton pasif olur.
- API tarafinda da "Cannot <action> contract from status <x>" hatasi ile bloklanir.

Gercek hayat:
- Satis sozlesmesi once `DRAFT` acilir, hukuki onaydan sonra `ACTIVE` yapilir.
- Muvakkat durdurma varsa `SUSPENDED`, tamamen biterse `CLOSED`.

## 3.2 Contract olusturma/guncelleme alanlari

| Alan | Ne icin kullanilir | Secmezsen ne olur |
|---|---|---|
| `legalEntityId` | Sozlesmenin bagli oldugu sirket birimi | Kayit bloklanir (`required`) |
| `counterpartyId` | Musteri/tedarikci baglantisi | Kayit bloklanir (`required`) |
| `contractNo` | Operasyonel tekil sozlesme no | Kayit bloklanir; ayni legal entity icinde duplicate olamaz |
| `contractType` (`CUSTOMER`,`VENDOR`) | Akis tipi (AR/AP yonu) | Kayit bloklanir (`required`) |
| `currencyCode` | Sozlesme para birimi | Kayit bloklanir; sistemde tanimli doviz olmalidir |
| `startDate` | Baslangic tarihi | Kayit bloklanir (`required`) |
| `endDate` | Bitis tarihi | Bos olabilir; doluysa `startDate <= endDate` olmalidir |
| `notes` | Operasyon notu | Bos olabilir |
| `lines[]` | Sozlesme satirlari | Dizi zorunlu; satir icerigi kurala aykiriysa kayit bloklanir |

Satir alanlari:

| Alan | Ne icin kullanilir | Secmezsen ne olur |
|---|---|---|
| `description` | Satir aciklamasi | Kayit bloklanir |
| `lineAmountTxn` / `lineAmountBase` | Tutar | `0` olamaz; eksi tutar (credit/adjustment) kabul edilir |
| `recognitionMethod` (`STRAIGHT_LINE`,`MILESTONE`,`MANUAL`) | Dagitim metodu | Bossa `STRAIGHT_LINE` kabul edilir |
| `recognitionStartDate` / `recognitionEndDate` | Donemleme araligi | `STRAIGHT_LINE`: ikisi de zorunlu; `MILESTONE`: ikisi de zorunlu ve ayni tarih; `MANUAL`: ikisi de bos olmali |
| `deferredAccountId` | Erteleme hesabi | Opsiyonel; girilirse tip/scope/aktif/postable kontrolu yapilir |
| `revenueAccountId` | Gelir/gider hesabi | Opsiyonel; girilirse tip/scope/aktif/postable kontrolu yapilir |
| `status` (`ACTIVE`,`INACTIVE`) | Satir aktifligi | Bossa `ACTIVE` kabul edilir |

Onemli davranis:
- `lineNo` kullanici tarafinda belirleyici degildir; backend 1..N sirali atar.
- `PUT /contracts/{id}` satir setini "tam degistirir" (partial patch degil).
- `DRAFT` disindaki sozlesme guncellenemez.

## 3.3 `contractType` secenegi gercekte neyi degistirir?

`CUSTOMER`:
- Linklenecek cari belge yonu `AR` olmak zorunda.
- `deferredAccountId` beklenen tip: `LIABILITY`
- `revenueAccountId` beklenen tip: `REVENUE`

`VENDOR`:
- Linklenecek cari belge yonu `AP` olmak zorunda.
- `deferredAccountId` beklenen tip: `ASSET`
- `revenueAccountId` beklenen tip: `EXPENSE`

Yanlis secim etkisi:
- Kayit veya link islemi backend tarafinda bloklanir.

## 3.4 Belge baglama (link-document) secenekleri

| Alan | Ne icin kullanilir | Secmezsen ne olur |
|---|---|---|
| `cariDocumentId` | Hangi cari belge baglanacak | Kayit bloklanir |
| `linkType` (`BILLING`,`ADVANCE`,`ADJUSTMENT`) | Baglama amaci | UI default `BILLING`; API'de invalid deger blok |
| `linkedAmountTxn` / `linkedAmountBase` | Baglanan tutar | `>0` zorunlu, bos/0/eksi blok |
| `linkFxRate` (opsiyonel) | Cross-currency baglamada link-level FX snapshot override | Bos birakirsan belge `fx_rate` (yoksa `linkedAmountBase/linkedAmountTxn`, ayni currency ise `1`) kullanilir |

Ek kontroller:
- Contract status sadece `DRAFT` veya `ACTIVE` ise linklenebilir.
- Belge status sadece `POSTED`, `PARTIALLY_SETTLED`, `SETTLED` ise linklenebilir.
- Sozlesme ve belge currency ayni olmak zorunda degildir (cross-currency desteklenir).
- Link satirinda `contractCurrencyCodeSnapshot`, `documentCurrencyCodeSnapshot`, `linkFxRateSnapshot` saklanir.
- Ayni tuple (`contract_id`,`cari_document_id`,`link_type`) tekrar insert edilemez.
- Kumulatif linked tutar belge tutar cap'ini gecemez.

Gercek hayat ornegi:
- Yillik yazilim aboneligi sozlesmesine kesilmis faturayi `BILLING` olarak baglarsiniz.
- Pesin avans senaryosunda ayni belgeyi `ADVANCE` tipiyle ayri izlersiniz.

---

## 4. PR-17 Periodization Kilavuzu (17A/17B/17C/17D)

## 4.1 Account family secenekleri

| Account Family | Is anlami | Tipik hesap ailesi |
|---|---|---|
| `DEFREV` | Gelecek ay/yil gelirleri (ertelenmis gelir) | 380/480 + gelir hesabi |
| `PREPAID_EXPENSE` | Gelecek ay/yil giderleri (pesin odeme) | 180/280 + gider hesabi |
| `ACCRUED_REVENUE` | Gelir tahakkuku | 181/281 + gelir hesabi |
| `ACCRUED_EXPENSE` | Gider tahakkuku | 381/481 + gider hesabi |

## 4.2 Schedule Generate ekrani

| Alan | Ne icin kullanilir | Secmezsen ne olur |
|---|---|---|
| `legalEntityId` | Hangi entity icin schedule | Kayit bloklanir |
| `fiscalPeriodId` | Donem baglami | Kayit bloklanir |
| `accountFamily` | Is akisi ailesi | Kayit bloklanir |
| `maturityBucket` (`SHORT_TERM`,`LONG_TERM`) | Kisa/uzun vade sinifi | Kayit bloklanir |
| `maturityDate` | Vade tarihi | Kayit bloklanir |
| `reclassRequired` | Uzundan kisaya reclass yapilsin mi | UI default `true`; false ise reclass satiri uretilmez |
| `currencyCode` | Islem para birimi | Kayit bloklanir (3 harf) |
| `fxRate` | Kur | Bos olabilir; girilirse `>0` olmali |
| `amountTxn` / `amountBase` | Tutar | Bos olamaz; sayisal olmak zorunda |
| `sourceEventUid` | Kaynak event kimligi | Bossa backend deterministik uid uretir |

Not:
- Teknik olarak amount alanlari 0 kabul edebilir; operasyonel olarak 0 schedule anlamsizdir.

## 4.3 Run Create ekrani

| Alan | Ne icin kullanilir | Secmezsen ne olur |
|---|---|---|
| `legalEntityId`, `fiscalPeriodId`, `accountFamily`, `maturityBucket`, `maturityDate`, `currencyCode`, `totalAmountTxn`, `totalAmountBase` | Run olusturma cekirdegi | Bos/invalid ise kayit bloklanir |
| `scheduleId` | Run'i bir schedule'a baglamak | Bos olursa bagimsiz run acilir |
| `runNo` | Operator run numarasi | Bos olursa backend otomatik `RRUN-*` run no uretir |
| `sourceRunUid` | Kaynak run kimligi | Bos olursa backend deterministik uid uretir |
| `fxRate` | Kur | Bos olabilir; girilirse `>0` olmali |
| `reclassRequired` | Reclass uretilsin mi | Default true; false ise reclass entry olusmaz |

## 4.4 Run/Post/Reverse aksiyonlari

Post:
- Sadece `DRAFT` veya `READY` run post edilebilir.
- `settlementPeriodId` opsiyoneldir.
- Vermezseniz run'in kendi period bilgisi/fallback period kullanilir.

Reverse:
- Sadece `POSTED` run reverse edilebilir.
- `reversalPeriodId` opsiyoneldir.
- `reason` bos ise varsayilan "Manual reversal" kullanilir.

Accrual aksiyonlari:
- `accruals/generate` sadece `ACCRUED_REVENUE` veya `ACCRUED_EXPENSE` kabul eder.
- `accruals/:id/settle` ve `accruals/:id/reverse` run permission setini kullanir.

## 4.5 `maturityBucket` + `reclassRequired` kombinasyonu

- `LONG_TERM + reclassRequired=true`:
  - Reclass satiri da uretilir.
  - DEFREV icin 480->380 gorunurlugu.
  - PREPAID icin 280->180 gorunurlugu.
  - ACCR_REV icin 281->181 gorunurlugu.
  - ACCR_EXP icin 481->381 gorunurlugu.

- `LONG_TERM + reclassRequired=false`:
  - Sadece recognition/accrual entrysi olusur, reclass olusmaz.

- `SHORT_TERM`:
  - Reclass flag true olsa bile fiilen reclass ihtiyaci yoktur.

## 4.6 Setup eksikse ne olur?

Posting onkosulu:
- Ilgili purpose kodlari `journal_purpose_accounts` icinde map edilmis olmali.
- Hesaplar `LEGAL_ENTITY` scope, aktif ve postable olmali.

Eksik setup etkisi:
- Post/settle/reverse adimi "Setup required: configure journal_purpose_accounts ..." hatasi ile durur.

Donem kilidi etkisi:
- Donem `OPEN` degilse post/reverse bloklanir.

Gercek hayat ornekleri:
- DEFREV: 12 aylik lisans gelirini aylik tanima.
- PREPAID: yillik sigorta giderini aylik amortize etme.
- ACCRUED_REVENUE: hizmet verildi ama fatura henuz kesilmedi.
- ACCRUED_EXPENSE: hizmet alindi ama fatura henuz gelmedi.

---

## 5. PR-18 UI davranislari (secmezsen / yetki yoksa)

Contracts sayfasi:
- `contract.read` yoksa sayfa verisi acilmaz.
- Counterparty picker icin `cari.card.read` yoksa:
  - Picker fetch yapilmaz.
  - Operatorden manual ID girmesi beklenir.
- Hesap picker icin `gl.account.read` yoksa:
  - Picker fetch yapilmaz.
  - Manual `deferredAccountId/revenueAccountId` girilebilir.
- Belge picker icin `contract.link_document` yoksa:
  - Picker fetch yapilmaz.
  - Manual `cariDocumentId` girilebilir.

Revenue sayfasi:
- `revenue.schedule.read` yoksa Schedules bolumu gizlenir.
- `revenue.run.read` yoksa Runs bolumu gizlenir.
- `revenue.report.read` yoksa Reports bolumu gizlenir.
- Gizli bolumler icin fetch call yapilmaz (403 noise azalir).

Action butonlari:
- Yetki yoksa disabled/hata mesaji.
- Status uygun degilse Post/Reverse gibi aksiyonlar engellenir.

---

## 6. PR-19 Counterparty AR/AP Mapping Kilavuzu

## 6.1 AR/AP mapping ne icin var?

Amac:
- Genel control hesap yerine, belirli cari kartlar icin ozel control hesap kullanmak.
- Ornek: "Stratejik Musteri A" tum AR hareketleri ozel alt hesapta izlensin.

Alanlar:
- `arAccountId` (customer icin)
- `apAccountId` (vendor icin)

## 6.2 Kurallar

- `arAccountId` ancak `isCustomer=true` iken atanabilir.
- `apAccountId` ancak `isVendor=true` iken atanabilir.
- Hesap:
  - Ayni tenant ve legal entity kapsaminda olmali.
  - CoA scope `LEGAL_ENTITY` olmali.
  - Aktif ve postable olmali.
  - Tip uyumu:
    - AR mapping icin `ASSET`
    - AP mapping icin `LIABILITY`

## 6.3 "Secmezsem ne olur?" (kritik semantik)

Create:
- `arAccountId/apAccountId` vermezseniz `null` kaydedilir.

Update:
- Alan hic gonderilmezse:
  - Mevcut deger korunur.
- Alan acikca `null` gonderilirse:
  - Mevcut mapping temizlenir.

Bu fark operasyonel olarak cok onemlidir:
- "Dokunma" ile "temizle" ayni sey degildir.

## 6.4 Postingte hesap cozum sirasi

Cari document ve settlement postingte:
1. Counterparty mapping varsa ve gecerliyse onu kullanir.
2. Mapping yoksa `journal_purpose_accounts` fallback kullanir.
3. Mapping var ama posting aninda gecersiz hale geldiyse (pasif, postable degil, yanlis tip/scope):
   - Posting acik hata ile bloklanir.

Ek not:
- Counterparty yoksa settlement tarafinda override lookup yapilmaz, purpose-account fallback kullanilir.

Gercek hayat ornekleri:
- Musteri bazli risk takibi:
  - Buyuk musteriler icin ayri AR control hesaplari kullanip bakiye analizi yaparsiniz.
- Tedarikci bazli raporlama:
  - Kritik tedarikcilere ait AP borclarini ayri control hesapta izlersiniz.

---

## 7. Sik hata senaryolari ve cozum

| Hata/Semptom | Anlami | Operasyon aksiyonu |
|---|---|---|
| `Only DRAFT contracts can be updated` | Active/closed contract edit edilmeye calisiliyor | Once lifecycle stratejisini netlestir; gerekli ise yeni contract/revision akisi kullan |
| `Direction mismatch` | Contract type ile belge yonu uyumsuz | CUSTOMER->AR, VENDOR->AP kuraliyla belgeyi kontrol et |
| `Currency mismatch` | Contract ve belge para birimi farkli | Ayni para birimli belge sec veya sozlesme setup'ini duzelt |
| `Setup required: configure journal_purpose_accounts ...` | Posting mapping eksik | Ilgili purpose kodlarina hesap bagla |
| `Period is CLOSED...` | Kapali doneme post/reverse denendi | Uygun acik donem sec veya donem yonetimi ile ilerle |
| `arAccountId requires isCustomer=true` | Rol-map uyumsuz | Cari kart rolunu duzelt veya alanı temizle |
| `...must reference an ACTIVE/postable account` | Mapping hesabinin durumu gecersiz | Hesabi aktif/postable yap veya yeni hesap sec |

---

## 8. Gercek hayat uygulama akislari

## Akis A - SaaS abonelik geliri (DEFREV)
1. Contract `CUSTOMER` olarak acilir.
2. Fatura belgeye donusur ve contract'a `BILLING` ile linklenir.
3. Revenue schedule/run olusturulur (`DEFREV`, genelde `LONG_TERM`, reclass true).
4. Ay sonu run post edilir, raporlarda short/long dagilim izlenir.

## Akis B - Pesin gider (PREPAID_EXPENSE)
1. Vendor contract/odeme baglami acilir.
2. Run `PREPAID_EXPENSE` ile olusturulur.
3. Donemsel amortizasyon post edilir.
4. 280->180 reclass gorunurlugu rapordan takip edilir.

## Akis C - Tahakkuk (ACCRUED_REVENUE / ACCRUED_EXPENSE)
1. Fatura zamanlamasi ile hizmet/teslim zamani farkliysa accrual run olusturulur.
2. `accrual settle` ile olgunlasan kisim kapatilir.
3. Gerekirse `accrual reverse` ile ters cevrilir.

## Akis D - Counterparty ozel control hesap yonetimi
1. Stratejik cari kartta `arAccountId` veya `apAccountId` atanir.
2. Postinglerde once bu mapping kullanilir.
3. Mapping temizlenirse sistem fallback purpose hesabina doner.

---

## 9. Canliya cikis kontrol listesi (PR-16..19)

1. Contracts lifecycle aksiyonlari rol bazinda test edildi.
2. Link-document senaryolarinda direction/currency/status kontrolleri test edildi.
3. Revenue icin required purpose kodlari map edildi.
4. Post/reverse donem acik/kapali testleri yapildi.
5. Revenue report panellerinde split + reconciliation degerleri kontrol edildi.
6. PR-18 fetch-gating davranisi (izin yoksa fetch yok) smoke testten gecti.
7. Counterparty AR/AP mapping:
   - omit ve explicit null semantigi dogrulandi.
   - posting aninda hesap gecerlilik kontrolleri dogrulandi.

Bu kontrol listesi yesil olmadan uretim kullanimi onerilmez.

