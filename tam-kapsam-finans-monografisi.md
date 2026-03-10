# Tam Kapsam Finans Monografisi

## 1. Amac

Bu monografi, SAAP icindeki finans modullerini tek bir test kurgusu icinde uctan uca calistirmak icin hazirlanmistir.

Hedef:
- kurulum + master data + operasyon + kontrol + kapanis akisini tek zincirde test etmek
- sadece mutlu yolu degil; kismi tahsilat, ters kayit, banka iadesi, kur farki, onay, exception ve yeniden acma gibi gercek hayat durumlarini da gormek
- repo icinde gercekten karsiligi bulunan modulleri ayni tenant icinde birbirine baglamak

Bu dokuman, kullanicinin yazdigi ilk 12 maddelik cekirdegi korur ve onu daha genis bir finans test monografisine donusturur.

## 2. Kapsam

Bu monografi su modulleri kapsar:
- Sirket ayarlari / organization management
- Hesap plani, purpose mappings, kurulum ve workflow
- Kasa, kasa oturumlari, tahsilat, tediye, transit transfer, kur degisimi, istisnalar
- Banka hesaplari, statement import, mutabakat, fark profilleri, onay akisi
- Cari kartlar, cari belgeler, settlement, bank attach/apply, audit, raporlar
- Sozlesme, auto billing, deferred revenue / prepaid / accrual akislari
- Bordro import, tahakkuk, liabilities, payment batch, ack, close control
- Mahsup, period close, year-end close, reopen
- Intercompany ve consolidation
- Ops dashboard, exception workbench, audit ve retention bakisi

Bilerek kapsam disi birakilanlar:
- Stok ve demirbas menuleri gorunuyor olsa da repo belgelerinde finans-core seviyesinde net operasyon akisi teyitli degil
- Bu nedenle bu monografi onlar icin derin senaryo yazmaz

## 3. Test Kurgusu

Bu test, tek tenant icinde iki legal entity ve her entity icin iki operating unit ile calistirilir.

### 3.1 Onerilen test veri seti

| Alan | Deger |
|---|---|
| Tenant | `TENANT_FIN_E2E` |
| Fiscal year | `2026` |
| Period | `2026-01`, `2026-02`, `2026-03` acik |
| Currency set | `AFN`, `USD` |
| Legal Entity 1 | `LE_AFG` - base currency `AFN` |
| Legal Entity 2 | `LE_USA` - base currency `USD` |
| LE_AFG OU-1 | `AFG_KBL` |
| LE_AFG OU-2 | `AFG_HRT` |
| LE_USA OU-1 | `USA_NY` |
| LE_USA OU-2 | `USA_TX` |
| Consolidation Group | `GRP_GLOBAL` |

### 3.2 Kasa ve banka tasarimi

Her legal entity icin asagidaki minimum yapi onerilir:

- 1 merkezi local kasa
- 1 merkezi exchange kasa
- her operating unit icin 1 local kasa
- her operating unit icin 1 exchange kasa
- entity bazinda en az 1 local currency banka hesabi
- entity bazinda en az 1 USD banka hesabi
- mumkunse bir branch/OU scope banka hesabi da acilarak branch-level banka akisi test edilmeli

### 3.3 Minimum hesap ve mapping seti

Asagidaki hesap aileleri testten once hazir olmali:
- kasa hesaplari
- banka hesaplari
- cash in transit hesabi
- cash exchange clearing hesabi
- bank transfer clearing hesabi
- intercompany due from / due to hesaplari
- shareholder commitment / paid capital hesaplari
- AR control hesaplari
- AP control hesaplari
- realized FX gain/loss hesaplari
- unrealized FX gain/loss hesaplari
- banka masraf ve faiz hesaplari
- retained earnings hesabi
- revenue / deferred revenue / prepaid / accrued hesaplari
- payroll expense / payroll payable / statutory payable hesaplari

## 4. Monografi Uygulama Kurallari

