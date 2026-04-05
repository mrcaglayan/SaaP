import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  approveCariCounterpartyRequest,
  createCariCounterpartyRequest,
  createCariCounterparty,
  getCariCounterparty,
  listCariCounterpartyRequests,
  listCariCounterparties,
  rejectCariCounterpartyRequest,
  updateCariCounterparty,
} from "../../api/cariCounterparty.js";
import {
  approveApprovalRequest as approveUnifiedApprovalRequest,
  getApprovalRequestDelegationPreview,
  rejectApprovalRequest as rejectUnifiedApprovalRequest,
} from "../../api/approvalDelegations.js";
import { listAccounts, upsertAccount } from "../../api/glAdmin.js";
import {
  createCariPaymentTerm,
  listCariPaymentTerms,
} from "../../api/cariPaymentTerms.js";
import { listLegalEntities, listOperatingUnits } from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import ApprovalActionDialog from "../../components/approval/ApprovalActionDialog.jsx";
import {
  buildApprovalDelegationActionNotice,
  buildApprovalDelegationDrawerNotice,
} from "../../components/approval/approvalDelegationUi.js";
import ApprovalExecutionStatusBadge from "../../components/approval/ApprovalExecutionStatusBadge.jsx";
import ApprovalRequestDrawer from "../../components/approval/ApprovalRequestDrawer.jsx";
import ApprovalRequestStatusBadge from "../../components/approval/ApprovalRequestStatusBadge.jsx";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { useWorkingContextDefaults } from "../../context/useWorkingContextDefaults.js";
import CounterpartyForm from "./CounterpartyForm.jsx";
import {
  COUNTERPARTY_LIST_SORT_DIRECTIONS,
  COUNTERPARTY_LIST_SORT_FIELDS,
  ROLE_FILTERS,
  buildCounterpartyListParams,
  buildInitialCounterpartyForm,
  createCounterpartyListFilters,
  mapCounterpartyApiError,
  mapDetailToCounterpartyForm,
  normalizeCounterpartyListSortBy,
  normalizeCounterpartyListSortDir,
  resolveCounterpartyAccountPickerGates,
  toPositiveInt,
} from "./counterpartyFormUtils.js";

const PAGE_CONFIG = {
  buyerCreate: {
    title: "Musteri Karti Olustur",
    subtitle: "Musteri odakli yeni cari kart olusturun.",
    mode: "create",
    roleDefault: "CUSTOMER",
    createPath: "/app/musteri-kartlari/olustur",
  },
  buyerList: {
    title: "Musteri Kartlari",
    subtitle: "Musteri kartlarini filtreleyin ve duzenleyin.",
    mode: "list",
    roleDefault: "CUSTOMER",
    createPath: "/app/musteri-kartlari/olustur",
  },
  vendorCreate: {
    title: "Tedarikci Karti Olustur",
    subtitle: "Tedarikci odakli yeni cari kart olusturun.",
    mode: "create",
    roleDefault: "VENDOR",
    createPath: "/app/tedarikci-kartlari/olustur",
  },
  vendorList: {
    title: "Tedarikci Kartlari",
    subtitle: "Tedarikci kartlarini filtreleyin ve duzenleyin.",
    mode: "list",
    roleDefault: "VENDOR",
    createPath: "/app/tedarikci-kartlari/olustur",
  },
};

const SORT_FIELD_LABELS = {
  id: "Newest (ID)",
  code: "Counterparty Code",
  name: "Counterparty Name",
  status: "Status",
  arAccountCode: "AR Account Code",
  arAccountName: "AR Account Name",
  apAccountCode: "AP Account Code",
  apAccountName: "AP Account Name",
};

const SORT_DIRECTION_LABELS = {
  asc: "Ascending",
  desc: "Descending",
};

const COUNTERPARTY_CREATE_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "primaryOperatingUnitId", contextKey: "operatingUnitId" },
];

function roleBadgeClass(role) {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "BOTH") {
    return "bg-violet-100 text-violet-700";
  }
  if (normalized === "VENDOR") {
    return "bg-amber-100 text-amber-800";
  }
  if (normalized === "CUSTOMER") {
    return "bg-emerald-100 text-emerald-700";
  }
  return "bg-slate-200 text-slate-700";
}

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function formatDateTimeLabel(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function formatMappedAccountLabel(code, name) {
  const codeText = String(code || "").trim();
  const nameText = String(name || "").trim();
  if (!codeText && !nameText) {
    return "-";
  }
  if (codeText && nameText) {
    return `${codeText} - ${nameText}`;
  }
  return codeText || nameText;
}

function formatOperatingUnitLabel(code, name, id) {
  const codeText = String(code || "").trim();
  const nameText = String(name || "").trim();
  if (codeText && nameText) {
    return `${codeText} - ${nameText}`;
  }
  if (codeText || nameText) {
    return codeText || nameText;
  }
  const parsedId = toPositiveInt(id);
  return parsedId ? `#${parsedId}` : "-";
}

function formatLegalEntityLabel(row, id) {
  const codeText = String(row?.code || "").trim();
  const nameText = String(row?.name || "").trim();
  if (codeText && nameText) {
    return `${codeText} - ${nameText}`;
  }
  if (codeText || nameText) {
    return codeText || nameText;
  }
  const parsedId = toPositiveInt(id);
  return parsedId ? `#${parsedId}` : "-";
}

function formatApprovalScopeLabel(row, legalEntityById, operatingUnitById) {
  const scopeType = toUpperText(row?.approvalRequest?.scopeType);
  const scopeId = toPositiveInt(row?.approvalRequest?.scopeId);
  if (scopeType === "OPERATING_UNIT") {
    return `Operating Unit ${formatOperatingUnitLabel(
      operatingUnitById.get(String(scopeId))?.code,
      operatingUnitById.get(String(scopeId))?.name,
      scopeId
    )}`;
  }
  if (scopeType === "LEGAL_ENTITY") {
    return `Legal Entity ${legalEntityById.get(String(scopeId))?.code || scopeId || "-"}`;
  }
  if (scopeType) {
    return `${scopeType} ${scopeId ? `#${scopeId}` : ""}`.trim();
  }
  if (toPositiveInt(row?.primaryOperatingUnitId)) {
    return `Operating Unit ${formatOperatingUnitLabel(
      operatingUnitById.get(String(row.primaryOperatingUnitId))?.code,
      operatingUnitById.get(String(row.primaryOperatingUnitId))?.name,
      row.primaryOperatingUnitId
    )}`;
  }
  return `Legal Entity ${
    legalEntityById.get(String(row?.legalEntityId))?.code || row?.legalEntityId || "-"
  }`;
}

function buildRequestDecisionSummary(row) {
  const reviewStatus = toUpperText(row?.approvalRequest?.requestStatus || row?.requestStatus);
  if (reviewStatus === "ESCALATED") {
    return "Escalated review pending";
  }
  if (row?.requestStatus === "APPROVED") {
    return row?.createdCounterpartyCode || row?.createdCounterpartyId || "Approved";
  }
  if (row?.requestStatus === "REJECTED") {
    return row?.decisionComment || "Rejected";
  }
  if (row?.approvalRequest?.executionStatus === "FAILED") {
    return row?.approvalRequest?.executionErrorText || "Execution failed";
  }
  return row?.decisionComment || "Awaiting review";
}

function buildApprovalTimelineItems(row) {
  const approvalRequest = row?.approvalRequest || null;
  const reviewStatus = toUpperText(approvalRequest?.requestStatus || row?.requestStatus);
  const executionStatus = toUpperText(
    approvalRequest?.executionStatus || row?.executionStatus
  );
  const requestedBy = row?.requestedByUserName || row?.requestedByUserId || "Requester";
  const decidedBy = row?.decidedByUserName || row?.decidedByUserId || "Reviewer";
  const timelineItems = [];

  if (approvalRequest?.submittedAt || row?.createdAt) {
    timelineItems.push({
      key: "submitted",
      label: "Submitted for Review",
      description: "The request entered the approval queue.",
      at: approvalRequest?.submittedAt || row?.createdAt,
      actor: requestedBy,
      note: approvalRequest?.requestCode || "",
      state: "done",
    });
  }

  if (reviewStatus === "ESCALATED") {
    timelineItems.push({
      key: "escalated",
      label: "Escalated",
      description: "The request stayed in the same review queue and was escalated for urgent attention.",
      at: row?.updatedAt || row?.decidedAt || null,
      actor: "",
      note:
        approvalRequest?.currentStepNo != null
          ? `Current step ${approvalRequest.currentStepNo}`
          : "Urgent reviewer follow-up",
      state: "attention",
      tone: "attention",
    });
  }

  if (
    reviewStatus === "PENDING_REVIEW" ||
    reviewStatus === "ESCALATED" ||
    row?.requestStatus === "PENDING"
  ) {
    timelineItems.push({
      key: "pending-review",
      label: reviewStatus === "ESCALATED" ? "Escalated Review" : "Awaiting Review",
      description:
        reviewStatus === "ESCALATED"
          ? "The request is still actionable in the normal review queue."
          : "A reviewer still needs to record a decision.",
      at: null,
      actor: "",
      note:
        approvalRequest?.currentStepNo != null
          ? `Current step ${approvalRequest.currentStepNo}`
          : "Pending reviewer action",
      state: reviewStatus === "ESCALATED" ? "attention" : "current",
      tone: reviewStatus === "ESCALATED" ? "attention" : "",
    });
  }

  if (approvalRequest?.approvedAt) {
    timelineItems.push({
      key: "approved",
      label: "Approved",
      description: "The review stage reached final approval.",
      at: approvalRequest.approvedAt,
      actor: decidedBy,
      note: row?.decisionComment || "",
      state: executionStatus === "NOT_EXECUTED" || executionStatus === "FAILED" ? "current" : "done",
    });
  }

  if (approvalRequest?.rejectedAt || row?.requestStatus === "REJECTED") {
    timelineItems.push({
      key: "rejected",
      label: "Rejected",
      description: "The request was rejected during review.",
      at: approvalRequest?.rejectedAt || row?.decidedAt,
      actor: decidedBy,
      note: row?.decisionComment || "",
      state: "done",
    });
  }

  if (approvalRequest?.withdrawnAt || row?.requestStatus === "CANCELLED") {
    timelineItems.push({
      key: "withdrawn",
      label: "Withdrawn",
      description: "The request was withdrawn before execution.",
      at: approvalRequest?.withdrawnAt || row?.updatedAt,
      actor: requestedBy,
      note: "",
      state: "done",
    });
  }

  if (approvalRequest?.executedAt || executionStatus === "EXECUTED") {
    timelineItems.push({
      key: "executed",
      label: "Executed",
      description: row?.createdCounterpartyId
        ? "A live counterparty card was created from the approved request."
        : "The approved request was executed.",
      at: approvalRequest?.executedAt || row?.updatedAt,
      actor: approvalRequest?.executedByUserId || "",
      note: row?.createdCounterpartyCode || row?.createdCounterpartyId || "",
      state: "done",
    });
  }

  if (executionStatus === "FAILED") {
    timelineItems.push({
      key: "execution-failed",
      label: "Execution Failed",
      description: "Review completed, but the execution step failed.",
      at: approvalRequest?.updatedAt || row?.updatedAt,
      actor: "",
      note: approvalRequest?.executionErrorText || "",
      state: "attention",
      tone: "attention",
    });
  }

  if (timelineItems.length === 0 && row?.createdAt) {
    timelineItems.push({
      key: "created",
      label: "Request Created",
      description: "Legacy request activity is available without detailed review history.",
      at: row.createdAt,
      actor: requestedBy,
      note: "",
      state: "done",
    });
  }

  return timelineItems;
}

function buildRequestStatusNotice(row) {
  const reviewStatus = toUpperText(row?.approvalRequest?.requestStatus || row?.requestStatus);
  if (reviewStatus !== "ESCALATED") {
    return null;
  }
  return {
    tone: "attention",
    title: "Escalated but still actionable",
    description:
      "This request has been escalated for urgency. It stays in the same pending queue and can still be approved or rejected here.",
  };
}

function matchesApprovalRequestId(row, approvalRequestId) {
  const normalizedApprovalRequestId = toPositiveInt(approvalRequestId);
  if (!normalizedApprovalRequestId || !row) {
    return false;
  }
  return (
    toPositiveInt(row?.approvalRequest?.id) === normalizedApprovalRequestId ||
    toPositiveInt(row?.id) === normalizedApprovalRequestId
  );
}

function canUseDelegatedDecision(preview) {
  return preview?.authorityMode === "DIRECT" || preview?.authorityMode === "DELEGATED";
}

function normalizeFilterRole(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return fallback;
  }
  if (!ROLE_FILTERS.includes(normalized)) {
    return fallback;
  }
  return normalized;
}

function normalizeLookupQuery(value) {
  return String(value || "").trim();
}

function resolveLegalEntityCurrencyCode(legalEntity) {
  const normalized = String(
    legalEntity?.functional_currency_code || legalEntity?.functionalCurrencyCode || ""
  )
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, 3);
}

function buildInlinePaymentTermCode({ legalEntityId, name }) {
  const normalizedName = normalizeLookupQuery(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 18);
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()
    : Math.random().toString(36).slice(2, 8).toUpperCase();
  const base = normalizedName || "TERM";
  return `PT-${legalEntityId}-${base}-${suffix}`.slice(0, 50);
}

function prependOrReplacePaymentTermOption(options, row) {
  const nextRowId = Number(row?.id || 0);
  if (!nextRowId) {
    return Array.isArray(options) ? [...options] : [];
  }
  const existing = Array.isArray(options) ? options : [];
  const filtered = existing.filter((item) => Number(item?.id || 0) !== nextRowId);
  return [row, ...filtered];
}

function mapPaymentTermRows(response) {
  if (!Array.isArray(response?.rows)) {
    return [];
  }
  return response.rows.map((row) => ({
    id: Number(row?.id || 0),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    dueDays: Number(row?.dueDays ?? row?.due_days ?? 0),
    graceDays: Number(row?.graceDays ?? row?.grace_days ?? 0),
    isEndOfMonth: Boolean(row?.isEndOfMonth ?? row?.is_end_of_month),
    status: String(row?.status || "ACTIVE").toUpperCase(),
  }));
}

function mapAccountRows(response) {
  if (!Array.isArray(response?.rows)) {
    return [];
  }
  return response.rows.map((row) => ({
    id: Number(row?.id || 0),
    coaId: Number(row?.coa_id || row?.coaId || 0),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    accountType: String(row?.account_type || row?.accountType || "").toUpperCase(),
    normalSide: String(row?.normal_side || row?.normalSide || "").toUpperCase(),
    allowPosting: Boolean(row?.allow_posting ?? row?.allowPosting),
    isActive: Boolean(row?.is_active ?? row?.isActive),
    parentAccountId: Number(row?.parent_account_id || row?.parentAccountId || 0) || null,
    breadcrumb: String(row?.account_breadcrumb || row?.accountBreadcrumb || "").trim(),
    breadcrumbCodes: String(
      row?.account_breadcrumb_codes || row?.accountBreadcrumbCodes || ""
    ).trim(),
    breadcrumbNames: String(
      row?.account_breadcrumb_names || row?.accountBreadcrumbNames || ""
    ).trim(),
  }));
}

function normalizeAccountCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function deriveSearchCodeCandidate(value) {
  const normalized = normalizeAccountCode(value);
  if (!normalized || /\s/.test(normalized)) {
    return "";
  }
  return normalized;
}

function findBestParentAccount(candidateCode, parentAccountOptions) {
  if (!candidateCode) {
    return null;
  }
  let bestParent = null;
  for (const row of parentAccountOptions || []) {
    const parentCode = normalizeAccountCode(row?.code);
    if (!parentCode || candidateCode === parentCode) {
      continue;
    }
    const matchesPrefix =
      candidateCode.startsWith(`${parentCode}.`) ||
      candidateCode.startsWith(`${parentCode}-`) ||
      candidateCode.startsWith(parentCode);
    if (!matchesPrefix) {
      continue;
    }
    if (
      !bestParent ||
      parentCode.length > normalizeAccountCode(bestParent?.code).length
    ) {
      bestParent = row;
    }
  }
  return bestParent;
}

