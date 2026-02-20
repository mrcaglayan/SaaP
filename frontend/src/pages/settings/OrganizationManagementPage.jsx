import { useEffect, useMemo, useState } from "react";
import {
  generateFiscalPeriods,
  listCountries,
  listCurrencies,
  listFiscalCalendars,
  listFiscalPeriods,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listShareholderJournalConfigs,
  listShareholders,
  upsertFiscalCalendar,
  upsertGroupCompany,
  upsertLegalEntity,
  upsertOperatingUnit,
  upsertShareholderJournalConfig,
  upsertShareholder,
} from "../../api/orgAdmin.js";
import { listAccounts } from "../../api/glAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";

const UNIT_TYPES = ["BRANCH", "PLANT", "STORE", "DEPARTMENT", "OTHER"];
const SHAREHOLDER_TYPES = ["INDIVIDUAL", "CORPORATE"];
const SHAREHOLDER_STATUSES = ["ACTIVE", "INACTIVE"];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getCommitmentJournalSkipReason(reason, l) {
  switch (String(reason || "")) {
    case "CAPITAL_SUB_ACCOUNT_REQUIRED":
      return l(
        "No commitment journal created: choose a capital sub-account for the shareholder.",
        "Taahhut fisi olusturulmadi: ortak icin bir sermaye alt hesap secin."
      );
    case "AUTH_USER_REQUIRED":
      return l(
        "No commitment journal created: authenticated user is required.",
        "Taahhut fisi olusturulmadi: dogrulanmis kullanici gerekli."
      );
    case "NO_OPEN_BOOK_PERIOD":
      return l(
        "No commitment journal created: no open book/period found for the legal entity.",
        "Taahhut fisi olusturulmadi: secili istirak / bagli ortak icin acik defter/donem bulunamadi."
      );
    case "COMMITMENT_DATE_OUTSIDE_OPEN_PERIOD":
      return l(
        "No commitment journal created: commitment date is outside an open fiscal period.",
        "Taahhut fisi olusturulmadi: taahhut tarihi acik bir mali donem disinda."
      );
    case "COMMITMENT_DEBIT_ACCOUNT_MAPPING_REQUIRED":
      return l(
        "No commitment journal created: configure commitment debit account for this legal entity.",
        "Taahhut fisi olusturulmadi: bu istirak / bagli ortak icin taahhut borc hesabi eslemesini yapin."
      );
    case "COMMITMENT_DEBIT_ACCOUNT_MAPPING_INVALID":
      return l(
        "No commitment journal created: mapped commitment debit account is invalid.",
        "Taahhut fisi olusturulmadi: eslenen taahhut borc hesabi gecersiz."
      );
    case "COMMITTED_CAPITAL_DECREASE_REQUIRES_MANUAL_REVERSAL":
      return l(
        "Committed capital decreased. Please create a manual reversal/adjustment journal.",
        "Taahhut edilen sermaye azaltildi. Lutfen manuel ters/duzeltme yevmiyesi olusturun."
      );
    case "DISABLED":
      return l(
        "Auto commitment journal is disabled.",
        "Otomatik taahhut fisi olusturma kapali."
      );
    default:
      return "";
  }
}

