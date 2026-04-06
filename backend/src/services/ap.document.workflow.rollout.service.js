import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
  AP_WORKFLOW_COMPAT_MODE,
  FEATURE_AP_DOCUMENT_WORKFLOW_V1,
} from "../../../shared/cariDocumentWorkflowGovernance.js";
import { normalizeFeatureCode } from "./features.catalog.js";
import { ensureUnifiedWorkflowPolicyForDefinition } from "./workflows.service.js";

export const DEFAULT_AP_WORKFLOW_DEFINITION_CODE = "WF_STD_AP_COUNTRY_POSTING_V1";
export const DEFAULT_AP_WORKFLOW_DEFINITION_NAME =
  "Standard AP Country Approval Gate";
export const AP_WORKFLOW_ROLLOUT_PHASES = Object.freeze([
  "PILOT",
  "STRICT",
  "ROLLBACK",
]);

const DEFAULT_AP_WORKFLOW_STEPS = Object.freeze([
  Object.freeze({
    stepNo: 1,
    stageScopeType: "COUNTRY",
    requiredPermissionCode: null,
    minApproverCount: 1,
    allowSelfApprove: false,
    escalationAfterHours: null,
  }),
]);

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDateOnly(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return new Date().toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  throw badRequest("effectiveOn must use YYYY-MM-DD format");
}

function normalizeRolloutPhase(value) {
  const normalized = toUpper(value);
  if (!AP_WORKFLOW_ROLLOUT_PHASES.includes(normalized)) {
    throw badRequest(
      `phase must be one of: ${AP_WORKFLOW_ROLLOUT_PHASES.join(", ")}`
    );
  }
  return normalized;
}

function conflictError(message, details = null) {
  const err = new Error(message);
  err.status = 409;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  return err;
}

function mapFeatureRows(rows = []) {
  const featureMap = {
    [FEATURE_AP_DOCUMENT_WORKFLOW_V1]: false,
    [AP_WORKFLOW_COMPAT_MODE]: false,
  };
  for (const row of rows) {
    const featureCode = normalizeFeatureCode(row?.feature_code);
    if (!Object.prototype.hasOwnProperty.call(featureMap, featureCode)) {
      continue;
    }
    featureMap[featureCode] = Number(row?.is_enabled) === 1;
  }
  return {
    featureEnabled: Boolean(featureMap[FEATURE_AP_DOCUMENT_WORKFLOW_V1]),
    compatModeEnabled: Boolean(featureMap[AP_WORKFLOW_COMPAT_MODE]),
    featureMap,
  };
}

function mapDefinitionRow(row) {
  return row
    ? {
        exists: true,
        definitionId: parsePositiveInt(row.id),
        code: String(row.code || "").trim(),
        name: String(row.name || "").trim(),
        processType: toUpper(row.process_type),
        isActive: Number(row.is_active) === 1 || row.is_active === true,
        versionNo: Number(row.version_no || 1) || 1,
        createdByUserId: parsePositiveInt(row.created_by_user_id),
      }
    : {
        exists: false,
        definitionId: null,
        code: DEFAULT_AP_WORKFLOW_DEFINITION_CODE,
        name: DEFAULT_AP_WORKFLOW_DEFINITION_NAME,
        processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
        isActive: false,
        versionNo: 1,
        createdByUserId: null,
      };
}

function mapAssignmentScopeType(row) {
  if (parsePositiveInt(row?.operating_unit_id)) {
    return "OPERATING_UNIT";
  }
  if (parsePositiveInt(row?.legal_entity_id)) {
    return "LEGAL_ENTITY";
  }
  if (parsePositiveInt(row?.country_id)) {
    return "COUNTRY";
  }
  if (parsePositiveInt(row?.group_company_id)) {
    return "GROUP";
  }
  return "TENANT";
}

function serializeRolloutConfig({
  phase,
  effectiveOn,
  note,
  defaultDefinitionId,
}) {
  return JSON.stringify({
    rollout: "ap_document_workflow_v1",
    phase,
    effectiveOn,
    note: String(note || "").trim() || null,
    defaultDefinitionId: parsePositiveInt(defaultDefinitionId),
    defaultDefinitionCode: DEFAULT_AP_WORKFLOW_DEFINITION_CODE,
  });
}

