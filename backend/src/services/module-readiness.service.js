import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { autoRemapCariPurposeMappingsForLegalEntity } from "./cari.purpose-mapping-autofix.service.js";
import { CASH_PURPOSE_CODES } from "./cash.purpose-mappings.service.js";
import {
  isEligibleDraftOperatingUnit,
  summarizeOperatingUnitCurrentAccountEligibility,
} from "./ou.current-account-eligibility.service.js";

const CARI_REQUIRED_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_OFFSET",
  "CARI_AP_CONTROL",
  "CARI_AP_OFFSET",
  "CARI_SETTLEMENT_FX_GAIN",
  "CARI_SETTLEMENT_FX_LOSS",
]);

const SHAREHOLDER_REQUIRED_PURPOSE_CODES = Object.freeze([
  "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
  "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
]);

const CASH_CLEARING_REQUIRED_PURPOSE_CODES = Object.freeze([
  CASH_PURPOSE_CODES.EXCHANGE_CLEARING,
]);

const BANK_CONTROL_PARENT_REQUIRED_PURPOSE_CODES = Object.freeze([
  "BANK_CONTROL_PARENT",
]);

const SHAREHOLDER_EXPECTED_NORMAL_SIDE = Object.freeze({
  SHAREHOLDER_CAPITAL_CREDIT_PARENT: "CREDIT",
  SHAREHOLDER_COMMITMENT_DEBIT_PARENT: "DEBIT",
});

const CARI_DISTINCT_PAIRS = Object.freeze([
  Object.freeze({
    left: "CARI_AR_CONTROL",
    right: "CARI_AR_OFFSET",
  }),
  Object.freeze({
    left: "CARI_AP_CONTROL",
    right: "CARI_AP_OFFSET",
  }),
  Object.freeze({
    left: "CARI_SETTLEMENT_FX_GAIN",
    right: "CARI_SETTLEMENT_FX_LOSS",
  }),
]);

const CARI_EXPECTED_ACCOUNT_TYPE = Object.freeze({
  CARI_AR_CONTROL: "ASSET",
  CARI_AR_OFFSET: "REVENUE",
  CARI_AP_CONTROL: "LIABILITY",
  CARI_AP_OFFSET: "EXPENSE",
  CARI_SETTLEMENT_FX_GAIN: "REVENUE",
  CARI_SETTLEMENT_FX_LOSS: "EXPENSE",
});

const CARI_EXPECTED_NORMAL_SIDE = Object.freeze({
  CARI_AR_CONTROL: "DEBIT",
  CARI_AR_OFFSET: "CREDIT",
  CARI_AP_CONTROL: "CREDIT",
  CARI_AP_OFFSET: "DEBIT",
  CARI_SETTLEMENT_FX_GAIN: "CREDIT",
  CARI_SETTLEMENT_FX_LOSS: "DEBIT",
});

const SHAREHOLDER_DISTINCT_PAIRS = Object.freeze([
  Object.freeze({
    left: "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
    right: "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
  }),
]);

const CASH_CLEARING_DISTINCT_PAIRS = Object.freeze([]);

const CASH_CLEARING_EXPECTED_ACCOUNT_TYPE = Object.freeze({
  [CASH_PURPOSE_CODES.EXCHANGE_CLEARING]: "ASSET",
});

const CASH_CLEARING_EXPECTED_NORMAL_SIDE = Object.freeze({
  [CASH_PURPOSE_CODES.EXCHANGE_CLEARING]: "DEBIT",
});

const WORKFLOW_REQUIRED_PROCESS_TYPES = Object.freeze([
  "PERIOD_CLOSE",
  "CONSOLIDATION_RUN",
]);

const OU_CURRENT_ACCOUNT_SETUP_PATH = "/app/ayarlar/organizasyon-yonetimi";

function normalizePermissionCode(value) {
  return String(value || "").trim();
}

function normalizeWorkflowProcessType(value) {
  return toUpper(value);
}

function inferWorkflowAssignmentScopeType(row) {
  if (parsePositiveInt(row?.operating_unit_id)) {
    return "OPERATING_UNIT";
  }
  if (parsePositiveInt(row?.legal_entity_id)) {
    return "LEGAL_ENTITY";
  }
  if (parsePositiveInt(row?.group_company_id)) {
    return "GROUP";
  }
  return "TENANT";
}

function addWorkflowIssue(target, nextIssue) {
  const reason = toUpper(nextIssue?.reason);
  const stepNo = parsePositiveInt(nextIssue?.stepNo);
  if (!reason) {
    return;
  }
  const exists = target.some(
    (row) => toUpper(row.reason) === reason && parsePositiveInt(row.stepNo) === stepNo
  );
  if (exists) {
    return;
  }
  target.push({
    reason,
    stepNo: stepNo || null,
    message: String(nextIssue?.message || ""),
  });
}

function evaluateWorkflowDefinitionReadiness({
  definitionRow,
  steps,
  permissionCodeSet,
}) {
  const issues = [];
  const invalidStepPermissions = [];
  const workflowDefinitionId = parsePositiveInt(
    definitionRow?.workflow_definition_id ?? definitionRow?.id
  );
  const processType = normalizeWorkflowProcessType(
    definitionRow?.process_type ?? definitionRow?.processType
  );
  const stepRows = Array.isArray(steps)
    ? [...steps].sort((left, right) => Number(left.step_no || 0) - Number(right.step_no || 0))
    : [];

  if (!toDbBoolean(definitionRow?.definition_is_active ?? definitionRow?.is_active)) {
    addWorkflowIssue(issues, {
      reason: "DEFINITION_INACTIVE",
      message: "Assigned workflow definition is not ACTIVE",
    });
  }

  if (stepRows.length === 0) {
    addWorkflowIssue(issues, {
      reason: "MISSING_STEPS",
      message: "Assigned workflow definition has no steps",
    });
  }

  let expectedStepNo = 1;
  let sequenceBroken = false;
  for (const step of stepRows) {
    const stepNo = Number(step?.step_no || 0);
    if (!Number.isInteger(stepNo) || stepNo < 1) {
      addWorkflowIssue(issues, {
        reason: "INVALID_STEP_NO",
        message: "Workflow step_no must be a positive integer",
      });
      continue;
    }

    if (!sequenceBroken && stepNo !== expectedStepNo) {
      sequenceBroken = true;
      addWorkflowIssue(issues, {
        reason: "STEP_SEQUENCE_GAP",
        stepNo,
        message: "Workflow steps must be continuous from step 1",
      });
    }
    expectedStepNo = stepNo + 1;

    const minApproverCount = Number(step?.min_approver_count || 0);
    if (!Number.isInteger(minApproverCount) || minApproverCount < 1) {
      addWorkflowIssue(issues, {
        reason: "INVALID_MIN_APPROVER_COUNT",
        stepNo,
        message: "Workflow step min_approver_count must be at least 1",
      });
    }

    const requiredPermissionCode = normalizePermissionCode(step?.required_permission_code);
    if (!requiredPermissionCode) {
      addWorkflowIssue(issues, {
        reason: "STEP_PERMISSION_MISSING",
        stepNo,
        message: "Workflow step required_permission_code is missing",
      });
      continue;
    }
    if (!permissionCodeSet.has(requiredPermissionCode)) {
      invalidStepPermissions.push({
        stepNo,
        requiredPermissionCode,
        reason: "PERMISSION_CODE_NOT_FOUND",
      });
    }
  }

  return {
    workflowDefinitionId,
    processType,
    stepCount: stepRows.length,
    issues,
    invalidStepPermissions,
  };
}

