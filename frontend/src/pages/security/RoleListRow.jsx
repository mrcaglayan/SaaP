import { Lock } from "lucide-react";

function normalizeText(value) {
  return String(value || "").trim();
}

function formatScopeLabel(scopeType) {
  return normalizeText(scopeType)
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildScopeSummary(entry) {
  const scopes = Array.from(
    new Set(
      [
        ...(Array.isArray(entry?.recommendedScopes) ? entry.recommendedScopes : []),
        entry?.defaultScope,
      ]
        .map((value) => normalizeText(value).toUpperCase())
        .filter(Boolean)
    )
  );
  if (scopes.length === 0) {
    return {
      primary: "-",
      secondary: "",
    };
  }
  const labels = scopes.map(formatScopeLabel);
  return {
    primary: labels[0],
    secondary: labels.length > 1 ? `+${labels.length - 1} more` : "",
  };
}

function getRoleTypeLabel(entry) {
  if (entry?.businessLabelOnly) {
    return "Label only";
  }
  if (entry?.managedPackageRole) {
    return "Package-backed";
  }
  if (entry?.companionOnly) {
    return "Companion";
  }
  if (entry?.category === "system") {
    return "System admin";
  }
  return "Runtime";
}

function getRoleStateMeta(entry) {
  if (entry?.businessLabelOnly) {
    return {
      label: "Locked",
      className: "border-sky-200 bg-sky-50 text-sky-800",
      showLock: true,
    };
  }
  if (entry?.managedPackageRole) {
    return {
      label: "Package",
      className: "border-blue-200 bg-blue-50 text-blue-800",
      showLock: false,
    };
  }
  if (entry?.companionOnly) {
    return {
      label: "Companion",
      className: "border-violet-200 bg-violet-50 text-violet-800",
      showLock: false,
    };
  }
  if (entry?.category === "system") {
    return {
      label: "Admin",
      className: "border-rose-200 bg-rose-50 text-rose-800",
      showLock: false,
    };
  }
  return {
    label: "Active",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    showLock: false,
  };
}

function getSecondaryCodeText(role, entry, l) {
  const technicalCode = normalizeText(entry?.technicalCode);
  if (technicalCode) {
    return l("Runtime code: {{code}}", "Runtime kodu: {{code}}", {
      code: technicalCode,
    });
  }
  return normalizeText(role?.code) || "-";
}

export default function RoleListRow({ entry, l, onOpenRole, role }) {
  const permissionCount = Array.isArray(role?.permissionCodes) ? role.permissionCodes.length : 0;
  const scopeSummary = buildScopeSummary(entry);
  const stateMeta = getRoleStateMeta(entry);

  return (
    <button
      type="button"
      onClick={onOpenRole}
      className="grid w-full grid-cols-[minmax(360px,2.25fr)_minmax(240px,1.15fr)_170px_160px_110px] items-center gap-4 border-b border-slate-200 bg-white px-4 py-3 text-left text-sm transition hover:bg-slate-50 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium leading-5 text-slate-900">{entry.displayName}</div>
          {entry?.businessLabelOnly ? <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{getSecondaryCodeText(role, entry, l)}</span>
          <span>{permissionCount} permissions</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm text-slate-700">{entry.workflowFamilyLabel}</div>
        <div className="mt-1 truncate text-xs text-slate-500">{entry.categoryLabel}</div>
      </div>

      <div>
        <div className="text-sm text-slate-700">{scopeSummary.primary}</div>
        {scopeSummary.secondary ? (
          <div className="mt-1 text-xs text-slate-500">{scopeSummary.secondary}</div>
        ) : null}
      </div>

      <div className="text-sm text-slate-700">{getRoleTypeLabel(entry)}</div>

      <div className="justify-self-end">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stateMeta.className}`}
        >
          {stateMeta.showLock ? <Lock className="h-3 w-3" /> : null}
          {stateMeta.label}
        </span>
      </div>
    </button>
  );
}
