import { useEffect, useMemo, useState } from "react";
import {
  executeRoleMigration,
  getRoleMigrationRun,
  listRoleMigrationRuns,
  previewRoleMigration,
  rollbackRoleMigration,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import SecurityWarningList from "./SecurityWarningList.jsx";
import { getRoleCatalogEntry } from "./roleCatalog.js";

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function toCount(value) {
  return Number(value || 0);
}

/**
 * Admin-facing preview/execute/rollback surface for the legacy-to-composable
 * role migration flow introduced in PR-4C.
 */
export default function RoleMigrationsPage() {
  const { hasPermission, securityAdminUiState, securityAdminUiStateLoaded } = useAuth();
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const migrationUiState = securityAdminUiState?.roleMigrations || null;
  const canWriteRoleMigrations = hasPermission("security.role_assignment.upsert");
  const isFreshTenantSimplified =
    securityAdminUiStateLoaded && Boolean(migrationUiState?.simplifiedFreshTenantView);
  const showPrimaryPreviewButton =
    !securityAdminUiStateLoaded || !isFreshTenantSimplified;

  async function loadRuns(nextSelectedRunId = null) {
    setLoading(true);
    setError("");
    try {
      const response = await listRoleMigrationRuns();
      const nextRuns = response?.rows || [];
      setRuns(nextRuns);

      const targetRunId =
        nextSelectedRunId || selectedRunId || Number(nextRuns[0]?.id || 0) || null;
      setSelectedRunId(targetRunId);

      if (targetRunId) {
        const runDetail = await getRoleMigrationRun(targetRunId);
        setSelectedRun(runDetail || null);
      } else {
        setSelectedRun(null);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Role migration runs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelectRun(runId) {
    const numericRunId = Number(runId || 0);
    if (!numericRunId) {
      return;
    }
    setSelectedRunId(numericRunId);
    setError("");
    try {
      const runDetail = await getRoleMigrationRun(numericRunId);
      setSelectedRun(runDetail || null);
    } catch (err) {
      setError(err?.response?.data?.message || "Role migration run detail could not be loaded.");
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setError("");
    setMessage("");
    try {
      const run = await previewRoleMigration();
      setMessage("Role migration preview generated.");
      await loadRuns(run?.id || null);
    } catch (err) {
      setError(err?.response?.data?.message || "Role migration preview could not be generated.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExecute() {
    if (!selectedRun?.id) {
      return;
    }
    setActing(true);
    setError("");
    setMessage("");
    try {
      const run = await executeRoleMigration(selectedRun.id);
      setSelectedRun(run || null);
      setMessage("Role migration executed.");
      await loadRuns(selectedRun.id);
    } catch (err) {
      setError(err?.response?.data?.message || "Role migration execution failed.");
    } finally {
      setActing(false);
    }
  }

  async function handleRollback() {
    if (!selectedRun?.id) {
      return;
    }
    const confirmed = window.confirm(
      "Rollback will restore the stored legacy assignments for this run. Continue?"
    );
    if (!confirmed) {
      return;
    }

    setActing(true);
    setError("");
    setMessage("");
    try {
      const run = await rollbackRoleMigration(selectedRun.id);
      setSelectedRun(run || null);
      setMessage("Role migration rollback completed.");
      await loadRuns(selectedRun.id);
    } catch (err) {
      setError(err?.response?.data?.message || "Role migration rollback failed.");
    } finally {
      setActing(false);
    }
  }

  const reviewWarnings = useMemo(() => {
    if (!selectedRun?.previewSummary) {
      return [];
    }
    const warnings = [];
    if (toCount(selectedRun.previewSummary.reviewRequiredItemCount) > 0) {
      warnings.push(
        `${selectedRun.previewSummary.reviewRequiredItemCount} preview items require review before a clean execute.`
      );
    }
    if (Array.isArray(selectedRun.previewSummary.activeLegacyDisabledRoleCodes) &&
      selectedRun.previewSummary.activeLegacyDisabledRoleCodes.length > 0) {
      warnings.push(
        `Legacy roles already retired for this tenant: ${selectedRun.previewSummary.activeLegacyDisabledRoleCodes.join(", ")}.`
      );
    }
    return warnings;
  }, [selectedRun]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Role Migration</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Review how legacy runtime roles map into composable roles when a brownfield tenant
            still carries compatibility assignments. Executed runs remain reviewable and
            rollback-capable from the stored snapshot.
          </p>
        </div>
        {showPrimaryPreviewButton ? (
          <button
            type="button"
            onClick={handlePreview}
            disabled={previewing || acting || !canWriteRoleMigrations}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {previewing ? "Building preview..." : "Preview Legacy Role Migration"}
          </button>
        ) : null}
      </div>

      {isFreshTenantSimplified ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <div className="font-semibold">Fresh-tenant simplified view</div>
          <p className="mt-1">
            This tenant has no legacy runtime role assignments and no stored migration runs, so
            the migration tool is hidden from the normal admin navigation. Keep using the steady
            state role, delegation, diagnostics, and compliance surfaces.
          </p>
          {canWriteRoleMigrations ? (
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || acting}
              className="mt-3 rounded-lg border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-60"
            >
              {previewing ? "Building preview..." : "Run Compatibility Preview Anyway"}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Migration Runs</h2>
            <button
              type="button"
              onClick={() => loadRuns(selectedRunId)}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading migration runs...</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-slate-500">
              No migration preview has been generated for this tenant yet.
            </p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => {
                const selected = Number(run.id) === Number(selectedRunId);
                const previewSummary = run.previewSummary || {};
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => handleSelectRun(run.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left ${
                      selected
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Run #{run.id}</div>
                      <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold">
                        {run.status}
                      </span>
                    </div>
                    <div className="mt-2 text-xs opacity-80">
                      Source assignments: {toCount(previewSummary.totalSourceAssignments)} | Ready:{" "}
                      {toCount(previewSummary.readyItemCount)} | Review:{" "}
                      {toCount(previewSummary.reviewRequiredItemCount)}
                    </div>
                    <div className="mt-1 text-xs opacity-70">
                      Created {formatDateTime(run.createdAt)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {!selectedRun ? (
            <p className="text-sm text-slate-500">
              Select a run to review the migration mapping and execution state.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Run #{selectedRun.id}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Mapping version {selectedRun.mappingVersion} | Created{" "}
                    {formatDateTime(selectedRun.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedRun.status === "PREVIEWED" ? (
                    <button
                      type="button"
                      onClick={handleExecute}
                      disabled={acting || !canWriteRoleMigrations}
                      className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {acting ? "Executing..." : "Execute Migration"}
                    </button>
                  ) : null}
                  {selectedRun.status === "EXECUTED" ? (
                    <button
                      type="button"
                      onClick={handleRollback}
                      disabled={acting || !canWriteRoleMigrations}
                      className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                    >
                      {acting ? "Rolling back..." : "Rollback Run"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Source assignments
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {toCount(selectedRun.previewSummary?.totalSourceAssignments)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Users affected
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {toCount(selectedRun.previewSummary?.usersAffected)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Ready items
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {toCount(selectedRun.previewSummary?.readyItemCount)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Review required
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {toCount(selectedRun.previewSummary?.reviewRequiredItemCount)}
                  </div>
                </div>
              </div>

              <SecurityWarningList
                title="Review notes"
                warnings={reviewWarnings}
              />

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Legacy assignment</th>
                      <th className="px-3 py-2">Proposed roles</th>
                      <th className="px-3 py-2">Scope</th>
                      <th className="px-3 py-2">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedRun.items || []).map((item) => {
                      const sourceSnapshot = item.sourceSnapshot || {};
                      const sourceRoleEntry = getRoleCatalogEntry(item.source_role_code);
                      const targetAssignments = Array.isArray(item.targetAssignments)
                        ? item.targetAssignments
                        : [];
                      const noteLines = Array.isArray(item.notes) ? item.notes : [];
                      return (
                        <tr key={item.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">
                              {sourceSnapshot.userName || `User #${item.source_user_id}`}
                            </div>
                            <div className="text-xs text-slate-500">
                              {sourceSnapshot.userEmail || "-"}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">
                              {sourceRoleEntry.code}
                            </div>
                            <div className="text-xs text-slate-500">
                              {sourceRoleEntry.technicalCode
                                ? `Runtime code: ${sourceRoleEntry.technicalCode}`
                                : item.source_role_name}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {targetAssignments.length === 0 ? (
                              <span className="text-slate-500">No target roles</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {targetAssignments.map((targetAssignment) => {
                                  const targetRoleEntry = getRoleCatalogEntry(
                                    targetAssignment.roleCode
                                  );
                                  return (
                                    <span
                                      key={`${item.id}-${targetAssignment.roleCode}`}
                                      className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-800"
                                    >
                                      {targetRoleEntry.code}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">
                              {sourceSnapshot.scope?.label ||
                                `${item.source_scope_type} #${item.source_scope_id}`}
                            </div>
                            <div className="text-xs text-slate-500">{item.source_effect}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">
                              {item.preview_status}
                            </div>
                            {noteLines.length > 0 ? (
                              <div className="mt-1 space-y-1 text-xs text-slate-500">
                                {noteLines.map((note) => (
                                  <div key={`${item.id}-${note}`}>{String(note)}</div>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
