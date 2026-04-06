# KULLANIM_KILAVUZU_ULKE_KAPSAMLI_AP_WORKFLOW_KURULUMU.md

## Ulke Kapsamli AP Workflow Kurulumu

Surum: v1  
Tarih (UTC): 2026-04-06  
Hedef kitle: AP operasyon, muhasebe, ulke finans, legal-entity finans, rollout sahipleri, teknik olmayan setup kullanicilari

Bu kilavuz kod degisikligi anlatmaz.  
Bu kilavuz, `Ayarlar > Workflow Kurulumu` ve `Cari Belgeler` ekranlari uzerinden ulke kapsamli AP onay akisinin nasil kurulacagini, neden boyle tasarlandigini ve gunluk operasyonda nasil calisacagini anlatir.

Bu dokuman fresh kurulum varsayimi ile yazilmistir.  
Eski AP verisini duzeltme, brownfield gecis veya tarihsel kayit temizligi bu kilavuzun kapsami disindadir.

---

## 1) Bu Kilavuzun Amaci

Bu dokuman su sorulara net cevap verir:
1. Ulke kapsamli AP workflow neyi cozer?
2. Hangi rol ne yapar, ne yapmaz?
3. Workflow kurulumunda `COUNTRY` ve `LEGAL_ENTITY` ne zaman kullanilir?
4. Pilot kurulum ile daha siki kurulum arasindaki fark nedir?
5. Iade, duzeltme, yeniden gonderme ve final post akisi nasil calisir?
6. Hangi durumda sistem posting'i bloklar?

---

## 2) Bu Model Hangi Is Problemini Cozer?

Bu model, AP belge onayini tek bir genis rolde toplamak yerine gorevleri ayirir.

Hedef operasyon akisi:
1. Belge taslagi olusur.
2. Legal entity finans ekibi belgeyi kontrol eder ve gonderir.
3. Ulke seviyesindeki onayci workflow uzerinden inceleme yapar.
4. Ulke seviyesindeki poster, onaylanmis belgeyi final olarak post eder.

Bu ayrim neden onemlidir:
1. Legal entity kontrolu ile ulke seviyesi son karar birbirine karismaz.
2. Ayni ulkedeki birden fazla legal entity, tek bir ulke workflow'u ile yonetilebilir.
3. Gerekirse bir legal entity, ulke varsayimini kendi daha siki kurali ile override edebilir.

---

## 3) Kapsam

Bu kilavuzun anlattigi akim:
1. Governed AP belge siniflari
2. `AP_DOCUMENT_POSTING` sureci
3. `DRAFT -> SUBMITTED -> RETURNED/APPROVED -> POSTED` akisi
4. Ulke ve legal entity tabanli workflow atamalari

Bu kilavuzun anlatmadigi akim:
1. AR belge governance
2. Petty cash benzeri direct-post belge siniflari
3. Donem kapanisi veya konsolidasyon workflow detaylari

Not:
1. V1 tasariminda tum AP belge siniflari workflow'a zorunlu girmek zorunda degildir.
2. Workflow yonetilen AP siniflari ile direct-post AP siniflari ayni tenant icinde birlikte yasayabilir.

---

## 4) Temel Roller ve Is Ayrimi

Yeni fresh kurulumda asagidaki rol ayrimini kullanin:

1. `BranchOperator`
- Taslak belge acabilir.
- Taslagi guncelleyebilir.
- Gerekirse taslagi iptal edebilir.
- Varsayilan olarak submit yetkisi verilmemelidir.

2. `EntityAPController`
- Legal entity seviyesinde AP belgeyi inceler.
- Gerekirse duzeltir.
- Belgeyi workflow'a gonderir.
- Ulke seviyesinde final post yetkisi almaz.

3. `CountryAPApprover`
- Ulke kapsaminda belgeleri gorur.
- Workflow adiminda approve veya return karari verir.
- Bu yetki CARI permission ile degil, workflow adim atamasi ile gelir.

4. `CountryAPPoster`
- Ulke kapsaminda onaylanmis AP belgeyi post eder.
- Gerekirse reverse islemi yapar.
- Approve yetkisi ile post yetkisi ayri tutulur.

Tavsiye:
1. Fresh kurulumda yeni model icin `APDocumentPoster` kullanmayin.
2. Pilot hiz icin ayni kisiye hem `CountryAPApprover` hem `CountryAPPoster` verilebilir.
3. Ancak rol ayrimini koruyun; boylece gorevler ileride ayristirilabilir.

---

## 5) Temel Kavramlar

### 5.1 Workflow Definition

Bir onay tarifidir.

