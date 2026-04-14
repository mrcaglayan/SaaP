import { useEffect, useMemo, useState } from "react";
import Combobox from "../../components/Combobox.jsx";
import InlineChildAccountCreatePanel from "../../components/InlineChildAccountCreatePanel.jsx";
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
import { listAccounts } from "../../api/glAdmin.js";
import { listLegalEntities } from "../../api/orgAdmin.js";
import {
  buildInlineParentAccountOptions,
  buildNextInlineChildCode,
  deriveSearchCodeCandidate,
  findBestParentAccount,
  findExactInlineCodeMatch,
  normalizeAccountCode,
  runInlineChildAccountCreate,
} from "../../utils/glInlineChildAccounts.js";
import { maybePromptParentBalanceTransferAfterChildCreate } from "../../utils/glInlineBalanceTransfer.js";

const STATUS_VALUES = ["ACTIVE", "INACTIVE"];
const SALVAGE_RULE_TYPES = ["NONE", "FIXED_BASE_AMOUNT", "PERCENT_OF_COST"];
const DEPRECIATION_METHODS = ["STRAIGHT_LINE", "DECLINING_BALANCE", "NONE"];
const CATEGORY_ACCOUNT_INLINE_FIELD_SPECS = {
  defaultAssetAccountId: { accountType: "ASSET", fallbackNormalSide: "DEBIT" },
  defaultAccumDeprAccountId: { accountType: "ASSET", fallbackNormalSide: "CREDIT" },
  defaultDeprExpenseAccountId: { accountType: "EXPENSE", fallbackNormalSide: "DEBIT" },
  defaultDisposalGainAccountId: { accountType: "REVENUE", fallbackNormalSide: "CREDIT" },
  defaultDisposalLossAccountId: { accountType: "EXPENSE", fallbackNormalSide: "DEBIT" },
};

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

function mapDepreciationProfileOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
    description: [normalizeText(row?.method), normalizeText(row?.status)]
      .filter(Boolean)
      .join(" | "),
  };
}

function mapAccountRows(response) {
  if (!Array.isArray(response?.rows)) {
    return [];
  }
  return response.rows.map((row) => ({
    id: Number(row?.id || 0),
    coaId: Number(row?.coa_id || row?.coaId || 0) || null,
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    accountType: String(row?.account_type || row?.accountType || "").toUpperCase(),
    normalSide: String(row?.normal_side || row?.normalSide || "").toUpperCase(),
    allowPosting: Boolean(row?.allow_posting ?? row?.allowPosting),
    isActive: Boolean(row?.is_active ?? row?.isActive),
    parentAccountId:
      Number(row?.parent_account_id || row?.parentAccountId || 0) || null,
  }));
}

function mapAccountOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  const descriptionParts = [normalizeText(row?.accountType)];
  if (row?.isActive === false) {
    descriptionParts.push("INACTIVE");
  }
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
    description: descriptionParts.filter(Boolean).join(" | "),
  };
}

function filterAccountRowsByType(rows, expectedType) {
  const normalizedType = normalizeText(expectedType).toUpperCase();
  return (Array.isArray(rows) ? rows : []).filter(
    (row) =>
      row?.allowPosting &&
      normalizeText(row?.accountType).toUpperCase() === normalizedType
  );
}

function createInlineAccountCreateDraft() {
  return {
    lookupQuery: "",
    parentAccountId: "",
    childCode: "",
    childName: "",
    saving: false,
    error: "",
    message: "",
  };
}

