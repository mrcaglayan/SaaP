import {
  createDocumentLineDraft,
  DOCUMENT_LINE_CHARGE_ALLOCATION_METHODS,
  DOCUMENT_LINE_FIXED_ASSET_MODES,
  computeDocumentChargeAllocationPreview,
  computeDocumentLineAmounts,
  DOCUMENT_LINE_SUBLEDGER_TYPES,
  DOCUMENT_DIRECTIONS,
  DOCUMENT_SETTLEMENT_MODES,
  normalizeDocumentFormLines,
  DOCUMENT_TYPES,
  listEligibleChargeTargetLines,
  requiresDueDate,
} from "./cariDocumentsUtils.js";
import {
  canCariDocumentBeCancelled as canCariDocumentBeCancelledByStatus,
  canCariDocumentBeSubmitted as canCariDocumentBeSubmittedByStatus,
  isDocClassWorkflowGoverned as isDocClassWorkflowGovernedByMetadata,
} from "../../../../shared/cariDocumentWorkflowGovernance.js";

export const FIXED_ASSET_SETTINGS_PATH = "/app/ayarlar/demirbas-ayarlari";
export const DOCUMENT_LINE_EXPANSION_LIMIT = 500;
export const LINE_TEXT_INPUT_COMMIT_DELAY_MS = 180;
export const FIXED_ASSET_AP_MODE_OPTIONS = DOCUMENT_LINE_FIXED_ASSET_MODES.filter(
  (value) =>
    value === "AUTO_CREATE"
    || value === "LINK_EXISTING"
    || value === "IMPROVE_EXISTING"
);

export function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeCurrencyCode(value) {
  return normalizeText(value).toUpperCase();
}

export function normalizeOptionalDecimalText(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

export function formatPostableAccountDisplay(account, accountId = null) {
  if (account?.code && account?.name) {
    return `${account.code} - ${account.name}`;
  }
  if (account?.code) {
    return account.code;
  }
  if (toPositiveInt(accountId)) {
    return `#${accountId}`;
  }
  return "-";
}

export function getFixedAssetCategoryDefaultAssetAccountId(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultAssetAccountId ?? categoryRow?.default_asset_account_id
  );
}

export function getFixedAssetCategoryDefaultAccumDeprAccountId(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultAccumDeprAccountId ?? categoryRow?.default_accum_depr_account_id
  );
}

export function getFixedAssetCategoryDefaultDeprExpenseAccountId(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultDeprExpenseAccountId ?? categoryRow?.default_depr_expense_account_id
  );
}

export function getFixedAssetCategoryDefaultDisposalGainAccountId(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultDisposalGainAccountId ?? categoryRow?.default_disposal_gain_account_id
  );
}

export function getFixedAssetCategoryDefaultDisposalLossAccountId(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultDisposalLossAccountId ?? categoryRow?.default_disposal_loss_account_id
  );
}

export function getFixedAssetCategoryDefaultDepreciationProfileId(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultDepreciationProfileId ?? categoryRow?.default_depreciation_profile_id
  );
}

export function getFixedAssetCategoryDefaultUsefulLifeMonths(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultUsefulLifeMonths ?? categoryRow?.default_useful_life_months
  );
}

export function formatFixedAssetCategoryDisplay(categoryRow, fallbackId = null) {
  const code = normalizeText(categoryRow?.code);
  const name = normalizeText(categoryRow?.name);
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code || name) {
    return code || name;
  }
  const categoryId = toPositiveInt(categoryRow?.id) || toPositiveInt(fallbackId);
  return categoryId ? `#${categoryId}` : "-";
}

export function buildFixedAssetCategorySetupIssue(categoryRow, fallbackId = null) {
  const normalizedCategoryId =
    toPositiveInt(categoryRow?.id) || toPositiveInt(fallbackId);
  if (!normalizedCategoryId) {
    return null;
  }
  const missingRequirements = [];
  if (!getFixedAssetCategoryDefaultAssetAccountId(categoryRow)) {
    missingRequirements.push("defaultAssetAccountId");
  }
  if (!getFixedAssetCategoryDefaultAccumDeprAccountId(categoryRow)) {
    missingRequirements.push("defaultAccumDeprAccountId");
  }
  if (!getFixedAssetCategoryDefaultDeprExpenseAccountId(categoryRow)) {
    missingRequirements.push("defaultDeprExpenseAccountId");
  }
  if (!getFixedAssetCategoryDefaultDisposalGainAccountId(categoryRow)) {
    missingRequirements.push("defaultDisposalGainAccountId");
  }
  if (!getFixedAssetCategoryDefaultDisposalLossAccountId(categoryRow)) {
    missingRequirements.push("defaultDisposalLossAccountId");
  }
  if (!getFixedAssetCategoryDefaultDepreciationProfileId(categoryRow)) {
    missingRequirements.push("defaultDepreciationProfileId");
  }
  if (!getFixedAssetCategoryDefaultUsefulLifeMonths(categoryRow)) {
    missingRequirements.push("defaultUsefulLifeMonths");
  }
  if (missingRequirements.length === 0) {
    return null;
  }
  return {
    categoryId: normalizedCategoryId,
    categoryLabel: formatFixedAssetCategoryDisplay(categoryRow, normalizedCategoryId),
    missingRequirements,
  };
}

export function getFixedAssetCategorySetupIssue(categoryId, categoriesById) {
  const normalizedCategoryId = toPositiveInt(categoryId);
  if (!normalizedCategoryId || !(categoriesById instanceof Map)) {
    return null;
  }
  const categoryRow = categoriesById.get(normalizedCategoryId) || null;
  return categoryRow
    ? buildFixedAssetCategorySetupIssue(categoryRow, normalizedCategoryId)
    : null;
}

export function formatFixedAssetCategorySetupRequirementLabel(requirementKey, l) {
  if (requirementKey === "defaultAssetAccountId") {
    return l("Default Asset Account", "Varsayilan Varlik Hesabi");
  }
  if (requirementKey === "defaultDepreciationProfileId") {
    return l("Default Depreciation Profile", "Varsayilan Amortisman Profili");
  }
  if (requirementKey === "defaultAccumDeprAccountId") {
    return l(
      "Default Accumulated Depreciation Account",
      "Varsayilan Birikmis Amortisman Hesabi"
    );
  }
  if (requirementKey === "defaultDeprExpenseAccountId") {
    return l(
      "Default Depreciation Expense Account",
      "Varsayilan Amortisman Gider Hesabi"
    );
  }
  if (requirementKey === "defaultDisposalGainAccountId") {
    return l("Default Disposal Gain Account", "Varsayilan Satis Kar Hesabi");
  }
  if (requirementKey === "defaultDisposalLossAccountId") {
    return l("Default Disposal Loss Account", "Varsayilan Satis Zarar Hesabi");
  }
  if (requirementKey === "defaultUsefulLifeMonths") {
    return l("Default Useful Life (months)", "Varsayilan Faydali Omur (ay)");
  }
  return requirementKey;
}

export function formatFixedAssetCategorySetupRequirementList(
  missingRequirements,
  l
) {
  return (Array.isArray(missingRequirements) ? missingRequirements : [])
    .map((requirementKey) =>
      formatFixedAssetCategorySetupRequirementLabel(requirementKey, l)
    )
    .join(", ");
}

export function roundDocumentUiAmount(value) {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }
  return Number(Number(value).toFixed(6));
}

export function resolveFixedAssetDisplayAccountId(
  line,
  categoriesById = new Map(),
  fixedAssetsById = new Map()
) {
  const normalizedLine = createDocumentLineDraft(line);
  if (normalizedLine.subledgerType !== "FIXED_ASSET") {
    return null;
  }
  const categoryId = toPositiveInt(normalizedLine.fixedAssetCategoryId);
  if (categoryId) {
    return getFixedAssetCategoryDefaultAssetAccountId(categoriesById.get(categoryId));
  }
  const targetAssetId = toPositiveInt(normalizedLine.targetFixedAssetId);
  if (targetAssetId) {
    const assetRow = fixedAssetsById.get(targetAssetId) || null;
    const assetCategoryId = toPositiveInt(
      assetRow?.categoryId ?? assetRow?.category_id
    );
    if (assetCategoryId) {
      return getFixedAssetCategoryDefaultAssetAccountId(categoriesById.get(assetCategoryId));
    }
  }
  return toPositiveInt(normalizedLine.postingAccountId);
}

export function normalizeChargeAllocationMethod(value) {
  const normalized = normalizeText(value).toUpperCase();
  return DOCUMENT_LINE_CHARGE_ALLOCATION_METHODS.includes(normalized)
    ? normalized
    : "NONE";
}

export function createInitialQuickCreateFixedAssetForm() {
  return {
    scope: "",
    lineRowId: "",
    legalEntityId: "",
    documentDate: "",
    currencyCode: "",
    name: "",
    categoryId: "",
    ownerOperatingUnitId: "",
    locationOperatingUnitId: "",
  };
}

export function normalizeDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "AR" || normalized === "AP") {
    return normalized;
  }
  return "";
}

export function formatWarehouseDisplay(
  warehouseId,
  warehouseCode,
  warehouseName
) {
  const normalizedWarehouseId = toPositiveInt(warehouseId);
  const code = normalizeText(warehouseCode);
  const name = normalizeText(warehouseName);
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code) {
    return code;
  }
  if (name) {
    return name;
  }
  return normalizedWarehouseId ? `#${normalizedWarehouseId}` : "-";
}

export function formatFixedAssetStatusLabel(status, l) {
  const normalized = normalizeText(status).toUpperCase();
  switch (normalized) {
    case "ACTIVE":
      return l("Active", "Aktif");
    case "DRAFT":
      return l("Draft", "Taslak");
    case "SUSPENDED":
      return l("Suspended", "Askida");
    case "FULLY_DEPRECIATED":
      return l("Fully Depreciated", "Tam Amortismanli");
    case "DISPOSED":
      return l("Disposed", "Elden Cikarildi");
    default:
      return normalized || "-";
  }
}

export function formatFixedAssetLifeMonths(value, l) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "-";
  }
  return l(`${parsed} month${parsed === 1 ? "" : "s"}`, `${parsed} ay`);
}

