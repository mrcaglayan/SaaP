# KULLANIM_KILAVUZU_KASA_MODULU.md

## SAAP Kasa Modulu Kullanım Kilavuzu (Teknik Olmayan Kullanicilar Icin)

Surum: v1  
Tarih: 2026-02-22  
Kapsam: `/app/kasa-tanimlari`, `/app/kasa-oturumlari`, `/app/tediye-islemleri`, `/app/tahsilat-islemleri`, `/app/kasa-islemleri`, `/app/kasa-istisnalari`

Bu kilavuz, kod bilmeyen operasyon, muhasebe, finans ve denetim ekipleri icin yazildi.  
Amac: "Hangi ekranda ne yapmaliyim, secersem/secmesem ne olur, hatada ne yapmaliyim" sorularina net cevap vermek.

---

## 1. Bu modul neyi cozer?

Kasa modulu, nakit islemlerini kontrol altina alir.  
Yani:
- Kasayi kim acmis/kapatmis, ne kadar para girmis/cikmis gorulur.
  (Buradaki "acma/kapama", fiziksel kasanin kilidini acma degil; sistemde oturum baslatma/bitirme kaydidir.)
- Islemler belli adimlardan gecer (olustur, post et, gerekirse ters kayit).
- Yetkisiz veya kurala aykiri hareketler engellenir.
- Istisnalar (zorunlu kapama, yuksek fark, override vb.) tek ekranda izlenir.

Kisa mantik:
- **GL (Defteri Kebir / Genel Ledger)** kayit dogru kaynak olarak kalir.
- **Kasa operasyonu**, GL (Defteri Kebir)'e gitmeden once kontrollu bir is akisindan gecer.

---

## 2. Temel kavramlar (teknik olmayan dille)

- **Kasa Register**: Fiziksel/operasyonel para noktasi. (Ornek: Magaza kasa cekmecesi, sube kasasi, merkez kasa)
- **Oturum (Session)**: Kasa acilis-kapanis periyodu. (Ornek: 08:00 acildi, 18:00 kapandi)
- **Islem (Transaction)**: Tek bir para hareketi. (Tahsilat, odeme, bankaya yatirma vb.)
- **Post etmek**: Islemi resmi muhasebe kaydina cevirme.
- **Iptal (Cancel)**: Henuz post edilmemis islemi gecersiz kilma.
- **Ters kayit (Reverse)**: Post edilmis islemi geri alan yeni ve bagli bir kayit uretme.
- **Varyans (Fark)**: Kasada beklenen para ile sayilan para arasindaki fark.
- **Override**: Normalde engellenen bir post islemini, ozel yetki + zorunlu gerekce ile yapma.
- **Istisna**: Riskli/inceleme gerektiren olay. (Yuksek fark, forced close, unposted islem vb.)

### 2.1 "Kasayi acmak/kapatmak" tam olarak ne demek?

- **Kasayi acmak (oturum acmak)**:
  - Sistem kaydi olarak "bu register su anda su kisi sorumlulugunda kullanima basladi" demektir.
  - Genelde fiziksel teslim/tesellum (kasa devri) sonrasi yapilir.
- **Kasayi kapatmak (oturum kapatmak)**:
  - Sistem kaydi olarak "bu register icin operasyon bitti, sayim yapildi, fark hesaplandi" demektir.
  - Fiziksel kilit kapatma operasyonu sirket prosedurudur; sistem bunun muhasebe/denetim kaydini tutar.

Ozet:
- Bu moduldaki acma/kapama, **fiziksel anahtar hareketinden cok operasyonel sorumluluk kaydi**dir.

---

## 3. Menude nereye girilir?

Sol menu > **Yevmiye Kayitlari**:
- **Kasa Tanimlari**: Register acma/guncelleme
- **Kasa Oturumlari**: Oturum acma/kapama
- **Tahsilat**: Sadece RECEIPT tipi islemler
- **Tediye**: Sadece PAYOUT tipi islemler
- **Kasa Islemleri**: Tum islem tipleri
- **Kasa Istisnalari**: Risk/denetim paneli