function resolveWorkflowAssignmentPrecedence({
  assignmentRow,
  legalEntityId,
  groupCompanyId,
}) {
  const assignmentOperatingUnitEntityId = parsePositiveInt(assignmentRow?.ou_legal_entity_id);
  const assignmentLegalEntityId = parsePositiveInt(assignmentRow?.legal_entity_id);
  const assignmentGroupCompanyId = parsePositiveInt(assignmentRow?.group_company_id);

  if (assignmentOperatingUnitEntityId && assignmentOperatingUnitEntityId === legalEntityId) {
    return 1;
  }
  if (assignmentLegalEntityId && assignmentLegalEntityId === legalEntityId) {
    return 2;
  }
  if (
    assignmentGroupCompanyId &&
    parsePositiveInt(groupCompanyId) &&
    assignmentGroupCompanyId === parsePositiveInt(groupCompanyId)
  ) {
    return 3;
  }
  if (!assignmentOperatingUnitEntityId && !assignmentLegalEntityId && !assignmentGroupCompanyId) {
    return 4;
  }
  return null;
}

function pickWorkflowAssignmentForProcess({
  assignmentRows,
  processType,
  legalEntityId,
  groupCompanyId,
}) {
  const matchingRows = [];
  for (const row of assignmentRows) {
    if (normalizeWorkflowProcessType(row?.process_type) !== normalizeWorkflowProcessType(processType)) {
      continue;
    }
    const precedence = resolveWorkflowAssignmentPrecedence({
      assignmentRow: row,
      legalEntityId,
      groupCompanyId,
    });
    if (!precedence) {
      continue;
    }
    matchingRows.push({
      row,
      precedence,
    });
  }

  matchingRows.sort((left, right) => {
    if (left.precedence !== right.precedence) {
      return left.precedence - right.precedence;
    }
    return Number(right.row?.id || 0) - Number(left.row?.id || 0);
  });
  return matchingRows[0]?.row || null;
}

async function loadWorkflowReadinessAssignments({
  tenantId,
  runQuery = query,
}) {
  const effectiveOn = new Date().toISOString().slice(0, 10);
  const processTypePlaceholders = WORKFLOW_REQUIRED_PROCESS_TYPES.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       wa.*,
       wd.is_active AS definition_is_active,
       wd.code AS workflow_definition_code,
       wd.name AS workflow_definition_name,
       ou.legal_entity_id AS ou_legal_entity_id
     FROM workflow_assignments wa
     JOIN workflow_definitions wd ON wd.id = wa.workflow_definition_id
     LEFT JOIN operating_units ou ON ou.id = wa.operating_unit_id
     WHERE wa.tenant_id = ?
       AND wa.status = 'ACTIVE'
       AND wa.process_type IN (${processTypePlaceholders})
       AND wa.effective_from <= ?
       AND (wa.effective_to IS NULL OR wa.effective_to >= ?)`,
    [tenantId, ...WORKFLOW_REQUIRED_PROCESS_TYPES, effectiveOn, effectiveOn]
  );
  return result.rows || [];
}

async function loadWorkflowDefinitionStepsByDefinitionId({
  definitionIds,
  runQuery = query,
}) {
  const normalizedDefinitionIds = (Array.isArray(definitionIds) ? definitionIds : [])
    .map((value) => parsePositiveInt(value))
    .filter(Boolean);
  if (normalizedDefinitionIds.length === 0) {
    return new Map();
  }

  const placeholders = normalizedDefinitionIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       workflow_definition_id,
       step_no,
       required_permission_code,
       min_approver_count
     FROM workflow_definition_steps
     WHERE workflow_definition_id IN (${placeholders})
     ORDER BY workflow_definition_id ASC, step_no ASC`,
    normalizedDefinitionIds
  );

  const stepsByDefinitionId = new Map();
  for (const row of result.rows || []) {
    const definitionId = parsePositiveInt(row.workflow_definition_id);
    if (!definitionId) {
      continue;
    }
    if (!stepsByDefinitionId.has(definitionId)) {
      stepsByDefinitionId.set(definitionId, []);
    }
    stepsByDefinitionId.get(definitionId).push(row);
  }
  return stepsByDefinitionId;
}

async function loadPermissionCodeSet(runQuery = query) {
  const result = await runQuery(
    `SELECT code
     FROM permissions`
  );
  const set = new Set();
  for (const row of result.rows || []) {
    const code = normalizePermissionCode(row?.code);
    if (code) {
      set.add(code);
    }
  }
  return set;
}