export function formatFixedAssetCategoryDisplayFromAssetRow(
  assetRow,
  categoriesById = new Map()
) {
  const categoryId = toPositiveInt(assetRow?.categoryId ?? assetRow?.category_id);
  const categoryRow = categoryId ? categoriesById.get(categoryId) || null : null;
  if (categoryRow) {
    return formatFixedAssetCategoryDisplay(categoryRow, categoryId);
  }
  const categoryCode = normalizeText(assetRow?.categoryCode || assetRow?.category_code);
  const categoryName = normalizeText(assetRow?.categoryName || assetRow?.category_name);
  if (categoryCode && categoryName) {
    return `${categoryCode} - ${categoryName}`;
  }
  if (categoryCode) {
    return categoryCode;
  }
  if (categoryName) {
    return categoryName;
  }
  return categoryId ? `#${categoryId}` : "-";
}

export const DEFAULT_FILTERS = {
  legalEntityId: "",
  operatingUnitId: "",
  counterpartyId: "",
  direction: "",
  documentType: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  documentDateFrom: "",
  documentDateTo: "",
  q: "",
  limit: 100,
  offset: 0,
};

export const DOCUMENT_FILTER_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "operatingUnitId" },
  { stateKey: "dateFrom" },
  { stateKey: "dateTo" },
];

export const DOCUMENT_CREATE_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "operatingUnitId" },
  {
    stateKey: "documentDate",
    contextKey: "dateTo",
    allowContextValue: (contextValue) => /^\d{4}-\d{2}-\d{2}$/.test(String(contextValue || "").trim()),
  },
];
export const DOCUMENT_FILTERS_STORAGE_SCOPE = "cari-documents.list";
export const DOCUMENT_TABLE_PREFS_STORAGE_SCOPE = "cari-documents.list.table";
export const DOCUMENT_SAVED_VIEW_MODULE_CODE = "CARI_DOCUMENTS_LIST";
export const DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE = "CARI_DOCUMENT_DRAFT_TEMPLATES";
export const DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE = 50;
export const DOCUMENT_TABLE_ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 200];
export const DOCUMENT_LIST_COLUMN_IDS = [
  "id",
  "documentNo",
  "legalEntity",
  "operatingUnit",
  "direction",
  "documentType",
  "status",
  "workflowGate",
  "documentDate",
  "amountTxn",
  "postedJournal",
  "reversalOf",
  "action",
];
export const INVENTORY_MOVEMENTS_ROUTE = "/app/stok-yansitma-islemleri";
export const INVENTORY_TRANSFERS_ROUTE = "/app/stok-transferleri";
export const FIXED_ASSET_DETAIL_ROUTE_PREFIX = "/app/demirbas-karti-detayi";
export const FIXED_ASSET_AR_ELIGIBLE_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
];
export const FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES = [
  "ACTIVE",
  "FULLY_DEPRECIATED",
];
export const DOCUMENT_RECURRING_TEMPLATE_CADENCES = [
  "NONE",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
];
export const DOCUMENT_EXPORT_COLUMNS = [
  { header: "ID", value: (row) => row?.id },
  { header: "Document No", value: (row) => firstDefinedRowValue(row, "documentNo", "document_no") },
  { header: "Legal Entity ID", value: (row) => firstDefinedRowValue(row, "legalEntityId", "legal_entity_id") },
  {
    header: "Legal Entity Code",
    value: (row) => firstDefinedRowValue(row, "legalEntityCode", "legal_entity_code"),
  },
  {
    header: "Legal Entity Name",
    value: (row) => firstDefinedRowValue(row, "legalEntityName", "legal_entity_name"),
  },
  {
    header: "Operating Unit ID",
    value: (row) => firstDefinedRowValue(row, "operatingUnitId", "operating_unit_id"),
  },
  { header: "Counterparty ID", value: (row) => firstDefinedRowValue(row, "counterpartyId", "counterparty_id") },
  {
    header: "Counterparty Code",
    value: (row) => firstDefinedRowValue(row, "counterpartyCodeSnapshot", "counterparty_code_snapshot"),
  },
  {
    header: "Counterparty Name",
    value: (row) => firstDefinedRowValue(row, "counterpartyNameSnapshot", "counterparty_name_snapshot"),
  },
  { header: "Direction", value: (row) => row?.direction },
  { header: "Document Type", value: (row) => firstDefinedRowValue(row, "documentType", "document_type") },
  { header: "Status", value: (row) => row?.status },
  { header: "Document Date", value: (row) => firstDefinedRowValue(row, "documentDate", "document_date") },
  { header: "Due Date", value: (row) => firstDefinedRowValue(row, "dueDateSnapshot", "due_date_snapshot") },
  {
    header: "Invoice Amount (Invoice Currency)",
    value: (row) => firstDefinedRowValue(row, "amountTxn", "amount_txn"),
  },
  {
    header: "Base Amount (Legal Entity Currency)",
    value: (row) => firstDefinedRowValue(row, "amountBase", "amount_base"),
  },
  {
    header: "Invoice Currency",
    value: (row) => firstDefinedRowValue(row, "currencyCodeSnapshot", "currency_code_snapshot"),
  },
  { header: "FX Rate", value: (row) => firstDefinedRowValue(row, "fxRateSnapshot", "fx_rate_snapshot") },
  {
    header: "Posted Journal Entry ID",
    value: (row) => firstDefinedRowValue(row, "postedJournalEntryId", "posted_journal_entry_id"),
  },
  {
    header: "Reversal Of Document ID",
    value: (row) => firstDefinedRowValue(row, "reversalOfDocumentId", "reversal_of_document_id"),
  },
  { header: "Created At", value: (row) => firstDefinedRowValue(row, "createdAt", "created_at") },
  { header: "Updated At", value: (row) => firstDefinedRowValue(row, "updatedAt", "updated_at") },
];

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function firstDefinedRowValue(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key];
    }
  }
  return "";
}

export function buildInventoryMovementLink(legalEntityId, movementId = null) {
  const params = new URLSearchParams();
  const normalizedLegalEntityId = normalizePositiveIntText(legalEntityId);
  const normalizedMovementId = normalizePositiveIntText(movementId);
  if (normalizedLegalEntityId) {
    params.set("legalEntityId", normalizedLegalEntityId);
  }
  if (normalizedMovementId) {
    params.set("movementId", normalizedMovementId);
  }
  const query = params.toString();
  return query ? `${INVENTORY_MOVEMENTS_ROUTE}?${query}` : INVENTORY_MOVEMENTS_ROUTE;
}

export function buildInventoryTransferLink({
  legalEntityId,
  sourceWarehouseId = null,
  targetWarehouseId = null,
  itemCardId = null,
  quantityRequested = null,
  sourceModule = null,
  sourceEntityType = null,
  sourceEntityId = null,
} = {}) {
  const params = new URLSearchParams();
  const normalizedLegalEntityId = normalizePositiveIntText(legalEntityId);
  const normalizedSourceWarehouseId = normalizePositiveIntText(sourceWarehouseId);
  const normalizedTargetWarehouseId = normalizePositiveIntText(targetWarehouseId);
  const normalizedItemCardId = normalizePositiveIntText(itemCardId);
  const normalizedSourceEntityId = normalizePositiveIntText(sourceEntityId);
  const normalizedQuantityRequested = normalizeText(quantityRequested);
  if (normalizedLegalEntityId) {
    params.set("legalEntityId", normalizedLegalEntityId);
  }
  if (normalizedSourceWarehouseId) {
    params.set("sourceWarehouseId", normalizedSourceWarehouseId);
  }
  if (normalizedTargetWarehouseId) {
    params.set("targetWarehouseId", normalizedTargetWarehouseId);
  }
  if (normalizedItemCardId) {
    params.set("itemCardId", normalizedItemCardId);
  }
  if (normalizedQuantityRequested) {
    params.set("quantityRequested", normalizedQuantityRequested);
  }
  if (normalizeText(sourceModule)) {
    params.set("sourceModule", normalizeText(sourceModule).toUpperCase());
  }
  if (normalizeText(sourceEntityType)) {
    params.set("sourceEntityType", normalizeText(sourceEntityType).toUpperCase());
  }
  if (normalizedSourceEntityId) {
    params.set("sourceEntityId", normalizedSourceEntityId);
  }
  params.set("prefillReason", "TRANSFER_REQUIRED");
  const query = params.toString();
  return query ? `${INVENTORY_TRANSFERS_ROUTE}?${query}` : INVENTORY_TRANSFERS_ROUTE;
}

export function extractTransferRequiredGuidanceFromError(error) {
  const responseData = error?.response?.data || {};
  const details = responseData?.details || {};
  const directReason = String(details?.reason || responseData?.code || "").trim().toUpperCase();
  const directCandidate =
    directReason === "TRANSFER_REQUIRED" ? details : null;
  const lineCandidate = Array.isArray(details?.lineErrors)
    ? details.lineErrors.find(
        (lineError) => String(lineError?.reason || "").trim().toUpperCase() === "TRANSFER_REQUIRED"
      ) || null
    : null;
  const candidate = lineCandidate || directCandidate;
  if (!candidate) {
    return null;
  }
  return {
    warehouseId: toPositiveInt(candidate?.warehouseId),
    warehouseCode: normalizeText(candidate?.warehouseCode),
    warehouseName: normalizeText(candidate?.warehouseName),
    itemCardId: toPositiveInt(candidate?.itemCardId),
    itemCardCode: normalizeText(candidate?.itemCardCode),
    itemCardName: normalizeText(candidate?.itemCardName),
    requestedQuantity: normalizeText(candidate?.requestedQuantity),
    transferSourceWarehouseId: toPositiveInt(candidate?.transferSourceWarehouseId),
    transferSourceWarehouseCode: normalizeText(candidate?.transferSourceWarehouseCode),
    transferSourceWarehouseName: normalizeText(candidate?.transferSourceWarehouseName),
    transferSourceOperatingUnitName: normalizeText(candidate?.transferSourceOperatingUnitName),
  };
}

