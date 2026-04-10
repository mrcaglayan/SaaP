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
  "PKG-PC-REOPEN": "gl.period.reopen",
  "PKG-PC-ADMIN": "gl.period.admin",
  "PKG-CON-PREPARE": "consolidation.run.create",
  "PKG-CON-EXECUTE": "consolidation.run.execute",
  "PKG-CON-ADJUST": "consolidation.adjustment.post",
  "PKG-CON-ELIM": "consolidation.elimination.post",
  "PKG-CON-FINALIZE": "consolidation.run.finalize",
  "PKG-CON-SETUP": "consolidation.group.upsert",
});

const WORKFLOW_PERMISSION_TO_PACKAGE_CODE = Object.freeze({
  "ouclose.prepare": "PKG-LC-PREPARE",
  "ouclose.submit": "PKG-LC-PREPARE",
  "ouclose.review": "PKG-LC-REVIEW",
  "ouclose.approve": "PKG-LC-APPROVE-LOCK",
  "ouclose.lock": "PKG-LC-APPROVE-LOCK",
  "ouclose.reopen": "PKG-LC-REOPEN-ADMIN",
  "org.fiscal_period.read": "PKG-PC-READINESS",
  "gl.period.close": "PKG-PC-CLOSE",
  "gl.period.reopen": "PKG-PC-REOPEN",
  "gl.period.admin": "PKG-PC-ADMIN",
  "consolidation.run.create": "PKG-CON-PREPARE",
  "consolidation.run.execute": "PKG-CON-EXECUTE",
  "consolidation.adjustment.post": "PKG-CON-ADJUST",
  "consolidation.elimination.post": "PKG-CON-ELIM",
  "consolidation.run.finalize": "PKG-CON-FINALIZE",
  "consolidation.group.upsert": "PKG-CON-SETUP",
});

function normalizeWorkflowCatalogOptions(options = {}) {
  return {
    workflowPackageEntries: Array.isArray(options.workflowPackageEntries)
      ? options.workflowPackageEntries
      : [],
    workflowPresetEntries: Array.isArray(options.workflowPresetEntries)
      ? options.workflowPresetEntries
      : [],
    businessRoleEntries: Array.isArray(options.businessRoleEntries)
      ? options.businessRoleEntries
      : [],
  };
}

function getWorkflowPackageLabel(requiredPackageCode, workflowPackageEntries = []) {
  const normalizedPackageCode = String(requiredPackageCode || "").trim().toUpperCase();
  if (!normalizedPackageCode) {
    return "";
  }
  const packageEntry = (Array.isArray(workflowPackageEntries) ? workflowPackageEntries : []).find(
    (entry) => String(entry?.code || "").trim().toUpperCase() === normalizedPackageCode
  );
  return packageEntry?.displayName || normalizedPackageCode;
}

function deriveActionLabelFromPackage(requiredPackageCode, workflowPackageEntries = []) {
  const packageLabel = getWorkflowPackageLabel(requiredPackageCode, workflowPackageEntries);
  if (!packageLabel) {
    return "";
  }
  const packageLabelParts = packageLabel.split("/");
  return String(packageLabelParts[packageLabelParts.length - 1] || packageLabel).trim();
}

function getWorkflowPackagePrimaryPermissionCode(requiredPackageCode, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  if (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return null;
  }
  const packageCode = String(requiredPackageCode || "").trim().toUpperCase();
  return WORKFLOW_PRESET_PRIMARY_PERMISSION_CODES[packageCode] || "";
}

function inferWorkflowStepPackageCode(rawStep, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const explicitPackageCode = String(
    rawStep?.requiredPackageCode ?? rawStep?.required_package_code ?? ""
  )
    .trim()
    .toUpperCase();
  if (explicitPackageCode) {
    return explicitPackageCode;
  }
  if (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return "PKG-AP-APPROVE";
  }
  const permissionCode = String(
    rawStep?.requiredPermissionCode ?? rawStep?.required_permission_code ?? ""
  )
    .trim()
    .toLowerCase();
  return WORKFLOW_PERMISSION_TO_PACKAGE_CODE[permissionCode] || "";
}

