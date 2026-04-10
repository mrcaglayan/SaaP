import {
  buildScopeLabel,
  getRoleCatalogEntry,
  getWorkflowFamilyLabel,
  getWorkflowPackageCatalogEntry,
  isBusinessRoleAssignmentRoleCode,
  isWorkflowPackageAssignmentRoleCode,
  resolveWorkflowPackagesForRuntimeRoles,
} from "./roleCatalog.js";

const COVERAGE_ORDER = Object.freeze({
  EXACT: 10,
  INHERITED: 20,
  OTHER: 30,
});

const VIEW_ONLY_PACKAGE_CODES_BY_FAMILY = Object.freeze({
  CROSS_WORKFLOW: ["PKG-WF-QUEUE-VIEW"],
  AP_DOCUMENT_POSTING: ["PKG-AP-VIEW"],
  LOCAL_CLOSE_PACK: ["PKG-LC-VIEW"],
  CONSOLIDATION_RUN: ["PKG-CON-VIEW"],
});

function normalizeText(value) {
  return String(value || "").trim();
}

function interpolateTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([.\w]+)\s*\}\}/g, (_, key) => {
    const resolvedValue = values?.[key];
    return resolvedValue == null ? "" : String(resolvedValue);
  });
}

function translate(l, english, turkish, values) {
  if (typeof l === "function") {
    return l(english, turkish, values);
  }
  return interpolateTemplate(english, values);
}

