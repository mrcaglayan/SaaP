# SaaP Tum Kullanim Kilavuzu (Birlesik PDF Surumu)

Surum tarihi: 2026-02-22

## Icindekiler (Tiklanabilir)

Bu dokuman, 3 ana kilavuzun tek PDF ciktisi alinabilmesi icin birlestirilmis halidir.
Icindekilerdeki baglantilara tiklayarak ilgili basliga gidebilirsiniz.

### Ana Bolumler
- [Bolum 1 - Ana Is Akisi ve Kurulum](#bolum1-baslangic)
  - [1) Kisa Ozet: Bu Sistemde Ana Mantik Nedir?](#bolum1-1-kisa-ozet-bu-sistemde-ana-mantik-nedir)
  - [2) Sifirdan Baslangic Senaryosu (Schema Silindikten Sonra)](#bolum1-2-sifirdan-baslangic-senaryosu-schema-silindikten-sonra)
  - [3) Kurulum Yolu: Hangi Sirayi Izlemeliyim?](#bolum1-3-kurulum-yolu-hangi-sirayi-izlemeliyim)
  - [4) Adim Adim Manuel Kurulum](#bolum1-4-adim-adim-manuel-kurulum)
  - [Adim 1 - Grup Sirketini Olustur](#bolum1-adim-1-grup-sirketini-olustur)
  - [Adim 2 - Legal Entity (Bagli Ortak) Olustur](#bolum1-adim-2-legal-entity-bagli-ortak-olustur)
  - [Adim 3 - Sube / Operasyon Birimi Tanimla](#bolum1-adim-3-sube-operasyon-birimi-tanimla)
  - [Adim 4 - Mali Takvim Kaydet](#bolum1-adim-4-mali-takvim-kaydet)
  - [Adim 5 - Donemleri Uret ve Dogru Filtreyle Listele](#bolum1-adim-5-donemleri-uret-ve-dogru-filtreyle-listele)
  - [Adim 6 - Defter (Book) Olustur](#bolum1-adim-6-defter-book-olustur)
  - [Adim 7 - Hesap Plani (CoA) Olustur](#bolum1-adim-7-hesap-plani-coa-olustur)
  - [Adim 8 - Hesaplari Yukle (Turkish Default CoA)](#bolum1-adim-8-hesaplari-yukle-turkish-default-coa)
  - [Adim 9 - Ortaklar ve Sermaye Taahhut Kurulumu](#bolum1-adim-9-ortaklar-ve-sermaye-taahhut-kurulumu)
  - [Adim 10 - Ilk Test Fisini Olustur](#bolum1-adim-10-ilk-test-fisini-olustur)
  - [Adim 11 - Intercompany Ciftlerini (Pair) Dogru Hazirla](#bolum1-adim-11-intercompany-ciftlerini-pair-dogru-hazirla)
  - [Adim 12 - Intercompany Fisini Otomatik Partner Mirror Ile Calistir](#bolum1-adim-12-intercompany-fisini-otomatik-partner-mirror-ile-calistir)
  - [Adim 13 - Post Asamasinda Bagli Mirrorlari Birlikte Post Et](#bolum1-adim-13-post-asamasinda-bagli-mirrorlari-birlikte-post-et)
  - [Adim 14 - Intercompany Uyumluluk Kontrolu (Compliance)](#bolum1-adim-14-intercompany-uyumluluk-kontrolu-compliance)
  - [Adim 15 - Intercompany Mutabakat Raporunu Calistir](#bolum1-adim-15-intercompany-mutabakat-raporunu-calistir)
  - [Adim 16 - Konsolidasyon Kurulumu ve Raporlari](#bolum1-adim-16-konsolidasyon-kurulumu-ve-raporlari)
  - [Adim 17 - Hesap Yeniden Siniflandirma (Bakiye Dagitimi / Islem Bazli)](#bolum1-adim-17-hesap-yeniden-siniflandirma-bakiye-dagitimi-islem-bazli)
  - [5) En Cok Karsilasilan Durumlar ve Cozumler](#bolum1-5-en-cok-karsilasilan-durumlar-ve-cozumler)
  - [6) Gunluk Pratik Is Akisi (Muhasebe Ekibi Icin)](#bolum1-6-gunluk-pratik-is-akisi-muhasebe-ekibi-icin)
  - [7) Roller ve Yetki (Neden Bazen Buton Gorunmuyor?)](#bolum1-7-roller-ve-yetki-neden-bazen-buton-gorunmuyor)
  - [8) Kisa Karar Rehberi](#bolum1-8-kisa-karar-rehberi)
  - [9) Ozet](#bolum1-9-ozet)
- [Bolum 2 - RBAC ve Kullanici Yetkilendirme](#bolum2-baslangic)
  - [1) Temel Kavramlar (Karisan Noktalar)](#bolum2-1-temel-kavramlar-karisan-noktalar)
  - [2) RBAC Ekranlari ve Ne Ise Yarar](#bolum2-2-rbac-ekranlari-ve-ne-ise-yarar)
  - [3) On Kosullar](#bolum2-3-on-kosullar)
  - [4) Sifirdan RBAC Kurulum Akisi](#bolum2-4-sifirdan-rbac-kurulum-akisi)
  - [Adim 1 - Rol Tasarimini Belirle](#bolum2-adim-1-rol-tasarimini-belirle)
  - [Adim 2 - Rol Olustur](#bolum2-adim-2-rol-olustur)
  - [Adim 3 - Role Permission Bagla](#bolum2-adim-3-role-permission-bagla)
  - [Adim 4 - Kullanici Olustur](#bolum2-adim-4-kullanici-olustur)
  - [Adim 5 - Kullaniciya Rol + Scope Ata](#bolum2-adim-5-kullaniciya-rol-scope-ata)
  - [Adim 6 - Gerekirse Data Scope Ile Daralt](#bolum2-adim-6-gerekirse-data-scope-ile-daralt)
  - [Adim 7 - Denetim ve Dogrulama](#bolum2-adim-7-denetim-ve-dogrulama)
  - [5) Sistem Rol Kurali (Kritik)](#bolum2-5-sistem-rol-kurali-kritik)
  - [6) Ornek Senaryolar](#bolum2-6-ornek-senaryolar)
  - [Senaryo A - Group bazli kullanici](#bolum2-senaryo-a-group-bazli-kullanici)
  - [Senaryo B - Entity bazli muhasebeci](#bolum2-senaryo-b-entity-bazli-muhasebeci)
  - [Senaryo C - Subede operator](#bolum2-senaryo-c-subede-operator)
  - [7) 10 Dakikalik Smoke Test Listesi](#bolum2-7-10-dakikalik-smoke-test-listesi)
  - [8) Sik Sorulan Sorular](#bolum2-8-sik-sorulan-sorular)
  - [9) Operasyonel Tavsiyeler](#bolum2-9-operasyonel-tavsiyeler)
- [Bolum 3 - Kasa Modulu Operasyon Rehberi](#bolum3-baslangic)
  - [SAAP Kasa Modulu Kullanım Kilavuzu (Teknik Olmayan Kullanicilar Icin)](#bolum3-saap-kasa-modulu-kullanm-kilavuzu-teknik-olmayan-kullanicilar-icin)
  - [1. Bu modul neyi cozer?](#bolum3-1-bu-modul-neyi-cozer)
  - [2. Temel kavramlar (teknik olmayan dille)](#bolum3-2-temel-kavramlar-teknik-olmayan-dille)
  - [3. Menude nereye girilir?](#bolum3-3-menude-nereye-girilir)
  - [4. Yetki modeli (kim ne yapabilir?)](#bolum3-4-yetki-modeli-kim-ne-yapabilir)
  - [5. Kasa kontrol modu banner'i (OFF / WARN / ENFORCE)](#bolum3-5-kasa-kontrol-modu-banneri-off-warn-enforce)
  - [6. Isletmeye almadan once kontrol listesi](#bolum3-6-isletmeye-almadan-once-kontrol-listesi)
  - [7. Kasa Tanimlari ekrani (adim adim)](#bolum3-7-kasa-tanimlari-ekrani-adim-adim)
  - [8. Kasa Oturumlari ekrani](#bolum3-8-kasa-oturumlari-ekrani)
  - [9. Kasa Islemleri / Tahsilat / Tediye](#bolum3-9-kasa-islemleri-tahsilat-tediye)
  - [10. Kasa Istisnalari ekrani (denetim paneli)](#bolum3-10-kasa-istisnalari-ekrani-denetim-paneli)
  - [11. "Secim" rehberi (hizli karar tablosu)](#bolum3-11-secim-rehberi-hizli-karar-tablosu)
  - [12. Gercek hayat senaryolari](#bolum3-12-gercek-hayat-senaryolari)
  - [13. Sik gorulen hata mesajlari ve cozum](#bolum3-13-sik-gorulen-hata-mesajlari-ve-cozum)
  - [14. Gun sonu operasyon proseduru (onerilen)](#bolum3-14-gun-sonu-operasyon-proseduru-onerilen)
  - [15. Haftalik/aylik kontrol proseduru (finans/supervisor)](#bolum3-15-haftalikaylik-kontrol-proseduru-finanssupervisor)
  - [16. "Neden bu kadar kisit var?" (isletme mantigi)](#bolum3-16-neden-bu-kadar-kisit-var-isletme-mantigi)
  - [17. Hangi durumda neyi secmeliyim? (tek sayfada)](#bolum3-17-hangi-durumda-neyi-secmeliyim-tek-sayfada)
  - [18. Son notlar](#bolum3-18-son-notlar)
  - [19. Ekip ici hizli egitim plani (onerilir)](#bolum3-19-ekip-ici-hizli-egitim-plani-onerilir)
  - [20. Destek isterken ne gondermeliyim?](#bolum3-20-destek-isterken-ne-gondermeliyim)
  - [21. Ek A - Kasa Modulu Teknik Karar Ozeti (ADR'den Isletmeye Cevrilmis)](#bolum3-21-ek-a-kasa-modulu-teknik-karar-ozeti-adrden-isletmeye-cevrilmis)
  - [22. Ek B - Islem Tipine Gore Muhasebe Kaydi Matrisi (Uygulamadaki Guncel Davranis)](#bolum3-22-ek-b-islem-tipine-gore-muhasebe-kaydi-matrisi-uygulamadaki-guncel-davranis)
  - [23. Ek C - Yetki ve Gorev Ayrimi (SoD) - Mevcut Sistem](#bolum3-23-ek-c-yetki-ve-gorev-ayrimi-sod-mevcut-sistem)

### PDF Sayfa Haritasi (A4 Tahmini)

| Bolum | Konu | Kaynak | Tahmini PDF Sayfa |
|---|---|---|---|
| B1 | [Bolum 1 - Ana Is Akisi ve Kurulum](#bolum1-baslangic) | `KULLANIM_KILAVUZU.md` | 4 |
| B2 | [Bolum 2 - RBAC ve Kullanici Yetkilendirme](#bolum2-baslangic) | `KULLANIM_KILAVUZU_BOLUM2_RBAC.md` | 23 |
| B3 | [Bolum 3 - Kasa Modulu Operasyon Rehberi](#bolum3-baslangic) | `KULLANIM_KILAVUZU_KASA_MODULU.md` | 29 |

### Konu-Sayfa Dizini (Header/Topic, A4 Tahmini)

| Bolum | Header / Topic | Tahmini PDF Sayfa |
|---|---|---|
| B1 | [1) Kisa Ozet: Bu Sistemde Ana Mantik Nedir?](#bolum1-1-kisa-ozet-bu-sistemde-ana-mantik-nedir) | 5 |
| B1 | [2) Sifirdan Baslangic Senaryosu (Schema Silindikten Sonra)](#bolum1-2-sifirdan-baslangic-senaryosu-schema-silindikten-sonra) | 5 |
| B1 | [3) Kurulum Yolu: Hangi Sirayi Izlemeliyim?](#bolum1-3-kurulum-yolu-hangi-sirayi-izlemeliyim) | 6 |
| B1 | [4) Adim Adim Manuel Kurulum](#bolum1-4-adim-adim-manuel-kurulum) | 6 |
| B1 | [Adim 1 - Grup Sirketini Olustur](#bolum1-adim-1-grup-sirketini-olustur) | 6 |
| B1 | [Adim 2 - Legal Entity (Bagli Ortak) Olustur](#bolum1-adim-2-legal-entity-bagli-ortak-olustur) | 7 |
| B1 | [Adim 3 - Sube / Operasyon Birimi Tanimla](#bolum1-adim-3-sube-operasyon-birimi-tanimla) | 8 |
| B1 | [Adim 4 - Mali Takvim Kaydet](#bolum1-adim-4-mali-takvim-kaydet) | 10 |
| B1 | [Adim 5 - Donemleri Uret ve Dogru Filtreyle Listele](#bolum1-adim-5-donemleri-uret-ve-dogru-filtreyle-listele) | 10 |
| B1 | [Adim 6 - Defter (Book) Olustur](#bolum1-adim-6-defter-book-olustur) | 11 |
| B1 | [Adim 7 - Hesap Plani (CoA) Olustur](#bolum1-adim-7-hesap-plani-coa-olustur) | 11 |
| B1 | [Adim 8 - Hesaplari Yukle (Turkish Default CoA)](#bolum1-adim-8-hesaplari-yukle-turkish-default-coa) | 12 |
| B1 | [Adim 9 - Ortaklar ve Sermaye Taahhut Kurulumu](#bolum1-adim-9-ortaklar-ve-sermaye-taahhut-kurulumu) | 12 |
| B1 | [Adim 10 - Ilk Test Fisini Olustur](#bolum1-adim-10-ilk-test-fisini-olustur) | 14 |
| B1 | [Adim 11 - Intercompany Ciftlerini (Pair) Dogru Hazirla](#bolum1-adim-11-intercompany-ciftlerini-pair-dogru-hazirla) | 14 |
| B1 | [Adim 12 - Intercompany Fisini Otomatik Partner Mirror Ile Calistir](#bolum1-adim-12-intercompany-fisini-otomatik-partner-mirror-ile-calistir) | 15 |
| B1 | [Adim 13 - Post Asamasinda Bagli Mirrorlari Birlikte Post Et](#bolum1-adim-13-post-asamasinda-bagli-mirrorlari-birlikte-post-et) | 15 |
| B1 | [Adim 14 - Intercompany Uyumluluk Kontrolu (Compliance)](#bolum1-adim-14-intercompany-uyumluluk-kontrolu-compliance) | 16 |
| B1 | [Adim 15 - Intercompany Mutabakat Raporunu Calistir](#bolum1-adim-15-intercompany-mutabakat-raporunu-calistir) | 16 |
| B1 | [Adim 16 - Konsolidasyon Kurulumu ve Raporlari](#bolum1-adim-16-konsolidasyon-kurulumu-ve-raporlari) | 17 |
| B1 | [Adim 17 - Hesap Yeniden Siniflandirma (Bakiye Dagitimi / Islem Bazli)](#bolum1-adim-17-hesap-yeniden-siniflandirma-bakiye-dagitimi-islem-bazli) | 17 |
| B1 | [5) En Cok Karsilasilan Durumlar ve Cozumler](#bolum1-5-en-cok-karsilasilan-durumlar-ve-cozumler) | 19 |
| B1 | [6) Gunluk Pratik Is Akisi (Muhasebe Ekibi Icin)](#bolum1-6-gunluk-pratik-is-akisi-muhasebe-ekibi-icin) | 21 |
| B1 | [7) Roller ve Yetki (Neden Bazen Buton Gorunmuyor?)](#bolum1-7-roller-ve-yetki-neden-bazen-buton-gorunmuyor) | 21 |
| B1 | [8) Kisa Karar Rehberi](#bolum1-8-kisa-karar-rehberi) | 22 |
| B1 | [9) Ozet](#bolum1-9-ozet) | 22 |
| B2 | [1) Temel Kavramlar (Karisan Noktalar)](#bolum2-1-temel-kavramlar-karisan-noktalar) | 23 |
| B2 | [2) RBAC Ekranlari ve Ne Ise Yarar](#bolum2-2-rbac-ekranlari-ve-ne-ise-yarar) | 24 |
| B2 | [3) On Kosullar](#bolum2-3-on-kosullar) | 24 |
| B2 | [4) Sifirdan RBAC Kurulum Akisi](#bolum2-4-sifirdan-rbac-kurulum-akisi) | 24 |
| B2 | [Adim 1 - Rol Tasarimini Belirle](#bolum2-adim-1-rol-tasarimini-belirle) | 24 |
| B2 | [Adim 2 - Rol Olustur](#bolum2-adim-2-rol-olustur) | 25 |
| B2 | [Adim 3 - Role Permission Bagla](#bolum2-adim-3-role-permission-bagla) | 25 |
| B2 | [Adim 4 - Kullanici Olustur](#bolum2-adim-4-kullanici-olustur) | 25 |
| B2 | [Adim 5 - Kullaniciya Rol + Scope Ata](#bolum2-adim-5-kullaniciya-rol-scope-ata) | 26 |
| B2 | [Adim 6 - Gerekirse Data Scope Ile Daralt](#bolum2-adim-6-gerekirse-data-scope-ile-daralt) | 26 |
| B2 | [Adim 7 - Denetim ve Dogrulama](#bolum2-adim-7-denetim-ve-dogrulama) | 27 |
| B2 | [5) Sistem Rol Kurali (Kritik)](#bolum2-5-sistem-rol-kurali-kritik) | 27 |
| B2 | [6) Ornek Senaryolar](#bolum2-6-ornek-senaryolar) | 27 |
| B2 | [Senaryo A - Group bazli kullanici](#bolum2-senaryo-a-group-bazli-kullanici) | 27 |
| B2 | [Senaryo B - Entity bazli muhasebeci](#bolum2-senaryo-b-entity-bazli-muhasebeci) | 28 |
| B2 | [Senaryo C - Subede operator](#bolum2-senaryo-c-subede-operator) | 28 |
| B2 | [7) 10 Dakikalik Smoke Test Listesi](#bolum2-7-10-dakikalik-smoke-test-listesi) | 28 |
| B2 | [8) Sik Sorulan Sorular](#bolum2-8-sik-sorulan-sorular) | 28 |
| B2 | [9) Operasyonel Tavsiyeler](#bolum2-9-operasyonel-tavsiyeler) | 29 |
| B3 | [SAAP Kasa Modulu Kullanım Kilavuzu (Teknik Olmayan Kullanicilar Icin)](#bolum3-saap-kasa-modulu-kullanm-kilavuzu-teknik-olmayan-kullanicilar-icin) | 29 |
| B3 | [1. Bu modul neyi cozer?](#bolum3-1-bu-modul-neyi-cozer) | 29 |
| B3 | [2. Temel kavramlar (teknik olmayan dille)](#bolum3-2-temel-kavramlar-teknik-olmayan-dille) | 30 |
| B3 | [3. Menude nereye girilir?](#bolum3-3-menude-nereye-girilir) | 30 |
| B3 | [4. Yetki modeli (kim ne yapabilir?)](#bolum3-4-yetki-modeli-kim-ne-yapabilir) | 31 |
| B3 | [5. Kasa kontrol modu banner'i (OFF / WARN / ENFORCE)](#bolum3-5-kasa-kontrol-modu-banneri-off-warn-enforce) | 31 |
| B3 | [6. Isletmeye almadan once kontrol listesi](#bolum3-6-isletmeye-almadan-once-kontrol-listesi) | 32 |
| B3 | [7. Kasa Tanimlari ekrani (adim adim)](#bolum3-7-kasa-tanimlari-ekrani-adim-adim) | 32 |
| B3 | [8. Kasa Oturumlari ekrani](#bolum3-8-kasa-oturumlari-ekrani) | 34 |
| B3 | [9. Kasa Islemleri / Tahsilat / Tediye](#bolum3-9-kasa-islemleri-tahsilat-tediye) | 37 |
| B3 | [10. Kasa Istisnalari ekrani (denetim paneli)](#bolum3-10-kasa-istisnalari-ekrani-denetim-paneli) | 39 |
| B3 | [11. "Secim" rehberi (hizli karar tablosu)](#bolum3-11-secim-rehberi-hizli-karar-tablosu) | 39 |
| B3 | [12. Gercek hayat senaryolari](#bolum3-12-gercek-hayat-senaryolari) | 41 |
| B3 | [13. Sik gorulen hata mesajlari ve cozum](#bolum3-13-sik-gorulen-hata-mesajlari-ve-cozum) | 42 |
| B3 | [14. Gun sonu operasyon proseduru (onerilen)](#bolum3-14-gun-sonu-operasyon-proseduru-onerilen) | 43 |
| B3 | [15. Haftalik/aylik kontrol proseduru (finans/supervisor)](#bolum3-15-haftalikaylik-kontrol-proseduru-finanssupervisor) | 43 |
| B3 | [16. "Neden bu kadar kisit var?" (isletme mantigi)](#bolum3-16-neden-bu-kadar-kisit-var-isletme-mantigi) | 43 |
| B3 | [17. Hangi durumda neyi secmeliyim? (tek sayfada)](#bolum3-17-hangi-durumda-neyi-secmeliyim-tek-sayfada) | 44 |
| B3 | [18. Son notlar](#bolum3-18-son-notlar) | 44 |
| B3 | [19. Ekip ici hizli egitim plani (onerilir)](#bolum3-19-ekip-ici-hizli-egitim-plani-onerilir) | 44 |
| B3 | [20. Destek isterken ne gondermeliyim?](#bolum3-20-destek-isterken-ne-gondermeliyim) | 44 |
| B3 | [21. Ek A - Kasa Modulu Teknik Karar Ozeti (ADR'den Isletmeye Cevrilmis)](#bolum3-21-ek-a-kasa-modulu-teknik-karar-ozeti-adrden-isletmeye-cevrilmis) | 45 |
| B3 | [22. Ek B - Islem Tipine Gore Muhasebe Kaydi Matrisi (Uygulamadaki Guncel Davranis)](#bolum3-22-ek-b-islem-tipine-gore-muhasebe-kaydi-matrisi-uygulamadaki-guncel-davranis) | 46 |
| B3 | [23. Ek C - Yetki ve Gorev Ayrimi (SoD) - Mevcut Sistem](#bolum3-23-ek-c-yetki-ve-gorev-ayrimi-sod-mevcut-sistem) | 46 |

> Not: Sayfa numaralari otomatik olarak A4 tahmini satir yogunluguna gore uretilir.
> Kesin navigasyon icin tiklanabilir baslik baglantilarini kullanin.

## Tam Icerik

<a id="bolum1-baslangic"></a>
## Bolum 1 - Ana Is Akisi ve Kurulum

> Kaynak dosya: `KULLANIM_KILAVUZU.md`

---

<a id="bolum1-saap-kullanim-kilavuzu-is-birimi-odakli"></a>
## SaaP Kullanim Kilavuzu (Is Birimi Odakli)

Bu dokuman teknik olmayan kullanicilar icin yazildi.
Amac: sistemi sifirdan dogru kurmak, gunluk muhasebe akislarini hatasiz ilerletmek ve intercompany islemlerini otomatik hale getirmek.

Bu kilavuzda her adim icin su 3 soruya cevap verilir:
1. Bu adim ne ise yarar?
2. Ne doldurmaliyim?
3. Bu adimi yapmazsam ne olur?

---

<a id="bolum1-1-kisa-ozet-bu-sistemde-ana-mantik-nedir"></a>
### 1) Kisa Ozet: Bu Sistemde Ana Mantik Nedir?

Sistem 4 temel blokta calisir:
1. Organizasyon yapisi kurulur.
2. Defter ve hesap plani kurulumu yapilir.
3. Fisler olusturulur, post edilir, donem kontrolu yapilir.
4. Intercompany mutabakat ve konsolidasyon raporlari alinır.

Gercek hayat benzetmesi:
- Organizasyon yapisi = Sirketin iskeleti.
- Hesap plani = Finans dili.
- Fis = Her islemin resmi kaydi.
- Mutabakat = Iki sirketin birbirine ayni tutari gormesi.
- Konsolidasyon = Tum sirketlerin tek tablo gibi gosterilmesi.

Terminoloji notu:
- Bu kilavuzda standart ifade `Legal Entity (Bagli Ortak)` olarak kullanilir.

---

<a id="bolum1-2-sifirdan-baslangic-senaryosu-schema-silindikten-sonra"></a>
### 2) Sifirdan Baslangic Senaryosu (Schema Silindikten Sonra)

Schema silindiyse once teknik hazirlik gerekir. Bu bolumu genelde IT/teknik ekip yapar.

<a id="bolum1-21-teknik-hazirlik-it-ekibi"></a>
#### 2.1 Teknik Hazirlik (IT Ekibi)

Yapilacaklar:
1. Veritabani tablolarini yeniden olusturmak (migration).
2. Temel sistem verilerini yuklemek (seed).
3. Ilk admin kullanicisini hazirlamak.

Yapilmazsa ne olur:
1. Login ekranina girseniz bile kullanici dogrulanamaz.
2. Sayfalar bos gelir veya "not found" tipinde hatalar gorursunuz.
3. Kaydetme butonlari calissa bile alt tarafta listeler dolmaz.

<a id="bolum1-22-kullanici-kontrolu"></a>
#### 2.2 Kullanici Kontrolu

Kullanici olarak kontrol edin:
1. Login olabiliyor muyum?
2. Sol menude "Ayarlar" altinda sayfalar gorunuyor mu?
3. "Organizasyon Yonetimi" aciliyor mu?

Bunlardan biri calismiyorsa teknik kurulum bitmemistir.

---

<a id="bolum1-3-kurulum-yolu-hangi-sirayi-izlemeliyim"></a>
### 3) Kurulum Yolu: Hangi Sirayi Izlemeliyim?

Iki yol var:
1. Hizli kurulum: `Sirket Ayarlari` (Company bootstrap)
2. Manuel kurulum: `Organizasyon Yonetimi` + `Hesap Plani Ayarlari`

Bu kilavuz manuel yola odaklidir (sizin seciminiz).

Neden manuel yol?
1. Her adimi kontrol ederek ilerlersiniz.
2. Yanlis kurgu riskini erken gorursunuz.
3. Buyuk organizasyonlarda daha guvenli olur.

Not (guncel sistem davranisi):
1. Readiness kontrol listesi artik su ek kalemleri de denetler:
   - `Open book periods`
   - `Shareholders`
   - `Shareholder commitment debit mappings`
2. Bu kalemler eksikse sistem kurulum adimlarina yonlendirir.

---

<a id="bolum1-4-adim-adim-manuel-kurulum"></a>
### 4) Adim Adim Manuel Kurulum

<a id="bolum1-adim-1-grup-sirketini-olustur"></a>
### Adim 1 - Grup Sirketini Olustur

Ekran:
- `Ayarlar > Organizasyon Yonetimi > Group Companies`

Ne doldurulur:
1. `Code` (ornek: `TMV`)
2. `Name` (ornek: `Turkish Maarif Foundation`)
3. `Save`

Amac:
- Tum `Legal Entity (Bagli Ortak)` kayitlarini tek bir cati grup altinda toplamak.

Yapilmazsa:
- `Legal Entity (Bagli Ortak)` olustururken baglanacak grup olmaz.
- Sonraki konsolidasyon kurulumunda problem yasarsiniz.

---

<a id="bolum1-adim-2-legal-entity-bagli-ortak-olustur"></a>
### Adim 2 - Legal Entity (Bagli Ortak) Olustur

Ekran:
- `Ayarlar > Organizasyon Yonetimi > Legal Entities`

Ne doldurulur:
1. Group company secimi
2. Entity code, entity name
3. Country, currency
4. Opsiyonel: tax id
5. Isaret kutulari:
   - `Intercompany enabled`
   - `Partner required`
   - `Auto-create defaults` (isterseniz)

<a id="bolum1-auto-create-defaults-ne-yapar"></a>
#### `Auto-create defaults` ne yapar?

Bu kutu aciksa, `Save` aninda sistem otomatik olarak sunlari olusturmayi dener:
1. Fiscal calendar: yoksa `MAIN`
2. Fiscal periods: secilen yil icin 12 donem (Ocak-Aralik akisi)
3. CoA: `Legal Entity (Bagli Ortak)` icin `COA-<EntityCode>` tipinde hesap plani
4. Book: `Legal Entity (Bagli Ortak)` icin `BOOK-<EntityCode>` tipinde LOCAL defter
5. Temel hesaplar: CoA tamamen bossa su 6 hesap:
   - `1000` Cash and Cash Equivalents
   - `1100` Accounts Receivable
   - `2000` Accounts Payable
   - `3000` Retained Earnings
   - `4000` Revenue
   - `5000` Operating Expense

<a id="bolum1-auto-create-defaults-ne-yapmaz"></a>
#### `Auto-create defaults` ne yapmaz?

1. Turk detay hesap planini (genis hesap listesi) yuklemez.
2. Var olan hesaplari topluca silip sifirdan kurmaz.
3. CoA icinde zaten hesap varsa, yukaridaki 6 temel hesabi yeniden eklemez.

Not:
- Turk hesap plani istiyorsaniz ayrica
  `Ayarlar > Hesap Plani Ayarlari > Load Turkish Default CoA`
  adimini kullanin.

Amac:
- Sirket bazli muhasebe kayit alanini acmak.

Yapilmazsa:
- Defter, hesap plani, fis gibi hicbir finans adimi baslamaz.

Gercek hayat ornegi:
- `AMF` (Afghanistan `Legal Entity (Bagli Ortak)`) tek basina bir muhasebe defteri tutar.
- `TMV` grubuna bagli oldugu icin sonra toplu rapora girebilir.

<a id="bolum1-intercompany-kutularinin-anlami-bugun-itibariyla"></a>
#### Intercompany Kutularinin Anlami (Bugun Itibariyla)

`Intercompany enabled`:
- Aciksa: bu `Legal Entity (Bagli Ortak)` intercompany karsi tarafli satir kullanabilir.
- Kapaliysa: karsi tarafli satir ve INTERCOMPANY kaynakli fis engellenir.

`Partner required`:
- Aciksa ve kaynak tipi `INTERCOMPANY` secilmisse:
  tum satirlarda karsi taraf entity secimi zorunlu olur.

Yapilmazsa veya yanlis secilirse:
1. Fis kaydi sirasinda policy hatalari alirsiniz.
2. Karsi tarafi eksik birakir, mutabakatta sapma olusturursunuz.

---

<a id="bolum1-adim-3-sube-operasyon-birimi-tanimla"></a>
### Adim 3 - Sube / Operasyon Birimi Tanimla

Ekran:
- `Ayarlar > Organizasyon Yonetimi > Operating Units / Branches`

Ne doldurulur:
1. `Legal Entity (Bagli Ortak)` sec
2. Sube kodu ve adi
3. `Save`

<a id="bolum1-has-subledger-alt-defter-var-kutusu-ne-anlama-gelir"></a>
#### `Has subledger` (Alt defter var) kutusu ne anlama gelir?

Bu kutu, subenin satir bazli alt referans zorunlulugu olup olmadigini belirler.

Ne zaman isaretlenmeli?
1. Sube bazinda detay takip istiyorsaniz (ornek: sube bazli alici/satici, stok, ogrenci/veli gibi alt detaylar).
2. "Bu sube kendi operasyon detayini ayri izlemeli" diyorsaniz.

Ne zaman isaretlenmemeli?
1. Sube sadece genel gider merkezi gibi kullaniliyorsa.
2. Tum detay takip merkezde yapiliyorsa, subede ayri alt detay acilmayacaksa.

Isaretlersem ne olur?
1. Sube kaydinda `Subledger = Yes` olur.
2. Journal satirinda bu sube secildiginde `Subledger Ref` alani zorunlu olur.
3. `Subledger Ref` girilmeden fis kaydi alinmaz (validasyon hatasi verir).
4. Tek basina ekstra hesap, defter veya otomatik fis olusturmaz.

Isaretlemezsem ne olur?
1. Sube kaydinda `Subledger = No` olur.
2. Bu sube secildiginde `Subledger Ref` alani opsiyonel kalir.
3. Kayit acisindan engel olmaz; sube normal calismaya devam eder.

Pratik ornekler:
1. Buyuk kampus subesi: kendi ogrenci/veli alacak takibi var -> `Has subledger = Evet`, satira `Subledger Ref` olarak ogrenci/veli referansi girilir.
2. Sadece idari temsilcilik: sadece merkezden butce aliyor -> `Has subledger = Hayir`, `Subledger Ref` bos birakilabilir.
3. Tum muhasebe merkezde tutuluyor, subeler sadece operasyon noktasi -> genelde `Hayir`.

Amac:
- Ayni `Legal Entity (Bagli Ortak)` icinde sube bazli takip yapmak.

Onemli not:
- Sube kendi basina ayri hesap plani kullanmaz.
- Sube, bagli oldugu `Legal Entity (Bagli Ortak)` defter ve hesap planini kullanir.

Yapilmazsa:
- Sube bazli rapor kirilimlari zayif kalir.

---

<a id="bolum1-adim-4-mali-takvim-kaydet"></a>
### Adim 4 - Mali Takvim Kaydet

Ekran:
- `Ayarlar > Organizasyon Yonetimi > Fiscal Calendars and Periods`

Ne doldurulur:
1. Calendar code
2. Calendar name
3. Start month/day
4. `Save Calendar`

Amac:
- Hangi gunlerde hangi mali donemin gececegini belirlemek.

Yapilmazsa:
- Donem olusmaz.
- Fis post etme ve donem kapama islemleri calismaz.

---

<a id="bolum1-adim-5-donemleri-uret-ve-dogru-filtreyle-listele"></a>
### Adim 5 - Donemleri Uret ve Dogru Filtreyle Listele

Ekran:
- Ayni bolumde `Generate 12 Periods`

Ne yapilir:
1. Takvimi sec.
2. Mali yili gir (ornek: `2026`).
3. `Generate 12 Periods`.
4. Sonra `Reload Periods` bas.

Neden bazen "No periods found" gorunur?
1. Yanlis takvim secili olabilir.
2. Yanlis mali yil filtresi olabilir.
3. Liste yenilenmemis olabilir.

Yapilmazsa:
- Fis kaydinda period secemezsiniz.
- Donem acik/kapali kontrolu dogru calismaz.

---

<a id="bolum1-adim-6-defter-book-olustur"></a>
### Adim 6 - Defter (Book) Olustur

Ekran:
- `Ayarlar > Hesap Plani Ayarlari > Books`

Ne doldurulur:
1. `Legal Entity (Bagli Ortak)`
2. Calendar
3. Book type (`LOCAL` genelde)
4. Book code, book name
5. Base currency

Book ne ise yarar?
- Ayni `Legal Entity (Bagli Ortak)` icinde farkli kayit amaclari icin ayri defter acabilirsiniz.
- En temel kullanim: yerel resmi kayit defteri.

Yapilmazsa:
- Fis acamazsiniz (fis book ister).

---

<a id="bolum1-adim-7-hesap-plani-coa-olustur"></a>
### Adim 7 - Hesap Plani (CoA) Olustur

Ekran:
- `Ayarlar > Hesap Plani Ayarlari > Charts of Accounts`

Ne doldurulur:
1. Scope (`LEGAL_ENTITY` veya `GROUP`)
2. Code, name
3. `Legal Entity (Bagli Ortak)` secimi (LEGAL_ENTITY ise)

Amac:
- Hangi hesap kodlariyla calisacaginizi belirlemek.

Yapilmazsa:
- Hesap olusturamazsiniz.
- Fis satiri hesap secimi bos kalir.

---

<a id="bolum1-adim-8-hesaplari-yukle-turkish-default-coa"></a>
### Adim 8 - Hesaplari Yukle (Turkish Default CoA)

Ekran:
- `Ayarlar > Hesap Plani Ayarlari > Accounts`
- Buton: `Load Turkish Default CoA`

Amac:
- Turk hesap plani iskeletini hizli yuklemek.

Tekrar basarsam ne olur?
1. Ayni kodlu hesaplar guncellenir/korunur.
2. Tum tabloyu sifirlayip bastan silmez.
3. Ozel eklediginiz farkli kodlu hesaplar genelde kalir.

Yapilmazsa:
- Tum hesaplari tek tek acmaniz gerekir.
- Kurulum suresi uzar.

---

<a id="bolum1-adim-9-ortaklar-ve-sermaye-taahhut-kurulumu"></a>
### Adim 9 - Ortaklar ve Sermaye Taahhut Kurulumu

Ekran:
- `Ayarlar > Organizasyon Yonetimi > Shareholders`

Bu adim 3 parcadan olusur:
1. `Parent mapping` (legal entity bazli ust hesap eslesmesi)
2. `Shareholder` (ortak) + ortak bazli alt hesap baglantisi
3. Kuyruktan `tek bir toplu taahhut taslak yevmiyesi` olusturma

<a id="bolum1-sermaye-taahhut-yevmiyesi-icin-setup-required-list-zorunlu-kontrol-listesi"></a>
#### Sermaye taahhut yevmiyesi icin "Setup Required List" (zorunlu kontrol listesi)

Sistem, secili `Legal Entity (Bagli Ortak)` icin su 4 kalemi kontrol eder:
1. En az 1 ortak tanimli mi?
2. Taahhutu olan ortaklar icin borc ve sermaye alt hesaplari tanimli mi?
3. Kullanilabilir equity (sermaye) alt hesap var mi?
4. Mali donemler olusturulmus mu?

Sistem nasil bildirir?
1. `Organizasyon Yonetimi > Shareholders` bolumunde "Setup Required List" kutusunda kalemleri `OK / Eksik` olarak gosterir.
2. Eksik varsa kullaniciyi dogrudan yonlendirir:
   - `Go to shareholder form`
   - `Open GL setup`
3. `Acilis Fisi Olustur` ekraninda da ayni kontrol listesi gosterilir (sermaye taahhut fisine yonelik uyarili panel).

<a id="bolum1-sermaye-taahhudu-nasil-calisir"></a>
#### Sermaye taahhudu nasil calisir?

Sistem mantigi:
1. Ortak bazli iki alt hesap birlikte calisir:
   - `Commitment debit sub-account` (tipik `501.xx`, DEBIT/EQUITY)
   - `Capital sub-account` (tipik `500.xx`, CREDIT/EQUITY)
2. Kayitta girilen taahhut mantigi `artis` uzerindendir:
   - formdaki artis tutari mevcut toplam taahhude eklenir
3. Toplu fis onizlemesinde sistem her ortak icin `delta` hesaplar:
   - `delta = committed_capital - already_journaled_amount`
4. Sadece `delta > 0` olan ortaklar toplu taahhut fisine dahil edilir.
5. Olusan taslak yevmiyede her ortak icin 2 satir vardir:
   - Borc: `commitment debit sub-account`
   - Alacak: `capital sub-account`
6. Fisleme kaydi audit tablosuna yazilir; ayni tutarin tekrar fislenmesi engellenir.
7. Journal post edilirken sistem, uygun satir kombinasyonlarini tespit ederse ortak taahhut toplamini ve sahiplik yuzdesini (ownership %) tekrar senkronize eder.

<a id="bolum1-uctan-uca-adimlar-onerilen-is-akis"></a>
#### Uctan uca adimlar (onerilen is akis)

1. `Shareholder parent account mapping` formunda:
   - `Capital credit parent` (tipik `500`)
   - `Commitment debit parent` (tipik `501`)
   secilip `Save Parent Mapping` yapilir.
2. Ortak formunda su alanlar doldurulur:
   - code, name, shareholder type, commitment date
   - commitment debit sub-account
   - capital sub-account
   - taahhut artisi (bu kayit)
3. `Save Shareholder` ile kayit alin.
4. Artis > 0 ise ortak otomatik olarak `Toplu taahhut yevmiye kuyrugu`na eklenir.
5. Gerekirse `Sermaye taahhut arttirimi` modali ile mevcut ortak icin ek artis girip `Kaydet ve kuyruga ekle` yapin.
6. Kuyruktan `Tek bir toplu taahhut yevmiyesi olustur` aksiyonunu acin.
7. Onizlemede kontrol edin:
   - Blocking validation errors
   - Included rows / Skipped rows
   - Toplam borc / toplam alacak / para birimi
8. `Create batch journal` ile tek bir taslak yevmiye olusturun.
9. Journal Workbench uzerinden taslagi gozden gecirip post edin.
10. Post sonrasi kontrol:
   - ilgili ortagin committed capital/ownership degerleri
   - olusan journal no, book ve fiscal period bilgileri

Yapilmazsa:
1. Taahhut akisinda manuel is yukunuz artar.
2. Delta takibi zorlasir ve ayni tutarin tekrar fislenme riski artar.
3. Kaydetme aninda sistem su tip hata/uyariyi verir:
   - "commitmentDebitSubAccountId is required..."
   - "capitalSubAccountId is required..."

---

<a id="bolum1-adim-10-ilk-test-fisini-olustur"></a>
### Adim 10 - Ilk Test Fisini Olustur

Ekran:
- `Yevmiye Kayitlari > Mahsup Islemleri` (Journal Workbench)

Asgari gerekli alanlar:
1. `Legal Entity (Bagli Ortak)`
2. Book
3. Fiscal period
4. Currency
5. En az 2 satir
6. Borc ve alacak esitligi
7. Eger satirdaki birimde `Has subledger = Evet` ise `Subledger Ref` alani

Amac:
- Sistemin temel muhasebe omurgasini dogrulamak.

Yapilmazsa:
- Sonraki intercompany veya konsolidasyon adiminda kok neden bulmak zorlasir.

---

<a id="bolum1-adim-11-intercompany-ciftlerini-pair-dogru-hazirla"></a>
### Adim 11 - Intercompany Ciftlerini (Pair) Dogru Hazirla

Intercompany duzende cift yon gerekir:
1. Kaynak -> Partner aktif pair
2. Partner -> Kaynak aktif pair

Neden iki yon?
- Kaynaktan partnera kayit var.
- Otomatik mirror olustururken partner tarafin da kurallari gerekir.

Yapilmazsa:
- INTERCOMPANY fis kaydinda "pair mapping" hatasi alirsiniz.
- Otomatik mirror akisi calismaz.

Not:
- Journal Workbench icindeki compliance alani, eksik pair icin hizli duzeltme aksiyonu sunar.

---

<a id="bolum1-adim-12-intercompany-fisini-otomatik-partner-mirror-ile-calistir"></a>
### Adim 12 - Intercompany Fisini Otomatik Partner Mirror Ile Calistir

Ekran:
- Journal Workbench > Create Draft Journal

Ne secilir:
1. `SourceType = INTERCOMPANY`
2. `Auto-create partner mirror draft journal(s)` kutusunu acik birak
3. Satirlarda `Counterparty LE` doldur

Onemli kural:
- Otomatik mirror modunda tum satirlarda karsi taraf secimi olmali.

Sistem ne yapar?
1. Kaynak `Legal Entity (Bagli Ortak)` uzerinde taslak fis olusturur.
2. Partner `Legal Entity (Bagli Ortak)` uzerinde bagli mirror taslak fis(ler) olusturur.
3. Ekranda mirror fis IDlerini gosterir.

Yapilmazsa:
- Partner kaydi elle acmak zorunda kalirsiniz.
- Zaman kaybi ve hata riski artar.

Gercek hayat ornegi:
- A sirketi B sirketine 100 birim hizmet faturaladi.
- A'da alacak ve gelir fis satirlari girilir.
- Sistem B'de buna karsi gider + borc mirror taslagi acabilir.

---

<a id="bolum1-adim-13-post-asamasinda-bagli-mirrorlari-birlikte-post-et"></a>
### Adim 13 - Post Asamasinda Bagli Mirrorlari Birlikte Post Et

Ekran:
- Journal Workbench > Post Journal

Ne yapilir:
1. Source fis ID gir.
2. `Post linked intercompany mirrors` kutusunu isaretle.
3. `Post` bas.

Sistem ne yapar?
1. Kaynak fis + bagli mirror taslaklari birlikte post etmeyi dener.
2. Her fisin donemi acik mi kontrol eder.
3. Birlikte post sonucu mesajda listelenir.

Yapilmazsa:
- Kaynak post olur, partner mirror taslakta kalabilir.
- Mutabakatta gecici fark gorebilirsiniz.

---

<a id="bolum1-adim-14-intercompany-uyumluluk-kontrolu-compliance"></a>
### Adim 14 - Intercompany Uyumluluk Kontrolu (Compliance)

Ekran:
- Journal Workbench icindeki `Intercompany Compliance` bolumu

Ne ise yarar?
- Politika ihlallerini toplu gosterir:
1. Intercompany kapali entityde karsi tarafli satir
2. Partner zorunlu oldugu halde eksik karsi taraf
3. Eksik aktif pair

Ekrandaki duzeltme aksiyonlari:
1. Entity icin intercompany ac
2. Partner required kuralini kapat
3. Eksik active pair olustur

Yapilmazsa:
- Ay sonu mutabakatta cok sayida elle duzeltme gerekir.

---

<a id="bolum1-adim-15-intercompany-mutabakat-raporunu-calistir"></a>
### Adim 15 - Intercompany Mutabakat Raporunu Calistir

Ekran:
- `Donem Sonu Islemler > Aylik > Intercompany Mutabakat`

Ne secilir:
1. Calendar
2. Fiscal period
3. Gerekirse from/to `Legal Entity (Bagli Ortak)` filtreleri
4. Tolerance

Amac:
- Iki `Legal Entity (Bagli Ortak)` kaydinin birbirini ayni tutarda gorup gormedigini kontrol etmek.

Yapilmazsa:
- Konsolidasyon oncesi farklar yakalanmaz.
- Raporlara yanlis bakiye tasinir.

---

<a id="bolum1-adim-16-konsolidasyon-kurulumu-ve-raporlari"></a>
### Adim 16 - Konsolidasyon Kurulumu ve Raporlari

Kurulum ekrani:
- `Ayarlar > Konsolidasyon Kurulumu`

Rapor ekrani:
- `Donem Sonu Islemler > Yillik > Konsolidasyon Raporlari`

Asgari gerekli kurulum:
1. Consolidation group
2. Group memberlar (`Legal Entity (Bagli Ortak)` ekleme)
3. Gerekirse CoA mapping
4. Run olusturma ve calistirma

Yapilmazsa:
- Bilanco ve gelir tablosu konsolide alinmaz.
- Grup resmi raporlama eksik kalir.

---

<a id="bolum1-adim-17-hesap-yeniden-siniflandirma-bakiye-dagitimi-islem-bazli"></a>
### Adim 17 - Hesap Yeniden Siniflandirma (Bakiye Dagitimi / Islem Bazli)

Ekran:
- `Ayarlar > Hesap Yeniden Siniflandirma`
- URL: `/app/ayarlar/hesap-yeniden-siniflandirma`

Bu ekran 2 akis sunar:
1. `Bakiye Dagitimi Olustur` (hesap bakiyesini alt hesaplara dagitma)
2. `Islem Bazli Yeniden Siniflandirma` (tek tek fis satiri esleme)

<a id="bolum1-a-bakiye-dagitimi-olustur"></a>
#### A) Bakiye Dagitimi Olustur

Ne doldurulur?
1. `Legal Entity (Bagli Ortak)` secin.
2. `Book` secin.
3. `Fiscal period` secin.
4. `Source account (direct != 0)` secin.
5. Dagitim tipini secin:
   - `Yuzdeye gore (PERCENT)`
   - `Tutara gore (AMOUNT)`
6. En az 1 `Hedef hesap` satiri ekleyin.
7. Dagitim degerlerini girin:
   - PERCENT modunda toplam yuzde = `100` olmali.
   - AMOUNT modunda toplam tutar = `Dagitilacak tutar` olmali.
8. `Entry date`, `Document date`, `Currency` alanlarini kontrol edin.
9. Gerekirse `Aciklama`, `Referans no`, `Run notu` girin.
10. `Yeniden siniflandirma taslagi olustur` butonuna basin.

Sistem ne yapar?
1. Kaynak bakiyeyi tersleyip hedef hesaplara dagitan tek bir taslak yevmiye olusturur.
2. Islemi `Son Yeniden Siniflandirma Runlari` listesine kaydeder.
3. Olusan `Journal No / Journal Id` bilgisini listede gosterir.

<a id="bolum1-b-islem-bazli-yeniden-siniflandirma"></a>
#### B) Islem Bazli Yeniden Siniflandirma

Ne doldurulur?
1. Ust kisimda yine `Legal Entity`, `Book`, `Fiscal period`, `Source account` secili olmali.
2. Gerekirse `dateFrom`, `dateTo`, `limit` filtrelerini girin.
3. `Kaynak satirlari yukle` butonuna basin.
4. Yeniden siniflandirilacak satirlari secin.
5. Her secili satir icin bir `Hedef hesap` secin.
6. `Secili satir` ve `Eslenen` sayisi esit oldugunda
   `Islem bazli yeniden siniflandirma taslagi olustur` butonuna basin.

Sistem ne yapar?
1. Secilen her kaynak satiri tersleyip secilen hedef hesapta yeni satirlar olusturur.
2. Taslak yevmiye olusturur ve run kaydina ekler.

Kontrol listesi:
1. `Son Yeniden Siniflandirma Runlari` alaninda yeni kayit gorunuyor mu?
2. `Journal Workbench` ekraninda ilgili taslak fis aciliyor mu?
3. Gerekli inceleme sonrasi fis post edildi mi?

Yapilmazsa:
1. Hesaplar arasi bakiye dagitimi manuel fisle yapilir.
2. Manuel dagitimda hata ve atlanan satir riski artar.

---

<a id="bolum1-5-en-cok-karsilasilan-durumlar-ve-cozumler"></a>
### 5) En Cok Karsilasilan Durumlar ve Cozumler

Durum:
- `No periods found for selected filters`

Cozum:
1. Takvim dogru mu kontrol et.
2. Mali yil dogru mu kontrol et.
3. `Reload Periods` bas.

Durum:
- `Intercompany disabled` hatasi

Cozum:
1. `Legal Entity (Bagli Ortak)` kaydinda `Intercompany enabled` acik olmali.
2. Kapaliysa policy geregi engellenir.

Durum:
- `Partner required` hatasi

Cozum:
1. SourceType `INTERCOMPANY` ise tum satirlarda Counterparty LE doldur.

Durum:
- `subledgerReferenceNo is required` hatasi

Cozum:
1. Satirda secilen birim `Has subledger = Evet` ise `Subledger Ref` girin.
2. `Subledger Ref` girip birim secmediyseniz once birim secin.

Durum:
- `commitmentDebitSubAccountId is required when committedCapital is greater than 0` hatasi

Cozum:
1. `Organizasyon Yonetimi > Shareholders` ekraninda ortak kartinda `Commitment debit sub-account` secin.
2. Bu hesap equity tipinde, aktif ve post edilebilir bir alt hesap olmali (tipik TR: `501.xx`).
3. Ortak kaydini tekrar kaydedin.

Durum:
- `capitalSubAccountId is required when committedCapital is greater than 0` hatasi

Cozum:
1. Ortak kartinda `Committed capital` 0'dan buyukse `Capital sub-account` secin.
2. Bu hesap equity tipinde, aktif ve post edilebilir bir alt hesap olmali.

Durum:
- Sermaye taahhut akisi icin ekranda "Setup Required List" eksik gorunuyor

Cozum:
1. Ortak tanimi, ortak bazli borc/sermaye alt hesaplari, equity alt hesap ve mali donem kalemlerini tamamlayin.
2. Ekrandaki yonlendirme butonlariyla ilgili setup ekranina gecin.

Durum:
- `Queued shareholders contain mixed currencies` (toplu taahhut onizlemede)

Cozum:
1. Toplu taahhut fisini para birimine gore ayri ayri olusturun.
2. Ayni batch icine farkli currency kodlu ortaklari birlikte koymayin.

Durum:
- `No OPEN book/fiscal period found for legalEntityId` veya `commitmentDate must be within an OPEN fiscal period`

Cozum:
1. Secili legal entity icin acik donem oldugunu kontrol edin.
2. `Taahhut tarihi`ni acik mali donem araligina alin.

Durum:
- `No shareholder has a positive journalizable commitment delta` (toplu taahhut onizlemede)

Cozum:
1. Delta mantigini kontrol edin: `committed_capital - already_journaled_amount`.
2. Delta 0 veya negatifse ortak batchte atlanir; yeni artis tutari girin veya ilgili ortaklari kuyruktan cikarip tekrar deneyin.

Durum:
- `Active pair mapping required` hatasi

Cozum:
1. Kaynak -> partner active pair olustur.
2. Otomatik mirror istiyorsan partner -> kaynak yonunu de active yap.

Durum:
- `Journal is not balanced`

Cozum:
1. Toplam borc = toplam alacak olmali.
2. Satirlari tekrar kontrol et.

Durum:
- Intercompany fis olustu ama partnerda post olmadi

Cozum:
1. Post ekraninda `Post linked intercompany mirrors` kutusunu isaretleyerek post et.

Durum:
- `Incorrect arguments to mysqld_stmt_execute` hatasi (Hesap Yeniden Siniflandirma sayfasinda run listesi/satir yukleme asamasinda)

Cozum:
1. Backend guncel kodla calisiyor mu kontrol edin (reclassification sorgularinda `LIMIT ?` yerine dogrudan sayisal limit kullanilmali).
2. Backend servisini yeniden baslatin.
3. Sayfayi yenileyip islemi tekrar deneyin.

---

<a id="bolum1-6-gunluk-pratik-is-akisi-muhasebe-ekibi-icin"></a>
### 6) Gunluk Pratik Is Akisi (Muhasebe Ekibi Icin)

Her gun:
1. Yeni fisleri taslak olustur.
2. Intercompany olanlarda counterparty alanini mutlaka doldur.
3. Gerekli kontrollerden sonra post et.

Haftalik:
1. Intercompany compliance bolumunu ac.
2. Cikan sorunlari aninda duzelt.

Aylik kapanis oncesi:
1. Intercompany mutabakat raporunu calistir.
2. Fark varsa once kaynagini duzelt.
3. Sonra konsolidasyon raporlarini al.

---

<a id="bolum1-7-roller-ve-yetki-neden-bazen-buton-gorunmuyor"></a>
### 7) Roller ve Yetki (Neden Bazen Buton Gorunmuyor?)

Bazi ekranlar yetkiye baglidir.

Ornek:
1. Sayfayi gorebiliyorsunuz ama `Save` calismiyor.
2. Sol menude ilgili modulu hic goremiyorsunuz.

Bu durumda sorun genelde veri degil, yetkidir.
Sistem yoneticisinden rol/yetki atamasi isteyin.

---

<a id="bolum1-8-kisa-karar-rehberi"></a>
### 8) Kisa Karar Rehberi

Soru:
- "Hizli kurulum mu manuel kurulum mu?"

Cevap:
1. Hedef hizli baslangic ise: Sirket Ayarlari (bootstrap)
2. Hedef kontrollu ve denetlenebilir kurulum ise: Manuel yol (bu kilavuz)

Soru:
- "Intercompanyde otomatik partner fis acmali miyim?"

Cevap:
1. Evet, operasyonel olarak daha saglikli.
2. Ama post asamasinda birlikte post etmeyi unutma.

---

<a id="bolum1-9-ozet"></a>
### 9) Ozet

Bu kilavuza gore kurulum yapildiginda:
1. Organizasyon yapiniz temiz kurulur.
2. Defter ve hesap plani stabil calisir.
3. Intercompany kontrolleri ve otomatik mirror akisiniz devreye girer.
4. Mutabakat ve konsolidasyon raporlarinda hata riski ciddi azalir.

Isterseniz bir sonraki adimda bu dokumani:
1. Ekran goruntulu PDF formatina
2. "Yeni baslayan personel egitim notu" formatina
donusturebilirim.

---

<a id="bolum2-baslangic"></a>
## Bolum 2 - RBAC ve Kullanici Yetkilendirme

> Kaynak dosya: `KULLANIM_KILAVUZU_BOLUM2_RBAC.md`

---

<a id="bolum2-saap-kullanim-kilavuzu-bolum-2-rbac-ve-kullanici-yetkilendirme"></a>
## SaaP Kullanim Kilavuzu - Bolum 2 (RBAC ve Kullanici Yetkilendirme)

Bu dokuman, uygulamada "kim neyi yapabilir" konusunu netlestirmek icin hazirlandi.
Odak: kullanici olusturma, rol atama, scope yonetimi, test ve dogrulama.

---

<a id="bolum2-1-temel-kavramlar-karisan-noktalar"></a>
### 1) Temel Kavramlar (Karisan Noktalar)

1. `Tenant`:
   - Bir veri siniri / sirket alani.
   - Rol degildir.

2. `TenantAdmin`:
   - Tenant icindeki bir roldur.
   - "Yeni tenant olusturma" yetkisi degildir.

3. `Provider Admin`:
   - `/provider/login` uzerinden platform seviyesinde calisir.
   - Yeni tenant olusturabilen tek taraftir.

4. `Role`:
   - Yetki paketi (permission seti).

5. `Permission`:
   - Tekil islem izni (ornek: `gl.journal.post`).

6. `Scope`:
   - Yetkinin hangi sinirda gecerli oldugu:
   - `TENANT`, `GROUP`, `COUNTRY`, `LEGAL_ENTITY`, `OPERATING_UNIT`

7. `Data Scope`:
   - Kullanici veri gorunurlugunu ayrica kisitlar.
   - Varsa, pratikte permission scope uzerine ekstra sinir koyar.

---

<a id="bolum2-2-rbac-ekranlari-ve-ne-ise-yarar"></a>
### 2) RBAC Ekranlari ve Ne Ise Yarar

1. `Ayarlar > Roller ve Yetkiler`
   - Rol olusturur.
   - Role permission matrisi baglar.

2. `Ayarlar > Kullanici Rol Atamalari`
   - Yeni kullanici olusturur.
   - Kullaniciya rol + scope + effect (`ALLOW`/`DENY`) atar.

3. `Ayarlar > Scope Atamalari`
   - Kullanici `data scope` kayitlarini yonetir.
   - Mevcut rol atamasinin scope'unu degistirir.

4. `Ayarlar > RBAC Denetim Loglari`
   - Rol/atama/scope degisikliklerini geriye donuk izler.

---

<a id="bolum2-3-on-kosullar"></a>
### 3) On Kosullar

1. Tenant kurulumunun tamam olmasi gerekir (readiness).
2. Sistemde en az bir `TenantAdmin` kullanici olmasi gerekir.
3. RBAC ekranlarina girecek kullanicida ilgili security permissionlari olmali.

---

<a id="bolum2-4-sifirdan-rbac-kurulum-akisi"></a>
### 4) Sifirdan RBAC Kurulum Akisi

<a id="bolum2-adim-1-rol-tasarimini-belirle"></a>
### Adim 1 - Rol Tasarimini Belirle

Ornek is rolleri:
1. Grup kontroloru
2. Entity muhasebecisi
3. Sube operatoru
4. Sadece okuma (auditor)

Her rol icin suyu yazin:
1. Hangi modulleri acabilir?
2. Hangi islemleri yapabilir? (create/post/upsert vb.)
3. Hangi scope seviyesinde calisacak?

---

<a id="bolum2-adim-2-rol-olustur"></a>
### Adim 2 - Rol Olustur

Ekran:
1. `Ayarlar > Roller ve Yetkiler`

Islem:
1. `Role code` gir (ornek: `EntityMuhasebeTR`)
2. `Role name` gir
3. `Rolu Kaydet`

Not:
1. Seed ile gelen sistem rolleri vardir (`TenantAdmin`, `GroupController`, vb.).
2. Operasyonel kullanim icin yeni custom rol olusturmak genelde daha guvenlidir.

---

<a id="bolum2-adim-3-role-permission-bagla"></a>
### Adim 3 - Role Permission Bagla

Ayni ekranda:
1. Sol listeden rolu sec.
2. Permission checkbox'larini sec.
3. `Yetkileri Degistir` ile kaydet.

Ornek (entity muhasebe):
1. `org.tree.read`
2. `org.fiscal_period.read`
3. `gl.book.read`
4. `gl.account.read`
5. `gl.journal.read`
6. `gl.journal.create`
7. `gl.journal.post`

---

<a id="bolum2-adim-4-kullanici-olustur"></a>
### Adim 4 - Kullanici Olustur

Ekran:
1. `Ayarlar > Kullanici Rol Atamalari`

`Yeni Kullanici` bolumunde:
1. Ad Soyad
2. E-posta
3. Sifre (min 8)
4. Durum (`ACTIVE`/`DISABLED`)
5. `Kullaniciyi Olustur`

Beklenen sonuc:
1. Kullanici olusur.
2. Kullanici dropdown listesine gelir.

---

<a id="bolum2-adim-5-kullaniciya-rol-scope-ata"></a>
### Adim 5 - Kullaniciya Rol + Scope Ata

Ayni sayfada:
1. Kullanici sec
2. Rol sec
3. `ScopeType` sec (`GROUP`, `LEGAL_ENTITY`, vb.)
4. `Scope` sec (`id` bazli)
5. `Effect` sec (`ALLOW` veya `DENY`)
6. `Ata`

Ornek:
1. Kullanici: `ayse.entity@example.com`
2. Rol: `EntityMuhasebeTR`
3. ScopeType: `LEGAL_ENTITY`
4. Scope: `LE-TR-001`
5. Effect: `ALLOW`

Sonuc:
1. Kullanici bu entity icinde calisir.
2. Diger entitylerde yetkili olmaz.

---

<a id="bolum2-adim-6-gerekirse-data-scope-ile-daralt"></a>
### Adim 6 - Gerekirse Data Scope Ile Daralt

Ekran:
1. `Ayarlar > Scope Atamalari`

Islem:
1. Kullanici sec
2. `Veri Scope'lari`na yeni satir ekle
3. `Kullanici Veri Scope'larini Guncelle`

Ne zaman gerekli?
1. Kullanici rolu genis ama veri gorunurlugunu daha dar tutmak istiyorsaniz.
2. Ozel denetim / segmentasyon ihtiyaci varsa.

---

<a id="bolum2-adim-7-denetim-ve-dogrulama"></a>
### Adim 7 - Denetim ve Dogrulama

Ekran:
1. `Ayarlar > RBAC Denetim Loglari`

Kontrol edin:
1. `role.permission.replace`
2. `assignment.create`
3. `assignment.scope_replace`
4. `user.create`

---

<a id="bolum2-5-sistem-rol-kurali-kritik"></a>
### 5) Sistem Rol Kurali (Kritik)

`TenantAdmin` gibi sistem rolleri icin:
1. Atama/degistirme/silme islemlerini sadece tenant-level `TenantAdmin` yapabilir.
2. Sistem rolu olmayan custom rollerde normal atama akisiniz devam eder.

Bu, "yanlislikla herkes TenantAdmin olmasin" diye uygulanir.

---

<a id="bolum2-6-ornek-senaryolar"></a>
### 6) Ornek Senaryolar

<a id="bolum2-senaryo-a-group-bazli-kullanici"></a>
### Senaryo A - Group bazli kullanici

1. Rol: `GroupController` veya custom grup rolu
2. Scope: `GROUP = G1`
3. Beklenen:
   - G1 altindaki entity/sube verisini gorur.
   - G2 altinda islem yapamaz.

<a id="bolum2-senaryo-b-entity-bazli-muhasebeci"></a>
### Senaryo B - Entity bazli muhasebeci

1. Rol: `EntityAccountant` veya custom
2. Scope: `LEGAL_ENTITY = LE1`
3. Beklenen:
   - LE1 icin fis olusturur/post eder.
   - LE2 icin 403 veya bos liste alir.

<a id="bolum2-senaryo-c-subede-operator"></a>
### Senaryo C - Subede operator

1. Rol: `BranchOperator`
2. Scope: `OPERATING_UNIT = OU1`
3. Beklenen:
   - OU1 odakli islemleri yapar.
   - Diger sube/entity tarafinda yetki yoktur.

---

<a id="bolum2-7-10-dakikalik-smoke-test-listesi"></a>
### 7) 10 Dakikalik Smoke Test Listesi

1. TenantAdmin ile giris yap.
2. Yeni rol olustur (`SmokeRole`).
3. Role 2-3 permission ekle.
4. Yeni kullanici olustur.
5. Kullaniciya rol + `LEGAL_ENTITY` scope ata.
6. Yeni kullanici ile giris yap.
7. Scope disi bir kayit acmayi dene (beklenen: engel/403).
8. Scope ici bir kayit acmayi dene (beklenen: basarili).
9. RBAC loglarda degisiklik kayitlarini dogrula.

---

<a id="bolum2-8-sik-sorulan-sorular"></a>
### 8) Sik Sorulan Sorular

1. `TenantAdmin` yeni tenant olusturabilir mi?
   - Hayir. Yeni tenant sadece Provider tarafindan olusturulur.

2. Tenant kullanicisi baska tenantin kullanicisini yonetebilir mi?
   - Hayir. Tum islemler kendi tenant sinirinda calisir.

3. Kullanici sayfayi goruyor ama kaydetme yapamiyor, neden?
   - Sayfaya giris permissioni var, islem permissioni eksik olabilir.
   - Scope disinda kaliyor olabilir.

4. `ALLOW` ve `DENY` birlikte kullanilir mi?
   - Evet, ama operasyonel olarak sade politika tavsiye edilir.
   - Once minimum `ALLOW` ile baslayin, gerekli yerde `DENY` ekleyin.

---

<a id="bolum2-9-operasyonel-tavsiyeler"></a>
### 9) Operasyonel Tavsiyeler

1. Her tenantta en fazla 1-2 kisi `TenantAdmin` olsun.
2. Gunluk kullanicilar icin custom roller acin.
3. Atamalari her zaman scope ile sinirlayin.
4. Periyodik olarak RBAC denetim loglarini kontrol edin.
5. "Tam yetki ver sonra kisitlariz" yerine "minimum yetkiyle basla" modelini kullanin.


---

<a id="bolum3-baslangic"></a>
## Bolum 3 - Kasa Modulu Operasyon Rehberi

> Kaynak dosya: `KULLANIM_KILAVUZU_KASA_MODULU.md`

---

﻿# KULLANIM_KILAVUZU_KASA_MODULU.md

<a id="bolum3-saap-kasa-modulu-kullanm-kilavuzu-teknik-olmayan-kullanicilar-icin"></a>
### SAAP Kasa Modulu Kullanım Kilavuzu (Teknik Olmayan Kullanicilar Icin)

Surum: v1  
Tarih: 2026-02-22  
Kapsam: `/app/kasa-tanimlari`, `/app/kasa-oturumlari`, `/app/tediye-islemleri`, `/app/tahsilat-islemleri`, `/app/kasa-islemleri`, `/app/kasa-istisnalari`

Bu kilavuz, kod bilmeyen operasyon, muhasebe, finans ve denetim ekipleri icin yazildi.  
Amac: "Hangi ekranda ne yapmaliyim, secersem/secmesem ne olur, hatada ne yapmaliyim" sorularina net cevap vermek.

---

<a id="bolum3-1-bu-modul-neyi-cozer"></a>
### 1. Bu modul neyi cozer?

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

<a id="bolum3-2-temel-kavramlar-teknik-olmayan-dille"></a>
### 2. Temel kavramlar (teknik olmayan dille)

- **Kasa Register**: Fiziksel/operasyonel para noktasi. (Ornek: Magaza kasa cekmecesi, sube kasasi, merkez kasa)
- **Oturum (Session)**: Kasa acilis-kapanis periyodu. (Ornek: 08:00 acildi, 18:00 kapandi)
- **Islem (Transaction)**: Tek bir para hareketi. (Tahsilat, odeme, bankaya yatirma vb.)
- **Post etmek**: Islemi resmi muhasebe kaydina cevirme.
- **Iptal (Cancel)**: Henuz post edilmemis islemi gecersiz kilma.
- **Ters kayit (Reverse)**: Post edilmis islemi geri alan yeni ve bagli bir kayit uretme.
- **Varyans (Fark)**: Kasada beklenen para ile sayilan para arasindaki fark.
- **Override**: Normalde engellenen bir post islemini, ozel yetki + zorunlu gerekce ile yapma.
- **Istisna**: Riskli/inceleme gerektiren olay. (Yuksek fark, forced close, unposted islem vb.)

<a id="bolum3-21-kasayi-acmakkapatmak-tam-olarak-ne-demek"></a>
#### 2.1 "Kasayi acmak/kapatmak" tam olarak ne demek?

- **Kasayi acmak (oturum acmak)**:
  - Sistem kaydi olarak "bu register su anda su kisi sorumlulugunda kullanima basladi" demektir.
  - Genelde fiziksel teslim/tesellum (kasa devri) sonrasi yapilir.
- **Kasayi kapatmak (oturum kapatmak)**:
  - Sistem kaydi olarak "bu register icin operasyon bitti, sayim yapildi, fark hesaplandi" demektir.
  - Fiziksel kilit kapatma operasyonu sirket prosedurudur; sistem bunun muhasebe/denetim kaydini tutar.

Ozet:
- Bu moduldaki acma/kapama, **fiziksel anahtar hareketinden cok operasyonel sorumluluk kaydi**dir.

---

<a id="bolum3-3-menude-nereye-girilir"></a>
### 3. Menude nereye girilir?

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

<a id="bolum3-4-yetki-modeli-kim-ne-yapabilir"></a>
### 4. Yetki modeli (kim ne yapabilir?)

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

<a id="bolum3-5-kasa-kontrol-modu-banneri-off-warn-enforce"></a>
### 5. Kasa kontrol modu banner'i (OFF / WARN / ENFORCE)

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

<a id="bolum3-6-isletmeye-almadan-once-kontrol-listesi"></a>
### 6. Isletmeye almadan once kontrol listesi

1. Kasa registerlari tanimli mi?
2. Her register uygun GL (Defteri Kebir) hesaba bagli mi?
3. Register para birimi dogru mu?
4. Session mode dogru mu? (`REQUIRED/OPTIONAL/NONE`)
5. Varyans kazanc/kayip hesaplari tanimli mi?
6. Ekipte yetki dagilimi net mi?
7. Kasa kontrol modu beklendigi gibi mi? (WARN ya da ENFORCE)

---

<a id="bolum3-7-kasa-tanimlari-ekrani-adim-adim"></a>
### 7. Kasa Tanimlari ekrani (adim adim)

Ekran: `/app/kasa-tanimlari`

<a id="bolum3-71-ne-yaparsiniz"></a>
#### 7.1 Ne yaparsiniz?
- Yeni kasa tanimi acarsiniz
- Var olani guncellersiniz
- Aktif/Pasif durumunu degistirirsiniz

<a id="bolum3-72-alanlar-ve-secim-etkileri"></a>
#### 7.2 Alanlar ve secim etkileri

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

<a id="bolum3-73-secersen-secmezsen-ne-olur"></a>
#### 7.3 Secersen / secmezsen ne olur?

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

<a id="bolum3-8-kasa-oturumlari-ekrani"></a>
### 8. Kasa Oturumlari ekrani

Ekran: `/app/kasa-oturumlari`

<a id="bolum3-81-oturum-acma"></a>
#### 8.1 Oturum acma

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

<a id="bolum3-82-oturum-kapama"></a>
#### 8.2 Oturum kapama

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

<a id="bolum3-83-beklenen-sayilan-fark"></a>
#### 8.3 Beklenen / Sayilan / Fark

- **Opening**: Oturum acilis tutari
- **Expected**: Beklenen kapanis (genelde kapanista kesinlesir)
- **Counted**: Fiziki sayilan tutar
- **Variance**: Counted - Expected

Not:
- Sistemde `expected_closing_amount` kapanista session satirina guvenilir sekilde yazilir.
- Acik oturumda canli expected her zaman ayrica endpoint ile gelmeyebilir.

<a id="bolum3-84-varyans-olursa-ne-olur"></a>
#### 8.4 Varyans olursa ne olur?

- Sayilan < Beklenen: "short" (eksik)
- Sayilan > Beklenen: "over" (fazla)
- Sistem, uygun hesaplara varyans kaydi uretebilir/post eder

Ornek:
- Beklenen 10.000, sayilan 9.940 -> -60 fark
- Esik 50 ise bu fark esik ustu olabilir -> onay + not istenir

---

<a id="bolum3-9-kasa-islemleri-tahsilat-tediye"></a>
### 9. Kasa Islemleri / Tahsilat / Tediye

Ekranlar:
- `/app/tahsilat-islemleri` -> RECEIPT sabit
- `/app/tediye-islemleri` -> PAYOUT sabit
- `/app/kasa-islemleri` -> tum tipler

<a id="bolum3-91-islem-olusturma-create"></a>
#### 9.1 Islem olusturma (Create)

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

<a id="bolum3-92-islem-tipi-bazli-zorunluluklar"></a>
#### 9.2 Islem tipi bazli zorunluluklar

- `TRANSFER_IN` / `TRANSFER_OUT`:
  - `counterCashRegisterId` zorunlu

- `DEPOSIT_TO_BANK` / `WITHDRAWAL_FROM_BANK`:
  - `counterAccountId` zorunlu

- `VARIANCE`:
  - Manuel olusturulamaz (sistem olusturur)

<a id="bolum3-93-durum-akisi-state-machine"></a>
#### 9.3 Durum akisi (state machine)

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

<a id="bolum3-94-post-ederken-override"></a>
#### 9.4 Post ederken override

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

<a id="bolum3-10-kasa-istisnalari-ekrani-denetim-paneli"></a>
### 10. Kasa Istisnalari ekrani (denetim paneli)

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

<a id="bolum3-11-secim-rehberi-hizli-karar-tablosu"></a>
### 11. "Secim" rehberi (hizli karar tablosu)

<a id="bolum3-111-session-mode-secimi"></a>
#### 11.1 Session mode secimi

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

<a id="bolum3-112-kapanis-nedeni-secimi"></a>
#### 11.2 Kapanis nedeni secimi

- `END_SHIFT`: normal vardiya kapanisi
- `FORCED_CLOSE`: elektrik kesintisi, sistem arizasi, acil durum
  - closeNote zorunlu
- `COUNT_CORRECTION`: sayim tekrar duzeltmesi

<a id="bolum3-113-approvevariance-secimi"></a>
#### 11.3 approveVariance secimi

- Isaretlemezsen:
  - Esik ustu farkta kapama reddedilebilir
- Isaretlersen:
  - Yetkin varsa kapama ilerler
  - Denetimde "onayli varyans" izi kalir

<a id="bolum3-114-allownegative-secimi"></a>
#### 11.4 allowNegative secimi

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

<a id="bolum3-12-gercek-hayat-senaryolari"></a>
### 12. Gercek hayat senaryolari

<a id="bolum3-senaryo-a-magaza-gunluk-akisi-ideal"></a>
#### Senaryo A - Magaza gunluk akisi (ideal)

1. Kasiyer sabah oturum acar (opening 1.000)
2. Gun boyu tahsilat/tediye girer
3. Supervisor gun sonu sayim alir
4. Sayilan ve beklenen uyusur
5. Oturum `END_SHIFT` ile kapanir
6. Istisna ekraninda sorun gorulmez

<a id="bolum3-senaryo-b-varyansli-kapanis"></a>
#### Senaryo B - Varyansli kapanis

1. Beklenen 20.000, sayilan 19.930
2. Esik 50 ise fark 70 -> esik ustu
3. closeNote yazilir
4. approveVariance + yetkili kullanici ile kapanir
5. Sistem varyans kaydini olusturur ve kayit izi birakir

<a id="bolum3-senaryo-c-cift-tiklama-internet-kopmasi"></a>
#### Senaryo C - Cift tiklama / internet kopmasi

1. Kullanici "Olustur" butonuna iki kere basar
2. Sistem ayni idempotency anahtariyla ikinciyi tekrar kaydetmez
3. Ekranda "Bu istek daha once islenmis" bilgisi gorunur
4. Muhasebede duplicate olusmaz

<a id="bolum3-senaryo-d-yanlis-post-edildi"></a>
#### Senaryo D - Yanlis post edildi

1. Islem POSTED oldugu icin duzenlenemez/silinemez
2. Reverse yapilir (gerekce zorunlu)
3. Gerekirse dogru islem yeni kayit olarak girilir
4. Denetimde zincir net gorulur

<a id="bolum3-senaryo-e-acil-override"></a>
#### Senaryo E - Acil override

1. Normal post kuraldan dolayi bloklanir
2. Finans admin override secip gerekce girer
3. Post tamamlanir
4. Olay istisna paneline duser, denetimde izlenir

---

<a id="bolum3-13-sik-gorulen-hata-mesajlari-ve-cozum"></a>
### 13. Sik gorulen hata mesajlari ve cozum

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

<a id="bolum3-14-gun-sonu-operasyon-proseduru-onerilen"></a>
### 14. Gun sonu operasyon proseduru (onerilen)

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

<a id="bolum3-15-haftalikaylik-kontrol-proseduru-finanssupervisor"></a>
### 15. Haftalik/aylik kontrol proseduru (finans/supervisor)

Haftalik:
- En cok varyans olusan registerlari incele
- Tekrar eden forced close nedenlerini takip et
- Override kullanimi artis trendini kontrol et

Aylik:
- Unposted islemleri sifirla
- Varyans gain/loss hesap etkisini raporla
- Denetim icin orneklem sec (requestId + aciklama + onay izi)

---

<a id="bolum3-16-neden-bu-kadar-kisit-var-isletme-mantigi"></a>
### 16. "Neden bu kadar kisit var?" (isletme mantigi)

Bu kisitlarin amaci operasyonu zorlastirmak degil, su riskleri azaltmaktir:
- Cift kayit
- Yetkisiz post
- Kapanis sonrasi sessiz veri degisikligi
- Kasa-fiziki para uyumsuzlugu
- Denetimde aciklanamayan hareketler

Kisa cevap:
- Hız + kontrol dengesini korumak icin.

---

<a id="bolum3-17-hangi-durumda-neyi-secmeliyim-tek-sayfada"></a>
### 17. Hangi durumda neyi secmeliyim? (tek sayfada)

- Magaza kasasi -> `TILL + REQUIRED + allowNegative=false`
- Subede esnek petty cash -> `DRAWER + OPTIONAL`
- Merkez kasa -> `VAULT + OPTIONAL/NONE` (politika ile)
- Riskli gecis donemi -> cash control mode `WARN`
- Stabil uretim -> cash control mode `ENFORCE`

---

<a id="bolum3-18-son-notlar"></a>
### 18. Son notlar

- Post edilmis kayitlar bilerek degistirilemez. Bu denetim guvencesidir.
- Silmek yerine ters kayit tercih edilir.
- Yetkiniz yoksa sistem bunu gizler/engeller; bu hata degil kontrol mekanizmasidir.
- Istisna ekrani sadece "problem listesi" degil, iyilestirme rehberidir.

---

<a id="bolum3-19-ekip-ici-hizli-egitim-plani-onerilir"></a>
### 19. Ekip ici hizli egitim plani (onerilir)

1. 30 dk: Kasa Tanimlari + Session mode egitimi
2. 30 dk: Kasa Oturumu ac/kapat canli deneme
3. 45 dk: Islem olustur-post-cancel-reverse senaryolari
4. 15 dk: Istisna paneli ve gun sonu checklist
5. 15 dk: Soru-cevap + yetki matrisi teyidi

Toplam: yaklasik 2 saat

---

<a id="bolum3-20-destek-isterken-ne-gondermeliyim"></a>
### 20. Destek isterken ne gondermeliyim?

Sorun bildirirken su bilgileri ekleyin:
- Hangi ekran/rota
- Hangi adimda hata alindi
- Hata metni
- Talep ID (requestId)
- Islem ID / Session ID / Register ID (varsa)
- Kisa is aciklamasi (ornek: "Gun sonu kapama, forced close")

Bu bilgiler, teknik ekibin sorunu cok daha hizli cozmesini saglar.

---

<a id="bolum3-21-ek-a-kasa-modulu-teknik-karar-ozeti-adrden-isletmeye-cevrilmis"></a>
### 21. Ek A - Kasa Modulu Teknik Karar Ozeti (ADR'den Isletmeye Cevrilmis)

Bu bolum, sistemde gercekten calisan kurallarin is diline cevrilmis ozetidir.

1. Register modeli
- Her kasa register tek bir GL (Defteri Kebir) hesabina baglidir.
- Register hesabi: aktif, postable, leaf ve ayni legal entity olmalidir.

2. Register tipleri ve oturum modu
- Tipler: `VAULT`, `DRAWER`, `TILL`
- Oturum modlari: `REQUIRED`, `OPTIONAL`, `NONE`
- Sistem defaultlari:
  - `registerType`: `DRAWER`
  - `sessionMode`: `REQUIRED`
- Not:
  - Tipe gore otomatik mode atamasi (ornegin TILL->REQUIRED) politika olarak onerilir, kodda otomatik bagli degildir.

3. Para birimi kurali
- Register tek para birimiyle calisir.
- Islem para birimi register para birimiyle ayni olmadan kayit gecmez.

4. Kasa kontrollu hesap kurali
- Kasa akisiyla baglanan hesaplar `is_cash_controlled` olur.
- Direkt GL (Defteri Kebir) kaydinda cash-control modu `ENFORCE` ise kural disi giris bloklanir.

5. Islem degistirilemezligi
- `POSTED` islem sonradan duzenlenmez/silinmez.
- Duzeltme yolu: `REVERSE` + gerekirse yeni dogru kayit.

6. Oturum kurallari
- Ayni register icin ayni anda tek acik oturum.
- `REQUIRED` modda open session olmadan create/post akisi bloklanabilir.
- Session kapamada expected/counted/variance hesaplanir.

7. Guvenilirlik kurallari
- Create icin idempotency key zorunlu.
- Cift tiklama/yeniden denemede replay korumasi vardir.
- `txn_no` legal entity + yil bazli deterministik gider.

8. Transfer kapsam siniri (v1)
- Registerlar arasi direkt transfer ayni legal entity + ayni operating unit icin desteklenir.
- Cross-OU transfer icin cash-in-transit akisi v2 backlog'dadir.

---

<a id="bolum3-22-ek-b-islem-tipine-gore-muhasebe-kaydi-matrisi-uygulamadaki-guncel-davranis"></a>
### 22. Ek B - Islem Tipine Gore Muhasebe Kaydi Matrisi (Uygulamadaki Guncel Davranis)

| Islem Tipi | Borc | Alacak | Pratik Not |
|---|---|---|---|
| `RECEIPT` | Register Kasa | Karsi Hesap | Tahsilat |
| `PAYOUT` | Karsi Hesap | Register Kasa | Odeme |
| `DEPOSIT_TO_BANK` | Karsi Hesap (banka vb.) | Register Kasa | Kasadan bankaya cikis |
| `WITHDRAWAL_FROM_BANK` | Register Kasa | Karsi Hesap (banka vb.) | Bankadan kasaya giris |
| `TRANSFER_OUT` | Hedef Register Kasa (`counterCashRegisterId`) | Kaynak Register Kasa (`registerId`) | Ayni LE + ayni OU zorunlu |
| `TRANSFER_IN` | Hedef Register Kasa (`registerId`) | Kaynak Register Kasa (`counterCashRegisterId`) | Ayni LE + ayni OU zorunlu |
| `VARIANCE` (eksik) | Varyans Zarar Hesabi | Register Kasa | Counted < Expected |
| `VARIANCE` (fazla) | Register Kasa | Varyans Kazanc Hesabi | Counted > Expected |
| `OPENING_FLOAT` | Register Kasa | Karsi Hesap | Opsiyonel acilis hareketi |
| `CLOSING_ADJUSTMENT` | Karsi Hesap | Register Kasa | Kontrollu ve aciklamali kullanim |

Ek teknik kontroller:
- Fis dengesi zorunlu (borc = alacak).
- Period OPEN degilse post olmaz.
- Satir scope kontrolunden gecmeyen kayit post olmaz.
- Sistem kaynagi `source_type = CASH` olarak yazilir.

---

<a id="bolum3-23-ek-c-yetki-ve-gorev-ayrimi-sod-mevcut-sistem"></a>
### 23. Ek C - Yetki ve Gorev Ayrimi (SoD) - Mevcut Sistem

<a id="bolum3-231-mevcut-aktif-kasa-yetkileri"></a>
#### 23.1 Mevcut aktif kasa yetkileri
- `cash.register.read`
- `cash.register.upsert`
- `cash.session.open`
- `cash.session.close`
- `cash.txn.read`
- `cash.txn.create`
- `cash.txn.cancel`
- `cash.txn.post`
- `cash.txn.reverse`
- `cash.override.post`
- `cash.variance.approve`
- `cash.report.read`

Not:
- `cash.txn.submit` ve `cash.txn.approve` su an aktif API akisinin parcasi degildir.

<a id="bolum3-232-sistemde-fiilen-zorunlu-olan-sod-kontrolleri"></a>
#### 23.2 Sistemde fiilen zorunlu olan SoD kontrolleri
- Override ile post:
  - `overrideCashControl=true`
  - `overrideReason` dolu
  - `cash.override.post` yetkisi
- Esik ustu varyans kapama:
  - `approveVariance=true`
  - `cash.variance.approve` yetkisi
  - `closeNote` zorunlu
- Durum gecis kurallari:
  - cancel: `DRAFT`/`SUBMITTED`
  - post: `DRAFT`/`SUBMITTED`/`APPROVED`
  - reverse: sadece `POSTED`
  - reversal satiri tekrar reverse edilemez

<a id="bolum3-233-henuz-zorunlu-olmayan-gelecek-iyilestirme-adayi"></a>
#### 23.3 Henuz zorunlu olmayan (gelecek iyilestirme adayi)
- \"Olusturan kisi post edemez\" gibi kisi-bazli ayrim
- Ayrik submit/approve endpointleri

Bu nedenle organizasyonel SoD (rol ayrimi) halen onemlidir:
- Operator agirlikli rollerde `post/reverse/override` verilmemelidir.

---