function resolveWorkflowStepEligibleBusinessRoleCodes({
  rawStep,
  requiredPackageCode,
  stageScopeType,
  processType,
  workflowPresetEntries,
  businessRoleEntries,
}) {
  const rawEligibleBusinessRoleCodes =
    rawStep?.eligibleBusinessRoleCodes ?? rawStep?.eligible_business_role_codes;
  const explicitRoleCodes = Array.isArray(rawEligibleBusinessRoleCodes)
    ? rawEligibleBusinessRoleCodes.map((roleCode) =>
        String(roleCode || "").trim().toUpperCase()
      )
    : [];
  if (explicitRoleCodes.length > 0) {
    return explicitRoleCodes;
  }

  const normalizedPackageCode = String(requiredPackageCode || "").trim().toUpperCase();
  const normalizedProcessType = String(processType || "").toUpperCase();
  const normalizedScopeType = String(stageScopeType || "").trim().toUpperCase();
  const suggestedRoleCodes = new Set();

  const presetStepMatches = (Array.isArray(workflowPresetEntries) ? workflowPresetEntries : [])
    .filter(
      (entry) =>
        String(entry?.workflowFamily || "").toUpperCase() === normalizedProcessType
    )
    .flatMap((entry) => (Array.isArray(entry?.steps) ? entry.steps : []))
    .filter(
      (step) =>
        String(step?.requiredPackageCode || "").trim().toUpperCase() === normalizedPackageCode
    );

  const sameScopePresetMatches = presetStepMatches.filter(
    (step) => String(step?.scopeType || "").trim().toUpperCase() === normalizedScopeType
  );
  const relevantPresetMatches =
    sameScopePresetMatches.length > 0 ? sameScopePresetMatches : presetStepMatches;

  relevantPresetMatches.forEach((step) => {
    (Array.isArray(step?.eligibleBusinessRoleCodes) ? step.eligibleBusinessRoleCodes : []).forEach(
      (roleCode) => suggestedRoleCodes.add(String(roleCode || "").trim().toUpperCase())
    );
  });

  (Array.isArray(businessRoleEntries) ? businessRoleEntries : [])
    .filter((entry) => {
      const starterPackageCodes = Array.isArray(entry?.starterPackageCodes)
        ? entry.starterPackageCodes
        : [];
      const optionalPackageCodes = Array.isArray(entry?.optionalPackageCodes)
        ? entry.optionalPackageCodes
        : [];
      return [...starterPackageCodes, ...optionalPackageCodes].includes(normalizedPackageCode);
    })
    .forEach((entry) => {
      suggestedRoleCodes.add(String(entry?.code || "").trim().toUpperCase());
    });

  const roleEntriesByCode = new Map(
    (Array.isArray(businessRoleEntries) ? businessRoleEntries : []).map((entry) => [
      String(entry?.code || "").trim().toUpperCase(),
      entry,
    ])
  );

  return Array.from(suggestedRoleCodes).sort((left, right) => {
    const leftOrder = Number(roleEntriesByCode.get(left)?.sortOrder || 9999);
    const rightOrder = Number(roleEntriesByCode.get(right)?.sortOrder || 9999);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
}

function inferWorkflowStepActionLabel({
  rawStep,
  requiredPackageCode,
  stageScopeType,
  processType,
  workflowPackageEntries,
  workflowPresetEntries,
}) {
  const explicitActionLabel = String(rawStep?.actionLabel ?? rawStep?.action_label ?? "").trim();
  if (explicitActionLabel) {
    return explicitActionLabel;
  }

  const normalizedPackageCode = String(requiredPackageCode || "").trim().toUpperCase();
  const normalizedProcessType = String(processType || "").toUpperCase();
  const normalizedScopeType = String(stageScopeType || "").trim().toUpperCase();

  const presetStepMatches = (Array.isArray(workflowPresetEntries) ? workflowPresetEntries : [])
    .filter(
      (entry) =>
        String(entry?.workflowFamily || "").toUpperCase() === normalizedProcessType
    )
    .flatMap((entry) => (Array.isArray(entry?.steps) ? entry.steps : []))
    .filter(
      (step) =>
        String(step?.requiredPackageCode || "").trim().toUpperCase() === normalizedPackageCode
    );
  const sameScopePresetMatch = presetStepMatches.find(
    (step) => String(step?.scopeType || "").trim().toUpperCase() === normalizedScopeType
  );
  if (sameScopePresetMatch?.actionLabel) {
    return sameScopePresetMatch.actionLabel;
  }
  if (presetStepMatches[0]?.actionLabel) {
    return presetStepMatches[0].actionLabel;
  }
  return deriveActionLabelFromPackage(normalizedPackageCode, workflowPackageEntries);
}

/**
 * Lists the workflow packages the current builder can bind to for one workflow family.
 * AP stays intentionally narrowed to `PKG-AP-APPROVE` until the backend step contract
 * can represent submit/post stages as first-class package-bound workflow steps.
 */
export function listWorkflowStepPackageOptions({ processType, workflowPackageEntries = [] }) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const familyEntries = (Array.isArray(workflowPackageEntries) ? workflowPackageEntries : []).filter(
    (entry) => String(entry?.workflowFamily || "").toUpperCase() === normalizedProcessType
  );
  if (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return familyEntries.filter(
      (entry) => String(entry?.code || "").trim().toUpperCase() === "PKG-AP-APPROVE"
    );
  }
  return familyEntries.filter((entry) => {
    const normalizedCode = String(entry?.code || "").trim().toUpperCase();
    return (
      !normalizedCode.startsWith("PKG-WF-") &&
      !normalizedCode.endsWith("-VIEW") &&
      !normalizedCode.endsWith("-SETUP") &&
      !normalizedCode.endsWith("-SETUP-ADMIN")
    );
  });
}

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
 * Normalizes one editable step draft row and enriches it with package-based
 * display metadata when catalog context is supplied.
 */
export function normalizeStepDraft(rawStep, fallbackStepNo, processType, options = {}) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const step = rawStep && typeof rawStep === "object" ? rawStep : {};
  const catalogOptions = normalizeWorkflowCatalogOptions(options);
  const inferredPackageCode = inferWorkflowStepPackageCode(step, processType);
  const normalizedStageScopeType = String(
    step.stageScopeType ??
      step.stage_scope_type ??
      (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
        ? "COUNTRY"
        : "LEGAL_ENTITY")
  ).toUpperCase();
  const normalizedRequiredPermissionCode =
    normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
      ? ""
      : String(step.requiredPermissionCode ?? step.required_permission_code ?? "").trim() ||
        getWorkflowPackagePrimaryPermissionCode(inferredPackageCode, processType);
  const eligibleBusinessRoleCodes = resolveWorkflowStepEligibleBusinessRoleCodes({
    rawStep: step,
    requiredPackageCode: inferredPackageCode,
    stageScopeType: normalizedStageScopeType,
    processType,
    workflowPresetEntries: catalogOptions.workflowPresetEntries,
    businessRoleEntries: catalogOptions.businessRoleEntries,
  });
  const businessRoleEntryMap = new Map(
    catalogOptions.businessRoleEntries.map((entry) => [
      String(entry?.code || "").trim().toUpperCase(),
      entry,
    ])
  );
  return {
    stepNo: String(
      Number(step.stepNo ?? step.step_no ?? fallbackStepNo) > 0
        ? Number(step.stepNo ?? step.step_no ?? fallbackStepNo)
        : fallbackStepNo
    ),
    stageScopeType: normalizedStageScopeType,
    requiredPermissionCode: normalizedRequiredPermissionCode,
    minApproverCount: String(
      Math.max(1, Number(step.minApproverCount ?? step.min_approver_count ?? 1) || 1)
    ),
    allowSelfApprove: Boolean(step.allowSelfApprove ?? step.allow_self_approve),
    escalationAfterHours:
      step.escalationAfterHours === null || step.escalation_after_hours === null
        ? ""
        : String(step.escalationAfterHours ?? step.escalation_after_hours ?? "").trim(),
    // These fields are UI-only until the package-native step builder lands.
    actionLabel: inferWorkflowStepActionLabel({
      rawStep: step,
      requiredPackageCode: inferredPackageCode,
      stageScopeType: normalizedStageScopeType,
      processType,
      workflowPackageEntries: catalogOptions.workflowPackageEntries,
      workflowPresetEntries: catalogOptions.workflowPresetEntries,
    }),
    requiredPackageCode: inferredPackageCode,
    requiredPackageLabel: getWorkflowPackageLabel(
      inferredPackageCode,
      catalogOptions.workflowPackageEntries
    ),
    eligibleBusinessRoleCodes,
    eligibleBusinessRoleLabels: Array.isArray(
      step.eligibleBusinessRoleLabels ?? step.eligible_business_role_labels
    )
      ? [...(step.eligibleBusinessRoleLabels ?? step.eligible_business_role_labels)]
      : eligibleBusinessRoleCodes.map(
          (roleCode) => businessRoleEntryMap.get(roleCode)?.displayName || roleCode
        ),
  };
}

/**
 * Creates normalized step drafts from saved rows or process defaults, with
 * optional package/business-role enrichment for the step-builder UI.
 */