function joinHumanList(values, l) {
  const safeValues = (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (safeValues.length === 0) {
    return "";
  }
  if (safeValues.length === 1) {
    return safeValues[0];
  }
  if (safeValues.length === 2) {
    return translate(l, "{{left}} and {{right}}", "{{left}} ve {{right}}", {
      left: safeValues[0],
      right: safeValues[1],
    });
  }
  return translate(l, "{{items}}, and {{last}}", "{{items}} ve {{last}}", {
    items: safeValues.slice(0, -1).join(", "),
    last: safeValues[safeValues.length - 1],
  });
}

function resolveAssignmentStatus(row) {
  const now = Date.now();
  const effectiveFrom = row?.effective_from ? new Date(row.effective_from).getTime() : null;
  const effectiveTo = row?.effective_to ? new Date(row.effective_to).getTime() : null;
  const afterStart =
    effectiveFrom === null || Number.isNaN(effectiveFrom) || effectiveFrom <= now;
  const beforeEnd =
    effectiveTo === null || Number.isNaN(effectiveTo) || effectiveTo >= now;
  if (afterStart && beforeEnd) {
    return "ACTIVE";
  }
  if (effectiveFrom !== null && !Number.isNaN(effectiveFrom) && effectiveFrom > now) {
    return "UPCOMING";
  }
  if (effectiveTo !== null && !Number.isNaN(effectiveTo) && effectiveTo < now) {
    return "EXPIRED";
  }
  return "CUSTOM";
}

function isActiveAllowAssignment(row) {
  return (
    resolveAssignmentStatus(row) === "ACTIVE" &&
    normalizeText(row?.effect).toUpperCase() !== "DENY"
  );
}

function buildTargetScopeContext(scopeType, scopeId, lookups, tenantScopeId) {
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  const numericScopeId = Number(scopeId || 0);
  const legalEntities = Array.isArray(lookups?.legalEntities) ? lookups.legalEntities : [];
  const operatingUnits = Array.isArray(lookups?.operatingUnits) ? lookups.operatingUnits : [];
  const targetOperatingUnit =
    normalizedScopeType === "OPERATING_UNIT"
      ? operatingUnits.find((row) => Number(row.id) === numericScopeId) || null
      : null;
  const targetLegalEntity =
    normalizedScopeType === "LEGAL_ENTITY"
      ? legalEntities.find((row) => Number(row.id) === numericScopeId) || null
      : targetOperatingUnit
        ? legalEntities.find((row) => Number(row.id) === Number(targetOperatingUnit.legal_entity_id)) ||
          null
        : null;
  const targetCountryId =
    normalizedScopeType === "COUNTRY"
      ? numericScopeId
      : Number(targetLegalEntity?.country_id || 0);
  const targetGroupCompanyId =
    normalizedScopeType === "GROUP"
      ? numericScopeId
      : Number(targetLegalEntity?.group_company_id || 0);
  const groupIdsForCountry =
    normalizedScopeType === "COUNTRY"
      ? Array.from(
          new Set(
            legalEntities
              .filter((row) => Number(row.country_id) === numericScopeId)
              .map((row) => Number(row.group_company_id || 0))
              .filter(Boolean)
          )
        )
      : targetGroupCompanyId
        ? [targetGroupCompanyId]
        : [];

  return {
    scopeType: normalizedScopeType,
    scopeId: numericScopeId,
    scopeLabel: buildScopeLabel(normalizedScopeType, numericScopeId, lookups, tenantScopeId),
    legalEntityId:
      normalizedScopeType === "LEGAL_ENTITY"
        ? numericScopeId
        : Number(targetOperatingUnit?.legal_entity_id || 0),
    countryId: targetCountryId,
    groupCompanyId: targetGroupCompanyId,
    groupIdsForCountry,
    tenantScopeId: Number(tenantScopeId || 0),
  };
}

function evaluateScopeCoverage(targetScope, assignmentScopeType, assignmentScopeId) {
  const targetScopeType = normalizeText(targetScope?.scopeType).toUpperCase();
  const targetScopeId = Number(targetScope?.scopeId || 0);
  const normalizedAssignmentScopeType = normalizeText(assignmentScopeType).toUpperCase();
  const numericAssignmentScopeId = Number(assignmentScopeId || 0);
  if (!targetScopeType || !targetScopeId || !normalizedAssignmentScopeType || !numericAssignmentScopeId) {
    return {
      status: "OTHER",
      label: "",
      coversTarget: false,
    };
  }
  if (
    normalizedAssignmentScopeType === targetScopeType &&
    numericAssignmentScopeId === targetScopeId
  ) {
    return {
      status: "EXACT",
      label: "Exact target scope",
      coversTarget: true,
    };
  }
  if (
    normalizedAssignmentScopeType === "TENANT" &&
    numericAssignmentScopeId === Number(targetScope.tenantScopeId || 0)
  ) {
    return {
      status: "INHERITED",
      label: "Tenant-wide inherited coverage",
      coversTarget: true,
    };
  }
  if (targetScopeType === "GROUP") {
    return {
      status: "OTHER",
      label: "",
      coversTarget: false,
    };
  }
  if (
    targetScopeType === "COUNTRY" &&
    normalizedAssignmentScopeType === "GROUP" &&
    Array.isArray(targetScope.groupIdsForCountry) &&
    targetScope.groupIdsForCountry.includes(numericAssignmentScopeId)
  ) {
    return {
      status: "INHERITED",
      label: "Inherited from group scope",
      coversTarget: true,
    };
  }
  if (targetScopeType === "LEGAL_ENTITY" || targetScopeType === "OPERATING_UNIT") {
    if (
      normalizedAssignmentScopeType === "LEGAL_ENTITY" &&
      numericAssignmentScopeId === Number(targetScope.legalEntityId || 0)
    ) {
      return {
        status: "INHERITED",
        label:
          targetScopeType === "OPERATING_UNIT"
            ? "Inherited from legal-entity scope"
            : "Exact legal-entity coverage",
        coversTarget: true,
      };
    }
    if (
      normalizedAssignmentScopeType === "COUNTRY" &&
      numericAssignmentScopeId === Number(targetScope.countryId || 0)
    ) {
      return {
        status: "INHERITED",
        label: "Inherited from country scope",
        coversTarget: true,
      };
    }
    if (
      normalizedAssignmentScopeType === "GROUP" &&
      numericAssignmentScopeId === Number(targetScope.groupCompanyId || 0)
    ) {
      return {
        status: "INHERITED",
        label: "Inherited from group scope",
        coversTarget: true,
      };
    }
  }
  return {
    status: "OTHER",
    label: "",
    coversTarget: false,
  };
}

function sortCoverageItems(left, right) {
  const leftCoverageOrder = COVERAGE_ORDER[normalizeText(left?.coverageStatus).toUpperCase()] || 999;
  const rightCoverageOrder =
    COVERAGE_ORDER[normalizeText(right?.coverageStatus).toUpperCase()] || 999;
  if (leftCoverageOrder !== rightCoverageOrder) {
    return leftCoverageOrder - rightCoverageOrder;
  }
  if (normalizeText(left?.scopeLabel) !== normalizeText(right?.scopeLabel)) {
    return normalizeText(left?.scopeLabel).localeCompare(normalizeText(right?.scopeLabel));
  }
  return normalizeText(left?.label || left?.packageLabel).localeCompare(
    normalizeText(right?.label || right?.packageLabel)
  );
}

function buildBusinessRoleAssignments(assignments, targetScope, lookups, tenantScopeId) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => isActiveAllowAssignment(assignment))
    .filter((assignment) => isBusinessRoleAssignmentRoleCode(assignment?.role_code))
    .map((assignment) => {
      const roleEntry = getRoleCatalogEntry(assignment.role_code);
      const coverage = evaluateScopeCoverage(
        targetScope,
        assignment.scope_type,
        assignment.scope_id
      );
      return {
        id: `business-role-${assignment.id}`,
        label: roleEntry.code,
        businessRoleCode: roleEntry.businessRoleCode || "",
        scopeType: normalizeText(assignment.scope_type).toUpperCase(),
        scopeId: Number(assignment.scope_id || 0),
        scopeLabel: buildScopeLabel(
          assignment.scope_type,
          assignment.scope_id,
          lookups,
          tenantScopeId
        ),
        coverageStatus: coverage.status,
        coverageLabel: coverage.label,
        coversTarget: coverage.coversTarget,
      };
    })
    .sort(sortCoverageItems);
}

