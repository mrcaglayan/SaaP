# Bordro Islemleri Kullanim Rehberi

Bu belge, `Bordro Islemleri` modulunu operasyonel olarak nasil kullanacagini ozetler.
Mevcut rolloutta bordro akisi kullanilabilir durumdadir ve normal operator yolu dogrudan CSV import uzerinden ilerler.

Not:
- Bu fazda canli payroll provider baglanti / preview / apply ekranlari normal operator akisinin parcasi degildir.
- `Provider Code` alani bugun canli entegrasyon secimi degil, kaynak ve audit etiketi gibi dusunulmelidir.

## Moduldeki ekranlar

- `Bordro Runlari` -> `/app/payroll-runs`
- `Bordro Import` -> `/app/payroll-runs/import`
- `Bordro Mappingleri` -> `/app/payroll-mappings`
- `Bordro Liabilities` -> `/app/payroll-liabilities`
- `Bordro Beneficiaries` -> `/app/payroll-beneficiaries`
- `Bordro Kapanis Kontrolleri` -> `/app/payroll-close-controls`

## Modulu kullanmadan once

Su kosullar hazir olmali:

- Kullanici rolunde gerekli bordro izinleri olmali.
- `Bordro Mappingleri` ekraninda payroll component -> GL hesap eslemeleri tamam olmali.
- Calisan odemeleri icin `Bordro Beneficiaries` ekraninda aktif ve tercihen `VERIFIED` banka hesaplari tanimli olmali.
- Odeme batch olusturmak icin uygun `bankAccountId` bilinmeli.
- Donem kapanisinda ilgili payroll period zaten kilitlenmis olmamali.

## Kisa ozet: normal aylik akis

Normal operasyon sirasiyla sunu yaparsin:

1. `Bordro Import` ile CSV'den payroll run olustur.
2. `Bordro Runlari` listesinden ilgili run'i bul.
3. `Bordro Run Detay` ekraninda accrual preview al.
4. Mapping eksigi varsa `Bordro Mappingleri` ekraninda tamamla.
5. Run'i `Mark Reviewed` yap, sonra `Finalize + Post Accrual` ile tahakkugu post et.
6. `Bordro Liabilities` ekraninda liabilities olustur.
7. Gerekli scope icin payment batch olustur.
8. Banka odemesi ve mutabakat kaniti geldikten sonra payment sync uygula.
9. Gerekirse beneficiary snapshot veya manual settlement override ekran bolumlerini kullan.
10. Donem tamamlandiginda `Bordro Kapanis Kontrolleri` ile prepare -> request -> approve -> close akisini tamamla.

## Adim adim kullanim

### 1. Bordro Import

Ekran: `/app/payroll-runs/import`

Ne yaparsin:
- `Legal Entity` secersin.
- `Provider Code` girersin.
- `Payroll Period`, `Pay Date`, `Currency` doldurursun.
- Gerekirse `Source Batch Ref` yazarsin.
- CSV icerigini yuklersin.

Alan mantigi:
- `Target Run ID` bos ise yeni payroll run olusur.
- `Target Run ID` dolu ise mevcut `DRAFT` correction shell icine import yapilir.

Sonuc panelinde kontrol et:
- run no
- status
- employee sayisi
- gross / net toplamlar
- duplicate satir var mi

Ne zaman durmalisin:
- CSV validation hatasi varsa
- duplicate sayisi beklenmedik derecede yuksekse
- yanlis legal entity veya payroll period ile import yapildiysa

### 2. Bordro Runlari

Ekran: `/app/payroll-runs`

Bu ekran izleme ve dogru run'i bulma ekranidir.

Ana filtreler:
- `Provider`
- `Payroll Period`
- `Status`
- arama

Status yorumu:
- `IMPORTED`: import tamam, tahakkuk oncesi kontrol gerekli
- `REVIEWED`: run incelenmis, finalize adimina hazir
- `FINALIZED`: tahakkuk post edilmis
- `DRAFT`: correction shell veya ara durum

Normalde importtan sonra ilgili run'a buradan girersin.

### 3. Bordro Run Detay

Ekran: `/app/payroll-runs/:runId`

Bu ekran en kritik operator ekranlarindan biridir.

Burada yaptiklarin:
- import satir ve audit detayini incelersin
- accrual preview alirsin
- run'i `Mark Reviewed` yaparsin
- `Finalize + Post Accrual` ile tahakkugu post edersin
- gerekiyorsa correction shell olusturur veya reverse edersin

Finalize oncesi mutlaka kontrol et:
- `Debit Total` ve `Credit Total` dengeli mi
- `Missing Mappings` var mi
- tutarlar beklenen bordro toplamiyla uyusuyor mu

Karar kurali:
- mapping eksigi varsa finalize etme
- preview dengesizse finalize etme

Correction / reversal kullanimi:
- `Create OFF_CYCLE Shell`: donem disi ekstra odeme
- `Create RETRO Shell`: gecmis donem duzeltmesi
- `Reverse Run`: yalniz `FINALIZED` run icin, reason gerekir

### 4. Bordro Mappingleri

Ekran: `/app/payroll-mappings`

Bu ekran payroll componentlerini GL hesaplara baglar.

Ne zaman girersin:
- run detail preview'de `Missing Mappings` gordugunde
- yeni provider kodu veya yeni bordro componenti devreye girdiginde

Pratik kural:
- gider komponentleri debit tarafa gider
- payable / yasal yukumluluk komponentleri credit tarafa gider

Provider mantigi:
- `providerCode` dolu mapping sadece o provider icin gecerli
- `providerCode` bos mapping fallback gibi davranir

Oneri:
- tek kaynakli operasyon varsa sade fallback set ile basla
- farkli provider davranislari varsa provider bazli ayir

