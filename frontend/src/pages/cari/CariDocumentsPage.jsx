import { useEffect, useMemo, useState } from "react";
import {
  cancelCariDocument,
  createCariDocumentComment,
  createCariDocumentEvidence,
  createCariDocument,
  deleteCariDocumentEvidence,
  downloadCariDocumentEvidence,
  getCariDocument,
  getCariDocumentOpenItems,
  listCariDocumentComments,
  listCariDocumentEvidence,
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
import { getJournal, listAccounts } from "../../api/glAdmin.js";
import { listExceptionWorkbench } from "../../api/exceptionsWorkbench.js";
import { listCariAudit } from "../../api/cariAudit.js";
import {
  createMeSavedView,
  deleteMeSavedView,
  listMeSavedViews,
  updateMeSavedView,
} from "../../api/me.js";
import Combobox from "../../components/Combobox.jsx";
import StatusTimeline from "../../components/StatusTimeline.jsx";
import TablePreferencesPanel from "../../components/TablePreferencesPanel.jsx";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
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
  DOCUMENT_DIRECTIONS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
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
  const next = {
    legalEntityId: normalizePositiveIntText(input?.legalEntityId),
    counterpartyId: normalizePositiveIntText(input?.counterpartyId),
    paymentTermId: normalizePositiveIntText(input?.paymentTermId),
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
    counterpartyId: firstDefinedRowValue(row, "counterpartyId", "counterparty_id"),
    paymentTermId: firstDefinedRowValue(row, "paymentTermId", "payment_term_id"),
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
    counterpartyId: "",
    paymentTermId: "",
    direction: "AR",
    documentType: "INVOICE",
    documentDate: todayIsoDate(),
    dueDate: "",
    amountTxn: "",
    amountBase: "",
    currencyCode: "USD",
    fxRate: "",
  };
}

function normalizeApiError(error, fallback = "Operation failed.") {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function formatAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
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

function resolveCounterpartyRoleFromDirection(direction) {
  const normalized = String(direction || "").trim().toUpperCase();
  if (normalized === "AR") return "CUSTOMER";
  if (normalized === "AP") return "VENDOR";
  return undefined;
}

function normalizeDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "AR" || normalized === "AP") {
    return normalized;
  }
  return "";
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

function buildDocumentLifecycleEvents(row) {
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
      note: "Draft created.",
    });
  }
  if (postedAt) {
    events.push({
      statusCode: "POSTED",
      at: postedAt,
      note: "Posted to journal.",
    });
  }
  if (status === "PARTIALLY_SETTLED") {
    events.push({
      statusCode: "PARTIALLY_SETTLED",
      at: updatedAt,
      note: updatedAt
        ? "Partially settled (timestamp inferred from updatedAt)."
        : "Partially settled.",
    });
  }
  if (status === "SETTLED") {
    events.push({
      statusCode: "SETTLED",
      at: updatedAt,
      note: updatedAt ? "Settled (timestamp inferred from updatedAt)." : "Settled.",
    });
  }
  if (status === "CANCELLED") {
    events.push({
      statusCode: "CANCELLED",
      at: updatedAt || createdAt,
      note: updatedAt
        ? "Cancelled (timestamp inferred from updatedAt)."
        : "Cancelled.",
    });
  }
  if (status === "REVERSED") {
    events.push({
      statusCode: "REVERSED",
      at: reversedAt || updatedAt,
      note: reversedAt
        ? "Reversal completed."
        : "Reversed (timestamp inferred from updatedAt).",
    });
  }
  return events;
}

function formatReadinessReason(reason) {
  switch (String(reason || "").trim().toUpperCase()) {
    case "ACCOUNT_NOT_FOUND":
      return "Mapped account no longer exists.";
    case "ACCOUNT_INACTIVE":
      return "Mapped account is inactive.";
    case "ACCOUNT_NOT_POSTABLE":
      return "Mapped account is not postable.";
    case "ACCOUNT_SCOPE_NOT_LEGAL_ENTITY":
      return "Mapped account is not in a legal-entity chart.";
    case "ACCOUNT_LEGAL_ENTITY_MISMATCH":
      return "Mapped account belongs to a different legal entity.";
    case "PURPOSES_MUST_MAP_TO_DIFFERENT_ACCOUNTS":
      return "Control and offset must map to different accounts.";
    case "MAPPED_ACCOUNT_ID_INVALID":
      return "Mapped account id is invalid.";
    case "ACCOUNT_TENANT_MISMATCH":
      return "Mapped account belongs to a different tenant.";
    case "ACCOUNT_TYPE_MISMATCH":
      return "Mapped account type does not match this purpose.";
    case "ACCOUNT_NORMAL_SIDE_MISMATCH":
      return "Mapped account normal side does not match this purpose.";
    default:
      return String(reason || "Invalid mapping.");
  }
}