function buildDirectWorkflowPackageAssignments(
  assignments,
  workflowFamily,
  targetScope,
  lookups,
  tenantScopeId
) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => isActiveAllowAssignment(assignment))
    .filter((assignment) => isWorkflowPackageAssignmentRoleCode(assignment?.role_code))
    .map((assignment) => {
      const roleEntry = getRoleCatalogEntry(assignment.role_code);
      const packageEntry = getWorkflowPackageCatalogEntry(roleEntry.workflowPackageCode);
      if (
        normalizeText(workflowFamily) &&
        normalizeText(packageEntry.workflowFamily) !== normalizeText(workflowFamily)
      ) {
        return null;
      }
      const coverage = evaluateScopeCoverage(
        targetScope,
        assignment.scope_type,
        assignment.scope_id
      );
      return {
        id: `direct-package-${assignment.id}`,
        packageCode: packageEntry.code,
        packageLabel: packageEntry.displayName,
        packageSummary: packageEntry.summary || packageEntry.description || "",
        workflowFamily: packageEntry.workflowFamily,
        workflowFamilyLabel: packageEntry.workflowFamilyLabel,
        scopeType: normalizeText(assignment.scope_type).toUpperCase(),
        scopeId: Number(assignment.scope_id || 0),
        scopeLabel: buildScopeLabel(
          assignment.scope_type,
          assignment.scope_id,
          lookups,
          tenantScopeId
        ),
        coverageStatus: coverage.status,
        coverageLabel: coverage.label,
        coversTarget: coverage.coversTarget,
        sourceLabels: ["Direct package assignment"],
        sourceRoleLabels: [],
      };
    })
    .filter(Boolean);
}

