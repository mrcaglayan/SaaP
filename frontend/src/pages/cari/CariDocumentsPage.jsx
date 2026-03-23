import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useCallback } from "react";
import {
  cancelCariDocument,
  createCariDocumentComment,
  createCariDocumentEvidence,
  createCariDocument,
  deleteCariDocumentEvidence,
  downloadCariDocumentEvidence,
  getCariDocument,
  listCariDocumentWarehouseOptions,
  getCariDocumentOpenItems,
  listCariDocumentComments,
  listCariDocumentEvidence,
  listCariDocumentMentionCandidates,
  listCariDocuments,
  getCariDocumentOpsStatus,
  postCariDocument,
  reverseCariDocument,
  upsertCariDocumentOpsStatus,
  uploadCariDocumentEvidenceContent,
  updateCariDocument,
} from "../../api/cariDocuments.js";
import {
  createCariCounterparty,
  listCariCounterparties,
} from "../../api/cariCounterparty.js";
import { listCariPaymentTerms } from "../../api/cariPaymentTerms.js";
import { getCariCounterpartyStatementReport } from "../../api/cariReports.js";
import { listCashRegisters } from "../../api/cashAdmin.js";
import { getJournal, listAccounts } from "../../api/glAdmin.js";
import { listItemCards } from "../../api/itemCards.js";
import { listExceptionWorkbench } from "../../api/exceptionsWorkbench.js";
import {
  createFixedAsset,
  listFixedAssetCategories,
  listFixedAssets,
} from "../../api/fixedAssets.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";
import { listCariAudit } from "../../api/cariAudit.js";
import { listTaxRules, previewTaxComputation } from "../../api/taxAdmin.js";
import {
  createMeSavedView,
  deleteMeSavedView,
  listMeSavedViews,
  updateMeSavedView,
} from "../../api/me.js";
import Combobox from "../../components/Combobox.jsx";
import MoneyText from "../../components/MoneyText.jsx";
import StatusTimeline from "../../components/StatusTimeline.jsx";
import TablePreferencesPanel from "../../components/TablePreferencesPanel.jsx";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { useWorkingContextDefaults } from "../../context/useWorkingContextDefaults.js";
import { usePersistedFilters } from "../../hooks/usePersistedFilters.js";
import { usePersistedTablePrefs } from "../../hooks/usePersistedTablePrefs.js";
import {
  buildLifecycleTimelineSteps,
  getLifecycleAllowedActions,
  getLifecycleStatusMeta,
} from "../../lifecycle/lifecycleRules.js";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import { exportRowsAsCsv } from "../../utils/csvExport.js";
import {
  buildDocumentListQuery,
  buildDocumentMutationPayload,
  computeDocumentLineAmounts,
  createDocumentLineDraft,
  DOCUMENT_LINE_FIXED_ASSET_MODES,
  DOCUMENT_LINE_KINDS,
  DOCUMENT_LINE_STOCK_IMPACT_MODES,
  DOCUMENT_LINE_SUBLEDGER_TYPES,
  DOCUMENT_DIRECTIONS,
  DOCUMENT_SETTLEMENT_MODES,
  getDocumentLineTotals,
  DOCUMENT_STATUSES,
  normalizeDocumentFormLines,
  DOCUMENT_TYPES,
  getDocumentFxComputation,
  mapDocumentRowToForm,
  requiresDueDate,
  validateDocumentMutationForm,
} from "./cariDocumentsUtils.js";
import {
  buildInlineCounterpartyCode,
  normalizeLookupQuery,
  prependOrReplaceCounterpartyOption,
  resolveInlineCounterpartyRoleFlags,
} from "./counterpartyInlineCreate.js";

const DEFAULT_FILTERS = {
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

const DOCUMENT_FILTER_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "dateFrom" },
  { stateKey: "dateTo" },
];

const DOCUMENT_CREATE_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  {
    stateKey: "documentDate",
    contextKey: "dateTo",
    allowContextValue: (contextValue) => /^\d{4}-\d{2}-\d{2}$/.test(String(contextValue || "").trim()),
  },
];
const DOCUMENT_FILTERS_STORAGE_SCOPE = "cari-documents.list";
const DOCUMENT_TABLE_PREFS_STORAGE_SCOPE = "cari-documents.list.table";
const DOCUMENT_SAVED_VIEW_MODULE_CODE = "CARI_DOCUMENTS_LIST";
const DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE = "CARI_DOCUMENT_DRAFT_TEMPLATES";
const DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE = 50;
const DOCUMENT_TABLE_ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 200];
const INVENTORY_MOVEMENTS_ROUTE = "/app/stok-yansitma-islemleri";
const FIXED_ASSET_SETTINGS_PATH = "/app/ayarlar/demirbas-ayarlari";
const INVENTORY_TRANSFERS_ROUTE = "/app/stok-transferleri";
const FIXED_ASSET_DETAIL_ROUTE_PREFIX = "/app/demirbas-karti-detayi";
const DOCUMENT_LINE_EXPANSION_LIMIT = 500;
const LINE_TEXT_INPUT_COMMIT_DELAY_MS = 180;
const FIXED_ASSET_AR_ELIGIBLE_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
];
const FIXED_ASSET_AP_MODE_OPTIONS = DOCUMENT_LINE_FIXED_ASSET_MODES.filter(
  (value) => value === "AUTO_CREATE" || value === "LINK_EXISTING"
);
const DOCUMENT_RECURRING_TEMPLATE_CADENCES = [
  "NONE",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
];
const DOCUMENT_EXPORT_COLUMNS = [
  { header: "ID", value: (row) => row?.id },
  { header: "Document No", value: (row) => firstDefinedRowValue(row, "documentNo", "document_no") },
  { header: "Legal Entity ID", value: (row) => firstDefinedRowValue(row, "legalEntityId", "legal_entity_id") },
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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function firstDefinedRowValue(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key];
    }
  }
  return "";
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildInventoryMovementLink(legalEntityId, movementId = null) {
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

function buildInventoryTransferLink({
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

function extractTransferRequiredGuidanceFromError(error) {
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

const INTERNAL_COMMENT_MENTION_REGEX = /(^|[\s(])@([A-Za-z0-9._%+\-@]*)$/;

function getInternalCommentMentionDraft(value, selectionStart) {
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

function shouldInsertMentionSpacer(nextCharacter) {
  return !/[\s),.;:!?]/.test(String(nextCharacter || ""));
}

function normalizeCurrencyCode(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePositiveIntText(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "";
}

function normalizeOptionalDecimalText(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function toPositiveDecimal(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(6));
}

function buildFixedAssetSaleCreatePrefill(searchParams) {
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

function clearFixedAssetSaleCreatePrefill(searchParams) {
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

const POSTING_LINE_AMOUNT_EPSILON = 0.000001;

function amountsMatch(left, right) {
  return (
    Math.abs(Number(left || 0) - Number(right || 0)) <= POSTING_LINE_AMOUNT_EPSILON
  );
}

function createPostingLineDraft(seed = {}) {
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

function mapPostableAccountRows(responseRows = []) {
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

function extendAccountOptionsForSelectedLines(options, lines) {
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

function mapItemCardLookupOptions(rows = []) {
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

function extendItemCardOptionsForSelectedLines(options, lines) {
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

function mapWarehouseLookupOptions(rows = [], l) {
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

function extendWarehouseOptionsForSelectedLines(options, lines, l) {
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

function buildRowsById(rows = []) {
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [Number(row?.id || 0), row])
      .filter(([id]) => id > 0)
  );
}

function formatPostableAccountDisplay(account, accountId = null) {
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

function getFixedAssetCategoryDefaultAssetAccountId(categoryRow) {
  return toPositiveInt(
    categoryRow?.defaultAssetAccountId ?? categoryRow?.default_asset_account_id
  );
}

function formatFixedAssetCategoryDisplay(categoryRow, fallbackId = null) {
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

function getFixedAssetCategoryMissingAccountIssue(categoryId, categoriesById) {
  const normalizedCategoryId = toPositiveInt(categoryId);
  if (!normalizedCategoryId || !(categoriesById instanceof Map)) {
    return null;
  }
  const categoryRow = categoriesById.get(normalizedCategoryId) || null;
  if (!categoryRow || getFixedAssetCategoryDefaultAssetAccountId(categoryRow)) {
    return null;
  }
  return {
    categoryId: normalizedCategoryId,
    categoryLabel: formatFixedAssetCategoryDisplay(categoryRow, normalizedCategoryId),
  };
}

function mapFixedAssetCategoryLookupOptions(rows = [], accountRowsById = new Map()) {
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
      return {
        value: String(id),
        label: code && name ? `${code} - ${name}` : code || name || `#${id}`,
        description: accountId
          ? `Asset account: ${formatPostableAccountDisplay(account, accountId)}`
          : "Asset account is not configured.",
      };
    })
    .filter(Boolean);
}

function extendFixedAssetCategoryOptionsForSelectedLines(options, lines) {
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

function mapFixedAssetLookupOptions(
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

function extendFixedAssetOptionsForSelectedLines(options, lines) {
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

function roundDocumentUiAmount(value) {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }
  return Number(Number(value).toFixed(6));
}

function allocateAmountAcrossUnits(amount, unitCount) {
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

function resolveFixedAssetDisplayAccountId(
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

function analyzeDocumentWarehouseBindings(
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

function resolveLineDefaultsFromItemCard(itemCard, direction) {
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

function getDefaultStockImpactModeForDirection(direction) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return "RECEIPT_PENDING";
  }
  if (normalizedDirection === "AR") {
    return "ISSUE_PENDING";
  }
  return "NONE";
}

function buildSubledgerTypeTransitionPatch(line, nextSubledgerType, direction) {
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
    revisedUsefulLifeMonths: "",
    lifeExtensionMonths: "",
  };
  if (normalizedNextSubledgerType === "FIXED_ASSET") {
    return {
      ...fixedAssetResetPatch,
      subledgerType: "FIXED_ASSET",
      itemCardId: "",
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
    subledgerType: "NONE",
    warehouseId: "",
    warehouseCode: "",
    warehouseName: "",
    stockImpactMode: "NONE",
  };
}

function resetDocumentLineTaxPreview(seed = {}) {
  return createDocumentLineDraft({
    ...seed,
    lineTaxAmountTxn: 0,
    taxes: [],
    previewStatus: seed?.taxCategoryCode ? "STALE" : "",
    previewError: "",
    previewUpdatedAt: "",
  });
}

function buildFixedAssetModeTransitionPatch(line, nextMode) {
  const currentLine = createDocumentLineDraft(line);
  const normalizedMode =
    String(nextMode || "").trim().toUpperCase() === "LINK_EXISTING"
      ? "LINK_EXISTING"
      : "AUTO_CREATE";
  if (normalizedMode === "LINK_EXISTING") {
    return {
      fixedAssetMode: "LINK_EXISTING",
      targetFixedAssetId: currentLine.targetFixedAssetId,
      fixedAssetCategoryId: "",
      fixedAssetOwnerOperatingUnitId: "",
      fixedAssetLocationOperatingUnitId: "",
      fixedAssetNameOverride: "",
      fixedAssetSerialNo: "",
      fixedAssetTag: "",
      revisedUsefulLifeMonths: "",
      lifeExtensionMonths: "",
      quantity: "1",
    };
  }
  return {
    fixedAssetMode: "AUTO_CREATE",
    targetFixedAssetId: "",
    revisedUsefulLifeMonths: "",
    lifeExtensionMonths: "",
  };
}

function expandAutoCreateFixedAssetLine(line) {
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

function buildInitialPostForm(snapshot = null) {
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

function documentUsesStoredLineTaxes(snapshot = null) {
  const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  return lines.some((line) => Array.isArray(line?.taxes) && line.taxes.length > 0);
}

function normalizeRecurringCadence(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (DOCUMENT_RECURRING_TEMPLATE_CADENCES.includes(normalized)) {
    return normalized;
  }
  return "MONTHLY";
}

function normalizeRecurringInterval(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "1";
}

function normalizeRecurringAnchorDay(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    return "";
  }
  return String(parsed);
}

function addDaysToIsoDate(dateText, daysToAdd) {
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

function resolvePaymentTermDueDateCandidate(documentDate, paymentTermRow) {
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

function createInitialRecurringTemplateRule() {
  return {
    cadence: "MONTHLY",
    interval: "1",
    anchorDay: "",
  };
}

function buildTemplateSafeDraftForm(input = {}) {
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

function buildRecurringTemplateRule(input = {}) {
  return {
    cadence: normalizeRecurringCadence(input?.cadence),
    interval: normalizeRecurringInterval(input?.interval),
    anchorDay: normalizeRecurringAnchorDay(input?.anchorDay),
  };
}

function buildDocumentDraftTemplateDefinition({ form, recurringRule }) {
  return {
    version: 1,
    draftForm: buildTemplateSafeDraftForm(form),
    recurringRule: buildRecurringTemplateRule(recurringRule),
  };
}

function resolveDocumentDraftTemplateState(savedView) {
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

function buildCloneDraftFormFromRow(row, fallbackForm) {
  const fallbackDocumentDate = normalizeText(fallbackForm?.documentDate) || todayIsoDate();
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

function normalizeVisibleColumnIds(candidateIds, defaultIds) {
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

function buildDocumentSavedViewDefinition({ filters, tablePrefs, columnIds }) {
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

function resolveDocumentSavedViewState(savedView, columnIds) {
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

function createInitialDraftForm() {
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
    currencyCode: "USD",
    fxRate: "",
    lines: [createDocumentLineDraft()],
  };
}

function buildDirectionScopedDraftForm(previousForm, nextDirection) {
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

function createInitialQuickCreateFixedAssetForm() {
  return {
    scope: "",
    lineRowId: "",
    name: "",
    categoryId: "",
    ownerOperatingUnitId: "",
    locationOperatingUnitId: "",
  };
}

function normalizeApiError(error, fallback = "Operation failed.") {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function buildTaxCategoryOptions(ruleRows = [], legalEntityId, lines = []) {
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

function normalizeInventoryReverseBlocks(error) {
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

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function formatFileSize(bytes) {
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

function isDraft(row) {
  return String(row?.status || "").toUpperCase() === "DRAFT";
}

function isPosted(row) {
  return String(row?.status || "").toUpperCase() === "POSTED";
}

function isImmediateCashSettled(row) {
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

function canReverseDocument(row) {
  return isPosted(row) || isImmediateCashSettled(row);
}

function resolveCounterpartyRoleFromDirection(direction) {
  const normalized = String(direction || "").trim().toUpperCase();
  if (normalized === "AR") return "CUSTOMER";
  if (normalized === "AP") return "VENDOR";
  return undefined;
}

function normalizeDocumentSettlementMode(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (DOCUMENT_SETTLEMENT_MODES.includes(normalized)) {
    return normalized;
  }
  return "ACCRUAL";
}

function isImmediateCashSettlementMode(value) {
  return normalizeDocumentSettlementMode(value) === "IMMEDIATE_CASH";
}

function getImmediateCashSettlementLabel(direction, l) {
  return normalizeDirection(direction) === "AP"
    ? l("Cash Purchase", "Nakit Alis")
    : l("Cash Sale", "Nakit Satis");
}

function formatCashRegisterLookupLabel(register, l) {
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

function mapCashRegisterLookupOptions(rows = [], l) {
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

function extendCashRegisterOptionsForSelectedValue(options, selectedValue, l) {
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

function translateDocumentMutationLineErrorMap(lineErrors, translateMessage) {
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

function FixedAssetQuickCreateModal({
  open,
  l,
  form,
  saving,
  error,
  legalEntityId,
  acquisitionDate,
  currencyCode,
  categoryOptions,
  operatingUnitOptions,
  categoriesById,
  onChange,
  onClose,
  onSave,
}) {
  if (!open) {
    return null;
  }
  const normalizedForm = createInitialQuickCreateFixedAssetForm();
  const activeForm = {
    ...normalizedForm,
    ...(form || {}),
  };
  const selectedCategory = categoriesById.get(toPositiveInt(activeForm.categoryId)) || null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {l("Create Draft Asset", "Taslak Varlik Olustur")}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Create a lightweight draft asset and link it back to this CARI line.",
                "Hafif bir taslak varlik olusturun ve bu CARI satirina geri baglayin."
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

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Legal Entity", "Tuzel Kisilik")}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {legalEntityId || "-"}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Acquisition Date", "Edinim Tarihi")}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {acquisitionDate || "-"}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Currency", "Para Birimi")}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {normalizeCurrencyCode(currencyCode) || "-"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
            {l("Asset Name", "Varlik Adi")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={activeForm.name}
              onChange={(event) => onChange({ name: event.target.value })}
              disabled={saving}
            />
          </label>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Category", "Kategori")}
              <Combobox
                className="mt-1"
                value={activeForm.categoryId}
                options={categoryOptions}
                disabled={saving}
                placeholder={l("Search category", "Kategori ara")}
                noOptionsText={l("No categories found.", "Kategori bulunamadi.")}
                onChange={(nextValue) =>
                  onChange({ categoryId: nextValue ? String(nextValue) : "" })
                }
              />
            </label>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Owner OU", "Sahip OB")}
              <Combobox
                className="mt-1"
                value={activeForm.ownerOperatingUnitId}
                options={operatingUnitOptions}
                disabled={saving}
                placeholder={l("Search operating unit", "Operasyon birimi ara")}
                noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                onChange={(nextValue) =>
                  onChange({
                    ownerOperatingUnitId: nextValue ? String(nextValue) : "",
                  })
                }
              />
            </label>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Location OU", "Konum OB")}
              <Combobox
                className="mt-1"
                value={activeForm.locationOperatingUnitId}
                options={operatingUnitOptions}
                disabled={saving}
                placeholder={l("Search operating unit", "Operasyon birimi ara")}
                noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                onChange={(nextValue) =>
                  onChange({
                    locationOperatingUnitId: nextValue ? String(nextValue) : "",
                  })
                }
              />
            </label>
          </div>
        </div>

        {selectedCategory ? (
          <p className="mt-3 text-xs text-slate-500">
            {l(
              `Category defaults will be applied automatically: useful life ${
                selectedCategory.defaultUsefulLifeMonths || "-"
              } months, profile #${
                selectedCategory.defaultDepreciationProfileId || "-"
              }, salvage rule ${selectedCategory.defaultSalvageRuleType || "NONE"}.`,
              `Kategori varsayilanlari otomatik uygulanir: faydali omur ${
                selectedCategory.defaultUsefulLifeMonths || "-"
              } ay, profil #${
                selectedCategory.defaultDepreciationProfileId || "-"
              }, hurda kurali ${selectedCategory.defaultSalvageRuleType || "NONE"}.`
            )}
          </p>
        ) : null}
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
            onClick={onSave}
            disabled={saving}
          >
            {saving
              ? l("Creating draft asset...", "Taslak varlik olusturuluyor...")
              : l("Create + Select", "Olustur + Sec")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FixedAssetCategorySetupModal({
  open,
  l,
  categoryLabel,
  canReadSettings,
  canUpsertSettings,
  onClose,
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {l("Asset Setup Required", "Varlik Kurulumu Gerekli")}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                `"${categoryLabel}" cannot be used for Auto-Create because its default asset account is not configured.`,
                `"${categoryLabel}" kategorisi varsayilan varlik hesabi tanimli olmadigi icin Otomatik Olustur ile kullanilamaz.`
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            onClick={onClose}
          >
            {l("Close", "Kapat")}
          </button>
        </div>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p>
            {l(
              "Open Fixed Asset Settings, configure the category, then come back and select it again.",
              "Demirbas Ayarlari sayfasini acin, kategoriyi yapilandirin ve sonra geri gelip yeniden secin."
            )}
          </p>
          {canReadSettings ? (
            !canUpsertSettings ? (
              <p className="mt-2 text-xs text-amber-800">
                {l(
                  "You can open the settings page, but you need fixed_assets.settings.upsert to update the category.",
                  "Ayarlar sayfasini acabilirsiniz ancak kategoriyi guncellemek icin fixed_assets.settings.upsert gerekir."
                )}
              </p>
            ) : null
          ) : (
            <p className="mt-2 text-xs text-amber-800">
              {l(
                "Missing permission: fixed_assets.settings.read",
                "Eksik yetki: fixed_assets.settings.read"
              )}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={onClose}
          >
            {l("Cancel", "Iptal")}
          </button>
          {canReadSettings ? (
            <a
              href={FIXED_ASSET_SETTINGS_PATH}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={onClose}
            >
              {l("Open Fixed Asset Settings", "Demirbas Ayarlarini Ac")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DocumentLineWorkbench({
  l,
  title,
  form,
  saving,
  gridSpanClass = "md:col-span-4",
  currencyCode,
  functionalCurrencyCode,
  fxComputation,
  canReadGlAccounts,
  lineAccountOptions,
  lineAccountsLoading,
  lineAccountsError,
  itemCardOptions,
  itemCardsLoading,
  itemCardsError,
  warehouseOptions,
  warehouseLoading,
  warehouseError,
  warehouseInfoMessage,
  warehouseLineErrors,
  lineValidationMessages,
  taxCategoryOptions,
  taxCategoryLoading,
  taxCategoryError,
  previewLoading,
  previewError,
  previewMessage,
  fixedAssetCategoryOptions,
  fixedAssetCategoriesLoading,
  fixedAssetCategoriesError,
  fixedAssetCategoriesById,
  fixedAssetDraftOptions,
  fixedAssetDraftLoading,
  fixedAssetDraftError,
  fixedAssetDraftRowsById,
  fixedAssetSaleOptions,
  fixedAssetSaleLoading,
  fixedAssetSaleError,
  fixedAssetSaleRowsById,
  fixedAssetOperatingUnitOptions,
  canQuickCreateFixedAsset,
  canReadFixedAssetSettings,
  canUpsertFixedAssetSettings,
  onAddLine,
  onRemoveLine,
  onMoveLine,
  onPatchLine,
  onPatchTaxSensitiveLine,
  onChangeSubledgerType,
  onChangeFixedAssetMode,
  onSelectFixedAssetCategory,
  onSelectTargetFixedAsset,
  onSelectItemCard,
  onChangeStockImpactMode,
  onSelectWarehouse,
  onExpandFixedAssetLine,
  onOpenQuickCreateFixedAsset,
  onPreviewAll,
  onPreviewRow,
}) {
  const lines = Array.isArray(form?.lines) ? form.lines.map((row) => createDocumentLineDraft(row)) : [];
  const documentDirection = normalizeDirection(form?.direction);
  const totals = fxComputation?.lineTotals || getDocumentLineTotals(lines);
  const resolvedAmountBaseText = normalizeOptionalDecimalText(
    fxComputation?.resolvedAmountBase
  );
  const resolvedAmountTxnText = normalizeOptionalDecimalText(
    fxComputation?.resolvedAmountTxn
  );
  const lineAccountsById = useMemo(
    () =>
      new Map(
        (Array.isArray(lineAccountOptions) ? lineAccountOptions : [])
          .map((row) => [Number(row?.id || 0), row])
          .filter(([id]) => id > 0)
      ),
    [lineAccountOptions]
  );
  const fixedAssetRowsById = useMemo(
    () =>
      new Map([
        ...(fixedAssetDraftRowsById instanceof Map
          ? [...fixedAssetDraftRowsById.entries()]
          : []),
        ...(fixedAssetSaleRowsById instanceof Map
          ? [...fixedAssetSaleRowsById.entries()]
          : []),
      ]),
    [fixedAssetDraftRowsById, fixedAssetSaleRowsById]
  );

  return (
    <div className={`${gridSpanClass} rounded-md border border-slate-200 bg-slate-50 px-3 py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
            {title}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {l(
              "Net is derived from quantity x unit price. Refresh tax preview after changing tax-sensitive fields.",
              "Net tutar miktar x birim fiyattan turetilir. Vergiyle ilgili alanlar degisirse vergi onizlemesini yenileyin."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={onPreviewAll}
            disabled={saving || previewLoading || lines.length === 0}
          >
            {previewLoading
              ? l("Refreshing taxes...", "Vergiler yenileniyor...")
              : l("Preview all line taxes", "Tum satir vergilerini onizle")}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={onAddLine}
            disabled={saving}
          >
            {l("Add line", "Satir ekle")}
          </button>
        </div>
      </div>

      {lineAccountsLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l(
            "Loading postable accounts for lines...",
            "Satirlar icin kaydedilebilir hesaplar yukleniyor..."
          )}
        </p>
      ) : null}
      {lineAccountsError ? (
        <p className="mt-2 text-xs text-amber-700">{lineAccountsError}</p>
      ) : null}
      {itemCardsLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading item cards...", "Urun kartlari yukleniyor...")}
        </p>
      ) : null}
      {itemCardsError ? <p className="mt-2 text-xs text-amber-700">{itemCardsError}</p> : null}
      {warehouseLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading warehouses...", "Depolar yukleniyor...")}
        </p>
      ) : null}
      {warehouseError ? (
        <p className="mt-2 text-xs text-amber-700">{warehouseError}</p>
      ) : null}
      {!warehouseError && !warehouseLoading && warehouseInfoMessage ? (
        <p className="mt-2 text-xs text-amber-700">{warehouseInfoMessage}</p>
      ) : null}
      {taxCategoryLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading tax categories...", "Vergi kategorileri yukleniyor...")}
        </p>
      ) : null}
      {taxCategoryError ? (
        <p className="mt-2 text-xs text-amber-700">{taxCategoryError}</p>
      ) : null}
      {fixedAssetCategoriesLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading fixed asset categories...", "Duran varlik kategorileri yukleniyor...")}
        </p>
      ) : null}
      {fixedAssetCategoriesError ? (
        <p className="mt-2 text-xs text-amber-700">{fixedAssetCategoriesError}</p>
      ) : null}
      {fixedAssetDraftLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading draft fixed assets...", "Taslak duran varliklar yukleniyor...")}
        </p>
      ) : null}
      {fixedAssetDraftError ? (
        <p className="mt-2 text-xs text-amber-700">{fixedAssetDraftError}</p>
      ) : null}
      {fixedAssetSaleLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l(
            "Loading eligible sale assets...",
            "Uygun satis varliklari yukleniyor..."
          )}
        </p>
      ) : null}
      {fixedAssetSaleError ? (
        <p className="mt-2 text-xs text-amber-700">{fixedAssetSaleError}</p>
      ) : null}
      {previewError ? <p className="mt-2 text-xs text-rose-700">{previewError}</p> : null}
      {previewMessage ? (
        <p className="mt-2 text-xs text-emerald-700">{previewMessage}</p>
      ) : null}

      <div className="mt-3 space-y-3">
        {lines.map((line, index) => {
          const lineCurrencyCode = normalizeCurrencyCode(currencyCode) || currencyCode || "USD";
          const hasTaxCategory = Boolean(normalizeText(line.taxCategoryCode));
          const isStockAffectingLine =
            normalizeText(line.stockImpactMode).toUpperCase() !== "NONE";
          const isFixedAssetLine = line.subledgerType === "FIXED_ASSET";
          const isStockLine = line.subledgerType === "STOCK";
          const isNoneLine = !isFixedAssetLine && !isStockLine;
          const isApDocument = documentDirection === "AP";
          const isArDocument = documentDirection === "AR";
          const activeFixedAssetMode =
            isFixedAssetLine && isApDocument
              ? line.fixedAssetMode || "AUTO_CREATE"
              : "LINK_EXISTING";
          const isAutoCreateMode =
            isFixedAssetLine && isApDocument && activeFixedAssetMode === "AUTO_CREATE";
          const isLinkExistingMode =
            isFixedAssetLine &&
            ((isApDocument && activeFixedAssetMode === "LINK_EXISTING") || isArDocument);
          const lockedQuantity = Boolean(
            (isApDocument && activeFixedAssetMode === "LINK_EXISTING") || isArDocument
          );
          const unitCount = toPositiveInt(line.quantity);
          const canExpandAutoCreate = Boolean(
            isAutoCreateMode && unitCount && unitCount > 1
          );
          const expansionWouldExceedLimit = Boolean(
            canExpandAutoCreate && lines.length + unitCount - 1 > DOCUMENT_LINE_EXPANSION_LIMIT
          );
          const selectedCategory = fixedAssetCategoriesById.get(
            toPositiveInt(line.fixedAssetCategoryId)
          ) || null;
          const selectedCategoryLabel = selectedCategory
            ? formatFixedAssetCategoryDisplay(
                selectedCategory,
                toPositiveInt(line.fixedAssetCategoryId)
              )
            : "";
          const selectedCategoryMissingDefaultAssetAccount = Boolean(
            isAutoCreateMode &&
              selectedCategory &&
              !getFixedAssetCategoryDefaultAssetAccountId(selectedCategory)
          );
          const selectedTargetAsset = fixedAssetRowsById.get(
            toPositiveInt(line.targetFixedAssetId)
          ) || null;
          const fixedAssetAccountId = resolveFixedAssetDisplayAccountId(
            line,
            fixedAssetCategoriesById,
            fixedAssetRowsById
          );
          const fixedAssetAccount = lineAccountsById.get(fixedAssetAccountId) || null;
          const fixedAssetPreviewAmounts = computeDocumentLineAmounts(line);
          const perUnitAmount =
            isAutoCreateMode && unitCount
              ? roundDocumentUiAmount(
                  Number(fixedAssetPreviewAmounts.lineNetAmountTxn || 0) / unitCount
                )
              : null;
          const showPerUnitMetadata = Boolean(isAutoCreateMode && unitCount === 1);
          const previewStatus = normalizeText(line.previewStatus).toUpperCase();
          const previewReady =
            previewStatus === "READY" ||
            (Array.isArray(line.taxes) && line.taxes.length > 0) ||
            (hasTaxCategory && Number(line.lineTaxAmountTxn || 0) > 0);
          const warehouseLabel = formatWarehouseDisplay(
            line.warehouseId,
            line.warehouseCode,
            line.warehouseName
          );
          const lineWarehouseError =
            warehouseLineErrors instanceof Map
              ? warehouseLineErrors.get(String(line.rowId || `line-${index}`)) || ""
              : "";
          const lineValidationRows =
            lineValidationMessages instanceof Map
              ? lineValidationMessages.get(String(line.rowId || `line-${index}`)) || []
              : [];

          return (
            <div
              key={line.rowId}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {l("Line", "Satir")} {index + 1}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                    onClick={() => onMoveLine(line.rowId, -1)}
                    disabled={saving || index === 0}
                  >
                    {l("Move up", "Yukari al")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                    onClick={() => onMoveLine(line.rowId, 1)}
                    disabled={saving || index === lines.length - 1}
                  >
                    {l("Move down", "Asagi al")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-cyan-300 px-2 py-1 text-[11px] font-semibold text-cyan-800 disabled:opacity-60"
                    onClick={() => onPreviewRow(line.rowId)}
                    disabled={saving || previewLoading || !hasTaxCategory}
                  >
                    {l("Preview tax", "Vergiyi onizle")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                    onClick={() => onRemoveLine(line.rowId)}
                    disabled={saving || lines.length <= 1}
                  >
                    {l("Remove", "Kaldir")}
                  </button>
                </div>
              </div>

              {lineValidationRows.length > 0 ? (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <ul className="space-y-1">
                    {lineValidationRows.map((message, messageIndex) => (
                      <li key={`${line.rowId}-validation-${messageIndex}`}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Line Type", "Satir Tipi")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={line.subledgerType}
                    onChange={(event) =>
                      onChangeSubledgerType(line.rowId, event.target.value)
                    }
                    disabled={saving}
                  >
                    {DOCUMENT_LINE_SUBLEDGER_TYPES.map((subledgerType) => (
                      <option
                        key={`line-subledger-${line.rowId}-${subledgerType}`}
                        value={subledgerType}
                      >
                        {subledgerType === "NONE"
                          ? l("General", "Genel")
                          : subledgerType === "STOCK"
                            ? l("Stock", "Stok")
                            : l("Fixed Asset", "Duran Varlik")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                  {l("Description", "Aciklama")}
                  <BufferedDraftLineTextInput
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={line.description}
                    onCommit={(nextValue) =>
                      onPatchLine(line.rowId, { description: nextValue })
                    }
                    disabled={saving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Line Kind", "Satir Turu")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={line.lineKind}
                    onChange={(event) =>
                      onPatchTaxSensitiveLine(line.rowId, {
                        lineKind: event.target.value,
                      })
                    }
                    disabled={saving}
                  >
                    {DOCUMENT_LINE_KINDS.map((lineKind) => (
                      <option key={`line-kind-${line.rowId}-${lineKind}`} value={lineKind}>
                        {lineKind}
                      </option>
                    ))}
                  </select>
                </label>

                {isFixedAssetLine && isApDocument ? (
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {l("Asset Mode", "Varlik Modu")}
                    <select
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      value={activeFixedAssetMode}
                      onChange={(event) =>
                        onChangeFixedAssetMode(line.rowId, event.target.value)
                      }
                      disabled={saving}
                    >
                      {FIXED_ASSET_AP_MODE_OPTIONS.map((mode) => (
                        <option key={`fa-mode-${line.rowId}-${mode}`} value={mode}>
                          {mode === "AUTO_CREATE"
                            ? l("Auto-Create", "Otomatik Olustur")
                            : l("Link Existing", "Mevcut Taslagi Bagla")}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {(isNoneLine || isStockLine) ? (
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <label className="block">
                      {isStockLine
                        ? l("Item Card", "Urun Karti")
                        : l("Item Card (optional)", "Urun Karti (opsiyonel)")}
                      <Combobox
                        className="mt-1"
                        value={line.itemCardId}
                        options={itemCardOptions}
                        loading={itemCardsLoading}
                        disabled={saving}
                        placeholder={l("Search item card", "Urun karti ara")}
                        noOptionsText={l("No item cards found.", "Urun karti bulunamadi.")}
                        onChange={(nextValue) => onSelectItemCard(line.rowId, nextValue)}
                      />
                    </label>
                  </div>
                ) : null}

                {isFixedAssetLine && isAutoCreateMode ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Asset Category", "Varlik Kategorisi")}
                        <Combobox
                          className="mt-1"
                          value={line.fixedAssetCategoryId}
                          options={fixedAssetCategoryOptions}
                          loading={fixedAssetCategoriesLoading}
                          disabled={saving}
                          placeholder={l("Search category", "Kategori ara")}
                          noOptionsText={l("No categories found.", "Kategori bulunamadi.")}
                          onChange={(nextValue) =>
                            onSelectFixedAssetCategory(line.rowId, nextValue)
                          }
                        />
                      </label>
                    </div>
                    {selectedCategoryMissingDefaultAssetAccount ? (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 md:col-span-4">
                        <p className="font-semibold">
                          {l(
                            "Auto-Create is blocked for this category.",
                            "Bu kategori icin Otomatik Olustur kullanilamaz."
                          )}
                        </p>
                        <p className="mt-1">
                          {l(
                            `"${selectedCategoryLabel}" is missing its default asset account. Configure it in Fixed Asset Settings, then select it again.`,
                            `"${selectedCategoryLabel}" kategorisinin varsayilan varlik hesabi eksik. Demirbas Ayarlarinda yapilandirin, sonra yeniden secin.`
                          )}
                        </p>
                        {canReadFixedAssetSettings ? (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <a
                              href={FIXED_ASSET_SETTINGS_PATH}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold underline underline-offset-2"
                            >
                              {l(
                                "Open Fixed Asset Settings",
                                "Demirbas Ayarlarini Ac"
                              )}
                            </a>
                            {!canUpsertFixedAssetSettings ? (
                              <span className="text-xs text-amber-800">
                                {l(
                                  "You can open the page, but you need fixed_assets.settings.upsert to update the category.",
                                  "Sayfayi acabilirsiniz ancak kategoriyi guncellemek icin fixed_assets.settings.upsert gerekir."
                                )}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-amber-800">
                            {l(
                              "Missing permission: fixed_assets.settings.read",
                              "Eksik yetki: fixed_assets.settings.read"
                            )}
                          </p>
                        )}
                      </div>
                    ) : null}
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Owner OU", "Sahip OB")}
                        <Combobox
                          className="mt-1"
                          value={line.fixedAssetOwnerOperatingUnitId}
                          options={fixedAssetOperatingUnitOptions}
                          disabled={saving}
                          placeholder={l("Search operating unit", "Operasyon birimi ara")}
                          noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                          onChange={(nextValue) =>
                            onPatchLine(line.rowId, {
                              fixedAssetOwnerOperatingUnitId: nextValue ? String(nextValue) : "",
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Location OU", "Konum OB")}
                        <Combobox
                          className="mt-1"
                          value={line.fixedAssetLocationOperatingUnitId}
                          options={fixedAssetOperatingUnitOptions}
                          disabled={saving}
                          placeholder={l("Search operating unit", "Operasyon birimi ara")}
                          noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                          onChange={(nextValue) =>
                            onPatchLine(line.rowId, {
                              fixedAssetLocationOperatingUnitId: nextValue
                                ? String(nextValue)
                                : "",
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                      <p>{l("Resolved Asset Account", "Cozumlenen Varlik Hesabi")}</p>
                      <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700">
                        {formatPostableAccountDisplay(fixedAssetAccount, fixedAssetAccountId)}
                      </div>
                    </div>
                    <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-950 md:col-span-4">
                      <p className="font-medium">
                        {l("Posting this line will create", "Bu satir kayda alindiginda")}{" "}
                        <span className="font-semibold">{unitCount || line.quantity || 0}</span>{" "}
                        {l("assets at", "adet varlik olusturur, birim basina")}{" "}
                        <MoneyText
                          amount={perUnitAmount}
                          currencyCode={lineCurrencyCode}
                          className="inline font-semibold"
                        />{" "}
                        {l("each.", "olacak.")}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800 disabled:opacity-60"
                          onClick={() => onExpandFixedAssetLine(line.rowId)}
                          disabled={saving || !canExpandAutoCreate || expansionWouldExceedLimit}
                        >
                          {l(
                            "Expand into individual asset lines",
                            "Tekil varlik satirlarina genislet"
                          )}
                        </button>
                        {expansionWouldExceedLimit ? (
                          <span className="text-xs text-amber-800">
                            {l(
                              `Expanding ${unitCount} units would exceed the 500-line document limit. Reduce quantity or split into separate documents.`,
                              `${unitCount} adetlik genisletme 500 satir belge sinirini asar. Miktari azaltin veya ayri belgelere bolun.`
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {showPerUnitMetadata ? (
                      <>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Asset Name Override", "Varlik Adi Gecersiz Kilma")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={line.fixedAssetNameOverride}
                            onChange={(event) =>
                              onPatchLine(line.rowId, {
                                fixedAssetNameOverride: event.target.value,
                              })
                            }
                            disabled={saving}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Serial No", "Seri No")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={line.fixedAssetSerialNo}
                            onChange={(event) =>
                              onPatchLine(line.rowId, {
                                fixedAssetSerialNo: event.target.value,
                              })
                            }
                            disabled={saving}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Asset Tag", "Varlik Etiketi")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={line.fixedAssetTag}
                            onChange={(event) =>
                              onPatchLine(line.rowId, {
                                fixedAssetTag: event.target.value,
                              })
                            }
                            disabled={saving}
                          />
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}

                {isFixedAssetLine && isLinkExistingMode ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                      <label className="block">
                        {isApDocument
                          ? l("Draft Asset", "Taslak Varlik")
                          : l("Asset", "Varlik")}
                        <Combobox
                          className="mt-1"
                          value={line.targetFixedAssetId}
                          options={isApDocument ? fixedAssetDraftOptions : fixedAssetSaleOptions}
                          loading={isApDocument ? fixedAssetDraftLoading : fixedAssetSaleLoading}
                          disabled={saving}
                          placeholder={
                            isApDocument
                              ? l("Search draft asset", "Taslak varlik ara")
                              : l("Search eligible asset", "Uygun varlik ara")
                          }
                          noOptionsText={
                            isApDocument
                              ? l("No draft assets found.", "Taslak varlik bulunamadi.")
                              : l("No eligible assets found.", "Uygun varlik bulunamadi.")
                          }
                          onChange={(nextValue) =>
                            onSelectTargetFixedAsset(line.rowId, nextValue)
                          }
                        />
                      </label>
                    </div>
                    {isApDocument ? (
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                          onClick={() => onOpenQuickCreateFixedAsset(line.rowId)}
                          disabled={saving || !canQuickCreateFixedAsset}
                        >
                          {l("+ New Asset", "+ Yeni Varlik")}
                        </button>
                      </div>
                    ) : null}
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
                        value={lockedQuantity ? "1" : line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving || lockedQuantity}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    {isApDocument ? (
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        <p>{l("Resolved Asset Account", "Cozumlenen Varlik Hesabi")}</p>
                        <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700">
                          {formatPostableAccountDisplay(fixedAssetAccount, fixedAssetAccountId)}
                        </div>
                      </div>
                    ) : canReadGlAccounts ? (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Sale Proceeds Account", "Satis Hasilat Hesabi")}
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving || lineAccountsLoading}
                        >
                          <option value="">
                            {l("Select account", "Hesap secin")}
                          </option>
                          {lineAccountOptions.map((row) => (
                            <option key={`line-account-${line.rowId}-${row.id}`} value={String(row.id)}>
                              {row.code} - {row.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Sale Proceeds Account ID", "Satis Hasilat Hesabi ID")}
                        <input
                          type="number"
                          min="1"
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving}
                        />
                      </label>
                    )}
                  </>
                ) : null}

                {isStockLine ? (
                  <>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {isStockAffectingLine
                        ? l("Warehouse (required)", "Depo (zorunlu)")
                        : l("Warehouse", "Depo")}
                      <Combobox
                        className="mt-1"
                        value={line.warehouseId}
                        options={warehouseOptions}
                        loading={warehouseLoading}
                        disabled={saving || !isStockAffectingLine}
                        clearable
                        placeholder={
                          isStockAffectingLine
                            ? l("Search warehouse", "Depo ara")
                            : l("Select stock impact first", "Once stok etkisini secin")
                        }
                        noOptionsText={l("No warehouses found.", "Depo bulunamadi.")}
                        onChange={(nextValue) => onSelectWarehouse(line.rowId, nextValue)}
                      />
                      {lineWarehouseError ? (
                        <span className="mt-1 block normal-case tracking-normal text-[11px] text-amber-700">
                          {lineWarehouseError}
                        </span>
                      ) : null}
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Stock Impact", "Stok Etkisi")}
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.stockImpactMode}
                        onChange={(event) =>
                          onChangeStockImpactMode(line.rowId, event.target.value)
                        }
                        disabled={saving}
                      >
                        {DOCUMENT_LINE_STOCK_IMPACT_MODES.map((mode) => (
                          <option key={`stock-impact-${line.rowId}-${mode}`} value={mode}>
                            {mode === "NONE"
                              ? l("None", "Yok")
                              : mode === "RECEIPT_PENDING"
                                ? l("Receipt Pending", "Giris Bekliyor")
                                : l("Issue Pending", "Cikis Bekliyor")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    {canReadGlAccounts ? (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Posting Account (optional)", "Kayit Hesabi (opsiyonel)")}
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving || lineAccountsLoading}
                        >
                          <option value="">
                            {l(
                              "Use purpose/default mapping",
                              "Amac/varsayilan eslemeyi kullan"
                            )}
                          </option>
                          {lineAccountOptions.map((row) => (
                            <option key={`line-account-${line.rowId}-${row.id}`} value={String(row.id)}>
                              {row.code} - {row.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Posting Account ID (optional)", "Kayit Hesabi ID (opsiyonel)")}
                        <input
                          type="number"
                          min="1"
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving}
                        />
                      </label>
                    )}
                  </>
                ) : null}

                {isNoneLine ? (
                  <>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    {canReadGlAccounts ? (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Posting Account (optional)", "Kayit Hesabi (opsiyonel)")}
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving || lineAccountsLoading}
                        >
                          <option value="">
                            {l(
                              "Use purpose/default mapping",
                              "Amac/varsayilan eslemeyi kullan"
                            )}
                          </option>
                          {lineAccountOptions.map((row) => (
                            <option key={`line-account-${line.rowId}-${row.id}`} value={String(row.id)}>
                              {row.code} - {row.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Posting Account ID (optional)", "Kayit Hesabi ID (opsiyonel)")}
                        <input
                          type="number"
                          min="1"
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving}
                        />
                      </label>
                    )}
                  </>
                ) : null}

              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {l("Net", "Net")}
                  </p>
                  <MoneyText
                    amount={line.lineNetAmountTxn}
                    currencyCode={lineCurrencyCode}
                    className="mt-1 text-sm font-semibold text-slate-800"
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {l("Tax", "Vergi")}
                  </p>
                  <MoneyText
                    amount={line.lineTaxAmountTxn}
                    currencyCode={lineCurrencyCode}
                    className="mt-1 text-sm font-semibold text-slate-800"
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {l("Gross", "Brut")}
                  </p>
                  <MoneyText
                    amount={line.lineGrossAmountTxn}
                    currencyCode={lineCurrencyCode}
                    className="mt-1 text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                {isFixedAssetLine ? (
                  <>
                    <span>
                      {l("Asset mode", "Varlik modu")}:{" "}
                      {isApDocument
                        ? activeFixedAssetMode || "-"
                        : l("Existing asset", "Mevcut varlik")}
                    </span>
                    <span>
                      {l("Target asset", "Hedef varlik")}:{" "}
                      {selectedTargetAsset?.assetNo ||
                        selectedTargetAsset?.name ||
                        line.targetFixedAssetId ||
                        "-"}
                    </span>
                    <span>
                      {l("Category", "Kategori")}:{" "}
                      {selectedCategory?.code ||
                        selectedCategory?.name ||
                        line.fixedAssetCategoryId ||
                        selectedTargetAsset?.categoryCode ||
                        selectedTargetAsset?.categoryName ||
                        "-"}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {l("Stock impact", "Stok etkisi")}: {line.stockImpactMode || "NONE"}
                    </span>
                    <span>
                      {l("Item card", "Urun karti")}: {line.itemCardId || "-"}
                    </span>
                    <span>
                      {l("Warehouse", "Depo")}: {warehouseLabel}
                    </span>
                  </>
                )}
              </div>

              {line.previewError ? (
                <p className="mt-2 text-xs text-rose-700">{line.previewError}</p>
              ) : null}
              {!line.previewError && hasTaxCategory && !previewReady ? (
                <p className="mt-2 text-xs text-amber-700">
                  {l(
                    "Tax category is set. Refresh preview to update invoice totals before saving.",
                    "Vergi kategorisi secili. Kaydetmeden once fatura toplamlarini guncellemek icin onizlemeyi yenileyin."
                  )}
                </p>
              ) : null}
              {previewReady && Array.isArray(line.taxes) && line.taxes.length > 0 ? (
                <div className="mt-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                    {l("Tax preview", "Vergi onizlemesi")}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-cyan-950">
                    {line.taxes.map((taxRow, taxIndex) => (
                      <li key={`line-tax-${line.rowId}-${taxRow.componentNo || taxIndex}`}>
                        {(taxRow.taxCode || l("Tax", "Vergi"))} | {taxRow.ratePct ?? 0}% |{" "}
                        <MoneyText
                          amount={taxRow.taxAmountTxn}
                          currencyCode={lineCurrencyCode}
                          className="inline"
                        />
                        {taxRow.taxPurposeCode ? ` | ${taxRow.taxPurposeCode}` : ""}
                        {taxRow.accountId ? ` | account #${taxRow.accountId}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Subtotal", "Ara Toplam")}
          </p>
          <MoneyText
            amount={totals.netAmountTxn}
            currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
            className="mt-1 text-sm font-semibold text-slate-800"
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Tax Total", "Vergi Toplami")}
          </p>
          <MoneyText
            amount={totals.taxAmountTxn}
            currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
            className="mt-1 text-sm font-semibold text-slate-800"
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Gross Total", "Brut Toplam")}
          </p>
          <MoneyText
            amount={totals.grossAmountTxn}
            currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
            className="mt-1 text-sm font-semibold text-slate-800"
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Base Total", "Baz Toplam")}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {resolvedAmountBaseText || "-"} {functionalCurrencyCode || ""}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        {l("Derived invoice total:", "Turetilmis fatura toplami:")}{" "}
        {resolvedAmountTxnText || "-"} {normalizeCurrencyCode(currencyCode) || currencyCode || ""}
      </p>
    </div>
  );
}

function BufferedDraftLineTextInput({
  value,
  onCommit,
  disabled = false,
  className = "",
  maxLength,
}) {
  const normalizedValue = String(value ?? "");
  const [draftValue, setDraftValue] = useState(normalizedValue);
  const commitTimeoutRef = useRef(null);
  const latestCommitRef = useRef(onCommit);

  useEffect(() => {
    latestCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    setDraftValue(normalizedValue);
  }, [normalizedValue]);

  useEffect(
    () => () => {
      if (commitTimeoutRef.current) {
        clearTimeout(commitTimeoutRef.current);
      }
    },
    []
  );

  const flushDraftValue = useCallback((nextValue) => {
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
    latestCommitRef.current?.(nextValue);
  }, []);

  const scheduleCommit = useCallback((nextValue) => {
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
    }
    commitTimeoutRef.current = setTimeout(() => {
      commitTimeoutRef.current = null;
      latestCommitRef.current?.(nextValue);
    }, LINE_TEXT_INPUT_COMMIT_DELAY_MS);
  }, []);

  return (
    <input
      type="text"
      className={className}
      value={draftValue}
      maxLength={maxLength}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        scheduleCommit(nextValue);
      }}
      onBlur={() => flushDraftValue(draftValue)}
      disabled={disabled}
    />
  );
}

function normalizeDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "AR" || normalized === "AP") {
    return normalized;
  }
  return "";
}

function resolveRouteFixedDirection(directionProp, searchParams) {
  const propDirection = normalizeDirection(directionProp);
  if (propDirection) {
    return propDirection;
  }
  if (!(searchParams instanceof URLSearchParams)) {
    return "";
  }
  return normalizeDirection(searchParams.get("direction"));
}

function getDocumentPageTitle(direction, l) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return l("Vendor Bills", "Alis Faturalari");
  }
  if (normalizedDirection === "AR") {
    return l("Sales Invoices", "Satis Faturalari");
  }
  return l("Cari Documents", "Cari Belgeler");
}

function getCreateDraftDocumentTitle(direction, l) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return l("Create Vendor Bill Draft", "Alis Faturasi Taslagi Olustur");
  }
  if (normalizedDirection === "AR") {
    return l("Create Sales Invoice Draft", "Satis Faturasi Taslagi Olustur");
  }
  return l("Create Draft Document", "Belge Taslagi Olustur");
}

function resolveOffsetAccountTypeByDirection(direction) {
  const normalized = normalizeDirection(direction);
  if (normalized === "AR") {
    return "REVENUE";
  }
  if (normalized === "AP") {
    return "EXPENSE";
  }
  return "";
}

function mapCounterpartyLookupOption(row) {
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

function mapLegalEntityLookupOption(row) {
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

function mapPaymentTermLookupOption(row) {
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

function mapOperatingUnitLookupOption(row) {
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

function formatOperatingUnitDisplay(unitId, unitCode, unitName) {
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

function formatWarehouseDisplay(warehouseId, warehouseCode, warehouseName) {
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

function buildOperatingUnitsById(...collections) {
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

function getDocumentOperatingUnitLabel(row, operatingUnitsById = new Map()) {
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

function buildDocumentLifecycleEvents(row, translate = (en) => en) {
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

  const events = [];
  if (createdAt) {
    events.push({
      statusCode: "DRAFT",
      at: createdAt,
      note: translate("Draft created.", "Taslak olusturuldu."),
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

function formatReadinessReason(reason, translate = (en) => en) {
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

export default function CariDocumentsPage({ direction = "" }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fixedRouteDirection = useMemo(
    () => resolveRouteFixedDirection(direction, searchParams),
    [direction, searchParams]
  );
  const hasFixedRouteDirection = Boolean(fixedRouteDirection);
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const { getModuleRow } = useModuleReadiness();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const translateDocumentMutationError = useCallback((message) => {
    const trimmedMessage = String(message || "").trim();
    const coreMessage = trimmedMessage.replace(/^lines\[\d+\]\./, "");
    switch (trimmedMessage) {
      case "legalEntityId is required.":
        return l("legalEntityId is required.", "legalEntityId zorunludur.");
      case "counterpartyId is required.":
        return l("counterpartyId is required.", "counterpartyId zorunludur.");
      case "direction must be AR or AP.":
        return l("direction must be AR or AP.", "direction AR veya AP olmali.");
      case "documentType is invalid.":
        return l("documentType is invalid.", "documentType gecersiz.");
      case "documentDate is required.":
        return l("documentDate is required.", "documentDate zorunludur.");
      case "settlementMode must be ACCRUAL or IMMEDIATE_CASH":
        return l(
          "settlementMode must be ACCRUAL or IMMEDIATE_CASH.",
          "settlementMode ACCRUAL veya IMMEDIATE_CASH olmali."
        );
      case "settlementCashRegisterId is required when settlementMode=IMMEDIATE_CASH":
        return l(
          "Cash register is required when immediate cash is selected.",
          "Aninda nakit secildiginde kasa zorunludur."
        );
      case "settlementCashRegisterId requires settlementMode=IMMEDIATE_CASH":
        return l(
          "Cash register can only be set when immediate cash is selected.",
          "Kasa yalnizca aninda nakit secildiginde atanabilir."
        );
      case "amountTxn must be > 0.":
        return l("amountTxn must be > 0.", "amountTxn 0'dan buyuk olmali.");
      case "amountBase must be > 0.":
        return l("amountBase must be > 0.", "amountBase 0'dan buyuk olmali.");
      case "fxRate is required when currencyCode differs from legal entity functional currency.":
        return l(
          "fxRate is required when invoice currency differs from the legal entity functional currency.",
          "Fatura para birimi, tuzel kisilik fonksiyonel para biriminden farkliysa fxRate zorunludur."
        );
      case "fxRate must be 1 when currencyCode matches legal entity functional currency":
        return l(
          "fxRate must be 1 when invoice currency matches the legal entity functional currency.",
          "Fatura para birimi, tuzel kisilik fonksiyonel para birimiyle ayniysa fxRate 1 olmalidir."
        );
      case "amountBase must equal amountTxn when currencyCode matches legal entity functional currency":
        return l(
          "Base amount must match invoice amount when invoice currency matches the legal entity functional currency.",
          "Fatura para birimi, tuzel kisilik fonksiyonel para birimiyle ayniysa baz tutar fatura tutarina esit olmalidir."
        );
      case "amountBase must equal amountTxn * fxRate when currencyCode differs from legal entity functional currency":
        return l(
          "Base amount must equal invoice amount x FX rate for foreign-currency invoices.",
          "Yabanci para faturalarda baz tutar, fatura tutari x kur olmalidir."
        );
      case "currencyCode must be a 3-letter code.":
        return l(
          "currencyCode must be a 3-letter code.",
          "currencyCode 3 harfli bir kod olmali."
        );
      case "warehouseCode is read-only; send warehouseId only":
        return l(
          "warehouseCode is read-only; send warehouseId only.",
          "warehouseCode salt okunurdur; yalnizca warehouseId gonderin."
        );
      case "warehouseName is read-only; send warehouseId only":
        return l(
          "warehouseName is read-only; send warehouseId only.",
          "warehouseName salt okunurdur; yalnizca warehouseId gonderin."
        );
      case "warehouseId must belong to legalEntityId":
        return l(
          "Selected warehouse must belong to the same legal entity.",
          "Secili depo ayni tuzel kisilige ait olmalidir."
        );
      case "warehouseId must reference an ACTIVE warehouse":
        return l(
          "Selected warehouse must be active.",
          "Secili depo aktif olmalidir."
        );
      case "fxRate must be > 0 when provided.":
        return l(
          "fxRate must be > 0 when provided.",
          "fxRate girildiginde 0'dan buyuk olmali."
        );
      default: {
        switch (coreMessage) {
          case "quantity must be > 0.":
            return l("Quantity must be greater than 0.", "Miktar 0'dan buyuk olmali.");
          case "lineNetAmountTxn must be > 0.":
            return l("Net amount must be greater than 0.", "Net tutar 0'dan buyuk olmali.");
          case "lineGrossAmountTxn must be > 0.":
            return l("Gross amount must be greater than 0.", "Brut tutar 0'dan buyuk olmali.");
          case "taxCategoryCode is required when lineTaxAmountTxn > 0.":
            return l(
              "Tax category is required when tax amount is greater than 0.",
              "Vergi tutari 0'dan buyukse vergi kategorisi zorunludur."
            );
          case "fixedAssetMode is required for AP FIXED_ASSET lines.":
            return l(
              "Choose an asset mode for AP fixed-asset lines.",
              "AP duran varlik satirlari icin bir varlik modu secin."
            );
          case "targetFixedAssetId must be empty for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Auto-create fixed-asset lines cannot target an existing asset.",
              "Otomatik olusturma duran varlik satirlari mevcut bir varligi hedefleyemez."
            );
          case "quantity must be a whole positive integer for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Auto-create fixed-asset quantity must be a whole positive number.",
              "Otomatik olusturma duran varlik miktari pozitif tam sayi olmalidir."
            );
          case "fixedAssetCategoryId is required for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Asset category is required for auto-create fixed-asset lines.",
              "Otomatik olusturma duran varlik satirlari icin varlik kategorisi zorunludur."
            );
          case "fixedAssetOwnerOperatingUnitId is required for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Owner OU is required for auto-create fixed-asset lines.",
              "Otomatik olusturma duran varlik satirlari icin sahip OB zorunludur."
            );
          case "fixedAssetLocationOperatingUnitId is required for AP FIXED_ASSET AUTO_CREATE lines.":
            return l(
              "Location OU is required for auto-create fixed-asset lines.",
              "Otomatik olusturma duran varlik satirlari icin konum OB zorunludur."
            );
          case "targetFixedAssetId is required for AP FIXED_ASSET LINK_EXISTING lines.":
            return l(
              "Select the draft asset to link on this AP fixed-asset line.",
              "Bu AP duran varlik satirinda baglanacak taslak varligi secin."
            );
          case "quantity must equal 1 for AP FIXED_ASSET LINK_EXISTING lines.":
            return l(
              "Link-existing AP fixed-asset lines must use quantity 1.",
              "Mevcut taslaga baglanan AP duran varlik satirlari miktar 1 kullanmalidir."
            );
          case "targetFixedAssetId is required for AR FIXED_ASSET lines.":
            return l(
              "Select the asset being sold on this AR fixed-asset line.",
              "Bu AR duran varlik satirinda satilan varligi secin."
            );
          case "quantity must equal 1 for AR FIXED_ASSET lines.":
            return l(
              "AR fixed-asset lines must use quantity 1.",
              "AR duran varlik satirlari miktar 1 kullanmalidir."
            );
          case "postingAccountId is required for AR FIXED_ASSET lines.":
            return l(
              "Sale proceeds account is required for AR fixed-asset lines.",
              "AR duran varlik satirlari icin satis hasilat hesabi zorunludur."
            );
          case "itemCardId is required for STOCK lines.":
            return l(
              "Item card is required for stock lines.",
              "Stok satirlari icin urun karti zorunludur."
            );
          case "stockImpactMode is required for STOCK lines.":
            return l(
              "Stock impact is required for stock lines.",
              "Stok satirlari icin stok etkisi zorunludur."
            );
          case "targetFixedAssetId must be empty for STOCK lines.":
            return l(
              "Stock lines cannot target a fixed asset.",
              "Stok satirlari bir duran varligi hedefleyemez."
            );
          case "targetFixedAssetId must be empty for NONE lines.":
            return l(
              "General lines cannot target a fixed asset.",
              "Genel satirlar bir duran varligi hedefleyemez."
            );
          case "Document cannot exceed 500 lines.":
            return l(
              "Document cannot exceed 500 lines.",
              "Belge 500 satiri asamaz."
            );
          default:
            break;
        }
        const stockLineWarehousePattern =
          /^lines\[\d+\]\.warehouseId is required for stock-affecting lines\.?$/;
        if (stockLineWarehousePattern.test(trimmedMessage)) {
          return l(
            "warehouseId is required for stock-affecting lines.",
            "Stok etkileyen satirlarda warehouseId zorunludur."
          );
        }
        const warehouseCodeReadOnlyPattern =
          /^lines\[\d+\]\.warehouseCode is read-only; send warehouseId only$/;
        if (warehouseCodeReadOnlyPattern.test(trimmedMessage)) {
          return l(
            "warehouseCode is read-only; send warehouseId only.",
            "warehouseCode salt okunurdur; yalnizca warehouseId gonderin."
          );
        }
        const warehouseNameReadOnlyPattern =
          /^lines\[\d+\]\.warehouseName is read-only; send warehouseId only$/;
        if (warehouseNameReadOnlyPattern.test(trimmedMessage)) {
          return l(
            "warehouseName is read-only; send warehouseId only.",
            "warehouseName salt okunurdur; yalnizca warehouseId gonderin."
          );
        }
        const warehouseLegalEntityPattern =
          /^lines\[\d+\]\.warehouseId must belong to legalEntityId$/;
        if (warehouseLegalEntityPattern.test(trimmedMessage)) {
          return l(
            "Selected warehouse must belong to the same legal entity.",
            "Secili depo ayni tuzel kisilige ait olmalidir."
          );
        }
        const activeWarehousePattern =
          /^lines\[\d+\]\.warehouseId must reference an ACTIVE warehouse$/;
        if (activeWarehousePattern.test(trimmedMessage)) {
          return l(
            "Selected warehouse must be active.",
            "Secili depo aktif olmalidir."
          );
        }
        const missingCategoryAccountPattern =
          /^lines\[\d+\]\.fixedAssetCategoryId is missing default_asset_account_id$/;
        if (missingCategoryAccountPattern.test(trimmedMessage)) {
          return l(
            "Selected asset category is missing its default asset account. Configure the category in Fixed Asset Settings and try again.",
            "Secili varlik kategorisinin varsayilan varlik hesabi eksik. Kategoriyi Demirbas Ayarlarinda yapilandirin ve tekrar deneyin."
          );
        }
        if (
          /^Warehouse does not belong to ownership context /i.test(trimmedMessage)
        ) {
          return l(
            "Selected warehouse belongs to another ownership context.",
            "Secili depo baska bir sahiplik baglamina aittir."
          );
        }
        const dueDatePrefix = "dueDate is required for documentType=";
        if (trimmedMessage.startsWith(dueDatePrefix)) {
          const documentType = trimmedMessage
            .slice(dueDatePrefix.length)
            .replace(/\.$/, "");
          return l(
            `dueDate is required for documentType=${documentType}.`,
            `documentType=${documentType} icin dueDate zorunludur.`
          );
        }
        return trimmedMessage;
      }
    }
  }, [l]);
  const {
    legalEntities: workingContextLegalEntities,
    loadingBase: workingContextBaseLoading,
    error: workingContextError,
  } = useWorkingContext();
  const canRead = hasPermission("cari.doc.read");
  const canCreate = hasPermission("cari.doc.create");
  const canUpdate = hasPermission("cari.doc.update");
  const canPost = hasPermission("cari.doc.post");
  const canReverse = hasPermission("cari.doc.reverse");
  const canFxOverride = hasPermission("cari.fx.override");
  const canReadReports = hasPermission("cari.report.read");
  const canReadCards = hasPermission("cari.card.read");
  const canUpsertCards = hasPermission("cari.card.upsert");
  const canReadCashRegisters = hasPermission("cash.register.read");
  const canReadItemCards = hasPermission("item.card.read");
  const canReadGlJournals = hasPermission("gl.journal.read");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canReadExceptions = hasPermission("ops.exceptions.read");
  const canReadCariAudit = hasPermission("cari.audit.read");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadFixedAssets = hasPermission("fixed_assets.read");
  const canUpsertFixedAssets = hasPermission("fixed_assets.upsert");
  const canReadFixedAssetSettings = hasPermission("fixed_assets.settings.read");
  const canUpsertFixedAssetSettings = hasPermission("fixed_assets.settings.upsert");

  const [filters, setFilters, resetFilters] = usePersistedFilters(
    DOCUMENT_FILTERS_STORAGE_SCOPE,
    () => ({ ...DEFAULT_FILTERS })
  );
  const [filterContextDefaultsSuspended, setFilterContextDefaultsSuspended] = useState(false);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterOperatingUnitOptions, setFilterOperatingUnitOptions] = useState([]);
  const [filterOperatingUnitLoading, setFilterOperatingUnitLoading] = useState(false);
  const [filterOperatingUnitError, setFilterOperatingUnitError] = useState("");
  const [filterCounterpartyOptions, setFilterCounterpartyOptions] = useState([]);
  const [filterCounterpartyLoading, setFilterCounterpartyLoading] = useState(false);

  const [createForm, setCreateForm] = useState(() => {
    const initialForm = createInitialDraftForm();
    return fixedRouteDirection
      ? { ...initialForm, direction: fixedRouteDirection }
      : initialForm;
  });
  const [createContextDefaultsSuspended, setCreateContextDefaultsSuspended] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [createValidationVisible, setCreateValidationVisible] = useState(false);
  const [createPaymentTermTouched, setCreatePaymentTermTouched] = useState(false);
  const [createDueDateTouched, setCreateDueDateTouched] = useState(false);
  const [createCurrencyTouched, setCreateCurrencyTouched] = useState(false);
  const [createCounterpartyOptions, setCreateCounterpartyOptions] = useState([]);
  const [createCounterpartyLoading, setCreateCounterpartyLoading] = useState(false);
  const [createCounterpartyLookupQuery, setCreateCounterpartyLookupQuery] = useState("");
  const [createPaymentTermOptions, setCreatePaymentTermOptions] = useState([]);
  const [createPaymentTermsLoading, setCreatePaymentTermsLoading] = useState(false);
  const [createPaymentTermsError, setCreatePaymentTermsError] = useState("");
  const [createCashRegisterRows, setCreateCashRegisterRows] = useState([]);
  const [createCashRegistersLoading, setCreateCashRegistersLoading] = useState(false);
  const [createCashRegistersError, setCreateCashRegistersError] = useState("");
  const [createOperatingUnitOptions, setCreateOperatingUnitOptions] = useState([]);
  const [createOperatingUnitsLoading, setCreateOperatingUnitsLoading] = useState(false);
  const [createOperatingUnitsError, setCreateOperatingUnitsError] = useState("");
  const [createOperatingUnitOverrideOpen, setCreateOperatingUnitOverrideOpen] =
    useState(false);
  const [createLineAccountRows, setCreateLineAccountRows] = useState([]);
  const [createLineAccountsLoading, setCreateLineAccountsLoading] = useState(false);
  const [createLineAccountsError, setCreateLineAccountsError] = useState("");
  const [createItemCardRows, setCreateItemCardRows] = useState([]);
  const [createItemCardsLoading, setCreateItemCardsLoading] = useState(false);
  const [createItemCardsError, setCreateItemCardsError] = useState("");
  const [createFixedAssetCategoryRows, setCreateFixedAssetCategoryRows] = useState([]);
  const [createFixedAssetCategoriesLoading, setCreateFixedAssetCategoriesLoading] = useState(false);
  const [createFixedAssetCategoriesError, setCreateFixedAssetCategoriesError] = useState("");
  const [createFixedAssetDraftRows, setCreateFixedAssetDraftRows] = useState([]);
  const [createFixedAssetDraftLoading, setCreateFixedAssetDraftLoading] = useState(false);
  const [createFixedAssetDraftError, setCreateFixedAssetDraftError] = useState("");
  const [createFixedAssetSaleRows, setCreateFixedAssetSaleRows] = useState([]);
  const [createFixedAssetSaleLoading, setCreateFixedAssetSaleLoading] = useState(false);
  const [createFixedAssetSaleError, setCreateFixedAssetSaleError] = useState("");
  const [createWarehouseRows, setCreateWarehouseRows] = useState([]);
  const [createWarehousesLoading, setCreateWarehousesLoading] = useState(false);
  const [createWarehousesError, setCreateWarehousesError] = useState("");
  const [taxRuleRows, setTaxRuleRows] = useState([]);
  const [taxCategoryLoading, setTaxCategoryLoading] = useState(false);
  const [taxCategoryError, setTaxCategoryError] = useState("");
  const [createLinePreviewLoading, setCreateLinePreviewLoading] = useState(false);
  const [createLinePreviewError, setCreateLinePreviewError] = useState("");
  const [createLinePreviewMessage, setCreateLinePreviewMessage] = useState("");
  const [createInlineCounterpartySaving, setCreateInlineCounterpartySaving] = useState(false);
  const [createInlineCounterpartyError, setCreateInlineCounterpartyError] = useState("");
  const [createInlineCounterpartyMessage, setCreateInlineCounterpartyMessage] = useState("");
  const [createRecurringRule, setCreateRecurringRule] = useState(() =>
    createInitialRecurringTemplateRule()
  );
  const [draftTemplatesLoading, setDraftTemplatesLoading] = useState(false);
  const [draftTemplatesSaving, setDraftTemplatesSaving] = useState(false);
  const [draftTemplatesError, setDraftTemplatesError] = useState("");
  const [draftTemplatesMessage, setDraftTemplatesMessage] = useState("");
  const [draftTemplates, setDraftTemplates] = useState([]);
  const [selectedDraftTemplateId, setSelectedDraftTemplateId] = useState("");
  const [defaultDraftTemplateHydrated, setDefaultDraftTemplateHydrated] = useState(false);

  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const lastObservedUrlDocumentIdRef = useRef(null);
  const pendingUrlSelectionDocumentIdRef = useRef(null);
  const appliedCreatePrefillSignatureRef = useRef("");
  const lastAppliedFixedRouteDirectionRef = useRef(null);
  const internalCommentTextareaRef = useRef(null);
  const internalCommentMentionRequestRef = useRef(0);

  const [editForm, setEditForm] = useState(() => createInitialDraftForm());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editValidationVisible, setEditValidationVisible] = useState(false);
  const [, setEditDueDateTouched] = useState(false);
  const [editCounterpartyOptions, setEditCounterpartyOptions] = useState([]);
  const [editCounterpartyLoading, setEditCounterpartyLoading] = useState(false);
  const [editCounterpartyLookupQuery, setEditCounterpartyLookupQuery] = useState("");
  const [editCashRegisterRows, setEditCashRegisterRows] = useState([]);
  const [editCashRegistersLoading, setEditCashRegistersLoading] = useState(false);
  const [editCashRegistersError, setEditCashRegistersError] = useState("");
  const [editOperatingUnitOptions, setEditOperatingUnitOptions] = useState([]);
  const [editOperatingUnitsLoading, setEditOperatingUnitsLoading] = useState(false);
  const [editOperatingUnitsError, setEditOperatingUnitsError] = useState("");
  const [editLineAccountRows, setEditLineAccountRows] = useState([]);
  const [editLineAccountsLoading, setEditLineAccountsLoading] = useState(false);
  const [editLineAccountsError, setEditLineAccountsError] = useState("");
  const [editItemCardRows, setEditItemCardRows] = useState([]);
  const [editItemCardsLoading, setEditItemCardsLoading] = useState(false);
  const [editItemCardsError, setEditItemCardsError] = useState("");
  const [editFixedAssetCategoryRows, setEditFixedAssetCategoryRows] = useState([]);
  const [editFixedAssetCategoriesLoading, setEditFixedAssetCategoriesLoading] = useState(false);
  const [editFixedAssetCategoriesError, setEditFixedAssetCategoriesError] = useState("");
  const [editFixedAssetDraftRows, setEditFixedAssetDraftRows] = useState([]);
  const [editFixedAssetDraftLoading, setEditFixedAssetDraftLoading] = useState(false);
  const [editFixedAssetDraftError, setEditFixedAssetDraftError] = useState("");
  const [editFixedAssetSaleRows, setEditFixedAssetSaleRows] = useState([]);
  const [editFixedAssetSaleLoading, setEditFixedAssetSaleLoading] = useState(false);
  const [editFixedAssetSaleError, setEditFixedAssetSaleError] = useState("");
  const [editWarehouseRows, setEditWarehouseRows] = useState([]);
  const [editWarehousesLoading, setEditWarehousesLoading] = useState(false);
  const [editWarehousesError, setEditWarehousesError] = useState("");
  const [editLinePreviewLoading, setEditLinePreviewLoading] = useState(false);
  const [editLinePreviewError, setEditLinePreviewError] = useState("");
  const [editLinePreviewMessage, setEditLinePreviewMessage] = useState("");
  const [editInlineCounterpartySaving, setEditInlineCounterpartySaving] = useState(false);
  const [editInlineCounterpartyError, setEditInlineCounterpartyError] = useState("");
  const [editInlineCounterpartyMessage, setEditInlineCounterpartyMessage] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [quickCreateFixedAssetOpen, setQuickCreateFixedAssetOpen] = useState(false);
  const [quickCreateFixedAssetForm, setQuickCreateFixedAssetForm] = useState(() =>
    createInitialQuickCreateFixedAssetForm()
  );
  const [quickCreateFixedAssetSaving, setQuickCreateFixedAssetSaving] = useState(false);
  const [quickCreateFixedAssetError, setQuickCreateFixedAssetError] = useState("");
  const [fixedAssetCategorySetupPrompt, setFixedAssetCategorySetupPrompt] = useState(null);

  const [postForm, setPostForm] = useState(() => buildInitialPostForm());
  const [postOffsetAccountOptions, setPostOffsetAccountOptions] = useState([]);
  const [postOffsetAccountsLoading, setPostOffsetAccountsLoading] = useState(false);
  const [postOffsetAccountsError, setPostOffsetAccountsError] = useState("");
  const [postWarehouseRows, setPostWarehouseRows] = useState([]);
  const [postWarehousesLoading, setPostWarehousesLoading] = useState(false);
  const [postWarehousesError, setPostWarehousesError] = useState("");
  const [postSaving, setPostSaving] = useState(false);
  const [postError, setPostError] = useState("");
  const [postTransferGuidance, setPostTransferGuidance] = useState(null);
  const [postMessage, setPostMessage] = useState("");

  const [reverseForm, setReverseForm] = useState(() => ({
    reason: l("Manual reversal", "Manuel ters kayit"),
    reversalDate: "",
  }));
  const [reverseSaving, setReverseSaving] = useState(false);
  const [reverseError, setReverseError] = useState("");
  const [reverseMessage, setReverseMessage] = useState("");
  const [reverseResult, setReverseResult] = useState(null);
  const [reverseInventoryBlocks, setReverseInventoryBlocks] = useState([]);
  const [linkedCashRows, setLinkedCashRows] = useState([]);
  const [linkedCashLoading, setLinkedCashLoading] = useState(false);
  const [linkedCashError, setLinkedCashError] = useState("");
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState("");
  const [relatedJournal, setRelatedJournal] = useState(null);
  const [relatedOpenItems, setRelatedOpenItems] = useState([]);
  const [relatedExceptions, setRelatedExceptions] = useState([]);
  const [relatedAuditRows, setRelatedAuditRows] = useState([]);
  const [internalCommentRows, setInternalCommentRows] = useState([]);
  const [internalCommentsLoading, setInternalCommentsLoading] = useState(false);
  const [internalCommentsError, setInternalCommentsError] = useState("");
  const [internalCommentsMessage, setInternalCommentsMessage] = useState("");
  const [internalCommentBody, setInternalCommentBody] = useState("");
  const [internalCommentSaving, setInternalCommentSaving] = useState(false);
  const [internalCommentMentionDraft, setInternalCommentMentionDraft] = useState(null);
  const [internalCommentMentionRows, setInternalCommentMentionRows] = useState([]);
  const [internalCommentMentionLoading, setInternalCommentMentionLoading] = useState(false);
  const [internalCommentMentionError, setInternalCommentMentionError] = useState("");
  const [internalCommentMentionHighlightIndex, setInternalCommentMentionHighlightIndex] = useState(-1);
  const [opsStatusRow, setOpsStatusRow] = useState(null);
  const [opsStatusLoading, setOpsStatusLoading] = useState(false);
  const [opsStatusError, setOpsStatusError] = useState("");
  const [opsStatusMessage, setOpsStatusMessage] = useState("");
  const [opsStatusSaving, setOpsStatusSaving] = useState(false);
  const [opsStatusForm, setOpsStatusForm] = useState({
    opsStatus: "OK",
    blockedReason: "",
    note: "",
  });
  const [evidenceRows, setEvidenceRows] = useState([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceMessage, setEvidenceMessage] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceUploadFile, setEvidenceUploadFile] = useState(null);
  const [evidenceUploadInputKey, setEvidenceUploadInputKey] = useState(0);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidenceDeletingId, setEvidenceDeletingId] = useState(null);
  const [evidenceDownloadingId, setEvidenceDownloadingId] = useState(null);
  const [documentListPage, setDocumentListPage] = useState(1);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsSaving, setSavedViewsSaving] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState("");
  const [savedViewsMessage, setSavedViewsMessage] = useState("");
  const [savedViews, setSavedViews] = useState([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [defaultSavedViewHydrated, setDefaultSavedViewHydrated] = useState(false);
  const operatingUnitsById = useMemo(
    () =>
      buildOperatingUnitsById(
        filterOperatingUnitOptions,
        createOperatingUnitOptions,
        editOperatingUnitOptions
      ),
    [createOperatingUnitOptions, editOperatingUnitOptions, filterOperatingUnitOptions]
  );

  const documentTableColumns = useMemo(
    () => [
      {
        id: "id",
        label: "ID",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2 font-mono text-xs",
        render: (row) => row?.id || "-",
      },
      {
        id: "documentNo",
        label: "Document No",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.documentNo || "-",
      },
      {
        id: "operatingUnit",
        label: "Operating Unit",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => getDocumentOperatingUnitLabel(row, operatingUnitsById),
      },
      {
        id: "direction",
        label: "Direction",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.direction || "-",
      },
      {
        id: "documentType",
        label: "Type",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.documentType || "-",
      },
      {
        id: "status",
        label: "Status",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.status || "-",
      },
      {
        id: "documentDate",
        label: "Document Date",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.documentDate || "-",
      },
      {
        id: "amountTxn",
        label: "Invoice Amount",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => (
          <MoneyText
            amount={row?.amountTxn}
            currencyCode={row?.currencyCode || row?.currencyCodeSnapshot || row?.currency_code}
            variant="stack"
          />
        ),
      },
      {
        id: "postedJournal",
        label: "Posted Journal",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.postedJournalEntryId || "-",
      },
      {
        id: "reversalOf",
        label: "Reversal Of",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.reversalOfDocumentId || "-",
      },
      {
        id: "action",
        label: "Action",
        headerClassName: "px-3 py-2 text-right",
        cellClassName: "px-3 py-2 text-right",
        render: (row) => (
          <button
            type="button"
            className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
            onClick={() => setSelectedDocumentId(row?.id)}
          >
            View / Actions
          </button>
        ),
      },
    ],
    [operatingUnitsById, setSelectedDocumentId]
  );
  const documentTableColumnIds = useMemo(
    () => documentTableColumns.map((column) => column.id),
    [documentTableColumns]
  );
  const [documentTablePrefs, setDocumentTablePrefs, resetDocumentTablePrefs] =
    usePersistedTablePrefs(
      DOCUMENT_TABLE_PREFS_STORAGE_SCOPE,
      {
        rowsPerPage: DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
        stickyHeader: false,
        visibleColumnIds: documentTableColumnIds,
      },
      documentTableColumnIds
    );
  const documentVisibleColumns = useMemo(() => {
    const visibleIds = new Set(documentTablePrefs.visibleColumnIds || []);
    return documentTableColumns.filter((column) => visibleIds.has(column.id));
  }, [documentTableColumns, documentTablePrefs.visibleColumnIds]);
  const documentRowsPerPage = useMemo(
    () =>
      toPositiveInt(documentTablePrefs.rowsPerPage) ||
      DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
    [documentTablePrefs.rowsPerPage]
  );
  const documentVisibleColumnCount = Math.max(1, documentVisibleColumns.length);
  const selectedSavedView = useMemo(
    () =>
      savedViews.find(
        (row) => Number(row?.id || 0) === Number(selectedSavedViewId || 0)
      ) || null,
    [savedViews, selectedSavedViewId]
  );
  const selectedDraftTemplate = useMemo(
    () =>
      draftTemplates.find(
        (row) => Number(row?.id || 0) === Number(selectedDraftTemplateId || 0)
      ) || null,
    [draftTemplates, selectedDraftTemplateId]
  );

  useWorkingContextDefaults(
    setFilters,
    filterContextDefaultsSuspended ? [] : DOCUMENT_FILTER_CONTEXT_MAPPINGS,
    [
      filterContextDefaultsSuspended,
      filters.legalEntityId,
      filters.dateFrom,
      filters.dateTo,
    ]
  );
  useWorkingContextDefaults(
    setCreateForm,
    createContextDefaultsSuspended ? [] : DOCUMENT_CREATE_CONTEXT_MAPPINGS,
    [createContextDefaultsSuspended, createForm.legalEntityId, createForm.documentDate]
  );

  const selectedRow = useMemo(
    () => rows.find((row) => Number(row?.id || 0) === Number(selectedDocumentId || 0)) || null,
    [rows, selectedDocumentId]
  );
  const selectedSnapshot = selectedDetail || selectedRow;
  const selectedDocumentOutsideList = useMemo(() => {
    const selectedId = Number(selectedSnapshot?.id || 0);
    if (!selectedId) {
      return false;
    }
    return !rows.some((row) => Number(row?.id || 0) === selectedId);
  }, [rows, selectedSnapshot]);
  const documentListRows = useMemo(() => {
    if (!selectedDocumentOutsideList || !selectedSnapshot) {
      return rows;
    }
    return [
      {
        ...selectedSnapshot,
        _outsideActiveFilters: true,
      },
      ...rows,
    ];
  }, [rows, selectedDocumentOutsideList, selectedSnapshot]);
  const documentListTotalPages = useMemo(() => {
    if (!documentListRows.length) {
      return 1;
    }
    return Math.max(1, Math.ceil(documentListRows.length / documentRowsPerPage));
  }, [documentListRows.length, documentRowsPerPage]);
  const pagedDocumentRows = useMemo(() => {
    const startIndex = Math.max(0, (documentListPage - 1) * documentRowsPerPage);
    return documentListRows.slice(startIndex, startIndex + documentRowsPerPage);
  }, [documentListPage, documentListRows, documentRowsPerPage]);
  const selectedDocumentDirection = normalizeDirection(
    selectedSnapshot?.direction || selectedSnapshot?.documentDirection
  );
  const selectedOffsetAccountType = resolveOffsetAccountTypeByDirection(
    selectedDocumentDirection
  );
  const filteredPostOffsetAccountOptions = useMemo(() => {
    const sourceOptions = Array.isArray(postOffsetAccountOptions)
      ? postOffsetAccountOptions
      : [];
    if (postForm.showAllOffsetAccounts || !selectedOffsetAccountType) {
      return sourceOptions;
    }
    return sourceOptions.filter(
      (row) => String(row?.accountType || "").toUpperCase() === selectedOffsetAccountType
    );
  }, [
    postForm.showAllOffsetAccounts,
    postOffsetAccountOptions,
    selectedOffsetAccountType,
  ]);
  const selectedDocumentNumericId = toPositiveInt(selectedSnapshot?.id);
  const selectedDocumentLegalEntityId = toPositiveInt(
    selectedSnapshot?.legalEntityId || selectedSnapshot?.legal_entity_id
  );
  const selectedPostedJournalEntryId = toPositiveInt(
    selectedSnapshot?.postedJournalEntryId || selectedSnapshot?.posted_journal_entry_id
  );
  const selectedCariPostingReadiness = getModuleRow(
    "cariPosting",
    selectedDocumentLegalEntityId
  );
  const cariPostingNotReady = Boolean(
    selectedCariPostingReadiness && !selectedCariPostingReadiness.ready
  );
  const canEditOrCancelSelected = Boolean(selectedSnapshot && isDraft(selectedSnapshot) && canUpdate);
  const canPostSelected = Boolean(
    selectedSnapshot && isDraft(selectedSnapshot) && canPost && !cariPostingNotReady
  );
  const canReverseSelected = Boolean(
    selectedSnapshot && canReverseDocument(selectedSnapshot) && canReverse
  );
  const canAttachEvidence = Boolean(selectedSnapshot && canUpdate);
  const canWriteInternalComments = Boolean(selectedSnapshot && canUpdate);
  const canWriteOpsStatus = Boolean(selectedSnapshot && canUpdate);

  function closeInternalCommentMentionPicker() {
    internalCommentMentionRequestRef.current += 1;
    setInternalCommentMentionDraft(null);
    setInternalCommentMentionRows([]);
    setInternalCommentMentionLoading(false);
    setInternalCommentMentionError("");
    setInternalCommentMentionHighlightIndex(-1);
  }

  function syncInternalCommentMentionDraft(value, selectionStart) {
    if (!selectedDocumentNumericId || !canWriteInternalComments || internalCommentSaving) {
      closeInternalCommentMentionPicker();
      return;
    }
    const nextDraft = getInternalCommentMentionDraft(value, selectionStart);
    if (!nextDraft) {
      closeInternalCommentMentionPicker();
      return;
    }
    const isSameDraft =
      internalCommentMentionDraft &&
      internalCommentMentionDraft.query === nextDraft.query &&
      internalCommentMentionDraft.replaceFrom === nextDraft.replaceFrom &&
      internalCommentMentionDraft.replaceTo === nextDraft.replaceTo;
    setInternalCommentMentionError("");
    if (isSameDraft) {
      return;
    }
    setInternalCommentMentionDraft(nextDraft);
    setInternalCommentMentionHighlightIndex(0);
  }

  function handleInternalCommentBodyChange(event) {
    const nextValue = String(event?.target?.value || "");
    const nextSelectionStart = event?.target?.selectionStart;
    setInternalCommentsError("");
    setInternalCommentsMessage("");
    setInternalCommentBody(nextValue);
    syncInternalCommentMentionDraft(nextValue, nextSelectionStart);
  }

  function handleInternalCommentBodyCursorChange(event) {
    syncInternalCommentMentionDraft(event?.target?.value, event?.target?.selectionStart);
  }

  function handleInternalCommentBodyBlur() {
    window.setTimeout(() => {
      if (document.activeElement === internalCommentTextareaRef.current) {
        return;
      }
      closeInternalCommentMentionPicker();
    }, 0);
  }

  function applyInternalCommentMention(candidate) {
    const email = normalizeText(candidate?.email);
    if (!email) {
      return;
    }
    const textarea = internalCommentTextareaRef.current;
    const currentValue = String(internalCommentBody || "");
    const activeDraft =
      internalCommentMentionDraft ||
      getInternalCommentMentionDraft(currentValue, textarea?.selectionStart);
    if (!activeDraft) {
      return;
    }
    const nextCharacter = currentValue.slice(activeDraft.replaceTo, activeDraft.replaceTo + 1);
    const spacer = shouldInsertMentionSpacer(nextCharacter) ? " " : "";
    const insertedText = `@${email}${spacer}`;
    const nextValue = `${currentValue.slice(0, activeDraft.replaceFrom)}${insertedText}${currentValue.slice(
      activeDraft.replaceTo
    )}`;
    const nextCaretPosition = activeDraft.replaceFrom + insertedText.length;

    setInternalCommentsError("");
    setInternalCommentsMessage("");
    setInternalCommentBody(nextValue);
    closeInternalCommentMentionPicker();

    window.requestAnimationFrame(() => {
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  function handleInternalCommentBodyKeyDown(event) {
    if (!internalCommentMentionDraft) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeInternalCommentMentionPicker();
      return;
    }
    if (!internalCommentMentionRows.length) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setInternalCommentMentionHighlightIndex((previous) =>
        previous >= internalCommentMentionRows.length - 1 ? 0 : previous + 1
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setInternalCommentMentionHighlightIndex((previous) =>
        previous <= 0 ? internalCommentMentionRows.length - 1 : previous - 1
      );
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && internalCommentMentionHighlightIndex >= 0) {
      const candidate = internalCommentMentionRows[internalCommentMentionHighlightIndex];
      if (!candidate) {
        return;
      }
      event.preventDefault();
      applyInternalCommentMention(candidate);
    }
  }

  const selectedDocumentAmountTxn = toPositiveDecimal(
    selectedSnapshot?.amountTxn ?? selectedSnapshot?.amount_txn
  );
  const selectedDocumentAmountBase = toPositiveDecimal(
    selectedSnapshot?.amountBase ?? selectedSnapshot?.amount_base
  );
  const selectedDetailForPosting = useMemo(() => {
    const activeDocumentId = toPositiveInt(selectedDocumentId);
    const loadedDetailId = toPositiveInt(selectedDetail?.id);
    if (!activeDocumentId || !loadedDetailId || activeDocumentId !== loadedDetailId) {
      return null;
    }
    return selectedDetail;
  }, [selectedDetail, selectedDocumentId]);
  const selectedDocumentPostingRulesReady = !toPositiveInt(selectedDocumentId) || Boolean(
    selectedDetailForPosting
  );
  const selectedDocumentUsesStoredTaxesForPosting = useMemo(
    () => documentUsesStoredLineTaxes(selectedDetailForPosting),
    [selectedDetailForPosting]
  );
  const selectedPostingDraftForm = useMemo(
    () => (selectedDetailForPosting ? mapDocumentRowToForm(selectedDetailForPosting) : null),
    [selectedDetailForPosting]
  );
  const selectedPostingWarehouseValidation = useMemo(
    () =>
      analyzeDocumentWarehouseBindings(selectedPostingDraftForm, {
        warehouseRowsById: buildRowsById(postWarehouseRows),
        warehouseLoading: postWarehousesLoading,
        warehouseError: postWarehousesError,
        l,
      }),
    [
      l,
      postWarehouseRows,
      postWarehousesError,
      postWarehousesLoading,
      selectedPostingDraftForm,
    ]
  );
  const reverseInventoryBlockSummary = useMemo(() => {
    const issueCount = reverseInventoryBlocks.filter(
      (row) => String(row?.inventoryMovementType || "").trim().toUpperCase() === "ISSUE"
    ).length;
    const receiptCount = reverseInventoryBlocks.filter(
      (row) => String(row?.inventoryMovementType || "").trim().toUpperCase() === "RECEIPT"
    ).length;
    const stepMessages = [];
    if (issueCount > 0) {
      stepMessages.push(
        l(
          "Reverse the linked valued issue movement first in Inventory Movements.",
          "Stok Hareketleri ekraninda once bagli degerlenmis cikis hareketini tersleyin."
        )
      );
      stepMessages.push(
        l(
          "If stock still needs to leave after correction, rematerialize the reopened successor pending stock link.",
          "Duzeltmeden sonra stok cikisi hala gerekiyorsa yeniden acilan ardil bekleyen stok baglantisini tekrar yansitin."
        )
      );
    }
    if (receiptCount > 0) {
      stepMessages.push(
        l(
          "Undo the linked materialized receipt only when no later issue chronology still depends on it.",
          "Bagli gerceklestirilmis alimi yalnizca daha sonraki cikis kronolojisi hala buna bagli degilse geri alin."
        )
      );
    }
    if (reverseInventoryBlocks.length > 0) {
      stepMessages.push(
        l(
          "Use the inventory movement links below, then retry the document reverse.",
          "Asagidaki stok hareketi baglantilarini kullanin, sonra belge ters kaydini tekrar deneyin."
        )
      );
    }
    return {
      issueCount,
      receiptCount,
      stepMessages,
    };
  }, [l, reverseInventoryBlocks]);
  const postFormPostingLineSummary = useMemo(() => {
    const rows = Array.isArray(postForm.postingLines) ? postForm.postingLines : [];
    let totalTxn = 0;
    let totalBase = 0;
    let invalidAmountRows = 0;
    for (const row of rows) {
      const lineAmountTxn = toPositiveDecimal(row?.amountTxn);
      const lineAmountBase = toPositiveDecimal(row?.amountBase);
      if (!lineAmountTxn || !lineAmountBase) {
        invalidAmountRows += 1;
      }
      if (lineAmountTxn) {
        totalTxn = Number((totalTxn + lineAmountTxn).toFixed(6));
      }
      if (lineAmountBase) {
        totalBase = Number((totalBase + lineAmountBase).toFixed(6));
      }
    }
    const hasDraftTotals = Boolean(
      selectedDocumentAmountTxn && selectedDocumentAmountBase
    );
    const matchesDraftTotals = Boolean(
      hasDraftTotals &&
        invalidAmountRows === 0 &&
        amountsMatch(totalTxn, selectedDocumentAmountTxn) &&
        amountsMatch(totalBase, selectedDocumentAmountBase)
    );
    return {
      lineCount: rows.length,
      invalidAmountRows,
      totalTxn,
      totalBase,
      hasDraftTotals,
      matchesDraftTotals,
    };
  }, [
    postForm.postingLines,
    selectedDocumentAmountBase,
    selectedDocumentAmountTxn,
  ]);
  const postingLinesReadyForSubmit = !postForm.usePostingLines || Boolean(
    postFormPostingLineSummary.lineCount > 0 &&
      postFormPostingLineSummary.hasDraftTotals &&
      postFormPostingLineSummary.invalidAmountRows === 0 &&
      postFormPostingLineSummary.matchesDraftTotals
  );
  const selectedDocumentLifecycleMeta = useMemo(
    () => getLifecycleStatusMeta("cariDocument", selectedSnapshot?.status, l),
    [l, selectedSnapshot?.status]
  );
  const selectedDocumentLifecycleActions = useMemo(
    () => getLifecycleAllowedActions("cariDocument", selectedSnapshot?.status, l),
    [l, selectedSnapshot?.status]
  );
  const selectedDocumentLifecycleTimeline = useMemo(
    () =>
      buildLifecycleTimelineSteps(
        "cariDocument",
        selectedSnapshot?.status,
        buildDocumentLifecycleEvents(selectedSnapshot, l),
        l
      ),
    [l, selectedSnapshot]
  );
  const deepLinkedDocumentIdRaw = String(
    searchParams.get("documentId") || searchParams.get("document_id") || ""
  ).trim();
  const deepLinkedDocumentId = toPositiveInt(deepLinkedDocumentIdRaw);
  const fixedAssetSaleCreatePrefill = useMemo(
    () => buildFixedAssetSaleCreatePrefill(searchParams),
    [searchParams]
  );
  const fixedAssetSaleCreatePrefillSignature = useMemo(() => {
    if (!fixedAssetSaleCreatePrefill) {
      return "";
    }
    return [
      fixedAssetSaleCreatePrefill.mode,
      fixedAssetSaleCreatePrefill.direction,
      fixedAssetSaleCreatePrefill.targetFixedAssetId,
      fixedAssetSaleCreatePrefill.legalEntityId,
      fixedAssetSaleCreatePrefill.operatingUnitId,
      fixedAssetSaleCreatePrefill.assetNo,
      fixedAssetSaleCreatePrefill.assetName,
    ].join("|");
  }, [fixedAssetSaleCreatePrefill]);
  const filterCounterpartyLookupOptions = useMemo(
    () => (filterCounterpartyOptions || []).map(mapCounterpartyLookupOption).filter((row) => row.value),
    [filterCounterpartyOptions]
  );
  const filterOperatingUnitLookupOptions = useMemo(() => {
    const selectedOperatingUnitId = normalizeText(filters.operatingUnitId);
    const rows = (filterOperatingUnitOptions || [])
      .map(mapOperatingUnitLookupOption)
      .filter((row) => row.value);
    if (
      selectedOperatingUnitId &&
      !rows.some((row) => String(row.value) === selectedOperatingUnitId)
    ) {
      rows.unshift({
        value: selectedOperatingUnitId,
        label: `Operating unit #${selectedOperatingUnitId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [filterOperatingUnitOptions, filters.operatingUnitId]);
  const legalEntityLookupOptions = useMemo(
    () =>
      (workingContextLegalEntities || [])
        .map(mapLegalEntityLookupOption)
        .filter((row) => row.value),
    [workingContextLegalEntities]
  );
  const legalEntityRowsById = useMemo(
    () =>
      new Map(
        (workingContextLegalEntities || [])
          .map((row) => [toPositiveInt(row?.id), row])
          .filter(([id]) => id)
      ),
    [workingContextLegalEntities]
  );
  const selectedDocumentLegalEntity = useMemo(
    () => legalEntityRowsById.get(selectedDocumentLegalEntityId) || null,
    [legalEntityRowsById, selectedDocumentLegalEntityId]
  );
  const selectedDocumentFunctionalCurrencyCode = useMemo(
    () =>
      normalizeCurrencyCode(
        selectedDocumentLegalEntity?.functional_currency_code ||
          selectedDocumentLegalEntity?.functionalCurrencyCode
      ),
    [selectedDocumentLegalEntity]
  );
  const filterLegalEntityLookupOptions = useMemo(() => {
    const selectedLegalEntityId = normalizeText(filters.legalEntityId);
    const rows = [...legalEntityLookupOptions];
    if (
      selectedLegalEntityId &&
      !rows.some((row) => String(row.value) === selectedLegalEntityId)
    ) {
      rows.unshift({
        value: selectedLegalEntityId,
        label: `Legal entity #${selectedLegalEntityId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [filters.legalEntityId, legalEntityLookupOptions]);
  const createLegalEntityLookupOptions = useMemo(() => {
    const selectedLegalEntityId = normalizeText(createForm.legalEntityId);
    const rows = [...legalEntityLookupOptions];
    if (
      selectedLegalEntityId &&
      !rows.some((row) => String(row.value) === selectedLegalEntityId)
    ) {
      rows.unshift({
        value: selectedLegalEntityId,
        label: `Legal entity #${selectedLegalEntityId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [createForm.legalEntityId, legalEntityLookupOptions]);
  const createSelectedLegalEntity = useMemo(
    () => legalEntityRowsById.get(toPositiveInt(createForm.legalEntityId)) || null,
    [createForm.legalEntityId, legalEntityRowsById]
  );
  const editSelectedLegalEntity = useMemo(
    () => legalEntityRowsById.get(toPositiveInt(editForm.legalEntityId)) || null,
    [editForm.legalEntityId, legalEntityRowsById]
  );
  const createFunctionalCurrencyCode = useMemo(
    () =>
      normalizeCurrencyCode(
        createSelectedLegalEntity?.functional_currency_code ||
          createSelectedLegalEntity?.functionalCurrencyCode
      ),
    [createSelectedLegalEntity]
  );
  const editFunctionalCurrencyCode = useMemo(
    () =>
      normalizeCurrencyCode(
        editSelectedLegalEntity?.functional_currency_code ||
          editSelectedLegalEntity?.functionalCurrencyCode
      ),
    [editSelectedLegalEntity]
  );
  const createDocumentMutationOptions = useMemo(
    () => ({
      functionalCurrencyCode: createFunctionalCurrencyCode || null,
    }),
    [createFunctionalCurrencyCode]
  );
  const editDocumentMutationOptions = useMemo(
    () => ({
      functionalCurrencyCode: editFunctionalCurrencyCode || null,
    }),
    [editFunctionalCurrencyCode]
  );
  const createDocumentFxComputation = useMemo(
    () => getDocumentFxComputation(createForm, createDocumentMutationOptions),
    [createDocumentMutationOptions, createForm]
  );
  const createResolvedAmountBaseText = useMemo(
    () => normalizeOptionalDecimalText(createDocumentFxComputation.resolvedAmountBase),
    [createDocumentFxComputation.resolvedAmountBase]
  );
  const editDocumentFxComputation = useMemo(
    () => getDocumentFxComputation(editForm, editDocumentMutationOptions),
    [editDocumentMutationOptions, editForm]
  );
  const editResolvedAmountBaseText = useMemo(() => {
    if (editFunctionalCurrencyCode) {
      return normalizeOptionalDecimalText(editDocumentFxComputation.derivedAmountBase);
    }
    return normalizeOptionalDecimalText(editForm.amountBase);
  }, [
    editDocumentFxComputation.derivedAmountBase,
    editForm.amountBase,
    editFunctionalCurrencyCode,
  ]);
  const createLineAccountOptions = useMemo(
    () => extendAccountOptionsForSelectedLines(createLineAccountRows, createForm.lines),
    [createForm.lines, createLineAccountRows]
  );
  const editLineAccountOptions = useMemo(
    () => extendAccountOptionsForSelectedLines(editLineAccountRows, editForm.lines),
    [editForm.lines, editLineAccountRows]
  );
  const createItemCardOptions = useMemo(
    () =>
      extendItemCardOptionsForSelectedLines(
        mapItemCardLookupOptions(createItemCardRows),
        createForm.lines
      ),
    [createForm.lines, createItemCardRows]
  );
  const createTaxCategoryOptions = useMemo(
    () => buildTaxCategoryOptions(taxRuleRows, createForm.legalEntityId, createForm.lines),
    [createForm.legalEntityId, createForm.lines, taxRuleRows]
  );
  const editItemCardOptions = useMemo(
    () =>
      extendItemCardOptionsForSelectedLines(
        mapItemCardLookupOptions(editItemCardRows),
        editForm.lines
      ),
    [editForm.lines, editItemCardRows]
  );
  const editTaxCategoryOptions = useMemo(
    () => buildTaxCategoryOptions(taxRuleRows, editForm.legalEntityId, editForm.lines),
    [editForm.legalEntityId, editForm.lines, taxRuleRows]
  );
  const createWarehouseRowsById = useMemo(
    () => buildRowsById(createWarehouseRows),
    [createWarehouseRows]
  );
  const editWarehouseRowsById = useMemo(
    () => buildRowsById(editWarehouseRows),
    [editWarehouseRows]
  );
  const createWarehouseOptions = useMemo(
    () =>
      extendWarehouseOptionsForSelectedLines(
        mapWarehouseLookupOptions(createWarehouseRows, l),
        createForm.lines,
        l
      ),
    [createForm.lines, createWarehouseRows, l]
  );
  const editWarehouseOptions = useMemo(
    () =>
      extendWarehouseOptionsForSelectedLines(
        mapWarehouseLookupOptions(editWarehouseRows, l),
        editForm.lines,
        l
      ),
    [editForm.lines, editWarehouseRows, l]
  );
  const createWarehouseValidation = useMemo(
    () =>
      analyzeDocumentWarehouseBindings(createForm, {
        warehouseRowsById: createWarehouseRowsById,
        warehouseLoading: createWarehousesLoading,
        warehouseError: createWarehousesError,
        l,
      }),
    [
      createForm,
      createWarehouseRowsById,
      createWarehousesLoading,
      createWarehousesError,
      l,
    ]
  );
  const editWarehouseValidation = useMemo(
    () =>
      analyzeDocumentWarehouseBindings(editForm, {
        warehouseRowsById: editWarehouseRowsById,
        warehouseLoading: editWarehousesLoading,
        warehouseError: editWarehousesError,
        l,
      }),
    [editForm, editWarehouseRowsById, editWarehousesLoading, editWarehousesError, l]
  );
  const createValidationResult = useMemo(
    () => validateDocumentMutationForm(createForm, createDocumentMutationOptions),
    [createDocumentMutationOptions, createForm]
  );
  const editValidationResult = useMemo(
    () => validateDocumentMutationForm(editForm, editDocumentMutationOptions),
    [editDocumentMutationOptions, editForm]
  );
  const createLineValidationMessages = useMemo(
    () =>
      createValidationVisible
        ? translateDocumentMutationLineErrorMap(
            createValidationResult.lineErrors,
            translateDocumentMutationError
          )
        : new Map(),
    [
      createValidationResult.lineErrors,
      createValidationVisible,
      translateDocumentMutationError,
    ]
  );
  const editLineValidationMessages = useMemo(
    () =>
      editValidationVisible
        ? translateDocumentMutationLineErrorMap(
            editValidationResult.lineErrors,
            translateDocumentMutationError
          )
        : new Map(),
    [editValidationResult.lineErrors, editValidationVisible, translateDocumentMutationError]
  );
  const createValidationSummary = useMemo(() => {
    if (!createValidationVisible) {
      return "";
    }
    const messages = [
      ...createValidationResult.generalErrors.map((message) =>
        translateDocumentMutationError(message)
      ),
    ];
    if (createValidationResult.lineErrors.size > 0) {
      messages.push(
        l(
          "Fix the highlighted line validation errors.",
          "Vurgulanan satir dogrulama hatalarini duzeltin."
        )
      );
    }
    return [...new Set(messages.filter(Boolean))].join(" ");
  }, [
    createValidationResult.generalErrors,
    createValidationResult.lineErrors,
    createValidationVisible,
    l,
    translateDocumentMutationError,
  ]);
  const editValidationSummary = useMemo(() => {
    if (!editValidationVisible) {
      return "";
    }
    const messages = [
      ...editValidationResult.generalErrors.map((message) =>
        translateDocumentMutationError(message)
      ),
    ];
    if (editValidationResult.lineErrors.size > 0) {
      messages.push(
        l(
          "Fix the highlighted line validation errors.",
          "Vurgulanan satir dogrulama hatalarini duzeltin."
        )
      );
    }
    return [...new Set(messages.filter(Boolean))].join(" ");
  }, [
    editValidationResult.generalErrors,
    editValidationResult.lineErrors,
    editValidationVisible,
    l,
    translateDocumentMutationError,
  ]);
  const createItemCardRowsById = useMemo(
    () =>
      new Map(
        (Array.isArray(createItemCardRows) ? createItemCardRows : [])
          .map((row) => [Number(row?.id || 0), row])
          .filter(([id]) => id > 0)
      ),
    [createItemCardRows]
  );
  const editItemCardRowsById = useMemo(
    () =>
      new Map(
        (Array.isArray(editItemCardRows) ? editItemCardRows : [])
          .map((row) => [Number(row?.id || 0), row])
          .filter(([id]) => id > 0)
      ),
    [editItemCardRows]
  );
  const createLineAccountsById = useMemo(
    () => buildRowsById(createLineAccountOptions),
    [createLineAccountOptions]
  );
  const editLineAccountsById = useMemo(
    () => buildRowsById(editLineAccountOptions),
    [editLineAccountOptions]
  );
  const createFixedAssetCategoriesById = useMemo(
    () => buildRowsById(createFixedAssetCategoryRows),
    [createFixedAssetCategoryRows]
  );
  const editFixedAssetCategoriesById = useMemo(
    () => buildRowsById(editFixedAssetCategoryRows),
    [editFixedAssetCategoryRows]
  );
  const createFixedAssetDraftRowsById = useMemo(
    () => buildRowsById(createFixedAssetDraftRows),
    [createFixedAssetDraftRows]
  );
  const editFixedAssetDraftRowsById = useMemo(
    () => buildRowsById(editFixedAssetDraftRows),
    [editFixedAssetDraftRows]
  );
  const createFixedAssetSaleRowsById = useMemo(
    () => buildRowsById(createFixedAssetSaleRows),
    [createFixedAssetSaleRows]
  );
  const editFixedAssetSaleRowsById = useMemo(
    () => buildRowsById(editFixedAssetSaleRows),
    [editFixedAssetSaleRows]
  );
  const createFixedAssetOperatingUnitOptions = useMemo(
    () =>
      (createOperatingUnitOptions || [])
        .map(mapOperatingUnitLookupOption)
        .filter((row) => row.value),
    [createOperatingUnitOptions]
  );
  const editFixedAssetOperatingUnitOptions = useMemo(
    () =>
      (editOperatingUnitOptions || [])
        .map(mapOperatingUnitLookupOption)
        .filter((row) => row.value),
    [editOperatingUnitOptions]
  );
  const createFixedAssetCategoryOptions = useMemo(
    () =>
      extendFixedAssetCategoryOptionsForSelectedLines(
        mapFixedAssetCategoryLookupOptions(
          createFixedAssetCategoryRows,
          createLineAccountsById
        ),
        createForm.lines
      ),
    [createFixedAssetCategoryRows, createForm.lines, createLineAccountsById]
  );
  const editFixedAssetCategoryOptions = useMemo(
    () =>
      extendFixedAssetCategoryOptionsForSelectedLines(
        mapFixedAssetCategoryLookupOptions(
          editFixedAssetCategoryRows,
          editLineAccountsById
        ),
        editForm.lines
      ),
    [editFixedAssetCategoryRows, editForm.lines, editLineAccountsById]
  );
  const createFixedAssetDraftOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(createFixedAssetDraftRows, operatingUnitsById, [
          "DRAFT",
        ]),
        createForm.lines
      ),
    [createFixedAssetDraftRows, createForm.lines, operatingUnitsById]
  );
  const editFixedAssetDraftOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(editFixedAssetDraftRows, operatingUnitsById, [
          "DRAFT",
        ]),
        editForm.lines
      ),
    [editFixedAssetDraftRows, editForm.lines, operatingUnitsById]
  );
  const createFixedAssetSaleOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(
          createFixedAssetSaleRows,
          operatingUnitsById,
          FIXED_ASSET_AR_ELIGIBLE_STATUSES
        ),
        createForm.lines
      ),
    [createFixedAssetSaleRows, createForm.lines, operatingUnitsById]
  );
  const editFixedAssetSaleOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(
          editFixedAssetSaleRows,
          operatingUnitsById,
          FIXED_ASSET_AR_ELIGIBLE_STATUSES
        ),
        editForm.lines
      ),
    [editFixedAssetSaleRows, editForm.lines, operatingUnitsById]
  );
  const createCounterpartyLookupOptions = useMemo(
    () => {
      const selectedCounterpartyId = normalizeText(createForm.counterpartyId);
      const rows = (createCounterpartyOptions || [])
        .map(mapCounterpartyLookupOption)
        .filter((row) => row.value);
      if (
        selectedCounterpartyId &&
        !rows.some((row) => String(row.value) === selectedCounterpartyId)
      ) {
        rows.unshift({
          value: selectedCounterpartyId,
          label: `Counterparty #${selectedCounterpartyId}`,
          description: "Selected value is outside current lookup scope.",
        });
      }
      return rows;
    },
    [createCounterpartyOptions, createForm.counterpartyId]
  );
  const createPaymentTermLookupOptions = useMemo(() => {
    const selectedPaymentTermId = normalizeText(createForm.paymentTermId);
    const rows = (createPaymentTermOptions || [])
      .map(mapPaymentTermLookupOption)
      .filter((row) => row.value);
    if (
      selectedPaymentTermId &&
      !rows.some((row) => String(row.value) === selectedPaymentTermId)
    ) {
      rows.unshift({
        value: selectedPaymentTermId,
        label: `Payment term #${selectedPaymentTermId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [createForm.paymentTermId, createPaymentTermOptions]);
  const selectedCreatePaymentTerm = useMemo(() => {
    const selectedPaymentTermId = toPositiveInt(createForm.paymentTermId);
    if (!selectedPaymentTermId) {
      return null;
    }
    return (
      createPaymentTermOptions.find(
        (row) => toPositiveInt(row?.id) === selectedPaymentTermId
      ) || null
    );
  }, [createForm.paymentTermId, createPaymentTermOptions]);
  const createImmediateCashDueDate =
    requiresDueDate(createForm.documentType) &&
    isImmediateCashSettlementMode(createForm.settlementMode)
      ? normalizeText(createForm.documentDate)
      : "";
  const createPaymentTermDerivedDueDate = resolvePaymentTermDueDateCandidate(
    createImmediateCashDueDate ? "" : createForm.documentDate,
    createImmediateCashDueDate ? null : selectedCreatePaymentTerm
  );
  const createDueDateForcedByImmediateCash = Boolean(
    createImmediateCashDueDate &&
      normalizeText(createForm.dueDate) === createImmediateCashDueDate
  );
  const createDueDateAutoDerived = Boolean(
    !createImmediateCashDueDate &&
      requiresDueDate(createForm.documentType) &&
      !createDueDateTouched &&
      createPaymentTermDerivedDueDate &&
      normalizeText(createForm.dueDate) === createPaymentTermDerivedDueDate
  );
  const createOperatingUnitLookupOptions = useMemo(() => {
    const selectedOperatingUnitId = normalizeText(createForm.operatingUnitId);
    const rows = (createOperatingUnitOptions || [])
      .map(mapOperatingUnitLookupOption)
      .filter((row) => row.value);
    if (
      selectedOperatingUnitId &&
      !rows.some((row) => String(row.value) === selectedOperatingUnitId)
    ) {
      rows.unshift({
        value: selectedOperatingUnitId,
        label: `Operating unit #${selectedOperatingUnitId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [createForm.operatingUnitId, createOperatingUnitOptions]);
  const selectedCreateCounterparty = useMemo(() => {
    const selectedCounterpartyId = toPositiveInt(createForm.counterpartyId);
    if (!selectedCounterpartyId) {
      return null;
    }
    return (
      createCounterpartyOptions.find(
        (row) => toPositiveInt(row?.id) === selectedCounterpartyId
      ) || null
    );
  }, [createCounterpartyOptions, createForm.counterpartyId]);
  const selectedCreateCounterpartyPrimaryOperatingUnitId = normalizePositiveIntText(
    selectedCreateCounterparty?.primaryOperatingUnitId
  );
  const selectedCreateCounterpartyPrimaryOperatingUnitLabel = formatOperatingUnitDisplay(
    selectedCreateCounterpartyPrimaryOperatingUnitId,
    selectedCreateCounterparty?.primaryOperatingUnitCode,
    selectedCreateCounterparty?.primaryOperatingUnitName
  );
  const createOperatingUnitDerivedFromCounterpartyPrimary = Boolean(
    selectedCreateCounterpartyPrimaryOperatingUnitId &&
      !createOperatingUnitOverrideOpen &&
      (!normalizeText(createForm.operatingUnitId) ||
        normalizeText(createForm.operatingUnitId) ===
          selectedCreateCounterpartyPrimaryOperatingUnitId)
  );
  const editCounterpartyLookupOptions = useMemo(
    () => (editCounterpartyOptions || []).map(mapCounterpartyLookupOption).filter((row) => row.value),
    [editCounterpartyOptions]
  );
  const editOperatingUnitLookupOptions = useMemo(() => {
    const selectedOperatingUnitId = normalizeText(editForm.operatingUnitId);
    const rows = (editOperatingUnitOptions || [])
      .map(mapOperatingUnitLookupOption)
      .filter((row) => row.value);
    if (
      selectedOperatingUnitId &&
      !rows.some((row) => String(row.value) === selectedOperatingUnitId)
    ) {
      rows.unshift({
        value: selectedOperatingUnitId,
        label: `Operating unit #${selectedOperatingUnitId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [editForm.operatingUnitId, editOperatingUnitOptions]);
  const createCashRegisterLookupOptions = useMemo(
    () =>
      extendCashRegisterOptionsForSelectedValue(
        mapCashRegisterLookupOptions(createCashRegisterRows, l),
        createForm.settlementCashRegisterId,
        l
      ),
    [createCashRegisterRows, createForm.settlementCashRegisterId, l]
  );
  const editCashRegisterLookupOptions = useMemo(
    () =>
      extendCashRegisterOptionsForSelectedValue(
        mapCashRegisterLookupOptions(editCashRegisterRows, l),
        editForm.settlementCashRegisterId,
        l
      ),
    [editCashRegisterRows, editForm.settlementCashRegisterId, l]
  );
  const createImmediateCashSelected = isImmediateCashSettlementMode(
    createForm.settlementMode
  );
  const editImmediateCashSelected = isImmediateCashSettlementMode(
    editForm.settlementMode
  );
  const createImmediateCashLabel = getImmediateCashSettlementLabel(
    createForm.direction,
    l
  );
  const editImmediateCashLabel = getImmediateCashSettlementLabel(editForm.direction, l);
  const editImmediateCashDueDate =
    requiresDueDate(editForm.documentType) &&
    isImmediateCashSettlementMode(editForm.settlementMode)
      ? normalizeText(editForm.documentDate)
      : "";
  const documentPageTitle = getDocumentPageTitle(fixedRouteDirection, l);
  const createDraftDocumentTitle = getCreateDraftDocumentTitle(fixedRouteDirection, l);
  const createInlineCounterpartyName = normalizeLookupQuery(createCounterpartyLookupQuery);
  const editInlineCounterpartyName = normalizeLookupQuery(editCounterpartyLookupQuery);
  const canInlineCreateCounterpartyInCreateForm = Boolean(
    canCreate &&
      canReadCards &&
      canUpsertCards &&
      toPositiveInt(createForm.legalEntityId) &&
      createInlineCounterpartyName
  );
  const filterLegalEntityLookupLoading = Boolean(
    workingContextBaseLoading && filterLegalEntityLookupOptions.length === 0
  );
  const createLegalEntityLookupLoading = Boolean(
    workingContextBaseLoading && legalEntityLookupOptions.length === 0
  );
  const canInlineCreateCounterpartyInEditForm = Boolean(
    canEditOrCancelSelected &&
      canReadCards &&
      canUpsertCards &&
      toPositiveInt(editForm.legalEntityId) &&
      editInlineCounterpartyName
  );

  function buildSmartResetDraftForm(previousForm) {
    const baseline = createInitialDraftForm();
    return {
      ...baseline,
      legalEntityId: normalizeText(previousForm?.legalEntityId) || baseline.legalEntityId,
      operatingUnitId: normalizeText(previousForm?.operatingUnitId) || baseline.operatingUnitId,
      direction: normalizeText(previousForm?.direction) || baseline.direction,
      documentType: normalizeText(previousForm?.documentType) || baseline.documentType,
      documentDate: normalizeText(previousForm?.documentDate) || baseline.documentDate,
      currencyCode: normalizeCurrencyCode(previousForm?.currencyCode) || baseline.currencyCode,
    };
  }

  function resetCreateDraftFormWithSmartDefaults() {
    setCreateForm((previousForm) => buildSmartResetDraftForm(previousForm));
    setCreateOperatingUnitOverrideOpen(false);
    setCreatePaymentTermTouched(false);
    setCreateDueDateTouched(false);
    setCreateCurrencyTouched(false);
    setCreateValidationVisible(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
  }

  function applyCreateDraftFormSnapshot(nextForm) {
    const normalized = buildTemplateSafeDraftForm(nextForm);
    setCreateForm(normalized);
    setCreateOperatingUnitOverrideOpen(false);
    setCreatePaymentTermTouched(Boolean(normalizeText(normalized.paymentTermId)));
    setCreateDueDateTouched(Boolean(normalizeText(normalized.dueDate)));
    setCreateCurrencyTouched(Boolean(normalizeCurrencyCode(normalized.currencyCode)));
    setCreateValidationVisible(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
  }

  function addCreateDocumentLine() {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    addDraftFormLine(setCreateForm);
  }

  function removeCreateDocumentLine(rowId) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    removeDraftFormLine(setCreateForm, rowId);
  }

  function moveCreateDocumentLine(rowId, directionStep) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    moveDraftFormLine(setCreateForm, rowId, directionStep);
  }

  function patchCreateDocumentLine(rowId, patch) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(setCreateForm, rowId, patch);
  }

  function patchCreateDocumentLineWithTaxReset(rowId, patch) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(setCreateForm, rowId, patch, { resetTaxPreview: true });
  }

  function changeCreateDocumentLineSubledgerType(rowId, nextSubledgerType) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    if (!currentLine) {
      return;
    }
    patchDraftFormLine(
      setCreateForm,
      rowId,
      buildSubledgerTypeTransitionPatch(
        currentLine,
        nextSubledgerType,
        createForm.direction
      ),
      { resetTaxPreview: true }
    );
  }

  function selectCreateDocumentLineItemCard(rowId, itemCardId) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    const selectedItemCard = createItemCardRowsById.get(Number(itemCardId || 0)) || null;
    if (!selectedItemCard) {
      patchDraftFormLine(setCreateForm, rowId, {
        itemCardId: "",
        warehouseId: "",
        warehouseCode: "",
        warehouseName: "",
      });
      return;
    }
    const lineDefaults = resolveLineDefaultsFromItemCard(
      selectedItemCard,
      createForm.direction
    );
    if (createDocumentLineDraft(currentLine).subledgerType === "FIXED_ASSET") {
      return;
    }
    const nextSubledgerType =
      createDocumentLineDraft(currentLine).subledgerType === "FIXED_ASSET"
        ? "FIXED_ASSET"
        : lineDefaults.stockImpactMode === "NONE"
          ? "NONE"
          : "STOCK";
    patchDraftFormLine(
      setCreateForm,
      rowId,
      lineDefaults.stockImpactMode === "NONE"
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
          },
      { resetTaxPreview: true }
    );
  }

  function selectCreateDocumentLineWarehouse(rowId, warehouseId) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const selectedWarehouse =
      createWarehouseRowsById.get(Number(warehouseId || 0)) || null;
    if (!selectedWarehouse) {
      patchDraftFormLine(setCreateForm, rowId, {
        warehouseId: "",
        warehouseCode: "",
        warehouseName: "",
      });
      return;
    }
    patchDraftFormLine(setCreateForm, rowId, {
      warehouseId: String(toPositiveInt(selectedWarehouse.id) || ""),
      warehouseCode: normalizeText(selectedWarehouse.code),
      warehouseName: normalizeText(selectedWarehouse.name),
    });
  }

  function changeCreateDocumentLineFixedAssetMode(rowId, nextMode) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    if (!currentLine) {
      return;
    }
    patchDraftFormLine(
      setCreateForm,
      rowId,
      buildFixedAssetModeTransitionPatch(currentLine, nextMode),
      { resetTaxPreview: true }
    );
  }

  function selectCreateDocumentLineFixedAssetCategory(rowId, categoryId) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const categorySetupIssue = getFixedAssetCategoryMissingAccountIssue(
      categoryId,
      createFixedAssetCategoriesById
    );
    if (categorySetupIssue) {
      setCreateLinePreviewError(
        l(
          `Selected category "${categorySetupIssue.categoryLabel}" is missing its default asset account. Configure it in Fixed Asset Settings first.`,
          `Secili "${categorySetupIssue.categoryLabel}" kategorisinin varsayilan varlik hesabi eksik. Once Demirbas Ayarlarinda yapilandirin.`
        )
      );
      setFixedAssetCategorySetupPrompt(categorySetupIssue);
      return;
    }
    patchDraftFormLine(setCreateForm, rowId, {
      fixedAssetCategoryId: categoryId ? String(categoryId) : "",
    });
  }

  function selectCreateDocumentLineTargetFixedAsset(rowId, assetId) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(
      setCreateForm,
      rowId,
      {
        targetFixedAssetId: assetId ? String(assetId) : "",
        quantity: "1",
      },
      { resetTaxPreview: true }
    );
  }

  function changeCreateDocumentLineStockImpactMode(rowId, nextMode) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(
      setCreateForm,
      rowId,
      {
        stockImpactMode: nextMode,
        ...(String(nextMode || "").trim().toUpperCase() === "NONE"
          ? {
              warehouseId: "",
              warehouseCode: "",
              warehouseName: "",
            }
          : {}),
      },
      { resetTaxPreview: true }
    );
  }

  function expandCreateDocumentLineFixedAsset(rowId) {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    replaceDraftFormLines(setCreateForm, (currentLines) => {
      const currentIndex = currentLines.findIndex((row) => row?.rowId === rowId);
      if (currentIndex < 0) {
        return currentLines;
      }
      const currentLine = createDocumentLineDraft(currentLines[currentIndex]);
      const expandedRows = expandAutoCreateFixedAssetLine(currentLine);
      if (expandedRows.length <= 1) {
        return currentLines;
      }
      return [
        ...currentLines.slice(0, currentIndex),
        ...expandedRows,
        ...currentLines.slice(currentIndex + 1),
      ];
    });
  }

  function openCreateQuickCreateFixedAsset(rowId) {
    const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    setQuickCreateFixedAssetError("");
    setQuickCreateFixedAssetForm({
      ...createInitialQuickCreateFixedAssetForm(),
      scope: "create",
      lineRowId: rowId,
      name: normalizeText(currentLine?.description),
      categoryId: normalizeText(currentLine?.fixedAssetCategoryId),
      ownerOperatingUnitId: normalizeText(currentLine?.fixedAssetOwnerOperatingUnitId),
      locationOperatingUnitId: normalizeText(currentLine?.fixedAssetLocationOperatingUnitId),
    });
    setQuickCreateFixedAssetOpen(true);
  }

  function addEditDocumentLine() {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    addDraftFormLine(setEditForm);
  }

  function removeEditDocumentLine(rowId) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    removeDraftFormLine(setEditForm, rowId);
  }

  function moveEditDocumentLine(rowId, directionStep) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    moveDraftFormLine(setEditForm, rowId, directionStep);
  }

  function patchEditDocumentLine(rowId, patch) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(setEditForm, rowId, patch);
  }

  function patchEditDocumentLineWithTaxReset(rowId, patch) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(setEditForm, rowId, patch, { resetTaxPreview: true });
  }

  function changeEditDocumentLineSubledgerType(rowId, nextSubledgerType) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    if (!currentLine) {
      return;
    }
    patchDraftFormLine(
      setEditForm,
      rowId,
      buildSubledgerTypeTransitionPatch(currentLine, nextSubledgerType, editForm.direction),
      { resetTaxPreview: true }
    );
  }

  function selectEditDocumentLineItemCard(rowId, itemCardId) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    const selectedItemCard = editItemCardRowsById.get(Number(itemCardId || 0)) || null;
    if (!selectedItemCard) {
      patchDraftFormLine(setEditForm, rowId, {
        itemCardId: "",
        warehouseId: "",
        warehouseCode: "",
        warehouseName: "",
      });
      return;
    }
    const lineDefaults = resolveLineDefaultsFromItemCard(
      selectedItemCard,
      editForm.direction
    );
    if (createDocumentLineDraft(currentLine).subledgerType === "FIXED_ASSET") {
      return;
    }
    const nextSubledgerType =
      createDocumentLineDraft(currentLine).subledgerType === "FIXED_ASSET"
        ? "FIXED_ASSET"
        : lineDefaults.stockImpactMode === "NONE"
          ? "NONE"
          : "STOCK";
    patchDraftFormLine(
      setEditForm,
      rowId,
      lineDefaults.stockImpactMode === "NONE"
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
          },
      { resetTaxPreview: true }
    );
  }

  function selectEditDocumentLineWarehouse(rowId, warehouseId) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    const selectedWarehouse =
      editWarehouseRowsById.get(Number(warehouseId || 0)) || null;
    if (!selectedWarehouse) {
      patchDraftFormLine(setEditForm, rowId, {
        warehouseId: "",
        warehouseCode: "",
        warehouseName: "",
      });
      return;
    }
    patchDraftFormLine(setEditForm, rowId, {
      warehouseId: String(toPositiveInt(selectedWarehouse.id) || ""),
      warehouseCode: normalizeText(selectedWarehouse.code),
      warehouseName: normalizeText(selectedWarehouse.name),
    });
  }

  function changeEditDocumentLineFixedAssetMode(rowId, nextMode) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    if (!currentLine) {
      return;
    }
    patchDraftFormLine(
      setEditForm,
      rowId,
      buildFixedAssetModeTransitionPatch(currentLine, nextMode),
      { resetTaxPreview: true }
    );
  }

  function selectEditDocumentLineFixedAssetCategory(rowId, categoryId) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    const categorySetupIssue = getFixedAssetCategoryMissingAccountIssue(
      categoryId,
      editFixedAssetCategoriesById
    );
    if (categorySetupIssue) {
      setEditLinePreviewError(
        l(
          `Selected category "${categorySetupIssue.categoryLabel}" is missing its default asset account. Configure it in Fixed Asset Settings first.`,
          `Secili "${categorySetupIssue.categoryLabel}" kategorisinin varsayilan varlik hesabi eksik. Once Demirbas Ayarlarinda yapilandirin.`
        )
      );
      setFixedAssetCategorySetupPrompt(categorySetupIssue);
      return;
    }
    patchDraftFormLine(setEditForm, rowId, {
      fixedAssetCategoryId: categoryId ? String(categoryId) : "",
    });
  }

  function selectEditDocumentLineTargetFixedAsset(rowId, assetId) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(
      setEditForm,
      rowId,
      {
        targetFixedAssetId: assetId ? String(assetId) : "",
        quantity: "1",
      },
      { resetTaxPreview: true }
    );
  }

  function changeEditDocumentLineStockImpactMode(rowId, nextMode) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(
      setEditForm,
      rowId,
      {
        stockImpactMode: nextMode,
        ...(String(nextMode || "").trim().toUpperCase() === "NONE"
          ? {
              warehouseId: "",
              warehouseCode: "",
              warehouseName: "",
            }
          : {}),
      },
      { resetTaxPreview: true }
    );
  }

  function expandEditDocumentLineFixedAsset(rowId) {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    replaceDraftFormLines(setEditForm, (currentLines) => {
      const currentIndex = currentLines.findIndex((row) => row?.rowId === rowId);
      if (currentIndex < 0) {
        return currentLines;
      }
      const currentLine = createDocumentLineDraft(currentLines[currentIndex]);
      const expandedRows = expandAutoCreateFixedAssetLine(currentLine);
      if (expandedRows.length <= 1) {
        return currentLines;
      }
      return [
        ...currentLines.slice(0, currentIndex),
        ...expandedRows,
        ...currentLines.slice(currentIndex + 1),
      ];
    });
  }

  function openEditQuickCreateFixedAsset(rowId) {
    const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    setQuickCreateFixedAssetError("");
    setQuickCreateFixedAssetForm({
      ...createInitialQuickCreateFixedAssetForm(),
      scope: "edit",
      lineRowId: rowId,
      name: normalizeText(currentLine?.description),
      categoryId: normalizeText(currentLine?.fixedAssetCategoryId),
      ownerOperatingUnitId: normalizeText(currentLine?.fixedAssetOwnerOperatingUnitId),
      locationOperatingUnitId: normalizeText(currentLine?.fixedAssetLocationOperatingUnitId),
    });
    setQuickCreateFixedAssetOpen(true);
  }

  function closeQuickCreateFixedAssetModal() {
    if (quickCreateFixedAssetSaving) {
      return;
    }
    setQuickCreateFixedAssetOpen(false);
    setQuickCreateFixedAssetError("");
    setQuickCreateFixedAssetForm(createInitialQuickCreateFixedAssetForm());
  }

  function patchQuickCreateFixedAssetForm(patch) {
    setQuickCreateFixedAssetError("");
    setQuickCreateFixedAssetForm((previous) => ({
      ...previous,
      ...patch,
    }));
  }

  async function handleQuickCreateFixedAssetSave() {
    const scope = normalizeText(quickCreateFixedAssetForm.scope).toLowerCase();
    const sourceForm = scope === "edit" ? editForm : createForm;
    const sourceCategoryRows = scope === "edit"
      ? editFixedAssetCategoryRows
      : createFixedAssetCategoryRows;
    const selectedCategory =
      sourceCategoryRows.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(quickCreateFixedAssetForm.categoryId)
      ) || null;
    const legalEntityId = toPositiveInt(sourceForm.legalEntityId);
    const categoryId = toPositiveInt(quickCreateFixedAssetForm.categoryId);
    const ownerOperatingUnitId = toPositiveInt(
      quickCreateFixedAssetForm.ownerOperatingUnitId
    );
    const locationOperatingUnitId = toPositiveInt(
      quickCreateFixedAssetForm.locationOperatingUnitId
    );
    const payload = {
      legalEntityId,
      name: normalizeText(quickCreateFixedAssetForm.name),
      categoryId,
      acquisitionDate: normalizeText(sourceForm.documentDate) || undefined,
      currencyCode: normalizeCurrencyCode(sourceForm.currencyCode) || undefined,
      originalCostTxn: 0,
      originalCostBase: 0,
      ownerOperatingUnitId: ownerOperatingUnitId || undefined,
      locationOperatingUnitId: locationOperatingUnitId || undefined,
      depreciationProfileId: toPositiveInt(
        selectedCategory?.defaultDepreciationProfileId ??
          selectedCategory?.default_depreciation_profile_id
      ) || undefined,
      usefulLifeMonths: toPositiveInt(
        selectedCategory?.defaultUsefulLifeMonths ??
          selectedCategory?.default_useful_life_months
      ) || undefined,
    };
    const salvageRuleType = normalizeText(
      selectedCategory?.defaultSalvageRuleType ??
        selectedCategory?.default_salvage_rule_type
    ).toUpperCase();
    if (payload.name.length === 0) {
      setQuickCreateFixedAssetError(
        l("Asset name is required.", "Varlik adi zorunludur.")
      );
      return;
    }
    if (!legalEntityId || !normalizeText(sourceForm.documentDate) || !payload.currencyCode) {
      setQuickCreateFixedAssetError(
        l(
          "Set legal entity, document date, and currency on the document first.",
          "Once belgede tuzel kisilik, belge tarihi ve para birimini doldurun."
        )
      );
      return;
    }
    if (!categoryId) {
      setQuickCreateFixedAssetError(
        l("Category is required.", "Kategori zorunludur.")
      );
      return;
    }
    if (salvageRuleType && salvageRuleType !== "NONE") {
      payload.salvageRuleType = salvageRuleType;
      if (salvageRuleType === "PERCENT_OF_COST") {
        const salvagePercent = Number(
          selectedCategory?.defaultSalvagePercent ??
            selectedCategory?.default_salvage_percent ??
            0
        );
        if (Number.isFinite(salvagePercent)) {
          payload.salvagePercent = salvagePercent;
        }
      }
      if (salvageRuleType === "FIXED_BASE_AMOUNT") {
        const salvageAmountBase = Number(
          selectedCategory?.defaultSalvageAmountBase ??
            selectedCategory?.default_salvage_amount_base ??
            0
        );
        if (Number.isFinite(salvageAmountBase)) {
          payload.salvageAmountBaseRule = salvageAmountBase;
        }
      }
    }

    setQuickCreateFixedAssetSaving(true);
    setQuickCreateFixedAssetError("");
    try {
      const result = await createFixedAsset(payload);
      const createdAssetId = toPositiveInt(result?.id ?? result?.row?.id);
      if (!createdAssetId) {
        throw new Error(
          l("Asset creation did not return an id.", "Varlik olusturma bir kimlik donmedi.")
        );
      }
      const createdAssetRow = {
        ...(result?.row || result || {}),
        id: createdAssetId,
        status: "DRAFT",
        categoryId,
        categoryCode:
          selectedCategory?.code || selectedCategory?.categoryCode || selectedCategory?.category_code || null,
        categoryName:
          selectedCategory?.name || selectedCategory?.categoryName || selectedCategory?.category_name || null,
        ownerOperatingUnitId: ownerOperatingUnitId || null,
        locationOperatingUnitId: locationOperatingUnitId || null,
        legalEntityId,
        currencyCode: payload.currencyCode,
        assetNo: result?.assetNo || result?.row?.assetNo || result?.row?.asset_no || null,
        name: payload.name,
      };
      const patchLine = {
        subledgerType: "FIXED_ASSET",
        fixedAssetMode: "LINK_EXISTING",
        targetFixedAssetId: String(createdAssetId),
        quantity: "1",
      };
      if (scope === "edit") {
        setEditFixedAssetDraftRows((previous) => {
          const nextRows = Array.isArray(previous) ? [...previous] : [];
          const existingIndex = nextRows.findIndex(
            (row) => toPositiveInt(row?.id) === createdAssetId
          );
          if (existingIndex >= 0) {
            nextRows[existingIndex] = createdAssetRow;
            return nextRows;
          }
          return [createdAssetRow, ...nextRows];
        });
        patchDraftFormLine(setEditForm, quickCreateFixedAssetForm.lineRowId, patchLine, {
          resetTaxPreview: true,
        });
      } else {
        setCreateFixedAssetDraftRows((previous) => {
          const nextRows = Array.isArray(previous) ? [...previous] : [];
          const existingIndex = nextRows.findIndex(
            (row) => toPositiveInt(row?.id) === createdAssetId
          );
          if (existingIndex >= 0) {
            nextRows[existingIndex] = createdAssetRow;
            return nextRows;
          }
          return [createdAssetRow, ...nextRows];
        });
        patchDraftFormLine(setCreateForm, quickCreateFixedAssetForm.lineRowId, patchLine, {
          resetTaxPreview: true,
        });
      }
      setQuickCreateFixedAssetOpen(false);
      setQuickCreateFixedAssetForm(createInitialQuickCreateFixedAssetForm());
    } catch (error) {
      setQuickCreateFixedAssetError(
        normalizeApiError(
          error,
          l("Failed to create draft asset.", "Taslak varlik olusturulamadi.")
        )
      );
    } finally {
      setQuickCreateFixedAssetSaving(false);
    }
  }

  async function handleCreateDocumentLineTaxPreview(rowId = null) {
    await runDocumentLineTaxPreview({
      form: createForm,
      setForm: setCreateForm,
      setLoading: setCreateLinePreviewLoading,
      setError: setCreateLinePreviewError,
      setMessage: setCreateLinePreviewMessage,
      targetRowId: rowId,
    });
  }

  async function handleEditDocumentLineTaxPreview(rowId = null) {
    await runDocumentLineTaxPreview({
      form: editForm,
      setForm: setEditForm,
      setLoading: setEditLinePreviewLoading,
      setError: setEditLinePreviewError,
      setMessage: setEditLinePreviewMessage,
      targetRowId: rowId,
    });
  }

  function handleFilterDirectionChange(nextDirection) {
    const normalizedDirection = normalizeText(nextDirection).toUpperCase();
    setFilters((previous) => ({
      ...previous,
      direction: DOCUMENT_DIRECTIONS.includes(normalizedDirection)
        ? normalizedDirection
        : "",
      counterpartyId: "",
    }));
  }

  function handleFilterLegalEntityChange(nextValue) {
    const normalizedLegalEntityId = nextValue ? String(nextValue) : "";
    setFilterContextDefaultsSuspended(true);
    setFilters((previous) => {
      if (normalizeText(previous.legalEntityId) === normalizedLegalEntityId) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: normalizedLegalEntityId,
        operatingUnitId: "",
        counterpartyId: "",
      };
    });
  }

  function handleCreateDirectionChange(nextDirection) {
    const normalizedDirection = normalizeText(nextDirection).toUpperCase();
    setCreateForm((previous) => {
      const safeDirection = DOCUMENT_DIRECTIONS.includes(normalizedDirection)
        ? normalizedDirection
        : previous.direction;
      if (safeDirection === previous.direction && !normalizeText(previous.counterpartyId)) {
        return previous;
      }
      const normalizedLines = normalizeDocumentFormLines(previous?.lines).map((row) => {
        const currentLine = createDocumentLineDraft(row);
        if (currentLine.subledgerType !== "FIXED_ASSET") {
          return currentLine;
        }
        if (safeDirection === "AR") {
          return createDocumentLineDraft({
            ...currentLine,
            fixedAssetMode: "",
            quantity: "1",
            fixedAssetCategoryId: "",
            fixedAssetOwnerOperatingUnitId: "",
            fixedAssetLocationOperatingUnitId: "",
            fixedAssetNameOverride: "",
            fixedAssetSerialNo: "",
            fixedAssetTag: "",
            revisedUsefulLifeMonths: "",
            lifeExtensionMonths: "",
          });
        }
        return createDocumentLineDraft({
          ...currentLine,
          fixedAssetMode: currentLine.targetFixedAssetId ? "LINK_EXISTING" : "AUTO_CREATE",
        });
      });
      return {
        ...previous,
        direction: safeDirection,
        counterpartyId: "",
        lines: normalizedLines,
      };
    });
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
  }

  function handleCreateSettlementModeChange(nextMode) {
    const normalizedMode = normalizeDocumentSettlementMode(nextMode);
    setCreateForm((previous) => ({
      ...previous,
      settlementMode: normalizedMode,
      settlementCashRegisterId:
        normalizedMode === "IMMEDIATE_CASH" ? previous.settlementCashRegisterId : "",
    }));
    if (normalizedMode === "IMMEDIATE_CASH") {
      setCreateDueDateTouched(false);
    }
  }

  function handleCreateLegalEntityChange(nextValue) {
    const normalizedLegalEntityId = nextValue ? String(nextValue) : "";
    setCreateContextDefaultsSuspended(true);
    setCreateForm((previous) => {
      if (normalizeText(previous.legalEntityId) === normalizedLegalEntityId) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: normalizedLegalEntityId,
        operatingUnitId: "",
        counterpartyId: "",
        paymentTermId: "",
        settlementCashRegisterId: "",
      };
    });
    setCreatePaymentTermTouched(false);
    setCreateDueDateTouched(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setCreateOperatingUnitsError("");
    setCreatePaymentTermsError("");
  }

  function handleEditSettlementModeChange(nextMode) {
    const normalizedMode = normalizeDocumentSettlementMode(nextMode);
    setEditForm((previous) => ({
      ...previous,
      settlementMode: normalizedMode,
      settlementCashRegisterId:
        normalizedMode === "IMMEDIATE_CASH" ? previous.settlementCashRegisterId : "",
    }));
    if (normalizedMode === "IMMEDIATE_CASH") {
      setEditDueDateTouched(false);
    }
  }

  function handleEditLegalEntityChange(nextValue) {
    const normalizedLegalEntityId = normalizeText(nextValue);
    setEditForm((previous) => ({
      ...previous,
      legalEntityId: normalizedLegalEntityId,
      operatingUnitId:
        normalizeText(previous.legalEntityId) === normalizedLegalEntityId
          ? previous.operatingUnitId
          : "",
      settlementCashRegisterId:
        normalizeText(previous.legalEntityId) === normalizedLegalEntityId
          ? previous.settlementCashRegisterId
          : "",
    }));
  }

  function replaceDraftFormLines(setForm, transformer) {
    setForm((previous) => {
      const currentLines = normalizeDocumentFormLines(previous?.lines, {
        amountTxn: previous?.amountTxn,
      });
      const nextLines = normalizeDocumentFormLines(transformer(currentLines), {
        amountTxn: previous?.amountTxn,
      });
      return {
        ...previous,
        lines: nextLines,
      };
    });
  }

  function addDraftFormLine(setForm) {
    replaceDraftFormLines(setForm, (currentLines) => [
      ...currentLines,
      createDocumentLineDraft(),
    ]);
  }

  function removeDraftFormLine(setForm, rowId) {
    replaceDraftFormLines(setForm, (currentLines) => {
      if (currentLines.length <= 1) {
        return currentLines;
      }
      const nextLines = currentLines.filter((row) => row?.rowId !== rowId);
      return nextLines.length > 0 ? nextLines : currentLines;
    });
  }

  function moveDraftFormLine(setForm, rowId, directionStep) {
    replaceDraftFormLines(setForm, (currentLines) => {
      const currentIndex = currentLines.findIndex((row) => row?.rowId === rowId);
      if (currentIndex < 0) {
        return currentLines;
      }
      const nextIndex = currentIndex + Number(directionStep || 0);
      if (nextIndex < 0 || nextIndex >= currentLines.length) {
        return currentLines;
      }
      const nextLines = [...currentLines];
      const [movedRow] = nextLines.splice(currentIndex, 1);
      nextLines.splice(nextIndex, 0, movedRow);
      return nextLines;
    });
  }

  function patchDraftFormLine(setForm, rowId, patch, { resetTaxPreview = false } = {}) {
    replaceDraftFormLines(setForm, (currentLines) =>
      currentLines.map((row) => {
        if (row?.rowId !== rowId) {
          return row;
        }
        const nextSeed = {
          ...row,
          ...patch,
        };
        return resetTaxPreview
          ? resetDocumentLineTaxPreview(nextSeed)
          : createDocumentLineDraft(nextSeed);
      })
    );
  }

  const runDocumentLineTaxPreview = useCallback(
    async ({
      form,
      setForm,
      setLoading,
      setError,
      setMessage,
      targetRowId = null,
    }) => {
      const legalEntityId = toPositiveInt(form?.legalEntityId);
      const postingDate = normalizeText(form?.documentDate);
      const direction = normalizeText(form?.direction).toUpperCase();
      const documentType = normalizeText(form?.documentType).toUpperCase();
      const currencyCode = normalizeCurrencyCode(form?.currencyCode);
      const lines = normalizeDocumentFormLines(form?.lines, {
        amountTxn: form?.amountTxn,
      });

      setError("");
      setMessage("");
      if (!legalEntityId || !postingDate || !direction || !documentType || !currencyCode) {
        setError(
          l(
            "Set legal entity, document date, direction, document type, and currency before previewing taxes.",
            "Vergi onizlemesinden once tuzel kisilik, belge tarihi, yon, belge turu ve para birimini girin."
          )
        );
        return;
      }
      if (lines.length === 0) {
        setError(
          l("Add at least one line before previewing taxes.", "Vergi onizlemesinden once en az bir satir ekleyin.")
        );
        return;
      }

      setLoading(true);
      try {
        const previewDirection = direction === "AP" ? "PURCHASE" : "SALE";
        const counterpartyType = direction === "AP" ? "VENDOR" : "CUSTOMER";
        const nextLines = [];
        let refreshedCount = 0;
        let errorCount = 0;

        for (const line of lines) {
          if (targetRowId && line.rowId !== targetRowId) {
            nextLines.push(line);
            continue;
          }
          const lineNetAmountTxn = Number(line.lineNetAmountTxn || 0);
          const hasTaxCategory = Boolean(normalizeText(line.taxCategoryCode));
          if (!hasTaxCategory) {
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: 0,
                taxes: [],
                previewStatus: "",
                previewError: "",
                previewUpdatedAt: "",
              })
            );
            continue;
          }
          if (lineNetAmountTxn <= 0) {
            errorCount += 1;
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: 0,
                taxes: [],
                previewStatus: "ERROR",
                previewError: l(
                  "Line net amount must be > 0 before previewing tax.",
                  "Vergi onizlemesinden once satir net tutari 0'dan buyuk olmali."
                ),
                previewUpdatedAt: "",
              })
            );
            continue;
          }

          try {
            const preview = await previewTaxComputation({
              legalEntityId,
              postingDate,
              moduleCode: "CARI",
              documentType,
              taxCategoryCode: line.taxCategoryCode,
              lineKind: line.lineKind,
              counterpartyType,
              baseAmount: lineNetAmountTxn,
              direction: previewDirection,
              currencyCode,
            });
            const taxAmountTxn = Number(
              preview?.breakdown?.taxAmount ??
                preview?.breakdown?.tax_amount ??
                0
            );
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: taxAmountTxn,
                taxes: [
                  {
                    componentNo: 1,
                    taxCode:
                      preview?.taxCode?.code ||
                      preview?.taxCode?.taxCode ||
                      line.taxCategoryCode,
                    taxKind:
                      preview?.taxCode?.taxKind ||
                      preview?.taxCode?.tax_kind ||
                      null,
                    ratePct:
                      preview?.breakdown?.ratePct ??
                      preview?.breakdown?.rate_pct ??
                      0,
                    taxBaseAmountTxn:
                      preview?.breakdown?.taxableBaseAmount ??
                      preview?.breakdown?.taxable_base_amount ??
                      lineNetAmountTxn,
                    taxAmountTxn,
                    taxPurposeCode:
                      preview?.mapping?.taxPurposeCode ||
                      preview?.mapping?.tax_purpose_code ||
                      null,
                    accountId:
                      Number(
                        preview?.mapping?.accountId ||
                          preview?.mapping?.account_id ||
                          0
                      ) || null,
                  },
                ],
                previewStatus: "READY",
                previewError: "",
                previewUpdatedAt: new Date().toISOString(),
              })
            );
            refreshedCount += 1;
          } catch (error) {
            errorCount += 1;
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: 0,
                taxes: [],
                previewStatus: "ERROR",
                previewError: normalizeApiError(
                  error,
                  l("Failed to preview tax for line.", "Satir icin vergi onizlemesi alinamadi.")
                ),
                previewUpdatedAt: "",
              })
            );
          }
        }

        setForm((previous) => ({
          ...previous,
          lines: nextLines,
        }));
        if (refreshedCount > 0) {
          setMessage(
            l(
              `Tax preview refreshed for ${refreshedCount} line(s).`,
              `${refreshedCount} satir icin vergi onizlemesi yenilendi.`
            )
          );
        }
        if (errorCount > 0) {
          setError(
            l(
              `${errorCount} line(s) could not refresh tax preview.`,
              `${errorCount} satirin vergi onizlemesi yenilenemedi.`
            )
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [l]
  );

  function addPostFormPostingLine() {
    setPostForm((previous) => {
      const rows = Array.isArray(previous.postingLines) ? previous.postingLines : [];
      return {
        ...previous,
        postingLines: [...rows, createPostingLineDraft()],
      };
    });
  }

  function updatePostFormPostingLine(rowId, patch) {
    setPostForm((previous) => {
      const rows = Array.isArray(previous.postingLines) ? previous.postingLines : [];
      let changed = false;
      const nextRows = rows.map((row) => {
        if (row?.rowId !== rowId) {
          return row;
        }
        changed = true;
        return {
          ...row,
          ...patch,
        };
      });
      if (!changed) {
        return previous;
      }
      return {
        ...previous,
        postingLines: nextRows,
      };
    });
  }

  function removePostFormPostingLine(rowId) {
    setPostForm((previous) => {
      const rows = Array.isArray(previous.postingLines) ? previous.postingLines : [];
      if (rows.length <= 1) {
        return previous;
      }
      const nextRows = rows.filter((row) => row?.rowId !== rowId);
      if (nextRows.length === rows.length) {
        return previous;
      }
      return {
        ...previous,
        postingLines: nextRows,
      };
    });
  }

  async function loadDocuments(nextFilters = filters) {
    if (!canRead) {
      setRows([]);
      setTotalRows(0);
      setListError(l("Missing permission: cari.doc.read", "Eksik yetki: cari.doc.read"));
      return;
    }
    const resolvedFilters = hasFixedRouteDirection
      ? {
          ...(nextFilters && typeof nextFilters === "object" ? nextFilters : {}),
          direction: fixedRouteDirection,
        }
      : nextFilters;
    setListLoading(true);
    setListError("");
    try {
      const response = await listCariDocuments(buildDocumentListQuery(resolvedFilters));
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setTotalRows(Number(response?.total || 0));
    } catch (error) {
      setRows([]);
      setTotalRows(0);
      setListError(
        normalizeApiError(error, l("Failed to load documents.", "Belgeler yuklenemedi."))
      );
    } finally {
      setListLoading(false);
    }
  }

  async function loadDocumentDetail(documentId) {
    if (!documentId || !canRead) {
      setSelectedDetail(null);
      return;
    }
    setDetailError("");
    try {
      const response = await getCariDocument(documentId);
      const row = response?.row || null;
      setSelectedDetail(row);
      if (row && isDraft(row)) {
        setEditForm(mapDocumentRowToForm(row));
        setEditDueDateTouched(false);
        setEditValidationVisible(false);
        setEditLinePreviewError("");
        setEditLinePreviewMessage("");
      }
    } catch (error) {
      setSelectedDetail(null);
      setDetailError(
        normalizeApiError(error, l("Failed to load document detail.", "Belge detayi yuklenemedi."))
      );
    }
  }

  useEffect(() => {
    if (!deepLinkedDocumentIdRaw || deepLinkedDocumentId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("documentId");
    nextParams.delete("document_id");
    setSearchParams(nextParams, { replace: true });
  }, [
    deepLinkedDocumentId,
    deepLinkedDocumentIdRaw,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    const previousDeepLinkedDocumentId = toPositiveInt(
      lastObservedUrlDocumentIdRef.current
    );
    const currentDeepLinkedDocumentId = toPositiveInt(deepLinkedDocumentId);
    const deepLinkChanged =
      Number(previousDeepLinkedDocumentId || 0) !==
      Number(currentDeepLinkedDocumentId || 0);
    lastObservedUrlDocumentIdRef.current = currentDeepLinkedDocumentId || null;
    if (!canRead || !currentDeepLinkedDocumentId) {
      pendingUrlSelectionDocumentIdRef.current = null;
      return;
    }
    if (!deepLinkChanged) {
      return;
    }
    if (Number(selectedDocumentId || 0) === Number(currentDeepLinkedDocumentId)) {
      pendingUrlSelectionDocumentIdRef.current = null;
      return;
    }
    pendingUrlSelectionDocumentIdRef.current = currentDeepLinkedDocumentId;
    setSelectedDocumentId(currentDeepLinkedDocumentId);
  }, [canRead, deepLinkedDocumentId, selectedDocumentId]);

  useEffect(() => {
    const selectedId = toPositiveInt(selectedDocumentId);
    const currentId = toPositiveInt(
      searchParams.get("documentId") || searchParams.get("document_id")
    );
    const pendingUrlSelectionId = toPositiveInt(
      pendingUrlSelectionDocumentIdRef.current
    );
    if (deepLinkedDocumentId && !selectedId) {
      return;
    }
    if (selectedId === currentId) {
      if (pendingUrlSelectionId && selectedId === pendingUrlSelectionId) {
        pendingUrlSelectionDocumentIdRef.current = null;
      }
      return;
    }
    if (pendingUrlSelectionId && currentId === pendingUrlSelectionId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    if (selectedId) {
      nextParams.set("documentId", String(selectedId));
    } else {
      nextParams.delete("documentId");
    }
    nextParams.delete("document_id");
    setSearchParams(nextParams, { replace: true });
  }, [
    deepLinkedDocumentId,
    searchParams,
    selectedDocumentId,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!hasFixedRouteDirection) {
      return;
    }
    setFilters((previous) => {
      if (normalizeDirection(previous?.direction) === fixedRouteDirection) {
        return previous;
      }
      return {
        ...previous,
        direction: fixedRouteDirection,
        counterpartyId: "",
      };
    });
  }, [fixedRouteDirection, hasFixedRouteDirection, setFilters]);

  useEffect(() => {
    if (!hasFixedRouteDirection) {
      lastAppliedFixedRouteDirectionRef.current = null;
      return;
    }
    if (lastAppliedFixedRouteDirectionRef.current === fixedRouteDirection) {
      return;
    }
    lastAppliedFixedRouteDirectionRef.current = fixedRouteDirection;
    setCreateForm((previousForm) =>
      buildDirectionScopedDraftForm(previousForm, fixedRouteDirection)
    );
    setCreateOperatingUnitOverrideOpen(false);
    setCreatePaymentTermTouched(false);
    setCreateDueDateTouched(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
  }, [
    fixedRouteDirection,
    hasFixedRouteDirection,
  ]);

  useEffect(() => {
    if (workingContextBaseLoading) {
      return;
    }
    const selectedLegalEntityId = normalizeText(filters.legalEntityId);
    if (!selectedLegalEntityId) {
      return;
    }
    const selectedStillVisible = legalEntityLookupOptions.some(
      (row) => String(row.value) === selectedLegalEntityId
    );
    if (selectedStillVisible) {
      return;
    }
    const fallbackLegalEntityId = normalizeText(legalEntityLookupOptions[0]?.value);
    setFilters((previous) => {
      const previousLegalEntityId = normalizeText(previous.legalEntityId);
      if (!previousLegalEntityId) {
        return previous;
      }
      const previousStillVisible = legalEntityLookupOptions.some(
        (row) => String(row.value) === previousLegalEntityId
      );
      if (previousStillVisible) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: fallbackLegalEntityId,
        counterpartyId: "",
      };
    });
  }, [
    filters.legalEntityId,
    legalEntityLookupOptions,
    setFilters,
    workingContextBaseLoading,
  ]);

  useEffect(() => {
    loadDocuments(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, filters]);

  useEffect(() => {
    if (!canRead) {
      setSavedViews([]);
      setSelectedSavedViewId("");
      setDefaultSavedViewHydrated(false);
      return;
    }
    loadDocumentSavedViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  useEffect(() => {
    if (!canRead || defaultSavedViewHydrated || savedViewsLoading) {
      return;
    }
    const defaultView = savedViews.find((row) => Boolean(row?.isDefault));
    if (defaultView) {
      applyDocumentSavedView(defaultView, { silent: true });
    }
    setDefaultSavedViewHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canRead,
    defaultSavedViewHydrated,
    savedViews,
    savedViewsLoading,
  ]);

  useEffect(() => {
    if (!canCreate) {
      setDraftTemplates([]);
      setSelectedDraftTemplateId("");
      setDefaultDraftTemplateHydrated(false);
      return;
    }
    loadDocumentDraftTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate]);

  useEffect(() => {
    if (!canCreate || defaultDraftTemplateHydrated || draftTemplatesLoading) {
      return;
    }
    const defaultTemplate = draftTemplates.find((row) => Boolean(row?.isDefault));
    if (defaultTemplate) {
      applyDocumentDraftTemplate(defaultTemplate, { silent: true });
    }
    setDefaultDraftTemplateHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canCreate,
    defaultDraftTemplateHydrated,
    draftTemplates,
    draftTemplatesLoading,
  ]);

  useEffect(() => {
    if (
      !canCreate ||
      !defaultDraftTemplateHydrated ||
      !fixedAssetSaleCreatePrefill ||
      !fixedAssetSaleCreatePrefillSignature
    ) {
      return;
    }
    if (
      appliedCreatePrefillSignatureRef.current ===
      fixedAssetSaleCreatePrefillSignature
    ) {
      return;
    }

    const assetLabel =
      fixedAssetSaleCreatePrefill.assetNo ||
      fixedAssetSaleCreatePrefill.assetName ||
      `#${fixedAssetSaleCreatePrefill.targetFixedAssetId}`;

    applyCreateDraftFormSnapshot({
      legalEntityId: fixedAssetSaleCreatePrefill.legalEntityId,
      operatingUnitId: fixedAssetSaleCreatePrefill.operatingUnitId,
      direction: fixedAssetSaleCreatePrefill.direction || "AR",
      documentType: "INVOICE",
      documentDate: todayIsoDate(),
      lines: [
        {
          subledgerType: "FIXED_ASSET",
          targetFixedAssetId: fixedAssetSaleCreatePrefill.targetFixedAssetId,
          quantity: "1",
          description: l(
            `Sale of fixed asset ${assetLabel}`,
            `${assetLabel} duran varlik satisi`
          ),
        },
      ],
    });
    setCreateError("");
    setCreateMessage(
      l(
        `Sale draft was prefilled from fixed asset detail for ${assetLabel}. Complete counterparty, sale proceeds account, and amount before saving.`,
        `${assetLabel} icin satis taslagi duran varlik detayindan hazirlandi. Kaydetmeden once cari, satis hasilat hesabi ve tutari tamamlayin.`
      )
    );
    appliedCreatePrefillSignatureRef.current =
      fixedAssetSaleCreatePrefillSignature;
    setSearchParams(clearFixedAssetSaleCreatePrefill(searchParams), {
      replace: true,
    });
  }, [
    canCreate,
    defaultDraftTemplateHydrated,
    fixedAssetSaleCreatePrefill,
    fixedAssetSaleCreatePrefillSignature,
    l,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setSelectedDetail(null);
      return;
    }
    loadDocumentDetail(selectedDocumentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocumentId, canRead]);

  useEffect(() => {
    if (!canReadOrgTree) {
      setFilterOperatingUnitOptions([]);
      setFilterOperatingUnitLoading(false);
      setFilterOperatingUnitError("");
      return;
    }
    const legalEntityId = toPositiveInt(filters.legalEntityId);
    if (!legalEntityId) {
      setFilterOperatingUnitOptions([]);
      setFilterOperatingUnitLoading(false);
      setFilterOperatingUnitError("");
      return;
    }
    let active = true;
    async function loadFilterOperatingUnits() {
      setFilterOperatingUnitLoading(true);
      setFilterOperatingUnitError("");
      try {
        const response = await listOperatingUnits({
          legalEntityId,
          limit: 500,
          includeInactive: true,
        });
        if (!active) return;
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setFilterOperatingUnitOptions(rows);
        setFilters((previous) => {
          const selectedOperatingUnitId = normalizeText(previous.operatingUnitId);
          if (!selectedOperatingUnitId) {
            return previous;
          }
          const selectedStillVisible = rows.some(
            (row) => String(toPositiveInt(row?.id) || "") === selectedOperatingUnitId
          );
          return selectedStillVisible
            ? previous
            : { ...previous, operatingUnitId: "" };
        });
      } catch (error) {
        if (!active) return;
        setFilterOperatingUnitOptions([]);
        setFilterOperatingUnitError(
          normalizeApiError(
            error,
            l(
              "Failed to load operating units for selected legal entity.",
              "Secili tuzel kisilik icin operasyon birimleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) setFilterOperatingUnitLoading(false);
      }
    }
    loadFilterOperatingUnits();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, filters.legalEntityId, l, setFilters]);

  useEffect(() => {
    if (!canReadCards) {
      setFilterCounterpartyOptions([]);
      setFilterCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(filters.legalEntityId);
    if (!legalEntityId) {
      setFilterCounterpartyOptions([]);
      setFilterCounterpartyLoading(false);
      return;
    }
    const role = resolveCounterpartyRoleFromDirection(filters.direction);
    let active = true;
    async function loadFilterCounterparties() {
      setFilterCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role,
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) return;
        setFilterCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) return;
        setFilterCounterpartyOptions([]);
      } finally {
        if (active) setFilterCounterpartyLoading(false);
      }
    }
    loadFilterCounterparties();
    return () => {
      active = false;
    };
  }, [canReadCards, filters.direction, filters.legalEntityId]);

  useEffect(() => {
    if (!canReadCards) {
      setCreateCounterpartyOptions([]);
      setCreateCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    if (!legalEntityId) {
      setCreateCounterpartyOptions([]);
      setCreateCounterpartyLoading(false);
      return;
    }
    const role = resolveCounterpartyRoleFromDirection(createForm.direction);
    let active = true;
    async function loadCreateCounterparties() {
      setCreateCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) return;
        setCreateCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) return;
        setCreateCounterpartyOptions([]);
      } finally {
        if (active) setCreateCounterpartyLoading(false);
      }
    }
    loadCreateCounterparties();
    return () => {
      active = false;
    };
  }, [canReadCards, createForm.direction, createForm.legalEntityId]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    setCreateCashRegistersError("");
    if (!canReadCashRegisters || !legalEntityId) {
      setCreateCashRegisterRows([]);
      setCreateCashRegistersLoading(false);
      return;
    }

    let active = true;
    async function loadCreateCashRegisters() {
      setCreateCashRegistersLoading(true);
      try {
        const response = await listCashRegisters({
          legalEntityId,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateCashRegisterRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateCashRegisterRows([]);
        setCreateCashRegistersError(
          normalizeApiError(error, l("Failed to load cash registers.", "Kasalar yuklenemedi."))
        );
      } finally {
        if (active) {
          setCreateCashRegistersLoading(false);
        }
      }
    }

    loadCreateCashRegisters();
    return () => {
      active = false;
    };
  }, [canReadCashRegisters, createForm.legalEntityId, l]);

  useEffect(() => {
    setTaxCategoryError("");
    if (!canReadOrgTree) {
      setTaxRuleRows([]);
      setTaxCategoryLoading(false);
      return;
    }

    let active = true;
    async function loadTaxRulesForCategories() {
      setTaxCategoryLoading(true);
      try {
        const response = await listTaxRules({
          moduleCode: "CARI",
          status: "ACTIVE",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setTaxRuleRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setTaxRuleRows([]);
        setTaxCategoryError(
          normalizeApiError(
            error,
            l("Failed to load tax category options.", "Vergi kategori secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setTaxCategoryLoading(false);
        }
      }
    }

    loadTaxRulesForCategories();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, l]);

  useEffect(() => {
    if (!canReadOrgTree) {
      setCreateOperatingUnitOptions([]);
      setCreateOperatingUnitsLoading(false);
      setCreateOperatingUnitsError("");
      return;
    }

    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    if (!legalEntityId) {
      setCreateOperatingUnitOptions([]);
      setCreateOperatingUnitsLoading(false);
      setCreateOperatingUnitsError("");
      return;
    }

    let active = true;
    async function loadCreateOperatingUnits() {
      setCreateOperatingUnitsLoading(true);
      setCreateOperatingUnitsError("");
      try {
        const response = await listOperatingUnits({
          legalEntityId,
          limit: 500,
          includeInactive: true,
        });
        if (!active) return;
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setCreateOperatingUnitOptions(rows);
        setCreateForm((previousForm) => {
          const selectedOperatingUnitId = normalizeText(previousForm.operatingUnitId);
          if (!selectedOperatingUnitId) {
            return previousForm;
          }
          const selectedStillVisible = rows.some(
            (row) => String(toPositiveInt(row?.id) || "") === selectedOperatingUnitId
          );
          return selectedStillVisible
            ? previousForm
            : { ...previousForm, operatingUnitId: "" };
        });
      } catch (error) {
        if (!active) return;
        setCreateOperatingUnitOptions([]);
        setCreateOperatingUnitsError(
          normalizeApiError(
            error,
            l(
              "Failed to load operating units for selected legal entity.",
              "Secili tuzel kisilik icin operasyon birimleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) setCreateOperatingUnitsLoading(false);
      }
    }

    loadCreateOperatingUnits();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, createForm.legalEntityId, l]);

  useEffect(() => {
    if (!canReadCards) {
      setCreatePaymentTermOptions([]);
      setCreatePaymentTermsLoading(false);
      setCreatePaymentTermsError("");
      return;
    }

    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    if (!legalEntityId) {
      setCreatePaymentTermOptions([]);
      setCreatePaymentTermsLoading(false);
      setCreatePaymentTermsError("");
      return;
    }

    let active = true;
    async function loadCreatePaymentTerms() {
      setCreatePaymentTermsLoading(true);
      setCreatePaymentTermsError("");
      try {
        const response = await listCariPaymentTerms({
          legalEntityId,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) return;
        setCreatePaymentTermOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) return;
        setCreatePaymentTermOptions([]);
        setCreatePaymentTermsError(
          normalizeApiError(
            error,
            l(
              "Failed to load payment terms for selected legal entity.",
              "Secili tuzel kisilik icin vade kosullari yuklenemedi."
            )
          )
        );
      } finally {
        if (active) setCreatePaymentTermsLoading(false);
      }
    }

    loadCreatePaymentTerms();
    return () => {
      active = false;
    };
  }, [canReadCards, createForm.legalEntityId, l]);

  useEffect(() => {
    if (!selectedCreateCounterparty) {
      return;
    }
    const suggestedPaymentTermId = toPositiveInt(
      selectedCreateCounterparty.defaultPaymentTermId
    );
    const suggestedCurrencyCode = normalizeCurrencyCode(
      selectedCreateCounterparty.defaultCurrencyCode
    );
    setCreateForm((previousForm) => {
      const nextForm = { ...previousForm };
      const currentPaymentTermId = normalizeText(previousForm.paymentTermId);
      const currentCurrencyCode = normalizeCurrencyCode(previousForm.currencyCode);
      let changed = false;

      if (!createPaymentTermTouched && !currentPaymentTermId && suggestedPaymentTermId) {
        nextForm.paymentTermId = String(suggestedPaymentTermId);
        changed = true;
      }
      if (
        !createCurrencyTouched &&
        (!currentCurrencyCode || currentCurrencyCode === "USD") &&
        suggestedCurrencyCode
      ) {
        nextForm.currencyCode = suggestedCurrencyCode;
        changed = true;
      }
      return changed ? nextForm : previousForm;
    });
  }, [createCurrencyTouched, createPaymentTermTouched, selectedCreateCounterparty]);

  useEffect(() => {
    if (createImmediateCashDueDate) {
      setCreateForm((previousForm) =>
        normalizeText(previousForm.dueDate) === createImmediateCashDueDate
          ? previousForm
          : { ...previousForm, dueDate: createImmediateCashDueDate }
      );
      return;
    }
    if (createDueDateTouched) {
      return;
    }
    if (!requiresDueDate(createForm.documentType)) {
      return;
    }
    const derivedDueDate = createPaymentTermDerivedDueDate;
    setCreateForm((previousForm) =>
      normalizeText(previousForm.dueDate) === (derivedDueDate || "")
        ? previousForm
        : { ...previousForm, dueDate: derivedDueDate || "" }
    );
  }, [
    createImmediateCashDueDate,
    createDueDateTouched,
    createForm.documentDate,
    createForm.documentType,
    createPaymentTermDerivedDueDate,
  ]);

  useEffect(() => {
    if (!editImmediateCashDueDate) {
      return;
    }
    setEditForm((previousForm) =>
      normalizeText(previousForm.dueDate) === editImmediateCashDueDate
        ? previousForm
        : { ...previousForm, dueDate: editImmediateCashDueDate }
    );
  }, [editImmediateCashDueDate]);

  useEffect(() => {
    setCreateOperatingUnitOverrideOpen(false);
  }, [createForm.counterpartyId, createForm.direction, createForm.legalEntityId]);

  useEffect(() => {
    if (!canReadOrgTree) {
      setEditOperatingUnitOptions([]);
      setEditOperatingUnitsLoading(false);
      setEditOperatingUnitsError("");
      return;
    }
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    if (!legalEntityId) {
      setEditOperatingUnitOptions([]);
      setEditOperatingUnitsLoading(false);
      setEditOperatingUnitsError("");
      return;
    }
    let active = true;
    async function loadEditOperatingUnits() {
      setEditOperatingUnitsLoading(true);
      setEditOperatingUnitsError("");
      try {
        const response = await listOperatingUnits({
          legalEntityId,
          limit: 500,
          includeInactive: true,
        });
        if (!active) return;
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setEditOperatingUnitOptions(rows);
        setEditForm((previousForm) => {
          const selectedOperatingUnitId = normalizeText(previousForm.operatingUnitId);
          if (!selectedOperatingUnitId) {
            return previousForm;
          }
          const selectedStillVisible = rows.some(
            (row) => String(toPositiveInt(row?.id) || "") === selectedOperatingUnitId
          );
          return selectedStillVisible
            ? previousForm
            : { ...previousForm, operatingUnitId: "" };
        });
      } catch (error) {
        if (!active) return;
        setEditOperatingUnitOptions([]);
        setEditOperatingUnitsError(
          normalizeApiError(
            error,
            l(
              "Failed to load operating units for selected legal entity.",
              "Secili tuzel kisilik icin operasyon birimleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) setEditOperatingUnitsLoading(false);
      }
    }
    loadEditOperatingUnits();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, editForm.legalEntityId, l]);

  useEffect(() => {
    if (!canReadCards) {
      setEditCounterpartyOptions([]);
      setEditCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    if (!legalEntityId) {
      setEditCounterpartyOptions([]);
      setEditCounterpartyLoading(false);
      return;
    }
    const role = resolveCounterpartyRoleFromDirection(editForm.direction);
    let active = true;
    async function loadEditCounterparties() {
      setEditCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) return;
        setEditCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) return;
        setEditCounterpartyOptions([]);
      } finally {
        if (active) setEditCounterpartyLoading(false);
      }
    }
    loadEditCounterparties();
    return () => {
      active = false;
    };
  }, [canReadCards, editForm.direction, editForm.legalEntityId]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditCashRegistersError("");
    if (!canReadCashRegisters || !legalEntityId) {
      setEditCashRegisterRows([]);
      setEditCashRegistersLoading(false);
      return;
    }

    let active = true;
    async function loadEditCashRegisters() {
      setEditCashRegistersLoading(true);
      try {
        const response = await listCashRegisters({
          legalEntityId,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditCashRegisterRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditCashRegisterRows([]);
        setEditCashRegistersError(
          normalizeApiError(error, l("Failed to load cash registers.", "Kasalar yuklenemedi."))
        );
      } finally {
        if (active) {
          setEditCashRegistersLoading(false);
        }
      }
    }

    loadEditCashRegisters();
    return () => {
      active = false;
    };
  }, [canReadCashRegisters, editForm.legalEntityId, l]);

  useEffect(() => {
    const documentId = Number(selectedSnapshot?.id || 0);
    const legalEntityId = Number(selectedSnapshot?.legalEntityId || 0);
    const counterpartyId = Number(selectedSnapshot?.counterpartyId || 0);
    if (!canReadReports || !documentId || !legalEntityId || !counterpartyId) {
      setLinkedCashRows([]);
      setLinkedCashError("");
      setLinkedCashLoading(false);
      return;
    }

    let active = true;
    async function loadLinkedCashRows() {
      setLinkedCashLoading(true);
      setLinkedCashError("");
      try {
        const payload = await getCariCounterpartyStatementReport({
          legalEntityId,
          counterpartyId,
          asOfDate: todayIsoDate(),
          status: "ALL",
          includeDetails: true,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        const allocationRows = Array.isArray(payload?.allocations?.rows)
          ? payload.allocations.rows
          : [];
        const settlementRows = Array.isArray(payload?.settlements?.rows)
          ? payload.settlements.rows
          : [];
        const settlementIdSet = new Set(
          allocationRows
            .filter((row) => Number(row?.documentId || 0) === documentId)
            .map((row) => Number(row?.settlementBatchId || 0))
            .filter((id) => id > 0)
        );
        const linkedRows = settlementRows
          .filter((row) => settlementIdSet.has(Number(row?.settlementBatchId || 0)))
          .map((row) => ({
            settlementBatchId: Number(row?.settlementBatchId || 0) || null,
            settlementNo: row?.settlementNo || null,
            settlementDate: row?.settlementDate || null,
            cashTransactionId: Number(row?.cashTransactionId || 0) || null,
          }));
        setLinkedCashRows(linkedRows);
      } catch (error) {
        if (!active) {
          return;
        }
        setLinkedCashRows([]);
        setLinkedCashError(
          normalizeApiError(
            error,
            l("Failed to load settlement/cash links.", "Mahsuplastirma/nakit baglantilari yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setLinkedCashLoading(false);
        }
      }
    }

    loadLinkedCashRows();
    return () => {
      active = false;
    };
  }, [canReadReports, l, selectedSnapshot?.counterpartyId, selectedSnapshot?.id, selectedSnapshot?.legalEntityId]);

  useEffect(() => {
    const documentId = toPositiveInt(selectedSnapshot?.id);
    const legalEntityId = toPositiveInt(
      selectedSnapshot?.legalEntityId || selectedSnapshot?.legal_entity_id
    );
    if (!canRead || !documentId) {
      setRelatedJournal(null);
      setRelatedOpenItems([]);
      setRelatedExceptions([]);
      setRelatedAuditRows([]);
      setRelatedError("");
      setRelatedLoading(false);
      return;
    }

    let active = true;
    async function loadRelatedPanel() {
      setRelatedLoading(true);
      setRelatedError("");
      let nextJournal = null;
      let nextOpenItems = [];
      let nextExceptions = [];
      let nextAuditRows = [];
      const errors = [];

      try {
        const openItemsResponse = await getCariDocumentOpenItems(documentId);
        nextOpenItems = Array.isArray(openItemsResponse?.rows)
          ? openItemsResponse.rows
          : [];
      } catch (error) {
        errors.push(
          normalizeApiError(
            error,
            l("Related open items failed to load.", "Ilgili acik kalemler yuklenemedi.")
          )
        );
      }

      if (canReadGlJournals && selectedPostedJournalEntryId) {
        try {
          const journalResponse = await getJournal(selectedPostedJournalEntryId);
          nextJournal = journalResponse?.row || null;
        } catch (error) {
          errors.push(
            normalizeApiError(
              error,
              l("Related GL journal failed to load.", "Ilgili yevmiye kaydi yuklenemedi.")
            )
          );
        }
      }

      if (canReadExceptions) {
        try {
          const exceptionResponse = await listExceptionWorkbench({
            legalEntityId: legalEntityId || undefined,
            sourceRefId: documentId,
            refresh: false,
            limit: 25,
            offset: 0,
            sortBy: "URGENCY",
          });
          nextExceptions = Array.isArray(exceptionResponse?.rows)
            ? exceptionResponse.rows
            : [];
        } catch (error) {
          errors.push(
            normalizeApiError(
              error,
              l("Related exceptions failed to load.", "Ilgili istisnalar yuklenemedi.")
            )
          );
        }
      }

      if (canReadCariAudit) {
        try {
          const auditResponse = await listCariAudit({
            legalEntityId: legalEntityId || undefined,
            resourceType: "cari_document",
            resourceId: String(documentId),
            includePayload: false,
            limit: 20,
            offset: 0,
          });
          nextAuditRows = Array.isArray(auditResponse?.rows) ? auditResponse.rows : [];
        } catch (error) {
          errors.push(
            normalizeApiError(
              error,
              l("Related audit trail failed to load.", "Ilgili denetim kayitlari yuklenemedi.")
            )
          );
        }
      }

      if (!active) {
        return;
      }
      setRelatedJournal(nextJournal);
      setRelatedOpenItems(nextOpenItems);
      setRelatedExceptions(nextExceptions);
      setRelatedAuditRows(nextAuditRows);
      setRelatedError(errors.join(" "));
      setRelatedLoading(false);
    }

    loadRelatedPanel();
    return () => {
      active = false;
    };
  }, [
    canRead,
    canReadCariAudit,
    canReadExceptions,
    canReadGlJournals,
    l,
    selectedPostedJournalEntryId,
    selectedSnapshot?.id,
    selectedSnapshot?.legalEntityId,
    selectedSnapshot?.legal_entity_id,
  ]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);

    setCreateLineAccountsError("");
    if (!canReadGlAccounts || !legalEntityId) {
      setCreateLineAccountRows([]);
      setCreateLineAccountsLoading(false);
      return;
    }

    let active = true;
    async function loadCreateLineAccounts() {
      setCreateLineAccountsLoading(true);
      try {
        const response = await listAccounts({
          legalEntityId,
          includeInactive: false,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateLineAccountRows(mapPostableAccountRows(response?.rows));
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateLineAccountRows([]);
        setCreateLineAccountsError(
          normalizeApiError(
            error,
            l(
              "Failed to load line posting account options.",
              "Satir kayit hesap secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setCreateLineAccountsLoading(false);
        }
      }
    }

    loadCreateLineAccounts();
    return () => {
      active = false;
    };
  }, [canReadGlAccounts, createForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    setCreateItemCardsError("");
    if (!canReadItemCards || !legalEntityId) {
      setCreateItemCardRows([]);
      setCreateItemCardsLoading(false);
      return;
    }

    let active = true;
    async function loadCreateItemCards() {
      setCreateItemCardsLoading(true);
      try {
        const response = await listItemCards({
          legalEntityId,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateItemCardRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateItemCardRows([]);
        setCreateItemCardsError(
          normalizeApiError(
            error,
            l("Failed to load item card options.", "Urun karti secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setCreateItemCardsLoading(false);
        }
      }
    }

    loadCreateItemCards();
    return () => {
      active = false;
    };
  }, [canReadItemCards, createForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    setCreateFixedAssetCategoriesError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setCreateFixedAssetCategoryRows([]);
      setCreateFixedAssetCategoriesLoading(false);
      return;
    }
    let active = true;
    async function loadCreateFixedAssetCategories() {
      setCreateFixedAssetCategoriesLoading(true);
      try {
        const response = await listFixedAssetCategories({
          legalEntityId,
          status: "ACTIVE",
        });
        if (!active) {
          return;
        }
        setCreateFixedAssetCategoryRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateFixedAssetCategoryRows([]);
        setCreateFixedAssetCategoriesError(
          normalizeApiError(
            error,
            l(
              "Failed to load fixed asset categories.",
              "Duran varlik kategorileri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setCreateFixedAssetCategoriesLoading(false);
        }
      }
    }
    loadCreateFixedAssetCategories();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, createForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    setCreateFixedAssetDraftError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setCreateFixedAssetDraftRows([]);
      setCreateFixedAssetDraftLoading(false);
      return;
    }
    let active = true;
    async function loadCreateFixedAssetDrafts() {
      setCreateFixedAssetDraftLoading(true);
      try {
        const response = await listFixedAssets({
          legalEntityId,
          status: "DRAFT",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateFixedAssetDraftRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateFixedAssetDraftRows([]);
        setCreateFixedAssetDraftError(
          normalizeApiError(
            error,
            l(
              "Failed to load draft fixed assets.",
              "Taslak duran varliklar yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setCreateFixedAssetDraftLoading(false);
        }
      }
    }
    loadCreateFixedAssetDrafts();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, createForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    setCreateFixedAssetSaleError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setCreateFixedAssetSaleRows([]);
      setCreateFixedAssetSaleLoading(false);
      return;
    }
    let active = true;
    async function loadCreateFixedAssetSaleRows() {
      setCreateFixedAssetSaleLoading(true);
      try {
        const responses = await Promise.all(
          FIXED_ASSET_AR_ELIGIBLE_STATUSES.map((status) =>
            listFixedAssets({
              legalEntityId,
              status,
              limit: 500,
              offset: 0,
            })
          )
        );
        if (!active) {
          return;
        }
        const merged = new Map();
        responses.forEach((response) => {
          (Array.isArray(response?.rows) ? response.rows : []).forEach((row) => {
            const id = toPositiveInt(row?.id);
            if (id && !merged.has(id)) {
              merged.set(id, row);
            }
          });
        });
        setCreateFixedAssetSaleRows([...merged.values()]);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateFixedAssetSaleRows([]);
        setCreateFixedAssetSaleError(
          normalizeApiError(
            error,
            l(
              "Failed to load eligible sale assets.",
              "Uygun satis varliklari yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setCreateFixedAssetSaleLoading(false);
        }
      }
    }
    loadCreateFixedAssetSaleRows();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, createForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const operatingUnitId = toPositiveInt(createForm.operatingUnitId);
    setCreateWarehousesError("");
    if (!canRead || !legalEntityId) {
      setCreateWarehouseRows([]);
      setCreateWarehousesLoading(false);
      return;
    }

    let active = true;
    async function loadCreateWarehouses() {
      setCreateWarehousesLoading(true);
      try {
        const response = await listCariDocumentWarehouseOptions({
          legalEntityId,
          operatingUnitId: operatingUnitId || undefined,
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateWarehouseRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateWarehouseRows([]);
        setCreateWarehousesError(
          normalizeApiError(
            error,
            l("Failed to load warehouse choices.", "Depo secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setCreateWarehousesLoading(false);
        }
      }
    }

    loadCreateWarehouses();
    return () => {
      active = false;
    };
  }, [canRead, createForm.legalEntityId, createForm.operatingUnitId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);

    setEditLineAccountsError("");
    if (!canReadGlAccounts || !legalEntityId) {
      setEditLineAccountRows([]);
      setEditLineAccountsLoading(false);
      return;
    }

    let active = true;
    async function loadEditLineAccounts() {
      setEditLineAccountsLoading(true);
      try {
        const response = await listAccounts({
          legalEntityId,
          includeInactive: false,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditLineAccountRows(mapPostableAccountRows(response?.rows));
      } catch (error) {
        if (!active) {
          return;
        }
        setEditLineAccountRows([]);
        setEditLineAccountsError(
          normalizeApiError(
            error,
            l(
              "Failed to load edit-line account options.",
              "Duzenleme satir hesap secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditLineAccountsLoading(false);
        }
      }
    }

    loadEditLineAccounts();
    return () => {
      active = false;
    };
  }, [canReadGlAccounts, editForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditItemCardsError("");
    if (!canReadItemCards || !legalEntityId) {
      setEditItemCardRows([]);
      setEditItemCardsLoading(false);
      return;
    }

    let active = true;
    async function loadEditItemCards() {
      setEditItemCardsLoading(true);
      try {
        const response = await listItemCards({
          legalEntityId,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditItemCardRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditItemCardRows([]);
        setEditItemCardsError(
          normalizeApiError(
            error,
            l(
              "Failed to load edit-line item card options.",
              "Duzenleme satiri urun karti secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditItemCardsLoading(false);
        }
      }
    }

    loadEditItemCards();
    return () => {
      active = false;
    };
  }, [canReadItemCards, editForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditFixedAssetCategoriesError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setEditFixedAssetCategoryRows([]);
      setEditFixedAssetCategoriesLoading(false);
      return;
    }
    let active = true;
    async function loadEditFixedAssetCategories() {
      setEditFixedAssetCategoriesLoading(true);
      try {
        const response = await listFixedAssetCategories({
          legalEntityId,
          status: "ACTIVE",
        });
        if (!active) {
          return;
        }
        setEditFixedAssetCategoryRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditFixedAssetCategoryRows([]);
        setEditFixedAssetCategoriesError(
          normalizeApiError(
            error,
            l(
              "Failed to load fixed asset categories.",
              "Duran varlik kategorileri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditFixedAssetCategoriesLoading(false);
        }
      }
    }
    loadEditFixedAssetCategories();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, editForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditFixedAssetDraftError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setEditFixedAssetDraftRows([]);
      setEditFixedAssetDraftLoading(false);
      return;
    }
    let active = true;
    async function loadEditFixedAssetDraftRows() {
      setEditFixedAssetDraftLoading(true);
      try {
        const response = await listFixedAssets({
          legalEntityId,
          status: "DRAFT",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditFixedAssetDraftRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditFixedAssetDraftRows([]);
        setEditFixedAssetDraftError(
          normalizeApiError(
            error,
            l(
              "Failed to load draft fixed assets.",
              "Taslak duran varliklar yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditFixedAssetDraftLoading(false);
        }
      }
    }
    loadEditFixedAssetDraftRows();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, editForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditFixedAssetSaleError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setEditFixedAssetSaleRows([]);
      setEditFixedAssetSaleLoading(false);
      return;
    }
    let active = true;
    async function loadEditFixedAssetSaleRows() {
      setEditFixedAssetSaleLoading(true);
      try {
        const responses = await Promise.all(
          FIXED_ASSET_AR_ELIGIBLE_STATUSES.map((status) =>
            listFixedAssets({
              legalEntityId,
              status,
              limit: 500,
              offset: 0,
            })
          )
        );
        if (!active) {
          return;
        }
        const merged = new Map();
        responses.forEach((response) => {
          (Array.isArray(response?.rows) ? response.rows : []).forEach((row) => {
            const id = toPositiveInt(row?.id);
            if (id && !merged.has(id)) {
              merged.set(id, row);
            }
          });
        });
        setEditFixedAssetSaleRows([...merged.values()]);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditFixedAssetSaleRows([]);
        setEditFixedAssetSaleError(
          normalizeApiError(
            error,
            l(
              "Failed to load eligible sale assets.",
              "Uygun satis varliklari yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditFixedAssetSaleLoading(false);
        }
      }
    }
    loadEditFixedAssetSaleRows();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, editForm.legalEntityId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    const operatingUnitId = toPositiveInt(editForm.operatingUnitId);
    setEditWarehousesError("");
    if (!canRead || !legalEntityId) {
      setEditWarehouseRows([]);
      setEditWarehousesLoading(false);
      return;
    }

    let active = true;
    async function loadEditWarehouses() {
      setEditWarehousesLoading(true);
      try {
        const response = await listCariDocumentWarehouseOptions({
          legalEntityId,
          operatingUnitId: operatingUnitId || undefined,
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditWarehouseRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditWarehouseRows([]);
        setEditWarehousesError(
          normalizeApiError(
            error,
            l(
              "Failed to load edit-line warehouse choices.",
              "Duzenleme satiri depo secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditWarehousesLoading(false);
        }
      }
    }

    loadEditWarehouses();
    return () => {
      active = false;
    };
  }, [canRead, editForm.legalEntityId, editForm.operatingUnitId, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(
      selectedDetailForPosting?.legalEntityId || selectedDetailForPosting?.legal_entity_id
    );
    const operatingUnitId = toPositiveInt(
      selectedDetailForPosting?.operatingUnitId || selectedDetailForPosting?.operating_unit_id
    );
    setPostWarehousesError("");
    if (!canRead || !legalEntityId || !selectedDetailForPosting) {
      setPostWarehouseRows([]);
      setPostWarehousesLoading(false);
      return;
    }

    let active = true;
    async function loadPostWarehouses() {
      setPostWarehousesLoading(true);
      try {
        const response = await listCariDocumentWarehouseOptions({
          legalEntityId,
          operatingUnitId: operatingUnitId || undefined,
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setPostWarehouseRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setPostWarehouseRows([]);
        setPostWarehousesError(
          normalizeApiError(
            error,
            l(
              "Failed to load posting warehouse choices.",
              "Kayit icin depo secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setPostWarehousesLoading(false);
        }
      }
    }

    loadPostWarehouses();
    return () => {
      active = false;
    };
  }, [canRead, l, selectedDetailForPosting]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(
      selectedSnapshot?.legalEntityId || selectedSnapshot?.legal_entity_id
    );

    setPostOffsetAccountsError("");
    if (!canReadGlAccounts || !legalEntityId) {
      setPostOffsetAccountOptions([]);
      setPostOffsetAccountsLoading(false);
      return;
    }

    let active = true;
    async function loadPostOffsetAccounts() {
      setPostOffsetAccountsLoading(true);
      try {
        const response = await listAccounts({
          legalEntityId,
          includeInactive: false,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setPostOffsetAccountOptions(mapPostableAccountRows(response?.rows));
      } catch (error) {
        if (!active) {
          return;
        }
        setPostOffsetAccountOptions([]);
        setPostOffsetAccountsError(
          normalizeApiError(
            error,
            l("Failed to load postable account options.", "Kaydedilebilir hesap secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setPostOffsetAccountsLoading(false);
        }
      }
    }

    loadPostOffsetAccounts();
    return () => {
      active = false;
    };
  }, [
    canReadGlAccounts,
    l,
    selectedSnapshot?.legalEntityId,
    selectedSnapshot?.legal_entity_id,
  ]);

  useEffect(() => {
    const availableOptionIds = new Set(
      filteredPostOffsetAccountOptions
        .map((row) => Number(row?.id || 0))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setPostForm((prev) => {
      let changed = false;
      let nextOffsetAccountId = prev.offsetAccountId;
      if (nextOffsetAccountId) {
        const exists = availableOptionIds.has(Number(nextOffsetAccountId));
        if (!exists) {
          nextOffsetAccountId = "";
          changed = true;
        }
      }

      const existingLines = Array.isArray(prev.postingLines) ? prev.postingLines : [];
      const nextPostingLines = existingLines.map((line) => {
        const currentOffsetAccountId = normalizePositiveIntText(line?.offsetAccountId);
        if (!currentOffsetAccountId) {
          return line;
        }
        const exists = availableOptionIds.has(Number(currentOffsetAccountId));
        if (exists) {
          return line;
        }
        changed = true;
        return {
          ...line,
          offsetAccountId: "",
        };
      });

      if (!changed) {
        return prev;
      }
      return {
        ...prev,
        offsetAccountId: nextOffsetAccountId,
        postingLines: nextPostingLines,
      };
    });
  }, [filteredPostOffsetAccountOptions]);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    setOpsStatusError("");
    setOpsStatusMessage("");
    setOpsStatusRow(null);
    setOpsStatusForm({
      opsStatus: "OK",
      blockedReason: "",
      note: "",
    });

    if (!canRead || !documentId) {
      setOpsStatusLoading(false);
      return;
    }

    let active = true;
    async function loadOpsStatus() {
      setOpsStatusLoading(true);
      try {
        const response = await getCariDocumentOpsStatus(documentId);
        if (!active) {
          return;
        }
        const row = response?.row || null;
        setOpsStatusRow(row);
        setOpsStatusForm({
          opsStatus: String(row?.opsStatus || "OK").trim().toUpperCase() || "OK",
          blockedReason: String(row?.blockedReason || ""),
          note: String(row?.note || ""),
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setOpsStatusError(
          normalizeApiError(
            error,
            l("Failed to load ops status note.", "Operasyon durumu notu yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setOpsStatusLoading(false);
        }
      }
    }

    loadOpsStatus();
    return () => {
      active = false;
    };
  }, [canRead, l, selectedDocumentNumericId]);

  useEffect(() => {
    const nextInitial = buildInitialPostForm(selectedSnapshot);
    setPostForm((previous) => {
      if (Number(previous?.documentId || 0) === Number(nextInitial.documentId || 0)) {
        return previous;
      }
      return nextInitial;
    });
    setPostError("");
    setPostMessage("");
  }, [selectedDocumentNumericId, selectedSnapshot]);

  useEffect(() => {
    if (!selectedDocumentUsesStoredTaxesForPosting) {
      return;
    }
    setPostForm((previous) =>
      previous.usePostingLines
        ? {
            ...previous,
            usePostingLines: false,
          }
        : previous
    );
  }, [selectedDocumentUsesStoredTaxesForPosting]);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    setInternalCommentsError("");
    setInternalCommentsMessage("");
    setInternalCommentBody("");
    closeInternalCommentMentionPicker();

    if (!canRead || !documentId) {
      setInternalCommentRows([]);
      setInternalCommentsLoading(false);
      return;
    }

    let active = true;
    async function loadInternalComments() {
      setInternalCommentsLoading(true);
      try {
        const response = await listCariDocumentComments(documentId);
        if (!active) {
          return;
        }
        setInternalCommentRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setInternalCommentRows([]);
        setInternalCommentsError(
          normalizeApiError(error, l("Failed to load internal comments.", "Ic yorumlar yuklenemedi."))
        );
      } finally {
        if (active) {
          setInternalCommentsLoading(false);
        }
      }
    }

    loadInternalComments();
    return () => {
      active = false;
    };
  }, [canRead, l, selectedDocumentNumericId]);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    if (!documentId || !canWriteInternalComments || !internalCommentMentionDraft) {
      setInternalCommentMentionRows([]);
      setInternalCommentMentionLoading(false);
      setInternalCommentMentionError("");
      setInternalCommentMentionHighlightIndex(-1);
      return;
    }

    const requestId = internalCommentMentionRequestRef.current + 1;
    internalCommentMentionRequestRef.current = requestId;
    const timeoutId = window.setTimeout(async () => {
      setInternalCommentMentionLoading(true);
      setInternalCommentMentionError("");
      try {
        const response = await listCariDocumentMentionCandidates(documentId, {
          q: internalCommentMentionDraft.query,
          limit: 8,
        });
        if (internalCommentMentionRequestRef.current !== requestId) {
          return;
        }
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setInternalCommentMentionRows(rows);
        setInternalCommentMentionHighlightIndex(rows.length > 0 ? 0 : -1);
      } catch (error) {
        if (internalCommentMentionRequestRef.current !== requestId) {
          return;
        }
        setInternalCommentMentionRows([]);
        setInternalCommentMentionHighlightIndex(-1);
        setInternalCommentMentionError(
          normalizeApiError(
            error,
            l(
              "Mention suggestions could not be loaded. You can still type the full email.",
              "Etiket onerileri yuklenemedi. E-postayi tam yazarak devam edebilirsiniz."
            )
          )
        );
      } finally {
        if (internalCommentMentionRequestRef.current === requestId) {
          setInternalCommentMentionLoading(false);
        }
      }
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canWriteInternalComments, internalCommentMentionDraft, l, selectedDocumentNumericId]);

  useEffect(() => {
    const documentId = selectedDocumentNumericId;
    setEvidenceMessage("");
    setEvidenceError("");
    setEvidenceNote("");
    setEvidenceUploadFile(null);
    setEvidenceUploadInputKey((prev) => prev + 1);
    setEvidenceDeletingId(null);
    setEvidenceDownloadingId(null);

    if (!canRead || !documentId) {
      setEvidenceRows([]);
      setEvidenceLoading(false);
      return;
    }

    let active = true;
    async function loadEvidenceRows() {
      setEvidenceLoading(true);
      try {
        const response = await listCariDocumentEvidence(documentId);
        if (!active) {
          return;
        }
        setEvidenceRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEvidenceRows([]);
        setEvidenceError(
          normalizeApiError(error, l("Failed to load evidence attachments.", "Kanit ekleri yuklenemedi."))
        );
      } finally {
        if (active) {
          setEvidenceLoading(false);
        }
      }
    }

    loadEvidenceRows();
    return () => {
      active = false;
    };
  }, [canRead, l, selectedDocumentNumericId]);

  useEffect(() => {
    if (documentListPage <= documentListTotalPages) {
      return;
    }
    setDocumentListPage(documentListTotalPages);
  }, [documentListPage, documentListTotalPages]);

  useEffect(() => {
    if (!selectedDocumentOutsideList || documentListPage === 1) {
      return;
    }
    setDocumentListPage(1);
  }, [documentListPage, selectedDocumentOutsideList]);

  async function handleSaveOpsStatus(event) {
    event.preventDefault();
    const documentId = selectedDocumentNumericId;
    if (!documentId || !canWriteOpsStatus) {
      setOpsStatusError(
        l(
          "Ops status update requires selected document and permission: cari.doc.update.",
          "Operasyon durumu guncellemesi icin secili belge ve `cari.doc.update` yetkisi gerekir."
        )
      );
      return;
    }

    const opsStatus = String(opsStatusForm?.opsStatus || "").trim().toUpperCase();
    const blockedReason = String(opsStatusForm?.blockedReason || "").trim();
    const note = String(opsStatusForm?.note || "").trim();

    if (!["OK", "AT_RISK", "BLOCKED"].includes(opsStatus)) {
      setOpsStatusError(
        l("opsStatus must be OK, AT_RISK, or BLOCKED.", "opsStatus OK, AT_RISK veya BLOCKED olmali.")
      );
      return;
    }
    if (opsStatus === "BLOCKED" && !blockedReason) {
      setOpsStatusError(
        l(
          "blockedReason is required when opsStatus=BLOCKED.",
          "opsStatus=BLOCKED iken blockedReason zorunludur."
        )
      );
      return;
    }

    setOpsStatusSaving(true);
    setOpsStatusError("");
    setOpsStatusMessage("");
    try {
      const response = await upsertCariDocumentOpsStatus(documentId, {
        opsStatus,
        blockedReason: blockedReason || null,
        note: note || null,
      });
      const row = response?.row || null;
      setOpsStatusRow(row);
      setOpsStatusForm({
        opsStatus: String(row?.opsStatus || "OK").trim().toUpperCase() || "OK",
        blockedReason: String(row?.blockedReason || ""),
        note: String(row?.note || ""),
      });
      setOpsStatusMessage(l("Ops status note updated.", "Operasyon durumu notu guncellendi."));
    } catch (error) {
      setOpsStatusError(
        normalizeApiError(
          error,
          l("Failed to update ops status note.", "Operasyon durumu notu guncellenemedi.")
        )
      );
    } finally {
      setOpsStatusSaving(false);
    }
  }

  async function refreshInternalComments(documentId) {
    const response = await listCariDocumentComments(documentId);
    setInternalCommentRows(Array.isArray(response?.rows) ? response.rows : []);
  }

  async function handleCreateInternalComment(event) {
    event.preventDefault();
    const documentId = selectedDocumentNumericId;
    if (!documentId || !canWriteInternalComments) {
      setInternalCommentsError(
        l(
          "Internal comment add requires selected document and permission: cari.doc.update.",
          "Ic yorum eklemek icin secili belge ve `cari.doc.update` yetkisi gerekir."
        )
      );
      return;
    }

    const body = String(internalCommentBody || "").trim();
    if (!body) {
      setInternalCommentsError(l("Comment body is required.", "Yorum metni zorunludur."));
      return;
    }

    closeInternalCommentMentionPicker();
    setInternalCommentSaving(true);
    setInternalCommentsError("");
    setInternalCommentsMessage("");
    try {
      const response = await createCariDocumentComment(documentId, { body });
      await refreshInternalComments(documentId);
      const commentId = toPositiveInt(response?.row?.id);
      setInternalCommentBody("");
      setInternalCommentsMessage(
        commentId
          ? l(`Internal comment added. id=${commentId}`, `Ic yorum eklendi. id=${commentId}`)
          : l("Internal comment added.", "Ic yorum eklendi.")
      );
    } catch (error) {
      setInternalCommentsError(
        normalizeApiError(error, l("Failed to add internal comment.", "Ic yorum eklenemedi."))
      );
    } finally {
      setInternalCommentSaving(false);
    }
  }

  async function refreshEvidenceRows(documentId) {
    const response = await listCariDocumentEvidence(documentId);
    setEvidenceRows(Array.isArray(response?.rows) ? response.rows : []);
  }

  async function handleAttachEvidence(event) {
    event.preventDefault();
    const documentId = selectedDocumentNumericId;
    if (!documentId || !canAttachEvidence) {
      setEvidenceError(
        l(
          "Evidence attach requires selected document and permission: cari.doc.update.",
          "Kanit eklemek icin secili belge ve `cari.doc.update` yetkisi gerekir."
        )
      );
      return;
    }
    if (!evidenceUploadFile) {
      setEvidenceError(l("Select a file before attaching evidence.", "Kanit eklemeden once dosya secin."));
      return;
    }

    setEvidenceUploading(true);
    setEvidenceError("");
    setEvidenceMessage("");
    try {
      const draftResponse = await createCariDocumentEvidence(documentId, {
        fileName: evidenceUploadFile.name || "evidence.bin",
        contentType: evidenceUploadFile.type || undefined,
        displayName: evidenceUploadFile.name || undefined,
        note: String(evidenceNote || "").trim() || undefined,
      });
      const evidenceId = toPositiveInt(draftResponse?.row?.id);
      if (!evidenceId) {
        throw new Error(l("Evidence create response is missing id.", "Kanit olusturma yanitinda id yok."));
      }

      await uploadCariDocumentEvidenceContent(documentId, evidenceId, evidenceUploadFile, {
        contentType: evidenceUploadFile.type || "application/octet-stream",
      });

      await refreshEvidenceRows(documentId);
      setEvidenceMessage(l(`Evidence attached. id=${evidenceId}`, `Kanit eklendi. id=${evidenceId}`));
      setEvidenceNote("");
      setEvidenceUploadFile(null);
      setEvidenceUploadInputKey((prev) => prev + 1);
    } catch (error) {
      setEvidenceError(normalizeApiError(error, l("Failed to attach evidence.", "Kanit eklenemedi.")));
    } finally {
      setEvidenceUploading(false);
    }
  }

  async function handleDownloadEvidence(row) {
    const documentId = selectedDocumentNumericId;
    const evidenceId = toPositiveInt(row?.id);
    if (!documentId || !evidenceId) {
      setEvidenceError(l("Evidence id is invalid.", "Kanit id gecersiz."));
      return;
    }

    setEvidenceDownloadingId(evidenceId);
    setEvidenceError("");
    try {
      const response = await downloadCariDocumentEvidence(documentId, evidenceId);
      const blob = response?.blob;
      if (!(blob instanceof Blob)) {
        throw new Error(
          l("Evidence download payload is invalid.", "Kanit indirme yuklemi gecersiz.")
        );
      }
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download =
        String(response?.fileName || row?.fileName || "").trim() ||
        `evidence-${evidenceId}.bin`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setEvidenceError(normalizeApiError(error, l("Failed to download evidence.", "Kanit indirilemedi.")));
    } finally {
      setEvidenceDownloadingId(null);
    }
  }

  async function handleDeleteEvidence(evidenceIdRaw) {
    const documentId = selectedDocumentNumericId;
    const evidenceId = toPositiveInt(evidenceIdRaw);
    if (!documentId || !evidenceId || !canAttachEvidence) {
      setEvidenceError(
        l(
          "Evidence delete requires selected document, valid evidence id, and cari.doc.update permission.",
          "Kanit silmek icin secili belge, gecerli kanit id ve `cari.doc.update` yetkisi gerekir."
        )
      );
      return;
    }

    setEvidenceDeletingId(evidenceId);
    setEvidenceError("");
    setEvidenceMessage("");
    try {
      await deleteCariDocumentEvidence(documentId, evidenceId);
      await refreshEvidenceRows(documentId);
      setEvidenceMessage(l(`Evidence deleted. id=${evidenceId}`, `Kanit silindi. id=${evidenceId}`));
    } catch (error) {
      setEvidenceError(normalizeApiError(error, l("Failed to delete evidence.", "Kanit silinemedi.")));
    } finally {
      setEvidenceDeletingId(null);
    }
  }

  async function handleInlineCreateCounterpartyForCreateForm() {
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const name = normalizeLookupQuery(createCounterpartyLookupQuery);
    if (!canUpsertCards) {
      setCreateInlineCounterpartyError(
        l("Missing permission: cari.card.upsert", "Eksik yetki: cari.card.upsert")
      );
      return;
    }
    if (!legalEntityId) {
      setCreateInlineCounterpartyError(
        l(
          "Select legalEntityId before creating a counterparty.",
          "Cari olusturmadan once legalEntityId secin."
        )
      );
      return;
    }
    if (!name) {
      setCreateInlineCounterpartyError(
        l(
          "Type a counterparty name in lookup before creating.",
          "Cari olusturmadan once aramaya cari adini yazin."
        )
      );
      return;
    }

    setCreateInlineCounterpartySaving(true);
    try {
      const payload = {
        legalEntityId,
        code: buildInlineCounterpartyCode({ legalEntityId, name }),
        name,
        status: "ACTIVE",
        ...resolveInlineCounterpartyRoleFlags(createForm.direction),
      };
      const response = await createCariCounterparty(payload);
      const row = response?.row || null;
      const counterpartyId = toPositiveInt(row?.id);
      if (!counterpartyId) {
        throw new Error(
          l("Counterparty create response is missing row.id.", "Cari olusturma yanitinda row.id yok.")
        );
      }
      setCreateCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
      setCreateForm((prev) => ({
        ...prev,
        counterpartyId: String(counterpartyId),
        operatingUnitId: "",
      }));
      setCreateCounterpartyLookupQuery("");
      setCreateInlineCounterpartyMessage(
        l(
          `Counterparty created and selected. counterpartyId=${counterpartyId}`,
          `Cari olusturuldu ve secildi. counterpartyId=${counterpartyId}`
        )
      );
    } catch (error) {
      setCreateInlineCounterpartyError(
        normalizeApiError(error, l("Failed to create counterparty from lookup.", "Aramadan cari olusturulamadi."))
      );
    } finally {
      setCreateInlineCounterpartySaving(false);
    }
  }

  async function handleInlineCreateCounterpartyForEditForm() {
    setEditInlineCounterpartyError("");
    setEditInlineCounterpartyMessage("");
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    const name = normalizeLookupQuery(editCounterpartyLookupQuery);
    if (!canUpsertCards) {
      setEditInlineCounterpartyError(
        l("Missing permission: cari.card.upsert", "Eksik yetki: cari.card.upsert")
      );
      return;
    }
    if (!legalEntityId) {
      setEditInlineCounterpartyError(
        l(
          "Select legalEntityId before creating a counterparty.",
          "Cari olusturmadan once legalEntityId secin."
        )
      );
      return;
    }
    if (!name) {
      setEditInlineCounterpartyError(
        l(
          "Type a counterparty name in lookup before creating.",
          "Cari olusturmadan once aramaya cari adini yazin."
        )
      );
      return;
    }

    setEditInlineCounterpartySaving(true);
    try {
      const payload = {
        legalEntityId,
        code: buildInlineCounterpartyCode({ legalEntityId, name }),
        name,
        status: "ACTIVE",
        ...resolveInlineCounterpartyRoleFlags(editForm.direction),
      };
      const response = await createCariCounterparty(payload);
      const row = response?.row || null;
      const counterpartyId = toPositiveInt(row?.id);
      if (!counterpartyId) {
        throw new Error(
          l("Counterparty create response is missing row.id.", "Cari olusturma yanitinda row.id yok.")
        );
      }
      setEditCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
      setEditForm((prev) => ({ ...prev, counterpartyId: String(counterpartyId) }));
      setEditCounterpartyLookupQuery("");
      setEditInlineCounterpartyMessage(
        l(
          `Counterparty created and selected. counterpartyId=${counterpartyId}`,
          `Cari olusturuldu ve secildi. counterpartyId=${counterpartyId}`
        )
      );
    } catch (error) {
      setEditInlineCounterpartyError(
        normalizeApiError(error, l("Failed to create counterparty from lookup.", "Aramadan cari olusturulamadi."))
      );
    } finally {
      setEditInlineCounterpartySaving(false);
    }
  }

  async function handleCreateDraft(event) {
    event.preventDefault();
    setCreateSaving(true);
    setCreateError("");
    setCreateMessage("");
    setCreateValidationVisible(true);
    try {
      if (createValidationResult.errors.length > 0) {
        return;
      }
      if (createWarehouseValidation.blockingMessages.length > 0) {
        setCreateError(createWarehouseValidation.blockingMessages.join(" "));
        return;
      }
      setCreateValidationVisible(false);
      const payload = buildDocumentMutationPayload(createForm, createDocumentMutationOptions);
      const response = await createCariDocument(payload);
      setCreateMessage(
        l(
          `Draft document created. id=${response?.row?.id || "-"}`,
          `Belge taslagi olusturuldu. id=${response?.row?.id || "-"}`
        )
      );
      resetCreateDraftFormWithSmartDefaults();
      await loadDocuments(filters);
      if (response?.row?.id) setSelectedDocumentId(response.row.id);
    } catch (error) {
      setCreateError(
        normalizeApiError(error, l("Failed to create draft document.", "Belge taslagi olusturulamadi."))
      );
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleUpdateDraft(event) {
    event.preventDefault();
    if (!selectedDocumentId || !canEditOrCancelSelected) {
      setEditError(
        l(
          "Only DRAFT documents can be edited with cari.doc.update permission.",
          "Yalnizca DRAFT belgeler `cari.doc.update` yetkisiyle duzenlenebilir."
        )
      );
      return;
    }
    setEditSaving(true);
    setEditError("");
    setEditMessage("");
    setEditValidationVisible(true);
    try {
      if (editValidationResult.errors.length > 0) {
        return;
      }
      if (editWarehouseValidation.blockingMessages.length > 0) {
        setEditError(editWarehouseValidation.blockingMessages.join(" "));
        return;
      }
      setEditValidationVisible(false);
      const payload = buildDocumentMutationPayload(editForm, editDocumentMutationOptions);
      if (!payload.rowVersion) {
        payload.rowVersion = Number(selectedDetail?.rowVersion || 0) || undefined;
      }
      const response = await updateCariDocument(selectedDocumentId, payload);
      setEditMessage(l("Draft document updated.", "Belge taslagi guncellendi."));
      setSelectedDetail(response?.row || null);
      if (response?.row) {
        setEditForm(mapDocumentRowToForm(response.row));
        setEditDueDateTouched(false);
      }
      await loadDocuments(filters);
    } catch (error) {
      setEditError(
        normalizeApiError(error, l("Failed to update draft document.", "Belge taslagi guncellenemedi."))
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCancelDraft() {
    if (!selectedDocumentId || !canEditOrCancelSelected) {
      setCancelError(
        l(
          "Only DRAFT documents can be cancelled with cari.doc.update permission.",
          "Yalnizca DRAFT belgeler `cari.doc.update` yetkisiyle iptal edilebilir."
        )
      );
      return;
    }
    setCancelSaving(true);
    setCancelError("");
    try {
      const response = await cancelCariDocument(selectedDocumentId);
      setSelectedDetail(response?.row || null);
      await loadDocuments(filters);
    } catch (error) {
      setCancelError(
        normalizeApiError(error, l("Failed to cancel draft document.", "Belge taslagi iptal edilemedi."))
      );
    } finally {
      setCancelSaving(false);
    }
  }

  async function handlePostDraft() {
    setPostTransferGuidance(null);
    if (cariPostingNotReady) {
      setPostError(
        l(
          "Setup incomplete for selected legal entity. Configure CARI purpose mappings in GL Setup first.",
          "Secili tuzel kisilik icin kurulum eksik. Once GL Ayarlari altinda CARI amac eslemelerini tamamlayin."
        )
      );
      return;
    }
    if (!selectedDocumentId || !canPostSelected) {
      setPostError(
        l(
          "Only DRAFT documents can be posted with cari.doc.post permission.",
          "Yalnizca DRAFT belgeler `cari.doc.post` yetkisiyle kayda alinabilir."
        )
      );
      return;
    }
    if (selectedPostingWarehouseValidation.blockingMessages.length > 0) {
      setPostError(selectedPostingWarehouseValidation.blockingMessages.join(" "));
      return;
    }
    if (postForm.useFxOverride && !canFxOverride) {
      setPostError(
        l(
          "FX override requires permission: cari.fx.override. Disable override or request access.",
          "Kur gecersiz kilma icin `cari.fx.override` yetkisi gerekir. Gecersiz kilmayi kapatin veya erisim isteyin."
        )
      );
      return;
    }
    if (postForm.useFxOverride && !String(postForm.fxOverrideReason || "").trim()) {
      setPostError(
        l(
          "fxOverrideReason is required when useFxOverride=true.",
          "useFxOverride=true iken fxOverrideReason zorunludur."
        )
      );
      return;
    }

    const payload = {
      useFxOverride: Boolean(postForm.useFxOverride),
      fxOverrideReason: postForm.useFxOverride
        ? String(postForm.fxOverrideReason || "").trim()
        : null,
      offsetAccountId: toPositiveInt(postForm.offsetAccountId) || null,
    };

    if (selectedDocumentUsesStoredTaxesForPosting && postForm.usePostingLines) {
      setPostError(
        l(
          "Split posting is not available for drafts that already store line-level taxes.",
          "Satir bazli vergisi kayitli taslaklarda bolunmus kayit kullanilamaz."
        )
      );
      return;
    }

    if (postForm.usePostingLines) {
      if (!selectedDocumentAmountTxn || !selectedDocumentAmountBase) {
        setPostError(
          l(
            "Selected draft amountTxn/amountBase is invalid. Re-open the draft and try again.",
            "Secili taslak amountTxn/amountBase gecersiz. Taslagi yeniden acip tekrar deneyin."
          )
        );
        return;
      }
      const sourceLines = Array.isArray(postForm.postingLines)
        ? postForm.postingLines
        : [];
      if (sourceLines.length === 0) {
        setPostError(l("Add at least one posting line.", "En az bir kayit satiri ekleyin."));
        return;
      }

      let totalTxn = 0;
      let totalBase = 0;
      const postingLines = [];
      for (let index = 0; index < sourceLines.length; index += 1) {
        const line = sourceLines[index] || {};
        const lineAmountTxn = toPositiveDecimal(line.amountTxn);
        const lineAmountBase = toPositiveDecimal(line.amountBase);
        if (!lineAmountTxn || !lineAmountBase) {
          setPostError(
            l(
              `Line ${index + 1}: amountTxn and amountBase must be greater than 0.`,
              `Satir ${index + 1}: amountTxn ve amountBase 0'dan buyuk olmali.`
            )
          );
          return;
        }

        const lineOffsetAccountRaw = normalizeText(line.offsetAccountId);
        const lineOffsetAccountId = lineOffsetAccountRaw
          ? toPositiveInt(lineOffsetAccountRaw)
          : null;
        if (lineOffsetAccountRaw && !lineOffsetAccountId) {
          setPostError(
            l(
              `Line ${index + 1}: offset account is invalid.`,
              `Satir ${index + 1}: karsi hesap gecersiz.`
            )
          );
          return;
        }

        totalTxn = Number((totalTxn + lineAmountTxn).toFixed(6));
        totalBase = Number((totalBase + lineAmountBase).toFixed(6));
        postingLines.push({
          amountTxn: lineAmountTxn,
          amountBase: lineAmountBase,
          offsetAccountId: lineOffsetAccountId || null,
          description: normalizeText(line.description).slice(0, 255) || null,
        });
      }

      if (
        !amountsMatch(totalTxn, selectedDocumentAmountTxn) ||
        !amountsMatch(totalBase, selectedDocumentAmountBase)
      ) {
        setPostError(
          l(
            `Line totals must match draft totals. Draft txn/base: ${selectedDocumentAmountTxn} / ${selectedDocumentAmountBase}. Entered txn/base: ${totalTxn} / ${totalBase}.`,
            `Satir toplamlari taslak toplamlariyla eslesmelidir. Taslak txn/base: ${selectedDocumentAmountTxn} / ${selectedDocumentAmountBase}. Girilen txn/base: ${totalTxn} / ${totalBase}.`
          )
        );
        return;
      }

      payload.postingLines = postingLines;
    }

    setPostSaving(true);
    setPostError("");
    setPostTransferGuidance(null);
    setPostMessage("");
    try {
      const response = await postCariDocument(selectedDocumentId, payload);
      setPostMessage(
        l(
          `Draft posted. postedJournalEntryId=${response?.row?.postedJournalEntryId || response?.journal?.journalEntryId || "-"}`,
          `Taslak kayda alindi. postedJournalEntryId=${response?.row?.postedJournalEntryId || response?.journal?.journalEntryId || "-"}`
        )
      );
      setSelectedDetail(response?.row || null);
      setPostTransferGuidance(null);
      await loadDocuments(filters);
      await loadDocumentDetail(selectedDocumentId);
    } catch (error) {
      setPostTransferGuidance(extractTransferRequiredGuidanceFromError(error));
      setPostError(
        normalizeApiError(error, l("Failed to post draft document.", "Belge taslagi kayda alinamadi."))
      );
    } finally {
      setPostSaving(false);
    }
  }

  async function handleReversePosted() {
    if (!selectedDocumentId || !canReverseSelected) {
      setReverseError(
        l(
          "Only POSTED documents or immediate-cash SETTLED documents can be reversed with cari.doc.reverse permission.",
          "Yalnizca POSTED belgeler veya IMMEDIATE_CASH SETTLED belgeler `cari.doc.reverse` yetkisiyle terslenebilir."
        )
      );
      return;
    }
    setReverseSaving(true);
    setReverseError("");
    setReverseMessage("");
    setReverseInventoryBlocks([]);
    try {
      const response = await reverseCariDocument(selectedDocumentId, {
        reason: String(reverseForm.reason || "").trim() || l("Manual reversal", "Manuel ters kayit"),
        reversalDate: String(reverseForm.reversalDate || "").trim() || undefined,
      });
      setReverseResult({
        reversalDocumentId: response?.row?.id || null,
        reversalDocumentNo: response?.row?.documentNo || null,
        reversalJournalEntryId: response?.journal?.reversalJournalEntryId || null,
      });
      setReverseMessage(
        l(
          `Reverse completed. reversalDocumentId=${response?.row?.id || "-"}`,
          `Ters kayit tamamlandi. reversalDocumentId=${response?.row?.id || "-"}`
        )
      );
      setReverseInventoryBlocks([]);
      await loadDocuments(filters);
      await loadDocumentDetail(selectedDocumentId);
    } catch (error) {
      setReverseInventoryBlocks(normalizeInventoryReverseBlocks(error));
      setReverseError(
        normalizeApiError(error, l("Failed to reverse document.", "Belge terslenemedi."))
      );
    } finally {
      setReverseSaving(false);
    }
  }

  function handleExportDocumentListCsv() {
    setListError("");
    const exported = exportRowsAsCsv({
      rows,
      columns: DOCUMENT_EXPORT_COLUMNS,
      fileName: `cari-documents-${todayIsoDate()}.csv`,
    });
    if (!exported) {
      setListError(
        l(
          "CSV export is only available in browser sessions.",
          "CSV disa aktarma yalnizca tarayici oturumlarinda kullanilabilir."
        )
      );
    }
  }

  function handleCloneSelectedDocumentToCreateForm() {
    if (!selectedSnapshot) {
      setDraftTemplatesError(
        l(
          "Select a document first to clone into draft form.",
          "Taslak forma kopyalamak icin once bir belge secin."
        )
      );
      return;
    }
    const nextForm = buildCloneDraftFormFromRow(selectedSnapshot, createForm);
    applyCreateDraftFormSnapshot(nextForm);
    setDraftTemplatesError("");
    setDraftTemplatesMessage(
      l(
        `Draft form cloned from document id=${selectedSnapshot?.id || "-"}`,
        `Taslak form belge id=${selectedSnapshot?.id || "-"} kaydindan kopyalandi.`
      )
    );
  }

  async function loadDocumentDraftTemplates(options = {}) {
    if (!canCreate) {
      setDraftTemplates([]);
      setSelectedDraftTemplateId("");
      setDraftTemplatesLoading(false);
      return;
    }
    const preferredId = toPositiveInt(options.preferredId);
    setDraftTemplatesLoading(true);
    setDraftTemplatesError("");
    try {
      const response = await listMeSavedViews({
        moduleCode: DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE,
      });
      const nextRows = Array.isArray(response?.rows) ? response.rows : [];
      setDraftTemplates(nextRows);
      setSelectedDraftTemplateId((current) => {
        const currentId = toPositiveInt(current);
        if (preferredId && nextRows.some((row) => Number(row?.id) === preferredId)) {
          return String(preferredId);
        }
        if (currentId && nextRows.some((row) => Number(row?.id) === currentId)) {
          return String(currentId);
        }
        return nextRows[0]?.id ? String(nextRows[0].id) : "";
      });
    } catch (error) {
      setDraftTemplates([]);
      setSelectedDraftTemplateId("");
      setDraftTemplatesError(
        normalizeApiError(error, l("Failed to load draft templates.", "Taslak sablonlari yuklenemedi."))
      );
    } finally {
      setDraftTemplatesLoading(false);
    }
  }

  function applyDocumentDraftTemplate(templateRow, options = {}) {
    const targetTemplate = templateRow && typeof templateRow === "object" ? templateRow : null;
    if (!targetTemplate) {
      setDraftTemplatesError(l("Draft template not found.", "Taslak sablon bulunamadi."));
      return;
    }
    const resolved = resolveDocumentDraftTemplateState(targetTemplate);
    applyCreateDraftFormSnapshot(resolved.draftForm);
    setCreateRecurringRule(resolved.recurringRule);
    setSelectedDraftTemplateId(String(targetTemplate.id));
    if (!options.silent) {
      setDraftTemplatesError("");
      setDraftTemplatesMessage(
        l(
          `Draft template applied: ${targetTemplate.name || targetTemplate.id}`,
          `Taslak sablon uygulandi: ${targetTemplate.name || targetTemplate.id}`
        )
      );
    }
  }

  async function handleCreateDocumentDraftTemplate() {
    const rawName = window.prompt(l("Recurring template name", "Tekrarlayan sablon adi"), "");
    const name = String(rawName || "").trim();
    if (!name) {
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      const response = await createMeSavedView({
        moduleCode: DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE,
        name,
        definition: buildDocumentDraftTemplateDefinition({
          form: createForm,
          recurringRule: createRecurringRule,
        }),
      });
      const createdId = toPositiveInt(response?.row?.id);
      await loadDocumentDraftTemplates({ preferredId: createdId });
      setDraftTemplatesMessage(
        l(`Recurring template created: ${name}`, `Tekrarlayan sablon olusturuldu: ${name}`)
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l("Failed to create recurring draft template.", "Tekrarlayan taslak sablon olusturulamadi.")
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }

  async function handleUpdateDocumentDraftTemplate() {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError(
        l("Select a recurring template to update.", "Guncellemek icin tekrarlayan bir sablon secin.")
      );
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      await updateMeSavedView(templateId, {
        definition: buildDocumentDraftTemplateDefinition({
          form: createForm,
          recurringRule: createRecurringRule,
        }),
      });
      await loadDocumentDraftTemplates({ preferredId: templateId });
      setDraftTemplatesMessage(
        l(
          `Recurring template updated: ${selectedDraftTemplate?.name || templateId}`,
          `Tekrarlayan sablon guncellendi: ${selectedDraftTemplate?.name || templateId}`
        )
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l("Failed to update recurring draft template.", "Tekrarlayan taslak sablon guncellenemedi.")
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }

  async function handleSetDefaultDocumentDraftTemplate() {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError(
        l(
          "Select a recurring template to set as default.",
          "Varsayilan yapmak icin tekrarlayan bir sablon secin."
        )
      );
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      await updateMeSavedView(templateId, { isDefault: true });
      await loadDocumentDraftTemplates({ preferredId: templateId });
      setDraftTemplatesMessage(
        l("Recurring template set as default.", "Tekrarlayan sablon varsayilan yapildi.")
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l(
            "Failed to set recurring draft template as default.",
            "Tekrarlayan taslak sablon varsayilan yapilamadi."
          )
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }

  async function handleDeleteDocumentDraftTemplate() {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError(
        l("Select a recurring template to delete.", "Silmek icin tekrarlayan bir sablon secin.")
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        `Delete recurring template "${selectedDraftTemplate?.name || templateId}"?`,
        `"${selectedDraftTemplate?.name || templateId}" tekrarlayan sablonu silinsin mi?`
      )
    );
    if (!confirmed) {
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      await deleteMeSavedView(templateId);
      await loadDocumentDraftTemplates();
      setDraftTemplatesMessage(l("Recurring template deleted.", "Tekrarlayan sablon silindi."));
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l("Failed to delete recurring draft template.", "Tekrarlayan taslak sablon silinemedi.")
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }

  async function loadDocumentSavedViews(options = {}) {
    if (!canRead) {
      setSavedViews([]);
      setSelectedSavedViewId("");
      setSavedViewsLoading(false);
      return;
    }
    const preferredId = toPositiveInt(options.preferredId);
    setSavedViewsLoading(true);
    setSavedViewsError("");
    try {
      const response = await listMeSavedViews({
        moduleCode: DOCUMENT_SAVED_VIEW_MODULE_CODE,
      });
      const nextRows = Array.isArray(response?.rows) ? response.rows : [];
      setSavedViews(nextRows);
      setSelectedSavedViewId((current) => {
        const currentId = toPositiveInt(current);
        if (preferredId && nextRows.some((row) => Number(row?.id) === preferredId)) {
          return String(preferredId);
        }
        if (currentId && nextRows.some((row) => Number(row?.id) === currentId)) {
          return String(currentId);
        }
        return nextRows[0]?.id ? String(nextRows[0].id) : "";
      });
    } catch (error) {
      setSavedViews([]);
      setSelectedSavedViewId("");
      setSavedViewsError(
        normalizeApiError(error, l("Failed to load saved views.", "Kayitli gorunumler yuklenemedi."))
      );
    } finally {
      setSavedViewsLoading(false);
    }
  }

  function applyDocumentSavedView(savedView, options = {}) {
    const targetView = savedView && typeof savedView === "object" ? savedView : null;
    if (!targetView) {
      setSavedViewsError(l("Saved view not found.", "Kayitli gorunum bulunamadi."));
      return;
    }
    const resolvedState = resolveDocumentSavedViewState(
      targetView,
      documentTableColumnIds
    );
    setFilters(resolvedState.filters);
    setDocumentTablePrefs((previous) => ({
      ...previous,
      ...resolvedState.tablePrefs,
    }));
    setDocumentListPage(1);
    setSelectedSavedViewId(String(targetView.id));
    if (!options.silent) {
      setSavedViewsMessage(
        l(
          `Saved view applied: ${targetView.name || targetView.id}`,
          `Kayitli gorunum uygulandi: ${targetView.name || targetView.id}`
        )
      );
      setSavedViewsError("");
    }
  }

  async function handleCreateDocumentSavedView() {
    const rawName = window.prompt(l("Saved view name", "Kayitli gorunum adi"), "");
    const name = String(rawName || "").trim();
    if (!name) {
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      const response = await createMeSavedView({
        moduleCode: DOCUMENT_SAVED_VIEW_MODULE_CODE,
        name,
        definition: buildDocumentSavedViewDefinition({
          filters,
          tablePrefs: documentTablePrefs,
          columnIds: documentTableColumnIds,
        }),
      });
      const createdId = toPositiveInt(response?.row?.id);
      await loadDocumentSavedViews({ preferredId: createdId });
      setSavedViewsMessage(
        l(`Saved view created: ${name}`, `Kayitli gorunum olusturuldu: ${name}`)
      );
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(error, l("Failed to create saved view.", "Kayitli gorunum olusturulamadi."))
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleUpdateDocumentSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        l("Select a saved view to update.", "Guncellemek icin bir kayitli gorunum secin.")
      );
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await updateMeSavedView(savedViewId, {
        definition: buildDocumentSavedViewDefinition({
          filters,
          tablePrefs: documentTablePrefs,
          columnIds: documentTableColumnIds,
        }),
      });
      await loadDocumentSavedViews({ preferredId: savedViewId });
      setSavedViewsMessage(
        l(
          `Saved view updated: ${selectedSavedView?.name || savedViewId}`,
          `Kayitli gorunum guncellendi: ${selectedSavedView?.name || savedViewId}`
        )
      );
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(error, l("Failed to update saved view.", "Kayitli gorunum guncellenemedi."))
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleSetDefaultDocumentSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        l(
          "Select a saved view to set as default.",
          "Varsayilan yapmak icin bir kayitli gorunum secin."
        )
      );
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await updateMeSavedView(savedViewId, { isDefault: true });
      await loadDocumentSavedViews({ preferredId: savedViewId });
      setSavedViewsMessage(
        l(
          `Saved view marked as default: ${selectedSavedView?.name || savedViewId}`,
          `Kayitli gorunum varsayilan yapildi: ${selectedSavedView?.name || savedViewId}`
        )
      );
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(error, l("Failed to set default saved view.", "Varsayilan kayitli gorunum ayarlanamadi."))
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleDeleteDocumentSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        l("Select a saved view to delete.", "Silmek icin bir kayitli gorunum secin.")
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        `Delete saved view "${selectedSavedView?.name || savedViewId}"?`,
        `"${selectedSavedView?.name || savedViewId}" kayitli gorunumu silinsin mi?`
      )
    );
    if (!confirmed) {
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await deleteMeSavedView(savedViewId);
      await loadDocumentSavedViews();
      setSavedViewsMessage(l("Saved view deleted.", "Kayitli gorunum silindi."));
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(error, l("Failed to delete saved view.", "Kayitli gorunum silinemedi."))
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }

  function handleDocumentTableRowsPerPageChange(value) {
    const nextRowsPerPage = toPositiveInt(value);
    if (!nextRowsPerPage) {
      return;
    }
    setDocumentTablePrefs((previous) => ({
      ...previous,
      rowsPerPage: nextRowsPerPage,
    }));
    setDocumentListPage(1);
  }

  function handleDocumentTableStickyHeaderChange(nextValue) {
    setDocumentTablePrefs((previous) => ({
      ...previous,
      stickyHeader: Boolean(nextValue),
    }));
  }

  function handleDocumentTableToggleColumn(columnId) {
    const normalizedId = String(columnId || "").trim();
    if (!normalizedId) {
      return;
    }
    setDocumentTablePrefs((previous) => {
      const currentVisibleIds = Array.isArray(previous?.visibleColumnIds)
        ? previous.visibleColumnIds
        : [];
      const hasColumn = currentVisibleIds.includes(normalizedId);
      if (hasColumn && currentVisibleIds.length <= 1) {
        return previous;
      }
      return {
        ...previous,
        visibleColumnIds: hasColumn
          ? currentVisibleIds.filter((id) => id !== normalizedId)
          : [...currentVisibleIds, normalizedId],
      };
    });
  }

  function handleDocumentTableSelectAllColumns() {
    setDocumentTablePrefs((previous) => ({
      ...previous,
      visibleColumnIds: documentTableColumnIds,
    }));
  }

  function handleDocumentTableResetPrefs() {
    resetDocumentTablePrefs({
      rowsPerPage: DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
      stickyHeader: false,
      visibleColumnIds: documentTableColumnIds,
    });
    setDocumentListPage(1);
  }

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Missing permission: `cari.doc.read`
      </div>
    );
  }

  const quickCreateScope = normalizeText(quickCreateFixedAssetForm.scope).toLowerCase();
  const quickCreateSourceForm = quickCreateScope === "edit" ? editForm : createForm;
  const quickCreateCategoryOptions =
    quickCreateScope === "edit"
      ? editFixedAssetCategoryOptions
      : createFixedAssetCategoryOptions;
  const quickCreateCategoriesById =
    quickCreateScope === "edit"
      ? editFixedAssetCategoriesById
      : createFixedAssetCategoriesById;
  const quickCreateOperatingUnitOptions =
    quickCreateScope === "edit"
      ? editFixedAssetOperatingUnitOptions
      : createFixedAssetOperatingUnitOptions;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {documentPageTitle}
        </h1>
        {listError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{listError}</div> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox
                className="mt-1"
                value={filters.legalEntityId}
                options={filterLegalEntityLookupOptions}
                loading={filterLegalEntityLookupLoading}
                placeholder={
                  filterLegalEntityLookupOptions.length > 0
                    ? l("Search legal entity code/name", "Tuzel kisilik kodu/adi ara")
                    : l("No legal entities available", "Kullanilabilir tuzel kisilik yok")
                }
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(nextValue) => handleFilterLegalEntityChange(nextValue)}
              />
            </label>
            {workingContextError ? (
              <p className="mt-1 text-[11px] normal-case text-amber-700">
                {workingContextError}
              </p>
            ) : null}
          </div>
          {!hasFixedRouteDirection ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Direction", "Yon")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.direction}
                onChange={(event) => handleFilterDirectionChange(event.target.value)}
              >
                <option value="">{l("ALL", "TUMU")}</option>
                {DOCUMENT_DIRECTIONS.map((entryDirection) => (
                  <option key={`filter-direction-${entryDirection}`} value={entryDirection}>
                    {entryDirection}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canReadOrgTree ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              <label className="block">
                {l("Operating Unit", "Operasyon Birimi")}
                <Combobox
                  className="mt-1"
                  value={filters.operatingUnitId}
                  options={filterOperatingUnitLookupOptions}
                  loading={filterOperatingUnitLoading}
                  disabled={!toPositiveInt(filters.legalEntityId)}
                  placeholder={
                    toPositiveInt(filters.legalEntityId)
                      ? l("Search operating unit code/name", "Operasyon birimi kodu/adi ara")
                      : l("Select legal entity first", "Once tuzel kisilik secin")
                  }
                  noOptionsText={
                    toPositiveInt(filters.legalEntityId)
                      ? l("No operating units found.", "Operasyon birimi bulunamadi.")
                      : l("Select legal entity first.", "Once tuzel kisilik secin.")
                  }
                  onChange={(nextValue) =>
                    setFilters((prev) => ({
                      ...prev,
                      operatingUnitId: nextValue ? String(nextValue) : "",
                    }))
                  }
                />
              </label>
              {filterOperatingUnitError ? (
                <p className="mt-1 text-[11px] normal-case text-amber-700">
                  {filterOperatingUnitError}
                </p>
              ) : null}
            </div>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Operating Unit ID", "Operasyon Birimi ID")}<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.operatingUnitId} onChange={(event) => setFilters((prev) => ({ ...prev, operatingUnitId: event.target.value }))} /></label>
          )}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Counterparty ID", "Cari ID")}<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.counterpartyId} onChange={(event) => setFilters((prev) => ({ ...prev, counterpartyId: event.target.value }))} /></label>
          {canReadCards ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Counterparty Lookup", "Cari Arama")}
              <Combobox
                className="mt-1"
                value={filters.counterpartyId}
                options={filterCounterpartyLookupOptions}
                loading={filterCounterpartyLoading}
                disabled={!toPositiveInt(filters.legalEntityId)}
                placeholder={toPositiveInt(filters.legalEntityId) ? l("Type code/name", "Kod/ad yazin") : l("Select legal entity first", "Once tuzel kisilik secin")}
                noOptionsText={toPositiveInt(filters.legalEntityId) ? l("No counterparties found.", "Cari bulunamadi.") : l("Set legalEntityId to load counterparties.", "Carileri yuklemek icin legalEntityId secin.")}
                onChange={(nextValue) =>
                  setFilters((prev) => ({
                    ...prev,
                    counterpartyId: nextValue ? String(nextValue) : "",
                  }))
                }
              />
            </label>
          ) : null}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Document Type", "Belge Turu")}<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.documentType} onChange={(event) => setFilters((prev) => ({ ...prev, documentType: event.target.value }))}><option value="">{l("ALL", "TUMU")}</option>{DOCUMENT_TYPES.map((documentType) => <option key={`filter-document-type-${documentType}`} value={documentType}>{documentType}</option>)}</select></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Status", "Durum")}<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}><option value="">{l("ALL", "TUMU")}</option>{DOCUMENT_STATUSES.map((status) => <option key={`filter-status-${status}`} value={status}>{status}</option>)}</select></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Date From", "Baslangic Tarihi")}<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} /></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Date To", "Bitis Tarihi")}<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} /></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Search", "Ara")}<input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} placeholder={l("documentNo / counterparty snapshot", "documentNo / cari ozet")} /></label>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => loadDocuments(filters)} disabled={listLoading}>{listLoading ? l("Loading...", "Yukleniyor...") : l("Refresh List", "Listeyi Yenile")}</button>
          <button type="button" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700" onClick={resetFilters} disabled={listLoading}>{l("Reset Filters", "Filtreleri Sifirla")}</button>
          <button
            type="button"
            className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 disabled:opacity-60"
            onClick={handleExportDocumentListCsv}
            disabled={listLoading || rows.length === 0}
          >
            {l("Export CSV", "CSV Disa Aktar")}
          </button>
        </div>
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Saved Views (server-side)", "Kayitli Gorunumler (sunucu)")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={selectedSavedViewId}
              onChange={(event) => setSelectedSavedViewId(event.target.value)}
              disabled={savedViewsLoading || savedViewsSaving || savedViews.length === 0}
            >
              <option value="">{l("Select saved view", "Kayitli gorunum secin")}</option>
              {savedViews.map((row) => (
                <option key={`document-saved-view-${row.id}`} value={row.id}>
                  {row.name}
                  {row.isDefault ? l(" (default)", " (varsayilan)") : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => applyDocumentSavedView(selectedSavedView)}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              {l("Apply", "Uygula")}
            </button>
            <button
              type="button"
              className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
              onClick={handleCreateDocumentSavedView}
              disabled={savedViewsSaving}
            >
              {l("Save Current", "Mevcutu Kaydet")}
            </button>
            <button
              type="button"
              className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
              onClick={handleUpdateDocumentSavedView}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              {l("Update Selected", "Secileni Guncelle")}
            </button>
            <button
              type="button"
              className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
              onClick={handleSetDefaultDocumentSavedView}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              {l("Set Default", "Varsayilan Yap")}
            </button>
            <button
              type="button"
              className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
              onClick={handleDeleteDocumentSavedView}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              {l("Delete", "Sil")}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => loadDocumentSavedViews({ preferredId: selectedSavedViewId })}
              disabled={savedViewsLoading || savedViewsSaving}
            >
              {savedViewsLoading
                ? l("Loading...", "Yukleniyor...")
                : l("Refresh Saved Views", "Kayitli Gorunumleri Yenile")}
            </button>
          </div>
          {savedViewsError ? (
            <p className="mt-2 text-xs text-rose-700">{savedViewsError}</p>
          ) : null}
          {savedViewsMessage ? (
            <p className="mt-2 text-xs text-emerald-700">{savedViewsMessage}</p>
          ) : null}
        </div>
      </section>

      {canCreate ? (
        <section
          id="create-draft-document"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {createDraftDocumentTitle}
          </h2>
          {createValidationSummary ? (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {createValidationSummary}
            </div>
          ) : null}
          {createError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{createError}</div> : null}
          {createMessage ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{createMessage}</div> : null}
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Clone + Recurring Templates", "Kopyala + Tekrarlayan Sablonlar")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={handleCloneSelectedDocumentToCreateForm}
                disabled={!selectedSnapshot || createSaving}
              >
                {l("Clone Selected Document", "Secili Belgeyi Kopyala")}
              </button>
              <select
                className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={selectedDraftTemplateId}
                onChange={(event) => setSelectedDraftTemplateId(event.target.value)}
                disabled={
                  draftTemplatesLoading ||
                  draftTemplatesSaving ||
                  draftTemplates.length === 0 ||
                  createSaving
                }
              >
                <option value="">{l("Select recurring template", "Tekrarlayan sablon secin")}</option>
                {draftTemplates.map((row) => (
                  <option key={`document-draft-template-${row.id}`} value={row.id}>
                    {row.name}
                    {row.isDefault ? l(" (default)", " (varsayilan)") : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() => applyDocumentDraftTemplate(selectedDraftTemplate)}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                {l("Apply Template", "Sablonu Uygula")}
              </button>
              <button
                type="button"
                className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                onClick={handleCreateDocumentDraftTemplate}
                disabled={draftTemplatesSaving || createSaving}
              >
                {l("Save Current Template", "Mevcut Sablonu Kaydet")}
              </button>
              <button
                type="button"
                className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
                onClick={handleUpdateDocumentDraftTemplate}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                {l("Update Template", "Sablonu Guncelle")}
              </button>
              <button
                type="button"
                className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                onClick={handleSetDefaultDocumentDraftTemplate}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                {l("Set Default", "Varsayilan Yap")}
              </button>
              <button
                type="button"
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                onClick={handleDeleteDocumentDraftTemplate}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                {l("Delete", "Sil")}
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() =>
                  loadDocumentDraftTemplates({ preferredId: selectedDraftTemplateId })
                }
                disabled={draftTemplatesLoading || draftTemplatesSaving || createSaving}
              >
                {draftTemplatesLoading
                  ? l("Loading...", "Yukleniyor...")
                  : l("Refresh Templates", "Sablonlari Yenile")}
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Recurring Cadence", "Tekrar Araligi")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={createRecurringRule.cadence}
                  onChange={(event) =>
                    setCreateRecurringRule((prev) => ({
                      ...prev,
                      cadence: normalizeRecurringCadence(event.target.value),
                    }))
                  }
                  disabled={createSaving}
                >
                  {DOCUMENT_RECURRING_TEMPLATE_CADENCES.map((cadence) => (
                    <option key={`create-recurring-cadence-${cadence}`} value={cadence}>
                      {cadence}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Repeat Every", "Her Tekrar")}
                <input
                  type="number"
                  min="1"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={createRecurringRule.interval}
                  onChange={(event) =>
                    setCreateRecurringRule((prev) => ({
                      ...prev,
                      interval: normalizeRecurringInterval(event.target.value),
                    }))
                  }
                  disabled={createSaving}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Anchor Day (optional)", "Sabit Gun (opsiyonel)")}
                <input
                  type="number"
                  min="1"
                  max="31"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={createRecurringRule.anchorDay}
                  onChange={(event) =>
                    setCreateRecurringRule((prev) => ({
                      ...prev,
                      anchorDay: normalizeRecurringAnchorDay(event.target.value),
                    }))
                  }
                  disabled={createSaving}
                />
              </label>
            </div>
            {draftTemplatesError ? (
              <p className="mt-2 text-xs text-rose-700">{draftTemplatesError}</p>
            ) : null}
            {draftTemplatesMessage ? (
              <p className="mt-2 text-xs text-emerald-700">{draftTemplatesMessage}</p>
            ) : null}
          </div>
          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={handleCreateDraft}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              <label className="block">
                {l("Legal Entity", "Tuzel Kisilik")}
                <Combobox
                  className="mt-1"
                  value={createForm.legalEntityId}
                  options={createLegalEntityLookupOptions}
                  loading={createLegalEntityLookupLoading}
                  disabled={createSaving || createLegalEntityLookupOptions.length === 0}
                  placeholder={
                    createLegalEntityLookupOptions.length > 0
                      ? l("Search legal entity code/name", "Tuzel kisilik kodu/adi ara")
                      : l("No legal entities available", "Kullanilabilir tuzel kisilik yok")
                  }
                  noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                  onChange={(nextValue) => handleCreateLegalEntityChange(nextValue)}
                />
              </label>
              {workingContextError ? (
                <p className="mt-1 text-[11px] normal-case text-amber-700">
                  {workingContextError}
                </p>
              ) : null}
            </div>
            {canReadOrgTree ? (
              createOperatingUnitDerivedFromCounterpartyPrimary ? (
                <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-950">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                    {l("Operating Unit", "Operasyon Birimi")}
                  </p>
                  <p className="mt-1 font-semibold">
                    {selectedCreateCounterpartyPrimaryOperatingUnitLabel}
                  </p>
                  <p className="mt-1 text-xs text-cyan-900">
                    {l(
                      "This counterparty has a primary operating unit. The document will use it automatically unless you choose another operating unit.",
                      "Bu carinin bir birincil operasyon birimi var. Siz baska bir operasyon birimi secmedikce belge bunu otomatik kullanir."
                    )}
                  </p>
                  <button
                    type="button"
                    className="mt-3 rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-900 disabled:opacity-60"
                    onClick={() => setCreateOperatingUnitOverrideOpen(true)}
                    disabled={createSaving || !toPositiveInt(createForm.legalEntityId)}
                  >
                    {l("Choose another operating unit", "Baska operasyon birimi sec")}
                  </button>
                </div>
              ) : (
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <label className="block">
                    {l("Operating Unit (optional)", "Operasyon Birimi (opsiyonel)")}
                    <Combobox
                      className="mt-1"
                      value={createForm.operatingUnitId}
                      options={createOperatingUnitLookupOptions}
                      loading={createOperatingUnitsLoading}
                      disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                      placeholder={
                        toPositiveInt(createForm.legalEntityId)
                          ? l("Search operating unit code/name", "Operasyon birimi kodu/adi ara")
                          : l("Select legal entity first", "Once tuzel kisilik secin")
                      }
                      noOptionsText={
                        toPositiveInt(createForm.legalEntityId)
                          ? l("No operating units found.", "Operasyon birimi bulunamadi.")
                          : l("Select legal entity first.", "Once tuzel kisilik secin.")
                      }
                      onChange={(nextValue) => {
                        const normalizedOperatingUnitId = nextValue ? String(nextValue) : "";
                        setCreateForm((prev) => ({
                          ...prev,
                          operatingUnitId: normalizedOperatingUnitId,
                        }));
                        setCreateOperatingUnitOverrideOpen(
                          Boolean(
                            normalizedOperatingUnitId &&
                              normalizedOperatingUnitId !==
                                selectedCreateCounterpartyPrimaryOperatingUnitId
                          )
                        );
                      }}
                    />
                  </label>
                  {selectedCreateCounterpartyPrimaryOperatingUnitId ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 normal-case text-[11px] text-slate-600">
                      <span>
                        {l("Counterparty primary operating unit:", "Cari birincil operasyon birimi:")}{" "}
                        <span className="font-semibold text-slate-800">
                          {selectedCreateCounterpartyPrimaryOperatingUnitLabel}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="font-semibold text-slate-700 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                        onClick={() => {
                          setCreateForm((prev) => ({ ...prev, operatingUnitId: "" }));
                          setCreateOperatingUnitOverrideOpen(false);
                        }}
                        disabled={createSaving}
                      >
                        {l("Use counterparty default", "Cari varsayilanini kullan")}
                      </button>
                    </div>
                  ) : null}
                  {createOperatingUnitsError ? (
                    <p className="mt-1 text-[11px] normal-case text-amber-700">
                      {createOperatingUnitsError}
                    </p>
                  ) : null}
                </div>
              )
            ) : (
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Operating Unit ID (optional)", "Operasyon Birimi ID (opsiyonel)")}
                <input
                  type="number"
                  min="1"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={createForm.operatingUnitId}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      operatingUnitId: event.target.value,
                    }))
                  }
                  disabled={createSaving}
                />
              </label>
            )}
            {!hasFixedRouteDirection ? (
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Direction", "Yon")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={createForm.direction}
                  onChange={(event) => handleCreateDirectionChange(event.target.value)}
                  required
                >
                  {DOCUMENT_DIRECTIONS.map((entryDirection) => (
                    <option key={`create-direction-${entryDirection}`} value={entryDirection}>
                      {entryDirection}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {canReadCards ? (
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  {l("Counterparty", "Cari")}
                  <Combobox
                    className="mt-1"
                    value={createForm.counterpartyId}
                    options={createCounterpartyLookupOptions}
                    loading={createCounterpartyLoading}
                    disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                    placeholder={
                      toPositiveInt(createForm.legalEntityId)
                        ? l("Search counterparty code/name", "Cari kodu/adi ara")
                        : l("Select legal entity first", "Once tuzel kisilik secin")
                    }
                    noOptionsText={
                      toPositiveInt(createForm.legalEntityId)
                        ? l("No counterparties found.", "Cari bulunamadi.")
                        : l("Select legal entity first.", "Once tuzel kisilik secin.")
                    }
                    onInputChange={(nextValue, meta) => {
                      setCreateInlineCounterpartyError("");
                      setCreateInlineCounterpartyMessage("");
                      const reason = String(meta?.reason || "").trim().toLowerCase();
                      if (reason === "select" || reason === "clear") {
                        setCreateCounterpartyLookupQuery("");
                        return;
                      }
                      setCreateCounterpartyLookupQuery(normalizeLookupQuery(nextValue));
                    }}
                    onChange={(nextValue) =>
                      setCreateForm((prev) => {
                        const normalizedCounterpartyId = nextValue ? String(nextValue) : "";
                        if (normalizeText(prev.counterpartyId) === normalizedCounterpartyId) {
                          return prev;
                        }
                        return {
                          ...prev,
                          counterpartyId: normalizedCounterpartyId,
                          operatingUnitId: "",
                        };
                      })
                    }
                  />
                </label>
                {canUpsertCards ? (
                  <button
                    type="button"
                    className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case text-slate-700 disabled:opacity-60"
                    onClick={handleInlineCreateCounterpartyForCreateForm}
                    disabled={!canInlineCreateCounterpartyInCreateForm || createInlineCounterpartySaving || createSaving}
                  >
                    {createInlineCounterpartySaving
                      ? l("Creating counterparty...", "Cari olusturuluyor...")
                      : l(
                          `Create "${createInlineCounterpartyName || "new counterparty"}"`,
                          `"${createInlineCounterpartyName || "yeni cari"}" olustur`
                        )}
                  </button>
                ) : null}
                {createInlineCounterpartyError ? (
                  <p className="mt-1 text-[11px] normal-case text-rose-700">{createInlineCounterpartyError}</p>
                ) : null}
                {createInlineCounterpartyMessage ? (
                  <p className="mt-1 text-[11px] normal-case text-emerald-700">{createInlineCounterpartyMessage}</p>
                ) : null}
              </div>
            ) : (
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Counterparty ID", "Cari ID")}
                <input
                  type="number"
                  min="1"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={createForm.counterpartyId}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      counterpartyId: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            )}
            {canReadCards ? (
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  {l("Payment Term (optional)", "Odeme Kosulu (opsiyonel)")}
                  <Combobox
                    className="mt-1"
                    value={createForm.paymentTermId}
                    options={createPaymentTermLookupOptions}
                    loading={createPaymentTermsLoading}
                    disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                    placeholder={
                      toPositiveInt(createForm.legalEntityId)
                        ? l("Search payment term code/name", "Odeme kosulu kodu/adi ara")
                        : l("Select legal entity first", "Once tuzel kisilik secin")
                    }
                    noOptionsText={
                      toPositiveInt(createForm.legalEntityId)
                        ? l("No payment terms found.", "Odeme kosulu bulunamadi.")
                        : l("Select legal entity first.", "Once tuzel kisilik secin.")
                    }
                    onChange={(nextValue) => {
                      setCreatePaymentTermTouched(true);
                      setCreateForm((prev) => ({
                        ...prev,
                        paymentTermId: nextValue ? String(nextValue) : "",
                      }));
                    }}
                  />
                </label>
                {createPaymentTermsError ? (
                  <p className="mt-1 text-[11px] normal-case text-amber-700">
                    {createPaymentTermsError}
                  </p>
                ) : null}
              </div>
            ) : (
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Payment Term ID (optional)", "Odeme Kosulu ID (opsiyonel)")}
                <input
                  type="number"
                  min="1"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={createForm.paymentTermId}
                  onChange={(event) => {
                    setCreatePaymentTermTouched(true);
                    setCreateForm((prev) => ({ ...prev, paymentTermId: event.target.value }));
                  }}
                />
              </label>
            )}
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Document Type", "Belge Turu")}<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.documentType} onChange={(event) => setCreateForm((prev) => ({ ...prev, documentType: event.target.value }))} required>{DOCUMENT_TYPES.map((documentType) => <option key={`create-document-type-${documentType}`} value={documentType}>{documentType}</option>)}</select></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Document Date", "Belge Tarihi")}<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.documentDate} onChange={(event) => setCreateForm((prev) => ({ ...prev, documentDate: event.target.value }))} required /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Due Date", "Vade Tarihi")}{" "}
              {requiresDueDate(createForm.documentType)
                ? l("(required for this type)", "(bu tur icin zorunlu)")
                : l("(optional)", "(opsiyonel)")}
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createForm.dueDate}
                onChange={(event) => {
                  const nextDueDate = event.target.value;
                  setCreateDueDateTouched(Boolean(nextDueDate));
                  setCreateForm((prev) => ({ ...prev, dueDate: nextDueDate }));
                }}
                disabled={createSaving || Boolean(createImmediateCashDueDate)}
                required={requiresDueDate(createForm.documentType)}
              />
              {createDueDateForcedByImmediateCash ? (
                <p className="mt-1 text-[11px] normal-case text-slate-500">
                  {l(
                    "Immediate cash uses the document date as the due date.",
                    "Aninda nakit tahsilat/odeme, vade tarihi olarak belge tarihini kullanir."
                  )}
                </p>
              ) : null}
              {createDueDateAutoDerived && selectedCreatePaymentTerm ? (
                <p className="mt-1 text-[11px] normal-case text-slate-500">
                  {l(
                    `Auto-filled from payment term ${selectedCreatePaymentTerm.code || selectedCreatePaymentTerm.name || `#${selectedCreatePaymentTerm.id}`}. You can still override it.`,
                    `Odeme kosulu ${selectedCreatePaymentTerm.code || selectedCreatePaymentTerm.name || `#${selectedCreatePaymentTerm.id}`} ile otomatik dolduruldu. Isterseniz yine de degistirebilirsiniz.`
                  )}
                </p>
              ) : null}
            </label>
            <div className="md:col-span-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                {l("Payment", "Odeme")}
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Mode", "Mod")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    value={normalizeDocumentSettlementMode(createForm.settlementMode)}
                    onChange={(event) => handleCreateSettlementModeChange(event.target.value)}
                    disabled={createSaving}
                  >
                    <option value="ACCRUAL">
                      {l("On Credit (Accrual)", "Vadeli (Tahakkuk)")}
                    </option>
                    <option value="IMMEDIATE_CASH">{createImmediateCashLabel}</option>
                  </select>
                </label>
                {createImmediateCashSelected ? (
                  canReadCashRegisters ? (
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Cash Register", "Kasa")}
                        <Combobox
                          className="mt-1"
                          value={createForm.settlementCashRegisterId}
                          options={createCashRegisterLookupOptions}
                          loading={createCashRegistersLoading}
                          disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                          placeholder={
                            toPositiveInt(createForm.legalEntityId)
                              ? l("Search cash register", "Kasa ara")
                              : l("Select legal entity first", "Once tuzel kisilik secin")
                          }
                          noOptionsText={
                            toPositiveInt(createForm.legalEntityId)
                              ? l("No cash registers found.", "Kasa bulunamadi.")
                              : l("Select legal entity first.", "Once tuzel kisilik secin.")
                          }
                          onChange={(nextValue) =>
                            setCreateForm((prev) => ({
                              ...prev,
                              settlementCashRegisterId: nextValue ? String(nextValue) : "",
                            }))
                          }
                        />
                      </label>
                      {createCashRegistersError ? (
                        <p className="mt-1 text-[11px] normal-case text-amber-700">
                          {createCashRegistersError}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Cash Register ID", "Kasa ID")}
                      <input
                        type="number"
                        min="1"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                        value={createForm.settlementCashRegisterId}
                        onChange={(event) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            settlementCashRegisterId: event.target.value,
                          }))
                        }
                        disabled={createSaving}
                      />
                    </label>
                  )
                ) : (
                  <p className="text-xs font-normal normal-case text-slate-500 md:self-end">
                    {l(
                      "Accrual keeps the current flow: post the document now and settle it later from CARI Settlements.",
                      "Tahakkuk mevcut akisi korur: belgeyi simdi kayda alin, sonra CARI mahsuplastirmadan kapatin."
                    )}
                  </p>
                )}
              </div>
            </div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Invoice Total (derived)", "Fatura Toplami (turetilmis)")}<input type="number" min="0.000001" step="0.000001" className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700" value={normalizeOptionalDecimalText(createDocumentFxComputation.resolvedAmountTxn)} readOnly disabled={createSaving} /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Invoice Currency", "Fatura Para Birimi")}<input type="text" maxLength={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase" value={createForm.currencyCode} onChange={(event) => {
              setCreateCurrencyTouched(true);
              setCreateForm((prev) => ({ ...prev, currencyCode: event.target.value }));
            }} required /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Base Amount (calculated)", "Baz Tutar (otomatik hesaplanir)")}<input type="number" min="0.000001" step="0.000001" className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700" value={createResolvedAmountBaseText} readOnly disabled={createSaving} /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{createDocumentFxComputation.fxRateRequired ? l("FX Rate (required)", "Kur (zorunlu)") : l("FX Rate", "Kur")}<input type="number" min="0.0000000001" step="0.0000000001" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createDocumentFxComputation.isLocalCurrency ? "1" : createForm.fxRate || ""} onChange={(event) => setCreateForm((prev) => ({ ...prev, fxRate: event.target.value }))} readOnly={createDocumentFxComputation.isLocalCurrency} required={createDocumentFxComputation.fxRateRequired} /></label>
            {createFunctionalCurrencyCode ? (
              <p className="md:col-span-4 -mt-1 text-[11px] text-slate-500">
                {createDocumentFxComputation.isLocalCurrency
                  ? l(
                      `Functional currency is ${createFunctionalCurrencyCode}. FX rate is fixed to 1 and base amount follows the invoice amount.`,
                      `Fonksiyonel para birimi ${createFunctionalCurrencyCode}. Kur 1 olarak sabitlenir ve baz tutar fatura tutarindan gelir.`
                    )
                  : l(
                      `Functional currency is ${createFunctionalCurrencyCode}. Base amount is calculated automatically from invoice amount x FX rate.`,
                      `Fonksiyonel para birimi ${createFunctionalCurrencyCode}. Baz tutar, fatura tutari x kur ile otomatik hesaplanir.`
                    )}
              </p>
            ) : null}
            <DocumentLineWorkbench
              l={l}
              title={l("Commercial Lines", "Ticari Satirlar")}
              form={createForm}
              saving={createSaving}
              currencyCode={createForm.currencyCode}
              functionalCurrencyCode={createFunctionalCurrencyCode}
              fxComputation={createDocumentFxComputation}
              canReadGlAccounts={canReadGlAccounts}
              lineAccountOptions={createLineAccountOptions}
              lineAccountsLoading={createLineAccountsLoading}
              lineAccountsError={createLineAccountsError}
              itemCardOptions={createItemCardOptions}
              itemCardsLoading={createItemCardsLoading}
              itemCardsError={createItemCardsError}
              warehouseOptions={createWarehouseOptions}
              warehouseLoading={createWarehousesLoading}
              warehouseError={createWarehousesError}
              warehouseInfoMessage={createWarehouseValidation.generalErrors[0] || ""}
              warehouseLineErrors={createWarehouseValidation.lineErrors}
              lineValidationMessages={createLineValidationMessages}
              taxCategoryOptions={createTaxCategoryOptions}
              taxCategoryLoading={taxCategoryLoading}
              taxCategoryError={taxCategoryError}
              previewLoading={createLinePreviewLoading}
              previewError={createLinePreviewError}
              previewMessage={createLinePreviewMessage}
              fixedAssetCategoryOptions={createFixedAssetCategoryOptions}
              fixedAssetCategoriesLoading={createFixedAssetCategoriesLoading}
              fixedAssetCategoriesError={createFixedAssetCategoriesError}
              fixedAssetCategoriesById={createFixedAssetCategoriesById}
              fixedAssetDraftOptions={createFixedAssetDraftOptions}
              fixedAssetDraftLoading={createFixedAssetDraftLoading}
              fixedAssetDraftError={createFixedAssetDraftError}
              fixedAssetDraftRowsById={createFixedAssetDraftRowsById}
              fixedAssetSaleOptions={createFixedAssetSaleOptions}
              fixedAssetSaleLoading={createFixedAssetSaleLoading}
              fixedAssetSaleError={createFixedAssetSaleError}
              fixedAssetSaleRowsById={createFixedAssetSaleRowsById}
              fixedAssetOperatingUnitOptions={createFixedAssetOperatingUnitOptions}
              canReadFixedAssetSettings={canReadFixedAssetSettings}
              canUpsertFixedAssetSettings={canUpsertFixedAssetSettings}
              onAddLine={addCreateDocumentLine}
              onRemoveLine={removeCreateDocumentLine}
              onMoveLine={moveCreateDocumentLine}
              onPatchLine={patchCreateDocumentLine}
              onPatchTaxSensitiveLine={patchCreateDocumentLineWithTaxReset}
              onChangeSubledgerType={changeCreateDocumentLineSubledgerType}
              onChangeFixedAssetMode={changeCreateDocumentLineFixedAssetMode}
              onSelectFixedAssetCategory={selectCreateDocumentLineFixedAssetCategory}
              onSelectTargetFixedAsset={selectCreateDocumentLineTargetFixedAsset}
              onSelectItemCard={selectCreateDocumentLineItemCard}
              onChangeStockImpactMode={changeCreateDocumentLineStockImpactMode}
              onSelectWarehouse={selectCreateDocumentLineWarehouse}
              onExpandFixedAssetLine={expandCreateDocumentLineFixedAsset}
              onOpenQuickCreateFixedAsset={openCreateQuickCreateFixedAsset}
              canQuickCreateFixedAsset={canUpsertFixedAssets}
              onPreviewAll={() => handleCreateDocumentLineTaxPreview()}
              onPreviewRow={(rowId) => handleCreateDocumentLineTaxPreview(rowId)}
            />
            <div className="md:col-span-4 flex gap-2">
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" disabled={createSaving}>{createSaving ? l("Creating...", "Olusturuluyor...") : createDraftDocumentTitle}</button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                onClick={resetCreateDraftFormWithSmartDefaults}
                disabled={createSaving}
              >
                {l("Reset Draft Form", "Taslak Formunu Sifirla")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Document List", "Belge Listesi")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {l("Total rows", "Toplam satir")}: {totalRows} |{" "}
          {l("Showing", "Gosterilen")}: {pagedDocumentRows.length} / {documentListRows.length} |{" "}
          {l("Page", "Sayfa")} {documentListPage}/{documentListTotalPages}
        </p>
        {selectedDocumentOutsideList ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {l(
              "Selected document is outside the active list filters and is shown temporarily.",
              "Secili belge aktif liste filtrelerinin disinda; gecici olarak gosteriliyor."
            )}
          </p>
        ) : null}
        <TablePreferencesPanel
          className="mt-3"
          title={l("Document table preferences", "Belge tablo tercihleri")}
          rowsPerPage={documentRowsPerPage}
          rowsPerPageOptions={DOCUMENT_TABLE_ROWS_PER_PAGE_OPTIONS}
          onRowsPerPageChange={handleDocumentTableRowsPerPageChange}
          stickyHeader={documentTablePrefs.stickyHeader}
          onStickyHeaderChange={handleDocumentTableStickyHeaderChange}
          columns={documentTableColumns.map((column) => ({
            id: column.id,
            label: column.label,
          }))}
          visibleColumnIds={documentTablePrefs.visibleColumnIds}
          onToggleColumn={handleDocumentTableToggleColumn}
          onSelectAllColumns={handleDocumentTableSelectAllColumns}
          onReset={handleDocumentTableResetPrefs}
        />
        <div className="mt-4 max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead
              className={`bg-slate-50 text-left text-slate-600 ${
                documentTablePrefs.stickyHeader ? "sticky top-0 z-10" : ""
              }`}
            >
              <tr>
                {documentVisibleColumns.map((column) => (
                  <th
                    key={`document-list-header-${column.id}`}
                    className={column.headerClassName || "px-3 py-2"}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedDocumentRows.map((row) => (
                <tr
                  key={`doc-row-${row.id}`}
                  className={`border-t border-slate-100 ${
                    row._outsideActiveFilters
                      ? "bg-amber-50"
                      : Number(row.id) === Number(selectedDocumentId)
                        ? "bg-cyan-50"
                        : "bg-white"
                  }`}
                >
                  {documentVisibleColumns.map((column) => (
                    <td
                      key={`document-list-cell-${row.id}-${column.id}`}
                      className={column.cellClassName || "px-3 py-2"}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
              {documentListRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={documentVisibleColumnCount}>
                    {listLoading
                      ? l("Loading documents...", "Belgeler yukleniyor...")
                      : l("No documents found for current filters.", "Mevcut filtreler icin belge bulunamadi.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={() => setDocumentListPage((current) => Math.max(1, current - 1))}
            disabled={documentListPage <= 1}
          >
            {l("Previous", "Onceki")}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={() =>
              setDocumentListPage((current) =>
                Math.min(documentListTotalPages, current + 1)
              )
            }
            disabled={documentListPage >= documentListTotalPages}
          >
            {l("Next", "Sonraki")}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Detail + Actions", "Detay + Islemler")}
        </h2>
        {detailError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detailError}</div> : null}
        {selectedSnapshot ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                {l("Document Detail", "Belge Detayi")}
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="font-semibold text-slate-600">documentNo</dt><dd>{selectedSnapshot.documentNo || "-"}</dd>
                <dt className="font-semibold text-slate-600">status</dt><dd>{selectedSnapshot.status || "-"}</dd>
                <dt className="font-semibold text-slate-600">operatingUnit</dt><dd>{getDocumentOperatingUnitLabel(selectedSnapshot, operatingUnitsById)}</dd>
                <dt className="font-semibold text-slate-600">postedJournalEntryId</dt><dd>{selectedSnapshot.postedJournalEntryId || "-"}</dd>
                <dt className="font-semibold text-slate-600">reversalOfDocumentId</dt><dd>{selectedSnapshot.reversalOfDocumentId || "-"}</dd>
                <dt className="font-semibold text-slate-600">counterpartyCodeSnapshot</dt><dd>{selectedSnapshot.counterpartyCodeSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">counterpartyNameSnapshot</dt><dd>{selectedSnapshot.counterpartyNameSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">dueDateSnapshot</dt><dd>{selectedSnapshot.dueDateSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">amountTxn</dt>
                <dd>
                  <MoneyText
                    amount={firstDefinedRowValue(selectedSnapshot, "amountTxn", "amount_txn")}
                    currencyCode={firstDefinedRowValue(
                      selectedSnapshot,
                      "currencyCode",
                      "currency_code",
                      "currencyCodeSnapshot",
                      "currency_code_snapshot"
                    )}
                  />
                </dd>
                <dt className="font-semibold text-slate-600">amountBase</dt>
                <dd>
                  <MoneyText
                    amount={firstDefinedRowValue(selectedSnapshot, "amountBase", "amount_base")}
                    currencyCode={selectedDocumentFunctionalCurrencyCode}
                  />
                </dd>
                <dt className="font-semibold text-slate-600">subtotalAmountTxn</dt>
                <dd>
                  <MoneyText
                    amount={firstDefinedRowValue(
                      selectedSnapshot,
                      "subtotalAmountTxn",
                      "subtotal_amount_txn"
                    )}
                    currencyCode={firstDefinedRowValue(
                      selectedSnapshot,
                      "currencyCode",
                      "currency_code",
                      "currencyCodeSnapshot",
                      "currency_code_snapshot"
                    )}
                  />
                </dd>
                <dt className="font-semibold text-slate-600">taxAmountTxn</dt>
                <dd>
                  <MoneyText
                    amount={firstDefinedRowValue(
                      selectedSnapshot,
                      "taxAmountTxn",
                      "tax_amount_txn"
                    )}
                    currencyCode={firstDefinedRowValue(
                      selectedSnapshot,
                      "currencyCode",
                      "currency_code",
                      "currencyCodeSnapshot",
                      "currency_code_snapshot"
                    )}
                  />
                </dd>
                <dt className="font-semibold text-slate-600">grossAmountTxn</dt>
                <dd>
                  <MoneyText
                    amount={firstDefinedRowValue(
                      selectedSnapshot,
                      "grossAmountTxn",
                      "gross_amount_txn"
                    )}
                    currencyCode={firstDefinedRowValue(
                      selectedSnapshot,
                      "currencyCode",
                      "currency_code",
                      "currencyCodeSnapshot",
                      "currency_code_snapshot"
                    )}
                  />
                </dd>
                <dt className="font-semibold text-slate-600">currencyCodeSnapshot</dt><dd>{selectedSnapshot.currencyCodeSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">fxRateSnapshot</dt><dd>{selectedSnapshot.fxRateSnapshot || "-"}</dd>
              </dl>
              <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  {l("Commercial lines", "Ticari satirlar")}
                </p>
                {!Array.isArray(selectedSnapshot.lines) || selectedSnapshot.lines.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {l("No stored document lines.", "Kayitli belge satiri yok.")}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedSnapshot.lines.map((line) => {
                      const isFixedAssetLine = line.subledgerType === "FIXED_ASSET";
                      const targetFixedAssetId = toPositiveInt(line.targetFixedAssetId);
                      const generatedFixedAssets = Array.isArray(line.generatedFixedAssets)
                        ? line.generatedFixedAssets
                        : [];
                      const targetFixedAsset =
                        targetFixedAssetId && fixedAssetRowsById instanceof Map
                          ? fixedAssetRowsById.get(targetFixedAssetId) || null
                          : null;
                      const targetFixedAssetLabel =
                        normalizeText(targetFixedAsset?.assetNo) ||
                        normalizeText(targetFixedAsset?.name) ||
                        (targetFixedAssetId ? `#${targetFixedAssetId}` : "");
                      return (
                      <div
                        key={`detail-line-${line.id || line.lineNo}`}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-800">
                          <span className="font-semibold">
                            {l("Line", "Satir")} {line.lineNo || "-"} | {line.lineKind || "STANDARD"}
                          </span>
                          <span>
                            {l("Posting account", "Kayit hesabi")} #{line.postingAccountId || "-"}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-700">
                          {line.description || "-"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-slate-600">
                          {isFixedAssetLine ? (
                            <>
                              <span>
                                {l("Fixed asset mode", "Demirbas modu")}: {line.fixedAssetMode || "-"}
                              </span>
                              <span>
                                {l("Fixed asset", "Demirbas")}:{" "}
                                {targetFixedAssetId ? (
                                  canReadFixedAssets ? (
                                    <Link
                                      to={`${FIXED_ASSET_DETAIL_ROUTE_PREFIX}/${targetFixedAssetId}`}
                                      className="text-cyan-700 hover:underline"
                                    >
                                      {targetFixedAssetLabel}
                                    </Link>
                                  ) : targetFixedAssetLabel
                                ) : line.fixedAssetMode === "AUTO_CREATE" ? (
                                  generatedFixedAssets.length > 0
                                    ? l(
                                        "Generated assets are listed below",
                                        "Olusan demirbaslar asagida listeleniyor"
                                      )
                                    : l("Auto-create on post", "Kayitta otomatik olusturulur")
                                ) : "-"}
                              </span>
                            </>
                          ) : (
                            <span>
                              {l("Item card", "Urun karti")}: {line.itemCardId || "-"}
                            </span>
                          )}
                          <span>
                            {l("Qty", "Miktar")}: {line.quantity ?? "-"}
                          </span>
                          <span>
                            {l("Unit price", "Birim fiyat")}: {line.unitPriceTxn ?? "-"}
                          </span>
                          <span>
                            {l("Tax category", "Vergi kategorisi")}: {line.taxCategoryCode || "-"}
                          </span>
                          <span>
                            {l("Stock impact", "Stok etkisi")}: {line.stockImpactMode || "NONE"}
                          </span>
                          <span>
                            {l("Warehouse", "Depo")}:{" "}
                            {formatWarehouseDisplay(
                              line.warehouseId,
                              line.warehouseCode,
                              line.warehouseName
                            )}
                          </span>
                        </div>
                        {isFixedAssetLine &&
                        line.fixedAssetMode === "AUTO_CREATE" &&
                        generatedFixedAssets.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="font-semibold text-slate-700">
                              {l("Generated fixed assets", "Olusan demirbaslar")}:
                            </span>
                            {generatedFixedAssets.map((assetRow) => {
                              const generatedAssetId = toPositiveInt(assetRow?.id);
                              const generatedAssetLabel =
                                normalizeText(assetRow?.assetNo) ||
                                normalizeText(assetRow?.name) ||
                                (generatedAssetId ? `#${generatedAssetId}` : "-");
                              const generatedAssetStatus = normalizeText(assetRow?.status);
                              const generatedAssetUnitNo = toPositiveInt(
                                assetRow?.sourceCariDocumentLineUnitNo
                              );
                              const chipLabel = [
                                generatedAssetUnitNo
                                  ? `${l("Unit", "Birim")} ${generatedAssetUnitNo}`
                                  : null,
                                generatedAssetLabel,
                                generatedAssetStatus || null,
                              ]
                                .filter(Boolean)
                                .join(" | ");
                              return generatedAssetId && canReadFixedAssets ? (
                                <Link
                                  key={`generated-fixed-asset-${line.id || line.lineNo}-${generatedAssetId}`}
                                  to={`${FIXED_ASSET_DETAIL_ROUTE_PREFIX}/${generatedAssetId}`}
                                  className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-cyan-800 hover:bg-cyan-100 hover:underline"
                                >
                                  {chipLabel}
                                </Link>
                              ) : (
                                <span
                                  key={`generated-fixed-asset-${line.id || line.lineNo}-${generatedAssetId || generatedAssetLabel}`}
                                  className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700"
                                >
                                  {chipLabel}
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">
                            <span className="block text-[11px] uppercase tracking-wide text-slate-500">
                              {l("Net", "Net")}
                            </span>
                            <MoneyText
                              amount={line.lineNetAmountTxn}
                              currencyCode={selectedSnapshot.currencyCodeSnapshot || selectedSnapshot.currencyCode}
                            />
                          </div>
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">
                            <span className="block text-[11px] uppercase tracking-wide text-slate-500">
                              {l("Tax", "Vergi")}
                            </span>
                            <MoneyText
                              amount={line.lineTaxAmountTxn}
                              currencyCode={selectedSnapshot.currencyCodeSnapshot || selectedSnapshot.currencyCode}
                            />
                          </div>
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">
                            <span className="block text-[11px] uppercase tracking-wide text-slate-500">
                              {l("Gross", "Brut")}
                            </span>
                            <MoneyText
                              amount={line.lineGrossAmountTxn}
                              currencyCode={selectedSnapshot.currencyCodeSnapshot || selectedSnapshot.currencyCode}
                            />
                          </div>
                        </div>
                        {Array.isArray(line.taxes) && line.taxes.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-slate-600">
                            {line.taxes.map((taxRow) => (
                              <li key={`detail-line-tax-${line.id || line.lineNo}-${taxRow.componentNo || 0}`}>
                                {(taxRow.taxCode || l("Tax", "Vergi"))} | {taxRow.ratePct ?? 0}% |{" "}
                                <MoneyText
                                  amount={taxRow.taxAmountTxn}
                                  currencyCode={selectedSnapshot.currencyCodeSnapshot || selectedSnapshot.currencyCode}
                                  className="inline"
                                />
                                {taxRow.taxPurposeCode ? ` | ${taxRow.taxPurposeCode}` : ""}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {Array.isArray(line.stockLinks) && line.stockLinks.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-slate-600">
                            {line.stockLinks.map((stockLink) => (
                              <li
                                key={`detail-line-stock-${line.id || line.lineNo}-${stockLink.id || stockLink.stockImpactMode}`}
                              >
                                {l("Stock link", "Stok baglantisi")} |{" "}
                                {stockLink.stockImpactMode || line.stockImpactMode || "NONE"} |{" "}
                                {stockLink.linkStatus || "-"} | {l("Qty", "Miktar")}{" "}
                                {stockLink.requestedQuantity ?? "-"}
                                {stockLink.inventoryMovementId
                                  ? ` | ${l("Movement", "Hareket")} #${stockLink.inventoryMovementId}`
                                  : ""}
                                {stockLink.inventoryMovementType
                                  ? ` | ${stockLink.inventoryMovementType}`
                                  : ""}
                                {stockLink.inventoryValuationStatus
                                  ? ` | ${stockLink.inventoryValuationStatus}`
                                  : ""}
                                {stockLink.inventoryWarehouseCode
                                  ? ` | ${l("Warehouse", "Depo")} ${stockLink.inventoryWarehouseCode}`
                                  : ""}
                                {stockLink.reopenedFromStockLinkId
                                  ? ` | ${l("Reopened from", "Yeniden acilan kaynak")} #${stockLink.reopenedFromStockLinkId}`
                                  : ""}
                                {stockLink.supersededByStockLinkId
                                  ? ` | ${l("Successor", "Devam baglantisi")} #${stockLink.supersededByStockLinkId}`
                                  : ""}
                                {stockLink.inventoryMovementReversedAt
                                  ? ` | ${l("Reversed", "Terslendi")} ${stockLink.inventoryMovementReversedAt}`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    )})}
                  </div>
                )}
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  {l("Lifecycle Snapshot", "Yasam Dongusu Ozeti")}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {selectedDocumentLifecycleMeta?.label || selectedSnapshot.status || "-"}
                </p>
                {selectedDocumentLifecycleMeta?.description ? (
                  <p className="mt-1 text-xs text-slate-600">{selectedDocumentLifecycleMeta.description}</p>
                ) : null}
                {selectedDocumentLifecycleActions.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-600">
                    {l("Next allowed transitions:", "Siradaki izinli gecisler:")}{" "}
                    {selectedDocumentLifecycleActions.map((row) => row.label).join(", ")}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    {l(
                      "No further lifecycle transitions are defined from this status.",
                      "Bu durumdan sonrasi icin tanimli bir yasam dongusu gecisi yok."
                    )}
                  </p>
                )}
              </div>
              {reverseResult ? <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{l("Reverse linkage", "Ters baglanti")}: `response.row.id`={reverseResult.reversalDocumentId || "-"}, `response.row.documentNo`={reverseResult.reversalDocumentNo || "-"}, `response.journal.reversalJournalEntryId`={reverseResult.reversalJournalEntryId || "-"}</div> : null}
              {canReadReports ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p className="font-semibold text-slate-800">
                    {l(
                      "Linked settlements / cash transactions",
                      "Bagli mahsuplar / nakit hareketleri"
                    )}
                  </p>
                  {linkedCashError ? <p className="mt-1 text-rose-700">{linkedCashError}</p> : null}
                  {linkedCashLoading ? <p className="mt-1 text-slate-600">{l("Loading linkage...", "Baglanti yukleniyor...")}</p> : null}
                  {!linkedCashLoading && linkedCashRows.length === 0 ? (
                    <p className="mt-1 text-slate-600">
                      {l(
                        "No linked settlements found for this document as of today.",
                        "Bu belge icin bugun itibariyla bagli mahsup bulunmuyor."
                      )}
                    </p>
                  ) : null}
                  {!linkedCashLoading && linkedCashRows.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {linkedCashRows.map((row, index) => (
                        <li key={`doc-link-${row.settlementBatchId || row.settlementNo || index}`} className="rounded border border-slate-200 bg-white px-2 py-1">
                          settlement={row.settlementNo || row.settlementBatchId || "-"} ({row.settlementDate || "-"}) | cashTransactionId={row.cashTransactionId || "-"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p className="font-semibold text-slate-800">
                  {l(
                    "Related Panel (GL / Open Items / Exceptions / Audit)",
                    "Iliskili Panel (GL / Acik Kalemler / Istisnalar / Denetim)"
                  )}
                </p>
                {relatedLoading ? (
                  <p className="mt-1 text-slate-600">{l("Loading related records...", "Iliskili kayitlar yukleniyor...")}</p>
                ) : null}
                {relatedError ? <p className="mt-1 text-rose-700">{relatedError}</p> : null}

                <div className="mt-2 space-y-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-700">{l("GL journal", "GL yevmiyesi")}</p>
                    {!canReadGlJournals ? (
                      <p className="mt-1 text-slate-500">{l("Missing permission: gl.journal.read", "Eksik yetki: gl.journal.read")}</p>
                    ) : !selectedPostedJournalEntryId ? (
                      <p className="mt-1 text-slate-600">{l("No posted journal linked yet.", "Henuz bagli kaydedilmis yevmiye yok.")}</p>
                    ) : !relatedJournal ? (
                      <p className="mt-1 text-slate-600">
                        {l("Linked journal id:", "Bagli yevmiye ID:")} {selectedPostedJournalEntryId}
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 text-slate-700">
                          id={relatedJournal.id || "-"} | no={relatedJournal.journal_no || "-"} | status=
                          {relatedJournal.status || "-"}
                        </p>
                        <Link
                          to={`/app/mahsup-islemleri?journalId=${relatedJournal.id}`}
                          className="mt-1 inline-block rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                        >
                          {l("Open in Journal Workbench", "Yevmiye Calisma Ekraninda Ac")}
                        </Link>
                        {Array.isArray(relatedJournal.source_links) &&
                        relatedJournal.source_links.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {relatedJournal.source_links.map((linkRow) => (
                              <li
                                key={`journal-source-link-${linkRow.id}`}
                                className="rounded border border-slate-200 bg-white px-2 py-1"
                              >
                                {linkRow.source_ref_type || "-"}#{linkRow.source_ref_id || "-"} (
                                {linkRow.link_role || "-"})
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">{l("Open items", "Acik kalemler")}</p>
                    {relatedOpenItems.length === 0 ? (
                      <p className="mt-1 text-slate-600">{l("No open items found for this document.", "Bu belge icin acik kalem bulunmuyor.")}</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {relatedOpenItems.map((row) => (
                          <li
                            key={`related-open-item-${row.id}`}
                            className="rounded border border-slate-200 bg-white px-2 py-1"
                          >
                            itemNo={row.itemNo || "-"} | status={row.status || "-"} | residual=
                            <MoneyText
                              amount={row.residualAmountTxn}
                              currencyCode={row.currencyCode}
                              className="ml-1"
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">
                      {l(
                        "Ops status note / blocked reason",
                        "Operasyon durum notu / engel nedeni"
                      )}
                    </p>
                    {opsStatusError ? (
                      <p className="mt-1 text-rose-700">{opsStatusError}</p>
                    ) : null}
                    {opsStatusMessage ? (
                      <p className="mt-1 text-emerald-700">{opsStatusMessage}</p>
                    ) : null}
                    {opsStatusLoading ? (
                      <p className="mt-1 text-slate-600">{l("Loading ops status...", "Operasyon durumu yukleniyor...")}</p>
                    ) : null}
                    {!opsStatusLoading ? (
                      <p className="mt-1 text-slate-600">
                        {l("Current:", "Guncel:")} {opsStatusRow?.opsStatus || "OK"}{" "}
                        {opsStatusRow?.updatedAt ? `(${l("updated", "guncellendi")} ${formatDateTime(opsStatusRow.updatedAt)})` : ""}
                      </p>
                    ) : null}

                    {canWriteOpsStatus ? (
                      <form
                        onSubmit={handleSaveOpsStatus}
                        className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2"
                      >
                        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {l("Ops Status", "Operasyon Durumu")}
                          <select
                            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs font-normal"
                            value={opsStatusForm.opsStatus}
                            onChange={(event) =>
                              setOpsStatusForm((prev) => ({
                                ...prev,
                                opsStatus: String(event.target.value || "").trim().toUpperCase(),
                              }))
                            }
                            disabled={opsStatusSaving}
                          >
                            <option value="OK">OK</option>
                            <option value="AT_RISK">AT_RISK</option>
                            <option value="BLOCKED">BLOCKED</option>
                          </select>
                        </label>
                        <input
                          type="text"
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder={l(
                            "Blocked reason (required when status=BLOCKED)",
                            "Engel nedeni (status=BLOCKED iken zorunlu)"
                          )}
                          value={opsStatusForm.blockedReason}
                          onChange={(event) =>
                            setOpsStatusForm((prev) => ({
                              ...prev,
                              blockedReason: event.target.value,
                            }))
                          }
                          disabled={opsStatusSaving}
                        />
                        <textarea
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder={l("Ops note (optional)", "Operasyon notu (opsiyonel)")}
                          rows={3}
                          value={opsStatusForm.note}
                          onChange={(event) =>
                            setOpsStatusForm((prev) => ({
                              ...prev,
                              note: event.target.value,
                            }))
                          }
                          disabled={opsStatusSaving}
                        />
                        <button
                          type="submit"
                          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                          disabled={opsStatusSaving}
                        >
                          {opsStatusSaving
                            ? l("Saving...", "Kaydediliyor...")
                            : l("Save Ops Status", "Operasyon Durumunu Kaydet")}
                        </button>
                      </form>
                    ) : (
                      <p className="mt-1 text-slate-500">{l("Missing permission: cari.doc.update", "Eksik yetki: cari.doc.update")}</p>
                    )}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">{l("Internal comments", "Dahili yorumlar")}</p>
                    {internalCommentsError ? (
                      <p className="mt-1 text-rose-700">{internalCommentsError}</p>
                    ) : null}
                    {internalCommentsMessage ? (
                      <p className="mt-1 text-emerald-700">{internalCommentsMessage}</p>
                    ) : null}
                    {internalCommentsLoading ? (
                      <p className="mt-1 text-slate-600">{l("Loading comments...", "Yorumlar yukleniyor...")}</p>
                    ) : null}

                    {canWriteInternalComments ? (
                      <form
                        onSubmit={handleCreateInternalComment}
                        className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2"
                      >
                        <div className="space-y-1">
                          <textarea
                            ref={internalCommentTextareaRef}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            placeholder={l(
                              "Add internal comment... Type @ to mention teammates.",
                              "Dahili yorum ekleyin... Ekip arkadaslarini etiketlemek icin @ yazin."
                            )}
                            rows={3}
                            value={internalCommentBody}
                            onChange={handleInternalCommentBodyChange}
                            onClick={handleInternalCommentBodyCursorChange}
                            onKeyUp={handleInternalCommentBodyCursorChange}
                            onKeyDown={handleInternalCommentBodyKeyDown}
                            onBlur={handleInternalCommentBodyBlur}
                            disabled={internalCommentSaving}
                          />
                          {internalCommentMentionDraft ? (
                            <div className="rounded border border-cyan-200 bg-cyan-50">
                              <div className="border-b border-cyan-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                                {l("Mention teammates", "Ekip arkadaslarini etiketle")}
                              </div>
                              {internalCommentMentionLoading ? (
                                <p className="px-2 py-2 text-xs text-cyan-800">
                                  {l("Loading suggestions...", "Oneriler yukleniyor...")}
                                </p>
                              ) : null}
                              {!internalCommentMentionLoading && internalCommentMentionError ? (
                                <p className="px-2 py-2 text-xs text-amber-800">
                                  {internalCommentMentionError}
                                </p>
                              ) : null}
                              {!internalCommentMentionLoading &&
                              !internalCommentMentionError &&
                              internalCommentMentionRows.length === 0 ? (
                                <p className="px-2 py-2 text-xs text-cyan-800">
                                  {l(
                                    "No matching teammates found.",
                                    "Eslesen ekip arkadasi bulunamadi."
                                  )}
                                </p>
                              ) : null}
                              {!internalCommentMentionLoading &&
                              !internalCommentMentionError &&
                              internalCommentMentionRows.length > 0 ? (
                                <ul className="max-h-40 overflow-auto p-1">
                                  {internalCommentMentionRows.map((row, index) => {
                                    const displayName = normalizeText(row?.name);
                                    const displayEmail = normalizeText(row?.email);
                                    const isHighlighted = index === internalCommentMentionHighlightIndex;
                                    return (
                                      <li key={`internal-comment-mention-${row?.id || displayEmail || index}`}>
                                        <button
                                          type="button"
                                          className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs ${
                                            isHighlighted
                                              ? "bg-cyan-100 text-cyan-950"
                                              : "text-slate-700 hover:bg-cyan-100/70"
                                          }`}
                                          onMouseEnter={() =>
                                            setInternalCommentMentionHighlightIndex(index)
                                          }
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => applyInternalCommentMention(row)}
                                        >
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate font-semibold">
                                              {displayName || displayEmail || "-"}
                                            </span>
                                            {displayName && displayEmail ? (
                                              <span className="block truncate font-mono text-[11px] text-slate-500">
                                                @{displayEmail}
                                              </span>
                                            ) : null}
                                          </span>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="submit"
                          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                          disabled={!String(internalCommentBody || "").trim() || internalCommentSaving}
                        >
                          {internalCommentSaving
                            ? l("Adding...", "Ekleniyor...")
                            : l("Add Comment", "Yorum Ekle")}
                        </button>
                        <p className="text-[11px] text-slate-500">
                          {l("Type", "Yazin")} <span className="font-mono">@</span>{" "}
                          {l(
                            "to open the teammate list. Picking a suggestion inserts @email and sends an in-app notification.",
                            "ekip listesini acmak icin. Bir oneriyi secmek @email ekler ve uygulama ici bildirim gonderir."
                          )}
                        </p>
                      </form>
                    ) : (
                      <p className="mt-1 text-slate-500">{l("Missing permission: cari.doc.update", "Eksik yetki: cari.doc.update")}</p>
                    )}

                    {!internalCommentsLoading && internalCommentRows.length === 0 ? (
                      <p className="mt-1 text-slate-600">{l("No internal comments yet.", "Henuz dahili yorum yok.")}</p>
                    ) : null}
                    {!internalCommentsLoading && internalCommentRows.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {internalCommentRows.map((row) => (
                          <li
                            key={`related-comment-${row.id}`}
                            className="rounded border border-slate-200 bg-white px-2 py-1"
                          >
                            <div className="whitespace-pre-wrap text-slate-700">
                              {row.body || "-"}
                            </div>
                            <div className="mt-1 text-slate-500">
                              {formatDateTime(row.createdAt)} | by=
                              {row.createdByUserName ||
                                row.createdByUserEmail ||
                                row.createdByUserId ||
                                "-"}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">{l("Evidence attachments", "Kanit ekleri")}</p>
                    {evidenceError ? (
                      <p className="mt-1 text-rose-700">{evidenceError}</p>
                    ) : null}
                    {evidenceMessage ? (
                      <p className="mt-1 text-emerald-700">{evidenceMessage}</p>
                    ) : null}
                    {evidenceLoading ? (
                      <p className="mt-1 text-slate-600">{l("Loading evidence...", "Kanitlar yukleniyor...")}</p>
                    ) : null}

                    {canAttachEvidence ? (
                      <form onSubmit={handleAttachEvidence} className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2">
                        <input
                          key={evidenceUploadInputKey}
                          type="file"
                          className="block w-full text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                          onChange={(event) => {
                            setEvidenceError("");
                            setEvidenceMessage("");
                            setEvidenceUploadFile(event.target.files?.[0] || null);
                          }}
                          disabled={evidenceUploading}
                        />
                        <input
                          type="text"
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder={l("Optional note", "Opsiyonel not")}
                          value={evidenceNote}
                          onChange={(event) => setEvidenceNote(event.target.value)}
                          disabled={evidenceUploading}
                        />
                        <button
                          type="submit"
                          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                          disabled={!evidenceUploadFile || evidenceUploading}
                        >
                          {evidenceUploading
                            ? l("Uploading...", "Yukleniyor...")
                            : l("Attach Evidence", "Kanit Ekle")}
                        </button>
                      </form>
                    ) : (
                      <p className="mt-1 text-slate-500">{l("Missing permission: cari.doc.update", "Eksik yetki: cari.doc.update")}</p>
                    )}

                    {!evidenceLoading && evidenceRows.length === 0 ? (
                      <p className="mt-1 text-slate-600">{l("No evidence attached to this document.", "Bu belgeye ekli kanit yok.")}</p>
                    ) : null}
                    {!evidenceLoading && evidenceRows.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {evidenceRows.map((row) => {
                          const rowId = toPositiveInt(row?.id);
                          const isDownloading = rowId && Number(evidenceDownloadingId) === Number(rowId);
                          const isDeleting = rowId && Number(evidenceDeletingId) === Number(rowId);
                          return (
                            <li
                              key={`related-evidence-${row.id}`}
                              className="rounded border border-slate-200 bg-white px-2 py-1"
                            >
                              <div className="text-slate-700">
                                #{row.id} | {row.fileName || "-"} | {formatFileSize(row.fileSizeBytes)} |{" "}
                                {row.contentType || "-"}
                              </div>
                              <div className="text-slate-600">
                                status={row.status || "-"} | uploaded={formatDateTime(row.uploadedAt)}
                              </div>
                              {row.note ? (
                                <div className="text-slate-500">note={row.note}</div>
                              ) : null}
                              <div className="mt-1 flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                                  onClick={() => handleDownloadEvidence(row)}
                                  disabled={!rowId || Boolean(isDownloading)}
                                >
                                  {isDownloading
                                    ? l("Downloading...", "Indiriliyor...")
                                    : l("Download", "Indir")}
                                </button>
                                {canAttachEvidence ? (
                                  <button
                                    type="button"
                                    className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                                    onClick={() => handleDeleteEvidence(rowId)}
                                    disabled={!rowId || Boolean(isDeleting)}
                                  >
                                    {isDeleting
                                      ? l("Deleting...", "Siliniyor...")
                                      : l("Delete", "Sil")}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">{l("Exceptions", "Istisnalar")}</p>
                    {!canReadExceptions ? (
                      <p className="mt-1 text-slate-500">{l("Missing permission: ops.exceptions.read", "Eksik yetki: ops.exceptions.read")}</p>
                    ) : relatedExceptions.length === 0 ? (
                      <p className="mt-1 text-slate-600">{l("No related exceptions for this source id.", "Bu kaynak ID icin iliskili istisna yok.")}</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {relatedExceptions.map((row) => (
                          <li
                            key={`related-exception-${row.id}`}
                            className="rounded border border-slate-200 bg-white px-2 py-1"
                          >
                            <div>
                              #{row.id} {row.status || "-"} | {row.severity || "-"}
                            </div>
                            <div className="text-slate-600">{row.title || "-"}</div>
                            <Link
                              to={`/app/ayarlar/exception-workbench?exceptionId=${row.id}`}
                              className="mt-1 inline-block rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                            >
                              {l("Open Exception", "Istisnayi Ac")}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">{l("Audit trail", "Denetim izi")}</p>
                    {!canReadCariAudit ? (
                      <p className="mt-1 text-slate-500">{l("Missing permission: cari.audit.read", "Eksik yetki: cari.audit.read")}</p>
                    ) : relatedAuditRows.length === 0 ? (
                      <p className="mt-1 text-slate-600">{l("No audit records found for this document.", "Bu belge icin denetim kaydi bulunmadi.")}</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {relatedAuditRows.map((row) => (
                          <li
                            key={`related-audit-${row.auditLogId}`}
                            className="rounded border border-slate-200 bg-white px-2 py-1"
                          >
                            {row.action || "-"} | {formatDateTime(row.createdAt)} | actor=
                            {row.actorEmail || row.actorUserId || "-"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
              <StatusTimeline
                className="mt-4"
                title={l("Document Lifecycle Timeline", "Belge Yasam Dongusu Zaman Cizelgesi")}
                steps={selectedDocumentLifecycleTimeline}
                emptyText={l(
                  "No lifecycle history available for this document yet.",
                  "Bu belge icin henuz yasam dongusu gecmisi yok."
                )}
              />
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                  {l("Draft Actions", "Taslak Islemleri")}
                </h3>
                {editValidationSummary ? (
                  <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {editValidationSummary}
                  </div>
                ) : null}
                {editError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{editError}</div> : null}
                {editMessage ? <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{editMessage}</div> : null}
                <form className="mt-3 grid gap-2 md:grid-cols-2" onSubmit={handleUpdateDraft}>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Legal Entity ID", "Tuzel Kisilik ID")}<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.legalEntityId} onChange={(event) => handleEditLegalEntityChange(event.target.value)} disabled={!canEditOrCancelSelected || editSaving} /></label>
                  {canReadOrgTree ? (
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Operating Unit (optional)", "Operasyon Birimi (opsiyonel)")}
                        <Combobox
                          className="mt-1"
                          value={editForm.operatingUnitId}
                          options={editOperatingUnitLookupOptions}
                          loading={editOperatingUnitsLoading}
                          disabled={!canEditOrCancelSelected || !toPositiveInt(editForm.legalEntityId) || editSaving}
                          placeholder={
                            toPositiveInt(editForm.legalEntityId)
                              ? l("Search operating unit code/name", "Operasyon birimi kodu/adi ara")
                              : l("Select legal entity first", "Once tuzel kisilik secin")
                          }
                          noOptionsText={
                            toPositiveInt(editForm.legalEntityId)
                              ? l("No operating units found.", "Operasyon birimi bulunamadi.")
                              : l("Select legal entity first.", "Once tuzel kisilik secin.")
                          }
                          onChange={(nextValue) =>
                            setEditForm((prev) => ({
                              ...prev,
                              operatingUnitId: nextValue ? String(nextValue) : "",
                            }))
                          }
                        />
                      </label>
                      {editOperatingUnitsError ? (
                        <p className="mt-1 text-[11px] normal-case text-amber-700">
                          {editOperatingUnitsError}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Operating Unit ID (optional)", "Operasyon Birimi ID (opsiyonel)")}<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.operatingUnitId} onChange={(event) => setEditForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))} disabled={!canEditOrCancelSelected || editSaving} /></label>
                  )}
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Counterparty ID", "Cari ID")}<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.counterpartyId} onChange={(event) => setEditForm((prev) => ({ ...prev, counterpartyId: event.target.value }))} disabled={!canEditOrCancelSelected || editSaving} /></label>
                  {canReadCards ? (
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Counterparty Lookup", "Cari Arama")}
                        <Combobox
                          className="mt-1"
                          value={editForm.counterpartyId}
                          options={editCounterpartyLookupOptions}
                          loading={editCounterpartyLoading}
                          disabled={!canEditOrCancelSelected || !toPositiveInt(editForm.legalEntityId) || editSaving}
                          placeholder={toPositiveInt(editForm.legalEntityId) ? l("Type code/name", "Kod/ad yazin") : l("Select legal entity first", "Once tuzel kisilik secin")}
                          noOptionsText={toPositiveInt(editForm.legalEntityId) ? l("No counterparties found.", "Cari bulunamadi.") : l("Set legalEntityId to load counterparties.", "Carileri yuklemek icin legalEntityId secin.")}
                          onInputChange={(nextValue, meta) => {
                            setEditInlineCounterpartyError("");
                            setEditInlineCounterpartyMessage("");
                            const reason = String(meta?.reason || "").trim().toLowerCase();
                            if (reason === "select" || reason === "clear") {
                              setEditCounterpartyLookupQuery("");
                              return;
                            }
                            setEditCounterpartyLookupQuery(normalizeLookupQuery(nextValue));
                          }}
                          onChange={(nextValue) =>
                            setEditForm((prev) => ({
                              ...prev,
                              counterpartyId: nextValue ? String(nextValue) : "",
                            }))
                          }
                        />
                      </label>
                      {canUpsertCards ? (
                        <button
                          type="button"
                          className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case text-slate-700 disabled:opacity-60"
                          onClick={handleInlineCreateCounterpartyForEditForm}
                          disabled={!canInlineCreateCounterpartyInEditForm || editInlineCounterpartySaving || editSaving}
                        >
                          {editInlineCounterpartySaving
                            ? l("Creating counterparty...", "Cari olusturuluyor...")
                            : l(
                                `Create "${editInlineCounterpartyName || "new counterparty"}"`,
                                `"${editInlineCounterpartyName || "yeni cari"}" olustur`
                              )}
                        </button>
                      ) : null}
                      {editInlineCounterpartyError ? (
                        <p className="mt-1 text-[11px] normal-case text-rose-700">{editInlineCounterpartyError}</p>
                      ) : null}
                      {editInlineCounterpartyMessage ? (
                        <p className="mt-1 text-[11px] normal-case text-emerald-700">{editInlineCounterpartyMessage}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Document Type", "Belge Turu")}<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.documentType} onChange={(event) => setEditForm((prev) => ({ ...prev, documentType: event.target.value }))} disabled={!canEditOrCancelSelected || editSaving}>{DOCUMENT_TYPES.map((documentType) => <option key={`edit-document-type-${documentType}`} value={documentType}>{documentType}</option>)}</select></label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {l("Due Date", "Vade Tarihi")}
                    <input
                      type="date"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      value={editForm.dueDate}
                      onChange={(event) => {
                        const nextDueDate = event.target.value;
                        setEditDueDateTouched(Boolean(nextDueDate));
                        setEditForm((prev) => ({ ...prev, dueDate: nextDueDate }));
                      }}
                      disabled={
                        !canEditOrCancelSelected || editSaving || Boolean(editImmediateCashDueDate)
                      }
                      required={requiresDueDate(editForm.documentType)}
                    />
                    {editImmediateCashDueDate ? (
                      <p className="mt-1 text-[11px] normal-case text-slate-500">
                        {l(
                          "Immediate cash uses the document date as the due date.",
                          "Aninda nakit tahsilat/odeme, vade tarihi olarak belge tarihini kullanir."
                        )}
                      </p>
                    ) : null}
                  </label>
                  <div className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                      {l("Payment", "Odeme")}
                    </p>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {l("Mode", "Mod")}
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                          value={normalizeDocumentSettlementMode(editForm.settlementMode)}
                          onChange={(event) => handleEditSettlementModeChange(event.target.value)}
                          disabled={!canEditOrCancelSelected || editSaving}
                        >
                          <option value="ACCRUAL">
                            {l("On Credit (Accrual)", "Vadeli (Tahakkuk)")}
                          </option>
                          <option value="IMMEDIATE_CASH">{editImmediateCashLabel}</option>
                        </select>
                      </label>
                      {editImmediateCashSelected ? (
                        canReadCashRegisters ? (
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <label className="block">
                              {l("Cash Register", "Kasa")}
                              <Combobox
                                className="mt-1"
                                value={editForm.settlementCashRegisterId}
                                options={editCashRegisterLookupOptions}
                                loading={editCashRegistersLoading}
                                disabled={
                                  !canEditOrCancelSelected ||
                                  !toPositiveInt(editForm.legalEntityId) ||
                                  editSaving
                                }
                                placeholder={
                                  toPositiveInt(editForm.legalEntityId)
                                    ? l("Search cash register", "Kasa ara")
                                    : l("Select legal entity first", "Once tuzel kisilik secin")
                                }
                                noOptionsText={
                                  toPositiveInt(editForm.legalEntityId)
                                    ? l("No cash registers found.", "Kasa bulunamadi.")
                                    : l("Select legal entity first.", "Once tuzel kisilik secin.")
                                }
                                onChange={(nextValue) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    settlementCashRegisterId: nextValue ? String(nextValue) : "",
                                  }))
                                }
                              />
                            </label>
                            {editCashRegistersError ? (
                              <p className="mt-1 text-[11px] normal-case text-amber-700">
                                {editCashRegistersError}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            {l("Cash Register ID", "Kasa ID")}
                            <input
                              type="number"
                              min="1"
                              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                              value={editForm.settlementCashRegisterId}
                              onChange={(event) =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  settlementCashRegisterId: event.target.value,
                                }))
                              }
                              disabled={!canEditOrCancelSelected || editSaving}
                            />
                          </label>
                        )
                      ) : (
                        <p className="text-xs font-normal normal-case text-slate-500 md:self-end">
                          {l(
                            "Accrual keeps the current flow: post the document now and settle it later from CARI Settlements.",
                            "Tahakkuk mevcut akisi korur: belgeyi simdi kayda alin, sonra CARI mahsuplastirmadan kapatin."
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                      {l("Amounts + Currency", "Tutar + Para Birimi")}
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {l("Invoice Total (derived)", "Fatura Toplami (turetilmis)")}
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                          value={normalizeOptionalDecimalText(editDocumentFxComputation.resolvedAmountTxn)}
                          readOnly
                          disabled={!canEditOrCancelSelected || editSaving}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {l("Invoice Currency", "Fatura Para Birimi")}
                        <input
                          type="text"
                          maxLength={3}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={editForm.currencyCode}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, currencyCode: event.target.value }))
                          }
                          disabled={!canEditOrCancelSelected || editSaving}
                          required
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {l("Base Amount (calculated)", "Baz Tutar (otomatik hesaplanir)")}
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                          value={editResolvedAmountBaseText}
                          readOnly
                          disabled={!canEditOrCancelSelected || editSaving}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {editDocumentFxComputation.fxRateRequired
                          ? l("FX Rate (required)", "Kur (zorunlu)")
                          : l("FX Rate", "Kur")}
                        <input
                          type="number"
                          min="0.0000000001"
                          step="0.0000000001"
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={editDocumentFxComputation.isLocalCurrency ? "1" : editForm.fxRate || ""}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, fxRate: event.target.value }))
                          }
                          readOnly={editDocumentFxComputation.isLocalCurrency}
                          disabled={!canEditOrCancelSelected || editSaving}
                          required={editDocumentFxComputation.fxRateRequired}
                        />
                      </label>
                    </div>
                    {editFunctionalCurrencyCode ? (
                      <p className="mt-2 text-[11px] text-slate-500">
                        {editDocumentFxComputation.isLocalCurrency
                          ? l(
                              `Functional currency is ${editFunctionalCurrencyCode}. FX rate is fixed to 1 and base amount follows the invoice amount.`,
                              `Fonksiyonel para birimi ${editFunctionalCurrencyCode}. Kur 1 olarak sabitlenir ve baz tutar fatura tutarindan gelir.`
                            )
                          : l(
                              `Functional currency is ${editFunctionalCurrencyCode}. Base amount is calculated automatically from invoice amount x FX rate.`,
                              `Fonksiyonel para birimi ${editFunctionalCurrencyCode}. Baz tutar, fatura tutari x kur ile otomatik hesaplanir.`
                            )}
                      </p>
                    ) : null}
                  </div>
                  <DocumentLineWorkbench
                    l={l}
                    title={l("Commercial Lines", "Ticari Satirlar")}
                    form={editForm}
                    saving={!canEditOrCancelSelected || editSaving}
                    gridSpanClass="md:col-span-2"
                    currencyCode={editForm.currencyCode}
                    functionalCurrencyCode={editFunctionalCurrencyCode}
                    fxComputation={editDocumentFxComputation}
                    canReadGlAccounts={canReadGlAccounts}
                    lineAccountOptions={editLineAccountOptions}
                    lineAccountsLoading={editLineAccountsLoading}
                    lineAccountsError={editLineAccountsError}
                    itemCardOptions={editItemCardOptions}
                    itemCardsLoading={editItemCardsLoading}
                    itemCardsError={editItemCardsError}
                    warehouseOptions={editWarehouseOptions}
                    warehouseLoading={editWarehousesLoading}
                    warehouseError={editWarehousesError}
                    warehouseInfoMessage={editWarehouseValidation.generalErrors[0] || ""}
                    warehouseLineErrors={editWarehouseValidation.lineErrors}
                    lineValidationMessages={editLineValidationMessages}
                    taxCategoryOptions={editTaxCategoryOptions}
                    taxCategoryLoading={taxCategoryLoading}
                    taxCategoryError={taxCategoryError}
                    previewLoading={editLinePreviewLoading}
                    previewError={editLinePreviewError}
                    previewMessage={editLinePreviewMessage}
                    fixedAssetCategoryOptions={editFixedAssetCategoryOptions}
                    fixedAssetCategoriesLoading={editFixedAssetCategoriesLoading}
                    fixedAssetCategoriesError={editFixedAssetCategoriesError}
                    fixedAssetCategoriesById={editFixedAssetCategoriesById}
                    fixedAssetDraftOptions={editFixedAssetDraftOptions}
                    fixedAssetDraftLoading={editFixedAssetDraftLoading}
                    fixedAssetDraftError={editFixedAssetDraftError}
                    fixedAssetDraftRowsById={editFixedAssetDraftRowsById}
                    fixedAssetSaleOptions={editFixedAssetSaleOptions}
                    fixedAssetSaleLoading={editFixedAssetSaleLoading}
                    fixedAssetSaleError={editFixedAssetSaleError}
                    fixedAssetSaleRowsById={editFixedAssetSaleRowsById}
                    fixedAssetOperatingUnitOptions={editFixedAssetOperatingUnitOptions}
                    canReadFixedAssetSettings={canReadFixedAssetSettings}
                    canUpsertFixedAssetSettings={canUpsertFixedAssetSettings}
                    onAddLine={addEditDocumentLine}
                    onRemoveLine={removeEditDocumentLine}
                    onMoveLine={moveEditDocumentLine}
                    onPatchLine={patchEditDocumentLine}
                    onPatchTaxSensitiveLine={patchEditDocumentLineWithTaxReset}
                    onChangeSubledgerType={changeEditDocumentLineSubledgerType}
                    onChangeFixedAssetMode={changeEditDocumentLineFixedAssetMode}
                    onSelectFixedAssetCategory={selectEditDocumentLineFixedAssetCategory}
                    onSelectTargetFixedAsset={selectEditDocumentLineTargetFixedAsset}
                    onSelectItemCard={selectEditDocumentLineItemCard}
                    onChangeStockImpactMode={changeEditDocumentLineStockImpactMode}
                    onSelectWarehouse={selectEditDocumentLineWarehouse}
                    onExpandFixedAssetLine={expandEditDocumentLineFixedAsset}
                    onOpenQuickCreateFixedAsset={openEditQuickCreateFixedAsset}
                    canQuickCreateFixedAsset={canUpsertFixedAssets}
                    onPreviewAll={() => handleEditDocumentLineTaxPreview()}
                    onPreviewRow={(rowId) => handleEditDocumentLineTaxPreview(rowId)}
                  />
                  <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!canEditOrCancelSelected || editSaving}>{editSaving ? l("Saving...", "Kaydediliyor...") : l("Update Draft Document", "Taslak Belgeyi Guncelle")}</button>
                  <button type="button" className="rounded-md border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" onClick={handleCancelDraft} disabled={!canEditOrCancelSelected || cancelSaving}>{cancelSaving ? l("Cancelling...", "Iptal ediliyor...") : l("Cancel Draft", "Taslagi Iptal Et")}</button>
                </form>
                {cancelError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{cancelError}</div> : null}
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                  {l("Post / Reverse", "Kaydet / Ters Kayit")}
                </h3>
                {cariPostingNotReady ? (
                  <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p className="font-semibold">
                      {l("Setup incomplete (CARI posting)", "Kurulum eksik (CARI kaydi)")}
                    </p>
                    <p className="mt-1">
                      {l("Posting is disabled for legalEntityId=", "Kayit islemi su legalEntityId icin kapali:")}
                      {selectedDocumentLegalEntityId}.
                    </p>
                    {Array.isArray(selectedCariPostingReadiness?.missingPurposeCodes) &&
                    selectedCariPostingReadiness.missingPurposeCodes.length > 0 ? (
                      <p className="mt-1">
                        {l("Missing purpose codes:", "Eksik amac kodlari:")}{" "}
                        {selectedCariPostingReadiness.missingPurposeCodes.join(", ")}
                      </p>
                    ) : null}
                    {Array.isArray(selectedCariPostingReadiness?.invalidMappings) &&
                    selectedCariPostingReadiness.invalidMappings.length > 0 ? (
                      <ul className="mt-2 list-disc pl-5">
                        {selectedCariPostingReadiness.invalidMappings.map((row, index) => (
                          <li key={`cari-readiness-invalid-${index}`}>
                            {String(row?.purposeCode || "-")}:{" "}
                            {formatReadinessReason(row?.reason, l)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        to="/app/ayarlar/hesap-plani-ayarlari#manual-purpose-mappings"
                        className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
                      >
                        {l("Fix manually", "Elle Duzelt")}
                      </Link>
                      <Link
                        to="/app/ayarlar/hesap-plani-ayarlari#template-wizard"
                        className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
                      >
                        {l("Use template", "Sablon Kullan")}
                      </Link>
                    </div>
                  </div>
                ) : null}
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Default Offset Account (Optional)", "Varsayilan Karsi Hesap (Opsiyonel)")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={postForm.offsetAccountId}
                    onChange={(event) =>
                      setPostForm((prev) => ({ ...prev, offsetAccountId: event.target.value }))
                    }
                    disabled={
                      !canPostSelected ||
                      postSaving ||
                      postOffsetAccountsLoading ||
                      !canReadGlAccounts
                    }
                  >
                    <option value="">{l("Use default CARI purpose mapping", "Varsayilan CARI amac eslemesini kullan")}</option>
                    {filteredPostOffsetAccountOptions.map((row) => (
                      <option key={`post-offset-account-${row.id}`} value={String(row.id)}>
                        {row.code} - {row.name} ({row.accountType || "-"})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(postForm.showAllOffsetAccounts)}
                    onChange={(event) =>
                      setPostForm((prev) => ({
                        ...prev,
                        showAllOffsetAccounts: event.target.checked,
                      }))
                    }
                    disabled={!canPostSelected || postSaving || !canReadGlAccounts}
                  />
                  {l("Show all account types", "Tum hesap turlerini goster")}
                </label>
                <p className="mt-1 text-xs text-slate-600">
                  {l("Applied when a posting line does not choose its own offset account.", "Bir kayit satiri kendi karsi hesabini secmezse uygulanir.")}
                </p>
                {selectedOffsetAccountType && !postForm.showAllOffsetAccounts ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Filtered by direction={selectedDocumentDirection}: showing only{" "}
                    {selectedOffsetAccountType} accounts.
                  </p>
                ) : null}
                {!canReadGlAccounts ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {l("Missing permission: `gl.account.read`. Default mapping will be used.", "Eksik yetki: `gl.account.read`. Varsayilan esleme kullanilacak.")}
                  </p>
                ) : null}
                {postOffsetAccountsLoading ? (
                  <p className="mt-1 text-xs text-slate-600">{l("Loading postable account options...", "Kaydedilebilir hesap secenekleri yukleniyor...")}</p>
                ) : null}
                {postOffsetAccountsError ? (
                  <p className="mt-1 text-xs text-rose-700">{postOffsetAccountsError}</p>
                ) : null}
                {!postOffsetAccountsLoading &&
                !postOffsetAccountsError &&
                canReadGlAccounts &&
                filteredPostOffsetAccountOptions.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-600">
                    {selectedOffsetAccountType && !postForm.showAllOffsetAccounts
                      ? l(
                          `No postable ${selectedOffsetAccountType} accounts found for selected legal entity.`,
                          `Secili tuzel kisilik icin kaydedilebilir ${selectedOffsetAccountType} hesap bulunamadi.`
                        )
                      : l("No postable accounts found for selected legal entity.", "Secili tuzel kisilik icin kaydedilebilir hesap bulunamadi.")}
                  </p>
                ) : null}
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={postForm.usePostingLines}
                    onChange={(event) =>
                      setPostForm((prev) => {
                        const usePostingLines = event.target.checked;
                        if (!usePostingLines) {
                          return {
                            ...prev,
                            usePostingLines: false,
                          };
                        }
                        const existingLines = Array.isArray(prev.postingLines)
                          ? prev.postingLines
                          : [];
                        if (existingLines.length > 0) {
                          return {
                            ...prev,
                            usePostingLines: true,
                          };
                        }
                        return {
                          ...prev,
                          usePostingLines: true,
                          postingLines: [
                            createPostingLineDraft({
                              amountTxn: selectedDocumentAmountTxn,
                              amountBase: selectedDocumentAmountBase,
                            }),
                          ],
                        };
                      })
                    }
                    disabled={
                      !canPostSelected ||
                      postSaving ||
                      !selectedDocumentPostingRulesReady ||
                      selectedDocumentUsesStoredTaxesForPosting
                    }
                  />
                  {l("Split posting by line items", "Kaydi satirlara bol")}
                </label>
                {!selectedDocumentPostingRulesReady && selectedDocumentId ? (
                  <p className="mt-1 text-xs text-slate-600">
                    {l(
                      "Loading draft line detail to determine whether split posting is available.",
                      "Bolunmus kaydin uygun olup olmadigini belirlemek icin taslak satir detayi yukleniyor."
                    )}
                  </p>
                ) : null}
                {selectedDocumentUsesStoredTaxesForPosting ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {l(
                      "Split posting is disabled because this draft already stores line-level taxes.",
                      "Bu taslakta satir bazli vergi kayitli oldugu icin bolunmus kayit kapatildi."
                    )}
                  </p>
                ) : null}
                {postForm.usePostingLines && !selectedDocumentUsesStoredTaxesForPosting ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                        {l("Posting lines", "Kayit satirlari")}
                      </p>
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        onClick={addPostFormPostingLine}
                        disabled={!canPostSelected || postSaving}
                      >
                        {l("Add line", "Satir Ekle")}
                      </button>
                    </div>
                    <div className="mt-2 space-y-2">
                      {(Array.isArray(postForm.postingLines) ? postForm.postingLines : []).map(
                        (line, index) => (
                          <div
                            key={line.rowId || `post-line-${index + 1}`}
                            className="rounded-md border border-slate-200 bg-white p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-700">
                                {l("Line", "Satir")} {index + 1}
                              </p>
                              <button
                                type="button"
                                className="rounded border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-700 disabled:opacity-40"
                                onClick={() => removePostFormPostingLine(line.rowId)}
                                disabled={
                                  !canPostSelected ||
                                  postSaving ||
                                  (postForm.postingLines || []).length <= 1
                                }
                              >
                                {l("Remove", "Kaldir")}
                              </button>
                            </div>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                {l("Description (Optional)", "Aciklama (Opsiyonel)")}
                                <input
                                  type="text"
                                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                                  value={line.description || ""}
                                  maxLength={255}
                                  onChange={(event) =>
                                    updatePostFormPostingLine(line.rowId, {
                                      description: event.target.value,
                                    })
                                  }
                                  disabled={!canPostSelected || postSaving}
                                />
                              </label>
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                {l("Offset Account (Optional)", "Karsi Hesap (Opsiyonel)")}
                                <select
                                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                                  value={normalizePositiveIntText(line.offsetAccountId)}
                                  onChange={(event) =>
                                    updatePostFormPostingLine(line.rowId, {
                                      offsetAccountId: normalizePositiveIntText(
                                        event.target.value
                                      ),
                                    })
                                  }
                                  disabled={
                                    !canPostSelected ||
                                    postSaving ||
                                    postOffsetAccountsLoading ||
                                    !canReadGlAccounts
                                  }
                                >
                                  <option value="">{l("Use default offset for this post", "Bu kayit icin varsayilan karsi hesabi kullan")}</option>
                                  {filteredPostOffsetAccountOptions.map((row) => (
                                    <option
                                      key={`post-line-offset-account-${line.rowId}-${row.id}`}
                                      value={String(row.id)}
                                    >
                                      {row.code} - {row.name} ({row.accountType || "-"})
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                {l("Invoice Amount (Invoice Currency)", "Fatura Tutari (Fatura Para Birimi)")}
                                <input
                                  type="number"
                                  min="0"
                                  step="0.000001"
                                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                                  value={line.amountTxn || ""}
                                  onChange={(event) =>
                                    updatePostFormPostingLine(line.rowId, {
                                      amountTxn: normalizeOptionalDecimalText(
                                        event.target.value
                                      ),
                                    })
                                  }
                                  disabled={!canPostSelected || postSaving}
                                />
                              </label>
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                {l("Base Amount (Legal Entity Currency)", "Baz Tutar (Tuzel Kisilik Para Birimi)")}
                                <input
                                  type="number"
                                  min="0"
                                  step="0.000001"
                                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                                  value={line.amountBase || ""}
                                  onChange={(event) =>
                                    updatePostFormPostingLine(line.rowId, {
                                      amountBase: normalizeOptionalDecimalText(
                                        event.target.value
                                      ),
                                    })
                                  }
                                  disabled={!canPostSelected || postSaving}
                                />
                              </label>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                    <div className="mt-2 text-xs text-slate-700">
                      <p>
                        {l("Draft totals txn/base:", "Taslak toplam txn/base:")}{" "}
                        {selectedDocumentAmountTxn ?? "-"} /{" "}
                        {selectedDocumentAmountBase ?? "-"}
                      </p>
                      <p>
                        {l("Posting line totals txn/base:", "Kayit satiri toplam txn/base:")}{" "}
                        {postFormPostingLineSummary.totalTxn} /{" "}
                        {postFormPostingLineSummary.totalBase}
                      </p>
                    </div>
                    {postFormPostingLineSummary.invalidAmountRows > 0 ? (
                      <p className="mt-1 text-xs text-amber-700">
                        {postFormPostingLineSummary.invalidAmountRows} {l("line(s) have missing or invalid amounts.", "satirda eksik veya gecersiz tutar var.")}
                      </p>
                    ) : null}
                    {postFormPostingLineSummary.lineCount > 0 &&
                    postFormPostingLineSummary.hasDraftTotals &&
                    !postFormPostingLineSummary.matchesDraftTotals ? (
                      <p className="mt-1 text-xs text-amber-700">
                        {l("Posting line totals must match draft totals before posting.", "Kayit oncesi satir toplamlari taslak toplamlariyla eslesmelidir.")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={postForm.useFxOverride} onChange={(event) => setPostForm((prev) => ({ ...prev, useFxOverride: event.target.checked }))} disabled={!canPostSelected || postSaving} />{l("useFxOverride", "Kur gecersiz kilma kullan")}</label>
                <input type="text" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder={l("fxOverrideReason", "Kur gecersiz kilma nedeni")} value={postForm.fxOverrideReason} onChange={(event) => setPostForm((prev) => ({ ...prev, fxOverrideReason: event.target.value }))} disabled={!canPostSelected || postSaving} />
                {postForm.useFxOverride && !canFxOverride ? <p className="mt-2 text-sm text-amber-700">{l("You cannot post with FX override. Missing permission: `cari.fx.override`.", "Kur gecersiz kilma ile kayit yapamazsiniz. Eksik yetki: `cari.fx.override`.")}</p> : null}
                <button type="button" className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={handlePostDraft} disabled={!canPostSelected || postSaving || !postingLinesReadyForSubmit}>{postSaving ? l("Posting...", "Kaydediliyor...") : l("Post Draft", "Taslagi Kaydet")}</button>
                {postError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{postError}</div> : null}
                {postTransferGuidance ? (
                  <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                    <p className="font-semibold">
                      {l(
                        "Stock exists in another ownership context. Use an explicit transfer before posting again.",
                        "Stok baska bir sahiplik baglaminda mevcut. Yeniden kayda almadan once acik bir transfer kullanin."
                      )}
                    </p>
                    <p className="mt-1 text-xs">
                      {[
                        postTransferGuidance.itemCardCode ||
                          postTransferGuidance.itemCardName ||
                          l("Item", "Kalem"),
                        postTransferGuidance.transferSourceWarehouseCode ||
                        postTransferGuidance.transferSourceWarehouseName
                          ? `${l("Suggested source", "Onerilen kaynak")}: ${
                              postTransferGuidance.transferSourceWarehouseCode ||
                              postTransferGuidance.transferSourceWarehouseName
                            }`
                          : "",
                        postTransferGuidance.warehouseCode || postTransferGuidance.warehouseName
                          ? `${l("Target warehouse", "Hedef depo")}: ${
                              postTransferGuidance.warehouseCode || postTransferGuidance.warehouseName
                            }`
                          : "",
                        postTransferGuidance.requestedQuantity
                          ? `${l("Quantity", "Miktar")}: ${postTransferGuidance.requestedQuantity}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" | ")}
                    </p>
                    <p className="mt-2 text-xs">
                      <Link
                        to={buildInventoryTransferLink({
                          legalEntityId: selectedRow?.legalEntityId || selectedDetail?.legalEntityId,
                          sourceWarehouseId: postTransferGuidance.transferSourceWarehouseId,
                          targetWarehouseId: postTransferGuidance.warehouseId,
                          itemCardId: postTransferGuidance.itemCardId,
                          quantityRequested: postTransferGuidance.requestedQuantity,
                          sourceModule: "CARI",
                          sourceEntityType: "CARI_DOCUMENT",
                          sourceEntityId: selectedDocumentId,
                        })}
                        className="font-semibold underline underline-offset-2"
                      >
                        {l("Open inventory transfers", "Stok transferlerini ac")}
                      </Link>{" "}
                      {l(
                        "to create the cross-context replenishment, then post the draft again.",
                        "ile contextler arasi ikmali olusturun, sonra taslagi yeniden kayda alin."
                      )}
                    </p>
                  </div>
                ) : null}
                {postMessage ? <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{postMessage}</div> : null}

                <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Reverse Reason", "Ters Kayit Nedeni")}<input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={reverseForm.reason} onChange={(event) => setReverseForm((prev) => ({ ...prev, reason: event.target.value }))} disabled={!canReverseSelected || reverseSaving} /></label>
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">{l("Reversal Date", "Ters Kayit Tarihi")}<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={reverseForm.reversalDate} onChange={(event) => setReverseForm((prev) => ({ ...prev, reversalDate: event.target.value }))} disabled={!canReverseSelected || reverseSaving} /></label>
                <button type="button" className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={handleReversePosted} disabled={!canReverseSelected || reverseSaving}>{reverseSaving ? l("Reversing...", "Ters kayit olusturuluyor...") : l("Reverse Document", "Belgeyi Tersle")}</button>
                {reverseError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{reverseError}</div> : null}
                {reverseInventoryBlocks.length > 0 ? (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <p className="font-semibold">
                      {l(
                        "Reverse is blocked by linked inventory effects:",
                        "Ters kayit bagli stok etkileri nedeniyle engellendi:"
                      )}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                      <span className="rounded-full border border-amber-300 bg-white px-2 py-1">
                        {`${reverseInventoryBlockSummary.issueCount} ${l("issue", "cikis")}`}
                      </span>
                      <span className="rounded-full border border-amber-300 bg-white px-2 py-1">
                        {`${reverseInventoryBlockSummary.receiptCount} ${l("receipt", "alim")}`}
                      </span>
                    </div>
                    {reverseInventoryBlockSummary.stepMessages.length > 0 ? (
                      <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">
                        {reverseInventoryBlockSummary.stepMessages.map((message, index) => (
                          <li key={`reverse-inventory-step-${index}`}>{message}</li>
                        ))}
                      </ol>
                    ) : null}
                    <p className="mt-2 text-xs text-amber-900">
                      <Link
                        to={buildInventoryMovementLink(selectedRow?.legalEntityId)}
                        className="font-semibold underline underline-offset-2"
                      >
                        {l("Inventory Movements", "Stok Hareketleri")}
                      </Link>{" "}
                      {l(
                        "opens `/app/stok-yansitma-islemleri` for the blocking legal entity context.",
                        "engel koyan tuzel kisilik baglamiyla `/app/stok-yansitma-islemleri` ekranini acar."
                      )}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {reverseInventoryBlocks.map((row, index) => (
                        <li key={`reverse-inventory-block-${row.stockLinkId || row.inventoryMovementId || index}`}>
                          {row.inventoryMovementId ? (
                            <Link
                              to={buildInventoryMovementLink(
                                row.legalEntityId || selectedRow?.legalEntityId,
                                row.inventoryMovementId
                              )}
                              className="font-semibold underline underline-offset-2"
                            >
                              {`#${row.inventoryMovementId}`}
                            </Link>
                          ) : (
                            "#-"
                          )}{" "}
                          {`| ${row.inventoryMovementType || "-"} | ${
                            row.itemCardCode || row.itemCardName || l("Item", "Kalem")
                          } | ${row.warehouseCode || row.warehouseName || l("Warehouse", "Depo")}`}
                          {row.documentLineNo ? ` | ${l("Line", "Satir")} ${row.documentLineNo}` : ""}
                          {row.inventoryValuationStatus ? ` | ${row.inventoryValuationStatus}` : ""}
                          {row.suggestedActionMessage ? ` | ${row.suggestedActionMessage}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {reverseMessage ? <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{reverseMessage}</div> : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
      <FixedAssetCategorySetupModal
        open={Boolean(fixedAssetCategorySetupPrompt)}
        l={l}
        categoryLabel={fixedAssetCategorySetupPrompt?.categoryLabel || ""}
        canReadSettings={canReadFixedAssetSettings}
        canUpsertSettings={canUpsertFixedAssetSettings}
        onClose={() => setFixedAssetCategorySetupPrompt(null)}
      />
      <FixedAssetQuickCreateModal
        open={quickCreateFixedAssetOpen}
        l={l}
        form={quickCreateFixedAssetForm}
        saving={quickCreateFixedAssetSaving}
        error={quickCreateFixedAssetError}
        legalEntityId={quickCreateSourceForm.legalEntityId}
        acquisitionDate={quickCreateSourceForm.documentDate}
        currencyCode={quickCreateSourceForm.currencyCode}
        categoryOptions={quickCreateCategoryOptions}
        operatingUnitOptions={quickCreateOperatingUnitOptions}
        categoriesById={quickCreateCategoriesById}
        onChange={patchQuickCreateFixedAssetForm}
        onClose={closeQuickCreateFixedAssetModal}
        onSave={handleQuickCreateFixedAssetSave}
      />
    </div>
  );
}