async function loadLegalEntitiesWithGroupCompany({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  const normalizedIds = (Array.isArray(legalEntityIds) ? legalEntityIds : [])
    .map((value) => parsePositiveInt(value))
    .filter(Boolean);
  if (normalizedIds.length === 0) {
    return new Map();
  }
  const placeholders = normalizedIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT id, group_company_id
     FROM legal_entities
     WHERE tenant_id = ?
       AND id IN (${placeholders})`,
    [tenantId, ...normalizedIds]
  );
  const map = new Map();
  for (const row of result.rows || []) {
    const legalEntityId = parsePositiveInt(row.id);
    if (!legalEntityId) {
      continue;
    }
    map.set(legalEntityId, {
      legalEntityId,
      groupCompanyId: parsePositiveInt(row.group_company_id) || null,
    });
  }
  return map;
}

export async function getCloseConsolidationWorkflowReadiness(
  tenantId,
  legalEntityId = null,
  { runQuery = query } = {}
) {
  const legalEntityIds = await resolveTargetLegalEntityIds({
    tenantId,
    legalEntityId,
    runQuery,
  });
  if (legalEntityIds.length === 0) {
    return {
      moduleKey: "closeConsolidationWorkflow",
      byLegalEntity: [],
    };
  }

  let legalEntityScopeMap = new Map();
  let assignmentRows = [];
  let permissionCodeSet = new Set();
  let stepsByDefinitionId = new Map();
  try {
    [legalEntityScopeMap, assignmentRows, permissionCodeSet] = await Promise.all([
      loadLegalEntitiesWithGroupCompany({
        tenantId,
        legalEntityIds,
        runQuery,
      }),
      loadWorkflowReadinessAssignments({
        tenantId,
        runQuery,
      }),
      loadPermissionCodeSet(runQuery),
    ]);

    const workflowDefinitionIds = Array.from(
      new Set(
        assignmentRows
          .map((row) => parsePositiveInt(row.workflow_definition_id))
          .filter(Boolean)
      )
    );
    stepsByDefinitionId = await loadWorkflowDefinitionStepsByDefinitionId({
      definitionIds: workflowDefinitionIds,
      runQuery,
    });
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err;
    }
    return {
      moduleKey: "closeConsolidationWorkflow",
      byLegalEntity: legalEntityIds.map((entityId) => ({
        legalEntityId: entityId,
        ready: false,
        requiredProcessTypes: [...WORKFLOW_REQUIRED_PROCESS_TYPES],
        missingProcessTypes: [...WORKFLOW_REQUIRED_PROCESS_TYPES],
        resolvedAssignments: [],
        invalidDefinitions: [
          {
            processType: "PERIOD_CLOSE",
            assignmentId: null,
            workflowDefinitionId: null,
            issues: [
              {
                reason: "WORKFLOW_TABLES_MISSING",
                stepNo: null,
                message: "Workflow approval tables are not migrated yet",
              },
            ],
          },
        ],
        invalidStepPermissions: [],
      })),
    };
  }

  const definitionValidationById = new Map();
  for (const assignmentRow of assignmentRows) {
    const workflowDefinitionId = parsePositiveInt(assignmentRow.workflow_definition_id);
    if (!workflowDefinitionId || definitionValidationById.has(workflowDefinitionId)) {
      continue;
    }
    const definitionReadiness = evaluateWorkflowDefinitionReadiness({
      definitionRow: assignmentRow,
      steps: stepsByDefinitionId.get(workflowDefinitionId) || [],
      permissionCodeSet,
    });
    definitionValidationById.set(workflowDefinitionId, definitionReadiness);
  }

  const byLegalEntity = legalEntityIds.map((entityId) => {
    const legalEntityScope = legalEntityScopeMap.get(entityId) || {
      legalEntityId: entityId,
      groupCompanyId: null,
    };

    const resolvedAssignments = [];
    const missingProcessTypes = [];
    const invalidDefinitions = [];
    const invalidStepPermissions = [];

    for (const processType of WORKFLOW_REQUIRED_PROCESS_TYPES) {
      const assignmentRow = pickWorkflowAssignmentForProcess({
        assignmentRows,
        processType,
        legalEntityId: legalEntityScope.legalEntityId,
        groupCompanyId: legalEntityScope.groupCompanyId,
      });

      if (!assignmentRow) {
        missingProcessTypes.push(processType);
        continue;
      }

      const assignmentId = parsePositiveInt(assignmentRow.id);
      const workflowDefinitionId = parsePositiveInt(assignmentRow.workflow_definition_id);
      const definitionReadiness = definitionValidationById.get(workflowDefinitionId) || null;
      const scopeType = inferWorkflowAssignmentScopeType(assignmentRow);

      resolvedAssignments.push({
        processType,
        assignmentId: assignmentId || null,
        workflowDefinitionId: workflowDefinitionId || null,
        workflowDefinitionCode: String(assignmentRow.workflow_definition_code || ""),
        scopeType,
        scopeId:
          parsePositiveInt(assignmentRow.operating_unit_id) ||
          parsePositiveInt(assignmentRow.legal_entity_id) ||
          parsePositiveInt(assignmentRow.group_company_id) ||
          null,
      });

      if (definitionReadiness?.issues?.length > 0) {
        invalidDefinitions.push({
          processType,
          assignmentId: assignmentId || null,
          workflowDefinitionId: workflowDefinitionId || null,
          issues: definitionReadiness.issues,
        });
      }

      for (const invalidPermission of definitionReadiness?.invalidStepPermissions || []) {
        invalidStepPermissions.push({
          processType,
          assignmentId: assignmentId || null,
          workflowDefinitionId: workflowDefinitionId || null,
          stepNo: Number(invalidPermission.stepNo || 0) || null,
          requiredPermissionCode: String(invalidPermission.requiredPermissionCode || ""),
          reason: toUpper(invalidPermission.reason),
        });
      }
    }

    return {
      legalEntityId: legalEntityScope.legalEntityId,
      ready:
        missingProcessTypes.length === 0 &&
        invalidDefinitions.length === 0 &&
        invalidStepPermissions.length === 0,
      requiredProcessTypes: [...WORKFLOW_REQUIRED_PROCESS_TYPES],
      missingProcessTypes,
      resolvedAssignments,
      invalidDefinitions,
      invalidStepPermissions,
    };
  });

  return {
    moduleKey: "closeConsolidationWorkflow",
    byLegalEntity,
  };
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDbBoolean(value) {
  return value === true || Number(value) === 1;
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function addInvalidMapping(invalidMappings, nextRow) {
  const purposeCode = toUpper(nextRow?.purposeCode);
  const reason = toUpper(nextRow?.reason);
  if (!purposeCode || !reason) {
    return;
  }
  const exists = invalidMappings.some(
    (row) => toUpper(row.purposeCode) === purposeCode && toUpper(row.reason) === reason
  );
  if (exists) {
    return;
  }
  invalidMappings.push({
    purposeCode,
    reason,
    accountId: parsePositiveInt(nextRow.accountId) || null,
    accountCode: String(nextRow.accountCode || "") || null,
    details: nextRow.details || null,
  });
}

function buildReadinessRow({
  legalEntityId,
  requiredPurposeCodes,
  missingPurposeCodes,
  invalidMappings,
}) {
  return {
    legalEntityId,
    ready: missingPurposeCodes.length === 0 && invalidMappings.length === 0,
    requiredPurposeCodes: [...requiredPurposeCodes],
    missingPurposeCodes,
    invalidMappings,
  };
}

function buildOperatingUnitCurrentAccountDirectionKey(operatingUnitId, partnerOperatingUnitId) {
  return `${parsePositiveInt(operatingUnitId) || 0}:${parsePositiveInt(partnerOperatingUnitId) || 0}`;
}

function describeOperatingUnitLabel(row) {
  const code = String(row?.code || row?.operatingUnitCode || "").trim();
  const name = String(row?.name || row?.operatingUnitName || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || `#${parsePositiveInt(row?.id) || "?"}`;
}

async function loadLegalEntityMetadataRows({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  if (!Array.isArray(legalEntityIds) || legalEntityIds.length === 0) {
    return [];
  }

  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT id, code, name
     FROM legal_entities
     WHERE tenant_id = ?
       AND id IN (${placeholders})
     ORDER BY id`,
    [tenantId, ...legalEntityIds]
  );
  return result.rows || [];
}

async function loadOperatingUnitCurrentAccountConfigRowsForReadiness({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  if (!Array.isArray(legalEntityIds) || legalEntityIds.length === 0) {
    return [];
  }

  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       cfg.id AS operating_unit_current_account_config_id,
       cfg.tenant_id,
       cfg.legal_entity_id,
       cfg.due_from_parent_account_id,
       cfg.due_to_parent_account_id,
       cfg.auto_provision_on_operating_unit_create,
       cfg.last_applied_at,
       cfg.created_at,
       cfg.updated_at
     FROM operating_unit_current_account_configs cfg
     WHERE cfg.tenant_id = ?
       AND cfg.legal_entity_id IN (${placeholders})
     ORDER BY cfg.legal_entity_id`,
    [tenantId, ...legalEntityIds]
  );
  return result.rows || [];
}

async function loadOperatingUnitCentralReadinessRows({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  if (!Array.isArray(legalEntityIds) || legalEntityIds.length === 0) {
    return [];
  }

  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       ou.id,
       ou.legal_entity_id,
       ou.code,
       ou.name,
       ou.status,
       CASE
         WHEN ou.central_due_from_account_id IS NOT NULL
           AND ou.central_due_to_account_id IS NOT NULL
           AND ou.ou_due_from_central_account_id IS NOT NULL
           AND ou.ou_due_to_central_account_id IS NOT NULL
           AND cdfa.id IS NOT NULL
           AND cdta.id IS NOT NULL
           AND odfa.id IS NOT NULL
           AND odtq.id IS NOT NULL
           AND cdfc.scope = 'LEGAL_ENTITY'
           AND cdtc.scope = 'LEGAL_ENTITY'
           AND odfc.scope = 'LEGAL_ENTITY'
           AND odtqc.scope = 'LEGAL_ENTITY'
           AND cdfc.legal_entity_id = ou.legal_entity_id
           AND cdtc.legal_entity_id = ou.legal_entity_id
           AND odfc.legal_entity_id = ou.legal_entity_id
           AND odtqc.legal_entity_id = ou.legal_entity_id
           AND cdfa.is_active = TRUE
           AND cdta.is_active = TRUE
           AND odfa.is_active = TRUE
           AND odtq.is_active = TRUE
           AND cdfa.allow_posting = TRUE
           AND cdta.allow_posting = TRUE
           AND odfa.allow_posting = TRUE
           AND odtq.allow_posting = TRUE
           AND cdfa.account_type = 'ASSET'
           AND cdta.account_type = 'LIABILITY'
           AND odfa.account_type = 'ASSET'
           AND odtq.account_type = 'LIABILITY'
           AND cdfa.normal_side = 'DEBIT'
           AND cdta.normal_side = 'CREDIT'
           AND odfa.normal_side = 'DEBIT'
           AND odtq.normal_side = 'CREDIT'
           AND NOT EXISTS (
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = cdfa.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = cdta.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = odfa.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = odtq.id
           )
         THEN TRUE
         ELSE FALSE
       END AS cross_context_self_balancing_ready
     FROM operating_units ou
     LEFT JOIN accounts cdfa ON cdfa.id = ou.central_due_from_account_id
     LEFT JOIN charts_of_accounts cdfc ON cdfc.id = cdfa.coa_id
     LEFT JOIN accounts cdta ON cdta.id = ou.central_due_to_account_id
     LEFT JOIN charts_of_accounts cdtc ON cdtc.id = cdta.coa_id
     LEFT JOIN accounts odfa ON odfa.id = ou.ou_due_from_central_account_id
     LEFT JOIN charts_of_accounts odfc ON odfc.id = odfa.coa_id
     LEFT JOIN accounts odtq ON odtq.id = ou.ou_due_to_central_account_id
     LEFT JOIN charts_of_accounts odtqc ON odtqc.id = odtq.coa_id
     WHERE ou.tenant_id = ?
       AND ou.legal_entity_id IN (${placeholders})
     ORDER BY ou.legal_entity_id, ou.id`,
    [tenantId, ...legalEntityIds]
  );
  return result.rows || [];
}

async function loadOperatingUnitPartnerReadinessRows({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  if (!Array.isArray(legalEntityIds) || legalEntityIds.length === 0) {
    return [];
  }

  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       map.legal_entity_id,
       map.operating_unit_id,
       map.partner_operating_unit_id,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       partner.code AS partner_operating_unit_code,
       partner.name AS partner_operating_unit_name,
       CASE
         WHEN map.due_from_account_id IS NOT NULL
           AND map.due_to_account_id IS NOT NULL
           AND dfa.id IS NOT NULL
           AND dta.id IS NOT NULL
           AND dfc.scope = 'LEGAL_ENTITY'
           AND dtc.scope = 'LEGAL_ENTITY'
           AND dfc.legal_entity_id = map.legal_entity_id
           AND dtc.legal_entity_id = map.legal_entity_id
           AND dfa.is_active = TRUE
           AND dta.is_active = TRUE
           AND dfa.allow_posting = TRUE
           AND dta.allow_posting = TRUE
           AND dfa.account_type = 'ASSET'
           AND dta.account_type = 'LIABILITY'
           AND dfa.normal_side = 'DEBIT'
           AND dta.normal_side = 'CREDIT'
           AND NOT EXISTS (
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = dfa.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM accounts child
             WHERE child.parent_account_id = dta.id
           )
         THEN TRUE
         ELSE FALSE
       END AS mapping_ready
     FROM operating_unit_partner_current_accounts map
     JOIN operating_units ou
       ON ou.id = map.operating_unit_id
     JOIN operating_units partner
       ON partner.id = map.partner_operating_unit_id
     LEFT JOIN accounts dfa
       ON dfa.id = map.due_from_account_id
     LEFT JOIN charts_of_accounts dfc
       ON dfc.id = dfa.coa_id
     LEFT JOIN accounts dta
       ON dta.id = map.due_to_account_id
     LEFT JOIN charts_of_accounts dtc
       ON dtc.id = dta.coa_id
     WHERE map.tenant_id = ?
       AND map.legal_entity_id IN (${placeholders})
     ORDER BY map.legal_entity_id, map.operating_unit_id, map.partner_operating_unit_id`,
    [tenantId, ...legalEntityIds]
  );
  return result.rows || [];
}

function buildOperatingUnitCurrentAccountReadinessRow({
  legalEntity,
  operatingUnitRows,
  configRow,
  partnerRows,
}) {
  const legalEntityId = parsePositiveInt(legalEntity?.id);
  const eligibility = summarizeOperatingUnitCurrentAccountEligibility(operatingUnitRows);
  const applicable = Boolean(eligibility?.currentAccountSetupRecommended);
  const eligibleOperatingUnits = (Array.isArray(operatingUnitRows) ? operatingUnitRows : []).filter(
    (row) => isEligibleDraftOperatingUnit(row)
  );
  const eligibleOperatingUnitIds = new Set(
    eligibleOperatingUnits.map((row) => parsePositiveInt(row?.id)).filter(Boolean)
  );

  const centralMissingRows = operatingUnitRows.filter(
    (row) =>
      eligibleOperatingUnitIds.has(parsePositiveInt(row?.id)) &&
      !toDbBoolean(row?.cross_context_self_balancing_ready)
  );

  const partnerRowByDirection = new Map();
  for (const row of partnerRows) {
    const directionKey = buildOperatingUnitCurrentAccountDirectionKey(
      row?.operating_unit_id,
      row?.partner_operating_unit_id
    );
    if (!partnerRowByDirection.has(directionKey)) {
      partnerRowByDirection.set(directionKey, row);
    }
  }

  const missingPartnerDirections = [];
  for (const sourceRow of eligibleOperatingUnits) {
    const sourceId = parsePositiveInt(sourceRow?.id);
    if (!sourceId) {
      continue;
    }
    for (const targetRow of eligibleOperatingUnits) {
      const targetId = parsePositiveInt(targetRow?.id);
      if (!targetId || targetId === sourceId) {
        continue;
      }
      const mappedRow = partnerRowByDirection.get(
        buildOperatingUnitCurrentAccountDirectionKey(sourceId, targetId)
      );
      if (mappedRow && toDbBoolean(mappedRow.mapping_ready)) {
        continue;
      }
      missingPartnerDirections.push({
        operatingUnitId: sourceId,
        operatingUnitCode: String(sourceRow?.code || "").trim(),
        operatingUnitName: String(sourceRow?.name || "").trim(),
        partnerOperatingUnitId: targetId,
        partnerOperatingUnitCode: String(targetRow?.code || "").trim(),
        partnerOperatingUnitName: String(targetRow?.name || "").trim(),
      });
    }
  }

  const configPresent = Boolean(
    parsePositiveInt(configRow?.operating_unit_current_account_config_id)
  );
  const configApplied = Boolean(String(configRow?.last_applied_at || "").trim());
  const configUpdatedAt = configRow?.updated_at ? new Date(configRow.updated_at) : null;
  const lastAppliedAt = configRow?.last_applied_at ? new Date(configRow.last_applied_at) : null;
  const configChangedSinceLastApply =
    configPresent &&
    Boolean(
      configUpdatedAt &&
        !Number.isNaN(configUpdatedAt.getTime()) &&
        (!lastAppliedAt ||
          Number.isNaN(lastAppliedAt.getTime()) ||
          configUpdatedAt > lastAppliedAt)
    );

  let ready = true;
  let blockerCode = "READY";
  if (!applicable) {
    blockerCode = "NOT_APPLICABLE";
  } else if (!configPresent) {
    ready = false;
    blockerCode = "MISSING_CONFIG";
  } else if (centralMissingRows.length > 0 || missingPartnerDirections.length > 0) {
    ready = false;
    blockerCode = configApplied ? "MAPPING_DRIFT" : "CONFIG_SAVED_NOT_APPLIED";
  }

  return {
    legalEntityId,
    legalEntityCode: String(legalEntity?.code || "").trim(),
    legalEntityName: String(legalEntity?.name || "").trim(),
    ready,
    applicable,
    blockerCode,
    setupPath: OU_CURRENT_ACCOUNT_SETUP_PATH,
    effectiveActiveOperatingUnitCount:
      parsePositiveInt(eligibility?.effectiveActiveOperatingUnitCount) || 0,
    currentAccountSetupRecommended: Boolean(eligibility?.currentAccountSetupRecommended),
    recommendationCode: String(eligibility?.recommendationCode || "").trim() || null,
    configPresent,
    configApplied,
    autoProvisionOnOperatingUnitCreate: toDbBoolean(
      configRow?.auto_provision_on_operating_unit_create
    ),
    lastAppliedAt: configRow?.last_applied_at || null,
    configChangedSinceLastApply,
    eligibleOperatingUnits: eligibleOperatingUnits.map((row) => ({
      id: parsePositiveInt(row?.id),
      code: String(row?.code || "").trim(),
      name: String(row?.name || "").trim(),
      label: describeOperatingUnitLabel(row),
    })),
    missingCentralOperatingUnits: centralMissingRows.map((row) => ({
      id: parsePositiveInt(row?.id),
      code: String(row?.code || "").trim(),
      name: String(row?.name || "").trim(),
      label: describeOperatingUnitLabel(row),
    })),
    expectedPartnerDirectionCount: applicable
      ? eligibleOperatingUnits.length * Math.max(eligibleOperatingUnits.length - 1, 0)
      : 0,
    missingPartnerDirectionCount: missingPartnerDirections.length,
    missingPartnerDirections,
  };
}

async function resolveTargetLegalEntityIds({
  tenantId,
  legalEntityId = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  if (normalizedLegalEntityId) {
    return [normalizedLegalEntityId];
  }

  const result = await runQuery(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
     ORDER BY id`,
    [normalizedTenantId]
  );
  return (result.rows || [])
    .map((row) => parsePositiveInt(row.id))
    .filter(Boolean);
}

async function loadPurposeMappingsByLegalEntity({
  tenantId,
  legalEntityIds,
  requiredPurposeCodes,
  runQuery = query,
}) {
  if (!Array.isArray(legalEntityIds) || legalEntityIds.length === 0) {
    return new Map();
  }
  if (!Array.isArray(requiredPurposeCodes) || requiredPurposeCodes.length === 0) {
    return new Map();
  }

  const legalEntityPlaceholders = legalEntityIds.map(() => "?").join(", ");
  const purposePlaceholders = requiredPurposeCodes.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       jpa.legal_entity_id,
       jpa.purpose_code,
       jpa.account_id AS mapped_account_id,
       a.id AS account_id,
       a.code AS account_code,
       a.account_type,
       a.normal_side,
       a.allow_posting,
       a.is_active,
       c.tenant_id AS account_tenant_id,
       c.scope AS coa_scope,
       c.legal_entity_id AS coa_legal_entity_id
     FROM journal_purpose_accounts jpa
     LEFT JOIN accounts a ON a.id = jpa.account_id
     LEFT JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE jpa.tenant_id = ?
       AND jpa.legal_entity_id IN (${legalEntityPlaceholders})
       AND jpa.purpose_code IN (${purposePlaceholders})`,
    [tenantId, ...legalEntityIds, ...requiredPurposeCodes]
  );

  const byLegalEntity = new Map();
  for (const row of result.rows || []) {
    const entityId = parsePositiveInt(row.legal_entity_id);
    const purposeCode = toUpper(row.purpose_code);
    if (!entityId || !purposeCode) {
      continue;
    }
    if (!byLegalEntity.has(entityId)) {
      byLegalEntity.set(entityId, new Map());
    }
    byLegalEntity.get(entityId).set(purposeCode, row);
  }

  return byLegalEntity;
}

function evaluateCommonMappingValidity({
  tenantId,
  legalEntityId,
  row,
}) {
  const invalids = [];
  const mappedAccountId = parsePositiveInt(row?.mapped_account_id);
  const accountId = parsePositiveInt(row?.account_id) || mappedAccountId || null;
  const accountCode = String(row?.account_code || "");
  const accountExists = parsePositiveInt(row?.account_id);

  if (!mappedAccountId) {
    invalids.push({
      reason: "MAPPED_ACCOUNT_ID_INVALID",
      accountId,
      accountCode,
    });
    return invalids;
  }
  if (!accountExists) {
    invalids.push({
      reason: "ACCOUNT_NOT_FOUND",
      accountId,
      accountCode,
    });
    return invalids;
  }

  if (parsePositiveInt(row?.account_tenant_id) !== parsePositiveInt(tenantId)) {
    invalids.push({
      reason: "ACCOUNT_TENANT_MISMATCH",
      accountId,
      accountCode,
    });
  }

  if (toUpper(row?.coa_scope) !== "LEGAL_ENTITY") {
    invalids.push({
      reason: "ACCOUNT_SCOPE_NOT_LEGAL_ENTITY",
      accountId,
      accountCode,
    });
  }

  if (parsePositiveInt(row?.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    invalids.push({
      reason: "ACCOUNT_LEGAL_ENTITY_MISMATCH",
      accountId,
      accountCode,
      details: {
        expectedLegalEntityId: parsePositiveInt(legalEntityId),
        actualLegalEntityId: parsePositiveInt(row?.coa_legal_entity_id) || null,
      },
    });
  }

  if (!toDbBoolean(row?.is_active)) {
    invalids.push({
      reason: "ACCOUNT_INACTIVE",
      accountId,
      accountCode,
    });
  }

  return invalids;
}

function evaluateCariPurposeRow({
  tenantId,
  legalEntityId,
  purposeCode,
  row,
}) {
  const invalids = evaluateCommonMappingValidity({
    tenantId,
    legalEntityId,
    row,
  }).map((invalid) => ({
    purposeCode,
    ...invalid,
  }));

  const accountExists = parsePositiveInt(row?.account_id);
  const accountId = accountExists || parsePositiveInt(row?.mapped_account_id);
  const accountCode = String(row?.account_code || "");
  if (accountExists && !toDbBoolean(row?.allow_posting)) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_NOT_POSTABLE",
      accountId: accountId || null,
      accountCode: accountCode || null,
    });
  }

  const expectedAccountType = CARI_EXPECTED_ACCOUNT_TYPE[purposeCode];
  if (accountExists && expectedAccountType && toUpper(row?.account_type) !== expectedAccountType) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_TYPE_MISMATCH",
      accountId: accountId || null,
      accountCode: accountCode || null,
      details: {
        expectedAccountType,
        actualAccountType: toUpper(row?.account_type) || null,
      },
    });
  }

  const expectedNormalSide = CARI_EXPECTED_NORMAL_SIDE[purposeCode];
  if (accountExists && expectedNormalSide && toUpper(row?.normal_side) !== expectedNormalSide) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_NORMAL_SIDE_MISMATCH",
      accountId: accountId || null,
      accountCode: accountCode || null,
      details: {
        expectedNormalSide,
        actualNormalSide: toUpper(row?.normal_side) || null,
      },
    });
  }

  return invalids;
}