function buildRuntimeRoleWorkflowPackageAssignments(
  assignments,
  workflowFamily,
  targetScope,
  lookups,
  tenantScopeId
) {
  const grouped = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    if (
      !isActiveAllowAssignment(assignment) ||
      isBusinessRoleAssignmentRoleCode(assignment?.role_code) ||
      isWorkflowPackageAssignmentRoleCode(assignment?.role_code)
    ) {
      continue;
    }
    const roleEntry = getRoleCatalogEntry(assignment.role_code);
    const mappedPackageEntries = resolveWorkflowPackagesForRuntimeRoles([assignment.role_code]).filter(
      (entry) =>
        !normalizeText(workflowFamily) ||
        normalizeText(entry.workflowFamily) === normalizeText(workflowFamily)
    );
    for (const packageEntry of mappedPackageEntries) {
      const coverage = evaluateScopeCoverage(
        targetScope,
        assignment.scope_type,
        assignment.scope_id
      );
      const groupedKey = [
        packageEntry.code,
        normalizeText(assignment.scope_type).toUpperCase(),
        Number(assignment.scope_id || 0),
      ].join("|");
      if (!grouped.has(groupedKey)) {
        grouped.set(groupedKey, {
          id: `mapped-package-${groupedKey}`,
          packageCode: packageEntry.code,
          packageLabel: packageEntry.displayName,
          packageSummary: packageEntry.summary || packageEntry.description || "",
          workflowFamily: packageEntry.workflowFamily,
          workflowFamilyLabel: packageEntry.workflowFamilyLabel,
          scopeType: normalizeText(assignment.scope_type).toUpperCase(),
          scopeId: Number(assignment.scope_id || 0),
          scopeLabel: buildScopeLabel(
            assignment.scope_type,
            assignment.scope_id,
            lookups,
            tenantScopeId
          ),
          coverageStatus: coverage.status,
          coverageLabel: coverage.label,
          coversTarget: coverage.coversTarget,
          sourceLabels: new Set(),
          sourceRoleLabels: new Set(),
        });
      }
      const item = grouped.get(groupedKey);
      item.sourceLabels.add("Runtime role source");
      item.sourceRoleLabels.add(roleEntry.code || normalizeText(assignment.role_code));
    }
  }

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    sourceLabels: Array.from(item.sourceLabels).sort(),
    sourceRoleLabels: Array.from(item.sourceRoleLabels).sort(),
  }));
}

function dedupeCoverageItems(items) {
  const grouped = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const groupedKey = [
      normalizeText(item.packageCode),
      normalizeText(item.scopeType),
      Number(item.scopeId || 0),
    ].join("|");
    if (!grouped.has(groupedKey)) {
      grouped.set(groupedKey, {
        ...item,
        sourceLabels: new Set(item.sourceLabels || []),
        sourceRoleLabels: new Set(item.sourceRoleLabels || []),
      });
      continue;
    }
    const existing = grouped.get(groupedKey);
    for (const label of item.sourceLabels || []) {
      existing.sourceLabels.add(label);
    }
    for (const label of item.sourceRoleLabels || []) {
      existing.sourceRoleLabels.add(label);
    }
  }
  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      sourceLabels: Array.from(item.sourceLabels).sort(),
      sourceRoleLabels: Array.from(item.sourceRoleLabels).sort(),
    }))
    .sort(sortCoverageItems);
}

function buildMissingScopeText(otherWorkflowPackages, workflowFamilyLabel, l) {
  if (!Array.isArray(otherWorkflowPackages) || otherWorkflowPackages.length === 0) {
    return "";
  }
  return translate(
    l,
    "{{family}} package authority exists, but only at other scopes: {{scopes}}.",
    "{{family}} paket yetkisi var; ancak yalnizca diger kapsamlarda mevcut: {{scopes}}.",
    {
      family: workflowFamilyLabel,
      scopes: joinHumanList(
        Array.from(new Set(otherWorkflowPackages.map((item) => item.scopeLabel))),
        l
      ),
    }
  );
}

function buildMissingPackageText({
  workflowFamilyLabel,
  matchingBusinessRoles,
  matchingWorkflowPackages,
  matchingActionPackages,
  matchingViewOnlyPackages,
  l,
}) {
  if (
    matchingWorkflowPackages.length === 0 &&
    matchingBusinessRoles.length > 0
  ) {
    return translate(
      l,
      "Business-role labels match the target scope, but no {{family}} package authority is active there yet.",
      "Is-rolu etiketleri hedef kapsamla eslesiyor; ancak orada henuz etkin bir {{family}} paket yetkisi yok.",
      { family: workflowFamilyLabel }
    );
  }
  if (
    matchingWorkflowPackages.length > 0 &&
    matchingActionPackages.length === 0 &&
    matchingViewOnlyPackages.length > 0
  ) {
    return translate(
      l,
      "The user can view {{family}} items at the target scope, but no action package is active there yet.",
      "Kullanici hedef kapsamda {{family}} kayitlarini goruntuleyebilir; ancak orada henuz etkin bir aksiyon paketi yok.",
      { family: workflowFamilyLabel }
    );
  }
  return "";
}