Not:
- Tahsilat ve Tediye ekranlari, Kasa Islemleri ekraninin hazir filtreli versiyonudur.

---

## 4. Yetki modeli (kim ne yapabilir?)

Bu yetkiler yoksa butonlar gorunmez veya ekran erisimi engellenir.

Temel yetkiler:
- `cash.register.read`: Kasa tanimlarini gorur
- `cash.register.upsert`: Kasa tanimi olusturur/gunceller, aktif-pasif yapar
- `cash.session.open`: Oturum acar
- `cash.session.close`: Oturum kapatir
- `cash.variance.approve`: Esik ustu varyansi onaylayarak kapatir
- `cash.txn.read`: Islem listelerini gorur
- `cash.txn.create`: Yeni islem olusturur
- `cash.txn.post`: Islem post eder
- `cash.txn.cancel`: Post edilmemis islemi iptal eder
- `cash.txn.reverse`: Post edilmis islemi ters kayit eder
- `cash.override.post`: Override ile post yapar
- `cash.report.read`: Istisna ekranini gorur

Gercek hayat ornek:
- Kasiyer: create + session open/close
- Supervisor: session close + variance approve + istisna izleme
- Finans: post + reverse
- Finans admin: register setup + override

---

## 5. Kasa kontrol modu banner'i (OFF / WARN / ENFORCE)

Ekran ustunde "Kasa kontrol modu" gorursunuz.

- **OFF**:
  - Direkt GL (Defteri Kebir) kasa kontrolu kapali.
  - Risk daha yuksek; pilot/discovery asamasi icin.
- **WARN**:
  - Direkt GL (Defteri Kebir) kaydi durmaz, ama uyari/denetim izi olusur.
  - Gecis donemi icin ideal.
- **ENFORCE**:
  - Kural disi direkt GL (Defteri Kebir) girisi engellenir.
  - Uretim ve denetim icin onerilen mod.
  - Pratikte:
    - `is_cash_controlled=true` hesaplara, normal manuel GL fisinden dogrudan satir yazmak bloke olur.
    - Ayni hareket, kasa modulu akisiyla (`source_type=CASH`) yapiliyorsa izinli olur.
    - Acil istisna durumunda sadece yetkili kullanici `override` + zorunlu gerekce ile ilerleyebilir.
  - Sonuc:
    - Yanlis kanaldan kasa hesabi oynanmasi zorlasir.
    - Denetimde "neden bu hesapta bu hareket var" sorusunun cevabi netlesir.

Secim etkisi:
- ENFORCE secmezseniz operasyon rahatlar ama kontrol riski artar.
- ENFORCE secerseniz disiplin artar, kisa vadede kullanici hata mesaji daha cok gorebilir.

---

## 6. Isletmeye almadan once kontrol listesi

1. Kasa registerlari tanimli mi?
2. Her register uygun GL (Defteri Kebir) hesaba bagli mi?
3. Register para birimi dogru mu?
4. Session mode dogru mu? (`REQUIRED/OPTIONAL/NONE`)
5. Varyans kazanc/kayip hesaplari tanimli mi?
6. Ekipte yetki dagilimi net mi?
7. Kasa kontrol modu beklendigi gibi mi? (WARN ya da ENFORCE)

---

## 7. Kasa Tanimlari ekrani (adim adim)

Ekran: `/app/kasa-tanimlari`

### 7.1 Ne yaparsiniz?
- Yeni kasa tanimi acarsiniz
- Var olani guncellersiniz
- Aktif/Pasif durumunu degistirirsiniz

### 7.2 Alanlar ve secim etkileri

- **code / name**
  - Bos birakilamaz.
  - Gercek hayat: `TILL-01`, `Sube Cekmece-1`

- **registerType** (`VAULT`, `DRAWER`, `TILL`)
  - Operasyon tipi secimidir.
  - Oneri:
    - TILL: POS kasasi
    - DRAWER: sube petty cash
    - VAULT: merkez kasa