function evaluateShareholderPurposeRow({
  tenantId,
  legalEntityId,
  purposeCode,
  row,
}) {
  const invalids = evaluateCommonMappingValidity({
    tenantId,
    legalEntityId,
    row,
  }).map((invalid) => ({
    purposeCode,
    ...invalid,
  }));

  const accountExists = parsePositiveInt(row?.account_id);
  const accountId = accountExists || parsePositiveInt(row?.mapped_account_id);
  const accountCode = String(row?.account_code || "");
  if (!row) {
    return invalids;
  }
  if (!accountExists) {
    return invalids;
  }

  if (toUpper(row?.account_type) !== "EQUITY") {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_TYPE_NOT_EQUITY",
      accountId: accountId || null,
      accountCode: accountCode || null,
    });
  }

  if (toDbBoolean(row?.allow_posting)) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_MUST_BE_NON_POSTABLE",
      accountId: accountId || null,
      accountCode: accountCode || null,
    });
  }

  const expectedNormalSide = SHAREHOLDER_EXPECTED_NORMAL_SIDE[purposeCode];
  if (expectedNormalSide && toUpper(row?.normal_side) !== expectedNormalSide) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_NORMAL_SIDE_MISMATCH",
      accountId: accountId || null,
      accountCode: accountCode || null,
      details: {
        expectedNormalSide,
        actualNormalSide: toUpper(row?.normal_side) || null,
      },
    });
  }

  return invalids;
}

