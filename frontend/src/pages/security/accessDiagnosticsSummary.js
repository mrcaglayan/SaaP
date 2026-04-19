import {
  buildScopeLabel,
  getRoleCatalogEntry,
  getWorkflowFamilyLabel,
  isPackageAuthorityOnlyRole,
  listWorkflowAuthorityDefinitions,
} from "./roleCatalog.js";

const COVERAGE_ORDER = Object.freeze({
  EXACT: 10,
  INHERITED: 20,
  OTHER: 30,
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

function dedupeSorted(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function buildPermissionCodes(permissionCodes) {
  return dedupeSorted(permissionCodes).map((permissionCode) =>
    normalizeText(permissionCode).toLowerCase()
  );
}

function buildPermissionSet(permissionCodes) {
  return new Set(buildPermissionCodes(permissionCodes));
}

function buildSatisfiedPermissionCodes(authorities, grantedPermissionCodes) {
  const grantedPermissionCodeSet = buildPermissionSet(grantedPermissionCodes);
  return dedupeSorted(
    (Array.isArray(authorities) ? authorities : []).flatMap((authority) => [
      ...(Array.isArray(authority?.requiredPermissionCodes)
        ? authority.requiredPermissionCodes
        : []),
      ...(Array.isArray(authority?.anyPermissionCodes)
        ? authority.anyPermissionCodes
        : []),
    ])
  ).filter((permissionCode) =>
    grantedPermissionCodeSet.has(normalizeText(permissionCode).toLowerCase())
  );
}

function authorityIsSatisfied(permissionCodeSet, authority) {
  const requiredPermissionCodes = buildPermissionCodes(
    authority?.requiredPermissionCodes
  );
  const anyPermissionCodes = buildPermissionCodes(authority?.anyPermissionCodes);
  if (requiredPermissionCodes.length === 0 && anyPermissionCodes.length === 0) {
    return false;
  }
  const satisfiesRequired = requiredPermissionCodes.every((permissionCode) =>
    permissionCodeSet.has(permissionCode)
  );
  const satisfiesAny =
    anyPermissionCodes.length === 0 ||
    anyPermissionCodes.some((permissionCode) => permissionCodeSet.has(permissionCode));
  return satisfiesRequired && satisfiesAny;
}

function listSatisfiedAuthorities(workflowFamily, permissionCodes) {
  const permissionCodeSet = buildPermissionSet(permissionCodes);
  return listWorkflowAuthorityDefinitions(workflowFamily).filter((authority) =>
    authorityIsSatisfied(permissionCodeSet, authority)
  );
}

function resolveRoleSnapshot(roleCode, rolesByCode) {
  const normalizedRoleCode = normalizeText(roleCode);
  const liveRole =
    rolesByCode instanceof Map ? rolesByCode.get(normalizedRoleCode) || null : null;
  const catalogRole = getRoleCatalogEntry(normalizedRoleCode);
  return {
    roleCode: normalizedRoleCode,
    roleLabel:
      normalizeText(
        liveRole?.displayName ||
          liveRole?.name ||
          liveRole?.code ||
          catalogRole?.displayName ||
          catalogRole?.code
      ) || normalizedRoleCode,
    permissionCodes: dedupeSorted([
      ...(Array.isArray(liveRole?.permissionCodes) ? liveRole.permissionCodes : []),
      ...(Array.isArray(catalogRole?.permissionCodes) ? catalogRole.permissionCodes : []),
    ]),
    sortOrder: Number(catalogRole?.sortOrder || 9999),
  };
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
  return normalizeText(left?.roleLabel).localeCompare(normalizeText(right?.roleLabel));
}

function buildSuggestedMissingAuthorityCodes(workflowFamily, authorityCodes) {
  const authorityCodeSet = new Set(
    (Array.isArray(authorityCodes) ? authorityCodes : [])
      .map((authorityCode) => normalizeText(authorityCode).toUpperCase())
      .filter(Boolean)
  );

  if (normalizeText(workflowFamily).toUpperCase() === "AP_DOCUMENT_POSTING") {
    const hasView = authorityCodeSet.has("AP_VIEW");
    const hasDraftSubmit = authorityCodeSet.has("AP_DRAFT_SUBMIT");
    const hasApprove = authorityCodeSet.has("AP_APPROVE");
    const hasPost = authorityCodeSet.has("AP_POST");
    const hasReverse = authorityCodeSet.has("AP_REVERSE");
    const hasFxOverride = authorityCodeSet.has("AP_FX_OVERRIDE");
    if (hasView && !hasDraftSubmit && !hasApprove && !hasPost && !hasReverse && !hasFxOverride) {
      return ["AP_DRAFT_SUBMIT", "AP_APPROVE", "AP_POST"];
    }
    if (!hasPost && (hasDraftSubmit || hasApprove || hasReverse || hasFxOverride)) {
      return ["AP_POST"];
    }
    return [];
  }

  if (normalizeText(workflowFamily).toUpperCase() === "LOCAL_CLOSE_PACK") {
    const hasView = authorityCodeSet.has("LOCAL_CLOSE_VIEW");
    const hasPrepare = authorityCodeSet.has("LOCAL_CLOSE_PREPARE");
    const hasReview = authorityCodeSet.has("LOCAL_CLOSE_REVIEW");
    const hasApproveLock = authorityCodeSet.has("LOCAL_CLOSE_APPROVE_LOCK");
    if (hasView && !hasPrepare && !hasReview && !hasApproveLock) {
      return ["LOCAL_CLOSE_REVIEW", "LOCAL_CLOSE_APPROVE_LOCK"];
    }
    if (!hasApproveLock && (hasPrepare || hasReview)) {
      return ["LOCAL_CLOSE_APPROVE_LOCK"];
    }
    return [];
  }

  if (normalizeText(workflowFamily).toUpperCase() === "PERIOD_CLOSE") {
    if (
      authorityCodeSet.has("PERIOD_CLOSE_READINESS") &&
      !authorityCodeSet.has("PERIOD_CLOSE")
    ) {
      return ["PERIOD_CLOSE"];
    }
    return [];
  }

  if (normalizeText(workflowFamily).toUpperCase() === "CONSOLIDATION_RUN") {
    const hasView = authorityCodeSet.has("CONSOLIDATION_VIEW");
    const hasPrepare = authorityCodeSet.has("CONSOLIDATION_PREPARE");
    const hasExecute = authorityCodeSet.has("CONSOLIDATION_EXECUTE");
    const hasAdjust = authorityCodeSet.has("CONSOLIDATION_ADJUST");
    const hasEliminate = authorityCodeSet.has("CONSOLIDATION_ELIMINATE");
    const hasFinalize = authorityCodeSet.has("CONSOLIDATION_FINALIZE");
    if (
      hasView &&
      !hasPrepare &&
      !hasExecute &&
      !hasAdjust &&
      !hasEliminate &&
      !hasFinalize
    ) {
      return [
        "CONSOLIDATION_PREPARE",
        "CONSOLIDATION_EXECUTE",
        "CONSOLIDATION_FINALIZE",
      ];
    }
    if (!hasFinalize && (hasPrepare || hasExecute || hasAdjust || hasEliminate)) {
      return ["CONSOLIDATION_FINALIZE"];
    }
    return [];
  }

  return [];
}

function buildCandidateRolesText(authorities, rolesByCode, excludedRoleCodes, l) {
  if (!(rolesByCode instanceof Map) || rolesByCode.size === 0) {
    return "";
  }
  const excludedRoleCodeSet = new Set(
    (Array.isArray(excludedRoleCodes) ? excludedRoleCodes : [])
      .map((roleCode) => normalizeText(roleCode))
      .filter(Boolean)
  );
  const matchingRoleLabels = Array.from(rolesByCode.values())
    .map((role) => resolveRoleSnapshot(role?.code, rolesByCode))
    .filter((role) => role.roleCode && !excludedRoleCodeSet.has(role.roleCode))
    .filter((role) => !isPackageAuthorityOnlyRole(role.roleCode))
    .map((role) => {
      const permissionCodeSet = buildPermissionSet(role.permissionCodes);
      const matchedAuthorityCount = (Array.isArray(authorities) ? authorities : []).filter(
        (authority) => authorityIsSatisfied(permissionCodeSet, authority)
      ).length;
      return {
        ...role,
        matchedAuthorityCount,
        permissionCount: role.permissionCodes.length,
      };
    })
    .filter((role) => role.matchedAuthorityCount > 0)
    .sort((left, right) => {
      if (left.matchedAuthorityCount !== right.matchedAuthorityCount) {
        return right.matchedAuthorityCount - left.matchedAuthorityCount;
      }
      if (left.permissionCount !== right.permissionCount) {
        return left.permissionCount - right.permissionCount;
      }
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.roleLabel.localeCompare(right.roleLabel);
    })
    .map((role) => role.roleLabel);

  const candidateRoleLabels = dedupeSorted(matchingRoleLabels).slice(0, 4);
  if (candidateRoleLabels.length === 0) {
    return "";
  }
  return translate(
    l,
    "Candidate roles that would satisfy the missing authority: {{roles}}.",
    "Eksik yetkiyi karsilayabilecek aday roller: {{roles}}.",
    {
      roles: joinHumanList(candidateRoleLabels, l),
    }
  );
}

function buildRoleCoverageItems(
  assignments,
  rolesByCode,
  workflowFamily,
  targetScope,
  lookups,
  tenantScopeId,
  l
) {
  const grouped = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    if (!isActiveAllowAssignment(assignment)) {
      continue;
    }
    const roleSnapshot = resolveRoleSnapshot(assignment?.role_code, rolesByCode);
    const authorityEntries = listSatisfiedAuthorities(
      workflowFamily,
      roleSnapshot.permissionCodes
    );
    if (authorityEntries.length === 0) {
      continue;
    }
    const coverage = evaluateScopeCoverage(
      targetScope,
      assignment.scope_type,
      assignment.scope_id
    );
    const groupedKey = [
      roleSnapshot.roleCode,
      normalizeText(assignment.scope_type).toUpperCase(),
      Number(assignment.scope_id || 0),
    ].join("|");
    if (!grouped.has(groupedKey)) {
      grouped.set(groupedKey, {
        id: `role-coverage-${groupedKey}`,
        roleCode: roleSnapshot.roleCode,
        roleLabel: roleSnapshot.roleLabel,
        roleSummary: getRoleCatalogEntry(roleSnapshot.roleCode)?.summary || "",
        workflowFamily: normalizeText(workflowFamily).toUpperCase(),
        workflowFamilyLabel: getWorkflowFamilyLabel(workflowFamily),
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
        authorityCodes: new Set(),
        authorityLabels: new Set(),
        permissionCodes: new Set(),
        sourceLabels: new Set(),
      });
    }
    const item = grouped.get(groupedKey);
    const matchedPermissionCodes = buildSatisfiedPermissionCodes(
      authorityEntries,
      roleSnapshot.permissionCodes
    );
    authorityEntries.forEach((authority) => {
      item.authorityCodes.add(authority.code);
      item.authorityLabels.add(authority.displayName);
    });
    matchedPermissionCodes.forEach((permissionCode) =>
      item.permissionCodes.add(normalizeText(permissionCode))
    );
    item.sourceLabels.add(translate(l, "Assigned role", "Atanmis rol"));
  }

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      authorityCodes: Array.from(item.authorityCodes).sort(),
      authorityLabels: Array.from(item.authorityLabels).sort(),
      permissionCodes: Array.from(item.permissionCodes).sort(),
      sourceLabels: Array.from(item.sourceLabels).sort(),
    }))
    .sort(sortCoverageItems);
}