export default function OrganizationManagementPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = (en, tr) => (isTr ? tr : en);
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadFiscalCalendars = hasPermission("org.fiscal_calendar.read");
  const canReadFiscalPeriods = hasPermission("org.fiscal_period.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canUpsertGroupCompany = hasPermission("org.group_company.upsert");
  const canUpsertLegalEntity = hasPermission("org.legal_entity.upsert");
  const canUpsertOperatingUnit = hasPermission("org.operating_unit.upsert");
  const canReadShareholders = hasPermission("org.tree.read");
  const canUpsertShareholder = hasPermission("org.legal_entity.upsert");
  const canUpsertFiscalCalendar = hasPermission("org.fiscal_calendar.upsert");
  const canGenerateFiscalPeriods = hasPermission("org.fiscal_period.generate");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shareholderJournalModal, setShareholderJournalModal] = useState(null);

  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [shareholders, setShareholders] = useState([]);
  const [shareholderJournalConfigs, setShareholderJournalConfigs] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [periods, setPeriods] = useState([]);

  const [groupForm, setGroupForm] = useState({ code: "", name: "" });
  const [entityForm, setEntityForm] = useState({
    groupCompanyId: "",
    code: "",
    name: "",
    taxId: "",
    countryId: "",
    functionalCurrencyCode: "USD",
    isIntercompanyEnabled: true,
    intercompanyPartnerRequired: false,
    autoProvisionDefaults: true,
  });
  const [unitForm, setUnitForm] = useState({
    legalEntityId: "",
    code: "",
    name: "",
    unitType: "BRANCH",
    hasSubledger: false,
  });
  const [shareholderForm, setShareholderForm] = useState({
    legalEntityId: "",
    code: "",
    name: "",
    shareholderType: "INDIVIDUAL",
    taxId: "",
    ownershipPct: "",
    commitmentDate: new Date().toISOString().slice(0, 10),
    committedCapital: "0",
    capitalSubAccountId: "",
    currencyCode: "USD",
    status: "ACTIVE",
    notes: "",
  });
  const [shareholderJournalConfigForm, setShareholderJournalConfigForm] = useState({
    legalEntityId: "",
    commitmentDebitAccountId: "",
  });
  const [calendarForm, setCalendarForm] = useState({
    code: "",
    name: "",
    yearStartMonth: 1,
    yearStartDay: 1,
  });
  const [periodForm, setPeriodForm] = useState({
    calendarId: "",
    fiscalYear: new Date().getUTCFullYear(),
  });

  async function loadCoreData() {
    if (!canReadOrgTree && !canReadFiscalCalendars) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (canReadOrgTree) {
        const [
          groupsRes,
          countriesRes,
          currenciesRes,
          accountsRes,
          entitiesRes,
          unitsRes,
          shareholdersRes,
          shareholderJournalConfigsRes,
        ] =
          await Promise.all([
            listGroupCompanies(),
            listCountries(),
            listCurrencies(),
            canReadAccounts
              ? listAccounts({ includeInactive: true })
              : Promise.resolve({ rows: [] }),
            listLegalEntities(),
            listOperatingUnits(),
            canReadShareholders
              ? listShareholders()
              : Promise.resolve({ rows: [] }),
            canReadShareholders
              ? listShareholderJournalConfigs()
              : Promise.resolve({ rows: [] }),
          ]);

        const groupRows = groupsRes?.rows || [];
        const countryRows = countriesRes?.rows || [];
        const currencyRows = currenciesRes?.rows || [];
        const accountRows = accountsRes?.rows || [];
        const entityRows = entitiesRes?.rows || [];
        const unitRows = unitsRes?.rows || [];
        const shareholderRows = shareholdersRes?.rows || [];
        const shareholderJournalConfigRows = shareholderJournalConfigsRes?.rows || [];

        setGroups(groupRows);
        setCountries(countryRows);
        setCurrencies(currencyRows);
        setAccounts(accountRows);
        setLegalEntities(entityRows);
        setOperatingUnits(unitRows);
        setShareholders(shareholderRows);
        setShareholderJournalConfigs(shareholderJournalConfigRows);

        setEntityForm((prev) => {
          const nextCountryId =
            prev.countryId || String(countryRows[0]?.id || "");
          const selectedCountry = countryRows.find(
            (row) => String(row.id) === String(nextCountryId)
          );
          const countryDefaultCurrency = String(
            selectedCountry?.default_currency_code || ""
          ).toUpperCase();

          return {
            ...prev,
            groupCompanyId:
              prev.groupCompanyId || String(groupRows[0]?.id || ""),
            countryId: nextCountryId,
            functionalCurrencyCode:
              prev.functionalCurrencyCode || countryDefaultCurrency || "USD",
          };
        });
        setUnitForm((prev) => ({
          ...prev,
          legalEntityId: prev.legalEntityId || String(entityRows[0]?.id || ""),
        }));
        setShareholderForm((prev) => {
          const nextLegalEntityId =
            prev.legalEntityId || String(entityRows[0]?.id || "");
          const selectedEntity = entityRows.find(
            (row) => String(row.id) === String(nextLegalEntityId)
          );
          const legalEntityCurrency = String(
            selectedEntity?.functional_currency_code || ""
          ).toUpperCase();
          return {
            ...prev,
            legalEntityId: nextLegalEntityId,
            currencyCode: prev.currencyCode || legalEntityCurrency || "USD",
          };
        });
        setShareholderJournalConfigForm((prev) => {
          const nextLegalEntityId =
            prev.legalEntityId || String(entityRows[0]?.id || "");
          const existingConfig = shareholderJournalConfigRows.find(
            (row) => String(row.legal_entity_id) === String(nextLegalEntityId)
          );
          return {
            legalEntityId: nextLegalEntityId,
            commitmentDebitAccountId:
              prev.commitmentDebitAccountId ||
              String(existingConfig?.account_id || ""),
          };
        });
      }

      if (canReadFiscalCalendars) {
        const calendarsRes = await listFiscalCalendars();
        const calendarRows = calendarsRes?.rows || [];
        setCalendars(calendarRows);
        setPeriodForm((prev) => ({
          ...prev,
          calendarId: prev.calendarId || String(calendarRows[0]?.id || ""),
        }));
      }
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load organization data.", "Organizasyon verileri yuklenemedi."));
    } finally {
      setLoading(false);
    }
  }

  async function loadPeriods(calendarId, fiscalYear) {
    if (!canReadFiscalPeriods || !calendarId) {
      setPeriods([]);
      return;
    }

    try {
      const response = await listFiscalPeriods(calendarId, {
        fiscalYear: fiscalYear || undefined,
      });
      setPeriods(response?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load fiscal periods.", "Mali donemler yuklenemedi."));
    }
  }

  useEffect(() => {
    loadCoreData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canReadOrgTree,
    canReadFiscalCalendars,
    canReadShareholders,
    canReadAccounts,
  ]);

  useEffect(() => {
    loadPeriods(periodForm.calendarId, periodForm.fiscalYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodForm.calendarId, periodForm.fiscalYear, canReadFiscalPeriods]);

  const countrySelectOptions = useMemo(
    () =>
      countries.map((row) => ({
        id: row.id,
        label: `${row.iso2} - ${row.name}`,
        defaultCurrencyCode: String(row.default_currency_code || "").toUpperCase(),
      })),
    [countries]
  );

  const currencySelectOptions = useMemo(
    () =>
      currencies.map((row) => ({
        code: String(row.code || "").toUpperCase(),
        label: `${String(row.code || "").toUpperCase()} - ${row.name}`,
      })),
    [currencies]
  );

  const selectedShareholderLegalEntityId = toNumber(
    shareholderForm.legalEntityId
  );
  const selectedConfigLegalEntityId = toNumber(
    shareholderJournalConfigForm.legalEntityId
  );
  const shareholderJournalConfigByEntity = useMemo(() => {
    const map = new Map();
    for (const row of shareholderJournalConfigs) {
      const key = Number(row.legal_entity_id);
      if (Number.isInteger(key) && key > 0) {
        map.set(key, row);
      }
    }
    return map;
  }, [shareholderJournalConfigs]);
  const equityShareholderAccounts = useMemo(() => {
    if (!selectedShareholderLegalEntityId) {
      return [];
    }
    return accounts.filter((row) => {
      const sameEntity =
        Number(row.legal_entity_id) === Number(selectedShareholderLegalEntityId);
      const isEquity = String(row.account_type || "").toUpperCase() === "EQUITY";
      const isActive = Boolean(row.is_active);
      return sameEntity && isEquity && isActive;
    });
  }, [accounts, selectedShareholderLegalEntityId]);
  const eligibleCommitmentDebitAccounts = useMemo(() => {
    if (!selectedConfigLegalEntityId) {
      return [];
    }
    const parentIds = new Set(
      accounts
        .filter(
          (row) =>
            Number(row.legal_entity_id) === Number(selectedConfigLegalEntityId) &&
            Boolean(row.is_active)
        )
        .map((row) => toNumber(row.parent_account_id))
        .filter(Boolean)
    );
    return accounts.filter((row) => {
      const sameEntity =
        Number(row.legal_entity_id) === Number(selectedConfigLegalEntityId);
      const isActive = Boolean(row.is_active);
      const allowPosting = !(
        row.allow_posting === false ||
        row.allow_posting === 0 ||
        row.allow_posting === "0"
      );
      const accountId = toNumber(row.id);
      if (!accountId) {
        return false;
      }
      return sameEntity && isActive && allowPosting && !parentIds.has(accountId);
    });
  }, [accounts, selectedConfigLegalEntityId]);

  const visibleShareholders = useMemo(() => {
    if (!selectedShareholderLegalEntityId) {
      return shareholders;
    }
    return shareholders.filter(
      (row) =>
        Number(row.legal_entity_id) === Number(selectedShareholderLegalEntityId)
    );
  }, [shareholders, selectedShareholderLegalEntityId]);

  async function handleGroupSubmit(event) {
    event.preventDefault();
    if (!canUpsertGroupCompany) {
      setError(l("Missing permission: org.group_company.upsert", "Eksik yetki: org.group_company.upsert"));
      return;
    }

    setSaving("group");
    setError("");
    setMessage("");
    try {
      await upsertGroupCompany({
        code: groupForm.code.trim(),
        name: groupForm.name.trim(),
      });
      setGroupForm({ code: "", name: "" });
      setMessage(l("Group company saved.", "Grup sirketi kaydedildi."));
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save group company.", "Grup sirketi kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleLegalEntitySubmit(event) {
    event.preventDefault();
    if (!canUpsertLegalEntity) {
      setError(l("Missing permission: org.legal_entity.upsert", "Eksik yetki: org.legal_entity.upsert"));
      return;
    }

    const groupCompanyId = toNumber(entityForm.groupCompanyId);
    const countryId = toNumber(entityForm.countryId);
    if (!groupCompanyId || !countryId) {
      setError(l("groupCompanyId and countryId are required.", "groupCompanyId ve countryId zorunludur."));
      return;
    }

    setSaving("entity");
    setError("");
    setMessage("");
    try {
      const response = await upsertLegalEntity({
        groupCompanyId,
        code: entityForm.code.trim(),
        name: entityForm.name.trim(),
        taxId: entityForm.taxId.trim() || undefined,
        countryId,
        functionalCurrencyCode: entityForm.functionalCurrencyCode
          .trim()
          .toUpperCase(),
        isIntercompanyEnabled: Boolean(entityForm.isIntercompanyEnabled),
        intercompanyPartnerRequired: Boolean(entityForm.intercompanyPartnerRequired),
        autoProvisionDefaults: Boolean(entityForm.autoProvisionDefaults),
      });

      setEntityForm((prev) => ({
        ...prev,
        code: "",
        name: "",
        taxId: "",
        functionalCurrencyCode: prev.functionalCurrencyCode || "USD",
      }));
      if (response?.provisioning?.created) {
        const created = response.provisioning.created;
        setMessage(
          l(
            `Legal entity saved. Defaults created: calendar ${created.fiscalCalendars}, periods ${created.fiscalPeriods}, CoA ${created.chartsOfAccounts}, accounts ${created.accounts}, books ${created.books}.`,
            `Istirak / bagli ortak kaydedildi. Varsayilanlar olusturuldu: takvim ${created.fiscalCalendars}, donem ${created.fiscalPeriods}, hesap plani ${created.chartsOfAccounts}, hesap ${created.accounts}, defter ${created.books}.`
          )
        );
      } else {
        setMessage(l("Legal entity saved.", "Istirak / bagli ortak kaydedildi."));
      }
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save legal entity.", "Istirak / bagli ortak kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleOperatingUnitSubmit(event) {
    event.preventDefault();
    if (!canUpsertOperatingUnit) {
      setError(l("Missing permission: org.operating_unit.upsert", "Eksik yetki: org.operating_unit.upsert"));
      return;
    }

    const legalEntityId = toNumber(unitForm.legalEntityId);
    if (!legalEntityId) {
      setError(l("legalEntityId is required.", "legalEntityId zorunludur."));
      return;
    }

    setSaving("unit");
    setError("");
    setMessage("");
    try {
      await upsertOperatingUnit({
        legalEntityId,
        code: unitForm.code.trim(),
        name: unitForm.name.trim(),
        unitType: unitForm.unitType,
        hasSubledger: Boolean(unitForm.hasSubledger),
      });
      setUnitForm((prev) => ({
        ...prev,
        code: "",
        name: "",
      }));
      setMessage(l("Operating unit saved.", "Operasyon birimi kaydedildi."));
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save operating unit.", "Operasyon birimi kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleShareholderJournalConfigSubmit(event) {
    event.preventDefault();
    if (!canUpsertLegalEntity) {
      setError(
        l(
          "Missing permission: org.legal_entity.upsert",
          "Eksik yetki: org.legal_entity.upsert"
        )
      );
      return;
    }

    const legalEntityId = toNumber(shareholderJournalConfigForm.legalEntityId);
    const commitmentDebitAccountId = toNumber(
      shareholderJournalConfigForm.commitmentDebitAccountId
    );
    if (!legalEntityId || !commitmentDebitAccountId) {
      setError(
        l(
          "legalEntityId and commitment debit account are required.",
          "legalEntityId ve taahhut borc hesabi zorunludur."
        )
      );
      return;
    }

    setSaving("shareholderJournalConfig");
    setError("");
    setMessage("");
    try {
      await upsertShareholderJournalConfig({
        legalEntityId,
        commitmentDebitAccountId,
      });
      setMessage(
        l(
          "Shareholder commitment debit account mapping saved.",
          "Ortak taahhut borc hesabi eslemesi kaydedildi."
        )
      );
      await loadCoreData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to save shareholder journal config.",
            "Ortak yevmiye konfigurasyonu kaydedilemedi."
          )
      );
    } finally {
      setSaving("");
    }
  }

  async function handleShareholderSubmit(event) {
    event.preventDefault();
    if (!canUpsertShareholder) {
      setError(
        l(
          "Missing permission: org.legal_entity.upsert",
          "Eksik yetki: org.legal_entity.upsert"
        )
      );
      return;
    }

    const legalEntityId = toNumber(shareholderForm.legalEntityId);
    if (!legalEntityId) {
      setError(l("legalEntityId is required.", "legalEntityId zorunludur."));
      return;
    }
    const committedCapital = Number(shareholderForm.committedCapital || 0);
    const capitalSubAccountId = toNumber(shareholderForm.capitalSubAccountId);
    const commitmentDebitAccountId = toNumber(
      shareholderJournalConfigByEntity.get(legalEntityId)?.account_id
    );
    if (committedCapital > 0 && !capitalSubAccountId) {
      setError(
        l(
          "Capital sub-account is required when committed capital is greater than 0.",
          "Taahhut edilen sermaye 0'dan buyukse sermaye alt hesap zorunludur."
        )
      );
      return;
    }
    if (committedCapital > 0 && !commitmentDebitAccountId) {
      setError(
        l(
          "Configure commitment debit account for this legal entity before saving.",
          "Kaydetmeden once bu istirak / bagli ortak icin taahhut borc hesabini tanimlayin."
        )
      );
      return;
    }

    setSaving("shareholder");
    setError("");
    setMessage("");
    try {
      const response = await upsertShareholder({
        legalEntityId,
        code: shareholderForm.code.trim(),
        name: shareholderForm.name.trim(),
        shareholderType: shareholderForm.shareholderType,
        taxId: shareholderForm.taxId.trim() || undefined,
        ownershipPct:
          shareholderForm.ownershipPct === ""
            ? undefined
            : Number(shareholderForm.ownershipPct),
        commitmentDate: shareholderForm.commitmentDate || undefined,
        committedCapital,
        capitalSubAccountId: capitalSubAccountId || undefined,
        autoCommitmentJournal: true,
        currencyCode: shareholderForm.currencyCode.trim().toUpperCase(),
        status: shareholderForm.status,
        notes: shareholderForm.notes.trim() || undefined,
      });

      setShareholderForm((prev) => ({
        ...prev,
        code: "",
        name: "",
        taxId: "",
        ownershipPct: "",
        committedCapital: "0",
        capitalSubAccountId: "",
        notes: "",
      }));

      const commitmentJournal = response?.commitmentJournal || null;
      if (commitmentJournal?.created) {
        const amountLabel = Number(commitmentJournal.amount || 0).toLocaleString(
          undefined,
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        );
        setMessage(
          l(
            "Shareholder saved. Commitment draft journal created.",
            "Ortak kaydedildi. Taahhut taslak yevmiye kaydi olusturuldu."
          )
        );
        setShareholderJournalModal({
          title: l(
            "Commitment Journal Created",
            "Taahhut Yevmiye Kaydi Olusturuldu"
          ),
          message: l(
            `Draft journal ${commitmentJournal.journalNo || "-"} created for commitment amount ${amountLabel}.`,
            `Taahhut tutari ${amountLabel} icin ${commitmentJournal.journalNo || "-"} numarali taslak fis olusturuldu.`
          ),
          journalNo: commitmentJournal.journalNo || "-",
          journalEntryId: commitmentJournal.journalEntryId || "-",
          bookCode: commitmentJournal.bookCode || "-",
          fiscalPeriodId: commitmentJournal.fiscalPeriodId || "-",
        });
      } else {
        const reasonText = getCommitmentJournalSkipReason(
          commitmentJournal?.reason,
          l
        );
        setMessage(
          reasonText
            ? `${l("Shareholder saved.", "Ortak kaydedildi.")} ${reasonText}`
            : l("Shareholder saved.", "Ortak kaydedildi.")
        );
      }
      await loadCoreData();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to save shareholder.", "Ortak kaydedilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function handleFiscalCalendarSubmit(event) {
    event.preventDefault();
    if (!canUpsertFiscalCalendar) {
      setError(l("Missing permission: org.fiscal_calendar.upsert", "Eksik yetki: org.fiscal_calendar.upsert"));
      return;
    }

    setSaving("calendar");
    setError("");
    setMessage("");
    try {
      await upsertFiscalCalendar({
        code: calendarForm.code.trim(),
        name: calendarForm.name.trim(),
        yearStartMonth: Number(calendarForm.yearStartMonth),
        yearStartDay: Number(calendarForm.yearStartDay),
      });
      setCalendarForm({
        code: "",
        name: "",
        yearStartMonth: 1,
        yearStartDay: 1,
      });
      setMessage(l("Fiscal calendar saved.", "Mali takvim kaydedildi."));
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save fiscal calendar.", "Mali takvim kaydedilemedi."));
    } finally {
      setSaving("");
    }
  }

  async function handleGeneratePeriods(event) {
    event.preventDefault();
    if (!canGenerateFiscalPeriods) {
      setError(l("Missing permission: org.fiscal_period.generate", "Eksik yetki: org.fiscal_period.generate"));
      return;
    }

    const calendarId = toNumber(periodForm.calendarId);
    const fiscalYear = toNumber(periodForm.fiscalYear);
    if (!calendarId || !fiscalYear) {
      setError(l("calendarId and fiscalYear are required.", "calendarId ve fiscalYear zorunludur."));
      return;
    }

    setSaving("periods");
    setError("");
    setMessage("");
    try {
      await generateFiscalPeriods({ calendarId, fiscalYear });
      setMessage(l("Fiscal periods generated.", "Mali donemler olusturuldu."));
      await loadPeriods(calendarId, fiscalYear);
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to generate fiscal periods.", "Mali donemler olusturulamadi."));
    } finally {
      setSaving("");
    }
  }

  if (!canReadOrgTree && !canReadFiscalCalendars) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {l(
          "You need `org.tree.read` and/or `org.fiscal_calendar.read` to use this page.",
          "Bu sayfayi kullanmak icin `org.tree.read` ve/veya `org.fiscal_calendar.read` yetkisi gerekir."
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TenantReadinessChecklist />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {l("Organization Management", "Organizasyon Yonetimi")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Maintain company structure, branches, and fiscal structure after onboarding.",
            "Kurulumdan sonra sirket yapisini, subeleri ve mali yapilari yonetin."
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
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Group Companies", "Grup Sirketleri")}
          </h2>
          <form onSubmit={handleGroupSubmit} className="grid gap-2 md:grid-cols-3">
            <input
              value={groupForm.code}
              onChange={(event) =>
                setGroupForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Code", "Kod")}
              required
            />
            <input
              value={groupForm.name}
              onChange={(event) =>
                setGroupForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Name", "Ad")}
              required
            />
            <button
              type="submit"
              disabled={saving === "group" || !canUpsertGroupCompany}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "group" ? l("Saving...", "Kaydediliyor...") : l("Save", "Kaydet")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                </tr>
              </thead>
              <tbody>
                {(groups || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                  </tr>
                ))}
                {groups.length === 0 && !loading && (
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-slate-500">
                      {l("No group companies found.", "Grup sirketi bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Legal Entities", "Istirakler / Bagli Ortaklar")}
          </h2>
          <form onSubmit={handleLegalEntitySubmit} className="grid gap-2 md:grid-cols-3">
            <select
              value={entityForm.groupCompanyId}
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  groupCompanyId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select group company", "Grup sirketi secin")}</option>
              {groups.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              value={entityForm.code}
              onChange={(event) =>
                setEntityForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Entity code", "Birim kodu")}
              required
            />
            <input
              value={entityForm.name}
              onChange={(event) =>
                setEntityForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Entity name", "Birim adi")}
              required
            />

            <select
              value={entityForm.countryId}
              onChange={(event) => {
                const nextCountryId = event.target.value;
                const selectedCountry = countrySelectOptions.find(
                  (option) => String(option.id) === String(nextCountryId)
                );
                setEntityForm((prev) => ({
                  ...prev,
                  countryId: nextCountryId,
                  functionalCurrencyCode:
                    selectedCountry?.defaultCurrencyCode || prev.functionalCurrencyCode,
                }));
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select country", "Ulke secin")}</option>
              {countrySelectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={entityForm.functionalCurrencyCode}
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  functionalCurrencyCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select currency", "Para birimi secin")}</option>
              {currencySelectOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>

            <input
              value={entityForm.taxId}
              onChange={(event) =>
                setEntityForm((prev) => ({ ...prev, taxId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Tax ID (optional)", "Vergi No (opsiyonel)")}
            />
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={entityForm.isIntercompanyEnabled}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    isIntercompanyEnabled: event.target.checked,
                  }))
                }
              />
              {l("Intercompany enabled", "Intercompany aktif")}
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={entityForm.intercompanyPartnerRequired}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    intercompanyPartnerRequired: event.target.checked,
                  }))
                }
              />
              {l("Partner required", "Karsi taraf zorunlu")}
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={entityForm.autoProvisionDefaults}
                onChange={(event) =>
                  setEntityForm((prev) => ({
                    ...prev,
                    autoProvisionDefaults: event.target.checked,
                  }))
                }
              />
              {l(
                "Auto-create defaults (calendar, periods, CoA, accounts, book)",
                "Varsayilanlari otomatik olustur (takvim, donemler, hesap plani, hesaplar, defter)"
              )}
            </label>
            <button
              type="submit"
              disabled={saving === "entity" || !canUpsertLegalEntity}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "entity" ? l("Saving...", "Kaydediliyor...") : l("Save", "Kaydet")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Group", "Grup")}</th>
                  <th className="px-3 py-2">{l("Country", "Ulke")}</th>
                  <th className="px-3 py-2">{l("Currency", "Para birimi")}</th>
                </tr>
              </thead>
              <tbody>
                {(legalEntities || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.group_company_id}</td>
                    <td className="px-3 py-2">{row.country_id}</td>
                    <td className="px-3 py-2">{row.functional_currency_code}</td>
                  </tr>
                ))}
                {legalEntities.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-slate-500">
                      {l("No legal entities found.", "Istirak / bagli ortak bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Operating Units / Branches", "Operasyon Birimleri / Subeler")}
          </h2>
          <form onSubmit={handleOperatingUnitSubmit} className="grid gap-2 md:grid-cols-5">
            <select
              value={unitForm.legalEntityId}
              onChange={(event) =>
                setUnitForm((prev) => ({
                  ...prev,
                  legalEntityId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              required
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {legalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              value={unitForm.code}
              onChange={(event) =>
                setUnitForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Unit code", "Birim kodu")}
              required
            />
            <input
              value={unitForm.name}
              onChange={(event) =>
                setUnitForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Unit name", "Birim adi")}
              required
            />
            <select
              value={unitForm.unitType}
              onChange={(event) =>
                setUnitForm((prev) => ({ ...prev, unitType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {UNIT_TYPES.map((unitType) => (
                <option key={unitType} value={unitType}>
                  {unitType}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={unitForm.hasSubledger}
                onChange={(event) =>
                  setUnitForm((prev) => ({
                    ...prev,
                    hasSubledger: event.target.checked,
                  }))
                }
              />
              {l("Has subledger", "Alt defter var")}
            </label>
            <button
              type="submit"
              disabled={saving === "unit" || !canUpsertOperatingUnit}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "unit" ? l("Saving...", "Kaydediliyor...") : l("Save", "Kaydet")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Entity ID", "Birim ID")}</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Type", "Tur")}</th>
                  <th className="px-3 py-2">{l("Subledger", "Alt Defter")}</th>
                </tr>
              </thead>
              <tbody>
                {(operatingUnits || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.legal_entity_id}</td>
                    <td className="px-3 py-2">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.unit_type}</td>
                    <td className="px-3 py-2">{row.has_subledger ? l("Yes", "Evet") : l("No", "Hayir")}</td>
                  </tr>
                ))}
                {operatingUnits.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-slate-500">
                      {l("No operating units found.", "Operasyon birimi bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Shareholders", "Ortaklar")}
          </h2>
          <form
            onSubmit={handleShareholderJournalConfigSubmit}
            className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-4"
          >
            <div className="text-xs font-semibold text-slate-700 md:col-span-4">
              {l(
                "Commitment Debit Account Mapping (per legal entity)",
                "Taahhut Borc Hesap Eslemesi (istirak / bagli ortak bazinda)"
              )}
            </div>
            <select
              value={shareholderJournalConfigForm.legalEntityId}
              onChange={(event) => {
                const nextLegalEntityId = event.target.value;
                const existingConfig = shareholderJournalConfigs.find(
                  (row) =>
                    String(row.legal_entity_id) === String(nextLegalEntityId)
                );
                setShareholderJournalConfigForm((prev) => ({
                  ...prev,
                  legalEntityId: nextLegalEntityId,
                  commitmentDebitAccountId: String(
                    existingConfig?.account_id || ""
                  ),
                }));
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {legalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <select
              value={shareholderJournalConfigForm.commitmentDebitAccountId}
              onChange={(event) =>
                setShareholderJournalConfigForm((prev) => ({
                  ...prev,
                  commitmentDebitAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              disabled={!canReadAccounts}
              required
            >
              <option value="">
                {canReadAccounts
                  ? l(
                      "Select commitment debit account",
                      "Taahhut borc hesabini secin"
                    )
                  : l("Need gl.account.read", "gl.account.read yetkisi gerekli")}
              </option>
              {eligibleCommitmentDebitAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={
                saving === "shareholderJournalConfig" || !canUpsertLegalEntity
              }
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "shareholderJournalConfig"
                ? l("Saving...", "Kaydediliyor...")
                : l("Save Mapping", "Eslemeyi Kaydet")}
            </button>
            <div className="text-xs text-slate-600 md:col-span-4">
              {(() => {
                const row = shareholderJournalConfigByEntity.get(
                  Number(selectedConfigLegalEntityId)
                );
                if (!row) {
                  return l(
                    "No mapping configured for selected legal entity.",
                    "Secili istirak / bagli ortak icin esleme tanimli degil."
                  );
                }
                return l(
                  `Current: ${row.account_code || "-"} - ${row.account_name || "-"}`,
                  `Mevcut: ${row.account_code || "-"} - ${row.account_name || "-"}`
                );
              })()}
            </div>
          </form>

          <form onSubmit={handleShareholderSubmit} className="grid gap-2 md:grid-cols-4">
            <select
              value={shareholderForm.legalEntityId}
              onChange={(event) => {
                const nextLegalEntityId = event.target.value;
                const selectedEntity = legalEntities.find(
                  (row) => String(row.id) === String(nextLegalEntityId)
                );
                const defaultCurrency = String(
                  selectedEntity?.functional_currency_code || ""
                ).toUpperCase();
                setShareholderForm((prev) => ({
                  ...prev,
                  legalEntityId: nextLegalEntityId,
                  capitalSubAccountId: "",
                  currencyCode: defaultCurrency || prev.currencyCode,
                }));
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select legal entity", "Istirak / bagli ortak secin")}</option>
              {legalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              value={shareholderForm.code}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Shareholder code", "Ortak kodu")}
              required
            />
            <input
              value={shareholderForm.name}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Shareholder name", "Ortak adi")}
              required
            />

            <select
              value={shareholderForm.shareholderType}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  shareholderType: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {SHAREHOLDER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              value={shareholderForm.taxId}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, taxId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Tax ID (optional)", "Vergi No (opsiyonel)")}
            />
            <input
              type="number"
              min={0}
              max={100}
              step="0.000001"
              value={shareholderForm.ownershipPct}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  ownershipPct: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Ownership %", "Sahiplik %")}
            />
            <select
              value={shareholderForm.capitalSubAccountId}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  capitalSubAccountId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={!canReadAccounts}
            >
              <option value="">
                {canReadAccounts
                  ? l(
                      "Capital sub-account (optional)",
                      "Sermaye alt hesap (opsiyonel)"
                    )
                  : l(
                      "Need gl.account.read",
                      "gl.account.read yetkisi gerekli"
                    )}
              </option>
              {equityShareholderAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
            <select
              value={shareholderForm.currencyCode}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  currencyCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select currency", "Para birimi secin")}</option>
              {currencySelectOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={shareholderForm.commitmentDate}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  commitmentDate: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              title={l("Commitment date", "Taahhut tarihi")}
              required
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={shareholderForm.committedCapital}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  committedCapital: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Committed capital", "Taahhut edilen sermaye")}
            />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {l(
                "Paid capital is auto-calculated from posted journals on the mapped capital sub-account.",
                "Odenen sermaye, eslenen sermaye alt hesabi uzerinden post edilmis yevmiye kayitlarindan otomatik hesaplanir."
              )}
            </div>
            <select
              value={shareholderForm.status}
              onChange={(event) =>
                setShareholderForm((prev) => ({
                  ...prev,
                  status: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {SHAREHOLDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <input
              value={shareholderForm.notes}
              onChange={(event) =>
                setShareholderForm((prev) => ({ ...prev, notes: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Notes (optional)", "Notlar (opsiyonel)")}
            />
            <button
              type="submit"
              disabled={saving === "shareholder" || !canUpsertShareholder}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "shareholder"
                ? l("Saving...", "Kaydediliyor...")
                : l("Save Shareholder", "Ortagi Kaydet")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Entity", "Birim")}</th>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Type", "Tur")}</th>
                  <th className="px-3 py-2">{l("Ownership %", "Sahiplik %")}</th>
                  <th className="px-3 py-2">
                    {l("Capital Sub-Account", "Sermaye Alt Hesap")}
                  </th>
                  <th className="px-3 py-2">{l("Committed", "Taahhut")}</th>
                  <th className="px-3 py-2">{l("Paid", "Odenen")}</th>
                  <th className="px-3 py-2">{l("Currency", "Para birimi")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleShareholders.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.legal_entity_id}</td>
                    <td className="px-3 py-2">{row.code}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.shareholder_type}</td>
                    <td className="px-3 py-2">
                      {row.ownership_pct === null || row.ownership_pct === undefined
                        ? "-"
                        : Number(row.ownership_pct).toFixed(4)}
                    </td>
                    <td className="px-3 py-2">
                      {row.capital_sub_account_code
                        ? row.capital_sub_account_name
                          ? `${row.capital_sub_account_code} - ${row.capital_sub_account_name}`
                          : row.capital_sub_account_code
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {Number(row.committed_capital || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2">
                      {Number(row.paid_capital || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2">{row.currency_code}</td>
                    <td className="px-3 py-2">{row.status}</td>
                  </tr>
                ))}
                {visibleShareholders.length === 0 && !loading && (
                  <tr>
                    <td colSpan={11} className="px-3 py-3 text-slate-500">
                      {l("No shareholders found.", "Ortak bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {l("Fiscal Calendars and Periods", "Mali Takvimler ve Donemler")}
          </h2>

          <form onSubmit={handleFiscalCalendarSubmit} className="grid gap-2 md:grid-cols-5">
            <input
              value={calendarForm.code}
              onChange={(event) =>
                setCalendarForm((prev) => ({ ...prev, code: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Calendar code", "Takvim kodu")}
              required
            />
            <input
              value={calendarForm.name}
              onChange={(event) =>
                setCalendarForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder={l("Calendar name", "Takvim adi")}
              required
            />
            <input
              type="number"
              min={1}
              max={12}
              value={calendarForm.yearStartMonth}
              onChange={(event) =>
                setCalendarForm((prev) => ({
                  ...prev,
                  yearStartMonth: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Start month", "Baslangic ayi")}
              required
            />
            <input
              type="number"
              min={1}
              max={31}
              value={calendarForm.yearStartDay}
              onChange={(event) =>
                setCalendarForm((prev) => ({
                  ...prev,
                  yearStartDay: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Start day", "Baslangic gunu")}
              required
            />
            <button
              type="submit"
              disabled={saving === "calendar" || !canUpsertFiscalCalendar}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-5"
            >
              {saving === "calendar" ? l("Saving...", "Kaydediliyor...") : l("Save Calendar", "Takvimi Kaydet")}
            </button>
          </form>

          <form onSubmit={handleGeneratePeriods} className="mt-3 grid gap-2 md:grid-cols-4">
            <select
              value={periodForm.calendarId}
              onChange={(event) =>
                setPeriodForm((prev) => ({ ...prev, calendarId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select calendar", "Takvim secin")}</option>
              {calendars.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={2000}
              value={periodForm.fiscalYear}
              onChange={(event) =>
                setPeriodForm((prev) => ({ ...prev, fiscalYear: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Fiscal year", "Mali yil")}
            />
            <button
              type="button"
              onClick={() => loadPeriods(periodForm.calendarId, periodForm.fiscalYear)}
              disabled={!canReadFiscalPeriods}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              {l("Reload Periods", "Donemleri Yeniden Yukle")}
            </button>
            <button
              type="submit"
              disabled={saving === "periods" || !canGenerateFiscalPeriods}
              className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "periods" ? l("Generating...", "Olusturuluyor...") : l("Generate 12 Periods", "12 Donem Olustur")}
            </button>
          </form>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("Year", "Yil")}</th>
                  <th className="px-3 py-2">{l("Period", "Donem")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Start", "Baslangic")}</th>
                  <th className="px-3 py-2">{l("End", "Bitis")}</th>
                </tr>
              </thead>
              <tbody>
                {(periods || []).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.fiscal_year}</td>
                    <td className="px-3 py-2">{row.period_no}</td>
                    <td className="px-3 py-2">{row.period_name}</td>
                    <td className="px-3 py-2">{row.start_date}</td>
                    <td className="px-3 py-2">{row.end_date}</td>
                  </tr>
                ))}
                {periods.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-slate-500">
                      {l("No periods found for selected filters.", "Secilen filtreler icin donem bulunamadi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {shareholderJournalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {shareholderJournalModal.title}
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {shareholderJournalModal.message}
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div>
                {l("Journal No", "Fis No")}:{" "}
                <span className="font-mono">{shareholderJournalModal.journalNo}</span>
              </div>
              <div>
                {l("Journal ID", "Fis ID")}:{" "}
                <span className="font-mono">
                  {shareholderJournalModal.journalEntryId}
                </span>
              </div>
              <div>
                {l("Book", "Defter")}:{" "}
                <span className="font-mono">{shareholderJournalModal.bookCode}</span>
              </div>
              <div>
                {l("Fiscal Period ID", "Mali Donem ID")}:{" "}
                <span className="font-mono">
                  {shareholderJournalModal.fiscalPeriodId}
                </span>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShareholderJournalModal(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

