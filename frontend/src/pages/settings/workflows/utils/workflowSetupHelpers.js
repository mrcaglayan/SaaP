import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
} from "../../../../../../shared/cariDocumentWorkflowGovernance.js";
import { getOrgScopeTreeNodeSummaryValue } from "../../../../shared/orgScopeTree.js";

export const PROCESS_TYPES = [
  "PERIOD_CLOSE",
  "CONSOLIDATION_RUN",
  "LOCAL_CLOSE_PACK",
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
];

export const ASSIGNMENT_SCOPE_TYPES = [
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
];

export const STEP_SCOPE_TYPES = ["OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY", "GROUP"];

const WORKFLOW_PRESET_PRIMARY_PERMISSION_CODES = Object.freeze({
  "PKG-LC-PREPARE": "ouclose.submit",
  "PKG-LC-REVIEW": "ouclose.review",
  "PKG-LC-APPROVE-LOCK": "ouclose.lock",
  "PKG-LC-REOPEN-ADMIN": "ouclose.reopen",
  "PKG-PC-READINESS": "org.fiscal_period.read",
  "PKG-PC-CLOSE": "gl.period.close",
  "PKG-CON-PREPARE": "consolidation.run.create",
  "PKG-CON-EXECUTE": "consolidation.run.execute",
  "PKG-CON-ADJUST": "consolidation.adjustment.post",
  "PKG-CON-ELIM": "consolidation.elimination.post",
  "PKG-CON-FINALIZE": "consolidation.run.finalize",
  "PKG-CON-SETUP": "consolidation.group.upsert",
});

/**
 * Predefined AP business flow templates.
 * Each template describes a real-world AP approval path in business terms.
 * The `steps` array feeds directly into `buildStepDrafts`.
 */
export const AP_BUSINESS_TEMPLATES = Object.freeze([
  {
    id: "branch-entity-country",
    steps: [
      { stepNo: 1, stageScopeType: "LEGAL_ENTITY", requiredPermissionCode: null, minApproverCount: 1, allowSelfApprove: false },
      { stepNo: 2, stageScopeType: "COUNTRY", requiredPermissionCode: null, minApproverCount: 1, allowSelfApprove: false },
    ],
  },
  {
    id: "branch-country",
    steps: [
      { stepNo: 1, stageScopeType: "COUNTRY", requiredPermissionCode: null, minApproverCount: 1, allowSelfApprove: false },
    ],
  },
  {
    id: "branch-entity",
    steps: [
      { stepNo: 1, stageScopeType: "LEGAL_ENTITY", requiredPermissionCode: null, minApproverCount: 1, allowSelfApprove: false },
    ],
  },
  {
    id: "direct-post",
    steps: [],
  },
]);

/**
 * Parses a positive integer from a mixed input.
 */
export function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Returns the current date in YYYY-MM-DD format.
 */
export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns the recommended default steps for one process type.
 */
