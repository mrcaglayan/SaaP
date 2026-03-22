import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listLegalEntities } from "../../api/orgAdmin.js";
import { listCariCounterparties } from "../../api/cariCounterparty.js";
import {
  getCariApAgingReport,
  getCariArAgingReport,
  getCariCounterpartyStatementReport,
  getCariOpenItemsReport,
  getCariSettlementRealizedFxReport,
} from "../../api/cariReports.js";
import { useAuth } from "../../auth/useAuth.js";
import MoneyText from "../../components/MoneyText.jsx";
import {
  formatMoneyAmount,
  formatMoneyText,
  resolveLegalEntityFunctionalCurrencyCode,
} from "../../utils/money.js";
import {
  buildCariReportQuery,
  reconcileOpenItemsSummary,
  reconcileSettlementRealizedFxSummary,
  reconcileStatementSummary,
  REPORT_TABS,
  ROLE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from "./cariReportsUtils.js";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
  const normalized = String(value || "").slice(0, 10);
  if (!normalized) {
    return "-";
  }
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  return date.toLocaleDateString();
}

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "AP" || normalized === "AR") {
    return normalized;
  }
  return "";
}

function resolveReportCurrencyCode(row) {
  return normalizeCurrencyCode(
    row?.currencyCode ||
      row?.currencyCodeSnapshot ||
      row?.currency_code ||
      row?.currency_code_snapshot
  );
}

function normalizeError(err, fallback) {
  return String(err?.response?.data?.message || err?.message || fallback);
}

function collectDistinctCurrencyCodes(rows, resolveRowCurrencyCode) {
  const codes = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const currencyCode = normalizeCurrencyCode(resolveRowCurrencyCode?.(row));
    if (currencyCode) {
      codes.add(currencyCode);
    }
  }
  return Array.from(codes);
}

function buildAggregateMoneyMeta(
  value,
  { explicitCurrencyCode = "", rows = [], resolveRowCurrencyCode } = {}
) {
  const currencyCode = normalizeCurrencyCode(explicitCurrencyCode);
  if (currencyCode) {
    return { currencyCode, mixed: false };
  }
  const codes = collectDistinctCurrencyCodes(rows, resolveRowCurrencyCode);
  if (codes.length === 1) {
    return { currencyCode: codes[0], mixed: false };
  }
  return {
    currencyCode: "",
    mixed: codes.length > 1 || toNumber(value) !== 0,
  };
}

function formatAggregateMoneyValue(value, moneyMeta) {
  if (moneyMeta?.currencyCode) {
    return formatMoneyText(value, moneyMeta.currencyCode);
  }
  if (moneyMeta?.mixed) {
    return "Mixed";
  }
  return formatMoneyAmount(value);
}

const TAB_CONFIG = [
  { id: REPORT_TABS.AR_AGING, label: "AR Aging" },
  { id: REPORT_TABS.AP_AGING, label: "AP Aging" },
  { id: REPORT_TABS.OPEN_ITEMS, label: "Open Items" },
  { id: REPORT_TABS.STATEMENT, label: "Counterparty Statement" },
  {
    id: REPORT_TABS.SETTLEMENT_REALIZED_FX,
    label: "Settlement Realized FX",
  },
];

const DEFAULT_FILTERS = {
  asOfDate: todayIsoDate(),
  periodFrom: "",
  periodTo: "",
  legalEntityId: "",
  counterpartyId: "",
  currencyCode: "",
  role: "",
  status: "OPEN",
  limit: 200,
  offset: 0,
};

function resolveRoleFromDirection(direction) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return "VENDOR";
  }
  if (normalizedDirection === "AR") {
    return "CUSTOMER";
  }
  return "";
}

function resolveDefaultTabForDirection(direction) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === "AP") {
    return REPORT_TABS.AP_AGING;
  }
  if (normalizedDirection === "AR") {
    return REPORT_TABS.AR_AGING;
  }
  return REPORT_TABS.AR_AGING;
}

