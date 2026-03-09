import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  applyCariForCashTransaction,
  cancelCashTransaction,
  createCashTransaction,
  initiateCashTransitTransfer,
  listCashRegisters,
  listCashSessions,
  listCashTransactions,
  postCashTransaction,
  receiveCashTransitTransfer,
  reverseCashTransaction,
} from "../../api/cashAdmin.js";
import { listCariCounterparties } from "../../api/cariCounterparty.js";
import { getCariOpenItemsReport } from "../../api/cariReports.js";
import { listAccounts } from "../../api/glAdmin.js";
import { listJournalPurposeAccounts } from "../../api/glPurposeMappings.js";
import {
  createMeSavedView,
  deleteMeSavedView,
  listMeSavedViews,
  updateMeSavedView,
} from "../../api/me.js";
import { useAuth } from "../../auth/useAuth.js";
import MoneyText from "../../components/MoneyText.jsx";
import StatusTimeline from "../../components/StatusTimeline.jsx";
import TablePreferencesPanel from "../../components/TablePreferencesPanel.jsx";
import { useWorkingContextDefaults } from "../../context/useWorkingContextDefaults.js";
import { usePersistedFilters } from "../../hooks/usePersistedFilters.js";
import { usePersistedTablePrefs } from "../../hooks/usePersistedTablePrefs.js";
import { useToastMessage } from "../../hooks/useToastMessage.js";
import { useI18n } from "../../i18n/useI18n.js";
import {
  buildLifecycleTimelineSteps,
  getLifecycleAllowedActions,
  getLifecycleStatusMeta,
} from "../../lifecycle/lifecycleRules.js";
import { exportRowsAsCsv } from "../../utils/csvExport.js";
import { formatMoneyText } from "../../utils/money.js";
import CashControlModeBanner from "./CashControlModeBanner.jsx";

const MANUAL_TXN_TYPES = [
  "RECEIPT",
  "PAYOUT",
  "DEPOSIT_TO_BANK",
  "WITHDRAWAL_FROM_BANK",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "OPENING_FLOAT",
  "CLOSING_ADJUSTMENT",
];
const FILTER_TXN_TYPES = [...MANUAL_TXN_TYPES, "VARIANCE"];
const COUNTER_ACCOUNT_REQUIRED_TXN_TYPES = new Set([
  "RECEIPT",
  "PAYOUT",
  "OPENING_FLOAT",
  "CLOSING_ADJUSTMENT",
  "VARIANCE",
  "DEPOSIT_TO_BANK",
  "WITHDRAWAL_FROM_BANK",
]);
const TXN_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "POSTED", "REVERSED", "CANCELLED"];
const CANCELLABLE_STATUSES = new Set(["DRAFT", "SUBMITTED"]);
const POSTABLE_STATUSES = new Set(["DRAFT", "SUBMITTED", "APPROVED"]);
const COUNTERPARTY_TYPES = ["CUSTOMER", "VENDOR", "EMPLOYEE", "LEGAL_ENTITY", "OTHER"];
const SOURCE_DOC_TYPES = [
  "AP_PAYMENT",
  "AR_RECEIPT",
  "EXPENSE_CLAIM",
  "PETTY_CASH_VOUCHER",
  "BANK_DEPOSIT_SLIP",
  "OTHER",
];

const CARI_SETTLEMENT_LINKED_TXN_TYPES = new Set(["RECEIPT", "PAYOUT"]);
const CASH_REGISTER_SETUP_PATH = "/app/kasa-tanimlari";
const CASH_SESSION_SETUP_PATH = "/app/kasa-oturumlari";
const CASH_TRANSIT_CLEARING_PURPOSE_CODE = "CASH_TRANSIT_CLEARING";

const CASH_TRANSACTION_FILTER_CONTEXT_MAPPINGS = [
  { stateKey: "bookDateFrom", contextKey: "dateFrom" },
  { stateKey: "bookDateTo", contextKey: "dateTo" },
];
const CASH_TRANSACTION_FILTERS_STORAGE_SCOPE = "cash-transactions.filters";
const CASH_TRANSACTION_TABLE_PREFS_STORAGE_SCOPE = "cash-transactions.list.table";
const CASH_TRANSACTION_SAVED_VIEW_MODULE_CODE = "CASH_TRANSACTIONS_LIST";
const CASH_TRANSACTION_TEMPLATE_MODULE_CODE = "CASH_TRANSACTION_CREATE_TEMPLATES";
const CASH_TRANSACTION_TABLE_DEFAULT_ROWS_PER_PAGE = 50;
const CASH_TRANSACTION_TABLE_ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 200];
const CASH_TRANSACTION_PRESET_OPTIONS = [
  {
    code: "RECEIPT_STANDARD",
    label: "Receipt / Customer",
    patch: {
      txnType: "RECEIPT",
      sourceDocType: "AR_RECEIPT",
      counterpartyType: "CUSTOMER",
      description: "Customer receipt",
    },
  },
  {
    code: "PAYOUT_STANDARD",
    label: "Payout / Vendor",
    patch: {
      txnType: "PAYOUT",
      sourceDocType: "AP_PAYMENT",
      counterpartyType: "VENDOR",
      description: "Vendor payout",
    },
  },
  {
    code: "DEPOSIT_STANDARD",
    label: "Deposit To Bank",
    patch: {
      txnType: "DEPOSIT_TO_BANK",
      sourceDocType: "BANK_DEPOSIT_SLIP",
      counterpartyType: "",
      description: "Deposit to bank",
    },
  },
  {
    code: "WITHDRAWAL_STANDARD",
    label: "Withdrawal From Bank",
    patch: {
      txnType: "WITHDRAWAL_FROM_BANK",
      sourceDocType: "BANK_DEPOSIT_SLIP",
      counterpartyType: "",
      description: "Withdrawal from bank",
    },
  },
  {
    code: "TRANSFER_STANDARD",
    label: "Transfer Out",
    patch: {
      txnType: "TRANSFER_OUT",
      sourceDocType: "OTHER",
      counterpartyType: "",
      description: "Inter-register transfer",
    },
  },
];
const CASH_TRANSACTION_EXPORT_COLUMNS = [
  { header: "ID", value: (row) => row?.id },
  { header: "Transaction No", value: (row) => firstDefinedRowValue(row, "txn_no", "txnNo") },
  { header: "Transaction Type", value: (row) => firstDefinedRowValue(row, "txn_type", "txnType") },
  { header: "Status", value: (row) => row?.status },
  { header: "Register ID", value: (row) => firstDefinedRowValue(row, "cash_register_id", "cashRegisterId") },
  { header: "Register Code", value: (row) => firstDefinedRowValue(row, "cash_register_code", "cashRegisterCode") },
  { header: "Register Name", value: (row) => firstDefinedRowValue(row, "cash_register_name", "cashRegisterName") },
  { header: "Session ID", value: (row) => firstDefinedRowValue(row, "cash_session_id", "cashSessionId") },
  { header: "Book Date", value: (row) => firstDefinedRowValue(row, "book_date", "bookDate") },
  { header: "Amount", value: (row) => row?.amount },
  { header: "Currency", value: (row) => firstDefinedRowValue(row, "currency_code", "currencyCode") },
  { header: "Counterparty Type", value: (row) => firstDefinedRowValue(row, "counterparty_type", "counterpartyType") },
  { header: "Counterparty ID", value: (row) => firstDefinedRowValue(row, "counterparty_id", "counterpartyId") },
  { header: "Counter Account ID", value: (row) => firstDefinedRowValue(row, "counter_account_id", "counterAccountId") },
  { header: "Counter Account Code", value: (row) => firstDefinedRowValue(row, "counter_account_code", "counterAccountCode") },
  { header: "Counter Register ID", value: (row) => firstDefinedRowValue(row, "counter_cash_register_id", "counterCashRegisterId") },
  {
    header: "Transit Transfer ID",
    value: (row) => firstDefinedRowValue(row, "cash_transit_transfer_id", "cashTransitTransferId"),
  },
  {
    header: "Transit Status",
    value: (row) => firstDefinedRowValue(row, "cash_transit_status", "cashTransitStatus"),
  },
  {
    header: "Linked Settlement Batch ID",
    value: (row) =>
      firstDefinedRowValue(row, "linked_cari_settlement_batch_id", "linkedCariSettlementBatchId"),
  },
  {
    header: "Linked Unapplied Cash ID",
    value: (row) =>
      firstDefinedRowValue(row, "linked_cari_unapplied_cash_id", "linkedCariUnappliedCashId"),
  },
  {
    header: "Posted Journal Entry ID",
    value: (row) => firstDefinedRowValue(row, "posted_journal_entry_id", "postedJournalEntryId"),
  },
  { header: "Override Reason", value: (row) => firstDefinedRowValue(row, "override_reason", "overrideReason") },
  { header: "Created At", value: (row) => firstDefinedRowValue(row, "created_at", "createdAt") },
];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function firstDefinedRowValue(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key];
    }
  }
  return "";
}

function buildOwnershipContextLabel(
  row,
  l,
  {
    explicitKeys = ["ownership_context_label", "ownershipContextLabel"],
    operatingUnitCodeKeys = ["operating_unit_code", "operatingUnitCode"],
    operatingUnitIdKeys = ["operating_unit_id", "operatingUnitId"],
  } = {}
) {
  const explicit = String(firstDefinedRowValue(row, ...explicitKeys) || "").trim();
  if (
    explicit &&
    (explicit === "Central / HQ" || explicit === "Merkez / HQ" || explicit.startsWith("OU:"))
  ) {
    return explicit;
  }
  const operatingUnitCode = String(
    firstDefinedRowValue(row, ...operatingUnitCodeKeys) || ""
  ).trim();
  if (operatingUnitCode) {
    return `OU: ${operatingUnitCode}`;
  }
  const operatingUnitId = toPositiveInt(firstDefinedRowValue(row, ...operatingUnitIdKeys));
  if (operatingUnitId) {
    return `OU: ${operatingUnitId}`;
  }
  if (explicit) {
    return explicit;
  }
  return l("Central / HQ", "Merkez / HQ");
}

function formatRegisterDisplayLabel(
  row,
  l,
  {
    codeKeys = ["code", "cash_register_code", "cashRegisterCode"],
    idKeys = ["id", "cash_register_id", "cashRegisterId"],
    nameKeys = ["name", "cash_register_name", "cashRegisterName"],
    explicitOwnershipKeys,
    operatingUnitCodeKeys,
    operatingUnitIdKeys,
  } = {}
) {
  const code = String(firstDefinedRowValue(row, ...codeKeys) || "").trim();
  const name = String(firstDefinedRowValue(row, ...nameKeys) || "").trim();
  const fallbackId = firstDefinedRowValue(row, ...idKeys);
  const baseLabel = [code || fallbackId, name].filter(Boolean).join(" - ") || "-";
  return {
    baseLabel,
    ownershipContext: buildOwnershipContextLabel(row, l, {
      explicitKeys: explicitOwnershipKeys,
      operatingUnitCodeKeys,
      operatingUnitIdKeys,
    }),
  };
}

function formatSessionDisplayLabel(row, l) {
  const sessionId = toPositiveInt(
    firstDefinedRowValue(row, "id", "cash_session_id", "cashSessionId")
  );
  const registerLabel = formatRegisterDisplayLabel(row, l);
  return [`#${sessionId || "-"}`, registerLabel.baseLabel, registerLabel.ownershipContext]
    .filter(Boolean)
    .join(" | ");
}

function formatRegisterOptionText(row, l, options) {
  const registerLabel = formatRegisterDisplayLabel(row, l, options);
  return `${registerLabel.baseLabel} | ${registerLabel.ownershipContext}`;
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

function buildCashTransactionSavedViewDefinition({
  filters,
  baseFilters,
  tablePrefs,
  columnIds,
}) {
  return {
    version: 1,
    filters: {
      ...(baseFilters && typeof baseFilters === "object" ? baseFilters : {}),
      ...(filters && typeof filters === "object" ? filters : {}),
    },
    tablePrefs: {
      rowsPerPage:
        toPositiveInt(tablePrefs?.rowsPerPage) ||
        CASH_TRANSACTION_TABLE_DEFAULT_ROWS_PER_PAGE,
      stickyHeader: Boolean(tablePrefs?.stickyHeader),
      visibleColumnIds: normalizeVisibleColumnIds(
        tablePrefs?.visibleColumnIds,
        columnIds
      ),
    },
  };
}

function resolveCashTransactionSavedViewState({ savedView, baseFilters, columnIds }) {
  const definition =
    savedView?.definition && typeof savedView.definition === "object"
      ? savedView.definition
      : {};
  const filters = {
    ...(baseFilters && typeof baseFilters === "object" ? baseFilters : {}),
    ...(definition.filters && typeof definition.filters === "object"
      ? definition.filters
      : {}),
  };
  const tablePrefs = {
    rowsPerPage:
      toPositiveInt(definition?.tablePrefs?.rowsPerPage) ||
      CASH_TRANSACTION_TABLE_DEFAULT_ROWS_PER_PAGE,
    stickyHeader: Boolean(definition?.tablePrefs?.stickyHeader),
    visibleColumnIds: normalizeVisibleColumnIds(
      definition?.tablePrefs?.visibleColumnIds,
      columnIds
    ),
  };
  return { filters, tablePrefs };
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function isTransferTxnType(txnType) {
  const normalized = toUpper(txnType);
  return normalized === "TRANSFER_IN" || normalized === "TRANSFER_OUT";
}

function requiresCounterAccountTxnType(txnType) {
  return COUNTER_ACCOUNT_REQUIRED_TXN_TYPES.has(toUpper(txnType));
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatAccountOptionLabel(account) {
  return `${account?.code || account?.id || "-"} - ${account?.name || "-"}`;
}

function buildPurposeMappingMap(rows) {
  const byPurposeCode = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const purposeCode = toUpper(row?.purposeCode || row?.purpose_code);
    if (!purposeCode) {
      continue;
    }
    byPurposeCode[purposeCode] = row;
  }
  return byPurposeCode;
}

function isTransitLikeAccount(account) {
  const code = toUpper(account?.code);
  const name = toUpper(account?.name);
  return (
    code.startsWith("108") ||
    name.includes("TRANSIT") ||
    name.includes("TRANSFER") ||
    name.includes("CLEAR")
  );
}

function toDateTimeLocalInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function generateIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `cash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "-";
  }
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function resolvePresetTxnType(pathname) {
  const normalized = String(pathname || "");
  if (normalized.startsWith("/app/tediye-islemleri")) {
    return "PAYOUT";
  }
  if (normalized.startsWith("/app/tahsilat-islemleri")) {
    return "RECEIPT";
  }
  return null;
}

function resolveCariDirection(txnType) {
  const normalized = toUpper(txnType);
  if (normalized === "RECEIPT") {
    return "AR";
  }
  if (normalized === "PAYOUT") {
    return "AP";
  }
  return null;
}

function resolveExpectedCounterpartyType(txnType) {
  const normalized = toUpper(txnType);
  if (normalized === "RECEIPT") {
    return "CUSTOMER";
  }
  if (normalized === "PAYOUT") {
    return "VENDOR";
  }
  return null;
}

function buildApplyCariIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `cash-apply-${globalThis.crypto.randomUUID()}`;
  }
  return `cash-apply-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildTransitReceiveIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `cash-transit-receive-${globalThis.crypto.randomUUID()}`;
  }
  return `cash-transit-receive-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isCrossOuRegisterPair(sourceRegister, targetRegister) {
  const sourceOu = toPositiveInt(sourceRegister?.operating_unit_id);
  const targetOu = toPositiveInt(targetRegister?.operating_unit_id);
  return sourceOu !== targetOu && Boolean(sourceOu || targetOu);
}

function buildInitialForm(presetTxnType) {
  return {
    registerId: "",
    cashSessionId: "",
    txnType: presetTxnType || "RECEIPT",
    txnDatetime: toDateTimeLocalInput(),
    bookDate: "",
    amount: "",
    currencyCode: "",
    description: "",
    referenceNo: "",
    sourceDocType: "",
    sourceDocId: "",
    counterpartyType: "",
    counterpartyId: "",
    counterAccountId: "",
    counterCashRegisterId: "",
  };
}

function buildInitialFilters(presetTxnType) {
  return {
    registerId: "",
    sessionId: "",
    txnType: presetTxnType || "",
    status: "",
    bookDateFrom: "",
    bookDateTo: "",
  };
}

function normalizePositiveIntText(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "";
}

function normalizeOptionalDecimalText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const text = String(value).trim();
  if (!text) {
    return "";
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function buildCashTransactionTemplateSafeForm(input = {}, presetTxnType = null) {
  const baseline = buildInitialForm(presetTxnType);
  const candidateTxnType = toUpper(input?.txnType || baseline.txnType);
  const txnType = presetTxnType
    ? toUpper(presetTxnType)
    : MANUAL_TXN_TYPES.includes(candidateTxnType)
      ? candidateTxnType
      : baseline.txnType;
  const isTransfer = txnType === "TRANSFER_IN" || txnType === "TRANSFER_OUT";
  const requiresCounterAccount = requiresCounterAccountTxnType(txnType);
  const expectedCounterpartyType = resolveExpectedCounterpartyType(txnType);
  const nextCounterpartyType = toUpper(input?.counterpartyType || "");

  const next = {
    registerId: normalizePositiveIntText(input?.registerId),
    cashSessionId: normalizePositiveIntText(input?.cashSessionId),
    txnType,
    txnDatetime: String(input?.txnDatetime || "").trim() || baseline.txnDatetime,
    bookDate: String(input?.bookDate || "").trim() || baseline.bookDate,
    amount: normalizeOptionalDecimalText(input?.amount),
    currencyCode: toUpper(input?.currencyCode || "") || baseline.currencyCode,
    description: String(input?.description || "").trim(),
    referenceNo: String(input?.referenceNo || "").trim(),
    sourceDocType: SOURCE_DOC_TYPES.includes(toUpper(input?.sourceDocType))
      ? toUpper(input?.sourceDocType)
      : "",
    sourceDocId: String(input?.sourceDocId || "").trim(),
    counterpartyType: COUNTERPARTY_TYPES.includes(nextCounterpartyType)
      ? nextCounterpartyType
      : "",
    counterpartyId: normalizePositiveIntText(input?.counterpartyId),
    counterAccountId: normalizePositiveIntText(input?.counterAccountId),
    counterCashRegisterId: normalizePositiveIntText(input?.counterCashRegisterId),
  };

  if (!isTransfer) {
    next.counterCashRegisterId = "";
  }
  if (!requiresCounterAccount && !isTransfer) {
    next.counterAccountId = "";
  }
  if (isTransfer) {
    next.counterpartyType = "";
    next.counterpartyId = "";
  }
  if (expectedCounterpartyType) {
    if (next.counterpartyType !== expectedCounterpartyType) {
      next.counterpartyType = expectedCounterpartyType;
      next.counterpartyId = "";
    }
  }

  return { ...baseline, ...next };
}

function buildCashTransactionTemplateDefinition({ form }) {
  return {
    version: 1,
    createForm: buildCashTransactionTemplateSafeForm(form),
  };
}

function buildCapitalFulfillmentTransitPrefill(search, presetTxnType = null) {
  const params = new URLSearchParams(String(search || ""));
  const prefillMode = toUpper(
    params.get("prefillMode") || params.get("prefill_mode") || params.get("shortcut")
  );
  if (prefillMode !== "CAPITAL_FULFILLMENT_TRANSIT") {
    return null;
  }

  const registerId =
    params.get("registerId") ||
    params.get("sourceRegisterId") ||
    params.get("source_register_id");
  const counterCashRegisterId =
    params.get("counterCashRegisterId") ||
    params.get("counter_cash_register_id") ||
    params.get("targetRegisterId") ||
    params.get("target_register_id");
  const amount = params.get("amount");
  const currencyCode = params.get("currencyCode") || params.get("currency_code");
  const referenceNo = params.get("referenceNo") || params.get("reference_no");
  const description = params.get("description");
  const bookDate = params.get("bookDate") || params.get("book_date");
  const sourceDocType =
    params.get("sourceDocType") || params.get("source_doc_type") || "OTHER";
  const sourceDocId = params.get("sourceDocId") || params.get("source_doc_id");
  const fulfillmentId = String(
    params.get("fulfillmentId") || params.get("fulfillment_id") || ""
  ).trim();
  const sourceRegisterCode = String(params.get("sourceRegisterCode") || "").trim();
  const targetRegisterCode = String(params.get("targetRegisterCode") || "").trim();

  return {
    prefillKey: [
      prefillMode,
      registerId,
      counterCashRegisterId,
      amount,
      currencyCode,
      referenceNo,
      description,
      bookDate,
      sourceDocId,
      fulfillmentId,
    ].join("|"),
    fulfillmentId,
    sourceRegisterCode,
    targetRegisterCode,
    form: buildCashTransactionTemplateSafeForm(
      {
        txnType: presetTxnType || "TRANSFER_OUT",
        registerId,
        counterCashRegisterId,
        amount,
        currencyCode,
        referenceNo,
        description,
        bookDate,
        sourceDocType,
        sourceDocId,
      },
      presetTxnType
    ),
  };
}

function resolveCashTransactionTemplateState(savedView, presetTxnType = null) {
  const definition =
    savedView?.definition && typeof savedView.definition === "object"
      ? savedView.definition
      : {};
  const createForm =
    definition?.createForm && typeof definition.createForm === "object"
      ? definition.createForm
      : {};
  return {
    form: buildCashTransactionTemplateSafeForm(createForm, presetTxnType),
  };
}

function buildUserActorLabel(userId) {
  const parsed = toPositiveInt(userId);
  return parsed ? `User #${parsed}` : null;
}

