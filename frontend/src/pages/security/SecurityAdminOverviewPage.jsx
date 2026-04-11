import { useEffect, useMemo, useState } from "react";
import {
  getOperationalCoverageWorkspace,
  listApprovalDelegations,
} from "../../api/approvalDelegations.js";
import {
  listAuditLogs,
  listRoleAssignments,
  listUsers,
} from "../../api/rbacAdmin.js";
import {
  listWorkflowAssignments,
  listWorkflowDefinitions,
} from "../../api/workflows.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import {
  SecurityWorkbenchLoadingState,
  SecurityWorkbenchNoticeState,
} from "./components/SecurityWorkbenchStates.jsx";
import { buildSecurityAdminOverviewSummary } from "./securityAdminOverviewSummary.js";

function getSignalToneClasses(tone) {
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50";
  }
  if (tone === "rose") {
    return "border-rose-200 bg-rose-50";
  }
  if (tone === "sky") {
    return "border-sky-200 bg-sky-50";
  }
  return "border-slate-200 bg-slate-50";
}

function formatMetricValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return new Intl.NumberFormat().format(value);
}

function hasTenantWidePermission(entitlements, permissionCode) {
  const normalizedCode = String(permissionCode || "").trim();
  if (!normalizedCode) {
    return false;
  }

  const permissionRows = Array.isArray(entitlements?.permissions)
    ? entitlements.permissions
    : [];

  return permissionRows.some(
    (row) =>
      String(row?.code || "").trim() === normalizedCode &&
      String(row?.scopeType || "").trim().toUpperCase() === "TENANT"
  );
}

