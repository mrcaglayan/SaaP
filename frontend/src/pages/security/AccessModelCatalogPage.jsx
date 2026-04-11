import { Fragment } from "react";
import {
  ChevronRight,
  Package,
  Shield,
  Workflow,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { listAccessModelCatalogSections } from "./roleCatalog.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import SecurityCatalogWorkbenchTabs from "./components/catalog/SecurityCatalogWorkbenchTabs.jsx";

const ACCESS_MODEL_TAB_ORDER = Object.freeze([
  "business_roles",
  "workflow_packages",
  "workflow_presets",
]);
const ACCESS_MODEL_VIEW_ORDER = Object.freeze(["browse", "matrix"]);
const ACCESS_MODEL_MATRIX_COMPARE_LIMIT = 4;

const FILTER_ALL = "ALL";
const SCOPE_LEVEL_ORDER = Object.freeze([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);
const WORKFLOW_FAMILY_ORDER = Object.freeze([
  "AP_DOCUMENT_POSTING",
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE",
  "CONSOLIDATION_RUN",
  "CROSS_WORKFLOW",
]);

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
    ...(entry?.runtimeNotes || []),
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
  return "Search by label, description, scope, package, preset, or replacement";
}

function getStatusLabel(entry) {
  if (entry?.hiddenFromPicker) {
    return "Hidden";
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
  if (entry?.draft) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (entry?.plannedExtension) {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function getWorkflowFamilyTheme(workflowFamily) {
  const normalizedFamily = normalizeText(workflowFamily).toUpperCase();
  if (normalizedFamily === "AP_DOCUMENT_POSTING") {
    return {
      chip: "border-sky-200 bg-sky-50 text-sky-800",
      panel: "border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.92),rgba(255,255,255,0.98))]",
      softPanel: "border-sky-100 bg-sky-50/70",
      icon: "border-sky-200 bg-white text-sky-700",
      metric: "text-sky-700",
    };
  }
  if (normalizedFamily === "LOCAL_CLOSE_PACK") {
    return {
      chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
      panel: "border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.92),rgba(255,255,255,0.98))]",
      softPanel: "border-emerald-100 bg-emerald-50/70",
      icon: "border-emerald-200 bg-white text-emerald-700",
      metric: "text-emerald-700",
    };
  }
  if (normalizedFamily === "PERIOD_CLOSE") {
    return {
      chip: "border-amber-200 bg-amber-50 text-amber-900",
      panel: "border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.98))]",
      softPanel: "border-amber-100 bg-amber-50/70",
      icon: "border-amber-200 bg-white text-amber-800",
      metric: "text-amber-800",
    };
  }
  if (normalizedFamily === "CONSOLIDATION_RUN") {
    return {
      chip: "border-violet-200 bg-violet-50 text-violet-800",
      panel: "border-violet-200 bg-[linear-gradient(135deg,rgba(245,243,255,0.92),rgba(255,255,255,0.98))]",
      softPanel: "border-violet-100 bg-violet-50/70",
      icon: "border-violet-200 bg-white text-violet-700",
      metric: "text-violet-700",
    };
  }
  return {
    chip: "border-slate-200 bg-slate-50 text-slate-700",
    panel: "border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.92),rgba(255,255,255,0.98))]",
    softPanel: "border-slate-200 bg-slate-50/80",
    icon: "border-slate-200 bg-white text-slate-700",
    metric: "text-slate-700",
  };
}

function getScopeCoverage(entry) {
  return new Set(getEntryScopes(entry));
}

function formatScopeLabel(scopeType) {
  return normalizeText(scopeType).replaceAll("_", " ");
}

function getPermissionModuleKey(permissionCode) {
  const parts = normalizeText(permissionCode).split(".").filter(Boolean);
  if (parts.length <= 1) {
    return normalizeText(permissionCode);
  }
  return parts.slice(0, -1).join(".");
}

function formatPermissionModuleLabel(moduleKey) {
  return normalizeText(moduleKey)
    .split(".")
    .filter(Boolean)
    .map((part) => part.replaceAll("_", " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function formatPermissionActionLabel(permissionCode) {
  const action = normalizeText(permissionCode).split(".").filter(Boolean).pop() || "";
  return action ? action.replaceAll("_", " ").toUpperCase() : permissionCode;
}

function buildPermissionModuleGroups(permissionCodes) {
  const rows = Array.isArray(permissionCodes) ? permissionCodes.filter(Boolean) : [];
  const byModule = new Map();
  rows.forEach((permissionCode) => {
    const moduleKey = getPermissionModuleKey(permissionCode);
    if (!byModule.has(moduleKey)) {
      byModule.set(moduleKey, []);
    }
    byModule.get(moduleKey).push(permissionCode);
  });

  return Array.from(byModule.entries()).map(([moduleKey, codes]) => {
    const codeSet = new Set(codes);
    return {
      moduleKey,
      moduleLabel: formatPermissionModuleLabel(moduleKey),
      permissions: codes.map((permissionCode) => ({
        code: permissionCode,
        actionLabel: formatPermissionActionLabel(permissionCode),
        requiresRead:
          !permissionCode.endsWith(".read") && codeSet.has(`${moduleKey}.read`),
      })),
    };
  });
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

function parseMatrixCompareCodes(rawValue, entries) {
  const validCodes = new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeText(entry.code))
      .filter(Boolean)
  );
  return Array.from(
    new Set(
      String(rawValue || "")
        .split(",")
        .map((value) => normalizeText(value))
        .filter((value) => value && validCodes.has(value))
    )
  ).slice(0, ACCESS_MODEL_MATRIX_COMPARE_LIMIT);
}

function buildDefaultCompareCodes(entries, preferredCode = "") {
  const rows = Array.isArray(entries) ? entries : [];
  const codes = [];
  const seen = new Set();
  const addCode = (value) => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue || seen.has(normalizedValue)) {
      return;
    }
    seen.add(normalizedValue);
    codes.push(normalizedValue);
  };

  addCode(preferredCode);
  rows.forEach((entry) => addCode(entry.code));

  return codes.slice(0, ACCESS_MODEL_MATRIX_COMPARE_LIMIT);
}

function joinMatrixCompareCodes(compareCodes) {
  return (Array.isArray(compareCodes) ? compareCodes : [])
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(",");
}

function buildNextMatrixCompareCodes(compareCodes, entryCode) {
  const normalizedCode = normalizeText(entryCode);
  const currentCodes = Array.isArray(compareCodes) ? compareCodes.filter(Boolean) : [];
  if (!normalizedCode) {
    return currentCodes;
  }
  if (currentCodes.includes(normalizedCode)) {
    return currentCodes.filter((value) => value !== normalizedCode);
  }
  return [...currentCodes, normalizedCode].slice(0, ACCESS_MODEL_MATRIX_COMPARE_LIMIT);
}

function collectMatrixLabels(entries, getter) {
  const labels = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const values = Array.isArray(getter(entry)) ? getter(entry) : [];
    values.forEach((value) => {
      const label = normalizeText(value);
      const key = label.toLowerCase();
      if (!label || labels.has(key)) {
        return;
      }
      labels.set(key, label);
    });
  });
  return Array.from(labels.values()).sort((left, right) => left.localeCompare(right));
}

function collectMatrixItems(entries, getter, keyGetter, sortGetter = null) {
  const values = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const rows = Array.isArray(getter(entry)) ? getter(entry) : [];
    rows.forEach((item) => {
      const itemKey = normalizeText(keyGetter(item));
      if (!itemKey || values.has(itemKey)) {
        return;
      }
      values.set(itemKey, item);
    });
  });

  return Array.from(values.values()).sort((left, right) => {
    const leftLabel = normalizeText(sortGetter ? sortGetter(left) : keyGetter(left));
    const rightLabel = normalizeText(sortGetter ? sortGetter(right) : keyGetter(right));
    return leftLabel.localeCompare(rightLabel);
  });
}