function buildCashTransactionLifecycleEvents(row, t) {
  if (!row) {
    return [];
  }
  const status = toUpper(row?.status);
  const createdAt = row?.created_at || row?.createdAt || null;
  const submittedAt = row?.submitted_at || row?.submittedAt || null;
  const approvedAt = row?.approved_at || row?.approvedAt || null;
  const postedAt = row?.posted_at || row?.postedAt || null;
  const cancelledAt = row?.cancelled_at || row?.cancelledAt || null;
  const reversedAt = row?.reversed_at || row?.reversedAt || null;
  const updatedAt = row?.updated_at || row?.updatedAt || null;

  const createdByUserId = row?.created_by_user_id || row?.createdByUserId;
  const submittedByUserId = row?.submitted_by_user_id || row?.submittedByUserId;
  const approvedByUserId = row?.approved_by_user_id || row?.approvedByUserId;
  const postedByUserId = row?.posted_by_user_id || row?.postedByUserId;
  const cancelledByUserId = row?.cancelled_by_user_id || row?.cancelledByUserId;
  const reversedByUserId = row?.reversed_by_user_id || row?.reversedByUserId;

  const events = [];
  if (createdAt) {
    events.push({
      statusCode: "DRAFT",
      at: createdAt,
      actorName: buildUserActorLabel(createdByUserId),
      note: t("cashTransactions.lifecycle.events.draft"),
    });
  }
  if (submittedAt) {
    events.push({
      statusCode: "SUBMITTED",
      at: submittedAt,
      actorName: buildUserActorLabel(submittedByUserId),
      note: t("cashTransactions.lifecycle.events.submitted"),
    });
  }
  if (approvedAt) {
    events.push({
      statusCode: "APPROVED",
      at: approvedAt,
      actorName: buildUserActorLabel(approvedByUserId),
      note: t("cashTransactions.lifecycle.events.approved"),
    });
  }
  if (postedAt) {
    events.push({
      statusCode: "POSTED",
      at: postedAt,
      actorName: buildUserActorLabel(postedByUserId),
      note: t("cashTransactions.lifecycle.events.posted"),
    });
  }
  if (status === "CANCELLED") {
    events.push({
      statusCode: "CANCELLED",
      at: cancelledAt || updatedAt || createdAt,
      actorName: buildUserActorLabel(cancelledByUserId),
      note: String(row?.cancel_reason || row?.cancelReason || "").trim() || t("cashTransactions.lifecycle.events.cancelled"),
    });
  }
  if (status === "REVERSED") {
    events.push({
      statusCode: "REVERSED",
      at: reversedAt || updatedAt || postedAt,
      actorName: buildUserActorLabel(reversedByUserId),
      note: String(row?.reverse_reason || row?.reverseReason || "").trim() || t("cashTransactions.lifecycle.events.reversed"),
    });
  }
  return events;
}

function statusClassName(status) {
  const normalized = toUpper(status);
  if (normalized === "POSTED") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized === "REVERSED") {
    return "bg-violet-100 text-violet-700";
  }
  if (normalized === "CANCELLED") {
    return "bg-rose-100 text-rose-700";
  }
  if (normalized === "APPROVED" || normalized === "SUBMITTED") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-slate-200 text-slate-700";
}

function normalizeErrorMessage(value) {
  return String(value || "").trim();
}

function extractRequestId(err) {
  return (
    err?.response?.data?.requestId ||
    err?.response?.headers?.["x-request-id"] ||
    null
  );
}

function mapTransactionErrorMessage(rawMessage, t) {
  const message = normalizeErrorMessage(rawMessage);
  if (!message) {
    return "";
  }

  const lower = message.toLowerCase();
  if (lower.includes("registerid not found for tenant")) {
    return t("cashTransactions.errorsMapped.registerNotFound");
  }
  if (lower.includes("cashsessionid not found for tenant")) {
    return t("cashTransactions.errorsMapped.sessionNotFound");
  }
  if (lower.includes("cashsessionid must belong to registerid")) {
    return t("cashTransactions.errorsMapped.sessionRegisterMismatch");
  }
  if (lower.includes("cashsessionid must be open")) {
    return t("cashTransactions.errorsMapped.sessionNotOpen");
  }
  if (lower.includes("countercashregisterid not found for tenant")) {
    return t("cashTransactions.errorsMapped.counterRegisterNotFound");
  }
  if (
    lower.includes("requires counteraccountid") ||
    lower.includes("counteraccountid is required")
  ) {
    return t("cashTransactions.errors.counterAccountRequired");
  }
  if (lower.includes("counteraccountid not found for tenant")) {
    return t("cashTransactions.errorsMapped.counterAccountInvalid");
  }
  if (lower.includes("an open cash session is required for this register")) {
    return t("cashTransactions.errors.sessionRequiredNoOpen");
  }
  if (lower.includes("posting requires an open cash session")) {
    return t("cashTransactions.errorsMapped.postRequiresOpenSession");
  }
  if (lower.includes("posting requires cash_session_id to be open")) {
    return t("cashTransactions.errorsMapped.sessionNotOpen");
  }
  if (lower.includes("cash register is not active")) {
    return t("cashTransactions.errors.registerInactive");
  }
  if (
    lower.includes("cash transit workflow requires") ||
    lower.includes("cash_in_transit workflow")
  ) {
    return t("cashTransactions.errorsMapped.transitSourceTargetOuMismatch");
  }
  if (lower.includes("cross-legal-entity cash transit transfer is not supported")) {
    return t("cashTransactions.errorsMapped.transitCrossLegalEntityNotSupported");
  }
  if (lower.includes("must be in_transit before receive")) {
    return t("cashTransactions.errorsMapped.transitMustBeInTransitBeforeReceive");
  }
  if (lower.includes("must be posted before receive")) {
    return t("cashTransactions.errorsMapped.transitTransferOutMustBePostedBeforeReceive");
  }
  if (lower.includes("already received or not in transit")) {
    return t("cashTransactions.errorsMapped.transitAlreadyReceived");
  }
  if (lower.includes("cannot reverse transfer-out after transit is received")) {
    return t("cashTransactions.errorsMapped.transitReverseTransferInFirst");
  }
  if (lower.includes("transaction currency must match register currency")) {
    return t("cashTransactions.errorsMapped.currencyMismatchGeneric");
  }
  if (lower.includes("amount exceeds register max_txn_amount")) {
    return t("cashTransactions.errorsMapped.maxAmountExceededGeneric");
  }
  if (lower.includes("only draft or submitted transactions can be cancelled")) {
    return t("cashTransactions.errors.cancelStatusInvalid");
  }
  if (lower.includes("only draft, submitted, or approved transactions can be posted")) {
    return t("cashTransactions.errors.postStatusInvalid");
  }
  if (lower.includes("only posted transactions can be reversed")) {
    return t("cashTransactions.errors.reverseStatusInvalid");
  }
  if (lower.includes("reversal transactions cannot be reversed")) {
    return t("cashTransactions.errors.reverseReversalNotAllowed");
  }
  if (lower.includes("cash transaction not found")) {
    return t("cashTransactions.errorsMapped.transactionNotFound");
  }
  if (lower.includes("overridereason is required when overridecashcontrol=true")) {
    return t("cashTransactions.errors.overrideReasonRequired");
  }
  if (lower.includes("duplicate transaction idempotency key")) {
    return t("cashTransactions.errorsMapped.idempotencyDuplicate");
  }
  if (lower.includes("can only be system-generated")) {
    return t("cashTransactions.errorsMapped.systemGeneratedOnly");
  }
  if (lower.includes("must be posted before applying cari settlement")) {
    return t("cashTransactions.errorsMapped.applyRequiresPostedTxn");
  }
  if (lower.includes("must include counterpartytype")) {
    return t("cashTransactions.errorsMapped.applyCounterpartyInvalid");
  }
  if (lower.includes("total allocations exceed incoming + unapplied available funds")) {
    return t("cashTransactions.errorsMapped.applyTotalExceedsAvailable");
  }
  if (lower.includes("applications amount exceeds available residual")) {
    return t("cashTransactions.errorsMapped.applyOpenItemResidualExceeded");
  }
  if (lower.includes("no open items available")) {
    return t("cashTransactions.errorsMapped.applyNoOpenDocs");
  }
  if (lower.includes("already linked to another cari settlement")) {
    return t("cashTransactions.errorsMapped.applyAlreadyLinked");
  }

  return "";
}

function toTransactionErrorState(err, t, fallbackKey) {
  const requestId = extractRequestId(err);
  const rawMessage = normalizeErrorMessage(
    err?.response?.data?.message || err?.message
  );
  const mappedMessage = mapTransactionErrorMessage(rawMessage, t);
  const fallbackMessage = t(fallbackKey);
  return {
    message: mappedMessage || (rawMessage ? `${fallbackMessage} (${rawMessage})` : fallbackMessage),
    requestId,
  };
}