function createCategoryInlineAccountCreateState() {
  return Object.fromEntries(
    Object.keys(CATEGORY_ACCOUNT_INLINE_FIELD_SPECS).map((fieldName) => [
      fieldName,
      createInlineAccountCreateDraft(),
    ])
  );
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
    defaultDepreciationProfileId: "",
    defaultAssetAccountId: "",
    defaultAccumDeprAccountId: "",
    defaultDeprExpenseAccountId: "",
    defaultDisposalGainAccountId: "",
    defaultDisposalLossAccountId: "",
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
    defaultDepreciationProfileId:
      row?.defaultDepreciationProfileId != null
        ? String(row.defaultDepreciationProfileId)
        : "",
    defaultAssetAccountId:
      row?.defaultAssetAccountId != null
        ? String(row.defaultAssetAccountId)
        : "",
    defaultAccumDeprAccountId:
      row?.defaultAccumDeprAccountId != null
        ? String(row.defaultAccumDeprAccountId)
        : "",
    defaultDeprExpenseAccountId:
      row?.defaultDeprExpenseAccountId != null
        ? String(row.defaultDeprExpenseAccountId)
        : "",
    defaultDisposalGainAccountId:
      row?.defaultDisposalGainAccountId != null
        ? String(row.defaultDisposalGainAccountId)
        : "",
    defaultDisposalLossAccountId:
      row?.defaultDisposalLossAccountId != null
        ? String(row.defaultDisposalLossAccountId)
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
    defaultDepreciationProfileId: toPositiveInt(form.defaultDepreciationProfileId),
    defaultAssetAccountId: toPositiveInt(form.defaultAssetAccountId),
    defaultAccumDeprAccountId: toPositiveInt(form.defaultAccumDeprAccountId),
    defaultDeprExpenseAccountId: toPositiveInt(form.defaultDeprExpenseAccountId),
    defaultDisposalGainAccountId: toPositiveInt(form.defaultDisposalGainAccountId),
    defaultDisposalLossAccountId: toPositiveInt(form.defaultDisposalLossAccountId),
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

function buildDisplayLabel(code, name, fallbackId) {
  const normalizedCode = normalizeText(code);
  const normalizedName = normalizeText(name);
  if (normalizedCode && normalizedName) {
    return `${normalizedCode} - ${normalizedName}`;
  }
  return normalizedCode || normalizedName || (fallbackId ? `#${fallbackId}` : "-");
}

function formatSalvageRuleSummary(row) {
  const ruleType = normalizeText(row?.defaultSalvageRuleType).toUpperCase() || "NONE";
  if (ruleType === "PERCENT_OF_COST") {
    return row?.defaultSalvagePercent != null
      ? `${ruleType} (${row.defaultSalvagePercent}%)`
      : ruleType;
  }
  if (ruleType === "FIXED_BASE_AMOUNT") {
    return row?.defaultSalvageAmountBase != null
      ? `${ruleType} (${row.defaultSalvageAmountBase})`
      : ruleType;
  }
  return ruleType;
}

function summarizeCategoryAccountingSetup(row) {
  const fieldIds = [
    toPositiveInt(row?.defaultDepreciationProfileId),
    toPositiveInt(row?.defaultAssetAccountId),
    toPositiveInt(row?.defaultAccumDeprAccountId),
    toPositiveInt(row?.defaultDeprExpenseAccountId),
    toPositiveInt(row?.defaultDisposalGainAccountId),
    toPositiveInt(row?.defaultDisposalLossAccountId),
  ];
  const configuredCount = fieldIds.filter(Boolean).length;
  const totalCount = fieldIds.length;
  if (!toPositiveInt(row?.defaultAssetAccountId)) {
    return {
      tone: "rose",
      label: "Missing default asset account",
      description: "Default Asset Account is required before CARI Auto-Create can use this category.",
      configuredCount,
      totalCount,
    };
  }
  if (configuredCount < totalCount) {
    return {
      tone: "amber",
      label: "Partial accounting setup",
      description: "Some default accounting fields are still not configured.",
      configuredCount,
      totalCount,
    };
  }
  return {
    tone: "emerald",
    label: "Ready",
    description: "All tracked default accounting fields are configured.",
    configuredCount,
    totalCount,
  };
}

function resolveReferenceDisplay(id, rowsById) {
  const normalizedId = toPositiveInt(id);
  if (!normalizedId) {
    return null;
  }
  const row = rowsById instanceof Map ? rowsById.get(normalizedId) : null;
  if (!row) {
    return `#${normalizedId}`;
  }
  return buildDisplayLabel(row.code, row.name, normalizedId);
}

function CategoryDetailsModal({
  l,
  row,
  accountRowsById,
  profileRowsById,
  loading,
  error,
  canUpsertSettings,
  onClose,
  onEdit,
}) {
  if (!row) {
    return null;
  }

  const readiness = summarizeCategoryAccountingSetup(row);
  const readinessLabel =
    readiness.tone === "emerald"
      ? l("Ready", "Hazir")
      : readiness.tone === "amber"
        ? l("Partial accounting setup", "Kismi muhasebe kurulumu")
        : l("Missing default asset account", "Varsayilan varlik hesabi eksik");
  const readinessDescription =
    readiness.tone === "emerald"
      ? l(
          "All tracked default accounting fields are configured.",
          "Takip edilen varsayilan muhasebe alanlarinin tamami tanimlanmis."
        )
      : readiness.tone === "amber"
        ? l(
            "Some default accounting fields are still not configured.",
            "Bazi varsayilan muhasebe alanlari halen tanimlanmamis."
          )
        : l(
            "Default Asset Account is required before CARI Auto-Create can use this category.",
            "CARI Otomatik Olustur bu kategoriyi kullanmadan once Varsayilan Varlik Hesabi tanimlanmalidir."
          );
  const toneClasses =
    readiness.tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : readiness.tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-rose-200 bg-rose-50 text-rose-700";

  const detailRows = [
    {
      label: l("Code", "Kod"),
      value: row.code || "-",
    },
    {
      label: l("Name", "Ad"),
      value: row.name || "-",
    },
    {
      label: l("Status", "Durum"),
      value: row.status || "-",
    },
    {
      label: l("Capitalization Threshold", "Aktiflestirme Esigi"),
      value:
        row.capitalizationThresholdBase != null
          ? String(row.capitalizationThresholdBase)
          : "-",
    },
    {
      label: l("Default Useful Life (months)", "Varsayilan Faydali Omur (ay)"),
      value:
        row.defaultUsefulLifeMonths != null
          ? String(row.defaultUsefulLifeMonths)
          : "-",
    },
    {
      label: l("Salvage Rule", "Hurda Kural"),
      value: formatSalvageRuleSummary(row),
    },
    {
      label: l("Default Depreciation Profile", "Varsayilan Amortisman Profili"),
      value:
        resolveReferenceDisplay(row.defaultDepreciationProfileId, profileRowsById) || "-",
    },
    {
      label: l("Default Asset Account", "Varsayilan Varlik Hesabi"),
      value:
        resolveReferenceDisplay(row.defaultAssetAccountId, accountRowsById)
        || l("Missing", "Eksik"),
    },
    {
      label: l(
        "Default Accumulated Depreciation Account",
        "Varsayilan Birikmis Amortisman Hesabi"
      ),
      value:
        resolveReferenceDisplay(row.defaultAccumDeprAccountId, accountRowsById) || "-",
    },
    {
      label: l(
        "Default Depreciation Expense Account",
        "Varsayilan Amortisman Gider Hesabi"
      ),
      value:
        resolveReferenceDisplay(row.defaultDeprExpenseAccountId, accountRowsById) || "-",
    },
    {
      label: l("Default Disposal Gain Account", "Varsayilan Elden Cikarma Kar Hesabi"),
      value:
        resolveReferenceDisplay(row.defaultDisposalGainAccountId, accountRowsById) || "-",
    },
    {
      label: l("Default Disposal Loss Account", "Varsayilan Elden Cikarma Zarar Hesabi"),
      value:
        resolveReferenceDisplay(row.defaultDisposalLossAccountId, accountRowsById) || "-",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
      <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Category Details", "Kategori Detaylari")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {buildDisplayLabel(row.code, row.name, row.id)}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            onClick={onClose}
          >
            {l("Close", "Kapat")}
          </button>
        </div>

        <div className={`mt-4 rounded-lg border px-4 py-3 ${toneClasses}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{readinessLabel}</p>
            <span className="text-xs font-semibold">
              {readiness.configuredCount}/{readiness.totalCount}
            </span>
          </div>
          <p className="mt-1 text-sm">{readinessDescription}</p>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="mt-4 text-sm text-slate-600">
            {l("Loading related profile/account labels...", "Ilgili profil/hesap etiketleri yukleniyor...")}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {detailRows.map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {item.label}
              </p>
              <p className="mt-1 text-sm text-slate-900">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {canUpsertSettings ? (
            <button
              type="button"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={onEdit}
            >
              {l("Edit Category", "Kategoriyi Duzenle")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════

export default function FixedAssetSettingsPage() {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const {
    workingContext,
    legalEntities: workingContextLegalEntities,
    loading: workingContextLoading,
  } = useWorkingContext();
  const workingLegalEntityId = toPositiveInt(workingContext?.legalEntityId);
  const workingOperatingUnitId = toPositiveInt(workingContext?.operatingUnitId);

  const canReadSettings = hasPermission("fixed_assets.settings.read");
  const canUpsertSettings = hasPermission("fixed_assets.settings.upsert");
  const canUpsertGlAccounts = hasPermission("gl.account.upsert");
  const canCreateJournals = hasPermission("gl.journal.create");
  const canPostJournals = hasPermission("gl.journal.post");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadFiscalPeriods = hasPermission("org.fiscal_period.read");
  const canReadTrialBalance = hasPermission("gl.trial_balance.read");

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
  useEffect(() => {
    if (!workingLegalEntityId) {
      return;
    }
    setFilterLeId((currentValue) => currentValue || String(workingLegalEntityId));
  }, [workingLegalEntityId]);

  // ── Category state ──────────────────────────────────────────────
  const [catRows, setCatRows] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState("");
  const [catSelected, setCatSelected] = useState(null);
  const [catForm, setCatForm] = useState(createCategoryForm);
  const [catSaving, setCatSaving] = useState(false);
  const [catFormError, setCatFormError] = useState("");
  const [catFormMsg, setCatFormMsg] = useState("");
  const [catDetailRow, setCatDetailRow] = useState(null);
  const [catDetailAccounts, setCatDetailAccounts] = useState([]);
  const [catDetailProfiles, setCatDetailProfiles] = useState([]);
  const [catDetailLoading, setCatDetailLoading] = useState(false);
  const [catDetailError, setCatDetailError] = useState("");
  const [catProfileOptions, setCatProfileOptions] = useState([]);
  const [catProfileLoading, setCatProfileLoading] = useState(false);
  const [catProfileError, setCatProfileError] = useState("");
  const [catAccountRows, setCatAccountRows] = useState([]);
  const [catAccountLoading, setCatAccountLoading] = useState(false);
  const [catAccountError, setCatAccountError] = useState("");
  const [catAccountRefreshToken, setCatAccountRefreshToken] = useState(0);
  const [catInlineAccountCreate, setCatInlineAccountCreate] = useState(
    createCategoryInlineAccountCreateState
  );

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
          ownerOperatingUnitId: workingOperatingUnitId || undefined,
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
  }, [canReadSettings, filterLeId, workingOperatingUnitId, l]);

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
          ownerOperatingUnitId: workingOperatingUnitId || undefined,
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
  }, [canReadSettings, filterLeId, workingOperatingUnitId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(catForm.legalEntityId);
    if (!canReadSettings || !legalEntityId) {
      setCatProfileOptions([]);
      setCatProfileError("");
      setCatProfileLoading(false);
      return;
    }
    if (activeTab !== "categories") {
      setCatProfileLoading(false);
      return;
    }
    let active = true;
    (async () => {
      setCatProfileLoading(true);
      setCatProfileError("");
      try {
        const response = await listFixedAssetDepreciationProfiles({
          legalEntityId,
          ownerOperatingUnitId: workingOperatingUnitId || undefined,
        });
        const items = Array.isArray(response?.rows) ? response.rows : [];
        if (active) {
          setCatProfileOptions(items.map(mapDepreciationProfileOption).filter(Boolean));
        }
      } catch (err) {
        if (active) {
          setCatProfileOptions([]);
          setCatProfileError(
            normalizeApiError(
              err,
              l(
                "Failed to load depreciation profile options.",
                "Amortisman profili secenekleri yuklenemedi."
              )
            )
          );
        }
      } finally {
        if (active) {
          setCatProfileLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [activeTab, canReadSettings, catForm.legalEntityId, workingOperatingUnitId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(catDetailRow?.legalEntityId);
    if (!catDetailRow || !canReadSettings || !legalEntityId) {
      setCatDetailAccounts([]);
      setCatDetailProfiles([]);
      setCatDetailError("");
      setCatDetailLoading(false);
      return;
    }
    let active = true;
    (async () => {
      setCatDetailLoading(true);
      setCatDetailError("");
      try {
        const [profileResponse, accountResponse] = await Promise.all([
          listFixedAssetDepreciationProfiles({
            legalEntityId,
            ownerOperatingUnitId: workingOperatingUnitId || undefined,
          }),
          listAccounts({
            legalEntityId,
            includeInactive: true,
            limit: 1000,
          }),
        ]);
        if (active) {
          setCatDetailProfiles(
            Array.isArray(profileResponse?.rows) ? profileResponse.rows : []
          );
          setCatDetailAccounts(mapAccountRows(accountResponse));
        }
      } catch (err) {
        if (active) {
          setCatDetailProfiles([]);
          setCatDetailAccounts([]);
          setCatDetailError(
            normalizeApiError(
              err,
              l(
                "Failed to load category detail references.",
                "Kategori detay referanslari yuklenemedi."
              )
            )
          );
        }
      } finally {
        if (active) {
          setCatDetailLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [canReadSettings, catDetailRow, workingOperatingUnitId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(catForm.legalEntityId);
    if (!canReadSettings || !legalEntityId) {
      setCatAccountRows([]);
      setCatAccountError("");
      setCatAccountLoading(false);
      return;
    }
    if (activeTab !== "categories") {
      setCatAccountLoading(false);
      return;
    }
    let active = true;
    (async () => {
      setCatAccountLoading(true);
      setCatAccountError("");
      try {
        const response = await listAccounts({
          legalEntityId,
          includeInactive: true,
          limit: 1000,
        });
        if (active) {
          setCatAccountRows(mapAccountRows(response));
        }
      } catch (err) {
        if (active) {
          setCatAccountRows([]);
          setCatAccountError(
            normalizeApiError(
              err,
              l(
                "Failed to load account options for selected legal entity.",
                "Secili tuzel kisilik icin hesap secenekleri yuklenemedi."
              )
            )
          );
        }
      } finally {
        if (active) {
          setCatAccountLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [activeTab, canReadSettings, catForm.legalEntityId, catAccountRefreshToken, l]);

  useEffect(() => {
    if (!canReadSettings) {
      return undefined;
    }
    const requestRefresh = () => {
      setCatAccountRefreshToken((current) => current + 1);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestRefresh();
      }
    };
    window.addEventListener("focus", requestRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", requestRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [canReadSettings]);

  const catAssetAccountOptions = useMemo(
    () => filterAccountRowsByType(catAccountRows, "ASSET").map(mapAccountOption).filter(Boolean),
    [catAccountRows]
  );
  const catExpenseAccountOptions = useMemo(
    () => filterAccountRowsByType(catAccountRows, "EXPENSE").map(mapAccountOption).filter(Boolean),
    [catAccountRows]
  );
  const catRevenueAccountOptions = useMemo(
    () => filterAccountRowsByType(catAccountRows, "REVENUE").map(mapAccountOption).filter(Boolean),
    [catAccountRows]
  );
  const catInlineAccountMetaByField = useMemo(() => {
    const next = {};
    const canResolveInlineAccount =
      Boolean(toPositiveInt(catForm.legalEntityId)) && !catAccountLoading;
    for (const [fieldName, spec] of Object.entries(
      CATEGORY_ACCOUNT_INLINE_FIELD_SPECS
    )) {
      const inlineState =
        catInlineAccountCreate[fieldName] || createInlineAccountCreateDraft();
      const lookupQuery = normalizeText(inlineState.lookupQuery);
      const codeCandidate = deriveSearchCodeCandidate(lookupQuery);
      const parentRows = buildInlineParentAccountOptions(
        catAccountRows,
        spec.accountType
      );
      const exactMatch =
        codeCandidate &&
        canResolveInlineAccount &&
        findExactInlineCodeMatch(catAccountRows, codeCandidate, spec.accountType);
      const selectedParent =
        parentRows.find(
          (row) =>
            toPositiveInt(row?.id) === toPositiveInt(inlineState.parentAccountId)
        ) || null;
      const bestParent =
        findBestParentAccount(
          normalizeAccountCode(inlineState.childCode || codeCandidate),
          parentRows
        ) ||
        parentRows.find((row) => !toPositiveInt(row?.parentAccountId)) ||
        parentRows[0] ||
        null;
      const effectiveParent = selectedParent || bestParent || null;
      const suggestedNextCode = buildNextInlineChildCode(
        catAccountRows,
        effectiveParent
      );
      next[fieldName] = {
        spec,
        inlineState,
        lookupQuery,
        codeCandidate,
        exactMatch,
        parentLookupOptions: parentRows.map(mapAccountOption).filter(Boolean),
        effectiveParentId: toPositiveInt(effectiveParent?.id)
          ? String(effectiveParent.id)
          : "",
        effectiveChildCode:
          normalizeText(inlineState.childCode) ||
          suggestedNextCode ||
          codeCandidate,
        effectiveChildName: normalizeText(inlineState.childName) || lookupQuery,
        suggestedNextCode,
        showPanel:
          canResolveInlineAccount &&
          Boolean(lookupQuery) &&
          !(Boolean(codeCandidate) && Boolean(exactMatch)),
      };
    }
    return next;
  }, [catAccountLoading, catAccountRows, catForm.legalEntityId, catInlineAccountCreate]);
  const catDetailAccountRowsById = useMemo(
    () =>
      new Map(
        (Array.isArray(catDetailAccounts) ? catDetailAccounts : [])
          .map((row) => [Number(row?.id || 0), row])
          .filter(([id]) => id > 0)
      ),
    [catDetailAccounts]
  );
  const catDetailProfileRowsById = useMemo(
    () =>
      new Map(
        (Array.isArray(catDetailProfiles) ? catDetailProfiles : [])
          .map((row) => [Number(row?.id || 0), row])
          .filter(([id]) => id > 0)
      ),
    [catDetailProfiles]
  );

  // ── Category handlers ──────────────────────────────────────────
  function updateCatInlineAccountCreate(fieldName, patch) {
    setCatInlineAccountCreate((current) => ({
      ...current,
      [fieldName]: {
        ...(current[fieldName] || createInlineAccountCreateDraft()),
        ...patch,
      },
    }));
  }

  function resetCatInlineAccountCreate(fieldName, patch = {}) {
    setCatInlineAccountCreate((current) => ({
      ...current,
      [fieldName]: {
        ...createInlineAccountCreateDraft(),
        ...patch,
      },
    }));
  }

  function handleCatAccountLookupInput(fieldName, nextValue, meta = {}) {
    const reason = normalizeText(meta?.reason).toLowerCase();
    if (reason === "select" || reason === "clear") {
      resetCatInlineAccountCreate(fieldName);
      return;
    }
    const normalizedLookup = normalizeText(nextValue);
    updateCatInlineAccountCreate(fieldName, {
      lookupQuery: normalizedLookup,
      parentAccountId: "",
      childCode: "",
      childName: normalizedLookup,
      saving: false,
      error: "",
      message: "",
    });
  }

  async function handleCatInlineAccountCreate(fieldName) {
    const meta = catInlineAccountMetaByField[fieldName];
    const spec = CATEGORY_ACCOUNT_INLINE_FIELD_SPECS[fieldName];
    if (!meta || !spec) {
      return;
    }
    updateCatInlineAccountCreate(fieldName, {
      saving: true,
      error: "",
      message: "",
    });
    try {
      const result = await runInlineChildAccountCreate({
        legalEntityId: catForm.legalEntityId,
        lookupName: meta.lookupQuery,
        parentAccountIdValue:
          meta.inlineState.parentAccountId || meta.effectiveParentId,
        childCodeValue: meta.effectiveChildCode,
        childNameValue: meta.effectiveChildName,
        accountType: spec.accountType,
        fallbackNormalSide: spec.fallbackNormalSide,
        l,
      });
      setCatAccountRows(Array.isArray(result?.accountRows) ? result.accountRows : []);
      setCatForm((current) => ({
        ...current,
        [fieldName]: result?.accountId ? String(result.accountId) : "",
      }));
      const transferOutcome =
        result?.mode === "created"
          ? await maybePromptParentBalanceTransferAfterChildCreate({
              l,
              legalEntityId: catForm.legalEntityId,
              parentAccount: result?.parentAccount,
              childAccountId: result?.accountId,
              childCode: result?.accountRow?.code || result?.code || meta.effectiveChildCode,
              childName: result?.accountRow?.name || meta.effectiveChildName,
              accountPool: result?.accountRows,
              canCreateJournals,
              canPostJournals,
              canReadBooks,
              canReadFiscalPeriods,
              canReadTrialBalance,
            })
          : null;
      const accountLabel = [
        result?.accountRow?.code || result?.code || "",
        result?.accountRow?.name || meta.effectiveChildName,
      ]
        .filter(Boolean)
        .join(" - ");
      resetCatInlineAccountCreate(fieldName, {
        message: [
          result?.mode === "existing"
            ? l(
                `Existing account selected: ${accountLabel}`,
                `Mevcut hesap secildi: ${accountLabel}`
              )
            : l(
                `Child account created: ${accountLabel}`,
                `Child hesap olusturuldu: ${accountLabel}`
              ),
          transferOutcome?.message || "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (err) {
      updateCatInlineAccountCreate(fieldName, {
        saving: false,
        error: normalizeApiError(
          err,
          l(
            "Failed to create child account.",
            "Child hesap olusturulamadi."
          )
        ),
        message: "",
      });
    }
  }

  function renderCatInlineAccountField({
    fieldName,
    label,
    options,
    placeholder,
    noOptionsText,
  }) {
    const meta = catInlineAccountMetaByField[fieldName];
    const inlineState =
      catInlineAccountCreate[fieldName] || createInlineAccountCreateDraft();

    return (
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        <label className="block">
          {label}
          <Combobox
            className="mt-1"
            value={catForm[fieldName]}
            options={options}
            loading={catAccountLoading}
            placeholder={
              toPositiveInt(catForm.legalEntityId)
                ? placeholder
                : l("Select legal entity first", "Once tuzel kisilik secin")
            }
            noOptionsText={
              toPositiveInt(catForm.legalEntityId)
                ? noOptionsText
                : l("Select legal entity first.", "Once tuzel kisilik secin.")
            }
            onChange={(value) =>
              setCatForm((current) => ({
                ...current,
                [fieldName]: value ? String(value) : "",
              }))
            }
            onInputChange={(nextValue, inputMeta) =>
              handleCatAccountLookupInput(fieldName, nextValue, inputMeta)
            }
            disabled={catSaving || !toPositiveInt(catForm.legalEntityId)}
          />
        </label>
        {inlineState.error ? (
          <p className="mt-1 text-[11px] normal-case text-rose-700">
            {inlineState.error}
          </p>
        ) : null}
        {inlineState.message ? (
          <p className="mt-1 text-[11px] normal-case text-emerald-700">
            {inlineState.message}
          </p>
        ) : null}
        {meta?.showPanel ? (
          <InlineChildAccountCreatePanel
            l={l}
            codeCandidate={meta.codeCandidate}
            searchText={meta.lookupQuery}
            parentAccountLookupOptions={meta.parentLookupOptions}
            parentAccountId={inlineState.parentAccountId || meta.effectiveParentId}
            onParentAccountIdChange={(value) =>
              updateCatInlineAccountCreate(fieldName, {
                parentAccountId: value || "",
              })
            }
            childCode={meta.effectiveChildCode}
            onChildCodeChange={(value) =>
              updateCatInlineAccountCreate(fieldName, { childCode: value || "" })
            }
            childName={meta.effectiveChildName}
            onChildNameChange={(value) =>
              updateCatInlineAccountCreate(fieldName, { childName: value || "" })
            }
            onUseTypedCode={() =>
              updateCatInlineAccountCreate(fieldName, {
                childCode: meta.codeCandidate,
              })
            }
            onUseNextCode={() =>
              updateCatInlineAccountCreate(fieldName, {
                childCode: meta.suggestedNextCode,
              })
            }
            suggestedNextCode={meta.suggestedNextCode}
            hasSelectedParent={Boolean(
              toPositiveInt(inlineState.parentAccountId || meta.effectiveParentId)
            )}
            onCreateChild={() => handleCatInlineAccountCreate(fieldName)}
            creating={Boolean(inlineState.saving)}
            canUpsertAccounts={canUpsertGlAccounts}
            submitting={catSaving}
            permissionHint={l(
              "Missing permission: gl.account.upsert",
              "Eksik yetki: gl.account.upsert"
            )}
          />
        ) : null}
      </div>
    );
  }

  function resetCatForm() {
    setCatSelected(null);
    setCatForm({ ...createCategoryForm(), legalEntityId: filterLeId });
    setCatInlineAccountCreate(createCategoryInlineAccountCreateState());
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
      const refreshed = await listFixedAssetCategories({
        legalEntityId: filterLeId || undefined,
        ownerOperatingUnitId: workingOperatingUnitId || undefined,
      });
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
      const refreshed = await listFixedAssetDepreciationProfiles({
        legalEntityId: filterLeId || undefined,
        ownerOperatingUnitId: workingOperatingUnitId || undefined,
      });
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
                    onChange={(v) => { setCatForm((p) => ({ ...p, legalEntityId: v ? String(v) : "" })); setCatInlineAccountCreate(createCategoryInlineAccountCreateState()); }} disabled={catSaving || !!catSelected?.id} />
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
              <div className="md:col-span-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  {l("Default Posting Setup", "Varsayilan Muhasebe Kurulumu")}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {l(
                    "These defaults drive asset creation, capitalization, depreciation, and disposal accounting. Default Asset Account is required for CARI Auto-Create.",
                    "Bu varsayilanlar duran varlik olusturma, aktiflestirme, amortisman ve elden cikarma muhasebesini yonetir. Varsayilan Varlik Hesabi, CARI Otomatik Olustur icin zorunludur."
                  )}
                </p>
              </div>
              {catProfileError ? <p className="md:col-span-4 text-sm text-amber-700">{catProfileError}</p> : null}
              {catAccountError ? <p className="md:col-span-4 text-sm text-amber-700">{catAccountError}</p> : null}
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  {l("Default Depreciation Profile", "Varsayilan Amortisman Profili")}
                  <Combobox
                    className="mt-1"
                    value={catForm.defaultDepreciationProfileId}
                    options={catProfileOptions}
                    loading={catProfileLoading}
                    placeholder={
                      toPositiveInt(catForm.legalEntityId)
                        ? l("Select profile", "Profil secin")
                        : l("Select legal entity first", "Once tuzel kisilik secin")
                    }
                    noOptionsText={
                      toPositiveInt(catForm.legalEntityId)
                        ? l("No profiles found.", "Profil bulunamadi.")
                        : l("Select legal entity first.", "Once tuzel kisilik secin.")
                    }
                    onChange={(v) =>
                      setCatForm((p) => ({
                        ...p,
                        defaultDepreciationProfileId: v ? String(v) : "",
                      }))
                    }
                    disabled={catSaving || !toPositiveInt(catForm.legalEntityId)}
                  />
                </label>
              </div>
              {renderCatInlineAccountField({
                fieldName: "defaultAssetAccountId",
                label: l("Default Asset Account", "Varsayilan Varlik Hesabi"),
                options: catAssetAccountOptions,
                placeholder: l("Search asset account", "Varlik hesabi ara"),
                noOptionsText: l(
                  "No asset accounts found.",
                  "Varlik hesabi bulunamadi."
                ),
              })}
              {renderCatInlineAccountField({
                fieldName: "defaultAccumDeprAccountId",
                label: l(
                  "Default Accumulated Depreciation Account",
                  "Varsayilan Birikmis Amortisman Hesabi"
                ),
                options: catAssetAccountOptions,
                placeholder: l(
                  "Search accumulated depreciation account",
                  "Birikmis amortisman hesabi ara"
                ),
                noOptionsText: l(
                  "No asset accounts found.",
                  "Varlik hesabi bulunamadi."
                ),
              })}
              {renderCatInlineAccountField({
                fieldName: "defaultDeprExpenseAccountId",
                label: l(
                  "Default Depreciation Expense Account",
                  "Varsayilan Amortisman Gider Hesabi"
                ),
                options: catExpenseAccountOptions,
                placeholder: l(
                  "Search depreciation expense account",
                  "Amortisman gider hesabi ara"
                ),
                noOptionsText: l(
                  "No expense accounts found.",
                  "Gider hesabi bulunamadi."
                ),
              })}
              {renderCatInlineAccountField({
                fieldName: "defaultDisposalGainAccountId",
                label: l(
                  "Default Disposal Gain Account",
                  "Varsayilan Elden Cikarma Kar Hesabi"
                ),
                options: catRevenueAccountOptions,
                placeholder: l(
                  "Search disposal gain account",
                  "Elden cikarma kar hesabi ara"
                ),
                noOptionsText: l(
                  "No revenue accounts found.",
                  "Gelir hesabi bulunamadi."
                ),
              })}
              {renderCatInlineAccountField({
                fieldName: "defaultDisposalLossAccountId",
                label: l(
                  "Default Disposal Loss Account",
                  "Varsayilan Elden Cikarma Zarar Hesabi"
                ),
                options: catExpenseAccountOptions,
                placeholder: l(
                  "Search disposal loss account",
                  "Elden cikarma zarar hesabi ara"
                ),
                noOptionsText: l(
                  "No expense accounts found.",
                  "Gider hesabi bulunamadi."
                ),
              })}
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
                      <th className="px-3 py-2">{l("Setup", "Kurulum")}</th>
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
                        <td className="px-3 py-2">{formatSalvageRuleSummary(row)}</td>
                        <td className="px-3 py-2">
                          {(() => {
                            const readiness = summarizeCategoryAccountingSetup(row);
                            const badgeClass =
                              readiness.tone === "emerald"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : readiness.tone === "amber"
                                  ? "border-amber-200 bg-amber-50 text-amber-700"
                                  : "border-rose-200 bg-rose-50 text-rose-700";
                            const label =
                              readiness.tone === "emerald"
                                ? l("Ready", "Hazir")
                                : readiness.tone === "amber"
                                  ? l("Partial", "Kismi")
                                  : l("Missing asset account", "Varlik hesabi eksik");
                            return (
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}>
                                {label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2">{row.status || "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
                              onClick={() => {
                                setCatDetailRow(row);
                                setCatDetailError("");
                              }}
                            >
                              {l("Details", "Detay")}
                            </button>
                            <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60"
                              onClick={() => { setCatSelected(row); setCatForm(mapCategoryToForm(row)); setCatInlineAccountCreate(createCategoryInlineAccountCreateState()); setCatFormError(""); setCatFormMsg(""); }} disabled={!canUpsertSettings}>
                              {l("Edit", "Duzenle")}
                            </button>
                          </div>
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
      <CategoryDetailsModal
        l={l}
        row={catDetailRow}
        accountRowsById={catDetailAccountRowsById}
        profileRowsById={catDetailProfileRowsById}
        loading={catDetailLoading}
        error={catDetailError}
        canUpsertSettings={canUpsertSettings}
        onClose={() => {
          setCatDetailRow(null);
          setCatDetailError("");
        }}
        onEdit={() => {
          if (!catDetailRow) {
            return;
          }
          setCatSelected(catDetailRow);
          setCatForm(mapCategoryToForm(catDetailRow));
          setCatInlineAccountCreate(createCategoryInlineAccountCreateState());
          setCatFormError("");
          setCatFormMsg("");
          setCatDetailRow(null);
          setCatDetailError("");
        }}
      />
    </div>
  );
}