1. Mumkun oldugunca kayit silmeyin; hatali adimlari reverse ile kapatin.
2. Ayni akisi hem local hem foreign currency ile en az bir kez calistirin.
3. En az bir akista maker-checker / approval zorlamasi acik olsun.
4. Ayni istek ikinci kez gonderilerek idempotent replay davranisi gozlemlensin.
5. Her faz sonunda ilgili rapor veya audit izinden kanit alin.

## 5. Faz 1 - Temel Kurulum

### 5.1 Sirket ve organizasyon

1. `Sirket Ayarlari` ekraninda tenant bootstrap calistir.
Beklenen: temel company ayarlari, varsayilan setup ve odeme kosullari olusur.

2. `Organizasyon Yonetimi` ekraninda `LE_AFG` ve `LE_USA` legal entity kayitlarini olustur.
Beklenen: iki entity aktif durumda olur ve calisma baglaminda secilebilir hale gelir.

3. Her legal entity icin iki operating unit olustur:
- `LE_AFG`: `AFG_KBL`, `AFG_HRT`
- `LE_USA`: `USA_NY`, `USA_TX`
Beklenen: OU listeleri calisma baglaminda gelir.

4. Her legal entity icin fiscal calendar, fiscal period ve book baglantilarini tamamla.
Beklenen: `2026-01`, `2026-02`, `2026-03` periodleri `OPEN` olur.

5. `Kur Yonetimi` ekraninda AFN/USD icin gunluk kurlar ve en az bir ay sonu kuru gir.
Beklenen: cari, cash FX ve revaluation akislari kur eksigi almadan calisabilir.

6. `Hesap Plani Ayarlari` ekraninda GL hesaplarini, purpose mappinglerini ve retained earnings hesabini tanimla.
Beklenen: journal, revrec, settlement, year-end ve payroll postingleri setup hatasi almadan ilerler.

7. `Vergi Kurulumu` ekraninda en az bir satis ve bir alim vergi setup'i yap.
Beklenen: cari belge ve ticari akislarda vergi baglamli test hazir olur.

8. `Workflow Kurulumu` ekraninda su akislardan en az birinde onay zorunlulugu tanimla:
- banka export
- payroll close
- consolidation run finalize/execute
Beklenen: sadece CRUD degil, kontrol akisi da test edilir.

9. `Roller ve Yetkiler` ile finance operator, checker ve auditor rol setlerini ayir.
Beklenen: eksik yetki ve maker-checker denemeleri icin kullanilacak en az 3 kullanici olur.

10. `Konsolidasyon Kurulumu` ekraninda `GRP_GLOBAL` groupunu ac, iki legal entity'yi bu gruba bagla ve canonical/group mapping hazirligini yap.
Beklenen: ileride consolidation execute oncesi coverage sifira indirilebilir.

## 6. Faz 2 - Sermaye ve Kurulus Islemleri

Bu faz, kullanicinin ilk 12 maddesindeki sermaye taahhudu ve yerine getirme akislarini genisletir.

11. Her legal entity icin en az iki shareholder tanimla ve commitment debit sub-account baglantilarini yap.
Beklenen: sermaye taahhut kaydi icin org setup tamamlanir.

12. Her entity icin sermaye taahhut kaydi gir.
Beklenen: commitment journal olusur ve unpaid capital gorunur.

13. `LE_AFG` icin bir sermaye taahhutunu merkezi banka hesabina fulfillment ile yerine getir.
Beklenen: bankaya giden fulfillment journal dogru hesaplarda olusur.

14. `LE_AFG` icin ikinci bir fulfillment'i merkezi cash register ile yap, sonra ayni tutari branch kasasina `Kasa Transit Transferleri` ile gonder.
Beklenen: cash transaction linki, fulfillment linki ve transit zinciri birlikte gorunur.

15. `LE_USA` icin branch bank account hedefli fulfillment yap.
Beklenen: OU-targeted fulfillment ve gerekiyorsa due from / due to self-balancing satirlari test edilir.

16. Bir fulfillment kaydini reverse et, sonra duzeltilmis tutarla tekrar post et.
Beklenen: reversal linkleri, net paid/unpaid capital ve audit izi dogru kalir.