export default function CariDocumentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const { getModuleRow } = useModuleReadiness();
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
  const canReadGlJournals = hasPermission("gl.journal.read");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canReadExceptions = hasPermission("ops.exceptions.read");
  const canReadCariAudit = hasPermission("cari.audit.read");

  const [filters, setFilters, resetFilters] = usePersistedFilters(
    DOCUMENT_FILTERS_STORAGE_SCOPE,
    () => ({ ...DEFAULT_FILTERS })
  );
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterCounterpartyOptions, setFilterCounterpartyOptions] = useState([]);
  const [filterCounterpartyLoading, setFilterCounterpartyLoading] = useState(false);

  const [createForm, setCreateForm] = useState(() => createInitialDraftForm());
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [createPaymentTermTouched, setCreatePaymentTermTouched] = useState(false);
  const [createCurrencyTouched, setCreateCurrencyTouched] = useState(false);
  const [createCounterpartyOptions, setCreateCounterpartyOptions] = useState([]);
  const [createCounterpartyLoading, setCreateCounterpartyLoading] = useState(false);
  const [createCounterpartyLookupQuery, setCreateCounterpartyLookupQuery] = useState("");
  const [createPaymentTermOptions, setCreatePaymentTermOptions] = useState([]);
  const [createPaymentTermsLoading, setCreatePaymentTermsLoading] = useState(false);
  const [createPaymentTermsError, setCreatePaymentTermsError] = useState("");
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

  const [editForm, setEditForm] = useState(() => createInitialDraftForm());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editCounterpartyOptions, setEditCounterpartyOptions] = useState([]);
  const [editCounterpartyLoading, setEditCounterpartyLoading] = useState(false);
  const [editCounterpartyLookupQuery, setEditCounterpartyLookupQuery] = useState("");
  const [editInlineCounterpartySaving, setEditInlineCounterpartySaving] = useState(false);
  const [editInlineCounterpartyError, setEditInlineCounterpartyError] = useState("");
  const [editInlineCounterpartyMessage, setEditInlineCounterpartyMessage] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const [postForm, setPostForm] = useState(() => buildInitialPostForm());
  const [postOffsetAccountOptions, setPostOffsetAccountOptions] = useState([]);
  const [postOffsetAccountsLoading, setPostOffsetAccountsLoading] = useState(false);
  const [postOffsetAccountsError, setPostOffsetAccountsError] = useState("");
  const [postSaving, setPostSaving] = useState(false);
  const [postError, setPostError] = useState("");
  const [postMessage, setPostMessage] = useState("");

  const [reverseForm, setReverseForm] = useState({ reason: "Manual reversal", reversalDate: "" });
  const [reverseSaving, setReverseSaving] = useState(false);
  const [reverseError, setReverseError] = useState("");
  const [reverseMessage, setReverseMessage] = useState("");
  const [reverseResult, setReverseResult] = useState(null);
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
        render: (row) => formatAmount(row?.amountTxn),
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
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
            onClick={() => setSelectedDocumentId(row?.id)}
          >
            View / Actions
          </button>
        ),
      },
    ],
    [setSelectedDocumentId]
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
  const documentListTotalPages = useMemo(() => {
    if (!rows.length) {
      return 1;
    }
    return Math.max(1, Math.ceil(rows.length / documentRowsPerPage));
  }, [documentRowsPerPage, rows.length]);
  const pagedDocumentRows = useMemo(() => {
    const startIndex = Math.max(0, (documentListPage - 1) * documentRowsPerPage);
    return rows.slice(startIndex, startIndex + documentRowsPerPage);
  }, [documentListPage, documentRowsPerPage, rows]);
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

  useWorkingContextDefaults(setFilters, DOCUMENT_FILTER_CONTEXT_MAPPINGS, [
    filters.legalEntityId,
    filters.dateFrom,
    filters.dateTo,
  ]);
  useWorkingContextDefaults(setCreateForm, DOCUMENT_CREATE_CONTEXT_MAPPINGS, [
    createForm.legalEntityId,
    createForm.documentDate,
  ]);

  const selectedRow = useMemo(
    () => rows.find((row) => Number(row?.id || 0) === Number(selectedDocumentId || 0)) || null,
    [rows, selectedDocumentId]
  );
  const selectedSnapshot = selectedDetail || selectedRow;
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
  const canReverseSelected = Boolean(selectedSnapshot && isPosted(selectedSnapshot) && canReverse);
  const canAttachEvidence = Boolean(selectedSnapshot && canUpdate);
  const canWriteInternalComments = Boolean(selectedSnapshot && canUpdate);
  const canWriteOpsStatus = Boolean(selectedSnapshot && canUpdate);
  const selectedDocumentAmountTxn = toPositiveDecimal(
    selectedSnapshot?.amountTxn ?? selectedSnapshot?.amount_txn
  );
  const selectedDocumentAmountBase = toPositiveDecimal(
    selectedSnapshot?.amountBase ?? selectedSnapshot?.amount_base
  );
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
    () => getLifecycleStatusMeta("cariDocument", selectedSnapshot?.status),
    [selectedSnapshot?.status]
  );
  const selectedDocumentLifecycleActions = useMemo(
    () => getLifecycleAllowedActions("cariDocument", selectedSnapshot?.status),
    [selectedSnapshot?.status]
  );
  const selectedDocumentLifecycleTimeline = useMemo(
    () =>
      buildLifecycleTimelineSteps(
        "cariDocument",
        selectedSnapshot?.status,
        buildDocumentLifecycleEvents(selectedSnapshot)
      ),
    [selectedSnapshot]
  );
  const deepLinkedDocumentIdRaw = String(
    searchParams.get("documentId") || searchParams.get("document_id") || ""
  ).trim();
  const deepLinkedDocumentId = toPositiveInt(deepLinkedDocumentIdRaw);
  const filterCounterpartyLookupOptions = useMemo(
    () => (filterCounterpartyOptions || []).map(mapCounterpartyLookupOption).filter((row) => row.value),
    [filterCounterpartyOptions]
  );
  const legalEntityLookupOptions = useMemo(
    () =>
      (workingContextLegalEntities || [])
        .map(mapLegalEntityLookupOption)
        .filter((row) => row.value),
    [workingContextLegalEntities]
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
  const editCounterpartyLookupOptions = useMemo(
    () => (editCounterpartyOptions || []).map(mapCounterpartyLookupOption).filter((row) => row.value),
    [editCounterpartyOptions]
  );
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
      direction: normalizeText(previousForm?.direction) || baseline.direction,
      documentType: normalizeText(previousForm?.documentType) || baseline.documentType,
      documentDate: normalizeText(previousForm?.documentDate) || baseline.documentDate,
      currencyCode: normalizeCurrencyCode(previousForm?.currencyCode) || baseline.currencyCode,
    };
  }

  function resetCreateDraftFormWithSmartDefaults() {
    setCreateForm((previousForm) => buildSmartResetDraftForm(previousForm));
    setCreatePaymentTermTouched(false);
    setCreateCurrencyTouched(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
  }

  function applyCreateDraftFormSnapshot(nextForm) {
    const normalized = buildTemplateSafeDraftForm(nextForm);
    setCreateForm(normalized);
    setCreatePaymentTermTouched(Boolean(normalizeText(normalized.paymentTermId)));
    setCreateCurrencyTouched(Boolean(normalizeCurrencyCode(normalized.currencyCode)));
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
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
    setFilters((previous) => {
      if (normalizeText(previous.legalEntityId) === normalizedLegalEntityId) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: normalizedLegalEntityId,
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
      return {
        ...previous,
        direction: safeDirection,
        counterpartyId: "",
      };
    });
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
  }

  function handleCreateLegalEntityChange(nextValue) {
    const normalizedLegalEntityId = nextValue ? String(nextValue) : "";
    setCreateForm((previous) => {
      if (normalizeText(previous.legalEntityId) === normalizedLegalEntityId) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: normalizedLegalEntityId,
        counterpartyId: "",
        paymentTermId: "",
      };
    });
    setCreatePaymentTermTouched(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setCreatePaymentTermsError("");
  }

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
      setListError("Missing permission: cari.doc.read");
      return;
    }
    setListLoading(true);
    setListError("");
    try {
      const response = await listCariDocuments(buildDocumentListQuery(nextFilters));
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setTotalRows(Number(response?.total || 0));
    } catch (error) {
      setRows([]);
      setTotalRows(0);
      setListError(normalizeApiError(error, "Failed to load documents."));
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
      if (row && isDraft(row)) setEditForm(mapDocumentRowToForm(row));
    } catch (error) {
      setSelectedDetail(null);
      setDetailError(normalizeApiError(error, "Failed to load document detail."));
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
    if (!canRead || !deepLinkedDocumentId) {
      return;
    }
    if (Number(selectedDocumentId || 0) === Number(deepLinkedDocumentId)) {
      return;
    }
    setSelectedDocumentId(deepLinkedDocumentId);
  }, [canRead, deepLinkedDocumentId, selectedDocumentId]);

  useEffect(() => {
    const selectedId = toPositiveInt(selectedDocumentId);
    const currentId = toPositiveInt(
      searchParams.get("documentId") || searchParams.get("document_id")
    );
    if (deepLinkedDocumentId && !selectedId) {
      return;
    }
    if (selectedId === currentId) {
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
    if (!selectedDocumentId) {
      setSelectedDetail(null);
      return;
    }
    loadDocumentDetail(selectedDocumentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocumentId, canRead]);

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
          normalizeApiError(error, "Failed to load payment terms for selected legal entity.")
        );
      } finally {
        if (active) setCreatePaymentTermsLoading(false);
      }
    }

    loadCreatePaymentTerms();
    return () => {
      active = false;
    };
  }, [canReadCards, createForm.legalEntityId]);

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
        setLinkedCashError(normalizeApiError(error, "Failed to load settlement/cash links."));
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
  }, [canReadReports, selectedSnapshot?.counterpartyId, selectedSnapshot?.id, selectedSnapshot?.legalEntityId]);

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
        errors.push(normalizeApiError(error, "Related open items failed to load."));
      }

      if (canReadGlJournals && selectedPostedJournalEntryId) {
        try {
          const journalResponse = await getJournal(selectedPostedJournalEntryId);
          nextJournal = journalResponse?.row || null;
        } catch (error) {
          errors.push(normalizeApiError(error, "Related GL journal failed to load."));
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
          errors.push(normalizeApiError(error, "Related exceptions failed to load."));
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
          errors.push(normalizeApiError(error, "Related audit trail failed to load."));
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
    selectedPostedJournalEntryId,
    selectedSnapshot?.id,
    selectedSnapshot?.legalEntityId,
    selectedSnapshot?.legal_entity_id,
  ]);

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
        const options = (Array.isArray(response?.rows) ? response.rows : [])
          .filter((row) => {
            const isActive = row?.is_active === true || Number(row?.is_active) === 1;
            const allowPosting =
              row?.allow_posting === true || Number(row?.allow_posting) === 1;
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

        setPostOffsetAccountOptions(options);
      } catch (error) {
        if (!active) {
          return;
        }
        setPostOffsetAccountOptions([]);
        setPostOffsetAccountsError(
          normalizeApiError(error, "Failed to load postable account options.")
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
        setOpsStatusError(normalizeApiError(error, "Failed to load ops status note."));
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
  }, [canRead, selectedDocumentNumericId]);

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
    const documentId = selectedDocumentNumericId;
    setInternalCommentsError("");
    setInternalCommentsMessage("");
    setInternalCommentBody("");

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
        setInternalCommentsError(normalizeApiError(error, "Failed to load internal comments."));
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
  }, [canRead, selectedDocumentNumericId]);

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
        setEvidenceError(normalizeApiError(error, "Failed to load evidence attachments."));
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
  }, [canRead, selectedDocumentNumericId]);

  useEffect(() => {
    if (documentListPage <= documentListTotalPages) {
      return;
    }
    setDocumentListPage(documentListTotalPages);
  }, [documentListPage, documentListTotalPages]);

  async function handleSaveOpsStatus(event) {
    event.preventDefault();
    const documentId = selectedDocumentNumericId;
    if (!documentId || !canWriteOpsStatus) {
      setOpsStatusError(
        "Ops status update requires selected document and permission: cari.doc.update."
      );
      return;
    }

    const opsStatus = String(opsStatusForm?.opsStatus || "").trim().toUpperCase();
    const blockedReason = String(opsStatusForm?.blockedReason || "").trim();
    const note = String(opsStatusForm?.note || "").trim();

    if (!["OK", "AT_RISK", "BLOCKED"].includes(opsStatus)) {
      setOpsStatusError("opsStatus must be OK, AT_RISK, or BLOCKED.");
      return;
    }
    if (opsStatus === "BLOCKED" && !blockedReason) {
      setOpsStatusError("blockedReason is required when opsStatus=BLOCKED.");
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
      setOpsStatusMessage("Ops status note updated.");
    } catch (error) {
      setOpsStatusError(normalizeApiError(error, "Failed to update ops status note."));
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
        "Internal comment add requires selected document and permission: cari.doc.update."
      );
      return;
    }

    const body = String(internalCommentBody || "").trim();
    if (!body) {
      setInternalCommentsError("Comment body is required.");
      return;
    }

    setInternalCommentSaving(true);
    setInternalCommentsError("");
    setInternalCommentsMessage("");
    try {
      const response = await createCariDocumentComment(documentId, { body });
      await refreshInternalComments(documentId);
      const commentId = toPositiveInt(response?.row?.id);
      setInternalCommentBody("");
      setInternalCommentsMessage(
        commentId ? `Internal comment added. id=${commentId}` : "Internal comment added."
      );
    } catch (error) {
      setInternalCommentsError(normalizeApiError(error, "Failed to add internal comment."));
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
        "Evidence attach requires selected document and permission: cari.doc.update."
      );
      return;
    }
    if (!evidenceUploadFile) {
      setEvidenceError("Select a file before attaching evidence.");
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
        throw new Error("Evidence create response is missing id.");
      }

      await uploadCariDocumentEvidenceContent(documentId, evidenceId, evidenceUploadFile, {
        contentType: evidenceUploadFile.type || "application/octet-stream",
      });

      await refreshEvidenceRows(documentId);
      setEvidenceMessage(`Evidence attached. id=${evidenceId}`);
      setEvidenceNote("");
      setEvidenceUploadFile(null);
      setEvidenceUploadInputKey((prev) => prev + 1);
    } catch (error) {
      setEvidenceError(normalizeApiError(error, "Failed to attach evidence."));
    } finally {
      setEvidenceUploading(false);
    }
  }

  async function handleDownloadEvidence(row) {
    const documentId = selectedDocumentNumericId;
    const evidenceId = toPositiveInt(row?.id);
    if (!documentId || !evidenceId) {
      setEvidenceError("Evidence id is invalid.");
      return;
    }

    setEvidenceDownloadingId(evidenceId);
    setEvidenceError("");
    try {
      const response = await downloadCariDocumentEvidence(documentId, evidenceId);
      const blob = response?.blob;
      if (!(blob instanceof Blob)) {
        throw new Error("Evidence download payload is invalid.");
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
      setEvidenceError(normalizeApiError(error, "Failed to download evidence."));
    } finally {
      setEvidenceDownloadingId(null);
    }
  }

  async function handleDeleteEvidence(evidenceIdRaw) {
    const documentId = selectedDocumentNumericId;
    const evidenceId = toPositiveInt(evidenceIdRaw);
    if (!documentId || !evidenceId || !canAttachEvidence) {
      setEvidenceError(
        "Evidence delete requires selected document, valid evidence id, and cari.doc.update permission."
      );
      return;
    }

    setEvidenceDeletingId(evidenceId);
    setEvidenceError("");
    setEvidenceMessage("");
    try {
      await deleteCariDocumentEvidence(documentId, evidenceId);
      await refreshEvidenceRows(documentId);
      setEvidenceMessage(`Evidence deleted. id=${evidenceId}`);
    } catch (error) {
      setEvidenceError(normalizeApiError(error, "Failed to delete evidence."));
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
      setCreateInlineCounterpartyError("Missing permission: cari.card.upsert");
      return;
    }
    if (!legalEntityId) {
      setCreateInlineCounterpartyError("Select legalEntityId before creating a counterparty.");
      return;
    }
    if (!name) {
      setCreateInlineCounterpartyError("Type a counterparty name in lookup before creating.");
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
        throw new Error("Counterparty create response is missing row.id.");
      }
      setCreateCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
      setCreateForm((prev) => ({ ...prev, counterpartyId: String(counterpartyId) }));
      setCreateCounterpartyLookupQuery("");
      setCreateInlineCounterpartyMessage(
        `Counterparty created and selected. counterpartyId=${counterpartyId}`
      );
    } catch (error) {
      setCreateInlineCounterpartyError(
        normalizeApiError(error, "Failed to create counterparty from lookup.")
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
      setEditInlineCounterpartyError("Missing permission: cari.card.upsert");
      return;
    }
    if (!legalEntityId) {
      setEditInlineCounterpartyError("Select legalEntityId before creating a counterparty.");
      return;
    }
    if (!name) {
      setEditInlineCounterpartyError("Type a counterparty name in lookup before creating.");
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
        throw new Error("Counterparty create response is missing row.id.");
      }
      setEditCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
      setEditForm((prev) => ({ ...prev, counterpartyId: String(counterpartyId) }));
      setEditCounterpartyLookupQuery("");
      setEditInlineCounterpartyMessage(
        `Counterparty created and selected. counterpartyId=${counterpartyId}`
      );
    } catch (error) {
      setEditInlineCounterpartyError(
        normalizeApiError(error, "Failed to create counterparty from lookup.")
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
    try {
      const { errors } = validateDocumentMutationForm(createForm);
      if (errors.length > 0) {
        setCreateError(errors.join(" "));
        return;
      }
      const payload = buildDocumentMutationPayload(createForm);
      const response = await createCariDocument(payload);
      setCreateMessage(`Draft document created. id=${response?.row?.id || "-"}`);
      resetCreateDraftFormWithSmartDefaults();
      await loadDocuments(filters);
      if (response?.row?.id) setSelectedDocumentId(response.row.id);
    } catch (error) {
      setCreateError(normalizeApiError(error, "Failed to create draft document."));
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleUpdateDraft(event) {
    event.preventDefault();
    if (!selectedDocumentId || !canEditOrCancelSelected) {
      setEditError("Only DRAFT documents can be edited with cari.doc.update permission.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    setEditMessage("");
    try {
      const { errors } = validateDocumentMutationForm(editForm);
      if (errors.length > 0) {
        setEditError(errors.join(" "));
        return;
      }
      const payload = buildDocumentMutationPayload(editForm);
      if (!payload.rowVersion) {
        payload.rowVersion = Number(selectedDetail?.rowVersion || 0) || undefined;
      }
      const response = await updateCariDocument(selectedDocumentId, payload);
      setEditMessage("Draft document updated.");
      setSelectedDetail(response?.row || null);
      await loadDocuments(filters);
    } catch (error) {
      setEditError(normalizeApiError(error, "Failed to update draft document."));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCancelDraft() {
    if (!selectedDocumentId || !canEditOrCancelSelected) {
      setCancelError("Only DRAFT documents can be cancelled with cari.doc.update permission.");
      return;
    }
    setCancelSaving(true);
    setCancelError("");
    try {
      const response = await cancelCariDocument(selectedDocumentId);
      setSelectedDetail(response?.row || null);
      await loadDocuments(filters);
    } catch (error) {
      setCancelError(normalizeApiError(error, "Failed to cancel draft document."));
    } finally {
      setCancelSaving(false);
    }
  }

  async function handlePostDraft() {
    if (cariPostingNotReady) {
      setPostError(
        "Setup incomplete for selected legal entity. Configure CARI purpose mappings in GL Setup first."
      );
      return;
    }
    if (!selectedDocumentId || !canPostSelected) {
      setPostError("Only DRAFT documents can be posted with cari.doc.post permission.");
      return;
    }
    if (postForm.useFxOverride && !canFxOverride) {
      setPostError("FX override requires permission: cari.fx.override. Disable override or request access.");
      return;
    }
    if (postForm.useFxOverride && !String(postForm.fxOverrideReason || "").trim()) {
      setPostError("fxOverrideReason is required when useFxOverride=true.");
      return;
    }

    const payload = {
      useFxOverride: Boolean(postForm.useFxOverride),
      fxOverrideReason: postForm.useFxOverride
        ? String(postForm.fxOverrideReason || "").trim()
        : null,
      offsetAccountId: toPositiveInt(postForm.offsetAccountId) || null,
    };

    if (postForm.usePostingLines) {
      if (!selectedDocumentAmountTxn || !selectedDocumentAmountBase) {
        setPostError(
          "Selected draft amountTxn/amountBase is invalid. Re-open the draft and try again."
        );
        return;
      }
      const sourceLines = Array.isArray(postForm.postingLines)
        ? postForm.postingLines
        : [];
      if (sourceLines.length === 0) {
        setPostError("Add at least one posting line.");
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
            `Line ${index + 1}: amountTxn and amountBase must be greater than 0.`
          );
          return;
        }

        const lineOffsetAccountRaw = normalizeText(line.offsetAccountId);
        const lineOffsetAccountId = lineOffsetAccountRaw
          ? toPositiveInt(lineOffsetAccountRaw)
          : null;
        if (lineOffsetAccountRaw && !lineOffsetAccountId) {
          setPostError(`Line ${index + 1}: offset account is invalid.`);
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
          `Line totals must match draft totals. Draft txn/base: ${selectedDocumentAmountTxn} / ${selectedDocumentAmountBase}. Entered txn/base: ${totalTxn} / ${totalBase}.`
        );
        return;
      }

      payload.postingLines = postingLines;
    }

    setPostSaving(true);
    setPostError("");
    setPostMessage("");
    try {
      const response = await postCariDocument(selectedDocumentId, payload);
      setPostMessage(`Draft posted. postedJournalEntryId=${response?.row?.postedJournalEntryId || response?.journal?.journalEntryId || "-"}`);
      setSelectedDetail(response?.row || null);
      await loadDocuments(filters);
      await loadDocumentDetail(selectedDocumentId);
    } catch (error) {
      setPostError(normalizeApiError(error, "Failed to post draft document."));
    } finally {
      setPostSaving(false);
    }
  }

  async function handleReversePosted() {
    if (!selectedDocumentId || !canReverseSelected) {
      setReverseError("Only POSTED documents can be reversed with cari.doc.reverse permission.");
      return;
    }
    setReverseSaving(true);
    setReverseError("");
    setReverseMessage("");
    try {
      const response = await reverseCariDocument(selectedDocumentId, {
        reason: String(reverseForm.reason || "").trim() || "Manual reversal",
        reversalDate: String(reverseForm.reversalDate || "").trim() || undefined,
      });
      setReverseResult({
        reversalDocumentId: response?.row?.id || null,
        reversalDocumentNo: response?.row?.documentNo || null,
        reversalJournalEntryId: response?.journal?.reversalJournalEntryId || null,
      });
      setReverseMessage(`Reverse completed. reversalDocumentId=${response?.row?.id || "-"}`);
      await loadDocuments(filters);
      await loadDocumentDetail(selectedDocumentId);
    } catch (error) {
      setReverseError(normalizeApiError(error, "Failed to reverse posted document."));
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
      setListError("CSV export is only available in browser sessions.");
    }
  }

  function handleCloneSelectedDocumentToCreateForm() {
    if (!selectedSnapshot) {
      setDraftTemplatesError("Select a document first to clone into draft form.");
      return;
    }
    const nextForm = buildCloneDraftFormFromRow(selectedSnapshot, createForm);
    applyCreateDraftFormSnapshot(nextForm);
    setDraftTemplatesError("");
    setDraftTemplatesMessage(
      `Draft form cloned from document id=${selectedSnapshot?.id || "-"}`
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
      setDraftTemplatesError(normalizeApiError(error, "Failed to load draft templates."));
    } finally {
      setDraftTemplatesLoading(false);
    }
  }

  function applyDocumentDraftTemplate(templateRow, options = {}) {
    const targetTemplate = templateRow && typeof templateRow === "object" ? templateRow : null;
    if (!targetTemplate) {
      setDraftTemplatesError("Draft template not found.");
      return;
    }
    const resolved = resolveDocumentDraftTemplateState(targetTemplate);
    applyCreateDraftFormSnapshot(resolved.draftForm);
    setCreateRecurringRule(resolved.recurringRule);
    setSelectedDraftTemplateId(String(targetTemplate.id));
    if (!options.silent) {
      setDraftTemplatesError("");
      setDraftTemplatesMessage(
        `Draft template applied: ${targetTemplate.name || targetTemplate.id}`
      );
    }
  }

  async function handleCreateDocumentDraftTemplate() {
    const rawName = window.prompt("Recurring template name", "");
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
      setDraftTemplatesMessage(`Recurring template created: ${name}`);
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(error, "Failed to create recurring draft template.")
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }

  async function handleUpdateDocumentDraftTemplate() {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError("Select a recurring template to update.");
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
        `Recurring template updated: ${
          selectedDraftTemplate?.name || templateId
        }`
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(error, "Failed to update recurring draft template.")
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }

  async function handleSetDefaultDocumentDraftTemplate() {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError("Select a recurring template to set as default.");
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      await updateMeSavedView(templateId, { isDefault: true });
      await loadDocumentDraftTemplates({ preferredId: templateId });
      setDraftTemplatesMessage("Recurring template set as default.");
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(error, "Failed to set recurring draft template as default.")
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }

  async function handleDeleteDocumentDraftTemplate() {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError("Select a recurring template to delete.");
      return;
    }
    const confirmed = window.confirm(
      `Delete recurring template "${selectedDraftTemplate?.name || templateId}"?`
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
      setDraftTemplatesMessage("Recurring template deleted.");
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(error, "Failed to delete recurring draft template.")
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
      setSavedViewsError(normalizeApiError(error, "Failed to load saved views."));
    } finally {
      setSavedViewsLoading(false);
    }
  }

  function applyDocumentSavedView(savedView, options = {}) {
    const targetView = savedView && typeof savedView === "object" ? savedView : null;
    if (!targetView) {
      setSavedViewsError("Saved view not found.");
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
      setSavedViewsMessage(`Saved view applied: ${targetView.name || targetView.id}`);
      setSavedViewsError("");
    }
  }

  async function handleCreateDocumentSavedView() {
    const rawName = window.prompt("Saved view name", "");
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
      setSavedViewsMessage(`Saved view created: ${name}`);
    } catch (error) {
      setSavedViewsError(normalizeApiError(error, "Failed to create saved view."));
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleUpdateDocumentSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError("Select a saved view to update.");
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
        `Saved view updated: ${selectedSavedView?.name || savedViewId}`
      );
    } catch (error) {
      setSavedViewsError(normalizeApiError(error, "Failed to update saved view."));
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleSetDefaultDocumentSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError("Select a saved view to set as default.");
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await updateMeSavedView(savedViewId, { isDefault: true });
      await loadDocumentSavedViews({ preferredId: savedViewId });
      setSavedViewsMessage(
        `Saved view marked as default: ${
          selectedSavedView?.name || savedViewId
        }`
      );
    } catch (error) {
      setSavedViewsError(normalizeApiError(error, "Failed to set default saved view."));
    } finally {
      setSavedViewsSaving(false);
    }
  }

  async function handleDeleteDocumentSavedView() {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError("Select a saved view to delete.");
      return;
    }
    const confirmed = window.confirm(
      `Delete saved view "${selectedSavedView?.name || savedViewId}"?`
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
      setSavedViewsMessage("Saved view deleted.");
    } catch (error) {
      setSavedViewsError(normalizeApiError(error, "Failed to delete saved view."));
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

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Cari Documents</h1>
        {listError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{listError}</div> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              Legal Entity
              <Combobox
                className="mt-1"
                value={filters.legalEntityId}
                options={filterLegalEntityLookupOptions}
                loading={filterLegalEntityLookupLoading}
                placeholder={
                  filterLegalEntityLookupOptions.length > 0
                    ? "Search legal entity code/name"
                    : "No legal entities available"
                }
                noOptionsText="No legal entities found."
                onChange={(nextValue) => handleFilterLegalEntityChange(nextValue)}
              />
            </label>
            {workingContextError ? (
              <p className="mt-1 text-[11px] normal-case text-amber-700">
                {workingContextError}
              </p>
            ) : null}
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Direction<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.direction} onChange={(event) => handleFilterDirectionChange(event.target.value)}><option value="">ALL</option>{DOCUMENT_DIRECTIONS.map((direction) => <option key={`filter-direction-${direction}`} value={direction}>{direction}</option>)}</select></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Counterparty ID<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.counterpartyId} onChange={(event) => setFilters((prev) => ({ ...prev, counterpartyId: event.target.value }))} /></label>
          {canReadCards ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Counterparty Lookup
              <Combobox
                className="mt-1"
                value={filters.counterpartyId}
                options={filterCounterpartyLookupOptions}
                loading={filterCounterpartyLoading}
                disabled={!toPositiveInt(filters.legalEntityId)}
                placeholder={toPositiveInt(filters.legalEntityId) ? "Type code/name" : "Select legal entity first"}
                noOptionsText={toPositiveInt(filters.legalEntityId) ? "No counterparties found." : "Set legalEntityId to load counterparties."}
                onChange={(nextValue) =>
                  setFilters((prev) => ({
                    ...prev,
                    counterpartyId: nextValue ? String(nextValue) : "",
                  }))
                }
              />
            </label>
          ) : null}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Document Type<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.documentType} onChange={(event) => setFilters((prev) => ({ ...prev, documentType: event.target.value }))}><option value="">ALL</option>{DOCUMENT_TYPES.map((documentType) => <option key={`filter-document-type-${documentType}`} value={documentType}>{documentType}</option>)}</select></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Status<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}><option value="">ALL</option>{DOCUMENT_STATUSES.map((status) => <option key={`filter-status-${status}`} value={status}>{status}</option>)}</select></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Date From<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} /></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Date To<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} /></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Search<input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} placeholder="documentNo / counterparty snapshot" /></label>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => loadDocuments(filters)} disabled={listLoading}>{listLoading ? "Loading..." : "Refresh List"}</button>
          <button type="button" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700" onClick={resetFilters} disabled={listLoading}>Reset Filters</button>
          <button
            type="button"
            className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 disabled:opacity-60"
            onClick={handleExportDocumentListCsv}
            disabled={listLoading || rows.length === 0}
          >
            Export CSV
          </button>
        </div>
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Saved Views (server-side)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={selectedSavedViewId}
              onChange={(event) => setSelectedSavedViewId(event.target.value)}
              disabled={savedViewsLoading || savedViewsSaving || savedViews.length === 0}
            >
              <option value="">Select saved view</option>
              {savedViews.map((row) => (
                <option key={`document-saved-view-${row.id}`} value={row.id}>
                  {row.name}
                  {row.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => applyDocumentSavedView(selectedSavedView)}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              Apply
            </button>
            <button
              type="button"
              className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
              onClick={handleCreateDocumentSavedView}
              disabled={savedViewsSaving}
            >
              Save Current
            </button>
            <button
              type="button"
              className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
              onClick={handleUpdateDocumentSavedView}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              Update Selected
            </button>
            <button
              type="button"
              className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
              onClick={handleSetDefaultDocumentSavedView}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              Set Default
            </button>
            <button
              type="button"
              className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
              onClick={handleDeleteDocumentSavedView}
              disabled={!selectedSavedView || savedViewsSaving}
            >
              Delete
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => loadDocumentSavedViews({ preferredId: selectedSavedViewId })}
              disabled={savedViewsLoading || savedViewsSaving}
            >
              {savedViewsLoading ? "Loading..." : "Refresh Saved Views"}
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
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Create Draft Document</h2>
          {createError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{createError}</div> : null}
          {createMessage ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{createMessage}</div> : null}
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Clone + Recurring Templates
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={handleCloneSelectedDocumentToCreateForm}
                disabled={!selectedSnapshot || createSaving}
              >
                Clone Selected Document
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
                <option value="">Select recurring template</option>
                {draftTemplates.map((row) => (
                  <option key={`document-draft-template-${row.id}`} value={row.id}>
                    {row.name}
                    {row.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() => applyDocumentDraftTemplate(selectedDraftTemplate)}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                Apply Template
              </button>
              <button
                type="button"
                className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                onClick={handleCreateDocumentDraftTemplate}
                disabled={draftTemplatesSaving || createSaving}
              >
                Save Current Template
              </button>
              <button
                type="button"
                className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
                onClick={handleUpdateDocumentDraftTemplate}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                Update Template
              </button>
              <button
                type="button"
                className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                onClick={handleSetDefaultDocumentDraftTemplate}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                Set Default
              </button>
              <button
                type="button"
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                onClick={handleDeleteDocumentDraftTemplate}
                disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
              >
                Delete
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                onClick={() =>
                  loadDocumentDraftTemplates({ preferredId: selectedDraftTemplateId })
                }
                disabled={draftTemplatesLoading || draftTemplatesSaving || createSaving}
              >
                {draftTemplatesLoading ? "Loading..." : "Refresh Templates"}
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Recurring Cadence
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
                Repeat Every
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
                Anchor Day (optional)
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
                Legal Entity
                <Combobox
                  className="mt-1"
                  value={createForm.legalEntityId}
                  options={createLegalEntityLookupOptions}
                  loading={createLegalEntityLookupLoading}
                  disabled={createSaving || createLegalEntityLookupOptions.length === 0}
                  placeholder={
                    createLegalEntityLookupOptions.length > 0
                      ? "Search legal entity code/name"
                      : "No legal entities available"
                  }
                  noOptionsText="No legal entities found."
                  onChange={(nextValue) => handleCreateLegalEntityChange(nextValue)}
                />
              </label>
              {workingContextError ? (
                <p className="mt-1 text-[11px] normal-case text-amber-700">
                  {workingContextError}
                </p>
              ) : null}
            </div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Direction<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.direction} onChange={(event) => handleCreateDirectionChange(event.target.value)} required>{DOCUMENT_DIRECTIONS.map((direction) => <option key={`create-direction-${direction}`} value={direction}>{direction}</option>)}</select></label>
            {canReadCards ? (
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  Counterparty
                  <Combobox
                    className="mt-1"
                    value={createForm.counterpartyId}
                    options={createCounterpartyLookupOptions}
                    loading={createCounterpartyLoading}
                    disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                    placeholder={
                      toPositiveInt(createForm.legalEntityId)
                        ? "Search counterparty code/name"
                        : "Select legal entity first"
                    }
                    noOptionsText={
                      toPositiveInt(createForm.legalEntityId)
                        ? "No counterparties found."
                        : "Select legal entity first."
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
                      setCreateForm((prev) => ({
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
                    onClick={handleInlineCreateCounterpartyForCreateForm}
                    disabled={!canInlineCreateCounterpartyInCreateForm || createInlineCounterpartySaving || createSaving}
                  >
                    {createInlineCounterpartySaving
                      ? "Creating counterparty..."
                      : `Create "${createInlineCounterpartyName || "new counterparty"}"`}
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
                Counterparty ID
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
                  Payment Term (optional)
                  <Combobox
                    className="mt-1"
                    value={createForm.paymentTermId}
                    options={createPaymentTermLookupOptions}
                    loading={createPaymentTermsLoading}
                    disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                    placeholder={
                      toPositiveInt(createForm.legalEntityId)
                        ? "Search payment term code/name"
                        : "Select legal entity first"
                    }
                    noOptionsText={
                      toPositiveInt(createForm.legalEntityId)
                        ? "No payment terms found."
                        : "Select legal entity first."
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
                Payment Term ID (optional)
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
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Document Type<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.documentType} onChange={(event) => setCreateForm((prev) => ({ ...prev, documentType: event.target.value }))} required>{DOCUMENT_TYPES.map((documentType) => <option key={`create-document-type-${documentType}`} value={documentType}>{documentType}</option>)}</select></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Document Date<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.documentDate} onChange={(event) => setCreateForm((prev) => ({ ...prev, documentDate: event.target.value }))} required /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Due Date {requiresDueDate(createForm.documentType) ? "(required for this type)" : "(optional)"}<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.dueDate} onChange={(event) => setCreateForm((prev) => ({ ...prev, dueDate: event.target.value }))} required={requiresDueDate(createForm.documentType)} /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Invoice Amount (Invoice Currency)<input type="number" min="0.000001" step="0.000001" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.amountTxn} onChange={(event) => setCreateForm((prev) => ({ ...prev, amountTxn: event.target.value }))} required /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Invoice Currency<input type="text" maxLength={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase" value={createForm.currencyCode} onChange={(event) => {
              setCreateCurrencyTouched(true);
              setCreateForm((prev) => ({ ...prev, currencyCode: event.target.value }));
            }} required /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Base Amount (Legal Entity Currency)<input type="number" min="0.000001" step="0.000001" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.amountBase} onChange={(event) => setCreateForm((prev) => ({ ...prev, amountBase: event.target.value }))} required /></label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">FX Rate (optional)<input type="number" min="0.0000000001" step="0.0000000001" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={createForm.fxRate} onChange={(event) => setCreateForm((prev) => ({ ...prev, fxRate: event.target.value }))} /></label>
            <div className="md:col-span-4 flex gap-2">
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" disabled={createSaving}>{createSaving ? "Creating..." : "Create Draft Document"}</button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                onClick={resetCreateDraftFormWithSmartDefaults}
                disabled={createSaving}
              >
                Reset Draft Form
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Document List</h2>
        <p className="mt-1 text-sm text-slate-600">
          Total rows: {totalRows} | Showing {pagedDocumentRows.length} of {rows.length} on page{" "}
          {documentListPage}/{documentListTotalPages}
        </p>
        <TablePreferencesPanel
          className="mt-3"
          title="Document table preferences"
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
                    Number(row.id) === Number(selectedDocumentId) ? "bg-cyan-50" : "bg-white"
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
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={documentVisibleColumnCount}>
                    {listLoading ? "Loading documents..." : "No documents found for current filters."}
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
            Previous
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
            Next
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Detail + Actions</h2>
        {detailError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detailError}</div> : null}
        {selectedSnapshot ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Document Detail</h3>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="font-semibold text-slate-600">documentNo</dt><dd>{selectedSnapshot.documentNo || "-"}</dd>
                <dt className="font-semibold text-slate-600">status</dt><dd>{selectedSnapshot.status || "-"}</dd>
                <dt className="font-semibold text-slate-600">postedJournalEntryId</dt><dd>{selectedSnapshot.postedJournalEntryId || "-"}</dd>
                <dt className="font-semibold text-slate-600">reversalOfDocumentId</dt><dd>{selectedSnapshot.reversalOfDocumentId || "-"}</dd>
                <dt className="font-semibold text-slate-600">counterpartyCodeSnapshot</dt><dd>{selectedSnapshot.counterpartyCodeSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">counterpartyNameSnapshot</dt><dd>{selectedSnapshot.counterpartyNameSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">dueDateSnapshot</dt><dd>{selectedSnapshot.dueDateSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">currencyCodeSnapshot</dt><dd>{selectedSnapshot.currencyCodeSnapshot || "-"}</dd>
                <dt className="font-semibold text-slate-600">fxRateSnapshot</dt><dd>{selectedSnapshot.fxRateSnapshot || "-"}</dd>
              </dl>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Lifecycle Snapshot</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {selectedDocumentLifecycleMeta?.label || selectedSnapshot.status || "-"}
                </p>
                {selectedDocumentLifecycleMeta?.description ? (
                  <p className="mt-1 text-xs text-slate-600">{selectedDocumentLifecycleMeta.description}</p>
                ) : null}
                {selectedDocumentLifecycleActions.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Next allowed transitions:{" "}
                    {selectedDocumentLifecycleActions.map((row) => row.label).join(", ")}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    No further lifecycle transitions are defined from this status.
                  </p>
                )}
              </div>
              {reverseResult ? <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Reverse linkage: `response.row.id`={reverseResult.reversalDocumentId || "-"}, `response.row.documentNo`={reverseResult.reversalDocumentNo || "-"}, `response.journal.reversalJournalEntryId`={reverseResult.reversalJournalEntryId || "-"}</div> : null}
              {canReadReports ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p className="font-semibold text-slate-800">Linked settlements / cash transactions</p>
                  {linkedCashError ? <p className="mt-1 text-rose-700">{linkedCashError}</p> : null}
                  {linkedCashLoading ? <p className="mt-1 text-slate-600">Loading linkage...</p> : null}
                  {!linkedCashLoading && linkedCashRows.length === 0 ? (
                    <p className="mt-1 text-slate-600">No linked settlements found for this document as of today.</p>
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
                <p className="font-semibold text-slate-800">Related Panel (GL / Open Items / Exceptions / Audit)</p>
                {relatedLoading ? (
                  <p className="mt-1 text-slate-600">Loading related records...</p>
                ) : null}
                {relatedError ? <p className="mt-1 text-rose-700">{relatedError}</p> : null}

                <div className="mt-2 space-y-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-700">GL journal</p>
                    {!canReadGlJournals ? (
                      <p className="mt-1 text-slate-500">Missing permission: gl.journal.read</p>
                    ) : !selectedPostedJournalEntryId ? (
                      <p className="mt-1 text-slate-600">No posted journal linked yet.</p>
                    ) : !relatedJournal ? (
                      <p className="mt-1 text-slate-600">
                        Linked journal id: {selectedPostedJournalEntryId}
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
                          Open in Journal Workbench
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
                    <p className="font-semibold text-slate-700">Open items</p>
                    {relatedOpenItems.length === 0 ? (
                      <p className="mt-1 text-slate-600">No open items found for this document.</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {relatedOpenItems.map((row) => (
                          <li
                            key={`related-open-item-${row.id}`}
                            className="rounded border border-slate-200 bg-white px-2 py-1"
                          >
                            itemNo={row.itemNo || "-"} | status={row.status || "-"} | residual=
                            {formatAmount(row.residualAmountTxn)} {row.currencyCode || ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">Ops status note / blocked reason</p>
                    {opsStatusError ? (
                      <p className="mt-1 text-rose-700">{opsStatusError}</p>
                    ) : null}
                    {opsStatusMessage ? (
                      <p className="mt-1 text-emerald-700">{opsStatusMessage}</p>
                    ) : null}
                    {opsStatusLoading ? (
                      <p className="mt-1 text-slate-600">Loading ops status...</p>
                    ) : null}
                    {!opsStatusLoading ? (
                      <p className="mt-1 text-slate-600">
                        Current: {opsStatusRow?.opsStatus || "OK"}{" "}
                        {opsStatusRow?.updatedAt ? `(updated ${formatDateTime(opsStatusRow.updatedAt)})` : ""}
                      </p>
                    ) : null}

                    {canWriteOpsStatus ? (
                      <form
                        onSubmit={handleSaveOpsStatus}
                        className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2"
                      >
                        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Ops Status
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
                          placeholder="Blocked reason (required when status=BLOCKED)"
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
                          placeholder="Ops note (optional)"
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
                          {opsStatusSaving ? "Saving..." : "Save Ops Status"}
                        </button>
                      </form>
                    ) : (
                      <p className="mt-1 text-slate-500">Missing permission: cari.doc.update</p>
                    )}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">Internal comments</p>
                    {internalCommentsError ? (
                      <p className="mt-1 text-rose-700">{internalCommentsError}</p>
                    ) : null}
                    {internalCommentsMessage ? (
                      <p className="mt-1 text-emerald-700">{internalCommentsMessage}</p>
                    ) : null}
                    {internalCommentsLoading ? (
                      <p className="mt-1 text-slate-600">Loading comments...</p>
                    ) : null}

                    {canWriteInternalComments ? (
                      <form
                        onSubmit={handleCreateInternalComment}
                        className="mt-2 space-y-2 rounded border border-slate-200 bg-white p-2"
                      >
                        <textarea
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder="Add internal comment... Use @email to mention."
                          rows={3}
                          value={internalCommentBody}
                          onChange={(event) => {
                            setInternalCommentsError("");
                            setInternalCommentsMessage("");
                            setInternalCommentBody(event.target.value);
                          }}
                          disabled={internalCommentSaving}
                        />
                        <button
                          type="submit"
                          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                          disabled={!String(internalCommentBody || "").trim() || internalCommentSaving}
                        >
                          {internalCommentSaving ? "Adding..." : "Add Comment"}
                        </button>
                        <p className="text-[11px] text-slate-500">
                          Mention teammates with <span className="font-mono">@email</span> to
                          send in-app notifications.
                        </p>
                      </form>
                    ) : (
                      <p className="mt-1 text-slate-500">Missing permission: cari.doc.update</p>
                    )}

                    {!internalCommentsLoading && internalCommentRows.length === 0 ? (
                      <p className="mt-1 text-slate-600">No internal comments yet.</p>
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
                    <p className="font-semibold text-slate-700">Evidence attachments</p>
                    {evidenceError ? (
                      <p className="mt-1 text-rose-700">{evidenceError}</p>
                    ) : null}
                    {evidenceMessage ? (
                      <p className="mt-1 text-emerald-700">{evidenceMessage}</p>
                    ) : null}
                    {evidenceLoading ? (
                      <p className="mt-1 text-slate-600">Loading evidence...</p>
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
                          placeholder="Optional note"
                          value={evidenceNote}
                          onChange={(event) => setEvidenceNote(event.target.value)}
                          disabled={evidenceUploading}
                        />
                        <button
                          type="submit"
                          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                          disabled={!evidenceUploadFile || evidenceUploading}
                        >
                          {evidenceUploading ? "Uploading..." : "Attach Evidence"}
                        </button>
                      </form>
                    ) : (
                      <p className="mt-1 text-slate-500">Missing permission: cari.doc.update</p>
                    )}

                    {!evidenceLoading && evidenceRows.length === 0 ? (
                      <p className="mt-1 text-slate-600">No evidence attached to this document.</p>
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
                                  {isDownloading ? "Downloading..." : "Download"}
                                </button>
                                {canAttachEvidence ? (
                                  <button
                                    type="button"
                                    className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                                    onClick={() => handleDeleteEvidence(rowId)}
                                    disabled={!rowId || Boolean(isDeleting)}
                                  >
                                    {isDeleting ? "Deleting..." : "Delete"}
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
                    <p className="font-semibold text-slate-700">Exceptions</p>
                    {!canReadExceptions ? (
                      <p className="mt-1 text-slate-500">Missing permission: ops.exceptions.read</p>
                    ) : relatedExceptions.length === 0 ? (
                      <p className="mt-1 text-slate-600">No related exceptions for this source id.</p>
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
                              Open Exception
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="font-semibold text-slate-700">Audit trail</p>
                    {!canReadCariAudit ? (
                      <p className="mt-1 text-slate-500">Missing permission: cari.audit.read</p>
                    ) : relatedAuditRows.length === 0 ? (
                      <p className="mt-1 text-slate-600">No audit records found for this document.</p>
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
                title="Document Lifecycle Timeline"
                steps={selectedDocumentLifecycleTimeline}
                emptyText="No lifecycle history available for this document yet."
              />
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Draft Actions</h3>
                {editError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{editError}</div> : null}
                {editMessage ? <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{editMessage}</div> : null}
                <form className="mt-3 grid gap-2 md:grid-cols-2" onSubmit={handleUpdateDraft}>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Legal Entity ID<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.legalEntityId} onChange={(event) => setEditForm((prev) => ({ ...prev, legalEntityId: event.target.value }))} disabled={!canEditOrCancelSelected || editSaving} /></label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Counterparty ID<input type="number" min="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.counterpartyId} onChange={(event) => setEditForm((prev) => ({ ...prev, counterpartyId: event.target.value }))} disabled={!canEditOrCancelSelected || editSaving} /></label>
                  {canReadCards ? (
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        Counterparty Lookup
                        <Combobox
                          className="mt-1"
                          value={editForm.counterpartyId}
                          options={editCounterpartyLookupOptions}
                          loading={editCounterpartyLoading}
                          disabled={!canEditOrCancelSelected || !toPositiveInt(editForm.legalEntityId) || editSaving}
                          placeholder={toPositiveInt(editForm.legalEntityId) ? "Type code/name" : "Select legal entity first"}
                          noOptionsText={toPositiveInt(editForm.legalEntityId) ? "No counterparties found." : "Set legalEntityId to load counterparties."}
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
                            ? "Creating counterparty..."
                            : `Create "${editInlineCounterpartyName || "new counterparty"}"`}
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
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Document Type<select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.documentType} onChange={(event) => setEditForm((prev) => ({ ...prev, documentType: event.target.value }))} disabled={!canEditOrCancelSelected || editSaving}>{DOCUMENT_TYPES.map((documentType) => <option key={`edit-document-type-${documentType}`} value={documentType}>{documentType}</option>)}</select></label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Due Date<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={editForm.dueDate} onChange={(event) => setEditForm((prev) => ({ ...prev, dueDate: event.target.value }))} disabled={!canEditOrCancelSelected || editSaving} required={requiresDueDate(editForm.documentType)} /></label>
                  <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!canEditOrCancelSelected || editSaving}>{editSaving ? "Saving..." : "Update Draft Document"}</button>
                  <button type="button" className="rounded-md border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" onClick={handleCancelDraft} disabled={!canEditOrCancelSelected || cancelSaving}>{cancelSaving ? "Cancelling..." : "Cancel Draft"}</button>
                </form>
                {cancelError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{cancelError}</div> : null}
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Post / Reverse</h3>
                {cariPostingNotReady ? (
                  <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p className="font-semibold">Setup incomplete (CARI posting)</p>
                    <p className="mt-1">
                      Posting is disabled for legalEntityId={selectedDocumentLegalEntityId}.
                    </p>
                    {Array.isArray(selectedCariPostingReadiness?.missingPurposeCodes) &&
                    selectedCariPostingReadiness.missingPurposeCodes.length > 0 ? (
                      <p className="mt-1">
                        Missing purpose codes:{" "}
                        {selectedCariPostingReadiness.missingPurposeCodes.join(", ")}
                      </p>
                    ) : null}
                    {Array.isArray(selectedCariPostingReadiness?.invalidMappings) &&
                    selectedCariPostingReadiness.invalidMappings.length > 0 ? (
                      <ul className="mt-2 list-disc pl-5">
                        {selectedCariPostingReadiness.invalidMappings.map((row, index) => (
                          <li key={`cari-readiness-invalid-${index}`}>
                            {String(row?.purposeCode || "-")}:{" "}
                            {formatReadinessReason(row?.reason)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        to="/app/ayarlar/hesap-plani-ayarlari#manual-purpose-mappings"
                        className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
                      >
                        Fix manually
                      </Link>
                      <Link
                        to="/app/ayarlar/hesap-plani-ayarlari#template-wizard"
                        className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
                      >
                        Use template
                      </Link>
                    </div>
                  </div>
                ) : null}
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Default Offset Account (Optional)
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
                    <option value="">Use default CARI purpose mapping</option>
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
                  Show all account types
                </label>
                <p className="mt-1 text-xs text-slate-600">
                  Applied when a posting line does not choose its own offset account.
                </p>
                {selectedOffsetAccountType && !postForm.showAllOffsetAccounts ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Filtered by direction={selectedDocumentDirection}: showing only{" "}
                    {selectedOffsetAccountType} accounts.
                  </p>
                ) : null}
                {!canReadGlAccounts ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Missing permission: `gl.account.read`. Default mapping will be used.
                  </p>
                ) : null}
                {postOffsetAccountsLoading ? (
                  <p className="mt-1 text-xs text-slate-600">Loading postable account options...</p>
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
                      ? `No postable ${selectedOffsetAccountType} accounts found for selected legal entity.`
                      : "No postable accounts found for selected legal entity."}
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
                    disabled={!canPostSelected || postSaving}
                  />
                  Split posting by line items
                </label>
                {postForm.usePostingLines ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                        Posting lines
                      </p>
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                        onClick={addPostFormPostingLine}
                        disabled={!canPostSelected || postSaving}
                      >
                        Add line
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
                                Line {index + 1}
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
                                Remove
                              </button>
                            </div>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Description (Optional)
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
                                Offset Account (Optional)
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
                                  <option value="">Use default offset for this post</option>
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
                                Invoice Amount (Invoice Currency)
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
                                Base Amount (Legal Entity Currency)
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
                        Draft totals txn/base:{" "}
                        {selectedDocumentAmountTxn ?? "-"} /{" "}
                        {selectedDocumentAmountBase ?? "-"}
                      </p>
                      <p>
                        Posting line totals txn/base:{" "}
                        {postFormPostingLineSummary.totalTxn} /{" "}
                        {postFormPostingLineSummary.totalBase}
                      </p>
                    </div>
                    {postFormPostingLineSummary.invalidAmountRows > 0 ? (
                      <p className="mt-1 text-xs text-amber-700">
                        {postFormPostingLineSummary.invalidAmountRows} line(s) have missing or invalid amounts.
                      </p>
                    ) : null}
                    {postFormPostingLineSummary.lineCount > 0 &&
                    postFormPostingLineSummary.hasDraftTotals &&
                    !postFormPostingLineSummary.matchesDraftTotals ? (
                      <p className="mt-1 text-xs text-amber-700">
                        Posting line totals must match draft totals before posting.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={postForm.useFxOverride} onChange={(event) => setPostForm((prev) => ({ ...prev, useFxOverride: event.target.checked }))} disabled={!canPostSelected || postSaving} />useFxOverride</label>
                <input type="text" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="fxOverrideReason" value={postForm.fxOverrideReason} onChange={(event) => setPostForm((prev) => ({ ...prev, fxOverrideReason: event.target.value }))} disabled={!canPostSelected || postSaving} />
                {postForm.useFxOverride && !canFxOverride ? <p className="mt-2 text-sm text-amber-700">You cannot post with FX override. Missing permission: `cari.fx.override`.</p> : null}
                <button type="button" className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={handlePostDraft} disabled={!canPostSelected || postSaving || !postingLinesReadyForSubmit}>{postSaving ? "Posting..." : "Post Draft"}</button>
                {postError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{postError}</div> : null}
                {postMessage ? <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{postMessage}</div> : null}

                <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-600">reverse reason<input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={reverseForm.reason} onChange={(event) => setReverseForm((prev) => ({ ...prev, reason: event.target.value }))} disabled={!canReverseSelected || reverseSaving} /></label>
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">reversalDate<input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" value={reverseForm.reversalDate} onChange={(event) => setReverseForm((prev) => ({ ...prev, reversalDate: event.target.value }))} disabled={!canReverseSelected || reverseSaving} /></label>
                <button type="button" className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={handleReversePosted} disabled={!canReverseSelected || reverseSaving}>{reverseSaving ? "Reversing..." : "Reverse Posted Document"}</button>
                {reverseError ? <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{reverseError}</div> : null}
                {reverseMessage ? <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{reverseMessage}</div> : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
