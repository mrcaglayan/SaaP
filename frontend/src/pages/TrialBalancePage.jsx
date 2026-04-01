import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Combobox from "../components/Combobox.jsx";
import MoneyText from "../components/MoneyText.jsx";
import ReportAuditPanel from "../components/ReportAuditPanel.jsx";
import {
  getTrialBalance,
  listBooks,
  listPeriodCloseRuns,
} from "../api/glAdmin.js";
import {
  appendLocalReportContextParams,
  buildLocalReportLocation,
  LOCAL_REPORT_ROUTE_PATHS,
  normalizeLocalReportParams,
} from "../api/glReports.js";
import { listFiscalPeriods, listLegalEntities } from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import LocalCloseReportBanner from "../components/LocalCloseReportBanner.jsx";
import { useI18n } from "../i18n/useI18n.js";
import { getLocalReportRouteConfig } from "../reporting/localReportConfig.js";

const REQUIRED_LEGACY_PERMISSIONS = Object.freeze([
  "org.tree.read",
  "gl.book.read",
  "org.fiscal_period.read",
  "gl.trial_balance.read",
]);
const EMPTY_TRIAL_BALANCE_ROWS = Object.freeze([]);
const EMPTY_TRIAL_BALANCE_SUMMARY = Object.freeze({
  debitTotal: 0,
  creditTotal: 0,
  balanceTotal: 0,
});
const EMPTY_TRIAL_BALANCE_FILTERS = Object.freeze({
  scope: "LOCAL",
  reportBasis: "POSTED",
  periodBasis: "FISCAL_PERIOD",
});

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePositiveIntText(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "";
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function formatPeriodLabel(row) {
  if (!row) {
    return "-";
  }
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`;
}

function hasRowId(rows, id) {
  return rows.some((row) => Number(row?.id) === Number(id));
}

function createInitialFilters(searchParams) {
  const params = normalizeLocalReportParams(
    Object.fromEntries((searchParams || new URLSearchParams()).entries()),
  );
  return {
    legalEntityId: normalizePositiveIntText(params.legalEntityId),
    bookId: normalizePositiveIntText(params.bookId),
    fiscalPeriodId: normalizePositiveIntText(params.fiscalPeriodId),
    includeRollup: parseBooleanFlag(params.includeRollup, true),
  };
}

function areFiltersEqual(left, right) {
  return (
    String(left?.legalEntityId || "") === String(right?.legalEntityId || "") &&
    String(left?.bookId || "") === String(right?.bookId || "") &&
    String(left?.fiscalPeriodId || "") ===
    String(right?.fiscalPeriodId || "") &&
    Boolean(left?.includeRollup) === Boolean(right?.includeRollup)
  );
}

function buildTrialBalanceResponseSnapshot(reportResponse) {
  return {
    filters: reportResponse?.filters || {},
    summary: reportResponse?.summary || {},
    rowCount: Array.isArray(reportResponse?.rows) ? reportResponse.rows.length : 0,
    legalEntity: reportResponse?.legalEntity || null,
    book: reportResponse?.book || null,
    fiscalPeriod: reportResponse?.fiscalPeriod || null,
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Render the first real local Mizan page on top of the shared trial-balance contract.
 */
export default function TrialBalancePage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const canReadTrialBalance = hasPermission("gl.trial_balance.read");
  const canReadPeriodClose = hasPermission("gl.period.close");
  const canReviewLocalClose = hasPermission("ouclose.prepare");
  const missingLegacyPermissions = REQUIRED_LEGACY_PERMISSIONS.filter(
    (permissionCode) => !hasPermission(permissionCode),
  );
  const hasRequiredLegacyReads = missingLegacyPermissions.length === 0;
  const [filters, setFilters] = useState(() =>
    createInitialFilters(searchParams),
  );
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingCloseContext, setLoadingCloseContext] = useState(false);
  const [error, setError] = useState("");
  const [closeContextError, setCloseContextError] = useState("");
  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [reportResponse, setReportResponse] = useState(null);
  const [latestCloseRun, setLatestCloseRun] = useState(null);
  const [pendingLedgerDrillthrough, setPendingLedgerDrillthrough] =
    useState(null);
  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
  const selectedBookId = toPositiveInt(filters.bookId);
  const selectedPeriodId = toPositiveInt(filters.fiscalPeriodId);
  const selectedBook = useMemo(
    () =>
      books.find((row) => Number(row?.id) === Number(selectedBookId)) || null,
    [books, selectedBookId],
  );
  const selectedPeriod = useMemo(
    () =>
      periods.find((row) => Number(row?.id) === Number(selectedPeriodId)) ||
      null,
    [periods, selectedPeriodId],
  );
  const selectedEntity = useMemo(
    () =>
      legalEntities.find(
        (row) => Number(row?.id) === Number(selectedLegalEntityId),
      ) || null,
    [legalEntities, selectedLegalEntityId],
  );
  const bookBaseCurrencyCode = String(
    selectedBook?.base_currency_code || "",
  ).toUpperCase();
  const trialBalanceRows = Array.isArray(reportResponse?.rows)
    ? reportResponse.rows
    : EMPTY_TRIAL_BALANCE_ROWS;
  const trialBalanceSummary =
    reportResponse?.summary || EMPTY_TRIAL_BALANCE_SUMMARY;
  const reportFilters = reportResponse?.filters || EMPTY_TRIAL_BALANCE_FILTERS;
  const auditSpecs = useMemo(() => {
    if (!reportResponse || trialBalanceRows.length === 0) {
      return [];
    }

    const exportRows = trialBalanceRows.map((row) => ({
      legalEntityCode: selectedEntity?.code || "",
      legalEntityName: selectedEntity?.name || "",
      bookCode: selectedBook?.code || "",
      bookName: selectedBook?.name || "",
      fiscalPeriodLabel: formatPeriodLabel(selectedPeriod),
      includeRollup: filters.includeRollup ? "YES" : "NO",
      currencyCode: bookBaseCurrencyCode,
      accountCode: row.account_code || "",
      accountName: row.account_name || "",
      isRollup: row.is_rollup ? "YES" : "NO",
      debitTotal: Number(row.debit_total || 0),
      creditTotal: Number(row.credit_total || 0),
      balance: Number(row.balance || 0),
    }));

    return [
      {
        key: "trialBalanceSummary",
        label: l("Trial balance rows", "Mizan satirlari"),
        rowCount: exportRows.length,
        routePath: LOCAL_REPORT_ROUTE_PATHS.trialBalance,
        fileName: `track51-trial-balance-${selectedBook?.code || selectedBookId || "book"}-${selectedPeriodId || "period"}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "legalEntityCode", header: "Legal Entity Code" },
          { key: "legalEntityName", header: "Legal Entity Name" },
          { key: "bookCode", header: "Book Code" },
          { key: "bookName", header: "Book Name" },
          { key: "fiscalPeriodLabel", header: "Fiscal Period" },
          { key: "includeRollup", header: "Include Rollup" },
          { key: "currencyCode", header: "Currency" },
          { key: "accountCode", header: "Account Code" },
          { key: "accountName", header: "Account Name" },
          { key: "isRollup", header: "Is Rollup" },
          { key: "debitTotal", header: "Debit Total" },
          { key: "creditTotal", header: "Credit Total" },
          { key: "balance", header: "Balance" },
        ],
        exportRows,
        fingerprintParameters: {
          legalEntityId: selectedLegalEntityId,
          bookId: selectedBookId,
          fiscalPeriodId: selectedPeriodId,
          includeRollup: filters.includeRollup,
        },
        fingerprintContext: {
          route: LOCAL_REPORT_ROUTE_PATHS.trialBalance,
          scope: reportFilters.scope || "LOCAL",
          reportBasis: reportFilters.reportBasis || "POSTED",
          periodBasis: reportFilters.periodBasis || "FISCAL_PERIOD",
          currencyCode: bookBaseCurrencyCode || null,
        },
        fingerprintSnapshot: {
          report: buildTrialBalanceResponseSnapshot(reportResponse),
          rows: exportRows,
          summary: trialBalanceSummary,
        },
      },
    ];
  }, [
    bookBaseCurrencyCode,
    filters.includeRollup,
    l,
    reportFilters.periodBasis,
    reportFilters.reportBasis,
    reportFilters.scope,
    reportResponse,
    selectedBook,
    selectedBookId,
    selectedEntity,
    selectedLegalEntityId,
    selectedPeriod,
    selectedPeriodId,
    trialBalanceRows,
    trialBalanceSummary,
  ]);
  const ledgerRouteImplemented = Boolean(
    getLocalReportRouteConfig(LOCAL_REPORT_ROUTE_PATHS.generalLedger)
      ?.implemented,
  );

  useEffect(() => {
    if (!hasRequiredLegacyReads) {
      return undefined;
    }
    const nextFilters = createInitialFilters(searchParams);
    setFilters((prev) =>
      areFiltersEqual(prev, nextFilters) ? prev : nextFilters,
    );
  }, [hasRequiredLegacyReads, searchParams]);

  useEffect(() => {
    if (!hasRequiredLegacyReads) {
      return undefined;
    }
    const nextParams = appendLocalReportContextParams(
      searchParams,
      new URLSearchParams(),
    );
    const normalized = normalizeLocalReportParams({
      legalEntityId: selectedLegalEntityId || undefined,
      bookId: selectedBookId || undefined,
      fiscalPeriodId: selectedPeriodId || undefined,
      includeRollup: filters.includeRollup,
    });
    for (const [key, value] of Object.entries(normalized)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      nextParams.set(key, String(value));
    }
    const nextQuery = nextParams.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    filters.includeRollup,
    searchParams,
    selectedBookId,
    selectedLegalEntityId,
    selectedPeriodId,
    setSearchParams,
    hasRequiredLegacyReads,
  ]);

  useEffect(() => {
    if (!hasRequiredLegacyReads) {
      return undefined;
    }
    let cancelled = false;
    async function loadReferences() {
      if (!canReadOrgTree && !canReadBooks) {
        setLegalEntities([]);
        setBooks([]);
        return;
      }
      setLoadingRefs(true);
      try {
        const [entityResponse, bookResponse] = await Promise.all([
          canReadOrgTree
            ? listLegalEntities({ limit: 500, includeInactive: true })
            : Promise.resolve({ rows: [] }),
          canReadBooks
            ? listBooks(
              selectedLegalEntityId
                ? { legalEntityId: selectedLegalEntityId }
                : {},
            )
            : Promise.resolve({ rows: [] }),
        ]);
        if (cancelled) {
          return;
        }
        const nextEntities = Array.isArray(entityResponse?.rows)
          ? entityResponse.rows
          : [];
        const nextBooks = Array.isArray(bookResponse?.rows)
          ? bookResponse.rows
          : [];
        setLegalEntities(nextEntities);
        setBooks(nextBooks);
        setFilters((prev) => {
          const next = { ...prev };
          if (!hasRowId(nextEntities, prev.legalEntityId)) {
            next.legalEntityId = String(nextEntities[0]?.id || "");
          }
          if (!hasRowId(nextBooks, prev.bookId)) {
            next.bookId = String(nextBooks[0]?.id || "");
          }
          return areFiltersEqual(prev, next) ? prev : next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
            l(
              "Failed to load report references.",
              "Rapor referanslari yuklenemedi.",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingRefs(false);
        }
      }
    }
    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, [
    canReadBooks,
    canReadOrgTree,
    hasRequiredLegacyReads,
    l,
    selectedLegalEntityId,
  ]);

  useEffect(() => {
    if (!hasRequiredLegacyReads) {
      return undefined;
    }
    let cancelled = false;
    async function loadPeriods() {
      if (!canReadPeriods || !selectedBookId) {
        setPeriods([]);
        return;
      }
      const calendarId = toPositiveInt(selectedBook?.calendar_id);
      if (!calendarId) {
        setPeriods([]);
        return;
      }
      setLoadingPeriods(true);
      try {
        const response = await listFiscalPeriods(calendarId);
        if (cancelled) {
          return;
        }
        const nextPeriods = Array.isArray(response?.rows) ? response.rows : [];
        setPeriods(nextPeriods);
        setFilters((prev) => {
          if (hasRowId(nextPeriods, prev.fiscalPeriodId)) {
            return prev;
          }
          return {
            ...prev,
            fiscalPeriodId: String(nextPeriods[0]?.id || ""),
          };
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
            l("Failed to load fiscal periods.", "Mali donemler yuklenemedi."),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPeriods(false);
        }
      }
    }
    void loadPeriods();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, hasRequiredLegacyReads, l, selectedBook, selectedBookId]);
  const loadTrialBalance = useCallback(async () => {
    if (!canReadTrialBalance || !selectedBookId || !selectedPeriodId) {
      setReportResponse(null);
      return;
    }
    setLoadingReport(true);
    setError("");
    try {
      const response = await getTrialBalance({
        legalEntityId: selectedLegalEntityId || undefined,
        bookId: selectedBookId,
        fiscalPeriodId: selectedPeriodId,
        includeRollup: filters.includeRollup,
      });
      setReportResponse(response || null);
    } catch (err) {
      setReportResponse(null);
      setError(
        err?.response?.data?.message ||
        l("Failed to load trial balance.", "Mizan yuklenemedi."),
      );
    } finally {
      setLoadingReport(false);
    }
  }, [
    canReadTrialBalance,
    filters.includeRollup,
    l,
    selectedBookId,
    selectedLegalEntityId,
    selectedPeriodId,
  ]);
  const loadCloseContext = useCallback(async () => {
    if (!canReadPeriodClose || !selectedBookId || !selectedPeriodId) {
      setLatestCloseRun(null);
      setCloseContextError("");
      return;
    }
    setLoadingCloseContext(true);
    setCloseContextError("");
    try {
      const response = await listPeriodCloseRuns({
        bookId: selectedBookId,
        fiscalPeriodId: selectedPeriodId,
      });
      const rows = Array.isArray(response?.rows) ? response.rows : [];
      setLatestCloseRun(rows[0] || null);
    } catch (err) {
      setLatestCloseRun(null);
      setCloseContextError(
        err?.response?.data?.message ||
        l("Failed to load close context.", "Kapanis baglami yuklenemedi."),
      );
    } finally {
      setLoadingCloseContext(false);
    }
  }, [canReadPeriodClose, l, selectedBookId, selectedPeriodId]);
  useEffect(() => {
    setPendingLedgerDrillthrough(null);
  }, [
    selectedBookId,
    selectedPeriodId,
    selectedLegalEntityId,
    filters.includeRollup,
  ]);
  useEffect(() => {
    if (!hasRequiredLegacyReads) {
      return;
    }
    void loadTrialBalance();
  }, [hasRequiredLegacyReads, loadTrialBalance]);

  useEffect(() => {
    if (!hasRequiredLegacyReads) {
      return;
    }
    void loadCloseContext();
  }, [hasRequiredLegacyReads, loadCloseContext]);
  const legalEntityOptions = useMemo(
    () =>
      legalEntities.map((row) => ({
        value: String(row.id),
        label: row.code
          ? `${row.code} - ${row.name}`
          : row.name || String(row.id),
        description: l("Legal entity", "Yasal varlik"),
      })),
    [l, legalEntities],
  );
  const bookOptions = useMemo(
    () =>
      books.map((row) => ({
        value: String(row.id),
        label: row.code
          ? `${row.code} - ${row.name}`
          : row.name || String(row.id),
        description: String(row.base_currency_code || "").toUpperCase(),
      })),
    [books],
  );
  const periodOptions = useMemo(
    () =>
      periods.map((row) => ({
        value: String(row.id),
        label: formatPeriodLabel(row),
        description: `${String(row.start_date || "").slice(0, 10)} -> ${String(
          row.end_date || "",
        ).slice(0, 10)}`,
      })),
    [periods],
  );
  function setFilterValue(key, value) {
    setFilters((prev) => {
      if (key === "legalEntityId") {
        return {
          ...prev,
          legalEntityId: value,
          bookId: "",
          fiscalPeriodId: "",
        };
      }
      if (key === "bookId") {
        return {
          ...prev,
          bookId: value,
          fiscalPeriodId: "",
        };
      }
      return {
        ...prev,
        [key]: value,
      };
    });
  }
  function handlePrepareLedgerDrillthrough(row) {
    const nextLocation = buildLocalReportLocation("generalLedger", {
      legalEntityId: selectedLegalEntityId || undefined,
      bookId: selectedBookId || undefined,
      fiscalPeriodId: selectedPeriodId || undefined,
      accountId: toPositiveInt(row?.account_id) || undefined,
      closePackId: searchParams.get("closePackId") || undefined,
      closeLaunchMode: searchParams.get("closeLaunchMode") || undefined,
    });
    // Keep the row payload stable so Mizan drillthrough and direct menu entry
    // continue to share the same ledger contract as RP03 evolves into RP04.
    const nextDrillthrough = {
      accountLabel: `${row?.account_code || "-"} - ${row?.account_name || "-"}`,
      location: nextLocation,
    };
    setPendingLedgerDrillthrough(nextDrillthrough);
    if (ledgerRouteImplemented && nextLocation) {
      navigate(nextLocation);
    }
  }
  if (!hasRequiredLegacyReads) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            {l("Mizan Raporu", "Mizan Raporu")}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {l(
              "This RP02 page is live, but the current repo still needs a small legacy permission set for book, period, and trial-balance reads.",
              "Bu RP02 sayfasi artik canli, ancak mevcut repo halen defter, donem ve mizan okumalari icin kucuk bir legacy yetki setine ihtiyac duyuyor.",
            )}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">
            {l(
              "Additional permissions currently required",
              "Su anda gereken ek yetkiler",
            )}
          </div>
          <div className="mt-2 font-mono text-xs text-amber-800">
            {missingLegacyPermissions.join(", ")}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {l("Mizan Raporu", "Mizan Raporu")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              {l(
                "Read posted local balances by legal entity, book, and fiscal period. RP02 keeps the page period-first and reserves OU/CENTRAL expansion for later steps.",
                "Yasal varlik, defter ve mali donem bazinda post edilmis yerel bakiyeleri okuyun. RP02 sayfayi donem-oncelikli tutar ve OU/CENTRAL genislemesini sonraki adimlara birakir.",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void Promise.all([loadTrialBalance(), loadCloseContext()]);
            }}
            disabled={
              loadingReport ||
              loadingCloseContext ||
              !selectedBookId ||
              !selectedPeriodId
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {loadingReport || loadingCloseContext
              ? l("Refreshing...", "Yenileniyor...")
              : l("Refresh", "Yenile")}
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <Combobox
            value={filters.legalEntityId || null}
            options={legalEntityOptions}
            onChange={(nextValue) =>
              setFilterValue(
                "legalEntityId",
                nextValue ? String(nextValue) : "",
              )
            }
            placeholder={l("Select legal entity", "Yasal varlik secin")}
            noOptionsText={l(
              "No legal entities found.",
              "Yasal varlik bulunamadi.",
            )}
            loading={loadingRefs}
            clearable={false}
          />
          <Combobox
            value={filters.bookId || null}
            options={bookOptions}
            onChange={(nextValue) =>
              setFilterValue("bookId", nextValue ? String(nextValue) : "")
            }
            placeholder={l("Select book", "Defter secin")}
            noOptionsText={l("No books found.", "Defter bulunamadi.")}
            loading={loadingRefs}
            clearable={false}
          />
          <Combobox
            value={filters.fiscalPeriodId || null}
            options={periodOptions}
            onChange={(nextValue) =>
              setFilterValue(
                "fiscalPeriodId",
                nextValue ? String(nextValue) : "",
              )
            }
            placeholder={l("Select fiscal period", "Mali donem secin")}
            noOptionsText={l("No periods found.", "Donem bulunamadi.")}
            loading={loadingPeriods}
            clearable={false}
          />
          <label className="flex min-h-10.5 items-center gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={filters.includeRollup}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  includeRollup: event.target.checked,
                }))
              }
            />
            <span>
              {l("Include roll-up rows", "Toplam satirlari dahil et")}
            </span>
          </label>
        </div>
        <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
          {l(
            "V1 basis: posted local balances by fiscal period. OU/CENTRAL scope, date-range basis, and include-zero behavior remain deferred until later steps.",
            "V1 baz: mali donem bazinda post edilmis yerel bakiyeler. OU/CENTRAL kapsami, tarih araligi bazli davranis ve sifir bakiyeleri dahil etme sonraki adimlara ertelidir.",
          )}
        </div>
      </section>
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Report Context", "Rapor Baglami")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Page header carries the current period basis and the latest close-run context when available.",
                "Sayfa basligi mevcut donem bazini ve musaitse son kapanis calismasi baglamini tasir.",
              )}
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {loadingReport
              ? l("Loading trial balance...", "Mizan yukleniyor...")
              : l("Rows loaded", "Yuklenen satir")}{" "}
            <span className="font-semibold text-slate-700">
              {trialBalanceRows.length}
            </span>
          </div>
        </div>
        <LocalCloseReportBanner
          searchParams={searchParams}
          reportKey="trialBalance"
          routePath={LOCAL_REPORT_ROUTE_PATHS.trialBalance}
          reportResponse={reportResponse}
          buildResponseSnapshot={buildTrialBalanceResponseSnapshot}
          canReview={canReviewLocalClose}
          l={l}
        />
        <div className="mt-4">
          <ReportAuditPanel
            specs={auditSpecs}
            title={l(
              "Audit export and fingerprint",
              "Audit disa aktarim ve fingerprint",
            )}
            subtitle={l(
              "RP13 now gives Mizan one stable frontend fingerprint plus CSV export for the currently loaded posted-trial-balance surface.",
              "RP13 artik Mizan icin mevcut yuklu post edilmis mizan yuzeyinde bir kararlı frontend fingerprint'i ve CSV disa aktarimi sunar.",
            )}
            l={l}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Entity / Book", "Varlik / Defter")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {selectedEntity?.code
                ? `${selectedEntity.code} / ${selectedBook?.code || "-"}`
                : selectedBook?.code || "-"}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {selectedEntity?.name || "-"} | {selectedBook?.name || "-"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Period Basis", "Donem Bazi")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {formatPeriodLabel(selectedPeriod)}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {reportFilters.periodBasis} | {reportFilters.reportBasis}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Balance Basis", "Bakiye Bazi")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {bookBaseCurrencyCode || "-"}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {reportFilters.scope} |{" "}
              {filters.includeRollup
                ? l("Roll-up on", "Toplam acik")
                : l("Leaf only", "Yalniz yaprak")}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Close Context", "Kapanis Baglami")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {loadingCloseContext
                ? l("Loading...", "Yukleniyor...")
                : latestCloseRun
                  ? `${latestCloseRun.closeStatus || latestCloseRun.status || "-"}`
                  : canReadPeriodClose
                    ? l("No close run", "Kapanis calismasi yok")
                    : l("Permission gated", "Yetki kisitli")}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {latestCloseRun
                ? `#${latestCloseRun.id} | ${latestCloseRun.status || "-"}`
                : canReadPeriodClose
                  ? l(
                    "Latest period-close run not found for this scope.",
                    "Bu kapsam icin son donem kapanisi bulunamadi.",
                  )
                  : "gl.period.close"}
            </div>
          </div>
        </div>
        {closeContextError ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {closeContextError}
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Debit Total", "Borc Toplami")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={trialBalanceSummary.debitTotal}
                currencyCode={bookBaseCurrencyCode}
              />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Credit Total", "Alacak Toplami")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={trialBalanceSummary.creditTotal}
                currencyCode={bookBaseCurrencyCode}
              />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Net Balance", "Net Bakiye")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={trialBalanceSummary.balanceTotal}
                currencyCode={bookBaseCurrencyCode}
              />
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Posted Trial Balance", "Post Edilmis Mizan")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {ledgerRouteImplemented
                ? l(
                  "Account rows now open the live Defter-i Kebir page on the shared RP03 path and query contract.",
                  "Hesap satirlari artik ortak RP03 path ve query sozlesmesi uzerinden canli Defter-i Kebir sayfasini acar.",
                )
                : l(
                  "Account rows already prepare the future Defter-i Kebir drillthrough contract even though RP03 has not activated the ledger page yet.",
                  "Hesap satirlari, RP03 henuz ledger sayfasini acmamis olsa da gelecekteki Defter-i Kebir drillthrough sozlesmesini simdiden hazirlar.",
                )}
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-3">{l("Account", "Hesap")}</th>
                <th className="px-3 py-3">{l("Debit", "Borc")}</th>
                <th className="px-3 py-3">{l("Credit", "Alacak")}</th>
                <th className="px-3 py-3">{l("Balance", "Bakiye")}</th>
                <th className="px-3 py-3">
                  {l("Drillthrough", "Drillthrough")}
                </th>
              </tr>
            </thead>
            <tbody>
              {trialBalanceRows.map((row) => {
                const isPrepared =
                  pendingLedgerDrillthrough?.location &&
                  pendingLedgerDrillthrough.location.includes(
                    `accountId=${encodeURIComponent(String(row.account_id || ""))}`,
                  );
                return (
                  <tr
                    key={row.account_id}
                    className={`border-t border-slate-100 ${row.is_rollup ? "bg-slate-50/70" : "bg-white"
                      }`}
                  >
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => handlePrepareLedgerDrillthrough(row)}
                        className="text-left font-semibold text-cyan-700 hover:underline"
                      >
                        {row.account_code} - {row.account_name}
                      </button>
                      {row.is_rollup ? (
                        <div className="mt-1 text-xs text-slate-500">
                          {l("Roll-up summary row", "Toplam satiri")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText
                        amount={row.debit_total}
                        currencyCode={bookBaseCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText
                        amount={row.credit_total}
                        currencyCode={bookBaseCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText
                        amount={row.balance}
                        currencyCode={bookBaseCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => handlePrepareLedgerDrillthrough(row)}
                        className="rounded border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
                      >
                        {isPrepared
                          ? l("Prepared", "Hazir")
                          : ledgerRouteImplemented
                            ? l("Open Ledger", "Defteri Ac")
                            : l("Prepare Link", "Link Hazirla")}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {trialBalanceRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-sm text-slate-500"
                  >
                    {loadingReport
                      ? l(
                        "Loading posted trial balance rows...",
                        "Post edilmis mizan satirlari yukleniyor...",
                      )
                      : l(
                        "No trial balance rows found for the selected scope.",
                        "Secilen kapsam icin mizan satiri bulunamadi.",
                      )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pendingLedgerDrillthrough ? (
          <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            <div className="font-semibold">
              {ledgerRouteImplemented
                ? l(
                  "Defter-i Kebir drillthrough payload",
                  "Defter-i Kebir drillthrough payload'i",
                )
                : l(
                  "Defter-i Kebir drillthrough payload prepared",
                  "Defter-i Kebir drillthrough payload hazirlandi",
                )}
            </div>
            <div className="mt-1 text-xs text-cyan-800">
              {pendingLedgerDrillthrough.accountLabel}
            </div>
            <div className="mt-2 break-all rounded border border-cyan-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">
              {pendingLedgerDrillthrough.location}
            </div>
            {ledgerRouteImplemented ? (
              <div className="mt-2 text-xs text-cyan-800">
                {l(
                  "This is now the live RP03 navigation target used by Mizan row drillthrough.",
                  "Bu artik Mizan satir drillthrough'u tarafindan kullanilan canli RP03 navigasyon hedefidir.",
                )}
              </div>
            ) : (
              <div className="mt-2 text-xs text-cyan-800">
                {l(
                  "RP03 will activate the real ledger page on this exact path and query contract.",
                  "RP03 gercek ledger sayfasini tam bu path ve query sozlesmesi uzerinden aktive edecek.",
                )}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
