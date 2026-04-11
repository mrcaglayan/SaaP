import { useEffect, useMemo, useState } from "react";
import {
  exportComplianceAuditReportCsv,
  generateComplianceAuditReport,
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import DelegationStateBadge from "../../components/security/DelegationStateBadge.jsx";
import { useI18n } from "../../i18n/useI18n.js";
import { triggerBlobDownload } from "../../utils/csvExport.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import SecurityDiagnosticsWorkbenchTabs from "./components/diagnostics/SecurityDiagnosticsWorkbenchTabs.jsx";
import { SecurityWorkbenchEmptyState } from "./components/SecurityWorkbenchStates.jsx";

const PREVIEW_LIMIT = 50;
const SCOPE_TYPES = ["", "TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const REPORT_FAMILIES = [
  {
    code: "ACCESS_MATRIX",
    title: "Access Matrix",
    subtitle: "Point-in-time role, permission, visibility, and delegation footprint.",
  },
  {
    code: "SOD_ANALYSIS",
    title: "SoD Analysis",
    subtitle: "Same-record maker-checker conflicts and mitigating approval controls.",
  },
  {
    code: "APPROVAL_COVERAGE",
    title: "Approval Coverage",
    subtitle: "Where approval policy coverage exists and where it is still missing.",
  },
  {
    code: "DELEGATION_LOG",
    title: "Delegation Log",
    subtitle: "Delegation windows, states, and delegated decision usage.",
  },
];

function formatDate(value) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

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

function formatScopeLabel(scopeType, scopeId, scopeName) {
  if (!scopeType || !scopeId) {
    return "-";
  }

  const base = `${scopeType}:${scopeId}`;
  return scopeName ? `${base} (${scopeName})` : base;
}

function getScopeOptions(scopeType, lookups, tenantScopeId) {
  if (scopeType === "TENANT") {
    return tenantScopeId
      ? [{ id: tenantScopeId, label: `Tenant #${tenantScopeId}` }]
      : [];
  }
  if (scopeType === "GROUP") {
    return (lookups.groups || []).map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (scopeType === "COUNTRY") {
    return (lookups.countries || []).map((row) => ({
      id: Number(row.id),
      label: `${row.iso2} - ${row.name}`,
    }));
  }
  if (scopeType === "LEGAL_ENTITY") {
    return (lookups.legalEntities || []).map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (scopeType === "OPERATING_UNIT") {
    return (lookups.operatingUnits || []).map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  return [];
}

function getSummaryCards(reportType, summary = {}) {
  if (reportType === "ACCESS_MATRIX") {
    return [
      { label: "Users in scope", value: summary.totalUsers },
      { label: "Users with roles", value: summary.usersWithRoles },
      { label: "Users with effective permissions", value: summary.usersWithEffectivePermissions },
      { label: "Users with active delegations", value: summary.usersWithActiveDelegations },
    ];
  }
  if (reportType === "SOD_ANALYSIS") {
    return [
      { label: "Users checked", value: summary.totalUsers },
      { label: "Users with conflicts", value: summary.usersWithConflicts },
      { label: "Block conflicts", value: summary.blockLevelConflicts },
      { label: "Mitigated conflicts", value: summary.mitigatedConflicts },
    ];
  }
  if (reportType === "APPROVAL_COVERAGE") {
    return [
      { label: "Covered actions", value: summary.coveredActionCount },
      { label: "Uncovered actions", value: summary.uncoveredActionCount },
      { label: "Policies in scope", value: summary.policyCount },
    ];
  }
  if (reportType === "DELEGATION_LOG") {
    return [
      { label: "Total delegations", value: summary.totalDelegations },
      { label: "Active", value: summary.activeDelegations },
      { label: "Expired", value: summary.expiredDelegations },
      { label: "Delegated decisions", value: summary.delegatedDecisionCount },
    ];
  }
  return [];
}

function getPreviewRowCount(reportType, report) {
  if (!report) {
    return 0;
  }
  if (reportType === "ACCESS_MATRIX") {
    return Array.isArray(report.matrix) ? report.matrix.length : 0;
  }
  if (reportType === "SOD_ANALYSIS") {
    return Array.isArray(report.conflicts) ? report.conflicts.length : 0;
  }
  if (reportType === "APPROVAL_COVERAGE") {
    const coveredRows = Array.isArray(report.coveredActions)
      ? report.coveredActions.reduce(
          (total, action) => total + Math.max(1, Array.isArray(action.policies) ? action.policies.length : 0),
          0
        )
      : 0;
    const uncoveredRows = Array.isArray(report.uncoveredActions)
      ? report.uncoveredActions.length
      : 0;
    return coveredRows + uncoveredRows;
  }
  if (reportType === "DELEGATION_LOG") {
    return Array.isArray(report.delegations) ? report.delegations.length : 0;
  }
  return 0;
}

function buildRequestPayload(filters, tenantScopeId) {
  const payload = {
    reportType: filters.reportType,
    asOfDate: filters.asOfDate,
  };

  if (!filters.scopeType) {
    return payload;
  }

  if (filters.scopeType === "TENANT" && tenantScopeId) {
    return {
      ...payload,
      scopeType: "TENANT",
      scopeId: tenantScopeId,
    };
  }

  if (filters.scopeId) {
    return {
      ...payload,
      scopeType: filters.scopeType,
      scopeId: Number(filters.scopeId),
    };
  }

  return payload;
}

function ReportMetricCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{Number(value || 0)}</div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const normalized = String(severity || "").trim().toLowerCase();
  const className =
    normalized === "block"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-800";
  const label = normalized === "block" ? "BLOCK" : normalized ? normalized.toUpperCase() : "-";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function CoverageBadge({ covered }) {
  const className = covered
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {covered ? "COVERED" : "UNCOVERED"}
    </span>
  );
}

function PreviewLimitNotice({ totalCount }) {
  if (Number(totalCount || 0) <= PREVIEW_LIMIT) {
    return null;
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Preview is capped at the first {PREVIEW_LIMIT} rows for readability. Use CSV export for the
      full point-in-time dataset.
    </div>
  );
}

function AccessMatrixPreview({ report }) {
  const rows = Array.isArray(report?.matrix) ? report.matrix.slice(0, PREVIEW_LIMIT) : [];
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        Access Matrix Preview
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">No access rows match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Roles</th>
                <th className="px-4 py-2">Effective Permissions</th>
                <th className="px-4 py-2">Data Scopes</th>
                <th className="px-4 py-2">Delegations</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{row.userName || `User #${row.userId}`}</div>
                    <div className="text-xs text-slate-500">{row.email || "-"}</div>
                    <div className="mt-1 text-xs text-slate-500">Status: {row.status || "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {Array.isArray(row.roles) && row.roles.length > 0 ? (
                      <div className="space-y-1">
                        {row.roles.slice(0, 4).map((role) => (
                          <div key={`${row.userId}-${role.assignmentId}`}>
                            {role.roleCode} @ {role.scopeType}:{role.scopeId}
                          </div>
                        ))}
                        {row.roles.length > 4 ? (
                          <div className="text-slate-500">+{row.roles.length - 4} more roles</div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-500">No role assignments in preview scope.</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {Array.isArray(row.effectivePermissions) && row.effectivePermissions.length > 0 ? (
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-800">
                          {row.effectivePermissions.length} permission(s)
                        </div>
                        {row.effectivePermissions.slice(0, 4).map((permission) => (
                          <div key={`${row.userId}-${permission.code}`}>
                            {permission.code}{" "}
                            <span className="text-slate-500">
                              ({(permission.scopes || []).length} scope)
                            </span>
                          </div>
                        ))}
                        {row.effectivePermissions.length > 4 ? (
                          <div className="text-slate-500">
                            +{row.effectivePermissions.length - 4} more permissions
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-500">No effective permissions in preview scope.</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {Array.isArray(row.dataScopes) && row.dataScopes.length > 0 ? (
                      <div className="space-y-1">
                        {row.dataScopes.slice(0, 3).map((scope) => (
                          <div key={`${row.userId}-${scope.scopeType}-${scope.scopeId}`}>
                            {formatScopeLabel(scope.scopeType, scope.scopeId, scope.scopeName)}{" "}
                            <span className="text-slate-500">{scope.effect}</span>
                          </div>
                        ))}
                        {row.dataScopes.length > 3 ? (
                          <div className="text-slate-500">+{row.dataScopes.length - 3} more data scopes</div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-500">No explicit visibility overrides.</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {Array.isArray(row.activeDelegations) && row.activeDelegations.length > 0 ? (
                      <div className="space-y-1">
                        {row.activeDelegations.slice(0, 3).map((delegation) => (
                          <div key={`${row.userId}-${delegation.relation}-${delegation.id}`}>
                            <span className="font-semibold">{delegation.relation}</span>{" "}
                            {delegation.moduleCode || "ALL"} @{" "}
                            {formatScopeLabel(
                              delegation.scopeType,
                              delegation.scopeId,
                              delegation.scopeName
                            )}
                          </div>
                        ))}
                        {row.activeDelegations.length > 3 ? (
                          <div className="text-slate-500">
                            +{row.activeDelegations.length - 3} more delegations
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-500">No active delegations.</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SodAnalysisPreview({ report }) {
  const rows = Array.isArray(report?.conflicts) ? report.conflicts.slice(0, PREVIEW_LIMIT) : [];
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        SoD Conflict Preview
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">No SoD conflicts were found for this scope.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Conflict</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Overlapping Scopes</th>
                <th className="px-4 py-2">Mitigating Controls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.userId}-${row.conflictRule?.code}`} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{row.userName || `User #${row.userId}`}</div>
                    <div className="text-xs text-slate-500">{row.email || "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div className="font-semibold text-slate-900">{row.conflictRule?.code || "-"}</div>
                    <div className="mt-1">
                      {row.conflictRule?.actionA || "-"} <span className="text-slate-400">vs</span>{" "}
                      {row.conflictRule?.actionB || "-"}
                    </div>
                    <div className="mt-1 text-slate-500">{row.conflictRule?.reason || "-"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <SeverityBadge severity={row.conflictRule?.severity} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {(row.overlappingScopes || []).length > 0 ? (
                      <div className="space-y-1">
                        {row.overlappingScopes.map((scope) => (
                          <div key={`${row.userId}-${row.conflictRule?.code}-${scope.type}-${scope.id}`}>
                            {formatScopeLabel(scope.type, scope.id, scope.name)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500">No overlap scope detail.</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {(row.mitigatingControls || []).length > 0 ? (
                      <div className="space-y-1">
                        {row.mitigatingControls.map((control) => (
                          <div key={`${row.userId}-${row.conflictRule?.code}-${control}`}>{control}</div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500">No mitigating control recorded.</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ApprovalCoveragePreview({ report }) {
  const coveredRows = [];
  for (const action of report?.coveredActions || []) {
    const policies = Array.isArray(action.policies) && action.policies.length > 0
      ? action.policies
      : [null];
    for (const policy of policies) {
      coveredRows.push({
        moduleCode: action.moduleCode,
        targetType: action.targetType,
        actionType: action.actionType,
        policy,
      });
    }
  }

  const previewCoveredRows = coveredRows.slice(0, PREVIEW_LIMIT);
  const previewUncoveredRows = Array.isArray(report?.uncoveredActions)
    ? report.uncoveredActions.slice(0, PREVIEW_LIMIT)
    : [];

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          Covered Actions
        </div>
        {previewCoveredRows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No approval coverage rows match the current filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Policy</th>
                  <th className="px-4 py-2">Threshold / Approvals</th>
                  <th className="px-4 py-2">Applicability Scopes</th>
                </tr>
              </thead>
              <tbody>
                {previewCoveredRows.map((row, index) => (
                  <tr
                    key={`${row.moduleCode}-${row.targetType}-${row.actionType}-${row.policy?.id || index}`}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="px-4 py-3">
                      <CoverageBadge covered />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">
                        {row.moduleCode} / {row.targetType}
                      </div>
                      <div className="mt-1 text-slate-500">{row.actionType}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">{row.policy?.policyCode || "-"}</div>
                      <div className="mt-1 text-slate-500">{row.policy?.policyName || "Policy detail unavailable."}</div>
                      <div className="mt-1 text-slate-500">Version {row.policy?.versionNo || 1}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div>Approvals: {row.policy?.requiredApprovals || 0}</div>
                      <div>Steps: {row.policy?.steps || 0}</div>
                      <div>Maker-checker: {row.policy?.makerCheckerRequired ? "Required" : "Not required"}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {(row.policy?.applicabilityScopes || []).length > 0 ? (
                        <div className="space-y-1">
                          {row.policy.applicabilityScopes.map((scope) => (
                            <div key={`${row.policy?.id}-${scope.type}-${scope.id}`}>
                              {formatScopeLabel(scope.type, scope.id, scope.name)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">No applicability scopes returned.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          Uncovered Actions
        </div>
        {previewUncoveredRows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No uncovered actions remain in the current catalog.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Audit Note</th>
                </tr>
              </thead>
              <tbody>
                {previewUncoveredRows.map((row) => (
                  <tr key={`${row.moduleCode}-${row.targetType}-${row.actionType}`} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <CoverageBadge covered={false} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">
                        {row.moduleCode} / {row.targetType}
                      </div>
                      <div className="mt-1 text-slate-500">{row.actionType}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{row.note || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function DelegationLogPreview({ report }) {
  const rows = Array.isArray(report?.delegations) ? report.delegations.slice(0, PREVIEW_LIMIT) : [];
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
        Delegation Log Preview
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">No delegations match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2">Delegator / Delegate</th>
                <th className="px-4 py-2">Module / Scope</th>
                <th className="px-4 py-2">Window</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2">Usage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div className="font-semibold text-slate-900">{row.delegatorName || `User #${row.delegatorUserId}`}</div>
                    <div className="text-slate-500">to {row.delegateName || `User #${row.delegateUserId}`}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div className="font-semibold text-slate-900">{row.moduleCode || "ALL"}</div>
                    <div className="mt-1 text-slate-500">
                      {formatScopeLabel(row.scopeType, row.scopeId, row.scopeName)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div>From: {formatDate(row.effectiveFrom)}</div>
                    <div>To: {formatDate(row.effectiveTo)}</div>
                    {row.revokedAt ? <div className="text-slate-500">Revoked: {formatDateTime(row.revokedAt)}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <DelegationStateBadge state={row.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div className="font-semibold text-slate-900">{row.decisionsActedOn || 0} delegated decision(s)</div>
                    {(row.decisionDetails || []).length > 0 ? (
                      <div className="mt-1 space-y-1">
                        {row.decisionDetails.slice(0, 3).map((detail) => (
                          <div key={`${row.id}-${detail.requestId}-${detail.decidedAt}`}>
                            {detail.requestCode || `Request #${detail.requestId}`}{" "}
                            <span className="text-slate-500">
                              ({detail.action || "-"} {formatDateTime(detail.decidedAt)})
                            </span>
                          </div>
                        ))}
                        {row.decisionDetails.length > 3 ? (
                          <div className="text-slate-500">
                            +{row.decisionDetails.length - 3} more decision rows
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1 text-slate-500">No delegated decisions recorded.</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReportPreview({ reportType, report }) {
  if (reportType === "ACCESS_MATRIX") {
    return <AccessMatrixPreview report={report} />;
  }
  if (reportType === "SOD_ANALYSIS") {
    return <SodAnalysisPreview report={report} />;
  }
  if (reportType === "APPROVAL_COVERAGE") {
    return <ApprovalCoveragePreview report={report} />;
  }
  if (reportType === "DELEGATION_LOG") {
    return <DelegationLogPreview report={report} />;
  }
  return null;
}

/**
 * Admin-facing point-in-time compliance report screen for access matrix, SoD,
 * approval coverage, and delegation audit outputs.
 */
export default function ComplianceReportsPage() {
  const { hasPermission, user } = useAuth();
  const { l } = useI18n();
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reportEnvelope, setReportEnvelope] = useState(null);
  const [lastPreviewKey, setLastPreviewKey] = useState("");
  const [lookups, setLookups] = useState({
    groups: [],
    countries: [],
    legalEntities: [],
    operatingUnits: [],
  });
  const [filters, setFilters] = useState({
    reportType: "ACCESS_MATRIX",
    asOfDate: new Date().toISOString().slice(0, 10),
    scopeType: "",
    scopeId: "",
  });

  const tenantScopeId = Number(user?.tenant_id || user?.tenantId || 0);
  const canPreview = hasPermission("security.audit.report.generate");
  const canExport = hasPermission("security.audit.report.export");
  const canReadOrgTree = hasPermission("org.tree.read");
  const scopeOptions = useMemo(
    () => getScopeOptions(filters.scopeType, lookups, tenantScopeId),
    [filters.scopeType, lookups, tenantScopeId]
  );
  const selectedFamily = useMemo(
    () => REPORT_FAMILIES.find((entry) => entry.code === filters.reportType) || REPORT_FAMILIES[0],
    [filters.reportType]
  );
  const currentPayload = useMemo(
    () => buildRequestPayload(filters, tenantScopeId),
    [filters, tenantScopeId]
  );
  const currentPreviewKey = useMemo(() => JSON.stringify(currentPayload), [currentPayload]);
  const isPreviewStale = Boolean(reportEnvelope && lastPreviewKey && lastPreviewKey !== currentPreviewKey);
  const summaryCards = useMemo(
    () => getSummaryCards(filters.reportType, reportEnvelope?.report?.summary || {}),
    [filters.reportType, reportEnvelope]
  );
  const previewCount = useMemo(
    () => getPreviewRowCount(filters.reportType, reportEnvelope?.report),
    [filters.reportType, reportEnvelope]
  );
  const workspaceStats = [
    {
      title: l("Report family", "Rapor ailesi"),
      value: selectedFamily.title,
      description: l(
        "The current point-in-time compliance lens selected for preview and export.",
        "Onizleme ve disa aktarma icin secili olan mevcut nokta-zamanli uyum mercegi."
      ),
      tone: "blue",
    },
    {
      title: l("As of date", "Referans tarihi"),
      value: formatDate(filters.asOfDate),
      description: l(
        "All report families are generated against this effective date.",
        "Tum rapor aileleri bu etkin tarih uzerinden uretilir."
      ),
      tone: "violet",
    },
    {
      title: l("Preview rows", "Onizleme satirlari"),
      value: previewCount,
      description: l(
        "Rows currently visible in the on-screen compliance preview.",
        "Ekrandaki uyum onizlemesinde su anda gorunen satirlar."
      ),
      tone: "green",
    },
    {
      title: l("Preview state", "Onizleme durumu"),
      value: !reportEnvelope
        ? l("Pending", "Bekliyor")
        : isPreviewStale
          ? l("Stale", "Eski")
          : l("Ready", "Hazir"),
      description: l(
        "Shows whether the exported filter state still matches the current on-screen preview.",
        "Disa aktarim filtre durumunun mevcut ekran onizlemesiyle halen eslesip eslesmedigini gosterir."
      ),
      tone: !reportEnvelope ? "amber" : isPreviewStale ? "amber" : "green",
    },
  ];
  const workspaceActions = [
    {
      label: l("Access explainability", "Erisim aciklanabilirligi"),
      to: "/app/ayarlar/security-admin/diagnostics?tab=access",
    },
    {
      label: l("Raw audit logs", "Ham denetim loglari"),
      to: "/app/ayarlar/security-admin/diagnostics?tab=raw-audit",
      tone: "primary",
    },
  ];

  useEffect(() => {
    if (filters.scopeType !== "TENANT") {
      return;
    }
    setFilters((prev) => ({ ...prev, scopeId: String(tenantScopeId || "") }));
  }, [filters.scopeType, tenantScopeId]);

  useEffect(() => {
    if (!filters.scopeType || filters.scopeType === "TENANT") {
      return;
    }
    if (
      filters.scopeId &&
      scopeOptions.some((option) => String(option.id) === String(filters.scopeId))
    ) {
      return;
    }
    if (scopeOptions.length === 0) {
      return;
    }
    setFilters((prev) => ({ ...prev, scopeId: String(scopeOptions[0].id) }));
  }, [filters.scopeId, filters.scopeType, scopeOptions]);

  async function loadLookups() {
    setLoadingLookups(true);
    setError("");
    try {
      const [groupsRes, countriesRes, entitiesRes, unitsRes] = await Promise.all([
        canReadOrgTree ? listGroupCompanies() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listCountries() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listOperatingUnits() : Promise.resolve({ rows: [] }),
      ]);

      setLookups({
        groups: Array.isArray(groupsRes?.rows) ? groupsRes.rows : [],
        countries: Array.isArray(countriesRes?.rows) ? countriesRes.rows : [],
        legalEntities: Array.isArray(entitiesRes?.rows) ? entitiesRes.rows : [],
        operatingUnits: Array.isArray(unitsRes?.rows) ? unitsRes.rows : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Compliance report lookups could not be loaded.");
    } finally {
      setLoadingLookups(false);
    }
  }

  useEffect(() => {
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadOrgTree]);

  async function handlePreview(event) {
    event?.preventDefault?.();
    if (!canPreview) {
      setError("Missing permission: security.audit.report.generate");
      return;
    }

    setLoadingReport(true);
    setError("");
    setMessage("");
    try {
      const response = await generateComplianceAuditReport(currentPayload);
      setReportEnvelope(response || null);
      setLastPreviewKey(currentPreviewKey);
      setMessage(`${selectedFamily.title} preview generated for ${filters.asOfDate}.`);
    } catch (err) {
      setError(err?.response?.data?.message || "Compliance report preview could not be generated.");
    } finally {
      setLoadingReport(false);
    }
  }

  async function handleExport() {
    if (!canExport) {
      setError("Missing permission: security.audit.report.export");
      return;
    }

    setExporting(true);
    setError("");
    setMessage("");
    try {
      const exported = await exportComplianceAuditReportCsv(currentPayload);
      const downloaded = triggerBlobDownload(exported.blob, exported.fileName);
      if (!downloaded) {
        throw new Error("Browser download could not be started.");
      }
      setMessage(
        `${selectedFamily.title} CSV exported${exported.rowCount ? ` (${exported.rowCount} rows)` : ""}.`
      );
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Compliance report export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="diagnostics"
      sectionKey="diagnostics-audit"
      eyebrow={l("Diagnostics & Audit", "Tanilama ve Denetim")}
      title={l("Compliance reports", "Uyum raporlari")}
      description={l(
        "Generate point-in-time access matrix, SoD, approval coverage, and delegation reporting without leaving the security-admin investigation family.",
        "Access matrix, SoD, approval coverage ve delegasyon raporlarini security-admin investigation ailesinden cikmadan nokta-zamanli olarak uretin."
      )}
      actions={workspaceActions}
      stats={workspaceStats}
      toolbar={<SecurityDiagnosticsWorkbenchTabs activeTab="compliance" />}
    >
      <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Uyum Raporlari</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Access matrix, SoD analysis, approval coverage, and delegation audit outputs can be
            generated here as point-in-time previews and exported without manual database inspection.
          </p>
        </div>
      </div>

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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-900">
          <div className="font-semibold">Point-in-time reporting</div>
          <div className="mt-1">
            Preview and export use the same report family and scope filters. CSV export always uses
            the current filter state, even if the on-screen preview is stale.
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {REPORT_FAMILIES.map((family) => {
            const active = family.code === filters.reportType;
            return (
              <button
                key={family.code}
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    reportType: family.code,
                  }))
                }
                className={`rounded-xl border px-4 py-4 text-left transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-white"
                }`}
              >
                <div className="text-sm font-semibold">{family.title}</div>
                <div className={`mt-2 text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>
                  {family.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        <form onSubmit={handlePreview} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            type="date"
            value={filters.asOfDate}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, asOfDate: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />

          <select
            value={filters.scopeType}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                scopeType: event.target.value,
                scopeId: event.target.value === "TENANT" ? String(tenantScopeId || "") : "",
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {SCOPE_TYPES.map((scopeType) => (
              <option key={scopeType || "ALL"} value={scopeType}>
                {scopeType || "All tenant scopes"}
              </option>
            ))}
          </select>

          {scopeOptions.length > 0 ? (
            <select
              value={filters.scopeId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, scopeId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">
                {filters.scopeType ? "Select scope target" : "No scope filter"}
              </option>
              {scopeOptions.map((option) => (
                <option key={`${filters.scopeType}-${option.id}`} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={1}
              value={filters.scopeId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, scopeId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={filters.scopeType ? "Scope id" : "No scope filter"}
              disabled={!filters.scopeType}
            />
          )}

          <button
            type="submit"
            disabled={!canPreview || loadingReport || loadingLookups}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loadingReport ? "Generating..." : "Generate Preview"}
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={!canExport || exporting || loadingLookups}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </form>

        <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
          <div>Preview permission: {canPreview ? "Available" : "Missing security.audit.report.generate"}</div>
          <div>Export permission: {canExport ? "Available" : "Missing security.audit.report.export"}</div>
          <div>Lookup mode: {canReadOrgTree ? "Named scope picker" : "Manual scope id entry"}</div>
        </div>
      </section>

      {!reportEnvelope ? (
        <SecurityWorkbenchEmptyState
          title={selectedFamily.title}
          description={l(
            "Generate a preview to inspect the point-in-time audit output before exporting.",
            "Disa aktarmadan once nokta-zamanli denetim cikisini incelemek icin bir onizleme olusturun."
          )}
        />
      ) : (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{selectedFamily.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{selectedFamily.subtitle}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>As of {reportEnvelope.asOfDate || filters.asOfDate}</div>
                <div>Generated {formatDateTime(reportEnvelope.generatedAt)}</div>
              </div>
            </div>

            {isPreviewStale ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Filters changed after the last preview. Generate again if you want the on-screen
                preview to match the current export filters.
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <ReportMetricCard key={card.label} label={card.label} value={card.value} />
              ))}
            </div>
          </section>

          <PreviewLimitNotice totalCount={previewCount} />
          <ReportPreview reportType={filters.reportType} report={reportEnvelope.report} />
        </div>
      )}
      </div>
    </SecurityAdminWorkspaceShell>
  );
}
