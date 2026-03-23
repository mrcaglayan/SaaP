import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  createFixedAsset,
  activateFixedAsset,
  listFixedAssetCategories,
  listFixedAssetDepreciationProfiles,
  listFixedAssetCustodians,
} from "../../api/fixedAssets.js";
import { listLegalEntities, listOperatingUnits } from "../../api/orgAdmin.js";

// ── Helpers ───────────────────────────────────────────────────────

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeNumber(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function mapComboOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
  };
}

function mapLegalEntityOption(row) {
  const opt = mapComboOption(row);
  if (!opt) return null;
  opt.description = normalizeText(
    row?.functional_currency_code || row?.functionalCurrencyCode
  );
  return opt;
}

function mapCustodianOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.employeeCode || row?.employee_code);
  const name = normalizeText(row?.displayName || row?.display_name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
  };
}

const SALVAGE_RULE_TYPES = ["NONE", "FIXED_BASE_AMOUNT", "PERCENT_OF_COST"];

function createEmptyForm() {
  return {
    legalEntityId: "",
    name: "",
    description: "",
    assetTag: "",
    serialNo: "",
    categoryId: "",
    ownerOperatingUnitId: "",
    locationOperatingUnitId: "",
    departmentCode: "",
    costCenterCode: "",
    custodianEmployeeId: "",
    acquisitionDate: "",
    currencyCode: "",
    originalCostTxn: "",
    originalCostBase: "",
    depreciationProfileId: "",
    usefulLifeMonths: "",
    salvageRuleType: "NONE",
    salvagePercent: "",
    salvageAmountBaseRule: "",
    remainingUsefulLifeMonths: "",
    legacyAccumDeprTxn: "",
    legacyAccumDeprBase: "",
    legacyNbvTxn: "",
    legacyNbvBase: "",
    inServiceDate: "",
    legacyOnboardingStatus: "ACTIVE",
    legacySuspendEffectiveDate: "",
    // Account override fields
    assetAccountId: "",
    accumDeprAccountId: "",
    deprExpenseAccountId: "",
    disposalGainAccountId: "",
    disposalLossAccountId: "",
  };
}

function buildCreatePayload(form) {
  const payload = {
    legalEntityId: toPositiveInt(form.legalEntityId) || undefined,
    name: normalizeText(form.name),
    categoryId: toPositiveInt(form.categoryId) || undefined,
    acquisitionDate: normalizeText(form.acquisitionDate) || undefined,
    currencyCode: normalizeText(form.currencyCode).toUpperCase() || undefined,
    originalCostTxn: toNonNegativeNumber(form.originalCostTxn) ?? 0,
    originalCostBase: toNonNegativeNumber(form.originalCostBase) ?? 0,
  };

  // Optional string fields
  if (normalizeText(form.description)) payload.description = normalizeText(form.description);
  if (normalizeText(form.assetTag)) payload.assetTag = normalizeText(form.assetTag);
  if (normalizeText(form.serialNo)) payload.serialNo = normalizeText(form.serialNo);
  if (normalizeText(form.departmentCode)) payload.departmentCode = normalizeText(form.departmentCode);
  if (normalizeText(form.costCenterCode)) payload.costCenterCode = normalizeText(form.costCenterCode);

  // Optional integer fields
  const ownerOuId = toPositiveInt(form.ownerOperatingUnitId);
  if (ownerOuId) payload.ownerOperatingUnitId = ownerOuId;
  const locationOuId = toPositiveInt(form.locationOperatingUnitId);
  if (locationOuId) payload.locationOperatingUnitId = locationOuId;
  const custodianId = toPositiveInt(form.custodianEmployeeId);
  if (custodianId) payload.custodianEmployeeId = custodianId;
  const profileId = toPositiveInt(form.depreciationProfileId);
  if (profileId) payload.depreciationProfileId = profileId;
  const usefulLife = toPositiveInt(form.usefulLifeMonths);
  if (usefulLife) payload.usefulLifeMonths = usefulLife;

  // Salvage
  const salvageType = normalizeText(form.salvageRuleType).toUpperCase() || "NONE";
  if (salvageType !== "NONE") payload.salvageRuleType = salvageType;
  if (salvageType === "PERCENT_OF_COST") {
    const pct = toNonNegativeNumber(form.salvagePercent);
    if (pct != null) payload.salvagePercent = pct;
  }
  if (salvageType === "FIXED_BASE_AMOUNT") {
    const amt = toNonNegativeNumber(form.salvageAmountBaseRule);
    if (amt != null) payload.salvageAmountBaseRule = amt;
  }

  // Legacy fields
  const remainingLife = toNonNegativeNumber(form.remainingUsefulLifeMonths);
  if (remainingLife != null) payload.remainingUsefulLifeMonths = remainingLife;
  const legacyAccumTxn = toNonNegativeNumber(form.legacyAccumDeprTxn);
  if (legacyAccumTxn != null) payload.legacyAccumDeprTxn = legacyAccumTxn;
  const legacyAccumBase = toNonNegativeNumber(form.legacyAccumDeprBase);
  if (legacyAccumBase != null) payload.legacyAccumDeprBase = legacyAccumBase;
  const legacyNbvTxn = toNonNegativeNumber(form.legacyNbvTxn);
  if (legacyNbvTxn != null) payload.legacyNbvTxn = legacyNbvTxn;
  const legacyNbvBase = toNonNegativeNumber(form.legacyNbvBase);
  if (legacyNbvBase != null) payload.legacyNbvBase = legacyNbvBase;
  if (normalizeText(form.inServiceDate)) payload.inServiceDate = normalizeText(form.inServiceDate);

  return payload;
}

