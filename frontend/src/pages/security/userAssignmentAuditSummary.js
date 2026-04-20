import { getRoleCatalogEntry } from "./roleCatalog.js";

function freezeList(values) {
  return Object.freeze(Array.isArray(values) ? values : []);
}

function freezeRule(rule) {
  return Object.freeze({
    ...rule,
    leftRoleCodes: freezeList(rule?.leftRoleCodes),
    rightRoleCodes: freezeList(rule?.rightRoleCodes),
    leftPermissionFamilyCodes: freezeList(rule?.leftPermissionFamilyCodes),
    rightPermissionFamilyCodes: freezeList(rule?.rightPermissionFamilyCodes),
  });
}

const PERMISSION_FAMILY_CATALOG = Object.freeze({
  AP_DRAFT_SUBMIT: Object.freeze({
    labelEn: "AP draft & submit",
    labelTr: "AP taslak ve gonderim",
    anyPermissionCodes: freezeList(["cari.doc.submit"]),
  }),
  AP_APPROVE: Object.freeze({
    labelEn: "AP approve",
    labelTr: "AP onay",
    anyPermissionCodes: freezeList(["approvals.requests.approve"]),
  }),
  AP_POST: Object.freeze({
    labelEn: "AP post",
    labelTr: "AP kayda alma",
    anyPermissionCodes: freezeList(["cari.doc.post"]),
  }),
  AP_REVERSE: Object.freeze({
    labelEn: "AP reverse",
    labelTr: "AP ters kayit",
    anyPermissionCodes: freezeList(["cari.doc.reverse"]),
  }),
  LOCAL_CLOSE_PREPARE: Object.freeze({
    labelEn: "Local Close prepare",
    labelTr: "Local Close hazirlik",
    anyPermissionCodes: freezeList(["ouclose.prepare", "ouclose.submit"]),
  }),
  LOCAL_CLOSE_REVIEW: Object.freeze({
    labelEn: "Local Close review",
    labelTr: "Local Close inceleme",
    anyPermissionCodes: freezeList(["ouclose.review"]),
  }),
  LOCAL_CLOSE_APPROVE_LOCK: Object.freeze({
    labelEn: "Local Close approve & lock",
    labelTr: "Local Close onay ve kilitleme",
    allPermissionCodes: freezeList(["ouclose.approve", "ouclose.lock"]),
  }),
  PERIOD_CLOSE_READINESS: Object.freeze({
    labelEn: "Period-close readiness",
    labelTr: "Donem kapanisi hazirlik",
    allPermissionCodes: freezeList(["org.fiscal_period.read"]),
    anyPermissionCodes: freezeList([
      "gl.book.read",
      "gl.journal.read",
      "gl.trial_balance.read",
    ]),
  }),
  PERIOD_CLOSE: Object.freeze({
    labelEn: "Period close",
    labelTr: "Donem kapatma",
    allPermissionCodes: freezeList(["gl.period.close"]),
  }),
  CONSOLIDATION_PREPARE: Object.freeze({
    labelEn: "Consolidation prepare",
    labelTr: "Konsolidasyon hazirlik",
    anyPermissionCodes: freezeList(["consolidation.run.create"]),
  }),
  CONSOLIDATION_EXECUTE: Object.freeze({
    labelEn: "Consolidation execute",
    labelTr: "Konsolidasyon yurutme",
    anyPermissionCodes: freezeList(["consolidation.run.execute"]),
  }),
  CONSOLIDATION_ADJUST: Object.freeze({
    labelEn: "Consolidation adjustment posting",
    labelTr: "Konsolidasyon duzeltme kaydi",
    anyPermissionCodes: freezeList(["consolidation.adjustment.post"]),
  }),
  CONSOLIDATION_ELIMINATE: Object.freeze({
    labelEn: "Consolidation elimination posting",
    labelTr: "Konsolidasyon eliminasyon kaydi",
    anyPermissionCodes: freezeList(["consolidation.elimination.post"]),
  }),
  CONSOLIDATION_FINALIZE: Object.freeze({
    labelEn: "Consolidation finalize",
    labelTr: "Konsolidasyon sonlandirma",
    anyPermissionCodes: freezeList(["consolidation.run.finalize"]),
  }),
});

