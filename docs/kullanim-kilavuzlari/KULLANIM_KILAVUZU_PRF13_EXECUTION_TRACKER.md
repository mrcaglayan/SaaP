# KULLANIM_KILAVUZU_PRF13_EXECUTION_TRACKER.md

## Uygulanan Follow-Up Adimlari Kullanim Kilavuzu (Son Kullanicilar Icin)

Surum: v3  
Tarih (UTC): 2026-03-02  
Hedef kitle: Muhasebe, finans, operasyon, urun sahibi (kod bilmeyen kullanicilar)

Bu kilavuz terminal komutu odakli degildir.  
Bu kilavuz, uygulamada yapilan gelistirmelerin "ekranda nasil kullanilacagini" anlatir.

Kaynak alinan uygulama planlari:
1. `06-SUBACCOUNTS.md`
2. `07-SETUPLOGIC.md`
3. `08-APPROVAL AND TAX ENGINE.md`
4. `09-FOLLOW UPS.md`

---

## 1) Bu Kilavuzun Amaci

Bu dokumanin amaci su sorulara net cevap vermektir:
1. Yapilan adimlar uygulamada bana ne kazandiriyor?
2. Hangi ekrana gidip hangi sirayla islem yapmaliyim?
3. Bu adimi atlarsam ne risk olusur?

Kisaca:
- Teknik dokumanlar "nasil gelistirildi" der.
- Bu kilavuz "nasil kullanilir" der.

---

## 2) Bu Fazda Tamamlanan Ana Isler (Kullanici Diliyle)

## 2.1 Banka ve subaccount tarafi (06 + 09 icindeki F02/F03/F04)

1. Banka hesaplari artik Operating Unit (OU) ile baglanabiliyor.
2. Banka GL baglantisinda daha siki kurallar var:
   - 102 agaci disina secim engellenir (ilgili kurulum acikken).
3. Ilk kullanimdan sonra banka kimlik alanlari korumaya alinmistir:
   - IBAN, hesap no, para birimi, bagli GL hesap gibi alanlar.
4. Tek tusla 102 alt hesap + banka hesabi birlikte acilabilir.

## 2.2 Setup Wizard tarafi (07 + 09 icindeki F05/F06)

1. Sirket kurulumu adim adim ve ulke-oncelikli akisa dondu.
2. Ulkeye gore baslangic hesap agaci/policy pack secimi var.
3. Account tree artik parent-child mantigina uygun kuruluyor.
4. Branch/operating unit setup ayni akista yonetilebiliyor.

## 2.3 Approval ve kapanis tarafi (08 + 09 icindeki F07/F08/F09)

1. Donem kapanisi ve konsolidasyon islemleri onay adimlariyla calisir.
2. Onay tamamlanmadan final adimlar bloke olur.
3. Onay akisi setup/readiness ekranlariyla daha gorunur hale geldi.

## 2.4 Tax ve mapping tarafi (08 + 09 icindeki F10/F11/F12)

1. Ulke bazli tax rejimi, tax kodu ve tax hesap eslestirmesi altyapisi eklendi.
2. Tax hesaplama davranisi daha tutarli hale getirildi.
3. Konsolidasyon icin canonical mapping katmani eklendi.

## 2.5 Rollout ve kalite guvencesi (09 icindeki F13)

1. Pilot -> genisleme akisinda kontrol adimlari netlestirildi.
2. Follow-up kapsaminda release kalite kontrolleri guclendirildi.
3. Tek kisilik (solo) proje gercegine uygun onay kapanisi modele alindi.

---

## 3) Son Kullaniciyi En Cok Etkileyen Davranis Degisiklikleri

## 3.1 Banka hesabi acarken

Artik:
1. OU secimi daha anlamli ve filtrelenebilir.
2. Yanlis legal entity / OU eslesmesi daha erken yakalanir.
3. 102 altinda olmayan hatali GL baglantisi engellenir (kurulum aciksa).

Sonuc:
- Daha guvenli ve denetlenebilir banka master kayitlari.

## 3.2 Sirket kurulumu yaparken

Artik:
1. Ulke secimi kurulumun basina alindi.
2. Hesap agaci parent-child duzeniyle kurulabiliyor.
3. Branch setup kurulumun ayrilmaz parcasi.

Sonuc:
- Sonradan duzeltme ihtiyaci azalir.

## 3.3 Donem kapanisi ve konsolidasyon yaparken

Artik:
1. Onay adimi atlanamaz.
2. "Neden finalize olmuyor?" sorusunun cevabi daha net gorunur.

Sonuc:
- Kapanis hatalari ve yetkisiz gecisler azalir.

## 3.4 Cari/tax etkisi

