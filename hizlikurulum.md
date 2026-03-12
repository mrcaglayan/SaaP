1-Request URL
http://localhost:3000/api/v1/provider/tenants
Request Method
POST
{"tenantCode":"TMV","tenantName":"Türkiye Maarif Vakfı","adminName":"Ufuk","adminEmail":"tmv@gmail.com","adminPassword":"12121212"}
2-Request URL
http://localhost:3000/api/v1/onboarding/company-bootstrap
Request Method
POST
{
"groupCompany": {
"code": "TMV",
"name": "TÜRKİYE MAARİF VAKFI"
},
"fiscalCalendar": {
"code": "MAIN",
"name": "Main Calendar",
"yearStartMonth": 1,
"yearStartDay": 1
},
"fiscalYear": 2026,
"legalEntities": [
{
"code": "AFG",
"name": "AFGHANTURK MAARIF FOUNDATION",
"functionalCurrencyCode": "AFN",
"isIntercompanyEnabled": true,
"intercompanyPartnerRequired": false,
"taxId": "123324",
"countryIso2": "AF",
"coaCode": "COA-AFG",
"coaName": "AF Starter CoA",
"bookCode": "BOOK-AFG",
"bookName": "AF Local Book",
"policyPackId": "TR_UNIFORM_V1",
"defaultAccounts": [
{
"code": "100",
"name": "KASA",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "101",
"name": "ALINAN CEKLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "102",
"name": "BANKALAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "103",
"name": "VERILEN CEK ve ODEME EMRI (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "108",
"name": "DIGER HAZIR DEGERLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "110",
"name": "HISSE SENETLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "111",
"name": "OZEL KESIM TAHVIL SNT.VE BONO.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "112",
"name": "KAMU KESIMI TAHVIL SNT.VE BONO",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "118",
"name": "DIGER MENKUL KIYMETLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "119",
"name": "MENKUL KIY.DEGER DUS.KAR.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "120",
"name": "ALICILAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "121",
"name": "ALACAK SENETLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "122",
"name": "ALACAK SENETLERI REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "124",
"name": "KAZANILMAMIS FIN.KIRA.FZ.GL(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "126",
"name": "VERILEN DEPOZITO VE TEMINATLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "127",
"name": "DIGER TICARI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "128",
"name": "SUPHELI TICARI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "129",
"name": "SUPHELI TIC.AL. KARSIGI (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "131",
"name": "ORTAKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "132",
"name": "ISTIRAKLERDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "133",
"name": "BAGLI ORTAKLIKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "135",
"name": "PERSONELDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "136",
"name": "DIGER CESITLI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "137",
"name": "DIGER ALACAK SNT.REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "138",
"name": "SUPHELI DIGER ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "139",
"name": "SUPHELI DIGER ALACAK.KARS.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "150",
"name": "ILK MADDE VE MALZEME",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "151",
"name": "YARI MAMULLER - URETIM",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "152",
"name": "MAMULLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "153",
"name": "TICARI MALLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "157",
"name": "DIGER STOKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "158",
"name": "STOK DEGER DUSUKLUGU KARS.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "159",
"name": "VERILEN SIPARIS AVANSLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "170",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "171",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "172",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "173",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "174",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "175",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "176",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "177",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "178",
"name": "YILLARA YAY.INS.ENF.DUZELT.HES",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "179",
"name": "TASERONLARA VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "180",
"name": "GELECEK AYLARA AIT GIDERLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "181",
"name": "GELIR TAHAKKUKLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "190",
"name": "DEVREDEN KATMA DEGER VERGISI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "191",
"name": "INDIRILECEK KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "192",
"name": "DIGER KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "193",
"name": "PESIN ODENEN VERGI VE FONLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "195",
"name": "IS AVANSLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "196",
"name": "PERSONEL AVANSLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "197",
"name": "SAYIM VE TESELLUM NOKSANLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "198",
"name": "DIGER CESITLI DONEN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "199",
"name": "DIGER DONEN VARLIKLAR KRS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "220",
"name": "ALICILAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "221",
"name": "ALACAK SENETLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "222",
"name": "ALACAK SENETLERI REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "224",
"name": "KAZANILMAMIS FIN.KIRA.FZ.GL(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "226",
"name": "VERILEN DEPOZITO VE TEMINATLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "229",
"name": "SUPHELI ALACAKLAR KARSILIGI(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "231",
"name": "ORTAKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "232",
"name": "ISTIRAKLERDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "233",
"name": "BAGLI ORTAKLIKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "235",
"name": "PERSONELDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "236",
"name": "DIGER CESITLI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "237",
"name": "DIGER ALACAK SNT.REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "239",
"name": "SUPHELI DIGER ALACAK.KARS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "240",
"name": "BAGLI MENKUL KIYMETLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "241",
"name": "BAGLI MEN.KIY.DEG. DUS.KAR.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "242",
"name": "ISTIRAKLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "243",
"name": "ISTIRAKLERE SERM.TAAHHUT. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "244",
"name": "IST.SERM.PAY.DEG.DUSUK.KRS.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "245",
"name": "BAGLI ORTAKLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "246",
"name": "BAGLI ORTAK.SER.TAAHHUTLERI(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "247",
"name": "BAG.ORT.SER.PAY.DEG.DUS.KRS(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "248",
"name": "DIGER MALI DURAN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "249",
"name": "DGR.MALI DURAN VARLIK.KRS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "250",
"name": "ARAZI VE ARSALAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "251",
"name": "YERALTI VE YERUSTU DUZENLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "252",
"name": "BINALAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "253",
"name": "TESIS MAKINE VE CIHAZLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "254",
"name": "TASITLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "255",
"name": "DEMIRBASLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "256",
"name": "DIGER MADDI DURAN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "257",
"name": "BIRIKMIS AMORTISMANLAR (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "258",
"name": "YAPILMAKTA OLAN YATIRIMLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "259",
"name": "VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "260",
"name": "HAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "261",
"name": "SEREFIYE",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "262",
"name": "KURULUS VE ORGUTLENME GIDER.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "263",
"name": "ARASTIRMA VE GELISTIRME GIDER.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "264",
"name": "OZEL MALIYETLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "265",
"name": "FINANSAL KIRALAMA KONUSU SABIT KIYMET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "267",
"name": "DIGER.MADDI OLM. DURAN VARLIK.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "268",
"name": "BIRIKMIS AMORTISMANLAR (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "269",
"name": "VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "271",
"name": "ARAMA GIDERLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "272",
"name": "HAZIRLIK VE GELISTIRME GIDER.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "277",
"name": "DIGER OZEL TUKENMEYE TABI VAR.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "278",
"name": "BIRIKMIS TUKENME PAYLARI (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "279",
"name": "VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "280",
"name": "GELECEK YILLARA AIT GIDERLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "281",
"name": "GELIR TAAHHUKLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "291",
"name": "GELECEK YILLARDA INDIRILE. KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "292",
"name": "DIGER KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "293",
"name": "GELECEK YILLAR IHTIYACI STOK.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "294",
"name": "ELD.CIK.STOK.VE MAD.DURAN VAR.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "295",
"name": "PESIN ODENEN VERGILER VE FON",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "297",
"name": "DIGER CESITLI DURAN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "298",
"name": "STOK DEGER DUSUKLUGU KARS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "299",
"name": "BIRIKMIS AMORTISMANLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "300",
"name": "BANKA KREDILERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "301",
"name": "FINANSAL KIRALAMA ISL.BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "302",
"name": "ERTELEN.FIN.KIRA.BORC.MAL. (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "303",
"name": "UZUN VAD.KRD.ANAP.TAKS.VE FAIZ",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "304",
"name": "TAHVIL ANAP.BORC TAK.VE FAIZ.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "305",
"name": "CIKARILMIS BONOLAR VE SENETLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "306",
"name": "CIKARILMIS DIGER MENKUL KIYM.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "308",
"name": "MENKUL KIYMET. IHRAC FARKI (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "309",
"name": "DIGER MALI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "320",
"name": "SATICILAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "321",
"name": "BORC SENETLERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "322",
"name": "BORC SENETLERI REESKONTU (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "326",
"name": "ALINAN DEPOZITO VE TEMINATLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "329",
"name": "DIGER TICARI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "331",
"name": "ORTAKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "332",
"name": "ISTIRAKLERE BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "333",
"name": "BAGLI ORTAKLIKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "335",
"name": "PERSONELE BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "336",
"name": "DIGER CESITLI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "337",
"name": "DIGER BORC.SENET.REESKONTU (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "340",
"name": "ALINAN SIPARIS AVANSLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "349",
"name": "ALINAN DIGER AVANSLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "350",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "351",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "352",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "353",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "354",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "355",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "356",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "357",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "358",
"name": "YILLARA YAY.INS.ENF.DUZELT.HES",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "360",
"name": "ODENECEK VERGI VE FONLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "361",
"name": "ODENECEK SOS. GUV. KESINTILERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "368",
"name": "VD.GEC.ER.VEYA TK.VR.VE DG.YUK",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "369",
"name": "ODENECEK DIGER YUKUMLULUKLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "370",
"name": "DON.KARI VER.VE DIG.YUK.KARS.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "371",
"name": "DON.KAR.PES.OD.VER.VE YUK (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "372",
"name": "KIDEM TAZMINATI KARSILIGI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "373",
"name": "MALIYET GIDERLERI KARSILIGI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "379",
"name": "DIGER BORC VE GIDER KARSILIGI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "380",
"name": "GELECEK AYLARA AIT GELIRLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "381",
"name": "GIDER TAHAKKUKLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "391",
"name": "HESAPLANAN KDV",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "392",
"name": "DIGER KDV",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "393",
"name": "MERKEZ VE SUBELER CARI HESABI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "397",
"name": "SAYIM VE TESELLUM FAZLALARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "399",
"name": "DIGER CESITLI YAB. KAYNAKLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "400",
"name": "BANKA KREDILERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "401",
"name": "FINANSAL KIRALAMA ISL.BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "402",
"name": "ERTELEN.FIN.KIRA.BORC.MAL. (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "405",
"name": "CIKARILMIS TAHVILLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "407",
"name": "CIKARILMIS DGR.MENKUL KIYMET.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "408",
"name": "MENKUL KIYMET.IHRAC FARKI (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "409",
"name": "DIGER MALI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "420",
"name": "SATICILAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "421",
"name": "BORC SENETLERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "422",
"name": "BORC SENETLERI REESKONTU (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "426",
"name": "ALINAN DEPOZITO VE TEMINATLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "429",
"name": "DIGER TICARI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "431",
"name": "ORTAKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "432",
"name": "ISTIRAKLERE BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "433",
"name": "BAGLI ORTAKLIKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "436",
"name": "DIGER CESITLI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "437",
"name": "DIGER BORC SENETLERI REES. (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "438",
"name": "KAMUYA OL.ERT.VEYA TAKSIT.BORC",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "440",
"name": "ALINAN SIPARIS AVANSLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "449",
"name": "ALINAN DIGER AVANSLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "472",
"name": "KIDEM TAZMINATI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "479",
"name": "DIGER BORC VE GIDER KARSILIK.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "480",
"name": "GELECEK YILLARA AIT GELIRLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "481",
"name": "GIDER TAHAKKUKLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "492",
"name": "GEL.YIL.ERT.VEYA TERKIN ED.KDV",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "493",
"name": "TESISE KATILMA PAYLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "499",
"name": "DI.CES.UZUN VAD.YAB.KAYNAKLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "500",
"name": "SERMAYE",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "501",
"name": "ODENMEMIS SERMAYE (-)",
"accountType": "EQUITY",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "502",
"name": "SERMAYE DUZELT.OLUMLU FARKLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "503",
"name": "SERMAYE DUZELT.OLUMSUZ FARKLARI (-)",
"accountType": "EQUITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "520",
"name": "HISSE SENETLERI IHRAC PRIMLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "521",
"name": "HISSE SENEDI IPTAL KARLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "522",
"name": "M.D.V.YENIDEN DEGERLEME ARTIS.",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "523",
"name": "ISTIRAKLER YENIDEN DEGER.ART.",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "524",
"name": "MALIYET ARTISLARI FONU",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "529",
"name": "DIGER SERMAYE YEDEKLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "540",
"name": "YASAL YEDEKLER",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "541",
"name": "STATU YEDEKLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "542",
"name": "OLAGANUSTU YEDEKLER",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "548",
"name": "DIGER KAR YEDEKLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "549",
"name": "OZEL FONLAR",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "570",
"name": "GECMIS YILLAR KARLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "580",
"name": "GECMIS YILLAR ZARARLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "590",
"name": "DONEM NET KARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "591",
"name": "DONEM NET ZARARI (-)",
"accountType": "EQUITY",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "600",
"name": "YURT ICI SATISLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "601",
"name": "YURT DISI SATISLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "602",
"name": "DIGER GELIRLER",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "610",
"name": "SATISTAN IADELER (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "611",
"name": "SATIS ISKONTOLARI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "612",
"name": "DIGER INDIRIMLER (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "620",
"name": "SATILAN MAMULLER MALIYETI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "621",
"name": "SATILAN TIC.MALLAR MALIYETI(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "622",
"name": "SATILAN HIZMET MALIYETI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "623",
"name": "DIGER SATISLARIN MALIYETI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "630",
"name": "ARASTIRMA VE GELISTIRME GID(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "631",
"name": "PAZARLAMA SAT.VE DAG.GID. (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "632",
"name": "GENEL YONETIM GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "640",
"name": "ISTIRAKLERDEN TEMETTU GELIR.",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "641",
"name": "BAGLI ORT.TEMETTU GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "642",
"name": "FAIZ GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "643",
"name": "KOMISYON GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "644",
"name": "KONUSU KALMAYAN KARSILIKLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "645",
"name": "MENKUL KIYMETLER SATIS KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "646",
"name": "KAMBIYO KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "647",
"name": "REESKONT FAIZ GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "648",
"name": "ENFLASYON DUZELTMESI KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "649",
"name": "DIGER OLAGAN GELIR VE KARLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "653",
"name": "KOMISYON GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "654",
"name": "KARSILIK GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "655",
"name": "MENKUL KIYMET SATIS ZARAR (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "656",
"name": "KAMBIYO ZARARLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "657",
"name": "REESKONT FAIZ GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "658",
"name": "ENFLASYON DUZELT.ZARARLARI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "659",
"name": "DIGER GIDER VE ZARARLAR (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "660",
"name": "KISA VADELI BORCLANMA GID. (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "661",
"name": "UZUN VADELI BORCLANMA GID. (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "671",
"name": "ONCEKI DONEM GELIR VE KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "679",
"name": "DIG.OLAGANDISI GELIR VE KARLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "680",
"name": "CALISMAYAN KISIM GID.VE ZAR(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "681",
"name": "ONCEKI DON.GID.VE ZARARLARI(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "689",
"name": "DIGER O.DISI GID.VE ZARAR.(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "690",
"name": "DONEM KARI VEYA ZARARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "691",
"name": "D.K.VER.VE DIG.YAS.YUK.KAR.(-)",
"accountType": "REVENUE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "692",
"name": "DONEM NET KARI VE ZARARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "697",
"name": "YILLARA YAY.INS.ENF.DUZELT.HES",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "698",
"name": "ENFLASYON DUZELTME HESABI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "700",
"name": "MALIYET MUHASEBESI BAGLANTI HS",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "701",
"name": "MALIYET MUHASEBESI YANSITMA HS",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "710",
"name": "DIREKT ILK MADDE VE MALZEME GD",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "711",
"name": "DIREKT ILK MAD.VE MAL.YANS.FAR",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "712",
"name": "DIREKT ILK MAD.VE MAL.FIAT FAR",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "713",
"name": "DIREKT ILK MAD.VE MAL.MIK.FAR.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "720",
"name": "DIREKT ISCILIK GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "721",
"name": "DIREKT ISCILIK GID.YANSIT.HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "722",
"name": "DIREKT ISCILIK UCRET FARKLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "723",
"name": "DIREKT ISCILIK SURE FARKLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "730",
"name": "GENEL URETIM GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "731",
"name": "GENEL URETIM GID.YANSITMA HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "732",
"name": "GENEL URETIM GID.BUTCE FARK.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "733",
"name": "GENEL URETIM GIDERLERI VER.FRK",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "734",
"name": "GENEL URETIM GID.KAPASITE FRK.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "740",
"name": "HIZMET URETIM MALIYETI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "741",
"name": "HIZMET URETIM MAL.YAN.HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "742",
"name": "HIZMET URET.MAL.FARK HESAPLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "750",
"name": "ARASTIRMA VE GELISTIRME GIDER.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "751",
"name": "ARAS.VE GELIS.GID.YANS.HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "752",
"name": "ARAS.VE GELIS.GIDER FARKLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "760",
"name": "PAZARLAMA SATIS VE DAGITIM GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "761",
"name": "PAZARLAMA SAT.VE DAG.GID.YANSITMA HS",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "762",
"name": "PAZARLAMA SAT.VE DAG.GID.FARK HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "770",
"name": "GENEL YONETIM GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "771",
"name": "GEN.YON.GID.YANSITMA HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "772",
"name": "GENEL YONETIM GID.FARKLARI HS.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "780",
"name": "FINANSMAN GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "781",
"name": "FINANSMAN GIDERLERI YANSITMA HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "782",
"name": "FINANSMAN GIDERLERI FARK HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "790",
"name": "ILK MADDE VE MALZEME GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "791",
"name": "ISCI UCRET VE GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "792",
"name": "MEMUR UCRET VE GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "793",
"name": "DIS. SAGL. FAYDA VE HIZMETLER",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "794",
"name": "CESITLI GIDERLER",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "795",
"name": "VERGI RESIM VE HARCLAR",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "796",
"name": "AMORTISMANLAR VE TUKENME PAYL.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "797",
"name": "FINANSMAN GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "798",
"name": "GIDER CESITLERI YANSITMA HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "799",
"name": "URETIM MALIYET HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "800",
"name": "YONETIM MUHASEBESI HESAPLARI - SERBEST",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "900",
"name": "NAZIM HESAPLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
}
],
"branches": [
{
"code": "KEO",
"name": "KABİL ERKEK OKULU",
"unitType": "BRANCH",
"hasSubledger": true
},
{
"code": "MEO",
"name": "MEZAR ERKEK OKULU",
"unitType": "BRANCH",
"hasSubledger": true
}
]
},
{
"code": "PKR",
"name": "PAK-TURK SCHOOLS",
"functionalCurrencyCode": "PKR",
"isIntercompanyEnabled": true,
"intercompanyPartnerRequired": false,
"taxId": "3445O3453",
"countryIso2": "PK",
"coaCode": "COA-PKR",
"coaName": "PK Starter CoA",
"bookCode": "BOOK-PKR",
"bookName": "PK Local Book",
"policyPackId": "TR_UNIFORM_V1",
"defaultAccounts": [
{
"code": "100",
"name": "KASA",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "101",
"name": "ALINAN CEKLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "102",
"name": "BANKALAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "103",
"name": "VERILEN CEK ve ODEME EMRI (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "108",
"name": "DIGER HAZIR DEGERLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "110",
"name": "HISSE SENETLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "111",
"name": "OZEL KESIM TAHVIL SNT.VE BONO.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "112",
"name": "KAMU KESIMI TAHVIL SNT.VE BONO",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "118",
"name": "DIGER MENKUL KIYMETLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "119",
"name": "MENKUL KIY.DEGER DUS.KAR.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "120",
"name": "ALICILAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "121",
"name": "ALACAK SENETLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "122",
"name": "ALACAK SENETLERI REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "124",
"name": "KAZANILMAMIS FIN.KIRA.FZ.GL(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "126",
"name": "VERILEN DEPOZITO VE TEMINATLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "127",
"name": "DIGER TICARI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "128",
"name": "SUPHELI TICARI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "129",
"name": "SUPHELI TIC.AL. KARSIGI (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "131",
"name": "ORTAKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "132",
"name": "ISTIRAKLERDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "133",
"name": "BAGLI ORTAKLIKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "135",
"name": "PERSONELDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "136",
"name": "DIGER CESITLI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "137",
"name": "DIGER ALACAK SNT.REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "138",
"name": "SUPHELI DIGER ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "139",
"name": "SUPHELI DIGER ALACAK.KARS.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "150",
"name": "ILK MADDE VE MALZEME",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "151",
"name": "YARI MAMULLER - URETIM",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "152",
"name": "MAMULLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "153",
"name": "TICARI MALLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "157",
"name": "DIGER STOKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "158",
"name": "STOK DEGER DUSUKLUGU KARS.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "159",
"name": "VERILEN SIPARIS AVANSLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "170",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "171",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "172",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "173",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "174",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "175",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "176",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "177",
"name": "YILLARA YAY. INS.VE ON.MALIYET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "178",
"name": "YILLARA YAY.INS.ENF.DUZELT.HES",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "179",
"name": "TASERONLARA VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "180",
"name": "GELECEK AYLARA AIT GIDERLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "181",
"name": "GELIR TAHAKKUKLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "190",
"name": "DEVREDEN KATMA DEGER VERGISI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "191",
"name": "INDIRILECEK KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "192",
"name": "DIGER KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "193",
"name": "PESIN ODENEN VERGI VE FONLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "195",
"name": "IS AVANSLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "196",
"name": "PERSONEL AVANSLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "197",
"name": "SAYIM VE TESELLUM NOKSANLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "198",
"name": "DIGER CESITLI DONEN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "199",
"name": "DIGER DONEN VARLIKLAR KRS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "220",
"name": "ALICILAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "221",
"name": "ALACAK SENETLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "222",
"name": "ALACAK SENETLERI REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "224",
"name": "KAZANILMAMIS FIN.KIRA.FZ.GL(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "226",
"name": "VERILEN DEPOZITO VE TEMINATLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "229",
"name": "SUPHELI ALACAKLAR KARSILIGI(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "231",
"name": "ORTAKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "232",
"name": "ISTIRAKLERDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "233",
"name": "BAGLI ORTAKLIKLARDAN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "235",
"name": "PERSONELDEN ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "236",
"name": "DIGER CESITLI ALACAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "237",
"name": "DIGER ALACAK SNT.REESKONTU (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "239",
"name": "SUPHELI DIGER ALACAK.KARS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "240",
"name": "BAGLI MENKUL KIYMETLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "241",
"name": "BAGLI MEN.KIY.DEG. DUS.KAR.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "242",
"name": "ISTIRAKLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "243",
"name": "ISTIRAKLERE SERM.TAAHHUT. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "244",
"name": "IST.SERM.PAY.DEG.DUSUK.KRS.(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "245",
"name": "BAGLI ORTAKLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "246",
"name": "BAGLI ORTAK.SER.TAAHHUTLERI(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "247",
"name": "BAG.ORT.SER.PAY.DEG.DUS.KRS(-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "248",
"name": "DIGER MALI DURAN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "249",
"name": "DGR.MALI DURAN VARLIK.KRS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "250",
"name": "ARAZI VE ARSALAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "251",
"name": "YERALTI VE YERUSTU DUZENLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "252",
"name": "BINALAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "253",
"name": "TESIS MAKINE VE CIHAZLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "254",
"name": "TASITLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "255",
"name": "DEMIRBASLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "256",
"name": "DIGER MADDI DURAN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "257",
"name": "BIRIKMIS AMORTISMANLAR (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "258",
"name": "YAPILMAKTA OLAN YATIRIMLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "259",
"name": "VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "260",
"name": "HAKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "261",
"name": "SEREFIYE",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "262",
"name": "KURULUS VE ORGUTLENME GIDER.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "263",
"name": "ARASTIRMA VE GELISTIRME GIDER.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "264",
"name": "OZEL MALIYETLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "265",
"name": "FINANSAL KIRALAMA KONUSU SABIT KIYMET",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "267",
"name": "DIGER.MADDI OLM. DURAN VARLIK.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "268",
"name": "BIRIKMIS AMORTISMANLAR (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "269",
"name": "VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "271",
"name": "ARAMA GIDERLERI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "272",
"name": "HAZIRLIK VE GELISTIRME GIDER.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "277",
"name": "DIGER OZEL TUKENMEYE TABI VAR.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "278",
"name": "BIRIKMIS TUKENME PAYLARI (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "279",
"name": "VERILEN AVANSLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "280",
"name": "GELECEK YILLARA AIT GIDERLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "281",
"name": "GELIR TAAHHUKLARI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "291",
"name": "GELECEK YILLARDA INDIRILE. KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "292",
"name": "DIGER KDV",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "293",
"name": "GELECEK YILLAR IHTIYACI STOK.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "294",
"name": "ELD.CIK.STOK.VE MAD.DURAN VAR.",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "295",
"name": "PESIN ODENEN VERGILER VE FON",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "297",
"name": "DIGER CESITLI DURAN VARLIKLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "298",
"name": "STOK DEGER DUSUKLUGU KARS. (-)",
"accountType": "ASSET",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "299",
"name": "BIRIKMIS AMORTISMANLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "300",
"name": "BANKA KREDILERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "301",
"name": "FINANSAL KIRALAMA ISL.BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "302",
"name": "ERTELEN.FIN.KIRA.BORC.MAL. (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "303",
"name": "UZUN VAD.KRD.ANAP.TAKS.VE FAIZ",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "304",
"name": "TAHVIL ANAP.BORC TAK.VE FAIZ.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "305",
"name": "CIKARILMIS BONOLAR VE SENETLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "306",
"name": "CIKARILMIS DIGER MENKUL KIYM.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "308",
"name": "MENKUL KIYMET. IHRAC FARKI (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "309",
"name": "DIGER MALI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "320",
"name": "SATICILAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "321",
"name": "BORC SENETLERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "322",
"name": "BORC SENETLERI REESKONTU (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "326",
"name": "ALINAN DEPOZITO VE TEMINATLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "329",
"name": "DIGER TICARI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "331",
"name": "ORTAKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "332",
"name": "ISTIRAKLERE BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "333",
"name": "BAGLI ORTAKLIKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "335",
"name": "PERSONELE BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "336",
"name": "DIGER CESITLI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "337",
"name": "DIGER BORC.SENET.REESKONTU (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "340",
"name": "ALINAN SIPARIS AVANSLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "349",
"name": "ALINAN DIGER AVANSLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "350",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "351",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "352",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "353",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "354",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "355",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "356",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "357",
"name": "YILLARA YAY.INS.ve ONR.HAKEDIS",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "358",
"name": "YILLARA YAY.INS.ENF.DUZELT.HES",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "360",
"name": "ODENECEK VERGI VE FONLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "361",
"name": "ODENECEK SOS. GUV. KESINTILERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "368",
"name": "VD.GEC.ER.VEYA TK.VR.VE DG.YUK",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "369",
"name": "ODENECEK DIGER YUKUMLULUKLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "370",
"name": "DON.KARI VER.VE DIG.YUK.KARS.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "371",
"name": "DON.KAR.PES.OD.VER.VE YUK (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "372",
"name": "KIDEM TAZMINATI KARSILIGI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "373",
"name": "MALIYET GIDERLERI KARSILIGI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "379",
"name": "DIGER BORC VE GIDER KARSILIGI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "380",
"name": "GELECEK AYLARA AIT GELIRLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "381",
"name": "GIDER TAHAKKUKLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "391",
"name": "HESAPLANAN KDV",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "392",
"name": "DIGER KDV",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "393",
"name": "MERKEZ VE SUBELER CARI HESABI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "397",
"name": "SAYIM VE TESELLUM FAZLALARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "399",
"name": "DIGER CESITLI YAB. KAYNAKLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "400",
"name": "BANKA KREDILERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "401",
"name": "FINANSAL KIRALAMA ISL.BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "402",
"name": "ERTELEN.FIN.KIRA.BORC.MAL. (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "405",
"name": "CIKARILMIS TAHVILLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "407",
"name": "CIKARILMIS DGR.MENKUL KIYMET.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "408",
"name": "MENKUL KIYMET.IHRAC FARKI (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "409",
"name": "DIGER MALI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "420",
"name": "SATICILAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "421",
"name": "BORC SENETLERI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "422",
"name": "BORC SENETLERI REESKONTU (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "426",
"name": "ALINAN DEPOZITO VE TEMINATLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "429",
"name": "DIGER TICARI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "431",
"name": "ORTAKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "432",
"name": "ISTIRAKLERE BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "433",
"name": "BAGLI ORTAKLIKLARA BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "436",
"name": "DIGER CESITLI BORCLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "437",
"name": "DIGER BORC SENETLERI REES. (-)",
"accountType": "LIABILITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "438",
"name": "KAMUYA OL.ERT.VEYA TAKSIT.BORC",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "440",
"name": "ALINAN SIPARIS AVANSLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "449",
"name": "ALINAN DIGER AVANSLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "472",
"name": "KIDEM TAZMINATI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "479",
"name": "DIGER BORC VE GIDER KARSILIK.",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "480",
"name": "GELECEK YILLARA AIT GELIRLER",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "481",
"name": "GIDER TAHAKKUKLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "492",
"name": "GEL.YIL.ERT.VEYA TERKIN ED.KDV",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "493",
"name": "TESISE KATILMA PAYLARI",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "499",
"name": "DI.CES.UZUN VAD.YAB.KAYNAKLAR",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "500",
"name": "SERMAYE",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "501",
"name": "ODENMEMIS SERMAYE (-)",
"accountType": "EQUITY",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "502",
"name": "SERMAYE DUZELT.OLUMLU FARKLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "503",
"name": "SERMAYE DUZELT.OLUMSUZ FARKLARI (-)",
"accountType": "EQUITY",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "520",
"name": "HISSE SENETLERI IHRAC PRIMLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "521",
"name": "HISSE SENEDI IPTAL KARLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "522",
"name": "M.D.V.YENIDEN DEGERLEME ARTIS.",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "523",
"name": "ISTIRAKLER YENIDEN DEGER.ART.",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "524",
"name": "MALIYET ARTISLARI FONU",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "529",
"name": "DIGER SERMAYE YEDEKLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "540",
"name": "YASAL YEDEKLER",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "541",
"name": "STATU YEDEKLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "542",
"name": "OLAGANUSTU YEDEKLER",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "548",
"name": "DIGER KAR YEDEKLERI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "549",
"name": "OZEL FONLAR",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "570",
"name": "GECMIS YILLAR KARLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "580",
"name": "GECMIS YILLAR ZARARLARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "590",
"name": "DONEM NET KARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "591",
"name": "DONEM NET ZARARI (-)",
"accountType": "EQUITY",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "600",
"name": "YURT ICI SATISLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "601",
"name": "YURT DISI SATISLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "602",
"name": "DIGER GELIRLER",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "610",
"name": "SATISTAN IADELER (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "611",
"name": "SATIS ISKONTOLARI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "612",
"name": "DIGER INDIRIMLER (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "620",
"name": "SATILAN MAMULLER MALIYETI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "621",
"name": "SATILAN TIC.MALLAR MALIYETI(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "622",
"name": "SATILAN HIZMET MALIYETI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "623",
"name": "DIGER SATISLARIN MALIYETI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "630",
"name": "ARASTIRMA VE GELISTIRME GID(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "631",
"name": "PAZARLAMA SAT.VE DAG.GID. (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "632",
"name": "GENEL YONETIM GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "640",
"name": "ISTIRAKLERDEN TEMETTU GELIR.",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "641",
"name": "BAGLI ORT.TEMETTU GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "642",
"name": "FAIZ GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "643",
"name": "KOMISYON GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "644",
"name": "KONUSU KALMAYAN KARSILIKLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "645",
"name": "MENKUL KIYMETLER SATIS KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "646",
"name": "KAMBIYO KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": true
},
{
"code": "647",
"name": "REESKONT FAIZ GELIRLERI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "648",
"name": "ENFLASYON DUZELTMESI KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "649",
"name": "DIGER OLAGAN GELIR VE KARLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "653",
"name": "KOMISYON GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "654",
"name": "KARSILIK GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "655",
"name": "MENKUL KIYMET SATIS ZARAR (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "656",
"name": "KAMBIYO ZARARLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "657",
"name": "REESKONT FAIZ GIDERLERI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "658",
"name": "ENFLASYON DUZELT.ZARARLARI (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "659",
"name": "DIGER GIDER VE ZARARLAR (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "660",
"name": "KISA VADELI BORCLANMA GID. (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "661",
"name": "UZUN VADELI BORCLANMA GID. (-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "671",
"name": "ONCEKI DONEM GELIR VE KARLARI",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "679",
"name": "DIG.OLAGANDISI GELIR VE KARLAR",
"accountType": "REVENUE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "680",
"name": "CALISMAYAN KISIM GID.VE ZAR(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "681",
"name": "ONCEKI DON.GID.VE ZARARLARI(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "689",
"name": "DIGER O.DISI GID.VE ZARAR.(-)",
"accountType": "EXPENSE",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "690",
"name": "DONEM KARI VEYA ZARARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "691",
"name": "D.K.VER.VE DIG.YAS.YUK.KAR.(-)",
"accountType": "REVENUE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "692",
"name": "DONEM NET KARI VE ZARARI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "697",
"name": "YILLARA YAY.INS.ENF.DUZELT.HES",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "698",
"name": "ENFLASYON DUZELTME HESABI",
"accountType": "EQUITY",
"normalSide": "CREDIT",
"allowPosting": false
},
{
"code": "700",
"name": "MALIYET MUHASEBESI BAGLANTI HS",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "701",
"name": "MALIYET MUHASEBESI YANSITMA HS",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "710",
"name": "DIREKT ILK MADDE VE MALZEME GD",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "711",
"name": "DIREKT ILK MAD.VE MAL.YANS.FAR",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "712",
"name": "DIREKT ILK MAD.VE MAL.FIAT FAR",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "713",
"name": "DIREKT ILK MAD.VE MAL.MIK.FAR.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "720",
"name": "DIREKT ISCILIK GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "721",
"name": "DIREKT ISCILIK GID.YANSIT.HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "722",
"name": "DIREKT ISCILIK UCRET FARKLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "723",
"name": "DIREKT ISCILIK SURE FARKLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "730",
"name": "GENEL URETIM GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "731",
"name": "GENEL URETIM GID.YANSITMA HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "732",
"name": "GENEL URETIM GID.BUTCE FARK.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "733",
"name": "GENEL URETIM GIDERLERI VER.FRK",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "734",
"name": "GENEL URETIM GID.KAPASITE FRK.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "740",
"name": "HIZMET URETIM MALIYETI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "741",
"name": "HIZMET URETIM MAL.YAN.HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "742",
"name": "HIZMET URET.MAL.FARK HESAPLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "750",
"name": "ARASTIRMA VE GELISTIRME GIDER.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "751",
"name": "ARAS.VE GELIS.GID.YANS.HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "752",
"name": "ARAS.VE GELIS.GIDER FARKLARI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "760",
"name": "PAZARLAMA SATIS VE DAGITIM GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "761",
"name": "PAZARLAMA SAT.VE DAG.GID.YANSITMA HS",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "762",
"name": "PAZARLAMA SAT.VE DAG.GID.FARK HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "770",
"name": "GENEL YONETIM GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": true
},
{
"code": "771",
"name": "GEN.YON.GID.YANSITMA HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "772",
"name": "GENEL YONETIM GID.FARKLARI HS.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "780",
"name": "FINANSMAN GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "781",
"name": "FINANSMAN GIDERLERI YANSITMA HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "782",
"name": "FINANSMAN GIDERLERI FARK HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "790",
"name": "ILK MADDE VE MALZEME GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "791",
"name": "ISCI UCRET VE GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "792",
"name": "MEMUR UCRET VE GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "793",
"name": "DIS. SAGL. FAYDA VE HIZMETLER",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "794",
"name": "CESITLI GIDERLER",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "795",
"name": "VERGI RESIM VE HARCLAR",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "796",
"name": "AMORTISMANLAR VE TUKENME PAYL.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "797",
"name": "FINANSMAN GIDERLERI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "798",
"name": "GIDER CESITLERI YANSITMA HES.",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "799",
"name": "URETIM MALIYET HESABI",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "800",
"name": "YONETIM MUHASEBESI HESAPLARI - SERBEST",
"accountType": "EXPENSE",
"normalSide": "DEBIT",
"allowPosting": false
},
{
"code": "900",
"name": "NAZIM HESAPLAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": false
}
],
"branches": [
{
"code": "ISL",
"name": "ISLAMANAD ERKEK OKULU",
"unitType": "BRANCH",
"hasSubledger": true
},
{
"code": "KRC",
"name": "KARACHI ERKEK OKULU",
"unitType": "BRANCH",
"hasSubledger": true
}
]
}
]
}
3-Request URL
http://localhost:3000/api/v1/workflows/definitions
Request Method
POST
{
"code": "AİUEA",
"name": "UEİA",
"processType": "PERIOD_CLOSE",
"isActive": true,
"versionNo": 1
}
4-Request URL
http://localhost:3000/api/v1/workflows/definitions
Request Method
POST
{
"code": "AİUEAA",
"name": "UEİAA",
"processType": "CONSOLIDATION_RUN",
"isActive": true,
"versionNo": 1
}

