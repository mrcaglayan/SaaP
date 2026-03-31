
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getTrialBalance, listBooks } from "../api/glAdmin.js";
import { buildLocalReportLocation } from "../api/glReports.js";
import { listFiscalPeriods, listLegalEntities } from "../api/orgAdmin.js";
import {
  getRevenueAccrualSplitReport,
  getRevenueDeferredRevenueSplitReport,
  getRevenueFutureYearRollforwardReport,
  getRevenuePostingMappingSetup,
  getRevenuePrepaidExpenseSplitReport,
} from "../api/revenueRecognition.js";
import {
  estimateReclassToShortTerm,
  formatAmount,
} from "./revenue/revenueRecognitionUtils.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";
const BALANCE_MATCH_TOLERANCE = 0.01;
const REVREC_CONTROLS = Object.freeze([
  {
    key: "DEFREV",
    familyCode: "DEFREV",
    mappingTitleEn: "Deferred revenue long/short mapping",
    mappingTitleTr: "Ertelenmis gelir uzun/kisa esleme",
    balanceTitleEn: "Deferred revenue posted balance control",
    balanceTitleTr: "Ertelenmis gelir bakiye kontrolu",
    longPurposeCode: "DEFREV_LONG_LIABILITY",
    shortPurposeCode: "DEFREV_SHORT_LIABILITY",
    expectedLongPrefix: "480",
    expectedShortPrefix: "380",
    reportKind: "deferred",
    normalBalanceSide: "CREDIT",
  },
  {
    key: "PREPAID_EXPENSE",
    familyCode: "PREPAID_EXPENSE",
    mappingTitleEn: "Prepaid expense long/short mapping",
    mappingTitleTr: "Pesin gider uzun/kisa esleme",
    balanceTitleEn: "Prepaid expense posted balance control",
    balanceTitleTr: "Pesin gider bakiye kontrolu",
    longPurposeCode: "PREPAID_EXP_LONG_ASSET",
    shortPurposeCode: "PREPAID_EXP_SHORT_ASSET",
    expectedLongPrefix: "280",
    expectedShortPrefix: "180",
    reportKind: "prepaid",
    normalBalanceSide: "DEBIT",
  },
  {
    key: "ACCRUED_REVENUE",
    familyCode: "ACCRUED_REVENUE",
    mappingTitleEn: "Accrued revenue long/short mapping",
    mappingTitleTr: "Gelir tahakkuku uzun/kisa esleme",
    balanceTitleEn: "Accrued revenue posted balance control",
    balanceTitleTr: "Gelir tahakkuku bakiye kontrolu",
    longPurposeCode: "ACCR_REV_LONG_ASSET",
    shortPurposeCode: "ACCR_REV_SHORT_ASSET",
    expectedLongPrefix: "281",
    expectedShortPrefix: "181",
    reportKind: "accrual",
    normalBalanceSide: "DEBIT",
  },
  {
    key: "ACCRUED_EXPENSE",
    familyCode: "ACCRUED_EXPENSE",
    mappingTitleEn: "Accrued expense long/short mapping",
    mappingTitleTr: "Gider tahakkuku uzun/kisa esleme",
    balanceTitleEn: "Accrued expense posted balance control",
    balanceTitleTr: "Gider tahakkuku bakiye kontrolu",
    longPurposeCode: "ACCR_EXP_LONG_LIABILITY",
    shortPurposeCode: "ACCR_EXP_SHORT_LIABILITY",
    expectedLongPrefix: "481",
    expectedShortPrefix: "381",
    reportKind: "accrual",
    normalBalanceSide: "CREDIT",
  },
]);
const YEAR_END_TABS = Object.freeze([
  {
    key: "setup",
    titleEn: "Mapping Baseline",
    titleTr: "Esleme Baz Cizgisi",
  },
  {
    key: "balances",
    titleEn: "Balance Controls",
    titleTr: "Bakiye Kontrolleri",
  },
]);
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}
function roundAmount(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(6));
}
function absAmount(value) {
  return roundAmount(Math.abs(Number(value || 0)));
}
function normalizeApiError(error, fallback = "Operation failed.") {
  const message = String(error?.message || error?.response?.data?.message || fallback).trim();
  const requestId = String(error?.requestId || error?.response?.data?.requestId || "").trim();
  return requestId ? `${message || fallback} (requestId: ${requestId})` : message || fallback;
}
function buildLegalEntityLabel(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(row?.id || "");
}
function buildBookLabel(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(row?.id || "");
}
function buildPeriodLabel(row) {
  const periodKey = String(row?.period_key || row?.periodKey || "").trim();
  if (periodKey) {
    return periodKey;
  }
  const fiscalYear = Number(row?.fiscal_year || row?.fiscalYear || 0);
  const periodNo = Number(row?.period_no || row?.periodNo || 0);
  if (fiscalYear > 0 && periodNo > 0) {
    return `${fiscalYear}/${String(periodNo).padStart(2, "0")}`;
  }
  return String(row?.name || row?.id || "");
}
function getMappingByPurpose(setupStatus) {
  const byPurpose = new Map();
  for (const familyRow of Array.isArray(setupStatus?.families) ? setupStatus.families : []) {
    for (const mapping of Array.isArray(familyRow?.purposeMappings) ? familyRow.purposeMappings : []) {
      const purposeCode = toUpper(mapping?.purposeCode);
      if (!purposeCode) {
        continue;
      }
      byPurpose.set(purposeCode, mapping);
    }
  }
  return byPurpose;
}
function getMissingPurposeCodes(setupStatus) {
  const missing = new Set();
  for (const familyRow of Array.isArray(setupStatus?.families) ? setupStatus.families : []) {
    for (const purposeCode of Array.isArray(familyRow?.missingPurposeCodes)
      ? familyRow.missingPurposeCodes
      : []) {
      const normalized = toUpper(purposeCode);
      if (normalized) {
        missing.add(normalized);
      }
    }
  }
  return Array.from(missing.values());
}
function statusBadgeClass(status) {
  if (status === "PASS") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "WARN") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-rose-100 text-rose-700";
}
function findAccrualFamilyRow(report, familyCode) {
  const targetFamily = toUpper(familyCode);
  return (Array.isArray(report?.rows) ? report.rows : []).find(
    (row) => toUpper(row?.accountFamily) === targetFamily
  ) || null;
}
function findRollforwardFamilyRow(report, familyCode) {
  const targetFamily = toUpper(familyCode);
  return (Array.isArray(report?.rows) ? report.rows : []).find(
    (row) => toUpper(row?.accountFamily) === targetFamily
  ) || null;
}
function buildTrialBalanceIndex(trialBalanceResponse) {
  const byAccountId = new Map();
  const byAccountCode = new Map();
  for (const row of Array.isArray(trialBalanceResponse?.rows) ? trialBalanceResponse.rows : []) {
    const accountId = toPositiveInt(row?.account_id);
    const accountCode = String(row?.account_code || "").trim();
    if (accountId) {
      byAccountId.set(accountId, row);
    }
    if (accountCode) {
      byAccountCode.set(accountCode, row);
    }
  }
  return { byAccountId, byAccountCode };
}
function findTrialBalanceRow(index, mapping) {
  const accountId = toPositiveInt(mapping?.accountId);
  if (accountId && index.byAccountId.has(accountId)) {
    return index.byAccountId.get(accountId);
  }
  const accountCode = String(mapping?.accountCode || "").trim();
  if (accountCode && index.byAccountCode.has(accountCode)) {
    return index.byAccountCode.get(accountCode);
  }
  return null;
}
function resolveExpectedSplitAmounts(control, reportBundle) {
  if (!reportBundle) {
    return null;
  }
  if (control.reportKind === "deferred") {
    return {
      shortTermAmountBase: roundAmount(reportBundle.deferred?.summary?.shortTermAmountBase),
      longTermAmountBase: roundAmount(reportBundle.deferred?.summary?.longTermAmountBase),
      reportAvailable: Boolean(reportBundle.deferred),
    };
  }
  if (control.reportKind === "prepaid") {
    return {
      shortTermAmountBase: roundAmount(reportBundle.prepaid?.summary?.shortTermAmountBase),
      longTermAmountBase: roundAmount(reportBundle.prepaid?.summary?.longTermAmountBase),
      reportAvailable: Boolean(reportBundle.prepaid),
    };
  }
  if (control.reportKind === "accrual") {
    const row = findAccrualFamilyRow(reportBundle.accrual, control.familyCode);
    return {
      shortTermAmountBase: roundAmount(row?.shortTermAmountBase),
      longTermAmountBase: roundAmount(row?.longTermAmountBase),
      reportAvailable: Boolean(reportBundle.accrual && row),
    };
  }
  return null;
}
function isUnexpectedBalanceSide(control, signedBalance, amountMagnitude) {
  if (amountMagnitude <= BALANCE_MATCH_TOLERANCE) {
    return false;
  }
  if (control.normalBalanceSide === "CREDIT") {
    return Number(signedBalance || 0) > BALANCE_MATCH_TOLERANCE;
  }
  return Number(signedBalance || 0) < BALANCE_MATCH_TOLERANCE * -1;
}
function buildReasonCodeList(issues, warnings) {
  const codes = new Set();
  for (const issue of issues) {
    codes.add(issue);
  }
  for (const warning of warnings) {
    codes.add(warning);
  }
  return Array.from(codes.values());
}
function buildSummaryRows(rows, isReadyFn) {
  const total = rows.length;
  let passed = 0;
  let warning = 0;
  let failed = 0;
  for (const row of rows) {
    const status = isReadyFn(row);
    if (status === "PASS") {
      passed += 1;
    } else if (status === "WARN") {
      warning += 1;
    } else {
      failed += 1;
    }
  }
  return { total, passed, warning, failed };
}

function normalizeTabKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (YEAR_END_TABS.some((tab) => tab.key === normalized)) {
    return normalized;
  }
  return YEAR_END_TABS[0].key;
}

function buildYearEndSearchParams({
  activeTab,
  legalEntityId,
  bookId,
  fiscalPeriodId,
}) {
  const nextParams = new URLSearchParams();
  if (toPositiveInt(legalEntityId)) {
    nextParams.set("legalEntityId", String(toPositiveInt(legalEntityId)));
  }
  if (toPositiveInt(bookId)) {
    nextParams.set("bookId", String(toPositiveInt(bookId)));
  }
  if (toPositiveInt(fiscalPeriodId)) {
    nextParams.set("fiscalPeriodId", String(toPositiveInt(fiscalPeriodId)));
  }
  if (normalizeTabKey(activeTab) !== YEAR_END_TABS[0].key) {
    nextParams.set("tab", normalizeTabKey(activeTab));
  }
  return nextParams;
}

function normalizeSelectionId(value) {
  return String(toPositiveInt(value) || "");
}

function createInitialSelection(searchParams) {
  return {
    activeTab: normalizeTabKey(searchParams.get("tab")),
    legalEntityId: normalizeSelectionId(searchParams.get("legalEntityId")),
    bookId: normalizeSelectionId(searchParams.get("bookId")),
    fiscalPeriodId: normalizeSelectionId(searchParams.get("fiscalPeriodId")),
  };
}

function selectionEquals(left, right) {
  return (
    left?.activeTab === right?.activeTab &&
    left?.legalEntityId === right?.legalEntityId &&
    left?.bookId === right?.bookId &&
    left?.fiscalPeriodId === right?.fiscalPeriodId
  );
}
/**
 * Show year-end REVREC controls as report-backed checks: mapping readiness for
 * setup, plus GL-vs-REVREC balance comparisons for one legal-entity/book/period
 * scope using the existing posted trial balance and REVREC split reports.
 */
export default function YearEndRevrecChecklistPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selection, setSelection] = useState(() =>
    createInitialSelection(searchParams)
  );
  const [loadingEntities, setLoadingEntities] = useState(true);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [runningSetup, setRunningSetup] = useState(false);
  const [runningBalances, setRunningBalances] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [setupError, setSetupError] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [setupStatus, setSetupStatus] = useState(null);
  const [setupCheckedAt, setSetupCheckedAt] = useState(null);
  const [balanceReports, setBalanceReports] = useState(null);
  const [trialBalanceResponse, setTrialBalanceResponse] = useState(null);
  const [balanceCheckedAt, setBalanceCheckedAt] = useState(null);
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const { activeTab, legalEntityId, bookId, fiscalPeriodId } = selection;
  const canReadRevrecSetup = hasPermission("revenue.schedule.read");
  const canReadRevrecReports = hasPermission("revenue.report.read");
  const canReadEntities = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const setActiveTab = useCallback((value) => {
    setSelection((prev) => {
      const nextValue = normalizeTabKey(
        typeof value === "function" ? value(prev.activeTab) : value
      );
      return prev.activeTab === nextValue
        ? prev
        : { ...prev, activeTab: nextValue };
    });
  }, []);
  const setLegalEntityId = useCallback((value) => {
    setSelection((prev) => {
      const nextValue = normalizeSelectionId(
        typeof value === "function" ? value(prev.legalEntityId) : value
      );
      return prev.legalEntityId === nextValue
        ? prev
        : { ...prev, legalEntityId: nextValue };
    });
  }, []);
  const setBookId = useCallback((value) => {
    setSelection((prev) => {
      const nextValue = normalizeSelectionId(
        typeof value === "function" ? value(prev.bookId) : value
      );
      return prev.bookId === nextValue ? prev : { ...prev, bookId: nextValue };
    });
  }, []);
  const setFiscalPeriodId = useCallback((value) => {
    setSelection((prev) => {
      const nextValue = normalizeSelectionId(
        typeof value === "function" ? value(prev.fiscalPeriodId) : value
      );
      return prev.fiscalPeriodId === nextValue
        ? prev
        : { ...prev, fiscalPeriodId: nextValue };
    });
  }, []);
  const selectedLegalEntityId = toPositiveInt(legalEntityId);
  const selectedBookId = toPositiveInt(bookId);
  const selectedFiscalPeriodId = toPositiveInt(fiscalPeriodId);
  const selectedBook = useMemo(
    () => books.find((row) => toPositiveInt(row?.id) === selectedBookId) || null,
    [books, selectedBookId]
  );
  const selectedBookCalendarId = toPositiveInt(selectedBook?.calendar_id);
  const selectedPeriod = useMemo(
    () => periods.find((row) => toPositiveInt(row?.id) === selectedFiscalPeriodId) || null,
    [periods, selectedFiscalPeriodId]
  );
  const nextPeriod = useMemo(() => {
    if (!selectedPeriod) {
      return null;
    }
    const orderedPeriods = [...periods].sort((left, right) => {
      const leftYear = Number(left?.fiscal_year || 0);
      const rightYear = Number(right?.fiscal_year || 0);
      if (leftYear !== rightYear) {
        return leftYear - rightYear;
      }
      return Number(left?.period_no || 0) - Number(right?.period_no || 0);
    });
    const currentIndex = orderedPeriods.findIndex(
      (row) => toPositiveInt(row?.id) === selectedFiscalPeriodId
    );
    if (currentIndex < 0 || currentIndex >= orderedPeriods.length - 1) {
      return null;
    }
    return orderedPeriods[currentIndex + 1] || null;
  }, [periods, selectedFiscalPeriodId, selectedPeriod]);
  useEffect(() => {
    if (!canReadEntities) {
      setLoadingEntities(false);
      setLegalEntities([]);
      return undefined;
    }
    let cancelled = false;
    async function loadLegalEntityLookups() {
      setLoadingEntities(true);
      setLookupError("");
      try {
        const response = await listLegalEntities({ limit: 500, includeInactive: true });
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setLegalEntities(rows);
        setLegalEntityId((prev) => {
          const prevId = toPositiveInt(prev);
          if (prevId) {
            return String(prevId);
          }
          return String(toPositiveInt(rows[0]?.id) || "");
        });
      } catch (err) {
        if (!cancelled) {
          setLegalEntities([]);
          setLookupError(
            normalizeApiError(
              err,
              l("Failed to load legal entities.", "Legal entity listesi yuklenemedi.")
            )
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingEntities(false);
        }
      }
    }
    void loadLegalEntityLookups();
    return () => {
      cancelled = true;
    };
  }, [canReadEntities, l, setLegalEntityId]);
  useEffect(() => {
    if (!selectedLegalEntityId) {
      setBooks([]);
      setSelection((prev) =>
        prev.bookId || prev.fiscalPeriodId
          ? { ...prev, bookId: "", fiscalPeriodId: "" }
          : prev
      );
      return undefined;
    }
    if (!canReadBooks) {
      setLoadingBooks(false);
      setBooks([]);
      return undefined;
    }
    let cancelled = false;
    async function loadBookLookups() {
      setLoadingBooks(true);
      setLookupError("");
      try {
        const response = await listBooks({ legalEntityId: selectedLegalEntityId, limit: 500 });
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setBooks(rows);
        setBookId((prev) => {
          if (toPositiveInt(prev)) {
            return prev;
          }
          return String(toPositiveInt(rows[0]?.id) || "");
        });
      } catch (err) {
        if (!cancelled) {
          setBooks([]);
          setLookupError(
            normalizeApiError(err, l("Failed to load books.", "Defterler yuklenemedi."))
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingBooks(false);
        }
      }
    }
    void loadBookLookups();
    return () => {
      cancelled = true;
    };
  }, [canReadBooks, l, selectedLegalEntityId, setBookId]);
  useEffect(() => {
    if (!selectedBookId) {
      setPeriods([]);
      setFiscalPeriodId("");
      return undefined;
    }
    if (!canReadPeriods) {
      setLoadingPeriods(false);
      setPeriods([]);
      return undefined;
    }
    // Preserve query-driven book/period selection while the book lookup is still
    // loading; otherwise the page briefly clears fiscalPeriodId and rewrites the
    // URL before the selected book resolves.
    if (!selectedBookCalendarId) {
      if (loadingBooks) {
        return undefined;
      }
      setPeriods([]);
      return undefined;
    }
    let cancelled = false;
    async function loadPeriodLookups() {
      setLoadingPeriods(true);
      setLookupError("");
      try {
        const response = await listFiscalPeriods(selectedBookCalendarId, { limit: 500 });
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setPeriods(rows);
        setFiscalPeriodId((prev) => {
          if (toPositiveInt(prev)) {
            return prev;
          }
          return String(toPositiveInt(rows[0]?.id) || "");
        });
      } catch (err) {
        if (!cancelled) {
          setPeriods([]);
          setLookupError(
            normalizeApiError(
              err,
              l("Failed to load fiscal periods.", "Mali donemler yuklenemedi.")
            )
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPeriods(false);
        }
      }
    }
    void loadPeriodLookups();
    return () => {
      cancelled = true;
    };
  }, [
    canReadPeriods,
    l,
    loadingBooks,
    selectedBookCalendarId,
    selectedBookId,
    setFiscalPeriodId,
  ]);
  const runSetupChecks = useCallback(
    async (entityIdInput = selectedLegalEntityId) => {
      if (!canReadRevrecSetup) {
        setSetupStatus(null);
        setSetupCheckedAt(null);
        setSetupError("Missing permission: revenue.schedule.read");
        return;
      }
      const targetEntityId = toPositiveInt(entityIdInput);
      if (!targetEntityId) {
        setSetupStatus(null);
        setSetupCheckedAt(null);
        return;
      }
      setRunningSetup(true);
      setSetupError("");
      try {
        const response = await getRevenuePostingMappingSetup({ legalEntityId: targetEntityId });
        setSetupStatus(response || null);
        setSetupCheckedAt(new Date().toISOString());
      } catch (err) {
        setSetupStatus(null);
        setSetupCheckedAt(null);
        setSetupError(
          normalizeApiError(
            err,
            l("Failed to run REVREC setup checks.", "REVREC kurulum kontrolleri calistirilamadi.")
          )
        );
      } finally {
        setRunningSetup(false);
      }
    },
    [canReadRevrecSetup, l, selectedLegalEntityId]
  );
  const runBalanceChecks = useCallback(
    async ({
      entityIdInput = selectedLegalEntityId,
      bookIdInput = selectedBookId,
      fiscalPeriodIdInput = selectedFiscalPeriodId,
    } = {}) => {
      if (!canReadRevrecReports) {
        setTrialBalanceResponse(null);
        setBalanceReports(null);
        setBalanceCheckedAt(null);
        setBalanceError("Missing permission: revenue.report.read");
        return;
      }
      const targetEntityId = toPositiveInt(entityIdInput);
      const targetBookId = toPositiveInt(bookIdInput);
      const targetFiscalPeriodId = toPositiveInt(fiscalPeriodIdInput);
      if (!targetEntityId || !targetBookId || !targetFiscalPeriodId) {
        setTrialBalanceResponse(null);
        setBalanceReports(null);
        setBalanceCheckedAt(null);
        setBalanceError("");
        return;
      }
      setRunningBalances(true);
      setBalanceError("");
      try {
        const reportQuery = {
          legalEntityId: targetEntityId,
          fiscalPeriodId: targetFiscalPeriodId,
          limit: 200,
          offset: 0,
        };
        const nextPeriodId = toPositiveInt(nextPeriod?.id);
        const [trialBalance, rollforward, deferred, accrual, prepaid, nextRollforward] = await Promise.all([
          getTrialBalance({
            legalEntityId: targetEntityId,
            bookId: targetBookId,
            fiscalPeriodId: targetFiscalPeriodId,
            includeRollup: false,
          }),
          getRevenueFutureYearRollforwardReport(reportQuery),
          getRevenueDeferredRevenueSplitReport(reportQuery),
          getRevenueAccrualSplitReport(reportQuery),
          getRevenuePrepaidExpenseSplitReport(reportQuery),
          nextPeriodId
            ? getRevenueFutureYearRollforwardReport({
                legalEntityId: targetEntityId,
                fiscalPeriodId: nextPeriodId,
                limit: 200,
                offset: 0,
              })
            : Promise.resolve(null),
        ]);
        setTrialBalanceResponse(trialBalance || null);
        setBalanceReports({
          rollforward: rollforward || null,
          deferred: deferred || null,
          accrual: accrual || null,
          prepaid: prepaid || null,
          nextPeriod: nextPeriodId
            ? {
                fiscalPeriodId: nextPeriodId,
                periodLabel: buildPeriodLabel(nextPeriod),
                rollforward: nextRollforward || null,
              }
            : null,
        });
        setBalanceCheckedAt(new Date().toISOString());
      } catch (err) {
        setTrialBalanceResponse(null);
        setBalanceReports(null);
        setBalanceCheckedAt(null);
        setBalanceError(
          normalizeApiError(
            err,
            l(
              "Failed to run REVREC balance checks.",
              "REVREC bakiye kontrolleri calistirilamadi."
            )
          )
        );
      } finally {
        setRunningBalances(false);
      }
    },
    [
      canReadRevrecReports,
      l,
      nextPeriod,
      selectedBookId,
      selectedFiscalPeriodId,
      selectedLegalEntityId,
    ]
  );
  useEffect(() => {
    if (!canReadRevrecSetup || !selectedLegalEntityId) {
      setSetupStatus(null);
      setSetupCheckedAt(null);
      if (!canReadRevrecSetup) {
        setSetupError("Missing permission: revenue.schedule.read");
      }
      return;
    }
    void runSetupChecks(selectedLegalEntityId);
  }, [canReadRevrecSetup, runSetupChecks, selectedLegalEntityId]);
  useEffect(() => {
    if (
      !canReadRevrecReports ||
      !selectedLegalEntityId ||
      !selectedBookId ||
      !selectedFiscalPeriodId
    ) {
      setTrialBalanceResponse(null);
      setBalanceReports(null);
      setBalanceCheckedAt(null);
      if (!canReadRevrecReports) {
        setBalanceError("Missing permission: revenue.report.read");
      } else {
        setBalanceError("");
      }
      return;
    }
    void runBalanceChecks({
      entityIdInput: selectedLegalEntityId,
      bookIdInput: selectedBookId,
      fiscalPeriodIdInput: selectedFiscalPeriodId,
    });
  }, [
    canReadRevrecReports,
    runBalanceChecks,
    selectedBookId,
    selectedFiscalPeriodId,
    selectedLegalEntityId,
  ]);
  const familyRows = useMemo(
    () => (Array.isArray(setupStatus?.families) ? setupStatus.families : []),
    [setupStatus]
  );
  const familyStatusRows = useMemo(() => {
    return REVREC_CONTROLS.map((control) => {
      const row =
        familyRows.find(
          (candidate) => toUpper(candidate?.accountFamily) === toUpper(control.familyCode)
        ) || null;
      const missingCount = Array.isArray(row?.missingPurposeCodes)
        ? row.missingPurposeCodes.length
        : 0;
      return {
        familyCode: control.familyCode,
        ready: Boolean(row?.ready),
        missingCount,
        missingPurposeCodes: Array.isArray(row?.missingPurposeCodes)
          ? row.missingPurposeCodes
          : [],
      };
    });
  }, [familyRows]);
  const mappingByPurpose = useMemo(() => getMappingByPurpose(setupStatus), [setupStatus]);
  const mappingRows = useMemo(() => {
    return REVREC_CONTROLS.map((control) => {
      const longMapping = mappingByPurpose.get(control.longPurposeCode) || null;
      const shortMapping = mappingByPurpose.get(control.shortPurposeCode) || null;
      const longId = toPositiveInt(longMapping?.accountId);
      const shortId = toPositiveInt(shortMapping?.accountId);
      const longCode = String(longMapping?.accountCode || "").trim();
      const shortCode = String(shortMapping?.accountCode || "").trim();
      if (!longId || !shortId) {
        return {
          ...control,
          status: "FAIL",
          detail: l(
            "Missing long/short account mapping.",
            "Uzun/kisa hesap eslemelerinden en az biri eksik."
          ),
          longCode,
          shortCode,
        };
      }
      if (longId === shortId) {
        return {
          ...control,
          status: "FAIL",
          detail: l(
            "Long and short accounts must be different.",
            "Uzun ve kisa hesap ayni olamaz."
          ),
          longCode,
          shortCode,
        };
      }
      const prefixWarnings = [];
      if (longCode && !longCode.startsWith(control.expectedLongPrefix)) {
        prefixWarnings.push(
          l(
            `Long account usually starts with ${control.expectedLongPrefix}.`,
            `Uzun hesap genelde ${control.expectedLongPrefix} ile baslar.`
          )
        );
      }
      if (shortCode && !shortCode.startsWith(control.expectedShortPrefix)) {
        prefixWarnings.push(
          l(
            `Short account usually starts with ${control.expectedShortPrefix}.`,
            `Kisa hesap genelde ${control.expectedShortPrefix} ile baslar.`
          )
        );
      }
      if (prefixWarnings.length > 0) {
        return {
          ...control,
          status: "WARN",
          detail: prefixWarnings.join(" "),
          longCode,
          shortCode,
        };
      }
      return {
        ...control,
        status: "PASS",
        detail: l("Mapped and separated correctly.", "Eslemeler ayrik ve dogru."),
        longCode,
        shortCode,
      };
    });
  }, [l, mappingByPurpose]);
  const missingPurposeCodes = useMemo(() => getMissingPurposeCodes(setupStatus), [setupStatus]);
  const trialBalanceIndex = useMemo(
    () => buildTrialBalanceIndex(trialBalanceResponse),
    [trialBalanceResponse]
  );
  const balanceRows = useMemo(() => {
    if (!balanceReports) {
      return [];
    }
    return REVREC_CONTROLS.map((control) => {
      const longMapping = mappingByPurpose.get(control.longPurposeCode) || null;
      const shortMapping = mappingByPurpose.get(control.shortPurposeCode) || null;
      const longId = toPositiveInt(longMapping?.accountId);
      const shortId = toPositiveInt(shortMapping?.accountId);
      const issues = [];
      const warnings = [];
      if (!longId || !shortId) {
        issues.push("MISSING_MAPPING");
      }
      const expected = resolveExpectedSplitAmounts(control, balanceReports);
      if (!expected?.reportAvailable) {
        issues.push("MISSING_REPORT_ROW");
      }
      const longRow = findTrialBalanceRow(trialBalanceIndex, longMapping);
      const shortRow = findTrialBalanceRow(trialBalanceIndex, shortMapping);
      const longSignedBalance = roundAmount(longRow?.balance);
      const shortSignedBalance = roundAmount(shortRow?.balance);
      // Trial balance keeps debit-credit sign, while the REVREC split reports
      // expose bucket magnitudes. Compare absolute posted balance and surface
      // abnormal sign direction separately as a warning.
      const actualLongAmountBase = absAmount(longSignedBalance);
      const actualShortAmountBase = absAmount(shortSignedBalance);
      const expectedLongAmountBase = roundAmount(expected?.longTermAmountBase);
      const expectedShortAmountBase = roundAmount(expected?.shortTermAmountBase);
      const longDifferenceAmountBase = roundAmount(actualLongAmountBase - expectedLongAmountBase);
      const shortDifferenceAmountBase = roundAmount(
        actualShortAmountBase - expectedShortAmountBase
      );
      if (!longRow && expectedLongAmountBase > BALANCE_MATCH_TOLERANCE) {
        issues.push("LONG_ACCOUNT_NOT_IN_TRIAL_BALANCE");
      }
      if (!shortRow && expectedShortAmountBase > BALANCE_MATCH_TOLERANCE) {
        issues.push("SHORT_ACCOUNT_NOT_IN_TRIAL_BALANCE");
      }
      if (Math.abs(longDifferenceAmountBase) > BALANCE_MATCH_TOLERANCE) {
        issues.push("LONG_BALANCE_MISMATCH");
      }
      if (Math.abs(shortDifferenceAmountBase) > BALANCE_MATCH_TOLERANCE) {
        issues.push("SHORT_BALANCE_MISMATCH");
      }
      if (isUnexpectedBalanceSide(control, longSignedBalance, actualLongAmountBase)) {
        warnings.push(
          control.normalBalanceSide === "CREDIT"
            ? "LONG_UNEXPECTED_DEBIT_BALANCE"
            : "LONG_UNEXPECTED_CREDIT_BALANCE"
        );
      }
      if (isUnexpectedBalanceSide(control, shortSignedBalance, actualShortAmountBase)) {
        warnings.push(
          control.normalBalanceSide === "CREDIT"
            ? "SHORT_UNEXPECTED_DEBIT_BALANCE"
            : "SHORT_UNEXPECTED_CREDIT_BALANCE"
        );
      }
      const detailMessages = [];
      if (issues.includes("MISSING_MAPPING")) {
        detailMessages.push(
          l(
            "Setup mapping is incomplete, so balance validation cannot be trusted.",
            "Kurulum eslemesi eksik oldugu icin bakiye kontrolu guvenilir degil."
          )
        );
      }
      if (issues.includes("MISSING_REPORT_ROW")) {
        detailMessages.push(
          l(
            "REVREC split report data is missing for this family and period.",
            "Bu aile ve donem icin REVREC bolumleme raporu verisi eksik."
          )
        );
      }
      if (issues.includes("LONG_ACCOUNT_NOT_IN_TRIAL_BALANCE")) {
        detailMessages.push(
          l(
            "Expected long-term amount exists but the mapped long account is missing from trial balance.",
            "Beklenen uzun vadeli tutar var ancak eslenen uzun hesap mizanda yok."
          )
        );
      }
      if (issues.includes("SHORT_ACCOUNT_NOT_IN_TRIAL_BALANCE")) {
        detailMessages.push(
          l(
            "Expected short-term amount exists but the mapped short account is missing from trial balance.",
            "Beklenen kisa vadeli tutar var ancak eslenen kisa hesap mizanda yok."
          )
        );
      }
      if (issues.includes("LONG_BALANCE_MISMATCH")) {
        detailMessages.push(
          l(
            "Long-term posted balance does not match the REVREC split report.",
            "Uzun vadeli post edilmis bakiye REVREC bolumleme raporuyla uyusmuyor."
          )
        );
      }
      if (issues.includes("SHORT_BALANCE_MISMATCH")) {
        detailMessages.push(
          l(
            "Short-term posted balance does not match the REVREC split report.",
            "Kisa vadeli post edilmis bakiye REVREC bolumleme raporuyla uyusmuyor."
          )
        );
      }
      if (warnings.includes("LONG_UNEXPECTED_DEBIT_BALANCE")) {
        detailMessages.push(
          l(
            "Long-term account shows a debit-side balance on a liability family.",
            "Uzun vadeli hesap, borc yonlu bakiye gosteriyor ve bu bir borc ailesi degil."
          )
        );
      }
      if (warnings.includes("SHORT_UNEXPECTED_DEBIT_BALANCE")) {
        detailMessages.push(
          l(
            "Short-term account shows a debit-side balance on a liability family.",
            "Kisa vadeli hesap, borc yonlu bakiye gosteriyor ve bu bir borc ailesi degil."
          )
        );
      }
      if (warnings.includes("LONG_UNEXPECTED_CREDIT_BALANCE")) {
        detailMessages.push(
          l(
            "Long-term account shows a credit-side balance on an asset family.",
            "Uzun vadeli hesap, alacak yonlu bakiye gosteriyor ve bu bir varlik ailesi degil."
          )
        );
      }
      if (warnings.includes("SHORT_UNEXPECTED_CREDIT_BALANCE")) {
        detailMessages.push(
          l(
            "Short-term account shows a credit-side balance on an asset family.",
            "Kisa vadeli hesap, alacak yonlu bakiye gosteriyor ve bu bir varlik ailesi degil."
          )
        );
      }
      const hasOpenAmounts =
        expectedLongAmountBase > BALANCE_MATCH_TOLERANCE ||
        expectedShortAmountBase > BALANCE_MATCH_TOLERANCE ||
        actualLongAmountBase > BALANCE_MATCH_TOLERANCE ||
        actualShortAmountBase > BALANCE_MATCH_TOLERANCE;
      let status = "PASS";
      let detail = l(
        "Posted GL balances match the REVREC split report.",
        "Post edilmis GL bakiyeleri REVREC bolumleme raporuyla uyusuyor."
      );
      if (!hasOpenAmounts && detailMessages.length === 0) {
        detail = l(
          "No open balance detected in REVREC or GL for this family.",
          "Bu aile icin REVREC veya GL tarafinda acik bakiye tespit edilmedi."
        );
      } else if (detailMessages.length > 0) {
        detail = detailMessages.join(" ");
      }
      if (issues.length > 0) {
        status = "FAIL";
      } else if (warnings.length > 0) {
        status = "WARN";
      }
      return {
        ...control,
        status,
        detail,
        reasonCodes: buildReasonCodeList(issues, warnings),
        longCode: String(longMapping?.accountCode || "").trim(),
        shortCode: String(shortMapping?.accountCode || "").trim(),
        expectedLongAmountBase,
        expectedShortAmountBase,
        actualLongAmountBase,
        actualShortAmountBase,
        longDifferenceAmountBase,
        shortDifferenceAmountBase,
        longSignedBalance,
        shortSignedBalance,
        longLedgerLocation: buildLocalReportLocation("generalLedger", {
          legalEntityId: selectedLegalEntityId || undefined,
          bookId: selectedBookId || undefined,
          fiscalPeriodId: selectedFiscalPeriodId || undefined,
          accountId: longId || undefined,
        }),
        shortLedgerLocation: buildLocalReportLocation("generalLedger", {
          legalEntityId: selectedLegalEntityId || undefined,
          bookId: selectedBookId || undefined,
          fiscalPeriodId: selectedFiscalPeriodId || undefined,
          accountId: shortId || undefined,
        }),
      };
    });
  }, [
    balanceReports,
    l,
    mappingByPurpose,
    selectedBookId,
    selectedFiscalPeriodId,
    selectedLegalEntityId,
    trialBalanceIndex,
  ]);
  const continuityRows = useMemo(() => {
    const nextRollforward = balanceReports?.nextPeriod?.rollforward || null;
    if (!balanceReports?.rollforward || !nextRollforward) {
      return [];
    }
    return REVREC_CONTROLS.map((control) => {
      const currentRow = findRollforwardFamilyRow(balanceReports.rollforward, control.familyCode);
      const nextRow = findRollforwardFamilyRow(nextRollforward, control.familyCode);
      const issues = [];
      const warnings = [];
      const currentClosingAmountBase = roundAmount(currentRow?.closingAmountBase);
      const nextOpeningAmountBase = roundAmount(nextRow?.openingAmountBase);
      const carryForwardDifferenceBase = roundAmount(
        currentClosingAmountBase - nextOpeningAmountBase
      );
      if (!currentRow) {
        issues.push("CURRENT_PERIOD_ROLLFORWARD_MISSING");
      }
      if (!nextRow) {
        issues.push("NEXT_PERIOD_OPENING_MISSING");
      }
      if (Math.abs(carryForwardDifferenceBase) > BALANCE_MATCH_TOLERANCE) {
        issues.push("NEXT_PERIOD_OPENING_MISMATCH");
      }
      const currentReclassEstimateBase = roundAmount(
        estimateReclassToShortTerm(currentRow || {})
      );
      const nextOpeningAbsBase = absAmount(nextOpeningAmountBase);
      if (
        currentReclassEstimateBase > BALANCE_MATCH_TOLERANCE &&
        nextOpeningAbsBase <= BALANCE_MATCH_TOLERANCE
      ) {
        warnings.push("RECLASS_ESTIMATE_ZEROED_IN_NEXT_OPENING");
      }

      let status = "PASS";
      let detail = l(
        "Current-period closing amount carries into the next-period opening amount.",
        "Cari donem kapanis tutari sonraki donem acilis tutarina tasiniyor."
      );
      if (issues.length > 0) {
        status = "FAIL";
        detail = issues.includes("NEXT_PERIOD_OPENING_MISMATCH")
          ? l(
              "Current-period closing amount does not match the next-period opening amount.",
              "Cari donem kapanis tutari sonraki donem acilis tutariyla uyusmuyor."
            )
          : l(
              "Rollforward data is missing for the current or next period.",
              "Cari veya sonraki donem icin rollforward verisi eksik."
            );
      } else if (warnings.length > 0) {
        status = "WARN";
        detail = l(
          "Carry-forward matches, but the expected reclass bridge estimate collapses to zero in the next opening and should be reviewed.",
          "Devir tutari uyusuyor ancak beklenen aktarim koprusu tahmini sonraki acilista sifira dusuyor; gozden gecirilmelidir."
        );
      }

      return {
        ...control,
        status,
        detail,
        reasonCodes: buildReasonCodeList(issues, warnings),
        currentClosingAmountBase,
        nextOpeningAmountBase,
        carryForwardDifferenceBase,
        currentReclassEstimateBase,
      };
    });
  }, [balanceReports, l]);
  const setupSummary = useMemo(
    () =>
      buildSummaryRows(
        [
          ...familyStatusRows.map((row) => ({
            status: row.ready ? "PASS" : "FAIL",
          })),
          ...mappingRows,
        ],
        (row) => row.status
      ),
    [familyStatusRows, mappingRows]
  );
  const balanceSummary = useMemo(
    () => buildSummaryRows(balanceRows, (row) => row.status),
    [balanceRows]
  );
  const continuitySummary = useMemo(
    () => buildSummaryRows(continuityRows, (row) => row.status),
    [continuityRows]
  );
  const rollforwardSummary = balanceReports?.rollforward?.summary || {};
  const refreshing = runningSetup || runningBalances;
  const trialBalanceLocation = useMemo(
    () =>
      buildLocalReportLocation("trialBalance", {
        legalEntityId: selectedLegalEntityId || undefined,
        bookId: selectedBookId || undefined,
        fiscalPeriodId: selectedFiscalPeriodId || undefined,
        includeRollup: true,
      }),
    [selectedBookId, selectedFiscalPeriodId, selectedLegalEntityId]
  );

  useEffect(() => {
    const requestedTab = normalizeTabKey(searchParams.get("tab"));
    const nextSelection = {
      activeTab: requestedTab,
      legalEntityId: normalizeSelectionId(searchParams.get("legalEntityId")),
      bookId: normalizeSelectionId(searchParams.get("bookId")),
      fiscalPeriodId: normalizeSelectionId(searchParams.get("fiscalPeriodId")),
    };
    setSelection((prev) => (selectionEquals(prev, nextSelection) ? prev : nextSelection));
  }, [searchParams]);

  useEffect(() => {
    const nextParams = buildYearEndSearchParams({
      activeTab,
      legalEntityId,
      bookId,
      fiscalPeriodId,
    });
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    activeTab,
    bookId,
    fiscalPeriodId,
    legalEntityId,
    searchParams,
    setSearchParams,
  ]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {l("Year-End REVREC Control", "Yil Sonu REVREC Kontrol")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              {l(
                "Use mapping baseline checks and report-backed balance controls before year-end close. The balance tab compares posted GL balances to the existing REVREC split reports for the selected legal entity, book, and fiscal period.",
                "Yil sonu kapanisi oncesinde esleme baz cizgisi ve rapor-destekli bakiye kontrollerini kullanin. Bakiye sekmesi, secili legal entity, defter ve mali donem icin post edilmis GL bakiyelerini mevcut REVREC bolumleme raporlariyla karsilastirir."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void runSetupChecks(selectedLegalEntityId);
              void runBalanceChecks({
                entityIdInput: selectedLegalEntityId,
                bookIdInput: selectedBookId,
                fiscalPeriodIdInput: selectedFiscalPeriodId,
              });
            }}
            disabled={refreshing || !selectedLegalEntityId}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {refreshing
              ? l("Running checks...", "Kontroller calisiyor...")
              : l("Run checks", "Kontrolleri calistir")}
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Legal entity", "Legal entity")}
            </label>
            <select
              value={legalEntityId}
              onChange={(event) => {
                const nextLegalEntityId = normalizeSelectionId(event.target.value);
                setSelection((prev) => ({
                  ...prev,
                  legalEntityId: nextLegalEntityId,
                  bookId: "",
                  fiscalPeriodId: "",
                }));
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={loadingEntities}
            >
              <option value="">{l("Select legal entity", "Legal entity secin")}</option>
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {buildLegalEntityLabel(entity)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Book", "Defter")}
            </label>
            <select
              value={bookId}
              onChange={(event) => {
                const nextBookId = normalizeSelectionId(event.target.value);
                setSelection((prev) => ({
                  ...prev,
                  bookId: nextBookId,
                  fiscalPeriodId: "",
                }));
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={loadingBooks || !selectedLegalEntityId}
            >
              <option value="">{l("Select book", "Defter secin")}</option>
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {buildBookLabel(book)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Fiscal period", "Mali donem")}
            </label>
            <select
              value={fiscalPeriodId}
              onChange={(event) => setFiscalPeriodId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={loadingPeriods || !selectedBookId}
            >
              <option value="">{l("Select fiscal period", "Mali donem secin")}</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {buildPeriodLabel(period)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase text-slate-500">{l("Last setup check", "Son kurulum kontrolu")}</div>
            <div className="mt-1 font-mono text-slate-900">
              {setupCheckedAt ? setupCheckedAt.replace("T", " ").slice(0, 19) : "-"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase text-slate-500">{l("Last balance check", "Son bakiye kontrolu")}</div>
            <div className="mt-1 font-mono text-slate-900">
              {balanceCheckedAt ? balanceCheckedAt.replace("T", " ").slice(0, 19) : "-"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase text-slate-500">{l("Selected book", "Secili defter")}</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {selectedBook ? buildBookLabel(selectedBook) : "-"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase text-slate-500">{l("Selected period", "Secili donem")}</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {selectedPeriod ? buildPeriodLabel(selectedPeriod) : "-"}
            </div>
          </div>
        </div>
        {lookupError ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {lookupError}
          </div>
        ) : null}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-2">
        <div className="flex flex-wrap gap-2">
          {YEAR_END_TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  active
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {l(tab.titleEn, tab.titleTr)}
              </button>
            );
          })}
        </div>
      </section>
      {activeTab === "setup" ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">{l("Total checks", "Toplam kontrol")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{setupSummary.total}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] uppercase text-emerald-700">{l("Passed", "Gecti")}</div>
                <div className="mt-1 text-base font-semibold text-emerald-800">{setupSummary.passed}</div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] uppercase text-amber-700">{l("Warnings", "Uyarilar")}</div>
                <div className="mt-1 text-base font-semibold text-amber-800">{setupSummary.warning}</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <div className="text-[11px] uppercase text-rose-700">{l("Failed", "Basarisiz")}</div>
                <div className="mt-1 text-base font-semibold text-rose-800">{setupSummary.failed}</div>
              </div>
            </div>
            {setupStatus?.ready ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {l(
                  "REVREC mapping baseline is ready for this legal entity.",
                  "Bu legal entity icin REVREC esleme baz cizgisi hazir."
                )}
              </div>
            ) : null}
            {setupError ? (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {setupError}
              </div>
            ) : null}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {l("Family readiness baseline", "Aile bazli hazirlik")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Each account family must have complete purpose mappings before running year-end actions.",
                "Yil sonu islemleri oncesi her hesap ailesi icin amac eslemeleri tam olmali."
              )}
            </p>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">{l("Family", "Aile")}</th>
                    <th className="px-3 py-2">{l("Status", "Durum")}</th>
                    <th className="px-3 py-2">{l("Missing purpose codes", "Eksik amac kodlari")}</th>
                  </tr>
                </thead>
                <tbody>
                  {familyStatusRows.map((row) => {
                    const statusText = row.ready ? l("READY", "HAZIR") : l("MISSING", "EKSIK");
                    const badgeClass = row.ready
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-rose-100 text-rose-700";
                    return (
                      <tr key={row.familyCode} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-800">{row.familyCode}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                            {statusText}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {row.missingPurposeCodes.length > 0
                            ? row.missingPurposeCodes.join(", ")
                            : l("None", "Yok")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {l("Long/short mapping integrity", "Uzun/kisa esleme butunlugu")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Long and short purpose accounts must both exist and be mapped to different postable accounts.",
                "Uzun ve kisa amac hesaplari mevcut olmali ve farkli postlanabilir hesaplara eslenmeli."
              )}
            </p>
            <div className="mt-3 grid gap-2">
              {mappingRows.map((row) => (
                <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800">
                      {l(row.mappingTitleEn, row.mappingTitleTr)}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                        row.status
                      )}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{row.detail}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {l("Long", "Uzun")} ({row.longPurposeCode}): {row.longCode || "-"} | {l("Short", "Kisa")} ({row.shortPurposeCode}): {row.shortCode || "-"}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-900">
              {l("Year-end operation reminders", "Yil sonu islem hatirlatmalari")}
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">
              <li>{l("Run/validate 480 -> 380 and 280 -> 180 reclass entries.", "480 -> 380 ve 280 -> 180 aktarim kayitlarini calistirin/dogrulayin.")}</li>
              <li>{l("Run/validate 281 -> 181 and 481 -> 381 reclass entries.", "281 -> 181 ve 481 -> 381 aktarim kayitlarini calistirin/dogrulayin.")}</li>
              <li>{l("Review open accrual/deferred balances before period close run.", "Donem kapanisi oncesi acik tahakkuk/ertelenmis bakiyeleri gozden gecirin.")}</li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Link
                to="/app/ayarlar/hesap-plani-ayarlari"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                {l("Open GL Setup", "GL Kurulumunu Ac")}
              </Link>
              <Link
                to="/app/gelecek-yillar-gelirleri"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                {l("Open REVREC Module", "REVREC Modulu Ac")}
              </Link>
            </div>
          </section>
          {missingPurposeCodes.length > 0 ? (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <h2 className="text-sm font-semibold text-rose-800">
                {l("Blocking missing mappings", "Engelleyici eksik eslemeler")}
              </h2>
              <p className="mt-1 text-xs text-rose-700">
                {l(
                  "These purpose codes are missing/invalid and will block stable year-end REVREC posting:",
                  "Bu amac kodlari eksik/gecersiz oldugu icin yil sonu REVREC kayitlarini bloke eder:"
                )}
              </p>
              <p className="mt-2 font-mono text-xs text-rose-900">{missingPurposeCodes.join(", ")}</p>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">{l("Total controls", "Toplam kontrol")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{balanceSummary.total}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] uppercase text-emerald-700">{l("Passed", "Gecti")}</div>
                <div className="mt-1 text-base font-semibold text-emerald-800">{balanceSummary.passed}</div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] uppercase text-amber-700">{l("Warnings", "Uyarilar")}</div>
                <div className="mt-1 text-base font-semibold text-amber-800">{balanceSummary.warning}</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <div className="text-[11px] uppercase text-rose-700">{l("Failed", "Basarisiz")}</div>
                <div className="mt-1 text-base font-semibold text-rose-800">{balanceSummary.failed}</div>
              </div>
            </div>
            {!selectedBookId || !selectedFiscalPeriodId ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {l(
                  "Select book and fiscal period to activate the report-backed balance controls.",
                  "Rapor-destekli bakiye kontrollerini aktif etmek icin defter ve mali donem secin."
                )}
              </div>
            ) : null}
            {selectedBookId && selectedFiscalPeriodId && balanceRows.every((row) => row.status === "PASS") ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {l(
                  "Posted GL balances match the current REVREC split reports for the selected scope.",
                  "Secili kapsam icin post edilmis GL bakiyeleri mevcut REVREC bolumleme raporlariyla uyusuyor."
                )}
              </div>
            ) : null}
            {balanceError ? (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {balanceError}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Link
                to={trialBalanceLocation || "/app/mizan-raporu"}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                {l("Open Mizan", "Mizani Ac")}
              </Link>
              <Link
                to="/app/gelecek-yillar-gelirleri"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                {l("Open REVREC Reports", "REVREC Raporlarini Ac")}
              </Link>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {l("Rollforward visibility", "Rollforward gorunumu")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "This section reuses the existing REVREC rollforward report so the operator can explain balance controls from posted report data instead of hidden math.",
                "Bu bolum, operatorun bakiye kontrollerini gizli matematik yerine post edilmis rapor verisiyle aciklayabilmesi icin mevcut REVREC rollforward raporunu yeniden kullanir."
              )}
            </p>
            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">{l("Opening", "Acilis")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{formatAmount(rollforwardSummary.openingAmountBase)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">{l("Movement", "Hareket")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{formatAmount(rollforwardSummary.movementAmountBase)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">{l("Closing", "Kapanis")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{formatAmount(rollforwardSummary.closingAmountBase)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">{l("Short / Long", "Kisa / Uzun")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {formatAmount(rollforwardSummary.shortTermAmountBase)} / {formatAmount(rollforwardSummary.longTermAmountBase)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase text-slate-500">{l("Reclass indicator", "Aktarim gostergesi")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {formatAmount(estimateReclassToShortTerm(rollforwardSummary))}
                </div>
              </div>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {l(
                "Closing vs next opening continuity",
                "Kapanis vs sonraki acilis surekliligi"
              )}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "RP12 extends the existing year-end REVREC seam with carry-forward continuity checks. Each family compares the selected period closing amount to the next available period opening amount from the same rollforward report family.",
                "RP12, mevcut yil sonu REVREC seam'ini devir surekliligi kontrolleriyle genisletir. Her aile, secili donem kapanis tutarini ayni rollforward rapor ailesindeki sonraki musait donem acilis tutariyla karsilastirir."
              )}
            </p>
            {!balanceReports?.nextPeriod ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {l(
                  "No next fiscal period is available on the current calendar yet, so opening continuity cannot be checked for this selection.",
                  "Mevcut takvimde sonraki mali donem henuz mevcut degil; bu secim icin acilis surekliligi kontrol edilemiyor."
                )}
              </div>
            ) : (
              <>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase text-slate-500">{l("Next period", "Sonraki donem")}</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {balanceReports.nextPeriod.periodLabel || balanceReports.nextPeriod.fiscalPeriodId}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <div className="text-[11px] uppercase text-emerald-700">{l("Passed", "Gecti")}</div>
                    <div className="mt-1 text-base font-semibold text-emerald-800">{continuitySummary.passed}</div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="text-[11px] uppercase text-amber-700">{l("Warnings", "Uyarilar")}</div>
                    <div className="mt-1 text-base font-semibold text-amber-800">{continuitySummary.warning}</div>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                    <div className="text-[11px] uppercase text-rose-700">{l("Failed", "Basarisiz")}</div>
                    <div className="mt-1 text-base font-semibold text-rose-800">{continuitySummary.failed}</div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {continuityRows.map((row) => (
                    <div key={`continuity-${row.key}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">
                          {l(row.balanceTitleEn, row.balanceTitleTr)}
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                            row.status
                          )}`}
                        >
                          {row.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{row.detail}</p>
                      {row.reasonCodes.length > 0 ? (
                        <p className="mt-1 font-mono text-[11px] text-slate-500">
                          {l("Reason codes", "Neden kodlari")}: {row.reasonCodes.join(", ")}
                        </p>
                      ) : null}
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-[11px] uppercase text-slate-500">{l("Current closing", "Cari kapanis")}</div>
                          <div className="mt-1 font-semibold text-slate-900">{formatAmount(row.currentClosingAmountBase)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-[11px] uppercase text-slate-500">{l("Next opening", "Sonraki acilis")}</div>
                          <div className="mt-1 font-semibold text-slate-900">{formatAmount(row.nextOpeningAmountBase)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <div className="text-[11px] uppercase text-slate-500">{l("Difference", "Fark")}</div>
                          <div className="mt-1 font-semibold text-slate-900">{formatAmount(row.carryForwardDifferenceBase)}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {l("Reclass estimate", "Aktarim tahmini")}: {formatAmount(row.currentReclassEstimateBase)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {l("Posted GL vs REVREC split", "Post edilmis GL vs REVREC bolumleme")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Each control compares the mapped long/short GL balances to the current REVREC short/long split report for the same family.",
                "Her kontrol, eslenen uzun/kisa GL bakiyelerini ayni aile icin gecerli REVREC kisa/uzun bolumleme raporuyla karsilastirir."
              )}
            </p>
            <div className="mt-3 grid gap-2">
              {balanceRows.map((row) => (
                <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800">
                      {l(row.balanceTitleEn, row.balanceTitleTr)}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                        row.status
                      )}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{row.detail}</p>
                  {row.reasonCodes.length > 0 ? (
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      {l("Reason codes", "Neden kodlari")}: {row.reasonCodes.join(", ")}
                    </p>
                  ) : null}
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] uppercase text-slate-500">{l("Expected short", "Beklenen kisa")}</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatAmount(row.expectedShortAmountBase)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] uppercase text-slate-500">{l("Actual short", "Fiili kisa")}</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatAmount(row.actualShortAmountBase)}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {l("Diff", "Fark")}: {formatAmount(row.shortDifferenceAmountBase)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] uppercase text-slate-500">{l("Expected long", "Beklenen uzun")}</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatAmount(row.expectedLongAmountBase)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] uppercase text-slate-500">{l("Actual long", "Fiili uzun")}</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatAmount(row.actualLongAmountBase)}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {l("Diff", "Fark")}: {formatAmount(row.longDifferenceAmountBase)}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {l("Long", "Uzun")} ({row.longPurposeCode}): {row.longCode || "-"} |{" "}
                    {l("Short", "Kisa")} ({row.shortPurposeCode}): {row.shortCode || "-"}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {row.longLedgerLocation ? (
                      <Link
                        to={row.longLedgerLocation}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {l("Open long ledger", "Uzun defteri ac")}
                      </Link>
                    ) : null}
                    {row.shortLedgerLocation ? (
                      <Link
                        to={row.shortLedgerLocation}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {l("Open short ledger", "Kisa defteri ac")}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-900">
              {l("Still deferred", "Halen ertelenen kisim")}
            </h2>
            <p className="mt-1 text-xs text-amber-900">
              {l(
                "This page now validates selected-period posted balances and first-pass closing-to-next-opening continuity from the existing REVREC reports. Full close-block wiring into the broader close/publish flow is still later RP12/RP13 hardening work.",
                "Bu sayfa artik secili donem post edilmis bakiyelerini ve mevcut REVREC raporlarindan ilk gecis kapanis-sonraki-acilis surekliligini dogrular. Daha genis kapanis/yayin akisina tam blok entegrasyonu ise halen sonraki RP12/RP13 sertlestirme isidir."
              )}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