function getScopeCoverageHint(entry) {
  const activeScopes = SCOPE_LEVEL_ORDER.filter((scopeType) =>
    getScopeCoverage(entry).has(scopeType)
  ).map(formatScopeLabel);
  if (activeScopes.length === 0) {
    return "No documented scope coverage.";
  }
  return `Coverage: ${activeScopes.join(", ")}`;
}

function getEntryStatusTone(entry) {
  if (entry?.hiddenFromPicker) {
    return "not_granted";
  }
  if (entry?.draft || entry?.plannedExtension) {
    return "linked";
  }
  return "granted";
}

function getEntryStatusMatrixHint(entry) {
  if (entry?.hiddenFromPicker) {
    return "Hidden from fresh-tenant selection surfaces.";
  }
  if (entry?.draft) {
    return "Draft definition. Review before broad rollout.";
  }
  if (entry?.plannedExtension) {
    return "Extension-aware package. Review rollout notes before adoption.";
  }
  return "Primary catalog path for the current access-model slice.";
}

function getWorkflowPackageMatrixPosture(entry) {
  const runtimeMappingLabel = normalizeText(entry?.runtimeMappingLabel).toLowerCase();
  if (runtimeMappingLabel.includes("companion")) {
    return {
      tone: "companion_only",
      label: "Companion-only",
      hint: entry.runtimeMappingLabel,
    };
  }
  if (entry?.plannedExtension) {
    return {
      tone: "linked",
      label: "Extension package",
      hint: entry.extensionNote || "Package is planned as an extension-aware rollout.",
    };
  }
  return {
    tone: "granted",
    label: "Package authority",
    hint: `${entry.permissionCount} mapped permission codes.`,
  };
}

function getMatrixEntryPosture(entry, tabKey) {
  if (tabKey === "business_roles") {
    return {
      tone: "linked",
      label: "Label only",
      hint: "Assign workflow packages separately. Business roles stay non-authoritative.",
    };
  }
  if (tabKey === "workflow_packages") {
    return getWorkflowPackageMatrixPosture(entry);
  }
  if (tabKey === "workflow_presets") {
    return {
      tone: entry?.draft ? "linked" : "granted",
      label: entry?.draft ? "Draft preset" : "Preset flow",
      hint: `${entry.stepCount} ordered steps with ${entry.requiredPackageLabels.length} required packages.`,
    };
  }
  return {
    tone: "neutral",
    label: "Catalog item",
    hint: entry?.description || "Access-model catalog item.",
  };
}

function buildSummaryComparisonGroup(entries, tabKey) {
  const scopeLabel = tabKey === "workflow_presets" ? "Primary scope" : "Default scope";
  return {
    key: "summary",
    title: "Summary",
    description:
      "Use the matrix to compare meaning and coverage side by side. The detail drawer remains the primary explanation path.",
    rows: [
      {
        key: "posture",
        label: "Authority posture",
        hint: "This keeps browse-first meaning separate from the raw editor.",
        cells: entries.map((entry) => getMatrixEntryPosture(entry, tabKey)),
      },
      {
        key: "family",
        label: "Workflow family",
        hint: "Routing and package questions usually start with the business family boundary.",
        cells: entries.map((entry) => ({
          tone: "neutral",
          label: entry.workflowFamilyLabel,
          hint: `${entry.modelTypeLabel} / ${entry.categoryLabel}`,
        })),
      },
      {
        key: "scope",
        label: scopeLabel,
        hint: "Scope-aware hint for where the compared item normally operates.",
        cells: entries.map((entry) => ({
          tone: "neutral",
          label: entry.defaultScope || entry.primaryScope || "-",
          hint: getScopeCoverageHint(entry),
        })),
      },
      {
        key: "status",
        label: "Catalog status",
        hint: "Active, hidden, extension, or draft posture.",
        cells: entries.map((entry) => ({
          tone: getEntryStatusTone(entry),
          label: getStatusLabel(entry),
          hint: getEntryStatusMatrixHint(entry),
        })),
      },
    ],
  };
}

