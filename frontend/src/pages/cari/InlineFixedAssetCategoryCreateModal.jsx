import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth.js";
import Combobox from "../../components/Combobox.jsx";
import InlineChildAccountCreatePanel from "../../components/InlineChildAccountCreatePanel.jsx";
import {
  createFixedAssetCategory,
  listFixedAssetDepreciationProfiles,
} from "../../api/fixedAssets.js";
import { listAccounts } from "../../api/glAdmin.js";
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

const FIXED_ASSET_SETTINGS_PATH = "/app/ayarlar/demirbas-ayarlari";
const GL_ACCOUNTS_PATH = "/app/ayarlar/hesap-plani-olustur";
const SALVAGE_RULE_TYPES = ["NONE", "FIXED_BASE_AMOUNT", "PERCENT_OF_COST"];
const CATEGORY_ACCOUNT_INLINE_FIELD_SPECS = {
  defaultAssetAccountId: { accountType: "ASSET", fallbackNormalSide: "DEBIT" },
  defaultAccumDeprAccountId: { accountType: "ASSET", fallbackNormalSide: "CREDIT" },
  defaultDeprExpenseAccountId: { accountType: "EXPENSE", fallbackNormalSide: "DEBIT" },
  defaultDisposalGainAccountId: { accountType: "REVENUE", fallbackNormalSide: "CREDIT" },
  defaultDisposalLossAccountId: { accountType: "EXPENSE", fallbackNormalSide: "DEBIT" },
};

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

function suggestCategoryCode(value) {
  const suggested = normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return suggested;
}

function createCategoryForm(initialName = "") {
  const name = normalizeText(initialName);
  return {
    code: suggestCategoryCode(name),
    name,
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
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
    description: normalizeText(row?.accountType),
  };
}

function filterAccountRowsByType(rows, expectedType) {
  const normalizedType = normalizeText(expectedType).toUpperCase();
  return (Array.isArray(rows) ? rows : []).filter(
    (row) =>
      row?.allowPosting &&
      row?.isActive &&
      normalizeText(row?.accountType).toUpperCase() === normalizedType
  );
}

function buildCategoryPayload(form, legalEntityId) {
  const salvageType =
    normalizeText(form.defaultSalvageRuleType).toUpperCase() || "NONE";
  return {
    legalEntityId: toPositiveInt(legalEntityId) || undefined,
    code: normalizeText(form.code).toUpperCase(),
    name: normalizeText(form.name),
    status: "ACTIVE",
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
      salvageType === "FIXED_BASE_AMOUNT" &&
      normalizeText(form.defaultSalvageAmountBase)
        ? Number(form.defaultSalvageAmountBase)
        : undefined,
  };
}