export function extractFixedAssetImprovementGuidanceFromError(error) {
  const responseData = error?.response?.data || {};
  const details = responseData?.details || {};
  const directReason = normalizeText(details?.reasonCode || details?.reason).toUpperCase();
  const hasDirectBlocker =
    directReason === "FA_IMPROVEMENT_LATER_FIXED_ASSET_ACTIVITY"
    || directReason === "FA_IMPROVEMENT_SAME_DAY_LIFE_CHANGE_CONFLICT";
  const rawMessage = String(responseData?.message || error?.message || "").trim();
  const rawMessageMatch = rawMessage.match(
    /targetFixedAssetId conflicts with later fixed-asset activity \(transactionId=(\d+), type=([A-Z_]+), effectiveDate=([0-9-]+)\)$/
  );
  const sameDayLifeConflictMatch = rawMessage.match(
    /targetFixedAssetId cannot apply another useful-life change on ([0-9-]+) because posted improvement transaction (\d+) already changes life on that date$/
  );
  if (!hasDirectBlocker && !rawMessageMatch && !sameDayLifeConflictMatch) {
    return null;
  }

  return {
    reasonCode: directReason || (
      sameDayLifeConflictMatch
        ? "FA_IMPROVEMENT_SAME_DAY_LIFE_CHANGE_CONFLICT"
        : "FA_IMPROVEMENT_LATER_FIXED_ASSET_ACTIVITY"
    ),
    assetId: toPositiveInt(details?.assetId),
    blockingTransactionId: toPositiveInt(
      details?.blockingTransactionId ?? rawMessageMatch?.[1] ?? sameDayLifeConflictMatch?.[2]
    ),
    blockingTransactionType: normalizeText(
      details?.blockingTransactionType ?? rawMessageMatch?.[2] ?? "IMPROVEMENT"
    ).toUpperCase(),
    blockingEffectiveDate: normalizeText(
      details?.blockingEffectiveDate ?? rawMessageMatch?.[3] ?? sameDayLifeConflictMatch?.[1]
    ),
  };
}

export function formatFixedAssetTransactionTypeLabel(transactionType, l) {
  switch (normalizeText(transactionType).toUpperCase()) {
    case "IMPROVEMENT":
      return l("Improvement", "Iyilestirme");
    case "OWNERSHIP_TRANSFER":
      return l("Ownership transfer", "Sahiplik devri");
    case "PHYSICAL_MOVE":
      return l("Physical move", "Fiziksel tasima");
    case "SUSPEND":
      return l("Suspend", "Askiya alma");
    case "REACTIVATE":
      return l("Reactivate", "Yeniden aktiflestirme");
    case "SALE":
      return l("Sale", "Satis");
    case "WRITEOFF":
      return l("Write-off", "Hurdaya ayirma");
    case "DEPRECIATION":
      return l("Depreciation", "Amortisman");
    default:
      return normalizeText(transactionType).toUpperCase() || "-";
  }
}

export const INTERNAL_COMMENT_MENTION_REGEX = /(^|[\s(])@([A-Za-z0-9._%+\-@]*)$/;

export function getInternalCommentMentionDraft(value, selectionStart) {
  const text = String(value || "");
  const caret =
    typeof selectionStart === "number" && Number.isFinite(selectionStart)
      ? Math.max(0, Math.min(selectionStart, text.length))
      : text.length;
  const beforeCaret = text.slice(0, caret);
  const match = beforeCaret.match(INTERNAL_COMMENT_MENTION_REGEX);
  if (!match) {
    return null;
  }
  const query = String(match[2] || "");
  return {
    query,
    replaceFrom: caret - query.length - 1,
    replaceTo: caret,
  };
}

export function shouldInsertMentionSpacer(nextCharacter) {
  return !/[\s),.;:!?]/.test(String(nextCharacter || ""));
}

export function normalizePositiveIntText(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "";
}

export function toPositiveDecimal(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(6));
}

export function buildFixedAssetSaleCreatePrefill(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) {
    return null;
  }
  const prefillMode = normalizeText(searchParams.get("prefillMode")).toUpperCase();
  if (prefillMode !== "FA_SALE") {
    return null;
  }
  const targetFixedAssetId = normalizePositiveIntText(
    searchParams.get("prefillTargetFixedAssetId")
  );
  if (!targetFixedAssetId) {
    return null;
  }
  const direction = normalizeText(searchParams.get("prefillDirection")).toUpperCase();
  return {
    mode: prefillMode,
    direction: direction === "AP" || direction === "AR" ? direction : "AR",
    targetFixedAssetId,
    legalEntityId: normalizePositiveIntText(searchParams.get("prefillLegalEntityId")),
    operatingUnitId: normalizePositiveIntText(searchParams.get("prefillOperatingUnitId")),
    assetNo: normalizeText(searchParams.get("prefillSourceAssetNo")),
    assetName: normalizeText(searchParams.get("prefillSourceAssetName")),
  };
}

export function clearFixedAssetSaleCreatePrefill(searchParams) {
  const nextParams = new URLSearchParams(searchParams);
  [
    "prefillMode",
    "prefillDirection",
    "prefillTargetFixedAssetId",
    "prefillLegalEntityId",
    "prefillOperatingUnitId",
    "prefillSourceAssetNo",
    "prefillSourceAssetName",
  ].forEach((key) => nextParams.delete(key));
  return nextParams;
}

export const POSTING_LINE_AMOUNT_EPSILON = 0.000001;

export function amountsMatch(left, right) {
  return (
    Math.abs(Number(left || 0) - Number(right || 0)) <= POSTING_LINE_AMOUNT_EPSILON
  );
}

export function createPostingLineDraft(seed = {}) {
  const rowId =
    globalThis.crypto?.randomUUID?.() ||
    `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    rowId,
    description: normalizeText(seed.description),
    amountTxn: normalizeOptionalDecimalText(seed.amountTxn),
    amountBase: normalizeOptionalDecimalText(seed.amountBase),
    offsetAccountId: normalizePositiveIntText(seed.offsetAccountId),
  };
}

export function mapPostableAccountRows(responseRows = []) {
  return (Array.isArray(responseRows) ? responseRows : [])
    .filter((row) => {
      const isActive = row?.is_active === true || Number(row?.is_active) === 1;
      const allowPosting = row?.allow_posting === true || Number(row?.allow_posting) === 1;
      return isActive && allowPosting;
    })
    .map((row) => ({
      id: Number(row?.id || 0),
      code: String(row?.code || "").trim(),
      name: String(row?.name || "").trim(),
      accountType: String(row?.account_type || "").trim().toUpperCase(),
    }))
    .filter((row) => row.id > 0 && row.code)
    .sort((left, right) =>
      String(left.code || "").localeCompare(String(right.code || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
}

export function extendAccountOptionsForSelectedLines(options, lines) {
  const normalizedOptions = Array.isArray(options) ? [...options] : [];
  const knownIds = new Set(
    normalizedOptions
      .map((row) => Number(row?.id || 0))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  const selectedIds = (Array.isArray(lines) ? lines : [])
    .map((line) => Number(line?.postingAccountId || 0))
    .filter((id) => Number.isInteger(id) && id > 0);
  selectedIds.forEach((id) => {
    if (!knownIds.has(id)) {
      normalizedOptions.unshift({
        id,
        code: `#${id}`,
        name: "Selected account is outside current lookup scope.",
        accountType: "",
      });
      knownIds.add(id);
    }
  });
  return normalizedOptions;
}

export function mapItemCardLookupOptions(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const value = String(toPositiveInt(row?.id) || "").trim();
      if (!value) {
        return null;
      }
      const code = normalizeText(row?.code);
      const name = normalizeText(row?.name);
      const itemType = normalizeText(row?.itemType || row?.item_type);
      return {
        value,
        label:
          code && name
            ? `${code} - ${name}`
            : code || name || `Item card #${value}`,
        description: itemType || undefined,
      };
    })
    .filter(Boolean);
}

export function extendItemCardOptionsForSelectedLines(options, lines) {
  const normalizedOptions = Array.isArray(options) ? [...options] : [];
  const knownValues = new Set(
    normalizedOptions.map((row) => String(row?.value || "").trim()).filter(Boolean)
  );
  const selectedIds = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line?.itemCardId || "").trim())
    .filter(Boolean);
  selectedIds.forEach((value) => {
    if (!knownValues.has(value)) {
      normalizedOptions.unshift({
        value,
        label: `Item card #${value}`,
        description: "Selected value is outside current lookup scope.",
      });
      knownValues.add(value);
    }
  });
  return normalizedOptions;
}

export function mapWarehouseLookupOptions(rows = [], l) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const value = String(toPositiveInt(row?.id) || "").trim();
      if (!value) {
        return null;
      }
      const operatingUnitId = toPositiveInt(
        row?.operatingUnitId ?? row?.operating_unit_id
      );
      const operatingUnitCode = normalizeText(
        row?.operatingUnitCode ?? row?.operating_unit_code
      );
      const operatingUnitName = normalizeText(
        row?.operatingUnitName ?? row?.operating_unit_name
      );
      const ownershipScope = normalizeText(
        row?.ownershipScope ?? row?.ownership_scope
      ).toUpperCase();
      const scopeLabel =
        ownershipScope === "OPERATING_UNIT"
          ? l(
              `Branch ${operatingUnitCode || operatingUnitName || `#${operatingUnitId || "?"}`}`,
              `Sube ${operatingUnitCode || operatingUnitName || `#${operatingUnitId || "?"}`}`
            )
          : l("Central ownership context", "Merkez sahiplik baglami");
      return {
        value,
        label: formatWarehouseDisplay(row?.id, row?.code, row?.name),
        description: scopeLabel,
      };
    })
    .filter(Boolean);
}

export function extendWarehouseOptionsForSelectedLines(options, lines, l) {
  const normalizedOptions = Array.isArray(options) ? [...options] : [];
  const knownValues = new Set(
    normalizedOptions.map((row) => String(row?.value || "").trim()).filter(Boolean)
  );
  const selectedRows = (Array.isArray(lines) ? lines : [])
    .map((line) => createDocumentLineDraft(line))
    .filter((line) => normalizeText(line.warehouseId))
    .map((line) => ({
      value: String(line.warehouseId).trim(),
      label: formatWarehouseDisplay(line.warehouseId, line.warehouseCode, line.warehouseName),
    }));
  selectedRows.forEach((row) => {
    if (!knownValues.has(row.value)) {
      normalizedOptions.unshift({
        value: row.value,
        label: row.label === "-" ? `#${row.value}` : row.label,
        description: l(
          "Selected warehouse is outside current ownership-context scope.",
          "Secili depo guncel sahiplik baglami kapsami disinda."
        ),
        disabled: true,
      });
      knownValues.add(row.value);
    }
  });
  return normalizedOptions;
}

