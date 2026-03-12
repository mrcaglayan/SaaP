const CARI_REQUIRED_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_OFFSET",
  "CARI_AP_CONTROL",
  "CARI_AP_OFFSET",
  "CARI_SETTLEMENT_FX_GAIN",
  "CARI_SETTLEMENT_FX_LOSS",
]);

const SHAREHOLDER_REQUIRED_PURPOSE_CODES = Object.freeze([
  "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
  "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
]);

const CASH_CLEARING_PURPOSE_CODES = Object.freeze([
  "CASH_EXCHANGE_CLEARING",
  "CASH_TRANSIT_CLEARING",
]);

const BANK_REQUIRED_PURPOSE_CODES = Object.freeze(["BANK_CONTROL_PARENT"]);

function buildCashClearingTarget({ purposeCode, matchCodes, suggestCode, suggestName }) {
  return Object.freeze({
    purposeCode,
    rules: Object.freeze({
      allowPosting: true,
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    match: Object.freeze({
      codeExact: Object.freeze(matchCodes),
    }),
    suggestCreate: Object.freeze({
      code: suggestCode,
      name: suggestName,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
  });
}

function buildCashClearingModule({
  exchangeMatchCodes,
  transitMatchCodes,
  exchangeSuggestCode,
  transitSuggestCode,
}) {
  return Object.freeze({
    moduleKey: "cashClearing",
    label: "Cash clearing defaults",
    requiredPurposeCodes: Object.freeze([]),
    purposeTargets: Object.freeze([
      buildCashClearingTarget({
        purposeCode: CASH_CLEARING_PURPOSE_CODES[0],
        matchCodes: exchangeMatchCodes,
        suggestCode: exchangeSuggestCode,
        suggestName: "FX Clearing",
      }),
      buildCashClearingTarget({
        purposeCode: CASH_CLEARING_PURPOSE_CODES[1],
        matchCodes: transitMatchCodes,
        suggestCode: transitSuggestCode,
        suggestName: "Cash Transit Clearing",
      }),
    ]),
  });
}

function buildBankControlParentModule({
  matchCodes,
  suggestCode,
  suggestName,
}) {
  return Object.freeze({
    moduleKey: "bankControlParent",
    label: "Bank control parent",
    requiredPurposeCodes: BANK_REQUIRED_PURPOSE_CODES,
    purposeTargets: Object.freeze([
      Object.freeze({
        purposeCode: BANK_REQUIRED_PURPOSE_CODES[0],
        rules: Object.freeze({
          accountType: "ASSET",
        }),
        match: Object.freeze({
          codeExact: Object.freeze(matchCodes),
        }),
        suggestCreate: Object.freeze({
          code: suggestCode,
          name: suggestName,
          accountType: "ASSET",
          normalSide: "DEBIT",
          allowPosting: false,
        }),
      }),
    ]),
  });
}

const STARTER_ACCOUNT_TREES_BY_PACK_ID = Object.freeze({
  TR_UNIFORM_V1: Object.freeze([
    Object.freeze({
      code: "100",
      name: "KASA",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "101",
      name: "ALINAN CEKLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "102",
      name: "BANKALAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "103",
      name: "VERILEN CEK ve ODEME EMRI (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "108",
      name: "DIGER HAZIR DEGERLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "110",
      name: "HISSE SENETLERI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "111",
      name: "OZEL KESIM TAHVIL SNT.VE BONO.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "112",
      name: "KAMU KESIMI TAHVIL SNT.VE BONO",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "118",
      name: "DIGER MENKUL KIYMETLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "119",
      name: "MENKUL KIY.DEGER DUS.KAR.(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "120",
      name: "ALICILAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "121",
      name: "ALACAK SENETLERI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "122",
      name: "ALACAK SENETLERI REESKONTU (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "124",
      name: "KAZANILMAMIS FIN.KIRA.FZ.GL(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "126",
      name: "VERILEN DEPOZITO VE TEMINATLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "127",
      name: "DIGER TICARI ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "128",
      name: "SUPHELI TICARI ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "129",
      name: "SUPHELI TIC.AL. KARSIGI (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "131",
      name: "ORTAKLARDAN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "132",
      name: "ISTIRAKLERDEN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "133",
      name: "BAGLI ORTAKLIKLARDAN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "135",
      name: "PERSONELDEN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "136",
      name: "DIGER CESITLI ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "137",
      name: "DIGER ALACAK SNT.REESKONTU (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "138",
      name: "SUPHELI DIGER ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "139",
      name: "SUPHELI DIGER ALACAK.KARS.(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "150",
      name: "ILK MADDE VE MALZEME",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "151",
      name: "YARI MAMULLER - URETIM",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "152",
      name: "MAMULLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "153",
      name: "TICARI MALLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "157",
      name: "DIGER STOKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "158",
      name: "STOK DEGER DUSUKLUGU KARS.(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "159",
      name: "VERILEN SIPARIS AVANSLARI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "170",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "171",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "172",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "173",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "174",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "175",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "176",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "177",
      name: "YILLARA YAY. INS.VE ON.MALIYET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "178",
      name: "YILLARA YAY.INS.ENF.DUZELT.HES",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "179",
      name: "TASERONLARA VERILEN AVANSLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "180",
      name: "GELECEK AYLARA AIT GIDERLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "181",
      name: "GELIR TAHAKKUKLARI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "190",
      name: "DEVREDEN KATMA DEGER VERGISI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "191",
      name: "INDIRILECEK KDV",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "192",
      name: "DIGER KDV",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "193",
      name: "PESIN ODENEN VERGI VE FONLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "195",
      name: "IS AVANSLARI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "196",
      name: "PERSONEL AVANSLARI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "197",
      name: "SAYIM VE TESELLUM NOKSANLARI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "198",
      name: "DIGER CESITLI DONEN VARLIKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "199",
      name: "DIGER DONEN VARLIKLAR KRS. (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "220",
      name: "ALICILAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "221",
      name: "ALACAK SENETLERI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "222",
      name: "ALACAK SENETLERI REESKONTU (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "224",
      name: "KAZANILMAMIS FIN.KIRA.FZ.GL(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "226",
      name: "VERILEN DEPOZITO VE TEMINATLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "229",
      name: "SUPHELI ALACAKLAR KARSILIGI(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "231",
      name: "ORTAKLARDAN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "232",
      name: "ISTIRAKLERDEN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "233",
      name: "BAGLI ORTAKLIKLARDAN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "235",
      name: "PERSONELDEN ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "236",
      name: "DIGER CESITLI ALACAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "237",
      name: "DIGER ALACAK SNT.REESKONTU (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "239",
      name: "SUPHELI DIGER ALACAK.KARS. (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "240",
      name: "BAGLI MENKUL KIYMETLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "241",
      name: "BAGLI MEN.KIY.DEG. DUS.KAR.(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "242",
      name: "ISTIRAKLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "243",
      name: "ISTIRAKLERE SERM.TAAHHUT. (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "244",
      name: "IST.SERM.PAY.DEG.DUSUK.KRS.(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "245",
      name: "BAGLI ORTAKLIKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "246",
      name: "BAGLI ORTAK.SER.TAAHHUTLERI(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "247",
      name: "BAG.ORT.SER.PAY.DEG.DUS.KRS(-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "248",
      name: "DIGER MALI DURAN VARLIKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "249",
      name: "DGR.MALI DURAN VARLIK.KRS. (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "250",
      name: "ARAZI VE ARSALAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "251",
      name: "YERALTI VE YERUSTU DUZENLERI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "252",
      name: "BINALAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "253",
      name: "TESIS MAKINE VE CIHAZLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "254",
      name: "TASITLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "255",
      name: "DEMIRBASLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "256",
      name: "DIGER MADDI DURAN VARLIKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "257",
      name: "BIRIKMIS AMORTISMANLAR (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "258",
      name: "YAPILMAKTA OLAN YATIRIMLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "259",
      name: "VERILEN AVANSLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "260",
      name: "HAKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "261",
      name: "SEREFIYE",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "262",
      name: "KURULUS VE ORGUTLENME GIDER.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "263",
      name: "ARASTIRMA VE GELISTIRME GIDER.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "264",
      name: "OZEL MALIYETLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "265",
      name: "FINANSAL KIRALAMA KONUSU SABIT KIYMET",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "267",
      name: "DIGER.MADDI OLM. DURAN VARLIK.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "268",
      name: "BIRIKMIS AMORTISMANLAR (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "269",
      name: "VERILEN AVANSLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "271",
      name: "ARAMA GIDERLERI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "272",
      name: "HAZIRLIK VE GELISTIRME GIDER.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "277",
      name: "DIGER OZEL TUKENMEYE TABI VAR.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "278",
      name: "BIRIKMIS TUKENME PAYLARI (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "279",
      name: "VERILEN AVANSLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "280",
      name: "GELECEK YILLARA AIT GIDERLER",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "281",
      name: "GELIR TAAHHUKLARI",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "291",
      name: "GELECEK YILLARDA INDIRILE. KDV",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "292",
      name: "DIGER KDV",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "293",
      name: "GELECEK YILLAR IHTIYACI STOK.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "294",
      name: "ELD.CIK.STOK.VE MAD.DURAN VAR.",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "295",
      name: "PESIN ODENEN VERGILER VE FON",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "297",
      name: "DIGER CESITLI DURAN VARLIKLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "298",
      name: "STOK DEGER DUSUKLUGU KARS. (-)",
      accountType: "ASSET",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "299",
      name: "BIRIKMIS AMORTISMANLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "300",
      name: "BANKA KREDILERI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "301",
      name: "FINANSAL KIRALAMA ISL.BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "302",
      name: "ERTELEN.FIN.KIRA.BORC.MAL. (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "303",
      name: "UZUN VAD.KRD.ANAP.TAKS.VE FAIZ",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "304",
      name: "TAHVIL ANAP.BORC TAK.VE FAIZ.",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "305",
      name: "CIKARILMIS BONOLAR VE SENETLER",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "306",
      name: "CIKARILMIS DIGER MENKUL KIYM.",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "308",
      name: "MENKUL KIYMET. IHRAC FARKI (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "309",
      name: "DIGER MALI BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "320",
      name: "SATICILAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "321",
      name: "BORC SENETLERI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "322",
      name: "BORC SENETLERI REESKONTU (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "326",
      name: "ALINAN DEPOZITO VE TEMINATLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "329",
      name: "DIGER TICARI BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "331",
      name: "ORTAKLARA BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "332",
      name: "ISTIRAKLERE BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "333",
      name: "BAGLI ORTAKLIKLARA BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "335",
      name: "PERSONELE BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "336",
      name: "DIGER CESITLI BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "337",
      name: "DIGER BORC.SENET.REESKONTU (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "340",
      name: "ALINAN SIPARIS AVANSLARI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "349",
      name: "ALINAN DIGER AVANSLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "350",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "351",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "352",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "353",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "354",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "355",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "356",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "357",
      name: "YILLARA YAY.INS.ve ONR.HAKEDIS",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "358",
      name: "YILLARA YAY.INS.ENF.DUZELT.HES",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "360",
      name: "ODENECEK VERGI VE FONLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "361",
      name: "ODENECEK SOS. GUV. KESINTILERI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "368",
      name: "VD.GEC.ER.VEYA TK.VR.VE DG.YUK",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "369",
      name: "ODENECEK DIGER YUKUMLULUKLER",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "370",
      name: "DON.KARI VER.VE DIG.YUK.KARS.",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "371",
      name: "DON.KAR.PES.OD.VER.VE YUK (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "372",
      name: "KIDEM TAZMINATI KARSILIGI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "373",
      name: "MALIYET GIDERLERI KARSILIGI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "379",
      name: "DIGER BORC VE GIDER KARSILIGI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "380",
      name: "GELECEK AYLARA AIT GELIRLER",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "381",
      name: "GIDER TAHAKKUKLARI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "391",
      name: "HESAPLANAN KDV",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "392",
      name: "DIGER KDV",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "393",
      name: "MERKEZ VE SUBELER CARI HESABI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "397",
      name: "SAYIM VE TESELLUM FAZLALARI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "399",
      name: "DIGER CESITLI YAB. KAYNAKLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "400",
      name: "BANKA KREDILERI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "401",
      name: "FINANSAL KIRALAMA ISL.BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "402",
      name: "ERTELEN.FIN.KIRA.BORC.MAL. (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "405",
      name: "CIKARILMIS TAHVILLER",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "407",
      name: "CIKARILMIS DGR.MENKUL KIYMET.",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "408",
      name: "MENKUL KIYMET.IHRAC FARKI (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "409",
      name: "DIGER MALI BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "420",
      name: "SATICILAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "421",
      name: "BORC SENETLERI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "422",
      name: "BORC SENETLERI REESKONTU (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "426",
      name: "ALINAN DEPOZITO VE TEMINATLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "429",
      name: "DIGER TICARI BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "431",
      name: "ORTAKLARA BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "432",
      name: "ISTIRAKLERE BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "433",
      name: "BAGLI ORTAKLIKLARA BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "436",
      name: "DIGER CESITLI BORCLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "437",
      name: "DIGER BORC SENETLERI REES. (-)",
      accountType: "LIABILITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "438",
      name: "KAMUYA OL.ERT.VEYA TAKSIT.BORC",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "440",
      name: "ALINAN SIPARIS AVANSLARI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "449",
      name: "ALINAN DIGER AVANSLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "472",
      name: "KIDEM TAZMINATI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "479",
      name: "DIGER BORC VE GIDER KARSILIK.",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "480",
      name: "GELECEK YILLARA AIT GELIRLER",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "481",
      name: "GIDER TAHAKKUKLARI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "492",
      name: "GEL.YIL.ERT.VEYA TERKIN ED.KDV",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "493",
      name: "TESISE KATILMA PAYLARI",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "499",
      name: "DI.CES.UZUN VAD.YAB.KAYNAKLAR",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "500",
      name: "SERMAYE",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "501",
      name: "ODENMEMIS SERMAYE (-)",
      accountType: "EQUITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "502",
      name: "SERMAYE DUZELT.OLUMLU FARKLARI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "503",
      name: "SERMAYE DUZELT.OLUMSUZ FARKLARI (-)",
      accountType: "EQUITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "520",
      name: "HISSE SENETLERI IHRAC PRIMLERI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "521",
      name: "HISSE SENEDI IPTAL KARLARI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "522",
      name: "M.D.V.YENIDEN DEGERLEME ARTIS.",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "523",
      name: "ISTIRAKLER YENIDEN DEGER.ART.",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "524",
      name: "MALIYET ARTISLARI FONU",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "529",
      name: "DIGER SERMAYE YEDEKLERI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "540",
      name: "YASAL YEDEKLER",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "541",
      name: "STATU YEDEKLERI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "542",
      name: "OLAGANUSTU YEDEKLER",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "548",
      name: "DIGER KAR YEDEKLERI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "549",
      name: "OZEL FONLAR",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "570",
      name: "GECMIS YILLAR KARLARI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "580",
      name: "GECMIS YILLAR ZARARLARI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "590",
      name: "DONEM NET KARI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "591",
      name: "DONEM NET ZARARI (-)",
      accountType: "EQUITY",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "600",
      name: "YURT ICI SATISLAR",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "601",
      name: "YURT DISI SATISLAR",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "602",
      name: "DIGER GELIRLER",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "610",
      name: "SATISTAN IADELER (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "611",
      name: "SATIS ISKONTOLARI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "612",
      name: "DIGER INDIRIMLER (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "620",
      name: "SATILAN MAMULLER MALIYETI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "621",
      name: "SATILAN TIC.MALLAR MALIYETI(-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "622",
      name: "SATILAN HIZMET MALIYETI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "623",
      name: "DIGER SATISLARIN MALIYETI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "630",
      name: "ARASTIRMA VE GELISTIRME GID(-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "631",
      name: "PAZARLAMA SAT.VE DAG.GID. (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "632",
      name: "GENEL YONETIM GIDERLERI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "640",
      name: "ISTIRAKLERDEN TEMETTU GELIR.",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "641",
      name: "BAGLI ORT.TEMETTU GELIRLERI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "642",
      name: "FAIZ GELIRLERI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "643",
      name: "KOMISYON GELIRLERI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "644",
      name: "KONUSU KALMAYAN KARSILIKLAR",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "645",
      name: "MENKUL KIYMETLER SATIS KARLARI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "646",
      name: "KAMBIYO KARLARI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "647",
      name: "REESKONT FAIZ GELIRLERI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "648",
      name: "ENFLASYON DUZELTMESI KARLARI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "649",
      name: "DIGER OLAGAN GELIR VE KARLAR",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "653",
      name: "KOMISYON GIDERLERI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "654",
      name: "KARSILIK GIDERLERI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "655",
      name: "MENKUL KIYMET SATIS ZARAR (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "656",
      name: "KAMBIYO ZARARLARI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "657",
      name: "REESKONT FAIZ GIDERLERI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "658",
      name: "ENFLASYON DUZELT.ZARARLARI (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "659",
      name: "DIGER GIDER VE ZARARLAR (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "660",
      name: "KISA VADELI BORCLANMA GID. (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "661",
      name: "UZUN VADELI BORCLANMA GID. (-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "671",
      name: "ONCEKI DONEM GELIR VE KARLARI",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "679",
      name: "DIG.OLAGANDISI GELIR VE KARLAR",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "680",
      name: "CALISMAYAN KISIM GID.VE ZAR(-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "681",
      name: "ONCEKI DON.GID.VE ZARARLARI(-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "689",
      name: "DIGER O.DISI GID.VE ZARAR.(-)",
      accountType: "EXPENSE",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "690",
      name: "DONEM KARI VEYA ZARARI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "691",
      name: "D.K.VER.VE DIG.YAS.YUK.KAR.(-)",
      accountType: "REVENUE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "692",
      name: "DONEM NET KARI VE ZARARI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "697",
      name: "YILLARA YAY.INS.ENF.DUZELT.HES",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "698",
      name: "ENFLASYON DUZELTME HESABI",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    }),
    Object.freeze({
      code: "700",
      name: "MALIYET MUHASEBESI BAGLANTI HS",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "701",
      name: "MALIYET MUHASEBESI YANSITMA HS",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "710",
      name: "DIREKT ILK MADDE VE MALZEME GD",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "711",
      name: "DIREKT ILK MAD.VE MAL.YANS.FAR",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "712",
      name: "DIREKT ILK MAD.VE MAL.FIAT FAR",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "713",
      name: "DIREKT ILK MAD.VE MAL.MIK.FAR.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "720",
      name: "DIREKT ISCILIK GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "721",
      name: "DIREKT ISCILIK GID.YANSIT.HES.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "722",
      name: "DIREKT ISCILIK UCRET FARKLARI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "723",
      name: "DIREKT ISCILIK SURE FARKLARI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "730",
      name: "GENEL URETIM GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "731",
      name: "GENEL URETIM GID.YANSITMA HES.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "732",
      name: "GENEL URETIM GID.BUTCE FARK.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "733",
      name: "GENEL URETIM GIDERLERI VER.FRK",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "734",
      name: "GENEL URETIM GID.KAPASITE FRK.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "740",
      name: "HIZMET URETIM MALIYETI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "741",
      name: "HIZMET URETIM MAL.YAN.HES.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "742",
      name: "HIZMET URET.MAL.FARK HESAPLARI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "750",
      name: "ARASTIRMA VE GELISTIRME GIDER.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "751",
      name: "ARAS.VE GELIS.GID.YANS.HESABI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "752",
      name: "ARAS.VE GELIS.GIDER FARKLARI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "760",
      name: "PAZARLAMA SATIS VE DAGITIM GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "761",
      name: "PAZARLAMA SAT.VE DAG.GID.YANSITMA HS",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "762",
      name: "PAZARLAMA SAT.VE DAG.GID.FARK HESABI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "770",
      name: "GENEL YONETIM GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "771",
      name: "GEN.YON.GID.YANSITMA HESABI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "772",
      name: "GENEL YONETIM GID.FARKLARI HS.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "780",
      name: "FINANSMAN GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "781",
      name: "FINANSMAN GIDERLERI YANSITMA HESABI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "782",
      name: "FINANSMAN GIDERLERI FARK HESABI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "790",
      name: "ILK MADDE VE MALZEME GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "791",
      name: "ISCI UCRET VE GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "792",
      name: "MEMUR UCRET VE GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "793",
      name: "DIS. SAGL. FAYDA VE HIZMETLER",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "794",
      name: "CESITLI GIDERLER",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "795",
      name: "VERGI RESIM VE HARCLAR",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "796",
      name: "AMORTISMANLAR VE TUKENME PAYL.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "797",
      name: "FINANSMAN GIDERLERI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "798",
      name: "GIDER CESITLERI YANSITMA HES.",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "799",
      name: "URETIM MALIYET HESABI",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "800",
      name: "YONETIM MUHASEBESI HESAPLARI - SERBEST",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    }),
    Object.freeze({
      code: "900",
      name: "NAZIM HESAPLAR",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
  ]),
  AF_STARTER_V1: Object.freeze([
    Object.freeze({
      code: "1000",
      name: "Current Assets",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    }),
    Object.freeze({
      code: "1100",
      name: "Accounts Receivable",
      parentCode: "1000",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "1150",
      name: "Cash and Bank",
      parentCode: "1000",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "2000",
      name: "Accounts Payable",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "3100",
      name: "Share Capital",
      accountType: "EQUITY",
      normalSide: "CREDIT",
      allowPosting: false,
    }),
    Object.freeze({
      code: "3110",
      name: "Shareholder Commitment Receivable",
      accountType: "EQUITY",
      normalSide: "DEBIT",
      allowPosting: false,
    }),
    Object.freeze({
      code: "4000",
      name: "Sales Revenue",
      accountType: "REVENUE",
      normalSide: "CREDIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "4050",
      name: "Foreign Exchange Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "5000",
      name: "Operating Expenses",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "7050",
      name: "Foreign Exchange Loss",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
  ]),
  US_GAAP_STARTER_V1: Object.freeze([
    Object.freeze({
      code: "1000",
      name: "Current Assets",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    }),
    Object.freeze({
      code: "1100",
      name: "Accounts Receivable",
      parentCode: "1000",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "1150",
      name: "Cash and Bank",
      parentCode: "1000",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "2000",
      name: "Accounts Payable",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "3100",
      name: "Common Stock",
      accountType: "EQUITY",
      normalSide: "CREDIT",
      allowPosting: false,
    }),
    Object.freeze({
      code: "3110",
      name: "Stock Subscription Receivable",
      accountType: "EQUITY",
      normalSide: "DEBIT",
      allowPosting: false,
    }),
    Object.freeze({
      code: "4000",
      name: "Sales Revenue",
      accountType: "REVENUE",
      normalSide: "CREDIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "4050",
      name: "Foreign Exchange Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "5000",
      name: "Operating Expenses",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
    Object.freeze({
      code: "7050",
      name: "Foreign Exchange Loss",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
      allowPosting: true,
    }),
  ]),
});

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

const TR_UNIFORM_DEFAULT_NON_POSTING_CODES = Object.freeze(
  new Set([
    "100",
    "102",
    "195",
    "335",
    "127",
    "128",
    "129",
    "131",
    "136",
    "153",
    "157",
    "159",
    "180",
    "181",
    "190",
    "191",
    "192",
    "193",
    "196",
    "242",
    "250",
    "252",
    "253",
    "254",
    "255",
    "257",
    "258",
    "260",
    "280",
    "281",
    "300",
    "326",
    "329",
    "331",
    "340",
    "360",
    "361",
    "368",
    "370",
    "380",
    "381",
    "391",
    "400",
    "420",
    "421",
    "431",
    "472",
    "480",
    "481",
    "500",
    "501",
    "570",
    "580",
    "590",
    "591",
  ])
);

const TR_UNIFORM_POSTABLE_EXCEPTION_CODES = Object.freeze(
  new Set(["600", "632", "646", "656", "770"])
);

function shouldForceTrUniformNonPostingByCode(code) {
  const normalizedCode = toUpper(code);
  if (!normalizedCode) {
    return false;
  }
  if (TR_UNIFORM_DEFAULT_NON_POSTING_CODES.has(normalizedCode)) {
    return true;
  }
  if (TR_UNIFORM_POSTABLE_EXCEPTION_CODES.has(normalizedCode)) {
    return false;
  }
  if (!/^\d+$/.test(normalizedCode)) {
    return false;
  }
  return Number.parseInt(normalizedCode, 10) >= 600;
}

function applyTrUniformPostingDefaults(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!shouldForceTrUniformNonPostingByCode(row?.code)) {
      return row;
    }
    return {
      ...row,
      allowPosting: false,
    };
  });
}

function normalizeStarterAccountTreeRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    code: toUpper(row?.code),
    ...(toUpper(row?.parentCode) ? { parentCode: toUpper(row.parentCode) } : {}),
    name: String(row?.name || "").trim(),
    accountType: toUpper(row?.accountType),
    normalSide: toUpper(row?.normalSide),
    allowPosting: row?.allowPosting === undefined ? true : Boolean(row.allowPosting),
  }));
}

function buildRequiredParentAccounts(starterAccountTree = []) {
  const treeRows = normalizeStarterAccountTreeRows(starterAccountTree);
  const byCode = new Map(treeRows.map((row) => [row.code, row]));
  const parentCodeSet = new Set(
    treeRows.map((row) => toUpper(row.parentCode)).filter(Boolean)
  );
  const nonPostableSet = new Set(
    treeRows.filter((row) => row.allowPosting === false).map((row) => row.code)
  );
  const requiredCodes = new Set([...parentCodeSet, ...nonPostableSet]);

  return Array.from(requiredCodes)
    .map((code) => {
      const row = byCode.get(code);
      if (!row) {
        return null;
      }
      return {
        code: row.code,
        name: row.name,
        accountType: row.accountType,
        normalSide: row.normalSide,
        allowPosting: false,
        reason: parentCodeSet.has(code)
          ? "required_parent_for_tree"
          : "required_non_postable_control",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.code.localeCompare(right.code));
}

function buildRequiredPurposeMappings(modules = [], starterAccountTree = []) {
  const requiredPurposeCodeSet = new Set();
  for (const module of modules || []) {
    for (const purposeCode of module?.requiredPurposeCodes || []) {
      requiredPurposeCodeSet.add(toUpper(purposeCode));
    }
  }

  const starterByCode = new Map(
    normalizeStarterAccountTreeRows(starterAccountTree).map((row) => [row.code, row])
  );
  const byPurposeCode = new Map();

  for (const module of modules || []) {
    const moduleKey = String(module?.moduleKey || "").trim();
    for (const target of module?.purposeTargets || []) {
      const purposeCode = toUpper(target?.purposeCode);
      if (!purposeCode || byPurposeCode.has(purposeCode)) {
        continue;
      }

      const recommendedCode = toUpper(
        target?.suggestCreate?.code || target?.match?.codeExact?.[0]
      );
      const treeRow = starterByCode.get(recommendedCode);

      byPurposeCode.set(purposeCode, {
        moduleKey,
        purposeCode,
        required: requiredPurposeCodeSet.has(purposeCode),
        recommendedCode: recommendedCode || null,
        ...(target?.suggestCreate?.name
          ? { recommendedName: String(target.suggestCreate.name).trim() }
          : {}),
        ...(treeRow?.parentCode ? { recommendedParentCode: treeRow.parentCode } : {}),
      });
    }
  }

  return Array.from(byPurposeCode.values()).sort((left, right) => {
    if (left.required !== right.required) {
      return left.required ? -1 : 1;
    }
    if (left.moduleKey !== right.moduleKey) {
      return String(left.moduleKey).localeCompare(String(right.moduleKey));
    }
    return String(left.purposeCode).localeCompare(String(right.purposeCode));
  });
}

function buildPackExpansion(pack) {
  const packId = toUpper(pack?.packId);
  const starterAccountRows = STARTER_ACCOUNT_TREES_BY_PACK_ID[packId] || [];
  const starterAccountTree = normalizeStarterAccountTreeRows(
    packId === "TR_UNIFORM_V1"
      ? applyTrUniformPostingDefaults(starterAccountRows)
      : starterAccountRows
  );
  return {
    starterAccountTree,
    requiredParentAccounts: buildRequiredParentAccounts(starterAccountTree),
    requiredPurposeMappings: buildRequiredPurposeMappings(
      pack?.modules || [],
      starterAccountTree
    ),
  };
}

const PACKS = Object.freeze([
  Object.freeze({
    packId: "TR_UNIFORM_V1",
    countryIso2: "TR",
    label: "Turkey Uniform Starter v1",
    locked: true,
    modules: Object.freeze([
      Object.freeze({
        moduleKey: "cariPosting",
        label: "Cari posting",
        requiredPurposeCodes: CARI_REQUIRED_PURPOSE_CODES,
        purposeTargets: Object.freeze([
          Object.freeze({
            purposeCode: "CARI_AR_CONTROL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["120"]),
            }),
            suggestCreate: Object.freeze({
              code: "120",
              name: "Trade Receivables",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_OFFSET",
            rules: Object.freeze({
              allowPosting: true,
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["600"]),
            }),
            suggestCreate: Object.freeze({
              code: "600",
              name: "Domestic Sales",
              accountType: "REVENUE",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_CONTROL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "LIABILITY",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["320"]),
            }),
            suggestCreate: Object.freeze({
              code: "320",
              name: "Trade Payables",
              accountType: "LIABILITY",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_OFFSET",
            rules: Object.freeze({
              allowPosting: true,
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              // 770 is preferred, 632 is fallback for TR starter flows.
              codeExact: Object.freeze(["770", "632"]),
            }),
            suggestCreate: Object.freeze({
              code: "770",
              name: "General Administrative Expenses",
              accountType: "EXPENSE",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_SETTLEMENT_FX_GAIN",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "REVENUE",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["646"]),
            }),
            suggestCreate: Object.freeze({
              code: "646",
              name: "Foreign Exchange Gains",
              accountType: "REVENUE",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_SETTLEMENT_FX_LOSS",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "EXPENSE",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["656"]),
            }),
            suggestCreate: Object.freeze({
              code: "656",
              name: "Foreign Exchange Losses",
              accountType: "EXPENSE",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_CONTROL_CASH",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["120"]),
            }),
            suggestCreate: Object.freeze({
              code: "120",
              name: "Trade Receivables",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_OFFSET_CASH",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["102", "100"]),
            }),
            suggestCreate: Object.freeze({
              code: "102",
              name: "Banks",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_CONTROL_CASH",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "LIABILITY",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["320"]),
            }),
            suggestCreate: Object.freeze({
              code: "320",
              name: "Trade Payables",
              accountType: "LIABILITY",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_OFFSET_CASH",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["102", "100"]),
            }),
            suggestCreate: Object.freeze({
              code: "102",
              name: "Banks",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_CONTROL_MANUAL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["120"]),
            }),
            suggestCreate: Object.freeze({
              code: "120",
              name: "Trade Receivables",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_OFFSET_MANUAL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["102", "100"]),
            }),
            suggestCreate: Object.freeze({
              code: "102",
              name: "Banks",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_CONTROL_MANUAL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "LIABILITY",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["320"]),
            }),
            suggestCreate: Object.freeze({
              code: "320",
              name: "Trade Payables",
              accountType: "LIABILITY",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_OFFSET_MANUAL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["102", "100"]),
            }),
            suggestCreate: Object.freeze({
              code: "102",
              name: "Banks",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_CONTROL_ON_ACCOUNT",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["120"]),
            }),
            suggestCreate: Object.freeze({
              code: "120",
              name: "Trade Receivables",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_OFFSET_ON_ACCOUNT",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "LIABILITY",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["340", "380"]),
            }),
            suggestCreate: Object.freeze({
              code: "340",
              name: "Customer Advances Received",
              accountType: "LIABILITY",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_CONTROL_ON_ACCOUNT",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "LIABILITY",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["320"]),
            }),
            suggestCreate: Object.freeze({
              code: "320",
              name: "Trade Payables",
              accountType: "LIABILITY",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_OFFSET_ON_ACCOUNT",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["159"]),
            }),
            suggestCreate: Object.freeze({
              code: "159",
              name: "Advances Given for Orders",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
        ]),
      }),
      Object.freeze({
        moduleKey: "shareholderCommitment",
        label: "Shareholder capital commitment",
        requiredPurposeCodes: SHAREHOLDER_REQUIRED_PURPOSE_CODES,
        purposeTargets: Object.freeze([
          Object.freeze({
            purposeCode: "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
            rules: Object.freeze({
              accountType: "EQUITY",
              normalSide: "CREDIT",
              allowPosting: false,
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["500"]),
            }),
            suggestCreate: Object.freeze({
              code: "500",
              name: "Capital",
              accountType: "EQUITY",
              normalSide: "CREDIT",
              allowPosting: false,
            }),
          }),
          Object.freeze({
            purposeCode: "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
            rules: Object.freeze({
              accountType: "EQUITY",
              normalSide: "DEBIT",
              allowPosting: false,
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["501"]),
            }),
            suggestCreate: Object.freeze({
              code: "501",
              name: "Unpaid Capital Commitments",
              accountType: "EQUITY",
              normalSide: "DEBIT",
              allowPosting: false,
            }),
          }),
        ]),
      }),
      buildBankControlParentModule({
        matchCodes: Object.freeze(["102"]),
        suggestCode: "102",
        suggestName: "Bank Control Parent",
      }),
      buildCashClearingModule({
        exchangeMatchCodes: Object.freeze(["108.01", "108"]),
        transitMatchCodes: Object.freeze(["108.02", "108"]),
        exchangeSuggestCode: "108.01",
        transitSuggestCode: "108.02",
      }),
    ]),
  }),
  Object.freeze({
    packId: "AF_STARTER_V1",
    countryIso2: "AF",
    label: "Afghanistan Starter v1",
    locked: true,
    modules: Object.freeze([
      Object.freeze({
        moduleKey: "cariPosting",
        label: "Cari posting",
        requiredPurposeCodes: CARI_REQUIRED_PURPOSE_CODES,
        purposeTargets: Object.freeze([
          Object.freeze({
            purposeCode: "CARI_AR_CONTROL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["1100"]),
            }),
            suggestCreate: Object.freeze({
              code: "1100",
              name: "Accounts Receivable",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_OFFSET",
            rules: Object.freeze({
              allowPosting: true,
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["4000"]),
            }),
            suggestCreate: Object.freeze({
              code: "4000",
              name: "Sales Revenue",
              accountType: "REVENUE",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_CONTROL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "LIABILITY",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["2000"]),
            }),
            suggestCreate: Object.freeze({
              code: "2000",
              name: "Accounts Payable",
              accountType: "LIABILITY",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_OFFSET",
            rules: Object.freeze({
              allowPosting: true,
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["5000"]),
            }),
            suggestCreate: Object.freeze({
              code: "5000",
              name: "Operating Expenses",
              accountType: "EXPENSE",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_SETTLEMENT_FX_GAIN",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "REVENUE",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["4050"]),
            }),
            suggestCreate: Object.freeze({
              code: "4050",
              name: "Foreign Exchange Gain",
              accountType: "REVENUE",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_SETTLEMENT_FX_LOSS",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "EXPENSE",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["7050"]),
            }),
            suggestCreate: Object.freeze({
              code: "7050",
              name: "Foreign Exchange Loss",
              accountType: "EXPENSE",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
        ]),
      }),
      Object.freeze({
        moduleKey: "shareholderCommitment",
        label: "Shareholder capital commitment",
        requiredPurposeCodes: SHAREHOLDER_REQUIRED_PURPOSE_CODES,
        purposeTargets: Object.freeze([
          Object.freeze({
            purposeCode: "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
            rules: Object.freeze({
              accountType: "EQUITY",
              normalSide: "CREDIT",
              allowPosting: false,
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["3100"]),
            }),
            suggestCreate: Object.freeze({
              code: "3100",
              name: "Share Capital",
              accountType: "EQUITY",
              normalSide: "CREDIT",
              allowPosting: false,
            }),
          }),
          Object.freeze({
            purposeCode: "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
            rules: Object.freeze({
              accountType: "EQUITY",
              normalSide: "DEBIT",
              allowPosting: false,
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["3110"]),
            }),
            suggestCreate: Object.freeze({
              code: "3110",
              name: "Shareholder Commitment Receivable",
              accountType: "EQUITY",
              normalSide: "DEBIT",
              allowPosting: false,
            }),
          }),
        ]),
      }),
      buildBankControlParentModule({
        matchCodes: Object.freeze(["1150"]),
        suggestCode: "1150",
        suggestName: "Cash and Bank",
      }),
      buildCashClearingModule({
        exchangeMatchCodes: Object.freeze(["1151", "1150"]),
        transitMatchCodes: Object.freeze(["1152", "1150"]),
        exchangeSuggestCode: "1151",
        transitSuggestCode: "1152",
      }),
    ]),
  }),
  Object.freeze({
    packId: "US_GAAP_STARTER_V1",
    countryIso2: "US",
    label: "US GAAP Starter v1",
    locked: true,
    modules: Object.freeze([
      Object.freeze({
        moduleKey: "cariPosting",
        label: "Cari posting",
        requiredPurposeCodes: CARI_REQUIRED_PURPOSE_CODES,
        purposeTargets: Object.freeze([
          Object.freeze({
            purposeCode: "CARI_AR_CONTROL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "ASSET",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["1100"]),
            }),
            suggestCreate: Object.freeze({
              code: "1100",
              name: "Accounts Receivable",
              accountType: "ASSET",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AR_OFFSET",
            rules: Object.freeze({
              allowPosting: true,
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["4000"]),
            }),
            suggestCreate: Object.freeze({
              code: "4000",
              name: "Sales Revenue",
              accountType: "REVENUE",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_CONTROL",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "LIABILITY",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["2000"]),
            }),
            suggestCreate: Object.freeze({
              code: "2000",
              name: "Accounts Payable",
              accountType: "LIABILITY",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_AP_OFFSET",
            rules: Object.freeze({
              allowPosting: true,
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["5000"]),
            }),
            suggestCreate: Object.freeze({
              code: "5000",
              name: "Operating Expenses",
              accountType: "EXPENSE",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_SETTLEMENT_FX_GAIN",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "REVENUE",
              normalSide: "CREDIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["4050"]),
            }),
            suggestCreate: Object.freeze({
              code: "4050",
              name: "Foreign Exchange Gain",
              accountType: "REVENUE",
              normalSide: "CREDIT",
              allowPosting: true,
            }),
          }),
          Object.freeze({
            purposeCode: "CARI_SETTLEMENT_FX_LOSS",
            rules: Object.freeze({
              allowPosting: true,
              accountType: "EXPENSE",
              normalSide: "DEBIT",
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["7050"]),
            }),
            suggestCreate: Object.freeze({
              code: "7050",
              name: "Foreign Exchange Loss",
              accountType: "EXPENSE",
              normalSide: "DEBIT",
              allowPosting: true,
            }),
          }),
        ]),
      }),
      Object.freeze({
        moduleKey: "shareholderCommitment",
        label: "Shareholder capital commitment",
        requiredPurposeCodes: SHAREHOLDER_REQUIRED_PURPOSE_CODES,
        purposeTargets: Object.freeze([
          Object.freeze({
            purposeCode: "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
            rules: Object.freeze({
              accountType: "EQUITY",
              normalSide: "CREDIT",
              allowPosting: false,
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["3100"]),
            }),
            suggestCreate: Object.freeze({
              code: "3100",
              name: "Common Stock",
              accountType: "EQUITY",
              normalSide: "CREDIT",
              allowPosting: false,
            }),
          }),
          Object.freeze({
            purposeCode: "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
            rules: Object.freeze({
              accountType: "EQUITY",
              normalSide: "DEBIT",
              allowPosting: false,
            }),
            match: Object.freeze({
              codeExact: Object.freeze(["3110"]),
            }),
            suggestCreate: Object.freeze({
              code: "3110",
              name: "Stock Subscription Receivable",
              accountType: "EQUITY",
              normalSide: "DEBIT",
              allowPosting: false,
            }),
          }),
        ]),
      }),
      buildBankControlParentModule({
        matchCodes: Object.freeze(["1150"]),
        suggestCode: "1150",
        suggestName: "Cash and Bank",
      }),
      buildCashClearingModule({
        exchangeMatchCodes: Object.freeze(["1151", "1150"]),
        transitMatchCodes: Object.freeze(["1152", "1150"]),
        exchangeSuggestCode: "1151",
        transitSuggestCode: "1152",
      }),
    ]),
  }),
]);

const PACKS_WITH_EXPANSION = Object.freeze(
  PACKS.map((pack) =>
    Object.freeze({
      ...pack,
      ...buildPackExpansion(pack),
    })
  )
);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function listPolicyPacks() {
  return PACKS_WITH_EXPANSION.map((pack) => ({
    packId: pack.packId,
    countryIso2: pack.countryIso2,
    label: pack.label,
    locked: true,
    starterAccountTreeCount: (pack.starterAccountTree || []).length,
    requiredParentAccountCount: (pack.requiredParentAccounts || []).length,
    requiredPurposeMappingCount: (pack.requiredPurposeMappings || []).length,
  }));
}

export function getPolicyPack(packId) {
  const normalizedPackId = String(packId || "").trim().toUpperCase();
  if (!normalizedPackId) {
    return null;
  }

  const pack = PACKS_WITH_EXPANSION.find((row) => row.packId === normalizedPackId);
  if (!pack) {
    return null;
  }

  return deepClone(pack);
}