function buildScopeComparisonGroup(entries) {
  return {
    key: "scope-coverage",
    title: "Scope coverage",
    description:
      "Scope-aware hints stay visible in the matrix so admins do not have to jump straight into the current role editor.",
    rows: SCOPE_LEVEL_ORDER.map((scopeType) => ({
      key: `scope-${scopeType}`,
      label: formatScopeLabel(scopeType),
      hint: `Documented coverage for ${formatScopeLabel(scopeType)} scope.`,
      cells: entries.map((entry) =>
        getScopeCoverage(entry).has(scopeType)
          ? {
            tone: "granted",
            label: "Granted",
            hint:
              entry.defaultScope === scopeType || entry.primaryScope === scopeType
                ? "Primary / default scope."
                : "Supported by this catalog row.",
          }
          : {
            tone: "not_granted",
            label: "Not granted",
            hint: "No documented scope coverage.",
          }
      ),
    })),
  };
}

function buildBusinessRoleMatrixGroups(entries) {
  const starterPackageLabels = collectMatrixLabels(entries, (entry) => entry.starterPackageLabels);
  const optionalPackageLabels = collectMatrixLabels(entries, (entry) => entry.optionalPackageLabels);
  const presetLabels = collectMatrixLabels(entries, (entry) => entry.usedInPresetLabels);

  return [
    buildSummaryComparisonGroup(entries, "business_roles"),
    buildScopeComparisonGroup(entries),
    {
      key: "starter-packages",
      title: "Suggested starter packages",
      description:
        "Starter suggestions help onboarding, but they do not grant workflow authority by themselves.",
      rows: starterPackageLabels.map((label) => ({
        key: `starter-${label}`,
        label,
        hint: "Starter bundle suggestion only.",
        cells: entries.map((entry) =>
          entry.starterPackageLabels.includes(label)
            ? {
              tone: "suggested",
              label: "Suggested",
              hint: "Starter package hint for guided onboarding.",
            }
            : {
              tone: "not_granted",
              label: "Not suggested",
              hint: "No starter-package hint for this role.",
            }
        ),
      })),
    },
    {
      key: "optional-packages",
      title: "Optional packages",
      description:
        "Optional packages surface useful companion coverage without collapsing the role into a raw authority set.",
      rows: optionalPackageLabels.map((label) => ({
        key: `optional-${label}`,
        label,
        hint: "Optional package pairing.",
        cells: entries.map((entry) =>
          entry.optionalPackageLabels.includes(label)
            ? {
              tone: "optional",
              label: "Optional",
              hint: "Useful companion package for some tenants.",
            }
            : {
              tone: "not_granted",
              label: "Not included",
              hint: "No optional pairing documented.",
            }
        ),
      })),
    },
    {
      key: "preset-coverage",
      title: "Workflow preset coverage",
      description:
        "Preset references keep business-role meaning visible before anyone drops into assignment tools.",
      rows: presetLabels.map((label) => ({
        key: `preset-${label}`,
        label,
        hint: "Shipped preset reference.",
        cells: entries.map((entry) =>
          entry.usedInPresetLabels.includes(label)
            ? {
              tone: "linked",
              label: "Referenced",
              hint: "Used by a shipped workflow preset.",
            }
            : {
              tone: "not_granted",
              label: "Not referenced",
              hint: "No shipped preset reference.",
            }
        ),
      })),
    },
  ].filter((group) => group.rows.length > 0);
}

function buildWorkflowPackageMatrixGroups(entries) {
  const moduleGroups = collectMatrixItems(
    entries,
    (entry) => buildPermissionModuleGroups(entry.permissionCodes),
    (group) => group.moduleKey,
    (group) => group.moduleLabel
  );
  const runtimeRoleLabels = collectMatrixLabels(entries, (entry) => entry.runtimeRoleLabels);
  const helperBundleLabels = collectMatrixLabels(entries, (entry) => entry.helperBundleLabels);
  const presetLabels = collectMatrixLabels(entries, (entry) => entry.usedInPresetLabels);

  return [
    buildSummaryComparisonGroup(entries, "workflow_packages"),
    buildScopeComparisonGroup(entries),
    {
      key: "permission-modules",
      title: "Permission modules",
      description:
        "Module-family grouping makes package comparison readable without treating the matrix as the only explanation surface.",
      rows: moduleGroups.map((group) => ({
        key: `module-${group.moduleKey}`,
        label: group.moduleLabel,
        hint: `${group.permissions.length} mapped actions in this module family.`,
        cells: entries.map((entry) => {
          const entryGroup = buildPermissionModuleGroups(entry.permissionCodes).find(
            (item) => item.moduleKey === group.moduleKey
          );
          return entryGroup
            ? {
              tone: "granted",
              label: "Granted",
              hint: `${entryGroup.permissions.length} mapped actions in ${group.moduleLabel}.`,
            }
            : {
              tone: "not_granted",
              label: "Not granted",
              hint: "This package does not include the module family.",
            };
        }),
      })),
    },
    {
      key: "runtime-role-mapping",
      title: "Runtime package sources",
      description:
        "Current runtime-role and helper-bundle links stay visible so package sources remain explainable.",
      rows: [
        {
          key: "mapping-posture",
          label: "Current runtime sources",
          hint: "Companion-only source posture remains visible in comparison mode.",
          cells: entries.map((entry) => {
            const runtimeMappingLabel = normalizeText(entry.runtimeMappingLabel).toLowerCase();
            if (runtimeMappingLabel.includes("companion")) {
              return {
                tone: "companion_only",
                label: "Companion-only",
                hint: entry.runtimeMappingLabel,
              };
            }
            return {
              tone: "linked",
              label: "Mapped",
              hint: entry.runtimeMappingLabel,
            };
          }),
        },
        ...runtimeRoleLabels.map((label) => ({
          key: `runtime-role-${label}`,
          label,
          hint: "Current runtime-role source.",
          cells: entries.map((entry) =>
            entry.runtimeRoleLabels.includes(label)
              ? {
                tone: normalizeText(entry.runtimeMappingLabel).toLowerCase().includes("companion")
                  ? "companion_only"
                  : "linked",
                label: normalizeText(entry.runtimeMappingLabel).toLowerCase().includes("companion")
                  ? "Companion-only"
                  : "Mapped",
                hint: "Runtime role is part of the current package source map.",
              }
              : {
                tone: "not_granted",
                label: "Not mapped",
                hint: "Runtime role is not part of this package source map.",
              }
          ),
        })),
        ...helperBundleLabels.map((label) => ({
          key: `helper-bundle-${label}`,
          label,
          hint: "Current helper-bundle source.",
          cells: entries.map((entry) =>
            entry.helperBundleLabels.includes(label)
              ? {
                tone: "linked",
                label: "Mapped",
                hint: "Helper bundle is part of the current package source map.",
              }
              : {
                tone: "not_granted",
                label: "Not mapped",
                hint: "Helper bundle is not part of this package source map.",
              }
          ),
        })),
      ],
    },
    {
      key: "preset-coverage",
      title: "Workflow preset coverage",
      description:
        "Compare which shipped presets depend on each package before changing assignment guidance.",
      rows: presetLabels.map((label) => ({
        key: `preset-${label}`,
        label,
        hint: "Preset dependency.",
        cells: entries.map((entry) =>
          entry.usedInPresetLabels.includes(label)
            ? {
              tone: "linked",
              label: "Used",
              hint: "This shipped preset depends on the package.",
            }
            : {
              tone: "not_granted",
              label: "Not used",
              hint: "No shipped preset dependency.",
            }
        ),
      })),
    },
  ].filter((group) => group.rows.length > 0);
}