export default function CashTransactionsPage() {
  const { pathname, search } = useLocation();
  const { hasPermission } = useAuth();
  const { language, t } = useI18n();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const localizeTxnStatus = (status) => {
    const normalized = toUpper(status);
    if (!normalized) {
      return "-";
    }
    if (normalized === "DRAFT") {
      return t("cashTransactions.values.statusDraft");
    }
    if (normalized === "SUBMITTED") {
      return t("cashTransactions.values.statusSubmitted");
    }
    if (normalized === "APPROVED") {
      return t("cashTransactions.values.statusApproved");
    }
    if (normalized === "POSTED") {
      return t("cashTransactions.values.statusPosted");
    }
    if (normalized === "REVERSED") {
      return t("cashTransactions.values.statusReversed");
    }
    if (normalized === "CANCELLED" || normalized === "CANCELED") {
      return t("cashTransactions.values.statusCancelled");
    }
    return normalized;
  };
  const localizeTransitStatus = (status) => {
    const normalized = toUpper(status);
    if (!normalized) {
      return "?";
    }
    if (normalized === "INITIATED") {
      return t("cashTransactions.values.transitStatusInitiated");
    }
    if (normalized === "IN_TRANSIT") {
      return t("cashTransactions.values.transitStatusInTransit");
    }
    if (normalized === "RECEIVED") {
      return t("cashTransactions.values.transitStatusReceived");
    }
    if (normalized === "CANCELED" || normalized === "CANCELLED") {
      return t("cashTransactions.values.transitStatusCanceled");
    }
    if (normalized === "REVERSED") {
      return t("cashTransactions.values.transitStatusReversed");
    }
    return normalized;
  };

  const presetTxnType = useMemo(() => resolvePresetTxnType(pathname), [pathname]);
  const capitalFulfillmentTransitPrefill = useMemo(
    () => buildCapitalFulfillmentTransitPrefill(search, presetTxnType),
    [presetTxnType, search]
  );
  const canRead = hasPermission("cash.txn.read");
  const canCreate = hasPermission("cash.txn.create");
  const canPost = hasPermission("cash.txn.post");
  const canCancel = hasPermission("cash.txn.cancel");
  const canReverse = hasPermission("cash.txn.reverse");
  const canOverridePost = hasPermission("cash.override.post");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadCariCards = hasPermission("cari.card.read");
  const canReadCariReports = hasPermission("cari.report.read");
  const canApplyCari = hasPermission("cari.settlement.apply");

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionSaving, setActionSaving] = useState(false);
  const [error, setError] = useState("");
  const [errorRequestId, setErrorRequestId] = useState(null);
  const [message, setMessage] = useToastMessage("", { toastType: "success" });
  const [infoMessage, setInfoMessage] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");
  const [accountLookupWarning, setAccountLookupWarning] = useState("");

  const [rows, setRows] = useState([]);
  const [registers, setRegisters] = useState([]);
  const [openSessions, setOpenSessions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [filters, setFilters, resetFilters] = usePersistedFilters(
    CASH_TRANSACTION_FILTERS_STORAGE_SCOPE,
    () => buildInitialFilters(presetTxnType)
  );
  const [form, setForm] = useState(buildInitialForm(presetTxnType));
  const [actionForm, setActionForm] = useState(null);
  const [selectedLifecycleTransactionId, setSelectedLifecycleTransactionId] = useState(null);
  const [counterpartyQuery, setCounterpartyQuery] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [counterpartyOptions, setCounterpartyOptions] = useState([]);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);
  const [counterpartyWarning, setCounterpartyWarning] = useState("");
  const [applyOpenItems, setApplyOpenItems] = useState([]);
  const [applyOpenItemsLoading, setApplyOpenItemsLoading] = useState(false);
  const [applyOpenItemsError, setApplyOpenItemsError] = useState("");
  const [transactionListPage, setTransactionListPage] = useState(1);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsSaving, setSavedViewsSaving] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState("");
  const [savedViewsMessage, setSavedViewsMessage] = useState("");
  const [savedViews, setSavedViews] = useState([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [defaultSavedViewHydrated, setDefaultSavedViewHydrated] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesSaving, setTemplatesSaving] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [templatesMessage, setTemplatesMessage] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [defaultTemplateHydrated, setDefaultTemplateHydrated] = useState(false);
  const [selectedPresetCode, setSelectedPresetCode] = useState("");
  const [cashPurposeMappingsByPurpose, setCashPurposeMappingsByPurpose] = useState({});
  const lastSuggestedCounterAccountIdRef = useRef(null);
  const appliedCapitalFulfillmentTransitPrefillRef = useRef("");

  useWorkingContextDefaults(setFilters, CASH_TRANSACTION_FILTER_CONTEXT_MAPPINGS, [
    filters.bookDateFrom,
    filters.bookDateTo,
  ]);

  const registerOptions = useMemo(
    () =>
      [...registers].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [registers]
  );
  const accountOptions = useMemo(
    () =>
      [...accounts]
        .filter((row) => parseDbBoolean(row?.allow_posting) && parseDbBoolean(row?.is_active))
        .sort((a, b) => String(a?.code || "").localeCompare(String(b?.code || ""))),
    [accounts]
  );
  const selectedRegister = useMemo(() => {
    const registerId = toPositiveInt(form.registerId);
    if (!registerId) {
      return null;
    }
    return registers.find((row) => toPositiveInt(row?.id) === registerId) || null;
  }, [form.registerId, registers]);
  const selectedCounterRegister = useMemo(() => {
    const registerId = toPositiveInt(form.counterCashRegisterId);
    if (!registerId) {
      return null;
    }
    return registers.find((row) => toPositiveInt(row?.id) === registerId) || null;
  }, [form.counterCashRegisterId, registers]);
  const showCounterpartyFields = !isTransferTxnType(form.txnType);
  const selectedIsCrossOuTransfer = useMemo(() => {
    return isCrossOuRegisterPair(selectedRegister, selectedCounterRegister);
  }, [selectedCounterRegister, selectedRegister]);
  const selectedRegisterDisplay = useMemo(
    () => (selectedRegister ? formatRegisterDisplayLabel(selectedRegister, l) : null),
    [l, selectedRegister]
  );
  const selectedCounterRegisterDisplay = useMemo(
    () =>
      selectedCounterRegister ? formatRegisterDisplayLabel(selectedCounterRegister, l) : null,
    [l, selectedCounterRegister]
  );
  const selectedTransferRouteMeta = useMemo(() => {
    if (!isTransferTxnType(form.txnType) || !selectedRegisterDisplay) {
      return null;
    }
    if (!selectedCounterRegisterDisplay) {
      return {
        modeLabel: l("Select target register", "Hedef kasa secin"),
        routeLabel: selectedRegisterDisplay.ownershipContext,
        description: l(
          "Select the target register to confirm whether this move stays direct or must use transit.",
          "Bu hareketin dogrudan mi kalacagini yoksa transit mi kullanacagini onaylamak icin hedef kasayi secin."
        ),
      };
    }
    if (selectedIsCrossOuTransfer) {
      return {
        modeLabel: l("Transit workflow required", "Transit akisi zorunlu"),
        routeLabel: `${selectedRegisterDisplay.ownershipContext} -> ${selectedCounterRegisterDisplay.ownershipContext}`,
        description:
          toUpper(form.txnType) === "TRANSFER_IN"
            ? l(
                "Different operating-unit contexts must be completed from Transit Receive instead of creating TRANSFER_IN directly.",
                "Farkli operating-unit baglamlari, TRANSFER_IN kaydini dogrudan olusturmak yerine Transit Receive ile tamamlanmalidir."
              )
            : l(
                "Different operating-unit contexts route through cash transit. Creating TRANSFER_OUT starts the transit workflow instead of a direct register-to-register post.",
                "Farkli operating-unit baglamlari kasa transitinden gecer. TRANSFER_OUT olusturma, dogrudan register'dan register'a post yerine transit akislarini baslatir."
              ),
      };
    }
    return {
      modeLabel: l("Direct transfer", "Dogrudan transfer"),
      routeLabel: `${selectedRegisterDisplay.ownershipContext} -> ${selectedCounterRegisterDisplay.ownershipContext}`,
      description: l(
        "Source and target share the same ownership context, so the transfer can be created directly on this screen.",
        "Kaynak ve hedef ayni sahiplik baglamini paylastigi icin transfer bu ekranda dogrudan olusturulabilir."
      ),
    };
  }, [
    form.txnType,
    l,
    selectedCounterRegisterDisplay,
    selectedIsCrossOuTransfer,
    selectedRegisterDisplay,
  ]);
  const selectedRegisterLegalEntityId = useMemo(
    () => toPositiveInt(selectedRegister?.legal_entity_id),
    [selectedRegister]
  );
  const scopedAccountOptions = accountOptions;
  const counterAccountIsTransfer = isTransferTxnType(form.txnType);
  const counterAccountIsRequired =
    requiresCounterAccountTxnType(form.txnType) || selectedIsCrossOuTransfer;
  const counterAccountNeedsLookup =
    requiresCounterAccountTxnType(form.txnType) || counterAccountIsTransfer;
  const showCounterAccountPicker =
    canReadAccounts && counterAccountNeedsLookup;
  const counterAccountPickerDisabled = !selectedRegisterLegalEntityId;
  const filteredCounterAccountOptions = useMemo(() => {
    const normalizedQuery = toUpper(accountQuery);
    const filtered = normalizedQuery
      ? scopedAccountOptions.filter((row) => {
          const haystack = `${row?.code || ""} ${row?.name || ""} ${row?.id || ""}`;
          return toUpper(haystack).includes(normalizedQuery);
        })
      : [...scopedAccountOptions];

    return filtered.sort((a, b) => {
      if (counterAccountIsTransfer) {
        const transitRankA = isTransitLikeAccount(a) ? 0 : 1;
        const transitRankB = isTransitLikeAccount(b) ? 0 : 1;
        if (transitRankA !== transitRankB) {
          return transitRankA - transitRankB;
        }
      }
      return String(a?.code || "").localeCompare(String(b?.code || ""));
    });
  }, [scopedAccountOptions, accountQuery, counterAccountIsTransfer]);
  const combinedLookupWarning = useMemo(
    () => [lookupWarning, accountLookupWarning].filter(Boolean).join(" "),
    [accountLookupWarning, lookupWarning]
  );
  const selectedRegisterId = useMemo(() => toPositiveInt(form.registerId), [form.registerId]);
  const selectedRegisterOpenSessions = useMemo(() => {
    if (!selectedRegisterId) {
      return [];
    }
    return openSessions.filter(
      (row) => toPositiveInt(row?.cash_register_id) === selectedRegisterId
    );
  }, [selectedRegisterId, openSessions]);
  const selectedRegisterSessionMode = toUpper(selectedRegister?.session_mode);
  const sessionModeRequiresSession = selectedRegisterSessionMode === "REQUIRED";
  const sessionModeDisablesSession = selectedRegisterSessionMode === "NONE";
  const createSessionPlaceholder = useMemo(() => {
    if (!selectedRegisterId) {
      return t("cashTransactions.placeholders.sessionSelectRegisterFirst");
    }
    if (sessionModeDisablesSession) {
      return t("cashTransactions.placeholders.sessionNotUsed");
    }
    if (sessionModeRequiresSession) {
      return t("cashTransactions.placeholders.sessionRequired");
    }
    return t("cashTransactions.placeholders.sessionOptional");
  }, [
    selectedRegisterId,
    sessionModeDisablesSession,
    sessionModeRequiresSession,
    t,
  ]);
  const createSessionManualPlaceholder = useMemo(() => {
    if (!selectedRegisterId) {
      return t("cashTransactions.form.cashSessionIdSelectRegisterFirst");
    }
    if (sessionModeDisablesSession) {
      return t("cashTransactions.form.cashSessionIdNotUsed");
    }
    if (sessionModeRequiresSession) {
      return t("cashTransactions.form.cashSessionIdRequiredManualFallback");
    }
    return t("cashTransactions.form.cashSessionIdManualFallback");
  }, [
    selectedRegisterId,
    sessionModeDisablesSession,
    sessionModeRequiresSession,
    t,
  ]);
  const selectedActionRow = useMemo(() => {
    const transactionId = toPositiveInt(actionForm?.transactionId);
    if (!transactionId) {
      return null;
    }
    return rows.find((row) => toPositiveInt(row?.id) === transactionId) || null;
  }, [actionForm?.transactionId, rows]);
  const selectedLifecycleTransactionRow = useMemo(() => {
    const transactionId = toPositiveInt(
      selectedLifecycleTransactionId || actionForm?.transactionId
    );
    if (!transactionId) {
      return null;
    }
    return rows.find((row) => toPositiveInt(row?.id) === transactionId) || null;
  }, [actionForm?.transactionId, rows, selectedLifecycleTransactionId]);
  const selectedTransitTargetOpenSessions = useMemo(() => {
    if (actionForm?.type !== "receiveTransit") {
      return [];
    }
    const targetRegisterId = toPositiveInt(
      selectedActionRow?.cash_transit_target_register_id || selectedActionRow?.counter_cash_register_id
    );
    if (!targetRegisterId) {
      return [];
    }
    return openSessions.filter(
      (row) => toPositiveInt(row?.cash_register_id) === targetRegisterId
    );
  }, [actionForm?.type, openSessions, selectedActionRow]);
  const selectedCounterpartyOption = useMemo(() => {
    const counterpartyId = toPositiveInt(form.counterpartyId);
    if (!counterpartyId) {
      return null;
    }
    return counterpartyOptions.find((row) => toPositiveInt(row?.id) === counterpartyId) || null;
  }, [counterpartyOptions, form.counterpartyId]);
  const selectedCounterAccountOption = useMemo(() => {
    const accountId = toPositiveInt(form.counterAccountId);
    if (!accountId) {
      return null;
    }
    return scopedAccountOptions.find((row) => toPositiveInt(row?.id) === accountId) || null;
  }, [scopedAccountOptions, form.counterAccountId]);
  const selectedCounterAccountLegalEntityId = useMemo(
    () =>
      toPositiveInt(
        selectedCounterAccountOption?.legal_entity_id ?? selectedCounterAccountOption?.legalEntityId
      ),
    [selectedCounterAccountOption]
  );
  const defaultTransitCounterAccountId = useMemo(
    () =>
      toPositiveInt(
        cashPurposeMappingsByPurpose[CASH_TRANSIT_CLEARING_PURPOSE_CODE]?.accountId ||
          cashPurposeMappingsByPurpose[CASH_TRANSIT_CLEARING_PURPOSE_CODE]?.account_id
      ),
    [cashPurposeMappingsByPurpose]
  );
  const counterpartyPickerReady = canReadCariCards && toPositiveInt(selectedRegister?.legal_entity_id);
  const counterpartyFallbackHint = useMemo(() => {
    if (counterpartyPickerReady) {
      return "";
    }
    if (!canReadCariCards) {
      return t("cashTransactions.warnings.counterpartyPickerPermissionMissing");
    }
    if (!selectedRegisterId) {
      return t("cashTransactions.warnings.counterpartyPickerNeedsRegister");
    }
    return t("cashTransactions.warnings.counterpartyPickerNeedsLegalEntity");
  }, [canReadCariCards, counterpartyPickerReady, selectedRegisterId, t]);
  const sessionFallbackHint = useMemo(() => {
    if (!selectedRegisterId) {
      return t("cashTransactions.warnings.sessionPickerNeedsRegister");
    }
    if (sessionModeDisablesSession) {
      return t("cashTransactions.warnings.sessionModeNone");
    }
    if (selectedRegisterOpenSessions.length === 0) {
      if (sessionModeRequiresSession) {
        return t("cashTransactions.warnings.sessionRequiredNoOpen");
      }
      return t("cashTransactions.warnings.noOpenSessionForRegister");
    }
    return "";
  }, [
    selectedRegisterId,
    selectedRegisterOpenSessions.length,
    sessionModeDisablesSession,
    sessionModeRequiresSession,
    t,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadCashPurposeMappings() {
      if (!selectedRegisterLegalEntityId) {
        setCashPurposeMappingsByPurpose({});
        return;
      }
      try {
        const response = await listJournalPurposeAccounts({
          legalEntityId: selectedRegisterLegalEntityId,
          moduleKey: "CASH",
        });
        if (cancelled) {
          return;
        }
        setCashPurposeMappingsByPurpose(buildPurposeMappingMap(response?.rows || []));
      } catch {
        if (!cancelled) {
          setCashPurposeMappingsByPurpose({});
        }
      }
    }

    loadCashPurposeMappings();
    return () => {
      cancelled = true;
    };
  }, [selectedRegisterLegalEntityId]);

  useEffect(() => {
    const previousSuggestedCounterAccountId = toPositiveInt(
      lastSuggestedCounterAccountIdRef.current
    );
    const nextSuggestedCounterAccountId = defaultTransitCounterAccountId;

    if (!counterAccountIsTransfer) {
      setForm((prev) => {
        const currentCounterAccountId = toPositiveInt(prev.counterAccountId);
        if (
          previousSuggestedCounterAccountId &&
          currentCounterAccountId === previousSuggestedCounterAccountId
        ) {
          return {
            ...prev,
            counterAccountId: "",
          };
        }
        return prev;
      });
      lastSuggestedCounterAccountIdRef.current = null;
      return;
    }

    if (!selectedRegisterLegalEntityId) {
      lastSuggestedCounterAccountIdRef.current = null;
      return;
    }

    setForm((prev) => {
      const currentCounterAccountId = toPositiveInt(prev.counterAccountId);
      const currentBelongsToSelectedLegalEntity =
        !currentCounterAccountId ||
        selectedCounterAccountLegalEntityId === selectedRegisterLegalEntityId;

      if (!currentBelongsToSelectedLegalEntity) {
        return {
          ...prev,
          counterAccountId: nextSuggestedCounterAccountId
            ? String(nextSuggestedCounterAccountId)
            : "",
        };
      }

      if (!nextSuggestedCounterAccountId) {
        if (
          previousSuggestedCounterAccountId &&
          currentCounterAccountId === previousSuggestedCounterAccountId
        ) {
          return {
            ...prev,
            counterAccountId: "",
          };
        }
        return prev;
      }

      if (
        !currentCounterAccountId ||
        (previousSuggestedCounterAccountId &&
          currentCounterAccountId === previousSuggestedCounterAccountId)
      ) {
        if (currentCounterAccountId === nextSuggestedCounterAccountId) {
          return prev;
        }
        return {
          ...prev,
          counterAccountId: String(nextSuggestedCounterAccountId),
        };
      }

      return prev;
    });

    lastSuggestedCounterAccountIdRef.current = nextSuggestedCounterAccountId
      ? String(nextSuggestedCounterAccountId)
      : null;
  }, [
    counterAccountIsTransfer,
    defaultTransitCounterAccountId,
    selectedCounterAccountLegalEntityId,
    selectedRegisterLegalEntityId,
  ]);

  useEffect(() => {
    const currentSessionId = toPositiveInt(form.cashSessionId);

    if (!selectedRegisterId) {
      if (currentSessionId) {
        setForm((prev) => ({ ...prev, cashSessionId: "" }));
      }
      return;
    }

    if (sessionModeDisablesSession) {
      if (currentSessionId) {
        setForm((prev) => ({ ...prev, cashSessionId: "" }));
      }
      return;
    }

    const hasSelectedOpenSession =
      currentSessionId &&
      selectedRegisterOpenSessions.some(
        (row) => toPositiveInt(row?.id) === currentSessionId
      );
    if (hasSelectedOpenSession) {
      return;
    }

    if (sessionModeRequiresSession) {
      const defaultOpenSessionId = toPositiveInt(selectedRegisterOpenSessions[0]?.id);
      if (defaultOpenSessionId) {
        setForm((prev) => {
          const prevSessionId = toPositiveInt(prev.cashSessionId);
          if (prevSessionId === defaultOpenSessionId) {
            return prev;
          }
          return { ...prev, cashSessionId: String(defaultOpenSessionId) };
        });
      }
    }
  }, [
    form.cashSessionId,
    selectedRegisterId,
    selectedRegisterOpenSessions,
    sessionModeDisablesSession,
    sessionModeRequiresSession,
  ]);
  const applySelectedTotal = useMemo(() => {
    if (actionForm?.type !== "applyCari") {
      return 0;
    }
    const drafts = actionForm?.applyDrafts || {};
    return Number(
      Object.values(drafts).reduce((sum, value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
      }, 0).toFixed(6)
    );
  }, [actionForm]);
  const canFilterByTxnType = !presetTxnType;
  const effectiveTxnTypeFilter = presetTxnType || filters.txnType || "";
  const selectedTransactionLifecycleMeta = useMemo(
    () => getLifecycleStatusMeta("cashTransaction", selectedLifecycleTransactionRow?.status, l),
    [l, selectedLifecycleTransactionRow?.status]
  );
  const selectedTransactionLifecycleActions = useMemo(
    () => getLifecycleAllowedActions("cashTransaction", selectedLifecycleTransactionRow?.status, l),
    [l, selectedLifecycleTransactionRow?.status]
  );
  const selectedTransactionLifecycleActionLabels = useMemo(() => {
    const labelsByAction = {
      submit: t("cashTransactions.lifecycle.actionLabels.submit"),
      approve: t("cashTransactions.lifecycle.actionLabels.approve"),
      post: t("cashTransactions.lifecycle.actionLabels.post"),
      cancel: t("cashTransactions.lifecycle.actionLabels.cancel"),
      reverse: t("cashTransactions.lifecycle.actionLabels.reverse"),
    };
    return selectedTransactionLifecycleActions.map(
      (row) => labelsByAction[row.action] || row.label
    );
  }, [selectedTransactionLifecycleActions, t]);
  const selectedTransactionLifecycleTimeline = useMemo(
    () =>
      buildLifecycleTimelineSteps(
        "cashTransaction",
        selectedLifecycleTransactionRow?.status,
        buildCashTransactionLifecycleEvents(selectedLifecycleTransactionRow, t),
        l
      ),
    [l, selectedLifecycleTransactionRow, t]
  );

  const createWarnings = useMemo(() => {
    const warnings = [];
    const normalizedTxnType = toUpper(form.txnType);
    const amount = toOptionalNumber(form.amount);

    if (selectedRegister && toUpper(selectedRegister.status) !== "ACTIVE") {
      warnings.push(t("cashTransactions.warnings.registerInactive"));
    }

    if (
      selectedRegister &&
      String(form.currencyCode || "").trim() &&
      toUpper(form.currencyCode) !== toUpper(selectedRegister.currency_code)
    ) {
      warnings.push(
        t("cashTransactions.warnings.currencyMismatch", {
          registerCurrency: selectedRegister.currency_code || "-",
        })
      );
    }

    const maxTxnAmount = Number(selectedRegister?.max_txn_amount || 0);
    if (selectedRegister && Number.isFinite(amount) && maxTxnAmount > 0 && amount > maxTxnAmount) {
      warnings.push(
        t("cashTransactions.warnings.maxAmountExceeded", {
          max: formatAmount(maxTxnAmount),
        })
      );
    }

    if (selectedRegister && toUpper(selectedRegister.session_mode) === "NONE") {
      warnings.push(t("cashTransactions.warnings.sessionModeNone"));
    }

    if (
      selectedRegister &&
      toUpper(selectedRegister.session_mode) === "REQUIRED" &&
      !toPositiveInt(form.cashSessionId) &&
      selectedRegisterOpenSessions.length === 0
    ) {
      warnings.push(t("cashTransactions.warnings.sessionRequiredNoOpen"));
    }

    if (
      (normalizedTxnType === "TRANSFER_IN" || normalizedTxnType === "TRANSFER_OUT") &&
      !toPositiveInt(form.counterCashRegisterId)
    ) {
      warnings.push(t("cashTransactions.errors.counterRegisterRequired"));
    }

    if (requiresCounterAccountTxnType(normalizedTxnType) && !toPositiveInt(form.counterAccountId)) {
      warnings.push(t("cashTransactions.errors.counterAccountRequired"));
    }
    if (normalizedTxnType === "TRANSFER_IN" && selectedIsCrossOuTransfer) {
      warnings.push(t("cashTransactions.warnings.crossOuTransferInUseTransitReceive"));
    }

    const expectedCounterpartyType = resolveExpectedCounterpartyType(normalizedTxnType);
    const selectedCounterpartyId = toPositiveInt(form.counterpartyId);
    if (expectedCounterpartyType && toUpper(form.counterpartyType) && toUpper(form.counterpartyType) !== expectedCounterpartyType) {
      warnings.push(
        t("cashTransactions.warnings.expectedCounterpartyTypeForTxn", {
          expected: expectedCounterpartyType,
          txnType: normalizedTxnType,
        })
      );
    }
    if (expectedCounterpartyType && selectedCounterpartyId && !toUpper(form.counterpartyType)) {
      warnings.push(
        t("cashTransactions.warnings.recommendCounterpartyType", {
          expected: expectedCounterpartyType,
        })
      );
    }

    return warnings;
  }, [
    form.amount,
    form.cashSessionId,
    form.counterAccountId,
    form.counterCashRegisterId,
    form.counterpartyId,
    form.counterpartyType,
    form.currencyCode,
    form.txnType,
    selectedIsCrossOuTransfer,
    selectedRegister,
    selectedRegisterOpenSessions.length,
    t,
  ]);

  const transactionRows = useMemo(
    () => [...rows].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0)),
    [rows]
  );
  const transactionTableColumns = useMemo(
    () => [
      { id: "id", label: t("cashTransactions.table.id") },
      { id: "txnNo", label: t("cashTransactions.table.txnNo") },
      { id: "txnType", label: t("cashTransactions.table.txnType") },
      { id: "status", label: t("cashTransactions.table.status") },
      { id: "register", label: t("cashTransactions.table.register") },
      { id: "session", label: t("cashTransactions.table.session") },
      { id: "bookDate", label: t("cashTransactions.table.bookDate") },
      { id: "amount", label: t("cashTransactions.table.amount") },
      { id: "currency", label: t("cashTransactions.table.currency") },
      { id: "counterparty", label: t("cashTransactions.table.counterparty") },
      { id: "counterAccount", label: t("cashTransactions.table.counterAccount") },
      { id: "counterRegister", label: t("cashTransactions.table.counterRegister") },
      { id: "links", label: t("cashTransactions.table.links") },
      { id: "postedJournal", label: t("cashTransactions.table.postedJournal") },
      { id: "overrideReason", label: t("cashTransactions.table.overrideReason") },
      { id: "createdAt", label: t("cashTransactions.table.createdAt") },
      { id: "actions", label: t("cashTransactions.table.actions") },
    ],
    [t]
  );
  const transactionTableColumnIds = useMemo(
    () => transactionTableColumns.map((column) => column.id),
    [transactionTableColumns]
  );
  const [transactionTablePrefs, setTransactionTablePrefs, resetTransactionTablePrefs] =
    usePersistedTablePrefs(
      CASH_TRANSACTION_TABLE_PREFS_STORAGE_SCOPE,
      {
        rowsPerPage: CASH_TRANSACTION_TABLE_DEFAULT_ROWS_PER_PAGE,
        stickyHeader: false,
        visibleColumnIds: transactionTableColumnIds,
      },
      transactionTableColumnIds
    );
  const transactionVisibleColumnSet = useMemo(
    () => new Set(transactionTablePrefs.visibleColumnIds || []),
    [transactionTablePrefs.visibleColumnIds]
  );
  const selectedSavedView = useMemo(
    () =>
      savedViews.find(
        (row) => Number(row?.id || 0) === Number(selectedSavedViewId || 0)
      ) || null,
    [savedViews, selectedSavedViewId]
  );
  const selectedTemplate = useMemo(
    () =>
      templates.find((row) => Number(row?.id || 0) === Number(selectedTemplateId || 0)) ||
      null,
    [templates, selectedTemplateId]
  );
  const availablePresetOptions = useMemo(() => {
    if (!presetTxnType) {
      return CASH_TRANSACTION_PRESET_OPTIONS;
    }
    const normalizedPresetTxnType = toUpper(presetTxnType);
    return CASH_TRANSACTION_PRESET_OPTIONS.filter(
      (row) => toUpper(row?.patch?.txnType) === normalizedPresetTxnType
    );
  }, [presetTxnType]);
  const visibleTransactionColumnCount = useMemo(() => {
    const count = transactionTableColumns.reduce(
      (total, column) => total + (transactionVisibleColumnSet.has(column.id) ? 1 : 0),
      0
    );
    return Math.max(1, count);
  }, [transactionTableColumns, transactionVisibleColumnSet]);
  const transactionRowsPerPage = useMemo(
    () =>
      toPositiveInt(transactionTablePrefs.rowsPerPage) ||
      CASH_TRANSACTION_TABLE_DEFAULT_ROWS_PER_PAGE,
    [transactionTablePrefs.rowsPerPage]
  );
  const transactionListTotalPages = useMemo(() => {
    if (!transactionRows.length) {
      return 1;
    }
    return Math.max(1, Math.ceil(transactionRows.length / transactionRowsPerPage));
  }, [transactionRows.length, transactionRowsPerPage]);
  const pagedTransactionRows = useMemo(() => {
    const startIndex = Math.max(0, (transactionListPage - 1) * transactionRowsPerPage);
    return transactionRows.slice(startIndex, startIndex + transactionRowsPerPage);
  }, [transactionListPage, transactionRows, transactionRowsPerPage]);

  function handleExportTransactionsCsv() {
    setError("");
    setErrorRequestId(null);
    const exported = exportRowsAsCsv({
      rows: transactionRows,
      columns: CASH_TRANSACTION_EXPORT_COLUMNS,
      fileName: `cash-transactions-${todayIsoDate()}.csv`,
    });
    if (!exported) {
      setError(
        t(
          "cashTransactions.errors.csvExportUnavailable",
          "CSV export is only available in browser sessions."
        )
      );
      return;
    }
    setMessage(
      t("cashTransactions.messages.exportedCsv", "CSV export ready ({{count}} rows).", {
        count: transactionRows.length,
      })
    );
  }

  function handleTransactionTableRowsPerPageChange(value) {
    const nextRowsPerPage = toPositiveInt(value);
    if (!nextRowsPerPage) {
      return;
    }
    setTransactionTablePrefs((previous) => ({
      ...previous,
      rowsPerPage: nextRowsPerPage,
    }));
    setTransactionListPage(1);
  }

  function handleTransactionTableStickyHeaderChange(nextValue) {
    setTransactionTablePrefs((previous) => ({
      ...previous,
      stickyHeader: Boolean(nextValue),
    }));
  }

  function handleTransactionTableToggleColumn(columnId) {
    const normalizedId = String(columnId || "").trim();
    if (!normalizedId) {
      return;
    }
    setTransactionTablePrefs((previous) => {
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

  function handleTransactionTableSelectAllColumns() {
    setTransactionTablePrefs((previous) => ({
      ...previous,
      visibleColumnIds: transactionTableColumnIds,
    }));
  }

  function handleTransactionTableResetPrefs() {
    resetTransactionTablePrefs({
      rowsPerPage: CASH_TRANSACTION_TABLE_DEFAULT_ROWS_PER_PAGE,
      stickyHeader: false,
      visibleColumnIds: transactionTableColumnIds,
    });
    setTransactionListPage(1);
  }

  function applyCreateFormSnapshot(nextForm) {
    const normalized = buildCashTransactionTemplateSafeForm(nextForm, presetTxnType);
    setForm(normalized);
    setCounterpartyQuery("");
    setAccountQuery("");
  }

  function resetCreateFormWithDefaults() {
    setForm((previous) => {
      const baseline = buildInitialForm(presetTxnType);
      return buildCashTransactionTemplateSafeForm(
        {
          ...baseline,
          registerId: previous?.registerId || "",
          currencyCode: previous?.currencyCode || "",
        },
        presetTxnType
      );
    });
    setCounterpartyQuery("");
    setAccountQuery("");
    setSelectedPresetCode("");
    setTemplatesError("");
    setTemplatesMessage("");
  }

  function handleApplyCreatePreset() {
    const selectedPreset =
      availablePresetOptions.find((row) => row.code === selectedPresetCode) || null;
    if (!selectedPreset) {
      setTemplatesError(
        t("cashTransactions.templates.errors.selectPreset", "Select a preset first.")
      );
      return;
    }
    applyCreateFormSnapshot({
      ...form,
      ...(selectedPreset.patch || {}),
    });
    setTemplatesError("");
    setTemplatesMessage(
      t("cashTransactions.templates.messages.presetApplied", "Preset applied: {{name}}", {
        name: selectedPreset.label || selectedPreset.code,
      })
    );
  }

  async function loadTransactionTemplates(options = {}) {
    if (!canCreate) {
      setTemplates([]);
      setSelectedTemplateId("");
      setTemplatesLoading(false);
      return;
    }
    const preferredId = toPositiveInt(options.preferredId);
    setTemplatesLoading(true);
    setTemplatesError("");
    try {
      const response = await listMeSavedViews({
        moduleCode: CASH_TRANSACTION_TEMPLATE_MODULE_CODE,
      });
      const nextRows = Array.isArray(response?.rows) ? response.rows : [];
      setTemplates(nextRows);
      setSelectedTemplateId((current) => {
        const currentId = toPositiveInt(current);
        if (preferredId && nextRows.some((row) => Number(row?.id) === preferredId)) {
          return String(preferredId);
        }
        if (currentId && nextRows.some((row) => Number(row?.id) === currentId)) {
          return String(currentId);
        }
        return nextRows[0]?.id ? String(nextRows[0].id) : "";
      });
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.load");
      setTemplates([]);
      setSelectedTemplateId("");
      setTemplatesError(errorState.message);
    } finally {
      setTemplatesLoading(false);
    }
  }

  function applyTransactionTemplate(templateRow, options = {}) {
    const target = templateRow && typeof templateRow === "object" ? templateRow : null;
    if (!target) {
      setTemplatesError(
        t("cashTransactions.templates.errors.selectTemplate", "Select a template first.")
      );
      return;
    }
    const resolved = resolveCashTransactionTemplateState(target, presetTxnType);
    applyCreateFormSnapshot(resolved.form);
    setSelectedTemplateId(String(target.id));
    if (!options.silent) {
      setTemplatesError("");
      setTemplatesMessage(
        t("cashTransactions.templates.messages.applied", "Template applied: {{name}}", {
          name: target.name || target.id,
        })
      );
    }
  }

  async function handleCreateTransactionTemplate() {
    const rawName = window.prompt(
      t("cashTransactions.templates.promptName", "Template name"),
      ""
    );
    const name = String(rawName || "").trim();
    if (!name) {
      return;
    }
    setTemplatesSaving(true);
    setTemplatesError("");
    setTemplatesMessage("");
    try {
      const response = await createMeSavedView({
        moduleCode: CASH_TRANSACTION_TEMPLATE_MODULE_CODE,
        name,
        definition: buildCashTransactionTemplateDefinition({ form }),
      });
      const createdId = toPositiveInt(response?.row?.id);
      await loadTransactionTemplates({ preferredId: createdId });
      setTemplatesMessage(
        t("cashTransactions.templates.messages.created", "Template created: {{name}}", {
          name,
        })
      );
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.action");
      setTemplatesError(errorState.message);
    } finally {
      setTemplatesSaving(false);
    }
  }

  async function handleUpdateTransactionTemplate() {
    const templateId = toPositiveInt(selectedTemplate?.id);
    if (!templateId) {
      setTemplatesError(
        t("cashTransactions.templates.errors.selectTemplate", "Select a template first.")
      );
      return;
    }
    setTemplatesSaving(true);
    setTemplatesError("");
    setTemplatesMessage("");
    try {
      await updateMeSavedView(templateId, {
        definition: buildCashTransactionTemplateDefinition({ form }),
      });
      await loadTransactionTemplates({ preferredId: templateId });
      setTemplatesMessage(
        t("cashTransactions.templates.messages.updated", "Template updated: {{name}}", {
          name: selectedTemplate?.name || templateId,
        })
      );
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.action");
      setTemplatesError(errorState.message);
    } finally {
      setTemplatesSaving(false);
    }
  }

  async function handleSetDefaultTransactionTemplate() {
    const templateId = toPositiveInt(selectedTemplate?.id);
    if (!templateId) {
      setTemplatesError(
        t("cashTransactions.templates.errors.selectTemplate", "Select a template first.")
      );
      return;
    }
    setTemplatesSaving(true);
    setTemplatesError("");
    setTemplatesMessage("");
    try {
      await updateMeSavedView(templateId, { isDefault: true });
      await loadTransactionTemplates({ preferredId: templateId });
      setTemplatesMessage(
        t("cashTransactions.templates.messages.setDefault", "Template set as default.")
      );
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.action");
      setTemplatesError(errorState.message);
    } finally {
      setTemplatesSaving(false);
    }
  }

  async function handleDeleteTransactionTemplate() {
    const templateId = toPositiveInt(selectedTemplate?.id);
    if (!templateId) {
      setTemplatesError(
        t("cashTransactions.templates.errors.selectTemplate", "Select a template first.")
      );
      return;
    }
    const confirmed = window.confirm(
      t(
        "cashTransactions.templates.confirmDelete",
        "Delete selected transaction template?"
      )
    );
    if (!confirmed) {
      return;
    }
    setTemplatesSaving(true);
    setTemplatesError("");
    setTemplatesMessage("");
    try {
      await deleteMeSavedView(templateId);
      await loadTransactionTemplates();
      setTemplatesMessage(
        t("cashTransactions.templates.messages.deleted", "Template deleted.")
      );
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.action");
      setTemplatesError(errorState.message);
    } finally {
      setTemplatesSaving(false);
    }
  }

  async function loadTransactionSavedViews(options = {}) {
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
        moduleCode: CASH_TRANSACTION_SAVED_VIEW_MODULE_CODE,
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
    } catch (err) {
      const errorState = toTransactionErrorState(
        err,
        t,
        "cashTransactions.errors.load"
      );
      setSavedViews([]);
      setSelectedSavedViewId("");
      setSavedViewsError(errorState.message);
    } finally {
      setSavedViewsLoading(false);
    }
  }

  function applyTransactionSavedView(savedView, options = {}) {
    const target = savedView && typeof savedView === "object" ? savedView : null;
    if (!target) {
      setSavedViewsError(
        t("cashTransactions.savedViews.selectRequired", "Select a saved view first.")
      );
      return;
    }
    const resolved = resolveCashTransactionSavedViewState({
      savedView: target,
      baseFilters: buildInitialFilters(presetTxnType),
      columnIds: transactionTableColumnIds,
    });
    setFilters(resolved.filters);
    setTransactionTablePrefs((previous) => ({
      ...previous,
      ...resolved.tablePrefs,
    }));
    setTransactionListPage(1);
    setSelectedSavedViewId(String(target.id));
    loadPageData(resolved.filters);
    if (!options.silent) {
      setSavedViewsMessage(
        t("cashTransactions.savedViews.applied", "Saved view applied: {{name}}", {
          name: target.name || target.id,
        })
      );
      setSavedViewsError("");
    }
  }

  async function handleCreateTransactionSavedView() {
    const rawName = window.prompt(
      t("cashTransactions.savedViews.promptName", "Saved view name"),
      ""
    );
    const name = String(rawName || "").trim();
    if (!name) {
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      const response = await createMeSavedView({
        moduleCode: CASH_TRANSACTION_SAVED_VIEW_MODULE_CODE,
        name,
        definition: buildCashTransactionSavedViewDefinition({
          filters,
          baseFilters: buildInitialFilters(presetTxnType),
          tablePrefs: transactionTablePrefs,
          columnIds: transactionTableColumnIds,
        }),
      });
      const createdId = toPositiveInt(response?.row?.id);
      await loadTransactionSavedViews({ preferredId: createdId });
      setSavedViewsMessage(
        t("cashTransactions.savedViews.created", "Saved view created: {{name}}", {
          name,
        })
      );
    } catch (err) {
      const errorState = toTransactionErrorState(
        err,
        t,
        "cashTransactions.errors.action"
      );
      setSavedViewsError(errorState.message);
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleUpdateTransactionSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        t("cashTransactions.savedViews.selectRequired", "Select a saved view first.")
      );
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await updateMeSavedView(savedViewId, {
        definition: buildCashTransactionSavedViewDefinition({
          filters,
          baseFilters: buildInitialFilters(presetTxnType),
          tablePrefs: transactionTablePrefs,
          columnIds: transactionTableColumnIds,
        }),
      });
      await loadTransactionSavedViews({ preferredId: savedViewId });
      setSavedViewsMessage(
        t("cashTransactions.savedViews.updated", "Saved view updated: {{name}}", {
          name: selectedSavedView?.name || savedViewId,
        })
      );
    } catch (err) {
      const errorState = toTransactionErrorState(
        err,
        t,
        "cashTransactions.errors.action"
      );
      setSavedViewsError(errorState.message);
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleSetDefaultTransactionSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        t("cashTransactions.savedViews.selectRequired", "Select a saved view first.")
      );
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await updateMeSavedView(savedViewId, { isDefault: true });
      await loadTransactionSavedViews({ preferredId: savedViewId });
      setSavedViewsMessage(
        t("cashTransactions.savedViews.setDefault", "Saved view set as default.")
      );
    } catch (err) {
      const errorState = toTransactionErrorState(
        err,
        t,
        "cashTransactions.errors.action"
      );
      setSavedViewsError(errorState.message);
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleDeleteTransactionSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        t("cashTransactions.savedViews.selectRequired", "Select a saved view first.")
      );
      return;
    }
    const confirmed = window.confirm(
      t("cashTransactions.savedViews.confirmDelete", "Delete selected saved view?")
    );
    if (!confirmed) {
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await deleteMeSavedView(savedViewId);
      await loadTransactionSavedViews();
      setSavedViewsMessage(
        t("cashTransactions.savedViews.deleted", "Saved view deleted.")
      );
    } catch (err) {
      const errorState = toTransactionErrorState(
        err,
        t,
        "cashTransactions.errors.action"
      );
      setSavedViewsError(errorState.message);
    } finally {
      setSavedViewsSaving(false);
    }
  }

  function toListQuery(nextFilters) {
    return {
      limit: 200,
      offset: 0,
      registerId: toPositiveInt(nextFilters.registerId) || undefined,
      sessionId: toPositiveInt(nextFilters.sessionId) || undefined,
      txnType: presetTxnType || nextFilters.txnType || undefined,
      status: nextFilters.status || undefined,
      bookDateFrom: nextFilters.bookDateFrom || undefined,
      bookDateTo: nextFilters.bookDateTo || undefined,
    };
  }

  async function loadPageData(nextFilters = filters) {
    if (!canRead) {
      setRows([]);
      setRegisters([]);
      setOpenSessions([]);
      setAccounts([]);
      setAccountLookupWarning("");
      return;
    }

    setLoading(true);
    setError("");
    setErrorRequestId(null);
    setLookupWarning("");
    try {
      const [listResult, registerResult, sessionResult] = await Promise.allSettled([
        listCashTransactions(toListQuery(nextFilters)),
        listCashRegisters({ limit: 300, offset: 0 }),
        listCashSessions({ status: "OPEN", limit: 300, offset: 0 }),
      ]);

      if (listResult.status !== "fulfilled") {
        throw listResult.reason;
      }

      const warnings = [];

      if (registerResult.status === "fulfilled") {
        setRegisters(registerResult.value?.rows || []);
      } else {
        setRegisters([]);
        warnings.push(
          registerResult.reason?.response?.data?.message ||
            t("cashTransactions.warnings.registerLookupUnavailable")
        );
      }

      if (sessionResult.status === "fulfilled") {
        setOpenSessions(sessionResult.value?.rows || []);
      } else {
        setOpenSessions([]);
        warnings.push(
          sessionResult.reason?.response?.data?.message ||
            t("cashTransactions.warnings.sessionLookupUnavailable")
        );
      }
      setRows(listResult.value?.rows || []);
      setLookupWarning(warnings.join(" "));
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.load");
      setError(errorState.message);
      setErrorRequestId(errorState.requestId);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm(buildInitialForm(presetTxnType));
    setActionForm(null);
    setSelectedLifecycleTransactionId(null);
    setCounterpartyQuery("");
    setCounterpartyOptions([]);
    setSelectedPresetCode("");
    setTemplatesError("");
    setTemplatesMessage("");
  }, [presetTxnType]);

  useEffect(() => {
    if (!capitalFulfillmentTransitPrefill) {
      appliedCapitalFulfillmentTransitPrefillRef.current = "";
      return;
    }
    if (
      appliedCapitalFulfillmentTransitPrefillRef.current ===
      capitalFulfillmentTransitPrefill.prefillKey
    ) {
      return;
    }

    setForm(capitalFulfillmentTransitPrefill.form);
    setActionForm(null);
    setSelectedLifecycleTransactionId(null);
    setCounterpartyQuery("");
    setCounterpartyOptions([]);
    setSelectedPresetCode("");
    setTemplatesError("");
    setTemplatesMessage("");

    const transferRouteMessage = l(
      `Prefilled HQ-to-branch cash transit transfer${
        capitalFulfillmentTransitPrefill.fulfillmentId
          ? ` for capital fulfillment ${capitalFulfillmentTransitPrefill.fulfillmentId}`
          : ""
      }.${
        capitalFulfillmentTransitPrefill.sourceRegisterCode ||
        capitalFulfillmentTransitPrefill.targetRegisterCode
          ? ` ${capitalFulfillmentTransitPrefill.sourceRegisterCode || "HQ"} -> ${
              capitalFulfillmentTransitPrefill.targetRegisterCode || "branch register"
            }.`
          : ""
      } Review book date and session before creating the transfer.`,
      `Merkezden subeye kasa transit transferi${
        capitalFulfillmentTransitPrefill.fulfillmentId
          ? ` sermaye karsilamasi ${capitalFulfillmentTransitPrefill.fulfillmentId} icin`
          : ""
      } onceden dolduruldu.${
        capitalFulfillmentTransitPrefill.sourceRegisterCode ||
        capitalFulfillmentTransitPrefill.targetRegisterCode
          ? ` ${capitalFulfillmentTransitPrefill.sourceRegisterCode || "Merkez"} -> ${
              capitalFulfillmentTransitPrefill.targetRegisterCode || "sube kasasi"
            }.`
          : ""
      } Transferi olusturmadan once tarih ve oturum alanlarini gozden gecirin.`
    );
    setInfoMessage(transferRouteMessage);
    appliedCapitalFulfillmentTransitPrefillRef.current =
      capitalFulfillmentTransitPrefill.prefillKey;
  }, [capitalFulfillmentTransitPrefill, l]);

  useEffect(() => {
    loadPageData(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, presetTxnType]);

  useEffect(() => {
    if (!canRead || !canReadAccounts || !selectedRegisterLegalEntityId) {
      setAccounts([]);
      setAccountLookupWarning("");
      return;
    }

    let active = true;

    async function loadScopedAccounts() {
      try {
        const result = await listAccounts({
          legalEntityId: selectedRegisterLegalEntityId,
          includeInactive: true,
          limit: 600,
        });
        if (!active) {
          return;
        }
        setAccounts(result?.rows || []);
        setAccountLookupWarning("");
      } catch (err) {
        if (!active) {
          return;
        }
        setAccounts([]);
        setAccountLookupWarning(
          err?.response?.data?.message || t("cashTransactions.warnings.accountLookupUnavailable")
        );
      }
    }

    loadScopedAccounts();
    return () => {
      active = false;
    };
  }, [canRead, canReadAccounts, selectedRegisterLegalEntityId, t]);

  useEffect(() => {
    if (!canRead) {
      setSavedViews([]);
      setSelectedSavedViewId("");
      setDefaultSavedViewHydrated(false);
      return;
    }
    loadTransactionSavedViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, presetTxnType]);

  useEffect(() => {
    if (!canRead || defaultSavedViewHydrated || savedViewsLoading) {
      return;
    }
    const defaultView = savedViews.find((row) => Boolean(row?.isDefault));
    if (defaultView) {
      applyTransactionSavedView(defaultView, { silent: true });
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
      setTemplates([]);
      setSelectedTemplateId("");
      setDefaultTemplateHydrated(false);
      return;
    }
    setDefaultTemplateHydrated(false);
    loadTransactionTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, presetTxnType]);

  useEffect(() => {
    if (!canCreate || defaultTemplateHydrated || templatesLoading) {
      return;
    }
    const defaultTemplate = templates.find((row) => Boolean(row?.isDefault));
    if (defaultTemplate) {
      applyTransactionTemplate(defaultTemplate, { silent: true });
    }
    setDefaultTemplateHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canCreate,
    defaultTemplateHydrated,
    templates,
    templatesLoading,
  ]);

  useEffect(() => {
    if (!selectedPresetCode) {
      return;
    }
    if (availablePresetOptions.some((row) => row.code === selectedPresetCode)) {
      return;
    }
    setSelectedPresetCode("");
  }, [availablePresetOptions, selectedPresetCode]);

  useEffect(() => {
    const selectedId = toPositiveInt(selectedLifecycleTransactionId);
    if (!selectedId) {
      return;
    }
    if (!rows.some((row) => toPositiveInt(row?.id) === selectedId)) {
      setSelectedLifecycleTransactionId(null);
    }
  }, [rows, selectedLifecycleTransactionId]);

  useEffect(() => {
    if (transactionListPage <= transactionListTotalPages) {
      return;
    }
    setTransactionListPage(transactionListTotalPages);
  }, [transactionListPage, transactionListTotalPages]);

  useEffect(() => {
    if (!canCreate) {
      return;
    }
    if (toPositiveInt(form.registerId)) {
      return;
    }
    if (!registerOptions.length) {
      return;
    }
    const defaultRegister = registerOptions.find(
      (row) => toUpper(row?.status) === "ACTIVE"
    );
    setForm((prev) => {
      const registerId = String(defaultRegister?.id || registerOptions[0]?.id || "");
      const nextRegister =
        registerOptions.find((row) => String(row.id) === registerId) || null;
      return {
        ...prev,
        registerId,
        currencyCode: toUpper(nextRegister?.currency_code),
      };
    });
  }, [canCreate, form.registerId, registerOptions]);

  useEffect(() => {
    if (!canReadCariCards) {
      setCounterpartyOptions([]);
      setCounterpartyLoading(false);
      setCounterpartyWarning("");
      return;
    }
    if (!showCounterpartyFields) {
      setCounterpartyOptions([]);
      setCounterpartyLoading(false);
      setCounterpartyWarning("");
      return;
    }

    const legalEntityId = toPositiveInt(selectedRegister?.legal_entity_id);
    const expectedType = resolveExpectedCounterpartyType(form.txnType);
    const roleFilter =
      expectedType === "CUSTOMER"
        ? "CUSTOMER"
        : expectedType === "VENDOR"
          ? "VENDOR"
          : undefined;
    if (!legalEntityId) {
      setCounterpartyOptions([]);
      setCounterpartyWarning("");
      return;
    }

    let active = true;
    async function loadCounterparties() {
      setCounterpartyLoading(true);
      setCounterpartyWarning("");
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role: roleFilter,
          status: "ACTIVE",
          q: counterpartyQuery || undefined,
          limit: 100,
          offset: 0,
          sortBy: "NAME",
          sortDir: "ASC",
        });
        if (!active) {
          return;
        }
        setCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch (err) {
        if (!active) {
          return;
        }
        setCounterpartyOptions([]);
        setCounterpartyWarning(
          String(
            err?.response?.data?.message ||
              t("cashTransactions.warnings.counterpartyPickerUnavailableManual")
          )
        );
      } finally {
        if (active) {
          setCounterpartyLoading(false);
        }
      }
    }

    loadCounterparties();
    return () => {
      active = false;
    };
  }, [canReadCariCards, counterpartyQuery, form.txnType, selectedRegister?.legal_entity_id, showCounterpartyFields, t]);

  useEffect(() => {
    if (actionForm?.type !== "applyCari" || !selectedActionRow) {
      setApplyOpenItems([]);
      setApplyOpenItemsLoading(false);
      setApplyOpenItemsError("");
      return;
    }

    if (!canReadCariReports) {
      setApplyOpenItems([]);
      setApplyOpenItemsLoading(false);
      setApplyOpenItemsError(t("cashTransactions.errors.openDocumentsPermissionMissing"));
      return;
    }

    const legalEntityId = toPositiveInt(selectedActionRow?.legal_entity_id);
    const counterpartyId = toPositiveInt(selectedActionRow?.counterparty_id);
    const direction = resolveCariDirection(selectedActionRow?.txn_type);
    if (!legalEntityId || !counterpartyId || !direction) {
      setApplyOpenItems([]);
      setApplyOpenItemsLoading(false);
      setApplyOpenItemsError(t("cashTransactions.errors.openDocumentsLoadNotAllowedForRow"));
      return;
    }

    let active = true;
    async function loadActionOpenItems() {
      setApplyOpenItemsLoading(true);
      setApplyOpenItemsError("");
      try {
        const payload = await getCariOpenItemsReport({
          legalEntityId,
          counterpartyId,
          asOfDate: actionForm.asOfDate || selectedActionRow.book_date || todayIsoDate(),
          direction,
          status: "OPEN",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setApplyOpenItems(Array.isArray(payload?.rows) ? payload.rows : []);
      } catch (err) {
        if (!active) {
          return;
        }
        setApplyOpenItems([]);
        setApplyOpenItemsError(
          String(err?.response?.data?.message || t("cashTransactions.errors.openDocumentsLoadFailed"))
        );
      } finally {
        if (active) {
          setApplyOpenItemsLoading(false);
        }
      }
    }

    loadActionOpenItems();
    return () => {
      active = false;
    };
  }, [actionForm?.type, actionForm?.asOfDate, canReadCariReports, selectedActionRow, t]);

  function clearMessages() {
    setError("");
    setErrorRequestId(null);
    setMessage("");
    setInfoMessage("");
  }

  function setSimpleError(message) {
    setError(message);
    setErrorRequestId(null);
  }

  function handleRegisterChange(nextRegisterId) {
    const nextRegister =
      registers.find((row) => String(row.id) === String(nextRegisterId)) || null;
    const currentLegalEntityId = toPositiveInt(selectedRegister?.legal_entity_id);
    const nextLegalEntityId = toPositiveInt(nextRegister?.legal_entity_id);
    setForm((prev) => ({
      ...prev,
      registerId: String(nextRegisterId || ""),
      cashSessionId: "",
      currencyCode: nextRegister ? toUpper(nextRegister.currency_code) : prev.currencyCode,
      counterAccountId:
        currentLegalEntityId && nextLegalEntityId && currentLegalEntityId === nextLegalEntityId
          ? prev.counterAccountId
          : "",
      counterpartyId: "",
      counterpartyType: prev.counterpartyType,
      counterCashRegisterId:
        toPositiveInt(nextRegisterId) &&
        toPositiveInt(prev.counterCashRegisterId) === toPositiveInt(nextRegisterId)
          ? ""
          : prev.counterCashRegisterId,
    }));
    setCounterpartyQuery("");
    setAccountQuery("");
  }

  function handleTxnTypeChange(nextTxnType) {
    const normalized = toUpper(nextTxnType);
    const isTransfer = isTransferTxnType(normalized);
    const requiresCounterAccount = requiresCounterAccountTxnType(normalized);
    const expectedCounterpartyType = resolveExpectedCounterpartyType(normalized);

    setForm((prev) => ({
      ...prev,
      txnType: normalized,
      counterCashRegisterId: isTransfer ? prev.counterCashRegisterId : "",
      counterAccountId: requiresCounterAccount || isTransfer ? prev.counterAccountId : "",
      counterpartyType: isTransfer ? "" : expectedCounterpartyType || prev.counterpartyType,
      counterpartyId: isTransfer
        ? ""
        : expectedCounterpartyType && expectedCounterpartyType !== toUpper(prev.counterpartyType)
          ? ""
          : prev.counterpartyId,
    }));
    setCounterpartyQuery("");
    setAccountQuery("");
  }

  function handleCounterpartyPick(nextCounterpartyId) {
    const option =
      counterpartyOptions.find((row) => toPositiveInt(row?.id) === toPositiveInt(nextCounterpartyId)) || null;
    const expectedCounterpartyType = resolveExpectedCounterpartyType(form.txnType);
    const fallbackType = option?.counterpartyType || "";
    setForm((prev) => ({
      ...prev,
      counterpartyId: nextCounterpartyId ? String(nextCounterpartyId) : "",
      counterpartyType: expectedCounterpartyType || fallbackType || prev.counterpartyType,
    }));
  }

  function setApplyDraftAmount(openItemId, nextValue) {
    setActionForm((prev) => {
      if (!prev || prev.type !== "applyCari") {
        return prev;
      }
      return {
        ...prev,
        applyDrafts: {
          ...(prev.applyDrafts || {}),
          [String(openItemId)]: nextValue,
        },
      };
    });
  }

  function fillApplyDraftsWithOpenAmounts() {
    setActionForm((prev) => {
      if (!prev || prev.type !== "applyCari") {
        return prev;
      }
      const nextDrafts = {};
      for (const row of applyOpenItems) {
        const openItemId = toPositiveInt(row?.openItemId);
        if (!openItemId) {
          continue;
        }
        const residual = Number(row?.residualAmountTxnAsOf || 0);
        if (Number.isFinite(residual) && residual > 0) {
          nextDrafts[String(openItemId)] = String(Number(residual.toFixed(6)));
        }
      }
      return {
        ...prev,
        applyDrafts: nextDrafts,
      };
    });
  }

  async function handleCreateTransaction(event) {
    event.preventDefault();
    clearMessages();

    if (!canCreate) {
      setSimpleError(t("cashTransactions.errors.missingCreatePermission"));
      return;
    }

    const registerId = toPositiveInt(form.registerId);
    const cashSessionId = toPositiveInt(form.cashSessionId);
    const counterAccountId = toPositiveInt(form.counterAccountId);
    const counterCashRegisterId = toPositiveInt(form.counterCashRegisterId);
    const counterpartyId = toPositiveInt(form.counterpartyId);
    const amount = toOptionalNumber(form.amount);
    const txnType = toUpper(form.txnType);
    const isTransferTxn = txnType === "TRANSFER_IN" || txnType === "TRANSFER_OUT";
    const currencyCode = toUpper(form.currencyCode);
    const txnDatetime = String(form.txnDatetime || "").trim();
    const bookDate = String(form.bookDate || "").trim();
    const crossOuTransfer = isTransferTxn
      ? isCrossOuRegisterPair(selectedRegister, selectedCounterRegister)
      : false;

    if (!registerId) {
      setSimpleError(t("cashTransactions.errors.registerRequired"));
      return;
    }
    if (!txnDatetime) {
      setSimpleError(t("cashTransactions.errors.txnDatetimeRequired"));
      return;
    }
    if (!bookDate) {
      setSimpleError(t("cashTransactions.errors.bookDateRequired"));
      return;
    }
    if (amount === null) {
      setSimpleError(t("cashTransactions.errors.amountRequired"));
      return;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      setSimpleError(t("cashTransactions.errors.amountInvalid"));
      return;
    }
    if (!currencyCode || currencyCode.length !== 3) {
      setSimpleError(t("cashTransactions.errors.currencyRequired"));
      return;
    }
    if (!MANUAL_TXN_TYPES.includes(txnType)) {
      setSimpleError(t("cashTransactions.errors.invalidTxnType"));
      return;
    }
    if (isTransferTxn && !counterCashRegisterId) {
      setSimpleError(t("cashTransactions.errors.counterRegisterRequired"));
      return;
    }
    if (requiresCounterAccountTxnType(txnType) && !counterAccountId) {
      setSimpleError(t("cashTransactions.errors.counterAccountRequired"));
      return;
    }
    if (crossOuTransfer && txnType !== "TRANSFER_OUT") {
      setSimpleError(t("cashTransactions.errors.crossOuTransferInMustUseTransitReceive"));
      return;
    }
    if (counterCashRegisterId && counterCashRegisterId === registerId) {
      setSimpleError(t("cashTransactions.errors.counterRegisterSame"));
      return;
    }

    if (selectedRegister) {
      if (toUpper(selectedRegister.status) !== "ACTIVE") {
        setSimpleError(t("cashTransactions.errors.registerInactive"));
        return;
      }
      if (toUpper(selectedRegister.currency_code) !== currencyCode) {
        setSimpleError(
          t("cashTransactions.errors.currencyMismatch", {
            registerCurrency: selectedRegister.currency_code || "-",
          })
        );
        return;
      }
      const maxTxnAmount = Number(selectedRegister.max_txn_amount || 0);
      if (maxTxnAmount > 0 && amount > maxTxnAmount) {
        setSimpleError(
          t("cashTransactions.errors.maxAmountExceeded", {
            max: formatAmount(maxTxnAmount),
          })
        );
        return;
      }
      if (
        toUpper(selectedRegister.session_mode) === "REQUIRED" &&
        !cashSessionId &&
        selectedRegisterOpenSessions.length === 0
      ) {
        setSimpleError(t("cashTransactions.errors.sessionRequiredNoOpen"));
        return;
      }
    }

    setCreating(true);
    try {
      const idempotencyKey = generateIdempotencyKey();
      if (crossOuTransfer) {
        const response = await initiateCashTransitTransfer({
          registerId,
          targetRegisterId: counterCashRegisterId,
          transitAccountId: counterAccountId || undefined,
          cashSessionId: cashSessionId || undefined,
          txnDatetime,
          bookDate,
          amount,
          currencyCode,
          description: String(form.description || "").trim() || undefined,
          referenceNo: String(form.referenceNo || "").trim() || undefined,
          note: String(form.description || "").trim() || undefined,
          idempotencyKey,
        });
        const transferId = response?.transfer?.id || "-";
        const transferOutTxnId = response?.transferOutTransaction?.id || "-";
        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.transitReplay", { transferId }));
        } else {
          setMessage(
            t("cashTransactions.messages.transitInitiated", {
              transferId,
              transferOutTxnId,
            })
          );
        }
      } else {
        const response = await createCashTransaction({
          registerId,
          cashSessionId: cashSessionId || undefined,
          txnType,
          txnDatetime,
          bookDate,
          amount,
          currencyCode,
          description: String(form.description || "").trim() || undefined,
          referenceNo: String(form.referenceNo || "").trim() || undefined,
          sourceDocType: String(form.sourceDocType || "").trim() || undefined,
          sourceDocId: String(form.sourceDocId || "").trim() || undefined,
          counterpartyType: String(form.counterpartyType || "").trim() || undefined,
          counterpartyId: counterpartyId || undefined,
          counterAccountId: counterAccountId || undefined,
          counterCashRegisterId: counterCashRegisterId || undefined,
          sourceModule: "MANUAL",
          idempotencyKey,
        });

        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.idempotentReplay"));
        } else {
          setMessage(t("cashTransactions.messages.created"));
        }
      }

      resetCreateFormWithDefaults();
      await loadPageData(filters);
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.create");
      setError(errorState.message);
      setErrorRequestId(errorState.requestId);
    } finally {
      setCreating(false);
    }
  }

  function openActionForm(type, row) {
    clearMessages();
    const transactionId = toPositiveInt(row?.id);
    if (!transactionId) {
      setSimpleError(t("cashTransactions.errors.actionRowMissing"));
      return;
    }
    setSelectedLifecycleTransactionId(String(transactionId));

    if (type === "post" && !canPost) {
      setSimpleError(t("cashTransactions.errors.missingPostPermission"));
      return;
    }
    if (type === "cancel" && !canCancel) {
      setSimpleError(t("cashTransactions.errors.missingCancelPermission"));
      return;
    }
    if (type === "reverse" && !canReverse) {
      setSimpleError(t("cashTransactions.errors.missingReversePermission"));
      return;
    }
    if (type === "receiveTransit" && !canCreate) {
      setSimpleError(t("cashTransactions.errors.missingCreatePermission"));
      return;
    }
    if (type === "applyCari" && !canApplyCari) {
      setSimpleError(t("cashTransactions.errors.missingApplyCariPermission"));
      return;
    }

    if (type === "receiveTransit") {
      const transitTransferId = toPositiveInt(row?.cash_transit_transfer_id);
      if (!transitTransferId) {
        setSimpleError(t("cashTransactions.errors.transitTransferLinkMissing"));
        return;
      }
      setActionForm({
        type,
        transactionId: String(transactionId),
        transitTransferId: String(transitTransferId),
        cashSessionId: "",
        txnDatetime: toDateTimeLocalInput(),
        bookDate: todayIsoDate(),
        idempotencyKey: buildTransitReceiveIdempotencyKey(),
        referenceNo: String(row?.reference_no || "").trim(),
        description: String(row?.description || "").trim(),
      });
      return;
    }

    if (type === "applyCari") {
      const asOfDate = String(row?.book_date || todayIsoDate()).slice(0, 10);
      setActionForm({
        type,
        transactionId: String(transactionId),
        settlementDate: asOfDate,
        asOfDate,
        idempotencyKey: buildApplyCariIdempotencyKey(),
        useUnappliedCash: false,
        fxRate: "",
        note: "",
        applyDrafts: {},
      });
      return;
    }

    setActionForm({
      type,
      transactionId: String(transactionId),
      overrideCashControl: false,
      overrideReason: "",
      cancelReason: "",
      reverseReason: "",
    });
  }

  async function handleActionSubmit(event) {
    event.preventDefault();
    clearMessages();

    const transactionId = toPositiveInt(actionForm?.transactionId);
    if (!transactionId) {
      setSimpleError(t("cashTransactions.errors.actionRowMissing"));
      return;
    }

    const row = selectedActionRow;
    if (!row) {
      setSimpleError(t("cashTransactions.errors.actionRowMissing"));
      return;
    }

    setActionSaving(true);
    try {
      if (actionForm.type === "receiveTransit") {
        const transitTransferId = toPositiveInt(
          actionForm.transitTransferId || row?.cash_transit_transfer_id
        );
        if (!transitTransferId) {
          throw new Error(t("cashTransactions.errors.transitTransferIdRequired"));
        }
        const response = await receiveCashTransitTransfer(transitTransferId, {
          cashSessionId: toPositiveInt(actionForm.cashSessionId) || undefined,
          txnDatetime: String(actionForm.txnDatetime || "").trim() || undefined,
          bookDate: String(actionForm.bookDate || "").trim() || undefined,
          idempotencyKey:
            String(actionForm.idempotencyKey || "").trim() || buildTransitReceiveIdempotencyKey(),
          referenceNo: String(actionForm.referenceNo || "").trim() || undefined,
          description: String(actionForm.description || "").trim() || undefined,
        });
        const transferInTxnId = response?.transferInTransaction?.id || "-";
        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.transitReceiveReplay", { transferInTxnId }));
        } else {
          setMessage(t("cashTransactions.messages.transitReceived", { transferInTxnId }));
        }
      } else if (actionForm.type === "post") {
        if (!canPost) {
          throw new Error(t("cashTransactions.errors.missingPostPermission"));
        }
        if (!POSTABLE_STATUSES.has(toUpper(row.status))) {
          throw new Error(t("cashTransactions.errors.postStatusInvalid"));
        }

        const overrideCashControl = actionForm.overrideCashControl === true;
        const overrideReason = String(actionForm.overrideReason || "").trim();
        if (overrideCashControl && !canOverridePost) {
          throw new Error(t("cashTransactions.errors.missingOverridePermission"));
        }
        if (overrideCashControl && !overrideReason) {
          throw new Error(t("cashTransactions.errors.overrideReasonRequired"));
        }

        const response = await postCashTransaction(transactionId, {
          overrideCashControl,
          overrideReason: overrideCashControl ? overrideReason : undefined,
        });
        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.idempotentReplay"));
        } else {
          setMessage(t("cashTransactions.messages.posted"));
        }
      } else if (actionForm.type === "cancel") {
        if (!CANCELLABLE_STATUSES.has(toUpper(row.status))) {
          throw new Error(t("cashTransactions.errors.cancelStatusInvalid"));
        }
        const cancelReason = String(actionForm.cancelReason || "").trim();
        if (!cancelReason) {
          throw new Error(t("cashTransactions.errors.cancelReasonRequired"));
        }
        await cancelCashTransaction(transactionId, { cancelReason });
        setMessage(t("cashTransactions.messages.cancelled"));
      } else if (actionForm.type === "reverse") {
        if (toUpper(row.status) !== "POSTED") {
          throw new Error(t("cashTransactions.errors.reverseStatusInvalid"));
        }
        if (toPositiveInt(row.reversal_of_transaction_id)) {
          throw new Error(t("cashTransactions.errors.reverseReversalNotAllowed"));
        }
        const reverseReason = String(actionForm.reverseReason || "").trim();
        if (!reverseReason) {
          throw new Error(t("cashTransactions.errors.reverseReasonRequired"));
        }
        const response = await reverseCashTransaction(transactionId, { reverseReason });
        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.idempotentReplay"));
        } else {
          setMessage(
            t("cashTransactions.messages.reversed", {
              reversalId: response?.reversal?.id || "-",
            })
          );
        }
      } else if (actionForm.type === "applyCari") {
        if (!canApplyCari) {
          throw new Error(t("cashTransactions.errors.missingApplyCariPermission"));
        }
        if (toUpper(row.status) !== "POSTED") {
          throw new Error(t("cashTransactions.errorsMapped.applyRequiresPostedTxn"));
        }
        if (!CARI_SETTLEMENT_LINKED_TXN_TYPES.has(toUpper(row.txn_type))) {
          throw new Error(t("cashTransactions.errors.onlyReceiptPayoutCanApplyCari"));
        }

        const expectedCounterpartyType = resolveExpectedCounterpartyType(row.txn_type);
        const rowCounterpartyType = toUpper(row.counterparty_type);
        const rowCounterpartyId = toPositiveInt(row.counterparty_id);
        if (!rowCounterpartyId || rowCounterpartyType !== expectedCounterpartyType) {
          throw new Error(
            t("cashTransactions.errors.applyCounterpartyTypeMismatch", {
              expected: expectedCounterpartyType,
            })
          );
        }

        const settlementDate = String(actionForm.settlementDate || "").trim();
        if (!settlementDate) {
          throw new Error(t("cashTransactions.errors.settlementDateRequired"));
        }

        const draftMap = actionForm.applyDrafts || {};
        const applications = [];
        for (const [openItemIdText, amountText] of Object.entries(draftMap)) {
          const openItemId = toPositiveInt(openItemIdText);
          const amountTxn = toOptionalNumber(amountText);
          if (!openItemId || !Number.isFinite(amountTxn) || amountTxn <= 0) {
            continue;
          }
          const openRow = applyOpenItems.find(
            (item) => toPositiveInt(item?.openItemId) === openItemId
          );
          const maxResidual = Number(openRow?.residualAmountTxnAsOf || 0);
          if (amountTxn > maxResidual + 0.000001) {
            throw new Error(t("cashTransactions.errors.overApplyDetected", { openItemId }));
          }
          applications.push({
            openItemId,
            amountTxn: Number(amountTxn.toFixed(6)),
          });
        }

        const selectedTotal = applications.reduce(
          (sum, item) => Number((sum + Number(item.amountTxn || 0)).toFixed(6)),
          0
        );
        const cashAmount = Number(row.amount || 0);
        if (selectedTotal > cashAmount + 0.000001) {
          throw new Error(t("cashTransactions.errors.applySelectedTotalExceedsCashAmount"));
        }

        const response = await applyCariForCashTransaction(transactionId, {
          settlementDate,
          idempotencyKey:
            String(actionForm.idempotencyKey || "").trim() || buildApplyCariIdempotencyKey(),
          autoAllocate: false,
          useUnappliedCash: Boolean(actionForm.useUnappliedCash),
          fxRate:
            actionForm.fxRate === null ||
            actionForm.fxRate === undefined ||
            String(actionForm.fxRate).trim() === ""
              ? undefined
              : Number(actionForm.fxRate),
          note: String(actionForm.note || "").trim() || undefined,
          applications,
        });

        if (response?.idempotentReplay) {
          setInfoMessage(t("cashTransactions.messages.applyReplayReturned"));
        } else {
          const settlementBatchId = response?.row?.id || null;
          const createdUnappliedCashId = response?.unapplied?.createdUnappliedCashId || null;
          setMessage(
            settlementBatchId
              ? t("cashTransactions.messages.applyCompletedSettlement", { settlementBatchId })
              : createdUnappliedCashId
                ? t("cashTransactions.messages.applyCreatedUnapplied", { createdUnappliedCashId })
                : t("cashTransactions.messages.applyCompleted")
          );
        }
      }

      setActionForm(null);
      await loadPageData(filters);
    } catch (err) {
      const errorState = toTransactionErrorState(err, t, "cashTransactions.errors.action");
      setError(errorState.message);
      setErrorRequestId(errorState.requestId);
    } finally {
      setActionSaving(false);
    }
  }

  function canPostRow(row) {
    return POSTABLE_STATUSES.has(toUpper(row?.status));
  }

  function canCancelRow(row) {
    return CANCELLABLE_STATUSES.has(toUpper(row?.status));
  }

  function canReverseRow(row) {
    if (toUpper(row?.status) !== "POSTED") {
      return false;
    }
    if (toPositiveInt(row?.reversal_of_transaction_id)) {
      return false;
    }
    return true;
  }

  function canApplyCariRow(row) {
    if (toUpper(row?.status) !== "POSTED") {
      return false;
    }
    if (!CARI_SETTLEMENT_LINKED_TXN_TYPES.has(toUpper(row?.txn_type))) {
      return false;
    }
    const expectedCounterpartyType = resolveExpectedCounterpartyType(row?.txn_type);
    if (!expectedCounterpartyType) {
      return false;
    }
    if (toUpper(row?.counterparty_type) !== expectedCounterpartyType) {
      return false;
    }
    if (!toPositiveInt(row?.counterparty_id)) {
      return false;
    }
    if (
      toPositiveInt(row?.linked_cari_settlement_batch_id || row?.linkedCariSettlementBatchId) ||
      toPositiveInt(row?.linked_cari_unapplied_cash_id || row?.linkedCariUnappliedCashId)
    ) {
      return false;
    }
    return true;
  }

  function canReceiveTransitRow(row) {
    if (!canCreate) {
      return false;
    }
    if (toUpper(row?.txn_type) !== "TRANSFER_OUT") {
      return false;
    }
    if (toUpper(row?.status) !== "POSTED") {
      return false;
    }
    if (!toPositiveInt(row?.cash_transit_transfer_id)) {
      return false;
    }
    if (toUpper(row?.cash_transit_status) !== "IN_TRANSIT") {
      return false;
    }
    if (toPositiveInt(row?.cash_transit_transfer_in_transaction_id)) {
      return false;
    }
    return true;
  }

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {t("cashTransactions.errors.missingReadPermission")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {presetTxnType === "PAYOUT"
            ? t("cashTransactions.presetTitles.payout")
            : presetTxnType === "RECEIPT"
            ? t("cashTransactions.presetTitles.receipt")
            : t("cashTransactions.presetTitles.all")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("cashTransactions.subtitle")}</p>
      </div>

      <CashControlModeBanner />

      {presetTxnType === "PAYOUT" ? (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {t("cashTransactions.presetNotices.payout")}
        </div>
      ) : null}
      {presetTxnType === "RECEIPT" ? (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {t("cashTransactions.presetNotices.receipt")}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p>{error}</p>
          {errorRequestId ? (
            <p className="mt-1 text-xs font-medium text-rose-700">
              {t("cashTransactions.errors.requestId", { requestId: errorRequestId })}
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {infoMessage ? (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {infoMessage}
        </div>
      ) : null}
      {combinedLookupWarning ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {combinedLookupWarning}
        </div>
      ) : null}
      {counterpartyWarning ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {counterpartyWarning}
        </div>
      ) : null}
      {savedViewsError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {savedViewsError}
        </div>
      ) : null}
      {savedViewsMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {savedViewsMessage}
        </div>
      ) : null}
      {templatesError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {templatesError}
        </div>
      ) : null}
      {templatesMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {templatesMessage}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {t("cashTransactions.sections.filters")}
        </h2>
        <form
          className="grid gap-2 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            loadPageData(filters);
          }}
        >
          {registerOptions.length > 0 ? (
            <select
              value={filters.registerId}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  registerId: event.target.value,
                  sessionId: "",
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("cashTransactions.placeholders.allRegisters")}</option>
              {registerOptions.map((row) => (
                <option key={`filter-register-${row.id}`} value={row.id}>
                  {formatRegisterOptionText(row, l)}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={1}
              value={filters.registerId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, registerId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.registerId")}
            />
          )}

          <input
            type="number"
            min={1}
            value={filters.sessionId}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, sessionId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t("cashTransactions.form.sessionId")}
          />

          {canFilterByTxnType ? (
            <select
              value={filters.txnType}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, txnType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("cashTransactions.placeholders.allTypes")}</option>
              {FILTER_TXN_TYPES.map((txnType) => (
                <option key={`filter-txn-type-${txnType}`} value={txnType}>
                  {txnType}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={effectiveTxnTypeFilter}
              readOnly
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            />
          )}

          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{t("cashTransactions.placeholders.allStatuses")}</option>
            {TXN_STATUSES.map((status) => (
              <option key={`filter-status-${status}`} value={status}>
                {status}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={filters.bookDateFrom}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, bookDateFrom: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <input
            type="date"
            value={filters.bookDateTo}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, bookDateTo: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <div className="md:col-span-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("cashTransactions.actions.applyFilters")}
            </button>
            <button
              type="button"
              onClick={() => {
                const reset = resetFilters(buildInitialFilters(presetTxnType));
                loadPageData(reset);
              }}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("cashTransactions.actions.clearFilters")}
            </button>
            <button
              type="button"
              onClick={() => loadPageData(filters)}
              disabled={loading}
              className="rounded-lg border border-cyan-300 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
            >
              {loading
                ? t("cashTransactions.actions.loading")
                : t("cashTransactions.actions.refresh")}
            </button>
            <button
              type="button"
              onClick={handleExportTransactionsCsv}
              disabled={loading || transactionRows.length === 0}
              className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            >
              {t("cashTransactions.actions.exportCsv", "Export CSV")}
            </button>
          </div>
          <div className="md:col-span-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("cashTransactions.savedViews.title", "Saved Views (server-side)")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={selectedSavedViewId}
                onChange={(event) => setSelectedSavedViewId(event.target.value)}
                disabled={savedViewsLoading || savedViewsSaving || savedViews.length === 0}
              >
                <option value="">
                  {t("cashTransactions.savedViews.selectPlaceholder", "Select saved view")}
                </option>
                {savedViews.map((row) => (
                  <option key={`cash-saved-view-${row.id}`} value={row.id}>
                    {row.name}
                    {row.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() => applyTransactionSavedView(selectedSavedView)}
                disabled={!selectedSavedView || savedViewsSaving}
              >
                {t("cashTransactions.savedViews.apply", "Apply")}
              </button>
              <button
                type="button"
                className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                onClick={handleCreateTransactionSavedView}
                disabled={savedViewsSaving}
              >
                {t("cashTransactions.savedViews.saveCurrent", "Save Current")}
              </button>
              <button
                type="button"
                className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
                onClick={handleUpdateTransactionSavedView}
                disabled={!selectedSavedView || savedViewsSaving}
              >
                {t("cashTransactions.savedViews.update", "Update Selected")}
              </button>
              <button
                type="button"
                className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                onClick={handleSetDefaultTransactionSavedView}
                disabled={!selectedSavedView || savedViewsSaving}
              >
                {t("cashTransactions.savedViews.setDefault", "Set Default")}
              </button>
              <button
                type="button"
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                onClick={handleDeleteTransactionSavedView}
                disabled={!selectedSavedView || savedViewsSaving}
              >
                {t("cashTransactions.savedViews.delete", "Delete")}
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() =>
                  loadTransactionSavedViews({ preferredId: selectedSavedViewId })
                }
                disabled={savedViewsLoading || savedViewsSaving}
              >
                {savedViewsLoading
                  ? t("cashTransactions.actions.loading")
                  : t("cashTransactions.savedViews.refresh", "Refresh Saved Views")}
              </button>
            </div>
          </div>
        </form>
      </section>

      {canCreate ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {t("cashTransactions.sections.create")}
          </h2>
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("cashTransactions.templates.title", "Templates + Presets")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                disabled={templatesLoading || templatesSaving || templates.length === 0 || creating}
              >
                <option value="">
                  {t("cashTransactions.templates.selectPlaceholder", "Select template")}
                </option>
                {templates.map((row) => (
                  <option key={`cash-create-template-${row.id}`} value={row.id}>
                    {row.name}
                    {row.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() => applyTransactionTemplate(selectedTemplate)}
                disabled={!selectedTemplate || templatesSaving || creating}
              >
                {t("cashTransactions.templates.apply", "Apply Template")}
              </button>
              <button
                type="button"
                className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                onClick={handleCreateTransactionTemplate}
                disabled={templatesSaving || creating}
              >
                {t("cashTransactions.templates.saveCurrent", "Save Current")}
              </button>
              <button
                type="button"
                className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
                onClick={handleUpdateTransactionTemplate}
                disabled={!selectedTemplate || templatesSaving || creating}
              >
                {t("cashTransactions.templates.update", "Update")}
              </button>
              <button
                type="button"
                className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                onClick={handleSetDefaultTransactionTemplate}
                disabled={!selectedTemplate || templatesSaving || creating}
              >
                {t("cashTransactions.templates.setDefault", "Set Default")}
              </button>
              <button
                type="button"
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                onClick={handleDeleteTransactionTemplate}
                disabled={!selectedTemplate || templatesSaving || creating}
              >
                {t("cashTransactions.templates.delete", "Delete")}
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() => loadTransactionTemplates({ preferredId: selectedTemplateId })}
                disabled={templatesLoading || templatesSaving || creating}
              >
                {templatesLoading
                  ? t("cashTransactions.actions.loading")
                  : t("cashTransactions.templates.refresh", "Refresh Templates")}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={selectedPresetCode}
                onChange={(event) => setSelectedPresetCode(event.target.value)}
                disabled={availablePresetOptions.length === 0 || creating}
              >
                <option value="">
                  {t("cashTransactions.templates.selectPreset", "Select preset")}
                </option>
                {availablePresetOptions.map((row) => (
                  <option key={`cash-create-preset-${row.code}`} value={row.code}>
                    {row.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-60"
                onClick={handleApplyCreatePreset}
                disabled={!selectedPresetCode || creating}
              >
                {t("cashTransactions.templates.applyPreset", "Apply Preset")}
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={resetCreateFormWithDefaults}
                disabled={creating}
              >
                {t("cashTransactions.actions.resetForm", "Reset Form")}
              </button>
            </div>
          </div>
          <form onSubmit={handleCreateTransaction} className="grid gap-2 md:grid-cols-3">
            {registerOptions.length > 0 ? (
              <select
                value={form.registerId}
                onChange={(event) => handleRegisterChange(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">{t("cashTransactions.placeholders.register")}</option>
                {registerOptions.map((row) => (
                  <option key={`form-register-${row.id}`} value={row.id}>
                    {formatRegisterOptionText(row, l)}
                  </option>
                ))}
              </select>
            ) : (
                <input
                  type="number"
                  min={1}
                  value={form.registerId}
                  onChange={(event) => handleRegisterChange(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("cashTransactions.form.registerIdManualFallback")}
                  required
                />
              )}
            {registerOptions.length === 0 ? (
              <div className="md:col-span-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p>{t("cashTransactions.warnings.noRegisterList")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    to={CASH_REGISTER_SETUP_PATH}
                    className="inline-flex items-center rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
                  >
                    {t("cashTransactions.actions.openRegisterSetup")}
                  </Link>
                </div>
              </div>
            ) : null}

            {selectedRegisterOpenSessions.length > 0 ? (
              <select
                value={form.cashSessionId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, cashSessionId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={sessionModeDisablesSession}
              >
                <option value="">{createSessionPlaceholder}</option>
                {selectedRegisterOpenSessions.map((session) => (
                  <option key={`form-session-${session.id}`} value={session.id}>
                    {formatSessionDisplayLabel(session, l)}
                  </option>
                ))}
              </select>
            ) : (
                <input
                  type="number"
                  min={1}
                  value={form.cashSessionId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, cashSessionId: event.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={createSessionManualPlaceholder}
                  disabled={sessionModeDisablesSession}
                />
              )}
            {sessionFallbackHint ? (
              <div className="md:col-span-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p>{sessionFallbackHint}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    to={
                      selectedRegisterId
                        ? `${CASH_SESSION_SETUP_PATH}?registerId=${selectedRegisterId}`
                        : CASH_SESSION_SETUP_PATH
                    }
                    className="inline-flex items-center rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
                  >
                    {t("cashTransactions.actions.openSessionSetup")}
                  </Link>
                  {!selectedRegisterId ? (
                    <Link
                      to={CASH_REGISTER_SETUP_PATH}
                      className="inline-flex items-center rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
                    >
                      {t("cashTransactions.actions.openRegisterSetup")}
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}

            <select
              value={form.txnType}
              onChange={(event) => handleTxnTypeChange(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={!canFilterByTxnType}
            >
              {(presetTxnType ? [presetTxnType] : MANUAL_TXN_TYPES).map((txnType) => (
                <option key={`form-txn-type-${txnType}`} value={txnType}>
                  {txnType}
                </option>
              ))}
            </select>

            <input
              type="datetime-local"
              value={form.txnDatetime}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, txnDatetime: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />

            <input
              type="date"
              value={form.bookDate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, bookDate: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />

            <input
              type="number"
              min="0.000001"
              step="0.000001"
              value={form.amount}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, amount: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.amount")}
              required
            />

            <input
              value={form.currencyCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, currencyCode: toUpper(event.target.value) }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.currencyCode")}
              maxLength={3}
              required
            />

            <input
              value={form.referenceNo}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, referenceNo: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.referenceNoOptional")}
              maxLength={100}
            />

            <input
              value={form.sourceDocId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sourceDocId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("cashTransactions.form.sourceDocIdOptional")}
              maxLength={80}
            />

            <select
              value={form.sourceDocType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sourceDocType: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("cashTransactions.form.sourceDocTypeOptional")}</option>
              {SOURCE_DOC_TYPES.map((value) => (
                <option key={`source-doc-type-${value}`} value={value}>
                  {value}
                </option>
              ))}
            </select>

            {showCounterpartyFields ? (
              <>
                <select
                  value={form.counterpartyType}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, counterpartyType: event.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("cashTransactions.form.counterpartyTypeOptional")}</option>
                  {COUNTERPARTY_TYPES.map((value) => (
                    <option key={`counterparty-type-${value}`} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                {counterpartyPickerReady ? (
                  <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
                    <input
                      type="text"
                      value={counterpartyQuery}
                      onChange={(event) => setCounterpartyQuery(event.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder={t("cashTransactions.placeholders.searchCounterparty")}
                    />
                    <select
                      value={form.counterpartyId}
                      onChange={(event) => handleCounterpartyPick(event.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">
                        {counterpartyLoading
                          ? t("cashTransactions.values.loadingCounterparties")
                          : t("cashTransactions.placeholders.selectCounterparty")}
                      </option>
                      {counterpartyOptions.map((row) => (
                        <option key={`counterparty-option-${row.id}`} value={row.id}>
                          {`${row.code || row.id} - ${row.name || "-"} (${row.counterpartyType || "OTHER"})`}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input
                    type="number"
                    min={1}
                    value={form.counterpartyId}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, counterpartyId: event.target.value }))
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("cashTransactions.form.counterpartyIdManualFallback")}
                  />
                )}
                {counterpartyFallbackHint ? (
                  <div className="md:col-span-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <p>{counterpartyFallbackHint}</p>
                    {!selectedRegisterId || !toPositiveInt(selectedRegister?.legal_entity_id) ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          to={CASH_REGISTER_SETUP_PATH}
                          className="inline-flex items-center rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
                        >
                          {t("cashTransactions.actions.openRegisterSetup")}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedCounterpartyOption ? (
                  <div className="md:col-span-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {t("cashTransactions.values.selectedCounterparty", {
                      code: selectedCounterpartyOption.code || selectedCounterpartyOption.id,
                      name: selectedCounterpartyOption.name || "-",
                      type: selectedCounterpartyOption.counterpartyType || "OTHER",
                    })}
                  </div>
                ) : null}
              </>
            ) : null}

            {showCounterAccountPicker ? (
              <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
                <input
                  type="text"
                  value={accountQuery}
                  onChange={(event) => setAccountQuery(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={counterAccountPickerDisabled}
                  placeholder={t(
                    counterAccountIsTransfer
                      ? "cashTransactions.placeholders.searchTransitAccount"
                      : "cashTransactions.placeholders.searchAccount"
                  )}
                />
                <select
                  value={form.counterAccountId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, counterAccountId: event.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={counterAccountPickerDisabled}
                  required={counterAccountIsRequired}
                >
                  <option value="">
                    {t(
                      counterAccountIsTransfer
                        ? "cashTransactions.placeholders.transitCounterAccount"
                        : "cashTransactions.placeholders.counterAccount"
                    )}
                  </option>
                  {filteredCounterAccountOptions.map((account) => (
                    <option key={`counter-account-${account.id}`} value={account.id}>
                      {formatAccountOptionLabel(account)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                type="number"
                min={1}
                value={form.counterAccountId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, counterAccountId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("cashTransactions.form.counterAccountIdManualFallback")}
                required={counterAccountIsRequired}
              />
            )}
            {selectedCounterAccountOption ? (
              <div className="md:col-span-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-800">
                {t("cashTransactions.values.selectedCounterAccount", {
                  code:
                    selectedCounterAccountOption.code || selectedCounterAccountOption.id,
                  name: selectedCounterAccountOption.name || "-",
                })}
              </div>
            ) : null}

            {isTransferTxnType(form.txnType) ? (
              registerOptions.length > 0 ? (
                <select
                  value={form.counterCashRegisterId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      counterCashRegisterId: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">{t("cashTransactions.placeholders.counterRegister")}</option>
                  {registerOptions
                    .filter((row) => String(row.id) !== String(form.registerId))
                    .map((row) => (
                      <option key={`counter-register-${row.id}`} value={row.id}>
                        {formatRegisterOptionText(row, l)}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={form.counterCashRegisterId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      counterCashRegisterId: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("cashTransactions.form.counterCashRegisterIdOptional")}
                  required
                />
              )
            ) : (
              <input
                type="text"
                readOnly
                value={t("cashTransactions.values.notApplicable")}
                className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
              />
            )}

            {isTransferTxnType(form.txnType) && selectedTransferRouteMeta ? (
              <div className="md:col-span-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                <div className="font-semibold">{selectedTransferRouteMeta.modeLabel}</div>
                <div className="mt-1 text-xs font-medium text-sky-950">
                  {selectedTransferRouteMeta.routeLabel}
                </div>
                <div className="mt-1 text-xs">{selectedTransferRouteMeta.description}</div>
              </div>
            ) : null}

            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
              placeholder={t("cashTransactions.form.descriptionOptional")}
              maxLength={500}
            />

            <div className="md:col-span-3 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {creating
                  ? t("cashTransactions.actions.creating")
                  : t("cashTransactions.actions.create")}
              </button>
            </div>
          </form>

          {createWarnings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <ul className="list-disc pl-5">
                {createWarnings.map((warning, index) => (
                  <li key={`cash-txn-warning-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
          {t("cashTransactions.readOnlyNotice")}
        </div>
      )}

      {actionForm ? (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-cyan-800">
            {t("cashTransactions.sections.action")}
          </h2>
          <form onSubmit={handleActionSubmit} className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-cyan-200 bg-white px-3 py-2 text-xs text-slate-700 md:col-span-2">
              {t("cashTransactions.selectedTransactionSummary", {
                id: selectedActionRow?.id || "-",
                txnNo: selectedActionRow?.txn_no || "-",
                status: localizeTxnStatus(selectedActionRow?.status),
              })}
            </div>

            {actionForm.type === "post" ? (
              <>
                {canOverridePost ? (
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={actionForm.overrideCashControl === true}
                      onChange={(event) =>
                        setActionForm((prev) => ({
                          ...prev,
                          overrideCashControl: event.target.checked,
                        }))
                      }
                    />
                    {t("cashTransactions.form.overrideCashControl")}
                  </label>
                ) : null}
                {actionForm.overrideCashControl ? (
                  <textarea
                    value={actionForm.overrideReason}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        overrideReason: event.target.value,
                      }))
                    }
                    className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                    placeholder={t("cashTransactions.form.overrideReason")}
                    maxLength={500}
                    required
                  />
                ) : null}
              </>
            ) : null}

            {actionForm.type === "cancel" ? (
              <textarea
                value={actionForm.cancelReason}
                onChange={(event) =>
                  setActionForm((prev) => ({
                    ...prev,
                    cancelReason: event.target.value,
                  }))
                }
                className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={t("cashTransactions.form.cancelReason")}
                maxLength={255}
                required
              />
            ) : null}

            {actionForm.type === "reverse" ? (
              <textarea
                value={actionForm.reverseReason}
                onChange={(event) =>
                  setActionForm((prev) => ({
                    ...prev,
                    reverseReason: event.target.value,
                  }))
                }
                className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                placeholder={t("cashTransactions.form.reverseReason")}
                maxLength={255}
                required
              />
            ) : null}

            {actionForm.type === "receiveTransit" ? (
              <>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.transitTransferId")}
                  <input
                    type="text"
                    value={actionForm.transitTransferId || ""}
                    readOnly
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-600"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.bookDate")}
                  <input
                    type="date"
                    value={actionForm.bookDate || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        bookDate: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.txnDatetime")}
                  <input
                    type="datetime-local"
                    value={actionForm.txnDatetime || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        txnDatetime: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                    required
                  />
                </label>
                {selectedTransitTargetOpenSessions.length > 0 ? (
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t("cashTransactions.form.cashSessionIdOptional")}
                    <select
                      value={actionForm.cashSessionId || ""}
                      onChange={(event) =>
                        setActionForm((prev) => ({
                          ...prev,
                          cashSessionId: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                      disabled={actionSaving}
                    >
                      <option value="">{t("cashTransactions.placeholders.autoOrNone")}</option>
                      {selectedTransitTargetOpenSessions.map((session) => (
                        <option key={`receive-transit-session-${session.id}`} value={session.id}>
                          {formatSessionDisplayLabel(session, l)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t("cashTransactions.form.cashSessionIdOptional")}
                    <input
                      type="number"
                      min={1}
                      value={actionForm.cashSessionId || ""}
                      onChange={(event) =>
                        setActionForm((prev) => ({
                          ...prev,
                          cashSessionId: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                      disabled={actionSaving}
                    />
                  </label>
                )}
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                  {t("cashTransactions.form.idempotencyKey")}
                  <input
                    type="text"
                    value={actionForm.idempotencyKey || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        idempotencyKey: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.referenceNoOptional")}
                  <input
                    type="text"
                    value={actionForm.referenceNo || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        referenceNo: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.descriptionOptional")}
                  <input
                    type="text"
                    value={actionForm.description || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                  />
                </label>
              </>
            ) : null}

            {actionForm.type === "applyCari" ? (
              <>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.settlementDate")}
                  <input
                    type="date"
                    value={actionForm.settlementDate || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        settlementDate: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.asOfDateOpenDocs")}
                  <input
                    type="date"
                    value={actionForm.asOfDate || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        asOfDate: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                  {t("cashTransactions.form.idempotencyKey")}
                  <input
                    type="text"
                    value={actionForm.idempotencyKey || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        idempotencyKey: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("cashTransactions.form.fxRateOptional")}
                  <input
                    type="number"
                    min="0.0000000001"
                    step="0.0000000001"
                    value={actionForm.fxRate || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        fxRate: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                  />
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(actionForm.useUnappliedCash)}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        useUnappliedCash: event.target.checked,
                      }))
                    }
                    disabled={actionSaving}
                  />
                  {t("cashTransactions.form.useUnappliedCash")}
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                  {t("cashTransactions.form.noteOptional")}
                  <input
                    type="text"
                    value={actionForm.note || ""}
                    onChange={(event) =>
                      setActionForm((prev) => ({
                        ...prev,
                        note: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    disabled={actionSaving}
                  />
                </label>

                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 md:col-span-2">
                  <p className="font-semibold text-slate-800">
                    {t("cashTransactions.apply.openDocsTitle")}
                  </p>
                  <p className="mt-1">
                    {t("cashTransactions.apply.openDocsDescription")}
                  </p>
                  <p className="mt-1">
                    {t("cashTransactions.apply.selectedTotal", {
                      total: formatMoneyText(
                        applySelectedTotal,
                        selectedActionRow?.currency_code
                      ),
                    })}
                  </p>
                  {applyOpenItemsError ? (
                    <p className="mt-1 text-rose-700">{applyOpenItemsError}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={fillApplyDraftsWithOpenAmounts}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      disabled={actionSaving || applyOpenItemsLoading}
                    >
                      {t("cashTransactions.actions.fillAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActionForm((prev) =>
                          prev && prev.type === "applyCari"
                            ? { ...prev, applyDrafts: {} }
                            : prev
                        )
                      }
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      disabled={actionSaving || applyOpenItemsLoading}
                    >
                      {t("cashTransactions.actions.clear")}
                    </button>
                  </div>
                  <div className="mt-2 max-h-64 overflow-auto rounded border border-slate-200">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="px-2 py-1">{t("cashTransactions.apply.table.document")}</th>
                          <th className="px-2 py-1">{t("cashTransactions.apply.table.openItem")}</th>
                          <th className="px-2 py-1">{t("cashTransactions.apply.table.dueDate")}</th>
                          <th className="px-2 py-1">{t("cashTransactions.apply.table.openAmount")}</th>
                          <th className="px-2 py-1">{t("cashTransactions.apply.table.applyAmount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {applyOpenItems.map((item) => (
                          <tr key={`apply-open-item-${item.openItemId}`} className="border-t border-slate-100">
                            <td className="px-2 py-1">{item.documentNo || item.documentId}</td>
                            <td className="px-2 py-1">{item.openItemId}</td>
                            <td className="px-2 py-1">{item.dueDate || "-"}</td>
                            <td className="px-2 py-1">
                              <MoneyText
                                amount={item.residualAmountTxnAsOf}
                                currencyCode={item.currencyCode || item.currency_code}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={(actionForm.applyDrafts || {})[String(item.openItemId)] || ""}
                                onChange={(event) =>
                                  setApplyDraftAmount(item.openItemId, event.target.value)
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-1"
                                disabled={actionSaving}
                              />
                            </td>
                          </tr>
                        ))}
                        {applyOpenItems.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-2 py-2 text-slate-500">
                              {applyOpenItemsLoading
                                ? t("cashTransactions.apply.loadingOpenDocuments")
                                : t("cashTransactions.apply.noOpenDocuments")}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}

            <div className="md:col-span-2 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={actionSaving}
                className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {actionSaving
                  ? t("cashTransactions.actions.saving")
                  : t("cashTransactions.actions.submitAction")}
              </button>
              <button
                type="button"
                onClick={() => setActionForm(null)}
                disabled={actionSaving}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {t("cashTransactions.actions.cancelAction")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {selectedLifecycleTransactionRow ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {t("cashTransactions.sections.lifecycle")}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                {t("cashTransactions.lifecycle.snapshotTitle")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {t("cashTransactions.selectedTransactionSummary", {
                  id: selectedLifecycleTransactionRow.id || "-",
                  txnNo: selectedLifecycleTransactionRow.txn_no || "-",
                  status: localizeTxnStatus(selectedLifecycleTransactionRow.status),
                })}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {selectedTransactionLifecycleMeta?.description || ""}
              </p>
              {selectedTransactionLifecycleActionLabels.length > 0 ? (
                <p className="mt-1 text-xs text-slate-600">
                  {t("cashTransactions.lifecycle.nextTransitions", {
                    actions: selectedTransactionLifecycleActionLabels.join(", "),
                  })}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  {t("cashTransactions.lifecycle.noTransitions")}
                </p>
              )}
            </div>
            <StatusTimeline
              title={t("cashTransactions.lifecycle.timelineTitle")}
              steps={selectedTransactionLifecycleTimeline}
              emptyText={t("cashTransactions.lifecycle.timelineEmpty")}
            />
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {t("cashTransactions.sections.list")}
        </h2>
        <p className="mb-3 text-xs text-slate-600">
          {t(
            "cashTransactions.listSummary",
            "Showing {{shown}} of {{total}} rows on page {{page}}/{{pages}}.",
            {
              shown: pagedTransactionRows.length,
              total: transactionRows.length,
              page: transactionListPage,
              pages: transactionListTotalPages,
            }
          )}
        </p>
        <TablePreferencesPanel
          title={t("cashTransactions.tablePreferences.title", "Transaction table preferences")}
          rowsPerPage={transactionRowsPerPage}
          rowsPerPageOptions={CASH_TRANSACTION_TABLE_ROWS_PER_PAGE_OPTIONS}
          onRowsPerPageChange={handleTransactionTableRowsPerPageChange}
          stickyHeader={transactionTablePrefs.stickyHeader}
          onStickyHeaderChange={handleTransactionTableStickyHeaderChange}
          columns={transactionTableColumns}
          visibleColumnIds={transactionTablePrefs.visibleColumnIds}
          onToggleColumn={handleTransactionTableToggleColumn}
          onSelectAllColumns={handleTransactionTableSelectAllColumns}
          onReset={handleTransactionTableResetPrefs}
          className="mb-3"
        />
        <div className="max-h-[30rem] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead
              className={`bg-slate-50 text-left text-slate-600 ${
                transactionTablePrefs.stickyHeader ? "sticky top-0 z-10" : ""
              }`}
            >
              <tr>
                {transactionVisibleColumnSet.has("id") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.id")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("txnNo") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.txnNo")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("txnType") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.txnType")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("status") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.status")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("register") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.register")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("session") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.session")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("bookDate") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.bookDate")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("amount") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.amount")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("currency") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.currency")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("counterparty") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.counterparty")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("counterAccount") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.counterAccount")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("counterRegister") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.counterRegister")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("links") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.links")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("postedJournal") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.postedJournal")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("overrideReason") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.overrideReason")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("createdAt") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.createdAt")}</th>
                ) : null}
                {transactionVisibleColumnSet.has("actions") ? (
                  <th className="px-3 py-2">{t("cashTransactions.table.actions")}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {pagedTransactionRows.map((row) => {
                const rowStatus = toUpper(row.status);
                const rowStatusLabel = localizeTxnStatus(row.status);
                const rowIsPosted = rowStatus === "POSTED";
                const rowIsLifecycleSelected =
                  toPositiveInt(row.id) === toPositiveInt(selectedLifecycleTransactionId);
                const rowRegisterLabel = formatRegisterDisplayLabel(row, l);
                const rowCounterRegisterLabel = row.counter_cash_register_id
                  ? formatRegisterDisplayLabel(row, l, {
                      codeKeys: ["counter_cash_register_code", "counterCashRegisterCode"],
                      idKeys: ["counter_cash_register_id", "counterCashRegisterId"],
                      nameKeys: ["counter_cash_register_name", "counterCashRegisterName"],
                      explicitOwnershipKeys: [
                        "counter_cash_register_ownership_context_label",
                        "counterCashRegisterOwnershipContextLabel",
                      ],
                      operatingUnitCodeKeys: [
                        "counter_cash_register_operating_unit_code",
                        "counterCashRegisterOperatingUnitCode",
                      ],
                      operatingUnitIdKeys: [
                        "counter_cash_register_operating_unit_id",
                        "counterCashRegisterOperatingUnitId",
                      ],
                    })
                  : null;
                return (
                  <tr
                    key={`cash-transaction-row-${row.id}`}
                    className={`border-t border-slate-100 ${
                      rowIsLifecycleSelected ? "bg-cyan-50" : rowIsPosted ? "bg-slate-50/60" : ""
                    }`}
                  >
                    {transactionVisibleColumnSet.has("id") ? (
                      <td className="px-3 py-2">{row.id}</td>
                    ) : null}
                    {transactionVisibleColumnSet.has("txnNo") ? (
                      <td className="px-3 py-2">{row.txn_no || "-"}</td>
                    ) : null}
                    {transactionVisibleColumnSet.has("txnType") ? (
                      <td className="px-3 py-2">{row.txn_type || "-"}</td>
                    ) : null}
                    {transactionVisibleColumnSet.has("status") ? (
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClassName(
                            row.status
                          )}`}
                        >
                          {rowStatusLabel}
                        </span>
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("register") ? (
                      <td className="px-3 py-2">
                        <div>{rowRegisterLabel.baseLabel}</div>
                        <div className="text-xs text-slate-500">
                          {rowRegisterLabel.ownershipContext}
                        </div>
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("session") ? (
                      <td className="px-3 py-2">{row.cash_session_id || "-"}</td>
                    ) : null}
                    {transactionVisibleColumnSet.has("bookDate") ? (
                      <td className="px-3 py-2">{row.book_date || "-"}</td>
                    ) : null}
                    {transactionVisibleColumnSet.has("amount") ? (
                      <td className="px-3 py-2">
                        <MoneyText amount={row.amount} currencyCode={row.currency_code} />
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("currency") ? (
                      <td className="px-3 py-2">{row.currency_code || "-"}</td>
                    ) : null}
                    {transactionVisibleColumnSet.has("counterparty") ? (
                      <td className="px-3 py-2">
                        {toPositiveInt(row.counterparty_id)
                          ? `${row.counterparty_type || "OTHER"} #${row.counterparty_id}`
                          : "-"}
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("counterAccount") ? (
                      <td className="px-3 py-2">
                        {row.counter_account_id
                          ? `${row.counter_account_code || row.counter_account_id} - ${
                              row.counter_account_name || "-"
                            }`
                          : "-"}
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("counterRegister") ? (
                      <td className="px-3 py-2">
                        {rowCounterRegisterLabel ? (
                          <>
                            <div>{rowCounterRegisterLabel.baseLabel}</div>
                            <div className="text-xs text-slate-500">
                              {rowCounterRegisterLabel.ownershipContext}
                            </div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("links") ? (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {toPositiveInt(row.cash_transit_transfer_id) ? (
                            <span className="inline-flex rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                              {t("cashTransactions.values.transitBadge", {
                                transferId: row.cash_transit_transfer_id,
                                status: localizeTransitStatus(row.cash_transit_status),
                              })}
                            </span>
                          ) : null}
                          {toPositiveInt(row.cash_transit_transfer_out_transaction_id) &&
                          toPositiveInt(row.cash_transit_transfer_in_transaction_id) ? (
                            <span className="inline-flex rounded border border-indigo-200 bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700">
                              {t("cashTransactions.values.transitPairBadge", {
                                outTxnId: row.cash_transit_transfer_out_transaction_id,
                                inTxnId: row.cash_transit_transfer_in_transaction_id,
                              })}
                            </span>
                          ) : null}
                          {toPositiveInt(
                            row.linked_cari_settlement_batch_id || row.linkedCariSettlementBatchId
                          ) ? (
                            <span className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              {t("cashTransactions.values.settlementBadge", {
                                settlementBatchId:
                                  row.linked_cari_settlement_batch_id ||
                                  row.linkedCariSettlementBatchId,
                              })}
                            </span>
                          ) : null}
                          {toPositiveInt(
                            row.linked_cari_unapplied_cash_id || row.linkedCariUnappliedCashId
                          ) ? (
                            <span className="inline-flex rounded border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                              {t("cashTransactions.values.unappliedBadge", {
                                unappliedCashId:
                                  row.linked_cari_unapplied_cash_id || row.linkedCariUnappliedCashId,
                              })}
                            </span>
                          ) : null}
                          {!toPositiveInt(
                            row.linked_cari_settlement_batch_id || row.linkedCariSettlementBatchId
                          ) &&
                          !toPositiveInt(
                            row.linked_cari_unapplied_cash_id || row.linkedCariUnappliedCashId
                          ) &&
                          !toPositiveInt(row.cash_transit_transfer_id) ? (
                            <span className="text-slate-400">-</span>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("postedJournal") ? (
                      <td className="px-3 py-2">
                        {row.posted_journal_entry_id || row.postedJournalEntryId || "-"}
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("overrideReason") ? (
                      <td className="px-3 py-2">
                        {row.override_reason || row.overrideReason || "-"}
                      </td>
                    ) : null}
                    {transactionVisibleColumnSet.has("createdAt") ? (
                      <td className="px-3 py-2">{formatDateTime(row.created_at)}</td>
                    ) : null}
                    {transactionVisibleColumnSet.has("actions") ? (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {canPost && canPostRow(row) ? (
                            <button
                              type="button"
                              onClick={() => openActionForm("post", row)}
                              className="rounded-md border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
                            >
                              {t("cashTransactions.actions.preparePost")}
                            </button>
                          ) : null}
                          {canCancel && canCancelRow(row) ? (
                            <button
                              type="button"
                              onClick={() => openActionForm("cancel", row)}
                              className="rounded-md border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                            >
                              {t("cashTransactions.actions.prepareCancel")}
                            </button>
                          ) : null}
                          {canReverse && canReverseRow(row) ? (
                            <button
                              type="button"
                              onClick={() => openActionForm("reverse", row)}
                              className="rounded-md border border-violet-300 px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                            >
                              {t("cashTransactions.actions.prepareReverse")}
                            </button>
                          ) : null}
                          {canReceiveTransitRow(row) ? (
                            <button
                              type="button"
                              onClick={() => openActionForm("receiveTransit", row)}
                              className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                            >
                              {t("cashTransactions.actions.receiveTransit")}
                            </button>
                          ) : null}
                          {canApplyCari && canApplyCariRow(row) ? (
                            <button
                              type="button"
                              onClick={() => openActionForm("applyCari", row)}
                              className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                            >
                              {t("cashTransactions.actions.applyCari")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setSelectedLifecycleTransactionId(String(row.id))}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {t("cashTransactions.actions.inspectLifecycle")}
                          </button>
                          {toPositiveInt(
                            row.linked_cari_settlement_batch_id || row.linkedCariSettlementBatchId
                          ) ||
                          toPositiveInt(
                            row.linked_cari_unapplied_cash_id || row.linkedCariUnappliedCashId
                          ) ? (
                            <span className="inline-flex rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                              {t("cashTransactions.values.linked")}
                            </span>
                          ) : null}
                          {!canPostRow(row) &&
                          !canCancelRow(row) &&
                          !canReverseRow(row) &&
                          !canReceiveTransitRow(row) &&
                          !(canApplyCari && canApplyCariRow(row)) ? (
                            <span className="text-slate-400">{t("cashTransactions.values.readOnly")}</span>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {loading ? (
                <tr>
                  <td colSpan={visibleTransactionColumnCount} className="px-3 py-3 text-slate-500">
                    {t("cashTransactions.loading")}
                  </td>
                </tr>
              ) : null}
              {!loading && transactionRows.length === 0 ? (
                <tr>
                  <td colSpan={visibleTransactionColumnCount} className="px-3 py-3 text-slate-500">
                    {t("cashTransactions.empty")}
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
            onClick={() => setTransactionListPage((current) => Math.max(1, current - 1))}
            disabled={transactionListPage <= 1}
          >
            {t("cashTransactions.pagination.previous", "Previous")}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={() =>
              setTransactionListPage((current) =>
                Math.min(transactionListTotalPages, current + 1)
              )
            }
            disabled={transactionListPage >= transactionListTotalPages}
          >
            {t("cashTransactions.pagination.next", "Next")}
          </button>
        </div>
      </section>
    </div>
  );
}
