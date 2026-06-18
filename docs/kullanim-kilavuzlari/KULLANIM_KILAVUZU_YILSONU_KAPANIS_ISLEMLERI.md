# KULLANIM_KILAVUZU_YILSONU_KAPANIS_ISLEMLERI.md

## Yilsonu Kapanis Islemleri Kullanim Kilavuzu

Surum: v1  
Tarih (UTC): 2026-03-02  
Hedef kitle: Muhasebe, finans, kontrol, operasyon

Bu kilavuz kod degisikligi anlatmaz.  
Bu kilavuz, uygulamadaki yilsonu kapanis akisinin ekran bazli kullanimini anlatir.

---

## 1) Amac

Bu dokumanin amaci:
1. Yilsonu kapanis oncesi hangi kontrollerin yapilacagini netlestirmek.
2. Hangi ekranda hangi sira ile islem yapilacagini gostermek.
3. Kapanis hatasi alindiginda nerede duzeltme yapilacagini belirtmek.

---

## 2) Kapsamdaki Ekranlar

1. Yilsonu REVREC kontrol ekrani  
   - Rota: `/app/donem-sonu-islemler/yillik/kapanis-islemleri`
2. Donem Durumu ve Otomatik Kapanis  
   - Rota: `/app/mahsup-islemleri`
3. Manuel REVREC purpose mapping ayarlari  
   - Rota: `/app/ayarlar/hesap-plani-ayarlari`
4. Revenue Recognition operasyon modulu  
   - Rota: `/app/gelecek-yillar-gelirleri`
5. Kapanis Gorevleri panosu  
   - Rota: `/app/donem-sonu-islemler/yillik/kapanis-gorevleri`
6. Kapanis Gorev Sablonlari  
   - Rota: `/app/donem-sonu-islemler/yillik/kapanis-gorev-sablonlari`

---

## 3) On Kosullar

Yilsonu kapanis denemesinden once su kosullari saglayin:

1. Ilgili legal entity, book ve fiscal period tanimli olmali.
2. REVREC purpose mapping satirlari eksiksiz olmali.
3. Yilsonu P&L kapama icin retained earnings hesabi hazir olmali.
4. Kullanici yetkileri uygun olmali.

Not: API seviyesinde yilsonu kapanista retained earnings hesabi zorunludur.

---

## 4) Onerilen Islem Sirasi

1. `Yilsonu > Kapanis Islemleri` ekraninda REVREC kontrollerini calistir.
2. Eksik/gecersiz mapping varsa `Ayarlar > Hesap Plani Ayarlari` ekraninda duzelt.
3. `Mahsup Islemleri` ekraninda otomatik kapanis calistir.
4. Kapanis calisma kayitlarini tabloda dogrula.
5. Gerekirse yeniden acma (reopen) adimini kontrollu sekilde kullan.

---

## 5) Yilsonu REVREC Kontrol Ekrani Kullanimi

Rota: `/app/donem-sonu-islemler/yillik/kapanis-islemleri`

### 5.1 Ne kontrol eder?

Ekran su kontrol setini calistirir:

1. Aile bazli hazirlik:
   - `DEFREV`
   - `PREPAID_EXPENSE`
   - `ACCRUED_REVENUE`
   - `ACCRUED_EXPENSE`
2. Uzun/kisa aktarim butunlugu:
   - `DEFREV_LONG_LIABILITY` <-> `DEFREV_SHORT_LIABILITY` (480/380 beklentisi)
   - `PREPAID_EXP_LONG_ASSET` <-> `PREPAID_EXP_SHORT_ASSET` (280/180 beklentisi)
   - `ACCR_REV_LONG_ASSET` <-> `ACCR_REV_SHORT_ASSET` (281/181 beklentisi)
   - `ACCR_EXP_LONG_LIABILITY` <-> `ACCR_EXP_SHORT_LIABILITY` (481/381 beklentisi)
3. Engelleyici eksik purpose kod listesi.

### 5.2 Nasil kullanilir?

1. Legal entity secin.
2. `Run checks` butonuna basin.
3. Ozet kartlari kontrol edin:
   - Total checks
   - Passed
   - Warnings
   - Failed
4. `Family readiness baseline` tablosunda eksik amac kodlarini okuyun.
5. `Long/short reclass integrity` sonucunu inceleyin:
   - `PASS`: Tamam
   - `WARN`: Kod prefix beklentisi disinda, inceleme gerekli
   - `FAIL`: Eksik/hatali mapping, kapanis oncesi duzeltme zorunlu

### 5.3 Uyari/Puanlama yorumu

1. `FAIL` varsa yilsonu kapanis oncesi mapping duzeltin.
2. `WARN` varsa muhasebe politikaniza gore hesap secimini dogrulayin.
3. `Blocking missing mappings` listesi bos degilse kapanis risklidir.

---

## 6) REVREC Mapping Duzeltme Akisi

Rota: `/app/ayarlar/hesap-plani-ayarlari`