function evaluateCashClearingPurposeRow({
  tenantId,
  legalEntityId,
  purposeCode,
  row,
}) {
  const invalids = evaluateCommonMappingValidity({
    tenantId,
    legalEntityId,
    row,
  }).map((invalid) => ({
    purposeCode,
    ...invalid,
  }));

  const accountExists = parsePositiveInt(row?.account_id);
  const accountId = accountExists || parsePositiveInt(row?.mapped_account_id);
  const accountCode = String(row?.account_code || "");
  if (!row || !accountExists) {
    return invalids;
  }

  if (!toDbBoolean(row?.allow_posting)) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_NOT_POSTABLE",
      accountId: accountId || null,
      accountCode: accountCode || null,
    });
  }

  const expectedAccountType = CASH_CLEARING_EXPECTED_ACCOUNT_TYPE[purposeCode];
  if (expectedAccountType && toUpper(row?.account_type) !== expectedAccountType) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_TYPE_MISMATCH",
      accountId: accountId || null,
      accountCode: accountCode || null,
      details: {
        expectedAccountType,
        actualAccountType: toUpper(row?.account_type) || null,
      },
    });
  }

  const expectedNormalSide = CASH_CLEARING_EXPECTED_NORMAL_SIDE[purposeCode];
  if (expectedNormalSide && toUpper(row?.normal_side) !== expectedNormalSide) {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_NORMAL_SIDE_MISMATCH",
      accountId: accountId || null,
      accountCode: accountCode || null,
      details: {
        expectedNormalSide,
        actualNormalSide: toUpper(row?.normal_side) || null,
      },
    });
  }

  return invalids;
}