Bu surecte kullanici ekranda genellikle su kodu gorur:
1. `AP_DOCUMENT_POSTING`

Fresh kurulumda varsayilan template olarak su tanim bulunabilir:
1. `WF_STD_AP_COUNTRY_POSTING_V1`

### 5.2 Workflow Step

Definition icindeki tek bir onay adimidir.

AP icin kritik kural:
1. Adim scope'u `COUNTRY`, `LEGAL_ENTITY`, `GROUP` veya `OPERATING_UNIT` olabilir.
2. AP surecinde review yetkisi workflow atamasindan geldigi icin `requiredPermissionCode` alani bos kalmalidir.

### 5.3 Workflow Assignment

Definition'in hangi organizasyon kapsami icin gecerli oldugunu belirler.

Ornek:
1. Tum TR ulkesi icin tek bir AP workflow atamasi
2. TR icindeki bir legal entity icin daha siki override atamasi

### 5.4 Workflow Gate

Belgenin posting oncesi workflow durumunu ozetleyen gostergedir.

Kullanicinin gorebilecegi temel gate durumlari:
1. `PENDING`: Inceleme tamamlanmadi.
2. `RETURNED`: Belge duzeltme icin geri geldi.
3. `APPROVED`: Workflow onayi tamamlandi.
4. `BLOCKED`: Assignment eksikligi gibi bir nedenle posting acilamiyor.
5. `NONE`: Bu belge icin aktif workflow kapisi yok.

---

## 6) Scope Mantigi ve Oncelik Sirasi

AP workflow assignment secim onceligi sunu izler:
1. `OPERATING_UNIT`
2. `LEGAL_ENTITY`
3. `COUNTRY`
4. `GROUP`
5. `TENANT`

Bu ne anlama gelir:
1. Ayni belge icin hem legal entity hem country atamasi varsa legal entity kazanir.
2. Country atamasi, ayni ulkedeki birden fazla legal entity icin ortak kural olabilir.
3. Sadece istisna gereken yerde daha dar scope kullanmak gerekir.

Pratik yorum:
1. Ulke bazli ortak AP yonetimi istiyorsaniz `COUNTRY` iyi bir baslangictir.
2. Belli bir legal entity daha siki kontrol istiyorsa o entity icin ayrica `LEGAL_ENTITY` atamasi tanimlayin.

---

## 7) Onerilen Isletim Modelleri

### 7.1 Pilot Icin Onerilen Baslangic Modeli

Bu model en hizli ve en anlasilir baslangictir:
1. Belge taslakta hazirlanir.
2. `EntityAPController` belgeyi kontrol eder ve submit eder.
3. Workflow tek adimda `COUNTRY` seviyesinde calisir.
4. `CountryAPApprover` approve eder veya return eder.
5. `CountryAPPoster` final post yapar.

Neden iyi baslangictir:
1. Ayni ulkedeki birden fazla legal entity icin hizli devreye alinabilir.
2. Legal entity ile ulke seviyesi rol ayrimini korur.
3. Ilk rolloutta gereksiz step karmasasi yaratmaz.

### 7.2 Daha Siki Kontrol Modeli

Bu model daha fazla denetim isteyen yapilar icindir:
1. Step 1: `LEGAL_ENTITY`
2. Step 2: `COUNTRY`
3. Sonrasinda final post

Ne zaman tercih edilir:
1. Legal entity finans kontrolunun workflow icinde de gorunur olmasi isteniyorsa
2. Ulke onayi oncesinde entity seviyesinde resmi onay adimi gerekiyorsa

---

## 8) Kuruluma Baslamadan Once

Asagidaki kararlar netlesmis olmali:
1. Hangi AP belge siniflari workflow ile yonetilecek?
2. Pilot ulke hangisi?
3. O ulkedeki hangi legal entity'ler country fallback ile yonetilecek?
4. Hangi legal entity icin override gerekecek?
5. Hangi kullanicilar `EntityAPController`, `CountryAPApprover`, `CountryAPPoster` olacak?

Fresh kurulum notu:
1. AP workflow definition'i fresh tenant'a otomatik seed edilmez.
2. Definition ve assignment bilerek acik ve net sekilde kurulmalidir.
3. Sistem sizin yerinize assignment olusturmaz.

---

## 9) Adim Adim Kurulum Rehberi

### 9.1 Surec Tasarimini Secin

Ilk karar:
1. Pilot icin tek adimli `COUNTRY` modeli mi kurulacak?
2. Yoksa `LEGAL_ENTITY + COUNTRY` iki adimli model mi kurulacak?