async function loadApFeatureRows({ tenantId, runQuery = query }) {
  const result = await runQuery(
    `SELECT feature_code, is_enabled
     FROM tenant_features
     WHERE tenant_id = ?
       AND feature_code IN (?, ?)`,
    [tenantId, FEATURE_AP_DOCUMENT_WORKFLOW_V1, AP_WORKFLOW_COMPAT_MODE]
  );
  return result.rows || [];
}

async function loadDefaultDefinitionRow({
  tenantId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        code,
        name,
        process_type,
        is_active,
        version_no,
        created_by_user_id
     FROM workflow_definitions
     WHERE tenant_id = ?
       AND code = ?
       AND version_no = 1
     LIMIT 1`,
    [tenantId, DEFAULT_AP_WORKFLOW_DEFINITION_CODE]
  );
  return result.rows?.[0] || null;
}

async function upsertTenantFeatureTx(runQuery, {
  tenantId,
  featureCode,
  isEnabled,
  updatedByUserId,
  configJson,
}) {
  await runQuery(
    `INSERT INTO tenant_features (
        tenant_id,
        feature_code,
        is_enabled,
        config_json,
        updated_by_user_id
     )
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_enabled = VALUES(is_enabled),
       config_json = VALUES(config_json),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      normalizeFeatureCode(featureCode),
      isEnabled ? 1 : 0,
      configJson,
      updatedByUserId,
    ]
  );
}

async function runWithManagedTransaction(runQuery, work) {
  if (runQuery === query) {
    return withTransaction(async (tx) => work(tx.query));
  }
  return work(runQuery);
}

/**
 * Upserts the default country-scoped AP workflow definition for one tenant
 * without creating assignments or enabling rollout flags.
 */