5-Request URL
http://localhost:3000/api/v1/workflows/definitions/1/steps
Request Method
POST
{
"steps": [
{
"stepNo": 1,
"stageScopeType": "OPERATING_UNIT",
"requiredPermissionCode": "gl.period.close",
"minApproverCount": 1,
"allowSelfApprove": false
},
{
"stepNo": 2,
"stageScopeType": "LEGAL_ENTITY",
"requiredPermissionCode": "gl.period.close",
"minApproverCount": 1,
"allowSelfApprove": false
},
{
"stepNo": 3,
"stageScopeType": "GROUP",
"requiredPermissionCode": "gl.period.close",
"minApproverCount": 1,
"allowSelfApprove": false
}
]
}
6-Request URL
http://localhost:3000/api/v1/workflows/definitions/2/steps
Request Method
POST
{
"steps": [
{
"stepNo": 1,
"stageScopeType": "OPERATING_UNIT",
"requiredPermissionCode": "consolidation.run.finalize",
"minApproverCount": 1,
"allowSelfApprove": false
},
{
"stepNo": 2,
"stageScopeType": "LEGAL_ENTITY",
"requiredPermissionCode": "consolidation.run.finalize",
"minApproverCount": 1,
"allowSelfApprove": false
},
{
"stepNo": 3,
"stageScopeType": "GROUP",
"requiredPermissionCode": "consolidation.run.finalize",
"minApproverCount": 1,
"allowSelfApprove": false
}
]
}

