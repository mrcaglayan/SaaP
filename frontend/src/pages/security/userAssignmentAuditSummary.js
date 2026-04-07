const SOD_PACKAGE_RULES = Object.freeze([
  Object.freeze({
    id: "ap-maker-reviewer",
    titleEn: "AP maker and reviewer overlap",
    titleTr: "AP hazirlama ve inceleme cakismasi",
    descriptionEn:
      "The same user can draft or submit AP and also approve it at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem AP taslagi hazirlayip gonderebilir hem de onaylayabilir.",
    requiredPackageCodes: Object.freeze(["PKG-AP-DRAFT-SUBMIT", "PKG-AP-APPROVE"]),
  }),
  Object.freeze({
    id: "ap-reviewer-poster",
    titleEn: "AP reviewer and poster overlap",
    titleTr: "AP inceleme ve post etme cakismasi",
    descriptionEn:
      "The same user can both approve and finalize AP at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem AP onaylayabilir hem de son kaydi yapabilir.",
    requiredPackageCodes: Object.freeze(["PKG-AP-APPROVE"]),
    anyPackageCodes: Object.freeze(["PKG-AP-POST", "PKG-AP-REVERSE", "PKG-AP-POST-GROUP"]),
  }),
  Object.freeze({
    id: "local-close-prepare-review",
    titleEn: "Local Close preparer and reviewer overlap",
    titleTr: "Local Close hazirlama ve inceleme cakismasi",
    descriptionEn:
      "The same user can both prepare and review Local Close at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem Local Close hazirlayabilir hem de inceleyebilir.",
    requiredPackageCodes: Object.freeze(["PKG-LC-PREPARE", "PKG-LC-REVIEW"]),
  }),
  Object.freeze({
    id: "local-close-review-lock",
    titleEn: "Local Close reviewer and final approver overlap",
    titleTr: "Local Close inceleme ve son onay cakismasi",
    descriptionEn:
      "The same user can both review and approve or lock Local Close at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem Local Close inceleyebilir hem de onaylayip kilitleyebilir.",
    requiredPackageCodes: Object.freeze(["PKG-LC-REVIEW", "PKG-LC-APPROVE-LOCK"]),
  }),
  Object.freeze({
    id: "period-close-readiness-close",
    titleEn: "Period Close readiness and close overlap",
    titleTr: "Donem kapanisi hazirlik ve kapatma cakismasi",
    descriptionEn:
      "The same user can both review readiness and close the period at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem donem hazirligini inceleyebilir hem de donemi kapatabilir.",
    requiredPackageCodes: Object.freeze(["PKG-PC-READINESS", "PKG-PC-CLOSE"]),
  }),
  Object.freeze({
    id: "consolidation-operator-finalizer",
    titleEn: "Consolidation operator and finalizer overlap",
    titleTr: "Konsolidasyon operatoru ve sonlandirici cakismasi",
    descriptionEn:
      "The same user can prepare or execute and also finalize Consolidation at {{scope}}.",
    descriptionTr:
      "Ayni kullanici {{scope}} kapsaminda hem konsolidasyonu hazirlayip yurutebilir hem de sonlandirabilir.",
    requiredPackageCodes: Object.freeze(["PKG-CON-FINALIZE"]),
    anyPackageCodes: Object.freeze([
      "PKG-CON-PREPARE",
      "PKG-CON-EXECUTE",
      "PKG-CON-ADJUST",
      "PKG-CON-ELIM",
    ]),
  }),
]);