function buildDefaultFilters(direction = "") {
  const fixedRole = resolveRoleFromDirection(direction);
  return fixedRole ? { ...DEFAULT_FILTERS, role: fixedRole } : { ...DEFAULT_FILTERS };
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

function renderSummaryCards(summary, { txnMoneyMeta, baseMoneyMeta }) {
  if (!summary) {
    return null;
  }

  const cards = [
    ["Count", summary.count],
    ["Open", summary.openCount ?? summary.postedCount],
    ["Partial", summary.partiallySettledCount ?? summary.partiallyAppliedCount],
    ["Settled", summary.settledCount ?? summary.fullyAppliedCount],
    [
      "Residual Txn",
      formatAggregateMoneyValue(summary.residualAmountTxnTotal, txnMoneyMeta),
    ],
    [
      "Residual Base",
      formatAggregateMoneyValue(summary.residualAmountBaseTotal, baseMoneyMeta),
    ],
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map(([label, value]) => (
        <article key={`summary-${label}`} className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{value ?? "-"}</p>
        </article>
      ))}
    </section>
  );
}

function renderSettlementRealizedFxSummaryCards(summary, reconcile, { baseMoneyMeta }) {
  if (!summary || !reconcile) {
    return null;
  }

  const cards = [
    ["Settlements", Number(summary.settlementCount || 0)],
    ["Distinct Counterparties", Number(summary.distinctCounterpartyCount || 0)],
    ["Distinct Currencies", Number(summary.distinctCurrencyCount || 0)],
    [
      "Realized FX Net (Base)",
      formatAggregateMoneyValue(summary.realizedFxNetBase, baseMoneyMeta),
    ],
    [
      "Realized FX Gain (Rows)",
      formatAggregateMoneyValue(reconcile.rowsRealizedFxGainBase, baseMoneyMeta),
    ],
    [
      "Realized FX Loss (Rows)",
      formatAggregateMoneyValue(reconcile.rowsRealizedFxLossBase, baseMoneyMeta),
    ],
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map(([label, value]) => (
        <article
          key={`settlement-realized-fx-summary-${label}`}
          className="rounded-xl border border-slate-200 bg-white p-3"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{value ?? "-"}</p>
        </article>
      ))}
    </section>
  );
}

