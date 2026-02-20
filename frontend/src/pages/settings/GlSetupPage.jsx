import { useEffect, useState } from "react";
import {
  listAccounts,
  listBooks,
  listCoas,
  upsertAccount,
  upsertAccountMapping,
  upsertBook,
  upsertCoa,
} from "../../api/glAdmin.js";
import { listFiscalCalendars, listLegalEntities } from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";

const BOOK_TYPES = ["LOCAL", "GROUP"];
const COA_SCOPES = ["LEGAL_ENTITY", "GROUP"];
const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
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
  { code: "500", name: "Sermaye", accountType: "EQUITY", normalSide: "CREDIT" },
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

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function GlSetupPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = (en, tr) => (isTr ? tr : en);
  const canReadLegalEntities = hasPermission("org.tree.read");
  const canReadCalendars = hasPermission("org.fiscal_calendar.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadCoas = hasPermission("gl.coa.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canUpsertBooks = hasPermission("gl.book.upsert");
  const canUpsertCoas = hasPermission("gl.coa.upsert");
  const canUpsertAccounts = hasPermission("gl.account.upsert");
  const canUpsertMappings = hasPermission("gl.account_mapping.upsert");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [legalEntities, setLegalEntities] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [books, setBooks] = useState([]);
  const [coas, setCoas] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [bookForm, setBookForm] = useState({
    legalEntityId: "",
    calendarId: "",
    code: "",
    name: "",
    bookType: "LOCAL",
    baseCurrencyCode: "USD",
  });
  const [coaForm, setCoaForm] = useState({
    scope: "LEGAL_ENTITY",
    legalEntityId: "",
    code: "",
    name: "",
  });
  const [accountForm, setAccountForm] = useState({
    coaId: "",
    code: "",
    name: "",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
    parentAccountId: "",
  });
  const [mappingForm, setMappingForm] = useState({
    sourceAccountId: "",
    targetAccountId: "",
    mappingType: "LOCAL_TO_GROUP",
  });

  async function loadData() {
    setLoading(true);
    setError("");

    const updates = {
      legalEntities,
      calendars,
      books,
      coas,
      accounts,
    };

    try {
      const tasks = [];

      if (canReadLegalEntities) {
        tasks.push(
          listLegalEntities().then((response) => {
            updates.legalEntities = response?.rows || [];
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
      setCalendars(updates.calendars);
      setBooks(updates.books);
      setCoas(updates.coas);
      setAccounts(updates.accounts);

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
      setBookForm((prev) => ({ ...prev, code: "", name: "" }));
      setMessage(l("Book saved.", "Defter kaydedildi."));
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

  async function handleAccountSubmit(event) {
    event.preventDefault();
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }

    const coaId = toPositiveInt(accountForm.coaId);
    if (!coaId) {
      setError(l("coaId is required.", "coaId zorunludur."));
      return;
    }

    setSaving("account");
    setError("");
    setMessage("");
    try {
      await upsertAccount({
        coaId,
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        accountType: accountForm.accountType,
        normalSide: accountForm.normalSide,
        allowPosting: Boolean(accountForm.allowPosting),
        parentAccountId: toPositiveInt(accountForm.parentAccountId) || undefined,
      });
      setAccountForm((prev) => ({ ...prev, code: "", name: "", parentAccountId: "" }));
      setMessage(l("Account saved.", "Hesap kaydedildi."));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save account.", "Hesap kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleLoadTurkishDefaultAccounts() {
    if (!canUpsertAccounts) {
      setError(l("Missing permission: gl.account.upsert", "Eksik yetki: gl.account.upsert"));
      return;
    }

    const coaId = toPositiveInt(accountForm.coaId);
    if (!coaId) {
      setError(
        l(
          "Select a CoA first, then click Load Turkish Default CoA.",
          "Once bir hesap plani secin, sonra Varsayilan Turk Hesap Planini Yukle butonuna basin."
        )
      );
      return;
    }

    const confirmed = window.confirm(
      l(
        `Load ${TURKISH_DEFAULT_COA_ACCOUNTS.length} Turkish default accounts into selected CoA?`,
        `Secili hesap planina ${TURKISH_DEFAULT_COA_ACCOUNTS.length} adet varsayilan Turk hesap plani hesabi yuklensin mi?`
      )
    );
    if (!confirmed) {
      return;
    }

    setSaving("turkish-default-accounts");
    setError("");
    setMessage("");

    try {
      let processed = 0;
      for (const account of TURKISH_DEFAULT_COA_ACCOUNTS) {
        await upsertAccount({
          coaId,
          code: account.code,
          name: account.name,
          accountType: account.accountType,
          normalSide: account.normalSide,
          allowPosting: true,
        });
        processed += 1;
      }

      setMessage(
        l(
          `Turkish default CoA loaded. Processed ${processed} accounts.`,
          `Varsayilan Turk hesap plani yuklendi. ${processed} hesap isleme alindi.`
        )
      );
      await loadData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to load Turkish default CoA accounts.",
            "Varsayilan Turk hesap plani hesaplari yuklenemedi."
          )
      );
    } finally {
      setSaving("");
    }
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
      <TenantReadinessChecklist />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{l("GL Setup", "GL Ayarlari")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
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

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Books", "Defterler")}</h2>
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
              {saving === "book" ? l("Saving...", "Kaydediliyor...") : l("Save Book", "Defteri Kaydet")}
            </button>
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
                </tr>
              </thead>
              <tbody>
                {books.map((book) => (
                  <tr key={book.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{book.id}</td>
                    <td className="px-3 py-2">{book.code}</td>
                    <td className="px-3 py-2">{book.name}</td>
                    <td className="px-3 py-2">{book.legal_entity_id}</td>
                    <td className="px-3 py-2">{book.calendar_id}</td>
                  </tr>
                ))}
                {books.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-slate-500">
                      {l("No books found.", "Defter bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

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
                {coas.map((coa) => (
                  <tr key={coa.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{coa.id}</td>
                    <td className="px-3 py-2">{coa.code}</td>
                    <td className="px-3 py-2">{coa.name}</td>
                    <td className="px-3 py-2">{coa.scope}</td>
                    <td className="px-3 py-2">{coa.legal_entity_id || "-"}</td>
                  </tr>
                ))}
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

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">{l("Accounts", "Hesaplar")}</h2>
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
          </div>
          <form onSubmit={handleAccountSubmit} className="grid gap-2 md:grid-cols-4">
            <select
              value={accountForm.coaId}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, coaId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select CoA", "Hesap plani secin")}</option>
              {coas.map((coa) => (
                <option key={coa.id} value={coa.id}>
                  {coa.code} - {coa.name}
                </option>
              ))}
            </select>
            <input
              value={accountForm.code}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Account code", "Hesap kodu")}
              required
            />
            <input
              value={accountForm.name}
              onChange={(event) =>
                setAccountForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Account name", "Hesap adi")}
              required
            />
            <select
              value={accountForm.accountType}
              onChange={(event) =>
                setAccountForm((prev) => ({
                  ...prev,
                  accountType: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {ACCOUNT_TYPES.map((accountType) => (
                <option key={accountType} value={accountType}>
                  {accountType}
                </option>
              ))}
            </select>
            <select
              value={accountForm.normalSide}
              onChange={(event) =>
                setAccountForm((prev) => ({
                  ...prev,
                  normalSide: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {NORMAL_SIDES.map((normalSide) => (
                <option key={normalSide} value={normalSide}>
                  {normalSide}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={accountForm.parentAccountId}
              onChange={(event) =>
                setAccountForm((prev) => ({
                  ...prev,
                  parentAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Parent account ID (optional)", "Ust hesap ID (opsiyonel)")}
            />
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={accountForm.allowPosting}
                onChange={(event) =>
                  setAccountForm((prev) => ({
                    ...prev,
                    allowPosting: event.target.checked,
                  }))
                }
              />
              {l("Allow posting", "Post edilmeye izin ver")}
            </label>
            <button
              type="submit"
              disabled={saving === "account" || !canUpsertAccounts}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "account" ? l("Saving...", "Kaydediliyor...") : l("Save Account", "Hesabi Kaydet")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">CoA</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Type", "Tur")}</th>
                  <th className="px-3 py-2">{l("Side", "Yon")}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{account.id}</td>
                    <td className="px-3 py-2">{account.coa_id}</td>
                    <td className="px-3 py-2">{account.code}</td>
                    <td className="px-3 py-2">{account.name}</td>
                    <td className="px-3 py-2">{account.account_type}</td>
                    <td className="px-3 py-2">{account.normal_side}</td>
                  </tr>
                ))}
                {accounts.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-slate-500">
                      {l("No accounts found.", "Hesap bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

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
      </div>
    </div>
  );
}