const RISKY_RUNTIME_ROLE_RULES = Object.freeze({
  APDocumentPoster: Object.freeze({
    titleEn: "Legacy AP poster role still combines duties",
    titleTr: "Legacy AP poster rolu gorevleri hala birlestiriyor",
    descriptionEn:
      "Legacy APDocumentPoster keeps AP submit and posting style authority together at {{scope}}. Prefer separate AP Submitter and AP Poster package grants.",
    descriptionTr:
      "Legacy APDocumentPoster, {{scope}} kapsaminda AP gonderim ve post etme benzeri yetkileri birlikte tutuyor. Bunun yerine ayri AP Submitter ve AP Poster paketlerini tercih edin.",
  }),
  GroupController: Object.freeze({
    titleEn: "Legacy group controller remains broad",
    titleTr: "Legacy grup controller rolu genis kalmaya devam ediyor",
    descriptionEn:
      "Legacy GroupController keeps broad cross-process authority at {{scope}}. Prefer separated group packages and business-role labels.",
    descriptionTr:
      "Legacy GroupController, {{scope}} kapsaminda genis surecler arasi yetkileri birlikte tutuyor. Bunun yerine ayrik grup paketlerini ve is rol etiketlerini tercih edin.",
  }),
  CountryController: Object.freeze({
    titleEn: "Legacy country controller remains broad",
    titleTr: "Legacy country controller rolu genis kalmaya devam ediyor",
    descriptionEn:
      "Legacy CountryController keeps broad country-wide control authority at {{scope}}. Prefer separated review, posting, and governance packages.",
    descriptionTr:
      "Legacy CountryController, {{scope}} kapsaminda genis ulke-geneli kontrol yetkilerini birlikte tutuyor. Bunun yerine ayrik inceleme, post etme ve yonetim paketlerini tercih edin.",
  }),
  EntityAccountant: Object.freeze({
    titleEn: "Legacy entity accountant remains broad",
    titleTr: "Legacy entity accountant rolu genis kalmaya devam ediyor",
    descriptionEn:
      "Legacy EntityAccountant keeps broad entity authority at {{scope}}. Prefer cleaner business-role labels plus scoped package grants.",
    descriptionTr:
      "Legacy EntityAccountant, {{scope}} kapsaminda genis entity yetkilerini birlikte tutuyor. Bunun yerine daha temiz is rol etiketleri ve kapsamli paket atamalarini tercih edin.",
  }),
});

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
    if (Number(payload.roleId || 0) && Number(payload.roleId || 0) !== Number(item.roleId || 0)) {
      return false;
    }
    if (normalizeText(payload.roleCode) && normalizeText(payload.roleCode) !== normalizeText(item.roleCode)) {
      return false;
    }
    if (payload.scopeType && toUpperText(payload.scopeType) !== toUpperText(item.scopeType)) {
      return false;
    }
    if (Number(payload.scopeId || 0) && Number(payload.scopeId || 0) !== Number(item.scopeId || 0)) {
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
      const leftDistance = Math.abs((toTimestamp(left?.created_at) ?? itemCreatedAt) - itemCreatedAt);
      const rightDistance = Math.abs((toTimestamp(right?.created_at) ?? itemCreatedAt) - itemCreatedAt);
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
    (left, right) => (toTimestamp(right?.created_at) || 0) - (toTimestamp(left?.created_at) || 0)
  )[0];
}

function resolveAuditAttribution(item, auditRows, auditReadable, l) {
  const createEvent = resolveCreateAuditEvent(item, auditRows);
  const updateEvent = resolveUpdateAuditEvent(item, auditRows);
  return {
    grantedByLabel: createEvent
      ? formatActorLabel(createEvent, l)
      : auditReadable
        ? translate(l, "Not recorded in current audit trail", "Mevcut audit izinde kayitli degil")
        : translate(l, "Audit access required", "Audit erisimi gerekli"),
    grantedAt: item.createdAt || createEvent?.created_at || "",
    lastChangedByLabel: updateEvent ? formatActorLabel(updateEvent, l) : "",
    lastChangedAt: updateEvent?.created_at || "",
  };
}

function buildDirectAuditItem({
  assignment,
  kindLabel,
  title,
  sourceLabel,
  sourceDetail,
  auditRows,
  auditReadable,
  l,
}) {
  const attribution = resolveAuditAttribution(assignment, auditRows, auditReadable, l);
  const statusMeta = getStatusMeta(assignment.status, l);
  return {
    id: `${kindLabel}-${assignment.assignmentId}`,
    kindLabel,
    title,
    scopeType: assignment.scopeType,
    scopeId: Number(assignment.scopeId || 0),
    scopeLabel: assignment.scopeLabel,
    sourceLabel,
    sourceDetail,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    effectiveFrom: assignment.effectiveFrom || "",
    effectiveTo: assignment.effectiveTo || "",
    grantedAt: attribution.grantedAt,
    grantedByLabel: attribution.grantedByLabel,
    lastChangedAt: attribution.lastChangedAt,
    lastChangedByLabel: attribution.lastChangedByLabel,
  };
}