function buildMissingScopeText(otherCoverageItems, workflowFamilyLabel, l) {
  if (!Array.isArray(otherCoverageItems) || otherCoverageItems.length === 0) {
    return "";
  }
  return translate(
    l,
    "{{family}} authority exists, but only at other scopes: {{scopes}}.",
    "{{family}} yetkisi var; ancak yalnizca diger kapsamlarda mevcut: {{scopes}}.",
    {
      family: workflowFamilyLabel,
      scopes: joinHumanList(
        Array.from(new Set(otherCoverageItems.map((item) => item.scopeLabel))),
        l
      ),
    }
  );
}

function buildMissingAuthorityText({
  workflowFamily,
  matchingAuthorities,
  matchingActionAuthorities,
  matchingViewOnlyAuthorities,
  l,
}) {
  const authorityDefinitions = listWorkflowAuthorityDefinitions(workflowFamily);
  const missingAuthorityCodes =
    buildSuggestedMissingAuthorityCodes(
      workflowFamily,
      matchingAuthorities.map((authority) => authority.code)
    ) ||
    [];
  const missingAuthorities = authorityDefinitions.filter((authority) =>
    missingAuthorityCodes.includes(authority.code)
  );

  if (
    matchingAuthorities.length > 0 &&
    matchingActionAuthorities.length === 0 &&
    matchingViewOnlyAuthorities.length > 0
  ) {
    return {
      text: translate(
        l,
        "The user has view-only authority at the target scope, but no action authority is active there yet.",
        "Kullanici hedef kapsamda yalnizca goruntuleme yetkisine sahip; ancak orada henuz etkin bir aksiyon yetkisi yok."
      ),
      missingAuthorities:
        missingAuthorities.length > 0
          ? missingAuthorities
          : authorityDefinitions.filter((authority) => !authority.viewOnly),
    };
  }

  return {
    text: "",
    missingAuthorities,
  };
}

