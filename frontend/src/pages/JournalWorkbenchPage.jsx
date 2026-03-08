import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Combobox from "../components/Combobox.jsx";
import {
  closePeriod,
  cancelJournalDraft,
  createJournal,
  getJournal,
  listIntercompanyComplianceIssues,
  listPeriodCloseRuns,
  listIntercompanyEntityFlags,
  getTrialBalance,
  listAccounts,
  listBooks,
  listJournals,
  postJournal,
  upsertIntercompanyPair,
  reopenPeriodClose,
  reverseJournal,
  runPeriodClose,
  updateJournalDraft,
  updateIntercompanyEntityFlags,
} from "../api/glAdmin.js";
import {
  listFiscalPeriods,
  listLegalEntities,
  listOperatingUnits,
} from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import MoneyText from "../components/MoneyText.jsx";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkingContextDefaults } from "../context/useWorkingContextDefaults.js";
import { usePersistedFilters } from "../hooks/usePersistedFilters.js";
import { useToastMessage } from "../hooks/useToastMessage.js";
import { useI18n } from "../i18n/useI18n.js";
import {
  formatMoneyText,
  resolveBookBaseCurrencyCode,
  resolveContextBaseCurrencyCode,
} from "../utils/money.js";

const JOURNAL_SOURCE_TYPES = [
  "MANUAL",
  "SYSTEM",
  "INTERCOMPANY",
  "ELIMINATION",
  "ADJUSTMENT",
];
const JOURNAL_STATUSES = ["DRAFT", "POSTED", "REVERSED", "CANCELLED"];
const PERIOD_STATUSES = ["OPEN", "SOFT_CLOSED", "HARD_CLOSED"];
const JOURNAL_HISTORY_FILTERS_STORAGE_SCOPE = "journal-workbench.history";
const JOURNAL_COMPLIANCE_FILTERS_STORAGE_SCOPE = "journal-workbench.compliance";
const JOURNAL_HISTORY_DEFAULT_FILTERS = {
  legalEntityId: "",
  bookId: "",
  fiscalPeriodId: "",
  status: "DRAFT",
  limit: "50",
  offset: "0",
};
const JOURNAL_COMPLIANCE_DEFAULT_FILTERS = {
  legalEntityId: "",
  fiscalPeriodId: "",
  includeDraft: true,
  limit: "200",
};
const JOURNAL_REVERSE_SOURCE_DESTINATIONS = Object.freeze({
  CARI_DOCUMENT: "/app/cari-belgeler",
  CARI_SETTLEMENT_BATCH: "/app/cari-settlements",
  CASH_TRANSACTION: "/app/kasa-islemleri",
  PAYMENT_BATCH: "/app/odeme-batchleri",
  PAYROLL_RUN: "/app/payroll-runs",
});
const JOURNAL_REVERSE_BLOCK_SOURCE_TYPES = new Set(
  Object.keys(JOURNAL_REVERSE_SOURCE_DESTINATIONS)
);
const PERIOD_CLOSE_FX_GATE_REQUIRED_CODE = "CASH_FX_REVALUATION_REQUIRED";
const PERIOD_CLOSE_FX_GATE_REVERSAL_CODE =
  "CASH_FX_REVALUATION_REVERSAL_REQUIRED";
const PERIOD_CLOSE_FX_GATE_CODES = new Set([
  PERIOD_CLOSE_FX_GATE_REQUIRED_CODE,
  PERIOD_CLOSE_FX_GATE_REVERSAL_CODE,
]);