function buildFinalResult({
  ready,
  workflowFamilyLabel,
  targetScopeLabel,
  matchingBusinessRoles,
  matchingActionPackages,
  matchingViewOnlyPackages,
  otherWorkflowPackages,
  l,
}) {
  if (!ready) {
    return {
      tone: "slate",
      title: translate(
        l,
        "Choose workflow family and target scope",
        "Workflow ailesi ve hedef kapsam secin"
      ),
      text: translate(
        l,
        "Select the governed workflow family and the target scope to explain what this user can or cannot do there.",
        "Bu kullanicinin o kapsamda neyi yapip yapamayacagini aciklamak icin yonetilen workflow ailesini ve hedef kapsami secin."
      ),
    };
  }

  if (matchingActionPackages.length > 0) {
    return {
      tone: "emerald",
      title: translate(l, "Action authority present", "Aksiyon yetkisi mevcut"),
      text: translate(
        l,
        "{{family}} action package authority covers {{scope}}. Matching business-role labels: {{roles}}.",
        "{{family}} aksiyon paketi yetkisi {{scope}} kapsaminda gecerli. Eslesen is-rolu etiketleri: {{roles}}.",
        {
          family: workflowFamilyLabel,
          scope: targetScopeLabel,
          roles:
            joinHumanList(matchingBusinessRoles.map((item) => item.label), l) ||
            translate(l, "none", "yok"),
        }
      ),
    };
  }

  if (matchingViewOnlyPackages.length > 0) {
    return {
      tone: "amber",
      title: translate(l, "View only", "Yalnizca goruntuleme"),
      text: translate(
        l,
        "The user can view {{family}} at {{scope}}, but no action package covers that scope yet.",
        "Kullanici {{scope}} kapsaminda {{family}} kayitlarini goruntuleyebilir; ancak o kapsami henuz bir aksiyon paketi kapsamiyor.",
        {
          family: workflowFamilyLabel,
          scope: targetScopeLabel,
        }
      ),
    };
  }

  if (matchingBusinessRoles.length > 0) {
    return {
      tone: "amber",
      title: translate(l, "Labels only", "Yalnizca etiket"),
      text: translate(
        l,
        "{{roles}} label the user at {{scope}}, but labels do not grant {{family}} authority without packages.",
        "{{roles}}, kullaniciyi {{scope}} kapsaminda etiketliyor; ancak etiketler paketler olmadan {{family}} yetkisi vermez.",
        {
          roles: joinHumanList(matchingBusinessRoles.map((item) => item.label), l),
          scope: targetScopeLabel,
          family: workflowFamilyLabel,
        }
      ),
    };
  }

  if (otherWorkflowPackages.length > 0) {
    return {
      tone: "rose",
      title: translate(l, "Scope mismatch", "Kapsam uyusmazligi"),
      text: buildMissingScopeText(otherWorkflowPackages, workflowFamilyLabel, l),
    };
  }

  return {
    tone: "slate",
    title: translate(l, "No relevant authority found", "Ilgili yetki bulunamadi"),
    text: translate(
      l,
      "No {{family}} business-role label or workflow package was found for {{scope}}.",
      "{{scope}} kapsaminda {{family}} icin ilgili bir is-rolu etiketi veya workflow paketi bulunamadi.",
      {
        family: workflowFamilyLabel,
        scope: targetScopeLabel,
      }
    ),
  };
}

function getViewOnlyPackageCodeSet(workflowFamily) {
  return new Set(
    (VIEW_ONLY_PACKAGE_CODES_BY_FAMILY[normalizeText(workflowFamily)] || []).map((code) =>
      normalizeText(code).toUpperCase()
    )
  );
}

/**
 * Build the UI-5A business-facing diagnostics summary for one user, one
 * workflow family, and one target scope. This keeps title-only business roles,
 * workflow package assignments, and runtime-role-derived package coverage
 * readable without pretending to be a full policy simulator.
 */
