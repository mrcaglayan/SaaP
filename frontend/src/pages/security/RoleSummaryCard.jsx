import {
  buildScopeLabel,
  getRoleCatalogEntry,
  isRecommendedScopeForRole,
} from "./roleCatalog.js";

function getBadgeClasses(kind) {
  if (kind === "legacy") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (kind === "system") {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (kind === "readonly") {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }
  if (kind === "scoped") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-cyan-200 bg-cyan-50 text-cyan-800";
}

/**
 * Shows the business meaning of a role so admins do not need tribal knowledge
 * to understand what they are assigning or reviewing.
 */
export default function RoleSummaryCard({
  role,
  scopeType = "",
  scopeId = null,
  lookups = {},
  tenantScopeId = null,
  className = "",
}) {
  const roleCode = String(role?.code || role?.roleCode || "").trim();
  if (!roleCode) {
    return null;
  }

  const entry = getRoleCatalogEntry(role);
  const recommendedScopeMatch = isRecommendedScopeForRole(role, scopeType);
  const resolvedScopeLabel =
    scopeType && scopeId
      ? buildScopeLabel(scopeType, scopeId, lookups, tenantScopeId)
      : "";

  return (
    <section
      className={[
        "rounded-xl border border-slate-200 bg-white p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">{roleCode}</div>
          <div className="mt-1 text-sm text-slate-600">
            {String(role?.name || role?.roleName || "").trim() || "Role detail"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getBadgeClasses(
              entry.category
            )}`}
          >
            {entry.categoryLabel}
          </span>
          {entry.companionOnly ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">
              Companion role
            </span>
          ) : null}
          {role?.legacyDisabled ? (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">
              Retired for new assignments
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-700">{entry.summary}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {entry.capabilities.map((capability) => (
          <span
            key={capability}
            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
          >
            {capability}
          </span>
        ))}
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-600">
        <div>
          <span className="font-semibold text-slate-800">Recommended scope:</span>{" "}
          {entry.recommendedScopes.length > 0
            ? entry.recommendedScopes.join(", ")
            : "Review tenant-specific role design"}
        </div>
        {resolvedScopeLabel ? (
          <div>
            <span className="font-semibold text-slate-800">Selected scope:</span>{" "}
            {resolvedScopeLabel}
          </div>
        ) : null}
        {role?.permissionCodes ? (
          <div>
            <span className="font-semibold text-slate-800">Permission count:</span>{" "}
            {role.permissionCodes.length}
          </div>
        ) : null}
      </div>

      {!recommendedScopeMatch && scopeType ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This role is usually assigned at {entry.recommendedScopes.join(", ")} scope, so confirm
          the selected scope deliberately.
        </div>
      ) : null}

      {entry.companionOnly && entry.companionNote ? (
        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          {entry.companionNote}
        </div>
      ) : null}
    </section>
  );
}
