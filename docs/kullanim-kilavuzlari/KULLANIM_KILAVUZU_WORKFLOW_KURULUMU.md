# KULLANIM_KILAVUZU_WORKFLOW_KURULUMU.md

## Donem Kapanisi ve Konsolidasyon Workflow Kurulumu

Surum: v1  
Tarih (UTC): 2026-03-03  
Hedef kitle: Muhasebe, finans, konsolidasyon, operasyon, ic denetim, urun sahibi (teknik olmayan kullanicilar)

Bu kilavuz kod degisikligi anlatmaz.  
Bu kilavuz, `Ayarlar > Workflow Kurulumu` ekraninin ne oldugunu, nasil kuruldugunu ve gercek hayatta etkisini anlatir.

---

## 1) Bu Kilavuzun Amaci

Bu dokuman su sorulara net cevap verir:
1. Workflow setup sayfasi ne ise yarar?
2. `PERIOD_CLOSE` ve `CONSOLIDATION_RUN` ne demektir?
3. Steps JSON alanlari neyi kontrol eder?
4. Yanlis kurulum olursa sistemde ne bloklanir?
5. Dogru kurulum nasil yapilir?

---

## 2) Workflow Kurulumu Ekrani Ne Ise Yarar?

Ekran yolu:
- `Ayarlar > Workflow Kurulumu`
- URL: `/app/ayarlar/workflow-kurulumu`

Bu ekranin amaci:
1. Donem kapanisi (`PERIOD_CLOSE`) icin onay adimlarini tanimlamak.
2. Konsolidasyon finalize (`CONSOLIDATION_RUN`) icin onay adimlarini tanimlamak.
3. Bu kurallari tenant, group, legal entity veya operating unit seviyesinde atamak.
4. Her legal entity icin workflow readiness durumunu gostermek.

Kisa ozet:
- Workflow setup, "kim, hangi sirayla, hangi yetkiyle onay verecek?" sorusunun cevabidir.

---

## 3) Temel Kavramlar

### 3.1 Workflow Definition (Tanim)

Bir "onay tarifi"dir.

Icerir:
1. `code`
2. `name`
3. `processType` (`PERIOD_CLOSE` veya `CONSOLIDATION_RUN`)
4. `versionNo`
5. `isActive`

### 3.2 Workflow Steps (Adimlar)

Definition altindaki adim dizisidir. JSON ile kaydedilir.

Adimlar soyle sorulara cevap verir:
1. Kac adim var?
2. Hangi adim hangi scope'ta?
3. Hangi permission gerekir?
4. Kac onayci gerekir?
5. Talebi acan kisi kendi adimini onaylayabilir mi?

### 3.3 Workflow Assignment (Atama)

Definition'in nerede gecerli olacagini belirler.

Ornek:
1. Tum tenant icin ayni kural.
2. Sadece belli group company icin farkli kural.
3. Sadece belli legal entity icin farkli kural.

### 3.4 Workflow Instance

Gercek islem aninda olusan "canli onay kaydi"dir.

Durumlar:
1. `PENDING`: Onay bekliyor.
2. `APPROVED`: Tum gerekli adimlar tamamlandi.
3. `REJECTED`: Red verildi, finalize/close blok.

---

## 4) Process Type Ne Demek?

## 4.1 `PERIOD_CLOSE`

Anlam:
- Defter donem kapanisi sureci.

Gercek hayat:
1. TR01 legal entity Ocak 2026 donemi kapanacak.
2. Sistem close-run baslatir.
3. Workflow gerekiyorsa onaylar bitmeden kapanis tamamlanmaz.

## 4.2 `CONSOLIDATION_RUN`

Anlam:
- Konsolidasyon run'inin finalize edilmesi sureci.

Gercek hayat:
1. Group ABC icin P01-2026 konsolidasyon run'i olustu.
2. Finalize tusu oncesinde workflow kontrol edilir.
3. Onay tamam degilse run `LOCKED` olamaz.

---

## 5) Steps JSON Alanlari Ne Ise Yarar?

Asagidaki alanlar adim davranisini belirler:

1. `stepNo`
- Adim sira numarasi.
- 1'den baslar, bosluk olmamali.
- Ornek: 1,2,3

2. `stageScopeType`
- Bu adimin onay scope seviyesi.
- Degerler: `OPERATING_UNIT`, `LEGAL_ENTITY`, `COUNTRY`, `GROUP`

3. `requiredPermissionCode`
- Onay verecek kullanicida bulunmasi gereken permission.
- Ornek:
  - `org.fiscal_period.read`
  - `gl.period.close.approve`
  - `consolidation.run.finalize`

4. `minApproverCount`
- O adimda gereken minimum farkli onayci sayisi.
- `1` ise tek kisi yeterli.
- `2` ise iki farkli kisi gerekir.

5. `allowSelfApprove`
- `false` ise maker-checker: talebi acan kisi kendi adimini onaylayamaz.
- `true` ise ayni kisi onaylayabilir.