function isActivePostableAccount(row) {
  const allowPosting = row?.allowPosting === true || Number(row?.allowPosting) === 1;
  const isActive = row?.isActive === true || Number(row?.isActive) === 1;
  return allowPosting && isActive;
}

function isActiveAccount(row) {
  return row?.isActive === true || Number(row?.isActive) === 1;
}

function buildInlineParentAccountOptions(rows, expectedType) {
  const type = normalizeAccountCode(expectedType);
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        normalizeAccountCode(row?.accountType) === type &&
        isActiveAccount(row) &&
        toPositiveInt(row?.id)
    )
    .sort((left, right) =>
      normalizeAccountCode(left?.code).localeCompare(normalizeAccountCode(right?.code))
    );
}

function findExactInlineCodeMatch(rows, candidateCode, expectedType) {
  const normalizedCode = normalizeAccountCode(candidateCode);
  const normalizedType = normalizeAccountCode(expectedType);
  if (!normalizedCode || !normalizedType) {
    return null;
  }
  return (
    (Array.isArray(rows) ? rows : []).find(
      (row) =>
        normalizeAccountCode(row?.code) === normalizedCode &&
        normalizeAccountCode(row?.accountType) === normalizedType &&
        isActivePostableAccount(row) &&
        toPositiveInt(row?.id)
    ) || null
  );
}

function resolveInlineControlAccountSpec(direction) {
  const normalizedDirection = String(direction || "").trim().toUpperCase();
  if (normalizedDirection === "AR") {
    return {
      direction: "AR",
      controlCode: "120",
      accountType: "ASSET",
      normalSide: "DEBIT",
      fieldName: "arAccountId",
    };
  }
  return {
    direction: "AP",
    controlCode: "320",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    fieldName: "apAccountId",
  };
}

function selectInlineControlParentAccount(accounts, spec) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const expectedType = normalizeAccountCode(spec?.accountType);
  const preferredControlCode = normalizeAccountCode(spec?.controlCode);

  const exactControl = rows.find(
    (row) =>
      normalizeAccountCode(row?.code) === preferredControlCode &&
      normalizeAccountCode(row?.accountType) === expectedType &&
      toPositiveInt(row?.id)
  );
  if (exactControl) {
    return exactControl;
  }

  const rootByType = rows.find(
    (row) =>
      !toPositiveInt(row?.parentAccountId) &&
      normalizeAccountCode(row?.accountType) === expectedType &&
      toPositiveInt(row?.id)
  );
  if (rootByType) {
    return rootByType;
  }

  return (
    rows.find(
      (row) =>
        normalizeAccountCode(row?.accountType) === expectedType &&
        toPositiveInt(row?.id)
    ) || null
  );
}