- **sessionMode** (`REQUIRED`, `OPTIONAL`, `NONE`)
  - `REQUIRED`: Oturum olmadan islem akisi bloke olabilir (ozellikle create/post)
  - `OPTIONAL`: Oturum var/yok esnek
  - `NONE`: Oturum acma kapali
  - Detayli isletme yorumu:
    - `REQUIRED`: Kisiden kisiye devir ve vardiya disiplini isteyen noktalarda
    - `OPTIONAL`: Bazi gunler vardiya acilip bazi gunler acilmayan ara yapilarda
    - `NONE`: Session takip ihtiyaci olmayan, daha cok merkez kasa/ozel nokta akislari

- **legalEntity / operatingUnit / account**
  - Kasa muhasebe baglamini belirler.
  - Yanlis baglanti olursa kayit reddedilir.

- **currencyCode**
  - 3 harfli olmalidir (USD, TRY vb.)
  - Islem para birimi register para birimiyle ayni olmalidir.

- **allowNegative**
  - `Hayir` (onerilen): Eksi kasaya izin verilmez
  - `Evet`: Eksi bakiye operasyonel olarak mumkun olur ama risk artar
  - Gercek hayat etkisi:
    - "Evet" oldugunda kasa bakiyesi 0 iken de odeme fisleri gecici olarak gecebilir.
    - Bu, "kasada olmayan parayi sistemde cikis gostermek" riskini dogurur.

- **maxTxnAmount**
  - Tek islem ust limitidir
  - Asilinca backend islemi reddeder

- **requiresApprovalOverAmount**
  - Bu deger ustu hareketlerde ek onay disiplini uygulanir
  - `maxTxnAmount`'i gecemez

- **varianceGainAccountId / varianceLossAccountId**
  - Kasa sayim farklarinin hangi hesaplara post edilecegini belirler
  - Eksikse session close sirasinda varyans olursa islem durur

- **status** (`ACTIVE`, `INACTIVE`)
  - INACTIVE register ile operasyon yapilamaz
  - Acik oturum varken pasife alma engellenir

### 7.3 Secersen / secmezsen ne olur?

- SessionMode = `REQUIRED` secerseniz:
  - Avantaj: Denetim izi guclenir
  - Dezavantaj: Oturum unutulursa islem bloke olur
  - Ornek: Magaza kasasi icin dogru secim

- SessionMode = `NONE` secerseniz:
  - Avantaj: Hizli is akis
  - Dezavantaj: Gun sonu kasa-kisi izlenebilirligi zayiflar
  - Ornek: Merkez kasa, shift takibi gerekmeyen yerde tercih edilebilir

- allowNegative = `Evet` secerseniz:
  - Avantaj: Acil odemede operasyon durmaz
  - Dezavantaj: Kasa disiplini ve suistimal riski artar
  - Gercek hayat ornek:
    - Kasa bakiyesi 300 TL iken 1.200 TL acil kargo odemesi cikar.
    - `allowNegative=true` ise islem gecebilir ve kasa -900'e duser.
    - Ayni gun icinde tahsilatla kapatilmazsa, gun sonu sayim/fark ve denetim riski buyur.
  - Yonetim onerisi:
    - `allowNegative=true` sadece istisnai registerlarda kullanin.
    - Bu registerlar icin dusuk `maxTxnAmount` ve istisna paneli takibi zorunlu olsun.

---

## 8. Kasa Oturumlari ekrani

Ekran: `/app/kasa-oturumlari`

### 8.1 Oturum acma

Gerekli alanlar:
- registerId (zorunlu)
- openingAmount (opsiyonel, bos ise 0)

Kurallar:
- Ayni register icin ayni anda tek OPEN oturum olur
- Register `ACTIVE` olmali
- Register `session_mode=NONE` ise oturum acilamaz

Gercek hayat:
- Sabah kasiyer kasayi teslim alip 500 TL acilisla oturum acar.

