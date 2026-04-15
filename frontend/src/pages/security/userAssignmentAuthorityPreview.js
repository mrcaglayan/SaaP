import {
  getRoleCatalogEntry,
  getWorkflowPackageCatalogEntry,
  resolveWorkflowPackagesForRuntimeRoles,
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

function sortWorkflowLines(left, right) {
  const leftFamilyOrder =
    WORKFLOW_FAMILY_ORDER[normalizeText(left?.workflowFamily).toUpperCase()] || 999;
  const rightFamilyOrder =
    WORKFLOW_FAMILY_ORDER[normalizeText(right?.workflowFamily).toUpperCase()] || 999;
  if (leftFamilyOrder !== rightFamilyOrder) {
    return leftFamilyOrder - rightFamilyOrder;
  }
  return sortByScope(left, right);
}

function getManagedPackageSourceLabel(sourceType, l) {
  const normalizedSourceType = normalizeText(sourceType).toUpperCase();
  if (normalizedSourceType === "STARTER_DERIVED") {
    return translate(l, "Starter package", "Starter paket");
  }
  if (normalizedSourceType === "PRESET_DERIVED") {
    return translate(l, "Preset-derived package", "Presetten tureyen paket");
  }
  return translate(l, "Workflow package", "Workflow paketi");
}

function getBundleSourceLabel(bundle, l) {
  if (bundle?.isPresetBundle) {
    return translate(l, "Preset-derived package", "Presetten tureyen paket");
  }
  return translate(l, "Direct runtime role", "Dogrudan runtime rol");
}

function pushWorkflowGrant(grantsByKey, grant) {
  const grantKey = [
    normalizeText(grant.workflowFamily).toUpperCase(),
    normalizeText(grant.scopeType).toUpperCase(),
    Number(grant.scopeId || 0),
    normalizeText(grant.packageCode).toUpperCase(),
  ].join("|");
  const existingGrant = grantsByKey.get(grantKey);
  if (existingGrant) {
    existingGrant.sourceLabels.add(grant.sourceLabel);
    existingGrant.hasManagedPackageSource ||= Boolean(grant.hasManagedPackageSource);
    existingGrant.hasRuntimeRoleSource ||= Boolean(grant.hasRuntimeRoleSource);
    return;
  }
  grantsByKey.set(grantKey, {
    ...grant,
    sourceLabels: new Set([grant.sourceLabel].filter(Boolean)),
    hasManagedPackageSource: Boolean(grant.hasManagedPackageSource),
    hasRuntimeRoleSource: Boolean(grant.hasRuntimeRoleSource),
  });
}

function buildWorkflowCapabilitySummary(workflowFamily, packageCodes, l) {
  const codeSet = new Set((Array.isArray(packageCodes) ? packageCodes : []).map((code) => normalizeText(code).toUpperCase()));
  if (normalizeText(workflowFamily).toUpperCase() === "CROSS_WORKFLOW") {
    const actions = [];
    if (codeSet.has("PKG-WF-SETUP-ADMIN")) {
      actions.push(
        translate(
          l,
          "manage workflow governance setup",
          "workflow yonetim kurulumunu yonetebilir"
        )
      );
    }
    if (codeSet.has("PKG-WF-QUEUE-VIEW")) {
      actions.push(
        translate(l, "view workflow queues", "workflow kuyruklarini goruntuleyebilir")
      );
    }
    return {
      summaryText: joinHumanList(actions, l),
      missingText: "",
    };
  }

  if (normalizeText(workflowFamily).toUpperCase() === "AP_DOCUMENT_POSTING") {
    const hasView = codeSet.has("PKG-AP-VIEW");
    const hasDraftSubmit = codeSet.has("PKG-AP-DRAFT-SUBMIT");
    const hasApprove = codeSet.has("PKG-AP-APPROVE");
    const hasPost =
      codeSet.has("PKG-AP-POST") || codeSet.has("PKG-AP-POST-GROUP");
    const hasReverse = codeSet.has("PKG-AP-REVERSE");
    const hasFxOverride = codeSet.has("PKG-AP-FX-OVERRIDE");
    const actions = [];
    if (hasView && !hasDraftSubmit && !hasApprove && !hasPost && !hasReverse && !hasFxOverride) {
      actions.push(translate(l, "view AP", "AP goruntuleyebilir"));
    }
    if (hasDraftSubmit) {
      actions.push(translate(l, "draft and submit AP", "AP taslagi olusturup gonderebilir"));
    }
    if (hasApprove) {
      actions.push(translate(l, "approve AP", "AP onaylayabilir"));
    }
    if (hasPost) {
      actions.push(translate(l, "post AP", "AP post edebilir"));
    }
    if (hasReverse) {
      actions.push(translate(l, "reverse AP", "AP ters kayit yapabilir"));
    }
    if (hasFxOverride) {
      actions.push(translate(l, "override AP FX", "AP kur override yapabilir"));
    }
    let missingText = "";
    if (!hasPost) {
      missingText =
        hasView && !hasDraftSubmit && !hasApprove && !hasReverse && !hasFxOverride
          ? translate(
              l,
              "draft, approve, or post AP",
              "AP taslagi olusturma, onaylama veya post etme"
            )
          : translate(l, "post AP", "AP post etme");
    }
    return {
      summaryText: joinHumanList(actions, l),
      missingText,
    };
  }

  if (normalizeText(workflowFamily).toUpperCase() === "LOCAL_CLOSE_PACK") {
    const hasView = codeSet.has("PKG-LC-VIEW");
    const hasPrepare = codeSet.has("PKG-LC-PREPARE");
    const hasReview = codeSet.has("PKG-LC-REVIEW");
    const hasApproveLock = codeSet.has("PKG-LC-APPROVE-LOCK");
    const hasReopenAdmin = codeSet.has("PKG-LC-REOPEN-ADMIN");
    const actions = [];
    if (hasView && !hasPrepare && !hasReview && !hasApproveLock && !hasReopenAdmin) {
      actions.push(translate(l, "view Local Close", "Local Close goruntuleyebilir"));
    }
    if (hasPrepare) {
      actions.push(
        translate(l, "prepare and submit Local Close", "Local Close hazirlayip gonderebilir")
      );
    }
    if (hasReview) {
      actions.push(translate(l, "review Local Close", "Local Close inceleyebilir"));
    }
    if (hasApproveLock) {
      actions.push(
        translate(l, "approve and lock Local Close", "Local Close onaylayip kilitleyebilir")
      );
    }
    if (hasReopenAdmin) {
      actions.push(
        translate(
          l,
          "reopen and administer Local Close",
          "Local Close yeniden acip yonetebilir"
        )
      );
    }
    let missingText = "";
    if (!hasApproveLock && (hasPrepare || hasReview)) {
      missingText = translate(
        l,
        "approve and lock Local Close",
        "Local Close onaylayip kilitleme"
      );
    } else if (hasView && !hasPrepare && !hasReview && !hasApproveLock && !hasReopenAdmin) {
      missingText = translate(
        l,
        "review or approve Local Close",
        "Local Close inceleme veya onaylama"
      );
    }
    return {
      summaryText: joinHumanList(actions, l),
      missingText,
    };
  }

  if (normalizeText(workflowFamily).toUpperCase() === "PERIOD_CLOSE") {
    const hasReadiness = codeSet.has("PKG-PC-READINESS");
    const hasClose = codeSet.has("PKG-PC-CLOSE");
    const actions = [];
    if (hasReadiness) {
      actions.push(
        translate(
          l,
          "review period-close readiness",
          "donem kapanis hazirlik durumunu inceleyebilir"
        )
      );
    }
    if (hasClose) {
      actions.push(translate(l, "close periods", "donem kapatabilir"));
    }
    return {
      summaryText: joinHumanList(actions, l),
      missingText:
        hasReadiness && !hasClose
          ? translate(l, "close periods", "donem kapatma")
          : "",
    };
  }

  if (normalizeText(workflowFamily).toUpperCase() === "CONSOLIDATION_RUN") {
    const hasView = codeSet.has("PKG-CON-VIEW");
    const hasPrepare = codeSet.has("PKG-CON-PREPARE");
    const hasExecute = codeSet.has("PKG-CON-EXECUTE");
    const hasAdjust = codeSet.has("PKG-CON-ADJUST");
    const hasEliminate = codeSet.has("PKG-CON-ELIM");
    const hasFinalize = codeSet.has("PKG-CON-FINALIZE");
    const hasSetup = codeSet.has("PKG-CON-SETUP");
    const actions = [];
    if (hasView && !hasPrepare && !hasExecute && !hasAdjust && !hasEliminate && !hasFinalize) {
      actions.push(translate(l, "view Consolidation", "konsolidasyon goruntuleyebilir"));
    }
    if (hasPrepare) {
      actions.push(
        translate(
          l,
          "prepare Consolidation runs",
          "konsolidasyon calistirmalarini hazirlayabilir"
        )
      );
    }
    if (hasExecute) {
      actions.push(
        translate(
          l,
          "execute Consolidation runs",
          "konsolidasyon calistirmalarini yurutebilir"
        )
      );
    }
    if (hasAdjust) {
      actions.push(
        translate(
          l,
          "post Consolidation adjustments",
          "konsolidasyon duzeltmelerini post edebilir"
        )
      );
    }
    if (hasEliminate) {
      actions.push(
        translate(
          l,
          "post Consolidation eliminations",
          "konsolidasyon eliminasyonlarini post edebilir"
        )
      );
    }
    if (hasFinalize) {
      actions.push(
        translate(l, "finalize Consolidation", "konsolidasyonu sonlandirabilir")
      );
    }
    if (hasSetup) {
      actions.push(
        translate(
          l,
          "administer Consolidation setup",
          "konsolidasyon kurulumunu yonetebilir"
        )
      );
    }
    let missingText = "";
    if (!hasFinalize && (hasPrepare || hasExecute || hasAdjust || hasEliminate)) {
      missingText = translate(
        l,
        "finalize Consolidation",
        "konsolidasyonu sonlandirma"
      );
    } else if (hasView && !hasPrepare && !hasExecute && !hasAdjust && !hasEliminate && !hasFinalize) {
      missingText = translate(
        l,
        "prepare, execute, or finalize Consolidation",
        "konsolidasyonu hazirlama, yurutme veya sonlandirma"
      );
    }
    return {
      summaryText: joinHumanList(actions, l),
      missingText,
    };
  }

  return {
    summaryText: "",
    missingText: "",
  };
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
    { role: roleEntry.code || normalizeText(roleCode) }
  );
}