function parseInlineChildSequence(code, parentCode) {
  const normalizedCode = normalizeAccountCode(code);
  const normalizedParentCode = normalizeAccountCode(parentCode);
  if (!normalizedCode || !normalizedParentCode) {
    return null;
  }

  let suffix = "";
  if (normalizedCode.startsWith(`${normalizedParentCode}.`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(`${normalizedParentCode}-`)) {
    suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  } else if (normalizedCode.startsWith(normalizedParentCode)) {
    suffix = normalizedCode.slice(normalizedParentCode.length);
  } else {
    return null;
  }

  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const numeric = Number(suffix);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return {
    value: numeric,
    width: suffix.length,
  };
}

function buildNextInlineChildCode(accounts, parentAccount) {
  const parentCode = normalizeAccountCode(parentAccount?.code);
  const parentId = toPositiveInt(parentAccount?.id);
  if (!parentCode || !parentId) {
    return "";
  }

  const rows = Array.isArray(accounts) ? accounts : [];
  const existingCodes = new Set(
    rows
      .map((row) => normalizeAccountCode(row?.code))
      .filter(Boolean)
  );

  const parsedChildren = rows
    .filter((row) => toPositiveInt(row?.parentAccountId) === parentId)
    .map((row) => parseInlineChildSequence(row?.code, parentCode))
    .filter(Boolean);

  const maxSequence = parsedChildren.reduce(
    (maxValue, row) => Math.max(maxValue, Number(row?.value || 0)),
    0
  );
  const width = Math.max(
    2,
    parsedChildren.reduce(
      (maxWidth, row) => Math.max(maxWidth, Number(row?.width || 0)),
      0
    )
  );

  let next = Math.max(1, maxSequence + 1);
  while (next <= 999999) {
    const candidate = `${parentCode}.${String(next).padStart(width, "0")}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
    next += 1;
  }
  return "";
}

/**
 * Renders counterparty create/list flows while separating request review authority
 * from live card edit authority.
 */
export default function CariCounterpartyPage({ pageKey = "buyerList" }) {
  const config = PAGE_CONFIG[pageKey] || PAGE_CONFIG.buyerList;
  const isCreatePage = config.mode === "create";
  const isListPage = config.mode === "list";
  const [searchParams, setSearchParams] = useSearchParams();

  const { hasPermission, permissions, user } = useAuth();
  const canRead = hasPermission("cari.card.read");
  const canRequest = hasPermission("cari.card.request");
  const canUpsert = hasPermission("cari.card.upsert");
  const isRequestCreateMode = isCreatePage && !canUpsert && canRequest;
  const canReviewRequests = hasPermission("cari.request.review");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadScopedOrgLookups = canReadOrgTree || canRequest || canUpsert;
  const canReadPaymentTerms = canRead || canRequest || canUpsert;
  const {
    workingContext,
    legalEntities: contextLegalEntities,
    operatingUnits: contextOperatingUnits,
  } = useWorkingContext();
  const accountPickerGates = useMemo(
    () => resolveCounterpartyAccountPickerGates(permissions),
    [permissions]
  );

  const [legalEntities, setLegalEntities] = useState([]);
  const [legalEntitiesLoading, setLegalEntitiesLoading] = useState(false);
  const [legalEntitiesError, setLegalEntitiesError] = useState("");

  const [createForm, setCreateForm] = useState(() =>
    buildInitialCounterpartyForm(config.roleDefault)
  );
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [createPaymentTerms, setCreatePaymentTerms] = useState([]);
  const [createPaymentTermsLoading, setCreatePaymentTermsLoading] = useState(false);
  const [createPaymentTermsError, setCreatePaymentTermsError] = useState("");
  const [createPaymentTermLookupQuery, setCreatePaymentTermLookupQuery] = useState("");
  const [createInlinePaymentTermSaving, setCreateInlinePaymentTermSaving] = useState(false);
  const [createInlinePaymentTermError, setCreateInlinePaymentTermError] = useState("");
  const [createInlinePaymentTermMessage, setCreateInlinePaymentTermMessage] = useState("");
  const [createAccountOptions, setCreateAccountOptions] = useState([]);
  const [createAccountsLoading, setCreateAccountsLoading] = useState(false);
  const [createAccountsError, setCreateAccountsError] = useState("");
  const [createArAccountLookupQuery, setCreateArAccountLookupQuery] = useState("");
  const [createApAccountLookupQuery, setCreateApAccountLookupQuery] = useState("");
  const [createInlineArParentAccountId, setCreateInlineArParentAccountId] = useState("");
  const [createInlineArChildCode, setCreateInlineArChildCode] = useState("");
  const [createInlineArChildName, setCreateInlineArChildName] = useState("");
  const [createInlineApParentAccountId, setCreateInlineApParentAccountId] = useState("");
  const [createInlineApChildCode, setCreateInlineApChildCode] = useState("");
  const [createInlineApChildName, setCreateInlineApChildName] = useState("");
  const [createInlineArAccountSaving, setCreateInlineArAccountSaving] = useState(false);
  const [createInlineArAccountError, setCreateInlineArAccountError] = useState("");
  const [createInlineArAccountMessage, setCreateInlineArAccountMessage] = useState("");
  const [createInlineApAccountSaving, setCreateInlineApAccountSaving] = useState(false);
  const [createInlineApAccountError, setCreateInlineApAccountError] = useState("");
  const [createInlineApAccountMessage, setCreateInlineApAccountMessage] = useState("");
  const createPreviousLegalEntityIdRef = useRef("");
  const createOperatingUnitLegalEntityRef = useRef("");
  const [createOperatingUnits, setCreateOperatingUnits] = useState([]);
  const [createOperatingUnitsLoading, setCreateOperatingUnitsLoading] = useState(false);
  const [createOperatingUnitsError, setCreateOperatingUnitsError] = useState("");

  useWorkingContextDefaults(setCreateForm, COUNTERPARTY_CREATE_CONTEXT_MAPPINGS, [
    createForm.legalEntityId,
    createForm.primaryOperatingUnitId,
  ]);

  const [filters, setFilters] = useState(() =>
    createCounterpartyListFilters(config.roleDefault)
  );
  const filterOperatingUnitLegalEntityRef = useRef("");
  const [filterOperatingUnits, setFilterOperatingUnits] = useState([]);
  const [filterOperatingUnitsLoading, setFilterOperatingUnitsLoading] = useState(false);
  const [filterOperatingUnitsError, setFilterOperatingUnitsError] = useState("");
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [requestRows, setRequestRows] = useState([]);
  const [requestTotalRows, setRequestTotalRows] = useState(0);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestActionKey, setRequestActionKey] = useState("");
  const [activeRequestId, setActiveRequestId] = useState(null);
  const [requestActionDialog, setRequestActionDialog] = useState(null);
  const [delegationPreview, setDelegationPreview] = useState(null);
  const [delegationPreviewLoading, setDelegationPreviewLoading] = useState(false);
  const dismissedApprovalRequestIdRef = useRef(null);

  const [editingId, setEditingId] = useState(null);
  const [editingForm, setEditingForm] = useState(() =>
    buildInitialCounterpartyForm(config.roleDefault)
  );
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editPaymentTerms, setEditPaymentTerms] = useState([]);
  const [editPaymentTermsLoading, setEditPaymentTermsLoading] = useState(false);
  const [editPaymentTermsError, setEditPaymentTermsError] = useState("");
  const [editPaymentTermLookupQuery, setEditPaymentTermLookupQuery] = useState("");
  const [editInlinePaymentTermSaving, setEditInlinePaymentTermSaving] = useState(false);
  const [editInlinePaymentTermError, setEditInlinePaymentTermError] = useState("");
  const [editInlinePaymentTermMessage, setEditInlinePaymentTermMessage] = useState("");
  const [editAccountOptions, setEditAccountOptions] = useState([]);
  const [editAccountsLoading, setEditAccountsLoading] = useState(false);
  const [editAccountsError, setEditAccountsError] = useState("");
  const [editArAccountLookupQuery, setEditArAccountLookupQuery] = useState("");
  const [editApAccountLookupQuery, setEditApAccountLookupQuery] = useState("");
  const [editInlineArParentAccountId, setEditInlineArParentAccountId] = useState("");
  const [editInlineArChildCode, setEditInlineArChildCode] = useState("");
  const [editInlineArChildName, setEditInlineArChildName] = useState("");
  const [editInlineApParentAccountId, setEditInlineApParentAccountId] = useState("");
  const [editInlineApChildCode, setEditInlineApChildCode] = useState("");
  const [editInlineApChildName, setEditInlineApChildName] = useState("");
  const [editInlineArAccountSaving, setEditInlineArAccountSaving] = useState(false);
  const [editInlineArAccountError, setEditInlineArAccountError] = useState("");
  const [editInlineArAccountMessage, setEditInlineArAccountMessage] = useState("");
  const [editInlineApAccountSaving, setEditInlineApAccountSaving] = useState(false);
  const [editInlineApAccountError, setEditInlineApAccountError] = useState("");
  const [editInlineApAccountMessage, setEditInlineApAccountMessage] = useState("");
  const editPreviousLegalEntityIdRef = useRef("");
  const editOperatingUnitLegalEntityRef = useRef("");
  const [editOperatingUnits, setEditOperatingUnits] = useState([]);
  const [editOperatingUnitsLoading, setEditOperatingUnitsLoading] = useState(false);
  const [editOperatingUnitsError, setEditOperatingUnitsError] = useState("");

  const legalEntityById = useMemo(() => {
    const map = new Map();
    for (const row of [...contextLegalEntities, ...legalEntities]) {
      map.set(String(row.id), row);
    }
    return map;
  }, [contextLegalEntities, legalEntities]);

  const operatingUnitById = useMemo(() => {
    const map = new Map();
    for (const row of [
      ...contextOperatingUnits,
      ...createOperatingUnits,
      ...filterOperatingUnits,
      ...editOperatingUnits,
    ]) {
      map.set(String(row.id), row);
    }
    return map;
  }, [contextOperatingUnits, createOperatingUnits, filterOperatingUnits, editOperatingUnits]);

  const activeRequestRow = useMemo(
    () => requestRows.find((row) => row.id === activeRequestId) || null,
    [activeRequestId, requestRows]
  );

  useEffect(() => {
    if (!activeRequestId || requestLoading || activeRequestRow) {
      return;
    }
    setActiveRequestId(null);
    setRequestActionDialog(null);
  }, [activeRequestId, activeRequestRow, requestLoading]);

  useEffect(() => {
    const requestedApprovalRequestId = searchParams.get("approvalRequestId");
    const normalizedApprovalRequestId = toPositiveInt(requestedApprovalRequestId);
    if (!normalizedApprovalRequestId) {
      dismissedApprovalRequestIdRef.current = null;
      return;
    }
    if (
      dismissedApprovalRequestIdRef.current &&
      dismissedApprovalRequestIdRef.current === normalizedApprovalRequestId
    ) {
      return;
    }
    if (!requestedApprovalRequestId || requestLoading || requestRows.length === 0) {
      return;
    }
    const match = requestRows.find((row) =>
      matchesApprovalRequestId(row, requestedApprovalRequestId)
    );
    if (!match || toPositiveInt(activeRequestId) === toPositiveInt(match.id)) {
      return;
    }
    setRequestError("");
    setRequestActionDialog(null);
    setActiveRequestId(match.id);
  }, [activeRequestId, requestLoading, requestRows, searchParams]);

  useEffect(() => {
    const approvalRequestId = toPositiveInt(activeRequestRow?.approvalRequest?.id);
    if (!approvalRequestId) {
      setDelegationPreview(null);
      setDelegationPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setDelegationPreviewLoading(true);
    getApprovalRequestDelegationPreview(approvalRequestId)
      .then((response) => {
        if (!cancelled) {
          setDelegationPreview(response?.row || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDelegationPreview(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDelegationPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRequestRow]);

  useEffect(() => {
    setCreateForm(buildInitialCounterpartyForm(config.roleDefault));
    setFilters(createCounterpartyListFilters(config.roleDefault));
    setFilterOperatingUnits([]);
    setFilterOperatingUnitsLoading(false);
    setFilterOperatingUnitsError("");
    setRows([]);
    setTotalRows(0);
    setRequestRows([]);
    setRequestTotalRows(0);
    setRequestError("");
    setRequestMessage("");
    setRequestActionKey("");
    setActiveRequestId(null);
    setRequestActionDialog(null);
    setDelegationPreview(null);
    setDelegationPreviewLoading(false);
    setEditingId(null);
    setEditingForm(buildInitialCounterpartyForm(config.roleDefault));
    setCreateError("");
    setCreateMessage("");
    setListError("");
    setEditError("");
    setEditMessage("");
    setCreatePaymentTerms([]);
    setCreatePaymentTermsError("");
    setCreatePaymentTermLookupQuery("");
    setCreateInlinePaymentTermSaving(false);
    setCreateInlinePaymentTermError("");
    setCreateInlinePaymentTermMessage("");
    setCreateAccountOptions([]);
    setCreateAccountsError("");
    setCreateOperatingUnits([]);
    setCreateOperatingUnitsLoading(false);
    setCreateOperatingUnitsError("");
    setCreateArAccountLookupQuery("");
    setCreateApAccountLookupQuery("");
    setCreateInlineArParentAccountId("");
    setCreateInlineArChildCode("");
    setCreateInlineArChildName("");
    setCreateInlineApParentAccountId("");
    setCreateInlineApChildCode("");
    setCreateInlineApChildName("");
    setEditPaymentTerms([]);
    setEditPaymentTermsError("");
    setEditPaymentTermLookupQuery("");
    setEditInlinePaymentTermSaving(false);
    setEditInlinePaymentTermError("");
    setEditInlinePaymentTermMessage("");
    setEditAccountOptions([]);
    setEditAccountsError("");
    setEditOperatingUnits([]);
    setEditOperatingUnitsLoading(false);
    setEditOperatingUnitsError("");
    setEditArAccountLookupQuery("");
    setEditApAccountLookupQuery("");
    setEditInlineArParentAccountId("");
    setEditInlineArChildCode("");
    setEditInlineArChildName("");
    setEditInlineApParentAccountId("");
    setEditInlineApChildCode("");
    setEditInlineApChildName("");
    createPreviousLegalEntityIdRef.current = "";
    createOperatingUnitLegalEntityRef.current = "";
    filterOperatingUnitLegalEntityRef.current = "";
    editPreviousLegalEntityIdRef.current = "";
    editOperatingUnitLegalEntityRef.current = "";
  }, [config.roleDefault, config.mode]);

  useEffect(() => {
    let cancelled = false;
    async function loadLegalEntityOptions() {
      if (!canReadScopedOrgLookups) {
        setLegalEntities([]);
        setLegalEntitiesError("Legal entity options are not available for this user.");
        return;
      }

      setLegalEntitiesLoading(true);
      setLegalEntitiesError("");
      try {
        const response = await listLegalEntities({ limit: 500, includeInactive: true });
        if (cancelled) {
          return;
        }
        setLegalEntities(Array.isArray(response?.rows) ? response.rows : []);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setLegalEntities([]);
        setLegalEntitiesError(
          String(err?.response?.data?.message || "Failed to load legal entities.")
        );
      } finally {
        if (!cancelled) {
          setLegalEntitiesLoading(false);
        }
      }
    }

    loadLegalEntityOptions();
    return () => {
      cancelled = true;
    };
  }, [canReadScopedOrgLookups]);

  useEffect(() => {
    if (!isCreatePage) {
      return;
    }
    if (createForm.legalEntityId) {
      return;
    }
    if (!Array.isArray(legalEntities) || legalEntities.length === 0) {
      return;
    }
    setCreateForm((prev) => ({
      ...prev,
      legalEntityId: String(legalEntities[0].id || ""),
    }));
  }, [createForm.legalEntityId, isCreatePage, legalEntities]);

  useEffect(() => {
    if (!isCreatePage) {
      return;
    }
    const primaryOperatingUnitId = String(createForm.primaryOperatingUnitId || "").trim();
    if (!primaryOperatingUnitId) {
      return;
    }
    setCreateForm((prev) => {
      const existingIds = Array.isArray(prev.operatingUnitIds)
        ? prev.operatingUnitIds.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      if (existingIds.includes(primaryOperatingUnitId)) {
        return prev;
      }
      return {
        ...prev,
        operatingUnitIds: [primaryOperatingUnitId, ...existingIds],
      };
    });
  }, [isCreatePage, createForm.primaryOperatingUnitId]);

  useEffect(() => {
    if (!isCreatePage) {
      createPreviousLegalEntityIdRef.current = "";
      return;
    }
    const selectedLegalEntityId = String(createForm.legalEntityId || "").trim();
    if (!selectedLegalEntityId) {
      createPreviousLegalEntityIdRef.current = "";
      return;
    }
    const selectedLegalEntity = legalEntityById.get(selectedLegalEntityId);
    const entityCurrency = resolveLegalEntityCurrencyCode(selectedLegalEntity);
    if (!entityCurrency) {
      createPreviousLegalEntityIdRef.current = selectedLegalEntityId;
      return;
    }
    const previousLegalEntityId = createPreviousLegalEntityIdRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    const currentCurrency = String(createForm.defaultCurrencyCode || "").trim();
    const shouldSyncCurrency = !currentCurrency || legalEntityChanged;
    createPreviousLegalEntityIdRef.current = selectedLegalEntityId;
    if (!shouldSyncCurrency) {
      return;
    }
    const normalizedEntityCurrency = String(entityCurrency).trim().toUpperCase();
    if (!normalizedEntityCurrency) {
      return;
    }
    if (currentCurrency.toUpperCase() === normalizedEntityCurrency) {
      return;
    }
    setCreateForm((prev) => {
      if (String(prev.legalEntityId || "").trim() !== selectedLegalEntityId) {
        return prev;
      }
      const prevCurrency = String(prev.defaultCurrencyCode || "").trim();
      if (!legalEntityChanged && prevCurrency) {
        return prev;
      }
      return {
        ...prev,
        defaultCurrencyCode: normalizedEntityCurrency,
      };
    });
  }, [isCreatePage, createForm.legalEntityId, createForm.defaultCurrencyCode, legalEntityById]);

  useEffect(() => {
    if (!editingId) {
      editPreviousLegalEntityIdRef.current = "";
      return;
    }
    const selectedLegalEntityId = String(editingForm.legalEntityId || "").trim();
    if (!selectedLegalEntityId) {
      editPreviousLegalEntityIdRef.current = "";
      return;
    }
    const selectedLegalEntity = legalEntityById.get(selectedLegalEntityId);
    const entityCurrency = resolveLegalEntityCurrencyCode(selectedLegalEntity);
    if (!entityCurrency) {
      editPreviousLegalEntityIdRef.current = selectedLegalEntityId;
      return;
    }
    const previousLegalEntityId = editPreviousLegalEntityIdRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    const currentCurrency = String(editingForm.defaultCurrencyCode || "").trim();
    const shouldSyncCurrency = !currentCurrency || legalEntityChanged;
    editPreviousLegalEntityIdRef.current = selectedLegalEntityId;
    if (!shouldSyncCurrency) {
      return;
    }
    const normalizedEntityCurrency = String(entityCurrency).trim().toUpperCase();
    if (!normalizedEntityCurrency) {
      return;
    }
    if (currentCurrency.toUpperCase() === normalizedEntityCurrency) {
      return;
    }
    setEditingForm((prev) => {
      if (String(prev.legalEntityId || "").trim() !== selectedLegalEntityId) {
        return prev;
      }
      const prevCurrency = String(prev.defaultCurrencyCode || "").trim();
      if (!legalEntityChanged && prevCurrency) {
        return prev;
      }
      return {
        ...prev,
        defaultCurrencyCode: normalizedEntityCurrency,
      };
    });
  }, [editingId, editingForm.legalEntityId, editingForm.defaultCurrencyCode, legalEntityById]);

  useEffect(() => {
    if (!isCreatePage) {
      return;
    }
    setCreatePaymentTermLookupQuery("");
    setCreateInlinePaymentTermSaving(false);
    setCreateInlinePaymentTermError("");
    setCreateInlinePaymentTermMessage("");
    setCreateArAccountLookupQuery("");
    setCreateApAccountLookupQuery("");
    setCreateInlineArParentAccountId("");
    setCreateInlineArChildCode("");
    setCreateInlineArChildName("");
    setCreateInlineApParentAccountId("");
    setCreateInlineApChildCode("");
    setCreateInlineApChildName("");
    setCreateInlineArAccountSaving(false);
    setCreateInlineArAccountError("");
    setCreateInlineArAccountMessage("");
    setCreateInlineApAccountSaving(false);
    setCreateInlineApAccountError("");
    setCreateInlineApAccountMessage("");
  }, [isCreatePage, createForm.legalEntityId]);

  useEffect(() => {
    if (!isCreatePage) {
      createOperatingUnitLegalEntityRef.current = "";
      return;
    }
    const selectedLegalEntityId = String(createForm.legalEntityId || "").trim();
    const previousLegalEntityId = createOperatingUnitLegalEntityRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    createOperatingUnitLegalEntityRef.current = selectedLegalEntityId;

    if (!selectedLegalEntityId) {
      setCreateForm((prev) => {
        if (
          !prev.primaryOperatingUnitId &&
          (!Array.isArray(prev.operatingUnitIds) || prev.operatingUnitIds.length === 0)
        ) {
          return prev;
        }
        return {
          ...prev,
          primaryOperatingUnitId: "",
          operatingUnitIds: [],
        };
      });
      return;
    }

    if (!legalEntityChanged) {
      return;
    }

    setCreateForm((prev) => ({
      ...prev,
      primaryOperatingUnitId: "",
      operatingUnitIds: [],
    }));
  }, [isCreatePage, createForm.legalEntityId]);

  useEffect(() => {
    if (!editingId) {
      setEditPaymentTermLookupQuery("");
      setEditInlinePaymentTermSaving(false);
      setEditInlinePaymentTermError("");
      setEditInlinePaymentTermMessage("");
      setEditArAccountLookupQuery("");
      setEditApAccountLookupQuery("");
      setEditInlineArParentAccountId("");
      setEditInlineArChildCode("");
      setEditInlineArChildName("");
      setEditInlineApParentAccountId("");
      setEditInlineApChildCode("");
      setEditInlineApChildName("");
      setEditInlineArAccountSaving(false);
      setEditInlineArAccountError("");
      setEditInlineArAccountMessage("");
      setEditInlineApAccountSaving(false);
      setEditInlineApAccountError("");
      setEditInlineApAccountMessage("");
      return;
    }
    setEditPaymentTermLookupQuery("");
    setEditInlinePaymentTermSaving(false);
    setEditInlinePaymentTermError("");
    setEditInlinePaymentTermMessage("");
    setEditArAccountLookupQuery("");
    setEditApAccountLookupQuery("");
    setEditInlineArParentAccountId("");
    setEditInlineArChildCode("");
    setEditInlineArChildName("");
    setEditInlineApParentAccountId("");
    setEditInlineApChildCode("");
    setEditInlineApChildName("");
    setEditInlineArAccountSaving(false);
    setEditInlineArAccountError("");
    setEditInlineArAccountMessage("");
    setEditInlineApAccountSaving(false);
    setEditInlineApAccountError("");
    setEditInlineApAccountMessage("");
  }, [editingId, editingForm.legalEntityId]);

  useEffect(() => {
    if (!editingId) {
      editOperatingUnitLegalEntityRef.current = "";
      return;
    }
    const selectedLegalEntityId = String(editingForm.legalEntityId || "").trim();
    const previousLegalEntityId = editOperatingUnitLegalEntityRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    editOperatingUnitLegalEntityRef.current = selectedLegalEntityId;

    if (!selectedLegalEntityId) {
      setEditingForm((prev) => {
        if (
          !prev.primaryOperatingUnitId &&
          (!Array.isArray(prev.operatingUnitIds) || prev.operatingUnitIds.length === 0)
        ) {
          return prev;
        }
        return {
          ...prev,
          primaryOperatingUnitId: "",
          operatingUnitIds: [],
        };
      });
      return;
    }

    if (!legalEntityChanged) {
      return;
    }

    setEditingForm((prev) => ({
      ...prev,
      primaryOperatingUnitId: "",
      operatingUnitIds: [],
    }));
  }, [editingId, editingForm.legalEntityId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCreatePaymentTerms() {
      if (!isCreatePage) {
        setCreatePaymentTerms([]);
        setCreatePaymentTermsError("");
        setCreatePaymentTermsLoading(false);
        return;
      }

      await loadPaymentTermsForLegalEntity({
        legalEntityId: createForm.legalEntityId,
        queryText: createPaymentTermLookupQuery,
        setRows: (rows) => {
          if (!cancelled) {
            setCreatePaymentTerms(rows);
          }
        },
        setLoading: (loading) => {
          if (!cancelled) {
            setCreatePaymentTermsLoading(loading);
          }
        },
        setError: (error) => {
          if (!cancelled) {
            setCreatePaymentTermsError(error);
          }
        },
      });
    }

    loadCreatePaymentTerms();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isCreatePage,
    createForm.legalEntityId,
    createPaymentTermLookupQuery,
    canReadPaymentTerms,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadCreateAccounts() {
      if (!isCreatePage || isRequestCreateMode) {
        setCreateAccountOptions([]);
        setCreateAccountsError("");
        setCreateAccountsLoading(false);
        return;
      }

      await loadAccountsForLegalEntity({
        legalEntityId: createForm.legalEntityId,
        queryText: "",
        setRows: (rows) => {
          if (!cancelled) {
            setCreateAccountOptions(rows);
          }
        },
        setLoading: (loading) => {
          if (!cancelled) {
            setCreateAccountsLoading(loading);
          }
        },
        setError: (error) => {
          if (!cancelled) {
            setCreateAccountsError(error);
          }
        },
      });
    }

    const timer = setTimeout(() => {
      void loadCreateAccounts();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isCreatePage,
    isRequestCreateMode,
    createForm.legalEntityId,
    accountPickerGates.shouldFetchGlAccounts,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadCreateOperatingUnits() {
      if (!isCreatePage) {
        setCreateOperatingUnits([]);
        setCreateOperatingUnitsError("");
        setCreateOperatingUnitsLoading(false);
        return;
      }

      await loadOperatingUnitsForLegalEntity({
        legalEntityId: createForm.legalEntityId,
        setRows: (rows) => {
          if (!cancelled) {
            setCreateOperatingUnits(rows);
            setCreateForm((prev) => {
              const visibleIds = new Set(
                rows.map((row) => String(row?.id || "").trim()).filter(Boolean)
              );
              const nextPrimaryOperatingUnitId = visibleIds.has(
                String(prev.primaryOperatingUnitId || "").trim()
              )
                ? String(prev.primaryOperatingUnitId || "").trim()
                : "";
              const nextOperatingUnitIds = Array.isArray(prev.operatingUnitIds)
                ? prev.operatingUnitIds
                    .map((value) => String(value || "").trim())
                    .filter((value) => value && visibleIds.has(value))
                : [];
              if (
                nextPrimaryOperatingUnitId &&
                !nextOperatingUnitIds.includes(nextPrimaryOperatingUnitId)
              ) {
                nextOperatingUnitIds.push(nextPrimaryOperatingUnitId);
              }
              const currentPrimaryOperatingUnitId = String(
                prev.primaryOperatingUnitId || ""
              ).trim();
              const currentOperatingUnitIds = Array.isArray(prev.operatingUnitIds)
                ? prev.operatingUnitIds.map((value) => String(value || "").trim()).filter(Boolean)
                : [];
              if (
                currentPrimaryOperatingUnitId === nextPrimaryOperatingUnitId &&
                currentOperatingUnitIds.length === nextOperatingUnitIds.length &&
                currentOperatingUnitIds.every(
                  (value, index) => value === nextOperatingUnitIds[index]
                )
              ) {
                return prev;
              }
              return {
                ...prev,
                primaryOperatingUnitId: nextPrimaryOperatingUnitId,
                operatingUnitIds: nextOperatingUnitIds,
              };
            });
          }
        },
        setLoading: (loading) => {
          if (!cancelled) {
            setCreateOperatingUnitsLoading(loading);
          }
        },
        setError: (error) => {
          if (!cancelled) {
            setCreateOperatingUnitsError(error);
          }
        },
      });
    }

    void loadCreateOperatingUnits();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreatePage, createForm.legalEntityId, canReadScopedOrgLookups]);

  useEffect(() => {
    let cancelled = false;
    async function loadEditPaymentTerms() {
      if (!editingId) {
        setEditPaymentTerms([]);
        setEditPaymentTermsError("");
        setEditPaymentTermsLoading(false);
        return;
      }

      await loadPaymentTermsForLegalEntity({
        legalEntityId: editingForm.legalEntityId,
        queryText: editPaymentTermLookupQuery,
        setRows: (rows) => {
          if (!cancelled) {
            setEditPaymentTerms(rows);
          }
        },
        setLoading: (loading) => {
          if (!cancelled) {
            setEditPaymentTermsLoading(loading);
          }
        },
        setError: (error) => {
          if (!cancelled) {
            setEditPaymentTermsError(error);
          }
        },
      });
    }

    loadEditPaymentTerms();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editingId,
    editingForm.legalEntityId,
    editPaymentTermLookupQuery,
    canReadPaymentTerms,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadEditAccounts() {
      if (!editingId) {
        setEditAccountOptions([]);
        setEditAccountsError("");
        setEditAccountsLoading(false);
        return;
      }

      await loadAccountsForLegalEntity({
        legalEntityId: editingForm.legalEntityId,
        queryText: "",
        setRows: (rows) => {
          if (!cancelled) {
            setEditAccountOptions(rows);
          }
        },
        setLoading: (loading) => {
          if (!cancelled) {
            setEditAccountsLoading(loading);
          }
        },
        setError: (error) => {
          if (!cancelled) {
            setEditAccountsError(error);
          }
        },
      });
    }

    const timer = setTimeout(() => {
      void loadEditAccounts();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editingId,
    editingForm.legalEntityId,
    accountPickerGates.shouldFetchGlAccounts,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadEditOperatingUnits() {
      if (!editingId) {
        setEditOperatingUnits([]);
        setEditOperatingUnitsError("");
        setEditOperatingUnitsLoading(false);
        return;
      }

      await loadOperatingUnitsForLegalEntity({
        legalEntityId: editingForm.legalEntityId,
        setRows: (rows) => {
          if (!cancelled) {
            setEditOperatingUnits(rows);
            setEditingForm((prev) => {
              const visibleIds = new Set(
                rows.map((row) => String(row?.id || "").trim()).filter(Boolean)
              );
              const nextPrimaryOperatingUnitId = visibleIds.has(
                String(prev.primaryOperatingUnitId || "").trim()
              )
                ? String(prev.primaryOperatingUnitId || "").trim()
                : "";
              const nextOperatingUnitIds = Array.isArray(prev.operatingUnitIds)
                ? prev.operatingUnitIds
                    .map((value) => String(value || "").trim())
                    .filter((value) => value && visibleIds.has(value))
                : [];
              if (
                nextPrimaryOperatingUnitId &&
                !nextOperatingUnitIds.includes(nextPrimaryOperatingUnitId)
              ) {
                nextOperatingUnitIds.push(nextPrimaryOperatingUnitId);
              }
              const currentPrimaryOperatingUnitId = String(
                prev.primaryOperatingUnitId || ""
              ).trim();
              const currentOperatingUnitIds = Array.isArray(prev.operatingUnitIds)
                ? prev.operatingUnitIds.map((value) => String(value || "").trim()).filter(Boolean)
                : [];
              if (
                currentPrimaryOperatingUnitId === nextPrimaryOperatingUnitId &&
                currentOperatingUnitIds.length === nextOperatingUnitIds.length &&
                currentOperatingUnitIds.every(
                  (value, index) => value === nextOperatingUnitIds[index]
                )
              ) {
                return prev;
              }
              return {
                ...prev,
                primaryOperatingUnitId: nextPrimaryOperatingUnitId,
                operatingUnitIds: nextOperatingUnitIds,
              };
            });
          }
        },
        setLoading: (loading) => {
          if (!cancelled) {
            setEditOperatingUnitsLoading(loading);
          }
        },
        setError: (error) => {
          if (!cancelled) {
            setEditOperatingUnitsError(error);
          }
        },
      });
    }

    void loadEditOperatingUnits();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, editingForm.legalEntityId, canReadScopedOrgLookups]);

  useEffect(() => {
    const selectedLegalEntityId = String(filters.legalEntityId || "").trim();
    const previousLegalEntityId = filterOperatingUnitLegalEntityRef.current;
    const legalEntityChanged =
      Boolean(previousLegalEntityId) && previousLegalEntityId !== selectedLegalEntityId;
    filterOperatingUnitLegalEntityRef.current = selectedLegalEntityId;

    if (!selectedLegalEntityId) {
      setFilterOperatingUnits([]);
      setFilterOperatingUnitsError("");
      setFilterOperatingUnitsLoading(false);
      setFilters((prev) => {
        if (!prev.primaryOperatingUnitId && !prev.allowedOperatingUnitId) {
          return prev;
        }
        return {
          ...prev,
          primaryOperatingUnitId: "",
          allowedOperatingUnitId: "",
        };
      });
      return;
    }

    if (!legalEntityChanged) {
      return;
    }

    setFilters((prev) => ({
      ...prev,
      primaryOperatingUnitId: "",
      allowedOperatingUnitId: "",
    }));
  }, [filters.legalEntityId]);

  useEffect(() => {
    let cancelled = false;
    async function loadFilterOperatingUnits() {
      if (!String(filters.legalEntityId || "").trim()) {
        setFilterOperatingUnits([]);
        setFilterOperatingUnitsError("");
        setFilterOperatingUnitsLoading(false);
        return;
      }

      await loadOperatingUnitsForLegalEntity({
        legalEntityId: filters.legalEntityId,
        setRows: (rows) => {
          if (!cancelled) {
            setFilterOperatingUnits(rows);
            setFilters((prev) => {
              const visibleIds = new Set(
                rows.map((row) => String(row?.id || "").trim()).filter(Boolean)
              );
              const nextPrimaryOperatingUnitId = visibleIds.has(
                String(prev.primaryOperatingUnitId || "").trim()
              )
                ? String(prev.primaryOperatingUnitId || "").trim()
                : "";
              const nextAllowedOperatingUnitId = visibleIds.has(
                String(prev.allowedOperatingUnitId || "").trim()
              )
                ? String(prev.allowedOperatingUnitId || "").trim()
                : "";
              if (
                String(prev.primaryOperatingUnitId || "").trim() === nextPrimaryOperatingUnitId &&
                String(prev.allowedOperatingUnitId || "").trim() === nextAllowedOperatingUnitId
              ) {
                return prev;
              }
              return {
                ...prev,
                primaryOperatingUnitId: nextPrimaryOperatingUnitId,
                allowedOperatingUnitId: nextAllowedOperatingUnitId,
              };
            });
          }
        },
        setLoading: (loading) => {
          if (!cancelled) {
            setFilterOperatingUnitsLoading(loading);
          }
        },
        setError: (error) => {
          if (!cancelled) {
            setFilterOperatingUnitsError(error);
          }
        },
      });
    }

    void loadFilterOperatingUnits();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.legalEntityId, canReadScopedOrgLookups]);

  async function loadCounterpartyRows(nextFilters = filters) {
    if (!canRead) {
      setRows([]);
      setTotalRows(0);
      return;
    }

    setListLoading(true);
    setListError("");
    try {
      const response = await listCariCounterparties(buildCounterpartyListParams(nextFilters));
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setTotalRows(Number(response?.total || 0));
    } catch (err) {
      setRows([]);
      setTotalRows(0);
      setListError(mapCounterpartyApiError(err, "Failed to load counterparties."));
    } finally {
      setListLoading(false);
    }
  }

  async function loadCounterpartyRequestRows(nextFilters = filters) {
    if (!canRequest && !canReviewRequests) {
      setRequestRows([]);
      setRequestTotalRows(0);
      setRequestError("");
      return;
    }

    const normalizedRole = normalizeFilterRole(nextFilters.role, config.roleDefault);
    setRequestLoading(true);
    setRequestError("");
    try {
      const response = await listCariCounterpartyRequests({
        legalEntityId: nextFilters.legalEntityId || undefined,
        primaryOperatingUnitId: nextFilters.primaryOperatingUnitId || undefined,
        role: normalizedRole || undefined,
        mineOnly: canReviewRequests ? undefined : true,
        limit: 50,
        offset: 0,
      });
      setRequestRows(Array.isArray(response?.rows) ? response.rows : []);
      setRequestTotalRows(Number(response?.total || 0));
    } catch (err) {
      setRequestRows([]);
      setRequestTotalRows(0);
      setRequestError(mapCounterpartyApiError(err, "Failed to load counterparty requests."));
    } finally {
      setRequestLoading(false);
    }
  }

  async function loadPaymentTermsForLegalEntity({
    legalEntityId,
    queryText,
    setRows,
    setLoading,
    setError,
  }) {
    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    if (!parsedLegalEntityId || !canReadPaymentTerms) {
      setRows([]);
      setError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const normalizedQuery = normalizeLookupQuery(queryText);
      const response = await listCariPaymentTerms({
        legalEntityId: parsedLegalEntityId,
        q: normalizedQuery || undefined,
        limit: 300,
        offset: 0,
      });
      setRows(mapPaymentTermRows(response));
    } catch (err) {
      setRows([]);
      setError(
        mapCounterpartyApiError(err, "Failed to load payment terms for selected legal entity.")
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadAccountsForLegalEntity({
    legalEntityId,
    queryText,
    setRows,
    setLoading,
    setError,
  }) {
    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    if (!parsedLegalEntityId || !accountPickerGates.shouldFetchGlAccounts) {
      setRows([]);
      setError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const normalizedQuery = normalizeLookupQuery(queryText);
      const response = await listAccounts({
        legalEntityId: parsedLegalEntityId,
        q: normalizedQuery || undefined,
        includeInactive: true,
        limit: 1000,
      });
      setRows(mapAccountRows(response));
    } catch (err) {
      setRows([]);
      setError(
        mapCounterpartyApiError(err, "Failed to load account options for selected legal entity.")
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadOperatingUnitsForLegalEntity({
    legalEntityId,
    setRows,
    setLoading,
    setError,
  }) {
    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    if (!parsedLegalEntityId) {
      setRows([]);
      setError("");
      setLoading(false);
      return;
    }
    if (!canReadScopedOrgLookups) {
      setRows([]);
      setError("Operating unit options are not available for this user.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await listOperatingUnits({
        legalEntityId: parsedLegalEntityId,
        includeInactive: true,
        limit: 500,
      });
      setRows(Array.isArray(response?.rows) ? response.rows : []);
    } catch (err) {
      setRows([]);
      setError(
        mapCounterpartyApiError(
          err,
          "Failed to load operating units for selected legal entity."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isListPage) {
      return;
    }
    const normalized = {
      ...filters,
      role: normalizeFilterRole(filters.role, config.roleDefault),
      sortBy: normalizeCounterpartyListSortBy(filters.sortBy, "id"),
      sortDir: normalizeCounterpartyListSortDir(filters.sortDir, "desc"),
    };
    loadCounterpartyRows(normalized);
    loadCounterpartyRequestRows(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListPage, config.roleDefault]);

  async function handleCreateSubmit(payload) {
    setCreateSaving(true);
    setCreateError("");
    setCreateMessage("");
    try {
      if (!canUpsert && canRequest) {
        const response = await createCariCounterpartyRequest(payload);
        const requestId = response?.row?.id;
        const approvalRequestCode = response?.row?.approvalRequest?.requestCode;
        setCreateMessage(
          `Counterparty request submitted for review. requestId=${requestId || "-"}${
            approvalRequestCode ? ` approvalRequest=${approvalRequestCode}` : ""
          }`
        );
      } else {
        const response = await createCariCounterparty(payload);
        const createdId = response?.row?.id;
        setCreateMessage(`Counterparty created successfully. id=${createdId || "-"}`);
      }
      setCreateForm((prev) => {
        const reset = buildInitialCounterpartyForm(config.roleDefault);
        return {
          ...reset,
          legalEntityId: prev.legalEntityId || reset.legalEntityId,
        };
      });
      setCreatePaymentTermLookupQuery("");
      setCreateInlinePaymentTermError("");
      setCreateInlinePaymentTermMessage("");
      setCreateArAccountLookupQuery("");
      setCreateApAccountLookupQuery("");
      setCreateInlineArParentAccountId("");
      setCreateInlineArChildCode("");
      setCreateInlineArChildName("");
      setCreateInlineApParentAccountId("");
      setCreateInlineApChildCode("");
      setCreateInlineApChildName("");
      setCreateInlineArAccountError("");
      setCreateInlineArAccountMessage("");
      setCreateInlineApAccountError("");
      setCreateInlineApAccountMessage("");
    } catch (err) {
      setCreateError(
        mapCounterpartyApiError(
          err,
          canUpsert ? "Failed to create counterparty." : "Failed to submit counterparty request."
        )
      );
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleStartEdit(counterpartyId) {
    if (!canUpsert) {
      return;
    }
    setEditPaymentTermLookupQuery("");
    setEditInlinePaymentTermSaving(false);
    setEditInlinePaymentTermError("");
    setEditInlinePaymentTermMessage("");
    setEditArAccountLookupQuery("");
    setEditApAccountLookupQuery("");
    setEditInlineArParentAccountId("");
    setEditInlineArChildCode("");
    setEditInlineArChildName("");
    setEditInlineApParentAccountId("");
    setEditInlineApChildCode("");
    setEditInlineApChildName("");
    setEditInlineArAccountSaving(false);
    setEditInlineArAccountError("");
    setEditInlineArAccountMessage("");
    setEditInlineApAccountSaving(false);
    setEditInlineApAccountError("");
    setEditInlineApAccountMessage("");
    setEditLoading(true);
    setEditError("");
    setEditMessage("");
    try {
      const response = await getCariCounterparty(counterpartyId);
      const row = response?.row || null;
      const nextForm = mapDetailToCounterpartyForm(row, config.roleDefault);
      setEditingId(counterpartyId);
      editPreviousLegalEntityIdRef.current = String(nextForm.legalEntityId || "").trim();
      setEditingForm(nextForm);
    } catch (err) {
      setEditingId(null);
      editPreviousLegalEntityIdRef.current = "";
      setEditError(mapCounterpartyApiError(err, "Failed to load counterparty detail."));
    } finally {
      setEditLoading(false);
    }
  }

  async function handleEditSubmit(payload) {
    if (!editingId) {
      return;
    }
    setEditSaving(true);
    setEditError("");
    setEditMessage("");
    try {
      await updateCariCounterparty(editingId, payload);
      setEditMessage("Counterparty updated.");
      await loadCounterpartyRows(filters);
    } catch (err) {
      setEditError(mapCounterpartyApiError(err, "Failed to update counterparty."));
    } finally {
      setEditSaving(false);
    }
  }

  function openRequestDrawer(requestId) {
    if (!requestId) {
      return;
    }
    const requestRow = requestRows.find((row) => Number(row.id) === Number(requestId)) || null;
    const approvalRequestId = toPositiveInt(requestRow?.approvalRequest?.id);
    dismissedApprovalRequestIdRef.current = null;
    setRequestError("");
    setRequestActionDialog(null);
    setActiveRequestId(requestId);
    if (approvalRequestId) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set("approvalRequestId", String(approvalRequestId));
      setSearchParams(nextSearchParams, { replace: true });
    }
  }

  const closeRequestDrawer = useCallback(() => {
    const activeApprovalRequestId =
      toPositiveInt(activeRequestRow?.approvalRequest?.id) ||
      toPositiveInt(searchParams.get("approvalRequestId"));
    dismissedApprovalRequestIdRef.current = activeApprovalRequestId;
    setActiveRequestId(null);
    setRequestActionDialog(null);
    setDelegationPreview(null);
    setDelegationPreviewLoading(false);
    if (searchParams.get("approvalRequestId")) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("approvalRequestId");
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [activeRequestRow, searchParams, setSearchParams]);

  const openRequestAction = useCallback((actionType, requestId) => {
    if (!requestId) {
      return;
    }
    const requestRow = requestRows.find((row) => Number(row.id) === Number(requestId)) || null;
    setRequestError("");
    setRequestActionDialog({
      actionType,
      requestId,
      approvalRequestId: toPositiveInt(requestRow?.approvalRequest?.id) || null,
    });
  }, [requestRows]);

  async function handleApproveRequest(
    requestId,
    decisionComment = "",
    approvalRequestId = null
  ) {
    if (!requestId) {
      return false;
    }
    const actionKey = `approve-${requestId}`;
    setRequestActionKey(actionKey);
    setRequestError("");
    setRequestMessage("");
    try {
      const response = approvalRequestId
        ? await approveUnifiedApprovalRequest(approvalRequestId, { decisionComment })
        : canReviewRequests
          ? await approveCariCounterpartyRequest(requestId, { decisionComment })
          : (() => {
              throw new Error("Missing permission: cari.request.review");
            })();
      const createdCounterpartyId = response?.counterparty?.id;
      setRequestMessage(
          `Request approved. counterpartyId=${createdCounterpartyId || "-"}`  
        );
      await loadCounterpartyRows(filters);
      await loadCounterpartyRequestRows(filters);
      return true;
    } catch (err) {
      setRequestError(mapCounterpartyApiError(err, "Failed to approve counterparty request."));
      return false;
    } finally {
      setRequestActionKey("");
    }
  }

  async function handleRejectRequest(
    requestId,
    decisionComment = "",
    approvalRequestId = null
  ) {
    if (!requestId) {
      return false;
    }
    const actionKey = `reject-${requestId}`;
    setRequestActionKey(actionKey);
    setRequestError("");
    setRequestMessage("");
    try {
      if (approvalRequestId) {
        await rejectUnifiedApprovalRequest(approvalRequestId, { decisionComment });
      } else if (canReviewRequests) {
        await rejectCariCounterpartyRequest(requestId, { decisionComment });
      } else {
        throw new Error("Missing permission: cari.request.review");
      }
      setRequestMessage("Request rejected.");
      await loadCounterpartyRequestRows(filters);
      return true;
    } catch (err) {
      setRequestError(mapCounterpartyApiError(err, "Failed to reject counterparty request."));
      return false;
    } finally {
      setRequestActionKey("");
    }
  }

  async function handleConfirmRequestAction(decisionComment) {
    if (!requestActionDialog?.requestId) {
      return;
    }
    const wasSuccessful =
      requestActionDialog.actionType === "APPROVE"
        ? await handleApproveRequest(
            requestActionDialog.requestId,
            decisionComment,
            requestActionDialog.approvalRequestId
          )
        : await handleRejectRequest(
            requestActionDialog.requestId,
            decisionComment,
            requestActionDialog.approvalRequestId
          );
    if (wasSuccessful) {
      setRequestActionDialog(null);
    }
  }

  function handleCreateAccountLookupInput(nextValue, meta = {}, direction = "AR") {
    const reason = String(meta?.reason || "").trim().toLowerCase();
    const targetDirection = String(direction || "AR").trim().toUpperCase();
    if (reason === "select" || reason === "clear") {
      if (targetDirection === "AP") {
        setCreateApAccountLookupQuery("");
        setCreateInlineApParentAccountId("");
        setCreateInlineApChildCode("");
        setCreateInlineApChildName("");
      } else {
        setCreateArAccountLookupQuery("");
        setCreateInlineArParentAccountId("");
        setCreateInlineArChildCode("");
        setCreateInlineArChildName("");
      }
      return;
    }
    setCreateInlineArAccountError("");
    setCreateInlineArAccountMessage("");
    setCreateInlineApAccountError("");
    setCreateInlineApAccountMessage("");
    const normalized = normalizeLookupQuery(nextValue);
    if (targetDirection === "AP") {
      setCreateApAccountLookupQuery(normalized);
      setCreateInlineApParentAccountId("");
      setCreateInlineApChildCode("");
      setCreateInlineApChildName(normalized);
    } else {
      setCreateArAccountLookupQuery(normalized);
      setCreateInlineArParentAccountId("");
      setCreateInlineArChildCode("");
      setCreateInlineArChildName(normalized);
    }
  }

  function handleCreatePaymentTermLookupInput(nextValue, meta = {}) {
    const reason = String(meta?.reason || "").trim().toLowerCase();
    if (reason === "select" || reason === "clear") {
      setCreatePaymentTermLookupQuery("");
      return;
    }
    setCreateInlinePaymentTermError("");
    setCreateInlinePaymentTermMessage("");
    setCreatePaymentTermLookupQuery(normalizeLookupQuery(nextValue));
  }

  function handleEditAccountLookupInput(nextValue, meta = {}, direction = "AR") {
    const reason = String(meta?.reason || "").trim().toLowerCase();
    const targetDirection = String(direction || "AR").trim().toUpperCase();
    if (reason === "select" || reason === "clear") {
      if (targetDirection === "AP") {
        setEditApAccountLookupQuery("");
        setEditInlineApParentAccountId("");
        setEditInlineApChildCode("");
        setEditInlineApChildName("");
      } else {
        setEditArAccountLookupQuery("");
        setEditInlineArParentAccountId("");
        setEditInlineArChildCode("");
        setEditInlineArChildName("");
      }
      return;
    }
    setEditInlineArAccountError("");
    setEditInlineArAccountMessage("");
    setEditInlineApAccountError("");
    setEditInlineApAccountMessage("");
    const normalized = normalizeLookupQuery(nextValue);
    if (targetDirection === "AP") {
      setEditApAccountLookupQuery(normalized);
      setEditInlineApParentAccountId("");
      setEditInlineApChildCode("");
      setEditInlineApChildName(normalized);
    } else {
      setEditArAccountLookupQuery(normalized);
      setEditInlineArParentAccountId("");
      setEditInlineArChildCode("");
      setEditInlineArChildName(normalized);
    }
  }

  function handleEditPaymentTermLookupInput(nextValue, meta = {}) {
    const reason = String(meta?.reason || "").trim().toLowerCase();
    if (reason === "select" || reason === "clear") {
      setEditPaymentTermLookupQuery("");
      return;
    }
    setEditInlinePaymentTermError("");
    setEditInlinePaymentTermMessage("");
    setEditPaymentTermLookupQuery(normalizeLookupQuery(nextValue));
  }

  async function runInlinePaymentTermCreate({
    legalEntityId,
    lookupName,
    setSaving,
    setError,
    setMessage,
    setLookupQuery,
    setForm,
    setOptions,
  }) {
    if (!canUpsert) {
      return;
    }

    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    const normalizedName = normalizeLookupQuery(lookupName);
    if (!parsedLegalEntityId) {
      setError("Select legal entity first.");
      return;
    }
    if (!normalizedName) {
      setError("Type payment term name first.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await createCariPaymentTerm({
        legalEntityId: parsedLegalEntityId,
        code: buildInlinePaymentTermCode({
          legalEntityId: parsedLegalEntityId,
          name: normalizedName,
        }),
        name: normalizedName,
        dueDays: 0,
        graceDays: 0,
        isEndOfMonth: false,
        status: "ACTIVE",
      });
      const createdRows = mapPaymentTermRows({ rows: [response?.row || null] });
      const createdRow = createdRows[0] || null;
      if (!createdRow?.id) {
        throw new Error("Payment term create response missing row id.");
      }
      setOptions((prev) => prependOrReplacePaymentTermOption(prev, createdRow));
      setForm((prev) => ({
        ...prev,
        defaultPaymentTermId: String(createdRow.id),
      }));
      setLookupQuery("");
      setMessage(`Payment term created: ${createdRow.code || "-"} - ${createdRow.name || "-"}`);
    } catch (err) {
      setError(mapCounterpartyApiError(err, "Failed to create payment term."));
    } finally {
      setSaving(false);
    }
  }

  async function runInlineControlAccountCreate({
    legalEntityId,
    lookupName,
    direction,
    parentAccountIdValue = "",
    childCodeValue = "",
    childNameValue = "",
    setSaving,
    setError,
    setMessage,
    setLookupQuery,
    setForm,
    setOptions,
    clearInlinePanel,
  }) {
    if (!accountPickerGates.canUpsertGlAccounts) {
      setError("Missing permission: gl.account.upsert");
      return;
    }

    const parsedLegalEntityId = toPositiveInt(legalEntityId);
    const normalizedLookupName = normalizeLookupQuery(lookupName);
    const normalizedName = normalizeLookupQuery(childNameValue) || normalizedLookupName;
    const requestedCode = normalizeAccountCode(
      childCodeValue || deriveSearchCodeCandidate(lookupName)
    );
    if (!parsedLegalEntityId) {
      setError("Select legal entity first.");
      return;
    }
    if (!normalizedName) {
      setError("Type account name first.");
      return;
    }

    const spec = resolveInlineControlAccountSpec(direction);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const fullAccountResponse = await listAccounts({
        legalEntityId: parsedLegalEntityId,
        includeInactive: true,
        limit: 1000,
        offset: 0,
      });
      const fullAccountRows = mapAccountRows(fullAccountResponse);
      if (requestedCode) {
        const exactExisting = findExactInlineCodeMatch(
          fullAccountRows,
          requestedCode,
          spec.accountType
        );
        if (exactExisting) {
          const exactExistingId = toPositiveInt(exactExisting.id);
          setForm((prev) => ({
            ...prev,
            [spec.fieldName]: String(exactExistingId),
          }));
          setLookupQuery("");
          setOptions((prevRows) => {
            const nextRows = Array.isArray(prevRows) ? [...prevRows] : [];
            const alreadyInRows = nextRows.some(
              (row) => toPositiveInt(row?.id) === exactExistingId
            );
            return alreadyInRows ? nextRows : [exactExisting, ...nextRows];
          });
          setMessage(
            `${spec.direction} account selected: ${exactExisting.code || "-"} - ${exactExisting.name || "-"}`
          );
          return;
        }
      }

      const selectedParentId = toPositiveInt(parentAccountIdValue);
      const parentAccountOptions = buildInlineParentAccountOptions(
        fullAccountRows,
        spec.accountType
      );

      let parentAccount =
        parentAccountOptions.find(
          (row) => toPositiveInt(row?.id) === selectedParentId
        ) || null;
      if (!parentAccount && requestedCode) {
        parentAccount = findBestParentAccount(requestedCode, parentAccountOptions);
      }
      if (!parentAccount) {
        parentAccount =
          selectInlineControlParentAccount(parentAccountOptions, spec) ||
          selectInlineControlParentAccount(fullAccountRows, spec);
      }
      if (!parentAccount) {
        throw new Error(
          `${spec.controlCode} control parent not found for ${spec.direction}.`
        );
      }

      const coaId = toPositiveInt(parentAccount?.coaId);
      if (!coaId) {
        throw new Error("Unable to resolve coaId for selected parent account.");
      }

      let nextCode = requestedCode;
      if (!nextCode) {
        nextCode = buildNextInlineChildCode(fullAccountRows, parentAccount);
      }
      if (!nextCode) {
        throw new Error("Unable to generate next child account code.");
      }
      const parentCode = normalizeAccountCode(parentAccount?.code);
      if (parentCode && nextCode === parentCode) {
        throw new Error("Child account code must differ from parent account code.");
      }

      const upsertResponse = await upsertAccount({
        coaId,
        code: nextCode,
        name: normalizedName,
        accountType: spec.accountType,
        normalSide: parentAccount?.normalSide || spec.normalSide,
        allowPosting: true,
        parentAccountId: toPositiveInt(parentAccount?.id) || undefined,
      });

      const refreshedResponse = await listAccounts({
        legalEntityId: parsedLegalEntityId,
        includeInactive: true,
        limit: 1000,
        offset: 0,
      });
      const refreshedRows = mapAccountRows(refreshedResponse);
      setOptions(refreshedRows);

      const createdRow =
        refreshedRows.find(
          (row) =>
            normalizeAccountCode(row?.code) === nextCode &&
            normalizeAccountCode(row?.accountType) === spec.accountType &&
            toPositiveInt(row?.id)
        ) || null;
      const createdAccountId =
        toPositiveInt(upsertResponse?.id) ||
        toPositiveInt(upsertResponse?.row?.id) ||
        toPositiveInt(createdRow?.id);
      if (!createdAccountId) {
        throw new Error("Account create response missing id.");
      }

      setForm((prev) => ({
        ...prev,
        [spec.fieldName]: String(createdAccountId),
      }));
      setLookupQuery("");
      clearInlinePanel?.();

      setMessage(
        `${spec.direction} sub-account created: ${nextCode} - ${normalizedName} (parent ${parentAccount.code || "-"})`
      );
    } catch (err) {
      setError(
        mapCounterpartyApiError(
          err,
          `Failed to create ${spec.direction} sub-account.`
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleInlineCreateArAccountForCreateForm() {
    await runInlineControlAccountCreate({
      legalEntityId: createForm.legalEntityId,
      lookupName: createArAccountLookupQuery,
      direction: "AR",
      parentAccountIdValue: createInlineArParentAccountId,
      childCodeValue: createInlineArChildCode,
      childNameValue: createInlineArChildName,
      setSaving: setCreateInlineArAccountSaving,
      setError: setCreateInlineArAccountError,
      setMessage: setCreateInlineArAccountMessage,
      setLookupQuery: setCreateArAccountLookupQuery,
      setForm: setCreateForm,
      setOptions: setCreateAccountOptions,
      clearInlinePanel: () => {
        setCreateInlineArParentAccountId("");
        setCreateInlineArChildCode("");
        setCreateInlineArChildName("");
      },
    });
  }

  async function handleInlineCreateApAccountForCreateForm() {
    await runInlineControlAccountCreate({
      legalEntityId: createForm.legalEntityId,
      lookupName: createApAccountLookupQuery,
      direction: "AP",
      parentAccountIdValue: createInlineApParentAccountId,
      childCodeValue: createInlineApChildCode,
      childNameValue: createInlineApChildName,
      setSaving: setCreateInlineApAccountSaving,
      setError: setCreateInlineApAccountError,
      setMessage: setCreateInlineApAccountMessage,
      setLookupQuery: setCreateApAccountLookupQuery,
      setForm: setCreateForm,
      setOptions: setCreateAccountOptions,
      clearInlinePanel: () => {
        setCreateInlineApParentAccountId("");
        setCreateInlineApChildCode("");
        setCreateInlineApChildName("");
      },
    });
  }

  async function handleInlineCreateArAccountForEditForm() {
    await runInlineControlAccountCreate({
      legalEntityId: editingForm.legalEntityId,
      lookupName: editArAccountLookupQuery,
      direction: "AR",
      parentAccountIdValue: editInlineArParentAccountId,
      childCodeValue: editInlineArChildCode,
      childNameValue: editInlineArChildName,
      setSaving: setEditInlineArAccountSaving,
      setError: setEditInlineArAccountError,
      setMessage: setEditInlineArAccountMessage,
      setLookupQuery: setEditArAccountLookupQuery,
      setForm: setEditingForm,
      setOptions: setEditAccountOptions,
      clearInlinePanel: () => {
        setEditInlineArParentAccountId("");
        setEditInlineArChildCode("");
        setEditInlineArChildName("");
      },
    });
  }

  async function handleInlineCreateApAccountForEditForm() {
    await runInlineControlAccountCreate({
      legalEntityId: editingForm.legalEntityId,
      lookupName: editApAccountLookupQuery,
      direction: "AP",
      parentAccountIdValue: editInlineApParentAccountId,
      childCodeValue: editInlineApChildCode,
      childNameValue: editInlineApChildName,
      setSaving: setEditInlineApAccountSaving,
      setError: setEditInlineApAccountError,
      setMessage: setEditInlineApAccountMessage,
      setLookupQuery: setEditApAccountLookupQuery,
      setForm: setEditingForm,
      setOptions: setEditAccountOptions,
      clearInlinePanel: () => {
        setEditInlineApParentAccountId("");
        setEditInlineApChildCode("");
        setEditInlineApChildName("");
      },
    });
  }

  async function handleInlineCreatePaymentTermForCreateForm() {
    await runInlinePaymentTermCreate({
      legalEntityId: createForm.legalEntityId,
      lookupName: createPaymentTermLookupQuery,
      setSaving: setCreateInlinePaymentTermSaving,
      setError: setCreateInlinePaymentTermError,
      setMessage: setCreateInlinePaymentTermMessage,
      setLookupQuery: setCreatePaymentTermLookupQuery,
      setForm: setCreateForm,
      setOptions: setCreatePaymentTerms,
    });
  }

  async function handleInlineCreatePaymentTermForEditForm() {
    await runInlinePaymentTermCreate({
      legalEntityId: editingForm.legalEntityId,
      lookupName: editPaymentTermLookupQuery,
      setSaving: setEditInlinePaymentTermSaving,
      setError: setEditInlinePaymentTermError,
      setMessage: setEditInlinePaymentTermMessage,
      setLookupQuery: setEditPaymentTermLookupQuery,
      setForm: setEditingForm,
      setOptions: setEditPaymentTerms,
    });
  }

  const createInlinePaymentTermName = normalizeLookupQuery(createPaymentTermLookupQuery);
  const editInlinePaymentTermName = normalizeLookupQuery(editPaymentTermLookupQuery);
  const createInlineArAccountName = normalizeLookupQuery(createArAccountLookupQuery);
  const createInlineApAccountName = normalizeLookupQuery(createApAccountLookupQuery);
  const editInlineArAccountName = normalizeLookupQuery(editArAccountLookupQuery);
  const editInlineApAccountName = normalizeLookupQuery(editApAccountLookupQuery);
  const createArCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(createArAccountLookupQuery),
    [createArAccountLookupQuery]
  );
  const createApCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(createApAccountLookupQuery),
    [createApAccountLookupQuery]
  );
  const editArCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(editArAccountLookupQuery),
    [editArAccountLookupQuery]
  );
  const editApCodeCandidate = useMemo(
    () => deriveSearchCodeCandidate(editApAccountLookupQuery),
    [editApAccountLookupQuery]
  );
  const createArParentAccountOptions = useMemo(
    () => buildInlineParentAccountOptions(createAccountOptions, "ASSET"),
    [createAccountOptions]
  );
  const createApParentAccountOptions = useMemo(
    () => buildInlineParentAccountOptions(createAccountOptions, "LIABILITY"),
    [createAccountOptions]
  );
  const editArParentAccountOptions = useMemo(
    () => buildInlineParentAccountOptions(editAccountOptions, "ASSET"),
    [editAccountOptions]
  );
  const editApParentAccountOptions = useMemo(
    () => buildInlineParentAccountOptions(editAccountOptions, "LIABILITY"),
    [editAccountOptions]
  );
  const createArExactCodeMatch = useMemo(
    () => findExactInlineCodeMatch(createAccountOptions, createArCodeCandidate, "ASSET"),
    [createAccountOptions, createArCodeCandidate]
  );
  const createApExactCodeMatch = useMemo(
    () => findExactInlineCodeMatch(createAccountOptions, createApCodeCandidate, "LIABILITY"),
    [createAccountOptions, createApCodeCandidate]
  );
  const editArExactCodeMatch = useMemo(
    () => findExactInlineCodeMatch(editAccountOptions, editArCodeCandidate, "ASSET"),
    [editAccountOptions, editArCodeCandidate]
  );
  const editApExactCodeMatch = useMemo(
    () => findExactInlineCodeMatch(editAccountOptions, editApCodeCandidate, "LIABILITY"),
    [editAccountOptions, editApCodeCandidate]
  );
  const showInlineCreateArAccountPanelInCreateForm =
    Boolean(toPositiveInt(createForm.legalEntityId)) &&
    Boolean(createForm.isCustomer) &&
    Boolean(createInlineArAccountName) &&
    !(Boolean(createArCodeCandidate) && Boolean(createArExactCodeMatch));
  const showInlineCreateApAccountPanelInCreateForm =
    Boolean(toPositiveInt(createForm.legalEntityId)) &&
    Boolean(createForm.isVendor) &&
    Boolean(createInlineApAccountName) &&
    !(Boolean(createApCodeCandidate) && Boolean(createApExactCodeMatch));
  const showInlineCreateArAccountPanelInEditForm =
    Boolean(editingId) &&
    Boolean(toPositiveInt(editingForm.legalEntityId)) &&
    Boolean(editingForm.isCustomer) &&
    Boolean(editInlineArAccountName) &&
    !(Boolean(editArCodeCandidate) && Boolean(editArExactCodeMatch));
  const showInlineCreateApAccountPanelInEditForm =
    Boolean(editingId) &&
    Boolean(toPositiveInt(editingForm.legalEntityId)) &&
    Boolean(editingForm.isVendor) &&
    Boolean(editInlineApAccountName) &&
    !(Boolean(editApCodeCandidate) && Boolean(editApExactCodeMatch));
  const selectedCreateArInlineParentAccount = useMemo(
    () =>
      createArParentAccountOptions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(createInlineArParentAccountId)
      ) || null,
    [createArParentAccountOptions, createInlineArParentAccountId]
  );
  const selectedCreateApInlineParentAccount = useMemo(
    () =>
      createApParentAccountOptions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(createInlineApParentAccountId)
      ) || null,
    [createApParentAccountOptions, createInlineApParentAccountId]
  );
  const selectedEditArInlineParentAccount = useMemo(
    () =>
      editArParentAccountOptions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(editInlineArParentAccountId)
      ) || null,
    [editArParentAccountOptions, editInlineArParentAccountId]
  );
  const selectedEditApInlineParentAccount = useMemo(
    () =>
      editApParentAccountOptions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(editInlineApParentAccountId)
      ) || null,
    [editApParentAccountOptions, editInlineApParentAccountId]
  );
  const createArSuggestedNextCode = useMemo(
    () => buildNextInlineChildCode(createAccountOptions, selectedCreateArInlineParentAccount),
    [createAccountOptions, selectedCreateArInlineParentAccount]
  );
  const createApSuggestedNextCode = useMemo(
    () => buildNextInlineChildCode(createAccountOptions, selectedCreateApInlineParentAccount),
    [createAccountOptions, selectedCreateApInlineParentAccount]
  );
  const editArSuggestedNextCode = useMemo(
    () => buildNextInlineChildCode(editAccountOptions, selectedEditArInlineParentAccount),
    [editAccountOptions, selectedEditArInlineParentAccount]
  );
  const editApSuggestedNextCode = useMemo(
    () => buildNextInlineChildCode(editAccountOptions, selectedEditApInlineParentAccount),
    [editAccountOptions, selectedEditApInlineParentAccount]
  );

  useEffect(() => {
    if (!showInlineCreateArAccountPanelInCreateForm) {
      return;
    }
    setCreateInlineArChildCode((prev) => prev || createArCodeCandidate);
    setCreateInlineArChildName(
      (prev) => prev || String(createInlineArAccountName || createForm.name || "").trim()
    );
  }, [
    showInlineCreateArAccountPanelInCreateForm,
    createArCodeCandidate,
    createInlineArAccountName,
    createForm.name,
  ]);
  useEffect(() => {
    if (!showInlineCreateArAccountPanelInCreateForm || !createArSuggestedNextCode) {
      return;
    }
    setCreateInlineArChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(createArCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return createArSuggestedNextCode;
      }
      return prev;
    });
  }, [
    showInlineCreateArAccountPanelInCreateForm,
    createArSuggestedNextCode,
    createArCodeCandidate,
  ]);

  useEffect(() => {
    if (!showInlineCreateApAccountPanelInCreateForm) {
      return;
    }
    setCreateInlineApChildCode((prev) => prev || createApCodeCandidate);
    setCreateInlineApChildName(
      (prev) => prev || String(createInlineApAccountName || createForm.name || "").trim()
    );
  }, [
    showInlineCreateApAccountPanelInCreateForm,
    createApCodeCandidate,
    createInlineApAccountName,
    createForm.name,
  ]);
  useEffect(() => {
    if (!showInlineCreateApAccountPanelInCreateForm || !createApSuggestedNextCode) {
      return;
    }
    setCreateInlineApChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(createApCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return createApSuggestedNextCode;
      }
      return prev;
    });
  }, [
    showInlineCreateApAccountPanelInCreateForm,
    createApSuggestedNextCode,
    createApCodeCandidate,
  ]);

  useEffect(() => {
    if (!showInlineCreateArAccountPanelInEditForm) {
      return;
    }
    setEditInlineArChildCode((prev) => prev || editArCodeCandidate);
    setEditInlineArChildName(
      (prev) => prev || String(editInlineArAccountName || editingForm.name || "").trim()
    );
  }, [
    showInlineCreateArAccountPanelInEditForm,
    editArCodeCandidate,
    editInlineArAccountName,
    editingForm.name,
  ]);
  useEffect(() => {
    if (!showInlineCreateArAccountPanelInEditForm || !editArSuggestedNextCode) {
      return;
    }
    setEditInlineArChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(editArCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return editArSuggestedNextCode;
      }
      return prev;
    });
  }, [
    showInlineCreateArAccountPanelInEditForm,
    editArSuggestedNextCode,
    editArCodeCandidate,
  ]);

  useEffect(() => {
    if (!showInlineCreateApAccountPanelInEditForm) {
      return;
    }
    setEditInlineApChildCode((prev) => prev || editApCodeCandidate);
    setEditInlineApChildName(
      (prev) => prev || String(editInlineApAccountName || editingForm.name || "").trim()
    );
  }, [
    showInlineCreateApAccountPanelInEditForm,
    editApCodeCandidate,
    editInlineApAccountName,
    editingForm.name,
  ]);
  useEffect(() => {
    if (!showInlineCreateApAccountPanelInEditForm || !editApSuggestedNextCode) {
      return;
    }
    setEditInlineApChildCode((prev) => {
      const normalizedPrev = normalizeAccountCode(prev);
      const normalizedCandidate = normalizeAccountCode(editApCodeCandidate);
      if (!normalizedPrev || normalizedPrev === normalizedCandidate) {
        return editApSuggestedNextCode;
      }
      return prev;
    });
  }, [
    showInlineCreateApAccountPanelInEditForm,
    editApSuggestedNextCode,
    editApCodeCandidate,
  ]);

  useEffect(() => {
    if (
      !showInlineCreateArAccountPanelInCreateForm ||
      toPositiveInt(createInlineArParentAccountId)
    ) {
      return;
    }
    const candidateCode = normalizeAccountCode(createInlineArChildCode || createArCodeCandidate);
    const bestParent =
      findBestParentAccount(candidateCode, createArParentAccountOptions) ||
      selectInlineControlParentAccount(
        createArParentAccountOptions,
        resolveInlineControlAccountSpec("AR")
      );
    if (toPositiveInt(bestParent?.id)) {
      setCreateInlineArParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineCreateArAccountPanelInCreateForm,
    createInlineArParentAccountId,
    createInlineArChildCode,
    createArCodeCandidate,
    createArParentAccountOptions,
  ]);

  useEffect(() => {
    if (
      !showInlineCreateApAccountPanelInCreateForm ||
      toPositiveInt(createInlineApParentAccountId)
    ) {
      return;
    }
    const candidateCode = normalizeAccountCode(createInlineApChildCode || createApCodeCandidate);
    const bestParent =
      findBestParentAccount(candidateCode, createApParentAccountOptions) ||
      selectInlineControlParentAccount(
        createApParentAccountOptions,
        resolveInlineControlAccountSpec("AP")
      );
    if (toPositiveInt(bestParent?.id)) {
      setCreateInlineApParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineCreateApAccountPanelInCreateForm,
    createInlineApParentAccountId,
    createInlineApChildCode,
    createApCodeCandidate,
    createApParentAccountOptions,
  ]);

  useEffect(() => {
    if (!showInlineCreateArAccountPanelInEditForm || toPositiveInt(editInlineArParentAccountId)) {
      return;
    }
    const candidateCode = normalizeAccountCode(editInlineArChildCode || editArCodeCandidate);
    const bestParent =
      findBestParentAccount(candidateCode, editArParentAccountOptions) ||
      selectInlineControlParentAccount(
        editArParentAccountOptions,
        resolveInlineControlAccountSpec("AR")
      );
    if (toPositiveInt(bestParent?.id)) {
      setEditInlineArParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineCreateArAccountPanelInEditForm,
    editInlineArParentAccountId,
    editInlineArChildCode,
    editArCodeCandidate,
    editArParentAccountOptions,
  ]);

  useEffect(() => {
    if (!showInlineCreateApAccountPanelInEditForm || toPositiveInt(editInlineApParentAccountId)) {
      return;
    }
    const candidateCode = normalizeAccountCode(editInlineApChildCode || editApCodeCandidate);
    const bestParent =
      findBestParentAccount(candidateCode, editApParentAccountOptions) ||
      selectInlineControlParentAccount(
        editApParentAccountOptions,
        resolveInlineControlAccountSpec("AP")
      );
    if (toPositiveInt(bestParent?.id)) {
      setEditInlineApParentAccountId(String(bestParent.id));
    }
  }, [
    showInlineCreateApAccountPanelInEditForm,
    editInlineApParentAccountId,
    editInlineApChildCode,
    editApCodeCandidate,
    editApParentAccountOptions,
  ]);

  const canInlineCreatePaymentTermInCreateForm =
    canUpsert &&
    Boolean(toPositiveInt(createForm.legalEntityId)) &&
    Boolean(createInlinePaymentTermName);
  const canInlineCreatePaymentTermInEditForm =
    canUpsert &&
    Boolean(editingId) &&
    Boolean(toPositiveInt(editingForm.legalEntityId)) &&
    Boolean(editInlinePaymentTermName);
  const canInlineCreateArAccountInCreateForm =
    canUpsert &&
    accountPickerGates.canUpsertGlAccounts &&
    Boolean(toPositiveInt(createForm.legalEntityId)) &&
    Boolean(createForm.isCustomer) &&
    Boolean(createInlineArAccountName) &&
    !(Boolean(createArCodeCandidate) && Boolean(createArExactCodeMatch));
  const canInlineCreateApAccountInCreateForm =
    canUpsert &&
    accountPickerGates.canUpsertGlAccounts &&
    Boolean(toPositiveInt(createForm.legalEntityId)) &&
    Boolean(createForm.isVendor) &&
    Boolean(createInlineApAccountName) &&
    !(Boolean(createApCodeCandidate) && Boolean(createApExactCodeMatch));
  const canInlineCreateArAccountInEditForm =
    canUpsert &&
    accountPickerGates.canUpsertGlAccounts &&
    Boolean(editingId) &&
    Boolean(toPositiveInt(editingForm.legalEntityId)) &&
    Boolean(editingForm.isCustomer) &&
    Boolean(editInlineArAccountName) &&
    !(Boolean(editArCodeCandidate) && Boolean(editArExactCodeMatch));
  const canInlineCreateApAccountInEditForm =
    canUpsert &&
    accountPickerGates.canUpsertGlAccounts &&
    Boolean(editingId) &&
    Boolean(toPositiveInt(editingForm.legalEntityId)) &&
    Boolean(editingForm.isVendor) &&
    Boolean(editInlineApAccountName) &&
    !(Boolean(editApCodeCandidate) && Boolean(editApExactCodeMatch));

  const activeRequestTimelineItems = useMemo(
    () => buildApprovalTimelineItems(activeRequestRow),
    [activeRequestRow]
  );
  const activeRequestStatusNotice = useMemo(
    () => buildRequestStatusNotice(activeRequestRow),
    [activeRequestRow]
  );
  const activeDrawerDelegationNotice = useMemo(
    () => buildApprovalDelegationDrawerNotice(delegationPreview),
    [delegationPreview]
  );
  const activeActionDelegationNotice = useMemo(
    () =>
      buildApprovalDelegationActionNotice(
        delegationPreview,
        requestActionDialog?.actionType === "REJECT" ? "Reject" : "Approve"
      ),
    [delegationPreview, requestActionDialog]
  );

  const activeRequestSummaryItems = useMemo(() => {
    if (!activeRequestRow) {
      return [];
    }
    const approvalRequest = activeRequestRow.approvalRequest || null;
    const reviewScopeLabel = formatApprovalScopeLabel(
      activeRequestRow,
      legalEntityById,
      operatingUnitById
    );
    return [
      {
        key: "requested-card",
        label: "Requested Card",
        value: `${activeRequestRow.code || "-"} - ${activeRequestRow.name || "-"}`,
        helperText: activeRequestRow.requestRole || "",
      },
      {
        key: "requester",
        label: "Requester",
        value: activeRequestRow.requestedByUserName || activeRequestRow.requestedByUserId || "-",
        helperText: `Submitted ${formatDateTimeLabel(
          approvalRequest?.submittedAt || activeRequestRow.createdAt
        )}`,
      },
      {
        key: "review-scope",
        label: "Review Scope",
        value: reviewScopeLabel,
        helperText:
          approvalRequest?.currentStepNo != null
            ? `Current step ${approvalRequest.currentStepNo}`
            : "Legacy request flow",
      },
      {
        key: "reviewer",
        label: "Latest Reviewer",
        value: activeRequestRow.decidedByUserName || activeRequestRow.decidedByUserId || "Pending",
        helperText: activeRequestRow.decidedAt
          ? `Decision recorded ${formatDateTimeLabel(activeRequestRow.decidedAt)}`
          : "No final decision recorded yet",
      },
      {
        key: "live-card",
        label: "Live Card",
        value:
          activeRequestRow.createdCounterpartyCode ||
          activeRequestRow.createdCounterpartyId ||
          "Not created yet",
        helperText: activeRequestRow.createdCounterpartyName || "",
      },
      {
        key: "review-result",
        label: "Review Outcome",
        value: buildRequestDecisionSummary(activeRequestRow),
        helperText: approvalRequest?.requestCode || `Request #${activeRequestRow.id}`,
      },
    ];
  }, [activeRequestRow, legalEntityById, operatingUnitById]);

  const activeRequestActions = useMemo(() => {
    if (!activeRequestRow || (!canReviewRequests && !canRequest)) {
      return [];
    }
    const reviewStatus = toUpperText(
      activeRequestRow.approvalRequest?.requestStatus || activeRequestRow.requestStatus
    );
    const isReviewable = ["PENDING", "PENDING_REVIEW", "ESCALATED"].includes(reviewStatus);
    const isRequester =
      Number(user?.id || 0) > 0 &&
      Number(user?.id || 0) === Number(activeRequestRow.requestedByUserId || 0);
    const approveBusy = requestActionKey === `approve-${activeRequestRow.id}`;
    const rejectBusy = requestActionKey === `reject-${activeRequestRow.id}`;
    const canResolveDecision = canReviewRequests || canUseDelegatedDecision(delegationPreview);

    return [
      {
        key: "approve",
        label: "Approve",
        tone: "approve",
        busy: approveBusy,
        busyLabel: "Approving...",
        disabled: !canResolveDecision || !isReviewable || Boolean(requestActionKey),
        description: !canResolveDecision
          ? "Missing permission: cari.request.review"
          : !isReviewable
            ? "Only pending or escalated review requests can be approved."
            : canUseDelegatedDecision(delegationPreview) &&
              !canReviewRequests &&
              activeActionDelegationNotice?.description
              ? activeActionDelegationNotice.description
            : reviewStatus === "ESCALATED"
              ? "Escalated requests stay actionable in the normal review queue."
              : "Record an approval decision at the request scope.",
        onClick: () => openRequestAction("APPROVE", activeRequestRow.id),
      },
      {
        key: "reject",
        label: "Reject",
        tone: "reject",
        busy: rejectBusy,
        busyLabel: "Rejecting...",
        disabled: !canResolveDecision || !isReviewable || Boolean(requestActionKey),
        description: !canResolveDecision
          ? "Missing permission: cari.request.review"
          : !isReviewable
            ? "Only pending or escalated review requests can be rejected."
            : canUseDelegatedDecision(delegationPreview) &&
              !canReviewRequests &&
              activeActionDelegationNotice?.description
              ? activeActionDelegationNotice.description
            : reviewStatus === "ESCALATED"
              ? "Escalated requests stay actionable in the normal review queue."
              : "Reject the request with an optional review comment.",
        onClick: () => openRequestAction("REJECT", activeRequestRow.id),
      },
      {
        key: "return",
        label: "Return for Revision",
        tone: "return",
        disabled: true,
        description:
          "Return routing is planned for the shared approval UX, but the CARI pilot does not expose that endpoint yet.",
        onClick: undefined,
      },
      {
        key: "withdraw",
        label: "Withdraw",
        tone: "withdraw",
        disabled: true,
        description: isRequester
          ? "Withdraw is planned for the shared approval UX, but the CARI pilot does not expose that endpoint yet."
          : "Only the original requester should withdraw, and the CARI pilot does not expose that endpoint yet.",
        onClick: undefined,
      },
    ];
  }, [
    activeActionDelegationNotice,
    activeRequestRow,
    canRequest,
    canReviewRequests,
    delegationPreview,
    openRequestAction,
    requestActionKey,
    user,
  ]);

  function renderCreatePage() {
    const requestMode = isRequestCreateMode;
    const hasScopedWorkingLegalEntity =
      requestMode && !canReadOrgTree && Boolean(workingContext.legalEntityId);
    const createLegalEntityId = String(
      createForm.legalEntityId || workingContext.legalEntityId || ""
    ).trim();
    const lockedCreateLegalEntityLabel = hasScopedWorkingLegalEntity
      ? formatLegalEntityLabel(legalEntityById.get(createLegalEntityId), createLegalEntityId)
      : "";
    const createLegalEntitiesError =
      !canReadOrgTree && requestMode && !createLegalEntityId
        ? "Select the working legal entity from the company/period bar first."
        : legalEntitiesError;
    const createTitle = requestMode
      ? config.roleDefault === "VENDOR"
        ? "Tedarikci Karti Talebi"
        : "Musteri Karti Talebi"
      : config.title;
    const createDescription = requestMode
      ? "Yeni kart talebini gonderin. Kapsam icindeki inceleme yetkilisi talebi inceler; canli kart duzenleme yetkisi ayri kalir."
      : config.subtitle;
    return (
      <CounterpartyForm
        title={createTitle}
        description={createDescription}
        mode="create"
        form={createForm}
        setForm={setCreateForm}
        legalEntities={legalEntities}
        legalEntitiesLoading={legalEntitiesLoading}
        legalEntitiesError={createLegalEntitiesError}
        lockLegalEntitySelection={hasScopedWorkingLegalEntity}
        lockedLegalEntityLabel={lockedCreateLegalEntityLabel}
        operatingUnits={createOperatingUnits}
        operatingUnitsLoading={createOperatingUnitsLoading}
        operatingUnitsError={createOperatingUnitsError}
        paymentTerms={createPaymentTerms}
        paymentTermsLoading={createPaymentTermsLoading}
        paymentTermsError={createPaymentTermsError}
        onPaymentTermLookupQueryChange={handleCreatePaymentTermLookupInput}
        canInlineCreatePaymentTerm={canInlineCreatePaymentTermInCreateForm}
        inlineCreatePaymentTermLabel={createInlinePaymentTermName}
        inlineCreatePaymentTermSaving={createInlinePaymentTermSaving}
        onInlineCreatePaymentTerm={handleInlineCreatePaymentTermForCreateForm}
        inlineCreatePaymentTermError={createInlinePaymentTermError}
        inlineCreatePaymentTermMessage={createInlinePaymentTermMessage}
        accountOptions={createAccountOptions}
        accountOptionsLoading={createAccountsLoading}
        accountOptionsError={createAccountsError}
        onAccountLookupQueryChange={handleCreateAccountLookupInput}
        showControlAccountOverrides={!requestMode}
        controlAccountOverridesHint="Control-account overrides belong to live card maintenance, not the request form."
        canUpsertGlAccounts={requestMode ? false : accountPickerGates.canUpsertGlAccounts}
        accountUpsertFallbackMessage="Missing permission: gl.account.upsert"
        canInlineCreateArAccount={canInlineCreateArAccountInCreateForm}
        inlineCreateArAccountLabel={createInlineArAccountName}
        inlineCreateArAccountSaving={createInlineArAccountSaving}
        onInlineCreateArAccount={handleInlineCreateArAccountForCreateForm}
        inlineCreateArAccountError={createInlineArAccountError}
        inlineCreateArAccountMessage={createInlineArAccountMessage}
        showInlineCreateArAccountPanel={showInlineCreateArAccountPanelInCreateForm}
        inlineCreateArCodeCandidate={createArCodeCandidate}
        inlineCreateArSearchText={createInlineArAccountName}
        inlineCreateArParentAccountOptions={createArParentAccountOptions}
        inlineCreateArParentAccountId={createInlineArParentAccountId}
        onInlineCreateArParentAccountIdChange={setCreateInlineArParentAccountId}
        inlineCreateArChildCode={createInlineArChildCode}
        onInlineCreateArChildCodeChange={setCreateInlineArChildCode}
        inlineCreateArChildName={createInlineArChildName}
        onInlineCreateArChildNameChange={setCreateInlineArChildName}
        inlineCreateArSuggestedNextCode={createArSuggestedNextCode}
        onInlineCreateArUseTypedCode={() => setCreateInlineArChildCode(createArCodeCandidate)}
        onInlineCreateArUseNextCode={() => setCreateInlineArChildCode(createArSuggestedNextCode)}
        canInlineCreateApAccount={canInlineCreateApAccountInCreateForm}
        inlineCreateApAccountLabel={createInlineApAccountName}
        inlineCreateApAccountSaving={createInlineApAccountSaving}
        onInlineCreateApAccount={handleInlineCreateApAccountForCreateForm}
        inlineCreateApAccountError={createInlineApAccountError}
        inlineCreateApAccountMessage={createInlineApAccountMessage}
        showInlineCreateApAccountPanel={showInlineCreateApAccountPanelInCreateForm}
        inlineCreateApCodeCandidate={createApCodeCandidate}
        inlineCreateApSearchText={createInlineApAccountName}
        inlineCreateApParentAccountOptions={createApParentAccountOptions}
        inlineCreateApParentAccountId={createInlineApParentAccountId}
        onInlineCreateApParentAccountIdChange={setCreateInlineApParentAccountId}
        inlineCreateApChildCode={createInlineApChildCode}
        onInlineCreateApChildCodeChange={setCreateInlineApChildCode}
        inlineCreateApChildName={createInlineApChildName}
        onInlineCreateApChildNameChange={setCreateInlineApChildName}
        inlineCreateApSuggestedNextCode={createApSuggestedNextCode}
        onInlineCreateApUseTypedCode={() => setCreateInlineApChildCode(createApCodeCandidate)}
        onInlineCreateApUseNextCode={() => setCreateInlineApChildCode(createApSuggestedNextCode)}
        canReadGlAccounts={requestMode ? false : accountPickerGates.showAccountPickers}
        accountReadFallbackMessage={
          "Missing permission: gl.account.read. AR/AP account selectors are hidden."
        }
        canSubmit={canUpsert || canRequest}
        submitting={createSaving}
        onSubmit={handleCreateSubmit}
        onReset={() => {
          setCreateForm(buildInitialCounterpartyForm(config.roleDefault));
          setCreatePaymentTermLookupQuery("");
          setCreateInlinePaymentTermSaving(false);
          setCreateInlinePaymentTermError("");
          setCreateInlinePaymentTermMessage("");
          setCreateArAccountLookupQuery("");
          setCreateApAccountLookupQuery("");
          setCreateInlineArParentAccountId("");
          setCreateInlineArChildCode("");
          setCreateInlineArChildName("");
          setCreateInlineApParentAccountId("");
          setCreateInlineApChildCode("");
          setCreateInlineApChildName("");
          setCreateInlineArAccountSaving(false);
          setCreateInlineArAccountError("");
          setCreateInlineArAccountMessage("");
          setCreateInlineApAccountSaving(false);
          setCreateInlineApAccountError("");
          setCreateInlineApAccountMessage("");
        }}
        submitLabel={canUpsert ? "Create Card" : canRequest ? "Submit for Review" : "Save"}
        serverError={createError}
        serverMessage={createMessage}
        roleHint={
          canUpsert
            ? `Default role preset: ${config.roleDefault}`
            : canRequest
              ? `Submit a ${config.roleDefault.toLowerCase()} master request for review. Review authority stays separate from live card edit authority.`
              : `Default role preset: ${config.roleDefault}`
        }
        enforceRoleAccountRequirement={canUpsert}
      />
    );
  }

  function renderListPage() {
    return (
      <div className="space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">{config.title}</h1>
              <p className="mt-1 text-sm text-slate-600">{config.subtitle}</p>
            </div>
            {(canUpsert || canRequest) && config.createPath ? (
              <Link
                to={config.createPath}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {canUpsert ? "Create Card" : "Submit for Review"}
              </Link>
            ) : null}
          </div>

          {!canUpsert ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {canReviewRequests && canRequest
                ? "You can submit and review in-scope counterparty requests, but live master-data editing stays disabled."
                : canReviewRequests
                  ? "You can review in-scope counterparty requests, but live master-data editing stays disabled."
                  : canRequest
                    ? "You can submit counterparty requests, but live master-data editing stays disabled."
                    : "You only have read permission. Edit actions are disabled."}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Legal Entity
              </label>
              {legalEntities.length > 0 ? (
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={filters.legalEntityId}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, legalEntityId: event.target.value }))
                  }
                >
                  <option value="">All in scope</option>
                  {legalEntities.map((row) => (
                    <option key={`filter-le-${row.id}`} value={String(row.id)}>
                      {row.code} - {row.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value=""
                  disabled
                >
                  <option value="">No in-scope legal entities</option>
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Primary OU
              </label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={filters.primaryOperatingUnitId}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    primaryOperatingUnitId: event.target.value,
                  }))
                }
                disabled={!filters.legalEntityId}
              >
                <option value="">Any</option>
                {filterOperatingUnits.map((row) => (
                  <option key={`filter-primary-ou-${row.id}`} value={String(row.id)}>
                    {row.code} - {row.name}
                  </option>
                ))}
              </select>
              {filterOperatingUnitsError ? (
                <p className="mt-1 text-xs text-amber-700">{filterOperatingUnitsError}</p>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Allowed OU
              </label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={filters.allowedOperatingUnitId}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    allowedOperatingUnitId: event.target.value,
                  }))
                }
                disabled={!filters.legalEntityId}
              >
                <option value="">Any membership</option>
                {filterOperatingUnits.map((row) => (
                  <option key={`filter-allowed-ou-${row.id}`} value={String(row.id)}>
                    {row.code} - {row.name}
                  </option>
                ))}
              </select>
              {filterOperatingUnitsLoading ? (
                <p className="mt-1 text-xs text-slate-500">Loading operating units...</p>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Status
              </label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={filters.status}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, status: event.target.value }))
                }
              >
                <option value="">All</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Role Filter
              </label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={filters.role}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    role: normalizeFilterRole(event.target.value, config.roleDefault),
                  }))
                }
              >
                {ROLE_FILTERS.map((role) => (
                  <option key={`role-filter-${role}`} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Code / Name
              </label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                type="text"
                value={filters.q}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, q: event.target.value }))
                }
                placeholder="Search"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                AR Account Code
              </label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                type="text"
                value={filters.arAccountCode}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, arAccountCode: event.target.value }))
                }
                placeholder="Contains..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                AR Account Name
              </label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                type="text"
                value={filters.arAccountName}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, arAccountName: event.target.value }))
                }
                placeholder="Contains..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                AP Account Code
              </label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                type="text"
                value={filters.apAccountCode}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, apAccountCode: event.target.value }))
                }
                placeholder="Contains..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                AP Account Name
              </label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                type="text"
                value={filters.apAccountName}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, apAccountName: event.target.value }))
                }
                placeholder="Contains..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Sort Field
              </label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={normalizeCounterpartyListSortBy(filters.sortBy, "id")}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    sortBy: normalizeCounterpartyListSortBy(event.target.value, "id"),
                  }))
                }
              >
                {COUNTERPARTY_LIST_SORT_FIELDS.map((sortField) => (
                  <option key={`counterparty-sort-field-${sortField}`} value={sortField}>
                    {SORT_FIELD_LABELS[sortField] || sortField}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Sort Direction
              </label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={normalizeCounterpartyListSortDir(filters.sortDir, "desc")}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    sortDir: normalizeCounterpartyListSortDir(event.target.value, "desc"),
                  }))
                }
              >
                {COUNTERPARTY_LIST_SORT_DIRECTIONS.map((sortDir) => (
                  <option key={`counterparty-sort-dir-${sortDir}`} value={sortDir}>
                    {SORT_DIRECTION_LABELS[sortDir] || sortDir}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => {
                loadCounterpartyRows(filters);
                loadCounterpartyRequestRows(filters);
              }}
              disabled={listLoading}
            >
              {listLoading ? "Loading..." : "Apply Filters"}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              onClick={() => {
                const reset = createCounterpartyListFilters(config.roleDefault);
                setFilters(reset);
                loadCounterpartyRows(reset);
                loadCounterpartyRequestRows(reset);
              }}
              disabled={listLoading}
            >
              Reset
            </button>
          </div>

          {listError ? (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {listError}
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Legal Entity</th>
                  <th className="px-3 py-2">Primary OU</th>
                  <th className="px-3 py-2">AR Account</th>
                  <th className="px-3 py-2">AP Account</th>
                  <th className="px-3 py-2">Payment Term</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row) => (
                  <tr key={`counterparty-row-${row.id}`}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-800">{row.code}</td>
                    <td className="px-3 py-2 text-slate-800">{row.name}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${roleBadgeClass(
                          row.counterpartyType
                        )}`}
                      >
                        {row.counterpartyType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{row.status}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {legalEntityById.get(String(row.legalEntityId))?.code ||
                        row.legalEntityId}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatOperatingUnitLabel(
                        row.primaryOperatingUnitCode,
                        row.primaryOperatingUnitName,
                        row.primaryOperatingUnitId
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatMappedAccountLabel(row.arAccountCode, row.arAccountName)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {formatMappedAccountLabel(row.apAccountCode, row.apAccountName)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {row.defaultPaymentTermCode || row.defaultPaymentTermId || "-"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => handleStartEdit(row.id)}
                        disabled={!canUpsert || editLoading}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-sm text-slate-500"
                      colSpan={9}
                    >
                      {listLoading ? "Loading..." : "No rows found for current filters."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Total rows: {totalRows}</p>
        </section>

        {canRequest || canReviewRequests ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Counterparty Requests</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {canReviewRequests
                    ? "Review customer/vendor card requests in your scope with separate review and execution states. Live card maintenance remains a separate edit authority."
                    : "Track the counterparty requests you submitted for review, including their review and execution status."}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Escalated requests stay in the same pending queue and remain reviewable here.
                </p>
              </div>
              {config.createPath && (canUpsert || canRequest) ? (
                <Link
                  to={config.createPath}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {canUpsert ? "Open Create Card" : "Open Submit for Review Form"}
                </Link>
              ) : null}
            </div>

            {requestError ? (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {requestError}
              </div>
            ) : null}
            {requestMessage ? (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {requestMessage}
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Review / Execution</th>
                    <th className="px-3 py-2">Legal Entity</th>
                    <th className="px-3 py-2">Primary OU</th>
                    <th className="px-3 py-2">Requester</th>
                    <th className="px-3 py-2">Approval Detail</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {requestRows.map((row) => {
                    const reviewStatus = row.approvalRequest?.requestStatus || row.requestStatus;
                    const isEscalated = toUpperText(reviewStatus) === "ESCALATED";
                    const isReviewable = ["PENDING", "PENDING_REVIEW", "ESCALATED"].includes(
                      toUpperText(reviewStatus)
                    );
                    return (
                    <tr
                      key={`counterparty-request-row-${row.id}`}
                      className={isEscalated ? "bg-amber-50/70" : ""}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-800">{row.code}</td>
                      <td className="px-3 py-2 text-slate-800">
                        <div>{row.name}</div>
                        {row.approvalRequest?.requestCode ? (
                          <div className="mt-1 font-mono text-[11px] text-slate-500">
                            {row.approvalRequest.requestCode}
                          </div>
                        ) : null}
                        {row.requestedPayload?.notes ? (
                          <div className="mt-1 text-xs text-slate-500 line-clamp-2">
                            {row.requestedPayload.notes}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${roleBadgeClass(
                            row.requestRole
                          )}`}
                        >
                          {row.requestRole}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <ApprovalRequestStatusBadge
                            status={row.approvalRequest?.requestStatus || row.requestStatus}
                          />
                          <ApprovalExecutionStatusBadge status={row.approvalRequest?.executionStatus} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {legalEntityById.get(String(row.legalEntityId))?.code || row.legalEntityId}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {formatOperatingUnitLabel(
                          operatingUnitById.get(String(row.primaryOperatingUnitId))?.code,
                          operatingUnitById.get(String(row.primaryOperatingUnitId))?.name,
                          row.primaryOperatingUnitId
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {row.requestedByUserName || row.requestedByUserId || "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-slate-700">
                            {buildRequestDecisionSummary(row)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {row.approvalRequest?.currentStepNo != null
                              ? `Current step ${row.approvalRequest.currentStepNo}`
                              : "Approval tracking unavailable"}
                          </div>
                          {isEscalated ? (
                            <div className="text-[11px] font-semibold text-amber-800">
                              Escalated and still actionable in this queue
                            </div>
                          ) : null}
                          <div className="text-[11px] text-slate-500">
                            {formatApprovalScopeLabel(row, legalEntityById, operatingUnitById)}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => openRequestDrawer(row.id)}
                            disabled={Boolean(requestActionKey)}
                          >
                            {canReviewRequests && isReviewable ? "Review" : "View"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {requestRows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-6 text-center text-sm text-slate-500"
                        colSpan={9}
                      >
                        {requestLoading
                          ? "Loading requests..."
                          : "No counterparty requests found for current scope."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Total requests: {requestTotalRows}</p>
          </section>
        ) : null}

        {activeRequestRow ? (
          <ApprovalRequestDrawer
            open={Boolean(activeRequestRow)}
            onClose={closeRequestDrawer}
            title="Counterparty Request Review"
            subtitle={`${activeRequestRow.code || "-"} - ${activeRequestRow.name || "-"}`}
            requestCode={activeRequestRow.approvalRequest?.requestCode || `Request #${activeRequestRow.id}`}
            requestStatus={activeRequestRow.approvalRequest?.requestStatus || activeRequestRow.requestStatus}
            executionStatus={activeRequestRow.approvalRequest?.executionStatus}
            summaryItems={activeRequestSummaryItems}
            timelineItems={activeRequestTimelineItems}
            timelineTitle="Decision & Escalation History"
            statusNotice={activeRequestStatusNotice}
            actions={activeRequestActions}
          >
            {delegationPreviewLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Checking approval authority for this request...
              </div>
            ) : activeDrawerDelegationNotice ? (
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">
                <div className="font-semibold">{activeDrawerDelegationNotice.title}</div>
                <p className="mt-1">{activeDrawerDelegationNotice.description}</p>
              </div>
            ) : null}
            {requestError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {requestError}
              </div>
            ) : null}
            {requestMessage ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                {requestMessage}
              </div>
            ) : null}
            {!activeRequestRow.approvalRequest ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                This row was created before the unified approval pilot or through the legacy flow, so only the
                collapsed request status is historically available.
              </div>
            ) : null}
            {activeRequestRow.requestedPayload?.notes ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Request Notes
                </div>
                <p className="mt-2 text-sm text-slate-700">{activeRequestRow.requestedPayload.notes}</p>
              </div>
            ) : null}
            {activeRequestRow.approvalRequest?.executionErrorText ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                <div className="font-semibold text-rose-900">Execution Error</div>
                <p className="mt-2">{activeRequestRow.approvalRequest.executionErrorText}</p>
              </div>
            ) : null}
          </ApprovalRequestDrawer>
        ) : null}

        <ApprovalActionDialog
          key={
            requestActionDialog
              ? `${requestActionDialog.actionType}-${requestActionDialog.requestId}`
              : "request-action-closed"
          }
          open={Boolean(requestActionDialog && activeRequestRow)}
          title={
            requestActionDialog?.actionType === "APPROVE"
              ? "Approve Counterparty Request"
              : "Reject Counterparty Request"
          }
          description={
            requestActionDialog?.actionType === "APPROVE"
              ? "Record an approval decision for this scoped request."
              : "Reject the request and keep the live counterparty card unchanged."
          }
          commentLabel={
            requestActionDialog?.actionType === "APPROVE" ? "Review note" : "Rejection reason"
          }
          commentPlaceholder={
            requestActionDialog?.actionType === "APPROVE"
              ? "Optional reviewer note"
              : "Optional rejection reason"
          }
          confirmLabel={requestActionDialog?.actionType === "APPROVE" ? "Approve" : "Reject"}
          confirmBusyLabel={
            requestActionDialog?.actionType === "APPROVE" ? "Approving..." : "Rejecting..."
          }
          confirmTone={requestActionDialog?.actionType === "APPROVE" ? "approve" : "reject"}
          authorityNotice={activeActionDelegationNotice}
          submitting={Boolean(requestActionKey)}
          error={requestError}
          onClose={() => setRequestActionDialog(null)}
          onConfirm={handleConfirmRequestAction}
        />

        {editingId ? (
          <CounterpartyForm
            title={`Edit Counterparty #${editingId}`}
            description="Update card master data. Existing contacts/addresses can be updated or new ones added."
            mode="edit"
            form={editingForm}
            setForm={setEditingForm}
            legalEntities={legalEntities}
            legalEntitiesLoading={legalEntitiesLoading}
            legalEntitiesError={legalEntitiesError}
            operatingUnits={editOperatingUnits}
            operatingUnitsLoading={editOperatingUnitsLoading}
            operatingUnitsError={editOperatingUnitsError}
            paymentTerms={editPaymentTerms}
            paymentTermsLoading={editPaymentTermsLoading}
            paymentTermsError={editPaymentTermsError}
            onPaymentTermLookupQueryChange={handleEditPaymentTermLookupInput}
            canInlineCreatePaymentTerm={canInlineCreatePaymentTermInEditForm}
            inlineCreatePaymentTermLabel={editInlinePaymentTermName}
            inlineCreatePaymentTermSaving={editInlinePaymentTermSaving}
            onInlineCreatePaymentTerm={handleInlineCreatePaymentTermForEditForm}
            inlineCreatePaymentTermError={editInlinePaymentTermError}
            inlineCreatePaymentTermMessage={editInlinePaymentTermMessage}
            accountOptions={editAccountOptions}
            accountOptionsLoading={editAccountsLoading}
            accountOptionsError={editAccountsError}
            onAccountLookupQueryChange={handleEditAccountLookupInput}
            canUpsertGlAccounts={accountPickerGates.canUpsertGlAccounts}
            accountUpsertFallbackMessage="Missing permission: gl.account.upsert"
            canInlineCreateArAccount={canInlineCreateArAccountInEditForm}
            inlineCreateArAccountLabel={editInlineArAccountName}
            inlineCreateArAccountSaving={editInlineArAccountSaving}
            onInlineCreateArAccount={handleInlineCreateArAccountForEditForm}
            inlineCreateArAccountError={editInlineArAccountError}
            inlineCreateArAccountMessage={editInlineArAccountMessage}
            showInlineCreateArAccountPanel={showInlineCreateArAccountPanelInEditForm}
            inlineCreateArCodeCandidate={editArCodeCandidate}
            inlineCreateArSearchText={editInlineArAccountName}
            inlineCreateArParentAccountOptions={editArParentAccountOptions}
            inlineCreateArParentAccountId={editInlineArParentAccountId}
            onInlineCreateArParentAccountIdChange={setEditInlineArParentAccountId}
            inlineCreateArChildCode={editInlineArChildCode}
            onInlineCreateArChildCodeChange={setEditInlineArChildCode}
            inlineCreateArChildName={editInlineArChildName}
            onInlineCreateArChildNameChange={setEditInlineArChildName}
            inlineCreateArSuggestedNextCode={editArSuggestedNextCode}
            onInlineCreateArUseTypedCode={() => setEditInlineArChildCode(editArCodeCandidate)}
            onInlineCreateArUseNextCode={() => setEditInlineArChildCode(editArSuggestedNextCode)}
            canInlineCreateApAccount={canInlineCreateApAccountInEditForm}
            inlineCreateApAccountLabel={editInlineApAccountName}
            inlineCreateApAccountSaving={editInlineApAccountSaving}
            onInlineCreateApAccount={handleInlineCreateApAccountForEditForm}
            inlineCreateApAccountError={editInlineApAccountError}
            inlineCreateApAccountMessage={editInlineApAccountMessage}
            showInlineCreateApAccountPanel={showInlineCreateApAccountPanelInEditForm}
            inlineCreateApCodeCandidate={editApCodeCandidate}
            inlineCreateApSearchText={editInlineApAccountName}
            inlineCreateApParentAccountOptions={editApParentAccountOptions}
            inlineCreateApParentAccountId={editInlineApParentAccountId}
            onInlineCreateApParentAccountIdChange={setEditInlineApParentAccountId}
            inlineCreateApChildCode={editInlineApChildCode}
            onInlineCreateApChildCodeChange={setEditInlineApChildCode}
            inlineCreateApChildName={editInlineApChildName}
            onInlineCreateApChildNameChange={setEditInlineApChildName}
            inlineCreateApSuggestedNextCode={editApSuggestedNextCode}
            onInlineCreateApUseTypedCode={() => setEditInlineApChildCode(editApCodeCandidate)}
            onInlineCreateApUseNextCode={() => setEditInlineApChildCode(editApSuggestedNextCode)}
            canReadGlAccounts={accountPickerGates.showAccountPickers}
            accountReadFallbackMessage={
              "Missing permission: gl.account.read. AR/AP account selectors are hidden."
            }
            canSubmit={canUpsert}
            submitting={editSaving}
            onSubmit={handleEditSubmit}
            onCancel={() => {
              setEditingId(null);
              editPreviousLegalEntityIdRef.current = "";
              setEditError("");
              setEditMessage("");
              setEditPaymentTermLookupQuery("");
              setEditInlinePaymentTermSaving(false);
              setEditInlinePaymentTermError("");
              setEditInlinePaymentTermMessage("");
              setEditArAccountLookupQuery("");
              setEditApAccountLookupQuery("");
              setEditInlineArParentAccountId("");
              setEditInlineArChildCode("");
              setEditInlineArChildName("");
              setEditInlineApParentAccountId("");
              setEditInlineApChildCode("");
              setEditInlineApChildName("");
              setEditInlineArAccountSaving(false);
              setEditInlineArAccountError("");
              setEditInlineArAccountMessage("");
              setEditInlineApAccountSaving(false);
              setEditInlineApAccountError("");
              setEditInlineApAccountMessage("");
            }}
            submitLabel="Save Changes"
            serverError={editError}
            serverMessage={editMessage}
          />
        ) : null}

        {editLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            Loading counterparty detail...
          </div>
        ) : null}
      </div>
    );
  }

  if (isCreatePage) {
    return renderCreatePage();
  }
  return renderListPage();
}