const ROLE_PERMISSION_FAMILY_HINTS = Object.freeze({
  BranchOperator: freezeList(["AP_DRAFT_SUBMIT", "PERIOD_CLOSE_READINESS"]),
  OUAPSubmitter: freezeList(["AP_DRAFT_SUBMIT"]),
  EntityAPController: freezeList(["AP_DRAFT_SUBMIT"]),
  CountryAPApprover: freezeList(["AP_APPROVE"]),
  APApprover: freezeList(["AP_APPROVE"]),
  CountryAPPoster: freezeList(["AP_POST", "AP_REVERSE"]),
  LocalClosePreparer: freezeList(["LOCAL_CLOSE_PREPARE"]),
  LocalCloseReviewer: freezeList([
    "LOCAL_CLOSE_REVIEW",
    "LOCAL_CLOSE_APPROVE_LOCK",
  ]),
  LocalCloseApproveLockAuthority: freezeList(["LOCAL_CLOSE_APPROVE_LOCK"]),
  GLOperator: freezeList(["PERIOD_CLOSE_READINESS"]),
  GroupReportingController: freezeList([
    "PERIOD_CLOSE_READINESS",
    "CONSOLIDATION_PREPARE",
    "CONSOLIDATION_EXECUTE",
    "CONSOLIDATION_ADJUST",
    "CONSOLIDATION_ELIMINATE",
    "CONSOLIDATION_FINALIZE",
  ]),
  PeriodCloseAuthority: freezeList(["PERIOD_CLOSE"]),
  ConsolidationRunPreparer: freezeList(["CONSOLIDATION_PREPARE"]),
  ConsolidationRunExecutor: freezeList(["CONSOLIDATION_EXECUTE"]),
  ConsolidationAdjustmentPoster: freezeList(["CONSOLIDATION_ADJUST"]),
  ConsolidationEliminationPoster: freezeList(["CONSOLIDATION_ELIMINATE"]),
  ConsolidationFinalizer: freezeList(["CONSOLIDATION_FINALIZE"]),
});

const REQUIRED_RISKY_RUNTIME_ROLE_RULE_IDS = Object.freeze([
  "ap-maker-reviewer",
  "ap-reviewer-poster",
  "local-close-prepare-review",
  "local-close-review-lock",
  "period-close-readiness-close",
  "consolidation-operator-finalizer",
]);