Artik:
1. Tax kural ve hesap baglantisi daha sistematik calisir.
2. Eksik mapping oldugunda risk daha erken gorunur.

Sonuc:
- Muhasebe kaydi kalitesi artar.

---

## 4) Ekran Bazli Kullanim Rehberi

## 4.1 Ayarlar > Sirket Ayarlari

Amac:
- Yeni kurulum veya mevcut kurulumun duzgun ilerleyip ilerlemedigini yonetmek.

Tipik kullanim:
1. Sirket kurulum ekranina gir.
2. Ulke sec.
3. Entity bilgilerini gir.
4. CoA/template secimini tamamla.
5. Account tree adiminda parent-child yapisini kur.
6. Branch/OU adiminda sube birimlerini ekle.
7. Kaydet/uygula.

Neye dikkat edilmeli?
1. Parent hesaplari cocuk hesaba baglamadan once netlestir.
2. Ayni kodu iki kez acma.
3. Ulkeye uygun paket secimi yap.

Yapilmazsa ne olur?
1. Sonraki asamalarda workflow/tax/mapping hazirliklari eksik kalabilir.
2. Kapanis ve konsolidasyon adimlarinda bloklar gorulebilir.

---

## 4.2 Ayarlar > Workflow Kurulumu

Amac:
- Donem kapanisi ve konsolidasyon icin kim hangi adimda onay verecek belirlemek.

Tipik kullanim:
1. Islem turunu sec (ornek: period close / consolidation).
2. Onay adimlarini sirayla tanimla.
3. Scope (entity/group vb.) ve sorumlu kisileri/rolleri ata.
4. Kaydet.
5. Test amacli bir akis baslatildiginda adimlarin gorundugunu kontrol et.

Neye dikkat edilmeli?
1. Onay adim sayisi bos birakilmamali.
2. Yanlis scope secimi tum akis davranisini etkiler.
3. Bir adimda gerekli rol yoksa surec beklemede kalir.

Yapilmazsa ne olur?
1. Kapanis/finalize adimlari onay bekledigi icin tamamlanamaz.

---

## 4.3 Banka Islemleri > Banka Tanimla

Amac:
- Dogru OU ve dogru GL baglantisiyla banka hesabini acmak.

Iki kullanim yolu:
1. Normal banka hesabi olusturma
2. Tek adimda 102 alt hesap + banka hesabi olusturma

### Normal banka hesabi olusturma

1. Legal Entity sec.
2. Gerekliyse Operating Unit sec.
3. Banka hesap bilgilerini gir (IBAN, hesap no, para birimi vb.).
4. Uygun GL hesabi sec.
5. Kaydet.

### Tek adimda 102 alt hesap + banka hesabi

1. "102 alt hesapla olustur" benzeri hizli akis secenegini kullan.
2. GL cocuk hesap adi/kodu icin istenen alanlari doldur.
3. Banka bilgilerini tamamla.
4. Kaydet.

Neye dikkat edilmeli?
1. OU, secilen legal entity ile uyumlu olmali.
2. Ilk kullanimdan sonra kimlik alanlari degistirilemeyebilir.
3. GL secimi sistem kurallarina uymuyorsa kayit alinmaz.

Yapilmazsa ne olur?
1. Yanlis hesap baglantisi muhasebe ve mutabakatta zincir hata uretir.

---

## 4.4 Donem Sonu > Kapanis/Konsolidasyon ile ilgili ekranlar

Amac:
- Onayli ve denetlenebilir kapanis akisi.

Tipik kullanim:
1. Kapanis veya konsolidasyon islemini baslat.
2. Sistem onay adimi istiyorsa ilgili kisiler onaylar.
3. Tum adimlar tamamlandiginda finalize edilir.

Neye dikkat edilmeli?
1. "Onay gerekiyor" uyarisini atlamaya calisma.
2. Gecikme varsa workflow setup tarafini kontrol et.

Yapilmazsa ne olur?
1. Kapanis sureci yarida kalir.
2. Raporlama guvenilirligi duser.

---

## 4.5 Donem Sonu > Yillik > Konsolidasyon Raporlari

Amac:
- Canonical mapping mantigiyla daha tutarli konsolidasyon ciktilari almak.

Tipik kullanim:
1. Donem sec.
2. Raporu calistir.
3. Beklenmeyen fark varsa mapping ve onay akislarini kontrol et.

Neye dikkat edilmeli?
1. Tum gerekli adimlar tamamlanmadan rapor yorumu yapma.
2. Ozellikle yeni kurulumdan sonra ilk raporda farklar normal olabilir; setup kontrolu gerekir.

---

## 5) "Ne Zaman Ne Yapmaliyim?" Hizli Is Akislari

## 5.1 Yeni bir sirket/tenant acilisinda