export default function CariReportsPage({ direction = "" }) {
  const [searchParams] = useSearchParams();
  const fixedRouteDirection = useMemo(
    () => resolveRouteFixedDirection(direction, searchParams),
    [direction, searchParams]
  );
  const fixedRole = useMemo(
    () => resolveRoleFromDirection(fixedRouteDirection),
    [fixedRouteDirection]
  );
  const hasFixedRouteDirection = Boolean(fixedRouteDirection);
  const { hasPermission } = useAuth();
  const canReadReports = hasPermission("cari.report.read");
  const canReadCards = hasPermission("cari.card.read");
  const canReadOrg = hasPermission("org.tree.read");

  const [activeTab, setActiveTab] = useState(() =>
    resolveDefaultTabForDirection(fixedRouteDirection)
  );
  const [filters, setFilters] = useState(() => buildDefaultFilters(fixedRouteDirection));
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [legalEntities, setLegalEntities] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [lookupWarning, setLookupWarning] = useState("");

  const openItemsReconcile = useMemo(
    () => reconcileOpenItemsSummary(reportData),
    [reportData]
  );
  const statementReconcile = useMemo(
    () => reconcileStatementSummary(reportData),
    [reportData]
  );
  const settlementRealizedFxReconcile = useMemo(
    () => reconcileSettlementRealizedFxSummary(reportData),
    [reportData]
  );
  const reportRows = useMemo(
    () => (Array.isArray(reportData?.rows) ? reportData.rows : []),
    [reportData]
  );
  const baseCurrencyCodeFromFilter = useMemo(
    () =>
      resolveLegalEntityFunctionalCurrencyCode(
        legalEntities,
        filters.legalEntityId
      ),
    [filters.legalEntityId, legalEntities]
  );
  const reportTxnMoneyMeta = useMemo(
    () =>
      buildAggregateMoneyMeta(reportData?.summary?.residualAmountTxnTotal, {
        explicitCurrencyCode: filters.currencyCode,
        rows: reportRows,
        resolveRowCurrencyCode: resolveReportCurrencyCode,
      }),
    [filters.currencyCode, reportData, reportRows]
  );
  const reportBaseMoneyMeta = useMemo(
    () =>
      buildAggregateMoneyMeta(reportData?.summary?.residualAmountBaseTotal, {
        explicitCurrencyCode: baseCurrencyCodeFromFilter,
        rows: reportRows,
        resolveRowCurrencyCode: (row) =>
          resolveLegalEntityFunctionalCurrencyCode(
            legalEntities,
            row?.legalEntityId || row?.legal_entity_id
          ),
      }),
    [baseCurrencyCodeFromFilter, legalEntities, reportData, reportRows]
  );
  const settlementFxBaseMoneyMeta = useMemo(
    () =>
      buildAggregateMoneyMeta(reportData?.summary?.realizedFxNetBase, {
        explicitCurrencyCode: baseCurrencyCodeFromFilter,
        rows: reportRows,
        resolveRowCurrencyCode: (row) =>
          resolveLegalEntityFunctionalCurrencyCode(
            legalEntities,
            row?.legalEntityId || row?.legal_entity_id
          ),
      }),
    [baseCurrencyCodeFromFilter, legalEntities, reportData, reportRows]
  );

  async function loadLookups() {
    const warnings = [];
    if (canReadOrg) {
      try {
        const leResponse = await listLegalEntities({ limit: 500, includeInactive: true });
        setLegalEntities(Array.isArray(leResponse?.rows) ? leResponse.rows : []);
      } catch (err) {
        setLegalEntities([]);
        warnings.push(normalizeError(err, "Legal entity lookup failed"));
      }
    } else {
      setLegalEntities([]);
    }

    if (canReadCards) {
      try {
        const cpResponse = await listCariCounterparties({ limit: 500, offset: 0 });
        setCounterparties(Array.isArray(cpResponse?.rows) ? cpResponse.rows : []);
      } catch (err) {
        setCounterparties([]);
        warnings.push(normalizeError(err, "Counterparty lookup failed"));
      }
    } else {
      setCounterparties([]);
    }

    setLookupWarning(warnings.join(" "));
  }

  async function loadReport(nextTab = activeTab, nextFilters = filters) {
    if (!canReadReports) {
      setReportData(null);
      return;
    }

    const resolvedFilters = fixedRole
      ? {
          ...(nextFilters && typeof nextFilters === "object" ? nextFilters : {}),
          role: fixedRole,
        }
      : nextFilters;

    setLoading(true);
    setError("");
    try {
      const queryParams = buildCariReportQuery(resolvedFilters, nextTab);
      let payload = null;
      if (nextTab === REPORT_TABS.AR_AGING) {
        payload = await getCariArAgingReport(queryParams);
      } else if (nextTab === REPORT_TABS.AP_AGING) {
        payload = await getCariApAgingReport(queryParams);
      } else if (nextTab === REPORT_TABS.OPEN_ITEMS) {
        payload = await getCariOpenItemsReport(queryParams);
      } else if (nextTab === REPORT_TABS.SETTLEMENT_REALIZED_FX) {
        payload = await getCariSettlementRealizedFxReport(queryParams);
      } else {
        payload = await getCariCounterpartyStatementReport(queryParams);
      }
      setReportData(payload || null);
    } catch (err) {
      setReportData(null);
      setError(normalizeError(err, "Failed to load report."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadCards, canReadOrg]);

  useEffect(() => {
    if (!hasFixedRouteDirection) {
      return;
    }
    const defaultTab = resolveDefaultTabForDirection(fixedRouteDirection);
    setActiveTab((prev) => (prev === defaultTab ? prev : defaultTab));
    setFilters((prev) => {
      if (prev.role === fixedRole) {
        return prev;
      }
      return {
        ...prev,
        role: fixedRole,
      };
    });
  }, [fixedRole, fixedRouteDirection, hasFixedRouteDirection]);

  useEffect(() => {
    loadReport(activeTab, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canReadReports, fixedRole]);

  if (!canReadReports) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Missing permission: `cari.report.read`
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Cari Reports</h1>
        <p className="mt-1 text-sm text-slate-600">
          AR/AP aging, open-items, statement, and settlement realized FX reporting.
        </p>

        {lookupWarning ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {lookupWarning}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 md:grid-cols-6">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {activeTab === REPORT_TABS.SETTLEMENT_REALIZED_FX
              ? "Period From"
              : "As-Of Date"}
            {activeTab === REPORT_TABS.SETTLEMENT_REALIZED_FX ? (
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.periodFrom}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, periodFrom: event.target.value }))
                }
              />
            ) : (
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.asOfDate}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, asOfDate: event.target.value }))
                }
              />
            )}
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Legal Entity
            {legalEntities.length > 0 ? (
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.legalEntityId}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, legalEntityId: event.target.value }))
                }
              >
                <option value="">All in scope</option>
                {legalEntities.map((row) => (
                  <option key={`cari-reports-le-${row.id}`} value={row.id}>
                    {row.code} - {row.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.legalEntityId}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, legalEntityId: event.target.value }))
                }
                placeholder="legalEntityId"
              />
            )}
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Counterparty
            {counterparties.length > 0 ? (
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.counterpartyId}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, counterpartyId: event.target.value }))
                }
              >
                <option value="">All</option>
                {counterparties.map((row) => (
                  <option key={`cari-reports-cp-${row.id}`} value={row.id}>
                    {row.code} - {row.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.counterpartyId}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, counterpartyId: event.target.value }))
                }
                placeholder="counterpartyId"
              />
            )}
          </label>

          {activeTab === REPORT_TABS.SETTLEMENT_REALIZED_FX ? (
            <>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Period To
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={filters.periodTo}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, periodTo: event.target.value }))
                  }
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Currency
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                  value={filters.currencyCode}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      currencyCode: String(event.target.value || "").toUpperCase().slice(0, 3),
                    }))
                  }
                  placeholder="USD"
                />
              </label>
            </>
          ) : (
            <>
              {!hasFixedRouteDirection ? (
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Customer / Vendor
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={filters.role}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, role: event.target.value }))
                    }
                  >
                    {ROLE_FILTER_OPTIONS.map((option) => (
                      <option key={`cari-reports-role-${option || "ALL"}`} value={option}>
                        {option || "ALL"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Status
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, status: event.target.value }))
                  }
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={`cari-reports-status-${option}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() => loadReport(activeTab, filters)}
              disabled={loading}
            >
              {loading ? "Loading..." : "Apply Filters"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              onClick={() => {
                const nextFilters = buildDefaultFilters(fixedRouteDirection);
                setFilters(nextFilters);
                loadReport(activeTab, nextFilters);
              }}
              disabled={loading}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === tab.id
                  ? "bg-cyan-700 text-white"
                  : "border border-slate-300 text-slate-700"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === REPORT_TABS.OPEN_ITEMS && reportData ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            openItemsReconcile.matches
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          API vs row-total reconcile (open items): txn diff={openItemsReconcile.txnDiff}, base diff=
          {openItemsReconcile.baseDiff}
        </div>
      ) : null}

      {activeTab === REPORT_TABS.STATEMENT && reportData ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            statementReconcile.matches
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          Statement reconcile (document vs open-item residual): txn diff={statementReconcile.txnDiff},
          base diff={statementReconcile.baseDiff}
        </div>
      ) : null}

      {activeTab === REPORT_TABS.SETTLEMENT_REALIZED_FX && reportData ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            settlementRealizedFxReconcile.rowsCoverFullResult
              ? settlementRealizedFxReconcile.matches
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
              : "border-sky-200 bg-sky-50 text-sky-800"
          }`}
        >
          {settlementRealizedFxReconcile.rowsCoverFullResult
            ? `Settlement FX summary reconcile (summary vs rows): settlements diff=${settlementRealizedFxReconcile.settlementCountDiff}, allocated txn diff=${settlementRealizedFxReconcile.allocatedTxnDiff}, allocated base diff=${settlementRealizedFxReconcile.allocatedBaseDiff}, FX net diff=${settlementRealizedFxReconcile.realizedFxNetBaseDiff}`
            : `Settlement FX loaded rows ${settlementRealizedFxReconcile.visibleGroupedRows}/${settlementRealizedFxReconcile.totalGroupedRows}. Gain/loss cards below are based on visible grouped rows.`}
        </div>
      ) : null}

      {activeTab === REPORT_TABS.SETTLEMENT_REALIZED_FX
        ? renderSettlementRealizedFxSummaryCards(
            reportData?.summary,
            settlementRealizedFxReconcile,
            { baseMoneyMeta: settlementFxBaseMoneyMeta }
          )
        : renderSummaryCards(reportData?.summary, {
            txnMoneyMeta: reportTxnMoneyMeta,
            baseMoneyMeta: reportBaseMoneyMeta,
          })}

      {(activeTab === REPORT_TABS.AR_AGING || activeTab === REPORT_TABS.AP_AGING) && reportData ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Aging Buckets</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Bucket</th>
                  <th className="px-3 py-2">Count</th>
                  <th className="px-3 py-2">Residual Txn</th>
                  <th className="px-3 py-2">Residual Base</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.buckets || []).map((row) => (
                  <tr key={`bucket-${row.bucketCode}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.bucketLabel}</td>
                    <td className="px-3 py-2">{row.count}</td>
                    <td className="px-3 py-2">
                      {formatAggregateMoneyValue(
                        row.residualAmountTxnTotal,
                        reportTxnMoneyMeta
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {formatAggregateMoneyValue(
                        row.residualAmountBaseTotal,
                        reportBaseMoneyMeta
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === REPORT_TABS.OPEN_ITEMS && reportData ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Open-Item Rows</h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Doc</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Original</th>
                    <th className="px-3 py-2">Residual</th>
                    <th className="px-3 py-2">Bucket</th>
                    <th className="px-3 py-2">Settlements</th>
                    <th className="px-3 py-2">Bank Linked</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.rows || []).map((row) => (
                    <tr key={`open-item-${row.openItemId}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.documentNo || row.documentId}</td>
                      <td className="px-3 py-2">{formatDate(row.dueDate)}</td>
                      <td className="px-3 py-2">{row.asOfStatus}</td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.originalAmountTxn}
                          currencyCode={resolveReportCurrencyCode(row)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.residualAmountTxnAsOf}
                          currencyCode={resolveReportCurrencyCode(row)}
                        />
                      </td>
                      <td className="px-3 py-2">{row.agingBucket?.label || "-"}</td>
                      <td className="px-3 py-2">{row.settlementContext?.allocationCountAsOf || 0}</td>
                      <td className="px-3 py-2">
                        {row.settlementContext?.bankLinkedAllocationCountAsOf || 0}
                      </td>
                    </tr>
                  ))}
                  {(reportData.rows || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-3 text-slate-500">
                        No rows.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Unapplied Balances</h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Receipt No</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">As-Of Status</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Residual</th>
                    <th className="px-3 py-2">Bank Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.unapplied?.rows || []).map((row) => (
                    <tr key={`unapplied-${row.unappliedCashId}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.cashReceiptNo || row.unappliedCashId}</td>
                      <td className="px-3 py-2">{formatDate(row.receiptDate)}</td>
                      <td className="px-3 py-2">{row.asOfStatus}</td>
                      <td className="px-3 py-2">
                        <MoneyText amount={row.amountTxn} currencyCode={row.currencyCode} />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.residualAmountTxnAsOf}
                          currencyCode={row.currencyCode}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {row.bankTransactionRef || row.bankStatementLineId || "-"}
                      </td>
                    </tr>
                  ))}
                  {(reportData.unapplied?.rows || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-slate-500">
                        No unapplied rows.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === REPORT_TABS.SETTLEMENT_REALIZED_FX && reportData ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Settlement Realized FX Rows</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Legal Entity</th>
                  <th className="px-3 py-2">Counterparty</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Currency</th>
                  <th className="px-3 py-2">Settlements</th>
                  <th className="px-3 py-2">Allocated Txn</th>
                  <th className="px-3 py-2">Allocated Base</th>
                  <th className="px-3 py-2">Realized FX Net</th>
                  <th className="px-3 py-2">Realized FX Gain</th>
                  <th className="px-3 py-2">Realized FX Loss</th>
                </tr>
              </thead>
              <tbody>
                {(reportData.rows || []).map((row, index) => {
                  const baseCurrencyCode = resolveLegalEntityFunctionalCurrencyCode(
                    legalEntities,
                    row.legalEntityId
                  );
                  return (
                    <tr
                      key={`settlement-realized-fx-row-${row.period || "na"}-${row.legalEntityId || "na"}-${row.counterpartyId || "na"}-${row.currencyCode || "na"}-${index}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2">{row.period || "-"}</td>
                      <td className="px-3 py-2">
                        {row.legalEntityCode || row.legalEntityId || "-"}
                        {row.legalEntityName ? ` - ${row.legalEntityName}` : ""}
                      </td>
                      <td className="px-3 py-2">
                        {row.counterpartyCode || row.counterpartyId || "-"}
                        {row.counterpartyName ? ` - ${row.counterpartyName}` : ""}
                      </td>
                      <td className="px-3 py-2">{row.counterpartyType || "-"}</td>
                      <td className="px-3 py-2">{row.currencyCode || "-"}</td>
                      <td className="px-3 py-2">{Number(row.settlementCount || 0)}</td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.totalAllocatedTxn}
                          currencyCode={row.currencyCode}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.totalAllocatedBase}
                          currencyCode={baseCurrencyCode}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.realizedFxNetBase}
                          currencyCode={baseCurrencyCode}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.realizedFxGainBase}
                          currencyCode={baseCurrencyCode}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.realizedFxLossBase}
                          currencyCode={baseCurrencyCode}
                        />
                      </td>
                    </tr>
                  );
                })}
                {(reportData.rows || []).length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-3 text-slate-500">
                      No settlement realized FX rows.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === REPORT_TABS.STATEMENT && reportData ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Documents</h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Doc</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Open As-Of</th>
                    <th className="px-3 py-2">Reversal Link</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.documents?.rows || []).map((row) => (
                    <tr key={`stmt-doc-${row.documentId}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.documentNo || row.documentId}</td>
                      <td className="px-3 py-2">{formatDate(row.documentDate)}</td>
                      <td className="px-3 py-2">{row.asOfStatus}</td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.amountTxn}
                          currencyCode={resolveReportCurrencyCode(row)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.asOfOpenAmountTxn}
                          currencyCode={resolveReportCurrencyCode(row)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {row.reversedByDocumentNo || row.reversalOfDocumentId || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Settlements & Reversals</h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Settlement</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Cash Txn</th>
                    <th className="px-3 py-2">Reversal Of</th>
                    <th className="px-3 py-2">Reversed By</th>
                    <th className="px-3 py-2">Bank Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.settlements?.rows || []).map((row) => (
                    <tr key={`stmt-settle-${row.settlementBatchId}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">{row.settlementNo || row.settlementBatchId}</td>
                      <td className="px-3 py-2">{formatDate(row.settlementDate)}</td>
                      <td className="px-3 py-2">{row.statusCurrent}</td>
                      <td className="px-3 py-2">
                        <MoneyText
                          amount={row.totalAllocatedTxn}
                          currencyCode={row.currencyCode}
                        />
                      </td>
                      <td className="px-3 py-2">{row.cashTransactionId || "-"}</td>
                      <td className="px-3 py-2">{row.reversalOfSettlementNo || "-"}</td>
                      <td className="px-3 py-2">{row.reversedBySettlementNo || "-"}</td>
                      <td className="px-3 py-2">
                        {row.bankTransactionRef || row.bankStatementLineId || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