export function buildAccessDiagnosticsSummary({
  assignments,
  workflowFamily,
  scopeType,
  scopeId,
  lookups,
  tenantScopeId,
  l,
}) {
  const normalizedWorkflowFamily = normalizeText(workflowFamily).toUpperCase();
  const targetScope = buildTargetScopeContext(scopeType, scopeId, lookups, tenantScopeId);
  const ready = Boolean(normalizedWorkflowFamily && targetScope.scopeType && targetScope.scopeId);
  const workflowFamilyLabel = normalizedWorkflowFamily
    ? getWorkflowFamilyLabel(normalizedWorkflowFamily)
    : "";

  const businessRoleAssignments = buildBusinessRoleAssignments(
    assignments,
    targetScope,
    lookups,
    tenantScopeId
  );
  const directWorkflowPackages = buildDirectWorkflowPackageAssignments(
    assignments,
    normalizedWorkflowFamily,
    targetScope,
    lookups,
    tenantScopeId
  );
  const runtimeRoleWorkflowPackages = buildRuntimeRoleWorkflowPackageAssignments(
    assignments,
    normalizedWorkflowFamily,
    targetScope,
    lookups,
    tenantScopeId
  );
  const workflowPackages = dedupeCoverageItems([
    ...directWorkflowPackages,
    ...runtimeRoleWorkflowPackages,
  ]);

  const matchingBusinessRoles = businessRoleAssignments.filter((item) => item.coversTarget);
  const otherBusinessRoles = businessRoleAssignments.filter((item) => !item.coversTarget);
  const matchingWorkflowPackages = workflowPackages.filter((item) => item.coversTarget);
  const otherWorkflowPackages = workflowPackages.filter((item) => !item.coversTarget);
  const viewOnlyPackageCodeSet = getViewOnlyPackageCodeSet(normalizedWorkflowFamily);
  const matchingViewOnlyPackages = matchingWorkflowPackages.filter((item) =>
    viewOnlyPackageCodeSet.has(normalizeText(item.packageCode).toUpperCase())
  );
  const matchingActionPackages = matchingWorkflowPackages.filter(
    (item) => !viewOnlyPackageCodeSet.has(normalizeText(item.packageCode).toUpperCase())
  );
  const matchingScopeLabels = Array.from(
    new Set(
      [...matchingBusinessRoles, ...matchingWorkflowPackages]
        .map((item) => item.scopeLabel)
        .filter(Boolean)
    )
  );
  const missingScopeText =
    matchingWorkflowPackages.length === 0
      ? buildMissingScopeText(otherWorkflowPackages, workflowFamilyLabel, l)
      : "";
  const missingPackageText = buildMissingPackageText({
    workflowFamilyLabel,
    matchingBusinessRoles,
    matchingWorkflowPackages,
    matchingActionPackages,
    matchingViewOnlyPackages,
    l,
  });
  const finalResult = buildFinalResult({
    ready,
    workflowFamilyLabel,
    targetScopeLabel: targetScope.scopeLabel,
    matchingBusinessRoles,
    matchingActionPackages,
    matchingViewOnlyPackages,
    otherWorkflowPackages,
    l,
  });
  const blockerTexts = Array.from(
    new Set([missingScopeText, missingPackageText].filter(Boolean))
  );

  const noteTexts = [];
  if (matchingBusinessRoles.length === 0 && otherBusinessRoles.length > 0) {
    noteTexts.push(
      translate(
        l,
        "Business-role labels exist, but only at other scopes.",
        "Is-rolu etiketleri var; ancak yalnizca diger kapsamlarda mevcut."
      )
    );
  }

  return {
    ready,
    workflowFamily: normalizedWorkflowFamily,
    workflowFamilyLabel,
    targetScope,
    finalResult,
    matchingScopeLabels,
    blockerTexts,
    missingScopeText,
    missingPackageText,
    businessRoleAssignments,
    matchingBusinessRoles,
    otherBusinessRoles,
    workflowPackages,
    matchingWorkflowPackages,
    otherWorkflowPackages,
    matchingActionPackages,
    matchingViewOnlyPackages,
    noteTexts: Array.from(new Set(noteTexts)),
  };
}