export async function ensureDefaultApWorkflowDefinition({
  tenantId,
  userId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedUserId) {
    throw badRequest("userId is required");
  }

  return runWithManagedTransaction(runQuery, async (txQuery) => {
    const existing = await loadDefaultDefinitionRow({
      tenantId: normalizedTenantId,
      runQuery: txQuery,
    });
    await txQuery(
      `INSERT INTO workflow_definitions (
          tenant_id,
          code,
          name,
          process_type,
          is_active,
          version_no,
          created_by_user_id
       )
       VALUES (?, ?, ?, ?, TRUE, 1, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         process_type = VALUES(process_type),
         is_active = VALUES(is_active),
         updated_at = CURRENT_TIMESTAMP`,
      [
        normalizedTenantId,
        DEFAULT_AP_WORKFLOW_DEFINITION_CODE,
        DEFAULT_AP_WORKFLOW_DEFINITION_NAME,
        AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
        normalizedUserId,
      ]
    );

    const definition = await loadDefaultDefinitionRow({
      tenantId: normalizedTenantId,
      runQuery: txQuery,
    });
    const definitionId = parsePositiveInt(definition?.id);
    if (!definitionId) {
      throw new Error("Failed to resolve default AP workflow definition id");
    }

    await txQuery(
      `DELETE FROM workflow_definition_steps
       WHERE workflow_definition_id = ?`,
      [definitionId]
    );
    for (const step of DEFAULT_AP_WORKFLOW_STEPS) {
      // Country-scoped AP reviewer authority comes from step assignment only.
      // PR-3 locked requiredPermissionCode to null for AP steps.
      // eslint-disable-next-line no-await-in-loop
      await txQuery(
        `INSERT INTO workflow_definition_steps (
            workflow_definition_id,
            step_no,
            stage_scope_type,
            required_permission_code,
            min_approver_count,
            allow_self_approve,
            escalation_after_hours
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          definitionId,
          step.stepNo,
          step.stageScopeType,
          null,
          step.minApproverCount,
          step.allowSelfApprove ? 1 : 0,
          step.escalationAfterHours,
        ]
      );
    }

    await ensureUnifiedWorkflowPolicyForDefinition({
      tenantId: normalizedTenantId,
      definitionId,
      runQuery: txQuery,
    });

    return {
      ...mapDefinitionRow(definition),
      created: !existing,
      stepScopeTypes: DEFAULT_AP_WORKFLOW_STEPS.map((step) => step.stageScopeType),
      stepCount: DEFAULT_AP_WORKFLOW_STEPS.length,
    };
  });
}

/**
 * Evaluates whether active legal entities resolve an explicit AP workflow
 * assignment through tenant/group/country/legal-entity fallback. Operating-unit
 * assignments are reported but excluded from this baseline rollout coverage.
 */
export async function evaluateApWorkflowLegalEntityCoverage({
  tenantId,
  effectiveOn,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  const asOfDate = normalizeDateOnly(effectiveOn);

  const legalEntityResult = await runQuery(
    `SELECT
        id,
        code,
        name,
        group_company_id,
        country_id,
        status
     FROM legal_entities
     WHERE tenant_id = ?
       AND status = 'ACTIVE'
     ORDER BY id ASC`,
    [normalizedTenantId]
  );
  const assignmentResult = await runQuery(
    `SELECT
        id,
        workflow_definition_id,
        group_company_id,
        country_id,
        legal_entity_id,
        operating_unit_id,
        effective_from,
        effective_to,
        status
     FROM workflow_assignments
     WHERE tenant_id = ?
       AND process_type = ?
       AND status = 'ACTIVE'
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY
       CASE
         WHEN operating_unit_id IS NOT NULL THEN 1
         WHEN legal_entity_id IS NOT NULL THEN 2
         WHEN country_id IS NOT NULL THEN 3
         WHEN group_company_id IS NOT NULL THEN 4
         ELSE 5
       END ASC,
       effective_from DESC,
       id DESC`,
    [
      normalizedTenantId,
      AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      asOfDate,
      asOfDate,
    ]
  );

  const assignments = assignmentResult.rows || [];
  const scopeCounts = {
    TENANT: 0,
    GROUP: 0,
    COUNTRY: 0,
    LEGAL_ENTITY: 0,
    OPERATING_UNIT: 0,
  };
  for (const assignment of assignments) {
    scopeCounts[mapAssignmentScopeType(assignment)] += 1;
  }

  const rows = (legalEntityResult.rows || []).map((legalEntityRow) => {
    const legalEntityId = parsePositiveInt(legalEntityRow.id);
    const groupCompanyId = parsePositiveInt(legalEntityRow.group_company_id);
    const countryId = parsePositiveInt(legalEntityRow.country_id);

    let resolvedAssignment = null;
    for (const assignment of assignments) {
      if (parsePositiveInt(assignment.operating_unit_id)) {
        continue;
      }
      if (parsePositiveInt(assignment.legal_entity_id) === legalEntityId) {
        resolvedAssignment = assignment;
        break;
      }
      if (
        !parsePositiveInt(assignment.legal_entity_id) &&
        parsePositiveInt(assignment.country_id) &&
        parsePositiveInt(assignment.country_id) === countryId
      ) {
        resolvedAssignment = assignment;
        break;
      }
      if (
        !parsePositiveInt(assignment.legal_entity_id) &&
        !parsePositiveInt(assignment.country_id) &&
        parsePositiveInt(assignment.group_company_id) &&
        parsePositiveInt(assignment.group_company_id) === groupCompanyId
      ) {
        resolvedAssignment = assignment;
        break;
      }
      if (
        !parsePositiveInt(assignment.legal_entity_id) &&
        !parsePositiveInt(assignment.country_id) &&
        !parsePositiveInt(assignment.group_company_id) &&
        !parsePositiveInt(assignment.operating_unit_id)
      ) {
        resolvedAssignment = assignment;
        break;
      }
    }

    return {
      legalEntityId,
      legalEntityCode: String(legalEntityRow.code || "").trim() || null,
      legalEntityName: String(legalEntityRow.name || "").trim() || null,
      groupCompanyId,
      countryId,
      covered: Boolean(resolvedAssignment),
      resolvedAssignmentId: parsePositiveInt(resolvedAssignment?.id),
      resolvedWorkflowDefinitionId: parsePositiveInt(
        resolvedAssignment?.workflow_definition_id
      ),
      resolvedScopeType: resolvedAssignment
        ? mapAssignmentScopeType(resolvedAssignment)
        : null,
    };
  });

  const coveredCount = rows.filter((row) => row.covered).length;
  return {
    effectiveOn: asOfDate,
    totalLegalEntities: rows.length,
    coveredCount,
    uncoveredCount: rows.length - coveredCount,
    activeAssignmentCount: assignments.length,
    ignoredOperatingUnitAssignmentCount: scopeCounts.OPERATING_UNIT,
    scopeCounts,
    rows,
  };
}

/**
 * Returns AP workflow rollout state for one tenant: the two feature flags, the
 * seeded default country template, and legal-entity coverage across explicit
 * AP workflow assignments.
 */
export async function getApWorkflowRolloutState({
  tenantId,
  effectiveOn,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  const asOfDate = normalizeDateOnly(effectiveOn);
  const [featureRows, defaultDefinitionRow, coverage] = await Promise.all([
    loadApFeatureRows({ tenantId: normalizedTenantId, runQuery }),
    loadDefaultDefinitionRow({ tenantId: normalizedTenantId, runQuery }),
    evaluateApWorkflowLegalEntityCoverage({
      tenantId: normalizedTenantId,
      effectiveOn: asOfDate,
      runQuery,
    }),
  ]);
  const features = mapFeatureRows(featureRows);
  return {
    tenantId: normalizedTenantId,
    effectiveOn: asOfDate,
    featureEnabled: features.featureEnabled,
    compatModeEnabled: features.compatModeEnabled,
    defaultDefinition: mapDefinitionRow(defaultDefinitionRow),
    coverage,
  };
}

/**
 * Applies one explicit AP workflow rollout phase for a tenant. The operation
 * only toggles feature flags and seeds the default definition; assignments stay
 * explicit and must be created separately by setup teams.
 */
export async function setApWorkflowRolloutPhase({
  tenantId,
  updatedByUserId,
  phase,
  effectiveOn,
  note = "",
  force = false,
  ensureDefaultDefinition = true,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedUserId = parsePositiveInt(updatedByUserId);
  const normalizedPhase = normalizeRolloutPhase(phase);
  const asOfDate = normalizeDateOnly(effectiveOn);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedUserId) {
    throw badRequest("updatedByUserId is required");
  }

  return runWithManagedTransaction(runQuery, async (txQuery) => {
    let defaultDefinition = null;
    if (ensureDefaultDefinition) {
      defaultDefinition = await ensureDefaultApWorkflowDefinition({
        tenantId: normalizedTenantId,
        userId: normalizedUserId,
        runQuery: txQuery,
      });
    }

    const stateBefore = await getApWorkflowRolloutState({
      tenantId: normalizedTenantId,
      effectiveOn: asOfDate,
      runQuery: txQuery,
    });
    if (
      normalizedPhase === "STRICT" &&
      stateBefore.coverage.uncoveredCount > 0 &&
      !force
    ) {
      throw conflictError(
        "Cannot disable AP workflow compat mode while active legal entities remain uncovered",
        {
          uncoveredLegalEntities: stateBefore.coverage.rows
            .filter((row) => !row.covered)
            .map((row) => ({
              legalEntityId: row.legalEntityId,
              legalEntityCode: row.legalEntityCode,
            })),
        }
      );
    }

    const targetFlags =
      normalizedPhase === "ROLLBACK"
        ? {
            [FEATURE_AP_DOCUMENT_WORKFLOW_V1]: false,
            [AP_WORKFLOW_COMPAT_MODE]: true,
          }
        : normalizedPhase === "STRICT"
          ? {
              [FEATURE_AP_DOCUMENT_WORKFLOW_V1]: true,
              [AP_WORKFLOW_COMPAT_MODE]: false,
            }
          : {
              [FEATURE_AP_DOCUMENT_WORKFLOW_V1]: true,
              [AP_WORKFLOW_COMPAT_MODE]: true,
            };

    const configJson = serializeRolloutConfig({
      phase: normalizedPhase,
      effectiveOn: asOfDate,
      note,
      defaultDefinitionId:
        parsePositiveInt(defaultDefinition?.definitionId) ||
        parsePositiveInt(stateBefore.defaultDefinition.definitionId),
    });

    for (const [featureCode, isEnabled] of Object.entries(targetFlags)) {
      // eslint-disable-next-line no-await-in-loop
      await upsertTenantFeatureTx(txQuery, {
        tenantId: normalizedTenantId,
        featureCode,
        isEnabled,
        updatedByUserId: normalizedUserId,
        configJson,
      });
    }

    const stateAfter = await getApWorkflowRolloutState({
      tenantId: normalizedTenantId,
      effectiveOn: asOfDate,
      runQuery: txQuery,
    });
    return {
      tenantId: normalizedTenantId,
      phase: normalizedPhase,
      force: Boolean(force),
      note: String(note || "").trim() || null,
      defaultDefinitionSeeded: Boolean(defaultDefinition),
      before: stateBefore,
      after: stateAfter,
    };
  });
}