export function buildStepDrafts(processType, rows, options = {}) {
  const sourceRows = Array.isArray(rows) && rows.length > 0 ? rows : buildDefaultSteps(processType);
  return sourceRows.map((row, index) =>
    normalizeStepDraft(row, index + 1, processType, options)
  );
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
    actionLabel: String(normalizedStep.actionLabel || "").trim(),
    stageScopeType: normalizedStep.stageScopeType,
    requiredPackageCode: String(normalizedStep.requiredPackageCode || "").trim().toUpperCase(),
    requiredPermissionCode:
      normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
        ? ""
        : String(normalizedStep.requiredPermissionCode || "").trim(),
    eligibleBusinessRoleCodes: Array.isArray(normalizedStep.eligibleBusinessRoleCodes)
      ? [...normalizedStep.eligibleBusinessRoleCodes]
      : [],
    minApproverCount: Math.max(1, Number(normalizedStep.minApproverCount || 1) || 1),
    allowSelfApprove: Boolean(normalizedStep.allowSelfApprove),
    escalationAfterHours: String(normalizedStep.escalationAfterHours || "").trim() || "",
  };
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
        requiredPermissionCode: getWorkflowPackagePrimaryPermissionCode(
          step?.requiredPackageCode,
          processType
        ),
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
    if (currentStep.actionLabel !== baselineStep.actionLabel) {
      differenceLines.push(
        l(
          `Step ${index + 1} action label differs from the preset baseline.`,
          `${index + 1}. adim islem etiketi preset temelinden farkli.`
        )
      );
    }
    if (currentStep.requiredPackageCode !== baselineStep.requiredPackageCode) {
      differenceLines.push(
        l(
          `Step ${index + 1} required package differs from the preset baseline.`,
          `${index + 1}. adim gerekli paketi preset temelinden farkli.`
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
    if (
      JSON.stringify(currentStep.eligibleBusinessRoleCodes) !==
      JSON.stringify(baselineStep.eligibleBusinessRoleCodes)
    ) {
      differenceLines.push(
        l(
          `Step ${index + 1} eligible business roles differ.`,
          `${index + 1}. adim uygun is rolleri farkli.`
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

function buildWorkflowExplainabilityActorText(roleLabels, fallbackText, l) {
  const normalizedLabels = (Array.isArray(roleLabels) ? roleLabels : [])
    .map((label) => String(label || "").trim())
    .filter(Boolean);
  if (normalizedLabels.length === 0) {
    return fallbackText;
  }
  if (normalizedLabels.length === 1) {
    return normalizedLabels[0];
  }
  if (normalizedLabels.length === 2) {
    return l(
      `${normalizedLabels[0]} or ${normalizedLabels[1]}`,
      `${normalizedLabels[0]} veya ${normalizedLabels[1]}`
    );
  }
  return normalizedLabels.join(", ");
}

function buildWorkflowExplainabilityEntry({
  key,
  stepNo,
  actionLabel,
  requiredPackageLabel,
  scopeType,
  actorText,
  minApproverCount,
  allowSelfApprove,
  escalationAfterHours,
  stepScopeLabels,
  l,
}) {
  const scopeLabel = getScopeLabel(scopeType, stepScopeLabels);
  const normalizedActionLabel = String(actionLabel || "").trim() || l("Step", "Adim");
  const normalizedPackageLabel =
    String(requiredPackageLabel || "").trim() || l("Package not selected", "Paket secilmedi");
  const normalizedActorText =
    String(actorText || "").trim() ||
    l("In-scope package holders", "Kapsam ici paket sahipleri");
  const minCount = Math.max(1, Number(minApproverCount || 1) || 1);
  const escalationText = String(escalationAfterHours || "").trim();

  const detailBadges = [
    {
      key: "package",
      label: l(`Package: ${normalizedPackageLabel}`, `Paket: ${normalizedPackageLabel}`),
    },
    {
      key: "scope",
      label: l(`Scope: ${scopeLabel}`, `Kapsam: ${scopeLabel}`),
    },
    {
      key: "actors",
      label: l(`Usually: ${normalizedActorText}`, `Genelde: ${normalizedActorText}`),
    },
    {
      key: "count",
      label:
        minCount === 1
          ? l("1 actor required", "1 aktor gerekir")
          : l(`${minCount} actors required`, `${minCount} aktor gerekir`),
    },
    {
      key: "self",
      label: allowSelfApprove
        ? l("Self-approve on", "Kendi kendine onay acik")
        : l("Self-approve off", "Kendi kendine onay kapali"),
    },
  ];

  if (escalationText) {
    detailBadges.push({
      key: "escalation",
      label: l(
        `Escalates after ${escalationText}h`,
        `${escalationText}s sonra escalation`
      ),
    });
  }

  return {
    key,
    stepNo,
    actionLabel: normalizedActionLabel,
    requiredPackageLabel: normalizedPackageLabel,
    scopeType,
    scopeLabel,
    actorText: normalizedActorText,
    lineText: l(
      `Step ${stepNo}: ${normalizedPackageLabel} at ${scopeLabel} scope - usually ${normalizedActorText}`,
      `${stepNo}. adim: ${normalizedPackageLabel} - ${scopeLabel} kapsaminda - genelde ${normalizedActorText}`
    ),
    helperText: l(
      `${normalizedActionLabel} runs at ${scopeLabel} scope.`,
      `${normalizedActionLabel}, ${scopeLabel} kapsaminda calisir.`
    ),
    detailBadges,
  };
}

function buildApPosterActorText(scopeType, l) {
  const normalizedScopeType = String(scopeType || "").toUpperCase();
  if (normalizedScopeType === "GROUP") {
    return l("Group posting authority", "Grup kayit yetkisi");
  }
  if (normalizedScopeType === "COUNTRY") {
    return l("Country posting authority", "Ulke kayit yetkisi");
  }
  return l("Entity posting authority", "Entity kayit yetkisi");
}

/**
 * Builds the business-readable explainability preview used while configuring a
 * workflow. This is a design-time preview only; runtime waiting/cannot-act
 * explanations land in the later explainability phases.
 */
export function buildWorkflowExplainabilityPreviewModel({
  stepDrafts,
  processType,
  stepScopeLabels,
  l,
}) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const normalizedSteps = Array.isArray(stepDrafts) ? stepDrafts : [];
  const previewEntries = [];
  const notes = [];

  if (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    previewEntries.push(
      buildWorkflowExplainabilityEntry({
        key: "ap-submit",
        stepNo: 1,
        actionLabel: l("Create / Edit / Submit", "Olustur / Duzenle / Gonder"),
        requiredPackageLabel: "AP Documents / Draft & Submit",
        scopeType: "OPERATING_UNIT",
        actorText: l("Branch Accountant", "Sube Muhasebecisi"),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
        stepScopeLabels,
        l,
      })
    );

    normalizedSteps.forEach((step, index) => {
      const actorText = buildWorkflowExplainabilityActorText(
        step?.eligibleBusinessRoleLabels,
        l("In-scope AP reviewers", "Kapsam ici AP inceleyicileri"),
        l
      );
      previewEntries.push(
        buildWorkflowExplainabilityEntry({
          key: `ap-approval-${index + 1}`,
          stepNo: index + 2,
          actionLabel: step?.actionLabel || l("Approve", "Onayla"),
          requiredPackageLabel:
            step?.requiredPackageLabel ||
            step?.requiredPackageCode ||
            "AP Documents / Approve",
          scopeType: step?.stageScopeType || "LEGAL_ENTITY",
          actorText,
          minApproverCount: step?.minApproverCount,
          allowSelfApprove: step?.allowSelfApprove,
          escalationAfterHours: step?.escalationAfterHours,
          stepScopeLabels,
          l,
        })
      );
    });

    const finalApprovalStep =
      normalizedSteps[normalizedSteps.length - 1] || null;
    const posterScopeType = String(
      finalApprovalStep?.stageScopeType || "LEGAL_ENTITY"
    ).toUpperCase();
    previewEntries.push(
      buildWorkflowExplainabilityEntry({
        key: "ap-post",
        stepNo: previewEntries.length + 1,
        actionLabel: l("Post", "Kaydet"),
        requiredPackageLabel:
          posterScopeType === "GROUP"
            ? "AP Documents / Group Post"
            : "AP Documents / Post",
        scopeType: posterScopeType,
        actorText: buildApPosterActorText(posterScopeType, l),
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: null,
        stepScopeLabels,
        l,
      })
    );

    notes.push(
      l(
        "The current AP backend bridge still stores only the approval-stage rows directly. This preview keeps submit and post visible in business language.",
        "Mevcut AP backend koprusu dogrudan yalnizca onay asamasi satirlarini saklar. Bu onizleme, gonderim ve kaydi is dilinde gorunur tutar."
      )
    );
  } else {
    normalizedSteps.forEach((step, index) => {
      const actorText = buildWorkflowExplainabilityActorText(
        step?.eligibleBusinessRoleLabels,
        l("In-scope package holders", "Kapsam ici paket sahipleri"),
        l
      );
      previewEntries.push(
        buildWorkflowExplainabilityEntry({
          key: `workflow-step-${index + 1}`,
          stepNo: index + 1,
          actionLabel: step?.actionLabel || l("Step", "Adim"),
          requiredPackageLabel:
            step?.requiredPackageLabel ||
            step?.requiredPackageCode ||
            step?.requiredPermissionCode,
          scopeType: step?.stageScopeType || "LEGAL_ENTITY",
          actorText,
          minApproverCount: step?.minApproverCount,
          allowSelfApprove: step?.allowSelfApprove,
          escalationAfterHours: step?.escalationAfterHours,
          stepScopeLabels,
          l,
        })
      );
    });
  }

  return {
    entryCount: previewEntries.length,
    summaryText: l(
      `This business preview shows ${previewEntries.length} explainable stage(s) in the current flow.`,
      `Bu is onizlemesi mevcut akistaki ${previewEntries.length} adet aciklanabilir asamayi gosterir.`
    ),
    entries: previewEntries,
    notes,
  };
}

function buildWorkflowStepIssue(severity, code, title, description) {
  return {
    severity,
    code,
    title,
    description,
  };
}

function findWorkflowCoverageApproverCheck(coverageDiagnostics, stepNo) {
  const checks = Array.isArray(coverageDiagnostics?.checks?.approvers)
    ? coverageDiagnostics.checks.approvers
    : [];
  return (
    checks.find(
      (check) => Math.max(1, Number(check?.stepNo || 0) || 0) === Math.max(1, Number(stepNo || 0) || 0)
    ) || null
  );
}

function buildWorkflowCoverageStepIssue({
  step,
  coverageDiagnostics,
  packageLabel,
  stepScopeLabels,
  l,
}) {
  const coverageCheck = findWorkflowCoverageApproverCheck(
    coverageDiagnostics,
    step?.stepNo
  );
  if (!coverageCheck) {
    return null;
  }

  const status = String(coverageCheck.status || "").toUpperCase();
  const scopeLabel = getScopeLabel(step?.stageScopeType, stepScopeLabels);
  const uncoveredScopeCount = Math.max(0, Number(coverageCheck.uncoveredScopeCount || 0) || 0);

  if (status === "NO_TARGET_SCOPES") {
    return buildWorkflowStepIssue(
      "warning",
      "no_target_scopes",
      l("No target scopes resolved", "Hedef kapsam cozulmedi"),
      l(
        `This assignment currently resolves no concrete ${scopeLabel} targets for ${packageLabel}.`,
        `Bu atama su anda ${packageLabel} icin somut ${scopeLabel} hedefi cozmuyor.`
      )
    );
  }

  if (status === "NO_COVERAGE") {
    return buildWorkflowStepIssue(
      "warning",
      "no_eligible_users",
      l("No eligible users found", "Uygun kullanici bulunamadi"),
      l(
        `No active users currently hold ${packageLabel} authority at the selected ${scopeLabel} targets.`,
        `Secilen ${scopeLabel} hedeflerinde su anda ${packageLabel} yetkisine sahip aktif kullanici yok.`
      )
    );
  }

  if (status === "PARTIAL_GAP") {
    return buildWorkflowStepIssue(
      "warning",
      "partial_coverage_gap",
      l("Partial actor coverage", "Kismi aktor kapsami"),
      l(
        `${uncoveredScopeCount} ${scopeLabel} target scope(s) currently have no active users for ${packageLabel}.`,
        `${uncoveredScopeCount} ${scopeLabel} hedef kapsaminda su anda ${packageLabel} icin aktif kullanici yok.`
      )
    );
  }

  return null;
}

/**
 * Builds the blocking and advisory validation state for the current workflow
 * step draft list. This keeps step-level warnings consistent between the page
 * save gate and the inline card UI.
 */
export function buildWorkflowStepValidationModel({
  stepDrafts,
  processType,
  workflowPackageEntries = [],
  coverageDiagnostics = null,
  stepScopeLabels = {},
  l,
}) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const packageEntriesByCode = new Map(
    (Array.isArray(workflowPackageEntries) ? workflowPackageEntries : []).map((entry) => [
      String(entry?.code || "").trim().toUpperCase(),
      entry,
    ])
  );

  const steps = (Array.isArray(stepDrafts) ? stepDrafts : []).map((step, index) => {
    const normalizedPackageCode = String(step?.requiredPackageCode || "").trim().toUpperCase();
    const normalizedScopeType = String(step?.stageScopeType || "").trim().toUpperCase();
    const packageEntry = packageEntriesByCode.get(normalizedPackageCode) || null;
    const packageLabel =
      packageEntry?.displayName ||
      step?.requiredPackageLabel ||
      normalizedPackageCode ||
      l("this step", "bu adim");
    const blockingIssues = [];
    const warningIssues = [];

    if (!normalizedPackageCode) {
      blockingIssues.push(
        buildWorkflowStepIssue(
          "error",
          "no_package_selected",
          l("Package required", "Paket gerekli"),
          l(
            "Select a workflow package before saving this step.",
            "Bu adimi kaydetmeden once bir workflow paketi secin."
          )
        )
      );
    } else if (!packageEntry) {
      blockingIssues.push(
        buildWorkflowStepIssue(
          "error",
          "unknown_package",
          l("Unknown package", "Bilinmeyen paket"),
          l(
            `${normalizedPackageCode} is not available in the current workflow package catalog.`,
            `${normalizedPackageCode} mevcut workflow paket katalogunda bulunmuyor.`
          )
        )
      );
    } else {
      const allowedScopes = Array.isArray(packageEntry.allowedScopes)
        ? packageEntry.allowedScopes
        : [];
      const allowedScopeLabels = allowedScopes.map((scopeType) =>
        getScopeLabel(scopeType, stepScopeLabels)
      );

      if (normalizedPackageCode === "PKG-AP-POST-GROUP") {
        blockingIssues.push(
          buildWorkflowStepIssue(
            "error",
            "ap_group_post_extension_not_enabled",
            l("Group AP post is not enabled", "Grup AP kaydi etkin degil"),
            packageEntry.extensionNote ||
              l(
                "Group-scoped AP posting remains preview-only until the clean extension package ships.",
                "Grup kapsamli AP kaydi, temiz extension paketi cikana kadar yalnizca onizlemedir."
              )
          )
        );
      } else if (
        normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE &&
        normalizedPackageCode !== "PKG-AP-APPROVE"
      ) {
        // The current AP backend bridge can only represent approval-stage
        // packages. Submit/post remain explained by preset preview for now.
        blockingIssues.push(
          buildWorkflowStepIssue(
            "error",
            "ap_package_bridge_not_supported",
            l("AP package bridge not supported", "AP paket koprusu desteklenmiyor"),
            l(
              "The current AP step builder can only bind approval-stage steps to AP Documents / Approve.",
              "Mevcut AP adim olusturucusu yalnizca onay adimlarini AP Documents / Approve paketine baglayabilir."
            )
          )
        );
      }

      if (
        normalizedProcessType === "PERIOD_CLOSE" &&
        normalizedScopeType === "GROUP" &&
        normalizedPackageCode.startsWith("PKG-PC-")
      ) {
        blockingIssues.push(
          buildWorkflowStepIssue(
            "error",
            "period_close_group_extension_not_ready",
            l(
              "Group period-close extension is not ready",
              "Grup donem kapama extension'i hazir degil"
            ),
            l(
              "Period Close packages currently support LEGAL_ENTITY and COUNTRY only. GROUP final-close needs a later backend extension.",
              "Period Close paketleri su an yalnizca LEGAL_ENTITY ve COUNTRY destekler. GROUP final-close icin daha sonraki bir backend extension gerekir."
            )
          )
        );
      } else if (
        allowedScopes.length > 0 &&
        normalizedScopeType &&
        !allowedScopes.includes(normalizedScopeType)
      ) {
        blockingIssues.push(
          buildWorkflowStepIssue(
            "error",
            "package_scope_mismatch",
            l("Package scope mismatch", "Paket kapsam uyusmazligi"),
            l(
              `${packageLabel} supports ${allowedScopeLabels.join(", ")}, but this step uses ${getScopeLabel(normalizedScopeType, stepScopeLabels)}.`,
              `${packageLabel}, ${allowedScopeLabels.join(", ")} destekler; ancak bu adim ${getScopeLabel(normalizedScopeType, stepScopeLabels)} kullaniyor.`
            )
          )
        );
      }

      if (packageEntry.plannedExtension && normalizedPackageCode !== "PKG-AP-POST-GROUP") {
        blockingIssues.push(
          buildWorkflowStepIssue(
            "error",
            "planned_extension",
            l("Extension not enabled", "Extension etkin degil"),
            packageEntry.extensionNote ||
              l(
                "This workflow package depends on an extension that is not enabled yet.",
                "Bu workflow paketi henuz etkin olmayan bir extension'a baglidir."
              )
          )
        );
      }

      const runtimeNotes = Array.isArray(packageEntry.runtimeNotes)
        ? packageEntry.runtimeNotes
        : [];
      if (runtimeNotes.length > 0) {
        warningIssues.push(
          buildWorkflowStepIssue(
            "warning",
            "runtime_source_note",
            l("Runtime source note", "Runtime kaynak notu"),
            runtimeNotes[0]
          )
        );
      }
    }

    if (step?.allowSelfApprove) {
      warningIssues.push(
        buildWorkflowStepIssue(
          "warning",
          "self_approve_enabled",
          l("Self-approval enabled", "Kendi kendine onay acik"),
          l(
            "All shipped governance presets keep self-approval off. Enable it only for an intentional exception.",
            "Tum hazir governance presetleri kendi kendine onayi kapali tutar. Bunu yalnizca bilincli bir istisna icin acin."
          )
        )
      );
    }

    const coverageIssue = buildWorkflowCoverageStepIssue({
      step,
      coverageDiagnostics,
      packageLabel,
      stepScopeLabels,
      l,
    });
    if (coverageIssue) {
      warningIssues.push(coverageIssue);
    }

    return {
      index,
      stepNo: Math.max(1, Number(step?.stepNo || index + 1) || index + 1),
      blockingIssues,
      warningIssues,
      allIssues: [...blockingIssues, ...warningIssues],
      hasBlockingIssues: blockingIssues.length > 0,
      hasWarnings: warningIssues.length > 0,
    };
  });

  const blockingIssueCount = steps.reduce(
    (total, step) => total + step.blockingIssues.length,
    0
  );
  const warningCount = steps.reduce(
    (total, step) => total + step.warningIssues.length,
    0
  );

  return {
    steps,
    blockingIssueCount,
    warningCount,
    hasBlockingIssues: blockingIssueCount > 0,
    hasWarnings: warningCount > 0,
    summaryTitle:
      blockingIssueCount > 0
        ? l("Workflow step fixes required", "Workflow adim duzeltmeleri gerekli")
        : warningCount > 0
          ? l("Workflow warnings to review", "Workflow uyarilarini gozden gecirin")
          : l("Workflow step checks passed", "Workflow adim kontrolleri gecti"),
    summaryText:
      blockingIssueCount > 0
        ? warningCount > 0
          ? l(
              `Fix ${blockingIssueCount} blocking issue(s) before saving. ${warningCount} additional warning(s) remain visible for rollout review.`,
              `Kaydetmeden once ${blockingIssueCount} engelleyici sorunu duzeltin. Canliya alma incelemesi icin ${warningCount} ek uyari gorunur kalir.`
            )
          : l(
              `Fix ${blockingIssueCount} blocking issue(s) before saving this workflow.`,
              `Bu workflow'u kaydetmeden once ${blockingIssueCount} engelleyici sorunu duzeltin.`
            )
        : warningCount > 0
          ? l(
              `${warningCount} warning(s) are visible. The draft can still be saved, but review rollout risks first.`,
              `${warningCount} uyari gorunuyor. Taslak yine de kaydedilebilir; ancak once canliya alma risklerini gozden gecirin.`
            )
          : l(
              "No blocking or advisory step issues were found in the current draft.",
              "Mevcut taslakta engelleyici veya danisma niteliginde adim sorunu bulunmadi."
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
  const scopeLabel = getScopeLabel(step?.stageScopeType, stepScopeLabels);
  const packageLabel =
    step?.requiredPackageLabel || step?.requiredPackageCode || step?.requiredPermissionCode || "-";
  const actionLabel = step?.actionLabel || deriveActionLabelFromPackage(step?.requiredPackageCode);
  const roleLabels = Array.isArray(step?.eligibleBusinessRoleLabels)
    ? step.eligibleBusinessRoleLabels.filter(Boolean)
    : [];
  const minCount = Math.max(1, Number(step?.minApproverCount || 1));
  const selfApprove = Boolean(step?.allowSelfApprove);
  const escalation = String(step?.escalationAfterHours || "").trim();

  const parts = [];
  parts.push(
    l(
      `${actionLabel || "Step"} runs at ${scopeLabel} scope using ${packageLabel}.`,
      `${actionLabel || "Adim"}, ${scopeLabel} kapsaminda ${packageLabel} kullanir.`
    )
  );
  if (roleLabels.length > 0) {
    parts.push(
      l(
        `Suggested business roles: ${roleLabels.join(", ")}.`,
        `Onerilen is rolleri: ${roleLabels.join(", ")}.`
      )
    );
  }
  parts.push(
    minCount === 1
      ? l("One actor is required.", "Tek bir aktor gerekir.")
      : l(`${minCount} actors are required.`, `${minCount} aktor gerekir.`)
  );

  if (String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    parts.push(
      l(
        "Current AP backend bridge still resolves reviewer authority from the workflow assignment scope.",
        "Mevcut AP backend koprusu, inceleyen yetkisini hala workflow atama kapsamindan cozer."
      )
    );
  } else if (step?.requiredPermissionCode) {
    parts.push(
      l(
        `Current runtime bridge permission: "${step.requiredPermissionCode}".`,
        `Mevcut runtime kopru yetkisi: "${step.requiredPermissionCode}".`
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
  return l(
    `This workflow runs in this order: ${steps
      .map(
        (step, index) =>
          `${index + 1}. ${step?.actionLabel || "Step"} at ${getScopeLabel(
            step?.stageScopeType,
            stepScopeLabels
          )} using ${step?.requiredPackageLabel || step?.requiredPackageCode || step?.requiredPermissionCode || "-"}`
      )
      .join(" -> ")}.`,
    `Bu workflow su sirada calisir: ${steps
      .map(
        (step, index) =>
          `${index + 1}. ${step?.actionLabel || "Adim"} - ${getScopeLabel(
            step?.stageScopeType,
            stepScopeLabels
          )} kapsaminda ${step?.requiredPackageLabel || step?.requiredPackageCode || step?.requiredPermissionCode || "-"}`
      )
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

function parseOptionalRoutingAmount(value) {
  if (value === undefined || value === null || value === "") {
    return { value: null, invalid: false };
  }
  const parsed = Number(String(value).replaceAll(",", "").trim());
  if (!Number.isFinite(parsed)) {
    return { value: null, invalid: true };
  }
  return { value: parsed, invalid: false };
}

function parseOptionalRoutingPriority(value) {
  if (value === undefined || value === null || value === "") {
    return { value: 100, invalid: false };
  }
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { value: 100, invalid: true };
  }
  return { value: parsed, invalid: false };
}

function normalizeRoutingBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  return String(value || "").trim().toLowerCase() === "true";
}

function resolveWorkflowAssignmentScopeType(item = {}) {
  if (toPositiveInt(item?.operatingUnitId ?? item?.operating_unit_id)) {
    return "OPERATING_UNIT";
  }
  if (toPositiveInt(item?.legalEntityId ?? item?.legal_entity_id)) {
    return "LEGAL_ENTITY";
  }
  if (toPositiveInt(item?.countryId ?? item?.country_id)) {
    return "COUNTRY";
  }
  if (toPositiveInt(item?.groupCompanyId ?? item?.group_company_id)) {
    return "GROUP";
  }
  return String(item?.scopeType || "").trim().toUpperCase() || "TENANT";
}

function resolveWorkflowAssignmentScopeId(item = {}) {
  return (
    toPositiveInt(item?.operatingUnitId ?? item?.operating_unit_id) ||
    toPositiveInt(item?.legalEntityId ?? item?.legal_entity_id) ||
    toPositiveInt(item?.countryId ?? item?.country_id) ||
    toPositiveInt(item?.groupCompanyId ?? item?.group_company_id) ||
    toPositiveInt(item?.scopeId) ||
    null
  );
}

function buildWorkflowAssignmentScopeKey(item = {}) {
  return [
    resolveWorkflowAssignmentScopeType(item),
    toPositiveInt(item?.groupCompanyId ?? item?.group_company_id) || 0,
    toPositiveInt(item?.countryId ?? item?.country_id) || 0,
    toPositiveInt(item?.legalEntityId ?? item?.legal_entity_id) || 0,
    toPositiveInt(item?.operatingUnitId ?? item?.operating_unit_id) || 0,
  ].join(":");
}

function normalizeWorkflowRoutingRule(item = {}) {
  const minAmount = parseOptionalRoutingAmount(item?.minAmount ?? item?.min_amount).value;
  const maxAmount = parseOptionalRoutingAmount(item?.maxAmount ?? item?.max_amount).value;
  const isFallback = normalizeRoutingBoolean(item?.isFallback ?? item?.is_fallback);
  const explicitAmountBasis = String(
    item?.amountBasis ?? item?.amount_basis ?? ""
  )
    .trim()
    .toUpperCase();

  return {
    id: toPositiveInt(item?.id),
    processType: String(item?.processType ?? item?.process_type ?? "").trim().toUpperCase(),
    status: String(item?.status || "ACTIVE").trim().toUpperCase() || "ACTIVE",
    scopeType: resolveWorkflowAssignmentScopeType(item),
    scopeId: resolveWorkflowAssignmentScopeId(item),
    scopeKey: buildWorkflowAssignmentScopeKey(item),
    amountBasis:
      explicitAmountBasis || minAmount !== null || maxAmount !== null || isFallback
        ? "BASE_AMOUNT"
        : null,
    minAmount,
    maxAmount,
    priority: parseOptionalRoutingPriority(item?.priority).value,
    isFallback,
    effectiveFrom: String(item?.effectiveFrom ?? item?.effective_from ?? "").trim(),
    effectiveTo: String(item?.effectiveTo ?? item?.effective_to ?? "").trim() || null,
  };
}

function workflowEffectiveWindowsOverlap(left, right) {
  const leftFrom = String(left?.effectiveFrom || "").trim();
  const rightFrom = String(right?.effectiveFrom || "").trim();
  const leftTo = String(left?.effectiveTo || "9999-12-31").trim();
  const rightTo = String(right?.effectiveTo || "9999-12-31").trim();

  if (!leftFrom || !rightFrom) {
    return false;
  }
  return leftFrom <= rightTo && rightFrom <= leftTo;
}

function isLegacyWorkflowRoutingRule(rule) {
  return (
    !rule?.isFallback &&
    rule?.amountBasis === null &&
    rule?.minAmount === null &&
    rule?.maxAmount === null
  );
}

function workflowAmountBandsOverlap(left, right) {
  if (left?.maxAmount !== null && right?.minAmount !== null && left.maxAmount < right.minAmount) {
    return false;
  }
  if (right?.maxAmount !== null && left?.minAmount !== null && right.maxAmount < left.minAmount) {
    return false;
  }
  return true;
}

function workflowRoutingRulesOverlap(left, right) {
  if (left?.isFallback || right?.isFallback) {
    return false;
  }
  if (isLegacyWorkflowRoutingRule(left) || isLegacyWorkflowRoutingRule(right)) {
    return true;
  }
  if (left?.amountBasis !== right?.amountBasis) {
    return false;
  }
  return workflowAmountBandsOverlap(left, right);
}

function formatRoutingPreviewAmount(value, language) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/**
 * Build the plain-language sentence shown for one AP routing rule preview row.
 */
export function buildApprovalRoutingRulePreview({
  scopeType,
  scopeSummary,
  minAmount,
  maxAmount,
  amountBasis,
  isFallback = false,
  targetLabel,
  l,
}) {
  const language = String(l("en", "tr"));
  const normalizedScopeType = String(scopeType || "").trim().toUpperCase();
  const normalizedScopeSummary = String(scopeSummary || "").trim();
  const normalizedTargetLabel =
    String(targetLabel || "").trim() || l("the selected workflow", "secilen workflow");
  const normalizedAmountBasis =
    String(amountBasis || "").trim().toUpperCase() || "BASE_AMOUNT";
  const amountBasisLabel =
    normalizedAmountBasis === "BASE_AMOUNT"
      ? l("base amount", "baz tutar")
      : normalizedAmountBasis;
  const minAmountLabel = formatRoutingPreviewAmount(minAmount, language);
  const maxAmountLabel = formatRoutingPreviewAmount(maxAmount, language);

  const scopeText =
    normalizedScopeType === "TENANT"
      ? l("across the tenant", "tenant genelinde")
      : l(
          `for ${normalizedScopeSummary || normalizedScopeType}`,
          `${normalizedScopeSummary || normalizedScopeType} icin`
        );

  let amountText = l(`for any ${amountBasisLabel}`, `${amountBasisLabel} icin herhangi bir tutarda`);
  if (isFallback) {
    amountText = l(
      `for all remaining ${amountBasisLabel}`,
      `kalan tum ${amountBasisLabel} durumlarinda`
    );
  } else if (minAmount !== null && maxAmount !== null) {
    amountText = l(
      `from ${minAmountLabel} to ${maxAmountLabel} ${amountBasisLabel}`,
      `${minAmountLabel} ile ${maxAmountLabel} ${amountBasisLabel} arasinda`
    );
  } else if (minAmount !== null) {
    amountText = l(
      `above ${minAmountLabel} ${amountBasisLabel}`,
      `${minAmountLabel} ${amountBasisLabel} uzerinde`
    );
  } else if (maxAmount !== null) {
    amountText = l(
      `up to ${maxAmountLabel} ${amountBasisLabel}`,
      `${maxAmountLabel} ${amountBasisLabel} seviyesine kadar`
    );
  }

  return l(
    `AP documents ${scopeText} ${amountText} use ${normalizedTargetLabel}.`,
    `${scopeText} AP belgeleri ${amountText} icin ${normalizedTargetLabel} kullanir.`
  );
}

/**
 * Sort AP routing rows so the matrix reads close to the runtime matching order.
 */
export function sortApprovalRoutingMatrixRows(rows = [], l) {
  const scopeRank = {
    OPERATING_UNIT: 5,
    LEGAL_ENTITY: 4,
    COUNTRY: 3,
    GROUP: 2,
    TENANT: 1,
  };

  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftRule = normalizeWorkflowRoutingRule(left);
    const rightRule = normalizeWorkflowRoutingRule(right);
    const leftStatusRank = leftRule.status === "ACTIVE" ? 0 : 1;
    const rightStatusRank = rightRule.status === "ACTIVE" ? 0 : 1;
    if (leftStatusRank !== rightStatusRank) {
      return leftStatusRank - rightStatusRank;
    }

    const scopeDiff =
      (scopeRank[rightRule.scopeType] || 0) - (scopeRank[leftRule.scopeType] || 0);
    if (scopeDiff !== 0) {
      return scopeDiff;
    }

    const leftScopeLabel = buildAssignmentScopeLabel(left, l);
    const rightScopeLabel = buildAssignmentScopeLabel(right, l);
    const scopeLabelDiff = leftScopeLabel.localeCompare(rightScopeLabel);
    if (scopeLabelDiff !== 0) {
      return scopeLabelDiff;
    }

    const fallbackDiff = Number(leftRule.isFallback) - Number(rightRule.isFallback);
    if (fallbackDiff !== 0) {
      return fallbackDiff;
    }

    const leftMinSort = leftRule.minAmount === null ? -1 : leftRule.minAmount;
    const rightMinSort = rightRule.minAmount === null ? -1 : rightRule.minAmount;
    if (leftMinSort !== rightMinSort) {
      return leftMinSort - rightMinSort;
    }

    const leftMaxSort = leftRule.maxAmount === null ? Number.MAX_SAFE_INTEGER : leftRule.maxAmount;
    const rightMaxSort =
      rightRule.maxAmount === null ? Number.MAX_SAFE_INTEGER : rightRule.maxAmount;
    if (leftMaxSort !== rightMaxSort) {
      return leftMaxSort - rightMaxSort;
    }

    if (leftRule.priority !== rightRule.priority) {
      return rightRule.priority - leftRule.priority;
    }

    return (toPositiveInt(right?.id) || 0) - (toPositiveInt(left?.id) || 0);
  });
}

/**
 * Validate one AP routing-matrix draft against the frontend form rules and
 * the currently loaded ACTIVE rows for the same scope.
 */
export function buildApprovalRoutingMatrixValidationModel({
  draft,
  assignments = [],
  definitions = [],
  presetEntries = [],
  editingAssignmentId = null,
  l,
}) {
  const errors = [];
  const warnings = [];
  const conflicts = [];
  const minAmountInfo = parseOptionalRoutingAmount(draft?.minAmount);
  const maxAmountInfo = parseOptionalRoutingAmount(draft?.maxAmount);
  const priorityInfo = parseOptionalRoutingPriority(draft?.priority);
  const normalizedRule = normalizeWorkflowRoutingRule({
    ...draft,
    minAmount: minAmountInfo.value,
    maxAmount: maxAmountInfo.value,
    priority: priorityInfo.value,
  });
  const draftStatus = String(draft?.status || "ACTIVE").trim().toUpperCase() || "ACTIVE";
  const targetMode = String(draft?.targetMode || "definition").trim().toLowerCase();
  const selectedDefinition = (Array.isArray(definitions) ? definitions : []).find(
    (row) => toPositiveInt(row?.id) === toPositiveInt(draft?.workflowDefinitionId)
  );
  const selectedPreset = (Array.isArray(presetEntries) ? presetEntries : []).find(
    (entry) => String(entry?.code || "") === String(draft?.workflowPresetCode || "")
  );

  if (!normalizedRule.scopeType) {
    errors.push(l("Choose a scope first.", "Once bir kapsam secin."));
  }
  if (!normalizedRule.effectiveFrom) {
    errors.push(l("Effective from is required.", "Gecerlilik baslangici zorunludur."));
  }
  if (draft?.effectiveTo && draft.effectiveFrom && String(draft.effectiveTo) < String(draft.effectiveFrom)) {
    errors.push(
      l(
        "Effective to cannot be earlier than effective from.",
        "Gecerlilik bitisi, baslangictan once olamaz."
      )
    );
  }
  if (minAmountInfo.invalid) {
    errors.push(l("Amount from must be a number.", "Tutar alt siniri sayi olmalidir."));
  }
  if (maxAmountInfo.invalid) {
    errors.push(l("Amount to must be a number.", "Tutar ust siniri sayi olmalidir."));
  }
  if (priorityInfo.invalid) {
    errors.push(l("Priority must be a non-negative integer.", "Oncelik negatif olmayan tam sayi olmalidir."));
  }
  if (normalizedRule.minAmount !== null && normalizedRule.minAmount < 0) {
    errors.push(l("Amount from cannot be negative.", "Tutar alt siniri negatif olamaz."));
  }
  if (normalizedRule.maxAmount !== null && normalizedRule.maxAmount < 0) {
    errors.push(l("Amount to cannot be negative.", "Tutar ust siniri negatif olamaz."));
  }
  if (
    normalizedRule.minAmount !== null &&
    normalizedRule.maxAmount !== null &&
    normalizedRule.maxAmount < normalizedRule.minAmount
  ) {
    errors.push(
      l(
        "Amount to cannot be smaller than amount from.",
        "Tutar ust siniri, alt sinirdan kucuk olamaz."
      )
    );
  }
  if (
    normalizedRule.isFallback &&
    (normalizedRule.minAmount !== null || normalizedRule.maxAmount !== null)
  ) {
    errors.push(
      l(
        "Fallback rules cannot set amount from or amount to.",
        "Fallback kurallari tutar alt veya ust siniri belirleyemez."
      )
    );
  }

  if (targetMode === "definition") {
    if (!toPositiveInt(draft?.workflowDefinitionId)) {
      errors.push(
        l(
          "Choose a workflow definition for this route.",
          "Bu rota icin bir workflow tanimi secin."
        )
      );
    } else if (
      String(selectedDefinition?.processType || "").trim().toUpperCase() !==
      AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
    ) {
      errors.push(
        l(
          "The selected definition must belong to AP Document Posting.",
          "Secilen tanim AP Belge Kaydi surecine ait olmalidir."
        )
      );
    }
  } else if (targetMode === "preset") {
    if (!selectedPreset) {
      errors.push(l("Choose a workflow preset first.", "Once bir workflow preset secin."));
    } else if (selectedPreset.usesExtension) {
      errors.push(
        selectedPreset.extensionNote ||
          l(
            "This preset is preview-only until its extension package is available.",
            "Bu preset extension paketi hazir olana kadar yalnizca onizlemedir."
          )
      );
    }
    if (!String(draft?.newDefinitionCode || "").trim()) {
      errors.push(
        l(
          "Preset-backed routes need a workflow code.",
          "Preset tabanli rotalar bir workflow kodu ister."
        )
      );
    }
    if (!String(draft?.newDefinitionName || "").trim()) {
      errors.push(
        l(
          "Preset-backed routes need a workflow name.",
          "Preset tabanli rotalar bir workflow adi ister."
        )
      );
    }
  }

  if (
    draftStatus === "ACTIVE" &&
    normalizedRule.minAmount === null &&
    normalizedRule.maxAmount === null &&
    !normalizedRule.isFallback
  ) {
    warnings.push(
      l(
        "A rule with no amount band matches every amount at this scope. Keep it only when that is intentional.",
        "Tutar bandi olmayan bir kural bu kapsamda tum tutarlari eslestirir. Bunu yalnizca bilerek istiyorsaniz kullanin."
      )
    );
  }

  if (draftStatus === "ACTIVE" && errors.length === 0) {
    (Array.isArray(assignments) ? assignments : []).forEach((row) => {
      const rowRule = normalizeWorkflowRoutingRule(row);
      if (rowRule.processType !== AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
        return;
      }
      if (rowRule.status !== "ACTIVE") {
        return;
      }
      if (toPositiveInt(rowRule.id) === toPositiveInt(editingAssignmentId)) {
        return;
      }
      if (rowRule.scopeKey !== normalizedRule.scopeKey) {
        return;
      }
      if (!workflowEffectiveWindowsOverlap(normalizedRule, rowRule)) {
        return;
      }

      if (normalizedRule.isFallback && rowRule.isFallback) {
        conflicts.push({
          row,
          code: "FALLBACK_CONFLICT",
          message: l(
            "Only one active fallback rule can exist for the same scope and effective window.",
            "Ayni kapsam ve gecerlilik araliginda yalnizca bir aktif fallback kurali olabilir."
          ),
        });
        return;
      }

      if (workflowRoutingRulesOverlap(normalizedRule, rowRule)) {
        conflicts.push({
          row,
          code: "AMOUNT_OVERLAP",
          message: l(
            "Active amount bands cannot overlap at the same scope and effective window.",
            "Aktif tutar bantlari ayni kapsam ve gecerlilik araliginda cakisamaz."
          ),
        });
      }
    });
  }

  return {
    errors,
    warnings,
    conflicts,
    isValid: errors.length === 0 && conflicts.length === 0,
  };
}

export default {
  PROCESS_TYPES,
  ASSIGNMENT_SCOPE_TYPES,
  STEP_SCOPE_TYPES,
  AP_BUSINESS_TEMPLATES,
  toPositiveInt,
  todayIsoDate,
  buildDefaultSteps,
  listWorkflowStepPackageOptions,
  safeParseJsonArray,
  normalizeStepDraft,
  buildStepDrafts,
  serializeStepDrafts,
  buildWorkflowExplainabilityPreviewModel,
  buildStepPreview,
  buildWorkflowPreview,
  buildApBusinessPreview,
  buildWorkflowPresetBaselineStepDrafts,
  buildWorkflowPresetPreviewModel,
  buildWorkflowPresetComparisonModel,
  buildWorkflowStepValidationModel,
  buildAssignmentEffectText,
  buildAssignmentSelectionLabel,
  buildAssignmentScopeLabel,
  buildApprovalRoutingRulePreview,
  sortApprovalRoutingMatrixRows,
  buildApprovalRoutingMatrixValidationModel,
  buildWorkflowCoverageReviewModel,
};