export function buildRowsById(rows = []) {
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [Number(row?.id || 0), row])
      .filter(([id]) => id > 0)
  );
}

export function mapFixedAssetCategoryLookupOptions(
  rows = [],
  accountRowsById = new Map(),
  l = (englishText) => englishText
) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const id = toPositiveInt(row?.id);
      if (!id) {
        return null;
      }
      const code = normalizeText(row?.code);
      const name = normalizeText(row?.name);
      const accountId = getFixedAssetCategoryDefaultAssetAccountId(row);
      const account = accountRowsById.get(accountId) || null;
      const setupIssue = buildFixedAssetCategorySetupIssue(row, id);
      const readinessDescription = setupIssue
        ? l(
            `Missing setup: ${formatFixedAssetCategorySetupRequirementList(
              setupIssue.missingRequirements,
              l
            )}.`,
            `Eksik kurulum: ${formatFixedAssetCategorySetupRequirementList(
              setupIssue.missingRequirements,
              l
            )}.`
          )
        : l(
            `Ready for asset creation. Asset account: ${formatPostableAccountDisplay(
              account,
              accountId
            )}`,
            `Varlik olusturma icin hazir. Varlik hesabi: ${formatPostableAccountDisplay(
              account,
              accountId
            )}`
          );
      return {
        value: String(id),
        label: code && name ? `${code} - ${name}` : code || name || `#${id}`,
        description: readinessDescription,
        disabled: Boolean(setupIssue),
      };
    })
    .filter(Boolean);
}

export function extendFixedAssetCategoryOptionsForSelectedLines(options, lines) {
  const normalizedOptions = Array.isArray(options) ? [...options] : [];
  const knownValues = new Set(
    normalizedOptions.map((row) => String(row?.value || "").trim()).filter(Boolean)
  );
  const selectedIds = (Array.isArray(lines) ? lines : [])
    .map((line) => normalizeText(line?.fixedAssetCategoryId))
    .filter(Boolean);
  selectedIds.forEach((value) => {
    if (!knownValues.has(value)) {
      normalizedOptions.unshift({
        value,
        label: `Category #${value}`,
        description: "Selected value is outside current lookup scope.",
      });
      knownValues.add(value);
    }
  });
  return normalizedOptions;
}

export function upsertFixedAssetCategoryRow(rows, nextRow) {
  const normalizedId = Number(nextRow?.id || 0);
  if (!normalizedId) {
    return Array.isArray(rows) ? [...rows] : [];
  }
  const mergedRows = [
    ...(Array.isArray(rows) ? rows : []).filter(
      (row) => Number(row?.id || 0) !== normalizedId
    ),
    nextRow,
  ];
  mergedRows.sort((left, right) =>
    String(left?.code || "").localeCompare(String(right?.code || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  return mergedRows;
}

export function mapFixedAssetLookupOptions(
  rows = [],
  operatingUnitsById = new Map(),
  eligibleStatuses = null
) {
  const allowedStatuses = Array.isArray(eligibleStatuses)
    ? new Set(eligibleStatuses.map((value) => String(value || "").trim().toUpperCase()))
    : null;
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      if (!allowedStatuses) {
        return true;
      }
      return allowedStatuses.has(normalizeText(row?.status).toUpperCase());
    })
    .map((row) => {
      const id = toPositiveInt(row?.id);
      if (!id) {
        return null;
      }
      const assetNo = normalizeText(row?.assetNo || row?.asset_no);
      const name = normalizeText(row?.name);
      const categoryCode = normalizeText(row?.categoryCode || row?.category_code);
      const categoryName = normalizeText(row?.categoryName || row?.category_name);
      const ownerOperatingUnitId = toPositiveInt(
        row?.ownerOperatingUnitId ?? row?.owner_operating_unit_id
      );
      const ownerOperatingUnit = operatingUnitsById.get(ownerOperatingUnitId) || null;
      const ownerLabel = ownerOperatingUnitId
        ? formatOperatingUnitDisplay(
            ownerOperatingUnitId,
            ownerOperatingUnit?.code,
            ownerOperatingUnit?.name
          )
        : "-";
      const categoryLabel =
        categoryCode && categoryName
          ? `${categoryCode} - ${categoryName}`
          : categoryCode || categoryName || "-";
      const status = normalizeText(row?.status).toUpperCase();
      return {
        value: String(id),
        label:
          assetNo && name ? `${assetNo} - ${name}` : assetNo || name || `Asset #${id}`,
        description: [categoryLabel, `Owner: ${ownerLabel}`, status || "-"]
          .filter(Boolean)
          .join(" | "),
      };
    })
    .filter(Boolean);
}

export function extendFixedAssetOptionsForSelectedLines(options, lines) {
  const normalizedOptions = Array.isArray(options) ? [...options] : [];
  const knownValues = new Set(
    normalizedOptions.map((row) => String(row?.value || "").trim()).filter(Boolean)
  );
  const selectedIds = (Array.isArray(lines) ? lines : [])
    .map((line) => normalizeText(line?.targetFixedAssetId))
    .filter(Boolean);
  selectedIds.forEach((value) => {
    if (!knownValues.has(value)) {
      normalizedOptions.unshift({
        value,
        label: `Asset #${value}`,
        description: "Selected value is outside current lookup scope.",
      });
      knownValues.add(value);
    }
  });
  return normalizedOptions;
}

export function allocateAmountAcrossUnits(amount, unitCount) {
  const totalUnits = toPositiveInt(unitCount);
  if (!totalUnits) {
    return [];
  }
  if (totalUnits === 1) {
    return [roundDocumentUiAmount(amount)];
  }
  const normalizedTotal = roundDocumentUiAmount(amount);
  const scaledTotal = Math.round(normalizedTotal * 1_000_000);
  const scaledBase = Math.floor(scaledTotal / totalUnits);
  const results = [];
  let allocated = 0;
  for (let index = 0; index < totalUnits; index += 1) {
    if (index === totalUnits - 1) {
      results.push((scaledTotal - allocated) / 1_000_000);
    } else {
      results.push(scaledBase / 1_000_000);
      allocated += scaledBase;
    }
  }
  return results.map((value) => roundDocumentUiAmount(value));
}

export function analyzeDocumentWarehouseBindings(
  form,
  {
    warehouseRowsById,
    warehouseLoading = false,
    warehouseError = "",
    l,
  } = {}
) {
  const normalizedMap =
    warehouseRowsById instanceof Map ? warehouseRowsById : new Map();
  const lines = normalizeDocumentFormLines(form?.lines);
  const lineErrors = new Map();
  const generalErrors = [];
  const stockLines = lines.filter(
    (line) => normalizeText(line.stockImpactMode).toUpperCase() !== "NONE"
  );
  if (stockLines.length === 0) {
    return {
      generalErrors,
      lineErrors,
      blockingMessages: [],
    };
  }
  if (warehouseError) {
    generalErrors.push(String(warehouseError).trim());
  } else if (warehouseLoading) {
    generalErrors.push(
      l(
        "Warehouse choices are still loading for the selected ownership context.",
        "Secili sahiplik baglami icin depo secenekleri hala yukleniyor."
      )
    );
  } else if (toPositiveInt(form?.legalEntityId) && normalizedMap.size === 0) {
    generalErrors.push(
      l(
        "No active warehouse exists for the selected ownership context.",
        "Secili sahiplik baglami icin aktif depo yok."
      )
    );
  }

  stockLines.forEach((line) => {
    const lineKey = String(line.rowId || `line-${line.lineNo || 0}`);
    const warehouseId = toPositiveInt(line.warehouseId);
    if (!warehouseId) {
      lineErrors.set(
        lineKey,
        l(
          "Select a warehouse for this stock-affecting line.",
          "Bu stok etkileyen satir icin depo secin."
        )
      );
      return;
    }
    if (!warehouseLoading && !warehouseError && !normalizedMap.has(warehouseId)) {
      lineErrors.set(
        lineKey,
        l(
          "Selected warehouse is outside the current ownership-context scope.",
          "Secili depo mevcut sahiplik baglami kapsami disinda."
        )
      );
    }
  });

  return {
    generalErrors,
    lineErrors,
    blockingMessages: [...new Set([...generalErrors, ...lineErrors.values()])],
  };
}

export function resolveLineDefaultsFromItemCard(itemCard, direction) {
  const normalizedDirection = normalizeDirection(direction);
  const itemType = normalizeText(itemCard?.itemType || itemCard?.item_type).toUpperCase();
  const isStockItem = itemType === "STOCK_ITEM";
  const postingAccountId =
    normalizedDirection === "AP"
      ? itemCard?.inventoryAssetAccountId ||
        itemCard?.inventory_asset_account_id ||
        itemCard?.defaultPurchaseAccountId ||
        itemCard?.default_purchase_account_id ||
        ""
      : itemCard?.defaultSalesAccountId ||
        itemCard?.default_sales_account_id ||
        "";
  const stockImpactMode = isStockItem
    ? normalizedDirection === "AP"
      ? "RECEIPT_PENDING"
      : normalizedDirection === "AR"
        ? "ISSUE_PENDING"
        : "NONE"
    : "NONE";
  return {
    itemCardId: String(toPositiveInt(itemCard?.id) || "").trim(),
    description: normalizeText(itemCard?.name),
    postingAccountId: String(toPositiveInt(postingAccountId) || "").trim(),
    taxCategoryCode: normalizeText(
      itemCard?.taxCategoryCode || itemCard?.tax_category_code
    ).toUpperCase(),
    stockImpactMode,
  };
}

export function getDefaultStockImpactModeForDirection(direction) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return "RECEIPT_PENDING";
  }
  if (normalizedDirection === "AR") {
    return "ISSUE_PENDING";
  }
  return "NONE";
}