function buildFinalResult({
  ready,
  workflowFamilyLabel,
  targetScopeLabel,
  matchingCoverageItems,
  matchingActionAuthorities,
  matchingViewOnlyAuthorities,
  otherCoverageItems,
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

  if (matchingActionAuthorities.length > 0) {
    return {
      tone: "emerald",
      title: translate(l, "Action authority present", "Aksiyon yetkisi mevcut"),
      text: translate(
        l,
        "{{family}} authority covers {{scope}} through {{roles}}.",
        "{{family}} yetkisi {{scope}} kapsaminda {{roles}} rolleriyle saglaniyor.",
        {
          family: workflowFamilyLabel,
          scope: targetScopeLabel,
          roles: joinHumanList(
            Array.from(new Set(matchingCoverageItems.map((item) => item.roleLabel))),
            l
          ),
        }
      ),
    };
  }

  if (matchingViewOnlyAuthorities.length > 0) {
    return {
      tone: "amber",
      title: translate(l, "View only", "Yalnizca goruntuleme"),
      text: translate(
        l,
        "The user can review {{family}} at {{scope}}, but no action authority covers that scope yet.",
        "Kullanici {{scope}} kapsaminda {{family}} kayitlarini inceleyebilir; ancak o kapsami henuz bir aksiyon yetkisi kapsamiyor.",
        {
          family: workflowFamilyLabel,
          scope: targetScopeLabel,
        }
      ),
    };
  }

  if (otherCoverageItems.length > 0) {
    return {
      tone: "rose",
      title: translate(l, "Scope mismatch", "Kapsam uyusmazligi"),
      text: buildMissingScopeText(otherCoverageItems, workflowFamilyLabel, l),
    };
  }

  return {
    tone: "slate",
    title: translate(l, "No relevant authority found", "Ilgili yetki bulunamadi"),
    text: translate(
      l,
      "No {{family}} role authority was found for {{scope}}.",
      "{{scope}} kapsaminda {{family}} icin ilgili rol yetkisi bulunamadi.",
      {
        family: workflowFamilyLabel,
        scope: targetScopeLabel,
      }
    ),
  };
}

/**
 * Build the UI-5A business-facing diagnostics summary for one user, one
 * governed workflow family, and one target scope. This stays role-native by
 * deriving effective authority directly from role permission sets.
 */
export function buildAccessDiagnosticsSummary({
  assignments,
  rolesByCode,
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
  const coverageItems = buildRoleCoverageItems(
    assignments,
    rolesByCode,
    normalizedWorkflowFamily,
    targetScope,
    lookups,
    tenantScopeId,
    l
  );
  const matchingCoverageItems = coverageItems.filter((item) => item.coversTarget);
  const otherCoverageItems = coverageItems.filter((item) => !item.coversTarget);
  const authorityDefinitions = listWorkflowAuthorityDefinitions(normalizedWorkflowFamily);
  const matchingAuthorityCodeSet = new Set(
    matchingCoverageItems.flatMap((item) => item.authorityCodes || [])
  );
  const matchingAuthorities = authorityDefinitions.filter((authority) =>
    matchingAuthorityCodeSet.has(authority.code)
  );
  const matchingViewOnlyAuthorities = matchingAuthorities.filter(
    (authority) => authority.viewOnly
  );
  const matchingActionAuthorities = matchingAuthorities.filter(
    (authority) => !authority.viewOnly
  );
  const matchingScopeLabels = Array.from(
    new Set(matchingCoverageItems.map((item) => item.scopeLabel).filter(Boolean))
  );
  const missingScopeText =
    matchingCoverageItems.length === 0
      ? buildMissingScopeText(otherCoverageItems, workflowFamilyLabel, l)
      : "";
  const missingAuthorityResult = buildMissingAuthorityText({
    workflowFamily: normalizedWorkflowFamily,
    matchingAuthorities,
    matchingActionAuthorities,
    matchingViewOnlyAuthorities,
    l,
  });
  const candidateRolesText = buildCandidateRolesText(
    missingAuthorityResult.missingAuthorities,
    rolesByCode,
    matchingCoverageItems.map((item) => item.roleCode),
    l
  );
  const finalResult = buildFinalResult({
    ready,
    workflowFamilyLabel,
    targetScopeLabel: targetScope.scopeLabel,
    matchingCoverageItems,
    matchingActionAuthorities,
    matchingViewOnlyAuthorities,
    otherCoverageItems,
    l,
  });
  const blockerTexts = Array.from(
    new Set(
      [missingScopeText, missingAuthorityResult.text, candidateRolesText].filter(Boolean)
    )
  );
  const noteTexts = [];

  if (
    matchingCoverageItems.some(
      (item) => normalizeText(item.coverageStatus).toUpperCase() === "INHERITED"
    )
  ) {
    noteTexts.push(
      translate(
        l,
        "Inherited coverage from broader scopes counts as effective authority here.",
        "Daha genis kapsamlardan devralinan kapsam, burada etkin yetki olarak sayilir."
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
    missingAuthorityText: missingAuthorityResult.text,
    candidateRolesText,
    coverageItems,
    matchingCoverageItems,
    otherCoverageItems,
    matchingAuthorities,
    matchingActionAuthorities,
    matchingViewOnlyAuthorities,
    noteTexts,
  };
}