## 7. Faz 3 - Kasa, Banka ve Clearing Kurulumlari

17. Her legal entity icin merkezi local ve merkezi exchange kasa ac.
Beklenen: base currency ve foreign currency nakit noktasi hazir olur.

18. Her operating unit icin iki register ac:
- local register
- exchange register
Beklenen: kullanicinin ilk maddesindeki "her branch icin local ve exchange kasa" kapsanir.

19. Local registerlarda `sessionMode=REQUIRED`, exchange registerlarda `OPTIONAL` veya politika ne ise onu ayarla.
Beklenen: session disiplin testi yapilabilir.

20. Her register icin variance gain/loss, max transaction ve gerekiyorsa negative balance kurallarini ayarla.
Beklenen: session close ve istisna ekranlari anlamli veri uretir.

21. Her legal entity icin su banka hesaplarini ac:
- local currency banka
- USD banka
- en az bir OU bagli banka hesabi
Beklenen: local, foreign ve branch-level banka hareketleri test edilebilir.

22. Su clearing hesaplarini tanimla:
- cash exchange clearing
- bank transfer clearing
- cash in transit
- intercompany clearing / due from / due to
Beklenen: exchange, transfer, banka fark ve intercompany akislarinda ayri izleme yapilabilir.

23. `Banka Onaylari` ekraninda `PAYMENT_BATCH / SUBMIT_EXPORT` icin maker-checker policy olustur.
Beklenen: export adimi bir senaryoda dogrudan degil, onay kuyrugu uzerinden calisir.

24. `Banka Mutabakat` setup'inda en az bir posting template ve iki difference profile olustur:
- `FEE`
- `FX`
Beklenen: banka masrafi ve kur farki satirlari mutabakatta otomatik veya yari otomatik kapatilabilir.

## 8. Faz 4 - Cari Kartlar ve Ticari Master Data

25. Her legal entity icin iki vendor karti ac:
- biri local currency default
- biri USD default
Beklenen: kullanicinin 7. maddesi kapsanir.

26. Her legal entity icin iki customer karti ac:
- biri local currency default
- biri USD default
Beklenen: kullanicinin 8. maddesi kapsanir.

27. Kartlarin bir kismina ozel AR/AP control hesap mapping'i ver, bir kismini fallback purpose mapping ile birak.
Beklenen: posting precedence test edilir.

28. Tum kartlara uygun payment term bagla:
- `NET30`
- `NET45`
- gerekiyorsa `ADVANCE`
Beklenen: aging ve due-date tabanli raporlar dolu gelir.

29. En az bir customer ve bir vendor kaydini `INACTIVE` yapip tekrar kullanmayi dene.
Beklenen: pasif kart kontrolu dogrulanir.

## 9. Faz 5 - Cari Belgeler, Tahsilat ve Odeme Monografisi

Bu faz, kullanicinin ilk dokumanindaki 9, 10 ve 11. maddeleri genisletir.

30. `LE_AFG` icin AFN customer'a tam tahsil edilecek bir satis faturasi post et.
Beklenen: AR open item olusur.

31. `LE_AFG` icin USD customer'a tam tahsil edilecek ikinci bir satis faturasi post et.
Beklenen: foreign currency AR open item olusur.

32. `LE_AFG` icin AFN customer'a kismi tahsilat alinacak bir fatura daha post et.
Beklenen: ileride residual bakiye kalacak acik kalem hazir olur.

33. `LE_AFG` icin USD customer'a kismi tahsilat alinacak ikinci foreign currency fatura post et.
Beklenen: hem partial hem FX etkisi ayni anda test edilir.

34. `LE_AFG` icin local currency vendor faturasi post et.
Beklenen: AP open item olusur.

35. `LE_AFG` icin USD vendor faturasi post et.
Beklenen: foreign currency AP open item olusur.

36. `LE_USA` icin ayni 30-35 adimlarini tekrar et.
Beklenen: monografi tek entity degil, iki ulke/iki entity duzeyinde calisir.