function evaluateBankControlParentPurposeRow({
  tenantId,
  legalEntityId,
  purposeCode,
  row,
}) {
  const invalids = evaluateCommonMappingValidity({
    tenantId,
    legalEntityId,
    row,
  }).map((invalid) => ({
    purposeCode,
    ...invalid,
  }));

  const accountExists = parsePositiveInt(row?.account_id);
  const accountId = accountExists || parsePositiveInt(row?.mapped_account_id);
  const accountCode = String(row?.account_code || "");
  if (!row || !accountExists) {
    return invalids;
  }

  if (toUpper(row?.account_type) !== "ASSET") {
    invalids.push({
      purposeCode,
      reason: "ACCOUNT_TYPE_MISMATCH",
      accountId: accountId || null,
      accountCode: accountCode || null,
      details: {
        expectedAccountType: "ASSET",
        actualAccountType: toUpper(row?.account_type) || null,
      },
    });
  }

  return invalids;
}

function evaluateDistinctPurposePairs({
  purposeMap,
  distinctPairs,
}) {
  const invalids = [];
  for (const pair of distinctPairs) {
    const leftPurpose = toUpper(pair?.left);
    const rightPurpose = toUpper(pair?.right);
    if (!leftPurpose || !rightPurpose) {
      continue;
    }

    const left = purposeMap.get(leftPurpose);
    const right = purposeMap.get(rightPurpose);
    const leftAccountId = parsePositiveInt(left?.mapped_account_id);
    const rightAccountId = parsePositiveInt(right?.mapped_account_id);

    if (!leftAccountId || !rightAccountId) {
      continue;
    }
    if (leftAccountId !== rightAccountId) {
      continue;
    }

    invalids.push({
      purposeCode: leftPurpose,
      reason: "PURPOSES_MUST_MAP_TO_DIFFERENT_ACCOUNTS",
      accountId: leftAccountId,
      accountCode: String(left?.account_code || "") || null,
      details: {
        pairedPurposeCode: rightPurpose,
      },
    });
    invalids.push({
      purposeCode: rightPurpose,
      reason: "PURPOSES_MUST_MAP_TO_DIFFERENT_ACCOUNTS",
      accountId: rightAccountId,
      accountCode: String(right?.account_code || "") || null,
      details: {
        pairedPurposeCode: leftPurpose,
      },
    });
  }
  return invalids;
}

