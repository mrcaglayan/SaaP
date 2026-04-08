import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getConsolidatedBalanceSheet,
  getConsolidatedIncomeStatement,
  getConsolidatedSummary,
  getConsolidatedTrialBalance,
  listBooks,
  listConsolidationRuns,
  listConsolidationAdjustments,
  listConsolidationEliminations,
  postConsolidationAdjustment,
  postConsolidationElimination,
} from "../api/glAdmin.js";
import {
  createConsolidationRunMemberSupportSnapshot,
  finalizeConsolidationRun,
  getConsolidationRunReviewGate,
  listConsolidationGroupMembers,
} from "../api/consolidationAdmin.js";
import { buildLocalReportLocation } from "../api/glReports.js";
import { useAuth } from "../auth/useAuth.js";
import GovernedRuntimeExplainabilityPanel from "../components/workflows/GovernedRuntimeExplainabilityPanel.jsx";
import MoneyText from "../components/MoneyText.jsx";
import { useI18n } from "../i18n/useI18n.js";
import {
  buildConsolidationFinalizeDisabledReason,
  buildConsolidationRuntimeExplainabilityModel,
} from "./consolidationRuntimeExplainability.js";
import { exportRowsAsCsv } from "../utils/csvExport.js";
import { formatMoneyText } from "../utils/money.js";
import { createReportFingerprint } from "../utils/reportFingerprint.js";

const CONSOLIDATION_REPORT_ROUTE_PATH =
  "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari";
const PERSISTED_MEMBER_SUPPORT_ITEM_CODES = Object.freeze({
  memberBreakdown: "MEMBER_BREAKDOWN",
  selectedMemberLocalDrill: "SELECTED_MEMBER_LOCAL_DRILL",
});

function toInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatPeriodNo(value) {
  return String(value || "").padStart(2, "0");
}

function getRunField(run, camelKey, snakeKey = camelKey) {
  return run?.[camelKey] ?? run?.[snakeKey] ?? null;
}