function buildBundleAuditItem(bundle, auditRows, auditReadable, l) {
  const rows = Array.isArray(bundle?.rows) ? bundle.rows : [];
  const directAttributions = rows
    .map((row) =>
      resolveAuditAttribution(
        {
          assignmentId: Number(row?.id || 0),
          userId: Number(row?.user_id || bundle?.userId || 0),
          roleId: Number(row?.role_id || 0),
          roleCode: normalizeText(row?.role_code),
          scopeType: normalizeText(row?.scope_type || bundle?.scopeType),
          scopeId: Number(row?.scope_id || bundle?.scopeId || 0),
          createdAt: row?.created_at || "",
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
    .sort((left, right) => (toTimestamp(right.lastChangedAt) || 0) - (toTimestamp(left.lastChangedAt) || 0));
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
      : bundle?.hasLegacyRole
        ? translate(l, "Legacy runtime mapping", "Legacy runtime eslemesi")
        : translate(l, "Runtime role mapping", "Runtime rol eslemesi"),
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
    grantedAt: bundle?.rows?.[0]?.created_at || "",
    grantedByLabel:
      grantedByLabels.length === 0
        ? auditReadable
          ? translate(l, "Not recorded in current audit trail", "Mevcut audit izinde kayitli degil")
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

function addPackageGrant(grantsByScope, scopeType, scopeId, scopeLabel, packageCode, sourceLabel) {
  const normalizedPackageCode = toUpperText(packageCode);
  if (!normalizedPackageCode) {
    return;
  }
  const scopeKey = buildScopeKey(scopeType, scopeId);
  if (!grantsByScope.has(scopeKey)) {
    grantsByScope.set(scopeKey, {
      scopeKey,
      scopeType: toUpperText(scopeType),
      scopeId: Number(scopeId || 0),
      scopeLabel: scopeLabel || "",
      packageCodes: new Set(),
      sourceLabels: new Set(),
    });
  }
  const entry = grantsByScope.get(scopeKey);
  entry.packageCodes.add(normalizedPackageCode);
  if (sourceLabel) {
    entry.sourceLabels.add(sourceLabel);
  }
}

function buildPackageScopeEntries(workflowPackageAssignments, userBundles) {
  const grantsByScope = new Map();
  for (const assignment of Array.isArray(workflowPackageAssignments) ? workflowPackageAssignments : []) {
    if (toUpperText(assignment?.effect) === "DENY") {
      continue;
    }
    if (!["ACTIVE", "UPCOMING"].includes(toUpperText(assignment?.status))) {
      continue;
    }
    addPackageGrant(
      grantsByScope,
      assignment.scopeType,
      assignment.scopeId,
      assignment.scopeLabel,
      assignment.packageCode,
      assignment.sourceTypeLabel
    );
  }
  for (const bundle of Array.isArray(userBundles) ? userBundles : []) {
    if (toUpperText(bundle?.effect) === "DENY") {
      continue;
    }
    if (!["ACTIVE", "UPCOMING"].includes(toUpperText(bundle?.status))) {
      continue;
    }
    const sourceLabel = bundle?.isPresetBundle
      ? "Preset-derived bundle"
      : bundle?.hasLegacyRole
        ? "Legacy runtime mapping"
        : "Runtime role mapping";
    for (const packageCode of Array.isArray(bundle?.packageCodes) ? bundle.packageCodes : []) {
      addPackageGrant(
        grantsByScope,
        bundle.scopeType,
        bundle.scopeId,
        bundle.scopeLabel,
        packageCode,
        sourceLabel
      );
    }
  }
  return Array.from(grantsByScope.values());
}

function buildPackageRuleWarnings(scopeEntries, l) {
  const warnings = [];
  for (const scopeEntry of scopeEntries) {
    const packageCodeSet = scopeEntry.packageCodes;
    for (const rule of SOD_PACKAGE_RULES) {
      const hasRequiredPackages = (rule.requiredPackageCodes || []).every((packageCode) =>
        packageCodeSet.has(packageCode)
      );
      if (!hasRequiredPackages) {
        continue;
      }
      const hasAnyPackages =
        !Array.isArray(rule.anyPackageCodes) ||
        rule.anyPackageCodes.some((packageCode) => packageCodeSet.has(packageCode));
      if (!hasAnyPackages) {
        continue;
      }
      warnings.push({
        id: `${rule.id}-${scopeEntry.scopeKey}`,
        title: translate(l, rule.titleEn, rule.titleTr),
        description: translate(l, rule.descriptionEn, rule.descriptionTr, {
          scope: scopeEntry.scopeLabel,
        }),
        scopeLabel: scopeEntry.scopeLabel,
        sourceLabels: Array.from(scopeEntry.sourceLabels),
      });
    }
  }
  return warnings;
}

function buildRuntimeRoleWarnings(userBundles, l) {
  const warnings = [];
  for (const bundle of Array.isArray(userBundles) ? userBundles : []) {
    if (!["ACTIVE", "UPCOMING"].includes(toUpperText(bundle?.status))) {
      continue;
    }
    for (const roleCode of Array.isArray(bundle?.roleCodes) ? bundle.roleCodes : []) {
      const roleRule = RISKY_RUNTIME_ROLE_RULES[normalizeText(roleCode)];
      if (!roleRule) {
        continue;
      }
      warnings.push({
        id: `${normalizeText(roleCode)}-${buildScopeKey(bundle.scopeType, bundle.scopeId)}`,
        title: translate(l, roleRule.titleEn, roleRule.titleTr),
        description: translate(l, roleRule.descriptionEn, roleRule.descriptionTr, {
          scope: bundle.scopeLabel,
        }),
        scopeLabel: bundle.scopeLabel,
        sourceLabels: [translate(l, "Legacy runtime mapping", "Legacy runtime eslemesi")],
      });
    }
  }
  return warnings;
}

/**
 * Builds the UI-2F selected-user audit timeline and UI-only SoD warning
 * summary. It reuses current assignment rows plus optional RBAC audit logs,
 * and intentionally stays advisory instead of enforcing service-layer policy.
 */
export function buildAssignmentAuditSummary({
  businessRoleAssignments,
  workflowPackageAssignments,
  userBundles,
  auditRows,
  auditReadable,
  l,
}) {
  const businessRoleItems = (Array.isArray(businessRoleAssignments) ? businessRoleAssignments : []).map(
    (assignment) =>
      buildDirectAuditItem({
        assignment,
        kindLabel: translate(l, "Business role label", "Is rol etiketi"),
        title: assignment.businessRoleLabel,
        sourceLabel: translate(l, "Direct label assignment", "Dogrudan etiket atamasi"),
        sourceDetail: translate(
          l,
          "Non-authoritative business title only.",
          "Yalnizca otorite vermeyen is unvani."
        ),
        auditRows,
        auditReadable,
        l,
      })
  );

  const workflowPackageItems = (Array.isArray(workflowPackageAssignments) ? workflowPackageAssignments : []).map(
    (assignment) =>
      buildDirectAuditItem({
        assignment,
        kindLabel: translate(l, "Workflow package", "Workflow paketi"),
        title: assignment.packageLabel,
        sourceLabel: assignment.sourceTypeLabel || translate(l, "Direct / custom", "Dogrudan / ozel"),
        sourceDetail: assignment.sourceDetail || assignment.packageSummary || "",
        auditRows,
        auditReadable,
        l,
      })
  );

  const bundleItems = (Array.isArray(userBundles) ? userBundles : []).map((bundle) =>
    buildBundleAuditItem(bundle, auditRows, auditReadable, l)
  );

  const auditItems = [...businessRoleItems, ...workflowPackageItems, ...bundleItems].sort(
    sortAuditItems
  );

  const packageWarnings = buildPackageRuleWarnings(
    buildPackageScopeEntries(workflowPackageAssignments, userBundles),
    l
  );
  const runtimeWarnings = buildRuntimeRoleWarnings(userBundles, l);
  const sodWarnings = Array.from(
    new Map(
      [...packageWarnings, ...runtimeWarnings].map((warning) => [warning.id, warning])
    ).values()
  );

  return {
    auditItems,
    sodWarnings,
  };
}
