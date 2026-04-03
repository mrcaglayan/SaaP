import { query, withTransaction } from "../db.js";
import { invalidateRbacCache } from "../middleware/rbac.js";

const MISSING_TABLE_ERRNOS = new Set([1146]);

export const ROLE_MIGRATION_MAPPING_VERSION = "pr4c-v1";

const LEGACY_ROLE_MIGRATION_RULES = Object.freeze({
  TenantAdmin: Object.freeze({
    targetRoleCodes: Object.freeze(["SecurityAdmin", "SystemAdmin"]),
    notes: Object.freeze([
      "TenantAdmin is split into SecurityAdmin and SystemAdmin.",
      "The legacy admin role remains recoverable through rollback only after execution.",
    ]),
  }),
  GroupController: Object.freeze({
    targetRoleCodes: Object.freeze(["GroupReportingController"]),
    notes: Object.freeze([
      "GroupController is narrowed to GroupReportingController in the composable model.",
      "Review whether any legacy master-data or close-review responsibilities need separate reassignment after migration.",
    ]),
  }),
  CountryController: Object.freeze({
    targetRoleCodes: Object.freeze([
      "GLOperator",
      "GLPostingAuthority",
      "TreasuryApprover",
      "PayrollApprover",
      "LocalCloseReviewer",
    ]),
    notes: Object.freeze([
      "CountryController maps to bounded review/approval roles at the same scope.",
      "Master-data stewardship is intentionally not auto-granted here.",
    ]),
  }),
  EntityAccountant: Object.freeze({
    targetRoleCodes: Object.freeze([
      "GLOperator",
      "TreasuryOperator",
      "PayrollOperator",
      "LocalClosePreparer",
    ]),
    notes: Object.freeze([
      "EntityAccountant maps to operator/preparer roles at the same scope.",
      "GLPostingAuthority is not auto-added; assign it only where manual posting is explicitly approved.",
    ]),
  }),
});

export const RETIRED_LEGACY_ROLE_CODES = Object.freeze(
  Object.keys(LEGACY_ROLE_MIGRATION_RULES)
);
const RETIRED_LEGACY_ROLE_CODE_SET = new Set(RETIRED_LEGACY_ROLE_CODES);
const TARGET_ROLE_CODES = Object.freeze(
  Array.from(
    new Set(
      RETIRED_LEGACY_ROLE_CODES.flatMap(
        (roleCode) => LEGACY_ROLE_MIGRATION_RULES[roleCode].targetRoleCodes
      )
    )
  )
);

/**
 * Returns whether one role code belongs to the retired legacy role catalog
 * that now survives only for migration and rollback recoverability.
 */