function normalizeSummaryGroupBy(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["account", "entity", "account_entity"].includes(normalized)) {
    return normalized;
  }
  return "account_entity";
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${numeric.toFixed(2)}%`;
}

function formatPlainAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildEntityMemberMap(rows) {
  const nextMap = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const legalEntityId = toInt(row?.legal_entity_id ?? row?.legalEntityId);
    if (!legalEntityId || nextMap.has(legalEntityId)) {
      continue;
    }
    nextMap.set(legalEntityId, row);
  }
  return nextMap;
}

function normalizeCurrencyCodeList(value) {
  const codes = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((code) => String(code || "").trim())
        .filter(Boolean);
  return [...new Set(codes.map((code) => code.toUpperCase()))];
}

function getSupportCurrencyContext(row) {
  const codes = normalizeCurrencyCodeList(
    row?.sourceCurrencyCodes ??
      row?.source_currency_codes ??
      row?.source_currency_codes_csv,
  );
  const explicitCode = String(
    row?.sourceCurrencyCode ?? row?.source_currency_code ?? "",
  )
    .trim()
    .toUpperCase();
  const parsedCount = Number(
    row?.sourceCurrencyCount ?? row?.source_currency_count ?? 0,
  );
  const sourceCurrencyCount = Number.isFinite(parsedCount)
    ? Math.max(0, Math.trunc(parsedCount))
    : codes.length;
  const normalizedCodes =
    explicitCode && !codes.length ? [explicitCode] : codes;
  const primaryCode =
    explicitCode || (normalizedCodes.length === 1 ? normalizedCodes[0] : "");
  const hasMixedSourceCurrencies =
    Boolean(
      row?.hasMixedSourceCurrencies ?? row?.has_mixed_source_currencies,
    ) ||
    sourceCurrencyCount > 1 ||
    normalizedCodes.length > 1;

  return {
    sourceCurrencyCount: Math.max(sourceCurrencyCount, normalizedCodes.length),
    sourceCurrencyCodes: normalizedCodes,
    sourceCurrencyCode: primaryCode || null,
    hasMixedSourceCurrencies,
  };
}

function getReviewGateTone(level) {
  if (String(level || "").toUpperCase() === "BLOCKER") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function ActionButtonWithTooltip({
  disabled = false,
  disabledReason = "",
  children,
  ...props
}) {
  const button = (
    <button {...props} disabled={disabled}>
      {children}
    </button>
  );
  if (!disabled || !disabledReason) {
    return button;
  }
  return (
    <span className="inline-flex" title={disabledReason}>
      {button}
    </span>
  );
}

function buildDraftPostingDisabledReason({
  itemType = "adjustment",
  canPost = false,
  saving = "",
  rowId = "",
  l,
}) {
  const normalizedItemType = String(itemType || "").trim().toLowerCase();
  const savingKey =
    normalizedItemType === "elimination"
      ? `postElimination:${rowId}`
      : `postAdjustment:${rowId}`;
  if (saving === savingKey) {
    return l("Posting is already in progress.", "Posting zaten isleniyor.");
  }
  if (canPost) {
    return "";
  }
  return normalizedItemType === "elimination"
    ? l(
        "You do not have Consolidation / Post Eliminations authority at Group scope.",
        "Grup kapsaminda Konsolidasyon / Eliminasyonlari Post Et yetkiniz yok."
      )
    : l(
        "You do not have Consolidation / Post Adjustments authority at Group scope.",
        "Grup kapsaminda Konsolidasyon / Duzeltmeleri Post Et yetkiniz yok."
      );
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatAccountLabel(code, name) {
  const normalizedCode = String(code || "").trim();
  const normalizedName = String(name || "").trim();
  if (normalizedCode && normalizedName) {
    return `${normalizedCode} - ${normalizedName}`;
  }
  return normalizedCode || normalizedName || "-";
}

function formatEntityLabel(code, name) {
  return formatAccountLabel(code, name);
}

function getCurrencyContextMode(currencyContext) {
  if (currencyContext?.hasMixedSourceCurrencies) {
    return "MIXED";
  }
  if (currencyContext?.sourceCurrencyCode) {
    return "SINGLE";
  }
  return "UNAVAILABLE";
}

function buildSupportCurrencyExportFields(row) {
  const currencyContext = getSupportCurrencyContext(row);
  return {
    sourceCurrencyMode: getCurrencyContextMode(currencyContext),
    sourceCurrencyCode: currencyContext.sourceCurrencyCode || "",
    sourceCurrencyCodes: currencyContext.sourceCurrencyCodes.join(", "),
    sourceCurrencyCount: currencyContext.sourceCurrencyCount || 0,
  };
}

function LocalBaseSupportValue({ amount, currencyContext, t }) {
  const codesLabel = currencyContext.sourceCurrencyCodes.join(", ");

  return (
    <div>
      <div className="font-medium text-slate-900">
        {formatPlainAmount(amount)}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {currencyContext.hasMixedSourceCurrencies
          ? t(
              "consolidationReports.drill.mixedLocalCurrencies",
              "Mixed local currencies: {{codes}}",
              { codes: codesLabel || "-" },
            )
          : currencyContext.sourceCurrencyCode
            ? t(
                "consolidationReports.drill.functionalCurrency",
                "Functional currency: {{code}}",
                { code: currencyContext.sourceCurrencyCode },
              )
            : t(
                "consolidationReports.drill.currencyContextUnavailable",
                "Local currency context unavailable.",
              )}
      </div>
    </div>
  );
}

/**
 * Render the consolidated reporting flow, including RP11 drill-across from
 * consolidated rows into member-level support detail and then into local
 * report entry points.
 */
export default function ConsolidationReportsPage() {
  const { hasPermission } = useAuth();
  const { t, l } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const canReadRun = hasPermission("consolidation.run.read");
  const canReadBalanceSheet = hasPermission(
    "consolidation.report.balance_sheet.read",
  );
  const canReadIncomeStatement = hasPermission(
    "consolidation.report.income_statement.read",
  );
  const canReadConsolidatedTrialBalance = hasPermission(
    "consolidation.report.trial_balance.read",
  );
  const canReadConsolidatedSummary = hasPermission(
    "consolidation.report.summary.read",
  );
  const canReadGroupMembers = hasPermission("consolidation.group.read");
  const canReadWorkflow = hasPermission("org.tree.read");
  const canReadBookLookups = hasPermission("gl.book.read");
  const canReadLocalSummary = hasPermission("gl.report.local.read");
  const canReadLocalStatements = hasPermission("gl.report.statement.read");
  const canCreateRun = hasPermission("consolidation.run.create");
  const canExecuteRun = hasPermission("consolidation.run.execute");
  const canPostAdjustment = hasPermission("consolidation.adjustment.post");
  const canPostElimination = hasPermission("consolidation.elimination.post");
  const canFinalizeRuns = hasPermission("consolidation.run.finalize");
  const canCreateExportSnapshots = hasPermission("ops.export_snapshot.create");

  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runs, setRuns] = useState([]);
  const requestedRunId = String(toInt(searchParams.get("runId")) || "");
  const [form, setForm] = useState({
    runId: requestedRunId,
    includeDraft: false,
    includeZero: false,
    rateType: "CLOSING",
  });
  const [summaryGroupBy, setSummaryGroupBy] = useState("account_entity");
  const [balanceSheetReport, setBalanceSheetReport] = useState(null);
  const [incomeStatementReport, setIncomeStatementReport] = useState(null);
  const [trialBalanceReport, setTrialBalanceReport] = useState(null);
  const [summaryReport, setSummaryReport] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [eliminations, setEliminations] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [memberBooks, setMemberBooks] = useState([]);
  const [memberBooksLoading, setMemberBooksLoading] = useState(false);
  const [memberBooksError, setMemberBooksError] = useState("");
  const [selectedSupportRow, setSelectedSupportRow] = useState(null);
  const [selectedMemberRow, setSelectedMemberRow] = useState(null);
  const [selectedMemberBookId, setSelectedMemberBookId] = useState("");
  const [reviewGateVersion, setReviewGateVersion] = useState(0);
  const [reviewGate, setReviewGate] = useState({
    loading: false,
    error: "",
    data: null,
  });
  const [auditFingerprintState, setAuditFingerprintState] = useState({
    loading: false,
    error: "",
    rows: {},
  });
  const [persistedSnapshotResult, setPersistedSnapshotResult] = useState(null);

  const selectedRun = useMemo(() => {
    const selectedId = toInt(form.runId);
    if (!selectedId) {
      return null;
    }
    return runs.find((row) => Number(row.id) === selectedId) || null;
  }, [form.runId, runs]);

  useEffect(() => {
    if (!requestedRunId) {
      return;
    }
    setForm((prev) =>
      prev.runId === requestedRunId ? prev : { ...prev, runId: requestedRunId }
    );
  }, [requestedRunId]);

  useEffect(() => {
    const normalizedRunId = String(toInt(form.runId) || "");
    const currentRunId = String(toInt(searchParams.get("runId")) || "");
    if (normalizedRunId === currentRunId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (normalizedRunId) {
      nextParams.set("runId", normalizedRunId);
    } else {
      nextParams.delete("runId");
    }

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [form.runId, searchParams, setSearchParams]);
  const presentationCurrencyCode = useMemo(
    () =>
      String(
        selectedRun?.presentationCurrencyCode ||
          selectedRun?.presentation_currency_code ||
          "",
      )
        .trim()
        .toUpperCase(),
    [selectedRun],
  );
  const selectedRunGroupId = toInt(
    getRunField(selectedRun, "consolidationGroupId", "consolidation_group_id"),
  );
  const selectedRunFiscalPeriodId = toInt(
    getRunField(selectedRun, "fiscalPeriodId", "fiscal_period_id"),
  );
  const finalizeActionDisabledReason = useMemo(
    () =>
      buildConsolidationFinalizeDisabledReason({
        selectedRun,
        reviewGateLoading: reviewGate.loading,
        reviewGateData: reviewGate.data,
        canFinalizeRuns,
        saving,
        l,
      }),
    [selectedRun, reviewGate.loading, reviewGate.data, canFinalizeRuns, saving, l],
  );
  const consolidationExplainabilityModel = useMemo(
    () =>
      buildConsolidationRuntimeExplainabilityModel({
        selectedRun,
        reviewGateData: reviewGate.data,
        reviewGateLoading: reviewGate.loading,
        reviewGateError: reviewGate.error,
        canCreateRun,
        canExecuteRun,
        canPostAdjustment,
        canPostElimination,
        canFinalizeRuns,
        finalizeDisabledReason: finalizeActionDisabledReason,
        l,
      }),
    [
      selectedRun,
      reviewGate.data,
      reviewGate.loading,
      reviewGate.error,
      canCreateRun,
      canExecuteRun,
      canPostAdjustment,
      canPostElimination,
      canFinalizeRuns,
      finalizeActionDisabledReason,
      l,
    ],
  );
  const balanceSheetRows = useMemo(
    () =>
      Array.isArray(balanceSheetReport?.rows) ? balanceSheetReport.rows : [],
    [balanceSheetReport],
  );
  const incomeStatementRows = useMemo(
    () =>
      Array.isArray(incomeStatementReport?.rows)
        ? incomeStatementReport.rows
        : [],
    [incomeStatementReport],
  );
  const trialBalanceRows = useMemo(
    () =>
      Array.isArray(trialBalanceReport?.rows) ? trialBalanceReport.rows : [],
    [trialBalanceReport],
  );
  const summaryRows = useMemo(
    () => (Array.isArray(summaryReport?.rows) ? summaryReport.rows : []),
    [summaryReport],
  );
  const groupMemberMap = useMemo(
    () => buildEntityMemberMap(groupMembers),
    [groupMembers],
  );
  const memberBreakdownRows = useMemo(() => {
    if (!selectedSupportRow || !Array.isArray(summaryReport?.rows)) {
      return [];
    }
    const accountId = toInt(selectedSupportRow.accountId);
    if (!accountId) {
      return [];
    }

    return summaryReport.rows
      .map((row) => {
        const legalEntityId = toInt(row.legalEntityId ?? row.legal_entity_id);
        const memberContext = legalEntityId
          ? groupMemberMap.get(legalEntityId)
          : null;
        return {
          accountId: toInt(row.accountId ?? row.account_id),
          accountCode: row.accountCode ?? row.account_code ?? null,
          accountName: row.accountName ?? row.account_name ?? null,
          legalEntityId,
          legalEntityCode: row.legalEntityCode ?? row.legal_entity_code ?? null,
          legalEntityName: row.legalEntityName ?? row.legal_entity_name ?? null,
          localDebitTotal: Number(
            row.localDebitTotal ?? row.local_debit_total ?? 0,
          ),
          localCreditTotal: Number(
            row.localCreditTotal ?? row.local_credit_total ?? 0,
          ),
          localBalanceTotal: Number(
            row.localBalanceTotal ?? row.local_balance_total ?? 0,
          ),
          translatedDebitTotal: Number(
            row.translatedDebitTotal ?? row.translated_debit_total ?? 0,
          ),
          translatedCreditTotal: Number(
            row.translatedCreditTotal ?? row.translated_credit_total ?? 0,
          ),
          translatedBalanceTotal: Number(
            row.translatedBalanceTotal ?? row.translated_balance_total ?? 0,
          ),
          sourceCurrencyCode:
            row.sourceCurrencyCode ?? row.source_currency_code ?? null,
          sourceCurrencyCodes:
            row.sourceCurrencyCodes ?? row.source_currency_codes ?? [],
          sourceCurrencyCount:
            row.sourceCurrencyCount ?? row.source_currency_count ?? 0,
          hasMixedSourceCurrencies:
            row.hasMixedSourceCurrencies ??
            row.has_mixed_source_currencies ??
            false,
          consolidationMethod:
            memberContext?.consolidation_method ??
            memberContext?.consolidationMethod ??
            null,
          ownershipPct:
            memberContext?.ownership_pct ?? memberContext?.ownershipPct ?? null,
        };
      })
      .filter((row) => row.accountId === accountId);
  }, [groupMemberMap, selectedSupportRow, summaryReport]);
  const selectedMemberEntityId = toInt(
    selectedMemberRow?.legalEntityId ?? selectedMemberRow?.legal_entity_id,
  );
  const selectedMemberBook = useMemo(() => {
    const bookId = toInt(selectedMemberBookId);
    if (!bookId) {
      return null;
    }
    return memberBooks.find((row) => Number(row?.id) === bookId) || null;
  }, [memberBooks, selectedMemberBookId]);
  const selectedMemberCurrencyContext = useMemo(
    () => getSupportCurrencyContext(selectedMemberRow),
    [selectedMemberRow],
  );
  const selectedSupportAccountId = toInt(
    selectedSupportRow?.accountId ?? selectedSupportRow?.account_id,
  );

  useEffect(() => {
    if (!selectedRun || !canReadRun) {
      setReviewGate({
        loading: false,
        error: "",
        data: null,
      });
      return;
    }

    let cancelled = false;
    async function loadReviewGate() {
      setReviewGate((prev) => ({
        ...prev,
        loading: true,
        error: "",
      }));
      try {
        const response = await getConsolidationRunReviewGate(selectedRun.id);
        if (!cancelled) {
          setReviewGate({
            loading: false,
            error: "",
            data: response || null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setReviewGate({
            loading: false,
            error:
              err?.response?.data?.message ||
              t(
                "consolidationReports.workflow.loadFailed",
                "Failed to load consolidation review gate.",
              ),
            data: null,
          });
        }
      }
    }

    void loadReviewGate();
    return () => {
      cancelled = true;
    };
  }, [selectedRun, canReadRun, reviewGateVersion, t]);

  useEffect(() => {
    // Clear loaded evidence whenever the selected run changes so RP13
    // fingerprints/exports never mix one run's snapshot with another run's id.
    setSelectedSupportRow(null);
    setSelectedMemberRow(null);
    setSelectedMemberBookId("");
    setMemberBooks([]);
    setMemberBooksError("");
    setBalanceSheetReport(null);
    setIncomeStatementReport(null);
    setTrialBalanceReport(null);
    setSummaryReport(null);
    setAdjustments([]);
    setEliminations([]);
    setAuditFingerprintState({
      loading: false,
      error: "",
      rows: {},
    });
    setPersistedSnapshotResult(null);
  }, [selectedRun?.id]);

  useEffect(() => {
    setPersistedSnapshotResult(null);
  }, [selectedMemberBookId, selectedMemberEntityId, selectedSupportAccountId]);

  useEffect(() => {
    if (!selectedRunGroupId || !canReadGroupMembers) {
      setGroupMembers([]);
      return;
    }

    let cancelled = false;

    async function loadGroupMembers() {
      try {
        const response =
          await listConsolidationGroupMembers(selectedRunGroupId);
        if (!cancelled) {
          setGroupMembers(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch {
        if (!cancelled) {
          setGroupMembers([]);
        }
      }
    }

    void loadGroupMembers();

    return () => {
      cancelled = true;
    };
  }, [canReadGroupMembers, selectedRunGroupId]);

  useEffect(() => {
    if (!selectedMemberEntityId || !canReadBookLookups) {
      setMemberBooks([]);
      setSelectedMemberBookId("");
      setMemberBooksError("");
      setMemberBooksLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMemberBooks() {
      setMemberBooksLoading(true);
      setMemberBooksError("");
      try {
        const response = await listBooks({
          legalEntityId: selectedMemberEntityId,
        });
        if (cancelled) {
          return;
        }

        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setMemberBooks(rows);
        setSelectedMemberBookId((prev) => {
          const currentId = toInt(prev);
          if (currentId && rows.some((row) => Number(row?.id) === currentId)) {
            return prev;
          }
          // Only auto-select a member book when the entity has exactly one
          // option; otherwise force an explicit choice before local drill-across.
          if (rows.length === 1) {
            return String(rows[0]?.id || "");
          }
          return "";
        });
      } catch (err) {
        if (!cancelled) {
          setMemberBooks([]);
          setSelectedMemberBookId("");
          setMemberBooksError(
            err?.response?.data?.message ||
              t(
                "consolidationReports.drill.booksFailed",
                "Failed to load member books for local drill-across.",
              ),
          );
        }
      } finally {
        if (!cancelled) {
          setMemberBooksLoading(false);
        }
      }
    }

    void loadMemberBooks();

    return () => {
      cancelled = true;
    };
  }, [canReadBookLookups, selectedMemberEntityId, t]);

  async function loadRuns() {
    if (!canReadRun) {
      return;
    }

    setLoadingRuns(true);
    setError("");
    try {
      const res = await listConsolidationRuns();
      const rows = res?.rows || [];
      setRuns(rows);
      setForm((prev) => {
        const currentRunId = toInt(prev.runId);
        if (
          currentRunId &&
          rows.some((row) => Number(row.id) === currentRunId)
        ) {
          return prev;
        }
        return { ...prev, runId: String(rows[0]?.id || prev.runId || "") };
      });
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t("consolidationReports.loadRunsFailed"),
      );
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadRun]);

  function resolveRunId() {
    const runId = toInt(form.runId);
    if (!runId) {
      setError(t("consolidationReports.runRequired"));
      return null;
    }
    return runId;
  }

  async function onLoadBalanceSheet() {
    if (!canReadBalanceSheet) {
      setError(t("consolidationReports.missingPermissionBs"));
      return;
    }

    const runId = resolveRunId();
    if (!runId) {
      return;
    }

    setSaving("balanceSheet");
    setError("");
    setMessage("");
    try {
      const res = await getConsolidatedBalanceSheet(runId, {
        includeDraft: form.includeDraft,
        includeZero: form.includeZero,
        rateType: form.rateType,
      });
      setBalanceSheetReport(res || null);
      setMessage(t("consolidationReports.loadBsSuccess"));
    } catch (err) {
      setError(
        err?.response?.data?.message || t("consolidationReports.loadBsFailed"),
      );
    } finally {
      setSaving("");
    }
  }

  async function onLoadIncomeStatement() {
    if (!canReadIncomeStatement) {
      setError(t("consolidationReports.missingPermissionIs"));
      return;
    }

    const runId = resolveRunId();
    if (!runId) {
      return;
    }

    setSaving("incomeStatement");
    setError("");
    setMessage("");
    try {
      const res = await getConsolidatedIncomeStatement(runId, {
        includeDraft: form.includeDraft,
        includeZero: form.includeZero,
        rateType: form.rateType,
      });
      setIncomeStatementReport(res || null);
      setMessage(t("consolidationReports.loadIsSuccess"));
    } catch (err) {
      setError(
        err?.response?.data?.message || t("consolidationReports.loadIsFailed"),
      );
    } finally {
      setSaving("");
    }
  }

  async function onLoadConsolidatedTrialBalance() {
    if (!canReadConsolidatedTrialBalance) {
      setError(
        t(
          "consolidationReports.missingPermissionTb",
          "Missing permission to read consolidated trial balance.",
        ),
      );
      return;
    }

    const runId = resolveRunId();
    if (!runId) {
      return;
    }

    setSaving("trialBalance");
    setError("");
    setMessage("");
    try {
      const res = await getConsolidatedTrialBalance(runId);
      setTrialBalanceReport(res || null);
      setMessage(
        t(
          "consolidationReports.loadTbSuccess",
          "Consolidated trial balance loaded.",
        ),
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t(
            "consolidationReports.loadTbFailed",
            "Failed to load consolidated trial balance.",
          ),
      );
    } finally {
      setSaving("");
    }
  }

  async function onLoadConsolidatedSummary(nextGroupBy = summaryGroupBy) {
    if (!canReadConsolidatedSummary) {
      setError(
        t(
          "consolidationReports.missingPermissionSummary",
          "Missing permission to read consolidated summary.",
        ),
      );
      return null;
    }

    const runId = resolveRunId();
    if (!runId) {
      return null;
    }

    const normalizedGroupBy = normalizeSummaryGroupBy(nextGroupBy);

    setSaving("summary");
    setError("");
    setMessage("");
    try {
      const res = await getConsolidatedSummary(runId, {
        groupBy: normalizedGroupBy,
      });
      setSummaryGroupBy(normalizedGroupBy);
      setSummaryReport(res || null);
      setMessage(
        t(
          "consolidationReports.loadSummarySuccess",
          "Consolidated summary loaded.",
        ),
      );
      return res || null;
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t(
            "consolidationReports.loadSummaryFailed",
            "Failed to load consolidated summary.",
          ),
      );
      return null;
    } finally {
      setSaving("");
    }
  }

  async function onSelectSupportRow(nextRow) {
    if (!nextRow) {
      return;
    }

    setSelectedSupportRow(nextRow);
    setSelectedMemberRow(null);
    setSelectedMemberBookId("");

    if (summaryReport?.groupBy === "account_entity") {
      return;
    }

    await onLoadConsolidatedSummary("account_entity");
  }

  async function onLoadDraftWorklist() {
    if (!canReadRun) {
      setError(t("consolidationReports.missingPermissionRun"));
      return;
    }

    const runId = resolveRunId();
    if (!runId) {
      return;
    }

    setSaving("worklist");
    setError("");
    setMessage("");
    try {
      const [adjustmentRes, eliminationRes] = await Promise.all([
        listConsolidationAdjustments(runId, { status: "ALL" }),
        listConsolidationEliminations(runId, {
          status: "ALL",
          includeLines: false,
        }),
      ]);
      setAdjustments(adjustmentRes?.rows || []);
      setEliminations(eliminationRes?.rows || []);
      setMessage(t("consolidationReports.loadWorklistSuccess"));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t("consolidationReports.loadWorklistFailed"),
      );
    } finally {
      setSaving("");
    }
  }

  async function onPostAdjustment(adjustmentId) {
    if (!canPostAdjustment) {
      setError(t("consolidationReports.missingPermissionAdj"));
      return;
    }
    const runId = resolveRunId();
    if (!runId) {
      return;
    }

    setSaving(`postAdjustment:${adjustmentId}`);
    setError("");
    setMessage("");
    try {
      await postConsolidationAdjustment(runId, adjustmentId);
      setMessage(
        t("consolidationReports.postAdjSuccess", { id: adjustmentId }),
      );
      await onLoadDraftWorklist();
      setReviewGateVersion((prev) => prev + 1);
    } catch (err) {
      setError(
        err?.response?.data?.message || t("consolidationReports.postAdjFailed"),
      );
    } finally {
      setSaving("");
    }
  }

  async function onPostElimination(eliminationEntryId) {
    if (!canPostElimination) {
      setError(t("consolidationReports.missingPermissionElim"));
      return;
    }
    const runId = resolveRunId();
    if (!runId) {
      return;
    }

    setSaving(`postElimination:${eliminationEntryId}`);
    setError("");
    setMessage("");
    try {
      await postConsolidationElimination(runId, eliminationEntryId);
      setMessage(
        t("consolidationReports.postElimSuccess", { id: eliminationEntryId }),
      );
      await onLoadDraftWorklist();
      setReviewGateVersion((prev) => prev + 1);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t("consolidationReports.postElimFailed"),
      );
    } finally {
      setSaving("");
    }
  }

  async function onFinalizeRun() {
    if (!canFinalizeRuns) {
      setError(
        t(
          "consolidationReports.finalize.missingPermission",
          "Missing permission: consolidation.run.finalize",
        ),
      );
      return;
    }
    const runId = resolveRunId();
    if (!runId) {
      return;
    }

    setSaving("finalize");
    setError("");
    setMessage("");
    try {
      await finalizeConsolidationRun(runId);
      setMessage(
        t(
          "consolidationReports.finalize.success",
          "Consolidation run finalized.",
        ),
      );
      await loadRuns();
      setReviewGateVersion((prev) => prev + 1);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t(
            "consolidationReports.finalize.failed",
            "Failed to finalize consolidation run.",
          ),
      );
    } finally {
      setSaving("");
    }
  }

  const selectedSupportAccountCode =
    selectedSupportRow?.accountCode || selectedSupportRow?.account_code || "-";
  const selectedSupportAccountName =
    selectedSupportRow?.accountName || selectedSupportRow?.account_name || "-";

  const localDrillParams =
    selectedMemberEntityId &&
    toInt(selectedMemberBookId) &&
    selectedRunFiscalPeriodId
      ? {
          legalEntityId: selectedMemberEntityId,
          bookId: toInt(selectedMemberBookId),
          fiscalPeriodId: selectedRunFiscalPeriodId,
        }
      : null;

  const trialBalanceLocation = localDrillParams
    ? buildLocalReportLocation("trialBalance", localDrillParams)
    : "";
  const balanceSheetLocation = localDrillParams
    ? buildLocalReportLocation("balanceSheet", localDrillParams)
    : "";
  const incomeStatementLocation = localDrillParams
    ? buildLocalReportLocation("incomeStatement", localDrillParams)
    : "";
  const auditReportSpecs = useMemo(() => {
    const runId = toInt(selectedRun?.id);
    if (!runId) {
      return [];
    }

    const runContext = {
      consolidationGroupCode: selectedRun?.consolidation_group_code || "",
      consolidationGroupName: selectedRun?.consolidation_group_name || "",
      fiscalYear: selectedRun?.fiscal_year || "",
      periodNo: selectedRun?.period_no || "",
      periodName: selectedRun?.period_name || "",
      runStatus: selectedRun?.status || "",
      presentationCurrencyCode,
    };
    const commonParameters = {
      runId,
      includeDraft: form.includeDraft,
      includeZero: form.includeZero,
      rateType: form.rateType,
    };
    const specs = [];

    if (balanceSheetReport?.totals || balanceSheetRows.length > 0) {
      specs.push({
        key: "balanceSheet",
        label: t(
          "consolidationReports.audit.balanceSheet",
          "Consolidated balance sheet",
        ),
        rowCount: balanceSheetRows.length,
        fileName: `track51-consolidated-balance-sheet-run-${runId}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "runId", header: "Run Id" },
          { key: "rateType", header: "Rate Type" },
          { key: "includeDraft", header: "Include Draft" },
          { key: "includeZero", header: "Include Zero" },
          { key: "reportingCurrencyCode", header: "Reporting Currency" },
          { key: "accountCode", header: "Account Code" },
          { key: "accountName", header: "Account Name" },
          { key: "accountType", header: "Account Type" },
          { key: "normalizedFinalBalance", header: "Normalized Final Balance" },
        ],
        exportRows: balanceSheetRows.map((row) => ({
          runId,
          rateType: form.rateType,
          includeDraft: form.includeDraft ? "YES" : "NO",
          includeZero: form.includeZero ? "YES" : "NO",
          reportingCurrencyCode: presentationCurrencyCode,
          accountCode: row.accountCode || row.account_code || "",
          accountName: row.accountName || row.account_name || "",
          accountType: row.accountType || row.account_type || "",
          normalizedFinalBalance: Number(
            row.normalizedFinalBalance ?? row.normalized_final_balance ?? 0,
          ),
        })),
        fingerprintParameters: {
          ...commonParameters,
          surface: "balanceSheet",
        },
        fingerprintContext: runContext,
        fingerprintSnapshot: balanceSheetReport,
      });
    }

    if (incomeStatementReport?.totals || incomeStatementRows.length > 0) {
      specs.push({
        key: "incomeStatement",
        label: t(
          "consolidationReports.audit.incomeStatement",
          "Consolidated income statement",
        ),
        rowCount: incomeStatementRows.length,
        fileName: `track51-consolidated-income-statement-run-${runId}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "runId", header: "Run Id" },
          { key: "rateType", header: "Rate Type" },
          { key: "includeDraft", header: "Include Draft" },
          { key: "includeZero", header: "Include Zero" },
          { key: "reportingCurrencyCode", header: "Reporting Currency" },
          { key: "accountCode", header: "Account Code" },
          { key: "accountName", header: "Account Name" },
          { key: "accountType", header: "Account Type" },
          { key: "normalizedFinalBalance", header: "Normalized Final Balance" },
        ],
        exportRows: incomeStatementRows.map((row) => ({
          runId,
          rateType: form.rateType,
          includeDraft: form.includeDraft ? "YES" : "NO",
          includeZero: form.includeZero ? "YES" : "NO",
          reportingCurrencyCode: presentationCurrencyCode,
          accountCode: row.accountCode || row.account_code || "",
          accountName: row.accountName || row.account_name || "",
          accountType: row.accountType || row.account_type || "",
          normalizedFinalBalance: Number(
            row.normalizedFinalBalance ?? row.normalized_final_balance ?? 0,
          ),
        })),
        fingerprintParameters: {
          ...commonParameters,
          surface: "incomeStatement",
        },
        fingerprintContext: runContext,
        fingerprintSnapshot: incomeStatementReport,
      });
    }

    if (trialBalanceRows.length > 0) {
      specs.push({
        key: "trialBalance",
        label: t(
          "consolidationReports.audit.trialBalance",
          "Consolidated trial balance",
        ),
        rowCount: trialBalanceRows.length,
        fileName: `track51-consolidated-trial-balance-run-${runId}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "runId", header: "Run Id" },
          { key: "reportingCurrencyCode", header: "Reporting Currency" },
          { key: "accountCode", header: "Account Code" },
          { key: "accountName", header: "Account Name" },
          { key: "debitTotal", header: "Debit Total" },
          { key: "creditTotal", header: "Credit Total" },
          { key: "balance", header: "Balance" },
        ],
        exportRows: trialBalanceRows.map((row) => ({
          runId,
          reportingCurrencyCode: presentationCurrencyCode,
          accountCode: row.account_code || row.accountCode || "",
          accountName: row.account_name || row.accountName || "",
          debitTotal: Number(row.debit_total ?? row.debitTotal ?? 0),
          creditTotal: Number(row.credit_total ?? row.creditTotal ?? 0),
          balance: Number(row.balance ?? 0),
        })),
        fingerprintParameters: {
          runId,
          surface: "trialBalance",
        },
        fingerprintContext: runContext,
        fingerprintSnapshot: trialBalanceReport,
      });
    }

    if (summaryRows.length > 0) {
      specs.push({
        key: "summary",
        label: t("consolidationReports.audit.summary", "Consolidated summary"),
        rowCount: summaryRows.length,
        fileName: `track51-consolidated-summary-run-${runId}-${summaryReport?.groupBy || summaryGroupBy}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "runId", header: "Run Id" },
          { key: "groupBy", header: "Group By" },
          { key: "reportingCurrencyCode", header: "Reporting Currency" },
          { key: "accountCode", header: "Account Code" },
          { key: "accountName", header: "Account Name" },
          { key: "legalEntityCode", header: "Member Entity Code" },
          { key: "legalEntityName", header: "Member Entity Name" },
          { key: "localBalanceTotal", header: "Local Base Sum" },
          { key: "sourceCurrencyMode", header: "Source Currency Mode" },
          { key: "sourceCurrencyCode", header: "Source Currency" },
          { key: "sourceCurrencyCodes", header: "Source Currency Codes" },
          { key: "sourceCurrencyCount", header: "Source Currency Count" },
          { key: "translatedBalanceTotal", header: "Translated Balance" },
        ],
        exportRows: summaryRows.map((row) => ({
          runId,
          groupBy: summaryReport?.groupBy || summaryGroupBy,
          reportingCurrencyCode: presentationCurrencyCode,
          accountCode: row.account_code || row.accountCode || "",
          accountName: row.account_name || row.accountName || "",
          legalEntityCode: row.legal_entity_code || row.legalEntityCode || "",
          legalEntityName: row.legal_entity_name || row.legalEntityName || "",
          localBalanceTotal: Number(
            row.local_balance_total ?? row.localBalanceTotal ?? 0,
          ),
          translatedBalanceTotal: Number(
            row.translated_balance_total ?? row.translatedBalanceTotal ?? 0,
          ),
          ...buildSupportCurrencyExportFields(row),
        })),
        fingerprintParameters: {
          runId,
          surface: "summary",
          groupBy: summaryReport?.groupBy || summaryGroupBy,
        },
        fingerprintContext: runContext,
        fingerprintSnapshot: summaryReport,
      });
    }

    if (selectedSupportRow && memberBreakdownRows.length > 0) {
      specs.push({
        key: "memberBreakdown",
        label: t(
          "consolidationReports.audit.memberBreakdown",
          "Member breakdown",
        ),
        rowCount: memberBreakdownRows.length,
        fileName: `track51-member-breakdown-run-${runId}-${selectedSupportAccountCode}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "runId", header: "Run Id" },
          { key: "groupAccountCode", header: "Group Account Code" },
          { key: "groupAccountName", header: "Group Account Name" },
          { key: "reportingCurrencyCode", header: "Reporting Currency" },
          { key: "legalEntityCode", header: "Member Entity Code" },
          { key: "legalEntityName", header: "Member Entity Name" },
          { key: "consolidationMethod", header: "Consolidation Method" },
          { key: "ownershipPct", header: "Ownership Pct" },
          { key: "localBalanceTotal", header: "Local Base Sum" },
          { key: "sourceCurrencyMode", header: "Source Currency Mode" },
          { key: "sourceCurrencyCode", header: "Source Currency" },
          { key: "sourceCurrencyCodes", header: "Source Currency Codes" },
          { key: "sourceCurrencyCount", header: "Source Currency Count" },
          { key: "translatedBalanceTotal", header: "Translated Balance" },
        ],
        exportRows: memberBreakdownRows.map((row) => ({
          runId,
          groupAccountCode: selectedSupportAccountCode,
          groupAccountName: selectedSupportAccountName,
          reportingCurrencyCode: presentationCurrencyCode,
          legalEntityCode: row.legalEntityCode || "",
          legalEntityName: row.legalEntityName || "",
          consolidationMethod: row.consolidationMethod || "",
          ownershipPct: row.ownershipPct ?? "",
          localBalanceTotal: Number(row.localBalanceTotal ?? 0),
          translatedBalanceTotal: Number(row.translatedBalanceTotal ?? 0),
          ...buildSupportCurrencyExportFields(row),
        })),
        fingerprintParameters: {
          runId,
          surface: "memberBreakdown",
          supportAccountId: toInt(selectedSupportRow?.accountId),
        },
        fingerprintContext: {
          ...runContext,
          selectedSupportAccountCode,
          selectedSupportAccountName,
        },
        fingerprintSnapshot: {
          selectedSupportRow,
          memberBreakdownRows,
        },
      });
    }

    if (selectedMemberRow) {
      specs.push({
        key: "selectedMemberLocalDrill",
        label: t(
          "consolidationReports.audit.localDrill",
          "Selected member local drill context",
        ),
        rowCount: 1,
        fileName: `track51-member-local-drill-run-${runId}-${selectedSupportAccountCode}-${selectedMemberEntityId || "na"}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "runId", header: "Run Id" },
          { key: "groupAccountCode", header: "Group Account Code" },
          { key: "groupAccountName", header: "Group Account Name" },
          { key: "reportingCurrencyCode", header: "Reporting Currency" },
          { key: "legalEntityCode", header: "Member Entity Code" },
          { key: "legalEntityName", header: "Member Entity Name" },
          { key: "consolidationMethod", header: "Consolidation Method" },
          { key: "ownershipPct", header: "Ownership Pct" },
          { key: "localBalanceTotal", header: "Local Base Sum" },
          { key: "sourceCurrencyMode", header: "Source Currency Mode" },
          { key: "sourceCurrencyCode", header: "Source Currency" },
          { key: "sourceCurrencyCodes", header: "Source Currency Codes" },
          { key: "sourceCurrencyCount", header: "Source Currency Count" },
          { key: "translatedBalanceTotal", header: "Translated Balance" },
          { key: "localBookId", header: "Local Book Id" },
          { key: "localBookCode", header: "Local Book Code" },
          { key: "localBookName", header: "Local Book Name" },
          { key: "memberMizanPath", header: "Member Mizan Path" },
          { key: "memberBilancoPath", header: "Member Bilanco Path" },
          { key: "memberGelirPath", header: "Member Gelir Tablosu Path" },
        ],
        exportRows: [
          {
            runId,
            groupAccountCode: selectedSupportAccountCode,
            groupAccountName: selectedSupportAccountName,
            reportingCurrencyCode: presentationCurrencyCode,
            legalEntityCode: selectedMemberRow.legalEntityCode || "",
            legalEntityName: selectedMemberRow.legalEntityName || "",
            consolidationMethod: selectedMemberRow.consolidationMethod || "",
            ownershipPct: selectedMemberRow.ownershipPct ?? "",
            localBalanceTotal: Number(selectedMemberRow.localBalanceTotal ?? 0),
            translatedBalanceTotal: Number(
              selectedMemberRow.translatedBalanceTotal ?? 0,
            ),
            localBookId: selectedMemberBook?.id || "",
            localBookCode: selectedMemberBook?.code || "",
            localBookName: selectedMemberBook?.name || "",
            memberMizanPath: trialBalanceLocation,
            memberBilancoPath: balanceSheetLocation,
            memberGelirPath: incomeStatementLocation,
            ...buildSupportCurrencyExportFields(selectedMemberRow),
          },
        ],
        fingerprintParameters: {
          runId,
          surface: "selectedMemberLocalDrill",
          supportAccountId: toInt(selectedSupportRow?.accountId),
          legalEntityId: selectedMemberEntityId,
          selectedMemberBookId: toInt(selectedMemberBookId),
        },
        fingerprintContext: {
          ...runContext,
          selectedSupportAccountCode,
          selectedSupportAccountName,
          selectedMemberLabel: formatEntityLabel(
            selectedMemberRow.legalEntityCode,
            selectedMemberRow.legalEntityName,
          ),
        },
        fingerprintSnapshot: {
          selectedMemberRow,
          selectedMemberBook,
          localDrillLocations: {
            trialBalanceLocation,
            balanceSheetLocation,
            incomeStatementLocation,
          },
        },
      });
    }

    return specs;
  }, [
    balanceSheetLocation,
    balanceSheetReport,
    balanceSheetRows,
    form.includeDraft,
    form.includeZero,
    form.rateType,
    incomeStatementLocation,
    incomeStatementReport,
    incomeStatementRows,
    memberBreakdownRows,
    presentationCurrencyCode,
    selectedMemberBook,
    selectedMemberBookId,
    selectedMemberEntityId,
    selectedMemberRow,
    selectedRun,
    selectedSupportAccountCode,
    selectedSupportAccountName,
    selectedSupportRow,
    summaryGroupBy,
    summaryReport,
    summaryRows,
    t,
    trialBalanceLocation,
    trialBalanceReport,
    trialBalanceRows,
  ]);
  const selectedMemberAuditSpecs = useMemo(
    () =>
      auditReportSpecs.filter((spec) =>
        Object.prototype.hasOwnProperty.call(
          PERSISTED_MEMBER_SUPPORT_ITEM_CODES,
          spec.key,
        ),
      ),
    [auditReportSpecs],
  );

  useEffect(() => {
    if (!auditReportSpecs.length) {
      setAuditFingerprintState({
        loading: false,
        error: "",
        rows: {},
      });
      return;
    }

    let cancelled = false;

    async function loadAuditFingerprints() {
      setAuditFingerprintState((previous) => ({
        ...previous,
        loading: true,
        error: "",
      }));
      try {
        const entries = await Promise.all(
          auditReportSpecs.map(async (spec) => {
            const fingerprint = await createReportFingerprint({
              reportKey: spec.key,
              routePath: CONSOLIDATION_REPORT_ROUTE_PATH,
              parameters: spec.fingerprintParameters,
              context: spec.fingerprintContext,
              reportSnapshot: spec.fingerprintSnapshot,
            });
            return [spec.key, fingerprint];
          }),
        );
        if (!cancelled) {
          setAuditFingerprintState({
            loading: false,
            error: "",
            rows: Object.fromEntries(entries),
          });
        }
      } catch (err) {
        if (!cancelled) {
          setAuditFingerprintState({
            loading: false,
            error:
              err?.message ||
              t(
                "consolidationReports.audit.fingerprintFailed",
                "Failed to build report fingerprints.",
              ),
            rows: {},
          });
        }
      }
    }

    void loadAuditFingerprints();
    return () => {
      cancelled = true;
    };
  }, [auditReportSpecs, t]);

  function handleExportAuditCsv(spec) {
    if (!spec) {
      return;
    }
    setError("");
    setMessage("");
    const exported = exportRowsAsCsv({
      rows: spec.exportRows,
      columns: spec.exportColumns,
      fileName: spec.fileName,
    });
    if (!exported) {
      setError(
        t(
          "consolidationReports.audit.exportUnavailable",
          "CSV export is only available in browser sessions.",
        ),
      );
      return;
    }
    setMessage(
      t(
        "consolidationReports.audit.exportReady",
        "Audit CSV ready for {{label}} ({{count}} rows).",
        {
          label: spec.label,
          count: spec.exportRows.length,
        },
      ),
    );
  }

  async function handlePersistMemberSupportSnapshot() {
    const runId = toInt(selectedRun?.id);
    if (!runId || !selectedMemberEntityId || !selectedSupportAccountId) {
      setError(
        t(
          "consolidationReports.audit.persistMissingSelection",
          "Select one support account and one member support row before persisting immutable evidence.",
        ),
      );
      return;
    }
    if (!canCreateExportSnapshots) {
      setError(
        t(
          "consolidationReports.audit.persistPermission",
          "Missing permission: ops.export_snapshot.create",
        ),
      );
      return;
    }
    if (auditFingerprintState.loading) {
      setError(
        t(
          "consolidationReports.audit.persistWaitForFingerprint",
          "Wait for the current report fingerprints to finish building before persisting the snapshot.",
        ),
      );
      return;
    }
    if (selectedMemberAuditSpecs.length === 0) {
      setError(
        t(
          "consolidationReports.audit.persistNoSpecs",
          "The selected member support chain does not have a persistable audit snapshot yet.",
        ),
      );
      return;
    }

    try {
      const items = selectedMemberAuditSpecs.map((spec) => {
        const fingerprintRow = auditFingerprintState.rows?.[spec.key];
        if (!fingerprintRow?.fingerprintSha256 || !fingerprintRow?.basisJson) {
          throw new Error(
            t(
              "consolidationReports.audit.persistFingerprintUnavailable",
              "One or more audit fingerprints are still missing for the selected member support chain.",
            ),
          );
        }
        return {
          itemCode: PERSISTED_MEMBER_SUPPORT_ITEM_CODES[spec.key],
          reportKey: spec.key,
          label: spec.label,
          fileName: spec.fileName,
          exportColumns: spec.exportColumns,
          exportRows: spec.exportRows,
          clientFingerprintSha256: fingerprintRow.fingerprintSha256,
          clientFingerprintBasisJson: fingerprintRow.basisJson,
        };
      });

      setSaving("persistSnapshot");
      setError("");
      setMessage("");
      const response = await createConsolidationRunMemberSupportSnapshot(runId, {
        routePath: CONSOLIDATION_REPORT_ROUTE_PATH,
        selectedMemberLegalEntityId: selectedMemberEntityId,
        selectedMemberBookId: toInt(selectedMemberBookId) || undefined,
        supportAccountId: selectedSupportAccountId,
        reportOptions: {
          includeDraft: form.includeDraft,
          includeZero: form.includeZero,
          rateType: form.rateType,
          summaryGroupBy,
        },
        items,
      });
      setPersistedSnapshotResult(response || null);
      setMessage(
        t(
          "consolidationReports.audit.persistSuccess",
          "Immutable member-support snapshot saved as #{{snapshotId}}.",
          {
            snapshotId: response?.snapshot?.id || "-",
          },
        ),
      );
    } catch (err) {
      setPersistedSnapshotResult(null);
      setError(
        err?.response?.data?.message ||
          err?.message ||
          t(
            "consolidationReports.audit.persistFailed",
            "Failed to persist the selected member-support snapshot.",
          ),
      );
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t("consolidationReports.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("consolidationReports.subtitle")}
        </p>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("consolidationReports.runLabel")}
            </div>
            {runs.length > 0 ? (
              <select
                value={form.runId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, runId: event.target.value }))
                }
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                disabled={loadingRuns}
                required
              >
                <option value="">
                  {t("consolidationReports.runPlaceholder")}
                </option>
                {runs.map((row) => (
                  <option key={row.id} value={row.id}>
                    #{row.id} | {row.consolidation_group_code} |{" "}
                    {row.fiscal_year}-P
                    {formatPeriodNo(row.period_no)} | {row.status}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={form.runId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, runId: event.target.value }))
                }
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("consolidationReports.runIdPlaceholder")}
                required
              />
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t("consolidationReports.rateTypeLabel")}
            </div>
            <select
              value={form.rateType}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, rateType: event.target.value }))
              }
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              {["CLOSING", "SPOT", "AVERAGE"].map((rateType) => (
                <option key={rateType} value={rateType}>
                  {rateType}
                </option>
              ))}
            </select>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.includeDraft}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  includeDraft: event.target.checked,
                }))
              }
            />
            {t("consolidationReports.includeDraft")}
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.includeZero}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  includeZero: event.target.checked,
                }))
              }
            />
            {t("consolidationReports.includeZero")}
          </label>

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <button
              type="button"
              onClick={onLoadBalanceSheet}
              disabled={saving === "balanceSheet" || !canReadBalanceSheet}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "balanceSheet"
                ? t("consolidationReports.loadBsLoading")
                : t("consolidationReports.loadBsButton")}
            </button>
            <button
              type="button"
              onClick={onLoadIncomeStatement}
              disabled={saving === "incomeStatement" || !canReadIncomeStatement}
              className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "incomeStatement"
                ? t("consolidationReports.loadIsLoading")
                : t("consolidationReports.loadIsButton")}
            </button>
            <button
              type="button"
              onClick={onLoadConsolidatedTrialBalance}
              disabled={
                saving === "trialBalance" || !canReadConsolidatedTrialBalance
              }
              className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving === "trialBalance"
                ? t(
                    "consolidationReports.loadTbLoading",
                    "Loading consolidated TB...",
                  )
                : t(
                    "consolidationReports.loadTbButton",
                    "Load Consolidated Trial Balance",
                  )}
            </button>
            <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
              <select
                value={summaryGroupBy}
                onChange={(event) =>
                  setSummaryGroupBy(normalizeSummaryGroupBy(event.target.value))
                }
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="account_entity">
                  {t(
                    "consolidationReports.summary.group.accountEntity",
                    "Summary by account + entity",
                  )}
                </option>
                <option value="account">
                  {t(
                    "consolidationReports.summary.group.account",
                    "Summary by account",
                  )}
                </option>
                <option value="entity">
                  {t(
                    "consolidationReports.summary.group.entity",
                    "Summary by entity",
                  )}
                </option>
              </select>
              <button
                type="button"
                onClick={() => void onLoadConsolidatedSummary(summaryGroupBy)}
                disabled={saving === "summary" || !canReadConsolidatedSummary}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              >
                {saving === "summary"
                  ? t(
                      "consolidationReports.loadSummaryLoading",
                      "Loading summary...",
                    )
                  : t(
                      "consolidationReports.loadSummaryButton",
                      "Load Consolidated Summary",
                    )}
              </button>
            </div>
            <button
              type="button"
              onClick={onLoadDraftWorklist}
              disabled={saving === "worklist" || !canReadRun}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              {saving === "worklist"
                ? t("consolidationReports.loadWorklistLoading")
                : t("consolidationReports.loadWorklistButton")}
            </button>
            <button
              type="button"
              onClick={loadRuns}
              disabled={loadingRuns || !canReadRun}
              className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              {loadingRuns
                ? t("consolidationReports.refreshRunsLoading")
                : t("consolidationReports.refreshRunsButton")}
            </button>
          </div>
        </div>

        {selectedRun && (
          <div className="space-y-2">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {t("consolidationReports.selectedRunSummary", {
                id: selectedRun.id,
                groupCode: selectedRun.consolidation_group_code || "-",
                groupName: selectedRun.consolidation_group_name || "-",
                fiscalYear: selectedRun.fiscal_year || "-",
                periodNo: formatPeriodNo(selectedRun.period_no),
                periodName: selectedRun.period_name || "-",
                status: selectedRun.status || "-",
              })}
            </div>
            <GovernedRuntimeExplainabilityPanel
              className="mt-2"
              l={l}
              model={consolidationExplainabilityModel}
              title={l("Consolidation explainability", "Konsolidasyon aciklamasi")}
            />
            <div className="rounded border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">
                    {t(
                      "consolidationReports.workflow.title",
                      "Workflow approval gate status",
                    )}
                  </span>
                  {reviewGate.data ? (
                    <div className="mt-1 text-[11px] text-cyan-800">
                      {t(
                        "consolidationReports.reviewGate.publishState",
                        "Publish state: {{state}} | Next status: {{status}}",
                        {
                          state: reviewGate.data.publishState || "-",
                          status: reviewGate.data.run?.nextStatus || "-",
                        },
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionButtonWithTooltip
                    type="button"
                    onClick={() => void onFinalizeRun()}
                    disabled={Boolean(finalizeActionDisabledReason)}
                    disabledReason={finalizeActionDisabledReason}
                    className="rounded border border-emerald-300 bg-white px-2 py-1 font-semibold text-emerald-900 disabled:opacity-60"
                  >
                    {saving === "finalize"
                      ? t(
                          "consolidationReports.finalize.loading",
                          "Finalizing...",
                        )
                      : t(
                          "consolidationReports.finalize.button",
                          "Finalize run",
                        )}
                  </ActionButtonWithTooltip>
                  <button
                    type="button"
                    onClick={() => setReviewGateVersion((prev) => prev + 1)}
                    disabled={reviewGate.loading}
                    className="rounded border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-900 disabled:opacity-60"
                  >
                    {reviewGate.loading
                      ? t(
                          "consolidationReports.reviewGate.refreshing",
                          "Refreshing gate...",
                        )
                      : t(
                          "consolidationReports.reviewGate.refresh",
                          "Refresh gate",
                        )}
                  </button>
                  <Link
                    to="/app/ayarlar/workflow-kurulumu"
                    className="rounded border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-900"
                  >
                    {t(
                      "consolidationReports.workflow.openSetup",
                      "Open workflow governance",
                    )}
                  </Link>
                </div>
              </div>
              {reviewGate.loading ? (
                <p className="mt-2">
                  {t(
                    "consolidationReports.workflow.loading",
                    "Loading workflow gate status...",
                  )}
                </p>
              ) : null}
              {reviewGate.error ? (
                <p className="mt-2 text-rose-700">{reviewGate.error}</p>
              ) : null}
              {!reviewGate.loading && !reviewGate.error && reviewGate.data ? (
                <div className="mt-2 space-y-2">
                  <p>
                    {reviewGate.data.workflowGate?.required
                      ? reviewGate.data.workflowGate?.approved
                        ? t(
                            "consolidationReports.workflow.approved",
                            "Workflow approval is complete for this run.",
                          )
                        : reviewGate.data.workflowGate?.message ||
                          t(
                            "consolidationReports.workflow.none",
                            "Workflow approval is still pending.",
                          )
                      : t(
                          "consolidationReports.workflow.none",
                          "No workflow gate is required for this run.",
                        )}
                  </p>
                  <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                    <div className="rounded border border-cyan-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t(
                          "consolidationReports.reviewGate.entries",
                          "Entries",
                        )}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {reviewGate.data.counts?.entryCount || 0}
                      </div>
                    </div>
                    <div className="rounded border border-cyan-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t(
                          "consolidationReports.reviewGate.adjustments",
                          "Draft adjustments",
                        )}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {reviewGate.data.counts?.draftAdjustmentCount || 0}
                      </div>
                    </div>
                    <div className="rounded border border-cyan-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t(
                          "consolidationReports.reviewGate.eliminations",
                          "Draft eliminations",
                        )}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {reviewGate.data.counts?.draftEliminationCount || 0}
                      </div>
                    </div>
                    <div className="rounded border border-cyan-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t(
                          "consolidationReports.reviewGate.localClose",
                          "Local close blockers",
                        )}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {reviewGate.data.counts?.memberReadinessBlockCount || 0}
                      </div>
                    </div>
                    <div className="rounded border border-cyan-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t(
                          "consolidationReports.reviewGate.tbDelta",
                          "TB delta",
                        )}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {reviewGate.data.mathSummary
                          ? formatMoneyText(
                              reviewGate.data.mathSummary.trialBalanceDelta,
                              presentationCurrencyCode,
                            )
                          : "-"}
                      </div>
                    </div>
                    <div className="rounded border border-cyan-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t(
                          "consolidationReports.reviewGate.bsDelta",
                          "BS equation delta",
                        )}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {reviewGate.data.mathSummary
                          ? formatMoneyText(
                              reviewGate.data.mathSummary.equationDelta,
                              presentationCurrencyCode,
                            )
                          : "-"}
                      </div>
                    </div>
                  </div>
                  {[
                    ...(reviewGate.data.blockers || []),
                    ...(reviewGate.data.warnings || []),
                  ].map((row) => (
                    <div
                      key={`${row.level}-${row.code}`}
                      className={`rounded border px-3 py-2 ${getReviewGateTone(row.level)}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-mono text-[11px]">
                            {row.code}
                          </div>
                          <div className="mt-1 text-sm font-semibold">
                            {row.message}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {row?.drill?.path ? (
                            <Link
                              to={row.drill.path}
                              className="rounded border border-current bg-white/80 px-2 py-1 text-[11px] font-semibold"
                            >
                              {row?.drill?.label ||
                                t(
                                  "consolidationReports.reviewGate.openDetail",
                                  "Open related detail",
                                )}
                            </Link>
                          ) : null}
                          {row?.drill?.surface === "worklist" ? (
                            <button
                              type="button"
                              onClick={() => void onLoadDraftWorklist()}
                              className="rounded border border-current bg-white/80 px-2 py-1 text-[11px] font-semibold"
                            >
                              {t(
                                "consolidationReports.reviewGate.openWorklist",
                                "Open worklist",
                              )}
                            </button>
                          ) : null}
                          {row?.drill?.surface === "summary" ? (
                            <button
                              type="button"
                              onClick={() =>
                                void onLoadConsolidatedSummary(summaryGroupBy)
                              }
                              className="rounded border border-current bg-white/80 px-2 py-1 text-[11px] font-semibold"
                            >
                              {t(
                                "consolidationReports.reviewGate.openSummary",
                                "Open summary",
                              )}
                            </button>
                          ) : null}
                          {row?.drill?.surface === "balanceSheet" ? (
                            <button
                              type="button"
                              onClick={() => void onLoadBalanceSheet()}
                              className="rounded border border-current bg-white/80 px-2 py-1 text-[11px] font-semibold"
                            >
                              {t(
                                "consolidationReports.reviewGate.openBalanceSheet",
                                "Open balance sheet",
                              )}
                            </button>
                          ) : null}
                          {row?.drill?.surface === "trialBalance" ? (
                            <button
                              type="button"
                              onClick={() =>
                                void onLoadConsolidatedTrialBalance()
                              }
                              className="rounded border border-current bg-white/80 px-2 py-1 text-[11px] font-semibold"
                            >
                              {t(
                                "consolidationReports.reviewGate.openTrialBalance",
                                "Open trial balance",
                              )}
                            </button>
                          ) : null}
                          {row?.drill?.surface === "workflow" ? (
                            <Link
                              to="/app/ayarlar/workflow-kurulumu"
                              className="rounded border border-current bg-white/80 px-2 py-1 text-[11px] font-semibold"
                            >
                              {t(
                                "consolidationReports.reviewGate.openWorkflow",
                                "Open workflow",
                              )}
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {!reviewGate.loading &&
              !reviewGate.error &&
              reviewGate.data &&
              (reviewGate.data.blockers || []).length === 0 &&
              (reviewGate.data.warnings || []).length === 0 ? (
                <p className="mt-2">
                  {t(
                    "consolidationReports.reviewGate.clear",
                    "No surfaced publish blockers or warnings are currently open for this run.",
                  )}
                </p>
              ) : null}
              {!canReadWorkflow ? (
                <p className="mt-2 text-amber-700">
                  {t(
                    "consolidationReports.workflow.missingPermission",
                    "Missing permission: org.tree.read (required to view workflow gate details).",
                  )}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {auditReportSpecs.length > 0 ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  {t(
                    "consolidationReports.audit.title",
                    "Audit evidence hardening",
                  )}
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "consolidationReports.audit.subtitle",
                    "RP13 keeps one stable fingerprint plus CSV export for the currently loaded consolidated and member-support surfaces. Local-base support context stays explicit and separate from translated/reporting-currency balances.",
                  )}
                </p>
              </div>
            </div>
            {auditFingerprintState.error ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {auditFingerprintState.error}
              </div>
            ) : null}
            <div className="grid gap-3 xl:grid-cols-2">
              {auditReportSpecs.map((spec) => {
                const fingerprintRow = auditFingerprintState.rows?.[spec.key];
                return (
                  <div
                    key={spec.key}
                    className="rounded border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {spec.label}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {t(
                            "consolidationReports.audit.rowsLoaded",
                            "Rows loaded: {{count}}",
                            {
                              count: spec.rowCount,
                            },
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleExportAuditCsv(spec)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {t(
                          "consolidationReports.audit.exportCsv",
                          "Export CSV",
                        )}
                      </button>
                    </div>
                    <div className="mt-3 font-mono text-[11px] text-slate-700 break-all">
                      {fingerprintRow?.fingerprintSha256 ||
                        (auditFingerprintState.loading
                          ? t(
                              "consolidationReports.audit.buildingFingerprint",
                              "Building fingerprint...",
                            )
                          : "-")}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      {t(
                        "consolidationReports.audit.fingerprintNote",
                        "Fingerprint basis includes the selected run, current parameters, and the loaded snapshot for this surface.",
                      )}
                    </div>
                    {fingerprintRow?.basisJson ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-semibold text-cyan-700">
                          {t(
                            "consolidationReports.audit.showBasis",
                            "Show fingerprint basis",
                          )}
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
                          {fingerprintRow.basisJson}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {balanceSheetReport?.totals && (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {t("consolidationReports.bsTotals", {
              assets: formatMoneyText(
                balanceSheetReport.totals.assetsTotal,
                presentationCurrencyCode,
              ),
              liabilities: formatMoneyText(
                balanceSheetReport.totals.liabilitiesTotal,
                presentationCurrencyCode,
              ),
              equity: formatMoneyText(
                balanceSheetReport.totals.equityTotal,
                presentationCurrencyCode,
              ),
              earnings: formatMoneyText(
                balanceSheetReport.totals.currentPeriodEarnings,
                presentationCurrencyCode,
              ),
              delta: formatMoneyText(
                balanceSheetReport.totals.equationDelta,
                presentationCurrencyCode,
              ),
            })}
          </div>
        )}
        {incomeStatementReport?.totals && (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {t("consolidationReports.isTotals", {
              revenue: formatMoneyText(
                incomeStatementReport.totals.revenueTotal,
                presentationCurrencyCode,
              ),
              expense: formatMoneyText(
                incomeStatementReport.totals.expenseTotal,
                presentationCurrencyCode,
              ),
              net: formatMoneyText(
                incomeStatementReport.totals.netIncome,
                presentationCurrencyCode,
              ),
            })}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.account")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.type")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.normalized")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(balanceSheetReport?.rows || []).slice(0, 10).map((row) => (
                  <tr
                    key={`bs-${row.accountId}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-2 py-2">
                      {row.accountCode} - {row.accountName}
                    </td>
                    <td className="px-2 py-2">{row.accountType}</td>
                    <td className="px-2 py-2">
                      <MoneyText
                        amount={row.normalizedFinalBalance || 0}
                        currencyCode={presentationCurrencyCode}
                      />
                    </td>
                  </tr>
                ))}
                {(balanceSheetReport?.rows || []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-slate-500">
                      {t("consolidationReports.tables.bsEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.account")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.type")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.normalized")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(incomeStatementReport?.rows || []).slice(0, 10).map((row) => (
                  <tr
                    key={`is-${row.accountId}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-2 py-2">
                      {row.accountCode} - {row.accountName}
                    </td>
                    <td className="px-2 py-2">{row.accountType}</td>
                    <td className="px-2 py-2">
                      <MoneyText
                        amount={row.normalizedFinalBalance || 0}
                        currencyCode={presentationCurrencyCode}
                      />
                    </td>
                  </tr>
                ))}
                {(incomeStatementReport?.rows || []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-3 text-slate-500">
                      {t("consolidationReports.tables.isEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {(trialBalanceReport?.rows || []).length > 0 ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  {t(
                    "consolidationReports.drill.trialBalanceTitle",
                    "Consolidated Trial Balance",
                  )}
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "consolidationReports.drill.trialBalanceSubtitle",
                    "Use the existing consolidation trial-balance endpoint as the summary-to-member drill starting point.",
                  )}
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {t("consolidationReports.drill.rowsLoaded", "Rows loaded")}:{" "}
                {trialBalanceReport.rows.length}
              </div>
            </div>
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-2 py-2">
                      {t("consolidationReports.tables.account")}
                    </th>
                    <th className="px-2 py-2">
                      {t("consolidationReports.drill.debit", "Debit")}
                    </th>
                    <th className="px-2 py-2">
                      {t("consolidationReports.drill.credit", "Credit")}
                    </th>
                    <th className="px-2 py-2">
                      {t("consolidationReports.drill.balance", "Balance")}
                    </th>
                    <th className="px-2 py-2">
                      {t("consolidationReports.drill.action", "Action")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalanceReport.rows.map((row) => (
                    <tr
                      key={`tb-${row.account_id || row.accountId}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-2 py-2">
                        {row.account_code || row.accountCode || "-"} -{" "}
                        {row.account_name || row.accountName || "-"}
                      </td>
                      <td className="px-2 py-2">
                        <MoneyText
                          amount={Number(
                            row.debit_total || row.debitTotal || 0,
                          )}
                          currencyCode={presentationCurrencyCode}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyText
                          amount={Number(
                            row.credit_total || row.creditTotal || 0,
                          )}
                          currencyCode={presentationCurrencyCode}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyText
                          amount={Number(row.balance || 0)}
                          currencyCode={presentationCurrencyCode}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => void onSelectSupportRow(row)}
                          className="rounded border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-700 hover:bg-cyan-50"
                        >
                          {t(
                            "consolidationReports.drill.openMemberBreakdown",
                            "Open member breakdown",
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {(summaryReport?.rows || []).length > 0 ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  {t(
                    "consolidationReports.drill.summaryTitle",
                    "Consolidated Summary and Member Breakdown",
                  )}
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "consolidationReports.drill.summarySubtitle",
                    "This flow keeps the repo's current run fields aligned with Track 51 canonical names: consolidationGroupId/groupId, fiscalPeriodId/consolidationPeriodId, and presentationCurrencyCode/reportingCurrencyId.",
                  )}
                </p>
              </div>
              <div className="text-xs text-slate-500">
                {t("consolidationReports.drill.groupBy", "Group by")}:{" "}
                {summaryReport.groupBy || summaryGroupBy}
              </div>
            </div>

            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-2 py-2">
                      {t("consolidationReports.tables.account")}
                    </th>
                    <th className="px-2 py-2">
                      {t("consolidationReports.drill.entity", "Member entity")}
                    </th>
                    <th className="px-2 py-2">
                      {t(
                        "consolidationReports.drill.localBaseSum",
                        "Local base sum",
                      )}
                    </th>
                    <th className="px-2 py-2">
                      {t(
                        "consolidationReports.drill.translatedBalance",
                        "Translated balance",
                      )}
                    </th>
                    <th className="px-2 py-2">
                      {t("consolidationReports.drill.action", "Action")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summaryReport.rows.slice(0, 60).map((row, index) => {
                    const rowAccountId = toInt(row.accountId ?? row.account_id);
                    const isSelected =
                      rowAccountId &&
                      rowAccountId === toInt(selectedSupportRow?.accountId);
                    return (
                      <tr
                        key={`summary-${row.account_id || row.accountId || "na"}-${row.legal_entity_id || row.legalEntityId || index}`}
                        className={`border-t border-slate-100 ${
                          isSelected ? "bg-cyan-50" : "bg-white"
                        }`}
                      >
                        <td className="px-2 py-2">
                          {row.account_code || row.accountCode || "-"}
                          {row.account_name || row.accountName
                            ? ` - ${row.account_name || row.accountName}`
                            : ""}
                        </td>
                        <td className="px-2 py-2">
                          {row.legal_entity_code || row.legalEntityCode
                            ? `${row.legal_entity_code || row.legalEntityCode} - ${
                                row.legal_entity_name ||
                                row.legalEntityName ||
                                ""
                              }`.trim()
                            : row.legal_entity_name ||
                              row.legalEntityName ||
                              "-"}
                        </td>
                        <td className="px-2 py-2">
                          <LocalBaseSupportValue
                            amount={
                              row.local_balance_total ||
                              row.localBalanceTotal ||
                              0
                            }
                            currencyContext={getSupportCurrencyContext(row)}
                            t={t}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <MoneyText
                            amount={Number(
                              row.translated_balance_total ||
                                row.translatedBalanceTotal ||
                                0,
                            )}
                            currencyCode={presentationCurrencyCode}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {rowAccountId ? (
                            <button
                              type="button"
                              onClick={() =>
                                void onSelectSupportRow({
                                  accountId: rowAccountId,
                                  accountCode:
                                    row.account_code || row.accountCode,
                                  accountName:
                                    row.account_name || row.accountName,
                                })
                              }
                              className="rounded border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-700 hover:bg-cyan-50"
                            >
                              {t(
                                "consolidationReports.drill.openChain",
                                "Open drill chain",
                              )}
                            </button>
                          ) : (
                            <span className="text-slate-500">
                              {t(
                                "consolidationReports.drill.accountRequired",
                                "Load account-based summary for drill-across.",
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedSupportRow ? (
              <div className="space-y-3 rounded border border-cyan-200 bg-white p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t(
                      "consolidationReports.drill.memberBreakdownTitle",
                      "Mapped member support for {{accountCode}} - {{accountName}}",
                      {
                        accountCode: selectedSupportAccountCode,
                        accountName: selectedSupportAccountName,
                      },
                    )}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    {t(
                      "consolidationReports.drill.memberBreakdownSubtitle",
                      "The consolidated group account stays mapping-aware here. Local report links open the member entity report family first instead of pretending there is always one direct local account.",
                    )}
                  </p>
                </div>

                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-2 py-2">
                          {t(
                            "consolidationReports.drill.entity",
                            "Member entity",
                          )}
                        </th>
                        <th className="px-2 py-2">
                          {t("consolidationReports.drill.method", "Method")}
                        </th>
                        <th className="px-2 py-2">
                          {t(
                            "consolidationReports.drill.ownership",
                            "Ownership",
                          )}
                        </th>
                        <th className="px-2 py-2">
                          {t(
                            "consolidationReports.drill.localBaseSum",
                            "Local base sum",
                          )}
                        </th>
                        <th className="px-2 py-2">
                          {t(
                            "consolidationReports.drill.translatedBalance",
                            "Translated balance",
                          )}
                        </th>
                        <th className="px-2 py-2">
                          {t("consolidationReports.drill.action", "Action")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberBreakdownRows.map((row) => {
                        const isSelectedMember =
                          toInt(row.legalEntityId) === selectedMemberEntityId;
                        return (
                          <tr
                            key={`member-${row.accountId}-${row.legalEntityId}`}
                            className={`border-t border-slate-100 ${
                              isSelectedMember ? "bg-cyan-50" : "bg-white"
                            }`}
                          >
                            <td className="px-2 py-2">
                              {row.legalEntityCode
                                ? `${row.legalEntityCode} - ${row.legalEntityName || ""}`.trim()
                                : row.legalEntityName || "-"}
                            </td>
                            <td className="px-2 py-2">
                              {row.consolidationMethod || "-"}
                            </td>
                            <td className="px-2 py-2">
                              {formatPercent(row.ownershipPct)}
                            </td>
                            <td className="px-2 py-2">
                              <LocalBaseSupportValue
                                amount={row.localBalanceTotal}
                                currencyContext={getSupportCurrencyContext(row)}
                                t={t}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <MoneyText
                                amount={row.translatedBalanceTotal}
                                currencyCode={presentationCurrencyCode}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => setSelectedMemberRow(row)}
                                className="rounded border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-700 hover:bg-cyan-50"
                              >
                                {t(
                                  "consolidationReports.drill.openLocalSupport",
                                  "Open local support",
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {memberBreakdownRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-3 text-slate-500">
                            {t(
                              "consolidationReports.drill.memberBreakdownEmpty",
                              "Load the account + entity summary to see member breakdown rows for this group account.",
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {selectedMemberRow ? (
                  <div className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="rounded border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t(
                            "consolidationReports.drill.entity",
                            "Member entity",
                          )}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedMemberRow.legalEntityCode
                            ? `${selectedMemberRow.legalEntityCode} - ${selectedMemberRow.legalEntityName || ""}`.trim()
                            : selectedMemberRow.legalEntityName || "-"}
                        </div>
                      </div>
                      <div className="rounded border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("consolidationReports.drill.book", "Local book")}
                        </div>
                        {canReadBookLookups ? (
                          <select
                            value={selectedMemberBookId}
                            onChange={(event) =>
                              setSelectedMemberBookId(event.target.value)
                            }
                            className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                            disabled={memberBooksLoading}
                          >
                            <option value="">
                              {t(
                                "consolidationReports.drill.bookPlaceholder",
                                "Select local book",
                              )}
                            </option>
                            {memberBooks.map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.code
                                  ? `${row.code} - ${row.name}`
                                  : row.name || row.id}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="mt-1 text-xs text-amber-700">
                            {t(
                              "consolidationReports.drill.bookPermission",
                              "Missing permission: gl.book.read",
                            )}
                          </div>
                        )}
                      </div>
                      <div className="rounded border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t(
                            "consolidationReports.drill.period",
                            "Local period",
                          )}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedRunFiscalPeriodId || "-"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {t(
                            "consolidationReports.drill.periodCompatibility",
                            "Current repo fiscalPeriodId, Track 51 consolidationPeriodId",
                          )}
                        </div>
                      </div>
                      <div className="rounded border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t(
                            "consolidationReports.drill.localCurrencyContext",
                            "Local currency context",
                          )}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedMemberCurrencyContext.hasMixedSourceCurrencies
                            ? t(
                                "consolidationReports.drill.mixedCurrencyShort",
                                "Mixed support",
                              )
                            : selectedMemberCurrencyContext.sourceCurrencyCode ||
                              "-"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {selectedMemberCurrencyContext.hasMixedSourceCurrencies
                            ? t(
                                "consolidationReports.drill.mixedLocalCurrencies",
                                "Mixed local currencies: {{codes}}",
                                {
                                  codes:
                                    selectedMemberCurrencyContext.sourceCurrencyCodes.join(
                                      ", ",
                                    ) || "-",
                                },
                              )
                            : selectedMemberCurrencyContext.sourceCurrencyCode
                              ? t(
                                  "consolidationReports.drill.functionalCurrency",
                                  "Functional currency: {{code}}",
                                  {
                                    code: selectedMemberCurrencyContext.sourceCurrencyCode,
                                  },
                                )
                              : t(
                                  "consolidationReports.drill.currencyContextUnavailable",
                                  "Local currency context unavailable.",
                                )}
                        </div>
                      </div>
                    </div>

                    {memberBooksError ? (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {memberBooksError}
                      </div>
                    ) : null}
                    {!memberBooksError &&
                    !memberBooksLoading &&
                    canReadBookLookups &&
                    memberBooks.length === 0 ? (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {t(
                          "consolidationReports.drill.noMemberBooks",
                          "No local books were found for this member entity, so local report links stay unavailable.",
                        )}
                      </div>
                    ) : null}
                    {!memberBooksError &&
                    !memberBooksLoading &&
                    canReadBookLookups &&
                    memberBooks.length === 1 &&
                    selectedMemberBook ? (
                      <div className="rounded border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
                        {t(
                          "consolidationReports.drill.autoSelectedBook",
                          "One local book was found and auto-selected: {{book}}.",
                          {
                            book: selectedMemberBook.code
                              ? `${selectedMemberBook.code} - ${selectedMemberBook.name || ""}`.trim()
                              : selectedMemberBook.name ||
                                selectedMemberBook.id,
                          },
                        )}
                      </div>
                    ) : null}
                    {!memberBooksError &&
                    !memberBooksLoading &&
                    canReadBookLookups &&
                    memberBooks.length > 1 &&
                    !selectedMemberBookId ? (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {t(
                          "consolidationReports.drill.selectBookRequired",
                          "Multiple local books were found for this member entity. Select one book before opening local report links.",
                        )}
                      </div>
                    ) : null}

                    <div className="rounded border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
                      {t(
                        "consolidationReports.drill.mappingNote",
                        "Mapping-aware rule: this drill-across stops at the member report family. From Mizan or the local statement, users can continue into local ledger detail without implying one direct local account on the consolidated row. Local-base support values stay distinct from translated balances where source currencies differ.",
                      )}
                    </div>

                    <div className="rounded border border-slate-200 bg-white px-3 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t(
                              "consolidationReports.audit.persistTitle",
                              "Persist immutable support snapshot",
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            {t(
                              "consolidationReports.audit.persistSubtitle",
                              "RP13 7B stores the selected member support chain server-side with one immutable snapshot hash and the exact loaded export/fingerprint basis.",
                            )}
                          </div>
                        </div>
                        {canCreateExportSnapshots ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handlePersistMemberSupportSnapshot()
                            }
                            disabled={
                              saving === "persistSnapshot" ||
                              auditFingerprintState.loading ||
                              selectedMemberAuditSpecs.length === 0
                            }
                            className="rounded border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
                          >
                            {saving === "persistSnapshot"
                              ? t(
                                  "consolidationReports.audit.persistSaving",
                                  "Saving snapshot...",
                                )
                              : t(
                                  "consolidationReports.audit.persistButton",
                                  "Persist support snapshot",
                                )}
                          </button>
                        ) : null}
                      </div>
                      {!canCreateExportSnapshots ? (
                        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          {t(
                            "consolidationReports.audit.persistPermission",
                            "Missing permission: ops.export_snapshot.create",
                          )}
                        </div>
                      ) : null}
                      {persistedSnapshotResult?.snapshot ? (
                        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                          <div className="font-semibold">
                            {t(
                              "consolidationReports.audit.persistedSummary",
                              "Snapshot #{{snapshotId}} | Hash: {{hash}}",
                              {
                                snapshotId:
                                  persistedSnapshotResult.snapshot.id || "-",
                                hash:
                                  persistedSnapshotResult.snapshot
                                    .snapshot_hash || "-",
                              },
                            )}
                          </div>
                          <div className="mt-1">
                            {t(
                              "consolidationReports.audit.persistedItems",
                              "Items stored: {{count}} | Status: {{status}} | Idempotent replay: {{idempotent}}",
                              {
                                count: Array.isArray(
                                  persistedSnapshotResult.items,
                                )
                                  ? persistedSnapshotResult.items.length
                                  : 0,
                                status:
                                  persistedSnapshotResult.snapshot.status ||
                                  "-",
                                idempotent: persistedSnapshotResult.idempotent
                                  ? "YES"
                                  : "NO",
                              },
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canReadLocalSummary && trialBalanceLocation ? (
                        <Link
                          to={trialBalanceLocation}
                          className="rounded border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50"
                        >
                          {t(
                            "consolidationReports.drill.openMizan",
                            "Open member Mizan",
                          )}
                        </Link>
                      ) : null}
                      {canReadLocalStatements && balanceSheetLocation ? (
                        <Link
                          to={balanceSheetLocation}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {t(
                            "consolidationReports.drill.openBilanco",
                            "Open member Bilanco",
                          )}
                        </Link>
                      ) : null}
                      {canReadLocalStatements && incomeStatementLocation ? (
                        <Link
                          to={incomeStatementLocation}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {t(
                            "consolidationReports.drill.openGelir",
                            "Open member Gelir Tablosu",
                          )}
                        </Link>
                      ) : null}
                    </div>

                    {!localDrillParams ? (
                      <div className="text-xs text-slate-500">
                        {t(
                          "consolidationReports.drill.selectBookHint",
                          "Select a local book to activate the member report links.",
                        )}
                        {selectedMemberBook?.code
                          ? ` ${selectedMemberBook.code}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">
            {t("consolidationReports.tables.adjustmentsTitle")}
          </h2>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.id")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.status")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.account")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.debit")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.credit")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.action")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">
                      {row.accountCode} - {row.accountName}
                    </td>
                    <td className="px-2 py-2">
                      <MoneyText
                        amount={row.debitAmount}
                        currencyCode={presentationCurrencyCode}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <MoneyText
                        amount={row.creditAmount}
                        currencyCode={presentationCurrencyCode}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {row.status === "DRAFT" ? (
                        <ActionButtonWithTooltip
                          type="button"
                          onClick={() => onPostAdjustment(row.id)}
                          disabled={
                            saving === `postAdjustment:${row.id}` ||
                            !canPostAdjustment
                          }
                          disabledReason={buildDraftPostingDisabledReason({
                            itemType: "adjustment",
                            canPost: canPostAdjustment,
                            saving,
                            rowId: row.id,
                            l,
                          })}
                          className="rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          {saving === `postAdjustment:${row.id}`
                            ? t("consolidationReports.tables.posting")
                            : t("consolidationReports.tables.post")}
                        </ActionButtonWithTooltip>
                      ) : (
                        <span className="text-slate-500">
                          {t("consolidationReports.tables.none")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {adjustments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-3 text-slate-500">
                      {t("consolidationReports.tables.adjustmentsEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">
            {t("consolidationReports.tables.eliminationsTitle")}
          </h2>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.id")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.status")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.description")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.lines")}
                  </th>
                  <th className="px-2 py-2">
                    {t("consolidationReports.tables.action")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {eliminations.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">{row.description}</td>
                    <td className="px-2 py-2">{Number(row.lineCount || 0)}</td>
                    <td className="px-2 py-2">
                      {row.status === "DRAFT" ? (
                        <ActionButtonWithTooltip
                          type="button"
                          onClick={() => onPostElimination(row.id)}
                          disabled={
                            saving === `postElimination:${row.id}` ||
                            !canPostElimination
                          }
                          disabledReason={buildDraftPostingDisabledReason({
                            itemType: "elimination",
                            canPost: canPostElimination,
                            saving,
                            rowId: row.id,
                            l,
                          })}
                          className="rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          {saving === `postElimination:${row.id}`
                            ? t("consolidationReports.tables.posting")
                            : t("consolidationReports.tables.post")}
                        </ActionButtonWithTooltip>
                      ) : (
                        <span className="text-slate-500">
                          {t("consolidationReports.tables.none")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {eliminations.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-slate-500">
                      {t("consolidationReports.tables.eliminationsEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
