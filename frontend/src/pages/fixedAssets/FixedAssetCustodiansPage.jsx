import { useEffect, useMemo, useState } from "react";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  listFixedAssetCustodians,
  createFixedAssetCustodian,
  updateFixedAssetCustodian,
} from "../../api/fixedAssets.js";
import { listLegalEntities, listOperatingUnits } from "../../api/orgAdmin.js";

const STATUS_VALUES = ["ACTIVE", "INACTIVE"];

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function mapLegalEntityOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
    description: normalizeText(
      row?.functional_currency_code || row?.functionalCurrencyCode
    ),
  };
}

function mapOuOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
  };
}

function createCustodianForm() {
  return {
    legalEntityId: "",
    employeeCode: "",
    displayName: "",
    operatingUnitId: "",
    status: "ACTIVE",
    notes: "",
  };
}

function mapCustodianToForm(row) {
  return {
    legalEntityId: String(row?.legalEntityId || ""),
    employeeCode: String(row?.employeeCode || ""),
    displayName: String(row?.displayName || ""),
    operatingUnitId: String(row?.operatingUnitId || ""),
    status: String(row?.status || "ACTIVE"),
    notes: String(row?.notes || ""),
  };
}

function buildCustodianPayload(form) {
  return {
    legalEntityId: toPositiveInt(form.legalEntityId) || undefined,
    employeeCode: normalizeText(form.employeeCode),
    displayName: normalizeText(form.displayName),
    operatingUnitId: toPositiveInt(form.operatingUnitId) || undefined,
    status: normalizeText(form.status).toUpperCase(),
    notes: normalizeText(form.notes) || undefined,
  };
}