37. Bir customer faturasi icin `Cari Settlements` ekraninda `autoAllocate=true` ile tam tahsilat yap.
Beklenen: belge `SETTLED`, open item sifir, statement guncel.

38. Bir customer faturasi icin `autoAllocate=false` ile manuel kismi tahsilat yap.
Beklenen: belge `PARTIALLY_SETTLED`, residual bakiye gorunur.

39. Bir vendor faturasi icin kismi odeme yap.
Beklenen: AP aging'de kalan borc acik kalir.

40. Bir settlement'i `paymentChannel=CASH` ile olustur ve linked cash transaction'i ayni anda uret.
Beklenen: settlement + kasa referansi birlikte doner.

41. Bir settlement'i `paymentChannel=MANUAL` ile yap.
Beklenen: cari kaydi olur, kasa fisi olusmaz.

42. Bir musteri tahsilatini once `unapplied cash` olarak birak, daha sonra ikinci adimda ilgili faturaya uygula.
Beklenen: on-account / unapplied akisi test edilir.

43. Bir belgeye credit note veya adjustment dokumani gec.
Beklenen: belge zinciri, open item etkisi ve statement hareketi net gorunur.

44. Bir posted settlement'i reverse etmeye calis. Eger linked cash transaction `POSTED` ise once kasa reverse et, sonra settlement reverse et.
Beklenen: bagli moduller arasi state guard calisir.

45. `Cari Raporlari` ekraninda su gorunumleri kontrol et:
- AR Aging
- AP Aging
- Open Items
- Counterparty Statement
Beklenen: full, partial, credit note ve unapplied etkileri raporda ayri okunur.

46. `Cari Audit` ekraninda su aksiyonlari filtrele:
- `cari.document.post`
- `cari.document.reverse`
- `cari.settlement.apply`
- `cari.settlement.reverse`
Beklenen: requestId bazli izleme yapilabilir.

## 10. Faz 6 - Kasa Operasyonlari

47. Her entity icin gerekli kasalarda oturum ac.
Beklenen: `REQUIRED` registerlarda create/post blok yemezsin.

48. `Tahsilat` ekranindan bir local currency receipt olustur ve post et.
Beklenen: kasa bakiyesi ve ilgili GL journali artar.

49. `Tediye` ekranindan bir local currency payout olustur ve post et.
Beklenen: kasa bakiyesi azalir.

50. Ayni OU icinde register-to-register transfer yap.
Beklenen: direkt transfer akisi calisir.

51. Farkli OU registerlar arasinda `Kasa Transit Transferleri` kullanarak transfer baslat, sonra hedefte receive yap.
Beklenen: `INITIATED -> IN_TRANSIT -> RECEIVED` zinciri tamamlanir.

52. `Kasa Kur Degisimleri` ekraninda `DIRECT` modda AFN -> USD exchange yap ve komisyon gir.
Beklenen: principal + fee akisi ayri gorunur.

53. `CLEARING` modda ikinci bir exchange yap.
Beklenen: clearing hesabi uzerinden staged posting gorunur.

54. Yanlis exchange kaydini reverse et.
Beklenen: reversal batch ve fee reversal etkisi gorunur.

55. Gun sonunda bir oturumu farksiz kapat, baska bir oturumu kucuk varyans ile kapat, ucuncu bir oturumu esik ustu varyans ile checker onayi kullanarak kapat.
Beklenen: `Cash Exceptions` ekraninda high variance / forced close / override benzeri veri olusur.

## 11. Faz 7 - Banka Operasyonlari

56. `Banka Ekstre Ice Aktar` ekraninda statement import et. Dosyada su tip satirlar olsun:
- customer collection
- vendor payment
- bank fee
- faiz geliri
- returned payment veya rejected payment
Beklenen: hem normal hem farkli satir tipleri ayni importta gorunur.

57. `Banka Ekstre Kuyrugu` ekraninda `UNMATCHED`, `PARTIAL`, `MATCHED` ve gerekiyorsa `IGNORED` satirlari olusturacak sekilde listeyi incele.
Beklenen: queue durumu anlamli sekilde dagilir.