6. `escalationAfterHours`
- Adim icin saat bazli eskalasyon metadata'si.
- Su an runtime'da aktif bir otomatik eskalasyon davranisi zorlanmiyor.

---

## 6) Assignment (Atama) Mantigi

Atama alanlari:
1. `processType`
2. `workflowDefinitionId`
3. `scopeType`: `TENANT`, `GROUP`, `LEGAL_ENTITY`, `OPERATING_UNIT`
4. Scope id alani (secime gore)
5. `effectiveFrom`
6. `effectiveTo` (opsiyonel)
7. `status`: `ACTIVE` veya `INACTIVE`

Scope secimi yaparken:
1. En genel kurali `TENANT` ile verebilirsiniz.
2. Istisna gerekiyorsa `GROUP` veya `LEGAL_ENTITY` ile ozellestirin.
3. Donemsel gecislerde `effectiveFrom`/`effectiveTo` ile versiyonlayin.

Secim onceligi (eslesme sirasi):
1. Operating Unit
2. Legal Entity
3. Group
4. Tenant fallback

Kritik not:
1. `PERIOD_CLOSE` hedeflerinde pratikte `COUNTRY`/`LEGAL_ENTITY`/`GROUP`/`TENANT`; `CONSOLIDATION_RUN` hedeflerinde ise `GROUP`/`TENANT` daha guvenli tercihtir.
2. Sadece OU tabanli kurulum, bu iki surecte "assignment bulunamadi" veya adim scope cozulemedi sorunlari dogurabilir.

---

## 7) Adim Adim Kurulum Rehberi

## 7.1 On Kosullar

Gerekli yetkiler:
1. Goruntuleme icin: `org.tree.read`
2. Kaydetme/guncelleme icin: `onboarding.company.setup`

Feature notu:
1. Workflow gate davranisi tenant feature ile acilir/kapanir.
2. Feature kapaliysa close/finalize workflow beklemeden ilerleyebilir.

## 7.2 Definition Olusturma

1. `Definitions` bolumune gidin.
2. `Code`, `Name`, `ProcessType`, `Version`, `Active` alanlarini doldurun.
3. `Save definition` ile kaydedin.

Oneri:
1. `PERIOD_CLOSE` icin ayri definition.
2. `CONSOLIDATION_RUN` icin ayri definition.

## 7.3 Steps JSON Kaydetme

1. Tanim listesinden definition secin.
2. `Steps (JSON)` alanina adimlari girin.
3. `Save steps` ile kaydedin.

Kontrol:
1. Dizi bos olmamali.
2. `stepNo` tekrar etmemeli.
3. `requiredPermissionCode` dolu olmali.
4. `minApproverCount >= 1` olmali.

## 7.4 Assignment Kaydetme

1. `Assignments` bolumunde `processType` secin.
2. Ayni process type ile uyumlu `definition` secin.
3. `scopeType` secin.
4. Gerekli scope id alanini doldurun.
5. `effectiveFrom` tarihini girin.
6. `status = ACTIVE` secin.
7. `Save assignment` ile kaydedin.

Kontrol:
1. Definition process type ile assignment process type ayni olmali.
2. `effectiveTo` kullaniliyorsa `effectiveTo >= effectiveFrom` olmali.

## 7.5 Readiness Kontrolu

1. Sayfadaki `Workflow readiness` kartini izleyin.
2. `Refresh readiness` ile guncel durumu alin.
3. Tum ilgili legal entity satirlari `ready` oldugunda setup tamamdir.

---

## 8) Ornek JSON Setleri

## 8.1 Period Close Icin Onerilen Baslangic

```json
[
  {
    "stepNo": 1,
    "stageScopeType": "LEGAL_ENTITY",
    "requiredPermissionCode": "org.fiscal_period.read",
    "minApproverCount": 1,
    "allowSelfApprove": false
  },
  {
    "stepNo": 2,
    "stageScopeType": "LEGAL_ENTITY",
    "requiredPermissionCode": "gl.period.close.approve",
    "minApproverCount": 1,
    "allowSelfApprove": false
  }
]
```

Ne olur:
1. Legal Entity hazirlik incelemesi tamamlanir.
2. Legal Entity onayi tamamlaninca instance `APPROVED` olur.
3. Bundan sonra close-run icin ayrica `gl.period.close.execute` yetkisi gerekir.
4. Gozetimsel onay gerekiyorsa ucuncu adim olarak `GROUP` + `gl.period.close.approve` ekleyin.

## 8.2 Consolidation Run Icin Onerilen Baslangic

```json
[
  {
    "stepNo": 1,
    "stageScopeType": "GROUP",
    "requiredPermissionCode": "consolidation.run.finalize",
    "minApproverCount": 2,
    "allowSelfApprove": false
  }
]
```

Ne olur:
1. Grup seviyesinde iki farkli onayci gerekir.
2. Tek onayda finalize acilmaz.
3. Ikinci onaydan sonra finalize acilir.

---

