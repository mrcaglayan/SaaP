import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
} from "../../../../../../shared/cariDocumentWorkflowGovernance.js";

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

function getScopeLabel(value, labels = {}) {
  return labels[String(value || "").toUpperCase()] || value || "-";
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
  selectedCountry,
  selectedGroupCompany,
  selectedLegalEntity,
  selectedOperatingUnit,
  l,
}) {
  const scopeType = assignmentForm?.scopeType;

  if (scopeType === "TENANT") {
    return l(
      "This workflow will apply across the whole tenant.",
      "Bu workflow tum tenant genelinde gecerli olur."
    );
  }
  if (scopeType === "GROUP") {
    return l(
      `This workflow will apply under Group = ${
        selectedGroupCompany?.code || selectedGroupCompany?.name || "-"
      }.`,
      `Bu workflow Grup = ${selectedGroupCompany?.code || selectedGroupCompany?.name || "-"} altinda gecerli olur.`
    );
  }
  if (scopeType === "COUNTRY") {
    return l(
      `This workflow will apply under Country = ${
        selectedCountry?.iso2 || selectedCountry?.name || "-"
      }.`,
      `Bu workflow Ulke = ${selectedCountry?.iso2 || selectedCountry?.name || "-"} altinda gecerli olur.`
    );
  }
  if (scopeType === "LEGAL_ENTITY") {
    return l(
      `This workflow will apply only to Legal Entity = ${
        selectedLegalEntity?.code || selectedLegalEntity?.name || "-"
      }.`,
      `Bu workflow yalnizca Legal Entity = ${selectedLegalEntity?.code || selectedLegalEntity?.name || "-"} icin gecerli olur.`
    );
  }
  if (scopeType === "OPERATING_UNIT") {
    return l(
      `This workflow will apply only to Operating Unit = ${
        selectedOperatingUnit?.code || selectedOperatingUnit?.name || "-"
      }.`,
      `Bu workflow yalnizca Operating Unit = ${selectedOperatingUnit?.code || selectedOperatingUnit?.name || "-"} icin gecerli olur.`
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
  selectedCountry,
  selectedGroupCompany,
  selectedLegalEntity,
  selectedOperatingUnit,
  scopeTypeLabels,
  l,
}) {
  const scopeType = String(assignmentForm?.scopeType || "").toUpperCase();
  const scopeLabel = scopeTypeLabels?.[scopeType] || scopeType || "-";

  if (scopeType === "TENANT") {
    return scopeLabel;
  }
  if (scopeType === "GROUP") {
    return `${scopeLabel} = ${
      selectedGroupCompany?.code || selectedGroupCompany?.name || "-"
    }`;
  }
  if (scopeType === "COUNTRY") {
    return `${scopeLabel} = ${selectedCountry?.iso2 || selectedCountry?.name || "-"}`;
  }
  if (scopeType === "LEGAL_ENTITY") {
    return `${scopeLabel} = ${
      selectedLegalEntity?.code || selectedLegalEntity?.name || "-"
    }`;
  }
  if (scopeType === "OPERATING_UNIT") {
    return `${scopeLabel} = ${
      selectedOperatingUnit?.code || selectedOperatingUnit?.name || "-"
    }`;
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
  toPositiveInt,
  todayIsoDate,
  buildDefaultSteps,
  safeParseJsonArray,
  normalizeStepDraft,
  buildStepDrafts,
  serializeStepDrafts,
  buildStepPreview,
  buildWorkflowPreview,
  buildAssignmentEffectText,
  buildAssignmentSelectionLabel,
  buildAssignmentScopeLabel,
};