export function buildChargeTargetDrafts(lines, chargeLineRowId, allocationPreview = null) {
  const eligibleTargets = listEligibleChargeTargetLines(lines, chargeLineRowId);
  const previewAllocations =
    allocationPreview?.chargeLinesByRowId instanceof Map
      ? allocationPreview.chargeLinesByRowId.get(String(chargeLineRowId))?.allocations || []
      : [];
  const previewAllocationByTargetRowId = new Map(
    previewAllocations.map((entry) => [String(entry.targetRowId || ""), entry])
  );
  return eligibleTargets.map((target) => {
    const previewAllocation =
      previewAllocationByTargetRowId.get(String(target.rowId || "")) || null;
    return {
      targetRowId: String(target.rowId || ""),
      targetLineNo: Number(target.lineNo || 0) || null,
      targetLineDescription: normalizeText(target.description),
      allocatedAmountTxn: previewAllocation
        ? String(roundDocumentUiAmount(previewAllocation.allocatedAmountTxn || 0))
        : "",
    };
  });
}

export function buildChargeAllocationMethodTransitionPatch(currentLine, nextMethod, lines) {
  const normalizedMethod = normalizeChargeAllocationMethod(nextMethod);
  if (normalizedMethod === "NONE") {
    return {
      chargeAllocationMethod: "NONE",
      chargeTargets: [],
    };
  }
  const allocationPreview = computeDocumentChargeAllocationPreview(lines);
  const currentTargets = Array.isArray(currentLine?.chargeTargets)
    ? currentLine.chargeTargets
    : [];
  const existingTargetByRowId = new Map(
    currentTargets
      .map((target) => [String(target?.targetRowId || ""), target])
      .filter(([rowId]) => rowId)
  );
  const targetDefaults = buildChargeTargetDrafts(
    lines,
    currentLine?.rowId,
    allocationPreview
  );
  const nextTargets = targetDefaults.map((target) => {
    const existingTarget = existingTargetByRowId.get(String(target.targetRowId || "")) || null;
    return {
      ...target,
      allocatedAmountTxn:
        normalizedMethod === "MANUAL"
          ? String(
              existingTarget?.allocatedAmountTxn
              || target.allocatedAmountTxn
              || ""
            ).trim()
          : String(existingTarget?.allocatedAmountTxn || "").trim(),
    };
  });
  return {
    chargeAllocationMethod: normalizedMethod,
    chargeTargets: nextTargets,
    subledgerType: "NONE",
    stockImpactMode: "NONE",
    warehouseId: "",
    warehouseCode: "",
    warehouseName: "",
  };
}

export function buildItemCardSelectionTransitionPatch(currentLine, itemCard, direction) {
  const currentDraftLine = createDocumentLineDraft(currentLine);
  if (currentDraftLine.subledgerType === "FIXED_ASSET") {
    return null;
  }
  const lineDefaults = resolveLineDefaultsFromItemCard(itemCard, direction);
  const nextSubledgerType = lineDefaults.stockImpactMode === "NONE" ? "NONE" : "STOCK";
  return lineDefaults.stockImpactMode === "NONE"
    ? {
        ...lineDefaults,
        subledgerType: nextSubledgerType,
        warehouseId: "",
        warehouseCode: "",
        warehouseName: "",
      }
    : {
        ...lineDefaults,
        subledgerType: nextSubledgerType,
        chargeAllocationMethod: "NONE",
        chargeTargets: [],
      };
}

export function buildSubledgerTypeTransitionPatch(line, nextSubledgerType, direction) {
  const currentLine = createDocumentLineDraft(line);
  const normalizedNextSubledgerType = DOCUMENT_LINE_SUBLEDGER_TYPES.includes(
    String(nextSubledgerType || "").trim().toUpperCase()
  )
    ? String(nextSubledgerType || "").trim().toUpperCase()
    : "NONE";
  const fixedAssetResetPatch = {
    targetFixedAssetId: "",
    fixedAssetMode: "",
    fixedAssetCategoryId: "",
    fixedAssetOwnerOperatingUnitId: "",
    fixedAssetLocationOperatingUnitId: "",
    fixedAssetNameOverride: "",
    fixedAssetSerialNo: "",
    fixedAssetTag: "",
    improvementEffectiveDate: "",
    revisedUsefulLifeMonths: "",
    lifeExtensionMonths: "",
  };
  const chargeResetPatch = {
    chargeAllocationMethod: "NONE",
    chargeTargets: [],
  };
  if (normalizedNextSubledgerType === "FIXED_ASSET") {
    return {
      ...fixedAssetResetPatch,
      ...chargeResetPatch,
      subledgerType: "FIXED_ASSET",
      itemCardId: "",
      postingAccountId: "",
      warehouseId: "",
      warehouseCode: "",
      warehouseName: "",
      stockImpactMode: "NONE",
      fixedAssetMode: normalizeDirection(direction) === "AP" ? "AUTO_CREATE" : "",
      quantity: normalizeDirection(direction) === "AR" ? "1" : currentLine.quantity,
    };
  }
  if (normalizedNextSubledgerType === "STOCK") {
    return {
      ...fixedAssetResetPatch,
      ...chargeResetPatch,
      subledgerType: "STOCK",
      ...(currentLine.subledgerType === "FIXED_ASSET"
        ? {
            warehouseId: "",
            warehouseCode: "",
            warehouseName: "",
          }
        : {}),
      stockImpactMode: getDefaultStockImpactModeForDirection(direction),
    };
  }
  return {
    ...fixedAssetResetPatch,
    ...chargeResetPatch,
    subledgerType: "NONE",
    ...(currentLine.subledgerType === "STOCK"
      ? {
          itemCardId: "",
        }
      : {}),
    warehouseId: "",
    warehouseCode: "",
    warehouseName: "",
    stockImpactMode: "NONE",
  };
}

export function resetDocumentLineTaxPreview(seed = {}) {
  return createDocumentLineDraft({
    ...seed,
    lineTaxAmountTxn: 0,
    taxes: [],
    previewStatus: seed?.taxCategoryCode ? "STALE" : "",
    previewError: "",
    previewUpdatedAt: "",
  });
}

export function buildFixedAssetModeTransitionPatch(line, nextMode, {
  defaultImprovementEffectiveDate = "",
} = {}) {
  const currentLine = createDocumentLineDraft(line);
  const requestedMode = String(nextMode || "").trim().toUpperCase();
  const normalizedMode = DOCUMENT_LINE_FIXED_ASSET_MODES.includes(requestedMode)
    ? requestedMode
    : "AUTO_CREATE";
  if (normalizedMode === "LINK_EXISTING") {
    return {
      fixedAssetMode: "LINK_EXISTING",
      targetFixedAssetId:
        currentLine.fixedAssetMode === "LINK_EXISTING"
          ? currentLine.targetFixedAssetId
          : "",
      fixedAssetCategoryId: "",
      fixedAssetOwnerOperatingUnitId: "",
      fixedAssetLocationOperatingUnitId: "",
      fixedAssetNameOverride: "",
      fixedAssetSerialNo: "",
      fixedAssetTag: "",
      improvementEffectiveDate: "",
      revisedUsefulLifeMonths: "",
      lifeExtensionMonths: "",
      quantity: "1",
    };
  }
  if (normalizedMode === "IMPROVE_EXISTING") {
    return {
      fixedAssetMode: "IMPROVE_EXISTING",
      targetFixedAssetId:
        currentLine.fixedAssetMode === "IMPROVE_EXISTING"
          ? currentLine.targetFixedAssetId
          : "",
      fixedAssetCategoryId: "",
      fixedAssetOwnerOperatingUnitId: "",
      fixedAssetLocationOperatingUnitId: "",
      fixedAssetNameOverride: "",
      fixedAssetSerialNo: "",
      fixedAssetTag: "",
      improvementEffectiveDate:
        currentLine.fixedAssetMode === "IMPROVE_EXISTING"
          ? currentLine.improvementEffectiveDate
          : String(defaultImprovementEffectiveDate || "").trim(),
      revisedUsefulLifeMonths:
        currentLine.fixedAssetMode === "IMPROVE_EXISTING"
          ? currentLine.revisedUsefulLifeMonths
          : "",
      lifeExtensionMonths:
        currentLine.fixedAssetMode === "IMPROVE_EXISTING"
          ? currentLine.lifeExtensionMonths
          : "",
      quantity: "1",
    };
  }
  return {
    fixedAssetMode: "AUTO_CREATE",
    targetFixedAssetId: "",
    fixedAssetCategoryId: currentLine.fixedAssetCategoryId,
    fixedAssetOwnerOperatingUnitId: currentLine.fixedAssetOwnerOperatingUnitId,
    fixedAssetLocationOperatingUnitId: currentLine.fixedAssetLocationOperatingUnitId,
    improvementEffectiveDate: "",
    revisedUsefulLifeMonths: "",
    lifeExtensionMonths: "",
  };
}

export function expandAutoCreateFixedAssetLine(line) {
  const normalizedLine = createDocumentLineDraft(line);
  const unitCount = toPositiveInt(normalizedLine.quantity);
  if (!unitCount || unitCount <= 1) {
    return [normalizedLine];
  }
  const amounts = computeDocumentLineAmounts(normalizedLine);
  const netAmounts = allocateAmountAcrossUnits(amounts.lineNetAmountTxn, unitCount);
  const taxAmounts = allocateAmountAcrossUnits(amounts.lineTaxAmountTxn, unitCount);
  return Array.from({ length: unitCount }, (_, index) =>
    createDocumentLineDraft({
      ...normalizedLine,
      rowId: index === 0 ? normalizedLine.rowId : undefined,
      quantity: "1",
      unitPriceTxn: String(netAmounts[index] ?? 0),
      lineNetAmountTxn: String(netAmounts[index] ?? 0),
      lineTaxAmountTxn: String(taxAmounts[index] ?? 0),
      lineGrossAmountTxn: String(
        roundDocumentUiAmount((netAmounts[index] ?? 0) + (taxAmounts[index] ?? 0))
      ),
      fixedAssetNameOverride: "",
      fixedAssetSerialNo: "",
      fixedAssetTag: "",
      taxes: [],
      previewStatus: normalizedLine.taxCategoryCode ? "STALE" : "",
      previewError: "",
      previewUpdatedAt: "",
    })
  );
}

