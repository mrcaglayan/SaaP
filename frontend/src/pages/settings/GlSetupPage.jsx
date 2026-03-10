import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  createBalanceSplitReclassification,
  getTrialBalance,
  listAccounts,
  listBooks,
  listCoas,
  postJournal,
  upsertAccount,
  upsertAccountMapping,
  upsertBook,
  upsertCoa,
} from "../../api/glAdmin.js";
import {
  listCountries,
  listFiscalCalendars,
  listFiscalPeriods,
  listLegalEntities,
  listShareholderJournalConfigs,
  upsertShareholderJournalConfig,
} from "../../api/orgAdmin.js";
import {
  listJournalPurposeAccounts,
  upsertJournalPurposeAccount,
} from "../../api/glPurposeMappings.js";
import {
  applyPolicyPack,
  listPolicyPacks,
  resolvePolicyPack,
} from "../../api/policyPacks.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";

const BOOK_TYPES = ["LOCAL", "GROUP"];
const DEFAULT_BOOK_FORM = {
  legalEntityId: "",
  calendarId: "",
  code: "",
  name: "",
  bookType: "LOCAL",
  baseCurrencyCode: "USD",
};
const COA_SCOPES = ["LEGAL_ENTITY", "GROUP"];
const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const UNSPECIFIED_ACCOUNT_TYPE = "UNSPECIFIED";
const NORMAL_SIDES = ["DEBIT", "CREDIT"];
const TURKISH_DEFAULT_COA_ACCOUNTS = [
  { code: "100", name: "Kasa", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "101", name: "Alinan Cekler", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "102", name: "Bankalar", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "103",
    name: "Verilen Cekler ve Odeme Emirleri (-)",
    accountType: "ASSET",
    normalSide: "CREDIT",
  },
  { code: "108", name: "Diger Hazir Degerler", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "110", name: "Hisse Senetleri", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "111",
    name: "Ozel Kesim Tahvil Senet ve Bonolari",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "112",
    name: "Kamu Kesimi Tahvil Senet ve Bonolari",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  { code: "118", name: "Diger Menkul Kiymetler", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "119",
    name: "Menkul Kiymetler Deger Dusuklugu Karsiligi (-)",
    accountType: "ASSET",
    normalSide: "CREDIT",
  },
  { code: "120", name: "Alicilar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "121", name: "Alacak Senetleri", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "122",
    name: "Alacak Senetleri Reeskontu (-)",
    accountType: "ASSET",
    normalSide: "CREDIT",
  },
  {
    code: "126",
    name: "Verilen Depozito ve Teminatlar",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  { code: "127", name: "Diger Ticari Alacaklar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "128", name: "Supheli Ticari Alacaklar", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "129",
    name: "Supheli Ticari Alacaklar Karsiligi (-)",
    accountType: "ASSET",
    normalSide: "CREDIT",
  },
  { code: "131", name: "Ortaklardan Alacaklar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "136", name: "Diger Cesitli Alacaklar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "153", name: "Ticari Mallar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "157", name: "Diger Stoklar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "159", name: "Verilen Siparis Avanslari", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "180",
    name: "Gelecek Aylara Ait Giderler",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  { code: "181", name: "Gelir Tahakkuklari", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "191", name: "Indirilecek KDV", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "193",
    name: "Pesin Odenen Vergi ve Fonlar",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  { code: "240", name: "Bagli Menkul Kiymetler", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "242", name: "Istirakler", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "245", name: "Bagli Ortakliklar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "250", name: "Arazi ve Arsalar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "252", name: "Binalar", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "253",
    name: "Tesis Makine ve Cihazlar",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  { code: "254", name: "Tasitlar", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "255", name: "Demirbaslar", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "257",
    name: "Birikmis Amortismanlar (-)",
    accountType: "ASSET",
    normalSide: "CREDIT",
  },
  {
    code: "258",
    name: "Yapilmakta Olan Yatirimlar",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  { code: "260", name: "Haklar", accountType: "ASSET", normalSide: "DEBIT" },
  {
    code: "262",
    name: "Kurulus ve Orgutlenme Giderleri",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "263",
    name: "Arastirma ve Gelistirme Giderleri",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "267",
    name: "Diger Maddi Olmayan Duran Varliklar",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "268",
    name: "Birikmis Amortismanlar (-)",
    accountType: "ASSET",
    normalSide: "CREDIT",
  },
  {
    code: "280",
    name: "Gelecek Yillara Ait Giderler",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  { code: "281", name: "Gelir Tahakkuklari", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "300", name: "Banka Kredileri", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "320", name: "Saticilar", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "321", name: "Borc Senetleri", accountType: "LIABILITY", normalSide: "CREDIT" },
  {
    code: "326",
    name: "Alinan Depozito ve Teminatlar",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  { code: "329", name: "Diger Ticari Borclar", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "331", name: "Ortaklara Borclar", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "335", name: "Personele Borclar", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "340", name: "Alinan Siparis Avanslari", accountType: "LIABILITY", normalSide: "CREDIT" },
  {
    code: "360",
    name: "Odenecek Vergi ve Fonlar",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "361",
    name: "Odenecek Sosyal Guvenlik Kesintileri",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "368",
    name: "Vadesi Gecmis Vergi ve Diger Yukumlulukler",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "370",
    name: "Donem Kari Vergi ve Diger Yasal Yukumluluk Karsiliklari",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "380",
    name: "Gelecek Aylara Ait Gelirler",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  { code: "381", name: "Gider Tahakkuklari", accountType: "LIABILITY", normalSide: "CREDIT" },
  {
    code: "391",
    name: "Hesaplanan KDV",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "400",
    name: "Banka Kredileri",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  { code: "420", name: "Saticilar", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "421", name: "Borc Senetleri", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "431", name: "Ortaklara Borclar", accountType: "LIABILITY", normalSide: "CREDIT" },
  {
    code: "472",
    name: "Kidem Tazminati Karsiligi",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "480",
    name: "Gelecek Yillara Ait Gelirler",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  { code: "481", name: "Gider Tahakkuklari", accountType: "LIABILITY", normalSide: "CREDIT" },
  {
    code: "500",
    name: "Sermaye",
    accountType: "EQUITY",
    normalSide: "CREDIT",
    allowPosting: false,
  },
  {
    code: "501",
    name: "Odenmemis Sermaye (-)",
    accountType: "EQUITY",
    normalSide: "DEBIT",
    allowPosting: false,
  },
  {
    code: "520",
    name: "Hisse Senedi Ihrac Primleri",
    accountType: "EQUITY",
    normalSide: "CREDIT",
  },
  {
    code: "529",
    name: "Diger Sermaye Yedekleri",
    accountType: "EQUITY",
    normalSide: "CREDIT",
  },
  { code: "540", name: "Yasal Yedekler", accountType: "EQUITY", normalSide: "CREDIT" },
  {
    code: "542",
    name: "Olaganustu Yedekler",
    accountType: "EQUITY",
    normalSide: "CREDIT",
  },
  {
    code: "570",
    name: "Gecmis Yillar Karlari",
    accountType: "EQUITY",
    normalSide: "CREDIT",
  },
  {
    code: "580",
    name: "Gecmis Yillar Zararlari (-)",
    accountType: "EQUITY",
    normalSide: "DEBIT",
  },
  { code: "590", name: "Donem Net Kari", accountType: "EQUITY", normalSide: "CREDIT" },
  {
    code: "591",
    name: "Donem Net Zarari (-)",
    accountType: "EQUITY",
    normalSide: "DEBIT",
  },
  { code: "600", name: "Yurtici Satislar", accountType: "REVENUE", normalSide: "CREDIT" },
  { code: "601", name: "Yurtdisi Satislar", accountType: "REVENUE", normalSide: "CREDIT" },
  { code: "602", name: "Diger Gelirler", accountType: "REVENUE", normalSide: "CREDIT" },
  {
    code: "610",
    name: "Satislardan Iadeler (-)",
    accountType: "REVENUE",
    normalSide: "DEBIT",
  },
  {
    code: "611",
    name: "Satis Iskontolari (-)",
    accountType: "REVENUE",
    normalSide: "DEBIT",
  },
  {
    code: "612",
    name: "Diger Indirimler (-)",
    accountType: "REVENUE",
    normalSide: "DEBIT",
  },
  {
    code: "620",
    name: "Satilan Mallar Maliyeti (-)",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "621",
    name: "Satilan Ticari Mallar Maliyeti (-)",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "622",
    name: "Satilan Hizmet Maliyeti (-)",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "630",
    name: "Arastirma ve Gelistirme Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "631",
    name: "Pazarlama Satis ve Dagitim Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "632",
    name: "Genel Yonetim Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "640",
    name: "Istiraklerden Temettu Gelirleri",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  { code: "642", name: "Faiz Gelirleri", accountType: "REVENUE", normalSide: "CREDIT" },
  { code: "646", name: "Kambiyo Karlari", accountType: "REVENUE", normalSide: "CREDIT" },
  {
    code: "649",
    name: "Diger Olagan Gelir ve Karlar",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  {
    code: "654",
    name: "Karsilik Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  { code: "656", name: "Kambiyo Zararlari", accountType: "EXPENSE", normalSide: "DEBIT" },
  {
    code: "659",
    name: "Diger Olagan Gider ve Zararlar",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "660",
    name: "Kisa Vadeli Borclanma Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "671",
    name: "Onceki Donem Gider ve Zararlari",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "679",
    name: "Diger Olagandisi Gelir ve Karlar",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  {
    code: "689",
    name: "Diger Olagandisi Gider ve Zararlar",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    code: "700",
    name: "Direkt Ilk Madde ve Malzeme Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  { code: "710", name: "Direkt Iscilik Giderleri", accountType: "EXPENSE", normalSide: "DEBIT" },
  { code: "720", name: "Genel Uretim Giderleri", accountType: "EXPENSE", normalSide: "DEBIT" },
  { code: "740", name: "Hizmet Uretim Maliyeti", accountType: "EXPENSE", normalSide: "DEBIT" },
  {
    code: "760",
    name: "Pazarlama Satis ve Dagitim Giderleri",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  { code: "770", name: "Genel Yonetim Giderleri", accountType: "EXPENSE", normalSide: "DEBIT" },
  { code: "780", name: "Finansman Giderleri", accountType: "EXPENSE", normalSide: "DEBIT" },
];
const USA_DEFAULT_COA_ACCOUNTS = [
  { code: "1000", name: "Cash and Cash Equivalents", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "1100", name: "Accounts Receivable", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "1200", name: "Inventory", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "1300", name: "Prepaid Expenses", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "1500", name: "Property Plant and Equipment", accountType: "ASSET", normalSide: "DEBIT" },
  { code: "1590", name: "Accumulated Depreciation", accountType: "ASSET", normalSide: "CREDIT" },
  { code: "2000", name: "Accounts Payable", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "2100", name: "Accrued Expenses", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "2200", name: "Taxes Payable", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "2300", name: "Deferred Revenue", accountType: "LIABILITY", normalSide: "CREDIT" },
  { code: "3000", name: "Retained Earnings", accountType: "EQUITY", normalSide: "CREDIT" },
  {
    code: "3100",
    name: "Capital Stock Parent",
    accountType: "EQUITY",
    normalSide: "CREDIT",
    allowPosting: false,
  },
  { code: "3101", name: "Common Stock Class A", accountType: "EQUITY", normalSide: "CREDIT" },
  {
    code: "3110",
    name: "Capital Commitment Parent",
    accountType: "EQUITY",
    normalSide: "DEBIT",
    allowPosting: false,
  },
  {
    code: "3111",
    name: "Capital Commitment Receivable",
    accountType: "EQUITY",
    normalSide: "DEBIT",
  },
  { code: "4000", name: "Sales Revenue", accountType: "REVENUE", normalSide: "CREDIT" },
  { code: "4100", name: "Service Revenue", accountType: "REVENUE", normalSide: "CREDIT" },
  { code: "4050", name: "Foreign Exchange Gain", accountType: "REVENUE", normalSide: "CREDIT" },
  { code: "5000", name: "Cost of Goods Sold", accountType: "EXPENSE", normalSide: "DEBIT" },
  { code: "6100", name: "Operating Expenses", accountType: "EXPENSE", normalSide: "DEBIT" },
  { code: "6200", name: "General and Administrative Expense", accountType: "EXPENSE", normalSide: "DEBIT" },
  { code: "7000", name: "Interest Expense", accountType: "EXPENSE", normalSide: "DEBIT" },
  { code: "7050", name: "Foreign Exchange Loss", accountType: "EXPENSE", normalSide: "DEBIT" },
];
const CARI_REQUIRED_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_OFFSET",
  "CARI_AP_CONTROL",
  "CARI_AP_OFFSET",
  "CARI_SETTLEMENT_FX_GAIN",
  "CARI_SETTLEMENT_FX_LOSS",
]);
const CARI_OPTIONAL_CONTEXT_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL_CASH",
  "CARI_AR_OFFSET_CASH",
  "CARI_AP_CONTROL_CASH",
  "CARI_AP_OFFSET_CASH",
  "CARI_AR_CONTROL_MANUAL",
  "CARI_AR_OFFSET_MANUAL",
  "CARI_AP_CONTROL_MANUAL",
  "CARI_AP_OFFSET_MANUAL",
  "CARI_AR_CONTROL_ON_ACCOUNT",
  "CARI_AR_OFFSET_ON_ACCOUNT",
  "CARI_AP_CONTROL_ON_ACCOUNT",
  "CARI_AP_OFFSET_ON_ACCOUNT",
]);
const CARI_MANUAL_PURPOSE_CODES = Object.freeze([
  ...CARI_REQUIRED_PURPOSE_CODES,
  ...CARI_OPTIONAL_CONTEXT_PURPOSE_CODES,
]);
const PURPOSE_MAPPING_MODULE_KEYS = Object.freeze({
  CARI: "CARI",
  CASH: "CASH",
  REVREC: "REVREC",
  BANK: "BANK",
});
const CASH_PURPOSE_CODES = Object.freeze([
  "CASH_EXCHANGE_CLEARING",
  "CASH_TRANSIT_CLEARING",
]);
const BANK_PURPOSE_CODES = Object.freeze(["BANK_CONTROL_PARENT"]);
const REVREC_REQUIRED_PURPOSE_CODES = Object.freeze([
  "DEFREV_SHORT_LIABILITY",
  "DEFREV_LONG_LIABILITY",
  "DEFREV_REVENUE",
  "DEFREV_RECLASS",
  "PREPAID_EXP_SHORT_ASSET",
  "PREPAID_EXP_LONG_ASSET",
  "PREPAID_EXPENSE",
  "PREPAID_RECLASS",
  "ACCR_REV_SHORT_ASSET",
  "ACCR_REV_LONG_ASSET",
  "ACCR_REV_REVENUE",
  "ACCR_REV_RECLASS",
  "ACCR_EXP_SHORT_LIABILITY",
  "ACCR_EXP_LONG_LIABILITY",
  "ACCR_EXP_EXPENSE",
  "ACCR_EXP_RECLASS",
]);
const CARI_REQUIRED_PURPOSE_CODE_SET = new Set(CARI_REQUIRED_PURPOSE_CODES);
const CARI_OPTIONAL_PURPOSE_CODE_SET = new Set(CARI_OPTIONAL_CONTEXT_PURPOSE_CODES);
const CASH_PURPOSE_CODE_SET = new Set(CASH_PURPOSE_CODES);
const BANK_PURPOSE_CODE_SET = new Set(BANK_PURPOSE_CODES);
const REVREC_REQUIRED_PURPOSE_CODE_SET = new Set(REVREC_REQUIRED_PURPOSE_CODES);
const CARI_PURPOSE_UI_META = Object.freeze({
  CARI_AR_CONTROL: Object.freeze({
    en: "AR control account (customer balance account).",
    tr: "AR kontrol hesabi (musteri bakiye hesabi).",
    exampleEn: "Example: AR invoice -> Dr 120, Cr 600",
    exampleTr: "Ornek: AR fatura -> Borc 120, Alacak 600",
  }),
  CARI_AR_OFFSET: Object.freeze({
    en: "AR document offset account (usually revenue).",
    tr: "AR belge karsi hesabi (genelde gelir hesabi).",
    exampleEn: "Example: AR invoice sales side -> 600/601/602",
    exampleTr: "Ornek: AR fatura satis tarafi -> 600/601/602",
  }),
  CARI_AP_CONTROL: Object.freeze({
    en: "AP control account (vendor balance account).",
    tr: "AP kontrol hesabi (satici bakiye hesabi).",
    exampleEn: "Example: AP invoice -> Dr 770, Cr 320",
    exampleTr: "Ornek: AP fatura -> Borc 770, Alacak 320",
  }),
  CARI_AP_OFFSET: Object.freeze({
    en: "AP document offset account (usually expense/cost).",
    tr: "AP belge karsi hesabi (genelde gider/maliyet hesabi).",
    exampleEn: "Example: AP expense side -> 770 or 632",
    exampleTr: "Ornek: AP gider tarafi -> 770 veya 632",
  }),
  CARI_SETTLEMENT_FX_GAIN: Object.freeze({
    en: "Realized FX gain account used when settlement base exceeds historical carrying base.",
    tr: "Settlement baz tutari tarihi tasinan baz tutari astiginda kullanilan gerceklesen kur farki kar hesabi.",
    exampleEn: "Example: AR collection at a stronger rate -> 646 / dedicated FX gain income.",
    exampleTr: "Ornek: daha guclu kurdan AR tahsilati -> 646 / ozel kambiyo kar hesabi.",
  }),
  CARI_SETTLEMENT_FX_LOSS: Object.freeze({
    en: "Realized FX loss account used when settlement base is below or economically worse than historical carrying base.",
    tr: "Settlement baz tutari tarihi tasinan baz tutardan dusuk veya ekonomik olarak daha kotu oldugunda kullanilan gerceklesen kur farki zarar hesabi.",
    exampleEn: "Example: AP payment at a weaker rate -> 656 / dedicated FX loss expense.",
    exampleTr: "Ornek: daha zayif kurdan AP odemesi -> 656 / ozel kambiyo zarar hesabi.",
  }),
  CARI_AR_CONTROL_CASH: Object.freeze({
    en: "Optional AR control override for CASH settlement context.",
    tr: "CASH settlement baglami icin opsiyonel AR kontrol override.",
    exampleEn: "Used only in cash-linked settlement; else fallback to CARI_AR_CONTROL.",
    exampleTr: "Sadece kasa/banka bagli settlement'ta kullanilir; yoksa CARI_AR_CONTROL fallback olur.",
  }),
  CARI_AR_OFFSET_CASH: Object.freeze({
    en: "Optional AR cash offset (cash/bank account).",
    tr: "Opsiyonel AR nakit karsi hesabi (kasa/banka hesabi).",
    exampleEn: "Example: cash collection apply -> Dr 102, Cr 120",
    exampleTr: "Ornek: nakit tahsilat apply -> Borc 102, Alacak 120",
  }),
  CARI_AP_CONTROL_CASH: Object.freeze({
    en: "Optional AP control override for CASH settlement context.",
    tr: "CASH settlement baglami icin opsiyonel AP kontrol override.",
    exampleEn: "Used only in cash-linked settlement; else fallback to CARI_AP_CONTROL.",
    exampleTr: "Sadece kasa/banka bagli settlement'ta kullanilir; yoksa CARI_AP_CONTROL fallback olur.",
  }),
  CARI_AP_OFFSET_CASH: Object.freeze({
    en: "Optional AP cash offset (cash/bank account).",
    tr: "Opsiyonel AP nakit karsi hesabi (kasa/banka hesabi).",
    exampleEn: "Example: vendor payout apply -> Dr 320, Cr 102",
    exampleTr: "Ornek: satici odeme apply -> Borc 320, Alacak 102",
  }),
  CARI_AR_CONTROL_MANUAL: Object.freeze({
    en: "Optional AR control override for MANUAL settlement context.",
    tr: "MANUAL settlement baglami icin opsiyonel AR kontrol override.",
    exampleEn: "Used in manual settlement without cash transaction link.",
    exampleTr: "Kasa islemi baglantisi olmayan manuel settlement'ta kullanilir.",
  }),
  CARI_AR_OFFSET_MANUAL: Object.freeze({
    en: "Optional AR offset for MANUAL settlement context.",
    tr: "MANUAL settlement baglami icin opsiyonel AR karsi hesap.",
    exampleEn: "Example: manual collection settlement -> usually 100/102.",
    exampleTr: "Ornek: manuel tahsilat settlement -> genelde 100/102.",
  }),
  CARI_AP_CONTROL_MANUAL: Object.freeze({
    en: "Optional AP control override for MANUAL settlement context.",
    tr: "MANUAL settlement baglami icin opsiyonel AP kontrol override.",
    exampleEn: "Used in manual settlement without cash transaction link.",
    exampleTr: "Kasa islemi baglantisi olmayan manuel settlement'ta kullanilir.",
  }),
  CARI_AP_OFFSET_MANUAL: Object.freeze({
    en: "Optional AP offset for MANUAL settlement context.",
    tr: "MANUAL settlement baglami icin opsiyonel AP karsi hesap.",
    exampleEn: "Example: manual payout settlement -> usually 100/102.",
    exampleTr: "Ornek: manuel odeme settlement -> genelde 100/102.",
  }),
  CARI_AR_CONTROL_ON_ACCOUNT: Object.freeze({
    en: "Optional AR control override for ON_ACCOUNT apply context.",
    tr: "ON_ACCOUNT apply baglami icin opsiyonel AR kontrol override.",
    exampleEn: "Used when settlement consumes/relieves on-account balances.",
    exampleTr: "Settlement on-account bakiyeleri tukettiginde/cozdugunde kullanilir.",
  }),
  CARI_AR_OFFSET_ON_ACCOUNT: Object.freeze({
    en: "Optional AR on-account offset (customer advances liability).",
    tr: "Opsiyonel AR on-account karsi hesabi (alinan siparis avansi yukumlulugu).",
    exampleEn: "Example: clear customer advance -> Dr 340, Cr 120",
    exampleTr: "Ornek: musteri avans kapama -> Borc 340, Alacak 120",
  }),
  CARI_AP_CONTROL_ON_ACCOUNT: Object.freeze({
    en: "Optional AP control override for ON_ACCOUNT apply context.",
    tr: "ON_ACCOUNT apply baglami icin opsiyonel AP kontrol override.",
    exampleEn: "Used when settlement consumes/relieves on-account balances.",
    exampleTr: "Settlement on-account bakiyeleri tukettiginde/cozdugunde kullanilir.",
  }),
  CARI_AP_OFFSET_ON_ACCOUNT: Object.freeze({
    en: "Optional AP on-account offset (vendor advances asset).",
    tr: "Opsiyonel AP on-account karsi hesabi (verilen siparis avansi varligi).",
    exampleEn: "Example: clear vendor advance -> Dr 320, Cr 159",
    exampleTr: "Ornek: satici avans kapama -> Borc 320, Alacak 159",
  }),
});
const REVREC_PURPOSE_UI_META = Object.freeze({
  DEFREV_SHORT_LIABILITY: Object.freeze({
    en: "Short deferred revenue liability (typically 380).",
    tr: "Kisa vadeli ertelenmis gelir yukumlulugu (genelde 380).",
    exampleEn: "Recognition entry credits this balance for short-term deferrals.",
    exampleTr: "Doneme yayma kaydinda kisa vadeli ertelenmis gelir burada izlenir.",
  }),
  DEFREV_LONG_LIABILITY: Object.freeze({
    en: "Long deferred revenue liability (typically 480).",
    tr: "Uzun vadeli ertelenmis gelir yukumlulugu (genelde 480).",
    exampleEn: "Year crossover balances stay here before 480->380 reclass.",
    exampleTr: "Yila sarkan bakiyeler 480->380 aktarmasi oncesi burada tutulur.",
  }),
  DEFREV_REVENUE: Object.freeze({
    en: "Revenue recognition account (6xx family).",
    tr: "Gelir tahakkuk kaydinin gelir hesabi (6xx grubu).",
    exampleEn: "Monthly recognition moves deferred revenue into this account.",
    exampleTr: "Aylik kayitta ertelenmis gelir bu gelir hesabina aktarilir.",
  }),
  DEFREV_RECLASS: Object.freeze({
    en: "Reclass bridge for long->short deferred revenue.",
    tr: "Uzun->kisa ertelenmis gelir aktarimi icin reclass purpose code.",
    exampleEn: "Used by automatic 480->380 reclass journal.",
    exampleTr: "Otomatik 480->380 aktarma fisinde kullanilir.",
  }),
  PREPAID_EXP_SHORT_ASSET: Object.freeze({
    en: "Short prepaid expense asset (typically 180).",
    tr: "Kisa vadeli pesin odenmis gider varligi (genelde 180).",
    exampleEn: "Amortization runs debit expense and credit this account.",
    exampleTr: "Giderlestirme kayitlari gider borc, bu hesap alacak olur.",
  }),
  PREPAID_EXP_LONG_ASSET: Object.freeze({
    en: "Long prepaid expense asset (typically 280).",
    tr: "Uzun vadeli pesin odenmis gider varligi (genelde 280).",
    exampleEn: "Year crossover balances stay here before 280->180 reclass.",
    exampleTr: "Yila sarkan bakiyeler 280->180 aktarmasi oncesi burada tutulur.",
  }),
  PREPAID_EXPENSE: Object.freeze({
    en: "Expense recognition account (7xx/6xx as policy).",
    tr: "Gider tahakkuk/giderlestirme hesabi (politikaya gore 7xx/6xx).",
    exampleEn: "Monthly amortization debits this expense account.",
    exampleTr: "Aylik giderlestirme kaydi bu gider hesabini borclandirir.",
  }),
  PREPAID_RECLASS: Object.freeze({
    en: "Reclass bridge for long->short prepaid expense.",
    tr: "Uzun->kisa pesin gider aktarimi icin reclass purpose code.",
    exampleEn: "Used by automatic 280->180 reclass journal.",
    exampleTr: "Otomatik 280->180 aktarma fisinde kullanilir.",
  }),
  ACCR_REV_SHORT_ASSET: Object.freeze({
    en: "Short accrued revenue asset (typically 181).",
    tr: "Kisa vadeli gelir tahakkuku varligi (genelde 181).",
    exampleEn: "Accrual run debits this account until invoicing/settlement.",
    exampleTr: "Tahakkuk calistiginda faturalamaya kadar bu hesap borclanir.",
  }),
  ACCR_REV_LONG_ASSET: Object.freeze({
    en: "Long accrued revenue asset (typically 281).",
    tr: "Uzun vadeli gelir tahakkuku varligi (genelde 281).",
    exampleEn: "Year crossover balances stay here before 281->181 reclass.",
    exampleTr: "Yila sarkan bakiyeler 281->181 aktarmasi oncesi burada tutulur.",
  }),
  ACCR_REV_REVENUE: Object.freeze({
    en: "Revenue account for accrued-revenue entries.",
    tr: "Gelir tahakkuk fislerinin gelir hesabi.",
    exampleEn: "Accrual journal credits revenue and debits accrued asset.",
    exampleTr: "Tahakkuk fisinde gelir alacak, tahakkuk varligi borc olur.",
  }),
  ACCR_REV_RECLASS: Object.freeze({
    en: "Reclass bridge for long->short accrued revenue.",
    tr: "Uzun->kisa gelir tahakkuku aktarimi icin reclass purpose code.",
    exampleEn: "Used by automatic 281->181 reclass journal.",
    exampleTr: "Otomatik 281->181 aktarma fisinde kullanilir.",
  }),
  ACCR_EXP_SHORT_LIABILITY: Object.freeze({
    en: "Short accrued expense liability (typically 381).",
    tr: "Kisa vadeli gider tahakkuku yukumlulugu (genelde 381).",
    exampleEn: "Accrual run credits this account until invoice/payment.",
    exampleTr: "Tahakkuk calistiginda fatura/odeme gelene kadar bu hesap alacaklanir.",
  }),
  ACCR_EXP_LONG_LIABILITY: Object.freeze({
    en: "Long accrued expense liability (typically 481).",
    tr: "Uzun vadeli gider tahakkuku yukumlulugu (genelde 481).",
    exampleEn: "Year crossover balances stay here before 481->381 reclass.",
    exampleTr: "Yila sarkan bakiyeler 481->381 aktarmasi oncesi burada tutulur.",
  }),
  ACCR_EXP_EXPENSE: Object.freeze({
    en: "Expense account for accrued-expense entries.",
    tr: "Gider tahakkuk fislerinin gider hesabi.",
    exampleEn: "Accrual journal debits expense and credits accrued liability.",
    exampleTr: "Tahakkuk fisinde gider borc, tahakkuk yukumlulugu alacak olur.",
  }),
  ACCR_EXP_RECLASS: Object.freeze({
    en: "Reclass bridge for long->short accrued expense.",
    tr: "Uzun->kisa gider tahakkuku aktarimi icin reclass purpose code.",
    exampleEn: "Used by automatic 481->381 reclass journal.",
    exampleTr: "Otomatik 481->381 aktarma fisinde kullanilir.",
  }),
});
const BANK_PURPOSE_UI_META = Object.freeze({
  BANK_CONTROL_PARENT: Object.freeze({
    en: "Bank control parent account used as the root for bank subaccounts in strict bank setup.",
    tr: "Siki banka kurulumunda banka alt hesaplari icin kok olarak kullanilan banka kontrol parent hesabi.",
    exampleEn:
      "Example: map the active ASSET parent that should own bank child accounts. Non-postable header accounts are allowed.",
    exampleTr:
      "Ornek: banka alt hesaplarini tasiyacak aktif VARLIK parent hesabini esleyin. Postlanamayan header hesaplara izin verilir.",
  }),
});
const CASH_PURPOSE_UI_META = Object.freeze({
  CASH_EXCHANGE_CLEARING: Object.freeze({
    en: "Optional default clearing account for FX cash exchange batches.",
    tr: "Kur/doviz kasa degisim fisleri icin opsiyonel varsayilan clearing hesabi.",
    exampleEn: "Example: 108.01 / dedicated FX clearing asset account.",
    exampleTr: "Ornek: 108.01 / ozel doviz clearing varlik hesabi.",
  }),
  CASH_TRANSIT_CLEARING: Object.freeze({
    en: "Optional default clearing account for cross-OU cash transit transfers.",
    tr: "Unitler arasi kasa transferleri icin opsiyonel varsayilan clearing hesabi.",
    exampleEn: "Example: 108.02 / branch transit clearing account.",
    exampleTr: "Ornek: 108.02 / sube transfer clearing hesabi.",
  }),
});
const SHAREHOLDER_REQUIRED_PURPOSE_CODES = Object.freeze([
  "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
  "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
]);

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toIsoLocalDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function pickDefaultPeriod(periodRows = [], todayIso = toIsoLocalDate()) {
  const rows = Array.isArray(periodRows)
    ? [...periodRows].sort((left, right) => {
        const leftStart = String(left?.start_date || "");
        const rightStart = String(right?.start_date || "");
        if (leftStart !== rightStart) {
          return leftStart.localeCompare(rightStart);
        }
        return Number(left?.period_no || 0) - Number(right?.period_no || 0);
      })
    : [];
  if (rows.length === 0) {
    return null;
  }

  const currentPeriod = rows.find((period) => {
    const startDate = String(period?.start_date || "");
    const endDate = String(period?.end_date || "");
    if (!startDate || !endDate || !todayIso) {
      return false;
    }
    return todayIso >= startDate && todayIso <= endDate;
  });
  return currentPeriod || rows[rows.length - 1];
}

function pickEntryDateForPeriod(period, todayIso = toIsoLocalDate()) {
  const startDate = String(period?.start_date || "");
  const endDate = String(period?.end_date || "");
  if (!startDate || !endDate) {
    return todayIso || toIsoLocalDate();
  }
  if (todayIso >= startDate && todayIso <= endDate) {
    return todayIso;
  }
  if (todayIso < startDate) {
    return startDate;
  }
  return endDate;
}

function getCariPurposeUiMeta(purposeCode) {
  const normalized = String(purposeCode || "")
    .trim()
    .toUpperCase();
  return CARI_PURPOSE_UI_META[normalized] || null;
}

function getRevrecPurposeUiMeta(purposeCode) {
  const normalized = String(purposeCode || "")
    .trim()
    .toUpperCase();
  return REVREC_PURPOSE_UI_META[normalized] || null;
}

function getCashPurposeUiMeta(purposeCode) {
  const normalized = String(purposeCode || "")
    .trim()
    .toUpperCase();
  return CASH_PURPOSE_UI_META[normalized] || null;
}

function getBankPurposeUiMeta(purposeCode) {
  const normalized = String(purposeCode || "")
    .trim()
    .toUpperCase();
  return BANK_PURPOSE_UI_META[normalized] || null;
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true";
  }
  return false;
}

function toQueryMapByPurpose(rows) {
  const byPurpose = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const purposeCode = toUpper(row?.purposeCode || row?.purpose_code);
    if (!purposeCode) {
      continue;
    }
    byPurpose[purposeCode] = row;
  }
  return byPurpose;
}

function buildAccountLabel(account) {
  const code = String(account?.code || "").trim();
  const name = String(account?.name || "").trim();
  const accountType = String(account?.account_type || account?.accountType || "")
    .trim()
    .toUpperCase();
  const posting = toBoolean(account?.allow_posting ?? account?.allowPosting)
    ? "Post"
    : "No Post";
  if (!code && !name) {
    return String(account?.id || "");
  }
  return `${code} - ${name} (${accountType || "N/A"}, ${posting})`;
}

function createAccountEditorDraft(seed = {}) {
  return {
    accountId: toPositiveInt(seed.accountId) || null,
    code: toUpper(seed.code),
    parentCode: toUpper(seed.parentCode),
    name: String(seed.name || "").trim(),
    accountType: toUpper(seed.accountType) || "ASSET",
    normalSide: toUpper(seed.normalSide) || "DEBIT",
    allowPosting:
      seed.allowPosting === undefined ? true : Boolean(seed.allowPosting),
  };
}

function compareAccountsForTree(left, right) {
  const leftCode = toUpper(left?.code);
  const rightCode = toUpper(right?.code);
  if (leftCode && rightCode && leftCode !== rightCode) {
    return leftCode.localeCompare(rightCode);
  }
  const leftName = String(left?.name || "").trim();
  const rightName = String(right?.name || "").trim();
  if (leftName !== rightName) {
    return leftName.localeCompare(rightName);
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function getAccountTreeVisitKey(account) {
  const accountId = toPositiveInt(account?.id);
  if (accountId) {
    return `ID:${accountId}`;
  }
  const code = toUpper(account?.code);
  if (code) {
    return `CODE:${code}`;
  }
  return `ROW:${String(account?.name || "")}`;
}

function buildPersistedAccountTreeRows(accounts = []) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const accountById = new Map();
  for (const account of rows) {
    const accountId = toPositiveInt(account?.id);
    if (accountId && !accountById.has(accountId)) {
      accountById.set(accountId, account);
    }
  }

  const childrenByParentId = new Map();
  for (const account of rows) {
    const accountId = toPositiveInt(account?.id);
    const parentAccountId = toPositiveInt(account?.parent_account_id);
    if (!accountId || !parentAccountId || parentAccountId === accountId) {
      continue;
    }
    if (!accountById.has(parentAccountId)) {
      continue;
    }
    if (!childrenByParentId.has(parentAccountId)) {
      childrenByParentId.set(parentAccountId, []);
    }
    childrenByParentId.get(parentAccountId).push(account);
  }
  for (const children of childrenByParentId.values()) {
    children.sort(compareAccountsForTree);
  }

  const roots = rows
    .filter((account) => {
      const accountId = toPositiveInt(account?.id);
      const parentAccountId = toPositiveInt(account?.parent_account_id);
      if (!accountId || !parentAccountId) {
        return true;
      }
      if (accountId === parentAccountId) {
        return true;
      }
      return !accountById.has(parentAccountId);
    })
    .sort(compareAccountsForTree);

  const treeRows = [];
  const visited = new Set();
  function walk(account, depth) {
    const visitKey = getAccountTreeVisitKey(account);
    if (!visitKey || visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);

    const accountId = toPositiveInt(account?.id);
    const children = accountId ? childrenByParentId.get(accountId) || [] : [];
    treeRows.push({
      account,
      depth,
      childCount: children.length,
    });
    for (const child of children) {
      walk(child, depth + 1);
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }

  const unresolvedRows = rows
    .filter((account) => !visited.has(getAccountTreeVisitKey(account)))
    .sort(compareAccountsForTree);
  for (const account of unresolvedRows) {
    walk(account, 0);
  }
  return treeRows;
}

function buildAccountEditorDraftFromAccount(account, accountById) {
  const parentAccountId = toPositiveInt(
    account?.parent_account_id ?? account?.parentAccountId
  );
  const parentAccount = parentAccountId ? accountById.get(parentAccountId) : null;
  return createAccountEditorDraft({
    accountId: account?.id,
    code: account?.code,
    parentCode: parentAccount?.code || "",
    name: account?.name,
    accountType: account?.account_type ?? account?.accountType,
    normalSide: account?.normal_side ?? account?.normalSide,
    allowPosting: account?.allow_posting ?? account?.allowPosting,
  });
}

const AccountEditorPanel = memo(function AccountEditorPanel({
  l,
  selectedCoaId,
  selectedCoaKey,
  accountEditorSeed,
  accountEditorDraftMode,
  canUpsertAccounts,
  saving,
  selectedTreeAccount,
  parentCodeDatalistOptionNodes,
  onSubmit,
  onStartAddRoot,
  onStartAddChildUnderSelected,
  onCancelDraft,
}) {
  const seedForm = useMemo(
    () => createAccountEditorDraft(accountEditorSeed),
    [accountEditorSeed]
  );
  const [localState, setLocalState] = useState(() => ({
    seedForm,
    form: seedForm,
  }));
  const localForm = localState.seedForm === seedForm ? localState.form : seedForm;

  function setLocalEditorField(field, value) {
    const normalizedValue =
      field === "code" ||
      field === "parentCode" ||
      field === "accountType" ||
      field === "normalSide"
        ? toUpper(value)
        : value;
    setLocalState((prev) => {
      const baseForm = prev.seedForm === seedForm ? prev.form : seedForm;
      return {
        seedForm,
        form: {
          ...baseForm,
          [field]: normalizedValue,
        },
      };
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(localForm);
  }

  return (
    <>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {l("Account Editor", "Hesap Duzenleyici")}
      </h4>
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs text-cyan-800">
          {accountEditorDraftMode
            ? l(
                "Draft mode: create a new root/child account, then save.",
                "Taslak mod: yeni kok/alt hesap olusturup kaydedin."
              )
            : l(
                "Click a row to edit. Use Parent Code for hierarchy.",
                "Duzenlemek icin satira tiklayin. Hiyerarsi icin Ust Kod kullanin."
              )}
        </div>
        <p className="text-[11px] text-slate-500">
          {l(
            "If you change code of an existing account, backend treats it as a new row.",
            "Mevcut hesap kodunu degistirirseniz backend bunu yeni satir olarak isler."
          )}
        </p>
        <input
          value={localForm.code}
          onChange={(event) => setLocalEditorField("code", event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          placeholder={l("Code", "Kod")}
          required
        />
        <input
          list={`gl-parent-code-options-${selectedCoaKey || "none"}`}
          value={localForm.parentCode}
          onChange={(event) => setLocalEditorField("parentCode", event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          placeholder={l("Parent code (optional)", "Ust kod (opsiyonel)")}
        />
        <datalist id={`gl-parent-code-options-${selectedCoaKey || "none"}`}>
          {parentCodeDatalistOptionNodes}
        </datalist>
        <input
          value={localForm.name}
          onChange={(event) => setLocalEditorField("name", event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          placeholder={l("Name", "Ad")}
          required
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={localForm.accountType}
            onChange={(event) => setLocalEditorField("accountType", event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          >
            {ACCOUNT_TYPES.map((accountType) => (
              <option key={accountType} value={accountType}>
                {accountType}
              </option>
            ))}
          </select>
          <select
            value={localForm.normalSide}
            onChange={(event) => setLocalEditorField("normalSide", event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          >
            {NORMAL_SIDES.map((normalSide) => (
              <option key={normalSide} value={normalSide}>
                {normalSide}
              </option>
            ))}
          </select>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(localForm.allowPosting)}
            onChange={(event) =>
              setLocalEditorField("allowPosting", event.target.checked)
            }
          />
          {l("Allow posting", "Post etmeye izin ver")}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving === "account" || !canUpsertAccounts || !selectedCoaId}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving === "account"
              ? l("Saving...", "Kaydediliyor...")
              : l("Save Account", "Hesabi Kaydet")}
          </button>
          <button
            type="button"
            onClick={onStartAddRoot}
            disabled={!canUpsertAccounts || !selectedCoaId}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {l("New Root", "Yeni Kok")}
          </button>
          <button
            type="button"
            onClick={onStartAddChildUnderSelected}
            disabled={!canUpsertAccounts || !selectedCoaId || !selectedTreeAccount}
            className="rounded-lg border border-cyan-300 px-2 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
          >
            {l("Add Child Under Selected", "Secili Altina Alt Hesap Ekle")}
          </button>
          {accountEditorDraftMode ? (
            <button
              type="button"
              onClick={onCancelDraft}
              className="rounded-lg border border-amber-300 px-2 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
            >
              {l("Cancel Draft", "Taslagi Iptal Et")}
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
});

function buildVisibleTreeRows(treeRows, collapsedAccountIdSet = new Set()) {
  const rows = Array.isArray(treeRows) ? treeRows : [];
  const visibleRows = [];
  const collapsedDepthStack = [];

  for (const row of rows) {
    while (
      collapsedDepthStack.length > 0 &&
      row.depth <= collapsedDepthStack[collapsedDepthStack.length - 1]
    ) {
      collapsedDepthStack.pop();
    }
    if (collapsedDepthStack.length > 0) {
      continue;
    }

    visibleRows.push(row);

    const accountId = toPositiveInt(row?.account?.id);
    if (row.childCount > 0 && accountId && collapsedAccountIdSet.has(accountId)) {
      collapsedDepthStack.push(row.depth);
    }
  }

  return visibleRows;
}

export default function GlSetupPage({ mode = "full" } = {}) {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const { getModuleRow, refreshLegalEntity } = useModuleReadiness();
  const accountsOnlyMode = mode === "accounts";
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);
  const canReadLegalEntities = hasPermission("org.tree.read");
  const canReadCalendars = hasPermission("org.fiscal_calendar.read");
  const canReadFiscalPeriods = hasPermission("org.fiscal_period.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadCoas = hasPermission("gl.coa.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadTrialBalance = hasPermission("gl.trial_balance.read");
  const canUpsertBooks = hasPermission("gl.book.upsert");
  const canUpsertCoas = hasPermission("gl.coa.upsert");
  const canUpsertAccounts = hasPermission("gl.account.upsert");
  const canUpsertMappings = hasPermission("gl.account_mapping.upsert");
  const canCreateJournals = hasPermission("gl.journal.create");
  const canPostJournals = hasPermission("gl.journal.post");
  const canUpsertShareholderParentMappings = hasPermission("org.legal_entity.upsert");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [updatingAccountId, setUpdatingAccountId] = useState(null);

  const [legalEntities, setLegalEntities] = useState([]);
  const [countries, setCountries] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [books, setBooks] = useState([]);
  const [coas, setCoas] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [policyPacks, setPolicyPacks] = useState([]);

  const [bookEditingCode, setBookEditingCode] = useState("");
  const [bookForm, setBookForm] = useState(DEFAULT_BOOK_FORM);
  const [coaForm, setCoaForm] = useState({
    scope: "LEGAL_ENTITY",
    legalEntityId: "",
    code: "",
    name: "",
  });
  const [accountForm, setAccountForm] = useState({
    coaId: "",
  });
  const [accountEditorForm, setAccountEditorForm] = useState(
    createAccountEditorDraft()
  );
  const [accountEditorDraftMode, setAccountEditorDraftMode] = useState(false);
  const [selectedAccountIdByCoaId, setSelectedAccountIdByCoaId] = useState({});
  const [collapsedAccountIdsByCoaId, setCollapsedAccountIdsByCoaId] = useState({});
  const [collapsedAccountTypeKeysByCoaId, setCollapsedAccountTypeKeysByCoaId] =
    useState({});
  const [mappingForm, setMappingForm] = useState({
    sourceAccountId: "",
    targetAccountId: "",
    mappingType: "LOCAL_TO_GROUP",
  });
  const [templateWizardForm, setTemplateWizardForm] = useState({
    legalEntityId: "",
    packId: "",
    mode: "MERGE",
  });
  const [templatePreviewRows, setTemplatePreviewRows] = useState([]);
  const [templateOverridesByPurpose, setTemplateOverridesByPurpose] = useState({});
  const [templateApplyResult, setTemplateApplyResult] = useState(null);
  const [manualMappingsForm, setManualMappingsForm] = useState({
    legalEntityId: "",
    capitalCreditParentAccountId: "",
    commitmentDebitParentAccountId: "",
  });
  const [manualPurposeModuleKey, setManualPurposeModuleKey] = useState(
    PURPOSE_MAPPING_MODULE_KEYS.CARI
  );
  const [manualCariMappingsByPurpose, setManualCariMappingsByPurpose] = useState({});
  const [manualCashMappingsByPurpose, setManualCashMappingsByPurpose] = useState({});
  const [manualBankMappingsByPurpose, setManualBankMappingsByPurpose] = useState({});
  const [manualRevrecMappingsByPurpose, setManualRevrecMappingsByPurpose] = useState({});
  const [showOptionalCariMappings, setShowOptionalCariMappings] = useState(false);
  const [loadingManualMappings, setLoadingManualMappings] = useState(false);
  const parentAccountIds = new Set(
    accounts.map((row) => toPositiveInt(row.parent_account_id)).filter(Boolean)
  );
  const selectedCoaId = toPositiveInt(accountForm.coaId);
  const selectedCoaKey = String(selectedCoaId || "");
  const selectedCoaAccounts = useMemo(() => {
    if (!selectedCoaId) {
      return [];
    }
    const rows = accounts.filter(
      (account) => toPositiveInt(account?.coa_id) === selectedCoaId
    );
    rows.sort(compareAccountsForTree);
    return rows;
  }, [accounts, selectedCoaId]);
  const selectedCoaAccountById = useMemo(() => {
    const byId = new Map();
    for (const account of selectedCoaAccounts) {
      const accountId = toPositiveInt(account?.id);
      if (!accountId) {
        continue;
      }
      byId.set(accountId, account);
    }
    return byId;
  }, [selectedCoaAccounts]);
  const selectedCoaAccountByCode = useMemo(() => {
    const byCode = new Map();
    for (const account of selectedCoaAccounts) {
      const code = toUpper(account?.code);
      if (!code || byCode.has(code)) {
        continue;
      }
      byCode.set(code, account);
    }
    return byCode;
  }, [selectedCoaAccounts]);
  const selectedCoaParentAccountIds = useMemo(() => {
    return new Set(
      selectedCoaAccounts
        .map((row) => toPositiveInt(row?.parent_account_id))
        .filter(Boolean)
    );
  }, [selectedCoaAccounts]);
  const selectedCoaTreeRows = useMemo(
    () => buildPersistedAccountTreeRows(selectedCoaAccounts),
    [selectedCoaAccounts]
  );
  const defaultCollapsedAccountIds = useMemo(
    () => Array.from(selectedCoaParentAccountIds),
    [selectedCoaParentAccountIds]
  );
  const defaultCollapsedAccountTypeKeys = useMemo(() => {
    const typeKeys = new Set();
    for (const account of selectedCoaAccounts) {
      const accountType = toUpper(account?.account_type) || UNSPECIFIED_ACCOUNT_TYPE;
      if (!accountType) {
        continue;
      }
      typeKeys.add(accountType);
    }
    return Array.from(typeKeys);
  }, [selectedCoaAccounts]);
  const collapsedAccountIdSet = useMemo(
    () =>
      new Set(
        (
          Array.isArray(collapsedAccountIdsByCoaId[selectedCoaKey])
            ? collapsedAccountIdsByCoaId[selectedCoaKey]
            : defaultCollapsedAccountIds
        )
          .map((value) => toPositiveInt(value))
          .filter(Boolean)
      ),
    [collapsedAccountIdsByCoaId, selectedCoaKey, defaultCollapsedAccountIds]
  );
  const collapsedAccountTypeSet = useMemo(
    () =>
      new Set(
        (
          Array.isArray(collapsedAccountTypeKeysByCoaId[selectedCoaKey])
            ? collapsedAccountTypeKeysByCoaId[selectedCoaKey]
            : defaultCollapsedAccountTypeKeys
        )
          .map((value) => toUpper(value))
          .filter(Boolean)
      ),
    [
      collapsedAccountTypeKeysByCoaId,
      selectedCoaKey,
      defaultCollapsedAccountTypeKeys,
    ]
  );
  const selectedCoaTreeGroups = useMemo(() => {
    const rowsByType = new Map();
    for (const account of selectedCoaAccounts) {
      const accountType = toUpper(account?.account_type) || UNSPECIFIED_ACCOUNT_TYPE;
      if (!rowsByType.has(accountType)) {
        rowsByType.set(accountType, []);
      }
      rowsByType.get(accountType).push(account);
    }

    const knownTypeSet = new Set(ACCOUNT_TYPES);
    const extraTypes = [...rowsByType.keys()]
      .filter((type) => !knownTypeSet.has(type))
      .sort((left, right) => left.localeCompare(right));
    const orderedTypes = [
      ...ACCOUNT_TYPES.filter((type) => rowsByType.has(type)),
      ...extraTypes,
    ];

    return orderedTypes.map((accountType) => {
      const treeRows = buildPersistedAccountTreeRows(rowsByType.get(accountType));
      return {
        accountType,
        totalCount: rowsByType.get(accountType)?.length || 0,
        visibleRows: buildVisibleTreeRows(treeRows, collapsedAccountIdSet),
      };
    });
  }, [selectedCoaAccounts, collapsedAccountIdSet]);
  const selectedTreeAccountId = toPositiveInt(
    selectedAccountIdByCoaId[selectedCoaKey]
  );
  const selectedTreeAccount =
    selectedCoaAccounts.find(
      (account) => toPositiveInt(account?.id) === selectedTreeAccountId
    ) || null;
  const selectedFallbackTreeAccount =
    selectedTreeAccount || selectedCoaTreeRows[0]?.account || null;
  const selectedCoaParentCodeOptions = useMemo(() => {
    const rows = selectedCoaAccounts.filter((account) => toUpper(account?.code));
    rows.sort(compareAccountsForTree);
    return rows;
  }, [selectedCoaAccounts]);
  const selectedCoaParentCodeDatalistOptions = useMemo(() => {
    return selectedCoaParentCodeOptions
      .map((account) => {
        const code = toUpper(account?.code);
        if (!code) {
          return null;
        }
        return {
          key: `account-parent-option-${account.id}`,
          value: code,
          label: `${code} - ${String(account?.name || "").trim() || "-"}`,
        };
      })
      .filter(Boolean);
  }, [selectedCoaParentCodeOptions]);
  const parentCodeDatalistOptionNodes = useMemo(
    () =>
      selectedCoaParentCodeDatalistOptions.map((option) => (
        <option key={option.key} value={option.value}>
          {option.label}
        </option>
      )),
    [selectedCoaParentCodeDatalistOptions]
  );
  const countryIso2ById = useMemo(() => {
    const byId = new Map();
    for (const country of countries) {
      const id = toPositiveInt(country?.id);
      const iso2 = toUpper(country?.iso2);
      if (!id || !iso2) {
        continue;
      }
      byId.set(id, iso2);
    }
    return byId;
  }, [countries]);
  const legalEntityById = useMemo(() => {
    const byId = new Map();
    for (const entity of legalEntities) {
      const id = toPositiveInt(entity?.id);
      if (!id) {
        continue;
      }
      byId.set(id, entity);
    }
    return byId;
  }, [legalEntities]);
  const calendarById = useMemo(() => {
    const byId = new Map();
    for (const calendar of calendars) {
      const id = toPositiveInt(calendar?.id);
      if (!id) {
        continue;
      }
      byId.set(id, calendar);
    }
    return byId;
  }, [calendars]);
  const accountsByLegalEntityId = useMemo(() => {
    const byEntity = new Map();
    for (const account of accounts) {
      const legalEntityId = toPositiveInt(account?.legal_entity_id);
      if (!legalEntityId) {
        continue;
      }
      if (!byEntity.has(legalEntityId)) {
        byEntity.set(legalEntityId, []);
      }
      byEntity.get(legalEntityId).push(account);
    }
    for (const rows of byEntity.values()) {
      rows.sort((left, right) =>
        String(left?.code || "").localeCompare(String(right?.code || ""))
      );
    }
    return byEntity;
  }, [accounts]);
  const selectedTemplateLegalEntityId = toPositiveInt(templateWizardForm.legalEntityId);
  const selectedManualLegalEntityId = toPositiveInt(manualMappingsForm.legalEntityId);
  const selectedTemplateEntity = legalEntities.find(
    (entity) => toPositiveInt(entity?.id) === selectedTemplateLegalEntityId
  );
  const selectedTemplateEntityCountryIso2 = toUpper(
    countryIso2ById.get(toPositiveInt(selectedTemplateEntity?.country_id))
  );
  const availableTemplatePacks = useMemo(() => {
    if (!selectedTemplateEntityCountryIso2) {
      return policyPacks;
    }
    const filtered = policyPacks.filter(
      (pack) => toUpper(pack?.countryIso2) === selectedTemplateEntityCountryIso2
    );
    return filtered.length > 0 ? filtered : policyPacks;
  }, [policyPacks, selectedTemplateEntityCountryIso2]);
  const templatePackIdSet = useMemo(
    () => new Set(availableTemplatePacks.map((pack) => String(pack?.packId || "").trim())),
    [availableTemplatePacks]
  );
  const templateEntityAccounts =
    accountsByLegalEntityId.get(selectedTemplateLegalEntityId) || [];
  const templateOverrideAccountOptions = templateEntityAccounts.filter((account) =>
    toBoolean(account?.is_active)
  );
  const manualEntityAccounts =
    accountsByLegalEntityId.get(selectedManualLegalEntityId) || [];
  const manualCariAccountOptions = manualEntityAccounts.filter(
    (account) => toBoolean(account?.is_active) && toBoolean(account?.allow_posting)
  );
  const manualBankAccountOptions = manualEntityAccounts.filter(
    (account) =>
      toBoolean(account?.is_active) && toUpper(account?.account_type) === "ASSET"
  );
  const manualShareholderAccountOptions = manualEntityAccounts.filter(
    (account) =>
      toBoolean(account?.is_active) &&
      !toBoolean(account?.allow_posting) &&
      toUpper(account?.account_type) === "EQUITY"
  );
  const selectedManualCariReadiness = getModuleRow(
    "cariPosting",
    selectedManualLegalEntityId
  );
  const selectedManualCashReadiness = getModuleRow(
    "cashClearing",
    selectedManualLegalEntityId
  );
  const selectedManualBankReadiness = getModuleRow(
    "bankControlParent",
    selectedManualLegalEntityId
  );
  const selectedManualShareholderReadiness = getModuleRow(
    "shareholderCommitment",
    selectedManualLegalEntityId
  );
  const isManualBankModule = manualPurposeModuleKey === PURPOSE_MAPPING_MODULE_KEYS.BANK;
  const isManualRevrecModule = manualPurposeModuleKey === PURPOSE_MAPPING_MODULE_KEYS.REVREC;
  const isManualCashModule = manualPurposeModuleKey === PURPOSE_MAPPING_MODULE_KEYS.CASH;
  const manualPurposeMappingsByPurpose =
    isManualBankModule
      ? manualBankMappingsByPurpose
      : isManualRevrecModule
      ? manualRevrecMappingsByPurpose
      : isManualCashModule
      ? manualCashMappingsByPurpose
      : manualCariMappingsByPurpose;
  const manualPurposeAccountOptions = isManualBankModule
    ? manualBankAccountOptions
    : manualCariAccountOptions;
  const visibleManualPurposeCodes = isManualBankModule
    ? BANK_PURPOSE_CODES
    : isManualRevrecModule
    ? REVREC_REQUIRED_PURPOSE_CODES
    : isManualCashModule
    ? CASH_PURPOSE_CODES
    : showOptionalCariMappings
    ? CARI_MANUAL_PURPOSE_CODES
    : CARI_REQUIRED_PURPOSE_CODES;
  const isSavingManualPurposeMappings =
    saving === "manual-cari-purpose-mappings" ||
    saving === "manual-cash-purpose-mappings" ||
    saving === "manual-bank-purpose-mappings" ||
    saving === "manual-revrec-purpose-mappings";
  const accountTreeTableRows = selectedCoaTreeGroups.map(
    ({ accountType, totalCount, visibleRows }) => {
      const typeCollapsed = collapsedAccountTypeSet.has(accountType);
      return (
        <Fragment key={`account-type-group-${accountType}`}>
          <tr className="border-t border-slate-200 bg-slate-50">
            <td colSpan={7} className="px-2 py-1.5">
              <button
                type="button"
                onClick={() => handleToggleAccountTypeGroup(accountType)}
                className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-left shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50"
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition-transform duration-150 ${
                    typeCollapsed ? "" : "rotate-90"
                  }`}
                >
                  <svg
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    className="h-2.5 w-2.5 fill-current"
                  >
                    <path d="M7 4.5L13.5 10L7 15.5z" />
                  </svg>
                </span>
                <span className="font-semibold text-slate-700">{accountType}</span>
                <span className="text-[11px] text-slate-500">({totalCount})</span>
              </button>
            </td>
          </tr>
          {!typeCollapsed
            ? visibleRows.map(({ account, depth, childCount }) => {
                const accountId = toPositiveInt(account?.id);
                const code = toUpper(account?.code);
                const parentAccountId = toPositiveInt(account?.parent_account_id);
                const parentCode = toUpper(
                  selectedCoaAccountById.get(parentAccountId)?.code
                );
                const postingAllowed = toBoolean(account?.allow_posting);
                const hasChildren = selectedCoaParentAccountIds.has(accountId);
                const rowUpdating = updatingAccountId === accountId;
                const rowCollapsed =
                  childCount > 0 && collapsedAccountIdSet.has(accountId);
                const isSelected =
                  !accountEditorDraftMode && accountId === selectedTreeAccountId;
                return (
                  <tr
                    key={account.id}
                    onClick={() => handleSelectTreeAccount(account)}
                    className={`cursor-pointer border-t border-slate-100 ${
                      isSelected ? "bg-cyan-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-2 py-1.5 font-semibold text-slate-700">
                      <div
                        className="flex items-center gap-1"
                        style={{ paddingLeft: `${Math.max(0, depth) * 16}px` }}
                      >
                        {childCount > 0 ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleAccountRowCollapse(accountId);
                            }}
                            title={
                              rowCollapsed
                                ? l("Expand", "Genislet")
                                : l("Collapse", "Daralt")
                            }
                            className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-transform duration-150 hover:border-cyan-300 hover:bg-cyan-50 ${
                              rowCollapsed ? "" : "rotate-90"
                            }`}
                          >
                            <svg
                              viewBox="0 0 20 20"
                              aria-hidden="true"
                              className="h-2.5 w-2.5 fill-current"
                            >
                              <path d="M7 4.5L13.5 10L7 15.5z" />
                            </svg>
                          </button>
                        ) : (
                          <span className="inline-block w-4 text-center text-[10px] text-slate-300">
                            *
                          </span>
                        )}
                        <span>{code || "-"}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">{parentCode || "-"}</td>
                    <td className="px-2 py-1.5 text-slate-700">
                      {String(account?.name || "").trim() || "-"}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {toUpper(account?.account_type) || "-"}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {toUpper(account?.normal_side) || "-"}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={postingAllowed}
                          disabled={
                            !canUpsertAccounts ||
                            rowUpdating ||
                            (hasChildren && !postingAllowed)
                          }
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            handleAccountPostingChange(account, event.target.checked)
                          }
                        />
                        <span>{postingAllowed ? l("Yes", "Evet") : l("No", "Hayir")}</span>
                      </label>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleStartAddChildAccount(account);
                          }}
                          disabled={!canUpsertAccounts || !code}
                          className="rounded border border-cyan-200 px-1.5 py-0.5 font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                        >
                          {l("Add Child", "Alt Hesap Ekle")}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSelectTreeAccount(account);
                          }}
                          className="rounded border border-slate-200 px-1.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {l("Edit", "Duzenle")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            : null}
        </Fragment>
      );
    }
  );

  async function loadData() {
    setLoading(true);
    setError("");

    const updates = {
      legalEntities,
      countries,
      calendars,
      books,
      coas,
      accounts,
      policyPacks,
    };

    try {
      const tasks = [];

      if (canReadLegalEntities) {
        tasks.push(
          listLegalEntities().then((response) => {
            updates.legalEntities = response?.rows || [];
          })
        );
        tasks.push(
          listCountries().then((response) => {
            updates.countries = response?.rows || [];
          })
        );
        tasks.push(
          listPolicyPacks().then((response) => {
            updates.policyPacks = response?.rows || [];
          })
        );
      }

      if (canReadCalendars) {
        tasks.push(
          listFiscalCalendars().then((response) => {
            updates.calendars = response?.rows || [];
          })
        );
      }

      if (canReadBooks) {
        tasks.push(
          listBooks().then((response) => {
            updates.books = response?.rows || [];
          })
        );
      }

      if (canReadCoas) {
        tasks.push(
          listCoas().then((response) => {
            updates.coas = response?.rows || [];
          })
        );
      }

      if (canReadAccounts) {
        tasks.push(
          listAccounts({ includeInactive: true }).then((response) => {
            updates.accounts = response?.rows || [];
          })
        );
      }

      await Promise.all(tasks);

      setLegalEntities(updates.legalEntities);
      setCountries(updates.countries);
      setCalendars(updates.calendars);
      setBooks(updates.books);
      setCoas(updates.coas);
      setAccounts(updates.accounts);
      setPolicyPacks(updates.policyPacks);

      setBookForm((prev) => ({
        ...prev,
        legalEntityId: prev.legalEntityId || String(updates.legalEntities[0]?.id || ""),
        calendarId: prev.calendarId || String(updates.calendars[0]?.id || ""),
      }));
      setCoaForm((prev) => ({
        ...prev,
        legalEntityId: prev.legalEntityId || String(updates.legalEntities[0]?.id || ""),
      }));
      setAccountForm((prev) => ({
        ...prev,
        coaId: prev.coaId || String(updates.coas[0]?.id || ""),
      }));
      setMappingForm((prev) => ({
        ...prev,
        sourceAccountId:
          prev.sourceAccountId || String(updates.accounts[0]?.id || ""),
        targetAccountId:
          prev.targetAccountId || String(updates.accounts[1]?.id || updates.accounts[0]?.id || ""),
      }));
      setTemplateWizardForm((prev) => ({
        ...prev,
        legalEntityId:
          prev.legalEntityId || String(updates.legalEntities[0]?.id || ""),
        packId: prev.packId || String(updates.policyPacks[0]?.packId || ""),
      }));
      setManualMappingsForm((prev) => ({
        ...prev,
        legalEntityId:
          prev.legalEntityId || String(updates.legalEntities[0]?.id || ""),
      }));
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load GL setup data.", "GL kurulum verileri yuklenemedi."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canReadLegalEntities,
    canReadCalendars,
    canReadBooks,
    canReadCoas,
    canReadAccounts,
  ]);

  useEffect(() => {
    const currentPackId = String(templateWizardForm.packId || "").trim();
    if (currentPackId && templatePackIdSet.has(currentPackId)) {
      return;
    }
    const fallbackPackId = String(availableTemplatePacks[0]?.packId || "").trim();
    if (!fallbackPackId || fallbackPackId === currentPackId) {
      return;
    }
    setTemplateWizardForm((prev) => ({
      ...prev,
      packId: fallbackPackId,
    }));
  }, [availableTemplatePacks, templatePackIdSet, templateWizardForm.packId]);

  useEffect(() => {
    setTemplatePreviewRows([]);
    setTemplateOverridesByPurpose({});
    setTemplateApplyResult(null);
  }, [templateWizardForm.legalEntityId, templateWizardForm.packId]);

  useEffect(() => {
    if (!selectedCoaId) {
      setAccountEditorDraftMode(false);
      setAccountEditorForm(createAccountEditorDraft());
      return;
    }
    if (accountEditorDraftMode) {
      return;
    }
    const fallbackAccount = selectedFallbackTreeAccount;
    if (!fallbackAccount) {
      setAccountEditorForm(createAccountEditorDraft());
      return;
    }
    const fallbackAccountId = toPositiveInt(fallbackAccount?.id);
    if (
      fallbackAccountId &&
      fallbackAccountId !== toPositiveInt(selectedAccountIdByCoaId[selectedCoaKey])
    ) {
      setSelectedAccountIdByCoaId((prev) => ({
        ...prev,
        [selectedCoaKey]: fallbackAccountId,
      }));
    }
    setAccountEditorForm(
      buildAccountEditorDraftFromAccount(fallbackAccount, selectedCoaAccountById)
    );
  }, [
    accountEditorDraftMode,
    selectedCoaId,
    selectedCoaKey,
    selectedFallbackTreeAccount,
    selectedCoaAccountById,
    selectedAccountIdByCoaId,
  ]);

  async function loadManualMappings(legalEntityIdInput) {
    const legalEntityId = toPositiveInt(
      legalEntityIdInput ?? manualMappingsForm.legalEntityId
    );
    if (!legalEntityId || !canReadLegalEntities || !canReadAccounts) {
      setManualCariMappingsByPurpose({});
      setManualCashMappingsByPurpose({});
      setManualBankMappingsByPurpose({});
      setManualRevrecMappingsByPurpose({});
      setManualMappingsForm((prev) => ({
        ...prev,
        capitalCreditParentAccountId: "",
        commitmentDebitParentAccountId: "",
      }));
      return;
    }

    setLoadingManualMappings(true);
    try {
      const [cariResponse, cashResponse, bankResponse, revrecResponse, shareholderResponse] =
        await Promise.all([
        listJournalPurposeAccounts({
          legalEntityId,
          moduleKey: PURPOSE_MAPPING_MODULE_KEYS.CARI,
        }),
        listJournalPurposeAccounts({
          legalEntityId,
          moduleKey: PURPOSE_MAPPING_MODULE_KEYS.CASH,
        }),
        listJournalPurposeAccounts({
          legalEntityId,
          moduleKey: PURPOSE_MAPPING_MODULE_KEYS.BANK,
        }),
        listJournalPurposeAccounts({
          legalEntityId,
          moduleKey: PURPOSE_MAPPING_MODULE_KEYS.REVREC,
        }),
        listShareholderJournalConfigs({ legalEntityId }),
      ]);

      setManualCariMappingsByPurpose(toQueryMapByPurpose(cariResponse?.rows || []));
      setManualCashMappingsByPurpose(toQueryMapByPurpose(cashResponse?.rows || []));
      setManualBankMappingsByPurpose(toQueryMapByPurpose(bankResponse?.rows || []));
      setManualRevrecMappingsByPurpose(toQueryMapByPurpose(revrecResponse?.rows || []));
      const shareholderRows = Array.isArray(shareholderResponse?.rows)
        ? shareholderResponse.rows
        : [];
      const shareholderRow =
        shareholderRows.find(
          (row) => toPositiveInt(row?.legal_entity_id) === legalEntityId
        ) || null;

      setManualMappingsForm((prev) => ({
        ...prev,
        legalEntityId: String(legalEntityId),
        capitalCreditParentAccountId: String(
          toPositiveInt(shareholderRow?.capital_credit_parent_account_id) || ""
        ),
        commitmentDebitParentAccountId: String(
          toPositiveInt(shareholderRow?.commitment_debit_parent_account_id) || ""
        ),
      }));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to load manual purpose mappings.",
            "Manuel amac eslemeleri yuklenemedi."
          )
      );
    } finally {
      setLoadingManualMappings(false);
    }
  }

  useEffect(() => {
    if (!selectedManualLegalEntityId) {
      return;
    }
    loadManualMappings(selectedManualLegalEntityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManualLegalEntityId, canReadLegalEntities, canReadAccounts]);

  function getPurposeReadinessStatus(readinessRow, purposeCode) {
    if (!readinessRow) {
      return {
        label: l("Unknown", "Bilinmiyor"),
        className: "bg-slate-100 text-slate-700",
        detail: "",
      };
    }

    const normalizedPurposeCode = toUpper(purposeCode);
    const missingPurposeCodes = new Set(
      (readinessRow?.missingPurposeCodes || []).map((code) => toUpper(code))
    );
    if (missingPurposeCodes.has(normalizedPurposeCode)) {
      return {
        label: l("Missing", "Eksik"),
        className: "bg-rose-100 text-rose-700",
        detail: "",
      };
    }

    const invalid = (readinessRow?.invalidMappings || []).filter(
      (row) => toUpper(row?.purposeCode) === normalizedPurposeCode
    );
    if (invalid.length > 0) {
      const reasons = Array.from(
        new Set(invalid.map((row) => toUpper(row?.reason)).filter(Boolean))
      );
      return {
        label: l("Invalid", "Gecersiz"),
        className: "bg-amber-100 text-amber-800",
        detail: reasons.join(", "),
      };
    }

    return {
      label: l("OK", "Tamam"),
      className: "bg-emerald-100 text-emerald-700",
      detail: "",
    };
  }

  function getRevrecPurposeMappingStatus(row) {
    const accountId = toPositiveInt(row?.accountId || row?.account_id);
    const validForPosting = toBoolean(
      row?.validForPurposePosting ??
        row?.valid_for_purpose_posting ??
        row?.validForCariPosting ??
        row?.valid_for_cari_posting
    );
    if (!accountId) {
      return {
        label: l("Missing", "Eksik"),
        className: "bg-rose-100 text-rose-700",
        detail: "",
      };
    }
    if (!validForPosting) {
      return {
        label: l("Invalid", "Gecersiz"),
        className: "bg-amber-100 text-amber-800",
        detail: l(
          "Account must be active, postable, and in selected legal-entity chart.",
          "Hesap aktif, postlanabilir ve secili legal-entity hesap planinda olmali."
        ),
      };
    }
    return {
      label: l("OK", "Tamam"),
      className: "bg-emerald-100 text-emerald-700",
      detail: "",
    };
  }

  function getBankPurposeMappingStatus(row, readinessRow, purposeCode) {
    const accountId = toPositiveInt(row?.accountId || row?.account_id);
    const validForBankControlParent = toBoolean(
      row?.validForBankControlParent ?? row?.valid_for_bank_control_parent
    );
    const hasValidationSnapshot =
      row?.validForBankControlParent !== undefined ||
      row?.valid_for_bank_control_parent !== undefined;
    if (!accountId) {
      return {
        label: l("Missing", "Eksik"),
        className: "bg-rose-100 text-rose-700",
        detail: "",
      };
    }
    if (!hasValidationSnapshot) {
      return {
        label: l("Selected", "Secildi"),
        className: "bg-sky-100 text-sky-700",
        detail: l(
          "Save to validate BANK control-parent rules for the selected account.",
          "Secilen hesap icin BANK kontrol-parent kurallarini dogrulamak uzere kaydedin."
        ),
      };
    }
    if (readinessRow) {
      return getPurposeReadinessStatus(readinessRow, purposeCode);
    }
    if (!validForBankControlParent) {
      return {
        label: l("Invalid", "Gecersiz"),
        className: "bg-amber-100 text-amber-800",
        detail: l(
          "Account must be active, ASSET, and in the selected legal-entity chart. Non-postable parent accounts are allowed.",
          "Hesap aktif, VARLIK tipinde ve secilen legal-entity hesap planinda olmali. Postlanamayan parent hesaplara izin verilir."
        ),
      };
    }
    return {
      label: l("OK", "Tamam"),
      className: "bg-emerald-100 text-emerald-700",
      detail: l(
        "Valid BANK control parent mapping.",
        "Gecerli BANK kontrol parent eslemesi."
      ),
    };
  }

  function handleTemplateOverrideChange(purposeCode, nextAccountId) {
    const normalizedPurposeCode = toUpper(purposeCode);
    if (!normalizedPurposeCode) {
      return;
    }
    setTemplateOverridesByPurpose((prev) => ({
      ...prev,
      [normalizedPurposeCode]: nextAccountId,
    }));
  }

  async function handleTemplatePreview() {
    if (!canReadLegalEntities) {
      setError(l("Missing permission: org.tree.read", "Eksik yetki: org.tree.read"));
      return;
    }

    const legalEntityId = toPositiveInt(templateWizardForm.legalEntityId);
    const packId = String(templateWizardForm.packId || "").trim();
    if (!legalEntityId || !packId) {
      setError(
        l(
          "Select legal entity and policy pack first.",
          "Once legal entity ve politika paketi secin."
        )
      );
      return;
    }

    setSaving("policy-pack-resolve");
    setError("");
    setMessage("");
    setTemplateApplyResult(null);
    try {
      const response = await resolvePolicyPack(packId, { legalEntityId });
      const rows = Array.isArray(response?.rows) ? response.rows : [];
      setTemplatePreviewRows(rows);
      setTemplateOverridesByPurpose({});
      setMessage(
        l(
          "Template preview prepared. Review rows and confirm apply to write mappings.",
          "Sablon onizlemesi hazirlandi. Satirlari kontrol edin ve yazmak icin onaylayin."
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to resolve policy pack.", "Politika paketi onizlemesi alinamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function handleTemplateApply() {
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }

    const legalEntityId = toPositiveInt(templateWizardForm.legalEntityId);
    const packId = String(templateWizardForm.packId || "").trim();
    if (!legalEntityId || !packId) {
      setError(
        l(
          "Select legal entity and policy pack first.",
          "Once legal entity ve politika paketi secin."
        )
      );
      return;
    }
    if (templatePreviewRows.length === 0) {
      setError(
        l(
          "Run template preview before confirm apply.",
          "Onaylamadan once sablon onizlemesi calistirin."
        )
      );
      return;
    }

    const rows = [];
    for (const previewRow of templatePreviewRows) {
      const purposeCode = toUpper(previewRow?.purposeCode);
      if (!purposeCode) {
        continue;
      }
      const resolvedAccountId = toPositiveInt(previewRow?.accountId);
      const overrideAccountId = toPositiveInt(
        templateOverridesByPurpose[purposeCode]
      );
      const effectiveAccountId = previewRow?.missing
        ? overrideAccountId
        : resolvedAccountId;
      if (!effectiveAccountId) {
        setError(
          l(
            `Select account override for missing purpose ${purposeCode} before apply.`,
            `Uygulamadan once eksik ${purposeCode} amaci icin hesap secin.`
          )
        );
        return;
      }
      rows.push({
        purposeCode,
        accountId: effectiveAccountId,
      });
    }

    setSaving("policy-pack-apply");
    setError("");
    setMessage("");
    try {
      const response = await applyPolicyPack(packId, {
        legalEntityId,
        mode: toUpper(templateWizardForm.mode || "MERGE"),
        rows,
      });
      setTemplateApplyResult({
        packId: String(response?.packId || packId),
        mode: String(response?.mode || templateWizardForm.mode || "MERGE"),
        appliedAt: response?.metadata?.appliedAt || null,
      });
      setMessage(
        l(
          "Template applied successfully. Module readiness refreshed.",
          "Sablon basariyla uygulandi. Modul hazirlik bilgisi yenilendi."
        )
      );
      await Promise.all([
        refreshLegalEntity(legalEntityId),
        loadManualMappings(legalEntityId),
      ]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to apply policy pack.", "Politika paketi uygulanamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  function handleManualPurposeAccountChange(purposeCode, nextAccountId) {
    const normalizedPurposeCode = toUpper(purposeCode);
    if (!normalizedPurposeCode) {
      return;
    }
    const updater = (prev) => ({
      ...prev,
      [normalizedPurposeCode]: {
        ...(prev[normalizedPurposeCode] || {}),
        purposeCode: normalizedPurposeCode,
        accountId: nextAccountId,
      },
    });
    if (isManualBankModule) {
      setManualBankMappingsByPurpose(updater);
      return;
    }
    if (isManualRevrecModule) {
      setManualRevrecMappingsByPurpose(updater);
      return;
    }
    if (isManualCashModule) {
      setManualCashMappingsByPurpose(updater);
      return;
    }
    setManualCariMappingsByPurpose(updater);
  }

  async function handleSaveManualPurposeMappings() {
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }

    const legalEntityId = selectedManualLegalEntityId;
    if (!legalEntityId) {
      setError(l("Select legal entity first.", "Once legal entity secin."));
      return;
    }

    const moduleKey = isManualBankModule
      ? PURPOSE_MAPPING_MODULE_KEYS.BANK
      : isManualRevrecModule
      ? PURPOSE_MAPPING_MODULE_KEYS.REVREC
      : isManualCashModule
      ? PURPOSE_MAPPING_MODULE_KEYS.CASH
      : PURPOSE_MAPPING_MODULE_KEYS.CARI;
    const isBank = moduleKey === PURPOSE_MAPPING_MODULE_KEYS.BANK;
    const isRevrec = moduleKey === PURPOSE_MAPPING_MODULE_KEYS.REVREC;
    const isCash = moduleKey === PURPOSE_MAPPING_MODULE_KEYS.CASH;
    const requiredPurposeCodes = isBank
      ? BANK_PURPOSE_CODES
      : isRevrec
      ? REVREC_REQUIRED_PURPOSE_CODES
      : isCash
      ? []
      : CARI_REQUIRED_PURPOSE_CODES;
    const optionalPurposeCodes = isBank
      ? []
      : isRevrec
      ? []
      : isCash
      ? CASH_PURPOSE_CODES
      : CARI_OPTIONAL_CONTEXT_PURPOSE_CODES;
    const mappingsByPurpose = isBank
      ? manualBankMappingsByPurpose
      : isRevrec
      ? manualRevrecMappingsByPurpose
      : isCash
      ? manualCashMappingsByPurpose
      : manualCariMappingsByPurpose;
    const savingKey = isBank
      ? "manual-bank-purpose-mappings"
      : isRevrec
      ? "manual-revrec-purpose-mappings"
      : isCash
      ? "manual-cash-purpose-mappings"
      : "manual-cari-purpose-mappings";

    const payloadRows = [];
    for (const purposeCode of requiredPurposeCodes) {
      const accountId = toPositiveInt(mappingsByPurpose[purposeCode]?.accountId);
      if (!accountId) {
        setError(
          l(
            `Select account for ${purposeCode} before saving.`,
            `Kaydetmeden once ${purposeCode} icin hesap secin.`
          )
        );
        return;
      }
      payloadRows.push({ purposeCode, accountId });
    }
    for (const purposeCode of optionalPurposeCodes) {
      const accountId = toPositiveInt(mappingsByPurpose[purposeCode]?.accountId);
      if (!accountId) {
        continue;
      }
      payloadRows.push({ purposeCode, accountId });
    }
    if (payloadRows.length === 0) {
      setError(
        l(
          "Select at least one account before saving.",
          "Kaydetmeden once en az bir hesap secin."
        )
      );
      return;
    }

    setSaving(savingKey);
    setError("");
    setMessage("");
    try {
      for (const row of payloadRows) {
        await upsertJournalPurposeAccount({
          legalEntityId,
          moduleKey,
          purposeCode: row.purposeCode,
          accountId: row.accountId,
        });
      }

      setMessage(
        isBank
          ? l(
              "Manual BANK purpose mappings saved.",
              "Manuel BANK amac eslemeleri kaydedildi."
            )
          : isRevrec
          ? l(
              "Manual REVREC purpose mappings saved.",
              "Manuel REVREC amac eslemeleri kaydedildi."
            )
          : isCash
          ? l(
              "Manual CASH purpose mappings saved.",
              "Manuel CASH amac eslemeleri kaydedildi."
            )
          : l(
              "Manual CARI purpose mappings saved.",
              "Manuel CARI amac eslemeleri kaydedildi."
            )
      );
      await Promise.all([refreshLegalEntity(legalEntityId), loadManualMappings(legalEntityId)]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          (isBank
            ? l(
                "Failed to save manual BANK purpose mappings.",
                "Manuel BANK amac eslemeleri kaydedilemedi."
              )
            : isRevrec
            ? l(
                "Failed to save manual REVREC purpose mappings.",
                "Manuel REVREC amac eslemeleri kaydedilemedi."
              )
            : isCash
            ? l(
                "Failed to save manual CASH purpose mappings.",
                "Manuel CASH amac eslemeleri kaydedilemedi."
              )
            : l(
                "Failed to save manual CARI purpose mappings.",
                "Manuel CARI amac eslemeleri kaydedilemedi."
              ))
      );
    } finally {
      setSaving("");
    }
  }

  async function handleSaveManualShareholderMappings() {
    if (!canUpsertShareholderParentMappings) {
      setError(
        l(
          "Missing permission: org.legal_entity.upsert",
          "Eksik yetki: org.legal_entity.upsert"
        )
      );
      return;
    }

    const legalEntityId = selectedManualLegalEntityId;
    const capitalCreditParentAccountId = toPositiveInt(
      manualMappingsForm.capitalCreditParentAccountId
    );
    const commitmentDebitParentAccountId = toPositiveInt(
      manualMappingsForm.commitmentDebitParentAccountId
    );

    if (!legalEntityId || !capitalCreditParentAccountId || !commitmentDebitParentAccountId) {
      setError(
        l(
          "Both shareholder parent accounts are required.",
          "Iki ortak parent hesap secimi zorunludur."
        )
      );
      return;
    }
    if (capitalCreditParentAccountId === commitmentDebitParentAccountId) {
      setError(
        l(
          "Shareholder parent accounts must be different.",
          "Ortak parent hesaplari farkli olmali."
        )
      );
      return;
    }

    setSaving("manual-shareholder-purpose-mappings");
    setError("");
    setMessage("");
    try {
      await upsertShareholderJournalConfig({
        legalEntityId,
        capitalCreditParentAccountId,
        commitmentDebitParentAccountId,
      });
      setMessage(
        l(
          "Manual shareholder parent mappings saved.",
          "Manuel ortak parent eslemeleri kaydedildi."
        )
      );
      await Promise.all([refreshLegalEntity(legalEntityId), loadManualMappings(legalEntityId)]);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to save shareholder parent mappings.",
            "Ortak parent eslemeleri kaydedilemedi."
          )
      );
    } finally {
      setSaving("");
    }
  }

  function resetBookForm() {
    setBookForm((prev) => ({
      ...prev,
      ...DEFAULT_BOOK_FORM,
      legalEntityId: prev.legalEntityId,
      calendarId: prev.calendarId,
      baseCurrencyCode: prev.baseCurrencyCode || "USD",
    }));
    setBookEditingCode("");
    setError("");
    setMessage("");
  }

  function handleBookEdit(book) {
    const code = String(book?.code || "").trim();
    if (!code) {
      return;
    }
    setBookEditingCode(code);
    setBookForm((prev) => ({
      ...prev,
      legalEntityId: String(book?.legal_entity_id || ""),
      calendarId: String(book?.calendar_id || ""),
      code,
      name: String(book?.name || "").trim(),
      bookType: toUpper(book?.book_type) || "LOCAL",
      baseCurrencyCode: toUpper(book?.base_currency_code) || "USD",
    }));
    setError("");
    setMessage("");
  }

  async function handleBookSubmit(event) {
    event.preventDefault();
    if (!canUpsertBooks) {
      setError(l("Missing permission: gl.book.upsert", "Eksik yetki: gl.book.upsert"));
      return;
    }

    const legalEntityId = toPositiveInt(bookForm.legalEntityId);
    const calendarId = toPositiveInt(bookForm.calendarId);
    if (!legalEntityId || !calendarId) {
      setError(l("legalEntityId and calendarId are required.", "legalEntityId ve calendarId zorunludur."));
      return;
    }

    const isEditMode = Boolean(bookEditingCode);

    setSaving("book");
    setError("");
    setMessage("");
    try {
      await upsertBook({
        legalEntityId,
        calendarId,
        code: bookForm.code.trim(),
        name: bookForm.name.trim(),
        bookType: bookForm.bookType,
        baseCurrencyCode: bookForm.baseCurrencyCode.trim().toUpperCase(),
      });
      resetBookForm();
      setMessage(
        isEditMode
          ? l("Book updated.", "Defter guncellendi.")
          : l("Book saved.", "Defter kaydedildi.")
      );
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save book.", "Defter kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleCoaSubmit(event) {
    event.preventDefault();
    if (!canUpsertCoas) {
      setError(l("Missing permission: gl.coa.upsert", "Eksik yetki: gl.coa.upsert"));
      return;
    }

    const legalEntityId = toPositiveInt(coaForm.legalEntityId);
    if (coaForm.scope === "LEGAL_ENTITY" && !legalEntityId) {
      setError(l("legalEntityId is required when scope is LEGAL_ENTITY.", "scope LEGAL_ENTITY iken legalEntityId zorunludur."));
      return;
    }

    setSaving("coa");
    setError("");
    setMessage("");
    try {
      await upsertCoa({
        scope: coaForm.scope,
        legalEntityId: coaForm.scope === "LEGAL_ENTITY" ? legalEntityId : undefined,
        code: coaForm.code.trim(),
        name: coaForm.name.trim(),
      });
      setCoaForm((prev) => ({ ...prev, code: "", name: "" }));
      setMessage(l("Chart of accounts saved.", "Hesap plani kaydedildi."));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save CoA.", "Hesap plani kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  function handleToggleAccountTypeGroup(accountType) {
    const normalizedType = toUpper(accountType);
    if (!selectedCoaKey || !normalizedType) {
      return;
    }
    setCollapsedAccountTypeKeysByCoaId((prev) => {
      const baseTypeValues = Array.isArray(prev[selectedCoaKey])
        ? prev[selectedCoaKey]
        : defaultCollapsedAccountTypeKeys;
      const nextSet = new Set(
        baseTypeValues
          .map((value) => toUpper(value))
          .filter(Boolean)
      );
      if (nextSet.has(normalizedType)) {
        nextSet.delete(normalizedType);
      } else {
        nextSet.add(normalizedType);
      }
      return {
        ...prev,
        [selectedCoaKey]: Array.from(nextSet),
      };
    });
  }

  function handleToggleAccountRowCollapse(accountId) {
    const normalizedAccountId = toPositiveInt(accountId);
    if (!selectedCoaKey || !normalizedAccountId) {
      return;
    }
    setCollapsedAccountIdsByCoaId((prev) => {
      const baseAccountIds = Array.isArray(prev[selectedCoaKey])
        ? prev[selectedCoaKey]
        : defaultCollapsedAccountIds;
      const nextSet = new Set(
        baseAccountIds
          .map((value) => toPositiveInt(value))
          .filter(Boolean)
      );
      if (nextSet.has(normalizedAccountId)) {
        nextSet.delete(normalizedAccountId);
      } else {
        nextSet.add(normalizedAccountId);
      }
      return {
        ...prev,
        [selectedCoaKey]: Array.from(nextSet),
      };
    });
  }

  function handleSelectTreeAccount(account) {
    if (!selectedCoaId) {
      return;
    }
    const accountId = toPositiveInt(account?.id);
    if (!accountId) {
      return;
    }
    setAccountEditorDraftMode(false);
    setSelectedAccountIdByCoaId((prev) => ({
      ...prev,
      [selectedCoaKey]: accountId,
    }));
  }

  function handleStartAddRootAccount() {
    if (!selectedCoaId) {
      setError(l("Select CoA first.", "Once hesap plani secin."));
      return;
    }
    setError("");
    setMessage("");
    setAccountEditorDraftMode(true);
    setAccountEditorForm(createAccountEditorDraft());
  }

  function handleStartAddChildAccount(parentAccount) {
    if (!selectedCoaId) {
      setError(l("Select CoA first.", "Once hesap plani secin."));
      return;
    }
    const parentAccountId = toPositiveInt(parentAccount?.id);
    const parentCode = toUpper(parentAccount?.code);
    if (!parentCode || !parentAccountId) {
      setError(
        l(
          "Select a valid parent account first.",
          "Once gecerli bir ust hesap secin."
        )
      );
      return;
    }
    setError("");
    setMessage("");
    setSelectedAccountIdByCoaId((prev) => ({
      ...prev,
      [selectedCoaKey]: parentAccountId,
    }));
    setAccountEditorDraftMode(true);
    setAccountEditorForm(
      createAccountEditorDraft({
        parentCode,
        accountType: toUpper(parentAccount?.account_type),
        normalSide: toUpper(parentAccount?.normal_side),
        allowPosting: true,
      })
    );
  }

  async function maybePromptParentBalanceTransferAfterChildCreate({
    coaId,
    parentAccount,
    childAccountId,
    childCode,
    childName,
  }) {
    const parentAccountId = toPositiveInt(parentAccount?.id);
    if (!parentAccountId || !toPositiveInt(childAccountId)) {
      return false;
    }

    const coaRow = coas.find((row) => toPositiveInt(row?.id) === toPositiveInt(coaId));
    const legalEntityId = toPositiveInt(
      coaRow?.legal_entity_id ?? parentAccount?.legal_entity_id
    );
    if (!legalEntityId) {
      return false;
    }

    if (!canCreateJournals) {
      setMessage(
        l(
          "Account saved. Balance transfer prompt skipped (missing permission: gl.journal.create).",
          "Hesap kaydedildi. Bakiye aktarim adimi atlandi (eksik yetki: gl.journal.create)."
        )
      );
      return false;
    }
    if (!canReadBooks || !canReadFiscalPeriods || !canReadTrialBalance) {
      setMessage(
        l(
          "Account saved. Balance transfer prompt skipped (book/period/trial balance read permission missing).",
          "Hesap kaydedildi. Bakiye aktarim adimi atlandi (defter/period/mizan okuma yetkisi eksik)."
        )
      );
      return false;
    }

    const legalEntityBooks = books
      .filter((book) => toPositiveInt(book?.legal_entity_id) === legalEntityId)
      .sort((left, right) => String(left?.code || "").localeCompare(String(right?.code || "")));
    if (legalEntityBooks.length === 0) {
      setMessage(
        l(
          "Account saved. No legal-entity book found to evaluate parent balance transfer.",
          "Hesap kaydedildi. Parent bakiye aktarimini degerlendirmek icin legal-entity defteri bulunamadi."
        )
      );
      return false;
    }

    const preferredBook =
      legalEntityBooks.find((book) => toUpper(book?.book_type) === "LOCAL") || legalEntityBooks[0];
    const bookId = toPositiveInt(preferredBook?.id);
    const calendarId = toPositiveInt(preferredBook?.calendar_id);
    if (!bookId || !calendarId) {
      setMessage(
        l(
          "Account saved. Book/calendar resolution failed for automatic balance transfer.",
          "Hesap kaydedildi. Otomatik bakiye aktarimi icin defter/takvim cozumlenemedi."
        )
      );
      return false;
    }

    const periodResponse = await listFiscalPeriods(calendarId);
    const periodRows = Array.isArray(periodResponse?.rows) ? periodResponse.rows : [];
    const selectedPeriod = pickDefaultPeriod(periodRows);
    const fiscalPeriodId = toPositiveInt(selectedPeriod?.id);
    if (!fiscalPeriodId) {
      setMessage(
        l(
          "Account saved. No fiscal period found to evaluate parent balance transfer.",
          "Hesap kaydedildi. Parent bakiye aktarimini degerlendirmek icin fiscal period bulunamadi."
        )
      );
      return false;
    }

    const trialBalance = await getTrialBalance({
      bookId,
      fiscalPeriodId,
      includeRollup: true,
    });
    const trialRows = Array.isArray(trialBalance?.rows) ? trialBalance.rows : [];
    const parentBalanceRow =
      trialRows.find((row) => toPositiveInt(row?.account_id) === parentAccountId) || null;
    const directBalance = Number(parentBalanceRow?.direct_balance ?? parentBalanceRow?.balance ?? 0);
    if (!Number.isFinite(directBalance) || Math.abs(directBalance) <= 0.0001) {
      return false;
    }

    const baseCurrencyCode = toUpper(preferredBook?.base_currency_code) || "USD";
    const periodLabel = `${selectedPeriod?.fiscal_year || ""}/${selectedPeriod?.period_no || ""} ${
      selectedPeriod?.period_name || ""
    }`.trim();
    const parentCode = toUpper(parentAccount?.code) || String(parentAccountId);
    const parentName = String(parentAccount?.name || "").trim();
    const formattedBalance = `${directBalance.toLocaleString(isTr ? "tr-TR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${baseCurrencyCode}`;

    const choiceRaw = window.prompt(
      l(
        `Parent account ${parentCode}${parentName ? ` - ${parentName}` : ""} has direct balance ${formattedBalance} in ${preferredBook?.code || bookId} (${periodLabel || fiscalPeriodId}). Choose: 1=Keep on parent, 2=Move all to new child ${childCode}, 3=Move all to another account.`,
        `Parent hesap ${parentCode}${parentName ? ` - ${parentName}` : ""} icin ${preferredBook?.code || bookId} (${periodLabel || fiscalPeriodId}) doneminde direkt bakiye ${formattedBalance}. Secim yapin: 1=Parentta kalsin, 2=Tamamini yeni alt hesaba (${childCode}) aktar, 3=Tamamini baska hesaba aktar.`
      ),
      "2"
    );
    const choice = String(choiceRaw || "")
      .trim()
      .toUpperCase();
    if (!choice || choice === "1") {
      return false;
    }
    if (choice !== "2" && choice !== "3") {
      setError(
        l(
          "Invalid transfer choice. Use 1, 2, or 3.",
          "Gecersiz aktarim secimi. 1, 2 veya 3 kullanin."
        )
      );
      return false;
    }

    const accountPool = [...selectedCoaAccounts];
    if (!accountPool.some((row) => toPositiveInt(row?.id) === toPositiveInt(childAccountId))) {
      accountPool.push({
        id: childAccountId,
        code: childCode,
        name: childName,
      });
    }
    const accountsById = new Map();
    const accountsByCode = new Map();
    for (const row of accountPool) {
      const accountId = toPositiveInt(row?.id);
      const accountCode = toUpper(row?.code);
      if (accountId && !accountsById.has(accountId)) {
        accountsById.set(accountId, row);
      }
      if (accountCode && !accountsByCode.has(accountCode)) {
        accountsByCode.set(accountCode, row);
      }
    }

    let targetAccount = accountsById.get(toPositiveInt(childAccountId)) || null;
    if (choice === "3") {
      const targetRaw = window.prompt(
        l(
          "Enter target account code or account id.",
          "Hedef hesap kodu veya hesap id girin."
        ),
        ""
      );
      const targetKey = String(targetRaw || "").trim();
      const targetId = toPositiveInt(targetKey);
      targetAccount =
        (targetId ? accountsById.get(targetId) : null) || accountsByCode.get(toUpper(targetKey)) || null;
      if (!targetAccount) {
        setError(
          l(
            "Target account not found in selected CoA.",
            "Secili hesap planinda hedef hesap bulunamadi."
          )
        );
        return false;
      }
    }

    const targetAccountId = toPositiveInt(targetAccount?.id);
    if (!targetAccountId || targetAccountId === parentAccountId) {
      setError(
        l(
          "Target account must be different from parent account.",
          "Hedef hesap parent hesaptan farkli olmalidir."
        )
      );
      return false;
    }

    const targetCode = toUpper(targetAccount?.code) || String(targetAccountId);
    const targetName = String(targetAccount?.name || "").trim();
    const confirmProceed = window.confirm(
      l(
        `Create balance transfer journal now?\nSource: ${parentCode}\nTarget: ${targetCode}${targetName ? ` - ${targetName}` : ""}\nAmount: ${formattedBalance}\nBook: ${preferredBook?.code || bookId}\nPeriod: ${periodLabel || fiscalPeriodId}`,
        `Bakiye aktarim fisini simdi olusturulsun mu?\nKaynak: ${parentCode}\nHedef: ${targetCode}${targetName ? ` - ${targetName}` : ""}\nTutar: ${formattedBalance}\nDefter: ${preferredBook?.code || bookId}\nDonem: ${periodLabel || fiscalPeriodId}`
      )
    );
    if (!confirmProceed) {
      return false;
    }

    const entryDate = pickEntryDateForPeriod(selectedPeriod, toIsoLocalDate());
    setSaving("account-balance-transfer");
    try {
      const reclassResult = await createBalanceSplitReclassification({
        legalEntityId,
        bookId,
        fiscalPeriodId,
        sourceAccountId: parentAccountId,
        entryDate,
        documentDate: entryDate,
        currencyCode: baseCurrencyCode,
        allocationMode: "PERCENT",
        description: l(
          `Subaccount balance transfer ${parentCode} -> ${targetCode}`,
          `Alt hesap bakiye aktarimi ${parentCode} -> ${targetCode}`
        ),
        note: l(
          `Triggered after creating child ${childCode}`,
          `${childCode} alt hesap olusturma sonrasi tetiklendi`
        ),
        targets: [
          {
            accountId: targetAccountId,
            percentage: 100,
          },
        ],
      });
      const journalEntryId = toPositiveInt(reclassResult?.journalEntryId);
      if (!journalEntryId) {
        throw new Error("Failed to resolve reclassification journal id");
      }

      if (canPostJournals) {
        await postJournal(journalEntryId);
        setMessage(
          l(
            `Account saved and parent balance moved to ${targetCode}. Journal #${journalEntryId} posted.`,
            `Hesap kaydedildi ve parent bakiye ${targetCode} hesabina tasindi. Fis #${journalEntryId} post edildi.`
          )
        );
      } else {
        setMessage(
          l(
            `Account saved and balance transfer draft created (#${journalEntryId}). Missing permission to post (gl.journal.post).`,
            `Hesap kaydedildi ve bakiye aktarim taslagi olusturuldu (#${journalEntryId}). Post etmek icin yetki eksik (gl.journal.post).`
          )
        );
      }
      return true;
    } finally {
      setSaving("");
    }
  }

  async function handleAccountSubmit(nextEditorForm) {
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }

    const coaId = toPositiveInt(accountForm.coaId);
    if (!coaId) {
      setError(l("coaId is required.", "coaId zorunludur."));
      return;
    }

    const editorForm = createAccountEditorDraft(nextEditorForm);
    const code = toUpper(editorForm.code);
    const name = String(editorForm.name || "").trim();
    const accountType = toUpper(editorForm.accountType) || "ASSET";
    const normalSide = toUpper(editorForm.normalSide) || "DEBIT";
    const parentCode = toUpper(editorForm.parentCode);
    if (!code || !name) {
      setError(
        l(
          "Account code and name are required.",
          "Hesap kodu ve adi zorunludur."
        )
      );
      return;
    }
    if (parentCode && parentCode === code) {
      setError(
        l(
          "Parent code cannot be same as account code.",
          "Ust kod, hesap kodu ile ayni olamaz."
        )
      );
      return;
    }

    const parentAccount = parentCode
      ? selectedCoaAccountByCode.get(parentCode)
      : null;
    if (parentCode && !parentAccount) {
      setError(
        l(
          `Parent code ${parentCode} not found in selected CoA.`,
          `Secili hesap planinda ${parentCode} parent kodu bulunamadi.`
        )
      );
      return;
    }
    const parentAccountId = toPositiveInt(parentAccount?.id);
    const currentAccountId = toPositiveInt(editorForm.accountId);
    if (currentAccountId && parentAccountId && currentAccountId === parentAccountId) {
      setError(
        l(
          "Account cannot be parent of itself.",
          "Hesap kendisini ust hesap secemez."
        )
      );
      return;
    }

    const currentAccount = currentAccountId
      ? selectedCoaAccountById.get(currentAccountId)
      : null;
    const currentCode = toUpper(currentAccount?.code);
    const isCreatingChildAccount = Boolean(parentAccountId) && (!currentAccountId || currentCode !== code);
    if (currentAccount && currentCode && currentCode !== code) {
      const confirmed = window.confirm(
        l(
          `Changing code ${currentCode} -> ${code} creates a new account row. Continue?`,
          `${currentCode} -> ${code} kod degisikligi yeni bir hesap satiri olusturur. Devam edilsin mi?`
        )
      );
      if (!confirmed) {
        return;
      }
    }

    setSaving("account");
    setError("");
    setMessage("");
    try {
      const response = await upsertAccount({
        coaId,
        code,
        name,
        accountType,
        normalSide,
        allowPosting: Boolean(editorForm.allowPosting),
        parentAccountId: parentAccountId || undefined,
      });
      const savedAccountId = toPositiveInt(response?.id);
      setAccountEditorDraftMode(false);
      if (savedAccountId) {
        setSelectedAccountIdByCoaId((prev) => ({
          ...prev,
          [selectedCoaKey]: savedAccountId,
        }));
      }
      setMessage(l("Account saved.", "Hesap kaydedildi."));
      await loadData();
      if (isCreatingChildAccount && savedAccountId && parentAccount) {
        try {
          await maybePromptParentBalanceTransferAfterChildCreate({
            coaId,
            parentAccount,
            childAccountId: savedAccountId,
            childCode: code,
            childName: name,
          });
        } catch (transferErr) {
          setError(
            transferErr?.response?.data?.message ||
              transferErr?.message ||
              l(
                "Account saved, but automatic parent balance transfer failed.",
                "Hesap kaydedildi, ancak otomatik parent bakiye aktarimi basarisiz oldu."
              )
          );
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save account.", "Hesap kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleSetAllAccountsAllowPosting(nextAllowPosting) {
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }
    if (!selectedCoaId) {
      setError(l("Select CoA first.", "Once hesap plani secin."));
      return;
    }
    if (selectedCoaAccounts.length === 0) {
      setError(l("No accounts found.", "Hesap bulunamadi."));
      return;
    }

    setSaving("account-posting-bulk");
    setError("");
    setMessage("");
    try {
      let processed = 0;
      let enforced = 0;
      for (const account of selectedCoaAccounts) {
        const response = await upsertAccount({
          coaId: selectedCoaId,
          code: String(account.code || "").trim(),
          name: String(account.name || "").trim(),
          accountType: String(account.account_type || "").toUpperCase(),
          normalSide: String(account.normal_side || "").toUpperCase(),
          allowPosting: Boolean(nextAllowPosting),
          parentAccountId: toPositiveInt(account.parent_account_id) || undefined,
        });
        processed += 1;
        if (response?.enforcedNonPosting) {
          enforced += 1;
        }
      }
      setMessage(
        l(
          `Posting updated for ${processed} accounts${enforced > 0 ? ` (${enforced} kept non-posting by rule).` : "."}`,
          `${processed} hesap icin post secenegi guncellendi${enforced > 0 ? ` (${enforced} hesap kural geregi post-disinda tutuldu).` : "."}`
        )
      );
      await loadData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to bulk update posting options.",
            "Toplu post secenegi guncellenemedi."
          )
      );
    } finally {
      setSaving("");
    }
  }

  async function handleAccountPostingChange(account, nextAllowPosting) {
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }

    const accountId = toPositiveInt(account?.id);
    const coaId = toPositiveInt(account?.coa_id);
    if (!accountId || !coaId) {
      setError(l("Invalid account row.", "Gecersiz hesap satiri."));
      return;
    }

    const hasChildren = parentAccountIds.has(accountId);
    if (hasChildren && nextAllowPosting) {
      setError(
        l(
          "Header account with children cannot be set to posting.",
          "Alt hesabi olan ust hesap post edilebilir yapilamaz."
        )
      );
      return;
    }

    setUpdatingAccountId(accountId);
    setError("");
    setMessage("");
    try {
      const response = await upsertAccount({
        coaId,
        code: String(account.code || "").trim(),
        name: String(account.name || "").trim(),
        accountType: String(account.account_type || "").toUpperCase(),
        normalSide: String(account.normal_side || "").toUpperCase(),
        allowPosting: Boolean(nextAllowPosting),
        parentAccountId: toPositiveInt(account.parent_account_id) || undefined,
      });

      if (response?.enforcedNonPosting) {
        setMessage(
          l(
            "Account has child rows; posting was kept OFF by rule.",
            "Hesabin alt satirlari oldugu icin post secenegi kural geregi kapali tutuldu."
          )
        );
      } else {
        setMessage(
          l(
            `Posting option updated for account ${account.code || accountId}.`,
            `${account.code || accountId} hesap icin post secenegi guncellendi.`
          )
        );
      }
      await loadData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to update account posting option.",
            "Hesap post secenegi guncellenemedi."
          )
      );
    } finally {
      setUpdatingAccountId(null);
    }
  }

  async function loadDefaultCoaAccounts({
    accountsToLoad,
    savingKey,
    confirmMessage,
    successMessage,
    failureMessage,
  }) {
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }

    const coaId = toPositiveInt(accountForm.coaId);
    if (!coaId) {
      setError(
        l(
          "Select a CoA first, then run default account loader.",
          "Once bir hesap plani secin, sonra varsayilan hesap yukleyiciyi calistirin."
        )
      );
      return;
    }

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setSaving(savingKey);
    setError("");
    setMessage("");

    try {
      let processed = 0;
      for (const account of accountsToLoad) {
        // Keep explicit non-postable defaults intact instead of forcing posting=true.
        await upsertAccount({
          coaId,
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          normalSide: account.normalSide,
          allowPosting: account.allowPosting ?? true,
        });
        processed += 1;
      }
      setMessage(successMessage(processed));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || failureMessage);
    } finally {
      setSaving("");
    }
  }

  async function handleLoadTurkishDefaultAccounts() {
    await loadDefaultCoaAccounts({
      accountsToLoad: TURKISH_DEFAULT_COA_ACCOUNTS,
      savingKey: "turkish-default-accounts",
      confirmMessage: l(
        `Load ${TURKISH_DEFAULT_COA_ACCOUNTS.length} Turkish default accounts into selected CoA?`,
        `Secili hesap planina ${TURKISH_DEFAULT_COA_ACCOUNTS.length} adet varsayilan Turk hesap plani hesabi yuklensin mi?`
      ),
      successMessage: (processed) =>
        l(
          `Turkish default CoA loaded. Processed ${processed} accounts.`,
          `Varsayilan Turk hesap plani yuklendi. ${processed} hesap isleme alindi.`
        ),
      failureMessage: l(
        "Failed to load Turkish default CoA accounts.",
        "Varsayilan Turk hesap plani hesaplari yuklenemedi."
      ),
    });
  }

  async function handleLoadUsaDefaultAccounts() {
    await loadDefaultCoaAccounts({
      accountsToLoad: USA_DEFAULT_COA_ACCOUNTS,
      savingKey: "usa-default-accounts",
      confirmMessage: l(
        `Load ${USA_DEFAULT_COA_ACCOUNTS.length} USA default accounts into selected CoA?`,
        `Secili hesap planina ${USA_DEFAULT_COA_ACCOUNTS.length} adet varsayilan ABD hesap plani hesabi yuklensin mi?`
      ),
      successMessage: (processed) =>
        l(
          `USA default CoA loaded. Processed ${processed} accounts.`,
          `Varsayilan ABD hesap plani yuklendi. ${processed} hesap isleme alindi.`
        ),
      failureMessage: l(
        "Failed to load USA default CoA accounts.",
        "Varsayilan ABD hesap plani hesaplari yuklenemedi."
      ),
    });
  }

  async function handleMappingSubmit(event) {
    event.preventDefault();
    if (!canUpsertMappings) {
      setError(l("Missing permission: gl.account_mapping.upsert", "Eksik yetki: gl.account_mapping.upsert"));
      return;
    }

    const sourceAccountId = toPositiveInt(mappingForm.sourceAccountId);
    const targetAccountId = toPositiveInt(mappingForm.targetAccountId);
    if (!sourceAccountId || !targetAccountId) {
      setError(l("sourceAccountId and targetAccountId are required.", "sourceAccountId ve targetAccountId zorunludur."));
      return;
    }

    setSaving("mapping");
    setError("");
    setMessage("");
    try {
      await upsertAccountMapping({
        sourceAccountId,
        targetAccountId,
        mappingType: mappingForm.mappingType,
      });
      setMessage(l("Account mapping saved.", "Hesap eslemesi kaydedildi."));
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save mapping.", "Hesap eslemesi kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  if (!canReadBooks && !canReadCoas && !canReadAccounts) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {l(
          "You need GL read permissions (`gl.book.read`, `gl.coa.read`, `gl.account.read`) to use this page.",
          "Bu sayfayi kullanmak icin GL okuma yetkileri (`gl.book.read`, `gl.coa.read`, `gl.account.read`) gerekir."
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!accountsOnlyMode ? <TenantReadinessChecklist /> : null}

      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {accountsOnlyMode
            ? l("Create Chart of Accounts", "Hesap Plani Olustur")
            : l("GL Setup", "GL Ayarlari")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {accountsOnlyMode
            ? l(
                "Use the larger workspace below to manage account trees and account defaults.",
                "Asagidaki genis alanda hesap agacini ve varsayilan hesaplari yonetin."
              )
            : l(
                "Manage books, charts of accounts, accounts, and account mappings.",
                "Defterleri, hesap planlarini, hesaplari ve hesap eslemelerini yonetin."
              )}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}

      {!accountsOnlyMode ? (
        <>
          <section
            id="template-wizard"
            className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
          >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-emerald-900">
              {l("Recommended: Template Wizard", "Onerilen: Sablon Sihirbazi")}
            </h2>
            <p className="mt-1 text-xs text-emerald-800">
              {l(
                "Preview first (no write), then confirm apply to write selected purpose mappings.",
                "Once onizleme yapin (yazmaz), sonra secili amac eslemelerini yazmak icin onaylayin."
              )}
            </p>
          </div>
          <span className="rounded-full border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-800">
            {l("No silent writes", "Sessiz yazim yok")}
          </span>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <select
            value={templateWizardForm.legalEntityId}
            onChange={(event) =>
              setTemplateWizardForm((prev) => ({
                ...prev,
                legalEntityId: event.target.value,
              }))
            }
            className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">{l("Select legal entity", "Legal entity secin")}</option>
            {legalEntities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.code} - {entity.name}
              </option>
            ))}
          </select>

          <select
            value={templateWizardForm.packId}
            onChange={(event) =>
              setTemplateWizardForm((prev) => ({
                ...prev,
                packId: event.target.value,
              }))
            }
            className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">{l("Select policy pack", "Politika paketi secin")}</option>
            {availableTemplatePacks.map((pack) => (
              <option key={pack.packId} value={pack.packId}>
                {pack.packId} - {pack.label} ({pack.countryIso2})
              </option>
            ))}
          </select>

          <select
            value={templateWizardForm.mode}
            onChange={(event) =>
              setTemplateWizardForm((prev) => ({
                ...prev,
                mode: event.target.value,
              }))
            }
            className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm"
          >
            <option value="MERGE">MERGE</option>
            <option value="OVERWRITE">OVERWRITE</option>
          </select>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleTemplatePreview}
              disabled={saving === "policy-pack-resolve"}
              className="rounded-lg border border-emerald-400 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-60"
            >
              {saving === "policy-pack-resolve"
                ? l("Previewing...", "Onizleniyor...")
                : l("Preview template", "Sablonu onizle")}
            </button>
            <button
              type="button"
              onClick={handleTemplateApply}
              disabled={
                saving === "policy-pack-apply" || templatePreviewRows.length === 0
              }
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "policy-pack-apply"
                ? l("Applying...", "Uygulaniyor...")
                : l("Confirm apply", "Uygulamayi onayla")}
            </button>
          </div>
        </div>

        {templateApplyResult ? (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs text-emerald-900">
            {l("Applied pack", "Uygulanan paket")}: {templateApplyResult.packId} |{" "}
            {l("Mode", "Mod")}: {templateApplyResult.mode} |{" "}
            {l("Applied at", "Uygulama zamani")}:{" "}
            {templateApplyResult.appliedAt || l("n/a", "yok")}
          </div>
        ) : null}

        {templatePreviewRows.length > 0 ? (
          <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-emerald-50 text-left text-emerald-900">
                <tr>
                  <th className="px-3 py-2">{l("Purpose code", "Amac kodu")}</th>
                  <th className="px-3 py-2">{l("Module", "Modul")}</th>
                  <th className="px-3 py-2">{l("Proposed account", "Onerilen hesap")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                </tr>
              </thead>
              <tbody>
                {templatePreviewRows.map((row) => {
                  const purposeCode = toUpper(row?.purposeCode);
                  const missing = Boolean(row?.missing);
                  const overrideValue = String(
                    templateOverridesByPurpose[purposeCode] || ""
                  );
                  return (
                    <tr key={purposeCode} className="border-t border-slate-100">
                      <td className="px-3 py-2 align-top font-medium text-slate-800">
                        {purposeCode}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {String(row?.moduleKey || "-")}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {!missing ? (
                          <div className="text-slate-800">
                            {String(row?.accountCode || "")}{" "}
                            <span className="text-xs text-slate-500">
                              (#{toPositiveInt(row?.accountId) || "-"})
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xs text-rose-700">
                              {l("Missing reason", "Eksik nedeni")}:{" "}
                              {String(row?.reason || "no_match")}
                            </div>
                            <select
                              value={overrideValue}
                              onChange={(event) =>
                                handleTemplateOverrideChange(
                                  purposeCode,
                                  event.target.value
                                )
                              }
                              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                            >
                              <option value="">
                                {l("Select override account", "Override hesap secin")}
                              </option>
                              {templateOverrideAccountOptions.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {buildAccountLabel(account)}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {!missing ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            {String(row?.confidence || "HIGH")}
                          </span>
                        ) : (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                            {l("Missing", "Eksik")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-emerald-900">
            {l(
              "No preview rows yet. Select legal entity + pack and run preview.",
              "Henuz onizleme satiri yok. Legal entity + paket secip onizleme calistirin."
            )}
          </p>
        )}
          </section>

          <section
            id="manual-purpose-mappings"
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              {l(
                "Advanced: Manual Purpose Mappings",
                "Gelismis: Manuel Amac Eslemeleri"
              )}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {l(
                "Manual path is fully supported without templates.",
                "Manuel yol, sablon kullanmadan tamamen desteklenir."
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={manualMappingsForm.legalEntityId}
              onChange={(event) =>
                setManualMappingsForm((prev) => ({
                  ...prev,
                  legalEntityId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{l("Select legal entity", "Legal entity secin")}</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} - {entity.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => loadManualMappings(selectedManualLegalEntityId)}
              disabled={loadingManualMappings || !selectedManualLegalEntityId}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {loadingManualMappings ? l("Loading...", "Yukleniyor...") : l("Reload", "Yenile")}
            </button>
          </div>
        </div>

        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {l("Purpose mapping module:", "Amac esleme modulu:")}{" "}
          <span className="font-semibold text-slate-900">{manualPurposeModuleKey}</span>
          <br />
          {isManualBankModule
            ? l("Required BANK purpose codes:", "Zorunlu BANK amac kodlari:")
            : isManualRevrecModule
            ? l("Required REVREC purpose codes:", "Zorunlu REVREC amac kodlari:")
            : isManualCashModule
            ? l("Optional CASH purpose codes:", "Opsiyonel CASH amac kodlari:")
            : l("Required CARI purpose codes:", "Zorunlu CARI amac kodlari:")}{" "}
          {isManualBankModule
            ? BANK_PURPOSE_CODES.join(", ")
            : isManualRevrecModule
            ? REVREC_REQUIRED_PURPOSE_CODES.join(", ")
            : isManualCashModule
            ? CASH_PURPOSE_CODES.join(", ")
            : CARI_REQUIRED_PURPOSE_CODES.join(", ")}
          {manualPurposeModuleKey === PURPOSE_MAPPING_MODULE_KEYS.CARI ? (
            <>
              <br />
              {l(
                "Optional CARI settlement context purpose codes:",
                "Opsiyonel CARI settlement baglam amac kodlari:"
              )}{" "}
              {CARI_OPTIONAL_CONTEXT_PURPOSE_CODES.length}{" "}
              {l(
                "(hidden by default; use Show optional button below).",
                "(varsayilan gizli; asagidaki Opsiyonelleri goster butonunu kullanin)."
              )}
            </>
          ) : null}
          <br />
          {l(
            "Required shareholder parent purpose codes:",
            "Zorunlu ortak parent amac kodlari:"
          )}{" "}
          {SHAREHOLDER_REQUIRED_PURPOSE_CODES.join(", ")}
        </div>

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {isManualBankModule
                ? l("BANK mappings", "BANK eslemeleri")
                : isManualRevrecModule
                ? l("REVREC mappings", "REVREC eslemeleri")
                : isManualCashModule
                ? l("CASH mappings", "CASH eslemeleri")
                : l("CARI mappings", "CARI eslemeleri")}
            </h3>
            <select
              value={manualPurposeModuleKey}
              onChange={(event) => {
                const nextValue = toUpper(event.target.value);
                if (
                  nextValue !== PURPOSE_MAPPING_MODULE_KEYS.CARI &&
                  nextValue !== PURPOSE_MAPPING_MODULE_KEYS.BANK &&
                  nextValue !== PURPOSE_MAPPING_MODULE_KEYS.CASH &&
                  nextValue !== PURPOSE_MAPPING_MODULE_KEYS.REVREC
                ) {
                  return;
                }
                setManualPurposeModuleKey(nextValue);
              }}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
            >
              <option value={PURPOSE_MAPPING_MODULE_KEYS.CARI}>CARI</option>
              <option value={PURPOSE_MAPPING_MODULE_KEYS.BANK}>BANK</option>
              <option value={PURPOSE_MAPPING_MODULE_KEYS.CASH}>CASH</option>
              <option value={PURPOSE_MAPPING_MODULE_KEYS.REVREC}>REVREC</option>
            </select>
          </div>
          {manualPurposeModuleKey === PURPOSE_MAPPING_MODULE_KEYS.CARI ? (
            <button
              type="button"
              onClick={() => setShowOptionalCariMappings((prev) => !prev)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
            >
              {showOptionalCariMappings
                ? l("Hide optional context mappings", "Opsiyonel baglam eslemelerini gizle")
                : l(
                    `Show optional context mappings (${CARI_OPTIONAL_CONTEXT_PURPOSE_CODES.length})`,
                    `Opsiyonel baglam eslemelerini goster (${CARI_OPTIONAL_CONTEXT_PURPOSE_CODES.length})`
                  )}
            </button>
          ) : null}
        </div>
        {isManualBankModule ? (
          <p className="mb-2 text-xs text-slate-500">
            {l(
              "BANK rows define the control parent used by strict bank setup. Select an active ASSET account in the legal-entity chart; non-postable parent accounts are allowed and preferred.",
              "BANK satirlari siki banka kurulumunda kullanilan kontrol parent hesabini tanimlar. Legal-entity hesap planinda aktif bir VARLIK hesabi secin; postlanamayan parent hesaplara izin verilir ve tercih edilir."
            )}
          </p>
        ) : isManualRevrecModule ? (
          <p className="mb-2 text-xs text-slate-500">
            {l(
              "Map all REVREC purpose codes so deferred/prepaid/accrual postings and long-short reclass entries can run automatically.",
              "Tum REVREC amac kodlarini esleyin; ertelenmis/pesin/tahakkuk kayitlari ile uzun-kisa vade aktarmalari otomatik calissin."
            )}
          </p>
        ) : isManualCashModule ? (
          <p className="mb-2 text-xs text-slate-500">
            {l(
              "CASH rows define standard defaults for FX exchange and cross-unit transit clearing. Users can still override per transaction, but readiness tracks missing defaults here.",
              "CASH satirlari kur degisimi ve unitler arasi nakit transferi icin standart varsayilanlari tanimlar. Kullanici islem bazinda override edebilir, ancak hazirlik ekrani eksik varsayilanlari burada takip eder."
            )}
          </p>
        ) : (
          <p className="mb-2 text-xs text-slate-500">
            {l(
              "Start with 4 required rows. Optional context rows only override settlement behavior for CASH, MANUAL, or ON_ACCOUNT.",
              "Ilk olarak 4 zorunlu satiri doldurun. Opsiyonel baglam satirlari sadece CASH, MANUAL veya ON_ACCOUNT settlement davranisini override eder."
            )}
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">{l("Purpose code", "Amac kodu")}</th>
                <th className="px-3 py-2">{l("Account", "Hesap")}</th>
                <th className="px-3 py-2">{l("Readiness", "Hazirlik")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleManualPurposeCodes.map((purposeCode) => {
                const row = manualPurposeMappingsByPurpose[purposeCode] || null;
                const selectedAccountId = String(toPositiveInt(row?.accountId) || "");
                const isRequiredPurpose =
                  isManualBankModule
                    ? BANK_PURPOSE_CODE_SET.has(purposeCode)
                    : isManualRevrecModule
                    ? REVREC_REQUIRED_PURPOSE_CODE_SET.has(purposeCode)
                    : CARI_REQUIRED_PURPOSE_CODE_SET.has(purposeCode);
                const isOptionalPurpose =
                  (manualPurposeModuleKey === PURPOSE_MAPPING_MODULE_KEYS.CARI &&
                    CARI_OPTIONAL_PURPOSE_CODE_SET.has(purposeCode)) ||
                  (isManualCashModule && CASH_PURPOSE_CODE_SET.has(purposeCode));
                const purposeMeta =
                  isManualBankModule
                    ? getBankPurposeUiMeta(purposeCode)
                    : isManualRevrecModule
                    ? getRevrecPurposeUiMeta(purposeCode)
                    : isManualCashModule
                    ? getCashPurposeUiMeta(purposeCode)
                    : getCariPurposeUiMeta(purposeCode);
                  const readinessStatus =
                    isManualBankModule
                      ? getBankPurposeMappingStatus(
                        row,
                        selectedManualBankReadiness,
                        purposeCode
                      )
                      : isManualRevrecModule
                      ? getRevrecPurposeMappingStatus(row)
                      : isManualCashModule
                    ? getPurposeReadinessStatus(selectedManualCashReadiness, purposeCode)
                    : isRequiredPurpose
                    ? getPurposeReadinessStatus(selectedManualCariReadiness, purposeCode)
                    : {
                        label: l("Optional", "Opsiyonel"),
                        className: "bg-slate-100 text-slate-700",
                        detail: l(
                          "Optional override; if empty fallback uses base mapping.",
                          "Opsiyonel override; bos ise fallback temel mapping'i kullanir."
                        ),
                      };
                const optionalTagLabel =
                  isManualBankModule
                    ? l("Required", "Zorunlu")
                    : isManualRevrecModule
                    ? l("Required", "Zorunlu")
                    : isManualCashModule
                    ? l("Default", "Varsayilan")
                    : l("Context override", "Baglam override");
                return (
                  <tr key={purposeCode} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{purposeCode}</div>
                      {purposeMeta ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          {l(purposeMeta.en, purposeMeta.tr)}
                        </p>
                      ) : null}
                      {purposeMeta ? (
                        <p className="text-[11px] text-slate-400">
                          {l(purposeMeta.exampleEn, purposeMeta.exampleTr)}
                        </p>
                      ) : null}
                      {isOptionalPurpose ? (
                        <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {optionalTagLabel}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={selectedAccountId}
                        onChange={(event) =>
                          handleManualPurposeAccountChange(
                            purposeCode,
                            event.target.value
                          )
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      >
                        <option value="">{l("Select account", "Hesap secin")}</option>
                        {manualPurposeAccountOptions.map((account) => (
                          <option key={account.id} value={account.id}>
                            {buildAccountLabel(account)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${readinessStatus.className}`}
                      >
                        {readinessStatus.label}
                      </span>
                      {readinessStatus.detail ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          {readinessStatus.detail}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={handleSaveManualPurposeMappings}
            disabled={isSavingManualPurposeMappings || !selectedManualLegalEntityId}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSavingManualPurposeMappings
              ? isManualBankModule
                ? l("Saving BANK mappings...", "BANK eslemeleri kaydediliyor...")
                : isManualRevrecModule
                ? l("Saving REVREC mappings...", "REVREC eslemeleri kaydediliyor...")
                : isManualCashModule
                ? l("Saving CASH mappings...", "CASH eslemeleri kaydediliyor...")
                : l("Saving CARI mappings...", "CARI eslemeleri kaydediliyor...")
              : isManualBankModule
              ? l("Save BANK mappings", "BANK eslemelerini kaydet")
              : isManualRevrecModule
              ? l("Save REVREC mappings", "REVREC eslemelerini kaydet")
              : isManualCashModule
              ? l("Save CASH mappings", "CASH eslemelerini kaydet")
              : l("Save CARI mappings", "CARI eslemelerini kaydet")}
          </button>
        </div>

        <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {l("Shareholder parent mappings", "Ortak parent eslemeleri")}
        </h3>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              SHAREHOLDER_CAPITAL_CREDIT_PARENT
            </label>
            <select
              value={manualMappingsForm.capitalCreditParentAccountId}
              onChange={(event) =>
                setManualMappingsForm((prev) => ({
                  ...prev,
                  capitalCreditParentAccountId: event.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              <option value="">{l("Select account", "Hesap secin")}</option>
              {manualShareholderAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {buildAccountLabel(account)}
                </option>
              ))}
            </select>
            {(() => {
              const status = getPurposeReadinessStatus(
                selectedManualShareholderReadiness,
                "SHAREHOLDER_CAPITAL_CREDIT_PARENT"
              );
              return (
                <div className="mt-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}
                  >
                    {status.label}
                  </span>
                  {status.detail ? (
                    <p className="mt-1 text-[11px] text-slate-500">{status.detail}</p>
                  ) : null}
                </div>
              );
            })()}
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              SHAREHOLDER_COMMITMENT_DEBIT_PARENT
            </label>
            <select
              value={manualMappingsForm.commitmentDebitParentAccountId}
              onChange={(event) =>
                setManualMappingsForm((prev) => ({
                  ...prev,
                  commitmentDebitParentAccountId: event.target.value,
                }))
              }
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              <option value="">{l("Select account", "Hesap secin")}</option>
              {manualShareholderAccountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {buildAccountLabel(account)}
                </option>
              ))}
            </select>
            {(() => {
              const status = getPurposeReadinessStatus(
                selectedManualShareholderReadiness,
                "SHAREHOLDER_COMMITMENT_DEBIT_PARENT"
              );
              return (
                <div className="mt-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}
                  >
                    {status.label}
                  </span>
                  {status.detail ? (
                    <p className="mt-1 text-[11px] text-slate-500">{status.detail}</p>
                  ) : null}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="mt-2">
          <button
            type="button"
            onClick={handleSaveManualShareholderMappings}
            disabled={
              saving === "manual-shareholder-purpose-mappings" ||
              !selectedManualLegalEntityId
            }
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving === "manual-shareholder-purpose-mappings"
              ? l(
                  "Saving shareholder parents...",
                  "Ortak parent eslemeleri kaydediliyor..."
                )
              : l(
                  "Save shareholder parent mappings",
                  "Ortak parent eslemelerini kaydet"
                )}
          </button>
        </div>
          </section>
        </>
      ) : null}

      <div className={accountsOnlyMode ? "space-y-4" : "grid gap-4 xl:grid-cols-2"}>
        {!accountsOnlyMode ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Books", "Defterler")}</h2>
          {bookEditingCode ? (
            <p className="mb-2 text-xs text-slate-600">
              {l(
                `Editing book ${bookEditingCode}. Book code is locked.`,
                `${bookEditingCode} defteri duzenleniyor. Defter kodu kilitli.`
              )}
            </p>
          ) : null}
          <form onSubmit={handleBookSubmit} className="grid gap-2 md:grid-cols-3">
            <select
              value={bookForm.legalEntityId}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} - {entity.name}
                </option>
              ))}
            </select>
            <select
              value={bookForm.calendarId}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, calendarId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select calendar", "Takvim secin")}</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.code} - {calendar.name}
                </option>
              ))}
            </select>
            <select
              value={bookForm.bookType}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, bookType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {BOOK_TYPES.map((bookType) => (
                <option key={bookType} value={bookType}>
                  {bookType}
                </option>
              ))}
            </select>
            <input
              value={bookForm.code}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, code: event.target.value }))
              }
              disabled={Boolean(bookEditingCode)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Book code", "Defter kodu")}
              required
            />
            <input
              value={bookForm.name}
              onChange={(event) =>
                setBookForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Book name", "Defter adi")}
              required
            />
            <input
              value={bookForm.baseCurrencyCode}
              onChange={(event) =>
                setBookForm((prev) => ({
                  ...prev,
                  baseCurrencyCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Base currency (e.g. USD)", "Ana para birimi (orn. USD)")}
              maxLength={3}
              required
            />
            <button
              type="submit"
              disabled={saving === "book" || !canUpsertBooks}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-3"
            >
              {saving === "book"
                ? l("Saving...", "Kaydediliyor...")
                : bookEditingCode
                  ? l("Update Book", "Defteri Guncelle")
                  : l("Save Book", "Defteri Kaydet")}
            </button>
            {bookEditingCode ? (
              <button
                type="button"
                onClick={resetBookForm}
                disabled={saving === "book"}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 md:col-span-3"
              >
                {l("Cancel Edit", "Duzenlemeyi Iptal Et")}
              </button>
            ) : null}
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Entity", "Birim")}</th>
                  <th className="px-3 py-2">{l("Calendar", "Takvim")}</th>
                  <th className="px-3 py-2">{l("Currency", "Para Birimi")}</th>
                  <th className="px-3 py-2">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => {
                  const legalEntity = legalEntityById.get(
                    toPositiveInt(book.legal_entity_id)
                  );
                  const calendar = calendarById.get(toPositiveInt(book.calendar_id));
                  const legalEntityLabel = legalEntity
                    ? `${legalEntity.code} - ${legalEntity.name}`
                    : "-";
                  const calendarLabel = calendar
                    ? `${calendar.code} - ${calendar.name}`
                    : "-";
                  return (
                    <tr key={book.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{book.id}</td>
                      <td className="px-3 py-2">{book.code}</td>
                      <td className="px-3 py-2">{book.name}</td>
                      <td className="px-3 py-2">{legalEntityLabel}</td>
                      <td className="px-3 py-2">{calendarLabel}</td>
                      <td className="px-3 py-2">{toUpper(book.base_currency_code) || "-"}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleBookEdit(book)}
                          disabled={saving === "book" || !canUpsertBooks}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {l("Edit", "Duzenle")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {books.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-slate-500">
                      {l("No books found.", "Defter bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </section>
        ) : null}

        {!accountsOnlyMode ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Charts of Accounts", "Hesap Planlari")}
          </h2>
          <form onSubmit={handleCoaSubmit} className="grid gap-2 md:grid-cols-3">
            <select
              value={coaForm.scope}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, scope: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {COA_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </select>
            <select
              value={coaForm.legalEntityId}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, legalEntityId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={coaForm.scope !== "LEGAL_ENTITY"}
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code} - {entity.name}
                </option>
              ))}
            </select>
            <input
              value={coaForm.code}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("CoA code", "Hesap plani kodu")}
              required
            />
            <input
              value={coaForm.name}
              onChange={(event) =>
                setCoaForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("CoA name", "Hesap plani adi")}
              required
            />
            <button
              type="submit"
              disabled={saving === "coa" || !canUpsertCoas}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "coa" ? l("Saving...", "Kaydediliyor...") : l("Save CoA", "Hesap Planini Kaydet")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Scope", "Kapsam")}</th>
                  <th className="px-3 py-2">{l("Entity", "Birim")}</th>
                </tr>
              </thead>
              <tbody>
                {coas.map((coa) => {
                  const legalEntity = legalEntityById.get(
                    toPositiveInt(coa.legal_entity_id)
                  );
                  const legalEntityLabel = legalEntity
                    ? `${legalEntity.code} - ${legalEntity.name}`
                    : "-";
                  return (
                    <tr key={coa.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{coa.id}</td>
                      <td className="px-3 py-2">{coa.code}</td>
                      <td className="px-3 py-2">{coa.name}</td>
                      <td className="px-3 py-2">{coa.scope}</td>
                      <td className="px-3 py-2">{legalEntityLabel}</td>
                    </tr>
                  );
                })}
                {coas.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-slate-500">
                      {l("No CoA rows found.", "Hesap plani satiri bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </section>
        ) : null}

        {accountsOnlyMode ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">{l("Accounts", "Hesaplar")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadTurkishDefaultAccounts}
                disabled={saving === "turkish-default-accounts" || !canUpsertAccounts}
                className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 disabled:opacity-60"
              >
                {saving === "turkish-default-accounts"
                  ? l("Loading Turkish CoA...", "Turk hesap plani yukleniyor...")
                  : l("Load Turkish Default CoA", "Varsayilan Turk Hesap Planini Yukle")}
              </button>
              <button
                type="button"
                onClick={handleLoadUsaDefaultAccounts}
                disabled={saving === "usa-default-accounts" || !canUpsertAccounts}
                className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-60"
              >
                {saving === "usa-default-accounts"
                  ? l("Loading USA CoA...", "ABD hesap plani yukleniyor...")
                  : l("Load USA defaults", "Varsayilan ABD Hesap Planini Yukle")}
              </button>
            </div>
          </div>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {l(
              "Hint: For shareholder commitment parent mappings (e.g. 500/501), save those parent equity accounts with Allow posting turned off.",
              "Ipucu: Ortak sermaye taahhut parent eslemesinde (ornegin 500/501), parent ozkaynak hesaplarini Post edilmeye izin ver kapali olarak kaydedin."
            )}
          </div>
          <div className="mb-3 grid gap-2 lg:grid-cols-12">
            <select
              value={accountForm.coaId}
              onChange={(event) => {
                setAccountEditorDraftMode(false);
                setAccountForm((prev) => ({ ...prev, coaId: event.target.value }));
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm lg:col-span-4"
              required
            >
              <option value="">{l("Select CoA", "Hesap plani secin")}</option>
              {coas.map((coa) => (
                <option key={coa.id} value={coa.id}>
                  {coa.code} - {coa.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center justify-end gap-2 lg:col-span-8">
              <button
                type="button"
                onClick={() => handleSetAllAccountsAllowPosting(true)}
                disabled={
                  saving === "account-posting-bulk" ||
                  !canUpsertAccounts ||
                  !selectedCoaId
                }
                className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {l("Select All Post", "Tumunu Post Sec")}
              </button>
              <button
                type="button"
                onClick={() => handleSetAllAccountsAllowPosting(false)}
                disabled={
                  saving === "account-posting-bulk" ||
                  !canUpsertAccounts ||
                  !selectedCoaId
                }
                className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {l("Unselect All Post", "Tumunu Post Kaldir")}
              </button>
              <button
                type="button"
                onClick={handleStartAddRootAccount}
                disabled={!canUpsertAccounts || !selectedCoaId}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {l("Add Root Account", "Kok Hesap Ekle")}
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-12">
            <div
              className={`rounded-lg border border-slate-200 bg-white ${
                accountsOnlyMode ? "lg:col-span-8" : "lg:col-span-7"
              }`}
            >
              <div className={`${accountsOnlyMode ? "max-h-[68vh]" : "max-h-[420px]"} overflow-auto`}>
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold">
                        {l("Code", "Kod")}
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold">
                        {l("Parent", "Ust")}
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold">
                        {l("Name", "Ad")}
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold">
                        {l("Type", "Tur")}
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold">
                        {l("Side", "Taraf")}
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold">
                        {l("Post", "Post")}
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold">
                        {l("Actions", "Islemler")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountTreeTableRows}
                    {selectedCoaTreeGroups.length === 0 && !loading && (
                      <tr>
                        <td colSpan={7} className="px-3 py-3 text-slate-500">
                          {l("No accounts found for selected CoA.", "Secili hesap plani icin hesap bulunamadi.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              className={`rounded-lg border border-slate-200 bg-white p-3 ${
                accountsOnlyMode ? "lg:col-span-4" : "lg:col-span-5"
              }`}
            >
              <AccountEditorPanel
                l={l}
                selectedCoaId={selectedCoaId}
                selectedCoaKey={selectedCoaKey}
                accountEditorSeed={accountEditorForm}
                accountEditorDraftMode={accountEditorDraftMode}
                canUpsertAccounts={canUpsertAccounts}
                saving={saving}
                selectedTreeAccount={selectedTreeAccount}
                parentCodeDatalistOptionNodes={parentCodeDatalistOptionNodes}
                onSubmit={handleAccountSubmit}
                onStartAddRoot={handleStartAddRootAccount}
                onStartAddChildUnderSelected={() =>
                  handleStartAddChildAccount(selectedTreeAccount)
                }
                onCancelDraft={() => setAccountEditorDraftMode(false)}
              />
            </div>
          </div>
        </section>
        ) : null}

        {!accountsOnlyMode ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Account Mapping", "Hesap Esleme")}
          </h2>
          <form onSubmit={handleMappingSubmit} className="grid gap-2 md:grid-cols-4">
            <select
              value={mappingForm.sourceAccountId}
              onChange={(event) =>
                setMappingForm((prev) => ({
                  ...prev,
                  sourceAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">{l("Select source account", "Kaynak hesap secin")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <select
              value={mappingForm.targetAccountId}
              onChange={(event) =>
                setMappingForm((prev) => ({
                  ...prev,
                  targetAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">{l("Select target account", "Hedef hesap secin")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <input
              value={mappingForm.mappingType}
              onChange={(event) =>
                setMappingForm((prev) => ({
                  ...prev,
                  mappingType: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Mapping type", "Esleme tipi")}
            />
            <button
              type="submit"
              disabled={saving === "mapping" || !canUpsertMappings}
              className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "mapping" ? l("Saving...", "Kaydediliyor...") : l("Save Mapping", "Eslemeyi Kaydet")}
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            {l(
              "Backend currently provides upsert for mappings. Listing mappings is not exposed yet.",
              "Backend su an yalnizca esleme upsert islemini saglar. Esleme listeleme henuz acik degildir."
            )}
          </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