export default function InlineFixedAssetCategoryCreateModal({
  open,
  legalEntityId,
  initialName,
  l,
  onClose,
  onCreated,
}) {
  const { hasPermission } = useAuth();
  const canUpsertGlAccounts = hasPermission("gl.account.upsert");
  const canCreateJournals = hasPermission("gl.journal.create");
  const canPostJournals = hasPermission("gl.journal.post");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadFiscalPeriods = hasPermission("org.fiscal_period.read");
  const canReadTrialBalance = hasPermission("gl.trial_balance.read");
  const [form, setForm] = useState(() => createCategoryForm(initialName));
  const [codeTouched, setCodeTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [profileOptions, setProfileOptions] = useState([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [accountRows, setAccountRows] = useState([]);
  const [assetAccountLoading, setAssetAccountLoading] = useState(false);
  const [assetAccountError, setAssetAccountError] = useState("");
  const [inlineAccountCreate, setInlineAccountCreate] = useState(
    createCategoryInlineAccountCreateState
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(createCategoryForm(initialName));
    setCodeTouched(false);
    setSaving(false);
    setError("");
    setInlineAccountCreate(createCategoryInlineAccountCreateState());
  }, [initialName, open]);

  useEffect(() => {
    const normalizedLegalEntityId = toPositiveInt(legalEntityId);
    if (!open || !normalizedLegalEntityId) {
      setProfileOptions([]);
      setProfileLoading(false);
      setProfileError("");
      setAccountRows([]);
      setAssetAccountLoading(false);
      setAssetAccountError("");
      return;
    }
    let active = true;
    async function loadReferences() {
      setProfileLoading(true);
      setAssetAccountLoading(true);
      setProfileError("");
      setAssetAccountError("");
      try {
        const [profileResponse, accountResponse] = await Promise.all([
          listFixedAssetDepreciationProfiles({ legalEntityId: normalizedLegalEntityId }),
          listAccounts({
            legalEntityId: normalizedLegalEntityId,
            includeInactive: true,
            limit: 1000,
          }),
        ]);
        if (!active) {
          return;
        }
        setProfileOptions(
          (Array.isArray(profileResponse?.rows) ? profileResponse.rows : [])
            .map(mapDepreciationProfileOption)
            .filter(Boolean)
        );
        setAccountRows(mapAccountRows(accountResponse));
      } catch (loadError) {
        if (!active) {
          return;
        }
        const normalizedError = normalizeApiError(
          loadError,
          l(
            "Failed to load category references.",
            "Kategori referanslari yuklenemedi."
          )
        );
        setProfileOptions([]);
        setAccountRows([]);
        setProfileError(normalizedError);
        setAssetAccountError(normalizedError);
      } finally {
        if (active) {
          setProfileLoading(false);
          setAssetAccountLoading(false);
        }
      }
    }
    loadReferences();
    return () => {
      active = false;
    };
  }, [legalEntityId, l, open]);

  const assetAccountOptions = useMemo(
    () =>
      filterAccountRowsByType(accountRows, "ASSET")
        .map(mapAccountOption)
        .filter(Boolean),
    [accountRows]
  );
  const expenseAccountOptions = useMemo(
    () =>
      filterAccountRowsByType(accountRows, "EXPENSE")
        .map(mapAccountOption)
        .filter(Boolean),
    [accountRows]
  );
  const revenueAccountOptions = useMemo(
    () =>
      filterAccountRowsByType(accountRows, "REVENUE")
        .map(mapAccountOption)
        .filter(Boolean),
    [accountRows]
  );
  const inlineAccountMetaByField = useMemo(() => {
    const next = {};
    const canResolveInlineAccount =
      Boolean(toPositiveInt(legalEntityId)) && !assetAccountLoading;
    for (const [fieldName, spec] of Object.entries(
      CATEGORY_ACCOUNT_INLINE_FIELD_SPECS
    )) {
      const inlineState =
        inlineAccountCreate[fieldName] || createInlineAccountCreateDraft();
      const lookupQuery = normalizeText(inlineState.lookupQuery);
      const codeCandidate = deriveSearchCodeCandidate(lookupQuery);
      const parentRows = buildInlineParentAccountOptions(
        accountRows,
        spec.accountType
      );
      const exactMatch =
        codeCandidate &&
        canResolveInlineAccount &&
        findExactInlineCodeMatch(accountRows, codeCandidate, spec.accountType);
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
        accountRows,
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
  }, [accountRows, assetAccountLoading, inlineAccountCreate, legalEntityId]);

  const missingPrerequisites = useMemo(() => {
    const issues = [];
    if (!toPositiveInt(legalEntityId)) {
      issues.push(
        l(
          "Select legal entity on the bill first.",
          "Once faturada tuzel kisilik secin."
        )
      );
    }
    if (!profileLoading && profileOptions.length === 0) {
      issues.push(
        l(
          "At least one fixed asset depreciation profile is required.",
          "En az bir duran varlik amortisman profili gerekir."
        )
      );
    }
    if (!assetAccountLoading && assetAccountOptions.length === 0) {
      issues.push(
        l(
          "At least one active postable asset account is required.",
          "En az bir aktif postalanabilir varlik hesabi gerekir."
        )
      );
    }
    if (!assetAccountLoading && expenseAccountOptions.length === 0) {
      issues.push(
        l(
          "At least one active postable expense account is required.",
          "En az bir aktif postalanabilir gider hesabi gerekir."
        )
      );
    }
    if (!assetAccountLoading && revenueAccountOptions.length === 0) {
      issues.push(
        l(
          "At least one active postable revenue account is required.",
          "En az bir aktif postalanabilir gelir hesabi gerekir."
        )
      );
    }
    return issues;
  }, [
    assetAccountLoading,
    assetAccountOptions.length,
    expenseAccountOptions.length,
    legalEntityId,
    l,
    profileLoading,
    profileOptions.length,
    revenueAccountOptions.length,
  ]);

  function patchForm(patch) {
    setForm((current) => {
      const next = {
        ...current,
        ...patch,
      };
      if (Object.prototype.hasOwnProperty.call(patch, "name") && !codeTouched) {
        next.code = suggestCategoryCode(patch.name);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "defaultSalvageRuleType")) {
        if (patch.defaultSalvageRuleType !== "PERCENT_OF_COST") {
          next.defaultSalvagePercent = "";
        }
        if (patch.defaultSalvageRuleType !== "FIXED_BASE_AMOUNT") {
          next.defaultSalvageAmountBase = "";
        }
      }
      return next;
    });
  }

  function updateInlineAccountCreate(fieldName, patch) {
    setInlineAccountCreate((current) => ({
      ...current,
      [fieldName]: {
        ...(current[fieldName] || createInlineAccountCreateDraft()),
        ...patch,
      },
    }));
  }

  function resetInlineAccountCreate(fieldName, patch = {}) {
    setInlineAccountCreate((current) => ({
      ...current,
      [fieldName]: {
        ...createInlineAccountCreateDraft(),
        ...patch,
      },
    }));
  }

  function handleAccountLookupInput(fieldName, nextValue, meta = {}) {
    const reason = normalizeText(meta?.reason).toLowerCase();
    if (reason === "select" || reason === "clear") {
      resetInlineAccountCreate(fieldName);
      return;
    }
    const normalizedLookup = normalizeText(nextValue);
    updateInlineAccountCreate(fieldName, {
      lookupQuery: normalizedLookup,
      parentAccountId: "",
      childCode: "",
      childName: normalizedLookup,
      saving: false,
      error: "",
      message: "",
    });
  }

  async function handleInlineAccountCreate(fieldName) {
    const meta = inlineAccountMetaByField[fieldName];
    const spec = CATEGORY_ACCOUNT_INLINE_FIELD_SPECS[fieldName];
    if (!meta || !spec) {
      return;
    }
    updateInlineAccountCreate(fieldName, {
      saving: true,
      error: "",
      message: "",
    });
    try {
      const result = await runInlineChildAccountCreate({
        legalEntityId,
        lookupName: meta.lookupQuery,
        parentAccountIdValue:
          meta.inlineState.parentAccountId || meta.effectiveParentId,
        childCodeValue: meta.effectiveChildCode,
        childNameValue: meta.effectiveChildName,
        accountType: spec.accountType,
        fallbackNormalSide: spec.fallbackNormalSide,
        l,
      });
      setAccountRows(Array.isArray(result?.accountRows) ? result.accountRows : []);
      patchForm({
        [fieldName]: result?.accountId ? String(result.accountId) : "",
      });
      const transferOutcome =
        result?.mode === "created"
          ? await maybePromptParentBalanceTransferAfterChildCreate({
              l,
              legalEntityId,
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
      resetInlineAccountCreate(fieldName, {
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
    } catch (createError) {
      updateInlineAccountCreate(fieldName, {
        saving: false,
        error: normalizeApiError(
          createError,
          l(
            "Failed to create child account.",
            "Child hesap olusturulamadi."
          )
        ),
        message: "",
      });
    }
  }

  function renderInlineAccountField({
    fieldName,
    label,
    options,
    placeholder,
    noOptionsText,
  }) {
    const meta = inlineAccountMetaByField[fieldName];
    const inlineState =
      inlineAccountCreate[fieldName] || createInlineAccountCreateDraft();

    return (
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        <label className="block">
          {label}
          <Combobox
            className="mt-1"
            value={form[fieldName]}
            options={options}
            loading={assetAccountLoading}
            disabled={saving}
            placeholder={placeholder}
            noOptionsText={noOptionsText}
            onChange={(value) =>
              patchForm({
                [fieldName]: value ? String(value) : "",
              })
            }
            onInputChange={(nextValue, inputMeta) =>
              handleAccountLookupInput(fieldName, nextValue, inputMeta)
            }
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
              updateInlineAccountCreate(fieldName, {
                parentAccountId: value || "",
              })
            }
            childCode={meta.effectiveChildCode}
            onChildCodeChange={(value) =>
              updateInlineAccountCreate(fieldName, { childCode: value || "" })
            }
            childName={meta.effectiveChildName}
            onChildNameChange={(value) =>
              updateInlineAccountCreate(fieldName, { childName: value || "" })
            }
            onUseTypedCode={() =>
              updateInlineAccountCreate(fieldName, {
                childCode: meta.codeCandidate,
              })
            }
            onUseNextCode={() =>
              updateInlineAccountCreate(fieldName, {
                childCode: meta.suggestedNextCode,
              })
            }
            suggestedNextCode={meta.suggestedNextCode}
            hasSelectedParent={Boolean(
              toPositiveInt(inlineState.parentAccountId || meta.effectiveParentId)
            )}
            onCreateChild={() => handleInlineAccountCreate(fieldName)}
            creating={Boolean(inlineState.saving)}
            canUpsertAccounts={canUpsertGlAccounts}
            submitting={saving}
            permissionHint={l(
              "Missing permission: gl.account.upsert",
              "Eksik yetki: gl.account.upsert"
            )}
          />
        ) : null}
      </div>
    );
  }

  async function handleSave() {
    const normalizedLegalEntityId = toPositiveInt(legalEntityId);
    if (!normalizedLegalEntityId) {
      setError(
        l(
          "Select legal entity on the bill first.",
          "Once faturada tuzel kisilik secin."
        )
      );
      return;
    }
    if (!normalizeText(form.code)) {
      setError(l("Category code is required.", "Kategori kodu zorunludur."));
      return;
    }
    if (!normalizeText(form.name)) {
      setError(l("Category name is required.", "Kategori adi zorunludur."));
      return;
    }
    if (!toPositiveInt(form.defaultUsefulLifeMonths)) {
      setError(
        l(
          "Useful life months is required.",
          "Faydali omur ay alani zorunludur."
        )
      );
      return;
    }
    if (!toPositiveInt(form.defaultDepreciationProfileId)) {
      setError(
        l(
          "Default depreciation profile is required.",
          "Varsayilan amortisman profili zorunludur."
        )
      );
      return;
    }
    if (!toPositiveInt(form.defaultAssetAccountId)) {
      setError(
        l(
          "Default asset account is required.",
          "Varsayilan varlik hesabi zorunludur."
        )
      );
      return;
    }
    if (!toPositiveInt(form.defaultAccumDeprAccountId)) {
      setError(
        l(
          "Default accumulated depreciation account is required.",
          "Varsayilan birikmis amortisman hesabi zorunludur."
        )
      );
      return;
    }
    if (!toPositiveInt(form.defaultDeprExpenseAccountId)) {
      setError(
        l(
          "Default depreciation expense account is required.",
          "Varsayilan amortisman gider hesabi zorunludur."
        )
      );
      return;
    }
    if (!toPositiveInt(form.defaultDisposalGainAccountId)) {
      setError(
        l(
          "Default disposal gain account is required.",
          "Varsayilan satis kar hesabi zorunludur."
        )
      );
      return;
    }
    if (!toPositiveInt(form.defaultDisposalLossAccountId)) {
      setError(
        l(
          "Default disposal loss account is required.",
          "Varsayilan satis zarar hesabi zorunludur."
        )
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await createFixedAssetCategory(
        buildCategoryPayload(form, normalizedLegalEntityId)
      );
      onCreated?.(created);
    } catch (saveError) {
      setError(
        normalizeApiError(
          saveError,
          l(
            "Failed to create fixed asset category.",
            "Duran varlik kategorisi olusturulamadi."
          )
        )
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {l("Create Asset Category", "Varlik Kategorisi Olustur")}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Create a ready-to-use category without leaving the bill screen.",
                "Fatura ekranindan ayrilmadan kullanima hazir kategori olusturun."
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            onClick={onClose}
            disabled={saving}
          >
            {l("Close", "Kapat")}
          </button>
        </div>

        {missingPrerequisites.length > 0 ? (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p className="font-semibold">
              {l(
                "Some prerequisites are missing before category creation.",
                "Kategori olusturmadan once bazi on kosullar eksik."
              )}
            </p>
            <ul className="mt-2 list-disc pl-5">
              {missingPrerequisites.map((issue) => (
                <li key={`inline-fa-category-issue-${issue}`}>{issue}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
              <a
                href={FIXED_ASSET_SETTINGS_PATH}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {l("Open Fixed Asset Settings", "Demirbas Ayarlarini Ac")}
              </a>
              <a
                href={GL_ACCOUNTS_PATH}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {l("Open Chart of Accounts", "Hesap Planini Ac")}
              </a>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Category Code", "Kategori Kodu")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.code}
              onChange={(event) => {
                setCodeTouched(true);
                patchForm({ code: event.target.value });
              }}
              disabled={saving}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Category Name", "Kategori Adi")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.name}
              onChange={(event) => patchForm({ name: event.target.value })}
              disabled={saving}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Useful Life (months)", "Faydali Omur (ay)")}
            <input
              type="number"
              min="1"
              step="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.defaultUsefulLifeMonths}
              onChange={(event) =>
                patchForm({ defaultUsefulLifeMonths: event.target.value })
              }
              disabled={saving}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Default Depreciation Profile", "Varsayilan Amortisman Profili")}
            <Combobox
              className="mt-1"
              value={form.defaultDepreciationProfileId}
              options={profileOptions}
              loading={profileLoading}
              disabled={saving}
              placeholder={l("Search depreciation profile", "Amortisman profili ara")}
              noOptionsText={l("No profiles found.", "Profil bulunamadi.")}
              onChange={(value) =>
                patchForm({
                  defaultDepreciationProfileId: value ? String(value) : "",
                })
              }
            />
            {profileError ? (
              <p className="mt-1 text-xs font-normal normal-case text-amber-700">
                {profileError}
              </p>
            ) : null}
          </label>
          {assetAccountError ? (
            <p className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
              {assetAccountError}
            </p>
          ) : null}
          {renderInlineAccountField({
            fieldName: "defaultAssetAccountId",
            label: l("Default Asset Account", "Varsayilan Varlik Hesabi"),
            options: assetAccountOptions,
            placeholder: l("Search asset account", "Varlik hesabi ara"),
            noOptionsText: l(
              "No asset accounts found.",
              "Varlik hesabi bulunamadi."
            ),
          })}
          {renderInlineAccountField({
            fieldName: "defaultAccumDeprAccountId",
            label: l(
              "Default Accumulated Depreciation Account",
              "Varsayilan Birikmis Amortisman Hesabi"
            ),
            options: assetAccountOptions,
            placeholder: l(
              "Search accumulated depreciation account",
              "Birikmis amortisman hesabi ara"
            ),
            noOptionsText: l(
              "No asset accounts found.",
              "Varlik hesabi bulunamadi."
            ),
          })}
          {renderInlineAccountField({
            fieldName: "defaultDeprExpenseAccountId",
            label: l(
              "Default Depreciation Expense Account",
              "Varsayilan Amortisman Gider Hesabi"
            ),
            options: expenseAccountOptions,
            placeholder: l(
              "Search depreciation expense account",
              "Amortisman gider hesabi ara"
            ),
            noOptionsText: l(
              "No expense accounts found.",
              "Gider hesabi bulunamadi."
            ),
          })}
          {renderInlineAccountField({
            fieldName: "defaultDisposalGainAccountId",
            label: l("Default Disposal Gain Account", "Varsayilan Satis Kar Hesabi"),
            options: revenueAccountOptions,
            placeholder: l(
              "Search disposal gain account",
              "Satis kar hesabi ara"
            ),
            noOptionsText: l(
              "No revenue accounts found.",
              "Gelir hesabi bulunamadi."
            ),
          })}
          {renderInlineAccountField({
            fieldName: "defaultDisposalLossAccountId",
            label: l("Default Disposal Loss Account", "Varsayilan Satis Zarar Hesabi"),
            options: expenseAccountOptions,
            placeholder: l(
              "Search disposal loss account",
              "Satis zarar hesabi ara"
            ),
            noOptionsText: l(
              "No expense accounts found.",
              "Gider hesabi bulunamadi."
            ),
          })}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Salvage Rule", "Hurda Kurali")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.defaultSalvageRuleType}
              onChange={(event) =>
                patchForm({ defaultSalvageRuleType: event.target.value })
              }
              disabled={saving}
            >
              {SALVAGE_RULE_TYPES.map((ruleType) => (
                <option key={`inline-fa-category-salvage-${ruleType}`} value={ruleType}>
                  {ruleType}
                </option>
              ))}
            </select>
          </label>
          {form.defaultSalvageRuleType === "PERCENT_OF_COST" ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Salvage Percent", "Hurda Yuzdesi")}
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={form.defaultSalvagePercent}
                onChange={(event) =>
                  patchForm({ defaultSalvagePercent: event.target.value })
                }
                disabled={saving}
              />
            </label>
          ) : null}
          {form.defaultSalvageRuleType === "FIXED_BASE_AMOUNT" ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Salvage Amount (Base)", "Hurda Tutari (Baz)")}
              <input
                type="number"
                min="0"
                step="0.01"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={form.defaultSalvageAmountBase}
                onChange={(event) =>
                  patchForm({ defaultSalvageAmountBase: event.target.value })
                }
                disabled={saving}
              />
            </label>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
            onClick={onClose}
            disabled={saving}
          >
            {l("Cancel", "Iptal")}
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={handleSave}
            disabled={saving || missingPrerequisites.length > 0}
          >
            {saving
              ? l("Creating category...", "Kategori olusturuluyor...")
              : l("Create + Select", "Olustur + Sec")}
          </button>
        </div>
      </div>
    </div>
  );
}