1. Sirket kurulumunu wizard ile tamamla.
2. Branch/OU yapisini netlestir.
3. Gereken banka hesaplarini dogru OU/GL ile tanimla.
4. Workflow onay adimlarini belirle.
5. Ilk kapanis denemesinde onay akisinin calistigini kontrol et.

## 5.2 Banka hesabini degistirmek isterken

1. Once hesapta gercek islem gecmisi var mi kontrol et.
2. Kilitli alanlari zorlamadan, gerekiyorsa yeni hesap acma yoluna git.
3. Eski hesabi status yonetimiyle pasiflestir.

## 5.3 Kapanis "takildi" hissi varsa

1. Islem ekraninda onay bekleme durumunu kontrol et.
2. Workflow kurulumu ekraninda adim/rol eslesmesini kontrol et.
3. Eksik adim varsa duzeltip yeniden dene.

## 5.4 Konsolidasyon sonucunda fark varsa

1. Mapping hazirligi ve hesap agaci kurulumunu kontrol et.
2. Ilgili donemde onay sureci tamam mi bak.
3. Sonra raporu tekrar degerlendir.

---

## 6) Sik Sorulan Sorular (Kodsuz Cevaplar)

## 6.1 "Neden bazi banka alanlarini degistiremiyorum?"

Cunku hesap artik kullanilmis olabilir.  
Bu koruma, gecmis kayitlarin guvenilir kalmasi icin var.

## 6.2 "Neden kapanis butonu ilerlemiyor?"

Genellikle onay adimi tamamlanmamistir veya yanlis setup vardir.

## 6.3 "Neden yeni kurulumdan sonra birkac yerde eksik uyari var?"

Kurulum adimlarinin bir parcasi atlanmis olabilir:
1. Account tree
2. Workflow setup
3. Tax/mapping hazirligi

## 6.4 "Outbox/reminder dosyalari ne ise yariyor?"

Bunlar teknik calisma dosyasi degil, operasyonel mesaj taslagi ve audit izi amacli dosyalardir.

## 6.5 "Solo app'te niye onay kaydi var?"

Dis ekip zorunlulugu olmasa bile, karar ve gecis adimlarinin kayitli kalmasi sonraki denetim/handover icin faydalidir.

---

## 7) Ekip Rolleri ve Sorumluluk Onerisi

## 7.1 Finans/Muhasebe kullanicisi

1. Banka hesap setup kurallarina uyar.
2. Kapanis onay surecinde adimlarini tamamlar.
3. Konsolidasyon ciktilarini is mantigiyla kontrol eder.

## 7.2 Operasyon sorumlusu

1. Wizard kurulum adimlarinin tam oldugunu teyit eder.
2. Akis takildiginda ilgili setup ekranina geri doner.
3. Kayit tutma/disiplin tarafini surdurur.

## 7.3 Urun/owner (solo dahil)

1. Hangi moduller bu fazda kapsama girdi net tutar.
2. Kapsam disi talepleri ayri faza planlar.
3. Son karar ve kapanis kaydini netlestirir.

---

## 8) Bu Fazda Kapsama Girmeyen Moduller

Asagidaki alanlar bu kilavuzdaki uygulanan adimlarin disindadir:
1. Stok modulu
2. Demirbas/fixed assets modulu
3. Genel raporlar bolumundeki tum placeholder ekranlar

Bu alanlar icin ayri plan ve ayri kullanim kilavuzu gerekir.

---

## 9) Son Kullanici Icin "Tamamlandi Mi?" Kontrol Listesi

Teknik komut bilmeden de su kontrolu yapabilirsin:

1. Sirket kurulum adimlari ekranlarda tamamlandi mi?
2. Banka hesaplari OU/GL ile dogru acildi mi?
3. Kapanis/konsolidasyon isleminde onay adimlari calisiyor mu?
4. Konsolidasyon raporu beklenen mantikta geliyor mu?
5. Ekibin kullandigi kayit dokumanlarinda "GO" karari var mi?

Tum cevaplar "evet" ise bu fazin kullanimi operasyonel olarak hazirdir.

---

## 10) Teknik Ek Icin Not (Son Kullanicilar Atlayabilir)

Bu kilavuz bilerek kod/terminal adimi icermez.  
Eger teknik ekip script veya release-gate komutlarina bakacaksa:
1. `11-PR-F13-ROLLOUT-RUNBOOK.md`
2. `12-PR-F13-PILOT-GA-SWITCH-PLAN.md`
3. `13-PR-F13-GA-SIGNOFF-RECORD.md`
4. `10-EXECUTION TRACKER.md`

Bu dort dokuman teknik operasyon adimlarini zaten detayli tutar.
