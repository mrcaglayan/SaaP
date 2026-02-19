import { useEffect, useMemo, useState } from "react";
import {
  generateFiscalPeriods,
  listCountries,
  listFiscalCalendars,
  listFiscalPeriods,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  upsertFiscalCalendar,
  upsertGroupCompany,
  upsertLegalEntity,
  upsertOperatingUnit,
} from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";

const UNIT_TYPES = ["BRANCH", "PLANT", "STORE", "DEPARTMENT", "OTHER"];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function OrganizationManagementPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = (en, tr) => (isTr ? tr : en);
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadFiscalCalendars = hasPermission("org.fiscal_calendar.read");
  const canReadFiscalPeriods = hasPermission("org.fiscal_period.read");
  const canUpsertGroupCompany = hasPermission("org.group_company.upsert");
  const canUpsertLegalEntity = hasPermission("org.legal_entity.upsert");
  const canUpsertOperatingUnit = hasPermission("org.operating_unit.upsert");
  const canUpsertFiscalCalendar = hasPermission("org.fiscal_calendar.upsert");
  const canGenerateFiscalPeriods = hasPermission("org.fiscal_period.generate");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [periods, setPeriods] = useState([]);

  const [groupForm, setGroupForm] = useState({ code: "", name: "" });
  const [entityForm, setEntityForm] = useState({
    groupCompanyId: "",
    code: "",
    name: "",
    taxId: "",
    countryId: "",
    countryIdManual: "",
    functionalCurrencyCode: "USD",
    isIntercompanyEnabled: true,
    intercompanyPartnerRequired: false,
  });
  const [unitForm, setUnitForm] = useState({
    legalEntityId: "",
    code: "",
    name: "",
    unitType: "BRANCH",
    hasSubledger: false,
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
        const [groupsRes, countriesRes, entitiesRes, unitsRes] =
          await Promise.all([
            listGroupCompanies(),
            listCountries(),
            listLegalEntities(),
            listOperatingUnits(),
          ]);

        const groupRows = groupsRes?.rows || [];
        const countryRows = countriesRes?.rows || [];
        const entityRows = entitiesRes?.rows || [];
        const unitRows = unitsRes?.rows || [];

        setGroups(groupRows);
        setCountries(countryRows);
        setLegalEntities(entityRows);
        setOperatingUnits(unitRows);

        setEntityForm((prev) => ({
          ...prev,
          groupCompanyId:
            prev.groupCompanyId || String(groupRows[0]?.id || ""),
          countryId: prev.countryId || String(countryRows[0]?.id || ""),
        }));
        setUnitForm((prev) => ({
          ...prev,
          legalEntityId: prev.legalEntityId || String(entityRows[0]?.id || ""),
        }));
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
  }, [canReadOrgTree, canReadFiscalCalendars]);

  useEffect(() => {
    loadPeriods(periodForm.calendarId, periodForm.fiscalYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodForm.calendarId, periodForm.fiscalYear, canReadFiscalPeriods]);

  const countrySelectOptions = useMemo(
    () => countries.map((row) => ({ id: row.id, label: `${row.iso2} - ${row.name}` })),
    [countries]
  );

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
    const countryId =
      toNumber(entityForm.countryId) || toNumber(entityForm.countryIdManual);
    if (!groupCompanyId || !countryId) {
      setError(l("groupCompanyId and countryId are required.", "groupCompanyId ve countryId zorunludur."));
      return;
    }

    setSaving("entity");
    setError("");
    setMessage("");
    try {
      await upsertLegalEntity({
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
      });

      setEntityForm((prev) => ({
        ...prev,
        code: "",
        name: "",
        taxId: "",
        functionalCurrencyCode: prev.functionalCurrencyCode || "USD",
      }));
      setMessage(l("Legal entity saved.", "Hukuki birim kaydedildi."));
      await loadCoreData();
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to save legal entity.", "Hukuki birim kaydedilemedi."));
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
            {l("Legal Entities", "Hukuki Birimler")}
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
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  countryId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{l("Select country (if available)", "Ulke secin (varsa)")}</option>
              {countrySelectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={entityForm.countryIdManual}
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  countryIdManual: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Country ID (manual)", "Ulke ID (manuel)")}
            />
            <input
              value={entityForm.functionalCurrencyCode}
              onChange={(event) =>
                setEntityForm((prev) => ({
                  ...prev,
                  functionalCurrencyCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={l("Currency (e.g. USD)", "Para birimi (orn. USD)")}
              maxLength={3}
              required
            />

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
                      {l("No legal entities found.", "Hukuki birim bulunamadi.")}
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
              <option value="">{l("Select legal entity", "Hukuki birim secin")}</option>
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
    </div>
  );
}