export function buildDefaultSteps(processType) {
  const normalized = String(processType || "").toUpperCase();
  if (normalized === "LOCAL_CLOSE_PACK") {
    return [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: "ouclose.approve",
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ];
  }
  if (normalized === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return [
      {
        stepNo: 1,
        stageScopeType: "COUNTRY",
        requiredPermissionCode: null,
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ];
  }
  const permissionCode =
    normalized === "CONSOLIDATION_RUN"
      ? "consolidation.run.finalize"
      : "gl.period.close";
  return [
    {
      stepNo: 1,
      stageScopeType: "OPERATING_UNIT",
      requiredPermissionCode: permissionCode,
      minApproverCount: 1,
      allowSelfApprove: false,
    },
    {
      stepNo: 2,
      stageScopeType: "LEGAL_ENTITY",
      requiredPermissionCode: permissionCode,
      minApproverCount: 1,
      allowSelfApprove: false,
    },
    {
      stepNo: 3,
      stageScopeType: "GROUP",
      requiredPermissionCode: permissionCode,
      minApproverCount: 1,
      allowSelfApprove: false,
    },
  ];
}

/**
 * Parses a JSON array from the advanced steps editor.
 */
export function safeParseJsonArray(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes one editable step draft row.
 */
export function normalizeStepDraft(rawStep, fallbackStepNo, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const step = rawStep && typeof rawStep === "object" ? rawStep : {};
  return {
    stepNo: String(
      Number(step.stepNo ?? step.step_no ?? fallbackStepNo) > 0
        ? Number(step.stepNo ?? step.step_no ?? fallbackStepNo)
        : fallbackStepNo
    ),
    stageScopeType: String(
      step.stageScopeType ??
        step.stage_scope_type ??
        (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
          ? "COUNTRY"
          : "LEGAL_ENTITY")
    ).toUpperCase(),
    requiredPermissionCode:
      normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
        ? ""
        : String(step.requiredPermissionCode ?? step.required_permission_code ?? "").trim(),
    minApproverCount: String(
      Math.max(1, Number(step.minApproverCount ?? step.min_approver_count ?? 1) || 1)
    ),
    allowSelfApprove: Boolean(step.allowSelfApprove ?? step.allow_self_approve),
    escalationAfterHours:
      step.escalationAfterHours === null || step.escalation_after_hours === null
        ? ""
        : String(step.escalationAfterHours ?? step.escalation_after_hours ?? "").trim(),
    // These fields are UI-only until the package-native step builder lands.
    actionLabel: String(step.actionLabel ?? step.action_label ?? "").trim(),
    requiredPackageCode: String(
      step.requiredPackageCode ?? step.required_package_code ?? ""
    )
      .trim()
      .toUpperCase(),
    eligibleBusinessRoleCodes: Array.isArray(
      step.eligibleBusinessRoleCodes ?? step.eligible_business_role_codes
    )
      ? (step.eligibleBusinessRoleCodes ?? step.eligible_business_role_codes).map((roleCode) =>
          String(roleCode || "").trim().toUpperCase()
        )
      : [],
    eligibleBusinessRoleLabels: Array.isArray(
      step.eligibleBusinessRoleLabels ?? step.eligible_business_role_labels
    )
      ? [...(step.eligibleBusinessRoleLabels ?? step.eligible_business_role_labels)]
      : [],
  };
}

/**
 * Creates normalized step drafts from saved rows or process defaults.
 */
export function buildStepDrafts(processType, rows) {
  const sourceRows = Array.isArray(rows) && rows.length > 0 ? rows : buildDefaultSteps(processType);
  return sourceRows.map((row, index) => normalizeStepDraft(row, index + 1, processType));
}

/**
 * Converts editable step drafts back to the API payload shape.
 */
export function serializeStepDrafts(stepDrafts, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  return (Array.isArray(stepDrafts) ? stepDrafts : []).map((step, index) => ({
    stepNo: Math.max(1, Number(step?.stepNo || index + 1) || index + 1),
    stageScopeType: String(step?.stageScopeType || "LEGAL_ENTITY").toUpperCase(),
    requiredPermissionCode:
      normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
        ? null
        : String(step?.requiredPermissionCode || "").trim() || null,
    minApproverCount: Math.max(1, Number(step?.minApproverCount || 1) || 1),
    allowSelfApprove: Boolean(step?.allowSelfApprove),
    escalationAfterHours: String(step?.escalationAfterHours || "").trim()
      ? Math.max(1, Number(step.escalationAfterHours) || 1)
      : null,
  }));
}

function normalizeComparableWorkflowStep(step, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const normalizedStep = normalizeStepDraft(step, Number(step?.stepNo || 1) || 1, processType);
  return {
    stageScopeType: normalizedStep.stageScopeType,
    requiredPermissionCode:
      normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
        ? ""
        : String(normalizedStep.requiredPermissionCode || "").trim(),
    minApproverCount: Math.max(1, Number(normalizedStep.minApproverCount || 1) || 1),
    allowSelfApprove: Boolean(normalizedStep.allowSelfApprove),
    escalationAfterHours: String(normalizedStep.escalationAfterHours || "").trim() || "",
  };
}

function getWorkflowPresetStepPermissionCode(step, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  if (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return null;
  }
  const packageCode = String(step?.requiredPackageCode || step?.required_package_code || "")
    .trim()
    .toUpperCase();
  return WORKFLOW_PRESET_PRIMARY_PERMISSION_CODES[packageCode] || "";
}

/**
 * Adapts one catalog preset into the current workflow-step editor model.
 * Until the package-native step builder ships, this keeps preset cloning on the
 * existing `requiredPermissionCode` API shape instead of inventing a new write contract.
 */
export function buildWorkflowPresetBaselineStepDrafts(presetEntry) {
  if (!presetEntry || typeof presetEntry !== "object") {
    return [];
  }

  const processType = String(presetEntry.workflowFamily || "").toUpperCase();
  const sourceSteps = Array.isArray(presetEntry.steps) ? presetEntry.steps : [];
  const adaptableSteps =
    processType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
      ? sourceSteps.filter(
          (step) =>
            String(step?.requiredPackageCode || "")
              .trim()
              .toUpperCase() === "PKG-AP-APPROVE"
        )
      : sourceSteps;

  return adaptableSteps.map((step, index) =>
    normalizeStepDraft(
      {
        stepNo: Number(step?.stepNo || index + 1) || index + 1,
        stageScopeType: String(step?.scopeType || step?.stageScopeType || "LEGAL_ENTITY"),
        requiredPermissionCode: getWorkflowPresetStepPermissionCode(step, processType),
        minApproverCount: Number(step?.minApproverCount || 1) || 1,
        allowSelfApprove: Boolean(step?.allowSelfApprove),
        escalationAfterHours:
          typeof step?.escalationAfterHours === "number" ? step.escalationAfterHours : null,
        actionLabel: step?.actionLabel || "",
        requiredPackageCode: step?.requiredPackageCode || "",
        eligibleBusinessRoleCodes: Array.isArray(step?.eligibleBusinessRoleCodes)
          ? step.eligibleBusinessRoleCodes
          : [],
        eligibleBusinessRoleLabels: Array.isArray(step?.eligibleBusinessRoleLabels)
          ? step.eligibleBusinessRoleLabels
          : [],
      },
      index + 1,
      processType
    )
  );
}

/**
 * Builds the business-readable preset preview used on the workflow governance page.
 */
export function buildWorkflowPresetPreviewModel({ presetEntry, stepScopeLabels, l }) {
  if (!presetEntry || typeof presetEntry !== "object") {
    return null;
  }

  const steps = Array.isArray(presetEntry.steps) ? presetEntry.steps : [];
  const lines = steps.map((step, index) => {
    const scopeLabel = getScopeLabel(step?.scopeType, stepScopeLabels);
    const actorText =
      Array.isArray(step?.eligibleBusinessRoleLabels) &&
      step.eligibleBusinessRoleLabels.length > 0
        ? step.eligibleBusinessRoleLabels.join(", ")
        : l("No typical actors listed", "Tipik aktor tanimli degil");

    return l(
      `Step ${index + 1}: ${step?.actionLabel || "-"} at ${scopeLabel} using ${step?.requiredPackageLabel || step?.requiredPackageCode || "-"} - usually ${actorText}`,
      `${index + 1}. adim: ${step?.actionLabel || "-"} - ${scopeLabel} kapsaminda ${step?.requiredPackageLabel || step?.requiredPackageCode || "-"} kullanir - genelde ${actorText}`
    );
  });

  return {
    summaryText: l(
      `${presetEntry.displayName} starts from a ${presetEntry.primaryScope || presetEntry.defaultScope || "-"} preset with ${steps.length} business step(s).`,
      `${presetEntry.displayName}, ${presetEntry.primaryScope || presetEntry.defaultScope || "-"} kapsaminda ${steps.length} adet is adimiyla baslar.`
    ),
    lines,
  };
}

/**
 * Compares the currently edited workflow steps against the selected preset baseline.
 */
export function buildWorkflowPresetComparisonModel({
  presetEntry,
  stepDrafts,
  stepScopeLabels,
  l,
}) {
  if (!presetEntry || typeof presetEntry !== "object") {
    return null;
  }

  const processType = String(presetEntry.workflowFamily || "").toUpperCase();
  const baselineDrafts = buildWorkflowPresetBaselineStepDrafts(presetEntry);
  const currentComparable = (Array.isArray(stepDrafts) ? stepDrafts : []).map((step) =>
    normalizeComparableWorkflowStep(step, processType)
  );
  const baselineComparable = baselineDrafts.map((step) =>
    normalizeComparableWorkflowStep(step, processType)
  );

  const differenceLines = [];
  if (currentComparable.length !== baselineComparable.length) {
    differenceLines.push(
      l(
        `Current flow has ${currentComparable.length} step(s); the preset baseline maps to ${baselineComparable.length}.`,
        `Mevcut akis ${currentComparable.length} adim; preset temelinde ${baselineComparable.length} adim var.`
      )
    );
  }

  const sharedLength = Math.min(currentComparable.length, baselineComparable.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const currentStep = currentComparable[index];
    const baselineStep = baselineComparable[index];
    if (currentStep.stageScopeType !== baselineStep.stageScopeType) {
      differenceLines.push(
        l(
          `Step ${index + 1} scope differs: current ${getScopeLabel(currentStep.stageScopeType, stepScopeLabels)}, preset ${getScopeLabel(baselineStep.stageScopeType, stepScopeLabels)}.`,
          `${index + 1}. adim kapsami farkli: mevcut ${getScopeLabel(currentStep.stageScopeType, stepScopeLabels)}, preset ${getScopeLabel(baselineStep.stageScopeType, stepScopeLabels)}.`
        )
      );
    }
    if (currentStep.requiredPermissionCode !== baselineStep.requiredPermissionCode) {
      differenceLines.push(
        l(
          `Step ${index + 1} permission differs from the preset baseline.`,
          `${index + 1}. adim yetkisi preset temelinden farkli.`
        )
      );
    }
    if (currentStep.minApproverCount !== baselineStep.minApproverCount) {
      differenceLines.push(
        l(
          `Step ${index + 1} minimum approver count differs.`,
          `${index + 1}. adim minimum onayci sayisi farkli.`
        )
      );
    }
    if (currentStep.allowSelfApprove !== baselineStep.allowSelfApprove) {
      differenceLines.push(
        l(
          `Step ${index + 1} self-approval rule differs.`,
          `${index + 1}. adim kendi kendine onay kurali farkli.`
        )
      );
    }
    if (currentStep.escalationAfterHours !== baselineStep.escalationAfterHours) {
      differenceLines.push(
        l(
          `Step ${index + 1} escalation timing differs.`,
          `${index + 1}. adim escalation suresi farkli.`
        )
      );
    }
  }

  const comparisonSupported = baselineComparable.length > 0;
  const matchesBaseline =
    comparisonSupported &&
    differenceLines.length === 0 &&
    JSON.stringify(currentComparable) === JSON.stringify(baselineComparable);
  const canApply = comparisonSupported && !presetEntry.usesExtension;
  const previewOnly = !comparisonSupported || Boolean(presetEntry.usesExtension);

  return {
    canApply,
    comparisonSupported,
    matchesBaseline,
    baselineDrafts,
    differenceLines,
    statusLabel: previewOnly
      ? l("Preview only", "Yalnizca onizleme")
      : matchesBaseline
        ? l("Matches preset baseline", "Preset temeliyle eslesiyor")
        : l("Customized from preset", "Presetten ozellestirilmis"),
    summaryText: previewOnly
      ? l(
          "This preset is preview-only until the current step model can represent it safely.",
          "Bu preset, mevcut adim modeli onu guvenle temsil edene kadar yalnizca onizlemedir."
        )
      : matchesBaseline
        ? l(
            "Current workflow steps still match the selected preset baseline.",
            "Mevcut workflow adimlari secilen preset temeliyle hala eslesiyor."
          )
        : l(
            "Current workflow steps now differ from the selected preset baseline.",
            "Mevcut workflow adimlari artik secilen preset temelinden farkli."
          ),
    supportNote: presetEntry.usesExtension
      ? presetEntry.extensionNote ||
        l(
          "This preset depends on an extension package and stays preview-only for now.",
          "Bu preset bir extension paketine bagli ve su an icin yalnizca onizleme olarak kalir."
        )
      : l(
          "Clone copies the preset baseline into the existing step model. Package-native step binding lands next.",
          "Kopyala, preset temelini mevcut adim modeline aktarir. Paket-tabani adim baglama sonraki dilimde gelir."
        ),
  };
}

function getScopeLabel(value, labels = {}) {
  return labels[String(value || "").toUpperCase()] || value || "-";
}

function getCoverageLookupRows(scopeType, lookups = {}) {
  const normalizedScopeType = String(scopeType || "").toUpperCase();
  if (normalizedScopeType === "GROUP") {
    return Array.isArray(lookups.groupCompanies) ? lookups.groupCompanies : [];
  }
  if (normalizedScopeType === "COUNTRY") {
    return Array.isArray(lookups.countries) ? lookups.countries : [];
  }
  if (normalizedScopeType === "LEGAL_ENTITY") {
    return Array.isArray(lookups.legalEntities) ? lookups.legalEntities : [];
  }
  if (normalizedScopeType === "OPERATING_UNIT") {
    return Array.isArray(lookups.operatingUnits) ? lookups.operatingUnits : [];
  }
  return [];
}

function buildCoverageScopeLabel(scopeType, scopeId, lookups = {}, tenantScopeId = null, l) {
  const normalizedScopeType = String(scopeType || "").toUpperCase();
  const numericScopeId = toPositiveInt(scopeId);
  if (!numericScopeId) {
    return normalizedScopeType || "-";
  }
  if (normalizedScopeType === "TENANT") {
    return numericScopeId === toPositiveInt(tenantScopeId)
      ? l("Tenant-wide", "Tenant geneli")
      : `TENANT #${numericScopeId}`;
  }

  const matchedRow = getCoverageLookupRows(normalizedScopeType, lookups).find(
    (row) => toPositiveInt(row?.id) === numericScopeId
  );
  if (!matchedRow) {
    return `${normalizedScopeType} #${numericScopeId}`;
  }
  if (normalizedScopeType === "COUNTRY") {
    return `${matchedRow.iso2 || matchedRow.iso3 || numericScopeId} - ${
      matchedRow.name || ""
    }`.trim();
  }
  return `${matchedRow.code || numericScopeId} - ${matchedRow.name || ""}`.trim();
}

function buildCoverageStatusLabel(status, l) {
  const normalizedStatus = String(status || "").toUpperCase();
  if (normalizedStatus === "COVERED") {
    return l("Covered", "Kapsandi");
  }
  if (normalizedStatus === "PARTIAL_GAP") {
    return l("Coverage gap", "Kapsam boslugu");
  }
  if (normalizedStatus === "NO_COVERAGE") {
    return l("No active actors", "Aktif aktor yok");
  }
  if (normalizedStatus === "NO_TARGET_SCOPES") {
    return l("No target scopes", "Hedef kapsam yok");
  }
  return normalizedStatus || "-";
}

function buildCoverageActorLabel({
  actorType,
  scopeType,
  stepNo = null,
  workflowType,
  l,
}) {
  const normalizedActorType = String(actorType || "").toUpperCase();
  const normalizedScopeType = String(scopeType || "").toUpperCase();
  const normalizedWorkflowType = String(workflowType || "").toUpperCase();
  const scopeLabel = getScopeLabel(normalizedScopeType, {
    TENANT: l("Tenant", "Tenant"),
    GROUP: l("Group", "Grup"),
    COUNTRY: l("Country", "Ulke"),
    LEGAL_ENTITY: l("Legal Entity", "Legal Entity"),
    OPERATING_UNIT: l("Operating Unit", "Operating Unit"),
  });

  if (normalizedWorkflowType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    if (normalizedActorType === "SUBMITTER") {
      return l("Branch submitters", "Sube gondericileri");
    }
    if (normalizedActorType === "POSTER") {
      return l(`${scopeLabel} posters`, `${scopeLabel} kayit sorumlulari`);
    }
    if (normalizedActorType === "APPROVER") {
      return stepNo
        ? l(`Step ${stepNo} ${scopeLabel} approvers`, `${stepNo}. adim ${scopeLabel} onaycilari`)
        : l(`${scopeLabel} approvers`, `${scopeLabel} onaycilari`);
    }
  }

  if (normalizedActorType === "APPROVER") {
    return stepNo
      ? l(`Step ${stepNo} reviewers`, `${stepNo}. adim inceleyicileri`)
      : l("Reviewers", "Inceleyiciler");
  }
  if (normalizedActorType === "POSTER") {
    return l("Posters", "Kayit sorumlulari");
  }
  return l("Submitters", "Gondericiler");
}

function buildCoverageDetailText(check, l) {
  if (!check) {
    return "";
  }
  const targetScopeCount = Number(check.targetScopeCount || 0);
  const coveredScopeCount = Number(check.coveredScopeCount || 0);
  const uncoveredScopeCount = Number(check.uncoveredScopeCount || 0);
  const matchedUserCount = Number(check.matchedUserCount || 0);

  if (String(check.status || "").toUpperCase() === "NO_TARGET_SCOPES") {
    return l(
      "No concrete scopes were found under the selected assignment.",
      "Secilen atama altinda somut kapsam bulunamadi."
    );
  }

  return l(
    `${coveredScopeCount}/${targetScopeCount} scopes covered | ${matchedUserCount} active users | ${uncoveredScopeCount} gaps`,
    `${targetScopeCount} kapsamin ${coveredScopeCount} tanesi kapsandi | ${matchedUserCount} aktif kullanici | ${uncoveredScopeCount} bosluk`
  );
}

function buildCoverageWarningDescription({
  warning,
  workflowType,
  scopeLabel,
  l,
}) {
  const normalizedWorkflowType = String(workflowType || "").toUpperCase();
  const normalizedActorType = String(warning?.actorType || "").toUpperCase();
  const uncoveredScopeCount = Number(warning?.uncoveredScopeCount || 0);
  const targetScopeCount = Number(warning?.targetScopeCount || 0);
  const minRequiredActors = Math.max(1, Number(warning?.minRequiredActors || 1) || 1);
  const permissionCode = String(warning?.permissionCode || "").trim();

  if (String(warning?.status || "").toUpperCase() === "NO_TARGET_SCOPES") {
    return l(
      "The selected assignment does not currently resolve any concrete scopes for this actor.",
      "Secilen atama bu aktor icin su anda somut kapsam cozmuyor."
    );
  }

  if (normalizedWorkflowType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    if (normalizedActorType === "SUBMITTER") {
      return uncoveredScopeCount >= targetScopeCount
        ? l(
            "Branch submission is expected, but no in-scope users currently hold submit authority.",
            "Sube gonderimi bekleniyor, ancak kapsam icinde gonderim yetkisine sahip kullanici yok."
          )
        : l(
            `${uncoveredScopeCount} in-scope branches currently have no submit authority.`,
            `${uncoveredScopeCount} kapsam ici subede su anda gonderim yetkisi yok.`
          );
    }
    if (normalizedActorType === "POSTER") {
      return uncoveredScopeCount >= targetScopeCount
        ? l(
            `${scopeLabel} posting is selected, but no in-scope users currently hold posting authority.`,
            `${scopeLabel} kaydi secildi, ancak kapsam icinde kayit yetkisine sahip kullanici yok.`
          )
        : l(
            `${uncoveredScopeCount} ${scopeLabel} scopes in this assignment currently have no posting authority.`,
            `Bu atamada ${uncoveredScopeCount} ${scopeLabel} kapsaminda su anda kayit yetkisi yok.`
          );
    }
    return uncoveredScopeCount >= targetScopeCount
      ? l(
          `This workflow uses ${scopeLabel} approval, but no in-scope users currently hold AP approval authority.`,
          `Bu workflow ${scopeLabel} onayi kullaniyor, ancak kapsam icinde AP onay yetkisine sahip kullanici yok.`
        )
      : l(
          `${uncoveredScopeCount} ${scopeLabel} scopes in this assignment currently have no AP approval coverage.`,
          `Bu atamada ${uncoveredScopeCount} ${scopeLabel} kapsaminda su anda AP onay kapsami yok.`
        );
  }

  if (normalizedActorType === "APPROVER") {
    return uncoveredScopeCount >= targetScopeCount
      ? l(
          `No in-scope users currently hold ${permissionCode} at ${scopeLabel} scope.`,
          `Kapsam icinde su anda ${scopeLabel} kapsaminda ${permissionCode} yetkisine sahip kullanici yok.`
        )
      : l(
          `${uncoveredScopeCount} ${scopeLabel} scopes currently have fewer than ${minRequiredActors} users with ${permissionCode}.`,
          `${uncoveredScopeCount} ${scopeLabel} kapsaminda su anda ${permissionCode} yetkisine sahip ${minRequiredActors} kullanicidan daha azi var.`
        );
  }

  return l(
    "Coverage gaps were found for this workflow actor.",
    "Bu workflow aktoru icin kapsam bosluklari bulundu."
  );
}

/**
 * Builds the review-step diagnostics view model from workflow coverage diagnostics.
 */
export function buildWorkflowCoverageReviewModel({
  diagnostics,
  workflowType,
  lookups,
  tenantScopeId,
  l,
}) {
  if (!diagnostics || typeof diagnostics !== "object") {
    return null;
  }

  const checks = [];
  if (diagnostics.checks?.submitter) {
    checks.push(diagnostics.checks.submitter);
  }
  if (Array.isArray(diagnostics.checks?.approvers)) {
    checks.push(...diagnostics.checks.approvers);
  }
  if (diagnostics.checks?.poster) {
    checks.push(diagnostics.checks.poster);
  }

  const summaryCards = checks.map((check) => {
    const actorLabel = buildCoverageActorLabel({
      actorType: check.actorType,
      scopeType: check.scopeType,
      stepNo: check.stepNo,
      workflowType,
      l,
    });
    const status = String(check.status || "").toUpperCase();
    const toneClass =
      status === "COVERED"
        ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
        : status === "PARTIAL_GAP"
          ? "border-amber-200 bg-amber-50/80 text-amber-900"
          : "border-rose-200 bg-rose-50/80 text-rose-900";

    return {
      key: `${check.actorType}-${check.stepNo || "x"}-${check.scopeType}`,
      actorLabel,
      statusLabel: buildCoverageStatusLabel(check.status, l),
      detailText: buildCoverageDetailText(check, l),
      toneClass,
      uncoveredScopeLabels: (Array.isArray(check.uncoveredScopes) ? check.uncoveredScopes : [])
        .slice(0, 4)
        .map((scope) =>
          buildCoverageScopeLabel(
            scope.scopeType,
            scope.scopeId,
            lookups,
            tenantScopeId,
            l
          )
        ),
    };
  });

  const warningCards = (Array.isArray(diagnostics.warnings) ? diagnostics.warnings : []).map(
    (warning, index) => {
      const scopeLabel = getScopeLabel(String(warning.scopeType || "").toUpperCase(), {
        TENANT: l("Tenant", "Tenant"),
        GROUP: l("Group", "Grup"),
        COUNTRY: l("Country", "Ulke"),
        LEGAL_ENTITY: l("Legal Entity", "Legal Entity"),
        OPERATING_UNIT: l("Operating Unit", "Operating Unit"),
      });
      return {
        key: `${warning.code}-${warning.stepNo || "x"}-${index}`,
        title: buildCoverageActorLabel({
          actorType: warning.actorType,
          scopeType: warning.scopeType,
          stepNo: warning.stepNo,
          workflowType,
          l,
        }),
        description: buildCoverageWarningDescription({
          warning,
          workflowType,
          scopeLabel,
          l,
        }),
        technicalHint: warning.permissionCode
          ? l(
              `Technical permission: ${warning.permissionCode}`,
              `Teknik yetki: ${warning.permissionCode}`
            )
          : "",
        uncoveredScopeLabels: (Array.isArray(warning.uncoveredScopes)
          ? warning.uncoveredScopes
          : []
        )
          .slice(0, 4)
          .map((scope) =>
            buildCoverageScopeLabel(
              scope.scopeType,
              scope.scopeId,
              lookups,
              tenantScopeId,
              l
            )
          ),
      };
    }
  );

  return {
    checkedOnLabel: diagnostics.effectiveOn
      ? l(
          `Coverage checked for ${diagnostics.effectiveOn}`,
          `${diagnostics.effectiveOn} tarihi icin kapsam kontrol edildi`
        )
      : l("Coverage checked for current access", "Kapsam mevcut erisim icin kontrol edildi"),
    successText:
      warningCards.length === 0
        ? l(
            "Active users were found for every checked workflow actor in this setup.",
            "Bu kurulumda kontrol edilen tum workflow aktorleri icin aktif kullanicilar bulundu."
          )
        : "",
    summaryCards,
    warningCards,
  };
}

/**
 * Builds an AP business-language process summary.
 * Speaks in terms of actors (submitter / reviewer / poster) rather than engine terms.
 *
 * @param {Array} stepDrafts – current step drafts
 * @param {Object} stepScopeLabels – e.g. { COUNTRY: "Country", LEGAL_ENTITY: "Legal Entity" }
 * @param {Function} l – i18n helper (en, tr) => string
 * @returns {string[]} array of plain-language sentences
 */
export function buildApBusinessPreview(stepDrafts, stepScopeLabels, l) {
  const steps = Array.isArray(stepDrafts) ? stepDrafts : [];
  const lines = [];

  // Submit line — always branch-level for AP
  lines.push(
    l(
      "Branch accountants with submit authority can submit this AP document.",
      "Gonderim yetkisine sahip sube muhasebecileri bu AP belgesini gonderebilir."
    )
  );

  if (steps.length === 0) {
    lines.push(
      l(
        "No approval step is configured. Documents can be posted directly after submission.",
        "Onay adimi yapilandirilmamis. Belgeler gonderimden sonra dogrudan kaydedilebilir."
      )
    );
    return lines;
  }

  // Approval lines — one per step
  steps.forEach((step, index) => {
    const scopeLabel = getScopeLabel(step?.stageScopeType, stepScopeLabels);
    const count = Math.max(1, Number(step?.minApproverCount || 1));

    if (steps.length === 1) {
      lines.push(
        count === 1
          ? l(
              `One ${scopeLabel} AP reviewer must approve it.`,
              `Bir ${scopeLabel} AP inceleyicisi onaylamalidir.`
            )
          : l(
              `${count} ${scopeLabel} AP reviewers must approve it.`,
              `${count} ${scopeLabel} AP inceleyicisi onaylamalidir.`
            )
      );
    } else {
      lines.push(
        count === 1
          ? l(
              `Step ${index + 1}: One ${scopeLabel} AP reviewer must approve.`,
              `Adim ${index + 1}: Bir ${scopeLabel} AP inceleyicisi onaylamalidir.`
            )
          : l(
              `Step ${index + 1}: ${count} ${scopeLabel} AP reviewers must approve.`,
              `Adim ${index + 1}: ${count} ${scopeLabel} AP inceleyicisi onaylamalidir.`
            )
      );
    }
  });

  // Post line — scope of the last step
  const lastStep = steps[steps.length - 1];
  const lastScopeLabel = getScopeLabel(lastStep?.stageScopeType, stepScopeLabels);
  lines.push(
    l(
      `After approval, ${lastScopeLabel} posting authority can post the document.`,
      `Onaydan sonra ${lastScopeLabel} kayit yetkisi belgeyi kaydedebilir.`
    )
  );

  return lines;
}

/**
 * Builds a readable explanation for one workflow step.
 */
export function buildStepPreview(step, processType, stepScopeLabels, l) {
  const level = getScopeLabel(step?.stageScopeType, stepScopeLabels).toLowerCase();
  const minCount = Math.max(1, Number(step?.minApproverCount || 1));
  const selfApprove = Boolean(step?.allowSelfApprove);
  const escalation = String(step?.escalationAfterHours || "").trim();

  const parts = [];
  parts.push(
    minCount === 1
      ? l(`One ${level}-level approval is required.`, `${level} seviyesinde tek bir onay gerekir.`)
      : l(
          `${minCount} ${level}-level approvals are required.`,
          `${level} seviyesinde ${minCount} onay gerekir.`
        )
  );

  if (String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    parts.push(
      l(
        "Reviewer authority comes from the workflow assignment scope.",
        "Inceleyen yetkisi workflow atama kapsamindan gelir."
      )
    );
  } else if (step?.requiredPermissionCode) {
    parts.push(
      l(
        `Approvers must hold "${step.requiredPermissionCode}".`,
        `Onaylayanlar "${step.requiredPermissionCode}" yetkisine sahip olmalidir.`
      )
    );
  }

  parts.push(
    selfApprove
      ? l("The submitter may approve their own item.", "Gonderen kendi kaydini onaylayabilir.")
      : l(
          "The submitter cannot approve their own item.",
          "Gonderen kendi kaydini onaylayamaz."
        )
  );

  if (escalation) {
    parts.push(
      l(
        `This step escalates after ${escalation} hours if still pending.`,
        `Bu adim ${escalation} saat sonra hala bekliyorsa escalation olur.`
      )
    );
  }

  return parts.join(" ");
}

/**
 * Builds the human summary sentence for the current step chain.
 */
export function buildWorkflowPreview(stepDrafts, stepScopeLabels, l) {
  const steps = Array.isArray(stepDrafts) ? stepDrafts : [];
  if (steps.length === 0) {
    return l("No approval steps defined yet.", "Henuz onay adimi tanimlanmadi.");
  }
  if (steps.length === 1) {
    return l(
      `This workflow requires ${getScopeLabel(steps[0]?.stageScopeType, stepScopeLabels)} approval.`,
      `Bu workflow ${getScopeLabel(steps[0]?.stageScopeType, stepScopeLabels)} onayi gerektirir.`
    );
  }
  return l(
    `This workflow requires approvals in this order: ${steps
      .map((step, index) => `${index + 1}. ${getScopeLabel(step?.stageScopeType, stepScopeLabels)}`)
      .join(" -> ")}.`,
    `Bu workflow su sirada onay gerektirir: ${steps
      .map((step, index) => `${index + 1}. ${getScopeLabel(step?.stageScopeType, stepScopeLabels)}`)
      .join(" -> ")}.`
  );
}

/**
 * Builds the plain-language effect text for the chosen assignment scope.
 */
export function buildAssignmentEffectText({
  assignmentForm,
  scopeNode,
  l,
}) {
  const scopeType = assignmentForm?.scopeType;
  const scopeSummary = getOrgScopeTreeNodeSummaryValue(scopeNode) || "-";

  if (scopeType === "TENANT") {
    return l(
      "This workflow will apply across the whole tenant.",
      "Bu workflow tum tenant genelinde gecerli olur."
    );
  }
  if (scopeType === "GROUP") {
    return l(
      `This workflow will apply under Group = ${scopeSummary}.`,
      `Bu workflow Grup = ${scopeSummary} altinda gecerli olur.`
    );
  }
  if (scopeType === "COUNTRY") {
    return l(
      `This workflow will apply under Country = ${scopeSummary}.`,
      `Bu workflow Ulke = ${scopeSummary} altinda gecerli olur.`
    );
  }
  if (scopeType === "LEGAL_ENTITY") {
    return l(
      `This workflow will apply only to Legal Entity = ${scopeSummary}.`,
      `Bu workflow yalnizca Legal Entity = ${scopeSummary} icin gecerli olur.`
    );
  }
  if (scopeType === "OPERATING_UNIT") {
    return l(
      `This workflow will apply only to Operating Unit = ${scopeSummary}.`,
      `Bu workflow yalnizca Operating Unit = ${scopeSummary} icin gecerli olur.`
    );
  }
  return l(
    "Choose a scope to see where this workflow will apply.",
    "Workflow'un nerede gecerli olacagini gormek icin bir kapsam secin."
  );
}

/**
 * Builds the compact assignment label used in summaries and progress panels.
 */
export function buildAssignmentSelectionLabel({
  assignmentForm,
  scopeNode,
  scopeTypeLabels,
  l,
}) {
  const scopeType = String(assignmentForm?.scopeType || "").toUpperCase();
  const scopeLabel = scopeTypeLabels?.[scopeType] || scopeType || "-";
  const scopeSummary = getOrgScopeTreeNodeSummaryValue(scopeNode) || "-";

  if (scopeType === "TENANT") {
    return scopeLabel;
  }
  if (scopeType === "GROUP") {
    return `${scopeLabel} = ${scopeSummary}`;
  }
  if (scopeType === "COUNTRY") {
    return `${scopeLabel} = ${scopeSummary}`;
  }
  if (scopeType === "LEGAL_ENTITY") {
    return `${scopeLabel} = ${scopeSummary}`;
  }
  if (scopeType === "OPERATING_UNIT") {
    return `${scopeLabel} = ${scopeSummary}`;
  }
  return l("Not assigned yet", "Henuz atanmadi");
}

/**
 * Builds the readable scope label shown in assignment records.
 */
export function buildAssignmentScopeLabel(row, l) {
  if (row?.operatingUnitId) {
    return `OPERATING_UNIT: ${
      row.operatingUnitCode || row.operatingUnitName || row.operatingUnitId
    }`;
  }
  if (row?.legalEntityId) {
    return `LEGAL_ENTITY: ${
      row.legalEntityCode || row.legalEntityName || row.legalEntityId
    }`;
  }
  if (row?.countryId) {
    return `COUNTRY: ${row.countryIso2 || row.countryName || row.countryId}`;
  }
  if (row?.groupCompanyId) {
    return `GROUP: ${row.groupCompanyCode || row.groupCompanyName || row.groupCompanyId}`;
  }
  return l("TENANT", "TENANT");
}

export default {
  PROCESS_TYPES,
  ASSIGNMENT_SCOPE_TYPES,
  STEP_SCOPE_TYPES,
  AP_BUSINESS_TEMPLATES,
  toPositiveInt,
  todayIsoDate,
  buildDefaultSteps,
  safeParseJsonArray,
  normalizeStepDraft,
  buildStepDrafts,
  serializeStepDrafts,
  buildStepPreview,
  buildWorkflowPreview,
  buildApBusinessPreview,
  buildWorkflowPresetBaselineStepDrafts,
  buildWorkflowPresetPreviewModel,
  buildWorkflowPresetComparisonModel,
  buildAssignmentEffectText,
  buildAssignmentSelectionLabel,
  buildAssignmentScopeLabel,
  buildWorkflowCoverageReviewModel,
};