function buildWorkflowPresetMatrixGroups(entries) {
  const requiredPackageLabels = collectMatrixLabels(entries, (entry) => entry.requiredPackageLabels);
  const typicalActorLabels = collectMatrixLabels(entries, (entry) => entry.typicalActorLabels);
  const stepRows = collectMatrixItems(
    entries,
    (entry) =>
      entry.steps.map((step) => ({
        key: `${step.actionLabel}::${step.scopeType}::${step.requiredPackageCode}`,
        label: step.actionLabel,
        hint: `${step.scopeType} scope via ${step.requiredPackageLabel}`,
      })),
    (step) => step.key,
    (step) => `${step.label} ${step.hint}`
  );

  return [
    buildSummaryComparisonGroup(entries, "workflow_presets"),
    buildScopeComparisonGroup(entries),
    {
      key: "required-packages",
      title: "Required packages",
      description:
        "Package requirements stay explicit so preset comparison does not become a black box.",
      rows: requiredPackageLabels.map((label) => ({
        key: `required-package-${label}`,
        label,
        hint: "Required package in the preset design.",
        cells: entries.map((entry) =>
          entry.requiredPackageLabels.includes(label)
            ? {
              tone: "granted",
              label: "Required",
              hint: "Preset depends on this package.",
            }
            : {
              tone: "not_granted",
              label: "Not required",
              hint: "Package is not part of this preset.",
            }
        ),
      })),
    },
    {
      key: "typical-actors",
      title: "Typical actors",
      description:
        "Business-readable actors remain visible even when admins are comparing the underlying package flow.",
      rows: typicalActorLabels.map((label) => ({
        key: `typical-actor-${label}`,
        label,
        hint: "Business-facing actor guidance.",
        cells: entries.map((entry) =>
          entry.typicalActorLabels.includes(label)
            ? {
              tone: "linked",
              label: "Actor",
              hint: "Typical actor documented for this preset.",
            }
            : {
              tone: "not_granted",
              label: "Not listed",
              hint: "Actor is not documented for this preset.",
            }
        ),
      })),
    },
    {
      key: "ordered-steps",
      title: "Ordered steps",
      description:
        "Step-level comparison keeps the business flow readable without forcing admins into the workflow builder.",
      rows: stepRows.map((stepRow) => ({
        key: `step-${stepRow.key}`,
        label: stepRow.label,
        hint: stepRow.hint,
        cells: entries.map((entry) => {
          const matchingStep = entry.steps.find(
            (step) =>
              `${step.actionLabel}::${step.scopeType}::${step.requiredPackageCode}` === stepRow.key
          );
          return matchingStep
            ? {
              tone: "granted",
              label: `Step ${matchingStep.stepNo}`,
              hint: `${matchingStep.scopeType} / ${matchingStep.requiredPackageLabel}`,
            }
            : {
              tone: "not_granted",
              label: "Not included",
              hint: "This preset does not include the step.",
            };
        }),
      })),
    },
  ].filter((group) => group.rows.length > 0);
}

function buildComparisonGroups(entries, tabKey) {
  if (tabKey === "business_roles") {
    return buildBusinessRoleMatrixGroups(entries);
  }
  if (tabKey === "workflow_packages") {
    return buildWorkflowPackageMatrixGroups(entries);
  }
  if (tabKey === "workflow_presets") {
    return buildWorkflowPresetMatrixGroups(entries);
  }
  return [];
}

function getMatrixToneConfig(tone) {
  if (tone === "granted") {
    return {
      badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
      panel: "border-emerald-100 bg-emerald-50/70",
    };
  }
  if (tone === "not_granted") {
    return {
      badge: "border-slate-200 bg-slate-50 text-slate-600",
      panel: "border-slate-200 bg-slate-50/80",
    };
  }
  if (tone === "companion_only") {
    return {
      badge: "border-sky-200 bg-sky-50 text-sky-800",
      panel: "border-sky-100 bg-sky-50/75",
    };
  }
  if (tone === "linked") {
    return {
      badge: "border-indigo-200 bg-indigo-50 text-indigo-800",
      panel: "border-indigo-100 bg-indigo-50/75",
    };
  }
  if (tone === "suggested") {
    return {
      badge: "border-cyan-200 bg-cyan-50 text-cyan-800",
      panel: "border-cyan-100 bg-cyan-50/70",
    };
  }
  if (tone === "optional") {
    return {
      badge: "border-violet-200 bg-violet-50 text-violet-800",
      panel: "border-violet-100 bg-violet-50/75",
    };
  }
  return {
    badge: "border-slate-200 bg-white text-slate-700",
    panel: "border-slate-200 bg-white",
  };
}

