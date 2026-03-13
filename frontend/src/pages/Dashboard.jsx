import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getOpsBankPaymentBatchesHealth,
  getOpsBankReconciliationSummary,
  getOpsJobsHealth,
  getOpsPayrollCloseStatus,
  getOpsPayrollImportHealth,
} from "../api/opsDashboard.js";
import { getInventoryWorkQueueSummary } from "../api/inventory.js";
import { listExceptionWorkbench } from "../api/exceptionsWorkbench.js";
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

function buildNotificationTargetPath(row) {
  const sourceRefType = String(row?.sourceRefType || "")
    .trim()
    .toUpperCase();
  const sourceRefId = Number(row?.sourceRefId || 0);
  if (!Number.isInteger(sourceRefId) || sourceRefId <= 0) {
    return "";
  }

  if (sourceRefType === "CARI_DOCUMENT") {
    return `/app/cari-belgeler?documentId=${sourceRefId}`;
  }
  return "";
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

export default function Dashboard() {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
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
  const canReadExceptions = hasPermission("ops.exceptions.read");
  const canReadReadiness = hasPermission("org.tree.read");
  const canReadInventory = hasPermission("inventory.read");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [snapshot, setSnapshot] = useState({
    bankReconciliation: null,
    bankPayments: null,
    payrollImports: null,
    payrollClose: null,
    jobs: null,
    exceptions: null,
    inventoryWorkQueue: null,
  });
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationRows, setNotificationRows] = useState([]);
  const [notificationsTotal, setNotificationsTotal] = useState(0);
  const [markingNotificationId, setMarkingNotificationId] = useState(null);
  const [markAllNotificationsSaving, setMarkAllNotificationsSaving] = useState(false);

  const scopeParams = useMemo(
    () => resolveScopeParams(workingContext),
    [workingContext]
  );
  const inventoryScopeParams = useMemo(() => {
    const params = {};
    if (scopeParams.legalEntityId) {
      params.legalEntityId = scopeParams.legalEntityId;
    }
    return params;
  }, [scopeParams.legalEntityId]);

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
        payrollImports: null,
        payrollClose: null,
        jobs: null,
        exceptions: null,
        inventoryWorkQueue: null,
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
        payrollImports: null,
        payrollClose: null,
        jobs: null,
        exceptions: null,
        inventoryWorkQueue: null,
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
  }, [canReadExceptions, canReadInventory, canReadOps, inventoryScopeParams, scopeParams, t]);

  useEffect(() => {
    load();
  }, [load]);

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

  const periodCloseBlockerCount = useMemo(() => {
    const payrollFailedChecks = toInt(
      snapshot.payrollClose?.checks?.failed_checks_open_periods,
      0
    );
    const tenantMissing = Array.isArray(missingChecks) ? missingChecks.length : 0;
    return payrollFailedChecks + tenantMissing + moduleBlockerCount;
  }, [missingChecks, moduleBlockerCount, snapshot.payrollClose]);

  const inventoryQueueLinks = useMemo(() => {
    const legalEntityId = inventoryScopeParams.legalEntityId || "";
    return {
      receiptMaterialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
        stockImpactMode: "RECEIPT_PENDING",
      }),
      issueMaterialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
        stockImpactMode: "ISSUE_PENDING",
      }),
      waitingApproval: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
        status: "INITIATED",
      }),
      readyToShip: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
        status: "APPROVED",
      }),
      waitingReceipt: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
        status: "IN_TRANSIT",
      }),
      transfers: buildAppPath("/app/stok-transferleri", {
        legalEntityId,
      }),
      materialization: buildAppPath("/app/stok-yansitma-islemleri", {
        legalEntityId,
      }),
    };
  }, [inventoryScopeParams.legalEntityId]);

  const windowLabel = useMemo(() => {
    const firstWindow =
      snapshot.bankReconciliation?.window ||
      snapshot.bankPayments?.window ||
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
    [canReadExceptions, canReadInventory, canReadOps, inventoryQueueLinks, openExceptionsCount, snapshot, t]
  );

  const readinessInlineError = moduleReadinessError || tenantReadinessError || "";

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
              onClick={load}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
          title={t("dashboard.cards.periodCloseBlockers", "Period Close Blockers")}
          value={formatCount(periodCloseBlockerCount)}
          subtitle={t(
            "dashboard.cards.periodCloseBlockersHint",
            "Failed close checks plus tenant/module readiness blockers."
          )}
          to="/app/payroll-close-controls"
          ctaLabel={t("dashboard.openQueue", "Open queue")}
          locked={!canReadOps && !canReadReadiness}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">
              {t("dashboard.inventoryWorkQueue", "Inventory Work Queue")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t(
                "dashboard.inventoryWorkQueueHint",
                "Pending materialization, transfer prep, transit, and receipt actions."
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
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                title={t("dashboard.inventory.receiptQueue", "Receipt Queue")}
                value={formatCount(
                  snapshot.inventoryWorkQueue?.stockLinks?.pending_receipt_materialization || 0
                )}
                subtitle={t(
                  "dashboard.inventory.receiptQueueHint",
                  "AP stock lines waiting warehouse receipt materialization."
                )}
                to={inventoryQueueLinks.receiptMaterialization}
                ctaLabel={t("dashboard.openQueue", "Open queue")}
              />
              <MetricCard
                title={t("dashboard.inventory.issueQueue", "Issue Queue")}
                value={formatCount(
                  snapshot.inventoryWorkQueue?.stockLinks?.pending_issue_materialization || 0
                )}
                subtitle={t(
                  "dashboard.inventory.issueQueueHint",
                  "AR stock lines waiting warehouse issue materialization."
                )}
                to={inventoryQueueLinks.issueMaterialization}
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

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
              return (
                <li
                  key={`dashboard-notification-${row?.id || index}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {row?.title || t("dashboard.notifications.defaultTitle", "Notification")}
                  </p>
                  {row?.body ? (
                    <p className="mt-1 text-xs text-slate-700">{row.body}</p>
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
                        {t("dashboard.notifications.openTarget", "Open")}
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