function normalizeSourceRefType(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveReverseBlockedSourceLinks(sourceLinks = []) {
  return (Array.isArray(sourceLinks) ? sourceLinks : [])
    .map((row) => ({
      sourceRefType: normalizeSourceRefType(row?.source_ref_type || row?.sourceRefType),
      sourceRefId: parsePositiveIntOrNull(row?.source_ref_id || row?.sourceRefId),
    }))
    .filter(
      (row) =>
        row.sourceRefType &&
        row.sourceRefId &&
        JOURNAL_REVERSE_BLOCK_SOURCE_TYPES.has(row.sourceRefType)
    );
}

function formatSettlementSourceLinkRole(role, l) {
  const normalizedRole = normalizeSourceRefType(role || "PRIMARY");
  if (normalizedRole === "REVERSAL_OF") {
    return l("Original Settlement", "Orijinal Mahsup");
  }
  if (normalizedRole === "PRIMARY") {
    return l("Source Settlement", "Kaynak Mahsup");
  }
  return normalizedRole || l("Settlement Link", "Mahsup Baglantisi");
}

function resolveJournalSourceLinkPath(sourceLink, settlementDrilldowns = []) {
  const sourceRefType = normalizeSourceRefType(
    sourceLink?.source_ref_type || sourceLink?.sourceRefType
  );
  const sourceRefId = parsePositiveIntOrNull(
    sourceLink?.source_ref_id || sourceLink?.sourceRefId
  );
  if (!sourceRefType || !sourceRefId) {
    return null;
  }

  if (sourceRefType === "CARI_DOCUMENT") {
    return `/app/cari-belgeler?documentId=${sourceRefId}`;
  }

  if (sourceRefType === "CARI_SETTLEMENT_BATCH") {
    const settlement =
      (Array.isArray(settlementDrilldowns) ? settlementDrilldowns : []).find(
        (row) => parsePositiveIntOrNull(row?.settlementBatchId) === sourceRefId
      ) || null;
    const params = new URLSearchParams({
      settlementBatchId: String(sourceRefId),
    });
    const legalEntityId = parsePositiveIntOrNull(settlement?.legalEntityId);
    const counterpartyId = parsePositiveIntOrNull(settlement?.counterpartyId);
    if (legalEntityId) {
      params.set("legalEntityId", String(legalEntityId));
    }
    if (counterpartyId) {
      params.set("counterpartyId", String(counterpartyId));
    }
    return `/app/cari-settlements?${params.toString()}`;
  }

  if (sourceRefType === "PAYMENT_BATCH") {
    return `/app/odeme-batchleri/${sourceRefId}`;
  }

  return null;
}

function formatJournalSourceLinkAction(sourceLink, l) {
  const sourceRefType = normalizeSourceRefType(
    sourceLink?.source_ref_type || sourceLink?.sourceRefType
  );
  if (sourceRefType === "CARI_DOCUMENT") {
    return l("Open Document", "Belgeyi Ac");
  }
  if (sourceRefType === "CARI_SETTLEMENT_BATCH") {
    return l("Open Settlement", "Mahsuplastirmayi Ac");
  }
  if (sourceRefType === "PAYMENT_BATCH") {
    return l("Open Payment Batch", "Odeme Batch'ini Ac");
  }
  return l("Open Source", "Kaynagi Ac");
}

function toInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalInt(value) {
  if (value === undefined || value === null || value === "") return null;
  return toInt(value);
}

function keepDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function toAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatInputAmount(value) {
  const rounded = Math.round(Math.max(0, Number(value || 0)) * 10000) / 10000;
  return String(rounded);
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOperatingUnitDisplay(unitId, unitCode, unitName) {
  const code = String(unitCode || "").trim();
  const name = String(unitName || "").trim();
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

function getJournalLineOperatingUnitLabel(line, unitsById) {
  const unitId = toInt(line?.operating_unit_id || line?.operatingUnitId);
  const lookupUnit = unitId ? unitsById.get(unitId) || null : null;
  return formatOperatingUnitDisplay(
    unitId,
    line?.operating_unit_code || line?.operatingUnitCode || lookupUnit?.code,
    line?.operating_unit_name || line?.operatingUnitName || lookupUnit?.name
  );
}

function getJournalLineSide(line) {
  const debit = toAmount(line?.debit_base ?? line?.debitBase);
  const credit = toAmount(line?.credit_base ?? line?.creditBase);
  if (debit > 0 && credit <= 0) {
    return "DEBIT";
  }
  if (credit > 0 && debit <= 0) {
    return "CREDIT";
  }
  return "OTHER";
}

function getJournalLineSortOrder(line) {
  const side = getJournalLineSide(line);
  if (side === "DEBIT") return 0;
  if (side === "CREDIT") return 1;
  return 2;
}

function sortJournalDetailLines(lines = []) {
  return [...(Array.isArray(lines) ? lines : [])]
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      const sideDelta =
        getJournalLineSortOrder(left.line) - getJournalLineSortOrder(right.line);
      if (sideDelta !== 0) {
        return sideDelta;
      }

      const leftLineNo = Number(left.line?.line_no || 0);
      const rightLineNo = Number(right.line?.line_no || 0);
      if (leftLineNo !== rightLineNo) {
        return leftLineNo - rightLineNo;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.line);
}

function hasId(rows, id) {
  return rows.some((row) => Number(row.id) === Number(id));
}

function toDateOnly(value) {
  return String(value || "").trim().slice(0, 10);
}

function normalizeErrorCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizePeriodCloseFxGate(error) {
  const data = error?.response?.data || {};
  const code = normalizeErrorCode(data?.code);
  if (!PERIOD_CLOSE_FX_GATE_CODES.has(code)) {
    return null;
  }
  return {
    code,
    message: String(data?.message || error?.message || "Period close is blocked."),
    details:
      data?.details && typeof data.details === "object" && !Array.isArray(data.details)
        ? data.details
        : {},
    requestId:
      data?.requestId ||
      error?.response?.headers?.["x-request-id"] ||
      null,
  };
}

function isIsoDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function findPeriodByDate(periods, targetDate) {
  if (!isIsoDateOnly(targetDate)) {
    return null;
  }
  for (const row of periods || []) {
    const startDate = toDateOnly(row?.start_date);
    const endDate = toDateOnly(row?.end_date);
    if (!isIsoDateOnly(startDate) || !isIsoDateOnly(endDate)) {
      continue;
    }
    if (targetDate >= startDate && targetDate <= endDate) {
      return row;
    }
  }
  return null;
}

function formatPeriodLabel(row) {
  if (!row) {
    return "";
  }
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`;
}

function isDraftStatus(status) {
  return String(status || "").trim().toUpperCase() === "DRAFT";
}

function isDescendantOfAccount(parentById, accountId, ancestorId) {
  const normalizedAccountId = toInt(accountId);
  const normalizedAncestorId = toInt(ancestorId);
  if (!normalizedAccountId || !normalizedAncestorId) {
    return false;
  }

  const visited = new Set();
  let currentParentId = toInt(parentById.get(normalizedAccountId));
  while (currentParentId) {
    if (currentParentId === normalizedAncestorId) {
      return true;
    }
    if (visited.has(currentParentId)) {
      break;
    }
    visited.add(currentParentId);
    currentParentId = toInt(parentById.get(currentParentId));
  }

  return false;
}

function buildCentralEquityAccountIds(accounts) {
  const parentById = new Map();
  const rowsById = new Map();
  for (const row of accounts || []) {
    const accountId = toInt(row?.id);
    if (!accountId) {
      continue;
    }
    rowsById.set(accountId, row);
    parentById.set(accountId, toInt(row?.parent_account_id));
  }

  const parentAccountIds = new Set();
  for (const [accountId, row] of rowsById.entries()) {
    const code = String(row?.code || "").trim();
    if (code === "500" || code === "501") {
      parentAccountIds.add(accountId);
    }
  }

  if (parentAccountIds.size === 0) {
    return new Set();
  }

  const restrictedAccountIds = new Set(parentAccountIds);
  for (const accountId of rowsById.keys()) {
    for (const parentAccountId of parentAccountIds) {
      if (
        accountId === parentAccountId ||
        isDescendantOfAccount(parentById, accountId, parentAccountId)
      ) {
        restrictedAccountIds.add(accountId);
        break;
      }
    }
  }

  return restrictedAccountIds;
}

function toJournalSummary(row) {
  const id = toInt(row?.id);
  if (!id) return null;

  const lineCountRaw = row?.line_count ?? row?.lineCount;
  const fallbackLineCount = Array.isArray(row?.lines) ? row.lines.length : 0;
  const lineCount = Number.isFinite(Number(lineCountRaw))
    ? Number(lineCountRaw)
    : fallbackLineCount;

  return {
    id,
    journal_no: String(row?.journal_no || row?.journalNo || ""),
    status: String(row?.status || "").toUpperCase(),
    entry_date: String(row?.entry_date || row?.entryDate || ""),
    total_debit_base: Number(row?.total_debit_base ?? row?.totalDebitBase ?? 0),
    total_credit_base: Number(row?.total_credit_base ?? row?.totalCreditBase ?? 0),
    line_count: lineCount,
  };
}

function createLine(defaultCurrencyCode = "USD", defaultAccountId = "", defaultUnitId = "") {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: defaultAccountId,
    operatingUnitId: defaultUnitId,
    subledgerReferenceNo: "",
    counterpartyLegalEntityId: "",
    description: "",
    currencyCode: defaultCurrencyCode,
    amountTxn: "0",
    debitBase: "0",
    creditBase: "0",
    taxCode: "",
  };
}

function mapJournalLineToEditorLine(line, fallbackCurrencyCode = "USD") {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: String(line?.account_id || ""),
    operatingUnitId: String(line?.operating_unit_id || ""),
    subledgerReferenceNo: String(line?.subledger_reference_no || ""),
    counterpartyLegalEntityId: String(line?.counterparty_legal_entity_id || ""),
    description: String(line?.description || ""),
    currencyCode: String(line?.currency_code || fallbackCurrencyCode || "USD").toUpperCase(),
    amountTxn: String(Number(line?.amount_txn || 0)),
    debitBase: String(Number(line?.debit_base || 0)),
    creditBase: String(Number(line?.credit_base || 0)),
    taxCode: String(line?.tax_code || ""),
  };
}

export default function JournalWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);

  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const canReadJournals = hasPermission("gl.journal.read");
  const canReadCariDocuments = hasPermission("cari.doc.read");
  const canReadCariReports = hasPermission("cari.report.read");
  const canCreate = hasPermission("gl.journal.create");
  const canUpdateDraft = hasPermission("gl.journal.update");
  const canCancelDraft = hasPermission("gl.journal.cancel");
  const canPost = hasPermission("gl.journal.post");
  const canReverse = hasPermission("gl.journal.reverse");
  const canReadTrialBalance = hasPermission("gl.trial_balance.read");
  const canClosePeriod = hasPermission("gl.period.close");
  const canOverrideCashFxRevaluation = hasPermission("cash.fx.revaluation.override");
  const canReadIntercompanyFlags = hasPermission("intercompany.flag.read");
  const canUpsertIntercompanyFlags = hasPermission("intercompany.flag.upsert");
  const canUpsertIntercompanyPairs = hasPermission("intercompany.pair.upsert");

  const today = new Date().toISOString().slice(0, 10);

  const [loadingRefs, setLoadingRefs] = useState(false);
  const [, setLoadingPeriods] = useState(false);
  const [loadingCreateAccountBalances, setLoadingCreateAccountBalances] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useToastMessage("", { toastType: "success" });

  const [entities, setEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [units, setUnits] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [createAccountBalanceRows, setCreateAccountBalanceRows] = useState([]);

  const [journal, setJournal] = useState({
    legalEntityId: "",
    bookId: "",
    fiscalPeriodId: "",
    entryDate: today,
    documentDate: today,
    currencyCode: "USD",
    sourceType: "MANUAL",
    description: "",
    referenceNo: "",
  });
  const [createAutoMirror, setCreateAutoMirror] = useState(true);
  const [lines, setLines] = useState([createLine(), createLine()]);
  const [createLineAmountFocusById, setCreateLineAmountFocusById] = useState({});
  const [editingDraftId, setEditingDraftId] = useState("");

  const [reverseForm, setReverseForm] = useState({
    journalId: "",
    reversalPeriodId: "",
    autoPost: true,
    reason: "",
  });

  const [tbForm, setTbForm] = useState({ bookId: "", fiscalPeriodId: "" });
  const [tbRows, setTbRows] = useState([]);
  const [tbSummary, setTbSummary] = useState({
    debitTotal: 0,
    creditTotal: 0,
    balanceTotal: 0,
  });

  const [periodForm, setPeriodForm] = useState({
    bookId: "",
    periodId: "",
    status: "SOFT_CLOSED",
    note: "",
  });
  const [periodCloseForm, setPeriodCloseForm] = useState({
    closeStatus: "SOFT_CLOSED",
    retainedEarningsAccountId: "",
    note: "",
    cashFxRevaluationOverride: false,
    cashFxRevaluationOverrideReason: "",
    reopenReason: "",
  });
  const [periodCloseRuns, setPeriodCloseRuns] = useState([]);
  const [periodCloseFxGate, setPeriodCloseFxGate] = useState(null);

  const [historyFilters, setHistoryFilters, resetHistoryFilters] = usePersistedFilters(
    JOURNAL_HISTORY_FILTERS_STORAGE_SCOPE,
    () => ({ ...JOURNAL_HISTORY_DEFAULT_FILTERS })
  );
  const [historyBooks, setHistoryBooks] = useState([]);
  const [historyPeriods, setHistoryPeriods] = useState([]);
  const [loadingHistoryPeriods, setLoadingHistoryPeriods] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [selectedHistoryJournalIds, setSelectedHistoryJournalIds] = useState([]);
  const [postConfirmState, setPostConfirmState] = useState({
    open: false,
    rows: [],
    postLinkedMirrors: false,
  });
  const [selectedJournalId, setSelectedJournalId] = useState("");
  const [selectedJournal, setSelectedJournal] = useState(null);
  const lastObservedUrlJournalIdRef = useRef(null);
  const pendingUrlSelectionJournalIdRef = useRef(null);
  const [complianceRows, setComplianceRows] = useState([]);
  const [complianceSummary, setComplianceSummary] = useState(null);
  const [complianceFilters, setComplianceFilters, resetComplianceFilters] = usePersistedFilters(
    JOURNAL_COMPLIANCE_FILTERS_STORAGE_SCOPE,
    () => ({ ...JOURNAL_COMPLIANCE_DEFAULT_FILTERS })
  );

  const selectedLegalEntityId = toInt(journal.legalEntityId);
  const selectedBookId = toInt(journal.bookId);
  const resolvedCreatePeriod = useMemo(
    () => findPeriodByDate(periods, toDateOnly(journal.entryDate)),
    [periods, journal.entryDate]
  );
  const resolvedCreatePeriodId = toInt(resolvedCreatePeriod?.id);
  const createAccountBalanceById = useMemo(() => {
    const map = new Map();
    for (const row of createAccountBalanceRows || []) {
      const accountId = toInt(row?.account_id);
      if (!accountId) {
        continue;
      }
      map.set(accountId, Number(row?.balance || 0));
    }
    return map;
  }, [createAccountBalanceRows]);
  const unitsById = useMemo(() => {
    const map = new Map();
    for (const unit of units) {
      const unitId = toInt(unit.id);
      if (!unitId) {
        continue;
      }
      map.set(unitId, unit);
    }
    return map;
  }, [units]);
  const trialBalanceBookId = toInt(tbForm.bookId);
  const periodActionBookId = toInt(periodForm.bookId);
  const canUseTbPeriodLookup =
    periods.length > 0 && trialBalanceBookId && trialBalanceBookId === selectedBookId;
  const canUsePeriodActionLookup =
    periods.length > 0 && periodActionBookId && periodActionBookId === selectedBookId;
  const postableAccounts = useMemo(() => {
    const parentIds = new Set(
      accounts
        .map((row) => toInt(row.parent_account_id))
        .filter(Boolean)
    );
    return accounts.filter((row) => {
      const accountId = toInt(row.id);
      if (!accountId) {
        return false;
      }
      const allowPosting = !(
        row.allow_posting === false ||
        row.allow_posting === 0 ||
        row.allow_posting === "0"
      );
      return allowPosting && !parentIds.has(accountId);
    });
  }, [accounts]);
  const centralEquityAccountIds = useMemo(
    () => buildCentralEquityAccountIds(accounts),
    [accounts]
  );
  const isCentralEquityAccountId = useCallback(
    (accountIdRaw) => centralEquityAccountIds.has(toInt(accountIdRaw)),
    [centralEquityAccountIds]
  );
  const retainedEarningsAccounts = useMemo(
    () =>
      postableAccounts.filter(
        (account) => String(account.account_type || "").toUpperCase() === "EQUITY"
      ),
    [postableAccounts]
  );
  const postableAccountOptions = useMemo(
    () =>
      postableAccounts.map((account) => {
        const accountId = toInt(account.id);
        const hasBalanceContext =
          Boolean(canReadTrialBalance) &&
          Boolean(selectedBookId) &&
          Boolean(resolvedCreatePeriodId);
        return {
          value: String(account.id),
          label: `${account.code} - ${account.name}`,
          description: String(account.account_type || "").toUpperCase(),
          accountType: String(account.account_type || "").toUpperCase(),
          balance: hasBalanceContext
            ? Number(createAccountBalanceById.get(accountId) || 0)
            : null,
        };
      }),
    [
      postableAccounts,
      canReadTrialBalance,
      selectedBookId,
      resolvedCreatePeriodId,
      createAccountBalanceById,
    ]
  );
  const legalEntityOptions = useMemo(
    () =>
      entities.map((entity) => ({
        value: String(entity.id),
        label: `${entity.code} - ${entity.name}`,
        description: `#${entity.id}`,
      })),
    [entities]
  );
  const bookOptions = useMemo(
    () =>
      books.map((book) => ({
        value: String(book.id),
        label: `${book.code} - ${book.name}`,
        description: `#${book.id}`,
      })),
    [books]
  );

  useEffect(() => {
    setLines((prev) => {
      let changed = false;
      const next = prev.map((line) => {
        if (!isCentralEquityAccountId(line.accountId)) {
          return line;
        }
        if (!String(line.operatingUnitId || "").trim() && !String(line.subledgerReferenceNo || "").trim()) {
          return line;
        }
        changed = true;
        return {
          ...line,
          operatingUnitId: "",
          subledgerReferenceNo: "",
        };
      });
      return changed ? next : prev;
    });
  }, [isCentralEquityAccountId]);
  const historyBookOptions = useMemo(
    () =>
      historyBooks.map((book) => ({
        value: String(book.id),
        label: `${book.code} - ${book.name}`,
        description: `#${book.id}`,
      })),
    [historyBooks]
  );
  const contextBookRows = useMemo(() => {
    const merged = new Map();
    for (const book of [...books, ...historyBooks]) {
      const bookId = toInt(book?.id);
      if (!bookId || merged.has(bookId)) {
        continue;
      }
      merged.set(bookId, book);
    }
    return Array.from(merged.values());
  }, [books, historyBooks]);
  const periodOptions = useMemo(
    () =>
      periods.map((period) => ({
        value: String(period.id),
        label: formatPeriodLabel(period),
        description: `#${period.id}`,
      })),
    [periods]
  );
  const historyPeriodOptions = useMemo(
    () =>
      historyPeriods.map((period) => ({
        value: String(period.id),
        label: formatPeriodLabel(period),
        description: `#${period.id}`,
      })),
    [historyPeriods]
  );
  const compliancePeriodOptions = useMemo(() => {
    const mergedById = new Map();
    for (const period of [...periods, ...historyPeriods]) {
      const periodId = toInt(period?.id);
      if (!periodId || mergedById.has(periodId)) {
        continue;
      }
      mergedById.set(periodId, {
        value: String(periodId),
        label: formatPeriodLabel(period),
        description: `#${periodId}`,
      });
    }
    return Array.from(mergedById.values());
  }, [periods, historyPeriods]);
  const operatingUnitOptions = useMemo(
    () =>
      units.map((unit) => ({
        value: String(unit.id),
        label: `${unit.code} - ${unit.name}`,
        description: `#${unit.id}`,
      })),
    [units]
  );
  const counterpartyLegalEntityOptions = useMemo(
    () =>
      entities.map((entity) => ({
        value: String(entity.id),
        label: `${entity.code} - ${entity.name}`,
        description: `#${entity.id}`,
      })),
    [entities]
  );
  const sourceTypeOptions = useMemo(
    () => JOURNAL_SOURCE_TYPES.map((value) => ({ value, label: value })),
    []
  );
  const periodStatusOptions = useMemo(
    () => PERIOD_STATUSES.map((value) => ({ value, label: value })),
    []
  );
  const periodCloseStatusOptions = useMemo(
    () => ["SOFT_CLOSED", "HARD_CLOSED"].map((value) => ({ value, label: value })),
    []
  );
  const retainedEarningsAccountOptions = useMemo(
    () =>
      retainedEarningsAccounts.map((account) => ({
        value: String(account.id),
        label: `${account.code} - ${account.name}`,
        description: `#${account.id}`,
      })),
    [retainedEarningsAccounts]
  );
  const historyStatusOptions = useMemo(
    () => JOURNAL_STATUSES.map((value) => ({ value, label: value })),
    []
  );
  const historyLimitOptions = useMemo(
    () =>
      ["20", "50", "100", "200"].map((value) => ({
        value,
        label: value,
      })),
    []
  );
  const complianceLimitOptions = useMemo(
    () =>
      ["100", "200", "300", "500"].map((value) => ({
        value,
        label: value,
      })),
    []
  );
  const reverseJournalOptions = useMemo(() => {
    const byId = new Map();
    const rows = [...(historyRows || []), selectedJournal].filter(Boolean);
    for (const row of rows) {
      const journalId = toInt(row?.id);
      if (!journalId || byId.has(journalId)) {
        continue;
      }
      const journalNo = String(row?.journal_no || row?.journalNo || "-");
      const status = String(row?.status || "").toUpperCase() || "-";
      byId.set(journalId, {
        value: String(journalId),
        label: `#${journalId} - ${journalNo}`,
        description: status,
      });
    }
    return Array.from(byId.values());
  }, [historyRows, selectedJournal]);
  const selectedLegalEntity = useMemo(
    () => entities.find((entity) => Number(entity.id) === Number(selectedLegalEntityId)) || null,
    [entities, selectedLegalEntityId]
  );
  const selectedBookBaseCurrencyCode = useMemo(
    () =>
      resolveContextBaseCurrencyCode({
        legalEntityRows: entities,
        legalEntityId: selectedLegalEntityId,
        bookRows: books,
        bookId: selectedBookId,
      }),
    [books, entities, selectedBookId, selectedLegalEntityId]
  );
  const renderPostableAccountOption = useCallback(
    ({ option, isHighlighted, isSelected, disabled }) => {
      const balanceText =
        option?.balance === null
          ? l("Period required", "Donem gerekli")
          : formatMoneyText(option.balance, selectedBookBaseCurrencyCode);
      const rowClass = disabled
        ? "cursor-not-allowed text-slate-400"
        : isHighlighted
          ? "bg-cyan-50 text-cyan-900"
          : isSelected
            ? "bg-slate-100 text-slate-900"
            : "text-slate-700 hover:bg-slate-50";

      return (
        <div className={`rounded px-2 py-1.5 ${rowClass}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate">{option?.label || "-"}</div>
              <div className="mt-0.5 truncate text-[10px] text-slate-500">
                {option?.accountType || l("Account", "Hesap")}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[11px] font-semibold text-slate-700">{balanceText}</div>
              <div className="text-[10px] text-slate-500">{l("Balance", "Bakiye")}</div>
            </div>
          </div>
        </div>
      );
    },
    [l, selectedBookBaseCurrencyCode]
  );

  const lineTotals = useMemo(() => {
    const totals = lines.reduce(
      (acc, line) => {
        acc.debit += toAmount(line.debitBase);
        acc.credit += toAmount(line.creditBase);
        return acc;
      },
      { debit: 0, credit: 0 }
    );
    return { ...totals, balanced: Math.abs(totals.debit - totals.credit) < 0.0001 };
  }, [lines]);

  const tbTotals = useMemo(() => {
    return {
      debit: toAmount(tbSummary.debitTotal),
      credit: toAmount(tbSummary.creditTotal),
      balance: toAmount(tbSummary.balanceTotal),
    };
  }, [tbSummary]);

  const historyLimit = toInt(historyFilters.limit) || 50;
  const historyOffset =
    Number.isInteger(Number(historyFilters.offset)) && Number(historyFilters.offset) >= 0
      ? Number(historyFilters.offset)
      : 0;
  const historyPage = Math.floor(historyOffset / historyLimit) + 1;
  const historyHasPrev = historyOffset > 0;
  const historyHasNext = historyOffset + historyRows.length < historyTotal;
  const selectedHistoryIdSet = useMemo(
    () => new Set(selectedHistoryJournalIds.map((id) => String(id))),
    [selectedHistoryJournalIds]
  );
  const draftHistoryRows = useMemo(
    () => historyRows.filter((row) => isDraftStatus(row.status)),
    [historyRows]
  );
  const selectedDraftHistoryRows = useMemo(
    () => draftHistoryRows.filter((row) => selectedHistoryIdSet.has(String(row.id))),
    [draftHistoryRows, selectedHistoryIdSet]
  );
  const allDraftRowsOnPageSelected =
    draftHistoryRows.length > 0 &&
    draftHistoryRows.every((row) => selectedHistoryIdSet.has(String(row.id)));
  const editingDraftJournalId = toInt(editingDraftId);
  const isEditMode = Boolean(editingDraftJournalId);
  const postingBusy = saving === "postJournal";
  const cancelBusy = saving === "cancelJournalDraft";
  const deepLinkedJournalIdRaw = String(
    searchParams.get("journalId") || searchParams.get("journal_id") || ""
  ).trim();
  const deepLinkedJournalId = toInt(deepLinkedJournalIdRaw);
  const selectedJournalReverseBlockedSourceLinks = useMemo(
    () => resolveReverseBlockedSourceLinks(selectedJournal?.source_links),
    [selectedJournal]
  );
  const selectedJournalCariSettlementDrilldowns = useMemo(() => {
    const rows =
      selectedJournal?.cariSettlementDrilldowns ||
      selectedJournal?.cari_settlement_drilldowns ||
      [];
    return Array.isArray(rows) ? rows : [];
  }, [selectedJournal]);
  const selectedJournalDetailLines = useMemo(
    () => sortJournalDetailLines(selectedJournal?.lines || []),
    [selectedJournal]
  );
  const selectedJournalOperatingUnitLabels = useMemo(() => {
    const byKey = new Map();
    for (const line of selectedJournalDetailLines) {
      const unitId = toInt(line?.operating_unit_id || line?.operatingUnitId);
      const label = getJournalLineOperatingUnitLabel(line, unitsById);
      if (label === "-") {
        continue;
      }
      byKey.set(unitId ? `id:${unitId}` : `label:${label}`, label);
    }

    if (byKey.size > 0) {
      return Array.from(byKey.values());
    }

    const journalUnitId = toInt(selectedJournal?.operating_unit_id || selectedJournal?.operatingUnitId);
    if (!journalUnitId && !selectedJournal?.operating_unit_code && !selectedJournal?.operating_unit_name) {
      return [];
    }

    return [
      formatOperatingUnitDisplay(
        journalUnitId,
        selectedJournal?.operating_unit_code || selectedJournal?.operatingUnitCode,
        selectedJournal?.operating_unit_name || selectedJournal?.operatingUnitName
      ),
    ].filter((label) => label && label !== "-");
  }, [selectedJournal, selectedJournalDetailLines, unitsById]);
  const isReverseBlockedForSelectedJournal = useMemo(() => {
    const selectedId = toInt(selectedJournal?.id);
    const reverseJournalId = toInt(reverseForm.journalId);
    if (!selectedId || !reverseJournalId || selectedId !== reverseJournalId) {
      return false;
    }
    return selectedJournalReverseBlockedSourceLinks.length > 0;
  }, [reverseForm.journalId, selectedJournal, selectedJournalReverseBlockedSourceLinks]);
  const reverseBlockedMessage = useMemo(() => {
    if (!isReverseBlockedForSelectedJournal) {
      return "";
    }
    const linkTokens = selectedJournalReverseBlockedSourceLinks.map(
      (row) => `${row.sourceRefType}:${row.sourceRefId}`
    );
    const destinationPaths = Array.from(
      new Set(
        selectedJournalReverseBlockedSourceLinks
          .map((row) => JOURNAL_REVERSE_SOURCE_DESTINATIONS[row.sourceRefType] || null)
          .filter(Boolean)
      )
    );
    const destinationSuffix =
      destinationPaths.length > 0
        ? l(
            ` Open from: ${destinationPaths.join(", ")}.`,
            ` Su ekranlardan tersleyin: ${destinationPaths.join(", ")}.`
          )
        : "";
    return l(
      `This journal is linked to subledger record(s) [${linkTokens.join(", ")}]. Reverse from source module, not from Journal Workbench.${destinationSuffix}`,
      `Bu fis alt-defter kayit(lar)ina bagli [${linkTokens.join(", ")}]. Ters kaydi Mahsup ekranindan degil, ilgili kaynak modulden yapin.${destinationSuffix}`
    );
  }, [
    isReverseBlockedForSelectedJournal,
    selectedJournalReverseBlockedSourceLinks,
    l,
  ]);
  const trialBalanceBookBaseCurrencyCode = useMemo(
    () => resolveBookBaseCurrencyCode(books, tbForm.bookId),
    [books, tbForm.bookId]
  );
  const historyBookBaseCurrencyCode = useMemo(
    () => resolveBookBaseCurrencyCode(historyBooks, historyFilters.bookId),
    [historyBooks, historyFilters.bookId]
  );
  const selectedJournalBookBaseCurrencyCode = useMemo(
    () =>
      resolveContextBaseCurrencyCode({
        legalEntityRows: entities,
        legalEntityId:
          selectedJournal?.legal_entity_id ||
          selectedJournal?.legalEntityId ||
          historyFilters.legalEntityId,
        bookRows: contextBookRows,
        bookId:
          selectedJournal?.book_id ||
          selectedJournal?.bookId ||
          historyFilters.bookId,
      }),
    [contextBookRows, entities, historyFilters.bookId, historyFilters.legalEntityId, selectedJournal]
  );
  const showPeriodCloseFxOverrideControls = canOverrideCashFxRevaluation;
  const periodCloseFxGateDetails = useMemo(() => {
    if (!periodCloseFxGate) {
      return [];
    }

    const details = periodCloseFxGate.details || {};
    if (periodCloseFxGate.code === PERIOD_CLOSE_FX_GATE_REQUIRED_CODE) {
      return [
        { label: l("Run Type", "Calisma Turu"), value: details.runType || "-" },
        {
          label: l("Period End", "Donem Sonu"),
          value: toDateOnly(details.periodEndDate) || "-",
        },
        {
          label: l("Foreign Balances", "Yabanci Para Bakiye"),
          value: String(Number(details.foreignBalanceCount || 0)),
        },
      ];
    }

    return [
      { label: l("Reason Code", "Neden Kodu"), value: details.reasonCode || "-" },
      {
        label: l("Previous Period", "Onceki Donem"),
        value: details.previousFiscalPeriodId || "-",
      },
      {
        label: l("Previous Run Type", "Onceki Calisma Turu"),
        value: details.previousRunType || "-",
      },
      {
        label: l("Previous Run", "Onceki Calisma"),
        value: details.previousRunId ? `#${details.previousRunId}` : "-",
      },
      {
        label: l("Reversal Journal", "Ters Kayit Fisi"),
        value: details.reversalJournalEntryId ? `#${details.reversalJournalEntryId}` : "-",
      },
    ];
  }, [l, periodCloseFxGate]);
  const selectedEntityIntercompanyEnabled = Boolean(
    selectedLegalEntity?.is_intercompany_enabled ?? true
  );
  const selectedEntityPartnerRequired = Boolean(
    selectedLegalEntity?.intercompany_partner_required ?? false
  );
  const requiresCounterpartyByPolicy =
    selectedEntityIntercompanyEnabled &&
    selectedEntityPartnerRequired &&
    String(journal.sourceType || "").toUpperCase() === "INTERCOMPANY";

  useEffect(() => {
    setPeriodCloseFxGate(null);
  }, [periodForm.bookId, periodForm.periodId]);

  const journalContextMappings = useMemo(
    () => [
      { stateKey: "legalEntityId" },
      {
        stateKey: "fiscalPeriodId",
        allowContextValue: (contextValue) => hasId(periods, Number(contextValue)),
      },
    ],
    [periods]
  );

  const historyContextMappings = useMemo(
    () => [{ stateKey: "legalEntityId" }],
    []
  );

  const complianceContextMappings = useMemo(() => [{ stateKey: "legalEntityId" }], []);

  useWorkingContextDefaults(
    setJournal,
    journalContextMappings,
    [journal.legalEntityId, journal.fiscalPeriodId, periods]
  );

  useWorkingContextDefaults(
    setHistoryFilters,
    historyContextMappings,
    [historyFilters.legalEntityId, historyFilters.fiscalPeriodId, historyPeriods]
  );

  useWorkingContextDefaults(
    setComplianceFilters,
    complianceContextMappings,
    [complianceFilters.legalEntityId]
  );

  useEffect(() => {
    setSelectedHistoryJournalIds((prev) => {
      const allowedIds = new Set(draftHistoryRows.map((row) => String(row.id)));
      const next = prev.filter((id) => allowedIds.has(String(id)));
      return next.length === prev.length ? prev : next;
    });
  }, [draftHistoryRows]);

  useEffect(() => {
    let cancelled = false;
    async function loadEntities() {
      if (!canReadOrgTree) {
        setEntities([]);
        return;
      }
      try {
        const entityRes = await listLegalEntities();
        if (cancelled) return;
        setEntities(entityRes?.rows || []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || l("Failed to load references.", "Referanslar yuklenemedi."));
        }
      }
    }
    loadEntities();
    return () => {
      cancelled = true;
    };
  }, [canReadOrgTree, l]);

  useEffect(() => {
    let cancelled = false;
    async function loadScopedRefs() {
      if (!canReadOrgTree && !canReadBooks && !canReadAccounts) {
        setBooks([]);
        setAccounts([]);
        setUnits([]);
        return;
      }

      // Wait for legal entity selection to avoid initial double-fetch flicker.
      if (canReadOrgTree && !selectedLegalEntityId) {
        setBooks([]);
        setAccounts([]);
        setUnits([]);
        return;
      }

      setLoadingRefs(true);
      setError("");
      try {
        const [bookRes, accountRes, unitRes] = await Promise.all([
          canReadBooks
            ? listBooks(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {})
            : Promise.resolve({ rows: [] }),
          canReadAccounts
            ? listAccounts(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {})
            : Promise.resolve({ rows: [] }),
          canReadOrgTree
            ? listOperatingUnits(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {})
            : Promise.resolve({ rows: [] }),
        ]);
        if (cancelled) return;
        setBooks(bookRes?.rows || []);
        setAccounts(accountRes?.rows || []);
        setUnits(unitRes?.rows || []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || l("Failed to load references.", "Referanslar yuklenemedi."));
        }
      } finally {
        if (!cancelled) setLoadingRefs(false);
      }
    }
    loadScopedRefs();
    return () => {
      cancelled = true;
    };
  }, [canReadOrgTree, canReadBooks, canReadAccounts, selectedLegalEntityId, l]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistoryBooks() {
      if (!canReadBooks) {
        setHistoryBooks([]);
        return;
      }

      setError("");
      try {
        const historyLegalEntityId = toInt(historyFilters.legalEntityId);
        const res = await listBooks(
          historyLegalEntityId ? { legalEntityId: historyLegalEntityId } : {}
        );
        if (cancelled) return;

        const rows = res?.rows || [];
        setHistoryBooks(rows);
        setHistoryFilters((prev) => {
          const historyBookId = toInt(prev.bookId);
          if (!historyBookId || hasId(rows, historyBookId)) {
            return prev;
          }
          return {
            ...prev,
            bookId: "",
            fiscalPeriodId: "",
          };
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              l("Failed to load history books.", "Gecmis defterleri yuklenemedi.")
          );
        }
      }
    }

    loadHistoryBooks();
    return () => {
      cancelled = true;
    };
  }, [canReadBooks, historyFilters.legalEntityId, l, setHistoryFilters]);

  useEffect(() => {
    let cancelled = false;
    async function loadPeriodsByBook() {
      if (!canReadPeriods || !selectedBookId) {
        setPeriods([]);
        return;
      }
      const book = books.find((row) => Number(row.id) === selectedBookId);
      const calendarId = toInt(book?.calendar_id);
      if (!calendarId) {
        setPeriods([]);
        return;
      }
      setLoadingPeriods(true);
      try {
        const res = await listFiscalPeriods(calendarId);
        if (cancelled) return;
        const rows = res?.rows || [];
        setPeriods(rows);
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message || l("Failed to load fiscal periods.", "Mali donemler yuklenemedi.")
          );
        }
      } finally {
        if (!cancelled) setLoadingPeriods(false);
      }
    }
    loadPeriodsByBook();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, selectedBookId, books, l]);

  useEffect(() => {
    setJournal((prev) => {
      const currentEntityId = toInt(prev.legalEntityId);
      const currentBookId = toInt(prev.bookId);
      const nextEntityId =
        currentEntityId && (entities.length === 0 || hasId(entities, currentEntityId))
          ? String(currentEntityId)
          : String(entities[0]?.id || prev.legalEntityId || "");
      const nextBookId =
        currentBookId && (books.length === 0 || hasId(books, currentBookId))
          ? String(currentBookId)
          : String(books[0]?.id || prev.bookId || "");
      return { ...prev, legalEntityId: nextEntityId, bookId: nextBookId };
    });

    setTbForm((prev) => {
      const currentBookId = toInt(prev.bookId);
      return {
        ...prev,
        bookId:
          currentBookId && (books.length === 0 || hasId(books, currentBookId))
            ? String(currentBookId)
            : String(books[0]?.id || prev.bookId || ""),
      };
    });

    setPeriodForm((prev) => {
      const currentBookId = toInt(prev.bookId);
      return {
        ...prev,
        bookId:
          currentBookId && (books.length === 0 || hasId(books, currentBookId))
            ? String(currentBookId)
            : String(books[0]?.id || prev.bookId || ""),
      };
    });

    setHistoryFilters((prev) => {
      const currentEntityId = toInt(prev.legalEntityId);
      const currentBookId = toInt(prev.bookId);
      return {
        ...prev,
        legalEntityId:
          currentEntityId && (entities.length === 0 || hasId(entities, currentEntityId))
            ? String(currentEntityId)
            : String(entities[0]?.id || prev.legalEntityId || ""),
        bookId:
          currentBookId && (books.length === 0 || hasId(books, currentBookId))
            ? String(currentBookId)
            : String(books[0]?.id || prev.bookId || ""),
      };
    });

    setComplianceFilters((prev) => {
      const currentEntityId = toInt(prev.legalEntityId);
      return {
        ...prev,
        legalEntityId:
          currentEntityId && (entities.length === 0 || hasId(entities, currentEntityId))
            ? String(currentEntityId)
            : String(entities[0]?.id || prev.legalEntityId || ""),
      };
    });

    setLines((prev) =>
      prev.map((line, index) => ({
        ...line,
        accountId:
          line.accountId ||
          String(postableAccounts[index]?.id || postableAccounts[0]?.id || ""),
        operatingUnitId: line.operatingUnitId || String(units[0]?.id || ""),
        subledgerReferenceNo: line.subledgerReferenceNo || "",
        currencyCode: line.currencyCode || journal.currencyCode || "USD",
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, books, postableAccounts, units]);

  useEffect(() => {
    setTbForm((prev) => {
      const periodId = toInt(prev.fiscalPeriodId);
      if (periodId && hasId(periods, periodId)) return prev;
      return { ...prev, fiscalPeriodId: String(periods[0]?.id || prev.fiscalPeriodId || "") };
    });
    setPeriodForm((prev) => {
      const periodId = toInt(prev.periodId);
      if (periodId && hasId(periods, periodId)) return prev;
      return { ...prev, periodId: String(periods[0]?.id || prev.periodId || "") };
    });
  }, [periods]);

  useEffect(() => {
    setJournal((prev) => {
      const nextPeriodId = resolvedCreatePeriodId ? String(resolvedCreatePeriodId) : "";
      if (String(prev.fiscalPeriodId || "") === nextPeriodId) {
        return prev;
      }
      return {
        ...prev,
        fiscalPeriodId: nextPeriodId,
      };
    });
  }, [resolvedCreatePeriodId]);

  useEffect(() => {
    let cancelled = false;

    async function loadCreateAccountBalances() {
      if (!canReadTrialBalance || !selectedBookId || !resolvedCreatePeriodId) {
        setCreateAccountBalanceRows([]);
        return;
      }

      setLoadingCreateAccountBalances(true);
      try {
        const res = await getTrialBalance({
          bookId: selectedBookId,
          fiscalPeriodId: resolvedCreatePeriodId,
          includeRollup: false,
        });
        if (cancelled) return;
        setCreateAccountBalanceRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch {
        if (!cancelled) {
          setCreateAccountBalanceRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingCreateAccountBalances(false);
        }
      }
    }

    loadCreateAccountBalances();
    return () => {
      cancelled = true;
    };
  }, [canReadTrialBalance, selectedBookId, resolvedCreatePeriodId]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistoryPeriodsByBook() {
      const historyBookId = toInt(historyFilters.bookId);
      if (!canReadPeriods || !historyBookId) {
        setHistoryPeriods([]);
        setHistoryFilters((prev) => ({
          ...prev,
          fiscalPeriodId: "",
        }));
        return;
      }

      const book = historyBooks.find((row) => Number(row.id) === historyBookId);
      const calendarId = toInt(book?.calendar_id);
      if (!calendarId) {
        setHistoryPeriods([]);
        setHistoryFilters((prev) => ({
          ...prev,
          fiscalPeriodId: "",
        }));
        return;
      }

      setLoadingHistoryPeriods(true);
      try {
        const res = await listFiscalPeriods(calendarId);
        if (cancelled) return;

        const rows = res?.rows || [];
        setHistoryPeriods(rows);
        setHistoryFilters((prev) => {
          const periodId = toInt(prev.fiscalPeriodId);
          if (periodId && hasId(rows, periodId)) {
            return prev;
          }
          return {
            ...prev,
            fiscalPeriodId: "",
          };
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              l("Failed to load history period options.", "Gecmis donem secenekleri yuklenemedi.")
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingHistoryPeriods(false);
        }
      }
    }

    loadHistoryPeriodsByBook();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, historyBooks, historyFilters.bookId, l, setHistoryFilters]);

  async function fetchJournalHistory(filters = historyFilters) {
    if (!canReadJournals) return;
    setLoadingHistory(true);
    setError("");
    try {
      const params = {
        legalEntityId: toInt(filters.legalEntityId) || undefined,
        bookId: toInt(filters.bookId) || undefined,
        fiscalPeriodId: toInt(filters.fiscalPeriodId) || undefined,
        status: filters.status || undefined,
        limit: toInt(filters.limit) || 50,
        offset:
          Number.isInteger(Number(filters.offset)) && Number(filters.offset) >= 0
            ? Number(filters.offset)
            : 0,
      };
      const res = await listJournals(params);
      setHistoryRows(res?.rows || []);
      setHistoryTotal(Number(res?.total || 0));
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load journal history.", "Fis gecmisi yuklenemedi."));
    } finally {
      setLoadingHistory(false);
    }
  }

  async function onApplyHistoryFilters(event) {
    event.preventDefault();
    const nextFilters = {
      ...historyFilters,
      offset: "0",
    };
    setHistoryFilters(nextFilters);
    await fetchJournalHistory(nextFilters);
  }

  async function onApplyComplianceFilters(event) {
    event.preventDefault();
    await loadComplianceIssues(complianceFilters);
  }

  async function onChangeHistoryPage(direction) {
    const nextOffset = Math.max(0, historyOffset + direction * historyLimit);
    const nextFilters = {
      ...historyFilters,
      offset: String(nextOffset),
    };
    setHistoryFilters(nextFilters);
    await fetchJournalHistory(nextFilters);
  }

  function onToggleHistoryRowSelection(journalId, checked) {
    const idText = String(journalId || "");
    setSelectedHistoryJournalIds((prev) => {
      if (checked) {
        if (prev.includes(idText)) return prev;
        return [...prev, idText];
      }
      return prev.filter((id) => id !== idText);
    });
  }

  function onToggleSelectAllDraftRows(checked) {
    if (!checked) {
      setSelectedHistoryJournalIds([]);
      return;
    }
    setSelectedHistoryJournalIds(draftHistoryRows.map((row) => String(row.id)));
  }

  function openPostConfirm(rows, options = {}) {
    const uniqueRows = [];
    const seenIds = new Set();
    for (const row of rows || []) {
      const summary = toJournalSummary(row);
      if (!summary || seenIds.has(summary.id)) {
        continue;
      }
      seenIds.add(summary.id);
      uniqueRows.push(summary);
    }

    if (uniqueRows.length === 0) {
      setError(l("No journal selected for posting.", "Post etmek icin fis secilmedi."));
      return false;
    }

    const nonDraftRows = uniqueRows.filter((row) => !isDraftStatus(row.status));
    if (nonDraftRows.length > 0) {
      setError(
        l(
          `Only DRAFT journals can be posted. Invalid IDs: ${nonDraftRows.map((row) => row.id).join(", ")}`,
          `Yalnizca DRAFT fisler post edilebilir. Gecersiz ID: ${nonDraftRows.map((row) => row.id).join(", ")}`
        )
      );
      return false;
    }

    setError("");
    setPostConfirmState({
      open: true,
      rows: uniqueRows,
      postLinkedMirrors: Boolean(options.postLinkedMirrors ?? false),
    });
    return true;
  }

  function closePostConfirm() {
    if (saving === "postJournal") return;
    setPostConfirmState((prev) => ({
      ...prev,
      open: false,
      rows: [],
    }));
  }

  async function runPostJournals(journalIds, includeLinkedMirrors) {
    const ids = [...new Set((journalIds || []).map((id) => toInt(id)).filter(Boolean))];
    if (ids.length === 0) {
      setError(l("No journal selected for posting.", "Post etmek icin fis secilmedi."));
      return;
    }

    setSaving("postJournal");
    setError("");
    setMessage("");
    try {
      const postedIdSet = new Set();
      let failedCount = 0;
      const failedItems = [];
      let syncedShareholderCount = 0;
      let syncedCommitmentAmount = 0;

      for (const journalId of ids) {
        try {
          const res = await postJournal(journalId, {
            postLinkedMirrors: Boolean(includeLinkedMirrors),
          });
          if (res?.posted) {
            const postedIds = Array.isArray(res?.postedJournalIds)
              ? res.postedJournalIds.filter((id) => toInt(id))
              : [journalId];
            postedIds.forEach((id) => postedIdSet.add(Number(id)));

            const commitmentSyncRows = Array.isArray(res?.shareholderCommitmentSync)
              ? res.shareholderCommitmentSync
              : [];
            const appliedCommitmentSyncRows = commitmentSyncRows.filter(
              (row) => Boolean(row?.applied) && Number(row?.shareholderCount || 0) > 0
            );
            syncedShareholderCount += appliedCommitmentSyncRows.reduce(
              (sum, row) => sum + Number(row?.shareholderCount || 0),
              0
            );
            syncedCommitmentAmount += appliedCommitmentSyncRows.reduce(
              (sum, row) => sum + Number(row?.totalAmount || 0),
              0
            );
          } else {
            failedCount += 1;
            failedItems.push(`#${journalId}`);
          }
        } catch (err) {
          failedCount += 1;
          failedItems.push(`#${journalId}`);
          if (failedItems.length <= 3) {
            const errorMessage = err?.response?.data?.message || err?.message || "Unknown error";
            failedItems[failedItems.length - 1] = `#${journalId} (${errorMessage})`;
          }
        }
      }

      const postedIds = [...postedIdSet];
      if (postedIds.length > 0) {
        const commitmentSyncSuffix =
          syncedShareholderCount > 0
            ? l(
                ` Shareholder commitment sync applied: ${syncedShareholderCount} shareholder(s), ${formatAmount(
                  syncedCommitmentAmount
                )}.`,
                ` Ortak taahhut senkronu uygulandi: ${syncedShareholderCount} ortak, ${formatAmount(
                  syncedCommitmentAmount
                )}.`
              )
            : "";
        const partialSuffix =
          failedCount > 0
            ? l(
                ` ${failedCount} journal(s) failed.`,
                ` ${failedCount} fis post edilemedi.`
              )
            : "";
        setMessage(
          l(
            postedIds.length > 1
              ? `Journals posted: ${postedIds.join(", ")}.${commitmentSyncSuffix}${partialSuffix}`
              : `Journal posted.${commitmentSyncSuffix}${partialSuffix}`,
            postedIds.length > 1
              ? `Fisler post edildi: ${postedIds.join(", ")}.${commitmentSyncSuffix}${partialSuffix}`
              : `Fis post edildi.${commitmentSyncSuffix}${partialSuffix}`
          )
        );
      } else {
        setMessage(l("Journal not posted.", "Fis post edilmedi."));
      }

      if (failedCount > 0) {
        setError(
          l(
            `Failed to post ${failedCount} journal(s). ${failedItems.join("; ")}`,
            `${failedCount} fis post edilemedi. ${failedItems.join("; ")}`
          )
        );
      }

      if (canReadJournals) {
        await fetchJournalHistory({ ...historyFilters, offset: "0" });
        const selectedId = toInt(selectedJournalId);
        if (selectedId && postedIdSet.has(selectedId)) {
          await loadJournalDetail(selectedId);
        }
      }

      setSelectedHistoryJournalIds((prev) =>
        prev.filter((id) => !postedIdSet.has(Number(id)))
      );
      setPostConfirmState((prev) => ({
        ...prev,
        open: false,
        rows: [],
      }));
    } finally {
      setSaving("");
    }
  }

  async function onOpenDraftQueue() {
    const nextFilters = {
      ...historyFilters,
      status: "DRAFT",
      offset: "0",
    };
    setHistoryFilters(nextFilters);
    setSelectedHistoryJournalIds([]);
    await fetchJournalHistory(nextFilters);
  }

  async function onOpenAllStatusesQueue() {
    const nextFilters = {
      ...historyFilters,
      status: "",
      offset: "0",
    };
    setHistoryFilters(nextFilters);
    setSelectedHistoryJournalIds([]);
    await fetchJournalHistory(nextFilters);
  }

  function onOpenSinglePostConfirm(row) {
    openPostConfirm([row], { postLinkedMirrors: false });
  }

  function onOpenBulkPostConfirm() {
    if (selectedDraftHistoryRows.length === 0) {
      setError(l("Select at least one DRAFT journal.", "En az bir DRAFT fis secin."));
      return;
    }
    openPostConfirm(selectedDraftHistoryRows, {
      postLinkedMirrors: false,
    });
  }

  async function onConfirmPostFromModal() {
    if (!postConfirmState.open || postConfirmState.rows.length === 0) {
      return;
    }
    await runPostJournals(
      postConfirmState.rows.map((row) => row.id),
      postConfirmState.postLinkedMirrors
    );
  }

  const loadJournalDetail = useCallback(async (journalId) => {
    const parsedId = toInt(journalId);
    if (!parsedId || !canReadJournals) return;
    setSaving("journalDetail");
    setError("");
    try {
      const res = await getJournal(parsedId);
      setSelectedJournalId(String(parsedId));
      setSelectedJournal(res?.row || null);
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load journal detail.", "Fis detayi yuklenemedi."));
    } finally {
      setSaving("");
    }
  }, [canReadJournals, l]);

  useEffect(() => {
    if (!deepLinkedJournalIdRaw || deepLinkedJournalId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("journalId");
    nextParams.delete("journal_id");
    setSearchParams(nextParams, { replace: true });
  }, [
    deepLinkedJournalId,
    deepLinkedJournalIdRaw,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    const previousDeepLinkedJournalId = toInt(lastObservedUrlJournalIdRef.current);
    const currentDeepLinkedJournalId = toInt(deepLinkedJournalId);
    const deepLinkChanged =
      Number(previousDeepLinkedJournalId || 0) !==
      Number(currentDeepLinkedJournalId || 0);
    lastObservedUrlJournalIdRef.current = currentDeepLinkedJournalId || null;
    if (!canReadJournals || !currentDeepLinkedJournalId) {
      pendingUrlSelectionJournalIdRef.current = null;
      return;
    }
    if (!deepLinkChanged) {
      return;
    }
    if (toInt(selectedJournalId) === currentDeepLinkedJournalId) {
      pendingUrlSelectionJournalIdRef.current = null;
      return;
    }
    pendingUrlSelectionJournalIdRef.current = currentDeepLinkedJournalId;
    setSelectedJournalId(String(currentDeepLinkedJournalId));
    setSelectedJournal((previous) =>
      toInt(previous?.id) === currentDeepLinkedJournalId ? previous : null
    );
    void loadJournalDetail(currentDeepLinkedJournalId);
  }, [
    canReadJournals,
    deepLinkedJournalId,
    loadJournalDetail,
    selectedJournalId,
  ]);

  useEffect(() => {
    const selectedId = toInt(selectedJournalId);
    const currentId = toInt(
      searchParams.get("journalId") || searchParams.get("journal_id")
    );
    const pendingUrlSelectionId = toInt(
      pendingUrlSelectionJournalIdRef.current
    );
    if (deepLinkedJournalId && !selectedId) {
      return;
    }
    if (selectedId === currentId) {
      if (pendingUrlSelectionId && selectedId === pendingUrlSelectionId) {
        pendingUrlSelectionJournalIdRef.current = null;
      }
      return;
    }
    if (pendingUrlSelectionId && currentId === pendingUrlSelectionId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    if (selectedId) {
      nextParams.set("journalId", String(selectedId));
    } else {
      nextParams.delete("journalId");
    }
    nextParams.delete("journal_id");
    setSearchParams(nextParams, { replace: true });
  }, [
    deepLinkedJournalId,
    searchParams,
    selectedJournalId,
    setSearchParams,
  ]);

  function applyEntityFlagSnapshot(snapshot) {
    const entityId = toInt(snapshot?.legal_entity_id);
    if (!entityId) {
      return;
    }

    setEntities((prev) =>
      prev.map((entity) =>
        Number(entity.id) === Number(entityId)
          ? {
              ...entity,
              is_intercompany_enabled: snapshot.is_intercompany_enabled,
              intercompany_partner_required: snapshot.intercompany_partner_required,
            }
          : entity
      )
    );
  }

  async function refreshIntercompanyFlagSnapshot(legalEntityId) {
    const parsedId = toInt(legalEntityId);
    if (!parsedId || !canReadIntercompanyFlags) {
      return;
    }

    const response = await listIntercompanyEntityFlags({ legalEntityId: parsedId });
    const row = response?.rows?.[0];
    if (row) {
      applyEntityFlagSnapshot(row);
    }
  }

  async function loadComplianceIssues(filters = complianceFilters) {
    if (!canReadIntercompanyFlags) {
      return;
    }

    setSaving("complianceAudit");
    setError("");
    try {
      const response = await listIntercompanyComplianceIssues({
        legalEntityId: toInt(filters.legalEntityId) || undefined,
        fiscalPeriodId: toInt(filters.fiscalPeriodId) || undefined,
        includeDraft: Boolean(filters.includeDraft),
        limit: toInt(filters.limit) || 200,
      });

      setComplianceRows(response?.rows || []);
      setComplianceSummary(response?.summary || null);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l(
            "Failed to load intercompany compliance issues.",
            "Intercompany uyumluluk sorunlari yuklenemedi."
          )
      );
    } finally {
      setSaving("");
    }
  }

  async function resolveComplianceIssue(issue, actionCode) {
    if (!issue || !actionCode) {
      return;
    }

    setSaving(`compliance:${actionCode}`);
    setError("");
    setMessage("");
    try {
      if (actionCode === "ENABLE_ENTITY_INTERCOMPANY") {
        const legalEntityId = toInt(issue.fromLegalEntityId);
        if (!legalEntityId) {
          throw new Error("fromLegalEntityId is required");
        }
        if (!canUpsertIntercompanyFlags) {
          throw new Error(l("Missing permission: intercompany.flag.upsert", "Eksik yetki: intercompany.flag.upsert"));
        }

        const response = await updateIntercompanyEntityFlags(legalEntityId, {
          isIntercompanyEnabled: true,
        });
        if (response?.row) {
          applyEntityFlagSnapshot(response.row);
        } else {
          await refreshIntercompanyFlagSnapshot(legalEntityId);
        }

        setMessage(
          l(
            `Enabled intercompany for legal entity ${issue.fromLegalEntityCode || legalEntityId}.`,
            `Istirak / bagli ortak ${issue.fromLegalEntityCode || legalEntityId} icin intercompany aktif edildi.`
          )
        );
      } else if (actionCode === "DISABLE_PARTNER_REQUIRED") {
        const legalEntityId = toInt(issue.fromLegalEntityId);
        if (!legalEntityId) {
          throw new Error("fromLegalEntityId is required");
        }
        if (!canUpsertIntercompanyFlags) {
          throw new Error(l("Missing permission: intercompany.flag.upsert", "Eksik yetki: intercompany.flag.upsert"));
        }

        const response = await updateIntercompanyEntityFlags(legalEntityId, {
          intercompanyPartnerRequired: false,
        });
        if (response?.row) {
          applyEntityFlagSnapshot(response.row);
        } else {
          await refreshIntercompanyFlagSnapshot(legalEntityId);
        }

        setMessage(
          l(
            `Disabled partner-required policy for legal entity ${issue.fromLegalEntityCode || legalEntityId}.`,
            `Istirak / bagli ortak ${issue.fromLegalEntityCode || legalEntityId} icin partner-zorunlu politikasi kapatildi.`
          )
        );
      } else if (actionCode === "CREATE_ACTIVE_PAIR") {
        const fromLegalEntityId = toInt(issue.fromLegalEntityId);
        const toLegalEntityId = toInt(issue.toLegalEntityId);
        if (!fromLegalEntityId || !toLegalEntityId) {
          throw new Error("fromLegalEntityId and toLegalEntityId are required");
        }
        if (!canUpsertIntercompanyPairs) {
          throw new Error(l("Missing permission: intercompany.pair.upsert", "Eksik yetki: intercompany.pair.upsert"));
        }

        await upsertIntercompanyPair({
          fromLegalEntityId,
          toLegalEntityId,
          status: "ACTIVE",
        });

        setMessage(
          l(
            `Created/updated active pair ${issue.fromLegalEntityCode || fromLegalEntityId} -> ${issue.toLegalEntityCode || toLegalEntityId}.`,
            `Aktif pair ${issue.fromLegalEntityCode || fromLegalEntityId} -> ${issue.toLegalEntityCode || toLegalEntityId} olusturuldu/guncellendi.`
          )
        );
      }

      await loadComplianceIssues();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          l("Failed to remediate compliance issue.", "Uyumluluk sorunu duzeltilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  function updateLine(lineId, field, value) {
    setLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, [field]: value } : line))
    );
  }

  function normalizeLineForAccountScope(line, nextAccountIdRaw = line.accountId) {
    const nextAccountId = String(nextAccountIdRaw || "");
    if (!isCentralEquityAccountId(nextAccountId)) {
      return {
        ...line,
        accountId: nextAccountId,
      };
    }
    return {
      ...line,
      accountId: nextAccountId,
      operatingUnitId: "",
      subledgerReferenceNo: "",
    };
  }

  function applyCreateLineOperatingUnitSelection(line, nextOperatingUnitId) {
    if (isCentralEquityAccountId(line.accountId)) {
      return {
        ...line,
        operatingUnitId: "",
        subledgerReferenceNo: "",
      };
    }
    const normalizedOperatingUnitId = String(nextOperatingUnitId || "");
    if (!toOptionalInt(normalizedOperatingUnitId)) {
      return {
        ...line,
        operatingUnitId: normalizedOperatingUnitId,
        subledgerReferenceNo: "",
      };
    }
    return {
      ...line,
      operatingUnitId: normalizedOperatingUnitId,
    };
  }

  function updateLineAccount(lineId, nextAccountId) {
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId ? normalizeLineForAccountScope(line, nextAccountId) : line
      )
    );
  }

  function updateLineOperatingUnit(lineId, nextOperatingUnitId) {
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId ? applyCreateLineOperatingUnitSelection(line, nextOperatingUnitId) : line
      )
    );
  }

  function resolveCreateLineBalanceAmount(accountIdRaw) {
    if (
      !canReadTrialBalance ||
      !selectedBookId ||
      !resolvedCreatePeriodId ||
      loadingCreateAccountBalances
    ) {
      return null;
    }
    const accountId = toInt(accountIdRaw);
    if (!accountId) {
      return null;
    }
    const balance = Number(createAccountBalanceById.get(accountId) || 0);
    return Number.isFinite(balance) ? balance : null;
  }

  function resolveCreateLineApplySide(lineId, preferredSide = "") {
    const normalizedPreferredSide = String(preferredSide || "").trim().toLowerCase();
    if (normalizedPreferredSide === "debit" || normalizedPreferredSide === "credit") {
      return normalizedPreferredSide;
    }
    const focusedSide = String(createLineAmountFocusById[lineId] || "")
      .trim()
      .toLowerCase();
    if (focusedSide === "debit" || focusedSide === "credit") {
      return focusedSide;
    }
    return "debit";
  }

  function applyCreateLineBalance(lineId, preferredSide = "") {
    const side = resolveCreateLineApplySide(lineId, preferredSide);
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) {
          return line;
        }
        const balance = resolveCreateLineBalanceAmount(line.accountId);
        if (balance === null) {
          return line;
        }
        const absolute = Math.abs(balance);
        return {
          ...line,
          debitBase: formatInputAmount(side === "debit" ? absolute : 0),
          creditBase: formatInputAmount(side === "credit" ? absolute : 0),
        };
      })
    );
  }

  function handleCreateLineBalanceShortcut(event, lineId, side) {
    const isApplyShortcut =
      event.altKey && String(event.key || "").toLowerCase() === "k";
    if (!isApplyShortcut) {
      return;
    }
    event.preventDefault();
    applyCreateLineBalance(lineId, side);
  }

  function addLine() {
    setLines((prev) => {
      const defaultAccountId = String(postableAccounts[0]?.id || "");
      const nextLine = normalizeLineForAccountScope(
        createLine(journal.currencyCode || "USD", defaultAccountId, ""),
        defaultAccountId
      );
      return [
        ...prev,
        applyCreateLineOperatingUnitSelection(nextLine, String(units[0]?.id || "")),
      ];
    });
  }

  function removeLine(lineId) {
    setLines((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((line) => line.id !== lineId);
    });
  }

  function formatCreateLineAccountBalance(accountIdRaw) {
    if (!canReadTrialBalance) {
      return l("No permission", "Yetki yok");
    }
    if (!resolvedCreatePeriodId) {
      return l("Select period date", "Donem tarihi secin");
    }
    if (loadingCreateAccountBalances) {
      return l("Loading...", "Yukleniyor...");
    }

    const accountId = toInt(accountIdRaw);
    const balance = accountId ? Number(createAccountBalanceById.get(accountId) || 0) : 0;
    return formatMoneyText(balance, selectedBookBaseCurrencyCode);
  }

  function exitEditMode() {
    setEditingDraftId("");
  }

  function hydrateEditorFromDraft(draftRow) {
    const draftId = toInt(draftRow?.id);
    if (!draftId) {
      throw new Error("Draft id is required");
    }
    if (!isDraftStatus(draftRow?.status)) {
      throw new Error("Only DRAFT journals can be edited");
    }

    setJournal((prev) => ({
      ...prev,
      legalEntityId: String(draftRow?.legal_entity_id || ""),
      bookId: String(draftRow?.book_id || ""),
      fiscalPeriodId: String(draftRow?.fiscal_period_id || ""),
      entryDate: toDateOnly(draftRow?.entry_date) || prev.entryDate,
      documentDate: toDateOnly(draftRow?.document_date) || prev.documentDate,
      currencyCode: String(draftRow?.currency_code || prev.currencyCode || "USD").toUpperCase(),
      sourceType: String(draftRow?.source_type || "MANUAL").toUpperCase(),
      description: String(draftRow?.description || ""),
      referenceNo: String(draftRow?.reference_no || ""),
    }));

    const sourceLines = Array.isArray(draftRow?.lines) ? draftRow.lines : [];
    const mappedLines = sourceLines.map((line) =>
      mapJournalLineToEditorLine(
        line,
        String(draftRow?.currency_code || journal.currencyCode || "USD").toUpperCase()
      )
    );
    const safeLines = mappedLines.length >= 2 ? mappedLines : [createLine(), createLine()];
    setLines(safeLines);
    setEditingDraftId(String(draftId));
  }

  async function onLoadDraftIntoEditor(journalId) {
    if (!canUpdateDraft) {
      setError(l("Missing permission: gl.journal.update", "Eksik yetki: gl.journal.update"));
      return;
    }

    const parsedId = toInt(journalId);
    if (!parsedId) {
      setError(l("journalId is required.", "journalId zorunludur."));
      return;
    }

    setSaving("loadDraftForEdit");
    setError("");
    setMessage("");
    try {
      const res = await getJournal(parsedId);
      const draftRow = res?.row;
      if (!draftRow || !isDraftStatus(draftRow?.status)) {
        throw new Error(l("Only DRAFT journals can be edited.", "Yalnizca DRAFT fisler duzenlenebilir."));
      }
      hydrateEditorFromDraft(draftRow);
      setSelectedJournalId(String(parsedId));
      setSelectedJournal(draftRow);
      setMessage(
        l(
          `Draft loaded into editor. Journal ID: ${parsedId}`,
          `Taslak editore yuklendi. Fis ID: ${parsedId}`
        )
      );
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || l("Failed to load draft.", "Taslak yuklenemedi."));
    } finally {
      setSaving("");
    }
  }

  async function onCancelDraft(journalId) {
    if (!canCancelDraft) {
      setError(l("Missing permission: gl.journal.cancel", "Eksik yetki: gl.journal.cancel"));
      return;
    }

    const parsedId = toInt(journalId);
    if (!parsedId) {
      setError(l("journalId is required.", "journalId zorunludur."));
      return;
    }

    const reason = window.prompt(
      l(
        "Cancel reason is required. Enter reason:",
        "Iptal nedeni zorunludur. Lutfen neden girin:"
      )
    );
    if (reason === null) {
      return;
    }
    const reasonText = String(reason || "").trim();
    if (!reasonText) {
      setError(l("Cancel reason is required.", "Iptal nedeni zorunludur."));
      return;
    }

    setSaving("cancelJournalDraft");
    setError("");
    setMessage("");
    try {
      await cancelJournalDraft(parsedId, { reason: reasonText });
      if (editingDraftJournalId === parsedId) {
        exitEditMode();
      }
      setSelectedHistoryJournalIds((prev) => prev.filter((id) => Number(id) !== parsedId));
      setMessage(
        l(
          `Draft cancelled. Journal ID: ${parsedId}`,
          `Taslak iptal edildi. Fis ID: ${parsedId}`
        )
      );

      if (canReadJournals) {
        await fetchJournalHistory(historyFilters);
        if (selectedJournalId === String(parsedId)) {
          await loadJournalDetail(parsedId);
        }
      }
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to cancel draft journal.", "Taslak fis iptal edilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onCreateJournal(event) {
    event.preventDefault();
    const updateJournalId = toInt(editingDraftId);
    if (updateJournalId ? !canUpdateDraft : !canCreate) {
      setError(
        updateJournalId
          ? l("Missing permission: gl.journal.update", "Eksik yetki: gl.journal.update")
          : l("Missing permission: gl.journal.create", "Eksik yetki: gl.journal.create")
      );
      return;
    }

    const legalEntityId = toInt(journal.legalEntityId);
    const bookId = toInt(journal.bookId);
    const fiscalPeriodId = resolvedCreatePeriodId;
    const periodDate = String(journal.entryDate || "").trim();
    if (!legalEntityId || !bookId) {
      setError(
        l(
          "legalEntityId and bookId are required.",
          "legalEntityId ve bookId zorunludur."
        )
      );
      return;
    }
    if (!periodDate) {
      setError(l("Period date is required.", "Donem tarihi zorunludur."));
      return;
    }
    if (!fiscalPeriodId) {
      setError(
        l(
          "No fiscal period matches the selected period date.",
          "Secilen donem tarihine uyan mali donem bulunamadi."
        )
      );
      return;
    }
    if (lines.length < 2) {
      setError(l("At least 2 lines are required.", "En az 2 satir gereklidir."));
      return;
    }

    const payloadLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      const row = lines[index];
      const accountId = toInt(row.accountId);
      if (!accountId) {
        setError(l(`Line ${index + 1}: accountId is required.`, `Satir ${index + 1}: accountId zorunludur.`));
        return;
      }

      const operatingUnitId = toOptionalInt(row.operatingUnitId);
      if (row.operatingUnitId && !operatingUnitId) {
        setError(
          l(
            `Line ${index + 1}: operatingUnitId must be a positive integer.`,
            `Satir ${index + 1}: operatingUnitId pozitif bir tam sayi olmali.`
          )
        );
        return;
      }
      if (operatingUnitId && isCentralEquityAccountId(accountId)) {
        setError(
          l(
            `Line ${index + 1}: operating unit is not allowed for capital/equity lines.`,
            `Satir ${index + 1}: sermaye/ozkaynak satirlarinda birim kullanilamaz.`
          )
        );
        return;
      }
      const selectedUnit = operatingUnitId ? unitsById.get(operatingUnitId) || null : null;
      const requiresSubledgerReference = Boolean(selectedUnit?.has_subledger);
      const subledgerReferenceNo = String(row.subledgerReferenceNo || "").trim();
      if (subledgerReferenceNo && !operatingUnitId) {
        setError(
          l(
            `Line ${index + 1}: subledger reference requires operating unit.`,
            `Satir ${index + 1}: alt defter referansi icin birim secilmelidir.`
          )
        );
        return;
      }
      if (requiresSubledgerReference && !subledgerReferenceNo) {
        setError(
          l(
            `Line ${index + 1}: subledger reference is required for selected unit.`,
            `Satir ${index + 1}: secilen birim icin alt defter referansi zorunludur.`
          )
        );
        return;
      }
      if (subledgerReferenceNo.length > 100) {
        setError(
          l(
            `Line ${index + 1}: subledger reference must be at most 100 characters.`,
            `Satir ${index + 1}: alt defter referansi en fazla 100 karakter olabilir.`
          )
        );
        return;
      }

      const counterpartyLegalEntityId = toOptionalInt(row.counterpartyLegalEntityId);
      if (row.counterpartyLegalEntityId && !counterpartyLegalEntityId) {
        setError(
          l(
            `Line ${index + 1}: counterpartyLegalEntityId must be a positive integer.`,
            `Satir ${index + 1}: counterpartyLegalEntityId pozitif bir tam sayi olmali.`
          )
        );
        return;
      }
      if (counterpartyLegalEntityId && counterpartyLegalEntityId === legalEntityId) {
        setError(
          l(
            `Line ${index + 1}: counterparty legal entity cannot be the same as legal entity.`,
            `Satir ${index + 1}: karsi taraf istirak / bagli ortak, secili istirak / bagli ortak ile ayni olamaz.`
          )
        );
        return;
      }

      const debitBase = toAmount(row.debitBase);
      const creditBase = toAmount(row.creditBase);
      if (debitBase < 0 || creditBase < 0) {
        setError(
          l(
            `Line ${index + 1}: debit/credit cannot be negative.`,
            `Satir ${index + 1}: borc/alacak negatif olamaz.`
          )
        );
        return;
      }
      if ((debitBase === 0 && creditBase === 0) || (debitBase > 0 && creditBase > 0)) {
        setError(
          l(
            `Line ${index + 1}: exactly one side must be > 0 (debit or credit).`,
            `Satir ${index + 1}: yalnizca bir taraf > 0 olmali (borc veya alacak).`
          )
        );
        return;
      }

      payloadLines.push({
        accountId,
        operatingUnitId: operatingUnitId || undefined,
        subledgerReferenceNo: subledgerReferenceNo || undefined,
        counterpartyLegalEntityId: counterpartyLegalEntityId || undefined,
        description: row.description.trim() || undefined,
        currencyCode: String(row.currencyCode || journal.currencyCode || "USD")
          .trim()
          .toUpperCase(),
        amountTxn: toAmount(row.amountTxn),
        debitBase,
        creditBase,
        taxCode: row.taxCode.trim() || undefined,
      });
    }

    const totalDebit = payloadLines.reduce((sum, row) => sum + row.debitBase, 0);
    const totalCredit = payloadLines.reduce((sum, row) => sum + row.creditBase, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      setError(l("Journal is not balanced.", "Fis dengede degil."));
      return;
    }

    const sourceType = String(journal.sourceType || "MANUAL").toUpperCase();
    const counterpartyLineNumbers = payloadLines
      .map((line, index) => (line.counterpartyLegalEntityId ? index + 1 : null))
      .filter(Boolean);
    const missingCounterpartyLineNumbers = payloadLines
      .map((line, index) => (!line.counterpartyLegalEntityId ? index + 1 : null))
      .filter(Boolean);

    if (!selectedEntityIntercompanyEnabled) {
      if (sourceType === "INTERCOMPANY") {
        setError(
          l(
            "Selected legal entity has intercompany disabled; INTERCOMPANY source is blocked.",
            "Secili istirak / bagli ortakta intercompany kapali; INTERCOMPANY kaynak tipi engellendi."
          )
        );
        return;
      }
      if (counterpartyLineNumbers.length > 0) {
        setError(
          l(
            `Selected legal entity has intercompany disabled; remove counterparty on line(s): ${counterpartyLineNumbers.join(", ")}.`,
            `Secili istirak / bagli ortakta intercompany kapali; su satirlarda karsi taraf kaldirilmalidir: ${counterpartyLineNumbers.join(", ")}.`
          )
        );
        return;
      }
    }

    if (sourceType === "INTERCOMPANY" && counterpartyLineNumbers.length === 0) {
      setError(
        l(
          "INTERCOMPANY source requires at least one line with counterparty legal entity.",
          "INTERCOMPANY kaynak tipi en az bir satirda karsi taraf istirak / bagli ortak gerektirir."
        )
      );
      return;
    }

    if (selectedEntityPartnerRequired && sourceType === "INTERCOMPANY") {
      if (missingCounterpartyLineNumbers.length > 0) {
        setError(
          l(
            `This legal entity requires partner on INTERCOMPANY journals. Missing on line(s): ${missingCounterpartyLineNumbers.join(", ")}.`,
            `Bu istirak / bagli ortak INTERCOMPANY fislerde partner zorunlu tutar. Eksik satir(lar): ${missingCounterpartyLineNumbers.join(", ")}.`
          )
        );
        return;
      }
    }

    setSaving(updateJournalId ? "updateJournalDraft" : "createJournal");
    setError("");
    setMessage("");
    try {
      const shouldAutoMirror = sourceType === "INTERCOMPANY" ? Boolean(createAutoMirror) : false;
      if (updateJournalId) {
        await updateJournalDraft(updateJournalId, {
          legalEntityId,
          bookId,
          fiscalPeriodId,
          entryDate: periodDate,
          documentDate: journal.documentDate,
          currencyCode: journal.currencyCode.trim().toUpperCase(),
          sourceType: journal.sourceType,
          description: journal.description.trim() || undefined,
          referenceNo: journal.referenceNo.trim() || undefined,
          lines: payloadLines,
        });
        setReverseForm((prev) => ({ ...prev, journalId: String(updateJournalId) }));
        setMessage(
          l(
            `Draft journal updated. ID: ${updateJournalId}`,
            `Taslak fis guncellendi. ID: ${updateJournalId}`
          )
        );

        if (canReadJournals) {
          await fetchJournalHistory(historyFilters);
          if (selectedJournalId === String(updateJournalId)) {
            await loadJournalDetail(updateJournalId);
          }
        }
      } else {
        const res = await createJournal({
          legalEntityId,
          bookId,
          fiscalPeriodId,
          entryDate: periodDate,
          documentDate: journal.documentDate,
          currencyCode: journal.currencyCode.trim().toUpperCase(),
          sourceType: journal.sourceType,
          description: journal.description.trim() || undefined,
          referenceNo: journal.referenceNo.trim() || undefined,
          autoMirror: shouldAutoMirror,
          lines: payloadLines,
        });

        const createdId = String(res?.journalEntryId || "");
        setReverseForm((prev) => ({ ...prev, journalId: createdId }));
        const mirrorIds = Array.isArray(res?.mirrorJournalEntryIds)
          ? res.mirrorJournalEntryIds.filter((id) => toInt(id))
          : [];
        const mirrorSuffix =
          mirrorIds.length > 0
            ? l(
                `, Mirror drafts: ${mirrorIds.join(", ")}`,
                `, Mirror taslaklari: ${mirrorIds.join(", ")}`
              )
            : "";
        setMessage(
          l(
            `Draft journal created. ID: ${res?.journalEntryId || "-"}, No: ${res?.journalNo || "-"}${mirrorSuffix}`,
            `Taslak fis olusturuldu. ID: ${res?.journalEntryId || "-"}, No: ${res?.journalNo || "-"}${mirrorSuffix}`
          )
        );

        if (canReadJournals) {
          await fetchJournalHistory({ ...historyFilters, offset: "0" });
        }
      }
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          (updateJournalId
            ? l("Failed to update draft journal.", "Taslak fis guncellenemedi.")
            : l("Failed to create journal.", "Fis olusturulamadi."))
      );
    } finally {
      setSaving("");
    }
  }

  async function onReverseJournal(event) {
    event.preventDefault();
    if (!canReverse) {
      setError(l("Missing permission: gl.journal.reverse", "Eksik yetki: gl.journal.reverse"));
      return;
    }

    const journalId = toInt(reverseForm.journalId);
    if (!journalId) {
      setError(l("journalId is required.", "journalId zorunludur."));
      return;
    }
    if (isReverseBlockedForSelectedJournal) {
      setError(
        reverseBlockedMessage ||
          l(
            "Selected journal is linked to a source module. Reverse from source module.",
            "Secili fis bir kaynak module bagli. Ters kaydi kaynak modulden yapin."
          )
      );
      return;
    }

    const reversalPeriodId = toOptionalInt(reverseForm.reversalPeriodId);
    if (reverseForm.reversalPeriodId && !reversalPeriodId) {
      setError(l("reversalPeriodId must be a positive integer.", "reversalPeriodId pozitif bir tam sayi olmali."));
      return;
    }

    setSaving("reverseJournal");
    setError("");
    setMessage("");
    try {
      const res = await reverseJournal(journalId, {
        reversalPeriodId: reversalPeriodId || undefined,
        autoPost: Boolean(reverseForm.autoPost),
        reason: reverseForm.reason.trim() || undefined,
      });
      setMessage(
        l(
          `Journal reversed. Original: ${journalId}, Reversal: ${res?.reversalJournalId || "-"}`,
          `Fis ters kaydedildi. Orijinal: ${journalId}, Ters Kayit: ${res?.reversalJournalId || "-"}`
        )
      );
      if (canReadJournals) {
        await fetchJournalHistory();
        if (selectedJournalId === String(journalId)) {
          await loadJournalDetail(journalId);
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to reverse journal.", "Fis ters kaydi yapilamadi."));
    } finally {
      setSaving("");
    }
  }

  async function onTrialBalance(event) {
    event.preventDefault();
    if (!canReadTrialBalance) {
      setError(l("Missing permission: gl.trial_balance.read", "Eksik yetki: gl.trial_balance.read"));
      return;
    }

    const bookId = toInt(tbForm.bookId);
    const fiscalPeriodId = toInt(tbForm.fiscalPeriodId);
    if (!bookId || !fiscalPeriodId) {
      setError(l("bookId and fiscalPeriodId are required.", "bookId ve fiscalPeriodId zorunludur."));
      return;
    }

    setSaving("trialBalance");
    setError("");
    setMessage("");
    try {
      const res = await getTrialBalance({ bookId, fiscalPeriodId, includeRollup: true });
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      const summary = res?.summary || {};
      setTbRows(rows);
      setTbSummary({
        debitTotal: Number(summary.debitTotal || 0),
        creditTotal: Number(summary.creditTotal || 0),
        balanceTotal: Number(summary.balanceTotal || 0),
      });
      setMessage(l("Trial balance loaded.", "Mizan yuklendi."));
    } catch (err) {
      setError(err?.response?.data?.message || l("Failed to load trial balance.", "Mizan yuklenemedi."));
    } finally {
      setSaving("");
    }
  }

  async function onUpdatePeriodStatus(event) {
    event.preventDefault();
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
      return;
    }

    setSaving("periodStatus");
    setError("");
    setMessage("");
    try {
      const res = await closePeriod(bookId, periodId, {
        status: periodForm.status,
        note: periodForm.note.trim() || undefined,
      });
      setMessage(
        l(
          `Period status updated: ${res?.previousStatus || "-"} -> ${res?.status || "-"}`,
          `Donem durumu guncellendi: ${res?.previousStatus || "-"} -> ${res?.status || "-"}`
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message || l("Failed to update period status.", "Donem durumu guncellenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onLoadPeriodCloseRuns() {
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
      return;
    }

    setSaving("periodCloseRuns");
    setError("");
    try {
      const res = await listPeriodCloseRuns({
        bookId,
        fiscalPeriodId: periodId,
        includeLines: true,
      });
      setPeriodCloseRuns(res?.rows || []);
    } catch (err) {
      setError(
        err?.response?.data?.message || l("Failed to load period close runs.", "Donem kapanis calismalari yuklenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onExecutePeriodClose(event) {
    event.preventDefault();
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
      return;
    }

    const retainedEarningsAccountId = toOptionalInt(
      periodCloseForm.retainedEarningsAccountId
    );
    if (periodCloseForm.retainedEarningsAccountId && !retainedEarningsAccountId) {
      setError(
        l(
          "retainedEarningsAccountId must be a positive integer.",
          "retainedEarningsAccountId pozitif bir tam sayi olmali."
        )
      );
      return;
    }

    const requestedCashFxOverride =
      showPeriodCloseFxOverrideControls &&
      Boolean(periodCloseForm.cashFxRevaluationOverride);
    const cashFxOverrideReason = periodCloseForm.cashFxRevaluationOverrideReason.trim();
    if (requestedCashFxOverride && !cashFxOverrideReason) {
      setError(
        l(
          "cashFxRevaluationOverrideReason is required when FX override is enabled.",
          "Kur override aciksa cashFxRevaluationOverrideReason zorunludur."
        )
      );
      return;
    }

    setSaving("periodCloseRun");
    setError("");
    setMessage("");
    setPeriodCloseFxGate(null);
    try {
      const res = await runPeriodClose(bookId, periodId, {
        closeStatus: periodCloseForm.closeStatus,
        retainedEarningsAccountId: retainedEarningsAccountId || undefined,
        note: periodCloseForm.note.trim() || undefined,
        cashFxRevaluationOverride: requestedCashFxOverride || undefined,
        cashFxRevaluationOverrideReason: requestedCashFxOverride
          ? cashFxOverrideReason
          : undefined,
      });

      const runId = res?.run?.id || "-";
      const carryLineCount = Number(res?.carryForwardLineCount || 0);
      const yearEndLineCount = Number(res?.yearEndLineCount || 0);
      setPeriodCloseFxGate(null);
      setMessage(
        res?.idempotent
          ? l(
              `Period close idempotent hit. Run #${runId} reused.`,
              `Donem kapanis idempotent sonuc verdi. #${runId} tekrar kullanildi.`
            )
          : l(
              `Period close completed. Run #${runId}, carry lines=${carryLineCount}, year-end lines=${yearEndLineCount}.`,
              `Donem kapanis tamamlandi. Run #${runId}, devir satirlari=${carryLineCount}, yil sonu satirlari=${yearEndLineCount}.`
            )
      );

      await onLoadPeriodCloseRuns();
    } catch (err) {
      const fxGate = normalizePeriodCloseFxGate(err);
      if (fxGate) {
        setPeriodCloseFxGate(fxGate);
        setError("");
        return;
      }
      setPeriodCloseFxGate(null);
      setError(
        err?.response?.data?.message || l("Failed to execute period close run.", "Donem kapanis calismasi baslatilamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onReopenPeriodClose(event) {
    event.preventDefault();
    if (!canClosePeriod) {
      setError(l("Missing permission: gl.period.close", "Eksik yetki: gl.period.close"));
      return;
    }

    const bookId = toInt(periodForm.bookId);
    const periodId = toInt(periodForm.periodId);
    if (!bookId || !periodId) {
      setError(l("bookId and periodId are required.", "bookId ve periodId zorunludur."));
      return;
    }

    const reason = periodCloseForm.reopenReason.trim();
    if (!reason) {
      setError(l("reopen reason is required.", "yeniden acma nedeni zorunludur."));
      return;
    }

    setSaving("periodReopen");
    setError("");
    setMessage("");
    try {
      const res = await reopenPeriodClose(bookId, periodId, { reason });
      const reversalIds = Array.isArray(res?.reversalJournalEntryIds)
        ? res.reversalJournalEntryIds
        : [];
      setMessage(
        l(
          `Period reopened. Reversal journals: ${reversalIds.length > 0 ? reversalIds.join(", ") : "none"}.`,
          `Donem yeniden acildi. Ters fisler: ${reversalIds.length > 0 ? reversalIds.join(", ") : "yok"}.`
        )
      );
      await onLoadPeriodCloseRuns();
    } catch (err) {
      setError(
        err?.response?.data?.message || l("Failed to reopen period close run.", "Donem kapanis calismasi yeniden acilamadi.")
      );
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{l("Journal Workbench", "Fis Calisma Ekrani")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Assisted journal lines with account/unit pickers, posting/reversal, trial balance, period status, and journal history.",
            "Hesap/birim secicileri, post/ters kayit, mizan, donem durumu ve fis gecmisi ile destekli fis satirlari."
          )}
        </p>
      </div>

      {loadingRefs && (
        <div className="text-xs text-slate-500">{l("Loading references...", "Referanslar yukleniyor...")}</div>
      )}
      {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            {isEditMode
              ? l(
                  `Edit Draft Journal #${editingDraftJournalId}`,
                  `Taslak Fis Duzenle #${editingDraftJournalId}`
                )
              : l("Create Draft Journal", "Taslak Fis Olustur")}
          </h2>
          {isEditMode ? (
            <button
              type="button"
              onClick={exitEditMode}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              {l("Exit Edit Mode", "Duzenleme Modundan Cik")}
            </button>
          ) : null}
        </div>
        <form onSubmit={onCreateJournal} className="space-y-3">
          <p className="text-xs text-slate-500">
            {l(
              "Period date determines fiscal period automatically for posting. Document date is the source document date for audit/reporting.",
              "Donem tarihi, posting icin mali donemi otomatik belirler. Belge tarihi ise kaynak belgenin denetim/raporlama tarihidir."
            )}
          </p>
          <div className="grid gap-2 md:grid-cols-4">
            <Combobox
              value={journal.legalEntityId || null}
              options={legalEntityOptions}
              onChange={(nextValue) =>
                setJournal((prev) => ({
                  ...prev,
                  legalEntityId: nextValue ? String(nextValue) : "",
                }))
              }
              onInputChange={(text, { reason }) => {
                if (reason === "input") {
                  setJournal((prev) => ({
                    ...prev,
                    legalEntityId: keepDigits(text),
                  }));
                } else if (reason === "clear") {
                  setJournal((prev) => ({ ...prev, legalEntityId: "" }));
                }
              }}
              placeholder={l("Select legal entity", "Istirak / bagli ortak secin")}
              noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
              clearable={false}
            />
            <Combobox
              value={journal.bookId || null}
              options={bookOptions}
              onChange={(nextValue) =>
                setJournal((prev) => ({
                  ...prev,
                  bookId: nextValue ? String(nextValue) : "",
                }))
              }
              onInputChange={(text, { reason }) => {
                if (reason === "input") {
                  setJournal((prev) => ({
                    ...prev,
                    bookId: keepDigits(text),
                  }));
                } else if (reason === "clear") {
                  setJournal((prev) => ({ ...prev, bookId: "" }));
                }
              }}
              placeholder={l("Select book", "Defter secin")}
              noOptionsText={l("No books found.", "Defter bulunamadi.")}
              clearable={false}
            />
            <div className="space-y-1 rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="px-1 text-[11px] text-slate-500">
                {l("Resolved fiscal period", "Eslesen mali donem")}
              </span>
              <div className="px-1 text-sm text-slate-700">
                {resolvedCreatePeriod
                  ? formatPeriodLabel(resolvedCreatePeriod)
                  : l("Select period date to resolve", "Eslestirmek icin donem tarihi secin")}
              </div>
              {String(journal.entryDate || "").trim() && !resolvedCreatePeriod ? (
                <div className="px-1 text-xs text-rose-600">
                  {l(
                    "No matching fiscal period for selected period date.",
                    "Secilen donem tarihi icin eslesen mali donem yok."
                  )}
                </div>
              ) : null}
            </div>
            <input value={journal.currencyCode} onChange={(event) => setJournal((prev) => ({ ...prev, currencyCode: event.target.value.toUpperCase() }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Currency", "Para birimi")} maxLength={3} required />
            <label className="space-y-1">
              <span className="px-1 text-[11px] text-slate-500">
                {l("Period date (donem tarihi)", "Donem tarihi (muhasebe/posting)")}
              </span>
              <input type="date" value={journal.entryDate} onChange={(event) => setJournal((prev) => ({ ...prev, entryDate: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" required />
            </label>
            <label className="space-y-1">
              <span className="px-1 text-[11px] text-slate-500">
                {l("Document date", "Belge tarihi")}
              </span>
              <input type="date" value={journal.documentDate} onChange={(event) => setJournal((prev) => ({ ...prev, documentDate: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" required />
            </label>
            <Combobox
              value={journal.sourceType || null}
              options={sourceTypeOptions}
              onChange={(nextValue) =>
                setJournal((prev) => ({
                  ...prev,
                  sourceType: nextValue ? String(nextValue) : "MANUAL",
                }))
              }
              clearable={false}
            />
            <input value={journal.referenceNo} onChange={(event) => setJournal((prev) => ({ ...prev, referenceNo: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Reference no", "Referans no")} />
            <input value={journal.description} onChange={(event) => setJournal((prev) => ({ ...prev, description: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-4" placeholder={l("Description", "Aciklama")} />
          </div>

          {selectedLegalEntity ? (
            <div
              className={`rounded border px-3 py-2 text-xs ${
                selectedEntityIntercompanyEnabled
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <div>
                {l("Intercompany policy", "Intercompany politikasi")}:{" "}
                <span className="font-semibold">
                  {selectedEntityIntercompanyEnabled
                    ? l("Enabled", "Aktif")
                    : l("Disabled", "Kapali")}
                </span>
                {" | "}
                {l("Partner required", "Partner zorunlu")}:{" "}
                <span className="font-semibold">
                  {selectedEntityPartnerRequired ? l("Yes", "Evet") : l("No", "Hayir")}
                </span>
              </div>
              {!selectedEntityIntercompanyEnabled ? (
                <div className="mt-1">
                  {l(
                    "Counterparty lines and INTERCOMPANY source journals are blocked for this legal entity.",
                    "Bu istirak / bagli ortak icin karsi taraf satirlari ve INTERCOMPANY kaynakli fisler engellenir."
                  )}
                </div>
              ) : null}
              {requiresCounterpartyByPolicy ? (
                <div className="mt-1">
                  {l(
                    "Because source type is INTERCOMPANY and partner-required is enabled, every line must include counterparty legal entity.",
                    "Kaynak tipi INTERCOMPANY ve partner-zorunlu acik oldugu icin her satirda karsi taraf istirak / bagli ortak secilmelidir."
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {String(journal.sourceType || "").toUpperCase() === "INTERCOMPANY" ? (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={createAutoMirror}
                onChange={(event) => setCreateAutoMirror(event.target.checked)}
                disabled={!selectedEntityIntercompanyEnabled}
              />
              {l(
                "Auto-create partner mirror draft journal(s)",
                "Partner mirror taslak fis(lerini) otomatik olustur"
              )}
            </label>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[1260px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">{l("Account", "Hesap")}</th>
                  <th className="px-2 py-2">{l("Unit", "Birim")}</th>
                  <th className="px-2 py-2">{l("Subledger Ref", "Alt Defter Ref")}</th>
                  <th className="px-2 py-2">{l("Counterparty LE", "Karsi taraf HU")}</th>
                  <th className="px-2 py-2">{l("Description", "Aciklama")}</th>
                  <th className="px-2 py-2">{l("Currency", "Para birimi")}</th>
                  <th className="px-2 py-2">{l("Amount", "Tutar")}</th>
                  <th className="px-2 py-2">{l("Debit", "Borc")}</th>
                  <th className="px-2 py-2">{l("Credit", "Alacak")}</th>
                  <th className="px-2 py-2">{l("Tax", "Vergi")}</th>
                  <th className="px-2 py-2">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const lineDisallowsOperatingUnit = isCentralEquityAccountId(line.accountId);
                  return (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 text-slate-500">{index + 1}</td>
                    <td className="px-2 py-2">
                      <>
                        <Combobox
                          value={line.accountId || null}
                          options={postableAccountOptions}
                          clearable={false}
                          disabled={!canReadAccounts}
                          placeholder={l("Search/select account", "Hesap ara/sec")}
                          noOptionsText={l("No account found.", "Hesap bulunamadi.")}
                          inputClassName="px-2 py-1.5 pr-14 text-xs"
                          listClassName="text-xs"
                          optionClassName="text-xs"
                          renderOption={renderPostableAccountOption}
                          onChange={(nextValue) =>
                            updateLineAccount(line.id, nextValue ? String(nextValue) : "")
                          }
                          onInputChange={(text, { reason }) => {
                            if (reason === "input") {
                              updateLineAccount(line.id, keepDigits(text));
                            } else if (reason === "clear") {
                              updateLineAccount(line.id, "");
                            }
                          }}
                        />
                        <div className="mt-1 text-[10px] text-slate-500">
                          {l("Balance", "Bakiye")}:{" "}
                          <span className="font-medium text-slate-700">
                            {formatCreateLineAccountBalance(line.accountId)}
                          </span>
                          <button
                            type="button"
                            onClick={() => applyCreateLineBalance(line.id)}
                            disabled={
                              !toInt(line.accountId) ||
                              !canReadTrialBalance ||
                              !resolvedCreatePeriodId ||
                              loadingCreateAccountBalances
                            }
                            className="ml-2 rounded border border-cyan-300 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                            title={l(
                              "Apply account balance to focused debit/credit input (Alt+K)",
                              "Hesap bakiyesini odaktaki borc/alacak alanina uygula (Alt+K)"
                            )}
                          >
                            {l("Apply", "Uygula")}
                          </button>
                        </div>
                      </>
                    </td>
                    <td className="px-2 py-2">
                      <Combobox
                        value={line.operatingUnitId || null}
                        options={operatingUnitOptions}
                        onChange={(nextValue) =>
                          updateLineOperatingUnit(line.id, nextValue ? String(nextValue) : "")
                        }
                        onInputChange={(text, { reason }) => {
                          if (reason === "input") {
                            updateLineOperatingUnit(line.id, keepDigits(text));
                          } else if (reason === "clear") {
                            updateLineOperatingUnit(line.id, "");
                          }
                        }}
                        placeholder={
                          lineDisallowsOperatingUnit
                            ? l("Legal entity scope", "Tuzel kisi seviyesi")
                            : l("Optional", "Opsiyonel")
                        }
                        inputClassName="px-2 py-1.5 pr-14 text-xs"
                        listClassName="text-xs"
                        optionClassName="text-xs"
                        disabled={!canReadOrgTree || lineDisallowsOperatingUnit}
                      />
                      {lineDisallowsOperatingUnit ? (
                        <div className="mt-1 text-[10px] text-amber-700">
                          {l(
                            "Capital/equity lines post at legal-entity scope.",
                            "Sermaye/ozkaynak satirlari tuzel kisi seviyesinde kaydedilir."
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={line.subledgerReferenceNo || ""}
                        onChange={(event) =>
                          updateLine(line.id, "subledgerReferenceNo", event.target.value)
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                        placeholder={
                          lineDisallowsOperatingUnit
                            ? l("Not applicable", "Uygulanmaz")
                            : (unitsById.get(toOptionalInt(line.operatingUnitId))?.has_subledger ?? false)
                            ? l("Required", "Zorunlu")
                            : l("Optional", "Opsiyonel")
                        }
                        required={
                          !lineDisallowsOperatingUnit &&
                          (unitsById.get(toOptionalInt(line.operatingUnitId))?.has_subledger ?? false)
                        }
                        disabled={lineDisallowsOperatingUnit}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Combobox
                        value={line.counterpartyLegalEntityId || null}
                        options={counterpartyLegalEntityOptions}
                        onChange={(nextValue) =>
                          updateLine(
                            line.id,
                            "counterpartyLegalEntityId",
                            nextValue ? String(nextValue) : ""
                          )
                        }
                        onInputChange={(text, { reason }) => {
                          if (reason === "input") {
                            updateLine(
                              line.id,
                              "counterpartyLegalEntityId",
                              keepDigits(text)
                            );
                          } else if (reason === "clear") {
                            updateLine(line.id, "counterpartyLegalEntityId", "");
                          }
                        }}
                        placeholder={
                          requiresCounterpartyByPolicy
                            ? l("Required", "Zorunlu")
                            : l("Optional", "Opsiyonel")
                        }
                        inputClassName="px-2 py-1.5 pr-14 text-xs"
                        listClassName="text-xs"
                        optionClassName="text-xs"
                      />
                    </td>
                    <td className="px-2 py-2"><input value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input value={line.currencyCode} onChange={(event) => updateLine(line.id, "currencyCode", event.target.value.toUpperCase())} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" maxLength={3} /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.amountTxn} onChange={(event) => updateLine(line.id, "amountTxn", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.debitBase} onChange={(event) => updateLine(line.id, "debitBase", event.target.value)} onFocus={() => setCreateLineAmountFocusById((prev) => ({ ...prev, [line.id]: "debit" }))} onKeyDown={(event) => handleCreateLineBalanceShortcut(event, line.id, "debit")} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={line.creditBase} onChange={(event) => updateLine(line.id, "creditBase", event.target.value)} onFocus={() => setCreateLineAmountFocusById((prev) => ({ ...prev, [line.id]: "credit" }))} onKeyDown={(event) => handleCreateLineBalanceShortcut(event, line.id, "credit")} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><input value={line.taxCode} onChange={(event) => updateLine(line.id, "taxCode", event.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" /></td>
                    <td className="px-2 py-2"><button type="button" onClick={() => removeLine(line.id)} disabled={lines.length <= 2} className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50">{l("Remove", "Kaldir")}</button></td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={addLine} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{l("Add Line", "Satir Ekle")}</button>
            <div className="text-xs text-slate-700">{l("Debit", "Borc")}: {formatMoneyText(lineTotals.debit, selectedBookBaseCurrencyCode)} | {l("Credit", "Alacak")}: {formatMoneyText(lineTotals.credit, selectedBookBaseCurrencyCode)} | <span className={lineTotals.balanced ? "text-emerald-700" : "text-rose-700"}>{lineTotals.balanced ? l("Balanced", "Dengeli") : l("Not Balanced", "Dengede Degil")}</span></div>
            <button
              type="submit"
              disabled={
                (saving === "createJournal" || saving === "updateJournalDraft") ||
                (isEditMode ? !canUpdateDraft : !canCreate) ||
                !resolvedCreatePeriodId
              }
              className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "updateJournalDraft"
                ? l("Saving...", "Kaydediliyor...")
                : saving === "createJournal"
                  ? l("Creating...", "Olusturuluyor...")
                  : isEditMode
                    ? l("Save Draft", "Taslagi Kaydet")
                    : l("Create Draft", "Taslak Olustur")}
            </button>
          </div>
        </form>
      </section>

      <div className="grid gap-4">
        <form onSubmit={onReverseJournal} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">{l("Reverse Journal", "Ters Fis Kaydi")}</h2>
          <Combobox
            value={reverseForm.journalId || null}
            options={reverseJournalOptions}
            onChange={(nextValue) =>
              setReverseForm((prev) => ({
                ...prev,
                journalId: nextValue ? String(nextValue) : "",
              }))
            }
            onInputChange={(text, { reason }) => {
              if (reason === "input") {
                setReverseForm((prev) => ({
                  ...prev,
                  journalId: keepDigits(text),
                }));
              } else if (reason === "clear") {
                setReverseForm((prev) => ({ ...prev, journalId: "" }));
              }
            }}
            placeholder={l("Select journal", "Fis secin")}
            noOptionsText={l("No journals found.", "Fis bulunamadi.")}
            clearable={false}
          />
          <Combobox
            value={reverseForm.reversalPeriodId || null}
            options={periodOptions}
            onChange={(nextValue) =>
              setReverseForm((prev) => ({
                ...prev,
                reversalPeriodId: nextValue ? String(nextValue) : "",
              }))
            }
            onInputChange={(text, { reason }) => {
              if (reason === "input") {
                setReverseForm((prev) => ({
                  ...prev,
                  reversalPeriodId: keepDigits(text),
                }));
              } else if (reason === "clear") {
                setReverseForm((prev) => ({ ...prev, reversalPeriodId: "" }));
              }
            }}
            placeholder={l(
              "Reversal period (optional)",
              "Ters kayit donemi (opsiyonel)"
            )}
            noOptionsText={l("No periods found.", "Donem bulunamadi.")}
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={reverseForm.autoPost} onChange={(event) => setReverseForm((prev) => ({ ...prev, autoPost: event.target.checked }))} />{l("Auto-post reversal", "Ters kaydi otomatik post et")}</label>
          <input value={reverseForm.reason} onChange={(event) => setReverseForm((prev) => ({ ...prev, reason: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Reason (optional)", "Neden (opsiyonel)")} />
          {isReverseBlockedForSelectedJournal ? (
            <p className="text-xs text-amber-700">{reverseBlockedMessage}</p>
          ) : null}
          <button type="submit" disabled={saving === "reverseJournal" || !canReverse || isReverseBlockedForSelectedJournal} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "reverseJournal" ? l("Reversing...", "Ters kayit yapiliyor...") : l("Reverse", "Ters Kayit")}</button>
        </form>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={onTrialBalance} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">{l("Trial Balance", "Mizan")}</h2>
          <Combobox
            value={tbForm.bookId || null}
            options={bookOptions}
            onChange={(nextValue) =>
              setTbForm((prev) => ({
                ...prev,
                bookId: nextValue ? String(nextValue) : "",
                fiscalPeriodId: "",
              }))
            }
            onInputChange={(text, { reason }) => {
              if (reason === "input") {
                setTbForm((prev) => ({ ...prev, bookId: keepDigits(text) }));
              } else if (reason === "clear") {
                setTbForm((prev) => ({ ...prev, bookId: "" }));
              }
            }}
            placeholder={l("Select book", "Defter secin")}
            noOptionsText={l("No books found.", "Defter bulunamadi.")}
            clearable={false}
          />
          <Combobox
            value={tbForm.fiscalPeriodId || null}
            options={canUseTbPeriodLookup ? periodOptions : []}
            onChange={(nextValue) =>
              setTbForm((prev) => ({
                ...prev,
                fiscalPeriodId: nextValue ? String(nextValue) : "",
              }))
            }
            onInputChange={(text, { reason }) => {
              if (reason === "input") {
                setTbForm((prev) => ({
                  ...prev,
                  fiscalPeriodId: keepDigits(text),
                }));
              } else if (reason === "clear") {
                setTbForm((prev) => ({ ...prev, fiscalPeriodId: "" }));
              }
            }}
            placeholder={l("Select fiscal period", "Mali donem secin")}
            noOptionsText={l("No periods found.", "Donem bulunamadi.")}
            clearable={false}
          />
          <button type="submit" disabled={saving === "trialBalance" || !canReadTrialBalance} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "trialBalance" ? l("Loading...", "Yukleniyor...") : l("Run", "Calistir")}</button>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-2">{l("Account", "Hesap")}</th><th className="px-2 py-2">{l("Debit", "Borc")}</th><th className="px-2 py-2">{l("Credit", "Alacak")}</th><th className="px-2 py-2">{l("Balance", "Bakiye")}</th></tr></thead>
              <tbody>
                {tbRows.map((row) => <tr key={row.account_id} className={`border-t border-slate-100 ${row.is_rollup ? "bg-slate-50/60" : ""}`}><td className="px-2 py-2">{row.account_code} - {row.account_name}{row.is_rollup ? ` (${l("Roll-up", "Toplam")})` : ""}</td><td className="px-2 py-2"><MoneyText amount={row.debit_total} currencyCode={trialBalanceBookBaseCurrencyCode} /></td><td className="px-2 py-2"><MoneyText amount={row.credit_total} currencyCode={trialBalanceBookBaseCurrencyCode} /></td><td className="px-2 py-2"><MoneyText amount={row.balance} currencyCode={trialBalanceBookBaseCurrencyCode} /></td></tr>)}
                {tbRows.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-slate-500">{l("No trial balance rows.", "Mizan satiri yok.")}</td></tr>}
              </tbody>
              {tbRows.length > 0 && <tfoot><tr className="border-t bg-slate-50 font-semibold text-slate-700"><td className="px-2 py-2">{l("Totals", "Toplamlar")}</td><td className="px-2 py-2"><MoneyText amount={tbTotals.debit} currencyCode={trialBalanceBookBaseCurrencyCode} /></td><td className="px-2 py-2"><MoneyText amount={tbTotals.credit} currencyCode={trialBalanceBookBaseCurrencyCode} /></td><td className="px-2 py-2"><MoneyText amount={tbTotals.balance} currencyCode={trialBalanceBookBaseCurrencyCode} /></td></tr></tfoot>}
            </table>
          </div>
        </form>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">{l("Period Status & Auto Close", "Donem Durumu ve Otomatik Kapanis")}</h2>

          <form onSubmit={onUpdatePeriodStatus} className="grid gap-2 md:grid-cols-2">
            <Combobox
              value={periodForm.bookId || null}
              options={bookOptions}
              onChange={(nextValue) =>
                setPeriodForm((prev) => ({
                  ...prev,
                  bookId: nextValue ? String(nextValue) : "",
                  periodId: "",
                }))
              }
              onInputChange={(text, { reason }) => {
                if (reason === "input") {
                  setPeriodForm((prev) => ({ ...prev, bookId: keepDigits(text) }));
                } else if (reason === "clear") {
                  setPeriodForm((prev) => ({ ...prev, bookId: "" }));
                }
              }}
              placeholder={l("Select book", "Defter secin")}
              noOptionsText={l("No books found.", "Defter bulunamadi.")}
              clearable={false}
            />
            <Combobox
              value={periodForm.periodId || null}
              options={canUsePeriodActionLookup ? periodOptions : []}
              onChange={(nextValue) =>
                setPeriodForm((prev) => ({
                  ...prev,
                  periodId: nextValue ? String(nextValue) : "",
                }))
              }
              onInputChange={(text, { reason }) => {
                if (reason === "input") {
                  setPeriodForm((prev) => ({
                    ...prev,
                    periodId: keepDigits(text),
                  }));
                } else if (reason === "clear") {
                  setPeriodForm((prev) => ({ ...prev, periodId: "" }));
                }
              }}
              placeholder={l("Select period", "Donem secin")}
              noOptionsText={l("No periods found.", "Donem bulunamadi.")}
              clearable={false}
            />
            <Combobox
              value={periodForm.status || null}
              options={periodStatusOptions}
              onChange={(nextValue) =>
                setPeriodForm((prev) => ({
                  ...prev,
                  status: nextValue ? String(nextValue) : "SOFT_CLOSED",
                }))
              }
              clearable={false}
            />
            <input value={periodForm.note} onChange={(event) => setPeriodForm((prev) => ({ ...prev, note: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Manual status note (optional)", "Elle durum notu (opsiyonel)")} />
            <button type="submit" disabled={saving === "periodStatus" || !canClosePeriod} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2">{saving === "periodStatus" ? l("Saving...", "Kaydediliyor...") : l("Update Status", "Durumu Guncelle")}</button>
          </form>

          {periodCloseFxGate ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">
                {l("Cash FX close gate blocked this close run.", "Nakit kur kapanis kapisi bu kapanisi engelledi.")}
              </div>
              <div className="mt-1 text-xs text-amber-800">{periodCloseFxGate.message}</div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {periodCloseFxGateDetails.map((detail) => (
                  <div
                    key={`${periodCloseFxGate.code}-${detail.label}`}
                    className="rounded border border-amber-200 bg-white/70 px-3 py-2"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      {detail.label}
                    </div>
                    <div className="mt-1 text-sm text-slate-800">{detail.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <Link
                  className="rounded border border-cyan-300 bg-white px-2 py-1 text-cyan-800"
                  to="/app/kasa-kur-raporlari"
                >
                  {l("Open Cash FX Reports", "Kasa kur raporlarini ac")}
                </Link>
                <Link
                  className="rounded border border-cyan-300 bg-white px-2 py-1 text-cyan-800"
                  to="/app/kasa-kur-ops-dashboard"
                >
                  {l("Open FX Ops Dashboard", "Kur operasyon panelini ac")}
                </Link>
              </div>
              <div className="mt-3 text-xs text-amber-800">
                {periodCloseFxGate.code === PERIOD_CLOSE_FX_GATE_REQUIRED_CODE
                  ? showPeriodCloseFxOverrideControls
                    ? l(
                        "If business needs require it, enable the override fields below and provide a reason before rerunning close.",
                        "Is geregi gerekiyorsa, asagidaki override alanlarini acip neden girerek kapanisi tekrar calistirin."
                      )
                    : l(
                        "Run cash FX revaluation first. Override is restricted to users with cash.fx.revaluation.override.",
                        "Once nakit kur degerlemesini calistirin. Override yalnizca cash.fx.revaluation.override yetkili kullanicilar icindir."
                      )
                  : l(
                      "This reversal integrity issue must be corrected before close can proceed; override is not available for this gate.",
                      "Bu ters kayit butunluk sorunu duzeltilmeden kapanis ilerleyemez; bu kapida override kullanilamaz."
                    )}
              </div>
              {periodCloseFxGate.requestId ? (
                <div className="mt-2 text-[11px] text-amber-700">
                  requestId: {periodCloseFxGate.requestId}
                </div>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={onExecutePeriodClose} className="grid gap-2 md:grid-cols-2">
            <Combobox
              value={periodCloseForm.closeStatus || null}
              options={periodCloseStatusOptions}
              onChange={(nextValue) =>
                setPeriodCloseForm((prev) => ({
                  ...prev,
                  closeStatus: nextValue ? String(nextValue) : "SOFT_CLOSED",
                }))
              }
              clearable={false}
            />
            <Combobox
              value={periodCloseForm.retainedEarningsAccountId || null}
              options={retainedEarningsAccountOptions}
              onChange={(nextValue) =>
                setPeriodCloseForm((prev) => ({
                  ...prev,
                  retainedEarningsAccountId: nextValue ? String(nextValue) : "",
                }))
              }
              onInputChange={(text, { reason }) => {
                if (reason === "input") {
                  setPeriodCloseForm((prev) => ({
                    ...prev,
                    retainedEarningsAccountId: keepDigits(text),
                  }));
                } else if (reason === "clear") {
                  setPeriodCloseForm((prev) => ({
                    ...prev,
                    retainedEarningsAccountId: "",
                  }));
                }
              }}
              placeholder={l(
                "Retained earnings account (year-end optional)",
                "Gecmis yil kar/zarar hesabi (yil sonu opsiyonel)"
              )}
              noOptionsText={l("No equity accounts found.", "Sermaye hesabi bulunamadi.")}
            />
            <input value={periodCloseForm.note} onChange={(event) => setPeriodCloseForm((prev) => ({ ...prev, note: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder={l("Auto close note (optional)", "Otomatik kapanis notu (opsiyonel)")} />
            {showPeriodCloseFxOverrideControls ? (
              <>
                <label className="inline-flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(periodCloseForm.cashFxRevaluationOverride)}
                    onChange={(event) =>
                      setPeriodCloseForm((prev) => ({
                        ...prev,
                        cashFxRevaluationOverride: event.target.checked,
                      }))
                    }
                  />
                  {l(
                    "Allow FX close-gate override for this run",
                    "Bu calisma icin kur kapanis kapisi override kullan"
                  )}
                </label>
                <textarea
                  value={periodCloseForm.cashFxRevaluationOverrideReason}
                  onChange={(event) =>
                    setPeriodCloseForm((prev) => ({
                      ...prev,
                      cashFxRevaluationOverrideReason: event.target.value,
                    }))
                  }
                  disabled={!periodCloseForm.cashFxRevaluationOverride}
                  className="min-h-[88px] w-full rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2 disabled:bg-slate-50 disabled:text-slate-400"
                  placeholder={l(
                    "FX override reason (required when enabled)",
                    "Kur override nedeni (aktifse zorunlu)"
                  )}
                />
              </>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <button type="submit" disabled={saving === "periodCloseRun" || !canClosePeriod} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "periodCloseRun" ? l("Running...", "Calisiyor...") : l("Run Auto Close", "Otomatik Kapanisi Calistir")}</button>
              <button type="button" onClick={onLoadPeriodCloseRuns} disabled={saving === "periodCloseRuns" || !canClosePeriod} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">{saving === "periodCloseRuns" ? l("Loading...", "Yukleniyor...") : l("Load Close Runs", "Kapanis Calismalarini Yukle")}</button>
            </div>
          </form>

          <form onSubmit={onReopenPeriodClose} className="grid gap-2 md:grid-cols-2">
            <input value={periodCloseForm.reopenReason} onChange={(event) => setPeriodCloseForm((prev) => ({ ...prev, reopenReason: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder={l("Reopen reason (required)", "Yeniden acma nedeni (zorunlu)")} required />
            <button type="submit" disabled={saving === "periodReopen" || !canClosePeriod} className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2">{saving === "periodReopen" ? l("Reopening...", "Yeniden aciliyor...") : l("Reopen Last Close Run", "Son Kapanis Calismasini Yeniden Ac")}</button>
          </form>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">{l("Run", "Calisma")}</th>
                  <th className="px-2 py-2">{l("Status", "Durum")}</th>
                  <th className="px-2 py-2">{l("Close", "Kapanis")}</th>
                  <th className="px-2 py-2">{l("Year-End", "Yil Sonu")}</th>
                  <th className="px-2 py-2">{l("Carry JRN", "Devir Fisi")}</th>
                  <th className="px-2 py-2">{l("Y/E JRN", "Y/S Fisi")}</th>
                  <th className="px-2 py-2">{l("Lines", "Satirlar")}</th>
                </tr>
              </thead>
              <tbody>
                {periodCloseRuns.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">{row.closeStatus}</td>
                    <td className="px-2 py-2">{row.yearEndClosed ? l("Yes", "Evet") : l("No", "Hayir")}</td>
                    <td className="px-2 py-2">{row.carryForwardJournalEntryId || "-"}</td>
                    <td className="px-2 py-2">{row.yearEndJournalEntryId || "-"}</td>
                    <td className="px-2 py-2">{Array.isArray(row.lines) ? row.lines.length : 0}</td>
                  </tr>
                ))}
                {periodCloseRuns.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-slate-500">
                      {l("No period close runs loaded.", "Donem kapanis calismasi yuklenmedi.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">{l("Journal History", "Fis Gecmisi")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fetchJournalHistory()}
              disabled={loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {loadingHistory ? l("Loading...", "Yukleniyor...") : l("Load Journals", "Fisleri Yukle")}
            </button>
            <button
              type="button"
              onClick={onOpenDraftQueue}
              disabled={loadingHistory || !canReadJournals}
              className="rounded border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-700 disabled:opacity-60"
            >
              {l("Draft Queue", "Taslak Kuyrugu")}
            </button>
            <button
              type="button"
              onClick={onOpenAllStatusesQueue}
              disabled={loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {l("All Statuses", "Tum Durumlar")}
            </button>
            <button
              type="button"
              onClick={onOpenBulkPostConfirm}
              disabled={
                !canPost ||
                postingBusy ||
                selectedDraftHistoryRows.length === 0
              }
              className="rounded bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {l("Post Selected", "Secilenleri Post Et")} ({selectedDraftHistoryRows.length})
            </button>
          </div>
        </div>

        <form onSubmit={onApplyHistoryFilters} className="grid gap-2 md:grid-cols-6">
          <Combobox
            value={historyFilters.legalEntityId || null}
            options={legalEntityOptions}
            onChange={(nextValue) =>
              setHistoryFilters((prev) => ({
                ...prev,
                legalEntityId: nextValue ? String(nextValue) : "",
              }))
            }
            placeholder={l("All legal entities", "Tum istirakler / bagli ortaklar")}
            noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
          />
          <Combobox
            value={historyFilters.bookId || null}
            options={historyBookOptions}
            onChange={(nextValue) =>
              setHistoryFilters((prev) => ({
                ...prev,
                bookId: nextValue ? String(nextValue) : "",
              }))
            }
            placeholder={l("All books", "Tum defterler")}
            noOptionsText={l("No books found.", "Defter bulunamadi.")}
          />
          <Combobox
            value={historyFilters.fiscalPeriodId || null}
            options={historyPeriodOptions}
            onChange={(nextValue) =>
              setHistoryFilters((prev) => ({
                ...prev,
                fiscalPeriodId: nextValue ? String(nextValue) : "",
              }))
            }
            placeholder={l("All periods", "Tum donemler")}
            noOptionsText={l("No periods found.", "Donem bulunamadi.")}
            disabled={loadingHistoryPeriods}
          />
          <Combobox
            value={historyFilters.status || null}
            options={historyStatusOptions}
            onChange={(nextValue) =>
              setHistoryFilters((prev) => ({
                ...prev,
                status: nextValue ? String(nextValue) : "",
              }))
            }
            placeholder={l("All statuses", "Tum durumlar")}
          />
          <Combobox
            value={historyFilters.limit || null}
            options={historyLimitOptions}
            onChange={(nextValue) =>
              setHistoryFilters((prev) => ({
                ...prev,
                limit: nextValue ? String(nextValue) : prev.limit,
              }))
            }
            clearable={false}
          />
          <button
            type="submit"
            disabled={loadingHistory || !canReadJournals}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {l("Apply Filters", "Filtreleri Uygula")}
          </button>
          <button
            type="button"
            disabled={loadingHistory || !canReadJournals}
            onClick={() => {
              const reset = resetHistoryFilters({ ...JOURNAL_HISTORY_DEFAULT_FILTERS });
              void fetchJournalHistory(reset);
            }}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {l("Reset", "Sifirla")}
          </button>
        </form>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{l("Total rows", "Toplam satir")}: {historyTotal}</span>
          <span>{l("Page", "Sayfa")} {historyPage}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeHistoryPage(-1)}
              disabled={!historyHasPrev || loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              {l("Prev", "Onceki")}
            </button>
            <button
              type="button"
              onClick={() => onChangeHistoryPage(1)}
              disabled={!historyHasNext || loadingHistory || !canReadJournals}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              {l("Next", "Sonraki")}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[2fr_1fr]">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allDraftRowsOnPageSelected}
                      onChange={(event) => onToggleSelectAllDraftRows(event.target.checked)}
                      disabled={draftHistoryRows.length === 0 || postingBusy}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300"
                      title={l("Select all draft rows on this page", "Bu sayfadaki tum taslaklari sec")}
                    />
                  </th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">{l("No", "No")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2">{l("Date", "Tarih")}</th>
                  <th className="px-3 py-2">{l("Debit", "Borc")}</th>
                  <th className="px-3 py-2">{l("Credit", "Alacak")}</th>
                  <th className="px-3 py-2">{l("Lines", "Satirlar")}</th>
                  <th className="px-3 py-2">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.id} className={`border-t border-slate-100 ${selectedJournalId === String(row.id) ? "bg-cyan-50/50" : ""}`}>
                    <td className="px-3 py-2">
                      {isDraftStatus(row.status) ? (
                        <input
                          type="checkbox"
                          checked={selectedHistoryIdSet.has(String(row.id))}
                          onChange={(event) => onToggleHistoryRowSelection(row.id, event.target.checked)}
                          disabled={postingBusy}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300"
                        />
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.journal_no}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.entry_date}</td>
                    <td className="px-3 py-2">
                      <MoneyText
                        amount={row.total_debit_base}
                        currencyCode={historyBookBaseCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyText
                        amount={row.total_credit_base}
                        currencyCode={historyBookBaseCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-2">{row.line_count}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <button type="button" onClick={() => loadJournalDetail(row.id)} className="cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">{l("View", "Goruntule")}</button>
                        {canUpdateDraft && isDraftStatus(row.status) ? (
                          <button
                            type="button"
                            onClick={() => onLoadDraftIntoEditor(row.id)}
                            disabled={saving === "loadDraftForEdit" || cancelBusy || postingBusy}
                            className="cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                          >
                            {l("Edit", "Duzenle")}
                          </button>
                        ) : null}
                        {canPost && isDraftStatus(row.status) ? (
                          <button
                            type="button"
                            onClick={() => onOpenSinglePostConfirm(row)}
                            disabled={postingBusy || cancelBusy || saving === "loadDraftForEdit"}
                            className="cursor-pointer rounded border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 disabled:opacity-50"
                          >
                            {l("Post", "Post Et")}
                          </button>
                        ) : null}
                        {canCancelDraft && isDraftStatus(row.status) ? (
                          <button
                            type="button"
                            onClick={() => onCancelDraft(row.id)}
                            disabled={cancelBusy || postingBusy || saving === "loadDraftForEdit"}
                            className="cursor-pointer rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                          >
                            {cancelBusy ? l("Cancelling...", "Iptal ediliyor...") : l("Cancel", "Iptal Et")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {historyRows.length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-slate-500">{l("No journal rows loaded.", "Fis satiri yuklenmedi.")}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-700">{l("Journal Detail", "Fis Detayi")}</h3>
            {!selectedJournal && <p className="mt-2 text-xs text-slate-500">{l("Select a journal row to load detail and lines.", "Detay ve satirlari yuklemek icin bir fis satiri secin.")}</p>}
            {selectedJournal && (
              <div className="mt-2 space-y-2 text-xs text-slate-700">
                <div>ID: {selectedJournal.id}</div>
                <div>{l("No", "No")}: {selectedJournal.journal_no}</div>
                <div>{l("Status", "Durum")}: {selectedJournal.status}</div>
                <div>{l("Entity", "Birim")}: {selectedJournal.legal_entity_code}</div>
                <div>{l("Book", "Defter")}: {selectedJournal.book_code}</div>
                <div>{l("Operating Units", "Operasyon Birimleri")}: {selectedJournalOperatingUnitLabels.join(", ") || "-"}</div>
                <div>{l("Period", "Donem")}: {selectedJournal.fiscal_year}-P{String(selectedJournal.period_no || "").padStart(2, "0")}</div>
                <div>{l("Lines", "Satirlar")}: {(selectedJournal.lines || []).length}</div>
                {Array.isArray(selectedJournal.source_links) &&
                selectedJournal.source_links.length > 0 ? (
                  <div>
                    {l("Source Links", "Kaynak Baglantilari")}:{" "}
                    {selectedJournal.source_links
                      .map((row) => {
                        const sourceRefType = normalizeSourceRefType(
                          row?.source_ref_type || row?.sourceRefType
                        );
                        const sourceRefId = parsePositiveIntOrNull(
                          row?.source_ref_id || row?.sourceRefId
                        );
                        if (!sourceRefType || !sourceRefId) {
                          return null;
                        }
                        return `${sourceRefType}:${sourceRefId}`;
                      })
                      .filter(Boolean)
                      .join(", ") || "-"}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedJournal.source_links.map((row, index) => {
                        const sourceRefType = normalizeSourceRefType(
                          row?.source_ref_type || row?.sourceRefType
                        );
                        const sourceRefId = parsePositiveIntOrNull(
                          row?.source_ref_id || row?.sourceRefId
                        );
                        const destination = resolveJournalSourceLinkPath(
                          row,
                          selectedJournalCariSettlementDrilldowns
                        );
                        if (!sourceRefType || !sourceRefId || !destination) {
                          return null;
                        }
                        return (
                          <Link
                            key={`journal-source-open-${sourceRefType}-${sourceRefId}-${index}`}
                            to={destination}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                          >
                            {formatJournalSourceLinkAction(row, l)}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {(canReadCariReports || canReadCariDocuments) &&
                selectedJournalCariSettlementDrilldowns.length > 0 ? (
                  <div className="rounded border border-slate-200 bg-slate-50 p-2">
                    <div className="font-semibold text-slate-700">
                      {l("Applied Documents", "Uygulanan Belgeler")}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {l(
                        "Resolved from linked CARI settlement batches.",
                        "Bagli CARI mahsup partilerinden cozuldu."
                      )}
                    </div>
                    <div className="mt-2 space-y-2">
                      {selectedJournalCariSettlementDrilldowns.map((settlement, settlementIndex) => {
                        const settlementBatchId = toInt(settlement?.settlementBatchId);
                        const settlementLabel =
                          settlement?.settlementNo ||
                          (settlementBatchId ? `#${settlementBatchId}` : `#${settlementIndex + 1}`);
                        const settlementRoles = Array.isArray(settlement?.sourceLinkRoles)
                          ? settlement.sourceLinkRoles
                          : Array.isArray(settlement?.source_link_roles)
                            ? settlement.source_link_roles
                            : [];
                        const appliedDocuments = Array.isArray(settlement?.appliedDocuments)
                          ? settlement.appliedDocuments
                          : Array.isArray(settlement?.applied_documents)
                            ? settlement.applied_documents
                            : [];
                        return (
                          <div
                            key={`journal-settlement-drilldown-${settlementBatchId || settlementIndex}`}
                            className="rounded border border-slate-200 bg-white p-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-800">{settlementLabel}</span>
                              <span>{settlement?.settlementDate || "-"}</span>
                              <span>{settlement?.status || "-"}</span>
                              {settlement?.cashTransactionId ? (
                                <span>
                                  {l("Cash Txn", "Nakit Islem")} #{settlement.cashTransactionId}
                                </span>
                              ) : null}
                              <span>
                                <MoneyText
                                  amount={settlement?.totalAllocatedTxn}
                                  currencyCode={settlement?.currencyCode}
                                />
                              </span>
                              {settlementBatchId ? (
                                <Link
                                  to={resolveJournalSourceLinkPath(
                                    {
                                      sourceRefType: "CARI_SETTLEMENT_BATCH",
                                      sourceRefId: settlementBatchId,
                                    },
                                    selectedJournalCariSettlementDrilldowns
                                  )}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                                >
                                  {l("Open Settlement", "Mahsuplastirmayi Ac")}
                                </Link>
                              ) : null}
                            </div>
                            {settlementRoles.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {settlementRoles.map((role) => (
                                  <span
                                    key={`settlement-link-role-${settlementBatchId || settlementIndex}-${role}`}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                                  >
                                    {formatSettlementSourceLinkRole(role, l)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {appliedDocuments.length === 0 ? (
                              <div className="mt-2 text-[11px] text-slate-500">
                                {l(
                                  "No applied documents found on this settlement batch.",
                                  "Bu mahsup partisinde uygulanan belge bulunmadi."
                                )}
                              </div>
                            ) : (
                              <div className="mt-2 space-y-1">
                                {appliedDocuments.map((documentRow, documentIndex) => {
                                  const documentId = toInt(documentRow?.documentId);
                                  const allocationAmount =
                                    documentRow?.allocationAmountDocTxn ??
                                    documentRow?.allocation_amount_doc_txn ??
                                    documentRow?.allocationAmountTxn ??
                                    documentRow?.allocation_amount_txn;
                                  const documentCurrencyCode =
                                    documentRow?.documentCurrencyCode ||
                                    documentRow?.document_currency_code ||
                                    null;
                                  const itemNo =
                                    documentRow?.itemNo ?? documentRow?.item_no ?? null;
                                  const documentLabel =
                                    documentRow?.documentNo ||
                                    documentRow?.document_no ||
                                    (documentId ? `#${documentId}` : `#${documentIndex + 1}`);
                                  return (
                                    <div
                                      key={`journal-applied-document-${settlementBatchId || settlementIndex}-${documentId || documentIndex}`}
                                      className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1"
                                    >
                                      <span className="font-medium text-slate-800">{documentLabel}</span>
                                      <span>{documentRow?.documentDate || documentRow?.document_date || "-"}</span>
                                      <span>{documentRow?.documentType || documentRow?.document_type || "-"}</span>
                                      <span>{documentRow?.documentDirection || documentRow?.document_direction || "-"}</span>
                                      <span>{l("Item", "Kalem")} {itemNo || "-"}</span>
                                      <span>
                                        {l("Applied", "Uygulanan")}{" "}
                                        <MoneyText
                                          amount={allocationAmount}
                                          currencyCode={documentCurrencyCode}
                                        />
                                      </span>
                                      {canReadCariDocuments && documentId ? (
                                        <Link
                                          to={`/app/cari-belgeler?documentId=${documentId}`}
                                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                                        >
                                          {l("Open Document", "Belgeyi Ac")}
                                        </Link>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {String(selectedJournal.status || "").toUpperCase() === "CANCELLED" && selectedJournal.cancel_reason ? (
                  <div>{l("Cancel Reason", "Iptal Nedeni")}: {selectedJournal.cancel_reason}</div>
                ) : null}
                {isDraftStatus(selectedJournal.status) ? (
                  <div className="pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {canUpdateDraft ? (
                        <button
                          type="button"
                          onClick={() => onLoadDraftIntoEditor(selectedJournal.id)}
                          disabled={saving === "loadDraftForEdit" || postingBusy || cancelBusy}
                          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                        >
                          {l("Edit Draft", "Taslagi Duzenle")}
                        </button>
                      ) : null}
                      {canPost ? (
                        <button
                          type="button"
                          onClick={() => onOpenSinglePostConfirm(selectedJournal)}
                          disabled={postingBusy || saving === "loadDraftForEdit" || cancelBusy}
                          className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {l("Post From Detail", "Detaydan Post Et")}
                        </button>
                      ) : null}
                      {canCancelDraft ? (
                        <button
                          type="button"
                          onClick={() => onCancelDraft(selectedJournal.id)}
                          disabled={cancelBusy || postingBusy || saving === "loadDraftForEdit"}
                          className="rounded border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                        >
                          {cancelBusy ? l("Cancelling...", "Iptal ediliyor...") : l("Cancel Draft", "Taslagi Iptal Et")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="max-h-52 overflow-auto rounded border border-slate-200">
                  <table className="min-w-full text-[11px]">
                    <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">{l("Account", "Hesap")}</th><th className="px-2 py-1.5">{l("Unit", "Birim")}</th><th className="px-2 py-1.5">{l("Subledger Ref", "Alt Defter Ref")}</th><th className="px-2 py-1.5">{l("Debit", "Borc")}</th><th className="px-2 py-1.5">{l("Credit", "Alacak")}</th></tr></thead>
                    <tbody>
                      {selectedJournalDetailLines.map((line, index) => {
                        const lineSide = getJournalLineSide(line);
                        const accountPrefix = lineSide === "CREDIT" ? " " : "";
                        const operatingUnitLabel = getJournalLineOperatingUnitLabel(line, unitsById);
                        const rowKey =
                          line?.id ||
                          `${line?.line_no || index}-${line?.account_code || ""}-${line?.account_name || ""}`;
                        return (
                        <tr key={rowKey} className="border-t border-slate-100">
                          <td className="px-2 py-1.5">{line.line_no}</td>
                          <td className={`px-2 py-1.5 ${lineSide === "CREDIT" ? "pl-8" : ""}`}>
                            {accountPrefix}
                            {line.account_code} - {line.account_name}
                          </td>
                          <td className="px-2 py-1.5">{operatingUnitLabel}</td>
                          <td className="px-2 py-1.5">{line.subledger_reference_no || "-"}</td>
                          <td className="px-2 py-1.5">
                            <MoneyText
                              amount={line.debit_base}
                              currencyCode={selectedJournalBookBaseCurrencyCode}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <MoneyText
                              amount={line.credit_base}
                              currencyCode={selectedJournalBookBaseCurrencyCode}
                            />
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {postConfirmState.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-800">
              {l("Confirm Journal Posting", "Fis Post Islem Onayi")}
            </h3>
            <p className="mt-1 text-xs text-rose-700">
              {l(
                "Posting is irreversible from this screen. Review journals before confirming.",
                "Bu ekrandan post islemi geri alinamaz. Onaylamadan once fisleri kontrol edin."
              )}
            </p>

            <div className="mt-3 max-h-60 overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5">ID</th>
                    <th className="px-2 py-1.5">{l("No", "No")}</th>
                    <th className="px-2 py-1.5">{l("Status", "Durum")}</th>
                    <th className="px-2 py-1.5">{l("Date", "Tarih")}</th>
                    <th className="px-2 py-1.5">{l("Debit", "Borc")}</th>
                    <th className="px-2 py-1.5">{l("Credit", "Alacak")}</th>
                    <th className="px-2 py-1.5">{l("Lines", "Satirlar")}</th>
                  </tr>
                </thead>
                <tbody>
                  {postConfirmState.rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">{row.id}</td>
                      <td className="px-2 py-1.5">{row.journal_no || "-"}</td>
                      <td className="px-2 py-1.5">{row.status || "-"}</td>
                      <td className="px-2 py-1.5">{row.entry_date || "-"}</td>
                      <td className="px-2 py-1.5">
                        <MoneyText
                          amount={row.total_debit_base}
                          currencyCode={historyBookBaseCurrencyCode}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <MoneyText
                          amount={row.total_credit_base}
                          currencyCode={historyBookBaseCurrencyCode}
                        />
                      </td>
                      <td className="px-2 py-1.5">{row.line_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={postConfirmState.postLinkedMirrors}
                onChange={(event) =>
                  setPostConfirmState((prev) => ({
                    ...prev,
                    postLinkedMirrors: event.target.checked,
                  }))
                }
              />
              {l("Post linked intercompany mirrors", "Bagli intercompany mirror fisleri de post et")}
            </label>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closePostConfirm}
                disabled={saving === "postJournal"}
                className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
              >
                {l("Cancel", "Iptal")}
              </button>
              <button
                type="button"
                onClick={onConfirmPostFromModal}
                disabled={saving === "postJournal"}
                className="rounded bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saving === "postJournal"
                  ? l("Posting...", "Post ediliyor...")
                  : l("Confirm & Post", "Onayla ve Post Et")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            {l("Intercompany Compliance Audit", "Intercompany Uyumluluk Denetimi")}
          </h2>
          <button
            type="button"
            onClick={() => loadComplianceIssues()}
            disabled={saving === "complianceAudit" || !canReadIntercompanyFlags}
            className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
          >
            {saving === "complianceAudit"
              ? l("Loading...", "Yukleniyor...")
              : l("Load Issues", "Sorunlari Yukle")}
          </button>
        </div>

        {!canReadIntercompanyFlags ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {l(
              "Missing permission: intercompany.flag.read",
              "Eksik yetki: intercompany.flag.read"
            )}
          </div>
        ) : (
          <>
            <form onSubmit={onApplyComplianceFilters} className="grid gap-2 md:grid-cols-5">
              <Combobox
                value={complianceFilters.legalEntityId || null}
                options={legalEntityOptions}
                onChange={(nextValue) =>
                  setComplianceFilters((prev) => ({
                    ...prev,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l("All legal entities", "Tum istirakler / bagli ortaklar")}
                noOptionsText={l("No legal entities found.", "Istirak bulunamadi.")}
              />
              <Combobox
                value={complianceFilters.fiscalPeriodId || null}
                options={compliancePeriodOptions}
                onChange={(nextValue) =>
                  setComplianceFilters((prev) => ({
                    ...prev,
                    fiscalPeriodId: nextValue ? String(nextValue) : "",
                  }))
                }
                placeholder={l(
                  "Fiscal period (optional)",
                  "Mali donem (opsiyonel)"
                )}
                noOptionsText={l("No periods found.", "Donem bulunamadi.")}
              />
              <Combobox
                value={complianceFilters.limit || null}
                options={complianceLimitOptions}
                onChange={(nextValue) =>
                  setComplianceFilters((prev) => ({
                    ...prev,
                    limit: nextValue ? String(nextValue) : prev.limit,
                  }))
                }
                clearable={false}
              />
              <label className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(complianceFilters.includeDraft)}
                  onChange={(event) =>
                    setComplianceFilters((prev) => ({
                      ...prev,
                      includeDraft: event.target.checked,
                    }))
                  }
                />
                {l("Include drafts", "Taslaklari dahil et")}
              </label>
              <button
                type="submit"
                disabled={saving === "complianceAudit"}
                className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {l("Apply", "Uygula")}
              </button>
              <button
                type="button"
                disabled={saving === "complianceAudit"}
                onClick={() => {
                  const reset = resetComplianceFilters({
                    ...JOURNAL_COMPLIANCE_DEFAULT_FILTERS,
                  });
                  void loadComplianceIssues(reset);
                }}
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {l("Reset", "Sifirla")}
              </button>
            </form>

            <div className="mt-2 text-xs text-slate-600">
              {l("Total issues", "Toplam sorun")}: {Number(complianceSummary?.totalIssues || 0)}{" "}
              | {l("Disabled entity", "Kapali entity")}:{" "}
              {Number(complianceSummary?.byIssueCode?.ENTITY_INTERCOMPANY_DISABLED || 0)}{" "}
              | {l("Missing partner", "Eksik partner")}:{" "}
              {Number(
                complianceSummary?.byIssueCode?.PARTNER_REQUIRED_MISSING_COUNTERPARTY || 0
              )}{" "}
              | {l("Missing pair", "Eksik pair")}:{" "}
              {Number(complianceSummary?.byIssueCode?.MISSING_ACTIVE_PAIR || 0)}
            </div>

            <div className="mt-3 overflow-x-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-2 py-2">{l("Issue", "Sorun")}</th>
                    <th className="px-2 py-2">{l("Journal", "Fis")}</th>
                    <th className="px-2 py-2">{l("Line", "Satir")}</th>
                    <th className="px-2 py-2">{l("From", "Kaynak")}</th>
                    <th className="px-2 py-2">{l("To", "Hedef")}</th>
                    <th className="px-2 py-2">{l("Account", "Hesap")}</th>
                    <th className="px-2 py-2">{l("Actions", "Aksiyonlar")}</th>
                  </tr>
                </thead>
                <tbody>
                  {complianceRows.map((row) => (
                    <tr
                      key={`${row.issueCode}-${row.journalId}-${row.lineNo}-${row.accountId}-${row.toLegalEntityId || 0}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-2 py-2">
                        <div className="font-semibold text-slate-800">{row.issueCode}</div>
                        <div className="text-slate-500">{row.issueMessage}</div>
                      </td>
                      <td className="px-2 py-2">
                        {row.journalNo || "-"}{" "}
                        <span className="text-slate-500">
                          (#{row.journalId || "-"}, {row.journalStatus || "-"})
                        </span>
                      </td>
                      <td className="px-2 py-2">{row.lineNo || "-"}</td>
                      <td className="px-2 py-2">
                        {row.fromLegalEntityCode || row.fromLegalEntityId || "-"}
                      </td>
                      <td className="px-2 py-2">
                        {row.toLegalEntityCode || row.toLegalEntityId || "-"}
                      </td>
                      <td className="px-2 py-2">
                        {row.accountCode || row.accountId || "-"}
                        {row.accountName ? ` - ${row.accountName}` : ""}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.suggestedActions?.includes("ENABLE_ENTITY_INTERCOMPANY") ? (
                            <button
                              type="button"
                              onClick={() =>
                                resolveComplianceIssue(row, "ENABLE_ENTITY_INTERCOMPANY")
                              }
                              disabled={
                                !canUpsertIntercompanyFlags ||
                                saving === "compliance:ENABLE_ENTITY_INTERCOMPANY"
                              }
                              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 disabled:opacity-60"
                            >
                              {l("Enable Entity", "Entity Ac")}
                            </button>
                          ) : null}
                          {row.suggestedActions?.includes("DISABLE_PARTNER_REQUIRED") ? (
                            <button
                              type="button"
                              onClick={() =>
                                resolveComplianceIssue(row, "DISABLE_PARTNER_REQUIRED")
                              }
                              disabled={
                                !canUpsertIntercompanyFlags ||
                                saving === "compliance:DISABLE_PARTNER_REQUIRED"
                              }
                              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 disabled:opacity-60"
                            >
                              {l("Disable Partner Required", "Partner Zorunluyu Kapat")}
                            </button>
                          ) : null}
                          {row.suggestedActions?.includes("CREATE_ACTIVE_PAIR") ? (
                            <button
                              type="button"
                              onClick={() => resolveComplianceIssue(row, "CREATE_ACTIVE_PAIR")}
                              disabled={
                                !canUpsertIntercompanyPairs ||
                                saving === "compliance:CREATE_ACTIVE_PAIR"
                              }
                              className="rounded border border-cyan-300 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-800 disabled:opacity-60"
                            >
                              {l("Create Pair", "Pair Olustur")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {complianceRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-slate-500">
                        {l(
                          "No intercompany compliance issues loaded.",
                          "Intercompany uyumluluk sorunu yuklenmedi."
                        )}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
