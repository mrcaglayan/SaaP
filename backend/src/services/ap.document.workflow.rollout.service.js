import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
} from "../../../shared/cariDocumentWorkflowGovernance.js";
import { ensureUnifiedWorkflowPolicyForDefinition } from "./workflows.service.js";

export const DEFAULT_AP_WORKFLOW_DEFINITION_CODE = "WF_STD_AP_COUNTRY_POSTING_V1";
export const DEFAULT_AP_WORKFLOW_DEFINITION_NAME =
  "Standard AP Country Approval Gate";

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

function mapDefinitionRow(row) {
  return row
    ? {
        exists: true,
        definitionId: parsePositiveInt(row.id),
        code: String(row.code || "").trim(),
        name: String(row.name || "").trim(),
        processType: String(row.process_type || "").trim().toUpperCase(),
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

async function runWithManagedTransaction(runQuery, work) {
  if (runQuery === query) {
    return withTransaction(async (tx) => work(tx.query));
  }
  return work(runQuery);
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

/**
 * Upserts the default country-scoped AP workflow definition for one tenant
 * without creating assignments.
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
      // requiredPermissionCode is null for AP steps.
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
 * Returns AP workflow rollout state for one tenant: the seeded default country
 * template and legal-entity coverage across explicit AP workflow assignments.
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
  const [defaultDefinitionRow, coverage] = await Promise.all([
    loadDefaultDefinitionRow({ tenantId: normalizedTenantId, runQuery }),
    evaluateApWorkflowLegalEntityCoverage({
      tenantId: normalizedTenantId,
      effectiveOn: asOfDate,
      runQuery,
    }),
  ]);
  return {
    tenantId: normalizedTenantId,
    effectiveOn: asOfDate,
    defaultDefinition: mapDefinitionRow(defaultDefinitionRow),
    coverage,
  };
}