58. `Banka Mutabakat` ekraninda once `Preview Auto-Run`, sonra `Apply Auto-Run` yap.
Beklenen: uygun satirlar otomatik eslesir.

59. Banka masraf satirini `FEE` difference profile ile islet.
Beklenen: fee expense hesabi ile kapama veya posting olur.

60. Kur farkli bir banka satirini `FX` difference profile ile islet.
Beklenen: fark satiri gain/loss hesaplarina dogru yansir.

61. Bir settlement batch veya unapplied cash kaydina `Bank Attach` yap.
Beklenen: statement line veya bank ref ile kayit baglanir.

62. Bir acik customer tahsilatini `Bank Apply` ile statement line'a dayanarak kapat.
Beklenen: bankadan gelen hareket ile cari settlement birlesir.

63. Bir payment return veya rejection olayini kaydet ve exception kuyruguna dusur.
Beklenen: banka iadesi / reddi siradan mutabakat degil, istisna olarak izlenir.

## 12. Faz 8 - Sozlesme, Faturalama ve Revenue Recognition

64. `LE_AFG` icin 12 aylik customer contract ac; bir satir straight-line, bir satir milestone olarak tasarla.
Beklenen: mixed recognition method testi hazir olur.

65. Contracttan `Generate Billing` ile once `FULL`, sonra baska contractta `PARTIAL` veya `MILESTONE` billing uret.
Beklenen: auto billing + auto link + idempotent replay davranisi test edilir.

66. Contracttan `Generate RevRec` ile `DEFREV` schedule uret.
Beklenen: deferred revenue schedule ve line sayilari olusur.

67. `Gelecek Yillar Gelirleri` ekraninda ilk donem run'ini create + post et.
Beklenen: recognized amount artar, deferred bakiye azalir.

68. Bir posted revrec run'ini reverse et, sonra yeniden post et.
Beklenen: reversible revenue recognition zinciri dogrulanir.

69. Vendor tipi bir contract veya manuel revenue module akisi ile `PREPAID_EXPENSE` senaryosu calistir.
Beklenen: pesin gider donemsellestirme akisi gorunur.

70. Ayrica en az bir `ACCRUED_REVENUE` veya `ACCRUED_EXPENSE` run'i olustur.
Beklenen: fatura zamani ile hizmet zamani farkli oldugunda accrual coverage saglanir.

71. Contract detail KPI'larinda su alanlari kontrol et:
- billed
- collected
- uncollected
- recognized
- deferred
- open receivable / open payable
Beklenen: ticari akisin contract ekranindaki finansal rollup ile mutabik oldugu gorulur.

## 13. Faz 9 - Bordro, Odeme Batch ve Banka Onay Zinciri

72. `Payroll Beneficiaries` ekraninda calisan banka hesaplarini ve primary hesaplari tanimla.
Beklenen: payment prep onkosulu saglanir.

73. `Payroll Mappings` ekraninda tum ana componentleri GL hesaplara bagla.
Beklenen: preview not balanced veya missing mapping hatasi alinmaz.

74. `Payroll Import` ile bir bordro run yukle.
Beklenen: run `IMPORTED` veya uygun ilk duruma gelir.

75. Run detail ekraninda preview al, `Mark Reviewed` yap ve `Finalize + Post Accrual` calistir.
Beklenen: payroll accrual journal olusur.

76. `Payroll Liabilities` ekraninda once `NET_PAY`, sonra `STATUTORY`, sonra `ALL` scope ile build/preview yap.
Beklenen: liabilities seti scope bazinda anlamli dagilir.

77. Liabilities uzerinden payment batch olustur.
Beklenen: batch `DRAFT` gelir.

78. Batch'i `Onayla` ve export etmeye calis. Policy devredeyse `Banka Onaylari` kuyruguna dusmesini sagla; checker kullanici ile approve et; sonra export tamamla.
Beklenen: maker-checker gercekten calisir.

79. Bankadan ack import et, gerekiyorsa return/reject senaryosu uret, sonra `Payment Sync Apply` ile liabilities durumlarini guncelle.
Beklenen: bordro borclarinin banka gercegi ile senkronu tamamlanir.