500 TL nereden gelir?
- Bu tutar normalde **fiziksel devir sayimindan** gelir (eldeki para gercekten sayilir).
- Sistem bu tutari otomatik "uretmez"; kullanici/prosedur girer.
- Bazi firmalarda onceki gunun kapanis tutari referans alinir, ama yine fiziki sayimla teyit edilmesi gerekir.

Acilista kayitli tutar ile fiziksel tutar uyusmazsa ne yapilir?
- Ornek:
  - Onceki kapanis kaydi 5.000 TL gorunuyor, fiziksel sayim 4.800 TL cikti.
- Mevcut backend davranisi:
  - Sistem, acilista "onceki kapanisla birebir eslesme" kontrolu ile oturum acmayi zorunlu kilmaz.
  - Yani 4.800 TL ile oturum acabilirsiniz.
- Onerilen dogru operasyon:
  - Acilisi **fiziksel sayilan gercek tutarla** acin (rakam gizlemeyin).
  - Farki ayni anda supervisor/finans ekibine bildirin.
  - Sirket prosedurune gore devir-fark tutanagi acin.
  - Gerekirse ilk islemde referans/aciklama ile olay numarasini baglayin.
- Neden boyle?
  - Yanlis rakamla (5.000) acmak, sorunu sadece gecici olarak saklar.
  - Gercek tutarla acmak, gun sonu fark analizini ve denetim izini dogru tutar.

Real-world SaaS uygulamalari bu problemi nasil yonetir?
- Cogu sistem acilista iki ayri deger tutar:
  - `expected_opening` (kayitli devir)
  - `counted_opening` (fiziksel sayim)
- Sistem farki otomatik hesaplar:
  - `opening_variance = counted_opening - expected_opening`
- Esik politikalari uygulanir:
  - kucuk fark -> izin + uyari
  - orta fark -> supervisor onayi
  - buyuk fark -> acilisi gecici bloke et / yeniden sayim iste
- Neden kodu ve aciklama zorunlu tutulur.
- Olay denetim izine ve istisna paneline duser.
- Tekrarlayan farklar icin register/kullanici bazli izleme yapilir.

SAAP icin ileride uygulanabilecek cozum adayi (backlog):
- `openMismatchMode`: `OFF` | `WARN` | `ENFORCE`
- `openMismatchTolerance`: otomatik izin esigi
- `openMismatchApprovalThreshold`: onay gerektiren esik
- Session alanlari:
  - `opening_expected_amount`
  - `opening_counted_amount`
  - `opening_variance_amount`
  - `opening_variance_reason`
- Kurgu:
  - `WARN`: acilis izinli + istisna kaydi
  - `ENFORCE`: esik ustu farkta onay olmadan acilis yok

Oturum acmak her yerde zorunlu mu?
- Hayir, register ayarina baglidir:
  - `REQUIRED`: Pratikte zorunlu kabul edilir (acmadan ilerlemek engellenebilir)
  - `OPTIONAL`: Tercihe bagli
  - `NONE`: Oturum acma zaten kapali

### 8.2 Oturum kapama

Gerekli alanlar:
- sessionId (acik oturum)
- countedClosingAmount (zorunlu)

Opsiyonel/kurala bagli alanlar:
- closedReason: `END_SHIFT`, `FORCED_CLOSE`, `COUNT_CORRECTION`
- closeNote: bazi durumlarda zorunlu
- approveVariance: esik ustu fark onayi icin

Kritik kurallar:
- Sadece OPEN session kapanir
- Sessionda post edilmemis islem varsa kapama bloklanir
- `FORCED_CLOSE` secildi ise closeNote zorunlu
- Varyans esigi asildiysa:
  - closeNote zorunlu
  - `approveVariance=true` ve yetki gerekir (`cash.variance.approve`)

### 8.3 Beklenen / Sayilan / Fark