7-Request URL
http://localhost:3000/api/v1/workflows/assignments
Request Method
POST
{
"processType": "PERIOD_CLOSE",
"workflowDefinitionId": 1,
"effectiveFrom": "2026-03-05",
"status": "ACTIVE"
}
8-Request URL
http://localhost:3000/api/v1/workflows/assignments
Request Method
POST
{
"processType": "CONSOLIDATION_RUN",
"workflowDefinitionId": 2,
"effectiveFrom": "2026-03-05",
"status": "ACTIVE"
}
9/Request URL
http://localhost:3000/api/v1/org/shareholder-journal-config
Request Method
POST
{
"legalEntityId": 1,
"capitalCreditParentAccountId": 186,
"commitmentDebitParentAccountId": 187
}
10-Request URL
http://localhost:3000/api/v1/org/shareholder-journal-config
Request Method
POST
{
"legalEntityId": 2,
"capitalCreditParentAccountId": 474,
"commitmentDebitParentAccountId": 475
}
11-Request URL
http://localhost:3000/api/v1/org/shareholders/auto-provision-sub-accounts
Request Method
POST
{
"legalEntityId": 2,
"shareholderCode": "01",
"shareholderName": "UFUK"
}
12-Request URL
http://localhost:3000/api/v1/org/shareholders/auto-provision-sub-accounts
Request Method
POST
{
"legalEntityId": 1,
"shareholderCode": "01",
"shareholderName": "UFUK"
}
13-Request URL
http://localhost:3000/api/v1/org/shareholders
Request Method
POST
{
"legalEntityId": 1,
"code": "01",
"name": "UFUK",
"shareholderType": "INDIVIDUAL",
"commitmentDate": "2026-03-05",
"committedCapital": 1000000,
"capitalSubAccountId": 1155,
"commitmentDebitSubAccountId": 1156,
"autoCommitmentJournal": false,
"currencyCode": "AFN",
"status": "ACTIVE"
}
14-Request URL
http://localhost:3000/api/v1/org/shareholders/commitment-journal-batch/preview
Request Method
POST
{
"legalEntityId": 1,
"shareholderIds": [
1
],
"commitmentDate": "2026-03-05"
}
15-Request URL
http://localhost:3000/api/v1/org/shareholders/commitment-journal-batch
Request Method
POST
{
"legalEntityId": 1,
"shareholderIds": [
1
],
"commitmentDate": "2026-03-05"
}
16-Request URL
http://localhost:3000/me/preferences
Request Method
PUT
{
"workingContext": {
"legalEntityId": "1",
"operatingUnitId": "",
"fiscalCalendarId": "1",
"fiscalPeriodId": "12",
"dateFrom": "",
"dateTo": ""
}
}
17-Request URL
http://localhost:3000/api/v1/org/shareholders/commitment-journal-batch/preview
Request Method
POST
{
"legalEntityId": 2,
"shareholderIds": [
2
],
"commitmentDate": "2026-03-05"
}
18-Request URL
http://localhost:3000/api/v1/org/shareholders/commitment-journal-batch
Request Method
POST
{
"legalEntityId": 2,
"shareholderIds": [
2
],
"commitmentDate": "2026-03-05"
}
19-Request URL
http://localhost:3000/api/v1/gl/journals/1/post
Request Method
POST
{
"postLinkedMirrors": false
}
20-Request URL
http://localhost:3000/api/v1/gl/journals/2/post
Request Method
POST
{
"postLinkedMirrors": false
}
21-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "120.01",
"name": "AHMET BALLI",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 11
}
22-Request URL
http://localhost:3000/api/v1/cari/counterparties
Request Method
POST
{
"legalEntityId": 1,
"primaryOperatingUnitId": 1,
"operatingUnitIds": [1],
"code": "AHM",
"name": "AHMET BALLI",
"isCustomer": true,
"isVendor": false,
"status": "ACTIVE",
"taxId": "23423423",
"email": "ahmetballi@gmail.com",
"phone": "3242342342",
"notes": null,
"defaultCurrencyCode": "AFN",
"defaultPaymentTermId": 3,
"arAccountId": 1165,
"apAccountId": null,
"contacts": [],
"addresses": []
}
23-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 2,
"code": "120.01",
"name": "Nail Ayyas",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 299
}
24-Request URL
http://localhost:3000/api/v1/cari/counterparties
Request Method
POST
{
"legalEntityId": 2,
"primaryOperatingUnitId": 3,
"operatingUnitIds": [3],
"code": "SFK",
"name": "NAIL AYYAS",
"isCustomer": true,
"isVendor": false,
"status": "ACTIVE",
"taxId": "234234245",
"email": "nail@gmail.com",
"phone": "32ı4435234523",
"notes": null,
"defaultCurrencyCode": "PKR",
"defaultPaymentTermId": null,
"arAccountId": 1166,
"apAccountId": null,
"contacts": [],
"addresses": []
}
25-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "320.01",
"name": "TÜRK TELEKOM",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true,
"parentAccountId": 121
}
26-Request URL
http://localhost:3000/api/v1/cari/counterparties
Request Method
POST
{
"legalEntityId": 1,
"primaryOperatingUnitId": 1,
"operatingUnitIds": [1],
"code": "TTNET",
"name": "TÜRK TELEKOM",
"isCustomer": false,
"isVendor": true,
"status": "ACTIVE",
"taxId": "234234324",
"email": "ttnet@gmail.com",
"phone": null,
"notes": null,
"defaultCurrencyCode": "AFN",
"defaultPaymentTermId": 3,
"arAccountId": null,
"apAccountId": 1167,
"contacts": [],
"addresses": []
}
27-Request URL
http://localhost:3000/api/v1/cari/counterparties
Request Method
POST
{
"legalEntityId": 2,
"primaryOperatingUnitId": 3,
"operatingUnitIds": [3],
"code": "PKMRK",
"name": "PAK MARKET",
"isCustomer": false,
"isVendor": true,
"status": "ACTIVE",
"taxId": "324325346",
"email": "pkr@gmail.com",
"phone": "35345345",
"notes": null,
"defaultCurrencyCode": "PKR",
"defaultPaymentTermId": null,
"arAccountId": null,
"apAccountId": 1168,
"contacts": [],
"addresses": []
}
28-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 2,
"code": "320.01",
"name": "PAK MARKET",
"accountType": "LIABILITY",
"normalSide": "CREDIT",
"allowPosting": true,
"parentAccountId": 409
}
29-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "100.01",
"name": "AFN KASA",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 1
}
30-Request URL
http://localhost:3000/api/v1/cash/registers
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"accountId": 1169,
"code": "KBLERK",
"name": "AFN KASA",
"registerType": "DRAWER",
"sessionMode": "REQUIRED",
"currencyCode": "AFN",
"status": "ACTIVE",
"allowNegative": false,
"varianceGainAccountId": null,
"varianceLossAccountId": null,
"maxTxnAmount": null,
"requiresApprovalOverAmount": null
}
31-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "100.02",
"name": "USD KASA",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 1
}
32-Request URL
http://localhost:3000/api/v1/cash/registers
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"accountId": 1170,
"code": "KKBLERKU",
"name": "USD KASA",
"registerType": "DRAWER",
"sessionMode": "REQUIRED",
"currencyCode": "USD",
"status": "ACTIVE",
"allowNegative": false,
"varianceGainAccountId": null,
"varianceLossAccountId": null,
"maxTxnAmount": null,
"requiresApprovalOverAmount": null
}
33-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "100.03",
"name": "AFN KASA MEZAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 1
}
34-Request URL
http://localhost:3000/api/v1/cash/registers
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 2,
"accountId": 1171,
"code": "MZRAFN",
"name": "AFN KASA",
"registerType": "DRAWER",
"sessionMode": "REQUIRED",
"currencyCode": "AFN",
"status": "ACTIVE",
"allowNegative": false,
"varianceGainAccountId": null,
"varianceLossAccountId": null,
"maxTxnAmount": null,
"requiresApprovalOverAmount": null
}
35-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "100.04",
"name": "USD KASA MEZAR",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 1
}
36-Request URL
http://localhost:3000/api/v1/cash/registers
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 2,
"accountId": 1172,
"code": "MZRUSD",
"name": "USD KASA",
"registerType": "DRAWER",
"sessionMode": "REQUIRED",
"currencyCode": "USD",
"status": "ACTIVE",
"allowNegative": false,
"varianceGainAccountId": null,
"varianceLossAccountId": null,
"maxTxnAmount": null,
"requiresApprovalOverAmount": null
}
37-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 2,
"code": "100.01",
"name": "AFN KASA ISLAMABAD",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 289
}
38-Request URL
http://localhost:3000/api/v1/cash/registers
Request Method
POST
{
"legalEntityId": 2,
"operatingUnitId": 3,
"accountId": 1173,
"code": "ISLMAFN",
"name": "PKR KASA",
"registerType": "DRAWER",
"sessionMode": "REQUIRED",
"currencyCode": "PKR",
"status": "ACTIVE",
"allowNegative": false,
"varianceGainAccountId": null,
"varianceLossAccountId": null,
"maxTxnAmount": null,
"requiresApprovalOverAmount": null
}
39-Request URL
http://localhost:3000/api/v1/cash/sessions/open
Request Method
POST
{
"registerId": 4,
"openingAmount": 0
}
40-Request URL
http://localhost:3000/api/v1/cash/sessions/open
Request Method
POST
{
"registerId": 5
}
41-Request URL
http://localhost:3000/api/v1/cash/sessions/open
Request Method
POST
{
"registerId": 7
}
42-Request URL
http://localhost:3000/api/v1/cash/sessions/open
Request Method
POST
{
"registerId": 8
}
43-Request URL
http://localhost:3000/api/v1/gl/journals
Request Method
POST
{
"legalEntityId": 1,
"bookId": 1,
"fiscalPeriodId": 3,
"entryDate": "2026-03-06",
"documentDate": "2026-03-05",
"currencyCode": "AFN",
"sourceType": "MANUAL",
"description": "Opening entry",
"overrideCashControl": true,
"overrideReason": "AÇILIŞ FİŞİ",
"lines": [
{
"accountId": 1169,
"operatingUnitId": 1,
"subledgerReferenceNo": "SLR-KEO-20260305-230YXTXLB",
"description": "TAAHÜT ÖDEMESİ",
"currencyCode": "AFN",
"amountTxn": 1000000,
"debitBase": 1000000,
"creditBase": 0
},
{
"accountId": 1156,
"description": "TAAHÜT ÖDEMESİ",
"currencyCode": "AFN",
"amountTxn": -1000000,
"debitBase": 0,
"creditBase": 1000000
}
]
}
44-Request URL
http://localhost:3000/api/v1/gl/journals/43/post
Request Method
POST
{
"overrideCashControl": true,
"overrideReason": "AÇILIŞ FİŞİ"
}
45-Request URL
http://localhost:3000/api/v1/gl/journals
Request Method
POST
{
"legalEntityId": 2,
"bookId": 2,
"fiscalPeriodId": 3,
"entryDate": "2026-03-06",
"documentDate": "2026-03-05",
"currencyCode": "PKR",
"sourceType": "MANUAL",
"description": "Opening entry",
"overrideCashControl": true,
"overrideReason": "AÇILIŞ KAYDI",
"lines": [
{
"accountId": 1173,
"operatingUnitId": 3,
"subledgerReferenceNo": "SLR-ISL-20260305-666FHBUIQ",
"description": "TAAHÜT ÖDEMESİ",
"currencyCode": "PKR",
"amountTxn": 1500000,
"debitBase": 1500000,
"creditBase": 0
},
{
"accountId": 1154,
"description": "TAAHÜT ÖDEMESİ",
"currencyCode": "PKR",
"amountTxn": -1500000,
"debitBase": 0,
"creditBase": 1500000
}
]
}
46-Request URL
http://localhost:3000/api/v1/gl/journals/44/post
Request Method
POST
{
"overrideCashControl": true,
"overrideReason": "AÇILIŞ KAYDI"
}
47-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "108.01",
"name": "DÖVİZ CLEARINCE",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 5
}
48-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 2,
"code": "108.01",
"name": "DOVIIZ CLEARANCE",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 293
}
49-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "108.02",
"name": "ÅžUBELER ARASI TRANSFERLER",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 5
}
50-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 5,
"paymentTermId": 3,
"direction": "AP",
"documentType": "INVOICE",
"documentDate": "2026-03-05",
"dueDate": "2026-03-11",
"amountTxn": 150000,
"amountBase": 150000,
"currencyCode": "AFN",
"fxRate": null
}
51-Request URL
http://localhost:3000/api/v1/cari/documents/21/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "770"
}
52-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 5,
"paymentTermId": 3,
"direction": "AP",
"documentType": "INVOICE",
"documentDate": "2026-03-05",
"dueDate": "2026-03-11",
"amountTxn": 10000,
"amountBase": 650000,
"currencyCode": "USD",
"fxRate": 65
}
53-Request URL
http://localhost:3000/api/v1/cari/documents/22/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "770"
}
54-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 1,
"paymentTermId": 3,
"direction": "AR",
"documentType": "INVOICE",
"documentDate": "2026-03-07",
"dueDate": "2026-03-08",
"amountTxn": 150000,
"amountBase": 150000,
"currencyCode": "AFN",
"fxRate": null
}
55-Request URL
http://localhost:3000/api/v1/cari/documents/3/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "600"
}
56-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 1,
"paymentTermId": 3,
"direction": "AR",
"documentType": "INVOICE",
"documentDate": "2026-03-07",
"dueDate": "2026-03-08",
"amountTxn": 20000,
"amountBase": 1300000,
"currencyCode": "USD",
"fxRate": 65
}
57-Request URL
http://localhost:3000/api/v1/cari/documents/4/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "600"
}
58-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 2,
"operatingUnitId": 3,
"counterpartyId": 4,
"paymentTermId": 8,
"direction": "AP",
"documentType": "INVOICE",
"documentDate": "2026-03-07",
"dueDate": "2026-03-09",
"amountTxn": 120000,
"amountBase": 120000,
"currencyCode": "PKR",
"fxRate": null
}
59-Request URL
http://localhost:3000/api/v1/cari/documents/5/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "770"
}
60-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 2,
"operatingUnitId": 3,
"counterpartyId": 4,
"paymentTermId": null,
"direction": "AP",
"documentType": "INVOICE",
"documentDate": "2026-03-07",
"dueDate": "2026-03-08",
"amountTxn": 10000,
"amountBase": 1770000,
"currencyCode": "USD",
"fxRate": 177
}
61-Request URL
http://localhost:3000/api/v1/cari/documents/6/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "770"
}
62-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 2,
"operatingUnitId": 3,
"counterpartyId": 2,
"paymentTermId": 8,
"direction": "AR",
"documentType": "INVOICE",
"documentDate": "2026-03-07",
"dueDate": "2026-03-08",
"amountTxn": 50000,
"amountBase": 50000,
"currencyCode": "PKR",
"fxRate": null
}
63-Request URL
http://localhost:3000/api/v1/cari/documents/7/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "600"
}
64-Request URL
http://localhost:3000/api/v1/cari/documents
Request Method
POST
{
"legalEntityId": 2,
"operatingUnitId": 3,
"counterpartyId": 2,
"paymentTermId": null,
"direction": "AR",
"documentType": "INVOICE",
"documentDate": "2026-03-07",
"dueDate": "2026-03-08",
"amountTxn": 30000,
"amountBase": 5310000,
"currencyCode": "USD",
"fxRate": 177
}
65-Request URL
http://localhost:3000/api/v1/cari/documents/8/post
Request Method
POST
{
"useFxOverride": false,
"fxOverrideReason": null,
"offsetAccountCode": "600"
}
66-Request URL
http://localhost:3000/api/v1/fx/rates/bulk-upsert
Request Method
POST
{
"rates": [
{
"rateDate": "2026-03-08",
"fromCurrencyCode": "USD",
"toCurrencyCode": "PKR",
"rateType": "SPOT",
"value": 200
}
]
}
67-Request URL
http://localhost:3000/api/v1/fx/rates/bulk-upsert
Request Method
POST
{
"rates": [
{
"rateDate": "2026-03-09",
"fromCurrencyCode": "USD",
"toCurrencyCode": "PKR",
"rateType": "SPOT",
"value": 200
}
]
}
68-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 2,
"code": "100.02",
"name": "KASA USD",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 289
}
69-Request URL
http://localhost:3000/api/v1/cash/registers
Request Method
POST
{
"legalEntityId": 2,
"operatingUnitId": 3,
"accountId": 592,
"code": "ISLMUSD",
"name": "KASA USD",
"registerType": "DRAWER",
"sessionMode": "REQUIRED",
"currencyCode": "USD",
"status": "ACTIVE",
"allowNegative": false,
"varianceGainAccountId": null,
"varianceLossAccountId": null,
"maxTxnAmount": null,
"requiresApprovalOverAmount": null
}
70-Request URL
http://localhost:3000/api/v1/cash/sessions/open
Request Method
POST
{
"registerId": 6
}
71-Request URL
http://localhost:3000/api/v1/cari/settlements/apply
Request Method
POST
{
"legalEntityId": 2,
"operatingUnitId": 3,
"counterpartyId": 2,
"direction": "AR",
"settlementDate": "2026-03-08",
"currencyCode": "USD",
"incomingAmountTxn": 20250,
"idempotencyKey": "CARI-SET-1772907018860-wompka8r",
"autoAllocate": true,
"useUnappliedCash": false,
"allocations": [],
"paymentChannel": "MANUAL"
}
72-Request URL
http://localhost:3000/api/v1/fx/rates/bulk-upsert
Request Method
POST
{
"rates": [
{
"rateDate": "2026-03-08",
"fromCurrencyCode": "USD",
"toCurrencyCode": "AFN",
"rateType": "SPOT",
"value": 65
}
]
}
73-Request URL
http://localhost:3000/api/v1/fx/rates/bulk-upsert
Request Method
POST
{
"rates": [
{
"rateDate": "2026-03-09",
"fromCurrencyCode": "USD",
"toCurrencyCode": "AFN",
"rateType": "SPOT",
"value": 90
}
]
}
74-Request URL
http://localhost:3000/api/v1/cari/settlements/apply
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 3,
"direction": "AP",
"settlementDate": "2026-03-09",
"currencyCode": "AFN",
"incomingAmountTxn": 200000,
"idempotencyKey": "CARI-SET-1772941205021-3tso1q1n",
"autoAllocate": true,
"useUnappliedCash": false,
"allocations": [],
"paymentChannel": "CASH",
"linkedCashTransaction": {
"registerId": 1,
"cashSessionId": 1,
"counterAccountId": 583,
"txnDatetime": "2026-03-08T08:08",
"bookDate": "2026-03-09",
"idempotencyKey": "CARI-CASH-CARI-SET-1772941205021-3tso1q1n",
"integrationEventUid": "CARI-CASH-EVT-CARI-SET-1772941205021-3tso1q1n"
}
}
75-Request URL
http://localhost:3000/api/v1/cari/settlements/apply
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 3,
"direction": "AP",
"settlementDate": "2026-03-09",
"currencyCode": "usd",
"incomingAmountTxn": 9444.44,
"idempotencyKey": "CARI-SET-1772941274120-nrv7sfk9",
"autoAllocate": true,
"useUnappliedCash": false,
"allocations": [],
"paymentChannel": "CASH",
"linkedCashTransaction": {
"registerId": 2,
"cashSessionId": 2,
"counterAccountId": 583,
"txnDatetime": "2026-03-08T08:08",
"bookDate": "2026-03-09",
"idempotencyKey": "CARI-CASH-CARI-SET-1772941274120-nrv7sfk9",
"integrationEventUid": "CARI-CASH-EVT-CARI-SET-1772941274120-nrv7sfk9"
}
}
76-Request URL
http://localhost:3000/api/v1/cari/settlements/apply
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 1,
"direction": "AR",
"settlementDate": "2026-03-09",
"currencyCode": "usd",
"incomingAmountTxn": 15000,
"idempotencyKey": "CARI-SET-1772941466211-7inktxpn",
"autoAllocate": true,
"useUnappliedCash": false,
"allocations": [],
"paymentChannel": "CASH",
"linkedCashTransaction": {
"registerId": 2,
"cashSessionId": 2,
"counterAccountId": 581,
"txnDatetime": "2026-03-08T08:13",
"bookDate": "2026-03-09",
"idempotencyKey": "CARI-CASH-CARI-SET-1772941466211-7inktxpn",
"integrationEventUid": "CARI-CASH-EVT-CARI-SET-1772941466211-7inktxpn"
}
}
77-Request URL
http://localhost:3000/api/v1/cari/settlements/apply
Request Method
POST
{
"legalEntityId": 1,
"operatingUnitId": 1,
"counterpartyId": 1,
"direction": "AR",
"settlementDate": "2026-03-09",
"currencyCode": "afn",
"incomingAmountTxn": 600000,
"idempotencyKey": "CARI-SET-1772941557649-4m9tmghz",
"autoAllocate": true,
"useUnappliedCash": false,
"allocations": [],
"paymentChannel": "CASH",
"linkedCashTransaction": {
"registerId": 1,
"cashSessionId": 1,
"counterAccountId": 581,
"txnDatetime": "2026-03-08T08:13",
"bookDate": "2026-03-09",
"idempotencyKey": "CARI-CASH-CARI-SET-1772941557649-4m9tmghz",
"integrationEventUid": "CARI-CASH-EVT-CARI-SET-1772941557649-4m9tmghz"
}
}
78-Request URL
http://localhost:3000/api/v1/cash/transactions/transit/initiate
Request Method
POST
{
"registerId": 1,
"targetRegisterId": 3,
"transitAccountId": 592,
"cashSessionId": 1,
"txnDatetime": "2026-03-08T08:18",
"bookDate": "2026-03-08",
"amount": 500000,
"currencyCode": "AFN",
"description": "Inter-register transfer",
"note": "Inter-register transfer",
"idempotencyKey": "62d1ea38-a6cd-459e-b806-e4f66441ccab"
}
79-Request URL
http://localhost:3000/api/v1/cash/transactions/5/post
Request Method
POST
{
"overrideCashControl": false
}
80-Request URL
http://localhost:3000/api/v1/cash/transactions/transit/1/receive
Request Method
POST
{
"cashSessionId": 3,
"txnDatetime": "2026-03-08T04:14:00.000Z",
"bookDate": "2026-03-08",
"idempotencyKey": "cash-transit-receive-032effd0-1311-45e0-a685-4b0e374f9fa0"
}
81-Request URL
http://localhost:3000/api/v1/gl/accounts
Request Method
POST
{
"coaId": 1,
"code": "102.01",
"name": "Azizi Bank 9891",
"accountType": "ASSET",
"normalSide": "DEBIT",
"allowPosting": true,
"parentAccountId": 3
}
82-Request URL
http://localhost:3000/api/v1/bank/accounts
Request Method
POST
{
"legalEntityId": 1,
"code": "AFN_MAIN",
"name": "AZIZI BANK",
"currencyCode": "AFN",
"bankName": "Azizi Bank Cor.",
"branchName": "Kabul",
"iban": "1345649891",
"accountNo": "49891",
"isActive": true,
"glAccountId": 594
}
83-Request URL
http://localhost:3000/api/v1/cash/transactions
Request Method
POST
{
"registerId": 1,
"cashSessionId": 1,
"txnType": "DEPOSIT_TO_BANK",
"txnDatetime": "2026-03-08T09:55",
"bookDate": "2026-03-09",
"amount": 100000,
"currencyCode": "AFN",
"description": "Deposit to bank",
"sourceDocType": "BANK_DEPOSIT_SLIP",
"counterAccountId": 594,
"sourceModule": "MANUAL",
"idempotencyKey": "6ef9230f-529c-4762-a885-5cda47b84b67"
}
84-Request URL
http://localhost:3000/api/v1/cash/transactions/7/post
Request Method
POST
{
"overrideCashControl": false
}