## 9) Gercek Hayat Senaryolari

## Senaryo A - Aylik Kapanis (Legal Entity + Group)

Durum:
1. TR01 Ocak 2026 kapanisi yapilacak.

Kurgu:
1. Step 1: LE Finance Manager onayi.
2. Step 2: Group Controller onayi.

Sonuc:
1. Ilk onaydan sonra adim 2'ye gecer.
2. Ikinci onaydan sonra kapanis blok kalkar.

## Senaryo B - Konsolidasyon Finalize (2 Grup Onayi)

Durum:
1. Grup run'i finale alinacak.

Kurgu:
1. Tek adim, `minApproverCount = 2`, `GROUP`.

Sonuc:
1. Bir kisi onay verirse bekleme devam eder.
2. Ikinci farkli kisi onayi ile finalize serbest olur.

## Senaryo C - Scope Hata Senaryosu

Durum:
1. Atama yalnizca OU scope ile yapildi.

Olasi etki:
1. Surece uygun assignment bulunamaz.
2. Sistem `WORKFLOW_NOT_ASSIGNED` benzeri blok verebilir.

Cozum:
1. LE veya GROUP seviyesinde aktif assignment ekleyin.
2. Gerekirse tenant fallback assignment tanimlayin.

---

## 10) Sistem Hangi Durumda Islemi Bloklar?

1. Feature acik ve aktif assignment yoksa.
2. Assignment var ama step tanimi yoksa.
3. Workflow instance `PENDING` ise.
4. Workflow instance `REJECTED` ise.
5. Onay verecek kiside step icin gereken permission yoksa.
6. Maker-checker aktifken talebi acan kisi kendi adimini onaylamaya calisiyorsa.

---

## 11) Sik Hatalar ve Cozum Yollari

1. Hata: `Missing permission: org.tree.read`
- Anlam: sayfayi okumaya yetki yok.
- Cozum: rol/yetki atamasini guncelleyin.

2. Hata: `Missing permission: onboarding.company.setup`
- Anlam: kaydetme/guncelleme yetkisi yok.
- Cozum: setup rolunu verin.

3. Hata: `steps must be a non-empty array`
- Anlam: steps JSON bos veya gecersiz.
- Cozum: en az bir adim iceren gecerli dizi kaydedin.

4. Hata: `processType must match workflow definition processType`
- Anlam: atamada secilen process type, definition ile uyumsuz.
- Cozum: ayni process type secin.

5. Hata: `effectiveTo cannot be earlier than effectiveFrom`
- Anlam: tarih araligi ters.
- Cozum: tarihleri duzeltin.

6. Hata: `WORKFLOW_NOT_ASSIGNED`
- Anlam: feature acik, ama o scope/tarih icin aktif assignment yok.
- Cozum: dogru scope ve tarih araliginda `ACTIVE` assignment ekleyin.

7. Hata: `APPROVAL_INSTANCE_REJECTED`
- Anlam: ilgili target icin instance redde dusmus.
- Cozum: red nedeni incelenip surec yeniden baslatilmalidir.

---

## 12) En Iyi Pratikler

1. `PERIOD_CLOSE` icin en az 2 adim dusunun:
- `LEGAL_ENTITY` + `GROUP`

2. `CONSOLIDATION_RUN` icin en az grup seviyesi onay tanimlayin.

3. Kritik sureclerde `allowSelfApprove = false` kullanin.

4. Her process type icin aktif bir fallback assignment planlayin.

5. Definition kodlarini versiyonlayin:
- Ornek: `WF_PERIOD_CLOSE_V1`, `WF_PERIOD_CLOSE_V2`

6. Uretime cikmadan once test checklisti yapin:
1. Close/finalize baslat.
2. Onay bekleme durumunu dogrula.
3. Onaylar tamamlaninca blokun kalktigini dogrula.

---

## 13) Go-Live Kontrol Listesi

1. `PERIOD_CLOSE` definition aktif.
2. `CONSOLIDATION_RUN` definition aktif.
3. Her iki definition icin steps kayitli ve gecerli.
4. Her iki process icin aktif assignment var.
5. Readiness kartinda eksik entity kalmadi.
6. Onay verecek rollerde gerekli permissionlar tanimli.
7. Maker-checker politikasi test edildi.
8. Pilot bir close ve pilot bir consolidation finalize testi basarili.

---

## 14) Kisa Sozluk

1. Definition: Onay kurali taslagi.
2. Step: Definition icindeki tek bir onay adimi.
3. Assignment: Definition'in hangi scope'ta gecerli oldugu.
4. Instance: Gercek islemde olusan canli onay kaydi.
5. Maker-checker: Talebi acanla onaylayanin farkli olmasi prensibi.
6. Scope: Yetki siniri (tenant, group, legal entity, operating unit).

---

Bu kilavuzu izleyerek workflow setup; denetlenebilir, tekrar edilebilir ve operasyon ekipleri tarafindan anlasilir bir standarda getirilebilir.