function SignalCard({ signal }) {
  return (
    <article
      className={`rounded-[28px] border px-5 py-5 shadow-sm ${getSignalToneClasses(
        signal?.tone
      )}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {signal?.title}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{signal?.description}</p>
    </article>
  );
}

/**
 * Canonical landing page for the new security-admin route family. It reuses
 * current APIs to show operational signals before the deeper workbench
 * refactors land in later redesign PRs.
 */
export default function SecurityAdminOverviewPage() {
  const { entitlements, hasAnyPermission, hasPermission } = useAuth();
  const { l, language } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [partialNotes, setPartialNotes] = useState([]);
  const [overviewData, setOverviewData] = useState({
    users: null,
    assignments: null,
    delegations: null,
    coverageRows: null,
    workflowDefinitions: null,
    workflowAssignments: null,
    auditRows: null,
  });

  const canReadAssignments = hasPermission("security.role_assignment.read");
  const canReadWorkflowDefinitions = hasPermission("workflow.definition.read");
  const canReadWorkflowAssignments = hasPermission("workflow.assignment.read");
  const canReadAudit = hasPermission("security.audit.read");
  const canReadCoverage = hasAnyPermission([
    "security.operational_coverage.read",
    "security.operational_coverage.request",
    "security.operational_coverage.review",
    "security.operational_coverage.revoke",
  ]);
  const canReadDelegations = hasPermission("approvals.policies.read");
  const canReadTenantWideDelegations =
    canReadDelegations &&
    hasTenantWidePermission(entitlements, "approvals.policies.read");

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      setLoadError("");
      setPartialNotes([]);

      const requestEntries = [
        canReadAssignments
          ? {
              key: "users",
              run: () => listUsers(),
              select: (response) =>
                (Array.isArray(response?.rows) ? response.rows : []),
              note: l(
                "User summary data is not available right now.",
                "Kullanici ozet verisi su anda kullanilamiyor."
              ),
            }
          : null,
        canReadAssignments
          ? {
              key: "assignments",
              run: () => listRoleAssignments(),
              select: (response) =>
                (Array.isArray(response?.rows) ? response.rows : []),
              note: l(
                "Role assignment summary data is not available right now.",
                "Rol atama ozet verisi su anda kullanilamiyor."
              ),
            }
          : null,
        canReadTenantWideDelegations
          ? {
              key: "delegations",
              run: () => listApprovalDelegations(),
              select: (response) =>
                (Array.isArray(response?.rows) ? response.rows : []),
              note: l(
                "Delegation summary data is not available right now.",
                "Delegasyon ozet verisi su anda kullanilamiyor."
              ),
            }
          : null,
        canReadCoverage
          ? {
              key: "coverageRows",
              run: () => getOperationalCoverageWorkspace(),
              select: (response) =>
                (Array.isArray(response?.rows) ? response.rows : []),
              note: l(
                "Temporary coverage summary data is not available right now.",
                "Gecici kapsama ozet verisi su anda kullanilamiyor."
              ),
            }
          : null,
        canReadWorkflowDefinitions
          ? {
              key: "workflowDefinitions",
              run: () => listWorkflowDefinitions({ limit: 200 }),
              select: (response) =>
                (Array.isArray(response?.rows) ? response.rows : []),
              note: l(
                "Workflow definition summary data is not available right now.",
                "Workflow tanim ozeti su anda kullanilamiyor."
              ),
            }
          : null,
        canReadWorkflowAssignments
          ? {
              key: "workflowAssignments",
              run: () => listWorkflowAssignments({ limit: 200 }),
              select: (response) =>
                (Array.isArray(response?.rows) ? response.rows : []),
              note: l(
                "Workflow assignment summary data is not available right now.",
                "Workflow atama ozeti su anda kullanilamiyor."
              ),
            }
          : null,
        canReadAudit
          ? {
              key: "auditRows",
              run: () => listAuditLogs({ page: 1, pageSize: 5 }),
              select: (response) =>
                (Array.isArray(response?.rows) ? response.rows : []),
              note: l(
                "Recent audit signals are not available right now.",
                "Guncel denetim sinyalleri su anda kullanilamiyor."
              ),
            }
          : null,
      ].filter(Boolean);

      const nextData = {
        users: null,
        assignments: null,
        delegations: null,
        coverageRows: null,
        workflowDefinitions: null,
        workflowAssignments: null,
        auditRows: null,
      };
      const nextNotes = [];

      if (!canReadTenantWideDelegations && canReadDelegations) {
        nextNotes.push(
          l(
            "Delegation counts stay hidden here until a tenant-wide delegation reader is available; scoped delegation reviews still belong in the users workbench.",
            "Delegasyon sayilari burada ancak tenant-geneli delegasyon okuyucusu oldugunda gosterilir; kapsamli delegasyon incelemeleri yine users workbench icinde kalir."
          )
        );
      }

      if (requestEntries.length === 0) {
        if (active) {
          setOverviewData(nextData);
          setPartialNotes(nextNotes);
          setLoading(false);
        }
        return;
      }

      const results = await Promise.allSettled(
        requestEntries.map((entry) => entry.run())
      );

      let successfulLoads = 0;

      results.forEach((result, index) => {
        const entry = requestEntries[index];
        if (result.status === "fulfilled") {
          nextData[entry.key] = entry.select(result.value);
          successfulLoads += 1;
          return;
        }

        nextData[entry.key] = null;
        nextNotes.push(entry.note);
      });

      if (!active) {
        return;
      }

      if (successfulLoads === 0) {
        setLoadError(
          l(
            "Security administration overview could not load any live summary data.",
            "Guvenlik yonetimi genel bakis sayfasi canli ozet verilerini yukleyemedi."
          )
        );
      }

      setOverviewData(nextData);
      setPartialNotes(nextNotes);
      setLoading(false);
    }

    loadOverview();

    return () => {
      active = false;
    };
  }, [
    canReadAssignments,
    canReadAudit,
    canReadCoverage,
    canReadDelegations,
    canReadTenantWideDelegations,
    canReadWorkflowAssignments,
    canReadWorkflowDefinitions,
    l,
  ]);

  const overviewSummary = useMemo(
    () =>
      buildSecurityAdminOverviewSummary({
        assignments: overviewData.assignments,
        auditRows: overviewData.auditRows,
        coverageRows: overviewData.coverageRows,
        delegations: overviewData.delegations,
        l,
        language,
        users: overviewData.users,
        workflowAssignments: overviewData.workflowAssignments,
        workflowDefinitions: overviewData.workflowDefinitions,
      }),
    [language, l, overviewData]
  );

  const stats = useMemo(() => {
    const nextStats = [];
    const { metrics } = overviewSummary;

    if (metrics.activeUsers !== null) {
      nextStats.push({
        title: l("Active users", "Aktif kullanicilar"),
        value: formatMetricValue(metrics.activeUsers),
        description: l(
          "People currently active in the security-admin snapshot.",
          "Guvenlik yonetimi gorunumunde su anda aktif olan kisiler."
        ),
        tone: "blue",
      });
    }
    if (metrics.directAssignments !== null) {
      nextStats.push({
        title: l("Direct assignments", "Dogrudan atamalar"),
        value: formatMetricValue(metrics.directAssignments),
        description: l(
          "Runtime roles granted directly, excluding workflow packages and business labels.",
          "Workflow paketleri ve is rolu etiketleri disindaki dogrudan runtime rol atamalari."
        ),
        tone: "green",
      });
    }
    if (metrics.workflowPackageAssignments !== null) {
      nextStats.push({
        title: l("Workflow package assignments", "Workflow paket atamalari"),
        value: formatMetricValue(metrics.workflowPackageAssignments),
        description: l(
          "Current managed package grants coming from the fresh workflow package flow.",
          "Fresh workflow package akisindan gelen mevcut yonetilen paket atamalari."
        ),
        tone: "violet",
      });
    }
    if (metrics.activeDelegations !== null) {
      nextStats.push({
        title: l("Delegations", "Delegasyonlar"),
        value: formatMetricValue(metrics.activeDelegations),
        description: l(
          "Active or upcoming approval delegations visible in this overview.",
          "Bu genel bakista gorunen aktif veya yaklasan onay delegasyonlari."
        ),
        tone: "amber",
      });
    }
    if (metrics.openCoverageRows !== null) {
      nextStats.push({
        title: l("Temporary coverage", "Gecici kapsama"),
        value: formatMetricValue(metrics.openCoverageRows),
        description: l(
          "Open temporary operational coverage requests or active windows.",
          "Acik gecici operasyonel kapsama talepleri veya aktif pencereler."
        ),
        tone: "blue",
      });
    }
    if (
      metrics.workflowDefinitions !== null ||
      metrics.workflowAssignments !== null
    ) {
      nextStats.push({
        title: l("Workflow governance", "Workflow governance"),
        value: l(
          "{{definitions}} / {{assignments}}",
          "{{definitions}} / {{assignments}}",
          {
            definitions:
              metrics.workflowDefinitions === null
                ? "-"
                : formatMetricValue(metrics.workflowDefinitions),
            assignments:
              metrics.workflowAssignments === null
                ? "-"
                : formatMetricValue(metrics.workflowAssignments),
          }
        ),
        description: l(
          "Definitions versus assignments visible in the workflow workbench.",
          "Workflow workbench icinde gorunen tanim ve atama dengesi."
        ),
      });
    }

    return nextStats;
  }, [l, overviewSummary]);

  return (
    <SecurityAdminWorkspaceShell
      eyebrow={l("Security Administration", "Kullanici ve erisim yonetimi")}
      title={l("User management", "Kullanici yonetimi")}
      description={l(
        "Use the sidebar to open users, roles, workflow governance, and audit pages. This landing page keeps only the live summary signals.",
        "Kullanicilar, roller, workflow governance ve denetim sayfalarini acmak icin kenar cubugunu kullanin. Bu acilis sayfasi yalnizca canli ozet sinyallerini tutar."
      )}
      stats={stats}
      showWorkbenchNavigation={false}
    >
      {loading ? (
        <SecurityWorkbenchLoadingState
          title={l("Overview signals", "Genel bakis sinyalleri")}
          description={l(
            "Loading live security administration signals...",
            "Canli guvenlik yonetimi sinyalleri yukleniyor..."
          )}
        />
      ) : null}

      {!loading && loadError ? (
        <SecurityWorkbenchNoticeState
          title={l("Overview load failed", "Genel bakis yuklenemedi")}
          description={loadError}
          tone="danger"
        />
      ) : null}

      {!loading && partialNotes.length > 0 ? (
        <SecurityWorkbenchNoticeState
          title={l(
            "Some overview signals are intentionally partial.",
            "Bazi genel bakis sinyalleri bilerek kisitli tutuldu."
          )}
          tone="warning"
        >
          <div className="space-y-2">
            {partialNotes.map((note, index) => (
              <p key={`${note}:${index}`}>{note}</p>
            ))}
          </div>
        </SecurityWorkbenchNoticeState>
      ) : null}

      {!loading && overviewSummary.signals.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {l("Operational signals", "Operasyonel sinyaller")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Review the highest-signal warnings and recent evidence before opening a workbench.",
                "Bir workbench acmadan once en yuksek onemli uyari ve guncel kanitlari inceleyin."
              )}
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {overviewSummary.signals.map((signal) => (
              <SignalCard key={signal.key} signal={signal} />
            ))}
          </div>
        </section>
      ) : null}

      {!loading && stats.length === 0 ? (
        <SecurityWorkbenchNoticeState
          title={l("Limited overview metrics", "Sinirli genel bakis metrikleri")}
          description={l(
            "Your current access can open the security-admin area, but live overview counts only appear for the domains you can read directly. Use the sidebar for the domains already in scope.",
            "Mevcut yetkiniz guvenlik yonetimi alanini acabilir, ancak canli genel bakis sayilari yalnizca dogrudan okuyabildiginiz alanlarda gosterilir. Halihazirda kapsaminizda olan alanlar icin kenar cubugunu kullanin."
          )}
        />
      ) : null}
    </SecurityAdminWorkspaceShell>
  );
}
