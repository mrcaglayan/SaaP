const CATEGORY_LABELS = Object.freeze({
  system: "System administration",
  composable: "Composable duty-boundary",
  scoped: "Scoped operations",
  readonly: "Read-only",
  legacy: "Retired compatibility",
  custom: "Custom tenant role",
});

const ROLE_CATALOG = Object.freeze({
  TenantAdmin: {
    category: "legacy",
    summary:
      "Retired compatibility admin role preserved only for migration rollback and historical review. Fresh tenants use SecurityAdmin plus SystemAdmin.",
    capabilities: ["Security admin", "System operations", "Compatibility bootstrap"],
    recommendedScopes: ["TENANT"],
    legacy: true,
  },
  SecurityAdmin: {
    category: "system",
    summary:
      "Manages roles, assignments, scopes, and security-facing audit surfaces.",
    capabilities: ["Role governance", "Access administration", "Security audit"],
    recommendedScopes: ["TENANT"],
  },
  SystemAdmin: {
    category: "system",
    summary:
      "Manages onboarding, workflow governance, jobs, retention, and broader operational controls.",
    capabilities: [
      "Ops jobs",
      "Onboarding controls",
      "Workflow governance",
      "Retention operations",
    ],
    recommendedScopes: ["TENANT"],
  },
  LocalUserAdmin: {
    category: "composable",
    summary:
      "Invites and manages allow-listed local operational roles without opening tenant-wide security administration.",
    capabilities: ["Scoped invites", "Allow-listed local roles", "Local assignment review"],
    recommendedScopes: ["COUNTRY", "LEGAL_ENTITY"],
  },
  MasterDataSteward: {
    category: "composable",
    summary:
      "Owns organizational, accounting, and counterparty master data review without taking posting authority.",
    capabilities: ["Org structure", "GL master data", "Counterparty request review"],
    recommendedScopes: ["GROUP", "COUNTRY", "LEGAL_ENTITY"],
  },
  CounterpartyCardEditor: {
    category: "composable",
    summary:
      "Maintains live customer/vendor cards and exceptional AP/AR control-account overrides without broad review or posting authority.",
    capabilities: [
      "Live card maintenance",
      "Counterparty account overrides",
      "Counterparty payment-term editing",
    ],
    recommendedScopes: ["LEGAL_ENTITY"],
  },
  EntityAPController: {
    category: "composable",
    summary:
      "Reviews, edits, and submits AP documents at legal-entity scope without inheriting country-level final posting authority.",
    capabilities: ["AP review", "AP draft correction", "AP workflow submit"],
    recommendedScopes: ["LEGAL_ENTITY"],
  },
  CountryAPApprover: {
    category: "composable",
    summary:
      "Country-scoped AP reviewer that reads governed AP documents while approve/return authority comes from workflow-step assignment.",
    capabilities: ["Country AP visibility", "Workflow review step", "AP return/approve via workflow"],
    recommendedScopes: ["COUNTRY"],
  },
  CountryAPPoster: {
    category: "composable",
    summary:
      "Country-scoped final AP posting role kept separate from workflow approval so posting authority can be assigned independently.",
    capabilities: ["Country AP visibility", "AP final post", "AP reverse"],
    recommendedScopes: ["COUNTRY"],
  },
  APDocumentPoster: {
    category: "legacy",
    summary:
      "Retired compatibility AP role preserved for brownfield migration and rollback while tenants move to EntityAPController plus country-scoped AP final roles.",
    capabilities: ["Compatibility AP submit", "Compatibility AP cancel", "Compatibility AP posting"],
    recommendedScopes: ["LEGAL_ENTITY"],
    legacy: true,
  },
  GLOperator: {
    category: "composable",
    summary:
      "Runs GL operations and reporting without free-form manual posting authority.",
    capabilities: ["Journal drafting", "Ledger visibility", "Period operations"],
    recommendedScopes: ["COUNTRY", "LEGAL_ENTITY"],
  },
  GLPostingAuthority: {
    category: "composable",
    summary:
      "Companion authority for manual journal post, reversal, and period close. Pair it with a read-bearing accounting role.",
    capabilities: ["Manual posting", "Manual reversal", "Period close"],
    recommendedScopes: ["COUNTRY", "LEGAL_ENTITY"],
    companionOnly: true,
    companionNote:
      "Pair with GLOperator or another read-bearing accounting role at the same or broader scope.",
  },
  ShareholderCapitalOperator: {
    category: "composable",
    summary:
      "Posts and reverses shareholder capital fulfillment without broader org master-data or treasury governance powers.",
    capabilities: ["Equity funding", "Capital fulfillment", "Posting control"],
    recommendedScopes: ["LEGAL_ENTITY"],
  },
  OUAccountant: {
    category: "composable",
    summary:
      "Optional operating-unit accounting role for OUs that truly own local accounting adjustments.",
    capabilities: ["OU accounting exceptions", "Operational GL work"],
    recommendedScopes: ["OPERATING_UNIT"],
  },
  TreasuryOperator: {
    category: "composable",
    summary:
      "Operates bank, cash, and settlement workflows without treasury approval power.",
    capabilities: ["Cash operations", "Bank operations", "Settlement handling"],
    recommendedScopes: ["LEGAL_ENTITY"],
  },
  TreasuryApprover: {
    category: "composable",
    summary:
      "Approves bank and treasury governance flows without becoming the operational maker.",
    capabilities: ["Bank governance", "Payment approval", "Cash variance approval"],
    recommendedScopes: ["COUNTRY"],
  },
  PayrollOperator: {
    category: "composable",
    summary:
      "Runs payroll preparation and operations without payroll governance approval power.",
    capabilities: ["Payroll operations", "Payroll ownership", "Payroll preparation"],
    recommendedScopes: ["LEGAL_ENTITY"],
  },
  PayrollApprover: {
    category: "composable",
    summary:
      "Approves payroll governance actions while keeping review authority separate from payroll operations.",
    capabilities: ["Payroll governance", "Run review", "Close approval"],
    recommendedScopes: ["COUNTRY"],
  },
  LocalClosePreparer: {
    category: "composable",
    summary:
      "Prepares local close work and reopen requests without reviewer authority.",
    capabilities: ["Close preparation", "Close submission", "Reopen requests"],
    recommendedScopes: ["LEGAL_ENTITY"],
  },
  LocalCloseReviewer: {
    category: "composable",
    summary:
      "Reviews and approves local close governance steps without becoming the close preparer.",
    capabilities: ["Close review", "Close approval", "Close locking"],
    recommendedScopes: ["COUNTRY"],
  },
  GroupReportingController: {
    category: "composable",
    summary:
      "Owns consolidation, intercompany, and group reporting responsibilities.",
    capabilities: ["Consolidation", "Intercompany control", "Group reporting"],
    recommendedScopes: ["GROUP"],
  },
  AuditorReadOnly: {
    category: "readonly",
    summary:
      "Read-only audit visibility across governed surfaces without operational authority.",
    capabilities: ["Read-only visibility", "Audit review", "Reporting access"],
    recommendedScopes: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"],
  },
  BranchOperator: {
    category: "scoped",
    summary:
      "Operating-unit visibility and operational-document role for draft creation, editing, and cancellation. It is not a free-form manual posting role.",
    capabilities: ["OU visibility", "Draft AP handling", "Operational documents"],
    recommendedScopes: ["OPERATING_UNIT"],
  },
  GroupController: {
    category: "legacy",
    summary:
      "Retired compatibility reporting role preserved only for migration rollback and historical review.",
    capabilities: ["Broad reporting", "Legacy close review", "Compatibility"],
    recommendedScopes: ["GROUP"],
    legacy: true,
  },
  CountryController: {
    category: "legacy",
    summary:
      "Retired compatibility country-wide controller role preserved only for migration rollback and historical review.",
    capabilities: ["Broad governance", "GL posting", "Treasury and payroll approval"],
    recommendedScopes: ["COUNTRY"],
    legacy: true,
  },
  EntityAccountant: {
    category: "legacy",
    summary:
      "Retired compatibility entity-wide accounting role preserved only for migration rollback and historical review.",
    capabilities: ["Broad entity operations", "Legacy GL operations", "Compatibility"],
    recommendedScopes: ["LEGAL_ENTITY"],
    legacy: true,
  },
});

