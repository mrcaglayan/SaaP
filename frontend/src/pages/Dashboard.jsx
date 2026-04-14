import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getConsolidationRunReviewGate,
  listConsolidationGroupMembers,
  listConsolidationRuns,
} from "../api/consolidationAdmin.js";
import {
  getOpsBankPaymentBatchesHealth,
  getOpsBankReconciliationSummary,
  getOpsCashTransitAttention,
  getOpsFixedAssetActivationAttention,
  getOpsFixedAssetDepreciationAttention,
  getOpsFixedAssetLateCatchUpAttention,
  getOpsJobsHealth,
  getOpsPayrollCloseStatus,
  getOpsPayrollImportHealth,
} from "../api/opsDashboard.js";
import { getInventoryWorkQueueSummary } from "../api/inventory.js";
import { listExceptionWorkbench } from "../api/exceptionsWorkbench.js";
import { getLocalClosePack, listLocalClosePacks } from "../api/localClosePacks.js";
import {
  listMeNotifications,
  markAllMeNotificationsRead,
  markMeNotificationRead,
} from "../api/me.js";
import { useAuth } from "../auth/useAuth.js";
import { useWorkingContext } from "../context/useWorkingContext.js";
import { useI18n } from "../i18n/useI18n.js";
import { useModuleReadiness } from "../readiness/useModuleReadiness.js";
import { useTenantReadiness } from "../readiness/useTenantReadiness.js";
import { resolveSourceLinkDestination } from "../utils/journalSourceLinkDestinations.js";

const CONSOLIDATION_REPORTS_PATH =
  "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari";
const LOCAL_CLOSE_WORKSPACE_PATH =
  "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri";
const YEAR_END_REVREC_PATH =
  "/app/donem-sonu-islemler/yillik/kapanis-islemleri";

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function formatCount(value) {
  const parsed = toInt(value, 0);
  return parsed.toLocaleString();
}

function formatWindowLabel(window) {
  const dateFrom = String(window?.dateFrom || "").trim();
  const dateTo = String(window?.dateTo || "").trim();
  if (!dateFrom || !dateTo) {
    return "";
  }
  return `${dateFrom} - ${dateTo}`;
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

function normalizeCariDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "AR" ? "AR" : normalized === "AP" ? "AP" : "";
}

function normalizeNotificationCode(value) {
  return String(value || "").trim().toUpperCase();
}

function buildCariNotificationDestination(row) {
  const sourceRefType = String(row?.sourceRefType || "")
    .trim()
    .toUpperCase();
  const sourceRefId = Number(row?.sourceRefId || 0);
  if (!Number.isInteger(sourceRefId) || sourceRefId <= 0) {
    return null;
  }

  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const direction = normalizeCariDirection(
    payload?.direction || payload?.documentDirection || payload?.settlementDirection
  );
  if (!direction) {
    return null;
  }

  if (sourceRefType === "CARI_DOCUMENT") {
    const baseRoute =
      direction === "AR" ? "/app/satis-faturalari" : "/app/alis-faturalari";
    return { route: `${baseRoute}?documentId=${sourceRefId}` };
  }

  if (sourceRefType === "CARI_SETTLEMENT_BATCH") {
    const baseRoute =
      direction === "AR" ? "/app/musteri-tahsilatlar" : "/app/tedarikci-odemeler";
    const params = new URLSearchParams({
      settlementBatchId: String(sourceRefId),
    });
    const legalEntityId = Number(payload?.legalEntityId || payload?.legal_entity_id || 0);
    const counterpartyId = Number(payload?.counterpartyId || payload?.counterparty_id || 0);
    if (Number.isInteger(legalEntityId) && legalEntityId > 0) {
      params.set("legalEntityId", String(legalEntityId));
    }
    if (Number.isInteger(counterpartyId) && counterpartyId > 0) {
      params.set("counterpartyId", String(counterpartyId));
    }
    return { route: `${baseRoute}?${params.toString()}` };
  }

  return null;
}

function buildApprovalRequestNotificationDestination(row) {
  const sourceRefType = normalizeNotificationCode(row?.sourceRefType);
  if (sourceRefType !== "APPROVAL_REQUEST") {
    return null;
  }

  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const approvalRequestId = Number(
    payload?.approvalRequestId || payload?.approval_request_id || row?.sourceRefId || 0
  );
  if (!Number.isInteger(approvalRequestId) || approvalRequestId <= 0) {
    return null;
  }

  const moduleCode = normalizeNotificationCode(payload?.moduleCode || payload?.module_code);
  if (moduleCode === "BANK") {
    return { route: `/app/banka-onaylar?approvalRequestId=${approvalRequestId}` };
  }

  return null;
}

function isEscalatedApprovalNotification(row) {
  return normalizeNotificationCode(row?.notificationType) === "APPROVAL_REQUEST_ESCALATED";
}

function buildNotificationTargetPath(row) {
  const inferredDestination =
    buildApprovalRequestNotificationDestination(row) || buildCariNotificationDestination(row);
  return (
    resolveSourceLinkDestination({
      sourceRefType: row?.sourceRefType,
      sourceRefId: row?.sourceRefId,
      destination: inferredDestination ||
        (row?.destination && typeof row.destination === "object"
          ? row.destination
          : row?.payload?.destination && typeof row.payload.destination === "object"
            ? row.payload.destination
            : null),
    }) || ""
  );
}

function resolveScopeParams(workingContext) {
  const params = {};
  const legalEntityId = Number(workingContext?.legalEntityId || 0);
  if (Number.isInteger(legalEntityId) && legalEntityId > 0) {
    params.legalEntityId = legalEntityId;
  }

  const dateFrom = String(workingContext?.dateFrom || "").trim();
  const dateTo = String(workingContext?.dateTo || "").trim();
  if (dateFrom) {
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    params.dateTo = dateTo;
  }

  if (!params.dateFrom && !params.dateTo) {
    params.days = 30;
  }

  return params;
}

