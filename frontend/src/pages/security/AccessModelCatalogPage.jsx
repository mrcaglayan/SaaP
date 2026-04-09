import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listRoleAssignments } from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { listAccessModelCatalogSections } from "./roleCatalog.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";

const ACCESS_MODEL_TAB_ORDER = Object.freeze([
  "business_roles",
  "workflow_packages",
  "workflow_presets",
  "legacy_catalog",
]);

const FILTER_ALL = "ALL";

function normalizeText(value) {
  return String(value || "").trim();
}

function toCount(value) {
  return Number(value || 0);
}

function buildEntrySearchText(entry) {
  const stepValues = Array.isArray(entry?.steps)
    ? entry.steps.flatMap((step) => [
      step.actionLabel,
      step.scopeType,
      step.requiredPackageCode,
      step.requiredPackageLabel,
      ...(step.eligibleBusinessRoleLabels || []),
      step.minApproverCount,
      step.allowSelfApprove ? "self approve allowed" : "self approve disabled",
      step.escalationAfterHours,
    ])
    : [];
  return [
    entry?.code,
    entry?.displayName,
    entry?.description,
    entry?.categoryLabel,
    entry?.modelTypeLabel,
    entry?.workflowFamilyLabel,
    entry?.defaultScope,
    entry?.primaryScope,
    entry?.technicalCode,
    entry?.runtimeCode,
    entry?.replacementLabel,
    entry?.legacyReason,
    entry?.visibleInNewTenantLabel,
    entry?.usedByCountLabel,
    entry?.usedByCount,
    ...(entry?.starterPackageLabels || []),
    ...(entry?.optionalPackageLabels || []),
    ...(entry?.allowedScopes || []),
    ...(entry?.permissionCodes || []),
    ...(entry?.usedInPresetLabels || []),
    ...(entry?.helperBundleLabels || []),
    ...(entry?.runtimeRoleLabels || []),
    ...(entry?.legacyWarnings || []),
    entry?.runtimeMappingLabel,
    ...(entry?.requiredPackageLabels || []),
    ...(entry?.typicalActorLabels || []),
    ...(entry?.roleLabels || []),
    ...(entry?.optionalRoleLabels || []),
    ...(entry?.capabilities || []),
    ...(entry?.recommendedScopes || []),
    ...stepValues,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildFilterOptions(entries, getter) {
  const options = Array.from(
    new Set(
      (Array.isArray(entries) ? entries : [])
        .flatMap((entry) => getter(entry))
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  return [FILTER_ALL, ...options];
}

function getEntryScopes(entry) {
  return [
    entry?.defaultScope,
    entry?.primaryScope,
    ...(entry?.allowedScopes || []),
    ...(entry?.recommendedScopes || []),
    ...((entry?.steps || []).map((step) => step.scopeType) || []),
  ]
    .map((value) => normalizeText(value).toUpperCase())
    .filter(Boolean);
}

function getSearchPlaceholder(tabKey) {
  if (tabKey === "business_roles") {
    return "Search by business role, scope, package suggestion, or workflow preset";
  }
  if (tabKey === "workflow_packages") {
    return "Search by package, workflow family, scope, permission, runtime role, or preset";
  }
  if (tabKey === "workflow_presets") {
    return "Search by preset, workflow family, actor, package, step action, or scope";
  }
  if (tabKey === "legacy_catalog") {
    return "Search by runtime code, legacy reason, replacement, scope, or visibility";
  }
  return "Search by label, description, scope, package, preset, or replacement";
}

function getStatusLabel(entry) {
  if (entry?.hiddenFromPicker) {
    return "Hidden";
  }
  if (entry?.legacy) {
    return "Legacy";
  }
  if (entry?.draft) {
    return "Draft";
  }
  if (entry?.plannedExtension) {
    return "Extension";
  }
  return "Active";
}

function getStatusClasses(entry) {
  if (entry?.hiddenFromPicker) {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }
  if (entry?.legacy) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (entry?.draft) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (entry?.plannedExtension) {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function getEntryHighlights(sectionKey, entry) {
  if (sectionKey === "business_roles") {
    return [
      `Default scope: ${entry.defaultScope || "-"}`,
      `Starter packages: ${entry.starterPackageLabels.length || 0}`,
      entry.optionalPackageLabels.length > 0
        ? `Optional packages: ${entry.optionalPackageLabels.join(", ")}`
        : "Optional packages: None",
    ];
  }
  if (sectionKey === "workflow_packages") {
    return [
      `Allowed scopes: ${entry.allowedScopes.join(", ") || "-"}`,
      `Permission codes: ${entry.permissionCount || 0}`,
      `Used in presets: ${entry.usedInPresetLabels.length || 0}`,
    ];
  }
  if (sectionKey === "workflow_presets") {
    return [
      `Primary scope: ${entry.primaryScope || "-"}`,
      `Step count: ${entry.stepCount || 0}`,
      `Typical actors: ${entry.typicalActorLabels.join(", ") || "-"}`,
    ];
  }
  return [
    `Recommended scope: ${entry.recommendedScopes.join(", ") || "-"}`,
    entry.replacementLabel ? `Replacement: ${entry.replacementLabel}` : "Replacement: Review manually",
    entry.technicalCode ? `Runtime code: ${entry.technicalCode}` : "Runtime code: preserved in catalog",
  ];
}

function updateSearchParams(searchParams, changes) {
  const nextParams = new URLSearchParams(searchParams);
  for (const [key, value] of Object.entries(changes)) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue || normalizedValue === FILTER_ALL) {
      nextParams.delete(key);
      continue;
    }
    nextParams.set(key, normalizedValue);
  }
  return nextParams;
}

function getPreviewValues(values, limit = 3) {
  const rows = Array.isArray(values) ? values.filter(Boolean) : [];
  if (rows.length <= limit) {
    return rows;
  }
  return [...rows.slice(0, limit), `+${rows.length - limit} more`];
}

function buildLegacyRoleAssignmentCounts(assignments) {
  const counts = {};
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const roleCode = normalizeText(assignment?.roleCode || assignment?.role_code);
    if (!roleCode) {
      continue;
    }
    counts[roleCode] = toCount(counts[roleCode]) + 1;
  }
  return counts;
}

function getLegacyUsedByCount(entry, assignmentCountsByRoleCode) {
  return (Array.isArray(entry?.usageSourceRoleCodes) ? entry.usageSourceRoleCodes : []).reduce(
    (total, roleCode) => total + toCount(assignmentCountsByRoleCode?.[roleCode]),
    0
  );
}

function buildLegacyCatalogViewEntry(entry, {
  canReadRoleAssignments,
  assignmentCountsByRoleCode,
  assignmentCountsLoaded,
  assignmentCountsLoading,
  assignmentCountsError,
}) {
  const usedByCount = getLegacyUsedByCount(entry, assignmentCountsByRoleCode);
  let usedByCountLabel = String(usedByCount);
  let usedByCountNote = usedByCount === 1
    ? "1 live tenant role assignment."
    : `${usedByCount} live tenant role assignments.`;

  if (!canReadRoleAssignments) {
    usedByCountLabel = "Requires assignment read";
    usedByCountNote =
      "Used By Count requires security.role_assignment.read before live tenant assignments can be summarized.";
  } else if (assignmentCountsError) {
    usedByCountLabel = "Unavailable";
    usedByCountNote =
      "Live assignment counts could not be loaded from the role-assignment API.";
  } else if (assignmentCountsLoading && !assignmentCountsLoaded) {
    usedByCountLabel = "Loading...";
    usedByCountNote = "Loading live tenant role assignments for this compatibility row.";
  } else if (!assignmentCountsLoaded) {
    usedByCountLabel = "Pending";
    usedByCountNote = "Live assignment counts have not been loaded yet.";
  }

  return {
    ...entry,
    usedByCount,
    usedByCountLabel,
    usedByCountNote,
    visibleInNewTenantLabel: entry?.visibleInNewTenant ? "Yes" : "No",
  };
}

function AccessModelTabButton({ active, count, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition ${active
        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        }`}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">Catalog</div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
            }`}
        >
          {count}
        </span>
      </div>
    </button>
  );
}

function AccessModelEntryCard({ active, entry, highlights, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-3xl border px-5 py-5 text-left transition ${active
        ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-300/50"
        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
        }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{entry.displayName}</div>
          <div className={`mt-1 text-sm ${active ? "text-slate-200" : "text-slate-600"}`}>
            {entry.description}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${active ? "border-white/20 bg-white/10 text-white" : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
          >
            {entry.modelTypeLabel}
          </span>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${active ? "border-white/20 bg-white/10 text-white" : getStatusClasses(entry)
              }`}
          >
            {getStatusLabel(entry)}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${active ? "border-white/20 bg-white/10 text-white" : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
        >
          {entry.categoryLabel}
        </span>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${active ? "border-white/20 bg-white/10 text-white" : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
        >
          {entry.workflowFamilyLabel}
        </span>
      </div>
      <div className={`mt-4 grid gap-2 text-sm ${active ? "text-slate-100" : "text-slate-600"}`}>
        {highlights.map((line) => (
          <div key={`${entry.code}-${line}`}>{line}</div>
        ))}
      </div>
    </button>
  );
}

function BusinessRoleActionButton({ children, disabled = false, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${disabled
        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        }`}
    >
      {children}
    </button>
  );
}

function BusinessRoleActionStrip({ entry, disableWhereUsed = false, onOpen }) {
  return (
    <div className="flex flex-wrap gap-2">
      <BusinessRoleActionButton disabled>Edit label</BusinessRoleActionButton>
      <BusinessRoleActionButton disabled>
        {entry.hiddenFromPicker ? "Show in picker" : "Hide from picker"}
      </BusinessRoleActionButton>
      <BusinessRoleActionButton disabled>Duplicate</BusinessRoleActionButton>
      <BusinessRoleActionButton disabled={disableWhereUsed} onClick={onOpen}>
        View where used
      </BusinessRoleActionButton>
    </div>
  );
}

function BusinessRoleCatalogTable({ entries, selectedEntryCode, onOpen }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <th className="px-5 py-4">Business role name</th>
              <th className="px-5 py-4">Default scope</th>
              <th className="px-5 py-4">Description</th>
              <th className="px-5 py-4">Suggested starter packages</th>
              <th className="px-5 py-4">Active / Hidden</th>
              <th className="px-5 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.map((entry) => {
              const isSelected = selectedEntryCode === entry.code;
              return (
                <tr
                  key={entry.code}
                  className={isSelected ? "bg-slate-950/5" : "bg-white"}
                >
                  <td className="px-5 py-4 align-top">
                    <button
                      type="button"
                      onClick={() => onOpen(entry.code)}
                      className="text-left"
                    >
                      <div className="text-sm font-semibold text-slate-950">{entry.displayName}</div>
                      <div className="mt-1 text-xs text-slate-500">{entry.categoryLabel}</div>
                    </button>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {entry.defaultScope || "-"}
                    </span>
                  </td>
                  <td className="px-5 py-4 align-top text-sm leading-6 text-slate-600">
                    {entry.description}
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-3">
                      <MetadataPillList
                        values={entry.starterPackageLabels}
                        emptyLabel="No starter packages are suggested for this role."
                      />
                      <div className="text-xs leading-5 text-slate-500">
                        Suggestions only. Package assignment at scope is still what grants authority.
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClasses(
                          entry
                        )}`}
                      >
                        {getStatusLabel(entry)}
                      </span>
                      <div className="text-xs leading-5 text-slate-500">
                        {entry.hiddenFromPicker
                          ? "Hidden from fresh-tenant pickers."
                          : "Shown in fresh-tenant pickers."}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <BusinessRoleActionStrip
                      entry={entry}
                      onOpen={() => onOpen(entry.code)}
                    />
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

function WorkflowPackageCatalogTable({ entries, selectedEntryCode, onOpen }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <th className="px-5 py-4">Package name</th>
              <th className="px-5 py-4">Workflow family</th>
              <th className="px-5 py-4">Allowed scopes</th>
              <th className="px-5 py-4">Underlying permission codes</th>
              <th className="px-5 py-4">Current runtime mapping</th>
              <th className="px-5 py-4">Used in presets</th>
              <th className="px-5 py-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.map((entry) => {
              const isSelected = selectedEntryCode === entry.code;
              return (
                <tr key={entry.code} className={isSelected ? "bg-slate-950/5" : "bg-white"}>
                  <td className="px-5 py-4 align-top">
                    <button
                      type="button"
                      onClick={() => onOpen(entry.code)}
                      className="text-left"
                    >
                      <div className="text-sm font-semibold text-slate-950">{entry.displayName}</div>
                      <div className="mt-1 text-xs text-slate-500">{entry.categoryLabel}</div>
                    </button>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {entry.workflowFamilyLabel}
                      </span>
                      <div className="text-xs text-slate-500">{entry.defaultScope || "-"}</div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <MetadataPillList
                      values={entry.allowedScopes}
                      emptyLabel="No allowed scopes are defined."
                    />
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-3">
                      <MetadataPillList
                        values={getPreviewValues(entry.permissionCodes, 3)}
                        emptyLabel="No permission codes are mapped yet."
                      />
                      <div className="text-xs leading-5 text-slate-500">
                        {entry.permissionCount} permission code{entry.permissionCount === 1 ? "" : "s"} in the package.
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-slate-900">{entry.runtimeMappingLabel}</div>
                      <MetadataPillList
                        values={getPreviewValues(entry.runtimeRoleLabels, 2)}
                        emptyLabel="No runtime role is mapped cleanly yet."
                      />
                      {entry.helperBundleLabels.length > 0 ? (
                        <MetadataPillList values={entry.helperBundleLabels} emptyLabel="" />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <MetadataPillList
                      values={getPreviewValues(entry.usedInPresetLabels, 3)}
                      emptyLabel="Not referenced by a shipped preset yet."
                    />
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClasses(
                          entry
                        )}`}
                      >
                        {getStatusLabel(entry)}
                      </span>
                      <div className="text-xs leading-5 text-slate-500">
                        {entry.plannedExtension
                          ? "Enable only with the matching backend extension."
                          : "Ready for the package-based governance model."}
                      </div>
                    </div>
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

function WorkflowPresetCatalogTable({ entries, selectedEntryCode, onOpen }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <th className="px-5 py-4">Preset name</th>
              <th className="px-5 py-4">Workflow family</th>
              <th className="px-5 py-4">Primary scope</th>
              <th className="px-5 py-4">Step count</th>
              <th className="px-5 py-4">Typical actors</th>
              <th className="px-5 py-4">Uses extension?</th>
              <th className="px-5 py-4">Active / Draft</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.map((entry) => {
              const isSelected = selectedEntryCode === entry.code;
              return (
                <tr key={entry.code} className={isSelected ? "bg-slate-950/5" : "bg-white"}>
                  <td className="px-5 py-4 align-top">
                    <button
                      type="button"
                      onClick={() => onOpen(entry.code)}
                      className="text-left"
                    >
                      <div className="text-sm font-semibold text-slate-950">{entry.displayName}</div>
                      <div className="mt-1 text-xs text-slate-500">{entry.categoryLabel}</div>
                    </button>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {entry.workflowFamilyLabel}
                    </span>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {entry.primaryScope || "-"}
                    </span>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="text-sm font-semibold text-slate-900">{entry.stepCount}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {entry.stepCount === 1 ? "Single-step preset" : "Ordered business flow"}
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <MetadataPillList
                      values={getPreviewValues(entry.typicalActorLabels, 3)}
                      emptyLabel="No typical actors are documented."
                    />
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${entry.usesExtension
                          ? "border-violet-200 bg-violet-50 text-violet-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800"
                          }`}
                      >
                        {entry.usesExtensionLabel}
                      </span>
                      <div className="text-xs leading-5 text-slate-500">
                        {entry.usesExtension
                          ? "Requires or anticipates an extension-aware rollout."
                          : "Runs on the shipped package model."}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClasses(
                          entry
                        )}`}
                      >
                        {getStatusLabel(entry)}
                      </span>
                      <div className="text-xs leading-5 text-slate-500">
                        {entry.draft
                          ? "Draft-only preset definition."
                          : "Ready-made business-readable preset."}
                      </div>
                    </div>
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

function LegacyCatalogTable({ entries, selectedEntryCode, onOpen }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <th className="px-5 py-4">Runtime code</th>
              <th className="px-5 py-4">Scope</th>
              <th className="px-5 py-4">Legacy reason</th>
              <th className="px-5 py-4">Replacement</th>
              <th className="px-5 py-4">Used By Count</th>
              <th className="px-5 py-4">Visible In New Tenant?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.map((entry) => {
              const isSelected = selectedEntryCode === entry.code;
              return (
                <tr key={entry.code} className={isSelected ? "bg-slate-950/5" : "bg-white"}>
                  <td className="px-5 py-4 align-top">
                    <button
                      type="button"
                      onClick={() => onOpen(entry.code)}
                      className="text-left"
                    >
                      <div className="text-sm font-semibold text-slate-950">
                        {entry.runtimeCode || entry.technicalCode || entry.code}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{entry.displayName}</div>
                    </button>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {entry.defaultScope || "-"}
                      </span>
                      <div className="text-xs text-slate-500">{entry.workflowFamilyLabel}</div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top text-sm leading-6 text-slate-600">
                    {entry.legacyReason || entry.description}
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="text-sm font-semibold text-slate-900">
                      {entry.replacementLabel || "Review manually"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      Replacement guidance only. This tab does not execute migration.
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="text-sm font-semibold text-slate-900">{entry.usedByCountLabel}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{entry.usedByCountNote}</div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                        {entry.visibleInNewTenantLabel}
                      </span>
                      <div className="text-xs leading-5 text-slate-500">
                        Compatibility-only. Fresh-tenant pickers should default to No.
                      </div>
                    </div>
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

function MetadataPillList({ values, emptyLabel }) {
  const rows = Array.isArray(values) ? values.filter(Boolean) : [];
  if (rows.length === 0) {
    return <div className="text-sm text-slate-500">{emptyLabel}</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((value) => (
        <span
          key={value}
          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function AccessModelDetailDrawer({ entry, open, onClose }) {
  if (!open || !entry) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close access model detail drawer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Detail drawer
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">{entry.displayName}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{entry.description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
            >
              Close
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
              {entry.modelTypeLabel}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
              {entry.categoryLabel}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
              {entry.workflowFamilyLabel}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClasses(entry)}`}>
              {getStatusLabel(entry)}
            </span>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Code</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">{entry.code}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Default scope</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {entry.defaultScope || entry.primaryScope || "-"}
              </div>
            </div>
            {entry.technicalCode ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Runtime code
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{entry.technicalCode}</div>
              </div>
            ) : null}
            {entry.replacementLabel ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Replacement
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{entry.replacementLabel}</div>
              </div>
            ) : null}
          </section>

          {Array.isArray(entry.starterPackageLabels) ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Suggested starter packages
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                These are onboarding suggestions only. Workflow authority still comes from the
                packages actually assigned at scope.
              </div>
              <div className="mt-4">
                <MetadataPillList
                  values={entry.starterPackageLabels}
                  emptyLabel="No starter packages are defined for this business role."
                />
              </div>
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Optional packages
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={entry.optionalPackageLabels}
                    emptyLabel="No optional packages are defined for this business role."
                  />
                </div>
              </div>
            </section>
          ) : null}

          {entry.modelType === "business_role" && Array.isArray(entry.usedInPresetLabels) ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                View where used
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                Shipped workflow presets that reference this business role today.
              </div>
              <div className="mt-4">
                <MetadataPillList
                  values={entry.usedInPresetLabels}
                  emptyLabel="This business role is not referenced by any shipped workflow preset yet."
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to="/app/ayarlar/workflow-kurulumu"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Open workflow governance
                </Link>
                <Link
                  to="/app/ayarlar/rbac/user-assignments"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Open user assignments
                </Link>
              </div>
            </section>
          ) : null}

          {entry.modelType === "workflow_package" ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Current runtime mapping
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">{entry.runtimeMappingLabel}</div>
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Existing helper bundle mapping
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={entry.helperBundleLabels}
                    emptyLabel="No helper bundle mapping is documented for this package."
                  />
                </div>
              </div>
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Existing runtime role mapping
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={entry.runtimeRoleLabels}
                    emptyLabel="No current runtime role matches this package cleanly yet."
                  />
                </div>
              </div>
            </section>
          ) : null}

          {entry.modelType === "business_role" ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Planned actions
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    This first business-role slice exposes the action posture without turning the
                    tab into a raw permission editor.
                  </div>
                </div>
                <BusinessRoleActionButton disabled>Create role label</BusinessRoleActionButton>
              </div>
              <div className="mt-4">
                <BusinessRoleActionStrip
                  entry={entry}
                  disableWhereUsed
                  onOpen={() => undefined}
                />
              </div>
            </section>
          ) : null}

          {entry.legacy && entry.legacyReason ? (
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                Compatibility status
              </div>
              <div className="mt-2 text-sm leading-6 text-amber-950">{entry.legacyReason}</div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                    Used By Count
                  </div>
                  <div className="mt-2 text-sm font-semibold text-amber-950">
                    {entry.usedByCountLabel || "Pending"}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-amber-900">
                    {entry.usedByCountNote ||
                      "Used By Count reflects live tenant role assignments when available."}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                    Visible In New Tenant?
                  </div>
                  <div className="mt-2 text-sm font-semibold text-amber-950">
                    {entry.visibleInNewTenantLabel || "No"}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-amber-900">
                    Fresh-tenant admin pickers should stay on the cleaned business labels and
                    package model.
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to="/app/ayarlar/rbac/role-migrations"
                  className="rounded-2xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950"
                >
                  Open migration workspace
                </Link>
                <Link
                  to="/app/ayarlar/rbac/roles-permissions"
                  className="rounded-2xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950"
                >
                  Open current role editor
                </Link>
              </div>
            </section>
          ) : null}

          {entry.modelType === "workflow_package" && Array.isArray(entry.legacyWarnings) && entry.legacyWarnings.length > 0 ? (
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                Legacy warnings
              </div>
              <div className="mt-4 space-y-3 text-sm leading-6 text-amber-950">
                {entry.legacyWarnings.map((warning) => (
                  <div key={`${entry.code}-${warning}`}>{warning}</div>
                ))}
              </div>
            </section>
          ) : null}

          {entry.modelType === "workflow_preset" ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Typical actors
                  </div>
                  <div className="mt-3">
                    <MetadataPillList
                      values={entry.typicalActorLabels}
                      emptyLabel="No typical actors are documented for this preset."
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Required packages
                  </div>
                  <div className="mt-3">
                    <MetadataPillList
                      values={entry.requiredPackageLabels}
                      emptyLabel="No required packages are documented for this preset."
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Uses extension?
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">
                    {entry.usesExtensionLabel}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Status
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">
                    {entry.statusLabel}
                  </div>
                </div>
              </div>
              {entry.extensionNote ? (
                <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                  {entry.extensionNote}
                </div>
              ) : null}
            </section>
          ) : null}

          {Array.isArray(entry.allowedScopes) ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Allowed scopes
              </div>
              <div className="mt-4">
                <MetadataPillList
                  values={entry.allowedScopes}
                  emptyLabel="No allowed scopes are defined for this package."
                />
              </div>
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Exact permission codes
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={entry.permissionCodes}
                    emptyLabel="This package is a planned extension and does not ship permission codes yet."
                  />
                </div>
              </div>
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Used in presets
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={entry.usedInPresetLabels}
                    emptyLabel="This package is not used by any shipped preset yet."
                  />
                </div>
              </div>
              {entry.extensionNote ? (
                <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                  {entry.extensionNote}
                </div>
              ) : null}
            </section>
          ) : null}

          {Array.isArray(entry.steps) ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Ordered steps
                </div>
                <div className="text-sm font-semibold text-slate-700">{entry.stepCount} steps</div>
              </div>
              <div className="mt-4 space-y-3">
                {entry.steps.map((step) => (
                  <div
                    key={`${entry.code}-${step.stepNo}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-950">
                        Step {step.stepNo}: {step.actionLabel}
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {step.scopeType}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      Required package: <span className="font-semibold text-slate-900">{step.requiredPackageLabel}</span>
                    </div>
                    <div className="mt-3">
                      <MetadataPillList
                        values={step.eligibleBusinessRoleLabels}
                        emptyLabel="No typical actor labels are defined for this step."
                      />
                    </div>
                    <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Min approver count
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">{step.minApproverCount}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Self-approve rule
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {step.allowSelfApprove ? "Allowed" : "Not allowed"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Escalation rule
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {step.escalationAfterHours == null
                            ? "No escalation"
                            : `${step.escalationAfterHours} hour${step.escalationAfterHours === 1 ? "" : "s"}`}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {entry.extensionNote ? (
                <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                  {entry.extensionNote}
                </div>
              ) : null}
            </section>
          ) : null}

          {Array.isArray(entry.capabilities) ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Capabilities
              </div>
              <div className="mt-4">
                <MetadataPillList
                  values={entry.capabilities}
                  emptyLabel="No additional capabilities are defined for this runtime role."
                />
              </div>
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Recommended scopes
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={entry.recommendedScopes}
                    emptyLabel="No recommended scopes are defined for this runtime role."
                  />
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

/**
 * Builds the first access-model shell so admins can browse business roles,
 * packages, presets, and legacy items from one tabbed catalog surface.
 */
export default function AccessModelCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission, securityAdminUiState, securityAdminUiStateLoaded } = useAuth();
  const [legacyAssignmentCountsByRoleCode, setLegacyAssignmentCountsByRoleCode] = useState({});
  const [legacyAssignmentCountsLoaded, setLegacyAssignmentCountsLoaded] = useState(false);
  const [legacyAssignmentCountsError, setLegacyAssignmentCountsError] = useState("");
  const sections = listAccessModelCatalogSections();
  const currentTab = ACCESS_MODEL_TAB_ORDER.includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : ACCESS_MODEL_TAB_ORDER[0];
  const isBusinessRolesTab = currentTab === "business_roles";
  const isWorkflowPackagesTab = currentTab === "workflow_packages";
  const isWorkflowPresetsTab = currentTab === "workflow_presets";
  const isLegacyCatalogTab = currentTab === "legacy_catalog";
  const canReadRoleAssignments = hasPermission("security.role_assignment.read");
  const isFreshTenantSimplified =
    securityAdminUiStateLoaded &&
    Boolean(securityAdminUiState?.roleMigrations?.simplifiedFreshTenantView);
  const currentSection =
    sections.find((section) => section.key === currentTab) || sections[0] || null;
  const searchValue = normalizeText(searchParams.get("q"));
  const scopeFilter = normalizeText(searchParams.get("scope")).toUpperCase() || FILTER_ALL;
  const familyFilter = normalizeText(searchParams.get("family")) || FILTER_ALL;
  const selectedEntryCode = normalizeText(searchParams.get("item"));
  const effectiveLegacyAssignmentCountsByRoleCode =
    canReadRoleAssignments && !isFreshTenantSimplified
      ? legacyAssignmentCountsByRoleCode
      : {};
  const effectiveLegacyAssignmentCountsLoaded = isFreshTenantSimplified
    ? true
    : canReadRoleAssignments
      ? legacyAssignmentCountsLoaded
      : false;
  const effectiveLegacyAssignmentCountsError =
    canReadRoleAssignments && !isFreshTenantSimplified ? legacyAssignmentCountsError : "";
  const effectiveLegacyAssignmentCountsLoading =
    isLegacyCatalogTab &&
    canReadRoleAssignments &&
    !isFreshTenantSimplified &&
    !legacyAssignmentCountsLoaded &&
    !legacyAssignmentCountsError;
  const currentEntries = (currentSection?.entries || []).map((entry) =>
    isLegacyCatalogTab
      ? buildLegacyCatalogViewEntry(entry, {
        canReadRoleAssignments,
        assignmentCountsByRoleCode: effectiveLegacyAssignmentCountsByRoleCode,
        assignmentCountsLoaded: effectiveLegacyAssignmentCountsLoaded,
        assignmentCountsLoading: effectiveLegacyAssignmentCountsLoading,
        assignmentCountsError: effectiveLegacyAssignmentCountsError,
      })
      : entry
  );
  const familyOptions = buildFilterOptions(currentEntries, (entry) => [entry.workflowFamily]);
  const scopeOptions = buildFilterOptions(currentEntries, (entry) => getEntryScopes(entry));
  const filteredEntries = currentEntries.filter((entry) => {
    const matchesSearch =
      !searchValue || buildEntrySearchText(entry).includes(searchValue.toLowerCase());
    const matchesFamily =
      familyFilter === FILTER_ALL || normalizeText(entry.workflowFamily) === familyFilter;
    const matchesScope =
      scopeFilter === FILTER_ALL || getEntryScopes(entry).includes(scopeFilter);
    return matchesSearch && matchesFamily && matchesScope;
  });
  const selectedEntry =
    currentEntries.find((entry) => normalizeText(entry.code) === selectedEntryCode) || null;
  const currentActionLink =
    currentTab === "workflow_packages" || currentTab === "workflow_presets"
      ? {
        to: "/app/ayarlar/workflow-kurulumu",
        label: "Open workflow governance",
      }
      : currentTab === "legacy_catalog"
        ? {
          to: "/app/ayarlar/rbac/role-migrations",
          label: "Open migration workspace",
        }
        : {
          to: "/app/ayarlar/rbac/roles-permissions",
          label: "Open current role editor",
        };

  useEffect(() => {
    if (!isLegacyCatalogTab || !canReadRoleAssignments || isFreshTenantSimplified) {
      return undefined;
    }

    let cancelled = false;

    // UI-1E keeps Used By Count tied to live role assignments so the legacy
    // catalog stays read-only and does not depend on a migration preview run.
    listRoleAssignments()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setLegacyAssignmentCountsByRoleCode(
          buildLegacyRoleAssignmentCounts(response?.rows || [])
        );
        setLegacyAssignmentCountsLoaded(true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLegacyAssignmentCountsByRoleCode({});
        setLegacyAssignmentCountsLoaded(false);
        setLegacyAssignmentCountsError(
          error?.response?.data?.message ||
          "Legacy role assignment counts could not be loaded."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [canReadRoleAssignments, isFreshTenantSimplified, isLegacyCatalogTab]);

  const activeCount = currentEntries.filter((entry) => !entry.legacy && !entry.hiddenFromPicker).length;
  const hiddenCount = currentEntries.filter((entry) => entry.hiddenFromPicker).length;
  const extensionCount = currentEntries.filter((entry) => entry.plannedExtension).length;
  const draftCount = currentEntries.filter((entry) => entry.draft).length;
  const legacyHiddenCount = currentEntries.filter((entry) => entry.visibleInNewTenant === false).length;
  const legacyAssignedCount = currentEntries.filter((entry) => toCount(entry.usedByCount) > 0).length;
  const legacyMixLabel =
    canReadRoleAssignments && (effectiveLegacyAssignmentCountsLoaded || isFreshTenantSimplified)
      ? `${legacyHiddenCount} hidden / ${legacyAssignedCount} assigned`
      : `${legacyHiddenCount} hidden / live counts pending`;
  const legacyMixDescription = !canReadRoleAssignments
    ? "Used By Count requires role-assignment read permission."
    : effectiveLegacyAssignmentCountsError
      ? "Live compatibility counts are temporarily unavailable from the role-assignment API."
      : isFreshTenantSimplified
        ? "This tenant currently has no live compatibility assignments."
        : "Used By Count reflects current live role assignments, not preset suggestions.";

  return (
    <SecurityAdminWorkspaceShell
      sectionKey="access-model"
      eyebrow="Security / Access Model"
      title="Access Model"
      description="Browse the separated catalog for business roles, workflow packages, workflow presets, and legacy runtime items. This shell keeps fresh-tenant admin browsing away from compatibility roles while the deeper editors land in the next slices."
      actions={[
        {
          to: currentActionLink.to,
          label: currentActionLink.label,
          tone: "primary",
        },
      ]}
      stats={[
        {
          title: "Visible in tab",
          value: filteredEntries.length,
          description: "Filtered rows in the active catalog.",
          tone: "blue",
        },
        {
          title: "Current mix",
          value: isBusinessRolesTab
            ? `${activeCount} active / ${hiddenCount} hidden`
            : isWorkflowPackagesTab
              ? `${activeCount - extensionCount} active / ${extensionCount} extension`
              : isWorkflowPresetsTab
                ? `${activeCount - draftCount} active / ${draftCount} draft`
                : legacyMixLabel,
          description: isBusinessRolesTab
            ? "Business roles stay human-friendly and separate from authority packages."
            : isWorkflowPackagesTab
              ? "Runtime mappings show how clean packages sit on top of current seeded roles."
              : isWorkflowPresetsTab
                ? "Presets stay readable as business flows before any tenant-specific workflow customization."
                : legacyMixDescription,
        },
        {
          title: "Detail drawer",
          value: selectedEntry?.displayName || "No item selected",
          description: "The right-side drawer follows the current catalog row selection.",
        },
      ]}
      toolbar={
        <>
          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {ACCESS_MODEL_TAB_ORDER.map((tabKey) => {
                const section = sections.find((item) => item.key === tabKey);
                if (!section) {
                  return null;
                }
                return (
                  <AccessModelTabButton
                    key={section.key}
                    active={section.key === currentTab}
                    count={section.entries.length}
                    label={section.label}
                    onClick={() =>
                      setSearchParams(
                        updateSearchParams(searchParams, {
                          tab: section.key,
                          item: "",
                        })
                      )
                    }
                  />
                );
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Shared filters
                </div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">
                  {currentSection?.label || "Catalog"}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {currentSection?.description || "Browse the access-model catalog."}
                </p>
              </div>
              <Link
                to={currentActionLink.to}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                {currentActionLink.label}
              </Link>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_220px_220px]">
              <input
                value={searchValue}
                onChange={(event) =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      q: event.target.value,
                    })
                  )
                }
                placeholder={getSearchPlaceholder(currentTab)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              />
              <select
                value={familyFilter}
                onChange={(event) =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      family: event.target.value,
                    })
                  )
                }
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              >
                {familyOptions.map((familyCode) => (
                  <option key={familyCode} value={familyCode}>
                    {familyCode === FILTER_ALL
                      ? "All workflow families"
                      : currentEntries.find((entry) => entry.workflowFamily === familyCode)
                        ?.workflowFamilyLabel || familyCode}
                  </option>
                ))}
              </select>
              <select
                value={scopeFilter}
                onChange={(event) =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      scope: event.target.value,
                    })
                  )
                }
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              >
                {scopeOptions.map((scopeCode) => (
                  <option key={scopeCode} value={scopeCode}>
                    {scopeCode === FILTER_ALL ? "All scopes" : scopeCode}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </>
      }
    >
      {isBusinessRolesTab ? (
            <section className="rounded-[28px] border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.95),rgba(255,255,255,0.98))] px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                    Business role guidance
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950">
                    Labels stay separate from workflow authority
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Business roles explain who a person is in the organization. Suggested starter
                    packages help onboarding, but package assignment at scope is still what grants
                    workflow authority.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <BusinessRoleActionButton disabled>Create role label</BusinessRoleActionButton>
                  <Link
                    to="/app/ayarlar/rbac/user-assignments"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open user assignments
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          {isWorkflowPackagesTab ? (
            <section className="rounded-[28px] border border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))] px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                    Workflow package guidance
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950">
                    Packages are the authority layer
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Workflow steps bind to packages, not to job titles. This tab shows the clean
                    package model, the scopes each package can run at, and how that model maps back
                    to today&apos;s seeded runtime roles and helper bundles.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    to="/app/ayarlar/workflow-kurulumu"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open workflow governance
                  </Link>
                  <Link
                    to="/app/ayarlar/rbac/roles-permissions"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open current role editor
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          {isWorkflowPresetsTab ? (
            <section className="rounded-[28px] border border-indigo-200 bg-[linear-gradient(135deg,rgba(238,242,255,0.96),rgba(255,255,255,0.98))] px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                    Workflow preset guidance
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950">
                    Presets should read like business flows
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Presets bundle the ordered steps, package requirements, scopes, and typical
                    actors into a ready-made governance flow. This tab is preview-only for now and
                    intentionally avoids turning the preset catalog into the actual save/apply UI.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    to="/app/ayarlar/workflow-kurulumu"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open workflow governance
                  </Link>
                  <Link
                    to="/app/ayarlar/rbac/access-model?tab=workflow_packages"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open workflow packages
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          {isLegacyCatalogTab ? (
            <section className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))] px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                    Legacy catalog guidance
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950">
                    Compatibility stays visible but out of fresh-tenant pickers
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    This tab keeps retired runtime roles and retired admin labels visible for
                    power-admin review while the normal tenant UX stays on the cleaned business
                    labels and package model.
                  </p>
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
                    Open current role editor
                  </Link>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-sm text-slate-700">
                {legacyMixDescription}
              </div>
            </section>
      ) : null}

      <section className="space-y-4">
        {filteredEntries.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
            No catalog rows match the current filters.
          </div>
        ) : isBusinessRolesTab ? (
          <BusinessRoleCatalogTable
            entries={filteredEntries}
            selectedEntryCode={selectedEntryCode}
            onOpen={(entryCode) =>
              setSearchParams(
                updateSearchParams(searchParams, {
                  item: entryCode,
                })
              )
            }
          />
        ) : isWorkflowPackagesTab ? (
          <WorkflowPackageCatalogTable
            entries={filteredEntries}
            selectedEntryCode={selectedEntryCode}
            onOpen={(entryCode) =>
              setSearchParams(
                updateSearchParams(searchParams, {
                  item: entryCode,
                })
              )
            }
          />
        ) : isWorkflowPresetsTab ? (
          <WorkflowPresetCatalogTable
            entries={filteredEntries}
            selectedEntryCode={selectedEntryCode}
            onOpen={(entryCode) =>
              setSearchParams(
                updateSearchParams(searchParams, {
                  item: entryCode,
                })
              )
            }
          />
        ) : isLegacyCatalogTab ? (
          <LegacyCatalogTable
            entries={filteredEntries}
            selectedEntryCode={selectedEntryCode}
            onOpen={(entryCode) =>
              setSearchParams(
                updateSearchParams(searchParams, {
                  item: entryCode,
                })
              )
            }
          />
        ) : (
          filteredEntries.map((entry) => (
            <AccessModelEntryCard
              key={`${currentTab}-${entry.code}`}
              active={selectedEntryCode === entry.code}
              entry={entry}
              highlights={getEntryHighlights(currentTab, entry)}
              onOpen={() =>
                setSearchParams(
                  updateSearchParams(searchParams, {
                    item: entry.code,
                  })
                )
              }
            />
          ))
        )}
      </section>

      <AccessModelDetailDrawer
        entry={selectedEntry}
        open={Boolean(selectedEntry)}
        onClose={() =>
          setSearchParams(
            updateSearchParams(searchParams, {
              item: "",
            })
          )
        }
      />
    </SecurityAdminWorkspaceShell>
  );
}