export const BOOTSTRAP_HANDOFF_PRESET_CATALOG = Object.freeze({
  EntitySetupManager: Object.freeze({
    code: "EntitySetupManager",
    summary:
      "Bootstrap preset for one legal-entity setup lead using bounded composable operator roles.",
    scopeType: "LEGAL_ENTITY",
    roleCodes: Object.freeze([
      "LocalUserAdmin",
      "MasterDataSteward",
      "CounterpartyCardEditor",
      "EntityAPController",
      "GLOperator",
      "TreasuryOperator",
      "PayrollOperator",
      "LocalClosePreparer",
      "ShareholderCapitalOperator",
    ]),
    optionalRoleCodes: Object.freeze(["GLPostingAuthority"]),
  }),
  CountryFinanceSetupManager: Object.freeze({
    code: "CountryFinanceSetupManager",
    summary:
      "Bootstrap preset for one country-level finance reviewer using bounded composable AP, treasury, payroll, and close-review roles.",
    scopeType: "COUNTRY",
    roleCodes: Object.freeze([
      "CountryAPApprover",
      "CountryAPPoster",
      "GLOperator",
      "TreasuryApprover",
      "PayrollApprover",
      "LocalCloseReviewer",
    ]),
    optionalRoleCodes: Object.freeze(["GLPostingAuthority"]),
  }),
});