const RISKY_RUNTIME_ROLE_RULES = Object.freeze({
  "ap-maker-reviewer": freezeRule({
    id: "ap-maker-reviewer",
    severity: "warn",
    titleEn: "AP maker and reviewer overlap",
    titleTr: "AP hazirlama ve inceleme cakismasi",
    descriptionEn:
      "The same user can both submit AP work and approve it at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem AP isini gonderebilir hem de onaylayabilir.",
    leftRoleCodes: ["BranchOperator", "OUAPSubmitter", "EntityAPController"],
    rightRoleCodes: ["CountryAPApprover", "APApprover"],
    leftPermissionFamilyCodes: ["AP_DRAFT_SUBMIT"],
    rightPermissionFamilyCodes: ["AP_APPROVE"],
  }),
  "ap-reviewer-poster": freezeRule({
    id: "ap-reviewer-poster",
    severity: "warn",
    titleEn: "AP reviewer and poster overlap",
    titleTr: "AP inceleme ve post etme cakismasi",
    descriptionEn:
      "The same user can both approve and finalize AP at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem AP onaylayabilir hem de son kaydi yapabilir.",
    leftRoleCodes: ["CountryAPApprover", "APApprover"],
    rightRoleCodes: ["CountryAPPoster"],
    leftPermissionFamilyCodes: ["AP_APPROVE"],
    rightPermissionFamilyCodes: ["AP_POST", "AP_REVERSE"],
  }),
  "local-close-prepare-review": freezeRule({
    id: "local-close-prepare-review",
    severity: "warn",
    titleEn: "Local Close preparer and reviewer overlap",
    titleTr: "Local Close hazirlama ve inceleme cakismasi",
    descriptionEn:
      "The same user can both prepare and review Local Close at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem Local Close hazirlayabilir hem de inceleyebilir.",
    leftRoleCodes: ["LocalClosePreparer"],
    rightRoleCodes: ["LocalCloseReviewer"],
    leftPermissionFamilyCodes: ["LOCAL_CLOSE_PREPARE"],
    rightPermissionFamilyCodes: ["LOCAL_CLOSE_REVIEW"],
  }),
  "local-close-review-lock": freezeRule({
    id: "local-close-review-lock",
    severity: "warn",
    titleEn: "Local Close reviewer and final approver overlap",
    titleTr: "Local Close inceleme ve son onay cakismasi",
    descriptionEn:
      "The same user can both review and approve or lock Local Close at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem Local Close inceleyebilir hem de onaylayip kilitleyebilir.",
    leftRoleCodes: ["LocalCloseReviewer"],
    rightRoleCodes: ["LocalCloseApproveLockAuthority"],
    leftPermissionFamilyCodes: ["LOCAL_CLOSE_REVIEW"],
    rightPermissionFamilyCodes: ["LOCAL_CLOSE_APPROVE_LOCK"],
  }),
  "period-close-readiness-close": freezeRule({
    id: "period-close-readiness-close",
    severity: "warn",
    titleEn: "Period Close readiness and close overlap",
    titleTr: "Donem kapanisi hazirlik ve kapatma cakismasi",
    descriptionEn:
      "The same user can both review readiness and close the period at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem donem hazirligini inceleyebilir hem de donemi kapatabilir.",
    leftRoleCodes: ["BranchOperator", "GLOperator", "GroupReportingController"],
    rightRoleCodes: ["PeriodCloseAuthority"],
    leftPermissionFamilyCodes: ["PERIOD_CLOSE_READINESS"],
    rightPermissionFamilyCodes: ["PERIOD_CLOSE"],
  }),
  "consolidation-operator-finalizer": freezeRule({
    id: "consolidation-operator-finalizer",
    severity: "warn",
    titleEn: "Consolidation operator and finalizer overlap",
    titleTr: "Konsolidasyon operatoru ve sonlandirici cakismasi",
    descriptionEn:
      "The same user can both operate and finalize Consolidation at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem konsolidasyonu yurutebilir hem de sonlandirabilir.",
    leftRoleCodes: [
      "ConsolidationRunPreparer",
      "ConsolidationRunExecutor",
      "ConsolidationAdjustmentPoster",
      "ConsolidationEliminationPoster",
    ],
    rightRoleCodes: ["ConsolidationFinalizer"],
    leftPermissionFamilyCodes: [
      "CONSOLIDATION_PREPARE",
      "CONSOLIDATION_EXECUTE",
      "CONSOLIDATION_ADJUST",
      "CONSOLIDATION_ELIMINATE",
    ],
    rightPermissionFamilyCodes: ["CONSOLIDATION_FINALIZE"],
  }),
});

const missingRiskyRuntimeRoleRuleIds = REQUIRED_RISKY_RUNTIME_ROLE_RULE_IDS.filter(
  (ruleId) => !RISKY_RUNTIME_ROLE_RULES[ruleId]
);

if (missingRiskyRuntimeRoleRuleIds.length > 0) {
  throw new Error(
    `Missing shipped runtime-role SoD rules: ${missingRiskyRuntimeRoleRuleIds.join(", ")}`
  );
}

const RISKY_RUNTIME_ROLE_RULE_LIST = freezeList(
  Object.values(RISKY_RUNTIME_ROLE_RULES)
);

function normalizeText(value) {
  return String(value || "").trim();
}