function buildModuleReadinessByLegalEntity({
  tenantId,
  legalEntityIds,
  requiredPurposeCodes,
  purposeMapByLegalEntity,
  distinctPairs,
  evaluatePurposeRow,
}) {
  const rows = [];

  for (const legalEntityId of legalEntityIds) {
    const purposeMap = purposeMapByLegalEntity.get(legalEntityId) || new Map();
    const missingPurposeCodes = [];
    const invalidMappings = [];

    for (const purposeCode of requiredPurposeCodes) {
      const row = purposeMap.get(purposeCode);
      if (!row) {
        missingPurposeCodes.push(purposeCode);
        continue;
      }

      const invalidRows = evaluatePurposeRow({
        tenantId,
        legalEntityId,
        purposeCode,
        row,
      });
      for (const invalid of invalidRows) {
        addInvalidMapping(invalidMappings, invalid);
      }
    }

    const distinctInvalids = evaluateDistinctPurposePairs({
      purposeMap,
      distinctPairs,
    });
    for (const invalid of distinctInvalids) {
      addInvalidMapping(invalidMappings, invalid);
    }

    rows.push(
      buildReadinessRow({
        legalEntityId,
        requiredPurposeCodes,
        missingPurposeCodes,
        invalidMappings,
      })
    );
  }

  return rows;
}

export async function getCariPostingReadiness(
  tenantId,
  legalEntityId = null,
  { runQuery = query } = {}
) {
  const legalEntityIds = await resolveTargetLegalEntityIds({
    tenantId,
    legalEntityId,
    runQuery,
  });

  for (const entityId of legalEntityIds) {
    // Self-heal stale mappings (e.g. parent account became non-postable after child creation).
    // eslint-disable-next-line no-await-in-loop
    await autoRemapCariPurposeMappingsForLegalEntity({
      tenantId,
      legalEntityId: entityId,
      runQuery,
    });
  }

  const purposeMapByLegalEntity = await loadPurposeMappingsByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: CARI_REQUIRED_PURPOSE_CODES,
    runQuery,
  });

  const byLegalEntity = buildModuleReadinessByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: CARI_REQUIRED_PURPOSE_CODES,
    purposeMapByLegalEntity,
    distinctPairs: CARI_DISTINCT_PAIRS,
    evaluatePurposeRow: evaluateCariPurposeRow,
  });

  return {
    moduleKey: "cariPosting",
    byLegalEntity,
  };
}

export async function getShareholderCommitmentReadiness(
  tenantId,
  legalEntityId = null,
  { runQuery = query } = {}
) {
  const legalEntityIds = await resolveTargetLegalEntityIds({
    tenantId,
    legalEntityId,
    runQuery,
  });
  const purposeMapByLegalEntity = await loadPurposeMappingsByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: SHAREHOLDER_REQUIRED_PURPOSE_CODES,
    runQuery,
  });

  const byLegalEntity = buildModuleReadinessByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: SHAREHOLDER_REQUIRED_PURPOSE_CODES,
    purposeMapByLegalEntity,
    distinctPairs: SHAREHOLDER_DISTINCT_PAIRS,
    evaluatePurposeRow: evaluateShareholderPurposeRow,
  });

  return {
    moduleKey: "shareholderCommitment",
    byLegalEntity,
  };
}