Tavsiye:
1. Ilk rolloutta tek adimli country modeli ile baslayin.
2. Sadece gercek is ihtiyaci varsa iki adimli modele gecin.

### 9.2 Definition Olusturun veya Varsayilan Tanimi Kullanin

Ekran yolu:
1. `Ayarlar > Workflow Kurulumu`

Definition alanlari:
1. `Code`
2. `Name`
3. `ProcessType`
4. `Version`
5. `Active`

AP icin secilecek surec:
1. `AP_DOCUMENT_POSTING`

Fresh kurulumda kullanabileceginiz hazir tanim:
1. `WF_STD_AP_COUNTRY_POSTING_V1`

Oneri:
1. Hazir tanim varsa pilotta onu kullanin.
2. Tenant'a ozel isimlendirme gerekiyorsa kendi taniminizi acin.

### 9.3 Step'leri Kurun

AP step kurulumunda kritik kurallar:
1. `stageScopeType` olarak `COUNTRY` veya ihtiyaca gore `LEGAL_ENTITY` secin.
2. `requiredPermissionCode` alanini bos birakin.
3. `allowSelfApprove = false` kullanin.
4. `minApproverCount = 1` ile baslayin; gercek ihtiyac varsa artirin.

Pilot icin basit kurgu:
1. Step 1
2. `stageScopeType = COUNTRY`
3. `requiredPermissionCode = bos`
4. `minApproverCount = 1`
5. `allowSelfApprove = false`

Daha siki kurgu:
1. Step 1 = `LEGAL_ENTITY`
2. Step 2 = `COUNTRY`
3. Her iki adimda da `requiredPermissionCode` bos
4. Her iki adimda da `allowSelfApprove = false`

Kritik not:
1. AP approve/return yetkisi ayri bir CARI permission degildir.
2. Bu nedenle AP step alanina permission kodu yazmayin.

### 9.4 Assignment Yapin

Definition hazir olduktan sonra assignment ile nerede gecerli oldugunu belirlersiniz.

Pilot icin onerilen assignment:
1. `processType = AP_DOCUMENT_POSTING`
2. `scopeType = COUNTRY`
3. Ilgili ulke secilir
4. `status = ACTIVE`
5. `effectiveFrom` girilir

Legal entity override gerekiyorsa:
1. Ayrica `scopeType = LEGAL_ENTITY` assignment ekleyin
2. Bu atama ayni ulkedeki country atamasinin uzerine cikar

Kurulum prensibi:
1. Country assignment genel kuraldir.
2. Legal entity assignment istisnadir.
3. Operating unit assignment yalniz gercek ihtiyac varsa kullanilmalidir.

### 9.5 Rol ve Kapsam Atamalarini Tamamlayin

Kurulum sadece workflow definition ile bitmez.
Asagidaki rol atamalari da eksiksiz olmalidir:

1. Taslaga mudahale edecek kullanicilar:
- `EntityAPController`
- `LEGAL_ENTITY` scope

2. Workflow review yapacak kullanicilar:
- `CountryAPApprover`
- `COUNTRY` scope
- ilgili workflow step assignment kapsaminda olmali

3. Final post yapacak kullanicilar:
- `CountryAPPoster`
- `COUNTRY` scope

Kritik ayrim:
1. `CountryAPApprover` belgeyi approve edebilir ama tek basina post etmek zorunda degildir.
2. `CountryAPPoster` post eder ama approve yetkisi workflow step atamasindan gelmiyorsa review yapamaz.

### 9.6 Assignment Rollout'unu Dogru Sirada Yurutun

Operasyonel olarak tenant-level switch yoktur. Governance iki seyle belirlenir:
1. `is_workflow_governed`: hangi AP belge sinifinin workflow'a girebilecegi
2. Workflow assignment: hangi scope'ta governance'in aktif oldugu

Teknik detaya girmeden operasyon yorumu:
1. Governed belge sinifi + assignment varsa belge submit -> review -> approve/post yoluna girer.
2. Governed belge sinifi + assignment yoksa o scope direct-post yolunda kalir.
3. Rollout assignment ekleyerek scope bazinda genisletilir.

Tavsiye edilen siralama:
1. Pilot ulke veya legal entity assignment'ini ekle
2. UAT yap
3. Gerekirse `LEGAL_ENTITY` override'larini ekle
4. Kalan governed scope'lara rollout'u yeni assignment ekleyerek genislet

### 9.7 Cari Belgeler Ekraninda Sonucu Kontrol Edin

Ekran yolu:
1. `Cari Islemler > Cari Belgeler`