function toUpperText(value) {
  return normalizeText(value).toUpperCase();
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
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

function safeParsePayloadJson(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function actionEndsWith(action, suffix) {
  const normalizedAction = normalizeText(action);
  return normalizedAction === suffix || normalizedAction.endsWith(`.${suffix}`);
}

function formatActorLabel(row, l) {
  const actorName = normalizeText(row?.actor_user_name);
  const actorEmail = normalizeText(row?.actor_user_email);
  if (actorName && actorEmail) {
    return `${actorName} (${actorEmail})`;
  }
  if (actorName) {
    return actorName;
  }
  if (actorEmail) {
    return actorEmail;
  }
  return translate(l, "Unknown admin", "Bilinmeyen yonetici");
}

function getStatusMeta(status, l) {
  const normalizedStatus = toUpperText(status);
  if (normalizedStatus === "ACTIVE") {
    return {
      label: translate(l, "Active", "Aktif"),
      tone: "green",
    };
  }
  if (normalizedStatus === "UPCOMING") {
    return {
      label: translate(l, "Scheduled", "Planli"),
      tone: "blue",
    };
  }
  if (normalizedStatus === "EXPIRED") {
    return {
      label: translate(l, "Expired", "Suresi doldu"),
      tone: "slate",
    };
  }
  return {
    label: translate(l, "Custom", "Ozel"),
    tone: "amber",
  };
}

function buildScopeKey(scopeType, scopeId) {
  return `${toUpperText(scopeType)}:${Number(scopeId || 0)}`;
}

function resolveCreateAuditEvent(item, auditRows) {
  const candidateRows = (Array.isArray(auditRows) ? auditRows : []).filter((row) => {
    if (!actionEndsWith(row?.action, "assignment.create")) {
      return false;
    }
    if (normalizeText(row?.resource_type) !== "user_role_scope") {
      return false;
    }
    if (Number(row?.target_user_id || 0) !== Number(item.userId || 0)) {
      return false;
    }
    if (toUpperText(row?.scope_type) !== toUpperText(item.scopeType)) {
      return false;
    }
    if (Number(row?.scope_id || 0) !== Number(item.scopeId || 0)) {
      return false;
    }
    if (Number(row?.resource_id || 0) === Number(item.assignmentId || 0)) {
      return true;
    }
    const payload = safeParsePayloadJson(row?.payload_json);
    if (!payload) {
      return false;
    }
    if (
      Number(payload.roleId || 0) &&
      Number(payload.roleId || 0) !== Number(item.roleId || 0)
    ) {
      return false;
    }
    if (
      normalizeText(payload.roleCode) &&
      normalizeText(payload.roleCode) !== normalizeText(item.roleCode)
    ) {
      return false;
    }
    if (
      payload.scopeType &&
      toUpperText(payload.scopeType) !== toUpperText(item.scopeType)
    ) {
      return false;
    }
    if (
      Number(payload.scopeId || 0) &&
      Number(payload.scopeId || 0) !== Number(item.scopeId || 0)
    ) {
      return false;
    }
    return true;
  });

  if (candidateRows.length === 0) {
    return null;
  }

  const itemCreatedAt = toTimestamp(item.createdAt);
  return candidateRows.sort((left, right) => {
    const leftResourceMatch =
      Number(left?.resource_id || 0) === Number(item.assignmentId || 0) ? 0 : 1;
    const rightResourceMatch =
      Number(right?.resource_id || 0) === Number(item.assignmentId || 0) ? 0 : 1;
    if (leftResourceMatch !== rightResourceMatch) {
      return leftResourceMatch - rightResourceMatch;
    }
    if (itemCreatedAt !== null) {
      const leftDistance = Math.abs(
        (toTimestamp(left?.created_at) ?? itemCreatedAt) - itemCreatedAt
      );
      const rightDistance = Math.abs(
        (toTimestamp(right?.created_at) ?? itemCreatedAt) - itemCreatedAt
      );
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
    }
    return (toTimestamp(right?.created_at) || 0) - (toTimestamp(left?.created_at) || 0);
  })[0];
}

function resolveUpdateAuditEvent(item, auditRows) {
  const candidateRows = (Array.isArray(auditRows) ? auditRows : []).filter((row) => {
    if (!actionEndsWith(row?.action, "assignment.scope_replace")) {
      return false;
    }
    if (normalizeText(row?.resource_type) !== "user_role_scope") {
      return false;
    }
    if (Number(row?.target_user_id || 0) !== Number(item.userId || 0)) {
      return false;
    }
    if (Number(row?.resource_id || 0) === Number(item.assignmentId || 0)) {
      return true;
    }
    const payload = safeParsePayloadJson(row?.payload_json);
    return Number(payload?.assignmentId || 0) === Number(item.assignmentId || 0);
  });
  if (candidateRows.length === 0) {
    return null;
  }
  return candidateRows.sort(
    (left, right) =>
      (toTimestamp(right?.created_at) || 0) - (toTimestamp(left?.created_at) || 0)
  )[0];
}

function resolveAuditAttribution(item, auditRows, auditReadable, l) {
  const createEvent = resolveCreateAuditEvent(item, auditRows);
  const updateEvent = resolveUpdateAuditEvent(item, auditRows);
  return {
    grantedByLabel: createEvent
      ? formatActorLabel(createEvent, l)
      : auditReadable
        ? translate(
            l,
            "Not recorded in current audit trail",
            "Mevcut audit izinde kayitli degil"
          )
        : translate(l, "Audit access required", "Audit erisimi gerekli"),
    grantedAt: item.createdAt || createEvent?.created_at || "",
    lastChangedByLabel: updateEvent ? formatActorLabel(updateEvent, l) : "",
    lastChangedAt: updateEvent?.created_at || "",
  };
}

function buildBundleAuditItem(bundle, auditRows, auditReadable, l) {
  const rows = Array.isArray(bundle?.rows) ? bundle.rows : [];
  const directAttributions = rows
    .map((row) =>
      resolveAuditAttribution(
        {
          assignmentId: Number(row?.assignmentId || row?.id || 0),
          userId: Number(row?.userId || row?.user_id || bundle?.userId || 0),
          roleId: Number(row?.roleId || row?.role_id || 0),
          roleCode: normalizeText(row?.roleCode || row?.role_code),
          scopeType: normalizeText(row?.scopeType || row?.scope_type || bundle?.scopeType),
          scopeId: Number(row?.scopeId || row?.scope_id || bundle?.scopeId || 0),
          createdAt: row?.createdAt || row?.created_at || "",
        },
        auditRows,
        auditReadable,
        l
      )
    )
    .filter(Boolean);
  const grantedByLabels = Array.from(
    new Set(
      directAttributions
        .map((entry) => normalizeText(entry.grantedByLabel))
        .filter(Boolean)
    )
  );
  const lastChangedEntries = directAttributions
    .filter((entry) => entry.lastChangedAt)
    .sort(
      (left, right) =>
        (toTimestamp(right.lastChangedAt) || 0) - (toTimestamp(left.lastChangedAt) || 0)
    );
  const statusMeta = getStatusMeta(bundle?.status, l);
  const title =
    normalizeText(bundle?.presetDisplayName) ||
    normalizeText(bundle?.presetCode) ||
    translate(l, "Custom runtime bundle", "Ozel runtime paketi");

  return {
    id: `bundle-${bundle?.id}`,
    kindLabel: translate(l, "Runtime bundle", "Runtime paketi"),
    title,
    scopeType: bundle?.scopeType,
    scopeId: Number(bundle?.scopeId || 0),
    scopeLabel: bundle?.scopeLabel || "",
    sourceLabel: bundle?.isPresetBundle
      ? translate(l, "Preset-derived bundle", "Presetten tureyen paket")
      : translate(l, "Direct runtime role", "Dogrudan runtime rol"),
    sourceDetail: bundle?.presetSummary
      ? bundle.presetSummary
      : translate(
          l,
          "{{count}} underlying runtime roles",
          "{{count}} alttaki runtime rol",
          { count: Array.isArray(bundle?.roleCodes) ? bundle.roleCodes.length : 0 }
        ),
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    effectiveFrom: bundle?.effectiveFrom || "",
    effectiveTo: bundle?.effectiveTo || "",
    grantedAt:
      rows[0]?.createdAt ||
      rows[0]?.created_at ||
      bundle?.createdAt ||
      "",
    grantedByLabel:
      grantedByLabels.length === 0
        ? auditReadable
          ? translate(
              l,
              "Not recorded in current audit trail",
              "Mevcut audit izinde kayitli degil"
            )
          : translate(l, "Audit access required", "Audit erisimi gerekli")
        : grantedByLabels.length === 1
          ? grantedByLabels[0]
          : translate(l, "Multiple admins", "Birden fazla yonetici"),
    lastChangedAt: lastChangedEntries[0]?.lastChangedAt || "",
    lastChangedByLabel: lastChangedEntries[0]?.lastChangedByLabel || "",
  };
}

function sortAuditItems(left, right) {
  const leftTimestamp = toTimestamp(left?.grantedAt) || 0;
  const rightTimestamp = toTimestamp(right?.grantedAt) || 0;
  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }
  return normalizeText(left?.title).localeCompare(normalizeText(right?.title));
}

function getPermissionFamilyLabel(familyCode, l) {
  const family = PERMISSION_FAMILY_CATALOG[toUpperText(familyCode)] || null;
  return family
    ? translate(l, family.labelEn, family.labelTr)
    : normalizeText(familyCode);
}

function resolveRoleMapEntry(rolesByCode, roleCode) {
  if (!rolesByCode || !roleCode) {
    return null;
  }
  if (rolesByCode instanceof Map) {
    return rolesByCode.get(normalizeText(roleCode)) || null;
  }
  return rolesByCode[normalizeText(roleCode)] || null;
}

function resolveRoleLabel(roleCode, rolesByCode) {
  const liveRole = resolveRoleMapEntry(rolesByCode, roleCode);
  const liveLabel =
    normalizeText(liveRole?.displayName) ||
    normalizeText(liveRole?.name) ||
    normalizeText(liveRole?.code);
  if (liveLabel) {
    return liveLabel;
  }
  const catalogEntry = getRoleCatalogEntry(roleCode);
  return (
    normalizeText(catalogEntry?.displayName) ||
    normalizeText(catalogEntry?.code) ||
    normalizeText(roleCode)
  );
}

function normalizePermissionCodeList(permissionCodes) {
  return Array.from(
    new Set(
      (Array.isArray(permissionCodes) ? permissionCodes : [])
        .map((code) => normalizeText(code))
        .filter(Boolean)
    )
  );
}

function resolveRolePermissionCodes(roleCode, rolesByCode) {
  const liveRole = resolveRoleMapEntry(rolesByCode, roleCode);
  return normalizePermissionCodeList(liveRole?.permissionCodes);
}

function roleHasPermissionFamily(permissionCodes, familyCode) {
  const family = PERMISSION_FAMILY_CATALOG[toUpperText(familyCode)] || null;
  if (!family) {
    return false;
  }
  const permissionSet = new Set(normalizePermissionCodeList(permissionCodes));
  const hasAll =
    !Array.isArray(family.allPermissionCodes) ||
    family.allPermissionCodes.every((permissionCode) =>
      permissionSet.has(permissionCode)
    );
  const hasAny =
    !Array.isArray(family.anyPermissionCodes) ||
    family.anyPermissionCodes.some((permissionCode) =>
      permissionSet.has(permissionCode)
    );
  return hasAll && hasAny;
}

function buildRolePermissionFamilySet(roleCode, rolesByCode) {
  const normalizedRoleCode = normalizeText(roleCode);
  const families = new Set(
    ROLE_PERMISSION_FAMILY_HINTS[normalizedRoleCode] || []
  );
  const permissionCodes = resolveRolePermissionCodes(normalizedRoleCode, rolesByCode);
  for (const familyCode of Object.keys(PERMISSION_FAMILY_CATALOG)) {
    if (roleHasPermissionFamily(permissionCodes, familyCode)) {
      families.add(familyCode);
    }
  }
  return families;
}

function isBundleActive(bundle) {
  if (toUpperText(bundle?.effect) === "DENY") {
    return false;
  }
  return ["ACTIVE", "UPCOMING"].includes(toUpperText(bundle?.status));
}

function createEmptyScopeEntry(scopeType, scopeId, scopeLabel) {
  return {
    scopeKey: buildScopeKey(scopeType, scopeId),
    scopeType: toUpperText(scopeType),
    scopeId: Number(scopeId || 0),
    scopeLabel: scopeLabel || "",
    roleCodes: new Set(),
    roleLabels: new Set(),
    rolePermissionFamilies: new Map(),
  };
}

function buildActiveScopeEntries(userBundles, rolesByCode) {
  const byScope = new Map();
  for (const bundle of Array.isArray(userBundles) ? userBundles : []) {
    if (!isBundleActive(bundle)) {
      continue;
    }
    const scopeKey = buildScopeKey(bundle.scopeType, bundle.scopeId);
    if (!byScope.has(scopeKey)) {
      byScope.set(
        scopeKey,
        createEmptyScopeEntry(bundle.scopeType, bundle.scopeId, bundle.scopeLabel)
      );
    }
    const scopeEntry = byScope.get(scopeKey);
    for (const roleCode of Array.isArray(bundle?.roleCodes) ? bundle.roleCodes : []) {
      const normalizedRoleCode = normalizeText(roleCode);
      if (!normalizedRoleCode) {
        continue;
      }
      scopeEntry.roleCodes.add(normalizedRoleCode);
      scopeEntry.roleLabels.add(resolveRoleLabel(normalizedRoleCode, rolesByCode));
      if (!scopeEntry.rolePermissionFamilies.has(normalizedRoleCode)) {
        scopeEntry.rolePermissionFamilies.set(
          normalizedRoleCode,
          buildRolePermissionFamilySet(normalizedRoleCode, rolesByCode)
        );
      }
    }
  }
  return Array.from(byScope.values()).map((scopeEntry) => ({
    ...scopeEntry,
    roleCodes: Array.from(scopeEntry.roleCodes).sort(),
    roleLabels: Array.from(scopeEntry.roleLabels).sort(),
  }));
}

function createProjectedScopeEntry({
  candidateRoleCode,
  scopeId,
  scopeLabel,
  scopeType,
  userBundles,
  rolesByCode,
}) {
  const activeScopeEntries = buildActiveScopeEntries(userBundles, rolesByCode);
  const scopeKey = buildScopeKey(scopeType, scopeId);
  const current =
    activeScopeEntries.find((entry) => entry.scopeKey === scopeKey) ||
    createEmptyScopeEntry(scopeType, scopeId, scopeLabel);
  const next = {
    ...current,
    scopeKey,
    scopeType: toUpperText(scopeType),
    scopeId: Number(scopeId || 0),
    scopeLabel: scopeLabel || current.scopeLabel || scopeKey,
    roleCodes: Array.isArray(current.roleCodes)
      ? new Set(current.roleCodes)
      : new Set(),
    roleLabels: Array.isArray(current.roleLabels)
      ? new Set(current.roleLabels)
      : new Set(),
    rolePermissionFamilies: new Map(current.rolePermissionFamilies || []),
  };
  const normalizedCandidateRoleCode = normalizeText(candidateRoleCode);
  if (normalizedCandidateRoleCode) {
    next.roleCodes.add(normalizedCandidateRoleCode);
    next.roleLabels.add(resolveRoleLabel(normalizedCandidateRoleCode, rolesByCode));
    next.rolePermissionFamilies.set(
      normalizedCandidateRoleCode,
      buildRolePermissionFamilySet(normalizedCandidateRoleCode, rolesByCode)
    );
  }
  return {
    ...next,
    roleCodes: Array.from(next.roleCodes).sort(),
    roleLabels: Array.from(next.roleLabels).sort(),
  };
}

function collectRuleSideEvidence(scopeEntry, rule, side) {
  const sideRoleCodes =
    side === "left"
      ? new Set(rule.leftRoleCodes.map((roleCode) => normalizeText(roleCode)))
      : new Set(rule.rightRoleCodes.map((roleCode) => normalizeText(roleCode)));
  const sidePermissionFamilyCodes =
    side === "left"
      ? rule.leftPermissionFamilyCodes
      : rule.rightPermissionFamilyCodes;
  const matchedRoleCodes = new Set();
  const matchedPermissionFamilyCodes = new Set();

  for (const roleCode of Array.isArray(scopeEntry?.roleCodes) ? scopeEntry.roleCodes : []) {
    const normalizedRoleCode = normalizeText(roleCode);
    const roleFamilies =
      scopeEntry?.rolePermissionFamilies?.get(normalizedRoleCode) || new Set();
    if (sideRoleCodes.has(normalizedRoleCode)) {
      matchedRoleCodes.add(normalizedRoleCode);
    }
    for (const familyCode of sidePermissionFamilyCodes) {
      if (roleFamilies.has(familyCode)) {
        matchedRoleCodes.add(normalizedRoleCode);
        matchedPermissionFamilyCodes.add(familyCode);
      }
    }
  }

  return {
    satisfied:
      matchedRoleCodes.size > 0 || matchedPermissionFamilyCodes.size > 0,
    matchedRoleCodes: Array.from(matchedRoleCodes).sort(),
    matchedPermissionFamilyCodes: Array.from(matchedPermissionFamilyCodes).sort(),
  };
}

function buildRoleConflictWarning(scopeEntry, rule, rolesByCode, l) {
  const leftEvidence = collectRuleSideEvidence(scopeEntry, rule, "left");
  const rightEvidence = collectRuleSideEvidence(scopeEntry, rule, "right");
  if (!leftEvidence.satisfied || !rightEvidence.satisfied) {
    return null;
  }

  const roleLabels = Array.from(
    new Set(
      [...leftEvidence.matchedRoleCodes, ...rightEvidence.matchedRoleCodes].map(
        (roleCode) => resolveRoleLabel(roleCode, rolesByCode)
      )
    )
  ).sort();
  const permissionFamilyLabels = Array.from(
    new Set(
      [
        ...leftEvidence.matchedPermissionFamilyCodes,
        ...rightEvidence.matchedPermissionFamilyCodes,
      ].map((familyCode) => getPermissionFamilyLabel(familyCode, l))
    )
  ).sort();
  const sourceLabels = [];
  if (roleLabels.length > 0) {
    sourceLabels.push(translate(l, "Role conflict", "Rol cakismasi"));
  }
  if (permissionFamilyLabels.length > 0) {
    sourceLabels.push(
      translate(l, "Permission-family fallback", "Yetki-ailesi geri dusumu")
    );
  }

  return {
    id: `${rule.id}-${scopeEntry.scopeKey}`,
    ruleId: rule.id,
    severity: rule.severity || "warn",
    title: translate(l, rule.titleEn, rule.titleTr),
    description: translate(l, rule.descriptionEn, rule.descriptionTr, {
      scope: scopeEntry.scopeLabel,
    }),
    scopeKey: scopeEntry.scopeKey,
    scopeLabel: scopeEntry.scopeLabel,
    roleLabels,
    permissionFamilyLabels,
    sourceLabels,
    matchedRoleCodes: Array.from(
      new Set([
        ...leftEvidence.matchedRoleCodes,
        ...rightEvidence.matchedRoleCodes,
      ])
    ).sort(),
    matchedPermissionFamilyCodes: Array.from(
      new Set([
        ...leftEvidence.matchedPermissionFamilyCodes,
        ...rightEvidence.matchedPermissionFamilyCodes,
      ])
    ).sort(),
  };
}

function buildRoleConflictWarnings(userBundles, rolesByCode, l) {
  const warnings = [];
  for (const scopeEntry of buildActiveScopeEntries(userBundles, rolesByCode)) {
    for (const rule of RISKY_RUNTIME_ROLE_RULE_LIST) {
      const warning = buildRoleConflictWarning(scopeEntry, rule, rolesByCode, l);
      if (warning) {
        warnings.push(warning);
      }
    }
  }
  return warnings;
}

/**
 * Builds UI-only blocked-role diagnostics for one candidate raw-role assignment
 * at one scope. This stays advisory and mirrors the role-native SoD model used
 * by the audit summary so admins can see conflicts before saving.
 */
export function buildCandidateRoleConflictWarnings({
  candidateRoleCode,
  scopeType,
  scopeId,
  scopeLabel,
  userBundles,
  rolesByCode,
  l,
}) {
  const normalizedCandidateRoleCode = normalizeText(candidateRoleCode);
  if (!normalizedCandidateRoleCode || !scopeType || !Number(scopeId || 0)) {
    return [];
  }

  const projectedScopeEntry = createProjectedScopeEntry({
    candidateRoleCode: normalizedCandidateRoleCode,
    scopeType,
    scopeId,
    scopeLabel,
    userBundles,
    rolesByCode,
  });

  const candidateFamilies = buildRolePermissionFamilySet(
    normalizedCandidateRoleCode,
    rolesByCode
  );
  const candidateRoleLabel = resolveRoleLabel(normalizedCandidateRoleCode, rolesByCode);

  return RISKY_RUNTIME_ROLE_RULE_LIST.map((rule) => {
    const warning = buildRoleConflictWarning(
      projectedScopeEntry,
      rule,
      rolesByCode,
      l
    );
    if (!warning) {
      return null;
    }
    const candidateContributes =
      warning.matchedRoleCodes.includes(normalizedCandidateRoleCode) ||
      warning.matchedPermissionFamilyCodes.some((familyCode) =>
        candidateFamilies.has(familyCode)
      );
    if (!candidateContributes) {
      return null;
    }
    return {
      ...warning,
      id: `${warning.id}-${normalizedCandidateRoleCode}`,
      candidateRoleLabels: [candidateRoleLabel],
      description: translate(
        l,
        "{{candidateRole}} would create this overlap at {{scope}}.",
        "{{candidateRole}} rolu {{scope}} kapsaminda bu cakismayi olusturur.",
        {
          candidateRole: candidateRoleLabel,
          scope: projectedScopeEntry.scopeLabel,
        }
      ),
    };
  })
    .filter(Boolean)
    .sort((left, right) => normalizeText(left.title).localeCompare(normalizeText(right.title)));
}

/**
 * Builds the selected-user audit timeline and role-native SoD summary from the
 * current runtime bundles plus optional RBAC audit logs.
 */
export function buildAssignmentAuditSummary({
  userBundles,
  auditRows,
  auditReadable,
  l,
  rolesByCode,
}) {
  const bundleItems = (Array.isArray(userBundles) ? userBundles : []).map((bundle) =>
    buildBundleAuditItem(bundle, auditRows, auditReadable, l)
  );

  const auditItems = bundleItems.sort(sortAuditItems);
  const sodWarnings = Array.from(
    new Map(
      buildRoleConflictWarnings(userBundles, rolesByCode, l).map((warning) => [
        warning.id,
        warning,
      ])
    ).values()
  );

  return {
    auditItems,
    sodWarnings,
  };
}