export function buildInitialPostForm(snapshot = null) {
  const documentId = toPositiveInt(snapshot?.id);
  const amountTxn = normalizeOptionalDecimalText(
    snapshot?.amountTxn ?? snapshot?.amount_txn
  );
  const amountBase = normalizeOptionalDecimalText(
    snapshot?.amountBase ?? snapshot?.amount_base
  );
  return {
    documentId: documentId || null,
    useFxOverride: false,
    fxOverrideReason: "",
    offsetAccountId: "",
    showAllOffsetAccounts: false,
    usePostingLines: false,
    postingLines: [
      createPostingLineDraft({
        amountTxn,
        amountBase,
      }),
    ],
  };
}

export function documentUsesStoredLineTaxes(snapshot = null) {
  const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  return lines.some((line) => Array.isArray(line?.taxes) && line.taxes.length > 0);
}

export function normalizeRecurringCadence(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (DOCUMENT_RECURRING_TEMPLATE_CADENCES.includes(normalized)) {
    return normalized;
  }
  return "MONTHLY";
}

export function normalizeRecurringInterval(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "1";
}

export function normalizeRecurringAnchorDay(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    return "";
  }
  return String(parsed);
}

export function addDaysToIsoDate(dateText, daysToAdd) {
  const normalizedDateText = normalizeText(dateText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateText)) {
    return "";
  }
  const parsedDays = Number(daysToAdd || 0);
  const utcDate = new Date(`${normalizedDateText}T00:00:00Z`);
  if (Number.isNaN(utcDate.getTime()) || !Number.isFinite(parsedDays)) {
    return "";
  }
  utcDate.setUTCDate(utcDate.getUTCDate() + parsedDays);
  return utcDate.toISOString().slice(0, 10);
}

export function resolvePaymentTermDueDateCandidate(documentDate, paymentTermRow) {
  if (!paymentTermRow) {
    return "";
  }
  const dueDays = Number(paymentTermRow?.dueDays ?? paymentTermRow?.due_days ?? 0);
  const graceDays = Number(paymentTermRow?.graceDays ?? paymentTermRow?.grace_days ?? 0);
  if (!Number.isFinite(dueDays) || !Number.isFinite(graceDays)) {
    return "";
  }
  return addDaysToIsoDate(documentDate, dueDays + graceDays);
}

export function createInitialRecurringTemplateRule() {
  return {
    cadence: "MONTHLY",
    interval: "1",
    anchorDay: "",
  };
}

export function buildTemplateSafeDraftForm(input = {}) {
  const baseline = createInitialDraftForm();
  const direction = normalizeText(input?.direction).toUpperCase();
  const documentType = normalizeText(input?.documentType).toUpperCase();
  const settlementMode = normalizeDocumentSettlementMode(
    input?.settlementMode ?? input?.settlement_mode
  );
  const next = {
    legalEntityId: normalizePositiveIntText(input?.legalEntityId),
    operatingUnitId: normalizePositiveIntText(input?.operatingUnitId),
    counterpartyId: normalizePositiveIntText(input?.counterpartyId),
    paymentTermId: normalizePositiveIntText(input?.paymentTermId),
    settlementMode,
    settlementCashRegisterId:
      settlementMode === "IMMEDIATE_CASH"
        ? normalizePositiveIntText(
            input?.settlementCashRegisterId ?? input?.settlement_cash_register_id
          )
        : "",
    direction: DOCUMENT_DIRECTIONS.includes(direction) ? direction : baseline.direction,
    documentType: DOCUMENT_TYPES.includes(documentType)
      ? documentType
      : baseline.documentType,
    documentDate: normalizeText(input?.documentDate) || baseline.documentDate,
    dueDate: normalizeText(input?.dueDate),
    amountTxn: normalizeOptionalDecimalText(input?.amountTxn),
    amountBase: normalizeOptionalDecimalText(input?.amountBase),
    currencyCode: normalizeCurrencyCode(input?.currencyCode) || baseline.currencyCode,
    fxRate: normalizeOptionalDecimalText(input?.fxRate),
    lines: normalizeDocumentFormLines(input?.lines, {
      amountTxn: input?.amountTxn,
    }),
  };
  return { ...baseline, ...next };
}

export function buildRecurringTemplateRule(input = {}) {
  return {
    cadence: normalizeRecurringCadence(input?.cadence),
    interval: normalizeRecurringInterval(input?.interval),
    anchorDay: normalizeRecurringAnchorDay(input?.anchorDay),
  };
}

export function buildDocumentDraftTemplateDefinition({ form, recurringRule }) {
  return {
    version: 1,
    draftForm: buildTemplateSafeDraftForm(form),
    recurringRule: buildRecurringTemplateRule(recurringRule),
  };
}

export function resolveDocumentDraftTemplateState(savedView) {
  const definition =
    savedView?.definition && typeof savedView.definition === "object"
      ? savedView.definition
      : {};
  const draftForm = buildTemplateSafeDraftForm(
    definition?.draftForm && typeof definition.draftForm === "object"
      ? definition.draftForm
      : {}
  );
  const recurringRule = buildRecurringTemplateRule(
    definition?.recurringRule && typeof definition.recurringRule === "object"
      ? definition.recurringRule
      : {}
  );
  return { draftForm, recurringRule };
}

export function buildCloneDraftFormFromRow(row, fallbackForm, options = {}) {
  const preserveSourceDocumentDate = Boolean(options?.preserveSourceDocumentDate);
  const sourceDocumentDate = normalizeText(
    firstDefinedRowValue(row, "documentDate", "document_date")
  );
  const fallbackDocumentDate =
    preserveSourceDocumentDate && sourceDocumentDate
      ? sourceDocumentDate
      : normalizeText(fallbackForm?.documentDate) || todayIsoDate();
  const sourceForm = {
    legalEntityId: firstDefinedRowValue(row, "legalEntityId", "legal_entity_id"),
    operatingUnitId: firstDefinedRowValue(row, "operatingUnitId", "operating_unit_id"),
    counterpartyId: firstDefinedRowValue(row, "counterpartyId", "counterparty_id"),
    paymentTermId: firstDefinedRowValue(row, "paymentTermId", "payment_term_id"),
    settlementMode: firstDefinedRowValue(row, "settlementMode", "settlement_mode"),
    settlementCashRegisterId: firstDefinedRowValue(
      row,
      "settlementCashRegisterId",
      "settlement_cash_register_id"
    ),
    direction: firstDefinedRowValue(row, "direction"),
    documentType: firstDefinedRowValue(row, "documentType", "document_type"),
    documentDate: fallbackDocumentDate,
    dueDate: firstDefinedRowValue(
      row,
      "dueDate",
      "due_date",
      "dueDateSnapshot",
      "due_date_snapshot"
    ),
    amountTxn: firstDefinedRowValue(row, "amountTxn", "amount_txn"),
    amountBase: firstDefinedRowValue(row, "amountBase", "amount_base"),
    currencyCode: firstDefinedRowValue(
      row,
      "currencyCode",
      "currency_code",
      "currencyCodeSnapshot",
      "currency_code_snapshot"
    ),
    fxRate: firstDefinedRowValue(row, "fxRate", "fx_rate", "fxRateSnapshot", "fx_rate_snapshot"),
    lines: Array.isArray(row?.lines) ? row.lines : undefined,
  };
  const nextForm = buildTemplateSafeDraftForm(sourceForm);
  if (!nextForm.dueDate && requiresDueDate(nextForm.documentType)) {
    nextForm.dueDate = fallbackDocumentDate;
  }
  return nextForm;
}

export function normalizeVisibleColumnIds(candidateIds, defaultIds) {
  const fallback = Array.isArray(defaultIds) ? defaultIds.map(String) : [];
  const allowedIds = new Set(fallback);
  const normalized = Array.isArray(candidateIds)
    ? candidateIds
        .map((value) => String(value || "").trim())
        .filter((value, index, all) => value && all.indexOf(value) === index)
        .filter((value) => allowedIds.has(value))
    : [];
  return normalized.length > 0 ? normalized : fallback;
}

export function buildDocumentSavedViewDefinition({ filters, tablePrefs, columnIds }) {
  return {
    version: 1,
    filters: {
      ...DEFAULT_FILTERS,
      ...(filters && typeof filters === "object" ? filters : {}),
    },
    tablePrefs: {
      rowsPerPage:
        toPositiveInt(tablePrefs?.rowsPerPage) || DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
      stickyHeader: Boolean(tablePrefs?.stickyHeader),
      visibleColumnIds: normalizeVisibleColumnIds(
        tablePrefs?.visibleColumnIds,
        columnIds
      ),
    },
  };
}

export function resolveDocumentSavedViewState(savedView, columnIds) {
  const definition =
    savedView?.definition && typeof savedView.definition === "object"
      ? savedView.definition
      : {};
  const nextFilters = {
    ...DEFAULT_FILTERS,
    ...(definition.filters && typeof definition.filters === "object"
      ? definition.filters
      : {}),
  };
  const tablePrefs = {
    rowsPerPage:
      toPositiveInt(definition?.tablePrefs?.rowsPerPage) ||
      DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
    stickyHeader: Boolean(definition?.tablePrefs?.stickyHeader),
    visibleColumnIds: normalizeVisibleColumnIds(
      definition?.tablePrefs?.visibleColumnIds,
      columnIds
    ),
  };
  return { filters: nextFilters, tablePrefs };
}

/**
 * Create the baseline AP/AR draft form state.
 *
 * Currency is intentionally blank until the selected legal entity can provide
 * its functional/book currency. This avoids showing a misleading USD default
 * before scope context finishes loading.
 */
export function createInitialDraftForm() {
  return {
    legalEntityId: "",
    operatingUnitId: "",
    counterpartyId: "",
    paymentTermId: "",
    settlementMode: "ACCRUAL",
    settlementCashRegisterId: "",
    direction: "AR",
    documentType: "INVOICE",
    documentDate: todayIsoDate(),
    dueDate: "",
    amountTxn: "",
    amountBase: "",
    currencyCode: "",
    fxRate: "",
    lines: [createDocumentLineDraft()],
  };
}