- **Opening**: Oturum acilis tutari
- **Expected**: Beklenen kapanis (genelde kapanista kesinlesir)
- **Counted**: Fiziki sayilan tutar
- **Variance**: Counted - Expected

Not:
- Sistemde `expected_closing_amount` kapanista session satirina guvenilir sekilde yazilir.
- Acik oturumda canli expected her zaman ayrica endpoint ile gelmeyebilir.

### 8.4 Varyans olursa ne olur?

- Sayilan < Beklenen: "short" (eksik)
- Sayilan > Beklenen: "over" (fazla)
- Sistem, uygun hesaplara varyans kaydi uretebilir/post eder

Ornek:
- Beklenen 10.000, sayilan 9.940 -> -60 fark
- Esik 50 ise bu fark esik ustu olabilir -> onay + not istenir

---

## 9. Kasa Islemleri / Tahsilat / Tediye

Ekranlar:
- `/app/tahsilat-islemleri` -> RECEIPT sabit
- `/app/tediye-islemleri` -> PAYOUT sabit
- `/app/kasa-islemleri` -> tum tipler

### 9.1 Islem olusturma (Create)

Temel alanlar:
- registerId
- txnType
- txnDatetime
- bookDate
- amount (>0)
- currencyCode (register ile ayni olmali)

Ek alanlar (duruma gore):
- counterAccountId (banka yonlu tiplerde zorunlu)
- counterCashRegisterId (transfer tiplerinde zorunlu)
- cashSessionId (register politikasi gerektirirse)
- referenceNo, description vb.

Sistem tarafi kritik:
- Her create isteginde idempotency key zorunlu
- Cift tiklama/yeniden denemede ayni islem ikinci kez uretilmez
- `idempotentReplay=true` donerse bu hata degil, "zaten islenmisti" bilgisidir

### 9.2 Islem tipi bazli zorunluluklar

- `TRANSFER_IN` / `TRANSFER_OUT`:
  - `counterCashRegisterId` zorunlu

- `DEPOSIT_TO_BANK` / `WITHDRAWAL_FROM_BANK`:
  - `counterAccountId` zorunlu

- `VARIANCE`:
  - Manuel olusturulamaz (sistem olusturur)

### 9.3 Durum akisi (state machine)

Durumlar:
- `DRAFT`
- `SUBMITTED`
- `APPROVED`
- `POSTED`
- `REVERSED`
- `CANCELLED`

Kurallar:
- Cancel: sadece `DRAFT`/`SUBMITTED`
- Post: `DRAFT`/`SUBMITTED`/`APPROVED`
- Reverse: sadece `POSTED` orijinal kayit
- Reversal satiri tekrar reverse edilemez
- POSTED kayit edit/cancel edilemez (immutability)

### 9.4 Post ederken override

Normalde sistem kurala aykiri postu engeller.  
Override icin:
- `overrideCashControl=true`
- `overrideReason` dolu
- kullanicida `cash.override.post` yetkisi

Secersen/secmesen:
- Override secmezseniz: guvenli ama bazen acil durumda bloke olabilirsiniz
- Override secerseniz: is devam eder ama denetimde sorumluluk artar

Gercek hayat:
- Aylik kapanisa 10 dk kala kritik bir duzeltme lazim.
- Finans admin override reason yazarak post eder.
- Sonra denetimde bu olay "istisna" olarak gorunur.

---

## 10. Kasa Istisnalari ekrani (denetim paneli)

Ekran: `/app/kasa-istisnalari`

Bu ekranda 5 ana bolum vardir:
1. Yuksek farkli oturumlar
2. Forced close oturumlari
3. Override kullanilan islemler
4. Post edilmemis islemler
5. Direkt GL cash-control olaylari (warn/override)

Filtreler:
- Legal entity
- Operating unit
- Register
- Tarih araligi
- Minimum mutlak fark

Ne zaman bakilmali?
- Gun sonu kapanista (operasyon)
- Hafta sonu risk taramasinda (supervisor)
- Ay sonu denetimde (finans/denetim)

---