### 5. Bordro Beneficiaries

Ekran: `/app/payroll-beneficiaries`

Bu ekran calisan banka hesap masteridir.

Ne icin kullanilir:
- calisana ait odeme hesabi tanimlamak
- primary hesap belirlemek
- eski hesaplari `INACTIVE` durumuna cekmek

Operasyon kurali:
- odemede kullanilacak hesaplar `ACTIVE` olmali
- mumkunse `VERIFIED` olmali
- ayni calisan + para birimi icin primary mantigi dogru kurulmus olmali

Ne zaman onceden kontrol edilmelidir:
- payment prep oncesi
- yeni calisan veya yeni banka hesap degisikligi oldugunda

### 6. Bordro Liabilities

Ekran: `/app/payroll-liabilities`
Alternatif run-bazli ekran: `/app/payroll-runs/:runId/liabilities`

Bu ekran liability, payment prep, payment sync ve istisna yonetimi icin merkez ekrandir.

#### 6.1 Build Liabilities

Ne yapar:
- finalized run uzerinden liability satirlari uretir

Ne zaman kullanilir:
- run finalize edildikten sonra

#### 6.2 Scope secimi

- `NET_PAY`: calisan net odemeleri
- `STATUTORY`: vergi, SGK ve benzeri yasal yukumlulukler
- `ALL`: ikisi birden

Secim kurali:
- maas odemesi batch'i icin `NET_PAY`
- resmi kurum odemeleri icin `STATUTORY`
- analiz ve genel gorunum icin `ALL`

#### 6.3 Create Payment Batch

Ne yapar:
- secilen liability scope'undan odeme batch olusturur

Dikkat:
- `bankAccountId` gerekir
- `idempotencyKey` girmen tavsiye edilir
- ayni isi iki kere yanlislikla calistirmaya karsi koruma saglar

#### 6.4 Payment Sync

Ne yapar:
- banka odeme sonuclarina gore liabilities settlement durumunu gunceller

`allowB04OnlySettlement` ne demek:
- acikse sadece odeme durumu ile settlement kabul edebilir
- kapalIysa daha siki kanit beklersin

Oneri:
- normal operasyon ve uretimde kapali tut
- sadece kontrollu istisna halinde ac

#### 6.5 Manual Settlement Overrides

Bu normal yol degil, istisna yoludur.

Ne zaman kullan:
- odemenin gerceklestigi teyitli ama banka kaniti veya otomatik sync gecikiyorsa

Kural:
- maker-checker mantigi vardir
- talep eden ve onaylayan ayni kisi olmamalidir

Risk:
- yanlis kullanimi audit riskidir

#### 6.6 Beneficiary Snapshot

Ne icin kullanilir:
- payment prep aninda kaydedilen immutable beneficiary bilgisini gormek icin

Onemli nokta:
- beneficiary master sonradan degisse de o odeme icin eski snapshot korunur

### 7. Bordro Kapanis Kontrolleri

Ekran: `/app/payroll-close-controls`

Bu ekran payroll period kapanis ekranidir.

Status akisi:
- `DRAFT`
- `READY`
- `REQUESTED`
- `CLOSED`
- `REOPENED`

Normal kapanis sirasi:
1. `Prepare`
2. checklist sonucu `READY`
3. `Request Close`
4. ayri kisi ile `Approve Close`
5. donem `CLOSED`

Kilit secenekleri:
- `lock_run_changes`
- `lock_manual_settlements`
- `lock_payment_prep`

Pratik kullanim:
- kapanisa yaklasirken run degisiklikleri ve manual settlement once kilitlenir
- odemeler bittiginde payment prep de kilitlenir

Maker-checker:
- close request'i yapan kisi ayni kaydi approve etmemelidir

## Onerilen operasyon sirasi

En guvenli aylik kullanim su sekildedir:

1. Beneficiary kayitlarinin hazir oldugunu kontrol et.
2. Bordro importu yap.
3. Run detail preview ile mapping eksiklerini bul.
4. Mappingleri tamamla.
5. Run'i review edip finalize et.
6. Liabilities olustur.
7. Scope bazli payment batch olustur.
8. Banka odemesi gerceklesince payment sync uygula.
9. Yalniz gerekiyorsa manual override kullan.
10. Donem kapanis kontrolleri ile payroll period'u kapat.

## Sik yapilan hatalar

- Mapping eksigi varken `Finalize + Post Accrual` yapmak istemek
- Beneficiary setup tamamlanmadan `NET_PAY` payment prep denemek
- `NET_PAY` yerine yanlislikla `STATUTORY` scope ile batch cikarmak
- `idempotencyKey` kullanmadan ayni payment prep isini tekrar denemek
- Banka kaniti olmadan manual override'i normal operasyon gibi kullanmak
- Donem kapanisina yakin lock kurallarini gec acmak

## Hangi durumda hangi ekrana gitmelisin?

- CSV yukleyeceksen: `Bordro Import`
- import edilen run'i bulacaksan: `Bordro Runlari`
- tahakkuk preview/finalize yapacaksan: `Bordro Run Detay`
- mapping eksigi varsa: `Bordro Mappingleri`
- banka hesap tanimi eksikse: `Bordro Beneficiaries`
- payment batch veya sync yapacaksan: `Bordro Liabilities`
- donem kapatacaksan: `Bordro Kapanis Kontrolleri`

## Son not

Bu modulde normal yol su an:

`CSV Import -> Run Review -> Finalize + Post Accrual -> Liabilities -> Payment Batch -> Payment Sync -> Close Controls`

Yani bugunku aktif operator yolu provider-ekranli entegrasyon degil, dogrudan bordro CSV operasyonudur.
