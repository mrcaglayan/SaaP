import { useEffect, useMemo, useState } from "react";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  listFixedAssetCategories,
  createFixedAssetCategory,
  updateFixedAssetCategory,
  listFixedAssetDepreciationProfiles,
  createFixedAssetDepreciationProfile,
  updateFixedAssetDepreciationProfile,
} from "../../api/fixedAssets.js";
import { listLegalEntities } from "../../api/orgAdmin.js";

const STATUS_VALUES = ["ACTIVE", "INACTIVE"];
const SALVAGE_RULE_TYPES = ["NONE", "FIXED_BASE_AMOUNT", "PERCENT_OF_COST"];
const DEPRECIATION_METHODS = ["STRAIGHT_LINE", "DECLINING_BALANCE", "NONE"];

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

// ── Category form helpers ───────────────────────────────────────

function createCategoryForm() {
  return {
    legalEntityId: "",
    code: "",
    name: "",
    status: "ACTIVE",
    description: "",
    capitalizationThresholdBase: "",
    defaultUsefulLifeMonths: "",
    defaultSalvageRuleType: "NONE",
    defaultSalvagePercent: "",
    defaultSalvageAmountBase: "",
  };
}

function mapCategoryToForm(row) {
  return {
    legalEntityId: String(row?.legalEntityId || ""),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    status: String(row?.status || "ACTIVE"),
    description: String(row?.description || ""),
    capitalizationThresholdBase:
      row?.capitalizationThresholdBase != null
        ? String(row.capitalizationThresholdBase)
        : "",
    defaultUsefulLifeMonths:
      row?.defaultUsefulLifeMonths != null
        ? String(row.defaultUsefulLifeMonths)
        : "",
    defaultSalvageRuleType: String(row?.defaultSalvageRuleType || "NONE"),
    defaultSalvagePercent:
      row?.defaultSalvagePercent != null
        ? String(row.defaultSalvagePercent)
        : "",
    defaultSalvageAmountBase:
      row?.defaultSalvageAmountBase != null
        ? String(row.defaultSalvageAmountBase)
        : "",
  };
}

function buildCategoryPayload(form) {
  const salvageType = normalizeText(form.defaultSalvageRuleType).toUpperCase() || "NONE";
  return {
    legalEntityId: toPositiveInt(form.legalEntityId) || undefined,
    code: normalizeText(form.code).toUpperCase(),
    name: normalizeText(form.name),
    status: normalizeText(form.status).toUpperCase(),
    description: normalizeText(form.description) || undefined,
    capitalizationThresholdBase:
      normalizeText(form.capitalizationThresholdBase)
        ? Number(form.capitalizationThresholdBase)
        : undefined,
    defaultUsefulLifeMonths: toPositiveInt(form.defaultUsefulLifeMonths) || undefined,
    defaultSalvageRuleType: salvageType,
    defaultSalvagePercent:
      salvageType === "PERCENT_OF_COST" && normalizeText(form.defaultSalvagePercent)
        ? Number(form.defaultSalvagePercent)
        : undefined,
    defaultSalvageAmountBase:
      salvageType === "FIXED_BASE_AMOUNT" && normalizeText(form.defaultSalvageAmountBase)
        ? Number(form.defaultSalvageAmountBase)
        : undefined,
  };
}

// ── Profile form helpers ────────────────────────────────────────

function createProfileForm() {
  return {
    legalEntityId: "",
    code: "",
    name: "",
    status: "ACTIVE",
    method: "STRAIGHT_LINE",
    decliningBalanceRatePercent: "",
    switchToStraightLine: false,
    description: "",
  };
}

function mapProfileToForm(row) {
  return {
    legalEntityId: String(row?.legalEntityId || ""),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    status: String(row?.status || "ACTIVE"),
    method: String(row?.method || "STRAIGHT_LINE"),
    decliningBalanceRatePercent:
      row?.decliningBalanceRatePercent != null
        ? String(row.decliningBalanceRatePercent)
        : "",
    switchToStraightLine: row?.switchToStraightLine === true,
    description: String(row?.description || ""),
  };
}