## 11. "Secim" rehberi (hizli karar tablosu)

### 11.1 Session mode secimi

- `REQUIRED` sec:
  - POS/TILL gibi vardiyali yerde
  - Kisi bazli sorumluluk istiyorsan
  - Ornek:
    - AVM magazasi, sabah kasiyer A aciyor, aksam kasiyer B kapatiyor
    - "kimde kac saat acik kaldi, kapanista fark var mi" net izlenir

- `OPTIONAL` sec:
  - Sube kasasi ama vardiya disiplini kismi ise
  - Ornek:
    - Muhasebe ofisi haftada 2 gun kasa kullaniyor
    - Kullanilan gunlerde oturum aciliyor, diger gunlerde islem yok

- `NONE` sec:
  - Oturum takip ihtiyaci yoksa (nadir)
  - Ornek:
    - Sadece yonetici kontrollu, gun ici kisiler arasi devir olmayan merkez kasa noktasi
  - Dikkat:
    - Denetimde "hangi kullanici hangi vardiyada kapatti" izi session seviyesinde olmaz

### 11.2 Kapanis nedeni secimi

- `END_SHIFT`: normal vardiya kapanisi
- `FORCED_CLOSE`: elektrik kesintisi, sistem arizasi, acil durum
  - closeNote zorunlu
- `COUNT_CORRECTION`: sayim tekrar duzeltmesi

### 11.3 approveVariance secimi

- Isaretlemezsen:
  - Esik ustu farkta kapama reddedilebilir
- Isaretlersen:
  - Yetkin varsa kapama ilerler
  - Denetimde "onayli varyans" izi kalir

### 11.4 allowNegative secimi

- `false` (onerilen):
  - Kasa disiplini yuksek
  - Islem daha erken bloke olabilir
  - Ornek:
    - Kasada 400 TL var, 700 TL odeme girilmek isteniyor -> sistem durdurur

- `true`:
  - Operasyon durmaz
  - Yanlis kullanim riski artar
  - Ornek:
    - Kasada 400 TL var, 700 TL odeme geciyor -> kasa -300 olur
    - Sonradan kapatilacak denirse de, gecikirse uyumsuzluk ve aciklama ihtiyaci artar

---

## 12. Gercek hayat senaryolari

### Senaryo A - Magaza gunluk akisi (ideal)

1. Kasiyer sabah oturum acar (opening 1.000)
2. Gun boyu tahsilat/tediye girer
3. Supervisor gun sonu sayim alir
4. Sayilan ve beklenen uyusur
5. Oturum `END_SHIFT` ile kapanir
6. Istisna ekraninda sorun gorulmez

### Senaryo B - Varyansli kapanis

1. Beklenen 20.000, sayilan 19.930
2. Esik 50 ise fark 70 -> esik ustu
3. closeNote yazilir
4. approveVariance + yetkili kullanici ile kapanir
5. Sistem varyans kaydini olusturur ve kayit izi birakir

### Senaryo C - Cift tiklama / internet kopmasi

1. Kullanici "Olustur" butonuna iki kere basar
2. Sistem ayni idempotency anahtariyla ikinciyi tekrar kaydetmez
3. Ekranda "Bu istek daha once islenmis" bilgisi gorunur
4. Muhasebede duplicate olusmaz

### Senaryo D - Yanlis post edildi

1. Islem POSTED oldugu icin duzenlenemez/silinemez
2. Reverse yapilir (gerekce zorunlu)
3. Gerekirse dogru islem yeni kayit olarak girilir
4. Denetimde zincir net gorulur

### Senaryo E - Acil override

1. Normal post kuraldan dolayi bloklanir
2. Finans admin override secip gerekce girer
3. Post tamamlanir
4. Olay istisna paneline duser, denetimde izlenir

---

## 13. Sik gorulen hata mesajlari ve cozum

- "registerId is required"
  - Register secmeden devam edilmis

- "Cash register is not ACTIVE"
  - Register pasif; once aktiflestirin