80. `Payroll Close Controls` ekraninda prepare -> request -> approve close zincirini tamamla; sonra kontrollu bir `Reopen` testi yap.
Beklenen: closed period lock'lari ve reopen gerekce zorunlulugu dogrulanir.

81. Opsiyonel ama guclu coverage icin bir `RETRO` veya `OFF_CYCLE` correction shell olustur ve ek duzeltme run'i gec.
Beklenen: sade ana run degil, correction akisi da test edilmis olur.

## 14. Faz 10 - Mahsup, Intercompany ve Consolidation

82. `Mahsup Islemleri` ekraninda normal manual journal olustur:
- gider tahakkuku
- reclass
- duzeltme fisleri
Beklenen: GL workbench normal kullanimi test edilir.

83. Bir intercompany journal olustur ve `Post linked intercompany mirrors` benzeri mirror davranisini kullan.
Beklenen: iki legal entity arasinda karsi tarafa aynalanan fis zinciri gorunur.

84. `Intercompany Mutabakat` ekraninda entityler arasi farklari kos.
Beklenen: due from / due to ve partner bazli farklar gorunur.

85. `Konsolidasyon Kurulumu` ekraninda canonical readiness / mapping coverage kontrol et; eksik varsa duzelt.
Beklenen: execute oncesi coverage tam olur.

86. Consolidation run create + execute yap.
Beklenen: execute guard gecilir, raporlar uretilir.

87. `Konsolidasyon Raporlari` ekraninda balance sheet ve income statement kontrolu yap.
Beklenen: entity bazli kayitlar grup seviyesine tasinir.

## 15. Faz 11 - Aylik Kapanis ve Yilsonu Kapanis

88. Kapanis oncesi su raporlari al:
- mizan
- open items
- counterparty statement
- cash FX reports
- bank reconciliation summary
- payroll close status
Beklenen: kapanis oncesi reconcile checklist veri ile dolu olur.

89. Foreign currency acik AP/AR, banka ve kasalar icin kur farki etkisini kontrol et.
Beklenen: realized ve unrealized FX mantigi ayni donemde gorulur.

90. `Kasa Kur Ops Dashboard` veya ilgili job akislari ile cash FX revaluation month-end run'ini tamamla.
Beklenen: close gate oncesi revaluation `COMPLETED` olur.

91. `Mahsup Islemleri` ekraninda `SOFT_CLOSED` period close calistir.
Beklenen: close run olusur, gerekiyorsa carry/reclass etkileri izlenir.

92. Bir ayar veya kayit hatasi simule edip `Reopen Last Close Run` ile donemi yeniden ac; duzeltme fisini gec; tekrar close et.
Beklenen: kapanis sonrasi duzeltme sureci test edilir.

93. `Yilsonu Kapanis Islemleri` ekraninda REVREC readiness kontrollerini calistir.
Beklenen: eksik purpose mapping veya long/short reclass sorunu varsa gorunur.

94. Yilsonu `Run Auto Close` ile retained earnings hesabina P&L kapamasi yap.
Beklenen: year-end jurnal ve carry-forward etkisi olusur.

95. Sonraki yil icin acilis fisinin veya tasinan bakiyelerin dogru geldigini kontrol et.
Beklenen: yilsonu sadece kapanis degil, yeni yil acilis dogrulugu da test edilir.

## 16. Faz 12 - Kontrol, Guvenlik ve Operasyonel Dayaniklilik

96. `Exception Workbench` ekraninda banka, payroll ve diger exception kayitlarini claim / resolve / ignore / reopen ile test et.
Beklenen: operasyon ekibi icin merkezi workbench akisi calisir.

97. `Operasyon Dashboard` ekraninda su KPI'lari incele:
- unmatched bank lines
- awaiting ack
- failed payroll jobs
- requested_gt_24h
- queued_due_now
Beklenen: monografi sonunda operasyon saglik paneli bos veya aciklanabilir sekilde gelir.

