import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listRoleAssignments, listUsers } from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import {
  getRoleCatalogEntry,
  listLegacyRoleCatalogEntries,
} from "./roleCatalog.js";

const FILTER_ALL = "ALL";

function toCount(value) {
  return Number(value || 0);
}

function getReadinessStatus(usageCount, hasReplacement) {
  if (usageCount === 0 && hasReplacement) {
    return "READY";
  }
  if (usageCount === 0 && !hasReplacement) {
    return "REVIEW";
  }
  if (usageCount > 0 && hasReplacement) {
    return "MIGRATE";
  }
  return "BLOCKED";
}

function getReadinessLabel(status) {
  switch (status) {
    case "READY":
      return "Ready to retire";
    case "REVIEW":
      return "Review manually";
    case "MIGRATE":
      return "Migration needed";
    case "BLOCKED":
      return "Blocked";
    default:
      return status;
  }
}

function getReadinessColors(status) {
  switch (status) {
    case "READY":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "REVIEW":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "MIGRATE":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "BLOCKED":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function buildLegacyVisibilityRows(legacyEntries, assignmentRows) {
  const assignmentsByRole = new Map();
  const usersByRole = new Map();
  for (const assignment of assignmentRows) {
    const roleCode =
      assignment.role_code || assignment.roleCode || assignment.role?.code || "";
    if (!roleCode) {
      continue;
    }
    if (!assignmentsByRole.has(roleCode)) {
      assignmentsByRole.set(roleCode, []);
    }
    assignmentsByRole.get(roleCode).push(assignment);

    const userId =
      assignment.user_id || assignment.userId || assignment.user?.id || null;
    if (userId) {
      if (!usersByRole.has(roleCode)) {
        usersByRole.set(roleCode, new Set());
      }
      usersByRole.get(roleCode).add(userId);
    }
  }

  return legacyEntries.map((entry) => {
    const runtimeCode = entry.runtimeCode || entry.technicalCode || entry.code || "";
    const usageSourceCodes = Array.isArray(entry.usageSourceRoleCodes)
      ? entry.usageSourceRoleCodes
      : [runtimeCode].filter(Boolean);

    let assignmentCount = 0;
    let userCount = 0;
    const userSet = new Set();
    for (const sourceCode of usageSourceCodes) {
      assignmentCount += (assignmentsByRole.get(sourceCode) || []).length;
      for (const uid of usersByRole.get(sourceCode) || []) {
        userSet.add(uid);
      }
    }
    userCount = userSet.size;

    const hasReplacement = Boolean(entry.replacementLabel);
    const readinessStatus = getReadinessStatus(assignmentCount, hasReplacement);

    return {
      ...entry,
      runtimeCode,
      usageSourceCodes,
      assignmentCount,
      userCount,
      hasReplacement,
      readinessStatus,
      readinessLabel: getReadinessLabel(readinessStatus),
      readinessColors: getReadinessColors(readinessStatus),
      visibleInNewTenant: entry.visibleInNewTenantLabel === "Yes",
    };
  });
}

function buildWarnings(rows) {
  const warnings = [];
  const blockedRows = rows.filter((r) => r.readinessStatus === "BLOCKED");
  if (blockedRows.length > 0) {
    warnings.push(
      `${blockedRows.length} legacy item(s) have active assignments but no replacement guidance. Manual review required.`
    );
  }
  const migrateRows = rows.filter((r) => r.readinessStatus === "MIGRATE");
  if (migrateRows.length > 0) {
    const totalAssignments = migrateRows.reduce(
      (sum, r) => sum + r.assignmentCount,
      0
    );
    warnings.push(
      `${migrateRows.length} legacy item(s) have ${totalAssignments} active assignment(s) that should be migrated to composable packages.`
    );
  }
  const visibleRows = rows.filter((r) => r.visibleInNewTenant);
  if (visibleRows.length > 0) {
    warnings.push(
      `${visibleRows.length} legacy item(s) are still visible in fresh-tenant pickers. Consider hiding them.`
    );
  }
  return warnings;
}

function MiniStat({ label, value, color }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${color || "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

function ReadinessBadge({ status, label }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getReadinessColors(status)}`}
    >
      {label}
    </span>
  );
}

function PickerVisibilityBadge({ visible }) {
  if (visible) {
    return (
      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
        Visible
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
      Hidden
    </span>
  );
}

function LegacyMigrationTable({ rows, readinessFilter }) {
  const filtered = useMemo(() => {
    if (readinessFilter === FILTER_ALL) {
      return rows;
    }
    return rows.filter((r) => r.readinessStatus === readinessFilter);
  }, [rows, readinessFilter]);

  if (filtered.length === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
        No legacy items match the current filter.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <th className="px-5 py-4">Legacy Role</th>
              <th className="px-5 py-4">Usage</th>
              <th className="px-5 py-4">Suggested Replacement</th>
              <th className="px-5 py-4">Migration Readiness</th>
              <th className="px-5 py-4">Picker Visibility</th>
              <th className="px-5 py-4">Warnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.map((row) => {
              const rowWarnings = [];
              if (row.readinessStatus === "BLOCKED") {
                rowWarnings.push("No replacement guidance available");
              }
              if (row.assignmentCount > 0) {
                rowWarnings.push(
                  `${row.assignmentCount} active assignment(s) on legacy role`
                );
              }
              if (row.visibleInNewTenant) {
                rowWarnings.push("Still visible in fresh-tenant pickers");
              }

              return (
                <tr key={row.code} className="bg-white">
                  <td className="px-5 py-4 align-top">
                    <div className="text-sm font-semibold text-slate-950">
                      {row.runtimeCode}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.displayName}
                    </div>
                    {row.workflowFamilyLabel ? (
                      <div className="mt-1 text-xs text-slate-400">
                        {row.workflowFamilyLabel}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="text-sm font-semibold text-slate-900">
                      {row.assignmentCount} assignment{row.assignmentCount !== 1 ? "s" : ""}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.userCount} user{row.userCount !== 1 ? "s" : ""}
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    {row.replacementLabel ? (
                      <div className="text-sm font-semibold text-slate-900">
                        {row.replacementLabel}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">
                        Review manually
                      </div>
                    )}
                    {row.defaultScope ? (
                      <div className="mt-1">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {row.defaultScope}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 align-top">
                    <ReadinessBadge
                      status={row.readinessStatus}
                      label={row.readinessLabel}
                    />
                  </td>
                  <td className="px-5 py-4 align-top">
                    <PickerVisibilityBadge visible={row.visibleInNewTenant} />
                    <div className="mt-1 text-xs text-slate-500">
                      {row.visibleInNewTenant
                        ? "Should default to hidden for fresh tenants"
                        : "Hidden from fresh-tenant pickers"}
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    {rowWarnings.length === 0 ? (
                      <div className="text-xs text-slate-400">None</div>
                    ) : (
                      <div className="space-y-1">
                        {rowWarnings.map((warning) => (
                          <div
                            key={warning}
                            className="text-xs leading-5 text-amber-700"
                          >
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LegacyMigrationVisibilityPage() {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assignmentRows, setAssignmentRows] = useState([]);
  const [readinessFilter, setReadinessFilter] = useState(FILTER_ALL);

  const legacyEntries = useMemo(() => listLegacyRoleCatalogEntries(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await listRoleAssignments();
        if (!cancelled) {
          setAssignmentRows(response?.rows || response || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              "Could not load role assignments for legacy usage analysis."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => buildLegacyVisibilityRows(legacyEntries, assignmentRows),
    [legacyEntries, assignmentRows]
  );

  const warnings = useMemo(() => buildWarnings(rows), [rows]);

  const summaryStats = useMemo(() => {
    const totalLegacy = rows.length;
    const totalAssignments = rows.reduce((s, r) => s + r.assignmentCount, 0);
    const totalUsers = new Set(
      rows.flatMap((r) => {
        const codes = r.usageSourceCodes || [];
        const matchedAssignments = assignmentRows.filter((a) => {
          const rc = a.role_code || a.roleCode || a.role?.code || "";
          return codes.includes(rc);
        });
        return matchedAssignments
          .map((a) => a.user_id || a.userId || a.user?.id)
          .filter(Boolean);
      })
    ).size;
    const readyCount = rows.filter((r) => r.readinessStatus === "READY").length;
    const migrateCount = rows.filter((r) => r.readinessStatus === "MIGRATE").length;
    const blockedCount = rows.filter((r) => r.readinessStatus === "BLOCKED").length;
    const reviewCount = rows.filter((r) => r.readinessStatus === "REVIEW").length;
    return {
      totalLegacy,
      totalAssignments,
      totalUsers,
      readyCount,
      migrateCount,
      blockedCount,
      reviewCount,
    };
  }, [rows, assignmentRows]);

  const readinessFilterOptions = [
    { value: FILTER_ALL, label: "All" },
    { value: "READY", label: `Ready (${summaryStats.readyCount})` },
    { value: "MIGRATE", label: `Migrate (${summaryStats.migrateCount})` },
    { value: "REVIEW", label: `Review (${summaryStats.reviewCount})` },
    { value: "BLOCKED", label: `Blocked (${summaryStats.blockedCount})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Legacy Migration Visibility
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Monitor how many users and flows still depend on legacy runtime roles.
            Review replacement guidance and migration readiness before retiring
            legacy items from the normal admin experience.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/app/ayarlar/rbac/role-migrations"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Open Migration Workspace
          </Link>
          <Link
            to="/app/ayarlar/rbac/access-model?tab=legacy_catalog"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Legacy Catalog
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <section className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,_rgba(255,251,235,0.96),_rgba(255,255,255,0.98))] px-5 py-5">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
              Migration warnings
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950">
              Action required before legacy roles can be safely retired
            </h3>
            <div className="mt-3 space-y-2">
              {warnings.map((warning) => (
                <div
                  key={warning}
                  className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-sm text-slate-700"
                >
                  {warning}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : !loading ? (
        <section className="rounded-[28px] border border-emerald-200 bg-[linear-gradient(135deg,_rgba(236,253,245,0.96),_rgba(255,255,255,0.98))] px-5 py-5">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Migration status
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950">
              All legacy items are ready to retire or already retired
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              No active legacy role assignments remain. The tenant is operating
              fully on the composable business-role and workflow-package model.
            </p>
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          Loading legacy migration visibility data...
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniStat
              label="Legacy items"
              value={summaryStats.totalLegacy}
            />
            <MiniStat
              label="Active assignments"
              value={summaryStats.totalAssignments}
              color={summaryStats.totalAssignments > 0 ? "text-amber-700" : "text-slate-900"}
            />
            <MiniStat
              label="Affected users"
              value={summaryStats.totalUsers}
              color={summaryStats.totalUsers > 0 ? "text-amber-700" : "text-slate-900"}
            />
            <MiniStat
              label="Ready to retire"
              value={summaryStats.readyCount}
              color={summaryStats.readyCount > 0 ? "text-emerald-700" : "text-slate-900"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Filter by readiness
            </span>
            {readinessFilterOptions.map((option) => {
              const isActive = readinessFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReadinessFilter(option.value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <LegacyMigrationTable
            rows={rows}
            readinessFilter={readinessFilter}
          />

          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Next steps
                </div>
                <h3 className="mt-2 text-base font-semibold text-slate-950">
                  How to proceed with legacy role retirement
                </h3>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <p>
                    <strong>Ready to retire</strong> items have zero active
                    assignments and a clear replacement. These can be hidden from
                    pickers immediately.
                  </p>
                  <p>
                    <strong>Migration needed</strong> items have active
                    assignments with known replacements. Use the migration
                    workspace to preview and execute the transition.
                  </p>
                  <p>
                    <strong>Review manually</strong> items have no active
                    assignments but lack a straightforward replacement. Verify
                    the intended model before retiring.
                  </p>
                  <p>
                    <strong>Blocked</strong> items have active assignments and no
                    replacement guidance. These require manual investigation
                    before migration.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/app/ayarlar/rbac/role-migrations"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Open migration workspace
                </Link>
                <Link
                  to="/app/ayarlar/rbac/roles-permissions"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Open role editor
                </Link>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