1. `Advanced: Manual Purpose Mappings` bolumune gidin.
2. Legal entity secin.
3. Modul secimini `REVREC` yapin.
4. Tum zorunlu REVREC purpose kodlari icin postlanabilir hesap secin.
5. Kaydedin (`Save REVREC mappings`).
6. Tekrar yilsonu kontrol ekranina donup `Run checks` calistirin.

Kural:
1. Uzun ve kisa vade icin ayni hesap secmeyin.
2. Hesaplar aktif ve postlanabilir olmali.
3. Hesap secili legal entity chart kapsaminda olmali.

---

## 6A) Kapanis Gorevleri ve Cockpit

Kapanis gorevleri, destek cizelgesi veya mutabakat motorunun yerine gecmez. Gorev panosu; banka mutabakati kontrol edildi, AP acik belgeler temizlendi, denetim kaniti eklendi gibi insan sahipli adimlari takip etmek icindir.

Temel akis:

1. Gorev sahibi `NOT_STARTED` veya `IN_PROGRESS` gorevi calisir.
2. Kanit gerekiyorsa gorev seviyesinde kanit ekler.
3. Gorevi `SUBMITTED` yapar.
4. Inceleyen kisi gorevi `APPROVED` yapar veya neden yazarak `RETURNED` yapar.
5. Istisna gerekiyorsa yetkili kisi zorunlu nedenle `WAIVED` yapar.
6. Yanlis acilmis manuel gorevler `CANCELLED` yapilir; bu bir waiver degildir.

Cockpit tarafinda sadece `required_for_cycle_lock = true` olan kapanis gorevleri kilit bloklayabilir. `APPROVED`, `WAIVED` ve `CANCELLED` gorevler cozulmus kabul edilir. Book bazli gorev aramalarinda `bookId` filtresini kullanin.

---

## 7) Otomatik Kapanis (Period Close) Kullanimi

Rota: `/app/mahsup-islemleri`

`Period Status & Auto Close` panelinde islem yapilir.

### 7.1 Hazirlik

1. Book secin.
2. Period secin.
3. Gerekirse donem durumunu guncelleyin (`Update Status`).

### 7.2 Kapanis calistirma

1. `closeStatus` secin (`SOFT_CLOSED` veya `HARD_CLOSED`).
2. Yilsonu icin retained earnings hesabi secin/girin.
3. Opsiyonel not girin.
4. `Run Auto Close` butonuna basin.

Beklenen sonuc:
1. Sistem period close run olusturur.
2. Tabloda su bilgiler gorunur:
   - Run
   - Status
   - Close
   - Year-End
   - Carry JRN
   - Y/E JRN
   - Lines

### 7.3 Reopen (gerekiyorsa)

1. `Reopen reason` alanini doldurun (zorunlu).
2. `Reopen Last Close Run` butonunu kullanin.
3. Ters kayitlar olustugu bilgisini kontrol edin.

---

## 8) Sik Hata Durumlari ve Cozum

### 8.1 Hata: `retainedEarningsAccountId is required for year-end P&L closing`

Neden:
1. Yilsonu kapanisinda retained earnings hesabi bos birakilmistir.

Cozum:
1. `Mahsup Islemleri` ekraninda retained earnings hesabi secin.
2. Kapanisi tekrar calistirin.

### 8.2 Hata: `missing required purpose mappings`

Neden:
1. REVREC purpose mapping satirlari eksik/gecersizdir.

Cozum:
1. `Ayarlar > Hesap Plani Ayarlari` ekraninda modul `REVREC` secip mapping tamamlayin.
2. Kontrol ekraninda tekrar `Run checks` yapin.

### 8.3 Hata: workflow/onay kaynakli blok

Neden:
1. Kapanis workflow onayi tamamlanmamistir veya red vardir.

Cozum:
1. Workflow/onay adimlarinin durumunu kontrol edin.
2. Gerekli onaylari tamamlayin.

---

## 9) Operasyonel Kontrol Listesi (Kisa)

1. Yilsonu kontrol ekraninda `FAIL = 0`.
2. `Blocking missing mappings` listesi bos.
3. Retained earnings hesabi secili.
4. Auto close run basariyla olustu.
5. Year-end fis numarasi (Y/E JRN) tabloda goruldu.
6. Sonuc raporlari ve mizan kontrol edildi.

---

## 10) Pratik Notlar

1. `WARN` durumu her zaman hata degildir, muhasebe politikanizla uyum kontrolu gerektirir.
2. `HARD_CLOSED` oncesi bir deneme icin `SOFT_CLOSED` tercih edilebilir.
3. Reopen islemi denetim izi olusturur; gerekce metnini net girin.

---

## 11) Hedeflenen Standart Is Akisi

1. REVREC kontrol ->
2. Mapping duzeltme ->
3. Auto close ->
4. Run tablosu dogrulama ->
5. Rapor/mizan son kontrol.

Bu sira, yilsonu kapanis hatalarini erken yakalayip tekrar is yukunu azaltir.