function AccessModelViewButton({ active, label, note, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className={`mt-1 text-xs leading-5 ${active ? "text-slate-300" : "text-slate-500"}`}>
        {note}
      </div>
    </button>
  );
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
    <div className="grid gap-4 xl:grid-cols-2">
      {entries.map((entry) => {
        const isSelected = selectedEntryCode === entry.code;
        return (
          <CatalogCardShell
            key={entry.code}
            active={isSelected}
            entry={entry}
            icon={<Shield className="h-5 w-5" />}
            onOpen={() => onOpen(entry.code)}
            title={entry.displayName}
            description={entry.description}
            footerNote={`Business role name: ${entry.displayName}`}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <CatalogMetric
                label="Default scope"
                value={entry.defaultScope || "-"}
                note="Business role name remains non-authoritative."
              />
              <CatalogMetric
                label="Starter packages"
                value={entry.starterPackageLabels.length}
                note="Suggestions only."
              />
              <CatalogMetric
                label="Active / Hidden"
                value={getStatusLabel(entry)}
                note={
                  entry.hiddenFromPicker
                    ? "Hidden from fresh-tenant pickers."
                    : "Shown in fresh-tenant pickers."
                }
              />
            </div>
            <div
              className={`rounded-2xl border px-4 py-4 ${
                isSelected ? "border-white/20 bg-white/10" : "border-slate-200 bg-white/80"
              }`}
            >
              <div
                className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                  isSelected ? "text-slate-300" : "text-slate-500"
                }`}
              >
                Suggested starter packages
              </div>
              <div className="mt-3">
                <MetadataPillList
                  values={getPreviewValues(entry.starterPackageLabels, 3)}
                  emptyLabel="No starter packages are suggested for this role."
                />
              </div>
              <div
                className={`mt-3 text-xs leading-5 ${
                  isSelected ? "text-slate-300" : "text-slate-500"
                }`}
              >
                Suggestions only. Package assignment at scope is still what grants authority.
              </div>
            </div>
          </CatalogCardShell>
        );
      })}
    </div>
  );
}

function WorkflowPackageCatalogTable({ entries, selectedEntryCode, onOpen }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const isSelected = selectedEntryCode === entry.code;
        return (
          <CatalogCardShell
            key={entry.code}
            active={isSelected}
            entry={entry}
            icon={<Package className="h-5 w-5" />}
            onOpen={() => onOpen(entry.code)}
            title={entry.displayName}
            description={entry.description}
            footerNote={`Package name: ${entry.displayName}`}
          >
            <div className="grid gap-3 md:grid-cols-4">
              <CatalogMetric
                label="Allowed scopes"
                value={entry.allowedScopes.length}
                note={entry.defaultScope || "No default scope"}
              />
              <CatalogMetric
                label="Underlying permission codes"
                value={entry.permissionCount}
                note="Authority comes from package-backed permissions."
              />
              <CatalogMetric
                label="Used in presets"
                value={entry.usedInPresetLabels.length}
                note={entry.plannedExtension ? "Extension-aware rollout." : "Shipped preset coverage."}
              />
              <CatalogMetric
                label="Current runtime sources"
                value={entry.runtimeRoleLabels.length + entry.helperBundleLabels.length}
                note="Runtime roles + helper bundles"
              />
            </div>
            <div
              className={`grid gap-4 rounded-2xl border px-4 py-4 ${
                isSelected ? "border-white/20 bg-white/10" : "border-slate-200 bg-white/80"
              } lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]`}
            >
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                    isSelected ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  Current runtime sources
                </div>
                <div className={`mt-2 text-sm font-semibold ${isSelected ? "text-white" : "text-slate-900"}`}>
                  {entry.runtimeMappingLabel}
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={getPreviewValues([...entry.runtimeRoleLabels, ...entry.helperBundleLabels], 4)}
                    emptyLabel="No runtime source is documented yet."
                  />
                </div>
              </div>
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                    isSelected ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  Permission modules
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={buildPermissionModuleGroups(entry.permissionCodes).map((group) => group.moduleLabel)}
                    emptyLabel="No permission codes are mapped yet."
                  />
                </div>
              </div>
            </div>
          </CatalogCardShell>
        );
      })}
    </div>
  );
}

function WorkflowPresetCatalogTable({ entries, selectedEntryCode, onOpen }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const isSelected = selectedEntryCode === entry.code;
        const stepPreview = Array.isArray(entry.steps)
          ? entry.steps.map((step) => `Step ${step.stepNo}: ${step.actionLabel}`)
          : [];
        return (
          <CatalogCardShell
            key={entry.code}
            active={isSelected}
            entry={entry}
            icon={<Workflow className="h-5 w-5" />}
            onOpen={() => onOpen(entry.code)}
            title={entry.displayName}
            description={entry.description}
            footerNote={`Preset name: ${entry.displayName}`}
          >
            <div className="grid gap-3 md:grid-cols-4">
              <CatalogMetric
                label="Primary scope"
                value={entry.primaryScope || "-"}
                note="Business-readable flow anchor."
              />
              <CatalogMetric
                label="Step count"
                value={entry.stepCount}
                note={entry.stepCount === 1 ? "Single-step preset" : "Ordered business flow"}
              />
              <CatalogMetric
                label="Typical actors"
                value={entry.typicalActorLabels.length}
                note="Business titles only."
              />
              <CatalogMetric
                label="Uses extension?"
                value={entry.usesExtensionLabel}
                note={
                  entry.draft
                    ? "Draft-only preset definition."
                    : "Ready-made business-readable preset."
                }
              />
            </div>
            <div
              className={`grid gap-4 rounded-2xl border px-4 py-4 ${
                isSelected ? "border-white/20 bg-white/10" : "border-slate-200 bg-white/80"
              } lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`}
            >
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                    isSelected ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  Typical actors
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={getPreviewValues(entry.typicalActorLabels, 4)}
                    emptyLabel="No typical actors are documented."
                  />
                </div>
              </div>
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                    isSelected ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  Step preview
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={getPreviewValues(stepPreview, 3)}
                    emptyLabel="No ordered steps are documented."
                  />
                </div>
              </div>
            </div>
          </CatalogCardShell>
        );
      })}
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

function CatalogMetric({ label, value, note, valueTone = "text-slate-900" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-lg font-semibold ${valueTone}`}>{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div> : null}
    </div>
  );
}