/**
 * Builds the readable UI-2E authority preview for the selected user from the
 * current allow-side assignments.
 */
export function buildEffectiveAuthorityPreview({
  workflowPackageAssignments,
  userBundles,
  l,
}) {
  const activeWorkflowPackageAssignments = (Array.isArray(workflowPackageAssignments)
    ? workflowPackageAssignments
    : []
  ).filter(
    (assignment) =>
      normalizeText(assignment?.status).toUpperCase() === "ACTIVE" &&
      normalizeText(assignment?.effect).toUpperCase() !== "DENY"
  );
  const activeUserBundles = (Array.isArray(userBundles) ? userBundles : []).filter(
    (bundle) =>
      normalizeText(bundle?.status).toUpperCase() === "ACTIVE" &&
      normalizeText(bundle?.effect).toUpperCase() !== "DENY"
  );

  const workflowGrantsByKey = new Map();
  for (const assignment of activeWorkflowPackageAssignments) {
    const workflowPackageEntry = getWorkflowPackageCatalogEntry(assignment.packageCode);
    if (!workflowPackageEntry.code) {
      continue;
    }
    pushWorkflowGrant(workflowGrantsByKey, {
      workflowFamily: workflowPackageEntry.workflowFamily,
      workflowFamilyLabel: workflowPackageEntry.workflowFamilyLabel,
      packageCode: workflowPackageEntry.code,
      packageLabel: workflowPackageEntry.displayName,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      scopeLabel: assignment.scopeLabel,
      sourceLabel: getManagedPackageSourceLabel(assignment.sourceType, l),
      hasManagedPackageSource: true,
      hasRuntimeRoleSource: false,
    });
  }

  for (const bundle of activeUserBundles) {
    for (const packageCode of Array.isArray(bundle?.packageCodes) ? bundle.packageCodes : []) {
      const workflowPackageEntry = getWorkflowPackageCatalogEntry(packageCode);
      if (!workflowPackageEntry.code) {
        continue;
      }
      pushWorkflowGrant(workflowGrantsByKey, {
        workflowFamily: workflowPackageEntry.workflowFamily,
        workflowFamilyLabel: workflowPackageEntry.workflowFamilyLabel,
        packageCode: workflowPackageEntry.code,
        packageLabel: workflowPackageEntry.displayName,
        scopeType: bundle.scopeType,
        scopeId: bundle.scopeId,
        scopeLabel: bundle.scopeLabel,
        sourceLabel: getBundleSourceLabel(bundle, l),
        hasManagedPackageSource: false,
        hasRuntimeRoleSource: true,
      });
    }
  }

  const workflowGroupsByScope = new Map();
  for (const grant of workflowGrantsByKey.values()) {
    const groupKey = [
      normalizeText(grant.workflowFamily).toUpperCase(),
      normalizeText(grant.scopeType).toUpperCase(),
      Number(grant.scopeId || 0),
    ].join("|");
    if (!workflowGroupsByScope.has(groupKey)) {
      workflowGroupsByScope.set(groupKey, {
        id: groupKey,
        workflowFamily: grant.workflowFamily,
        workflowFamilyLabel: grant.workflowFamilyLabel,
        scopeType: grant.scopeType,
        scopeId: Number(grant.scopeId || 0),
        scopeLabel: grant.scopeLabel,
        packageCodes: new Set(),
        sourceLabels: new Set(),
        hasManagedPackageSource: false,
        hasRuntimeRoleSource: false,
      });
    }
    const group = workflowGroupsByScope.get(groupKey);
    group.packageCodes.add(grant.packageCode);
    for (const sourceLabel of grant.sourceLabels) {
      group.sourceLabels.add(sourceLabel);
    }
    group.hasManagedPackageSource ||= Boolean(grant.hasManagedPackageSource);
    group.hasRuntimeRoleSource ||= Boolean(grant.hasRuntimeRoleSource);
  }

  const workflowLines = Array.from(workflowGroupsByScope.values())
    .map((group) => {
      const summary = buildWorkflowCapabilitySummary(
        group.workflowFamily,
        Array.from(group.packageCodes),
        l
      );
      if (!summary.summaryText) {
        return null;
      }
      return {
        id: group.id,
        workflowFamily: group.workflowFamily,
        workflowFamilyLabel: group.workflowFamilyLabel,
        scopeType: group.scopeType,
        scopeId: group.scopeId,
        scopeLabel: group.scopeLabel,
        summaryText: summary.summaryText,
        missingText: summary.missingText,
        sourceLabels: Array.from(group.sourceLabels).sort(),
        noteText:
          !group.hasManagedPackageSource && group.hasRuntimeRoleSource
            ? translate(
                l,
                "Summarized from the current direct runtime roles at this scope.",
                "Bu kapsamda mevcut dogrudan runtime rollerinden ozetlendi."
              )
            : group.hasManagedPackageSource && group.hasRuntimeRoleSource
              ? translate(
                  l,
                  "Combines workflow packages and direct runtime roles at this scope.",
                  "Bu kapsamda workflow paketleri ile dogrudan runtime rollerini birlikte gosterir."
                )
              : "",
      };
    })
    .filter(Boolean)
    .sort(sortWorkflowLines);

  const runtimeLines = [];
  const runtimeLineKeys = new Set();
  for (const bundle of activeUserBundles) {
    for (const roleCode of Array.isArray(bundle?.roleCodes) ? bundle.roleCodes : []) {
      if (resolveWorkflowPackagesForRuntimeRoles([roleCode]).length > 0) {
        continue;
      }
      const runtimeLineKey = [
        normalizeText(roleCode),
        normalizeText(bundle.scopeType).toUpperCase(),
        Number(bundle.scopeId || 0),
      ].join("|");
      if (runtimeLineKeys.has(runtimeLineKey)) {
        continue;
      }
      runtimeLineKeys.add(runtimeLineKey);
      const roleEntry = getRoleCatalogEntry(roleCode);
      runtimeLines.push({
        id: runtimeLineKey,
        roleCode: normalizeText(roleCode),
        roleLabel: roleEntry.code,
        scopeType: bundle.scopeType,
        scopeId: Number(bundle.scopeId || 0),
        scopeLabel: bundle.scopeLabel,
        summaryText: getRuntimeRoleSummary(roleCode, roleEntry, l),
        sourceLabels: [translate(l, "Direct runtime role", "Dogrudan runtime rol")],
      });
    }
  }
  runtimeLines.sort(sortByScope);

  const warningTexts = [];

  if (
    (Array.isArray(workflowPackageAssignments) ? workflowPackageAssignments : []).some(
      (assignment) =>
        normalizeText(assignment?.status).toUpperCase() === "ACTIVE" &&
        normalizeText(assignment?.effect).toUpperCase() === "DENY"
    ) ||
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
    workflowLines,
    runtimeLines,
    warnings,
  };
}