export function isRetiredLegacyRoleCode(roleCode) {
  return RETIRED_LEGACY_ROLE_CODE_SET.has(String(roleCode || "").trim());
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDateOnly(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const text = String(value);
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  if (match) {
    return match[0];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function sameDateOnly(left, right) {
  return toDateOnly(left) === toDateOnly(right);
}

function sameAssignmentWindow(existingAssignment, targetAssignment) {
  return (
    normalizeUpperText(existingAssignment?.effect) ===
      normalizeUpperText(targetAssignment?.effect) &&
    sameDateOnly(existingAssignment?.effective_from, targetAssignment?.effectiveFrom) &&
    sameDateOnly(existingAssignment?.effective_to, targetAssignment?.effectiveTo)
  );
}

function parseJsonMaybe(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function sortObjectKeys(input) {
  return Object.fromEntries(
    Object.entries(input || {}).sort(([leftKey], [rightKey]) =>
      String(leftKey).localeCompare(String(rightKey))
    )
  );
}

function summarizeScope(scopeType, scopeId, scopeMetaByKey) {
  const normalizedScopeType = normalizeUpperText(scopeType);
  const normalizedScopeId = parsePositiveInt(scopeId);
  const scopeKey = `${normalizedScopeType}:${normalizedScopeId || 0}`;
  const scopeMeta = scopeMetaByKey.get(scopeKey) || null;
  const label = scopeMeta?.label || `${normalizedScopeType}#${normalizedScopeId || "?"}`;
  return {
    scopeType: normalizedScopeType,
    scopeId: normalizedScopeId,
    label,
    code: scopeMeta?.code || null,
    name: scopeMeta?.name || null,
  };
}

async function safeQuery(runQuery, sql, params = [], fallbackRows = []) {
  try {
    return await runQuery(sql, params);
  } catch (err) {
    if (MISSING_TABLE_ERRNOS.has(Number(err?.errno))) {
      return { rows: fallbackRows };
    }
    throw err;
  }
}

async function loadRoleRowsByCode(tenantId, roleCodes, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRoleCodes = Array.from(
    new Set(
      (Array.isArray(roleCodes) ? roleCodes : [])
        .map((roleCode) => String(roleCode || "").trim())
        .filter(Boolean)
    )
  );
  if (!normalizedTenantId || normalizedRoleCodes.length === 0) {
    return new Map();
  }

  const result = await runQuery(
    `SELECT id, tenant_id, code, name, is_system
     FROM roles
     WHERE tenant_id = ?
       AND code IN (${normalizedRoleCodes.map(() => "?").join(", ")})
     ORDER BY code`,
    [normalizedTenantId, ...normalizedRoleCodes]
  );

  const roleRowsByCode = new Map();
  for (const row of result.rows || []) {
    roleRowsByCode.set(String(row.code || "").trim(), row);
  }
  return roleRowsByCode;
}

async function loadScopeMetaByKey(tenantId, sourceAssignments, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const scopeIdsByType = new Map();
  const scopeMetaByKey = new Map();

  for (const assignment of sourceAssignments || []) {
    const scopeType = normalizeUpperText(assignment.scope_type);
    const scopeId = parsePositiveInt(assignment.scope_id);
    if (!scopeType || !scopeId) {
      continue;
    }
    if (!scopeIdsByType.has(scopeType)) {
      scopeIdsByType.set(scopeType, new Set());
    }
    scopeIdsByType.get(scopeType).add(scopeId);
  }

  if (scopeIdsByType.has("TENANT")) {
    const tenantIds = Array.from(scopeIdsByType.get("TENANT"));
    const tenantResult = await runQuery(
      `SELECT id, code, name
       FROM tenants
       WHERE id IN (${tenantIds.map(() => "?").join(", ")})`,
      tenantIds
    );
    for (const row of tenantResult.rows || []) {
      scopeMetaByKey.set(`TENANT:${row.id}`, {
        code: row.code || null,
        name: row.name || null,
        label: [row.code, row.name].filter(Boolean).join(" - ") || `TENANT#${row.id}`,
      });
    }
  }

  if (scopeIdsByType.has("GROUP")) {
    const ids = Array.from(scopeIdsByType.get("GROUP"));
    const result = await runQuery(
      `SELECT id, code, name
       FROM group_companies
       WHERE tenant_id = ?
         AND id IN (${ids.map(() => "?").join(", ")})`,
      [normalizedTenantId, ...ids]
    );
    for (const row of result.rows || []) {
      scopeMetaByKey.set(`GROUP:${row.id}`, {
        code: row.code || null,
        name: row.name || null,
        label: [row.code, row.name].filter(Boolean).join(" - ") || `GROUP#${row.id}`,
      });
    }
  }

  if (scopeIdsByType.has("COUNTRY")) {
    const ids = Array.from(scopeIdsByType.get("COUNTRY"));
    const result = await runQuery(
      `SELECT id, iso2 AS code, name
       FROM countries
       WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids
    );
    for (const row of result.rows || []) {
      scopeMetaByKey.set(`COUNTRY:${row.id}`, {
        code: row.code || null,
        name: row.name || null,
        label: [row.code, row.name].filter(Boolean).join(" - ") || `COUNTRY#${row.id}`,
      });
    }
  }

  if (scopeIdsByType.has("LEGAL_ENTITY")) {
    const ids = Array.from(scopeIdsByType.get("LEGAL_ENTITY"));
    const result = await runQuery(
      `SELECT id, code, name
       FROM legal_entities
       WHERE tenant_id = ?
         AND id IN (${ids.map(() => "?").join(", ")})`,
      [normalizedTenantId, ...ids]
    );
    for (const row of result.rows || []) {
      scopeMetaByKey.set(`LEGAL_ENTITY:${row.id}`, {
        code: row.code || null,
        name: row.name || null,
        label:
          [row.code, row.name].filter(Boolean).join(" - ") || `LEGAL_ENTITY#${row.id}`,
      });
    }
  }

  if (scopeIdsByType.has("OPERATING_UNIT")) {
    const ids = Array.from(scopeIdsByType.get("OPERATING_UNIT"));
    const result = await runQuery(
      `SELECT id, code, name
       FROM operating_units
       WHERE tenant_id = ?
         AND id IN (${ids.map(() => "?").join(", ")})`,
      [normalizedTenantId, ...ids]
    );
    for (const row of result.rows || []) {
      scopeMetaByKey.set(`OPERATING_UNIT:${row.id}`, {
        code: row.code || null,
        name: row.name || null,
        label:
          [row.code, row.name].filter(Boolean).join(" - ") ||
          `OPERATING_UNIT#${row.id}`,
      });
    }
  }

  return scopeMetaByKey;
}

async function loadLegacySourceAssignments(
  tenantId,
  sourceRoleCodes = RETIRED_LEGACY_ROLE_CODES,
  runQuery = query
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedSourceRoleCodes = Array.from(
    new Set(
      (Array.isArray(sourceRoleCodes) ? sourceRoleCodes : [])
        .map((roleCode) => String(roleCode || "").trim())
        .filter(Boolean)
    )
  );
  if (!normalizedTenantId || normalizedSourceRoleCodes.length === 0) {
    return [];
  }

  const result = await runQuery(
    `SELECT
       urs.id,
       urs.user_id,
       u.email AS user_email,
       u.name AS user_name,
       urs.role_id,
       r.code AS role_code,
       r.name AS role_name,
       urs.scope_type,
       urs.scope_id,
       urs.effect,
       urs.effective_from,
       urs.effective_to,
       urs.created_at
     FROM user_role_scopes urs
     JOIN users u
       ON u.id = urs.user_id
      AND u.tenant_id = urs.tenant_id
     JOIN roles r
       ON r.id = urs.role_id
      AND r.tenant_id = urs.tenant_id
     WHERE urs.tenant_id = ?
       AND r.code IN (${normalizedSourceRoleCodes.map(() => "?").join(", ")})
     ORDER BY u.name, u.email, r.code, urs.scope_type, urs.scope_id, urs.id`,
    [normalizedTenantId, ...normalizedSourceRoleCodes]
  );

  return result.rows || [];
}

function buildPreviewItem({
  assignment,
  scopeMetaByKey,
  targetRoleRowsByCode,
}) {
  const sourceRoleCode = String(assignment.role_code || "").trim();
  const rule = LEGACY_ROLE_MIGRATION_RULES[sourceRoleCode] || null;
  const notes = [...(rule?.notes || [])];

  if (!rule) {
    return {
      previewStatus: "SKIPPED_UNMAPPED",
      notes: ["No migration rule is defined for this role assignment."],
      targetAssignments: [],
      summary: `${sourceRoleCode} has no configured migration target.`,
    };
  }

  const scope = summarizeScope(assignment.scope_type, assignment.scope_id, scopeMetaByKey);
  const targetAssignments = [];
  const missingTargetRoleCodes = [];
  for (const targetRoleCode of rule.targetRoleCodes) {
    const targetRole = targetRoleRowsByCode.get(targetRoleCode) || null;
    if (!targetRole) {
      missingTargetRoleCodes.push(targetRoleCode);
      continue;
    }

    targetAssignments.push({
      roleId: parsePositiveInt(targetRole.id),
      roleCode: targetRole.code,
      roleName: targetRole.name,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      effect: normalizeUpperText(assignment.effect) || "ALLOW",
      effectiveFrom: toDateOnly(assignment.effective_from),
      effectiveTo: toDateOnly(assignment.effective_to),
    });
  }

  let previewStatus = "READY";
  if (missingTargetRoleCodes.length > 0) {
    previewStatus = "REVIEW_REQUIRED";
    notes.push(
      `Missing target roles for this tenant: ${missingTargetRoleCodes.join(", ")}. Reseed before execution.`
    );
  }

  const summary =
    targetAssignments.length > 0
      ? `${sourceRoleCode} -> ${targetAssignments.map((target) => target.roleCode).join(" + ")}`
      : `${sourceRoleCode} has no resolvable target assignments`;

  return {
    previewStatus,
    notes,
    targetAssignments,
    summary,
  };
}

function buildPreviewSummary(sourceAssignments, previewItems, disabledRoleCodes = []) {
  const summary = {
    mappingVersion: ROLE_MIGRATION_MAPPING_VERSION,
    totalSourceAssignments: sourceAssignments.length,
    usersAffected: new Set(sourceAssignments.map((assignment) => assignment.user_id)).size,
    readyItemCount: 0,
    reviewRequiredItemCount: 0,
    skippedUnmappedItemCount: 0,
    sourceRoleCounts: {},
    previewStatusCounts: {},
    activeLegacyDisabledRoleCodes: [...disabledRoleCodes].sort(),
  };

  for (const assignment of sourceAssignments) {
    const roleCode = String(assignment.role_code || "").trim();
    summary.sourceRoleCounts[roleCode] = (summary.sourceRoleCounts[roleCode] || 0) + 1;
  }

  for (const item of previewItems) {
    const previewStatus = String(item.previewStatus || "READY").trim();
    summary.previewStatusCounts[previewStatus] =
      (summary.previewStatusCounts[previewStatus] || 0) + 1;
    if (previewStatus === "READY") {
      summary.readyItemCount += 1;
    } else if (previewStatus === "REVIEW_REQUIRED") {
      summary.reviewRequiredItemCount += 1;
    } else if (previewStatus === "SKIPPED_UNMAPPED") {
      summary.skippedUnmappedItemCount += 1;
    }
  }

  summary.sourceRoleCounts = sortObjectKeys(summary.sourceRoleCounts);
  summary.previewStatusCounts = sortObjectKeys(summary.previewStatusCounts);
  return summary;
}

async function loadRoleMigrationRunRow(tenantId, runId, runQuery = query) {
  const result = await safeQuery(
    runQuery,
    `SELECT
       id,
       tenant_id,
       requested_by_user_id,
       executed_by_user_id,
       rolled_back_by_user_id,
       status,
       mapping_version,
       preview_summary_json,
       execution_summary_json,
       rollback_summary_json,
       created_at,
       executed_at,
       rolled_back_at
     FROM role_migration_runs
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, runId],
    []
  );
  return result.rows[0] || null;
}

async function loadRoleMigrationRunItems(tenantId, runId, runQuery = query) {
  const result = await safeQuery(
    runQuery,
    `SELECT
       id,
       run_id,
       tenant_id,
       source_assignment_id,
       source_user_id,
       source_role_id,
       source_role_code,
       source_role_name,
       source_scope_type,
       source_scope_id,
       source_effect,
       source_effective_from,
       source_effective_to,
       preview_status,
       execution_status,
       rollback_status,
       source_snapshot_json,
       target_assignments_json,
       notes_json,
       execution_result_json,
       rollback_result_json,
       created_at
     FROM role_migration_run_items
     WHERE tenant_id = ?
       AND run_id = ?
     ORDER BY id`,
    [tenantId, runId],
    []
  );
  return (result.rows || []).map((row) => ({
    ...row,
    sourceSnapshot: parseJsonMaybe(row.source_snapshot_json, {}),
    targetAssignments: parseJsonMaybe(row.target_assignments_json, []),
    notes: parseJsonMaybe(row.notes_json, []),
    executionResult: parseJsonMaybe(row.execution_result_json, null),
    rollbackResult: parseJsonMaybe(row.rollback_result_json, null),
  }));
}

async function setLegacyRoleDisabledState({
  tenantId,
  roleId,
  roleCode,
  runId,
  actorUserId,
  isDisabled,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRoleId = parsePositiveInt(roleId);
  const normalizedRunId = parsePositiveInt(runId);
  if (!normalizedTenantId || !normalizedRoleId || !roleCode) {
    return;
  }

  if (isDisabled) {
    if (!normalizedRunId) {
      throw new Error("runId is required to disable legacy roles");
    }
    await runQuery(
      `UPDATE roles
       SET is_system = FALSE
       WHERE tenant_id = ?
         AND id = ?`,
      [normalizedTenantId, normalizedRoleId]
    );
    await runQuery(
      `INSERT INTO role_migration_legacy_disabled_roles (
          tenant_id,
          role_id,
          role_code,
          disabled_by_run_id,
          disabled_by_user_id,
          is_disabled
        )
       VALUES (?, ?, ?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         role_code = VALUES(role_code),
         disabled_by_run_id = VALUES(disabled_by_run_id),
         disabled_by_user_id = VALUES(disabled_by_user_id),
         is_disabled = TRUE,
         disabled_at = CURRENT_TIMESTAMP,
         reenabled_by_user_id = NULL,
         reenabled_at = NULL`,
      [normalizedTenantId, normalizedRoleId, roleCode, normalizedRunId, parsePositiveInt(actorUserId)]
    );
    return;
  }

  await runQuery(
    `UPDATE roles
     SET is_system = TRUE
     WHERE tenant_id = ?
       AND id = ?`,
    [normalizedTenantId, normalizedRoleId]
  );
  await runQuery(
    `UPDATE role_migration_legacy_disabled_roles
     SET is_disabled = FALSE,
         reenabled_by_user_id = ?,
         reenabled_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND role_id = ?`,
    [parsePositiveInt(actorUserId), normalizedTenantId, normalizedRoleId]
  );
}

/**
 * Returns the set of legacy role codes that are actively disabled for a tenant.
 */
export async function loadActiveLegacyDisabledRoleCodeSet(
  tenantId,
  runQuery = query
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    return new Set();
  }

  const result = await safeQuery(
    runQuery,
    `SELECT role_code
     FROM role_migration_legacy_disabled_roles
     WHERE tenant_id = ?
       AND is_disabled = TRUE`,
    [normalizedTenantId],
    []
  );

  return new Set(
    (result.rows || [])
      .map((row) => String(row.role_code || "").trim())
      .filter(Boolean)
  );
}

/**
 * Summarize whether the legacy-role migration UI should stay visible for one
 * tenant, so fresh tenants can hide migration-only admin surfaces without
 * losing brownfield rollback and history access.
 */
export async function getRoleMigrationUiState(tenantId, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    return {
      pendingLegacyAssignmentCount: 0,
      usersWithLegacyAssignmentsCount: 0,
      runCount: 0,
      latestRunId: null,
      latestRunStatus: null,
      activeLegacyDisabledRoleCodes: [],
      hasPendingLegacyAssignments: false,
      hasMigrationHistory: false,
      shouldShowInNavigation: false,
      simplifiedFreshTenantView: true,
    };
  }

  const assignmentResult = await safeQuery(
    runQuery,
    `SELECT COUNT(*) AS assignment_count,
            COUNT(DISTINCT urs.user_id) AS user_count
       FROM user_role_scopes urs
       JOIN roles r
         ON r.id = urs.role_id
        AND r.tenant_id = urs.tenant_id
      WHERE urs.tenant_id = ?
        AND r.code IN (${RETIRED_LEGACY_ROLE_CODES.map(() => "?").join(", ")})`,
    [normalizedTenantId, ...RETIRED_LEGACY_ROLE_CODES],
    [{ assignment_count: 0, user_count: 0 }]
  );
  const pendingLegacyAssignmentCount = Number(
    assignmentResult.rows?.[0]?.assignment_count || 0
  );
  const usersWithLegacyAssignmentsCount = Number(
    assignmentResult.rows?.[0]?.user_count || 0
  );

  const runCountResult = await safeQuery(
    runQuery,
    `SELECT COUNT(*) AS run_count,
            MAX(id) AS latest_run_id
       FROM role_migration_runs
      WHERE tenant_id = ?`,
    [normalizedTenantId],
    [{ run_count: 0, latest_run_id: null }]
  );
  const runCount = Number(runCountResult.rows?.[0]?.run_count || 0);
  const latestRunId = parsePositiveInt(runCountResult.rows?.[0]?.latest_run_id);

  let latestRunStatus = null;
  if (latestRunId) {
    const latestRunResult = await safeQuery(
      runQuery,
      `SELECT status
         FROM role_migration_runs
        WHERE tenant_id = ?
          AND id = ?
        LIMIT 1`,
      [normalizedTenantId, latestRunId],
      []
    );
    latestRunStatus =
      String(latestRunResult.rows?.[0]?.status || "").trim().toUpperCase() || null;
  }

  const activeLegacyDisabledRoleCodes = Array.from(
    await loadActiveLegacyDisabledRoleCodeSet(normalizedTenantId, runQuery)
  ).sort((left, right) => left.localeCompare(right));
  const hasPendingLegacyAssignments = pendingLegacyAssignmentCount > 0;
  const hasMigrationHistory = runCount > 0;
  const shouldShowInNavigation = hasPendingLegacyAssignments || hasMigrationHistory;

  return {
    pendingLegacyAssignmentCount,
    usersWithLegacyAssignmentsCount,
    runCount,
    latestRunId,
    latestRunStatus,
    activeLegacyDisabledRoleCodes,
    hasPendingLegacyAssignments,
    hasMigrationHistory,
    shouldShowInNavigation,
    simplifiedFreshTenantView: !shouldShowInNavigation,
  };
}

/**
 * Returns whether a concrete role row is actively disabled by the role migration tool.
 */
export async function isRoleLegacyDisabled(tenantId, roleId, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRoleId = parsePositiveInt(roleId);
  if (!normalizedTenantId || !normalizedRoleId) {
    return false;
  }

  const result = await safeQuery(
    runQuery,
    `SELECT id
     FROM role_migration_legacy_disabled_roles
     WHERE tenant_id = ?
       AND role_id = ?
       AND is_disabled = TRUE
     LIMIT 1`,
    [normalizedTenantId, normalizedRoleId],
    []
  );
  return Boolean(result.rows[0]?.id);
}

/**
 * Lists preview/execution runs for a tenant so admins can review the migration history.
 */
export async function listRoleMigrationRuns({ tenantId, runQuery = query }) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    return [];
  }

  const result = await safeQuery(
    runQuery,
    `SELECT
       id,
       tenant_id,
       requested_by_user_id,
       executed_by_user_id,
       rolled_back_by_user_id,
       status,
       mapping_version,
       preview_summary_json,
       execution_summary_json,
       rollback_summary_json,
       created_at,
       executed_at,
       rolled_back_at
     FROM role_migration_runs
     WHERE tenant_id = ?
     ORDER BY id DESC`,
    [normalizedTenantId],
    []
  );

  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    requestedByUserId: parsePositiveInt(row.requested_by_user_id),
    executedByUserId: parsePositiveInt(row.executed_by_user_id),
    rolledBackByUserId: parsePositiveInt(row.rolled_back_by_user_id),
    status: normalizeUpperText(row.status),
    mappingVersion: row.mapping_version || null,
    previewSummary: parseJsonMaybe(row.preview_summary_json, {}),
    executionSummary: parseJsonMaybe(row.execution_summary_json, null),
    rollbackSummary: parseJsonMaybe(row.rollback_summary_json, null),
    createdAt: row.created_at || null,
    executedAt: row.executed_at || null,
    rolledBackAt: row.rolled_back_at || null,
  }));
}

/**
 * Builds and stores a deterministic preview snapshot for the tenant's legacy role assignments.
 */
export async function createRoleMigrationPreviewRun({
  tenantId,
  actorUserId = null,
  sourceRoleCodes = RETIRED_LEGACY_ROLE_CODES,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedActorUserId = parsePositiveInt(actorUserId);
  if (!normalizedTenantId) {
    throw new Error("tenantId is required to preview role migration");
  }

  const normalizedSourceRoleCodes = Array.from(
    new Set(
      (
        Array.isArray(sourceRoleCodes) && sourceRoleCodes.length > 0
          ? sourceRoleCodes
          : RETIRED_LEGACY_ROLE_CODES
      )
        .map((roleCode) => String(roleCode || "").trim())
        .filter((roleCode) => RETIRED_LEGACY_ROLE_CODE_SET.has(roleCode))
    )
  );

  const sourceAssignments = await loadLegacySourceAssignments(
    normalizedTenantId,
    normalizedSourceRoleCodes
  );
  const scopeMetaByKey = await loadScopeMetaByKey(normalizedTenantId, sourceAssignments);
  const targetRoleRowsByCode = await loadRoleRowsByCode(
    normalizedTenantId,
    TARGET_ROLE_CODES
  );
  const activeDisabledRoleCodes = await loadActiveLegacyDisabledRoleCodeSet(normalizedTenantId);

  const previewItems = sourceAssignments.map((assignment) => {
    const previewItem = buildPreviewItem({
      assignment,
      scopeMetaByKey,
      targetRoleRowsByCode,
    });
    const scope = summarizeScope(assignment.scope_type, assignment.scope_id, scopeMetaByKey);
    const sourceSnapshot = {
      assignmentId: parsePositiveInt(assignment.id),
      userId: parsePositiveInt(assignment.user_id),
      userEmail: assignment.user_email || null,
      userName: assignment.user_name || null,
      roleId: parsePositiveInt(assignment.role_id),
      roleCode: assignment.role_code || null,
      roleName: assignment.role_name || null,
      scope,
      effect: normalizeUpperText(assignment.effect) || "ALLOW",
      effectiveFrom: toDateOnly(assignment.effective_from),
      effectiveTo: toDateOnly(assignment.effective_to),
      createdAt: assignment.created_at || null,
    };
    return {
      sourceAssignmentId: parsePositiveInt(assignment.id),
      sourceUserId: parsePositiveInt(assignment.user_id),
      sourceRoleId: parsePositiveInt(assignment.role_id),
      sourceRoleCode: assignment.role_code || null,
      sourceRoleName: assignment.role_name || null,
      sourceScopeType: scope.scopeType,
      sourceScopeId: scope.scopeId,
      sourceEffect: normalizeUpperText(assignment.effect) || "ALLOW",
      sourceEffectiveFrom: toDateOnly(assignment.effective_from),
      sourceEffectiveTo: toDateOnly(assignment.effective_to),
      previewStatus: previewItem.previewStatus,
      notes: previewItem.notes,
      summary: previewItem.summary,
      sourceSnapshot,
      targetAssignments: previewItem.targetAssignments,
    };
  });

  const previewSummary = buildPreviewSummary(
    sourceAssignments,
    previewItems,
    activeDisabledRoleCodes
  );

  let runId = null;
  await withTransaction(async (tx) => {
    const runInsert = await tx.query(
      `INSERT INTO role_migration_runs (
          tenant_id,
          requested_by_user_id,
          status,
          mapping_version,
          preview_summary_json
        )
       VALUES (?, ?, 'PREVIEWED', ?, ?)`,
      [
        normalizedTenantId,
        normalizedActorUserId,
        ROLE_MIGRATION_MAPPING_VERSION,
        toJson(previewSummary),
      ]
    );
    runId = parsePositiveInt(runInsert.rows.insertId);
    if (!runId) {
      throw new Error("Failed to create role migration preview run");
    }

    for (const item of previewItems) {
      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO role_migration_run_items (
            run_id,
            tenant_id,
            source_assignment_id,
            source_user_id,
            source_role_id,
            source_role_code,
            source_role_name,
            source_scope_type,
            source_scope_id,
            source_effect,
            source_effective_from,
            source_effective_to,
            preview_status,
            source_snapshot_json,
            target_assignments_json,
            notes_json
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runId,
          normalizedTenantId,
          item.sourceAssignmentId,
          item.sourceUserId,
          item.sourceRoleId,
          item.sourceRoleCode,
          item.sourceRoleName,
          item.sourceScopeType,
          item.sourceScopeId,
          item.sourceEffect,
          item.sourceEffectiveFrom,
          item.sourceEffectiveTo,
          item.previewStatus,
          toJson(item.sourceSnapshot),
          toJson(item.targetAssignments),
          toJson(item.notes),
        ]
      );
    }
  });

  return getRoleMigrationRunDetail({
    tenantId: normalizedTenantId,
    runId,
  });
}

/**
 * Loads one persisted migration preview/execution run with its item snapshot.
 */
export async function getRoleMigrationRunDetail({
  tenantId,
  runId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRunId = parsePositiveInt(runId);
  if (!normalizedTenantId || !normalizedRunId) {
    return null;
  }

  const runRow = await loadRoleMigrationRunRow(
    normalizedTenantId,
    normalizedRunId,
    runQuery
  );
  if (!runRow) {
    return null;
  }

  const items = await loadRoleMigrationRunItems(
    normalizedTenantId,
    normalizedRunId,
    runQuery
  );
  return {
    id: parsePositiveInt(runRow.id),
    tenantId: parsePositiveInt(runRow.tenant_id),
    requestedByUserId: parsePositiveInt(runRow.requested_by_user_id),
    executedByUserId: parsePositiveInt(runRow.executed_by_user_id),
    rolledBackByUserId: parsePositiveInt(runRow.rolled_back_by_user_id),
    status: normalizeUpperText(runRow.status),
    mappingVersion: runRow.mapping_version || null,
    previewSummary: parseJsonMaybe(runRow.preview_summary_json, {}),
    executionSummary: parseJsonMaybe(runRow.execution_summary_json, null),
    rollbackSummary: parseJsonMaybe(runRow.rollback_summary_json, null),
    createdAt: runRow.created_at || null,
    executedAt: runRow.executed_at || null,
    rolledBackAt: runRow.rolled_back_at || null,
    items,
  };
}

/**
 * Executes a stored migration preview by creating target assignments, removing
 * the source legacy assignments, and disabling fully retired source roles.
 */
export async function executeRoleMigrationRun({
  tenantId,
  runId,
  actorUserId = null,
  itemIds = null,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRunId = parsePositiveInt(runId);
  const normalizedActorUserId = parsePositiveInt(actorUserId);
  if (!normalizedTenantId || !normalizedRunId) {
    throw new Error("tenantId and runId are required to execute role migration");
  }

  const selectedItemIds = Array.from(
    new Set((Array.isArray(itemIds) ? itemIds : []).map(parsePositiveInt).filter(Boolean))
  );

  await withTransaction(async (tx) => {
    const runRow = await loadRoleMigrationRunRow(normalizedTenantId, normalizedRunId, tx.query);
    if (!runRow) {
      throw new Error("Role migration run not found");
    }
    if (normalizeUpperText(runRow.status) !== "PREVIEWED") {
      throw new Error("Only PREVIEWED role migration runs can be executed");
    }

    const items = await loadRoleMigrationRunItems(normalizedTenantId, normalizedRunId, tx.query);
    if (items.length === 0) {
      throw new Error("Role migration run has no preview items");
    }

    const executionTargets =
      selectedItemIds.length > 0
        ? items.filter((item) => selectedItemIds.includes(parsePositiveInt(item.id)))
        : items;
    if (selectedItemIds.length > 0 && executionTargets.length === 0) {
      throw new Error("Selected role migration items were not found in this run");
    }

    const summary = {
      processedItemCount: executionTargets.length,
      executedItemCount: 0,
      skippedItemCount: 0,
      conflictItemCount: 0,
      createdTargetAssignmentCount: 0,
      alreadyPresentTargetAssignmentCount: 0,
      deletedSourceAssignmentCount: 0,
      disabledRoleCodes: [],
    };

    const touchedSourceRoleCodes = new Set();
    const roleRowsByCode = await loadRoleRowsByCode(
      normalizedTenantId,
      RETIRED_LEGACY_ROLE_CODES,
      tx.query
    );

    for (const item of executionTargets) {
      const itemId = parsePositiveInt(item.id);
      const previewStatus = normalizeUpperText(item.preview_status);
      if (previewStatus !== "READY") {
        summary.skippedItemCount += 1;
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `UPDATE role_migration_run_items
           SET execution_status = 'SKIPPED',
               execution_result_json = ?
           WHERE id = ?
             AND tenant_id = ?`,
          [
            toJson({
              reason: `Preview status ${previewStatus} is not executable without review.`,
            }),
            itemId,
            normalizedTenantId,
          ]
        );
        continue;
      }

      const sourceSnapshot = item.sourceSnapshot || {};
      const targetAssignments = Array.isArray(item.targetAssignments)
        ? item.targetAssignments
        : [];

      const sourceRowResult = await tx.query(
        `SELECT id
         FROM user_role_scopes
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1`,
        [parsePositiveInt(item.source_assignment_id), normalizedTenantId]
      );
      if (!sourceRowResult.rows[0]?.id) {
        summary.conflictItemCount += 1;
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `UPDATE role_migration_run_items
           SET execution_status = 'CONFLICT',
               execution_result_json = ?
           WHERE id = ?
             AND tenant_id = ?`,
          [
            toJson({
              reason: "Source assignment no longer exists.",
            }),
            itemId,
            normalizedTenantId,
          ]
        );
        continue;
      }

      const createdTargetAssignments = [];
      const alreadyPresentTargetAssignments = [];
      const conflicts = [];

      for (const targetAssignment of targetAssignments) {
        const targetRoleId = parsePositiveInt(targetAssignment.roleId);
        if (!targetRoleId) {
          conflicts.push({
            reason: `Target role ${targetAssignment.roleCode || "UNKNOWN"} is not configured for this tenant.`,
          });
          break;
        }

        // eslint-disable-next-line no-await-in-loop
        const existingResult = await tx.query(
          `SELECT
             id,
             effect,
             effective_from,
             effective_to
           FROM user_role_scopes
           WHERE tenant_id = ?
             AND user_id = ?
             AND role_id = ?
             AND scope_type = ?
             AND scope_id = ?
           LIMIT 1`,
          [
            normalizedTenantId,
            parsePositiveInt(item.source_user_id),
            targetRoleId,
            targetAssignment.scopeType,
            parsePositiveInt(targetAssignment.scopeId),
          ]
        );
        const existingAssignment = existingResult.rows[0] || null;

        if (!existingAssignment) {
          // eslint-disable-next-line no-await-in-loop
          const insertResult = await tx.query(
            `INSERT INTO user_role_scopes (
                tenant_id,
                user_id,
                role_id,
                scope_type,
                scope_id,
                effect,
                effective_from,
                effective_to
              )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              normalizedTenantId,
              parsePositiveInt(item.source_user_id),
              targetRoleId,
              targetAssignment.scopeType,
              parsePositiveInt(targetAssignment.scopeId),
              targetAssignment.effect,
              targetAssignment.effectiveFrom,
              targetAssignment.effectiveTo,
            ]
          );
          const insertedAssignmentId = parsePositiveInt(insertResult.rows.insertId);
          createdTargetAssignments.push({
            assignmentId: insertedAssignmentId,
            roleId: targetRoleId,
            roleCode: targetAssignment.roleCode,
          });
          summary.createdTargetAssignmentCount += 1;
          continue;
        }

        if (sameAssignmentWindow(existingAssignment, targetAssignment)) {
          alreadyPresentTargetAssignments.push({
            assignmentId: parsePositiveInt(existingAssignment.id),
            roleId: targetRoleId,
            roleCode: targetAssignment.roleCode,
          });
          summary.alreadyPresentTargetAssignmentCount += 1;
          continue;
        }

        conflicts.push({
          roleCode: targetAssignment.roleCode,
          existingAssignmentId: parsePositiveInt(existingAssignment.id),
          reason: "Target assignment already exists with different effect/effective dates.",
        });
        break;
      }

      if (conflicts.length > 0) {
        for (const createdAssignment of createdTargetAssignments) {
          // eslint-disable-next-line no-await-in-loop
          await tx.query(
            `DELETE FROM user_role_scopes
             WHERE id = ?
               AND tenant_id = ?`,
            [createdAssignment.assignmentId, normalizedTenantId]
          );
        }
        summary.conflictItemCount += 1;
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `UPDATE role_migration_run_items
           SET execution_status = 'CONFLICT',
               execution_result_json = ?
           WHERE id = ?
             AND tenant_id = ?`,
          [
            toJson({
              sourceSnapshot,
              conflicts,
            }),
            itemId,
            normalizedTenantId,
          ]
        );
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `DELETE FROM user_role_scopes
         WHERE id = ?
           AND tenant_id = ?`,
        [parsePositiveInt(item.source_assignment_id), normalizedTenantId]
      );
      summary.deletedSourceAssignmentCount += 1;
      summary.executedItemCount += 1;
      touchedSourceRoleCodes.add(String(item.source_role_code || "").trim());

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `UPDATE role_migration_run_items
         SET execution_status = 'EXECUTED',
             rollback_status = 'NOT_APPLICABLE',
             execution_result_json = ?
         WHERE id = ?
           AND tenant_id = ?`,
        [
          toJson({
            sourceSnapshot,
            createdTargetAssignments,
            alreadyPresentTargetAssignments,
            deletedSourceAssignment: {
              assignmentId: parsePositiveInt(item.source_assignment_id),
            },
          }),
          itemId,
          normalizedTenantId,
        ]
      );
    }

    const disabledRoleCodes = [];
    for (const sourceRoleCode of touchedSourceRoleCodes) {
      const remainingResult = await tx.query(
        `SELECT COUNT(*) AS remaining_count
         FROM user_role_scopes urs
         JOIN roles r
           ON r.id = urs.role_id
          AND r.tenant_id = urs.tenant_id
         WHERE urs.tenant_id = ?
           AND r.code = ?`,
        [normalizedTenantId, sourceRoleCode]
      );
      const remainingCount = Number(remainingResult.rows[0]?.remaining_count || 0);
      if (remainingCount > 0) {
        continue;
      }

      const roleRow = roleRowsByCode.get(sourceRoleCode) || null;
      if (!roleRow) {
        continue;
      }

      await setLegacyRoleDisabledState({
        tenantId: normalizedTenantId,
        roleId: roleRow.id,
        roleCode: sourceRoleCode,
        runId: normalizedRunId,
        actorUserId: normalizedActorUserId,
        isDisabled: true,
        runQuery: tx.query,
      });
      disabledRoleCodes.push(sourceRoleCode);
    }

    summary.disabledRoleCodes = disabledRoleCodes.sort();
    await tx.query(
      `UPDATE role_migration_runs
       SET status = 'EXECUTED',
           executed_by_user_id = ?,
           executed_at = CURRENT_TIMESTAMP,
           execution_summary_json = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [normalizedActorUserId, toJson(summary), normalizedRunId, normalizedTenantId]
    );
  });

  await invalidateRbacCache(normalizedTenantId);

  return getRoleMigrationRunDetail({
    tenantId: normalizedTenantId,
    runId: normalizedRunId,
  });
}

/**
 * Rolls back one executed migration run by restoring the deleted source
 * assignments and removing only the target assignments created by that run.
 */
export async function rollbackRoleMigrationRun({
  tenantId,
  runId,
  actorUserId = null,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRunId = parsePositiveInt(runId);
  const normalizedActorUserId = parsePositiveInt(actorUserId);
  if (!normalizedTenantId || !normalizedRunId) {
    throw new Error("tenantId and runId are required to roll back role migration");
  }

  await withTransaction(async (tx) => {
    const runRow = await loadRoleMigrationRunRow(normalizedTenantId, normalizedRunId, tx.query);
    if (!runRow) {
      throw new Error("Role migration run not found");
    }
    if (normalizeUpperText(runRow.status) !== "EXECUTED") {
      throw new Error("Only EXECUTED role migration runs can be rolled back");
    }

    const items = await loadRoleMigrationRunItems(normalizedTenantId, normalizedRunId, tx.query);
    const executedItems = items.filter(
      (item) => normalizeUpperText(item.execution_status) === "EXECUTED"
    );

    const summary = {
      rolledBackItemCount: 0,
      restoredSourceAssignmentCount: 0,
      removedCreatedTargetAssignmentCount: 0,
      reenabledRoleCodes: [],
    };

    for (const item of executedItems) {
      const executionResult = item.executionResult || {};
      const createdTargetAssignments = Array.isArray(executionResult.createdTargetAssignments)
        ? executionResult.createdTargetAssignments
        : [];
      const sourceSnapshot = executionResult.sourceSnapshot || item.sourceSnapshot || {};

      for (const createdTargetAssignment of createdTargetAssignments) {
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `DELETE FROM user_role_scopes
           WHERE id = ?
             AND tenant_id = ?`,
          [parsePositiveInt(createdTargetAssignment.assignmentId), normalizedTenantId]
        );
        summary.removedCreatedTargetAssignmentCount += 1;
      }

      // Restore the deleted source row deterministically. Rollback is explicit,
      // so the stored snapshot wins over any later drift at the same scope key.
      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO user_role_scopes (
            tenant_id,
            user_id,
            role_id,
            scope_type,
            scope_id,
            effect,
            effective_from,
            effective_to
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           effect = VALUES(effect),
           effective_from = VALUES(effective_from),
           effective_to = VALUES(effective_to)`,
        [
          normalizedTenantId,
          parsePositiveInt(sourceSnapshot.userId),
          parsePositiveInt(sourceSnapshot.roleId),
          sourceSnapshot.scope?.scopeType,
          parsePositiveInt(sourceSnapshot.scope?.scopeId),
          sourceSnapshot.effect,
          sourceSnapshot.effectiveFrom,
          sourceSnapshot.effectiveTo,
        ]
      );
      summary.restoredSourceAssignmentCount += 1;
      summary.rolledBackItemCount += 1;

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `UPDATE role_migration_run_items
         SET rollback_status = 'ROLLED_BACK',
             rollback_result_json = ?
         WHERE id = ?
           AND tenant_id = ?`,
        [
          toJson({
            restoredSourceRoleCode: sourceSnapshot.roleCode || null,
            restoredScopeType: sourceSnapshot.scope?.scopeType || null,
            restoredScopeId: parsePositiveInt(sourceSnapshot.scope?.scopeId),
            removedCreatedTargetAssignmentCount: createdTargetAssignments.length,
          }),
          parsePositiveInt(item.id),
          normalizedTenantId,
        ]
      );
    }

    const disabledRoleResult = await safeQuery(
      tx.query,
      `SELECT role_id, role_code
       FROM role_migration_legacy_disabled_roles
       WHERE tenant_id = ?
         AND disabled_by_run_id = ?
         AND is_disabled = TRUE`,
      [normalizedTenantId, normalizedRunId],
      []
    );
    for (const disabledRole of disabledRoleResult.rows || []) {
      // eslint-disable-next-line no-await-in-loop
      await setLegacyRoleDisabledState({
        tenantId: normalizedTenantId,
        roleId: disabledRole.role_id,
        roleCode: disabledRole.role_code,
        actorUserId: normalizedActorUserId,
        isDisabled: false,
        runQuery: tx.query,
      });
      summary.reenabledRoleCodes.push(String(disabledRole.role_code || "").trim());
    }

    summary.reenabledRoleCodes = summary.reenabledRoleCodes.sort();

    await tx.query(
      `UPDATE role_migration_runs
       SET status = 'ROLLED_BACK',
           rolled_back_by_user_id = ?,
           rolled_back_at = CURRENT_TIMESTAMP,
           rollback_summary_json = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [normalizedActorUserId, toJson(summary), normalizedRunId, normalizedTenantId]
    );
  });

  await invalidateRbacCache(normalizedTenantId);

  return getRoleMigrationRunDetail({
    tenantId: normalizedTenantId,
    runId: normalizedRunId,
  });
}