function buildAppPath(basePath, params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function formatPeriodLabel(periodYear, periodNo, periodName = "") {
  const normalizedYear = toInt(periodYear, 0);
  const normalizedPeriodNo = toInt(periodNo, 0);
  const normalizedPeriodName = String(periodName || "").trim();
  if (normalizedYear > 0 && normalizedPeriodNo > 0) {
    return `FY${normalizedYear} P${String(normalizedPeriodNo).padStart(2, "0")}${
      normalizedPeriodName ? ` - ${normalizedPeriodName}` : ""
    }`;
  }
  return normalizedPeriodName || "-";
}

function formatEnumLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function formatConsolidationRunScope(run) {
  if (!run) {
    return "-";
  }
  const groupCode = String(run?.consolidation_group_code || run?.consolidationGroupCode || "").trim();
  const groupName = String(run?.consolidation_group_name || run?.consolidationGroupName || "").trim();
  const groupLabel = groupCode && groupName ? `${groupCode} - ${groupName}` : groupCode || groupName;
  const periodLabel = formatPeriodLabel(run?.fiscal_year, run?.period_no, run?.period_name);
  const currencyCode = String(
    run?.presentation_currency_code || run?.presentationCurrencyCode || ""
  )
    .trim()
    .toUpperCase();
  return [groupLabel, periodLabel, currencyCode].filter(Boolean).join(" | ") || `#${run?.id || "-"}`;
}

function getConsolidationPublishTone(publishState) {
  switch (String(publishState || "").trim().toUpperCase()) {
    case "READY_TO_PUBLISH":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "LOCKED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "BLOCKED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function dedupeConsolidationMemberRows(rows) {
  const deduped = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const legalEntityId = toInt(row?.legal_entity_id ?? row?.legalEntityId, 0);
    if (!legalEntityId || seen.has(legalEntityId)) {
      continue;
    }
    seen.add(legalEntityId);
    deduped.push(row);
  }
  return deduped;
}

function buildYearEndRevrecPath(params = {}) {
  return buildAppPath(YEAR_END_REVREC_PATH, {
    legalEntityId: params.legalEntityId,
    bookId: params.bookId,
    fiscalPeriodId: params.fiscalPeriodId,
    tab: "balances",
  });
}

function MetricCard({ title, value, subtitle, to, ctaLabel, locked }) {
  const baseClassName =
    "rounded-xl border p-4 transition-colors bg-white border-slate-200 shadow-sm";
  const lockedClassName = "border-amber-200 bg-amber-50/70";

  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
      {locked ? (
        <p className="mt-2 text-xs font-medium text-amber-900">Permission required</p>
      ) : null}
      {!locked && to && ctaLabel ? (
        <span className="mt-3 inline-flex text-xs font-semibold text-cyan-700">
          {ctaLabel}
        </span>
      ) : null}
    </>
  );

  if (locked || !to) {
    return (
      <article className={`${baseClassName} ${locked ? lockedClassName : ""}`}>
        {content}
      </article>
    );
  }

  return (
    <Link
      to={to}
      className={`${baseClassName} hover:border-cyan-300 hover:bg-cyan-50/30`}
    >
      {content}
    </Link>
  );
}

function ReadinessSummaryCard({ title, value, subtitle, tone = "slate", locked = false }) {
  const toneClassName =
    tone === "rose"
      ? "border-rose-200 bg-rose-50"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50"
        : tone === "cyan"
          ? "border-cyan-200 bg-cyan-50"
          : "border-slate-200 bg-slate-50";
  return (
    <article className={`rounded-lg border px-3 py-3 ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
      {locked ? (
        <p className="mt-2 text-xs font-medium text-amber-900">Permission required</p>
      ) : null}
    </article>
  );
}

/**
 * Render the finance console dashboard, including one lightweight Track 51
 * consolidation-readiness summary that reuses the live run, local-close, and
 * year-end review seams instead of introducing another dashboard endpoint.
 */
export default function Dashboard() {
  const { l, t } = useI18n();
  const { entitlements, getPermissionAccess, hasPermission } = useAuth();
  const { workingContext } = useWorkingContext();
  const {
    readiness: moduleReadinessPayload,
    loading: moduleReadinessLoading,
    error: moduleReadinessError,
  } = useModuleReadiness();
  const {
    missingChecks,
    loading: tenantReadinessLoading,
    error: tenantReadinessError,
  } = useTenantReadiness();

  const canReadOps = hasPermission("ops.dashboard.read");
  const canReadCash = hasPermission("cash.txn.read");
  const canReadExceptions = hasPermission("ops.exceptions.read");
  const currentLegalEntityId = toInt(workingContext?.legalEntityId, 0);
  const canReadReadiness = getPermissionAccess(
    "org.tree.read",
    currentLegalEntityId > 0
      ? {
          scope: {
            scopeType: "LEGAL_ENTITY",
            scopeId: currentLegalEntityId,
          },
        }
      : undefined
  ).allowed;
  const inventoryEntitlementOus = useMemo(() => {
    const rows = Array.isArray(entitlements?.permissions) ? entitlements.permissions : [];
    return rows
      .filter((row) => String(row?.code || "").trim() === "inventory.read")
      .filter((row) => String(row?.scopeType || "").trim().toUpperCase() === "OPERATING_UNIT")
      .flatMap((row) =>
        Array.isArray(row?.scopeIds) ? row.scopeIds.map((id) => toInt(id, 0)) : []
      )
      .filter((id) => id > 0);
  }, [entitlements?.permissions]);
  const singleInventoryOuId =
    inventoryEntitlementOus.length === 1 ? inventoryEntitlementOus[0] : 0;
  const inventoryReadAtLegalEntity = getPermissionAccess(
    "inventory.read",
    currentLegalEntityId > 0
      ? {
          scope: {
            scopeType: "LEGAL_ENTITY",
            scopeId: currentLegalEntityId,
          },
        }
      : undefined
  ).allowed;
  const canReadInventory =
    hasPermission("inventory.read") &&
    (toInt(workingContext?.operatingUnitId, 0) > 0 ||
      singleInventoryOuId > 0 ||
      inventoryReadAtLegalEntity);
  const canReadFixedAssetRuns =
    hasPermission("fixed_assets.depreciation.run") || hasPermission("fixed_assets.read");
  const canReadConsolidationRuns = hasPermission("consolidation.run.read");
  const canReadConsolidationGroups = hasPermission("consolidation.group.read");
  const canReadLocalClose = hasPermission("ouclose.read");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [snapshot, setSnapshot] = useState({
    bankReconciliation: null,
    bankPayments: null,
    cashTransit: null,
    payrollImports: null,
    payrollClose: null,
    jobs: null,
    exceptions: null,
    inventoryWorkQueue: null,
    fixedAssetActivationAttention: null,
    fixedAssetLateCatchUpAttention: null,
    fixedAssetDepreciationAttention: null,
  });
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationRows, setNotificationRows] = useState([]);
  const [notificationsTotal, setNotificationsTotal] = useState(0);
  const [markingNotificationId, setMarkingNotificationId] = useState(null);
  const [markAllNotificationsSaving, setMarkAllNotificationsSaving] = useState(false);
  const [consolidationReadiness, setConsolidationReadiness] = useState({
    loading: false,
    error: "",
    data: null,
  });

  const scopeParams = useMemo(
    () => resolveScopeParams(workingContext),
    [workingContext]
  );
  const workingFiscalPeriodId = toInt(workingContext?.fiscalPeriodId, 0);
  const inventoryScopeParams = useMemo(() => {
    const params = {};
    const operatingUnitId = toInt(workingContext?.operatingUnitId, 0);
    if (operatingUnitId > 0) {
      if (scopeParams.legalEntityId) {
        params.legalEntityId = scopeParams.legalEntityId;
      }
      params.operatingUnitId = operatingUnitId;
      return params;
    }
    if (singleInventoryOuId > 0) {
      params.operatingUnitId = singleInventoryOuId;
      return params;
    }
    if (scopeParams.legalEntityId) {
      params.legalEntityId = scopeParams.legalEntityId;
    }
    return params;
  }, [scopeParams.legalEntityId, singleInventoryOuId, workingContext?.operatingUnitId]);

  const loadConsolidationReadiness = useCallback(async () => {
    if (!canReadConsolidationRuns) {
      setConsolidationReadiness({
        loading: false,
        error: "",
        data: null,
      });
      return;
    }

    setConsolidationReadiness((prev) => ({
      ...prev,
      loading: true,
      error: "",
    }));

    try {
      let runRows = [];
      let selectionMode = "LATEST";

      // Prefer the current working period when one is selected so the dashboard
      // follows the same accounting window the operator is already using.
      if (workingFiscalPeriodId > 0) {
        const scopedResponse = await listConsolidationRuns({
          fiscalPeriodId: workingFiscalPeriodId,
        });
        runRows = Array.isArray(scopedResponse?.rows) ? scopedResponse.rows : [];
        if (runRows.length > 0) {
          selectionMode = "CURRENT_PERIOD";
        }
      }

      if (runRows.length === 0) {
        const fallbackResponse = await listConsolidationRuns();
        runRows = Array.isArray(fallbackResponse?.rows) ? fallbackResponse.rows : [];
        selectionMode = "LATEST";
      }

      const selectedRun = runRows[0] || null;
      if (!selectedRun) {
        setConsolidationReadiness({
          loading: false,
          error: "",
          data: {
            selectionMode,
            run: null,
            reviewGate: null,
            localClose: null,
          },
        });
        return;
      }

      const reviewGate = await getConsolidationRunReviewGate(selectedRun.id);
      const selectedRunGroupId = toInt(
        selectedRun?.consolidation_group_id ?? selectedRun?.consolidationGroupId,
        0
      );
      const selectedRunPeriodId = toInt(
        selectedRun?.fiscal_period_id ?? selectedRun?.fiscalPeriodId,
        0
      );

      let localClose = {
        available: false,
        memberCount: 0,
        packCount: 0,
        lockedPackCount: 0,
        pendingPackCount: Number(reviewGate?.counts?.memberReadinessBlockCount || 0),
        revrecFailureCount: 0,
        centralPackCount: 0,
        revrecPath: "",
        partialRevrecCoverage: false,
        firstCentralPack: null,
      };

      if (
        canReadConsolidationGroups &&
        canReadLocalClose &&
        selectedRunGroupId > 0 &&
        selectedRunPeriodId > 0
      ) {
        const groupMemberResponse = await listConsolidationGroupMembers(selectedRunGroupId);
        const memberRows = dedupeConsolidationMemberRows(groupMemberResponse?.rows);
        const memberEntityIds = new Set(
          memberRows
            .map((row) => toInt(row?.legal_entity_id ?? row?.legalEntityId, 0))
            .filter((value) => value > 0)
        );
        const localCloseResponse = await listLocalClosePacks({
          fiscalPeriodId: selectedRunPeriodId,
          limit: 500,
        });
        const memberPackRows = (Array.isArray(localCloseResponse?.rows)
          ? localCloseResponse.rows
          : []
        ).filter((row) => memberEntityIds.has(toInt(row?.legalEntityId, 0)));
        const centralPackRows = memberPackRows.filter(
          (row) => String(row?.closeScopeType || "").trim().toUpperCase() === "CENTRAL"
        );
        const detailResults = await Promise.allSettled(
          centralPackRows.map((row) => getLocalClosePack(row.id))
        );

        let revrecFailureCount = 0;
        let revrecPath = "";
        let partialRevrecCoverage = false;
        for (const result of detailResults) {
          if (result.status !== "fulfilled") {
            partialRevrecCoverage = true;
            continue;
          }
          const blockers = Array.isArray(result.value?.reviewGate?.blockers)
            ? result.value.reviewGate.blockers
            : [];
          const revrecBlockers = blockers.filter((row) =>
            String(row?.code || "").trim().toUpperCase().startsWith("REVREC_CONTINUITY_")
          );
          revrecFailureCount += revrecBlockers.length;
          if (!revrecPath) {
            const firstPath = String(revrecBlockers[0]?.drill?.path || "").trim();
            if (firstPath) {
              revrecPath = firstPath;
            }
          }
        }

        localClose = {
          available: true,
          memberCount: memberRows.length,
          packCount: memberPackRows.length,
          lockedPackCount: memberPackRows.filter(
            (row) => String(row?.status || "").trim().toUpperCase() === "LOCKED"
          ).length,
          pendingPackCount: Math.max(
            memberPackRows.filter(
              (row) => String(row?.status || "").trim().toUpperCase() !== "LOCKED"
            ).length,
            Number(reviewGate?.counts?.memberReadinessBlockCount || 0)
          ),
          revrecFailureCount,
          centralPackCount: centralPackRows.length,
          revrecPath,
          partialRevrecCoverage,
          firstCentralPack: centralPackRows[0] || null,
        };
      }

      setConsolidationReadiness({
        loading: false,
        error: "",
        data: {
          selectionMode,
          run: selectedRun,
          reviewGate: reviewGate || null,
          localClose,
        },
      });
    } catch (err) {
      setConsolidationReadiness({
        loading: false,
        error:
          err?.response?.data?.message ||
          err?.message ||
          t(
            "dashboard.consolidationReadiness.loadFailed",
            "Consolidation readiness summary could not be loaded."
          ),
        data: null,
      });
    }
  }, [
    canReadConsolidationGroups,
    canReadConsolidationRuns,
    canReadLocalClose,
    t,
    workingFiscalPeriodId,
  ]);

  const load = useCallback(async () => {
    const requestEntries = [];
    if (canReadOps) {
      requestEntries.push(
        {
          key: "bankReconciliation",
          run: () => getOpsBankReconciliationSummary(scopeParams),
        },
        {
          key: "bankPayments",
          run: () => getOpsBankPaymentBatchesHealth(scopeParams),
        },
        {
          key: "payrollImports",
          run: () => getOpsPayrollImportHealth(scopeParams),
        },
        {
          key: "payrollClose",
          run: () => getOpsPayrollCloseStatus(scopeParams),
        },
        {
          key: "jobs",
          run: () => getOpsJobsHealth(scopeParams),
        }
      );
    }

    if (canReadCash) {
      requestEntries.push({
        key: "cashTransit",
        run: () => getOpsCashTransitAttention(scopeParams),
      });
    }

    if (canReadOps && canReadFixedAssetRuns) {
      requestEntries.push({
        key: "fixedAssetActivationAttention",
        run: () => getOpsFixedAssetActivationAttention(scopeParams),
      });
      requestEntries.push({
        key: "fixedAssetLateCatchUpAttention",
        run: () => getOpsFixedAssetLateCatchUpAttention(scopeParams),
      });
      requestEntries.push({
        key: "fixedAssetDepreciationAttention",
        run: () => getOpsFixedAssetDepreciationAttention(scopeParams),
      });
    }

    if (canReadExceptions) {
      requestEntries.push({
        key: "exceptions",
        run: () =>
          listExceptionWorkbench({
            limit: 1,
            offset: 0,
            refresh: 0,
            days: scopeParams.days || 90,
            legalEntityId: scopeParams.legalEntityId,
          }),
      });
    }

    if (canReadInventory) {
      requestEntries.push({
        key: "inventoryWorkQueue",
        run: () => getInventoryWorkQueueSummary(inventoryScopeParams),
      });
    }

    if (requestEntries.length === 0) {
      setError("");
      setLoading(false);
      setSnapshot({
        bankReconciliation: null,
        bankPayments: null,
        cashTransit: null,
        payrollImports: null,
        payrollClose: null,
        jobs: null,
        exceptions: null,
        inventoryWorkQueue: null,
        fixedAssetActivationAttention: null,
        fixedAssetLateCatchUpAttention: null,
        fixedAssetDepreciationAttention: null,
      });
      setLastRefreshedAt(new Date().toISOString());
      return;
    }

    setLoading(true);
    setError("");
    try {
      const settled = await Promise.allSettled(
        requestEntries.map((entry) => entry.run())
      );

      const nextSnapshot = {
        bankReconciliation: null,
        bankPayments: null,
        cashTransit: null,
        payrollImports: null,
        payrollClose: null,
        jobs: null,
        exceptions: null,
        inventoryWorkQueue: null,
        fixedAssetActivationAttention: null,
        fixedAssetLateCatchUpAttention: null,
        fixedAssetDepreciationAttention: null,
      };

      const failedKeys = [];
      settled.forEach((result, index) => {
        const entry = requestEntries[index];
        if (result.status === "fulfilled") {
          nextSnapshot[entry.key] = result.value || null;
          return;
        }
        failedKeys.push(entry.key);
      });

      setSnapshot(nextSnapshot);
      if (failedKeys.length > 0) {
        setError(
          t(
            "dashboard.widgetsPartialError",
            "Some dashboard widgets could not be loaded: {{widgets}}",
            { widgets: failedKeys.join(", ") }
          )
        );
      }
      setLastRefreshedAt(new Date().toISOString());
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          t("dashboard.loadFailed", "Dashboard data could not be loaded.")
      );
    } finally {
      setLoading(false);
    }
  }, [
    canReadCash,
    canReadExceptions,
    canReadFixedAssetRuns,
    canReadInventory,
    canReadOps,
    inventoryScopeParams,
    scopeParams,
    t,
  ]);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([load(), loadConsolidationReadiness()]);
  }, [load, loadConsolidationReadiness]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const response = await listMeNotifications({
        status: "UNREAD",
        limit: 8,
        offset: 0,
      });
      const rows = Array.isArray(response?.rows) ? response.rows : [];
      setNotificationRows(rows);
      setNotificationsTotal(Number(response?.total || rows.length || 0));
    } catch (err) {
      setNotificationsError(
        err?.response?.data?.message ||
          err?.message ||
          t("dashboard.notifications.loadFailed", "Notifications could not be loaded.")
      );
      setNotificationRows([]);
      setNotificationsTotal(0);
    } finally {
      setNotificationsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  async function handleMarkNotificationRead(notificationId) {
    const parsedId = Number(notificationId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return;
    }
    setMarkingNotificationId(parsedId);
    setNotificationsError("");
    try {
      await markMeNotificationRead(parsedId);
      await loadNotifications();
    } catch (err) {
      setNotificationsError(
        err?.response?.data?.message ||
          err?.message ||
          t("dashboard.notifications.markReadFailed", "Notification could not be marked as read.")
      );
    } finally {
      setMarkingNotificationId(null);
    }
  }

  async function handleMarkAllNotificationsRead() {
    setMarkAllNotificationsSaving(true);
    setNotificationsError("");
    try {
      await markAllMeNotificationsRead();
      await loadNotifications();
    } catch (err) {
      setNotificationsError(
        err?.response?.data?.message ||
          err?.message ||
          t("dashboard.notifications.markAllFailed", "Notifications could not be marked as read.")
      );
    } finally {
      setMarkAllNotificationsSaving(false);
    }
  }

  const moduleReadinessRows = useMemo(() => {
    const modules = moduleReadinessPayload?.modules || {};
    const legalEntityId = Number(scopeParams.legalEntityId || 0);
    const rows = [];

    for (const [moduleKey, moduleValue] of Object.entries(modules)) {
      for (const row of moduleValue?.byLegalEntity || []) {
        const rowLegalEntityId = Number(row?.legalEntityId || 0);
        if (
          Number.isInteger(legalEntityId) &&
          legalEntityId > 0 &&
          rowLegalEntityId !== legalEntityId
        ) {
          continue;
        }
        rows.push({
          moduleKey,
          ...row,
        });
      }
    }

    return rows;
  }, [moduleReadinessPayload, scopeParams.legalEntityId]);

  const moduleBlockerCount = useMemo(
    () => moduleReadinessRows.filter((row) => !row?.ready).length,
    [moduleReadinessRows]
  );

  const openExceptionsCount = useMemo(() => {
    const byStatus = snapshot.exceptions?.summary?.by_status || {};
    return (
      toInt(byStatus.OPEN, 0) +
      toInt(byStatus.IN_REVIEW, 0) +
      toInt(byStatus.ASSIGNED, 0)
    );
  }, [snapshot.exceptions]);

  const toPostCount = useMemo(() => {
    const bankPending = toInt(snapshot.bankPayments?.sla?.pending_export_batches, 0);
    const payrollPreviewed = toInt(snapshot.payrollImports?.sla?.previewed_jobs, 0);
    const payrollApplying = toInt(snapshot.payrollImports?.sla?.applying_jobs, 0);
    return bankPending + payrollPreviewed + payrollApplying;
  }, [snapshot.bankPayments, snapshot.payrollImports]);

  const toSettleCount = useMemo(() => {
    const unmatched = toInt(snapshot.bankReconciliation?.sla?.unmatched_open_total, 0);
    const awaitingAck = toInt(snapshot.bankPayments?.sla?.awaiting_ack_batches, 0);
    return unmatched + awaitingAck;
  }, [snapshot.bankPayments, snapshot.bankReconciliation]);

  const cashTransitIncomingWaitingCount = useMemo(
    () => toInt(snapshot.cashTransit?.queue?.incoming_waiting_total, 0),
    [snapshot.cashTransit]
  );

  const cashTransitPendingDispatchCount = useMemo(
    () => toInt(snapshot.cashTransit?.queue?.initiated_not_dispatched_total, 0),
    [snapshot.cashTransit]
  );

  const cashTransitOldestWaitingHours = useMemo(
    () => toInt(snapshot.cashTransit?.queue?.oldest_waiting_hours, 0),
    [snapshot.cashTransit]
  );

  const periodCloseBlockerCount = useMemo(() => {
    const payrollFailedChecks = toInt(
      snapshot.payrollClose?.checks?.failed_checks_open_periods,
      0
    );
    const tenantMissing = Array.isArray(missingChecks) ? missingChecks.length : 0;
    return payrollFailedChecks + tenantMissing + moduleBlockerCount;
  }, [missingChecks, moduleBlockerCount, snapshot.payrollClose]);

  const fixedAssetSkippedAttentionAssetCount = useMemo(
    () =>
      toInt(
        snapshot.fixedAssetDepreciationAttention?.affected_assets?.pending_skipped_assets,
        0
      ),
    [snapshot.fixedAssetDepreciationAttention]
  );

  const fixedAssetSkippedAttentionRunCount = useMemo(
    () =>
      toInt(
        snapshot.fixedAssetDepreciationAttention?.runs?.pending_skipped_runs,
        0
      ),
    [snapshot.fixedAssetDepreciationAttention]
  );

  const fixedAssetSkippedAttentionPeriodHint = useMemo(() => {
    const oldest = String(
      snapshot.fixedAssetDepreciationAttention?.runs?.oldest_period_key || ""
    ).trim();
    const latest = String(
      snapshot.fixedAssetDepreciationAttention?.runs?.latest_period_key || ""
    ).trim();
    if (!oldest && !latest) {
      return "";
    }
    if (oldest && latest && oldest !== latest) {
      return `${oldest} - ${latest}`;
    }
    return latest || oldest;
  }, [snapshot.fixedAssetDepreciationAttention]);

  const fixedAssetLateCatchUpCount = useMemo(
    () =>
      toInt(
        snapshot.fixedAssetLateCatchUpAttention?.affected_assets?.pending_late_catch_up_assets,
        0
      ),
    [snapshot.fixedAssetLateCatchUpAttention]
  );

  const fixedAssetLateCatchUpPeriodHint = useMemo(() => {
    const oldest = String(
      snapshot.fixedAssetLateCatchUpAttention?.periods?.oldest_pending_period_key || ""
    ).trim();
    const latest = String(
      snapshot.fixedAssetLateCatchUpAttention?.periods?.latest_pending_period_key || ""
    ).trim();
    if (!oldest && !latest) {
      return "";
    }
    if (oldest && latest && oldest !== latest) {
      return `${oldest} - ${latest}`;
    }
    return latest || oldest;
  }, [snapshot.fixedAssetLateCatchUpAttention]);

  const fixedAssetPendingActivationCount = useMemo(
    () =>
      toInt(
        snapshot.fixedAssetActivationAttention?.affected_assets?.pending_activation_assets,
        0
      ),
    [snapshot.fixedAssetActivationAttention]
  );

  const fixedAssetPendingActivationOldestDate = useMemo(
    () =>
      String(
        snapshot.fixedAssetActivationAttention?.acquisition_dates?.oldest_acquisition_date || ""
      ).trim(),
    [snapshot.fixedAssetActivationAttention]
  );

  const inventoryQueueLinks = useMemo(() => {
    const legalEntityId = inventoryScopeParams.legalEntityId || "";
    const operatingUnitId = inventoryScopeParams.operatingUnitId || "";
    return {
      receiptMaterialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
        operatingUnitId,
        queueScope: "ACTIONABLE",
        stockImpactMode: "RECEIPT_PENDING",
      }),
      issueMaterialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
        operatingUnitId,
        queueScope: "ACTIONABLE",
        stockImpactMode: "ISSUE_PENDING",
      }),
      completedMaterialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
        operatingUnitId,
        queueScope: "COMPLETED",
      }),
      voidMaterialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
        operatingUnitId,
        queueScope: "VOID",
      }),
      waitingApproval: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
        operatingUnitId,
        status: "INITIATED",
      }),
      readyToShip: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
        operatingUnitId,
        status: "APPROVED",
      }),
      waitingReceipt: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
        operatingUnitId,
        status: "IN_TRANSIT",
      }),
      transfers: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
        operatingUnitId,
      }),
      materialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
        operatingUnitId,
        queueScope: "ACTIONABLE",
      }),
    };
  }, [inventoryScopeParams.legalEntityId, inventoryScopeParams.operatingUnitId]);

  const windowLabel = useMemo(() => {
    const firstWindow =
      snapshot.bankReconciliation?.window ||
      snapshot.bankPayments?.window ||
      snapshot.cashTransit?.window ||
      snapshot.payrollImports?.window ||
      snapshot.payrollClose?.window ||
      snapshot.jobs?.window ||
      null;
    return formatWindowLabel(firstWindow);
  }, [snapshot]);

  const quickLinks = useMemo(
    () => [
      {
        to: "/app/ayarlar/exception-workbench",
        title: t("dashboard.links.exceptions", "Exception Workbench"),
        hint: `${formatCount(openExceptionsCount)} ${t("dashboard.openItems", "open items")}`,
        enabled: canReadExceptions,
      },
      {
        to: "/app/banka-mutabakat",
        title: t("dashboard.links.bankReconciliation", "Bank Reconciliation"),
        hint: `${formatCount(
          snapshot.bankReconciliation?.sla?.unmatched_open_total || 0
        )} ${t("dashboard.unmatchedLines", "unmatched lines")}`,
        enabled: canReadOps,
      },
      {
        to: "/app/odeme-batchleri",
        title: t("dashboard.links.paymentBatches", "Payment Batches"),
        hint: `${formatCount(
          snapshot.bankPayments?.sla?.pending_export_batches || 0
        )} ${t("dashboard.pendingExport", "pending export")}`,
        enabled: canReadOps,
      },
      {
        to: "/app/payroll-close-controls",
        title: t("dashboard.links.payrollClose", "Payroll Close Controls"),
        hint: `${formatCount(
          snapshot.payrollClose?.checks?.failed_checks_open_periods || 0
        )} ${t("dashboard.failedChecks", "failed checks")}`,
        enabled: canReadOps,
      },
      {
        to: "/app/kasa-transit-transferleri",
        title: l("Cash Transit Queue", "Kasa Transit Kuyrugu"),
        hint: `${formatCount(cashTransitIncomingWaitingCount)} ${l("awaiting receipt", "teslim almayi bekliyor")}`,
        enabled: canReadCash,
      },
      {
        to: "/app/ayarlar/operasyon-dashboard",
        title: t("dashboard.links.opsDetail", "Ops Dashboard Detail"),
        hint: `${formatCount(
          (snapshot.jobs?.sla?.queued_due_now || 0) +
            (snapshot.jobs?.sla?.retries_due_now || 0)
        )} ${t("dashboard.jobsDueNow", "jobs due now")}`,
        enabled: canReadOps,
      },
      {
        to: inventoryQueueLinks.materialization,
        title: t("dashboard.links.inventoryMaterialization", "Inventory Materialization"),
        hint: `${formatCount(
          snapshot.inventoryWorkQueue?.stockLinks?.total_pending || 0
        )} ${t("dashboard.pendingLinks", "pending links")}`,
        enabled: canReadInventory,
      },
      {
        to: inventoryQueueLinks.transfers,
        title: t("dashboard.links.inventoryTransfers", "Inventory Transfers"),
        hint: `${formatCount(
          snapshot.inventoryWorkQueue?.transfers?.in_transit_waiting_receipt || 0
        )} ${t("dashboard.inTransit", "in transit")}`,
        enabled: canReadInventory,
      },
    ],
    [
      canReadCash,
      canReadExceptions,
      canReadInventory,
      canReadOps,
      cashTransitIncomingWaitingCount,
      inventoryQueueLinks,
      l,
      openExceptionsCount,
      snapshot,
      t,
    ]
  );

  const readinessInlineError = moduleReadinessError || tenantReadinessError || "";
  const consolidationRun = consolidationReadiness.data?.run || null;
  const consolidationReviewGate = consolidationReadiness.data?.reviewGate || null;
  const consolidationLocalClose = consolidationReadiness.data?.localClose || null;
  const consolidationBlockerCount = Array.isArray(consolidationReviewGate?.blockers)
    ? consolidationReviewGate.blockers.length
    : 0;
  const consolidationSelectionLabel =
    consolidationReadiness.data?.selectionMode === "CURRENT_PERIOD"
      ? t("dashboard.consolidationReadiness.currentPeriod", "Current working period")
      : t("dashboard.consolidationReadiness.latestRun", "Latest available run");
  const consolidationPublishStateLabel = formatEnumLabel(
    consolidationReviewGate?.publishState || consolidationRun?.status || ""
  );
  const consolidationReportsLink = buildAppPath(CONSOLIDATION_REPORTS_PATH, {
    runId: consolidationRun?.id,
  });
  const localCloseWorkspaceLink = buildAppPath(LOCAL_CLOSE_WORKSPACE_PATH, {
    fiscalPeriodId:
      consolidationRun?.fiscal_period_id ?? consolidationRun?.fiscalPeriodId ?? undefined,
  });
  const yearEndRevrecLink =
    String(consolidationLocalClose?.revrecPath || "").trim() ||
    (consolidationLocalClose?.firstCentralPack
      ? buildYearEndRevrecPath({
          legalEntityId: consolidationLocalClose.firstCentralPack.legalEntityId,
          bookId: consolidationLocalClose.firstCentralPack.bookId,
          fiscalPeriodId: consolidationLocalClose.firstCentralPack.fiscalPeriodId,
        })
      : YEAR_END_REVREC_PATH);
  const refreshingDashboard = loading || consolidationReadiness.loading;

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {t("dashboard.financeConsoleTitle", "Finance Console")}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {t(
                "dashboard.financeConsoleSubtitle",
                "Today's operational queues and blockers in one place."
              )}
            </p>
            {windowLabel ? (
              <p className="mt-2 text-xs font-medium text-slate-500">
                {t("dashboard.window", "Window")}: {windowLabel}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {lastRefreshedAt ? (
              <span className="text-xs text-slate-500">
                {t("dashboard.lastUpdated", "Last updated")}:{" "}
                {new Date(lastRefreshedAt).toLocaleTimeString()}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void refreshDashboard();
              }}
              disabled={refreshingDashboard}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {refreshingDashboard
                ? t("dashboard.refreshing", "Refreshing...")
                : t("dashboard.refresh", "Refresh")}
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </div>
        ) : null}
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title={t("dashboard.cards.toPost", "To Post")}
          value={formatCount(toPostCount)}
          subtitle={t(
            "dashboard.cards.toPostHint",
            "Batches and payroll imports waiting posting actions."
          )}
          to="/app/odeme-batchleri"
          ctaLabel={t("dashboard.openQueue", "Open queue")}
          locked={!canReadOps}
        />
        <MetricCard
          title={t("dashboard.cards.toSettle", "To Settle")}
          value={formatCount(toSettleCount)}
          subtitle={t(
            "dashboard.cards.toSettleHint",
            "Unmatched statements and exported batches awaiting bank ack."
          )}
          to="/app/banka-mutabakat"
          ctaLabel={t("dashboard.openQueue", "Open queue")}
          locked={!canReadOps}
        />
        <MetricCard
          title={l("Cash Awaiting Receipt", "Teslim Alinacak Kasa Transiti")}
          value={formatCount(cashTransitIncomingWaitingCount)}
          subtitle={
            cashTransitIncomingWaitingCount > 0 || cashTransitPendingDispatchCount > 0
              ? l(
                  "{{waiting}} inbound transfers are waiting receipt. {{pending}} are still pending dispatch. Oldest wait: {{hours}}h.",
                  "{{waiting}} gelen transfer teslim almayi bekliyor. {{pending}} transfer hala sevk bekliyor. En eski bekleme: {{hours}} sa.",
                  {
                    waiting: formatCount(cashTransitIncomingWaitingCount),
                    pending: formatCount(cashTransitPendingDispatchCount),
                    hours: formatCount(cashTransitOldestWaitingHours),
                  }
                )
              : l(
                  "No inbound cash transit transfer is currently waiting receipt.",
                  "Teslim almayi bekleyen gelen kasa transit transferi yok."
                )
          }
          to="/app/kasa-transit-transferleri"
          ctaLabel={l("Open queue", "Kuyrugu ac")}
          locked={!canReadCash}
        />
        <MetricCard
          title={t("dashboard.cards.exceptions", "Exceptions")}
          value={formatCount(openExceptionsCount)}
          subtitle={t(
            "dashboard.cards.exceptionsHint",
            "Open, in-review, and assigned exception workload."
          )}
          to="/app/ayarlar/exception-workbench"
          ctaLabel={t("dashboard.openQueue", "Open queue")}
          locked={!canReadExceptions}
        />
        <MetricCard
          title={t("dashboard.cards.periodCloseBlockers", "Close & Readiness Blockers")}
          value={formatCount(periodCloseBlockerCount)}
          subtitle={t(
            "dashboard.cards.periodCloseBlockersHint",
            "Failed close checks plus open tenant/module readiness blockers."
          )}
          to="/app/payroll-close-controls"
          ctaLabel={t("dashboard.openQueue", "Open queue")}
          locked={!canReadOps && !canReadReadiness}
        />
        <MetricCard
          title={t("dashboard.cards.fixedAssetPendingActivation", "FA Pending Activation")}
          value={formatCount(fixedAssetPendingActivationCount)}
          subtitle={
            fixedAssetPendingActivationCount > 0
              ? t(
                  "dashboard.cards.fixedAssetPendingActivationHint",
                  "{{assetCount}} draft assets are waiting activation. Oldest acquisition date: {{date}}.",
                  {
                    assetCount: formatCount(fixedAssetPendingActivationCount),
                    date: fixedAssetPendingActivationOldestDate || "-",
                  }
                )
              : t(
                  "dashboard.cards.fixedAssetPendingActivationClear",
                  "No draft assets are currently waiting activation."
                )
          }
          to="/app/demirbas-alim-islemleri"
          ctaLabel={t("dashboard.openQueue", "Open queue")}
          locked={!canReadOps || !canReadFixedAssetRuns}
        />
        <MetricCard
          title={t("dashboard.cards.fixedAssetLateCatchUp", "FA Late Catch-Up Pending")}
          value={formatCount(fixedAssetLateCatchUpCount)}
          subtitle={
            fixedAssetLateCatchUpCount > 0
              ? t(
                  "dashboard.cards.fixedAssetLateCatchUpHint",
                  "{{assetCount}} assets were entered after already-posted depreciation periods. Oldest pending period: {{period}}.",
                  {
                    assetCount: formatCount(fixedAssetLateCatchUpCount),
                    period: fixedAssetLateCatchUpPeriodHint || "-",
                  }
                )
              : t(
                  "dashboard.cards.fixedAssetLateCatchUpClear",
                  "No assets are currently waiting late catch-up depreciation review."
                )
          }
          to="/app/demirbas-ops-dashboard"
          ctaLabel={t("dashboard.openDashboard", "Open dashboard")}
          locked={!canReadOps || !canReadFixedAssetRuns}
        />
        <MetricCard
          title={t("dashboard.cards.fixedAssetSkippedMonths", "FA Skipped Runs")}
          value={formatCount(fixedAssetSkippedAttentionAssetCount)}
          subtitle={
            fixedAssetSkippedAttentionAssetCount > 0
              ? t(
                  "dashboard.cards.fixedAssetSkippedMonthsHint",
                  "{{assetCount}} active assets still need skipped-run depreciation review across {{runCount}} skipped runs. Oldest period: {{period}}.",
                  {
                    assetCount: formatCount(fixedAssetSkippedAttentionAssetCount),
                    runCount: formatCount(fixedAssetSkippedAttentionRunCount),
                    period: fixedAssetSkippedAttentionPeriodHint || "-",
                  }
                )
              : t(
                  "dashboard.cards.fixedAssetSkippedMonthsClear",
                  "No active assets currently need skipped-run depreciation review."
                )
          }
          to="/app/demirbas-ops-dashboard"
          ctaLabel={t("dashboard.openDashboard", "Open dashboard")}
          locked={!canReadOps || !canReadFixedAssetRuns}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">
              {t("dashboard.consolidationReadiness", "Consolidation Readiness")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t(
                "dashboard.consolidationReadinessHint",
                "Latest run publish state, surfaced blockers, member close-chain lock progress, and REVREC continuity follow-up in one summary."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={consolidationReportsLink}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("dashboard.consolidationReadiness.openRun", "Open consolidation")}
            </Link>
            <Link
              to={localCloseWorkspaceLink}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("dashboard.consolidationReadiness.openLocalClose", "Open local close")}
            </Link>
            <Link
              to={yearEndRevrecLink}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("dashboard.consolidationReadiness.openYearEnd", "Open year-end REVREC")}
            </Link>
          </div>
        </div>
        {!canReadConsolidationRuns ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t("dashboard.permissionRequired", "Permission required")}
          </div>
        ) : null}
        {consolidationReadiness.error ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {consolidationReadiness.error}
          </div>
        ) : null}
        {canReadConsolidationRuns && consolidationReadiness.loading ? (
          <p className="mt-3 text-sm text-slate-600">
            {t(
              "dashboard.consolidationReadiness.loading",
              "Refreshing consolidation readiness summary..."
            )}
          </p>
        ) : null}
        {canReadConsolidationRuns && !consolidationRun && !consolidationReadiness.loading ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {t(
              "dashboard.consolidationReadiness.noRun",
              "No consolidation runs are available yet for this tenant."
            )}
          </div>
        ) : null}
        {consolidationRun ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getConsolidationPublishTone(
                  consolidationReviewGate?.publishState || consolidationRun?.status
                )}`}
              >
                {consolidationPublishStateLabel}
              </span>
              <span className="text-sm text-slate-600">
                {consolidationRun.run_name
                  ? `${consolidationRun.run_name} | `
                  : ""}
                {formatConsolidationRunScope(consolidationRun)}
              </span>
              <span className="text-xs text-slate-500">
                {consolidationSelectionLabel}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ReadinessSummaryCard
                title={t("dashboard.consolidationReadiness.runStatus", "Run Status")}
                value={consolidationPublishStateLabel}
                subtitle={t(
                  "dashboard.consolidationReadiness.runStatusHint",
                  "Surfaced publish state from the live consolidation review gate."
                )}
                tone={
                  String(consolidationReviewGate?.publishState || consolidationRun?.status)
                    .trim()
                    .toUpperCase() === "READY_TO_PUBLISH"
                    ? "emerald"
                    : String(consolidationReviewGate?.publishState || consolidationRun?.status)
                          .trim()
                          .toUpperCase() === "LOCKED"
                      ? "cyan"
                      : "rose"
                }
              />
              <ReadinessSummaryCard
                title={t("dashboard.consolidationReadiness.blockers", "Blockers")}
                value={formatCount(consolidationBlockerCount)}
                subtitle={t(
                  "dashboard.consolidationReadiness.blockersHint",
                  "Open review-gate blockers before the run can finalize or publish."
                )}
                tone={consolidationBlockerCount > 0 ? "rose" : "emerald"}
              />
              <ReadinessSummaryCard
                title={t("dashboard.consolidationReadiness.localClose", "Local Close Locked / Pending")}
                value={
                  consolidationLocalClose?.available
                    ? `${formatCount(consolidationLocalClose.lockedPackCount)} / ${formatCount(
                        consolidationLocalClose.pendingPackCount
                      )}`
                    : "-"
                }
                subtitle={
                  consolidationLocalClose?.available
                    ? t(
                        "dashboard.consolidationReadiness.localCloseHint",
                        "{{locked}} locked scopes across {{packs}} member packs. Pending includes missing or non-locked mandatory scopes.",
                        {
                          locked: formatCount(consolidationLocalClose.lockedPackCount),
                          packs: formatCount(consolidationLocalClose.packCount),
                        }
                      )
                    : t(
                        "dashboard.consolidationReadiness.localCloseMissing",
                        "Requires consolidation.group.read and ouclose.read to summarize member close-chain progress."
                      )
                }
                tone={
                  consolidationLocalClose?.available &&
                  Number(consolidationLocalClose.pendingPackCount || 0) === 0
                    ? "emerald"
                    : "rose"
                }
                locked={!consolidationLocalClose?.available}
              />
              <ReadinessSummaryCard
                title={t(
                  "dashboard.consolidationReadiness.revrecFailures",
                  "REVREC Continuity Failures"
                )}
                value={
                  consolidationLocalClose?.available
                    ? formatCount(consolidationLocalClose.revrecFailureCount)
                    : "-"
                }
                subtitle={
                  consolidationLocalClose?.available
                    ? t(
                        "dashboard.consolidationReadiness.revrecFailuresHint",
                        "Central pack review-gate blockers from closing-to-next-opening REVREC continuity."
                      )
                    : t(
                        "dashboard.consolidationReadiness.revrecMissing",
                        "Uses the existing local-close review seam; unavailable without member pack visibility."
                      )
                }
                tone={
                  consolidationLocalClose?.available &&
                  Number(consolidationLocalClose.revrecFailureCount || 0) === 0
                    ? "emerald"
                    : "rose"
                }
                locked={!consolidationLocalClose?.available}
              />
            </div>
            {consolidationLocalClose?.available ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>
                  {t("dashboard.consolidationReadiness.memberCount", "Members")}:{" "}
                  {formatCount(consolidationLocalClose.memberCount)}
                </span>
                <span>
                  {t("dashboard.consolidationReadiness.centralPacks", "Central packs")}:{" "}
                  {formatCount(consolidationLocalClose.centralPackCount)}
                </span>
                {consolidationLocalClose.partialRevrecCoverage ? (
                  <span className="text-amber-700">
                    {t(
                      "dashboard.consolidationReadiness.partialCoverage",
                      "Some central pack review details could not be read, so REVREC counts may be partial."
                    )}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">
              {t("dashboard.inventoryWorkQueue", "Inventory Work Queue")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t(
                "dashboard.inventoryWorkQueueHint",
                "Ready queue work, blocked or cleanup-required rows, and transfer execution follow-up."
              )}
            </p>
          </div>
          {canReadInventory ? (
            <Link
              to={inventoryQueueLinks.materialization}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("dashboard.openQueue", "Open queue")}
            </Link>
          ) : null}
        </div>
        {!canReadInventory ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t("dashboard.permissionRequired", "Permission required")}
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <MetricCard
                title={t("dashboard.inventory.receiptQueue", "Ready Receipts")}
                value={formatCount(
                  snapshot.inventoryWorkQueue?.stockLinks?.ready_receipt_materialization || 0
                )}
                subtitle={t(
                  "dashboard.inventory.receiptQueueHint",
                  "Receipt-side queue rows that can materialize immediately."
                )}
                to={inventoryQueueLinks.receiptMaterialization}
                ctaLabel={t("dashboard.openQueue", "Open queue")}
              />
              <MetricCard
                title={t("dashboard.inventory.issueQueue", "Ready Issues")}
                value={formatCount(
                  snapshot.inventoryWorkQueue?.stockLinks?.ready_issue_materialization || 0
                )}
                subtitle={t(
                  "dashboard.inventory.issueQueueHint",
                  "Issue-side queue rows that can materialize immediately."
                )}
                to={inventoryQueueLinks.issueMaterialization}
                ctaLabel={t("dashboard.openQueue", "Open queue")}
              />
              <MetricCard
                title={t("dashboard.inventory.attentionRequired", "Attention Required")}
                value={formatCount(
                  (snapshot.inventoryWorkQueue?.stockLinks?.blocked_total || 0) +
                    (snapshot.inventoryWorkQueue?.stockLinks?.repair_required_total || 0) +
                    (snapshot.inventoryWorkQueue?.stockLinks?.transfer_required_total || 0)
                )}
                subtitle={t(
                  "dashboard.inventory.attentionRequiredHint",
                  "Blocked, cleanup-required, or transfer-required stock-link rows."
                )}
                to={inventoryQueueLinks.materialization}
                ctaLabel={t("dashboard.openQueue", "Open queue")}
              />
              <MetricCard
                title={t("dashboard.inventory.waitingApproval", "Waiting Approval")}
                value={formatCount(
                  snapshot.inventoryWorkQueue?.transfers?.waiting_approval || 0
                )}
                subtitle={t(
                  "dashboard.inventory.waitingApprovalHint",
                  "Transfers initiated but not approved yet."
                )}
                to={inventoryQueueLinks.waitingApproval}
                ctaLabel={t("dashboard.openQueue", "Open queue")}
              />
              <MetricCard
                title={t("dashboard.inventory.readyToShip", "Ready To Ship")}
                value={formatCount(snapshot.inventoryWorkQueue?.transfers?.ready_to_ship || 0)}
                subtitle={t(
                  "dashboard.inventory.readyToShipHint",
                  "Approved transfers waiting shipment posting."
                )}
                to={inventoryQueueLinks.readyToShip}
                ctaLabel={t("dashboard.openQueue", "Open queue")}
              />
              <MetricCard
                title={t("dashboard.inventory.waitingReceipt", "Waiting Receipt")}
                value={formatCount(
                  snapshot.inventoryWorkQueue?.transfers?.in_transit_waiting_receipt || 0
                )}
                subtitle={t(
                  "dashboard.inventory.waitingReceiptHint",
                  "Transfers already shipped and waiting target receipt."
                )}
                to={inventoryQueueLinks.waitingReceipt}
                ctaLabel={t("dashboard.openQueue", "Open queue")}
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {t("dashboard.inventory.completedHistory", "Completed History")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCount(snapshot.inventoryWorkQueue?.stockLinks?.completed_total || 0)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "dashboard.inventory.completedHistoryHint",
                    "Stock links already materialized and visible through explicit history scope."
                  )}
                </p>
                <Link
                  to={inventoryQueueLinks.completedMaterialization}
                  className="mt-2 inline-flex text-xs font-semibold text-slate-700 hover:text-slate-900"
                >
                  {t("dashboard.openQueue", "Open queue")}
                </Link>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {t("dashboard.inventory.voidHistory", "Void History")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCount(snapshot.inventoryWorkQueue?.stockLinks?.void_total || 0)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "dashboard.inventory.voidHistoryHint",
                    "Stock links closed out as void and visible through explicit history scope."
                  )}
                </p>
                <Link
                  to={inventoryQueueLinks.voidMaterialization}
                  className="mt-2 inline-flex text-xs font-semibold text-slate-700 hover:text-slate-900"
                >
                  {t("dashboard.openQueue", "Open queue")}
                </Link>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {t("dashboard.inventory.reopenedPending", "Reopened Pending")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCount(snapshot.inventoryWorkQueue?.stockLinks?.reopened_pending || 0)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "dashboard.inventory.reopenedPendingHint",
                    "Successor stock links reopened after reversal and still waiting action."
                  )}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {t("dashboard.inventory.staleMaterialization", "Stale Materialization")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCount(snapshot.inventoryWorkQueue?.stockLinks?.stale_pending_gt_2d || 0)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "dashboard.inventory.staleMaterializationHint",
                    "Pending stock links older than two days."
                  )}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {t("dashboard.inventory.crossContextTransit", "Cross-Context Transit")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCount(
                    snapshot.inventoryWorkQueue?.transfers?.cross_context_in_transit || 0
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "dashboard.inventory.crossContextTransitHint",
                    "In-transit transfers moving between different contexts."
                  )}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {t("dashboard.inventory.oldestTransit", "Oldest Transit")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatCount(
                    snapshot.inventoryWorkQueue?.transfers?.oldest_in_transit_days || 0
                  )}
                  <span className="ml-1 text-sm font-medium text-slate-500">
                    {t("dashboard.days", "days")}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t(
                    "dashboard.inventory.oldestTransitHint",
                    "Longest-running transfer still waiting receipt."
                  )}
                </p>
              </article>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">
          {t("dashboard.recentActivity", "Recent Activity Links")}
        </h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((link) =>
            link.enabled ? (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 hover:border-cyan-300 hover:bg-cyan-50/30"
              >
                <p className="text-sm font-semibold text-slate-900">{link.title}</p>
                <p className="mt-1 text-xs text-slate-600">{link.hint}</p>
              </Link>
            ) : (
              <article
                key={link.to}
                className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2"
              >
                <p className="text-sm font-semibold text-amber-900">{link.title}</p>
                <p className="mt-1 text-xs text-amber-800">
                  {t("dashboard.permissionRequired", "Permission required")}
                </p>
              </article>
            )
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">
            {t("dashboard.notifications.title", "Mentions & Notifications")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">
              {t("dashboard.notifications.unreadCount", "Unread")}:{" "}
              {formatCount(notificationsTotal)}
            </span>
            <button
              type="button"
              onClick={loadNotifications}
              disabled={notificationsLoading}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {notificationsLoading
                ? t("dashboard.notifications.refreshing", "Refreshing...")
                : t("dashboard.notifications.refresh", "Refresh")}
            </button>
            <button
              type="button"
              onClick={handleMarkAllNotificationsRead}
              disabled={markAllNotificationsSaving || notificationRows.length === 0}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {markAllNotificationsSaving
                ? t("dashboard.notifications.markingAll", "Marking...")
                : t("dashboard.notifications.markAllRead", "Mark all read")}
            </button>
          </div>
        </div>
        {notificationsError ? (
          <p className="mt-2 text-sm text-amber-700">{notificationsError}</p>
        ) : null}
        {notificationsLoading ? (
          <p className="mt-2 text-sm text-slate-600">
            {t("dashboard.notifications.loading", "Loading notifications...")}
          </p>
        ) : null}
        {!notificationsLoading && notificationRows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            {t("dashboard.notifications.empty", "No unread notifications.")}
          </p>
        ) : null}
        {!notificationsLoading && notificationRows.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {notificationRows.map((row, index) => {
              const targetPath = buildNotificationTargetPath(row);
              const isMarking =
                Number(markingNotificationId || 0) === Number(row?.id || 0);
              const isEscalatedApproval = isEscalatedApprovalNotification(row);
              return (
                <li
                  key={`dashboard-notification-${row?.id || index}`}
                  className={`rounded-lg border px-3 py-2 ${
                    isEscalatedApproval
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {row?.title || t("dashboard.notifications.defaultTitle", "Notification")}
                    </p>
                    {isEscalatedApproval ? (
                      <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                        {t("dashboard.notifications.escalatedApproval", "Escalated approval")}
                      </span>
                    ) : null}
                  </div>
                  {row?.body ? (
                    <p className="mt-1 text-xs text-slate-700">{row.body}</p>
                  ) : null}
                  {isEscalatedApproval ? (
                    <p className="mt-1 text-xs font-medium text-amber-900">
                      {t(
                        "dashboard.notifications.escalatedApprovalHint",
                        "Still reviewable in the normal pending queue."
                      )}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTimeLabel(row?.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {targetPath ? (
                      <Link
                        to={targetPath}
                        className="rounded-md border border-cyan-300 bg-white px-2 py-1 text-xs font-semibold text-cyan-700"
                      >
                        {isEscalatedApproval
                          ? t("dashboard.notifications.openQueue", "Open queue")
                          : t("dashboard.notifications.openTarget", "Open")}
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleMarkNotificationRead(row?.id)}
                      disabled={isMarking}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      {isMarking
                        ? t("dashboard.notifications.marking", "Marking...")
                        : t("dashboard.notifications.markRead", "Mark read")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">
          {t("dashboard.readiness", "Readiness")}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              {t("dashboard.readinessTenantMissing", "Tenant Missing Checks")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatCount(Array.isArray(missingChecks) ? missingChecks.length : 0)}
            </p>
          </article>
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              {t("dashboard.readinessModuleBlockers", "Module Blockers")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatCount(moduleBlockerCount)}
            </p>
          </article>
          <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              {t("dashboard.readinessMonitoredRows", "Monitored Rows")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatCount(moduleReadinessRows.length)}
            </p>
          </article>
        </div>
        {moduleReadinessLoading || tenantReadinessLoading ? (
          <p className="mt-3 text-sm text-slate-600">
            {t("dashboard.readinessLoading", "Refreshing readiness data...")}
          </p>
        ) : null}
        {readinessInlineError ? (
          <p className="mt-3 text-sm text-amber-700">{readinessInlineError}</p>
        ) : null}
      </section>
    </section>
  );
}