function validateForm(form, t) {
  const errors = {};
  if (!normalizeText(form.name)) errors.name = t(["fixedAssets", "createForm", "validationRequired"]);
  if (!toPositiveInt(form.categoryId)) errors.categoryId = t(["fixedAssets", "createForm", "validationRequired"]);
  if (!normalizeText(form.acquisitionDate)) errors.acquisitionDate = t(["fixedAssets", "createForm", "validationRequired"]);
  if (!normalizeText(form.currencyCode)) errors.currencyCode = t(["fixedAssets", "createForm", "validationRequired"]);
  if (!toPositiveInt(form.legalEntityId)) errors.legalEntityId = t(["fixedAssets", "createForm", "validationRequired"]);
  return errors;
}

// ── Components ────────────────────────────────────────────────────

function FormSection({ title, children, notice }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {notice ? <p className="mt-1 text-xs text-amber-700">{notice}</p> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-3">{children}</div>
    </section>
  );
}

function FormField({ label, error, children }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
      {label}
      {children}
      {error ? <p className="mt-0.5 text-xs font-normal normal-case text-rose-600">{error}</p> : null}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, error, disabled }) {
  return (
    <input
      type="text"
      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm font-normal ${
        error ? "border-rose-400" : "border-slate-300"
      }`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

function NumberInput({ value, onChange, placeholder, error, disabled, min = "0", step = "0.01" }) {
  return (
    <input
      type="number"
      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm font-normal font-mono ${
        error ? "border-rose-400" : "border-slate-300"
      }`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      min={min}
      step={step}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════

export default function FixedAssetFormPage() {
  const { l, t } = useI18n();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const { legalEntity } = useWorkingContext();

  const canUpsert = hasPermission("fixed_assets.upsert");
  const canPost = hasPermission("fixed_assets.post");
  const canOverrideAccounts = hasPermission("fixed_assets.account_override");

  const cf = (key) => t(["fixedAssets", "createForm", key]);

  // ── Form state ──────────────────────────────────────────────────
  const [form, setForm] = useState(createEmptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [createdAssetId, setCreatedAssetId] = useState(null);

  // ── Lookups ─────────────────────────────────────────────────────
  const [leOptions, setLeOptions] = useState([]);
  const [ouOptions, setOuOptions] = useState([]);
  const [catOptions, setCatOptions] = useState([]);
  const [catRows, setCatRows] = useState([]);
  const [profileOptions, setProfileOptions] = useState([]);
  const [custodianOptions, setCustodianOptions] = useState([]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev;
    });
  };

  // ── Sync working context LE ─────────────────────────────────────
  useEffect(() => {
    const ctxLeId = toPositiveInt(legalEntity?.id);
    if (ctxLeId && !form.legalEntityId) setField("legalEntityId", String(ctxLeId));
  }, [legalEntity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load legal entity lookup ────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listLegalEntities();
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setLeOptions(items.map(mapLegalEntityOption).filter(Boolean));
      } catch {
        if (active) setLeOptions([]);
      }
    })();
    return () => { active = false; };
  }, []);

  // ── Load OU lookup ──────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listOperatingUnits({ legalEntityId: form.legalEntityId || undefined });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setOuOptions(items.map(mapComboOption).filter(Boolean));
      } catch {
        if (active) setOuOptions([]);
      }
    })();
    return () => { active = false; };
  }, [form.legalEntityId]);

  // ── Load category lookup ────────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listFixedAssetCategories({
          legalEntityId: form.legalEntityId || undefined,
          status: "ACTIVE",
        });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) {
          setCatRows(items);
          setCatOptions(items.map(mapComboOption).filter(Boolean));
        }
      } catch {
        if (active) { setCatRows([]); setCatOptions([]); }
      }
    })();
    return () => { active = false; };
  }, [form.legalEntityId]);

  // ── Load depreciation profile lookup ────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listFixedAssetDepreciationProfiles({
          legalEntityId: form.legalEntityId || undefined,
          status: "ACTIVE",
        });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setProfileOptions(items.map(mapComboOption).filter(Boolean));
      } catch {
        if (active) setProfileOptions([]);
      }
    })();
    return () => { active = false; };
  }, [form.legalEntityId]);

  // ── Load custodian lookup ───────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listFixedAssetCustodians({
          legalEntityId: form.legalEntityId || undefined,
          status: "ACTIVE",
        });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setCustodianOptions(items.map(mapCustodianOption).filter(Boolean));
      } catch {
        if (active) setCustodianOptions([]);
      }
    })();
    return () => { active = false; };
  }, [form.legalEntityId]);

  // ── Category-driven defaults ────────────────────────────────────
  const selectedCategory = catRows.find((c) => String(c.id) === form.categoryId) || null;

  useEffect(() => {
    if (!selectedCategory) return;
    setForm((prev) => {
      const next = { ...prev };
      if (selectedCategory.defaultUsefulLifeMonths != null && !prev.usefulLifeMonths) {
        next.usefulLifeMonths = String(selectedCategory.defaultUsefulLifeMonths);
      }
      if (selectedCategory.defaultSalvageRuleType && prev.salvageRuleType === "NONE") {
        next.salvageRuleType = selectedCategory.defaultSalvageRuleType;
      }
      if (selectedCategory.defaultSalvagePercent != null && !prev.salvagePercent) {
        next.salvagePercent = String(selectedCategory.defaultSalvagePercent);
      }
      if (selectedCategory.defaultSalvageAmountBase != null && !prev.salvageAmountBaseRule) {
        next.salvageAmountBaseRule = String(selectedCategory.defaultSalvageAmountBase);
      }
      // If category has a paired depreciation profile, pre-fill it
      if (selectedCategory.defaultDepreciationProfileId && !prev.depreciationProfileId) {
        next.depreciationProfileId = String(selectedCategory.defaultDepreciationProfileId);
      }
      return next;
    });
  }, [selectedCategory]);

  // ── Low-value threshold indication ──────────────────────────────
  const capThreshold = selectedCategory?.capitalizationThresholdBase;
  const costBase = toNonNegativeNumber(form.originalCostBase);
  const isBelowThreshold = capThreshold != null && capThreshold > 0 && costBase != null && costBase < capThreshold;
  const hasLegacyOnboardingDraftValues = [
    form.legacyAccumDeprTxn,
    form.legacyAccumDeprBase,
    form.legacyNbvTxn,
    form.legacyNbvBase,
  ].some((value) => normalizeText(value) !== "");
  const isLegacySuspendActivation =
    hasLegacyOnboardingDraftValues
    && normalizeText(form.legacyOnboardingStatus).toUpperCase() === "SUSPENDED";

  // ── Handlers ────────────────────────────────────────────────────

  async function handleSaveDraft(e) {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    const validationErrors = validateForm(form, t);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaving(true);
    try {
      const payload = buildCreatePayload(form);
      const result = await createFixedAsset(payload);
      const newId = result?.id || result?.row?.id;
      if (newId) {
        setCreatedAssetId(newId);
        setFormSuccess(cf("createSuccess"));
        if (!canPost) {
          setTimeout(() => navigate(`/app/demirbas-karti-detayi/${newId}`), 800);
        }
      }
    } catch (err) {
      setFormError(normalizeApiError(err, cf("createFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (!createdAssetId || !canPost) return;
    if (isLegacySuspendActivation && !normalizeText(form.legacySuspendEffectiveDate)) {
      setFormError(
        l(
          "Suspend effective date is required when imported lifecycle status is Suspended.",
          "Ice aktarilan yasam dongusu durumu Askida iken aski gecerlilik tarihi zorunludur."
        )
      );
      return;
    }
    setFormError("");
    setFormSuccess("");
    setActivating(true);
    try {
      const activationPayload = {
        postingDate: normalizeText(form.acquisitionDate),
        capitalizationDate: normalizeText(form.acquisitionDate) || undefined,
        inServiceDate: normalizeText(form.inServiceDate) || undefined,
      };
      if (isLegacySuspendActivation) {
        activationPayload.legacyOnboardingStatus = "SUSPENDED";
        activationPayload.legacySuspendEffectiveDate = normalizeText(form.legacySuspendEffectiveDate);
      }
      await activateFixedAsset(createdAssetId, activationPayload);
      setFormSuccess(cf("activateSuccess"));
      setTimeout(() => navigate(`/app/demirbas-karti-detayi/${createdAssetId}`), 800);
    } catch (err) {
      setFormError(normalizeApiError(err, cf("activateFailed")));
    } finally {
      setActivating(false);
    }
  }

  // ── Permission guard ────────────────────────────────────────────
  if (!canUpsert) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {l("Missing permission: fixed_assets.upsert", "Eksik yetki: fixed_assets.upsert")}
        </p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSaveDraft} className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <Link to="/app/demirbas-karti-listesi" className="text-sm text-cyan-700 hover:underline">
              {cf("backToRegister")}
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{cf("title")}</h1>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !!createdAssetId}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-cyan-700 disabled:opacity-50"
            >
              {saving ? cf("saving") : cf("saveDraft")}
            </button>
            {canPost && createdAssetId ? (
              <button
                type="button"
                onClick={handleActivate}
                disabled={activating}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {activating ? cf("activating") : cf("activateAsset")}
              </button>
            ) : null}
          </div>
        </div>
        {formError ? <p className="mt-2 text-sm text-rose-700">{formError}</p> : null}
        {formSuccess ? <p className="mt-2 text-sm text-emerald-700">{formSuccess}</p> : null}
        {isBelowThreshold ? (
          <p className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            {cf("lowValueNotice")}
          </p>
        ) : null}
      </section>

      {/* Identity */}
      <FormSection title={cf("sectionIdentity")}>
        <FormField label={cf("fieldName")} error={errors.name}>
          <TextInput value={form.name} onChange={(v) => setField("name", v)} error={errors.name} disabled={!!createdAssetId} />
        </FormField>
        <FormField label={cf("fieldCategory")} error={errors.categoryId}>
          <Combobox
            className="mt-1"
            value={form.categoryId}
            options={catOptions}
            placeholder={l("Select", "Secin")}
            noOptionsText={l("None", "Yok")}
            onChange={(v) => setField("categoryId", v ? String(v) : "")}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldLegalEntity")} error={errors.legalEntityId}>
          <Combobox
            className="mt-1"
            value={form.legalEntityId}
            options={leOptions}
            placeholder={l("Select", "Secin")}
            noOptionsText={l("None", "Yok")}
            onChange={(v) => setField("legalEntityId", v ? String(v) : "")}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldDescription")}>
          <TextInput value={form.description} onChange={(v) => setField("description", v)} disabled={!!createdAssetId} />
        </FormField>
        <FormField label={cf("fieldAssetTag")}>
          <TextInput value={form.assetTag} onChange={(v) => setField("assetTag", v)} disabled={!!createdAssetId} />
        </FormField>
        <FormField label={cf("fieldSerialNo")}>
          <TextInput value={form.serialNo} onChange={(v) => setField("serialNo", v)} disabled={!!createdAssetId} />
        </FormField>
      </FormSection>

      {/* Organization */}
      <FormSection title={cf("sectionOrganization")}>
        <FormField label={cf("fieldOwnerOu")}>
          <Combobox
            className="mt-1"
            value={form.ownerOperatingUnitId}
            options={ouOptions}
            placeholder={l("Select", "Secin")}
            noOptionsText={l("None", "Yok")}
            onChange={(v) => setField("ownerOperatingUnitId", v ? String(v) : "")}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldLocationOu")}>
          <Combobox
            className="mt-1"
            value={form.locationOperatingUnitId}
            options={ouOptions}
            placeholder={l("Select", "Secin")}
            noOptionsText={l("None", "Yok")}
            onChange={(v) => setField("locationOperatingUnitId", v ? String(v) : "")}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldCustodian")}>
          <Combobox
            className="mt-1"
            value={form.custodianEmployeeId}
            options={custodianOptions}
            placeholder={l("Select", "Secin")}
            noOptionsText={l("None", "Yok")}
            onChange={(v) => setField("custodianEmployeeId", v ? String(v) : "")}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldDepartmentCode")}>
          <TextInput value={form.departmentCode} onChange={(v) => setField("departmentCode", v)} disabled={!!createdAssetId} />
        </FormField>
        <FormField label={cf("fieldCostCenterCode")}>
          <TextInput value={form.costCenterCode} onChange={(v) => setField("costCenterCode", v)} disabled={!!createdAssetId} />
        </FormField>
      </FormSection>

      {/* Cost and Currency */}
      <FormSection title={cf("sectionCost")}>
        <FormField label={cf("fieldAcquisitionDate")} error={errors.acquisitionDate}>
          <input
            type="date"
            className={`mt-1 w-full rounded-md border px-3 py-2 text-sm font-normal ${errors.acquisitionDate ? "border-rose-400" : "border-slate-300"}`}
            value={form.acquisitionDate}
            onChange={(e) => setField("acquisitionDate", e.target.value)}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldCurrencyCode")} error={errors.currencyCode}>
          <TextInput
            value={form.currencyCode}
            onChange={(v) => setField("currencyCode", v)}
            placeholder="TRY"
            error={errors.currencyCode}
            disabled={!!createdAssetId}
          />
        </FormField>
        <div /> {/* spacer */}
        <FormField label={cf("fieldOriginalCostTxn")}>
          <NumberInput value={form.originalCostTxn} onChange={(v) => setField("originalCostTxn", v)} disabled={!!createdAssetId} />
        </FormField>
        <FormField label={cf("fieldOriginalCostBase")}>
          <NumberInput value={form.originalCostBase} onChange={(v) => setField("originalCostBase", v)} disabled={!!createdAssetId} />
        </FormField>
      </FormSection>

      {/* Depreciation Settings */}
      <FormSection title={cf("sectionDepreciation")}>
        <FormField label={cf("fieldDepreciationProfile")}>
          <Combobox
            className="mt-1"
            value={form.depreciationProfileId}
            options={profileOptions}
            placeholder={l("Select", "Secin")}
            noOptionsText={l("None", "Yok")}
            onChange={(v) => setField("depreciationProfileId", v ? String(v) : "")}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldUsefulLifeMonths")}>
          <NumberInput
            value={form.usefulLifeMonths}
            onChange={(v) => setField("usefulLifeMonths", v)}
            step="1"
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldSalvageRuleType")}>
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            value={form.salvageRuleType}
            onChange={(e) => setField("salvageRuleType", e.target.value)}
            disabled={!!createdAssetId}
          >
            {SALVAGE_RULE_TYPES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </FormField>
        {form.salvageRuleType === "PERCENT_OF_COST" ? (
          <FormField label={cf("fieldSalvagePercent")}>
            <NumberInput
              value={form.salvagePercent}
              onChange={(v) => setField("salvagePercent", v)}
              step="0.01"
              disabled={!!createdAssetId}
            />
          </FormField>
        ) : null}
        {form.salvageRuleType === "FIXED_BASE_AMOUNT" ? (
          <FormField label={cf("fieldSalvageAmountBase")}>
            <NumberInput
              value={form.salvageAmountBaseRule}
              onChange={(v) => setField("salvageAmountBaseRule", v)}
              disabled={!!createdAssetId}
            />
          </FormField>
        ) : null}
      </FormSection>

      {/* Legacy Onboarding */}
      <FormSection
        title={cf("sectionLegacy")}
        notice={cf("legacyNotice")}
      >
        <FormField label={cf("fieldInServiceDate")}>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
            value={form.inServiceDate}
            onChange={(e) => setField("inServiceDate", e.target.value)}
            disabled={!!createdAssetId}
          />
        </FormField>
        <FormField label={cf("fieldRemainingUsefulLifeMonths")}>
          <NumberInput
            value={form.remainingUsefulLifeMonths}
            onChange={(v) => setField("remainingUsefulLifeMonths", v)}
            step="1"
            disabled={!!createdAssetId}
          />
        </FormField>
        <div /> {/* spacer */}
        <FormField label={cf("fieldLegacyAccumDeprTxn")}>
          <NumberInput value={form.legacyAccumDeprTxn} onChange={(v) => setField("legacyAccumDeprTxn", v)} disabled={!!createdAssetId} />
        </FormField>
        <FormField label={cf("fieldLegacyAccumDeprBase")}>
          <NumberInput value={form.legacyAccumDeprBase} onChange={(v) => setField("legacyAccumDeprBase", v)} disabled={!!createdAssetId} />
        </FormField>
        <div /> {/* spacer */}
        <FormField label={cf("fieldLegacyNbvTxn")}>
          <NumberInput value={form.legacyNbvTxn} onChange={(v) => setField("legacyNbvTxn", v)} disabled={!!createdAssetId} />
        </FormField>
        <FormField label={cf("fieldLegacyNbvBase")}>
          <NumberInput value={form.legacyNbvBase} onChange={(v) => setField("legacyNbvBase", v)} disabled={!!createdAssetId} />
        </FormField>
      </FormSection>

      {/* Account Override (separately gated) */}
      {canOverrideAccounts ? (
        <FormSection
          title={cf("sectionAccounts")}
          notice={cf("accountOverrideNotice")}
        >
          <FormField label={cf("fieldAssetAccount")}>
            <TextInput value={form.assetAccountId} onChange={(v) => setField("assetAccountId", v)} disabled={!!createdAssetId} />
          </FormField>
          <FormField label={cf("fieldAccumDeprAccount")}>
            <TextInput value={form.accumDeprAccountId} onChange={(v) => setField("accumDeprAccountId", v)} disabled={!!createdAssetId} />
          </FormField>
          <FormField label={cf("fieldDeprExpenseAccount")}>
            <TextInput value={form.deprExpenseAccountId} onChange={(v) => setField("deprExpenseAccountId", v)} disabled={!!createdAssetId} />
          </FormField>
          <FormField label={cf("fieldDisposalGainAccount")}>
            <TextInput value={form.disposalGainAccountId} onChange={(v) => setField("disposalGainAccountId", v)} disabled={!!createdAssetId} />
          </FormField>
          <FormField label={cf("fieldDisposalLossAccount")}>
            <TextInput value={form.disposalLossAccountId} onChange={(v) => setField("disposalLossAccountId", v)} disabled={!!createdAssetId} />
          </FormField>
        </FormSection>
      ) : null}

      {/* Bottom action bar */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {canPost && createdAssetId && hasLegacyOnboardingDraftValues ? (
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <FormField label={l("Imported Lifecycle Status", "Ice Aktarilan Yasam Dongusu Durumu")}>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={form.legacyOnboardingStatus}
                onChange={(e) => setField("legacyOnboardingStatus", e.target.value)}
                disabled={activating}
              >
                <option value="ACTIVE">{l("Active", "Aktif")}</option>
                <option value="SUSPENDED">{l("Suspended", "Askida")}</option>
              </select>
            </FormField>
            {isLegacySuspendActivation ? (
              <FormField label={l("Suspend Effective Date", "Aski Gecerlilik Tarihi")}>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={form.legacySuspendEffectiveDate}
                  onChange={(e) => setField("legacySuspendEffectiveDate", e.target.value)}
                  disabled={activating}
                />
              </FormField>
            ) : (
              <div />
            )}
            <p className="md:col-span-2 text-xs text-amber-700">
              {l(
                "These legacy lifecycle options are used only during activation and are not saved on the draft.",
                "Bu eski yasam dongusu secenekleri yalnizca aktiflestirme sirasinda kullanilir ve taslakta saklanmaz."
              )}
            </p>
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <Link to="/app/demirbas-karti-listesi" className="text-sm text-cyan-700 hover:underline">
            {cf("backToRegister")}
          </Link>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !!createdAssetId}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-cyan-700 disabled:opacity-50"
            >
              {saving ? cf("saving") : cf("saveDraft")}
            </button>
            {canPost && createdAssetId ? (
              <button
                type="button"
                onClick={handleActivate}
                disabled={activating}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {activating ? cf("activating") : cf("activateAsset")}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </form>
  );
}