98. Yetkisi olmayan kullanici ile su isleri dene:
- banka export
- settlement reverse
- payroll close approve
- consolidation execute
Beklenen: ekran/aksiyon bazli permission guardlar dogru calisir.

99. Idempotency testi icin su islemlerden en az ikisini ayni key ile ikinci kez gonder:
- cash create
- settlement apply
- contract generate-billing
- payroll finalize veya provider import apply
Beklenen: duplicate kayit yerine replay davranisi gorunur.

100. Tum ana moduller icin audit kaniti topla:
- cari audit
- RBAC audit
- sensitive data audit
- batch / close / consolidation requestId kayitlari
Beklenen: test sadece islevsel degil, denetlenebilir de olur.

## 17. Bu Monografide Ozel Olarak Bulunmasi Gereken Kritik Sonuclar

Monografi basarili sayilmadan once su sonuclar gorulmeli:

- 2 legal entity aktif ve consolidation grubuna bagli
- 4 operating unit aktif
- her entity icin local + USD banka hesabi aktif
- her branch/OU icin local + exchange kasa aktif
- en az 1 sermaye taahhudu ve 1 fulfillment reverse edilmis
- full settlement, partial settlement ve unapplied cash gorulmus
- cash linked settlement ve bank apply ikisi de calistirilmis
- direct exchange ve clearing exchange ikisi de gorulmus
- en az 1 bank fee ve 1 returned payment / rejected payment islenmis
- contract billing + revrec + reverse zinciri tamamlanmis
- payroll import + accrual + liabilities + batch + ack + close tamamlanmis
- intercompany journal ve consolidation execute tamamlanmis
- soft close, reopen ve year-end close tamamlanmis

## 18. Onerilen Kanit Paketi

Her faz sonunda ekran goruntusu veya rapor export'u alin:
- organization tree
- chart/purpose mapping ozetleri
- capital fulfillment history
- customer/vendor card listeleri
- open items ve counterparty statement
- cash sessions + cash exceptions
- bank queue + reconciliation + approvals
- contracts financial rollup + revenue reports
- payroll run detail + liabilities + close controls
- journal history + trial balance
- intercompany reconcile sonucu
- consolidation report
- year-end close run tablosu

## 19. Neden Bu Monografi Genisletildi?

Bu monografi sadece temel satis-fatura-tahsilat akisiyla sinirli tutulmadi. Genisletme nedeni:

- gercek finans sistemlerinde kismi odeme ve on-account / unapplied cash cok yaygindir
- credit note, reversal ve returned payment olmadan denetim kalitesi eksik kalir
- foreign currency acik kalemler ve cash/bank revaluation olmadan kapanis testi eksik olur
- contract/deferred revenue ve payroll olmadan sistem ancak parca parca test edilmis sayilir
- intercompany ve consolidation olmadan grup muhasebesi test edilmis olmaz

## 20. Dis Kaynaklardan Alinan Coverage Fikirleri

Bu dokuman repo kurallarini repo belgelerinden alir; ama su resmi kaynaklar, coverage'i genisletmek icin kullanildi:

- Microsoft Learn - Bank reconciliation overview:
  https://learn.microsoft.com/en-us/dynamics365/finance/cash-bank-management/configure-bank-reconciliation-matching-rules
- Microsoft Learn - Foreign currency revaluation for AR/AP:
  https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/foreign-currency-revaluation-accounts-payable-accounts-receivable
- Microsoft Learn - Year-end close:
  https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/year-end-close
- Microsoft Learn - Intercompany accounting setup:
  https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/intercompany-accounting-setup
- Oracle Documentation - On-account and unapplied receipts:
  https://docs.oracle.com/cd/E26401_01/doc.122/f10570/T355475T355482.htm

Bu kaynaklardan repo'ya bire bir davranis alinmadi; sadece su ek test fikirleri desteklendi:
- on-account / unapplied cash
- credit / adjustment ve reversal coverage
- bank fee / FX difference profilleri
- intercompany ve close coverage'in genis tutulmasi
- year-end close oncesi revaluation ve reconciliation mantigi