export default function FixedAssetCustodiansPage() {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const {
    workingContext,
    legalEntities: workingContextLegalEntities,
    loading: workingContextLoading,
  } = useWorkingContext();
  const workingLegalEntityId = toPositiveInt(workingContext?.legalEntityId);
  const workingOperatingUnitId = toPositiveInt(workingContext?.operatingUnitId);

  const canRead = hasPermission("fixed_assets.custodian.read");
  const canWrite = hasPermission("fixed_assets.custodian.write");

  // ── Legal entity lookup ─────────────────────────────────────────
  const [fallbackLeRows, setFallbackLeRows] = useState([]);
  const [fallbackLeLoading, setFallbackLeLoading] = useState(false);

  useEffect(() => {
    const canReadOrg = hasPermission("org.tree.read");
    if (
      !canReadOrg ||
      (Array.isArray(workingContextLegalEntities) &&
        workingContextLegalEntities.length > 0) ||
      workingContextLoading
    ) {
      return;
    }
    let active = true;
    (async () => {
      setFallbackLeLoading(true);
      try {
        const res = await listLegalEntities({ limit: 500, includeInactive: true });
        if (active) setFallbackLeRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch {
        if (active) setFallbackLeRows([]);
      } finally {
        if (active) setFallbackLeLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hasPermission, workingContextLegalEntities, workingContextLoading]);

  const leRows = useMemo(() => {
    if (Array.isArray(workingContextLegalEntities) && workingContextLegalEntities.length > 0) {
      return workingContextLegalEntities;
    }
    return fallbackLeRows;
  }, [fallbackLeRows, workingContextLegalEntities]);

  const leOptions = useMemo(() => leRows.map(mapLegalEntityOption).filter(Boolean), [leRows]);
  const leLookupLoading = fallbackLeLoading || (workingContextLoading && leOptions.length === 0);

  // ── Operating unit lookup ───────────────────────────────────────
  const [ouRows, setOuRows] = useState([]);

  useEffect(() => {
    const canReadOrg = hasPermission("org.tree.read");
    if (!canReadOrg) return;
    let active = true;
    (async () => {
      try {
        const res = await listOperatingUnits({ limit: 500 });
        if (active) setOuRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch {
        if (active) setOuRows([]);
      }
    })();
    return () => { active = false; };
  }, [hasPermission]);

  const ouOptions = useMemo(() => ouRows.map(mapOuOption).filter(Boolean), [ouRows]);

  // ── Filter ──────────────────────────────────────────────────────
  const [filterLeId, setFilterLeId] = useState("");
  const [filterStatus, setFilterStatus] = useState("ACTIVE");

  useEffect(() => {
    if (!workingLegalEntityId) {
      return;
    }
    setFilterLeId((currentValue) => currentValue || String(workingLegalEntityId));
  }, [workingLegalEntityId]);

  // ── List state ──────────────────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");

  // ── Form state ──────────────────────────────────────────────────
  const [selectedRow, setSelectedRow] = useState(null);
  const [form, setForm] = useState(createCustodianForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formMsg, setFormMsg] = useState("");

  useEffect(() => {
    if (selectedRow?.id) {
      return;
    }
    setForm((currentForm) => {
      const nextLegalEntityId =
        currentForm.legalEntityId || (workingLegalEntityId ? String(workingLegalEntityId) : "");
      const nextOperatingUnitId =
        currentForm.operatingUnitId || (workingOperatingUnitId ? String(workingOperatingUnitId) : "");
      if (
        nextLegalEntityId === currentForm.legalEntityId &&
        nextOperatingUnitId === currentForm.operatingUnitId
      ) {
        return currentForm;
      }
      return {
        ...currentForm,
        legalEntityId: nextLegalEntityId,
        operatingUnitId: nextOperatingUnitId,
      };
    });
  }, [selectedRow?.id, workingLegalEntityId, workingOperatingUnitId]);

  // ── Load custodians ─────────────────────────────────────────────
  useEffect(() => {
    if (!canRead) {
      setRows([]);
      setListError(l("Missing permission: fixed_assets.custodian.read", "Eksik yetki: fixed_assets.custodian.read"));
      return;
    }
    let active = true;
    (async () => {
      setLoading(true);
      setListError("");
      try {
        const res = await listFixedAssetCustodians({
          legalEntityId: filterLeId || undefined,
          operatingUnitId: workingOperatingUnitId || undefined,
          status: filterStatus || undefined,
        });
        if (active) setRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch (err) {
        if (active) {
          setRows([]);
          setListError(normalizeApiError(err, l("Failed to load custodians.", "Zimmetliler yuklenemedi.")));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, filterLeId, filterStatus, workingOperatingUnitId, l]);

  // ── Handlers ────────────────────────────────────────────────────
  function resetForm() {
    setSelectedRow(null);
    setForm({
      ...createCustodianForm(),
      legalEntityId: filterLeId,
      operatingUnitId: workingOperatingUnitId ? String(workingOperatingUnitId) : "",
    });
    setFormError("");
    setFormMsg("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canWrite) {
      setFormError(l("Missing permission: fixed_assets.custodian.write", "Eksik yetki: fixed_assets.custodian.write"));
      return;
    }
    const payload = buildCustodianPayload(form);
    if (!payload.employeeCode) { setFormError(l("Employee code is required.", "Personel kodu zorunludur.")); return; }
    if (!payload.displayName) { setFormError(l("Display name is required.", "Gorunen ad zorunludur.")); return; }

    setSaving(true);
    setFormError("");
    setFormMsg("");
    try {
      const res = selectedRow?.id
        ? await updateFixedAssetCustodian(selectedRow.id, payload)
        : await createFixedAssetCustodian(payload);
      setFormMsg(
        selectedRow?.id
          ? l("Custodian updated.", "Zimmetli guncellendi.")
          : l("Custodian created.", "Zimmetli olusturuldu.")
      );
      if (res) { setSelectedRow(res); setForm(mapCustodianToForm(res)); }
      const refreshed = await listFixedAssetCustodians({
        legalEntityId: filterLeId || undefined,
        operatingUnitId: workingOperatingUnitId || undefined,
        status: filterStatus || undefined,
      });
      setRows(Array.isArray(refreshed?.rows) ? refreshed.rows : []);
    } catch (err) {
      setFormError(normalizeApiError(err, l("Failed to save custodian.", "Zimmetli kaydedilemedi.")));
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {l("Fixed Asset Custodians", "Demirbas Zimmetlileri")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Manage custodian employees responsible for fixed assets. Custodians are used for assignment and reporting.",
            "Demirbas zimmetli calisanlarini yonetin. Zimmetliler atama ve raporlama icin kullanilir."
          )}
        </p>
      </section>

      {/* Filters */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{l("Filters", "Filtreler")}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox className="mt-1" value={filterLeId} options={leOptions} loading={leLookupLoading}
                placeholder={l("All legal entities", "Tum tuzel kisilikler")} noOptionsText={l("None", "Yok")}
                onChange={(v) => setFilterLeId(v ? String(v) : "")} />
            </label>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Status", "Durum")}
            <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">{l("All", "Tumleri")}</option>
              {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {listError ? <p className="mt-3 text-sm text-rose-700">{listError}</p> : null}
      </section>

      {/* Form */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {selectedRow?.id
              ? l("Edit Custodian", "Zimmetli Duzenle")
              : l("Create Custodian", "Zimmetli Olustur")}
          </h2>
          <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60" onClick={resetForm} disabled={saving}>
            {l("Reset", "Sifirla")}
          </button>
        </div>
        {formError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div> : null}
        {formMsg ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{formMsg}</div> : null}
        <form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={handleSubmit}>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox className="mt-1" value={form.legalEntityId} options={leOptions} loading={leLookupLoading}
                placeholder={l("Select", "Secin")} noOptionsText={l("None", "Yok")}
                onChange={(v) => setForm((p) => ({ ...p, legalEntityId: v ? String(v) : "" }))} disabled={saving || !!selectedRow?.id} />
            </label>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Employee Code", "Personel Kodu")}
            <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={form.employeeCode}
              onChange={(e) => setForm((p) => ({ ...p, employeeCode: e.target.value }))} disabled={saving} required />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Display Name", "Gorunen Ad")}
            <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={form.displayName}
              onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))} disabled={saving} required />
          </label>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Operating Unit (optional)", "Isletme Birimi (opsiyonel)")}
              <Combobox className="mt-1" value={form.operatingUnitId} options={ouOptions}
                placeholder={l("Select OU", "Isletme birimi secin")} noOptionsText={l("None", "Yok")}
                onChange={(v) => setForm((p) => ({ ...p, operatingUnitId: v ? String(v) : "" }))} disabled={saving} />
            </label>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Status", "Durum")}
            <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} disabled={saving}>
              {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="md:col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Notes (optional)", "Notlar (opsiyonel)")}
            <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" rows={2} value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} disabled={saving} />
          </label>
          <div className="md:col-span-4 flex gap-3 items-center pt-2">
            <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={!canWrite || saving}>
              {saving ? l("Saving...", "Kaydediliyor...") : selectedRow?.id ? l("Update Custodian", "Zimmetli Guncelle") : l("Create Custodian", "Zimmetli Olustur")}
            </button>
            {!canWrite ? <p className="text-sm text-slate-500">{l("Missing permission: fixed_assets.custodian.write", "Eksik yetki: fixed_assets.custodian.write")}</p> : null}
          </div>
        </form>
      </section>

      {/* List */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{l("Custodian List", "Zimmetli Listesi")}</h2>
        {loading ? <p className="mt-3 text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p> : null}
        {!loading && rows.length === 0 && !listError ? <p className="mt-3 text-sm text-slate-600">{l("No custodians found.", "Zimmetli bulunamadi.")}</p> : null}
        {!loading && rows.length > 0 ? (
          <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">{l("Employee Code", "Personel Kodu")}</th>
                  <th className="px-3 py-2">{l("Display Name", "Gorunen Ad")}</th>
                  <th className="px-3 py-2">{l("Operating Unit", "Isletme Birimi")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2">{l("Notes", "Notlar")}</th>
                  <th className="px-3 py-2 text-right">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.employeeCode || "-"}</td>
                    <td className="px-3 py-2">{row.displayName || "-"}</td>
                    <td className="px-3 py-2">{row.operatingUnitId || "-"}</td>
                    <td className="px-3 py-2">{row.status || "-"}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{row.notes || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60"
                        onClick={() => { setSelectedRow(row); setForm(mapCustodianToForm(row)); setFormError(""); setFormMsg(""); }} disabled={!canWrite}>
                        {l("Edit", "Duzenle")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