- "An OPEN session already exists for this register"
  - Ayni kasada ikinci oturum acilmaya calisildi

- "countedClosingAmount is required"
  - Kapanista sayilan tutar girilmedi

- "closeNote is required when closedReason is FORCED_CLOSE"
  - Forced close secip not yazilmadi

- "Variance exceeds configured threshold"
  - Esik ustu fark var; approveVariance + yetki gerekir

- "amount exceeds register max_txn_amount"
  - Islem tutari register limitini asti

- "Transaction currency must match register currency"
  - Islem para birimi register para birimiyle ayni degil

- "Only POSTED transactions can be reversed"
  - Reverse icin once islem POSTED olmali

- "overrideReason is required when overrideCashControl=true"
  - Override secili ama gerekce bos

Not:
- Hata kutusunda "Talep ID" gorurseniz, destek ekibine bu ID'yi iletin.

---

## 14. Gun sonu operasyon proseduru (onerilen)

1. Acik oturum listesi kontrol et
2. Tum bekleyen islemleri gozden gecir
3. Gerekliyse post/cancel islemlerini tamamla
4. Fiziki sayim yap
5. Oturumu uygun kapanis nedeni ile kapat
6. Istisna panelini kontrol et:
   - yuksek fark
   - forced close
   - override
   - unposted
7. Gerekli aciklamalari ayni gun gir

---

## 15. Haftalik/aylik kontrol proseduru (finans/supervisor)

Haftalik:
- En cok varyans olusan registerlari incele
- Tekrar eden forced close nedenlerini takip et
- Override kullanimi artis trendini kontrol et

Aylik:
- Unposted islemleri sifirla
- Varyans gain/loss hesap etkisini raporla
- Denetim icin orneklem sec (requestId + aciklama + onay izi)

---

## 16. "Neden bu kadar kisit var?" (isletme mantigi)

Bu kisitlarin amaci operasyonu zorlastirmak degil, su riskleri azaltmaktir:
- Cift kayit
- Yetkisiz post
- Kapanis sonrasi sessiz veri degisikligi
- Kasa-fiziki para uyumsuzlugu
- Denetimde aciklanamayan hareketler

Kisa cevap:
- Hız + kontrol dengesini korumak icin.

---

## 17. Hangi durumda neyi secmeliyim? (tek sayfada)

- Magaza kasasi -> `TILL + REQUIRED + allowNegative=false`
- Subede esnek petty cash -> `DRAWER + OPTIONAL`
- Merkez kasa -> `VAULT + OPTIONAL/NONE` (politika ile)
- Riskli gecis donemi -> cash control mode `WARN`
- Stabil uretim -> cash control mode `ENFORCE`

---

## 18. Son notlar

- Post edilmis kayitlar bilerek degistirilemez. Bu denetim guvencesidir.
- Silmek yerine ters kayit tercih edilir.
- Yetkiniz yoksa sistem bunu gizler/engeller; bu hata degil kontrol mekanizmasidir.
- Istisna ekrani sadece "problem listesi" degil, iyilestirme rehberidir.

---

## 19. Ekip ici hizli egitim plani (onerilir)

1. 30 dk: Kasa Tanimlari + Session mode egitimi
2. 30 dk: Kasa Oturumu ac/kapat canli deneme
3. 45 dk: Islem olustur-post-cancel-reverse senaryolari
4. 15 dk: Istisna paneli ve gun sonu checklist
5. 15 dk: Soru-cevap + yetki matrisi teyidi

Toplam: yaklasik 2 saat

---

## 20. Destek isterken ne gondermeliyim?

Sorun bildirirken su bilgileri ekleyin:
- Hangi ekran/rota
- Hangi adimda hata alindi
- Hata metni
- Talep ID (requestId)
- Islem ID / Session ID / Register ID (varsa)
- Kisa is aciklamasi (ornek: "Gun sonu kapama, forced close")

Bu bilgiler, teknik ekibin sorunu cok daha hizli cozmesini saglar.