function CatalogScopeCoverage({ entry, compact = false }) {
  const activeScopes = getScopeCoverage(entry);
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {SCOPE_LEVEL_ORDER.map((scopeType) => {
        const active = activeScopes.has(scopeType);
        return (
          <span
            key={`${entry.code}-${scopeType}`}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              active
                ? "border-slate-300 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-300"
            }`}
          >
            {formatScopeLabel(scopeType)}
          </span>
        );
      })}
    </div>
  );
}

function CatalogFamilyFilterRail({ entries, familyFilter, onSelect }) {
  const familyCounts = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const familyCode = normalizeText(entry.workflowFamily).toUpperCase() || "CROSS_WORKFLOW";
    familyCounts.set(familyCode, toCount(familyCounts.get(familyCode)) + 1);
  });
  const visibleFamilyCodes = WORKFLOW_FAMILY_ORDER.filter(
    (familyCode) => toCount(familyCounts.get(familyCode)) > 0
  );

  return (
    <aside className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Browse by workflow family
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-600">
        Domain-colored sidebar filter for the catalog. Start with one family, then open the detail
        drawer for the exact role, package, or preset meaning.
      </div>
      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => onSelect(FILTER_ALL)}
          className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition ${
            familyFilter === FILTER_ALL
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          }`}
        >
          <span>All workflow families</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
            {entries.length}
          </span>
        </button>
        {visibleFamilyCodes.map((familyCode) => {
          const theme = getWorkflowFamilyTheme(familyCode);
          const active = familyFilter === familyCode;
          return (
            <button
              key={familyCode}
              type="button"
              onClick={() => onSelect(familyCode)}
              className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition ${
                active
                  ? `${theme.chip} shadow-sm`
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span>
                {entries.find((entry) => entry.workflowFamily === familyCode)?.workflowFamilyLabel ||
                  familyCode}
              </span>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">
                {toCount(familyCounts.get(familyCode))}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function CatalogCardShell({
  active,
  entry,
  icon,
  onOpen,
  title,
  description,
  children,
  footerNote = "",
}) {
  const theme = getWorkflowFamilyTheme(entry.workflowFamily);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-[28px] border px-5 py-5 text-left transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-300/50"
          : `${theme.panel} text-slate-900 hover:border-slate-300`
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`rounded-2xl border p-3 ${
              active
                ? "border-white/20 bg-white/10 text-white"
                : theme.icon
            }`}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <div
              className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                active ? "text-slate-300" : "text-slate-500"
              }`}
            >
              {entry.categoryLabel}
            </div>
            <div className="mt-2 text-lg font-semibold leading-tight">{title}</div>
            <div
              className={`mt-2 text-sm leading-6 ${
                active ? "text-slate-200" : "text-slate-600"
              }`}
            >
              {description}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
              active ? "border-white/20 bg-white/10 text-white" : theme.chip
            }`}
          >
            {entry.workflowFamilyLabel}
          </span>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
              active ? "border-white/20 bg-white/10 text-white" : getStatusClasses(entry)
            }`}
          >
            {getStatusLabel(entry)}
          </span>
        </div>
      </div>
      <CatalogScopeCoverage entry={entry} />
      <div className="mt-4 space-y-4">{children}</div>
      <div
        className={`mt-4 flex items-center justify-between text-xs ${
          active ? "text-slate-300" : "text-slate-500"
        }`}
      >
        <span>{footerNote || entry.code}</span>
        <span className="inline-flex items-center gap-1 font-semibold">
          Open detail
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

function MatrixLegend() {
  const items = [
    { tone: "granted", label: "Granted" },
    { tone: "not_granted", label: "Not granted" },
    { tone: "companion_only", label: "Companion-only" },
    { tone: "linked", label: "Linked" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const tone = getMatrixToneConfig(item.tone);
        return (
          <span
            key={item.label}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.badge}`}
          >
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

function MatrixCandidatePicker({
  entries,
  compareEntryCodes,
  onReset,
  onToggle,
  selectedEntryCode,
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Compare matrix
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">Select up to 4 items</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Matrix comparison is for side-by-side review only. The browse cards and detail drawer
            remain the primary path for understanding one role, package, preset, or catalog row.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {compareEntryCodes.length} / {ACCESS_MODEL_MATRIX_COMPARE_LIMIT} selected
          </span>
          <button
            type="button"
            onClick={onReset}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Reset selection
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {entries.map((entry) => {
          const active = compareEntryCodes.includes(entry.code);
          const atLimit =
            !active && compareEntryCodes.length >= ACCESS_MODEL_MATRIX_COMPARE_LIMIT;
          return (
            <button
              key={entry.code}
              type="button"
              disabled={atLimit}
              onClick={() => onToggle(entry.code)}
              className={`rounded-2xl border px-4 py-4 text-left transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                  : atLimit
                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${active ? "text-slate-300" : "text-slate-500"}`}>
                    {entry.categoryLabel}
                  </div>
                  <div className="mt-2 text-sm font-semibold">{entry.displayName}</div>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    active
                      ? "border-white/20 bg-white/10 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {active ? "Selected" : "Compare"}
                </span>
              </div>
              <div className={`mt-2 text-xs leading-5 ${active ? "text-slate-300" : "text-slate-500"}`}>
                {entry.workflowFamilyLabel} / {entry.defaultScope || entry.primaryScope || "-"} /{" "}
                {getStatusLabel(entry)}
              </div>
              {selectedEntryCode === entry.code ? (
                <div className={`mt-3 text-xs font-semibold ${active ? "text-slate-200" : "text-sky-700"}`}>
                  Current drawer selection
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WorkflowRoutingMatrixCallout({ compareEntries, currentTab }) {
  if (
    (currentTab !== "workflow_packages" && currentTab !== "workflow_presets") ||
    compareEntries.length === 0
  ) {
    return null;
  }

  const comparedFamilies = Array.from(
    new Set(compareEntries.map((entry) => normalizeText(entry.workflowFamily)).filter(Boolean))
  );
  const includesApRouting = comparedFamilies.includes("AP_DOCUMENT_POSTING");

  return (
    <section className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Workflow assignment routing visibility
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            Amount-band routing stays reachable from matrix context
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {includesApRouting
              ? "AP amount band routing rules live in workflow governance. Use the routing matrix to review min/max amount thresholds, priority, fallback, and which assignment resolves for a given scope plus amount combination."
              : "Detailed workflow assignment resolution still lives in workflow governance and diagnostics. Use those surfaces when this comparison raises routing questions that the catalog should not answer by itself."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {comparedFamilies.map((familyCode) => (
              <span
                key={familyCode}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getWorkflowFamilyTheme(familyCode).chip}`}
              >
                {compareEntries.find((entry) => entry.workflowFamily === familyCode)?.workflowFamilyLabel ||
                  familyCode}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/app/ayarlar/security-admin/workflows?tab=definitions"
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Open workflow routing matrix
          </Link>
          <Link
            to="/app/ayarlar/security-admin/diagnostics?tab=access"
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Open access debugger
          </Link>
        </div>
      </div>
    </section>
  );
}

function AccessModelComparisonMatrix({ compareEntries, currentTab, onOpenDetail }) {
  const comparisonGroups = buildComparisonGroups(compareEntries, currentTab);

  if (compareEntries.length === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
        No comparison rows are available for the current filters.
      </div>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Matrix comparison
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            Side-by-side comparison without replacing browse mode
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Compare cross-role or cross-package differences here, then open the detail drawer for
            the full explanation of one selected item.
          </p>
        </div>
        <MatrixLegend />
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-[980px] w-full border-separate border-spacing-y-3">
          <thead>
            <tr>
              <th className="w-[260px] px-3 pb-2 text-left align-bottom text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Signal
              </th>
              {compareEntries.map((entry) => (
                <th key={`header-${entry.code}`} className="px-3 pb-2 align-bottom">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {entry.categoryLabel}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-950">
                          {entry.displayName}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {entry.workflowFamilyLabel} / {entry.defaultScope || entry.primaryScope || "-"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenDetail(entry.code)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        Open detail
                      </button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparisonGroups.map((group) => (
              <Fragment key={group.key}>
                <tr>
                  <td colSpan={compareEntries.length + 1} className="px-3 pt-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {group.title}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">{group.description}</div>
                    </div>
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={`${group.key}-${row.key}`}>
                    <th className="px-3 align-top">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left">
                        <div className="text-sm font-semibold text-slate-900">{row.label}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">{row.hint}</div>
                      </div>
                    </th>
                    {row.cells.map((cell, index) => {
                      const tone = getMatrixToneConfig(cell.tone);
                      return (
                        <td key={`${group.key}-${row.key}-${compareEntries[index]?.code || index}`} className="px-3 align-top">
                          <div className={`rounded-2xl border px-4 py-4 ${tone.panel}`}>
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.badge}`}
                            >
                              {cell.label}
                            </span>
                            {cell.hint ? (
                              <div className="mt-2 text-xs leading-5 text-slate-600">{cell.hint}</div>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PermissionModuleGroupList({ permissionCodes, emptyLabel }) {
  const groups = buildPermissionModuleGroups(permissionCodes);
  if (groups.length === 0) {
    return <div className="text-sm text-slate-500">{emptyLabel}</div>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.moduleKey}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {group.moduleLabel}
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {group.permissions.map((permission) => (
              <div
                key={permission.code}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{permission.code}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    {permission.actionLabel} access for {group.moduleLabel}.
                  </div>
                </div>
                {permission.requiresRead ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                    Requires READ
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccessModelDetailDrawer({ entry, open, onClose }) {
  if (!open || !entry) {
    return null;
  }

  const theme = getWorkflowFamilyTheme(entry.workflowFamily);

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
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${theme.chip}`}>
              {entry.workflowFamilyLabel}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
              {entry.modelTypeLabel}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
              {entry.categoryLabel}
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

          <section className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Scope coverage
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-600">
              Scope level pills show where this business role, package, or preset is expected to operate.
            </div>
            <CatalogScopeCoverage entry={entry} />
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
                  to="/app/ayarlar/security-admin/workflows?tab=definitions"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Open workflow governance
                </Link>
                <Link
                  to="/app/ayarlar/security-admin/users?tab=assignments"
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
                Current runtime sources
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">{entry.runtimeMappingLabel}</div>
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Helper bundle sources
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
                  Runtime role sources
                </div>
                <div className="mt-3">
                  <MetadataPillList
                    values={entry.runtimeRoleLabels}
                    emptyLabel="No runtime role source is documented for this package yet."
                  />
                </div>
              </div>
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
                  Permissions grouped by module
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  Module groups keep package meaning readable before anyone drops into the current
                  role editor.
                </div>
                <div className="mt-4">
                  <PermissionModuleGroupList
                    permissionCodes={entry.permissionCodes}
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
                    className={`rounded-2xl border px-4 py-4 ${theme.softPanel}`}
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
 * Builds the access-model shell so admins can browse business roles,
 * workflow packages, and workflow presets from one tabbed catalog surface.
 */
export default function AccessModelCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sections = listAccessModelCatalogSections();
  const currentView = ACCESS_MODEL_VIEW_ORDER.includes(searchParams.get("view"))
    ? searchParams.get("view")
    : ACCESS_MODEL_VIEW_ORDER[0];
  const isMatrixView = currentView === "matrix";
  const currentModelTab = ACCESS_MODEL_TAB_ORDER.includes(searchParams.get("modelTab"))
    ? searchParams.get("modelTab")
    : ACCESS_MODEL_TAB_ORDER[0];
  const isBusinessRolesTab = currentModelTab === "business_roles";
  const isWorkflowPackagesTab = currentModelTab === "workflow_packages";
  const isWorkflowPresetsTab = currentModelTab === "workflow_presets";
  const currentSection =
    sections.find((section) => section.key === currentModelTab) || sections[0] || null;
  const searchValue = normalizeText(searchParams.get("q"));
  const scopeFilter = normalizeText(searchParams.get("scope")).toUpperCase() || FILTER_ALL;
  const familyFilter = normalizeText(searchParams.get("family")).toUpperCase() || FILTER_ALL;
  const selectedEntryCode = normalizeText(searchParams.get("item"));
  const currentEntries = currentSection?.entries || [];
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
  const defaultCompareEntryCodes = buildDefaultCompareCodes(filteredEntries, selectedEntryCode);
  const rawCompareEntryCodes = parseMatrixCompareCodes(searchParams.get("compare"), filteredEntries);
  const compareEntryCodes =
    rawCompareEntryCodes.length > 0 ? rawCompareEntryCodes : defaultCompareEntryCodes;
  const compareEntries = compareEntryCodes
    .map((entryCode) =>
      filteredEntries.find((entry) => normalizeText(entry.code) === entryCode) || null
    )
    .filter(Boolean);
  const selectedEntry =
    currentEntries.find((entry) => normalizeText(entry.code) === selectedEntryCode) || null;
  const currentActionLink =
    currentModelTab === "workflow_packages" || currentModelTab === "workflow_presets"
      ? {
        to: "/app/ayarlar/security-admin/workflows?tab=definitions",
        label: "Open workflow governance",
      }
      : {
        to: "/app/ayarlar/security-admin/catalog?tab=roles",
        label: "Open roles & permissions",
      };

  const activeCount = currentEntries.filter((entry) => !entry.hiddenFromPicker).length;
  const hiddenCount = currentEntries.filter((entry) => entry.hiddenFromPicker).length;
  const extensionCount = currentEntries.filter((entry) => entry.plannedExtension).length;
  const draftCount = currentEntries.filter((entry) => entry.draft).length;
  const accessModelEntryCount = sections.reduce(
    (total, section) => total + section.entries.length,
    0
  );

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="catalog"
      sectionKey="access-model"
      eyebrow="Security / Access Model"
      title="Access Model"
      description="Browse the separated catalog for business roles, workflow packages, and workflow presets. This shell keeps the fresh-tenant security model focused on steady-state assignment paths."
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
              : `${activeCount - draftCount} active / ${draftCount} draft`,
          description: isBusinessRolesTab
            ? "Business roles stay human-friendly and separate from authority packages."
            : isWorkflowPackagesTab
              ? "Runtime mappings show how clean packages sit on top of current seeded roles."
              : "Presets stay readable as business flows before any tenant-specific workflow customization.",
        },
        {
          title: isMatrixView ? "Matrix compare" : "Detail drawer",
          value: isMatrixView ? `${compareEntries.length} selected` : selectedEntry?.displayName || "No item selected",
          description: isMatrixView
            ? "Matrix stays secondary to the browse cards and detail drawer."
            : "The right-side drawer follows the current catalog row selection.",
        },
      ]}
      toolbar={
        <>
          <SecurityCatalogWorkbenchTabs
            activeTab="access-model"
            counts={{ "access-model": accessModelEntryCount }}
          />
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
                    active={section.key === currentModelTab}
                    count={section.entries.length}
                    label={section.label}
                    onClick={() =>
                      setSearchParams(
                        updateSearchParams(searchParams, {
                          modelTab: section.key,
                          item: "",
                          compare: isMatrixView
                            ? joinMatrixCompareCodes(buildDefaultCompareCodes(section.entries))
                            : "",
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

            <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)]">
              <AccessModelViewButton
                active={!isMatrixView}
                label="Browse mode"
                note="Cards and the drawer stay primary for understanding one item."
                onClick={() =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      view: "",
                      compare: "",
                    })
                  )
                }
              />
              <AccessModelViewButton
                active={isMatrixView}
                label="Compare matrix"
                note="Side-by-side comparison for roles, packages, or presets."
                onClick={() =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      view: "matrix",
                      compare: joinMatrixCompareCodes(
                        compareEntryCodes.length > 0
                          ? compareEntryCodes
                          : buildDefaultCompareCodes(filteredEntries, selectedEntryCode)
                      ),
                    })
                  )
                }
              />
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
                placeholder={getSearchPlaceholder(currentModelTab)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 lg:col-span-2"
              />
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
                    to="/app/ayarlar/security-admin/users?tab=assignments"
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
                    to current runtime roles and helper bundles.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    to="/app/ayarlar/security-admin/workflows?tab=definitions"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open workflow governance
                  </Link>
                  <Link
                    to="/app/ayarlar/security-admin/catalog?tab=roles"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open roles & permissions
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
                    to="/app/ayarlar/security-admin/workflows?tab=definitions"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open workflow governance
                  </Link>
                  <Link
                    to="/app/ayarlar/security-admin/catalog?tab=access-model&modelTab=workflow_packages"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open workflow packages
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

      <section className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <CatalogFamilyFilterRail
          entries={currentEntries}
          familyFilter={familyFilter}
          onSelect={(familyCode) =>
            setSearchParams(
              updateSearchParams(searchParams, {
                family: familyCode,
              })
            )
          }
        />
        <div className="space-y-4">
          {filteredEntries.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
              No catalog rows match the current filters.
            </div>
          ) : isMatrixView ? (
            <>
              <MatrixCandidatePicker
                entries={filteredEntries}
                compareEntryCodes={compareEntryCodes}
                selectedEntryCode={selectedEntryCode}
                onReset={() =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      compare: joinMatrixCompareCodes(
                        buildDefaultCompareCodes(filteredEntries, selectedEntryCode)
                      ),
                    })
                  )
                }
                onToggle={(entryCode) =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      compare: joinMatrixCompareCodes(
                        buildNextMatrixCompareCodes(compareEntryCodes, entryCode)
                      ),
                    })
                  )
                }
              />
              <WorkflowRoutingMatrixCallout
                compareEntries={compareEntries}
                currentTab={currentModelTab}
              />
              <AccessModelComparisonMatrix
                compareEntries={compareEntries}
                currentTab={currentModelTab}
                onOpenDetail={(entryCode) =>
                  setSearchParams(
                    updateSearchParams(searchParams, {
                      item: entryCode,
                    })
                  )
                }
              />
            </>
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
          ) : null}
        </div>
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