function buildProfilePayload(form) {
  const method = normalizeText(form.method).toUpperCase() || "STRAIGHT_LINE";
  return {
    legalEntityId: toPositiveInt(form.legalEntityId) || undefined,
    code: normalizeText(form.code).toUpperCase(),
    name: normalizeText(form.name),
    status: normalizeText(form.status).toUpperCase(),
    method,
    decliningBalanceRatePercent:
      method === "DECLINING_BALANCE" && normalizeText(form.decliningBalanceRatePercent)
        ? Number(form.decliningBalanceRatePercent)
        : undefined,
    switchToStraightLine: form.switchToStraightLine === true,
    description: normalizeText(form.description) || undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════

export default function FixedAssetSettingsPage() {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const {
    legalEntities: workingContextLegalEntities,
    loading: workingContextLoading,
    error: workingContextError,
  } = useWorkingContext();

  const canReadSettings = hasPermission("fixed_assets.settings.read");
  const canUpsertSettings = hasPermission("fixed_assets.settings.upsert");

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

  // ── Active tab ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("categories");

  // ── Shared filter ───────────────────────────────────────────────
  const [filterLeId, setFilterLeId] = useState("");

  // ── Category state ──────────────────────────────────────────────
  const [catRows, setCatRows] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState("");
  const [catSelected, setCatSelected] = useState(null);
  const [catForm, setCatForm] = useState(createCategoryForm);
  const [catSaving, setCatSaving] = useState(false);
  const [catFormError, setCatFormError] = useState("");
  const [catFormMsg, setCatFormMsg] = useState("");

  // ── Profile state ───────────────────────────────────────────────
  const [profRows, setProfRows] = useState([]);
  const [profLoading, setProfLoading] = useState(false);
  const [profError, setProfError] = useState("");
  const [profSelected, setProfSelected] = useState(null);
  const [profForm, setProfForm] = useState(createProfileForm);
  const [profSaving, setProfSaving] = useState(false);
  const [profFormError, setProfFormError] = useState("");
  const [profFormMsg, setProfFormMsg] = useState("");

  // ── Load categories ─────────────────────────────────────────────
  useEffect(() => {
    if (!canReadSettings) {
      setCatRows([]);
      setCatError(l("Missing permission: fixed_assets.settings.read", "Eksik yetki: fixed_assets.settings.read"));
      return;
    }
    let active = true;
    (async () => {
      setCatLoading(true);
      setCatError("");
      try {
        const res = await listFixedAssetCategories({
          legalEntityId: filterLeId || undefined,
        });
        if (active) setCatRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch (err) {
        if (active) {
          setCatRows([]);
          setCatError(normalizeApiError(err, l("Failed to load categories.", "Kategoriler yuklenemedi.")));
        }
      } finally {
        if (active) setCatLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canReadSettings, filterLeId, l]);

  // ── Load profiles ───────────────────────────────────────────────
  useEffect(() => {
    if (!canReadSettings) {
      setProfRows([]);
      setProfError(l("Missing permission: fixed_assets.settings.read", "Eksik yetki: fixed_assets.settings.read"));
      return;
    }
    let active = true;
    (async () => {
      setProfLoading(true);
      setProfError("");
      try {
        const res = await listFixedAssetDepreciationProfiles({
          legalEntityId: filterLeId || undefined,
        });
        if (active) setProfRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch (err) {
        if (active) {
          setProfRows([]);
          setProfError(normalizeApiError(err, l("Failed to load profiles.", "Profiller yuklenemedi.")));
        }
      } finally {
        if (active) setProfLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canReadSettings, filterLeId, l]);

  // ── Category handlers ──────────────────────────────────────────
  function resetCatForm() {
    setCatSelected(null);
    setCatForm({ ...createCategoryForm(), legalEntityId: filterLeId });
    setCatFormError("");
    setCatFormMsg("");
  }

  async function handleCatSubmit(e) {
    e.preventDefault();
    if (!canUpsertSettings) {
      setCatFormError(l("Missing permission: fixed_assets.settings.upsert", "Eksik yetki: fixed_assets.settings.upsert"));
      return;
    }
    const payload = buildCategoryPayload(catForm);
    if (!payload.code) { setCatFormError(l("Code is required.", "Kod zorunludur.")); return; }
    if (!payload.name) { setCatFormError(l("Name is required.", "Ad zorunludur.")); return; }

    setCatSaving(true);
    setCatFormError("");
    setCatFormMsg("");
    try {
      const res = catSelected?.id
        ? await updateFixedAssetCategory(catSelected.id, payload)
        : await createFixedAssetCategory(payload);
      setCatFormMsg(
        catSelected?.id
          ? l("Category updated.", "Kategori guncellendi.")
          : l("Category created.", "Kategori olusturuldu.")
      );
      if (res) { setCatSelected(res); setCatForm(mapCategoryToForm(res)); }
      const refreshed = await listFixedAssetCategories({ legalEntityId: filterLeId || undefined });
      setCatRows(Array.isArray(refreshed?.rows) ? refreshed.rows : []);
    } catch (err) {
      setCatFormError(normalizeApiError(err, l("Failed to save category.", "Kategori kaydedilemedi.")));
    } finally {
      setCatSaving(false);
    }
  }

  // ── Profile handlers ───────────────────────────────────────────
  function resetProfForm() {
    setProfSelected(null);
    setProfForm({ ...createProfileForm(), legalEntityId: filterLeId });
    setProfFormError("");
    setProfFormMsg("");
  }

  async function handleProfSubmit(e) {
    e.preventDefault();
    if (!canUpsertSettings) {
      setProfFormError(l("Missing permission: fixed_assets.settings.upsert", "Eksik yetki: fixed_assets.settings.upsert"));
      return;
    }
    const payload = buildProfilePayload(profForm);
    if (!payload.code) { setProfFormError(l("Code is required.", "Kod zorunludur.")); return; }
    if (!payload.name) { setProfFormError(l("Name is required.", "Ad zorunludur.")); return; }

    setProfSaving(true);
    setProfFormError("");
    setProfFormMsg("");
    try {
      const res = profSelected?.id
        ? await updateFixedAssetDepreciationProfile(profSelected.id, payload)
        : await createFixedAssetDepreciationProfile(payload);
      setProfFormMsg(
        profSelected?.id
          ? l("Profile updated.", "Profil guncellendi.")
          : l("Profile created.", "Profil olusturuldu.")
      );
      if (res) { setProfSelected(res); setProfForm(mapProfileToForm(res)); }
      const refreshed = await listFixedAssetDepreciationProfiles({ legalEntityId: filterLeId || undefined });
      setProfRows(Array.isArray(refreshed?.rows) ? refreshed.rows : []);
    } catch (err) {
      setProfFormError(normalizeApiError(err, l("Failed to save profile.", "Profil kaydedilemedi.")));
    } finally {
      setProfSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  const tabClass = (tab) =>
    `px-4 py-2 text-sm font-semibold rounded-t-lg border border-b-0 ${
      activeTab === tab
        ? "bg-white text-slate-900 border-slate-200"
        : "bg-slate-100 text-slate-500 border-transparent hover:text-slate-700"
    }`;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {l("Fixed Asset Settings", "Demirbas Ayarlari")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Manage categories and depreciation profiles used by the fixed-assets module.",
            "Demirbas modulunun kullandigi kategori ve amortisman profillerini yonetin."
          )}
        </p>
      </section>

      {/* Filter */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox
                className="mt-1"
                value={filterLeId}
                options={leOptions}
                loading={leLookupLoading}
                placeholder={l("All legal entities", "Tum tuzel kisilikler")}
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(v) => setFilterLeId(v ? String(v) : "")}
              />
            </label>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-1 -mb-px">
        <button type="button" className={tabClass("categories")} onClick={() => setActiveTab("categories")}>
          {l("Categories", "Kategoriler")}
        </button>
        <button type="button" className={tabClass("profiles")} onClick={() => setActiveTab("profiles")}>
          {l("Depreciation Profiles", "Amortisman Profilleri")}
        </button>
      </div>

      {/* ── Categories Tab ────────────────────────────────────────── */}
      {activeTab === "categories" ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">
                {catSelected?.id
                  ? l("Edit Category", "Kategori Duzenle")
                  : l("Create Category", "Kategori Olustur")}
              </h2>
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60" onClick={resetCatForm} disabled={catSaving}>
                {l("Reset", "Sifirla")}
              </button>
            </div>
            {catFormError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{catFormError}</div> : null}
            {catFormMsg ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{catFormMsg}</div> : null}
            <form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={handleCatSubmit}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  {l("Legal Entity", "Tuzel Kisilik")}
                  <Combobox className="mt-1" value={catForm.legalEntityId} options={leOptions} loading={leLookupLoading}
                    placeholder={l("Select", "Secin")} noOptionsText={l("None", "Yok")}
                    onChange={(v) => setCatForm((p) => ({ ...p, legalEntityId: v ? String(v) : "" }))} disabled={catSaving || !!catSelected?.id} />
                </label>
              </div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Code", "Kod")}
                <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase" value={catForm.code}
                  onChange={(e) => setCatForm((p) => ({ ...p, code: e.target.value }))} disabled={catSaving} required />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Name", "Ad")}
                <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.name}
                  onChange={(e) => setCatForm((p) => ({ ...p, name: e.target.value }))} disabled={catSaving} required />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Status", "Durum")}
                <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.status}
                  onChange={(e) => setCatForm((p) => ({ ...p, status: e.target.value }))} disabled={catSaving}>
                  {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Description", "Aciklama")}
                <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.description}
                  onChange={(e) => setCatForm((p) => ({ ...p, description: e.target.value }))} disabled={catSaving} />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Capitalization Threshold", "Aktiflestirme Esigi")}
                <input type="number" min="0" step="0.01" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.capitalizationThresholdBase}
                  onChange={(e) => setCatForm((p) => ({ ...p, capitalizationThresholdBase: e.target.value }))} disabled={catSaving} />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Default Useful Life (months)", "Varsayilan Faydali Omur (ay)")}
                <input type="number" min="1" step="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.defaultUsefulLifeMonths}
                  onChange={(e) => setCatForm((p) => ({ ...p, defaultUsefulLifeMonths: e.target.value }))} disabled={catSaving} />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Salvage Rule Type", "Hurda Kural Tipi")}
                <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.defaultSalvageRuleType}
                  onChange={(e) => setCatForm((p) => ({ ...p, defaultSalvageRuleType: e.target.value, defaultSalvagePercent: "", defaultSalvageAmountBase: "" }))} disabled={catSaving}>
                  {SALVAGE_RULE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              {catForm.defaultSalvageRuleType === "PERCENT_OF_COST" ? (
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Salvage Percent (%)", "Hurda Yuzdesi (%)")}
                  <input type="number" min="0" max="100" step="0.01" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.defaultSalvagePercent}
                    onChange={(e) => setCatForm((p) => ({ ...p, defaultSalvagePercent: e.target.value }))} disabled={catSaving} required />
                </label>
              ) : null}
              {catForm.defaultSalvageRuleType === "FIXED_BASE_AMOUNT" ? (
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Salvage Amount", "Hurda Tutari")}
                  <input type="number" min="0" step="0.01" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={catForm.defaultSalvageAmountBase}
                    onChange={(e) => setCatForm((p) => ({ ...p, defaultSalvageAmountBase: e.target.value }))} disabled={catSaving} required />
                </label>
              ) : null}
              <div className="md:col-span-4 flex gap-3 items-center pt-2">
                <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={!canUpsertSettings || catSaving}>
                  {catSaving ? l("Saving...", "Kaydediliyor...") : catSelected?.id ? l("Update Category", "Kategori Guncelle") : l("Create Category", "Kategori Olustur")}
                </button>
                {!canUpsertSettings ? <p className="text-sm text-slate-500">{l("Missing permission: fixed_assets.settings.upsert", "Eksik yetki: fixed_assets.settings.upsert")}</p> : null}
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{l("Categories", "Kategoriler")}</h2>
            {catError ? <p className="mt-3 text-sm text-rose-700">{catError}</p> : null}
            {catLoading ? <p className="mt-3 text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p> : null}
            {!catLoading && catRows.length === 0 && !catError ? <p className="mt-3 text-sm text-slate-600">{l("No categories found.", "Kategori bulunamadi.")}</p> : null}
            {!catLoading && catRows.length > 0 ? (
              <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">{l("Code", "Kod")}</th>
                      <th className="px-3 py-2">{l("Name", "Ad")}</th>
                      <th className="px-3 py-2">{l("Threshold", "Esik")}</th>
                      <th className="px-3 py-2">{l("Useful Life", "Faydali Omur")}</th>
                      <th className="px-3 py-2">{l("Salvage Rule", "Hurda Kural")}</th>
                      <th className="px-3 py-2">{l("Status", "Durum")}</th>
                      <th className="px-3 py-2 text-right">{l("Action", "Islem")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{row.code || "-"}</td>
                        <td className="px-3 py-2">{row.name || "-"}</td>
                        <td className="px-3 py-2">{row.capitalizationThresholdBase != null ? row.capitalizationThresholdBase : "-"}</td>
                        <td className="px-3 py-2">{row.defaultUsefulLifeMonths != null ? `${row.defaultUsefulLifeMonths} mo` : "-"}</td>
                        <td className="px-3 py-2">{row.defaultSalvageRuleType || "-"}</td>
                        <td className="px-3 py-2">{row.status || "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60"
                            onClick={() => { setCatSelected(row); setCatForm(mapCategoryToForm(row)); setCatFormError(""); setCatFormMsg(""); }} disabled={!canUpsertSettings}>
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
        </>
      ) : null}

      {/* ── Profiles Tab ──────────────────────────────────────────── */}
      {activeTab === "profiles" ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">
                {profSelected?.id
                  ? l("Edit Depreciation Profile", "Amortisman Profili Duzenle")
                  : l("Create Depreciation Profile", "Amortisman Profili Olustur")}
              </h2>
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60" onClick={resetProfForm} disabled={profSaving}>
                {l("Reset", "Sifirla")}
              </button>
            </div>
            {profFormError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{profFormError}</div> : null}
            {profFormMsg ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{profFormMsg}</div> : null}
            <form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={handleProfSubmit}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  {l("Legal Entity", "Tuzel Kisilik")}
                  <Combobox className="mt-1" value={profForm.legalEntityId} options={leOptions} loading={leLookupLoading}
                    placeholder={l("Select", "Secin")} noOptionsText={l("None", "Yok")}
                    onChange={(v) => setProfForm((p) => ({ ...p, legalEntityId: v ? String(v) : "" }))} disabled={profSaving || !!profSelected?.id} />
                </label>
              </div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Code", "Kod")}
                <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase" value={profForm.code}
                  onChange={(e) => setProfForm((p) => ({ ...p, code: e.target.value }))} disabled={profSaving} required />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Name", "Ad")}
                <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={profForm.name}
                  onChange={(e) => setProfForm((p) => ({ ...p, name: e.target.value }))} disabled={profSaving} required />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Status", "Durum")}
                <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={profForm.status}
                  onChange={(e) => setProfForm((p) => ({ ...p, status: e.target.value }))} disabled={profSaving}>
                  {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Method", "Yontem")}
                <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={profForm.method}
                  onChange={(e) => setProfForm((p) => ({ ...p, method: e.target.value, decliningBalanceRatePercent: "" }))} disabled={profSaving}>
                  {DEPRECIATION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              {profForm.method === "DECLINING_BALANCE" ? (
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Declining Balance Rate (%)", "Azalan Bakiye Orani (%)")}
                  <input type="number" min="0.01" max="100" step="0.01" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={profForm.decliningBalanceRatePercent}
                    onChange={(e) => setProfForm((p) => ({ ...p, decliningBalanceRatePercent: e.target.value }))} disabled={profSaving} required />
                </label>
              ) : null}
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-2 self-end pb-2">
                <input type="checkbox" checked={profForm.switchToStraightLine}
                  onChange={(e) => setProfForm((p) => ({ ...p, switchToStraightLine: e.target.checked }))} disabled={profSaving} />
                {l("Switch to Straight Line", "Dogrusal Amortismana Gec")}
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Description", "Aciklama")}
                <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={profForm.description}
                  onChange={(e) => setProfForm((p) => ({ ...p, description: e.target.value }))} disabled={profSaving} />
              </label>
              <div className="md:col-span-4 flex gap-3 items-center pt-2">
                <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={!canUpsertSettings || profSaving}>
                  {profSaving ? l("Saving...", "Kaydediliyor...") : profSelected?.id ? l("Update Profile", "Profil Guncelle") : l("Create Profile", "Profil Olustur")}
                </button>
                {!canUpsertSettings ? <p className="text-sm text-slate-500">{l("Missing permission: fixed_assets.settings.upsert", "Eksik yetki: fixed_assets.settings.upsert")}</p> : null}
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{l("Depreciation Profiles", "Amortisman Profilleri")}</h2>
            {profError ? <p className="mt-3 text-sm text-rose-700">{profError}</p> : null}
            {profLoading ? <p className="mt-3 text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p> : null}
            {!profLoading && profRows.length === 0 && !profError ? <p className="mt-3 text-sm text-slate-600">{l("No profiles found.", "Profil bulunamadi.")}</p> : null}
            {!profLoading && profRows.length > 0 ? (
              <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">{l("Code", "Kod")}</th>
                      <th className="px-3 py-2">{l("Name", "Ad")}</th>
                      <th className="px-3 py-2">{l("Method", "Yontem")}</th>
                      <th className="px-3 py-2">{l("Rate %", "Oran %")}</th>
                      <th className="px-3 py-2">{l("Switch to SL", "SL Gecis")}</th>
                      <th className="px-3 py-2">{l("Status", "Durum")}</th>
                      <th className="px-3 py-2 text-right">{l("Action", "Islem")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{row.code || "-"}</td>
                        <td className="px-3 py-2">{row.name || "-"}</td>
                        <td className="px-3 py-2">{row.method || "-"}</td>
                        <td className="px-3 py-2">{row.decliningBalanceRatePercent != null ? row.decliningBalanceRatePercent : "-"}</td>
                        <td className="px-3 py-2">{row.switchToStraightLine ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">{row.status || "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60"
                            onClick={() => { setProfSelected(row); setProfForm(mapProfileToForm(row)); setProfFormError(""); setProfFormMsg(""); }} disabled={!canUpsertSettings}>
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
        </>
      ) : null}
    </div>
  );
}
