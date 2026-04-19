import {
  getRoleCatalogEntry,
  getWorkflowFamilyLabel,
  isPackageAuthorityOnlyRole,
  listWorkflowAuthorityDefinitions,
} from "./roleCatalog.js";

const SCOPE_ORDER = Object.freeze({
  TENANT: 10,
  GROUP: 20,
  COUNTRY: 30,
  LEGAL_ENTITY: 40,
  OPERATING_UNIT: 50,
});

const WORKFLOW_FAMILY_ORDER = Object.freeze({
  CROSS_WORKFLOW: 10,
  AP_DOCUMENT_POSTING: 20,
  LOCAL_CLOSE_PACK: 30,
  PERIOD_CLOSE: 40,
  CONSOLIDATION_RUN: 50,
});

const RUNTIME_ROLE_PREVIEW_SUMMARIES = Object.freeze({
  SecurityAdmin: {
    en: "manage roles, assignments, and security administration",
    tr: "rolleri, atamalari ve guvenlik yonetimini idare edebilir",
  },
  SystemAdmin: {
    en: "manage tenant setup, workflow operations, and system administration",
    tr: "tenant kurulumunu, workflow operasyonlarini ve sistem yonetimini idare edebilir",
  },
  LocalUserAdmin: {
    en: "invite and manage scoped local users",
    tr: "kapsamli yerel kullanicilari davet edip yonetebilir",
  },
  MasterDataSteward: {
    en: "maintain organization structure and accounting master data",
    tr: "organizasyon yapisini ve muhasebe ana verisini yonetebilir",
  },
  CounterpartyCardEditor: {
    en: "maintain customer and vendor cards plus exceptional account overrides",
    tr: "musteri ve tedarikci kartlarini ve istisnai hesap override'larini yonetebilir",
  },
  ShareholderCapitalOperator: {
    en: "manage capital commitment and fulfillment records",
    tr: "sermaye taahhudu ve yerine getirme kayitlarini yonetebilir",
  },
  TreasuryOperator: {
    en: "manage bank, cash, and settlement operations",
    tr: "banka, kasa ve mutabakat operasyonlarini yonetebilir",
  },
  TreasuryApprover: {
    en: "approve treasury governance actions",
    tr: "hazine yonetim onay aksiyonlarini gerceklestirebilir",
  },
  PayrollOperator: {
    en: "run payroll operations",
    tr: "bordro operasyonlarini yurutebilir",
  },
  PayrollApprover: {
    en: "approve payroll governance actions",
    tr: "bordro yonetim onay aksiyonlarini gerceklestirebilir",
  },
  OUAccountant: {
    en: "handle operating-unit accounting exceptions",
    tr: "operating-unit muhasebe istisnalarini yonetebilir",
  },
  OUAPSubmitter: {
    en: "submit operating-unit AP drafts for workflow handoff",
    tr: "operating-unit AP taslaklarini workflow devri icin gonderebilir",
  },
  AuditorReadOnly: {
    en: "review governed areas in read-only mode",
    tr: "yonetilen alanlari salt-okunur modda inceleyebilir",
  },
});

function normalizeText(value) {
  return String(value || "").trim();
}

function interpolateTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([.\w]+)\s*\}\}/g, (_, key) => {
    if (!values || typeof values !== "object") {
      return "";
    }
    const resolvedValue = values[key];
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
  return translate(
    l,
    "{{items}}, and {{last}}",
    "{{items}} ve {{last}}",
    {
      items: safeValues.slice(0, -1).join(", "),
      last: safeValues[safeValues.length - 1],
    }
  );
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

function sortByScope(left, right) {
  const leftScopeOrder = SCOPE_ORDER[normalizeText(left?.scopeType).toUpperCase()] || 999;
  const rightScopeOrder = SCOPE_ORDER[normalizeText(right?.scopeType).toUpperCase()] || 999;
  if (leftScopeOrder !== rightScopeOrder) {
    return leftScopeOrder - rightScopeOrder;
  }
  const leftScopeLabel = normalizeText(left?.scopeLabel);
  const rightScopeLabel = normalizeText(right?.scopeLabel);
  if (leftScopeLabel !== rightScopeLabel) {
    return leftScopeLabel.localeCompare(rightScopeLabel);
  }
  return normalizeText(left?.id).localeCompare(normalizeText(right?.id));
}

function sortAuthorityLines(left, right) {
  const leftFamilyOrder =
    WORKFLOW_FAMILY_ORDER[normalizeText(left?.workflowFamily).toUpperCase()] || 999;
  const rightFamilyOrder =
    WORKFLOW_FAMILY_ORDER[normalizeText(right?.workflowFamily).toUpperCase()] || 999;
  if (leftFamilyOrder !== rightFamilyOrder) {
    return leftFamilyOrder - rightFamilyOrder;
  }
  return sortByScope(left, right);
}

function buildPermissionCodes(permissionCodes) {
  return dedupeSorted(permissionCodes).map((permissionCode) =>
    normalizeText(permissionCode).toLowerCase()
  );
}

function buildPermissionSet(permissionCodes) {
  return new Set(buildPermissionCodes(permissionCodes));
}

function resolveRoleRowEntry(roleCode, rolesByCode) {
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

function listCoveredWorkflowFamilies(permissionCodes) {
  return Object.keys(WORKFLOW_FAMILY_ORDER).filter(
    (workflowFamily) =>
      listSatisfiedAuthorities(workflowFamily, permissionCodes).length > 0
  );
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

function buildMissingPermissionCodes(authorities) {
  return dedupeSorted(
    (Array.isArray(authorities) ? authorities : []).flatMap((authority) => [
      ...(authority?.requiredPermissionCodes || []),
      ...(authority?.anyPermissionCodes || []),
    ])
  );
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

function buildCandidateRoleLabels(missingAuthorities, rolesByCode, excludedRoleCodes) {
  if (!(rolesByCode instanceof Map) || rolesByCode.size === 0) {
    return [];
  }
  const excludedRoleCodeSet = new Set(
    (Array.isArray(excludedRoleCodes) ? excludedRoleCodes : [])
      .map((roleCode) => normalizeText(roleCode))
      .filter(Boolean)
  );
  const candidates = Array.from(rolesByCode.values())
    .map((role) => resolveRoleRowEntry(role?.code, rolesByCode))
    .filter((role) => role.roleCode && !excludedRoleCodeSet.has(role.roleCode))
    .filter((role) => !isPackageAuthorityOnlyRole(role.roleCode))
    .map((role) => {
      const permissionCodeSet = buildPermissionSet(role.permissionCodes);
      const matchedAuthorities = (Array.isArray(missingAuthorities)
        ? missingAuthorities
        : []
      ).filter((authority) => authorityIsSatisfied(permissionCodeSet, authority));
      return {
        ...role,
        matchedAuthorityCount: matchedAuthorities.length,
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
    });

  return dedupeSorted(candidates.map((role) => role.roleLabel)).slice(0, 4);
}

function getRoleSourceLabel(sourceType, l) {
  const normalizedSourceType = normalizeText(sourceType).toUpperCase();
  if (normalizedSourceType === "STARTER_DERIVED" || normalizedSourceType === "PRESET_DERIVED") {
    return translate(l, "Preset-derived role", "Presetten tureyen rol");
  }
  return translate(l, "Assigned role", "Atanmis rol");
}

function buildActiveRoleRows({ userBundles, rolesByCode, l }) {
  const activeRows = [];
  for (const bundle of Array.isArray(userBundles) ? userBundles : []) {
    if (
      normalizeText(bundle?.status).toUpperCase() !== "ACTIVE" ||
      normalizeText(bundle?.effect).toUpperCase() === "DENY"
    ) {
      continue;
    }
    const sourceLabel = getRoleSourceLabel(bundle?.sourceType, l);
    const rows = Array.isArray(bundle?.rows) && bundle.rows.length > 0
      ? bundle.rows
      : (Array.isArray(bundle?.roleCodes) ? bundle.roleCodes : []).map((roleCode) => ({
          assignmentId: `${bundle.id}:${roleCode}`,
          roleCode,
          scopeType: bundle.scopeType,
          scopeId: bundle.scopeId,
          scopeLabel: bundle.scopeLabel,
          effect: bundle.effect,
          status: bundle.status,
        }));
    for (const row of rows) {
      if (
        normalizeText(row?.status || bundle?.status).toUpperCase() !== "ACTIVE" ||
        normalizeText(row?.effect || bundle?.effect).toUpperCase() === "DENY"
      ) {
        continue;
      }
      const roleEntry = resolveRoleRowEntry(row?.roleCode, rolesByCode);
      activeRows.push({
        id: `bundle-role-${row?.assignmentId || `${bundle.id}:${row?.roleCode}`}`,
        roleCode: roleEntry.roleCode,
        roleLabel: roleEntry.roleLabel,
        permissionCodes: roleEntry.permissionCodes,
        scopeType: normalizeText(row?.scopeType || bundle?.scopeType).toUpperCase(),
        scopeId: Number(row?.scopeId || bundle?.scopeId || 0),
        scopeLabel: row?.scopeLabel || bundle?.scopeLabel || "",
        sourceLabel,
      });
    }
  }
  return activeRows;
}

function getRuntimeRoleSummary(roleCode, roleEntry, l) {
  const configuredSummary = RUNTIME_ROLE_PREVIEW_SUMMARIES[normalizeText(roleCode)];
  if (configuredSummary) {
    return translate(l, configuredSummary.en, configuredSummary.tr);
  }
  return translate(
    l,
    "use {{role}} authority",
    "{{role}} yetkisini kullanabilir",
    { role: roleEntry.roleLabel || roleEntry.code || normalizeText(roleCode) }
  );
}

/**
 * Builds the readable authority preview for the selected user from current
 * allow-side runtime-role assignments and their granted permissions.
 */
export function buildEffectiveAuthorityPreview({
  userBundles,
  rolesByCode,
  l,
}) {
  const activeRoleRows = buildActiveRoleRows({
    userBundles,
    rolesByCode,
    l,
  });
  const authorityGroupsByKey = new Map();
  const residualRoleLines = [];
  const residualRoleLineKeys = new Set();

  for (const roleRow of activeRoleRows) {
    const coveredWorkflowFamilies = listCoveredWorkflowFamilies(roleRow.permissionCodes);
    if (coveredWorkflowFamilies.length === 0) {
      const runtimeLineKey = [
        normalizeText(roleRow.roleCode),
        normalizeText(roleRow.scopeType).toUpperCase(),
        Number(roleRow.scopeId || 0),
      ].join("|");
      if (residualRoleLineKeys.has(runtimeLineKey)) {
        continue;
      }
      residualRoleLineKeys.add(runtimeLineKey);
      residualRoleLines.push({
        id: runtimeLineKey,
        roleCode: roleRow.roleCode,
        roleLabel: roleRow.roleLabel,
        scopeType: roleRow.scopeType,
        scopeId: Number(roleRow.scopeId || 0),
        scopeLabel: roleRow.scopeLabel,
        summaryText: getRuntimeRoleSummary(roleRow.roleCode, roleRow, l),
        sourceLabels: [roleRow.sourceLabel],
      });
      continue;
    }

    for (const workflowFamily of coveredWorkflowFamilies) {
      const groupKey = [
        normalizeText(workflowFamily).toUpperCase(),
        normalizeText(roleRow.scopeType).toUpperCase(),
        Number(roleRow.scopeId || 0),
      ].join("|");
      if (!authorityGroupsByKey.has(groupKey)) {
        authorityGroupsByKey.set(groupKey, {
          id: groupKey,
          workflowFamily,
          workflowFamilyLabel: getWorkflowFamilyLabel(workflowFamily),
          scopeType: roleRow.scopeType,
          scopeId: Number(roleRow.scopeId || 0),
          scopeLabel: roleRow.scopeLabel,
          roleCodes: new Set(),
          roleLabels: new Set(),
          sourceLabels: new Set(),
          permissionCodes: new Set(),
        });
      }
      const group = authorityGroupsByKey.get(groupKey);
      group.roleCodes.add(roleRow.roleCode);
      group.roleLabels.add(roleRow.roleLabel);
      group.sourceLabels.add(roleRow.sourceLabel);
      for (const permissionCode of roleRow.permissionCodes) {
        group.permissionCodes.add(normalizeText(permissionCode));
      }
    }
  }

  const authorityLines = Array.from(authorityGroupsByKey.values())
    .map((group) => {
      const authorityEntries = listSatisfiedAuthorities(
        group.workflowFamily,
        Array.from(group.permissionCodes)
      );
      if (authorityEntries.length === 0) {
        return null;
      }
      const missingAuthorityCodes = buildSuggestedMissingAuthorityCodes(
        group.workflowFamily,
        authorityEntries.map((authority) => authority.code)
      );
      const missingAuthorities = listWorkflowAuthorityDefinitions(group.workflowFamily).filter(
        (authority) => missingAuthorityCodes.includes(authority.code)
      );
      const roleLabels = Array.from(group.roleLabels).sort();
      const candidateRoleLabels = buildCandidateRoleLabels(
        missingAuthorities,
        rolesByCode,
        Array.from(group.roleCodes)
      );
      return {
        id: group.id,
        workflowFamily: group.workflowFamily,
        workflowFamilyLabel: group.workflowFamilyLabel,
        scopeType: group.scopeType,
        scopeId: group.scopeId,
        scopeLabel: group.scopeLabel,
        roleLabels,
        sourceLabels: Array.from(group.sourceLabels).sort(),
        summaryText: joinHumanList(
          authorityEntries.map((authority) => authority.displayName),
          l
        ),
        missingText: joinHumanList(
          missingAuthorities.map((authority) => authority.displayName),
          l
        ),
        matchedPermissionCodes: buildSatisfiedPermissionCodes(
          authorityEntries,
          Array.from(group.permissionCodes)
        ),
        missingPermissionCodes: buildMissingPermissionCodes(missingAuthorities),
        candidateRoleLabels,
        noteText: translate(
          l,
          "Derived directly from active role permissions at this scope.",
          "Bu kapsamda etkin rol yetkilerinden dogrudan turetildi."
        ),
      };
    })
    .filter(Boolean)
    .sort(sortAuthorityLines);

  residualRoleLines.sort(sortByScope);

  const warningTexts = [];
  if (
    (Array.isArray(userBundles) ? userBundles : []).some(
      (bundle) =>
        normalizeText(bundle?.status).toUpperCase() === "ACTIVE" &&
        normalizeText(bundle?.effect).toUpperCase() === "DENY"
    )
  ) {
    warningTexts.push(
      translate(
        l,
        "Active deny assignments exist. This preview summarizes allow-side authority only.",
        "Etkin deny atamalari var. Bu onizleme yalnizca allow tarafindaki yetkiyi ozetler."
      )
    );
  }

  const warnings = Array.from(new Set(warningTexts))
    .map((text, index) => ({
      id: `warning-${index + 1}`,
      text,
    }))
    .sort((left, right) => normalizeText(left.text).localeCompare(normalizeText(right.text)));

  return {
    governedAuthorityLines: authorityLines,
    otherRoleLines: residualRoleLines,
    warnings,
  };
}