Kontrol edilmesi gerekenler:
1. Belge detayinda `workflow gate` gorunuyor mu?
2. `RETURNED` belgede iade nedeni gorunuyor mu?
3. `APPROVED` belge post edilmeye hazir mi?
4. Country kapsamli kullanici ayni ulkedeki farkli legal entity belgelerini gorebiliyor mu?

---

## 10) Belge Yasam Dongusu Nasil Calisir?

### 10.1 `DRAFT`

Anlami:
1. Belge henuz incelemeye girmedi.
2. Duzenlenebilir.
3. Gerekirse iptal edilebilir.

### 10.2 `SUBMITTED`

Anlami:
1. Belge workflow incelemesine girdi.
2. Artik posting icin hazir degildir.
3. Review sonucu beklenir.

### 10.3 `RETURNED`

Anlami:
1. Belge reddedilmis terminal bir kayit degildir.
2. Duzeltme icin geri gelmistir.
3. Iade nedeni kullaniciya gosterilir.
4. Duzeltildikten sonra yeniden submit edilebilir.

### 10.4 `APPROVED`

Anlami:
1. Workflow incelemesi tamamlandi.
2. Belge final post icin hazirdir.
3. Son posting yetkisi ayri rol tarafindan kullanilir.

### 10.5 `POSTED`

Anlami:
1. Muhasebe kaydi olusmustur.
2. Artik normal taslak/islem duzeltme mantigi uygulanmaz.
3. Gerekirse reverse sureci kullanilir.

---

## 11) Gercek Hayat Senaryolari

## Senaryo A - Ayni Ulkede Iki Legal Entity Tek Ulke Workflow'u Kullaniyor

Durum:
1. TR ulkesinde `TR01` ve `TR02` legal entity'leri var.
2. Her ikisi icin ulke seviyesinde ayni AP review modeli isteniyor.

Kurgu:
1. Tek bir `COUNTRY` assignment olusturulur.
2. `CountryAPApprover` her iki legal entity'nin governed AP belgelerini gorur.
3. `CountryAPPoster` her iki legal entity icin onayli belgeyi post eder.

Sonuc:
1. Tek tek legal entity assignment acmaya gerek kalmaz.
2. Ulke ekipleri operasyonu merkezi yurutur.

## Senaryo B - Bir Legal Entity Ulke Kuralini Override Ediyor

Durum:
1. Ulke genelinde tek adimli country modeli var.
2. Ancak `TR01` icin daha siki kontrol gerekiyor.

Kurgu:
1. Tum TR icin `COUNTRY` assignment kalir.
2. `TR01` icin ayri `LEGAL_ENTITY` assignment eklenir.
3. `TR01` belgeleri artik ulke varsayimi yerine entity override ile calisir.

Sonuc:
1. Ayni ulke icinde farkli kontrol seviyeleri birlikte yasar.
2. Diger entity'ler country fallback ile calismaya devam eder.

## Senaryo C - Belge Iade Edildi, Duzeltildi, Yeniden Gonderildi

Durum:
1. Belge submit edildi.
2. Ulke onaycisi eksik veya hatali bilgi nedeniyle return verdi.

Kullanici ne gorur:
1. Belge status'u `RETURNED` olur.
2. Iade nedeni detayda gorunur.
3. Entity kontroloru belgeyi duzeltir.
4. Belge yeniden submit edilir.

Is anlami:
1. Iade, surecin bittigi anlamina gelmez.
2. Duzeltme ve yeniden inceleme yolu bilerek acik tutulmustur.

## Senaryo D - Assignment Eksik

Durum:
1. Belge workflow yonetilen AP sinifindadir.
2. Ama belge kapsami icin assignment yoktur.

Operasyonel sonuc:
1. Belge workflow submit yoluna girmez.
2. Kullanici direct-post path gorebilir.
3. Governed akis o scope'ta isteniyorsa cozum rol degistirmek degil dogru assignment'i eklemektir.

---

## 12) Kullanicinin Ekranda Gorecegi Temel Isaretler

### 12.1 Workflow Gate Mesajlari

Kullanici belge detayinda sunlari gorebilir:
1. `Pending gate`
2. `Returned gate`
3. `Approved gate`
4. `Blocked gate`

Yorum:
1. `Pending gate`: Inceleme devam ediyor, post erken.
2. `Returned gate`: Duzeltme gerekiyor.
3. `Approved gate`: Review tamam, poster devam edebilir.
4. `Blocked gate`: Assignment veya rollout kurali sorunu var.

### 12.2 Iade Notu

`RETURNED` belgede kullanici sunlari gormelidir:
1. Iade nedeni
2. Iade zamani
3. Duzeltip yeniden gonderme yonlendirmesi