const CATEGORY_ORDER = Object.freeze([
  "composable",
  "scoped",
  "readonly",
  "system",
  "legacy",
  "custom",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

/**
 * Returns the UX metadata for one bootstrap handoff preset.
 */
export function getBootstrapHandoffPresetEntry(presetCode) {
  const normalizedPresetCode = normalizeText(presetCode);
  const base = BOOTSTRAP_HANDOFF_PRESET_CATALOG[normalizedPresetCode] || null;
  return {
    code: normalizedPresetCode,
    summary:
      base?.summary ||
      "Bootstrap preset. Review included composable roles before assigning it broadly.",
    scopeType: base?.scopeType || "",
    roleCodes: [...(base?.roleCodes || [])],
    optionalRoleCodes: [...(base?.optionalRoleCodes || [])],
  };
}

/**
 * Returns the UX metadata used to explain a role in admin surfaces.
 */
export function getRoleCatalogEntry(roleOrCode) {
  const roleCode =
    typeof roleOrCode === "string"
      ? normalizeText(roleOrCode)
      : normalizeText(roleOrCode?.code);
  const base = ROLE_CATALOG[roleCode] || null;

  return {
    code: roleCode || normalizeText(roleOrCode?.roleCode),
    category: base?.category || "custom",
    categoryLabel: CATEGORY_LABELS[base?.category || "custom"] || CATEGORY_LABELS.custom,
    summary:
      base?.summary ||
      "Tenant-local role. Review its permission set carefully before assigning it broadly.",
    capabilities: [...(base?.capabilities || ["Tenant-specific permissions"])],
    recommendedScopes: [...(base?.recommendedScopes || [])],
    companionOnly: Boolean(base?.companionOnly),
    companionNote: base?.companionNote || "",
    legacy: Boolean(base?.legacy),
  };
}

/**
 * Sorts roles into a stable management order with composable roles first and legacy roles last.
 */
export function sortRolesForManagement(roles) {
  const safeRoles = Array.isArray(roles) ? roles : [];
  return [...safeRoles].sort((left, right) => {
    const leftEntry = getRoleCatalogEntry(left);
    const rightEntry = getRoleCatalogEntry(right);
    const leftCategoryIndex = CATEGORY_ORDER.indexOf(leftEntry.category);
    const rightCategoryIndex = CATEGORY_ORDER.indexOf(rightEntry.category);
    if (leftCategoryIndex !== rightCategoryIndex) {
      return leftCategoryIndex - rightCategoryIndex;
    }
    return normalizeText(left.code).localeCompare(normalizeText(right.code));
  });
}

/**
 * Groups roles by the UI category used on admin role-management screens.
 */
export function groupRolesForManagement(roles) {
  const grouped = new Map();
  for (const role of sortRolesForManagement(roles)) {
    const entry = getRoleCatalogEntry(role);
    const key = entry.category;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        label: entry.categoryLabel,
        roles: [],
      });
    }
    grouped.get(key).roles.push(role);
  }
  return Array.from(grouped.values());
}

/**
 * Builds a human-readable scope label using lookup rows when available.
 */
export function buildScopeLabel(scopeType, scopeId, lookups = {}, tenantScopeId = null) {
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  const numericScopeId = Number(scopeId || 0);
  if (!numericScopeId) {
    return `${normalizedScopeType || "SCOPE"} #?`;
  }

  if (normalizedScopeType === "TENANT") {
    return numericScopeId === Number(tenantScopeId || 0)
      ? `Tenant #${numericScopeId}`
      : `Tenant #${numericScopeId}`;
  }

  const sourceRows =
    normalizedScopeType === "GROUP"
      ? lookups.groups
      : normalizedScopeType === "COUNTRY"
        ? lookups.countries
        : normalizedScopeType === "LEGAL_ENTITY"
          ? lookups.legalEntities
          : normalizedScopeType === "OPERATING_UNIT"
            ? lookups.operatingUnits
            : [];
  const matchedRow = (Array.isArray(sourceRows) ? sourceRows : []).find(
    (row) => Number(row.id) === numericScopeId
  );

  if (!matchedRow) {
    return `${normalizedScopeType} #${numericScopeId}`;
  }

  if (normalizedScopeType === "COUNTRY") {
    return `${matchedRow.iso2 || matchedRow.iso3 || numericScopeId} - ${matchedRow.name || ""}`.trim();
  }

  return `${matchedRow.code || numericScopeId} - ${matchedRow.name || ""}`.trim();
}

/**
 * Returns whether the supplied scope type matches the role's recommended assignment shape.
 */
export function isRecommendedScopeForRole(roleOrCode, scopeType) {
  const entry = getRoleCatalogEntry(roleOrCode);
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  if (!normalizedScopeType || entry.recommendedScopes.length === 0) {
    return true;
  }
  return entry.recommendedScopes.includes(normalizedScopeType);
}