export function buildDirectionScopedDraftForm(previousForm, nextDirection) {
  const baseline = createInitialDraftForm();
  const normalizedDirection = normalizeText(nextDirection).toUpperCase();
  return {
    ...baseline,
    legalEntityId: normalizeText(previousForm?.legalEntityId) || baseline.legalEntityId,
    direction: DOCUMENT_DIRECTIONS.includes(normalizedDirection)
      ? normalizedDirection
      : baseline.direction,
    documentType: normalizeText(previousForm?.documentType) || baseline.documentType,
    documentDate: normalizeText(previousForm?.documentDate) || baseline.documentDate,
    currencyCode: normalizeCurrencyCode(previousForm?.currencyCode) || baseline.currencyCode,
  };
}

export function normalizeApiError(error, fallback = "Operation failed.") {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

export function normalizeTranslatedApiError(error, translateMessage, fallback = "Operation failed.") {
  const rawMessage = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  const translatedMessage =
    typeof translateMessage === "function" ? translateMessage(rawMessage) : rawMessage;
  const resolvedMessage = String(translatedMessage || rawMessage || fallback).trim() || fallback;
  return requestId ? `${resolvedMessage} (requestId: ${requestId})` : resolvedMessage;
}

export function buildTaxCategoryOptions(ruleRows = [], legalEntityId, lines = []) {
  const selectedLegalEntityId = toPositiveInt(legalEntityId);
  const values = new Set();

  for (const row of Array.isArray(ruleRows) ? ruleRows : []) {
    const taxCategoryCode = normalizeText(row?.taxCategoryCode).toUpperCase();
    if (!taxCategoryCode) {
      continue;
    }
    const regimeLegalEntityId = toPositiveInt(row?.regimeLegalEntityId);
    if (
      selectedLegalEntityId &&
      regimeLegalEntityId &&
      regimeLegalEntityId !== selectedLegalEntityId
    ) {
      continue;
    }
    values.add(taxCategoryCode);
  }

  for (const line of Array.isArray(lines) ? lines : []) {
    const taxCategoryCode = normalizeText(line?.taxCategoryCode).toUpperCase();
    if (taxCategoryCode) {
      values.add(taxCategoryCode);
    }
  }

  return Array.from(values)
    .sort((left, right) =>
      left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    )
    .map((value) => ({ value, label: value }));
}

export function normalizeInventoryReverseBlocks(error) {
  const rows =
    error?.response?.data?.details?.inventoryBlocks ??
    error?.details?.inventoryBlocks ??
    [];
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => ({
    stockLinkId: toPositiveInt(row?.stockLinkId),
    documentLineId: toPositiveInt(row?.documentLineId),
    documentLineNo: Number(row?.documentLineNo || 0),
    stockImpactMode: normalizeText(row?.stockImpactMode).toUpperCase(),
    linkStatus: normalizeText(row?.linkStatus).toUpperCase(),
    inventoryMovementId: toPositiveInt(row?.inventoryMovementId),
    inventoryMovementType: normalizeText(row?.inventoryMovementType).toUpperCase(),
    inventoryValuationStatus: normalizeText(row?.inventoryValuationStatus).toUpperCase(),
    inventoryMovementDate: normalizeText(row?.inventoryMovementDate),
    warehouseCode: normalizeText(row?.warehouseCode),
    warehouseName: normalizeText(row?.warehouseName),
    itemCardCode: normalizeText(row?.itemCardCode),
    itemCardName: normalizeText(row?.itemCardName),
    requestedQuantity:
      row?.requestedQuantity === null || row?.requestedQuantity === undefined
        ? null
        : Number(row.requestedQuantity),
    suggestedActionCode: normalizeText(row?.suggestedActionCode).toUpperCase(),
    suggestedActionMessage: normalizeText(row?.suggestedActionMessage),
  }));
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

export function formatFileSize(bytes) {
  const parsed = Number(bytes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = parsed;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export function isDraft(row) {
  return String(row?.status || "").toUpperCase() === "DRAFT";
}

export function isSubmitted(row) {
  return String(row?.status || "").toUpperCase() === "SUBMITTED";
}

export function isReturned(row) {
  return String(row?.status || "").toUpperCase() === "RETURNED";
}

export function isApproved(row) {
  return String(row?.status || "").toUpperCase() === "APPROVED";
}

export function isPosted(row) {
  return String(row?.status || "").toUpperCase() === "POSTED";
}

export function isDocClassWorkflowGoverned(row) {
  return isDocClassWorkflowGovernedByMetadata({
    direction: row?.direction,
    documentType: row?.documentType ?? row?.document_type,
    isWorkflowGoverned: row?.isWorkflowGoverned ?? row?.is_workflow_governed,
  });
}

export function canSubmitDocument(row) {
  return canCariDocumentBeSubmittedByStatus(row);
}

export function canCancelDocument(row) {
  return canCariDocumentBeCancelledByStatus(row);
}

export function isImmediateCashSettled(row) {
  return (
    String(row?.status || "").toUpperCase() === "SETTLED" &&
    isImmediateCashSettlementMode(
      firstDefinedRowValue(row, "settlementMode", "settlement_mode")
    ) &&
    toPositiveInt(
      firstDefinedRowValue(row, "autoSettlementBatchId", "auto_settlement_batch_id")
    ) &&
    toPositiveInt(
      firstDefinedRowValue(
        row,
        "autoSettlementCashTransactionId",
        "auto_settlement_cash_transaction_id"
      )
    )
  );
}

export function canReverseDocument(row) {
  return isPosted(row) || isImmediateCashSettled(row);
}

export function resolveCounterpartyRoleFromDirection(direction) {
  const normalized = String(direction || "").trim().toUpperCase();
  if (normalized === "AR") return "CUSTOMER";
  if (normalized === "AP") return "VENDOR";
  return undefined;
}

export function normalizeDocumentSettlementMode(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (DOCUMENT_SETTLEMENT_MODES.includes(normalized)) {
    return normalized;
  }
  return "ACCRUAL";
}

export function isImmediateCashSettlementMode(value) {
  return normalizeDocumentSettlementMode(value) === "IMMEDIATE_CASH";
}

export function getImmediateCashSettlementLabel(direction, l) {
  return normalizeDirection(direction) === "AP"
    ? l("Cash Purchase", "Nakit Alis")
    : l("Cash Sale", "Nakit Satis");
}

export function formatCashRegisterLookupLabel(register, l) {
  const code = normalizeText(register?.code);
  const name = normalizeText(register?.name);
  const currencyCode = normalizeCurrencyCode(
    register?.currencyCode ?? register?.currency_code
  );
  const sessionMode = normalizeText(
    register?.sessionMode ?? register?.session_mode
  ).toUpperCase();
  const ownershipContextLabel = normalizeText(register?.ownershipContextLabel);
  const operatingUnitCode = normalizeText(
    register?.operatingUnitCode ?? register?.operating_unit_code
  );
  const normalizedOwnershipContext = ownershipContextLabel
    ? ownershipContextLabel === "Central / HQ" ||
      ownershipContextLabel === "Merkez / HQ" ||
      ownershipContextLabel === "Central" ||
      ownershipContextLabel === "Merkez"
      ? l("Central", "Merkez")
      : ownershipContextLabel.startsWith("OU:")
        ? ownershipContextLabel
        : operatingUnitCode
          ? `OU: ${operatingUnitCode}`
          : ownershipContextLabel
    : operatingUnitCode
      ? `OU: ${operatingUnitCode}`
      : l("Central", "Merkez");
  const parts = [];
  if (code || name) {
    parts.push([code, name].filter(Boolean).join(" - "));
  }
  if (currencyCode) {
    parts.push(currencyCode);
  }
  if (sessionMode) {
    parts.push(`session=${sessionMode}`);
  }
  parts.push(normalizedOwnershipContext);
  return parts.filter(Boolean).join(" | ") || "-";
}

export function mapCashRegisterLookupOptions(rows = [], l) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const value = String(toPositiveInt(row?.id) || "").trim();
      if (!value) {
        return null;
      }
      return {
        value,
        label: formatCashRegisterLookupLabel(row, l),
      };
    })
    .filter(Boolean);
}

export function extendCashRegisterOptionsForSelectedValue(options, selectedValue, l) {
  const normalizedOptions = Array.isArray(options) ? [...options] : [];
  const selectedId = normalizeText(selectedValue);
  if (!selectedId) {
    return normalizedOptions;
  }
  const knownValues = new Set(
    normalizedOptions.map((row) => String(row?.value || "").trim()).filter(Boolean)
  );
  if (!knownValues.has(selectedId)) {
    normalizedOptions.unshift({
      value: selectedId,
      label: `Cash register #${selectedId}`,
      description: l(
        "Selected value is outside current lookup scope.",
        "Secili deger guncel arama kapsaminda degil."
      ),
    });
  }
  return normalizedOptions;
}

export function translateDocumentMutationLineErrorMap(lineErrors, translateMessage) {
  if (!(lineErrors instanceof Map) || typeof translateMessage !== "function") {
    return new Map();
  }
  const translated = new Map();
  for (const [rowId, messages] of lineErrors.entries()) {
    const translatedMessages = (Array.isArray(messages) ? messages : [])
      .map((message) => translateMessage(message))
      .filter(Boolean);
    if (translatedMessages.length > 0) {
      translated.set(String(rowId || ""), translatedMessages);
    }
  }
  return translated;
}

export function resolveRouteFixedDirection(directionProp, searchParams) {
  const propDirection = normalizeDirection(directionProp);
  if (propDirection) {
    return propDirection;
  }
  if (!(searchParams instanceof URLSearchParams)) {
    return "";
  }
  return normalizeDirection(searchParams.get("direction"));
}

export function getDocumentPageTitle(direction, l) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return l("Vendor Bills", "Alis Faturalari");
  }
  if (normalizedDirection === "AR") {
    return l("Sales Invoices", "Satis Faturalari");
  }
  return l("Cari Documents", "Cari Belgeler");
}

export function getCreateDraftDocumentTitle(direction, l) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return l("Create Vendor Bill Draft", "Alis Faturasi Taslagi Olustur");
  }
  if (normalizedDirection === "AR") {
    return l("Create Sales Invoice Draft", "Satis Faturasi Taslagi Olustur");
  }
  return l("Create Draft Document", "Belge Taslagi Olustur");
}

export function resolveOffsetAccountTypeByDirection(direction) {
  const normalized = normalizeDirection(direction);
  if (normalized === "AR") {
    return "REVENUE";
  }
  if (normalized === "AP") {
    return "EXPENSE";
  }
  return "";
}