export async function getCashClearingReadiness(
  tenantId,
  legalEntityId = null,
  { runQuery = query } = {}
) {
  const legalEntityIds = await resolveTargetLegalEntityIds({
    tenantId,
    legalEntityId,
    runQuery,
  });
  const purposeMapByLegalEntity = await loadPurposeMappingsByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: CASH_CLEARING_REQUIRED_PURPOSE_CODES,
    runQuery,
  });

  const byLegalEntity = buildModuleReadinessByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: CASH_CLEARING_REQUIRED_PURPOSE_CODES,
    purposeMapByLegalEntity,
    distinctPairs: CASH_CLEARING_DISTINCT_PAIRS,
    evaluatePurposeRow: evaluateCashClearingPurposeRow,
  });

  return {
    moduleKey: "cashClearing",
    byLegalEntity,
  };
}

export async function getBankControlParentReadiness(
  tenantId,
  legalEntityId = null,
  { runQuery = query } = {}
) {
  const legalEntityIds = await resolveTargetLegalEntityIds({
    tenantId,
    legalEntityId,
    runQuery,
  });
  const purposeMapByLegalEntity = await loadPurposeMappingsByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: BANK_CONTROL_PARENT_REQUIRED_PURPOSE_CODES,
    runQuery,
  });

  const byLegalEntity = buildModuleReadinessByLegalEntity({
    tenantId,
    legalEntityIds,
    requiredPurposeCodes: BANK_CONTROL_PARENT_REQUIRED_PURPOSE_CODES,
    purposeMapByLegalEntity,
    distinctPairs: [],
    evaluatePurposeRow: evaluateBankControlParentPurposeRow,
  });

  return {
    moduleKey: "bankControlParent",
    byLegalEntity,
  };
}

export async function getOperatingUnitCurrentAccountReadiness(
  tenantId,
  legalEntityId = null,
  { runQuery = query } = {}
) {
  const legalEntityIds = await resolveTargetLegalEntityIds({
    tenantId,
    legalEntityId,
    runQuery,
  });
  const [legalEntityRows, operatingUnitRows, configRows, partnerRows] = await Promise.all([
    loadLegalEntityMetadataRows({
      tenantId,
      legalEntityIds,
      runQuery,
    }),
    loadOperatingUnitCentralReadinessRows({
      tenantId,
      legalEntityIds,
      runQuery,
    }),
    loadOperatingUnitCurrentAccountConfigRowsForReadiness({
      tenantId,
      legalEntityIds,
      runQuery,
    }),
    loadOperatingUnitPartnerReadinessRows({
      tenantId,
      legalEntityIds,
      runQuery,
    }),
  ]);

  const configRowByLegalEntityId = new Map(
    configRows.map((row) => [parsePositiveInt(row?.legal_entity_id), row])
  );
  const operatingUnitRowsByLegalEntityId = new Map();
  for (const row of operatingUnitRows) {
    const rowLegalEntityId = parsePositiveInt(row?.legal_entity_id);
    if (!rowLegalEntityId) {
      continue;
    }
    if (!operatingUnitRowsByLegalEntityId.has(rowLegalEntityId)) {
      operatingUnitRowsByLegalEntityId.set(rowLegalEntityId, []);
    }
    operatingUnitRowsByLegalEntityId.get(rowLegalEntityId).push(row);
  }
  const partnerRowsByLegalEntityId = new Map();
  for (const row of partnerRows) {
    const rowLegalEntityId = parsePositiveInt(row?.legal_entity_id);
    if (!rowLegalEntityId) {
      continue;
    }
    if (!partnerRowsByLegalEntityId.has(rowLegalEntityId)) {
      partnerRowsByLegalEntityId.set(rowLegalEntityId, []);
    }
    partnerRowsByLegalEntityId.get(rowLegalEntityId).push(row);
  }

  const byLegalEntity = legalEntityRows.map((legalEntityRow) =>
    buildOperatingUnitCurrentAccountReadinessRow({
      legalEntity: legalEntityRow,
      operatingUnitRows:
        operatingUnitRowsByLegalEntityId.get(parsePositiveInt(legalEntityRow?.id)) || [],
      configRow: configRowByLegalEntityId.get(parsePositiveInt(legalEntityRow?.id)) || null,
      partnerRows:
        partnerRowsByLegalEntityId.get(parsePositiveInt(legalEntityRow?.id)) || [],
    })
  );

  return {
    moduleKey: "operatingUnitCurrentAccounts",
    byLegalEntity,
  };
}

export async function getModuleReadiness(
  tenantId,
  legalEntityId = null,
  { runQuery = query } = {}
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const [
    cariPosting,
    shareholderCommitment,
    cashClearing,
    bankControlParent,
    operatingUnitCurrentAccounts,
    closeConsolidationWorkflow,
  ] =
    await Promise.all([
      getCariPostingReadiness(normalizedTenantId, normalizedLegalEntityId, {
        runQuery,
      }),
      getShareholderCommitmentReadiness(normalizedTenantId, normalizedLegalEntityId, {
        runQuery,
      }),
      getCashClearingReadiness(normalizedTenantId, normalizedLegalEntityId, {
        runQuery,
      }),
      getBankControlParentReadiness(normalizedTenantId, normalizedLegalEntityId, {
        runQuery,
      }),
      getOperatingUnitCurrentAccountReadiness(normalizedTenantId, normalizedLegalEntityId, {
        runQuery,
      }),
      getCloseConsolidationWorkflowReadiness(
        normalizedTenantId,
        normalizedLegalEntityId,
        {
          runQuery,
        }
      ),
    ]);

  return {
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId || null,
    modules: {
      cariPosting: {
        byLegalEntity: cariPosting.byLegalEntity,
      },
      shareholderCommitment: {
        byLegalEntity: shareholderCommitment.byLegalEntity,
      },
      cashClearing: {
        byLegalEntity: cashClearing.byLegalEntity,
      },
      bankControlParent: {
        byLegalEntity: bankControlParent.byLegalEntity,
      },
      operatingUnitCurrentAccounts: {
        byLegalEntity: operatingUnitCurrentAccounts.byLegalEntity,
      },
      closeConsolidationWorkflow: {
        byLegalEntity: closeConsolidationWorkflow.byLegalEntity,
      },
    },
  };
}