### 12.3 Legal Entity Bilgisi

Country kapsamli kullanici icin liste ve detayda legal entity bilgisinin gorunmesi onemlidir.

Neden:
1. Ayni ulkedeki birden fazla sirket ayni ekranda yonetilebilir.
2. Onayci veya poster hangi belge hangi sirketten geliyor anlar.

---

## 13) Sik Yapilan Hatalar ve Dogru Yaklasim

1. Hata: AP step alanina permission kodu yazmak
- Dogrusu: AP step'lerde `requiredPermissionCode` bos kalir.

2. Hata: `BranchOperator` rolune submit'i varsayilan vermek
- Dogrusu: Submit sadece bilincli tenant karari ile verilir.

3. Hata: Governed yapmak istediginiz scope icin assignment tanimlamayi ertelemek
- Dogrusu: Assignment governance rollout'unun anahtari oldugu icin hangi scope workflow ile yonetilecekse assignment'i oraya ekleyin.

4. Hata: Country rolunu verip legal entity duzeltme sorumlulugunu unutmak
- Dogrusu: `EntityAPController` ve country rolleri birlikte tasarlanmalidir.

5. Hata: Her legal entity icin ayri assignment acmak zorundaymis gibi davranmak
- Dogrusu: Ortak kural varsa `COUNTRY` assignment kullanin, sadece istisnalari override edin.

6. Hata: `RETURNED` durumu terminal red gibi yorumlamak
- Dogrusu: `RETURNED`, duzeltme ve yeniden submit icin tasarlanmistir.

---

## 14) Go-Live Oncesi Kisa Kontrol Listesi

1. `AP_DOCUMENT_POSTING` definition aktif.
2. Step kurgusu is ihtiyacina uygun.
3. AP step'lerde permission alani bos.
4. Pilot ulke icin aktif assignment var.
5. Override gereken legal entity'ler icin ayri assignment var.
6. `EntityAPController` rol atamalari tamam.
7. `CountryAPApprover` rol atamalari tamam.
8. `CountryAPPoster` rol atamalari tamam.
9. Pilot kapsam assignment ile aktif edildi.
10. Assignment olmayan governed scope'larin bilincli olarak direct-postta kaldigi teyit edildi.
11. `RETURNED` belge duzeltme ve yeniden submit akisi test edildi.
12. `APPROVED` belgenin yalniz postere acildigi kontrol edildi.
13. Ayni ulkedeki birden fazla legal entity belgesi country kullanicisi tarafindan gorulebildi.

---

## 15) Hangi Durumda Sistem Islemi Bloklar?

1. Governed AP belge workflow submit yoluna sokulmaya calisiliyor ama active assignment yoksa
2. Workflow gate henuz `APPROVED` degilse
3. Belge `RETURNED` durumda ama duzeltme yapilmadan tekrar gonderilmeye calisiliyorsa
4. Final post yetkisi olmayan kullanici `POSTED` asamasina gecmeye calisiyorsa
5. Kapsam atamasi yanlis oldugu icin kullanici belgeyi goremiyorsa

Kritik yorum:
1. Bu bloklar hata degil, tasarimin parcasidir.
2. Amac belgeyi dogru kisi, dogru kapsam ve dogru sirada ilerletmektir.

---

## 16) En Iyi Pratikler

1. Ilk rolloutta country default + entity override mantigiyla ilerleyin.
2. Fresh kurulumda legacy AP rolune geri donmeyin.
3. AP approve ve AP post gorevlerini ayni yetki paketi gibi dusunmeyin.
4. `allowSelfApprove = false` ile maker-checker prensibini koruyun.
5. Kullanici egitiminde status yerine is anlami uzerinden anlatim yapin:
- `SUBMITTED = incelemede`
- `RETURNED = duzeltme gerekiyor`
- `APPROVED = post'a hazir`

---

## 17) Kisa Sozluk

1. Definition: Onay tarifi
2. Step: Tek bir review adimi
3. Assignment: Tanimin hangi kapsamda gecerli oldugu
4. Country scope: Ayni ulkedeki birden fazla legal entity'yi kapsayan is alani
5. Override: Daha dar kapsamli kuralin daha genel kurali gecersiz kilmasi
6. Workflow gate: Posting oncesi workflow durumu
7. Returned: Duzeltme icin geri gelen belge

---

Bu kilavuz izlenirse ulke kapsamli AP workflow kurulumu; denetlenebilir, anlasilir ve operasyon ekipleri tarafindan yonetilebilir bir standarda donusur. Temel prensip sudur: legal entity kontrolu, ulke onayi ve final posting ayni rolde toplanmamalidir.