export function mapCounterpartyLookupOption(row) {
  const id = toPositiveInt(row?.id);
  const code = String(row?.code || id || "").trim();
  const name = String(row?.name || "").trim();
  const counterpartyType = String(row?.counterpartyType || "OTHER")
    .trim()
    .toUpperCase();
  return {
    value: id ? String(id) : "",
    label: name ? `${code || id} - ${name}` : String(code || id || "-"),
    description: counterpartyType || "OTHER",
  };
}

export function mapLegalEntityLookupOption(row) {
  const id = toPositiveInt(row?.id);
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  const functionalCurrencyCode = normalizeCurrencyCode(
    row?.functional_currency_code || row?.functionalCurrencyCode
  );
  const currencyDescription = functionalCurrencyCode
    ? `Functional currency: ${functionalCurrencyCode}`
    : "";

  return {
    value: id ? String(id) : "",
    label: name ? `${code || id} - ${name}` : String(code || id || "-"),
    description: currencyDescription,
  };
}

export function mapPaymentTermLookupOption(row) {
  const id = toPositiveInt(row?.id);
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  const dueDaysRaw = Number(row?.dueDays ?? row?.due_days);
  const dueDaysText =
    Number.isFinite(dueDaysRaw) && dueDaysRaw >= 0 ? `Due ${dueDaysRaw} day(s)` : "";
  const status = normalizeText(row?.status).toUpperCase();
  const statusText = status && status !== "ACTIVE" ? status : "";

  return {
    value: id ? String(id) : "",
    label: name ? `${code || id} - ${name}` : String(code || id || "-"),
    description: [dueDaysText, statusText].filter(Boolean).join(" | "),
  };
}

export function mapOperatingUnitLookupOption(row) {
  const id = toPositiveInt(row?.id);
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  const status = normalizeText(row?.status).toUpperCase();
  const statusText = status && status !== "ACTIVE" ? status : "";

  return {
    value: id ? String(id) : "",
    label: name ? `${code || id} - ${name}` : String(code || id || "-"),
    description: statusText,
  };
}

export function formatOperatingUnitDisplay(unitId, unitCode, unitName) {
  const code = normalizeText(unitCode);
  const name = normalizeText(unitName);
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code) {
    return code;
  }
  if (name) {
    return name;
  }
  return unitId ? `#${unitId}` : "-";
}

export function buildOperatingUnitsById(...collections) {
  const unitsById = new Map();
  for (const collection of collections) {
    for (const row of collection || []) {
      const id = toPositiveInt(row?.id);
      if (!id) {
        continue;
      }
      const code = normalizeText(row?.code);
      const name = normalizeText(row?.name);
      if (!code && !name) {
        continue;
      }
      unitsById.set(id, { code, name });
    }
  }
  return unitsById;
}

export function getDocumentOperatingUnitLabel(row, operatingUnitsById = new Map()) {
  const unitId = toPositiveInt(
    firstDefinedRowValue(row, "operatingUnitId", "operating_unit_id")
  );
  const lookupUnit = unitId ? operatingUnitsById.get(unitId) || null : null;
  return formatOperatingUnitDisplay(
    unitId,
    firstDefinedRowValue(row, "operatingUnitCode", "operating_unit_code") || lookupUnit?.code,
    firstDefinedRowValue(row, "operatingUnitName", "operating_unit_name") || lookupUnit?.name
  );
}

export function formatLegalEntityDisplay(legalEntityId, code = "", name = "") {
  const normalizedCode = normalizeText(code);
  const normalizedName = normalizeText(name);
  if (normalizedCode && normalizedName) {
    return `${normalizedCode} - ${normalizedName}`;
  }
  if (normalizedCode || normalizedName) {
    return normalizedCode || normalizedName;
  }
  const normalizedId = toPositiveInt(legalEntityId);
  return normalizedId ? `#${normalizedId}` : "-";
}

export function getDocumentLegalEntityLabel(row) {
  return formatLegalEntityDisplay(
    firstDefinedRowValue(row, "legalEntityId", "legal_entity_id"),
    firstDefinedRowValue(row, "legalEntityCode", "legal_entity_code"),
    firstDefinedRowValue(row, "legalEntityName", "legal_entity_name")
  );
}

export function normalizeWorkflowGateState(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (
    normalized === "NONE" ||
    normalized === "PENDING" ||
    normalized === "RETURNED" ||
    normalized === "APPROVED" ||
    normalized === "BLOCKED"
  ) {
    return normalized;
  }
  return "NONE";
}

export function buildDocumentLifecycleEvents(row, translate = (en) => en) {
  if (!row) {
    return [];
  }
  const status = String(row?.status || "")
    .trim()
    .toUpperCase();
  const createdAt = row?.createdAt || row?.created_at || null;
  const updatedAt = row?.updatedAt || row?.updated_at || null;
  const postedAt = row?.postedAt || row?.posted_at || null;
  const reversedAt = row?.reversedAt || row?.reversed_at || null;
  const returnedAt = row?.returnedAt || row?.returned_at || null;
  const returnReason = normalizeText(row?.returnReason || row?.return_reason);

  const events = [];
  if (createdAt) {
    events.push({
      statusCode: "DRAFT",
      at: createdAt,
      note: translate("Draft created.", "Taslak olusturuldu."),
    });
  }
  if (status === "SUBMITTED") {
    events.push({
      statusCode: "SUBMITTED",
      at: updatedAt || createdAt,
      note: translate(
        "Submitted for approval (timestamp inferred from updatedAt).",
        "Onaya gonderildi (zaman bilgisi updatedAt alanindan tahmin edildi)."
      ),
    });
  }
  if (status === "APPROVED") {
    events.push({
      statusCode: "APPROVED",
      at: updatedAt || createdAt,
      note: translate(
        "Approved for posting (timestamp inferred from updatedAt).",
        "Kayit icin onaylandi (zaman bilgisi updatedAt alanindan tahmin edildi)."
      ),
    });
  }
  if (status === "RETURNED") {
    events.push({
      statusCode: "RETURNED",
      at: returnedAt || updatedAt || createdAt,
      note: returnReason
        ? translate(
            `Returned for correction: ${returnReason}`,
            `Duzeltme icin iade edildi: ${returnReason}`
          )
        : translate(
            "Returned for correction.",
            "Duzeltme icin iade edildi."
          ),
    });
  }
  if (postedAt) {
    events.push({
      statusCode: "POSTED",
      at: postedAt,
      note: translate("Posted to journal.", "Yevmiyeye kaydedildi."),
    });
  }
  if (status === "PARTIALLY_SETTLED") {
    events.push({
      statusCode: "PARTIALLY_SETTLED",
      at: updatedAt,
      note: updatedAt
        ? translate(
            "Partially settled (timestamp inferred from updatedAt).",
            "Kismen mahsuplastirildi (zaman bilgisi updatedAt alanindan tahmin edildi)."
          )
        : translate("Partially settled.", "Kismen mahsuplastirildi."),
    });
  }
  if (status === "SETTLED") {
    events.push({
      statusCode: "SETTLED",
      at: updatedAt,
      note: updatedAt
        ? translate(
            "Settled (timestamp inferred from updatedAt).",
            "Mahsuplastirildi (zaman bilgisi updatedAt alanindan tahmin edildi)."
          )
        : translate("Settled.", "Mahsuplastirildi."),
    });
  }
  if (status === "CANCELLED") {
    events.push({
      statusCode: "CANCELLED",
      at: updatedAt || createdAt,
      note: updatedAt
        ? translate(
            "Cancelled (timestamp inferred from updatedAt).",
            "Iptal edildi (zaman bilgisi updatedAt alanindan tahmin edildi)."
          )
        : translate("Cancelled.", "Iptal edildi."),
    });
  }
  if (status === "REVERSED") {
    events.push({
      statusCode: "REVERSED",
      at: reversedAt || updatedAt,
      note: reversedAt
        ? translate("Reversal completed.", "Ters kayit tamamlandi.")
        : translate(
            "Reversed (timestamp inferred from updatedAt).",
            "Terslendi (zaman bilgisi updatedAt alanindan tahmin edildi)."
          ),
    });
  }
  return events;
}

export function formatReadinessReason(reason, translate = (en) => en) {
  switch (String(reason || "").trim().toUpperCase()) {
    case "ACCOUNT_NOT_FOUND":
      return translate(
        "Mapped account no longer exists.",
        "Eslenen hesap artik mevcut degil."
      );
    case "ACCOUNT_INACTIVE":
      return translate("Mapped account is inactive.", "Eslenen hesap pasif.");
    case "ACCOUNT_NOT_POSTABLE":
      return translate(
        "Mapped account is not postable.",
        "Eslenen hesap kayit yapilabilir degil."
      );
    case "ACCOUNT_SCOPE_NOT_LEGAL_ENTITY":
      return translate(
        "Mapped account is not in a legal-entity chart.",
        "Eslenen hesap tuzel kisilik hesap planinda degil."
      );
    case "ACCOUNT_LEGAL_ENTITY_MISMATCH":
      return translate(
        "Mapped account belongs to a different legal entity.",
        "Eslenen hesap farkli bir tuzel kisilige ait."
      );
    case "PURPOSES_MUST_MAP_TO_DIFFERENT_ACCOUNTS":
      return translate(
        "Control and offset must map to different accounts.",
        "Kontrol ve karsi hesap farkli hesaplara eslenmelidir."
      );
    case "MAPPED_ACCOUNT_ID_INVALID":
      return translate("Mapped account id is invalid.", "Eslenen hesap id gecersiz.");
    case "ACCOUNT_TENANT_MISMATCH":
      return translate(
        "Mapped account belongs to a different tenant.",
        "Eslenen hesap farkli bir tenant'a ait."
      );
    case "ACCOUNT_TYPE_MISMATCH":
      return translate(
        "Mapped account type does not match this purpose.",
        "Eslenen hesap turu bu amacla uyusmuyor."
      );
    case "ACCOUNT_NORMAL_SIDE_MISMATCH":
      return translate(
        "Mapped account normal side does not match this purpose.",
        "Eslenen hesap normal bakiye yonu bu amacla uyusmuyor."
      );
    default:
      return String(reason || translate("Invalid mapping.", "Gecersiz esleme."));
  }
}
