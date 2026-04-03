import express from "express";
import bcrypt from "bcrypt";
import { query, withTransaction } from "../db.js";
import {
  assertScopeAccess,
  buildScopeFilter,
  invalidateRbacCache,
  requirePermission,
} from "../middleware/rbac.js";
import { logRbacAuditEvent } from "../audit/rbacAuditLogger.js";
import {
  assertCountryExists,
  assertGroupCompanyBelongsToTenant,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
  assertUserBelongsToTenant,
} from "../tenantGuards.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parseIdempotencyKey,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { parseDateOnly } from "./cash.validators.common.js";
import { createInviteForTenantUser } from "../services/userInvites.service.js";
import { executeIdempotentRequest } from "../services/idempotency.service.js";
import { canManageSecurity } from "../services/systemRoles.service.js";
import { getUserRoleScopeEffectiveDateGuard } from "../services/authz.scope.service.js";
import {
  createRoleMigrationPreviewRun,
  executeRoleMigrationRun,
  getRoleMigrationUiState,
  getRoleMigrationRunDetail,
  isRoleLegacyDisabled,
  isRetiredLegacyRoleCode,
  loadActiveLegacyDisabledRoleCodeSet,
  listRoleMigrationRuns,
  rollbackRoleMigrationRun,
} from "../services/roleMigration.service.js";
import {
  assertFieldVisibilityPolicyPermission,
  createFieldVisibilityPolicy,
  deactivateFieldVisibilityPolicy,
  getFieldVisibilityPolicyById,
  listFieldVisibilityPoliciesForActor,
  resolveFieldVisibilityPolicyManagementScope,
  updateFieldVisibilityPolicy,
} from "../services/fieldVisibilityPolicies.service.js";
import {
  assertValidPermissionRuleSet,
  evaluatePermissionRuleSet,
} from "../constants/permission-rules.js";

const router = express.Router();

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

const VALID_USER_STATUSES = new Set(["ACTIVE", "DISABLED"]);
const ENTITY_USER_ADMIN_PERMISSION = "security.user_admin.entity";
const BRANCH_OPERATOR_ROLE_CODE = "BranchOperator";

function normalizeUserEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw badRequest("email is required");
  }
  if (email.length > 255) {
    throw badRequest("email cannot exceed 255 characters");
  }
  if (!email.includes("@") || !email.includes(".")) {
    throw badRequest("email is invalid");
  }
  return email;
}

function normalizeUserName(value) {
  const name = String(value || "").trim();
  if (!name) {
    throw badRequest("name is required");
  }
  if (name.length > 255) {
    throw badRequest("name cannot exceed 255 characters");
  }
  return name;
}

function normalizeUserStatus(value) {
  const normalized = String(value || "ACTIVE")
    .trim()
    .toUpperCase();
  if (!VALID_USER_STATUSES.has(normalized)) {
    throw badRequest("status must be ACTIVE or DISABLED");
  }
  return normalized;
}

function validateUserPassword(value) {
  const password = String(value || "");
  if (password.length < 8) {
    throw badRequest("password must be at least 8 characters");
  }
  if (password.length > 128) {
    throw badRequest("password cannot exceed 128 characters");
  }
  return password;
}

const VALID_SCOPE_TYPES = new Set([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

const VALID_EFFECTS = new Set(["ALLOW", "DENY"]);
const VALID_FIELD_VISIBILITY_SCOPE_TYPES = new Set([
  "GLOBAL",
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

function normalizeScopeType(value) {
  const scopeType = String(value || "").toUpperCase();
  if (!VALID_SCOPE_TYPES.has(scopeType)) {
    throw badRequest(
      "scopeType must be one of TENANT, GROUP, COUNTRY, LEGAL_ENTITY, OPERATING_UNIT"
    );
  }
  return scopeType;
}

function normalizeEffect(value, fallback = "ALLOW") {
  const effect = String(value || fallback).toUpperCase();
  if (!VALID_EFFECTS.has(effect)) {
    throw badRequest("effect must be ALLOW or DENY");
  }
  return effect;
}

function normalizeFieldVisibilityScopeType(value, fallback = "GLOBAL") {
  const scopeType = String(value || fallback).trim().toUpperCase();
  if (!VALID_FIELD_VISIBILITY_SCOPE_TYPES.has(scopeType)) {
    throw badRequest(
      "appliesToScopeType must be GLOBAL, TENANT, GROUP, COUNTRY, LEGAL_ENTITY, or OPERATING_UNIT"
    );
  }
  return scopeType;
}

async function assertFieldVisibilityPolicyScopeBelongsToTenant(
  tenantId,
  scopeType,
  scopeId
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedScopeType = normalizeFieldVisibilityScopeType(scopeType);
  if (normalizedScopeType === "GLOBAL") {
    return {
      appliesToScopeType: null,
      appliesToScopeId: null,
    };
  }
  if (normalizedScopeType === "TENANT") {
    const normalizedScopeId = parsePositiveInt(scopeId) || normalizedTenantId;
    if (normalizedScopeId !== normalizedTenantId) {
      throw badRequest("Tenant-scoped field visibility policies must use the current tenant id");
    }
    return {
      appliesToScopeType: "TENANT",
      appliesToScopeId: normalizedTenantId,
    };
  }

  const normalizedScopeId = parsePositiveInt(scopeId);
  if (!normalizedScopeId) {
    throw badRequest(`appliesToScopeId is required when appliesToScopeType = ${normalizedScopeType}`);
  }

  if (normalizedScopeType === "GROUP") {
    await assertGroupCompanyBelongsToTenant(normalizedScopeId, normalizedTenantId);
  } else if (normalizedScopeType === "COUNTRY") {
    await assertCountryExists(normalizedScopeId);
  } else if (normalizedScopeType === "LEGAL_ENTITY") {
    await assertLegalEntityBelongsToTenant(normalizedScopeId, normalizedTenantId);
  } else if (normalizedScopeType === "OPERATING_UNIT") {
    await assertOperatingUnitBelongsToTenant(normalizedScopeId, normalizedTenantId);
  }

  return {
    appliesToScopeType: normalizedScopeType,
    appliesToScopeId: normalizedScopeId,
  };
}

function toDateOnly(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const asText = String(value);
  const dateOnlyMatch = asText.match(/\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[0];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function parseOptionalDateFieldValue(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseDateOnly(value, label);
}

function parseOptionalDateField(body, camelKey, snakeKey = camelKey) {
  const payload = body && typeof body === "object" ? body : {};
  const hasCamelKey = Object.prototype.hasOwnProperty.call(payload, camelKey);
  const hasSnakeKey = Object.prototype.hasOwnProperty.call(payload, snakeKey);
  if (!hasCamelKey && !hasSnakeKey) {
    return { provided: false, value: null };
  }
  const rawValue = hasCamelKey ? payload[camelKey] : payload[snakeKey];
  return {
    provided: true,
    value: parseOptionalDateFieldValue(rawValue, camelKey),
  };
}

function resolveAssignmentEffectiveDates(body, existingAssignment = null) {
  const effectiveFromInput = parseOptionalDateField(
    body,
    "effectiveFrom",
    "effective_from"
  );
  const effectiveToInput = parseOptionalDateField(
    body,
    "effectiveTo",
    "effective_to"
  );

  const effectiveFrom = effectiveFromInput.provided
    ? effectiveFromInput.value
    : toDateOnly(existingAssignment?.effective_from);
  const effectiveTo = effectiveToInput.provided
    ? effectiveToInput.value
    : toDateOnly(existingAssignment?.effective_to);

  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw badRequest("effectiveTo must be on or after effectiveFrom");
  }

  return { effectiveFrom, effectiveTo };
}

async function getRoleForTenant(roleId, tenantId) {
  const roleResult = await query(
    `SELECT id, tenant_id, code, name, is_system
     FROM roles
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [roleId, tenantId]
  );
  return roleResult.rows[0] || null;
}

async function getRoleByCodeForTenant(roleCode, tenantId, runQuery = query) {
  const roleResult = await runQuery(
    `SELECT id, tenant_id, code, name, is_system
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  return roleResult.rows[0] || null;
}

async function getBranchOperatorRoleForTenant(tenantId, runQuery = query) {
  const role = await getRoleByCodeForTenant(BRANCH_OPERATOR_ROLE_CODE, tenantId, runQuery);
  if (!role) {
    throw new Error("BranchOperator role is not configured for this tenant");
  }
  return role;
}

async function lookupUserByEmail(email, runQuery = query) {
  const result = await runQuery(
    `SELECT id, tenant_id, email, name, status
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

async function assertUserHasNoExplicitDataScopes(tenantId, userId, runQuery = query) {
  const result = await runQuery(
    `SELECT COUNT(*) AS scope_count
     FROM data_scopes
     WHERE tenant_id = ?
       AND user_id = ?`,
    [tenantId, userId]
  );
  const scopeCount = Number(result.rows[0]?.scope_count || 0);
  if (scopeCount > 0) {
    throw badRequest("User has explicit data scopes and must be managed by Security Admin");
  }
}

async function assertSystemRoleManageAllowed(req, tenantId, role) {
  if (!Boolean(role?.is_system)) {
    return;
  }

  const actorUserId = parsePositiveInt(req.user?.userId);
  const canManageSystemRoles = await canManageSecurity(actorUserId, tenantId);
  if (!canManageSystemRoles) {
    throw forbidden("Only SecurityAdmin can manage system role assignments");
  }
}

async function assertRoleAssignmentUpsertAllowed(tenantId, role) {
  if (!role?.id) {
    return;
  }
  if (isRetiredLegacyRoleCode(role.code)) {
    throw badRequest(
      `${role.code || "Role"} is retired and can only be restored through migration or rollback seams`
    );
  }
  const isLegacyDisabled = await isRoleLegacyDisabled(tenantId, role.id);
  if (isLegacyDisabled) {
    throw badRequest(
      `${role.code || "Role"} is disabled by role migration and can only be restored through rollback`
    );
  }
}

function assertRetiredLegacyRoleNotManaged(roleOrCode) {
  const roleCode =
    typeof roleOrCode === "string"
      ? String(roleOrCode || "").trim()
      : String(roleOrCode?.code || "").trim();
  if (!isRetiredLegacyRoleCode(roleCode)) {
    return;
  }
  throw badRequest(
    `${roleCode || "Role"} is retired and is no longer manageable through the normal role admin surfaces`
  );
}

async function assertSecurityMigrationManageAllowed(req, tenantId) {
  const actorUserId = parsePositiveInt(req.user?.userId);
  const canManageSystemRoles = await canManageSecurity(actorUserId, tenantId);
  if (!canManageSystemRoles) {
    throw forbidden("Only SecurityAdmin can manage role migration runs");
  }
}

function normalizeRoleCodeList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizePositiveIntList(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map(parsePositiveInt).filter(Boolean))
  );
}

async function upsertPermissionAndGetId(permissionCode, runQuery = query) {
  await runQuery(
    `INSERT INTO permissions (code, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       description = VALUES(description)`,
    [permissionCode, permissionCode]
  );

  const permissionResult = await runQuery(
    `SELECT id FROM permissions WHERE code = ? LIMIT 1`,
    [permissionCode]
  );
  const permissionId = permissionResult.rows[0]?.id;
  if (!permissionId) {
    throw new Error(`Permission lookup failed for ${permissionCode}`);
  }
  return permissionId;
}

async function loadRolePermissionCodes(roleId, runQuery = query) {
  const result = await runQuery(
    `SELECT p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?
     ORDER BY p.code`,
    [roleId]
  );
  return Array.from(
    new Set(
      (result.rows || [])
        .map((row) => String(row.code || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizePermissionCodeList(permissionCodes) {
  return Array.from(
    new Set(
      (Array.isArray(permissionCodes) ? permissionCodes : [])
        .map((permissionCode) => String(permissionCode || "").trim())
        .filter(Boolean)
    )
  );
}

function validateRolePermissionSetOrThrow(roleCode, permissionCodes) {
  return assertValidPermissionRuleSet({
    permissionCodes,
    subjectLabel: `Role ${roleCode || "UNKNOWN"}`,
  });
}

async function buildCombinedRoleAssignmentWarnings({
  tenantId,
  userId,
  scopeType,
  scopeId,
  includeRoleId,
  excludeAssignmentId = null,
  effect = "ALLOW",
  asOfDate = null,
  runQuery = query,
}) {
  if (String(effect || "").toUpperCase() !== "ALLOW") {
    return [];
  }

  const params = [tenantId, userId, scopeType, scopeId];
  let excludeAssignmentSql = "";
  if (parsePositiveInt(excludeAssignmentId)) {
    excludeAssignmentSql = " AND urs.id <> ?";
    params.push(parsePositiveInt(excludeAssignmentId));
  }
  const effectiveGuard = await getUserRoleScopeEffectiveDateGuard({
    runQuery,
    asOfDate,
  });

  const existingResult = await runQuery(
    `SELECT DISTINCT p.code
     FROM user_role_scopes urs
     JOIN role_permissions rp ON rp.role_id = urs.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE urs.tenant_id = ?
       AND urs.user_id = ?
       AND urs.scope_type = ?
       AND urs.scope_id = ?
       AND urs.effect = 'ALLOW'${excludeAssignmentSql}${effectiveGuard.sql}
     ORDER BY p.code`,
    [...params, ...effectiveGuard.params]
  );

  const permissionCodes = normalizePermissionCodeList(
    (existingResult.rows || []).map((row) => row.code)
  );

  const includeRolePermissionCodes = parsePositiveInt(includeRoleId)
    ? await loadRolePermissionCodes(includeRoleId, runQuery)
    : [];
  const combinedPermissionCodes = normalizePermissionCodeList([
    ...permissionCodes,
    ...includeRolePermissionCodes,
  ]);

  const evaluation = evaluatePermissionRuleSet({
    permissionCodes: combinedPermissionCodes,
    subjectLabel: `Combined assigned role set at ${scopeType}#${scopeId}`,
  });

  return [
    ...evaluation.errors.map((ruleError) => ({
      ...ruleError,
      severity: "warn",
      type: "assignment_rule_warning",
    })),
    ...evaluation.warnings,
  ];
}

async function assertScopeTargetExists(tenantId, scopeType, scopeId) {
  const normalizedScopeType = String(scopeType || "").toUpperCase();
  const parsedScopeId = parsePositiveInt(scopeId);

  if (!parsedScopeId) {
    throw badRequest("scopeId must be a positive integer");
  }

  if (normalizedScopeType === "TENANT") {
    if (parsePositiveInt(tenantId) !== parsedScopeId) {
      throw badRequest("TENANT scopeId must match tenantId");
    }
    return;
  }

  if (normalizedScopeType === "GROUP") {
    await assertGroupCompanyBelongsToTenant(tenantId, parsedScopeId, "scopeId");
    return;
  }

  if (normalizedScopeType === "COUNTRY") {
    await assertCountryExists(parsedScopeId, "scopeId");
    return;
  }

  if (normalizedScopeType === "LEGAL_ENTITY") {
    await assertLegalEntityBelongsToTenant(tenantId, parsedScopeId, "scopeId");
    return;
  }

  if (normalizedScopeType === "OPERATING_UNIT") {
    await assertOperatingUnitBelongsToTenant(tenantId, parsedScopeId, "scopeId");
    return;
  }

  throw badRequest("Unsupported scopeType");
}

router.get(
  "/permissions",
  requirePermission("security.permission.read"),
  asyncHandler(async (req, res) => {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const params = [];
    let whereClause = "";

    if (q) {
      whereClause = "WHERE code LIKE ? OR description LIKE ?";
      params.push(`%${q}%`, `%${q}%`);
    }

    const result = await query(
      `SELECT id, code, description
       FROM permissions
       ${whereClause}
       ORDER BY code`,
      params
    );

    return res.json({
      rows: result.rows,
    });
  })
);

router.get(
  "/users",
  requirePermission("security.role_assignment.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const q = req.query.q ? String(req.query.q).trim() : null;
    const conditions = ["tenant_id = ?"];
    const params = [tenantId];

    if (q) {
      conditions.push("(email LIKE ? OR name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    const result = await query(
      `SELECT id, email, name, status, created_at
       FROM users
       WHERE ${conditions.join(" AND ")}
       ORDER BY name, email
       LIMIT 200`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.post(
  "/users",
  requirePermission("security.role_assignment.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["email", "name", "password"]);
    const email = normalizeUserEmail(req.body.email);
    const name = normalizeUserName(req.body.name);
    const password = validateUserPassword(req.body.password);
    const status = normalizeUserStatus(req.body.status);

    const existingUserResult = await query(
      `SELECT id, tenant_id
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );
    if (existingUserResult.rows[0]) {
      throw badRequest("email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let createdUserId = null;
    try {
      const result = await query(
        `INSERT INTO users (
           tenant_id,
           email,
           password_hash,
           name,
           status
         )
         VALUES (?, ?, ?, ?, ?)`,
        [tenantId, email, passwordHash, name, status]
      );
      createdUserId = parsePositiveInt(result.rows.insertId);
    } catch (err) {
      if (err?.errno === 1062) {
        throw badRequest("email already exists");
      }
      throw err;
    }

    await logRbacAuditEvent(req, {
      tenantId,
      targetUserId: createdUserId,
      action: "user.create",
      resourceType: "user",
      resourceId: createdUserId,
      scopeType: "TENANT",
      scopeId: tenantId,
      payload: {
        userId: createdUserId,
        email,
        name,
        status,
      },
    });

    return res.status(201).json({
      ok: true,
      id: createdUserId,
      tenantId,
    });
  })
);

router.post(
  "/invites",
  requirePermission("security.role_assignment.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    assertRequiredFields(req.body, ["email", "name"]);

    const idempotencyKey = parseIdempotencyKey(req, { required: false });
    const actorUserId = parsePositiveInt(req.user?.userId);
    const result = await executeIdempotentRequest({
      scopeCode: `SECURITY_INVITES_TENANT_${tenantId}`,
      idempotencyKey,
      requestFingerprintInput: {
        tenantId,
        actorUserId,
        email: String(req.body.email || "").trim().toLowerCase(),
        name: String(req.body.name || "").trim(),
      },
      execute: async () => {
        const invite = await createInviteForTenantUser({
          tenantId,
          actorUserId,
          email: req.body.email,
          name: req.body.name,
        });

        await logRbacAuditEvent(req, {
          tenantId,
          targetUserId: invite.userId,
          action: "user.invite.create",
          resourceType: "user_invite",
          resourceId: invite.id,
          scopeType: "TENANT",
          scopeId: tenantId,
          payload: {
            userId: invite.userId,
            email: invite.email,
            expiresAt: invite.expiresAt,
          },
        });

        return {
          status: 201,
          payload: {
            ok: true,
            invite,
          },
        };
      },
    });

    return res.status(result.status).json({
      ...result.payload,
      idempotentReplay: Boolean(result.idempotentReplay),
    });
  })
);

router.get(
  "/entity-branch-operators",
  requirePermission(ENTITY_USER_ADMIN_PERMISSION),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const branchOperatorRole = await getBranchOperatorRoleForTenant(tenantId);

    const operatingUnitParams = [tenantId];
    const operatingUnitConditions = ["ou.tenant_id = ?"];
    operatingUnitConditions.push(buildScopeFilter(req, "operating_unit", "ou.id", operatingUnitParams));

    const operatingUnitResult = await query(
      `SELECT
         ou.id,
         ou.code,
         ou.name,
         ou.status,
         ou.unit_type,
         ou.legal_entity_id,
         le.code AS legal_entity_code,
         le.name AS legal_entity_name,
         le.status AS legal_entity_status
       FROM operating_units ou
       JOIN legal_entities le
         ON le.id = ou.legal_entity_id
        AND le.tenant_id = ou.tenant_id
       WHERE ${operatingUnitConditions.join(" AND ")}
       ORDER BY le.code, ou.code, ou.id`,
      operatingUnitParams
    );

    const assignmentParams = [tenantId, parsePositiveInt(branchOperatorRole.id)];
    const assignmentConditions = [
      "urs.tenant_id = ?",
      "urs.role_id = ?",
      "urs.scope_type = 'OPERATING_UNIT'",
      "urs.effect = 'ALLOW'",
    ];
    assignmentConditions.push(
      buildScopeFilter(req, "operating_unit", "urs.scope_id", assignmentParams)
    );

    const assignmentResult = await query(
      `SELECT
         urs.id,
         urs.user_id,
         u.email AS user_email,
         u.name AS user_name,
         u.status AS user_status,
         urs.scope_id AS operating_unit_id,
         ou.code AS operating_unit_code,
         ou.name AS operating_unit_name,
         ou.status AS operating_unit_status,
         le.id AS legal_entity_id,
         le.code AS legal_entity_code,
         le.name AS legal_entity_name,
         le.status AS legal_entity_status,
         urs.created_at
       FROM user_role_scopes urs
       JOIN users u
         ON u.id = urs.user_id
        AND u.tenant_id = urs.tenant_id
       JOIN operating_units ou
         ON ou.id = urs.scope_id
        AND ou.tenant_id = urs.tenant_id
       JOIN legal_entities le
         ON le.id = ou.legal_entity_id
        AND le.tenant_id = ou.tenant_id
       WHERE ${assignmentConditions.join(" AND ")}
       ORDER BY le.code, ou.code, u.name, u.email, urs.id`,
      assignmentParams
    );

    return res.json({
      tenantId,
      role: {
        id: parsePositiveInt(branchOperatorRole.id),
        code: branchOperatorRole.code,
        name: branchOperatorRole.name,
      },
      operatingUnits: operatingUnitResult.rows || [],
      assignments: assignmentResult.rows || [],
    });
  })
);

router.post(
  "/entity-branch-operators",
  requirePermission(ENTITY_USER_ADMIN_PERMISSION, {
    resolveScope: (req) => {
      const operatingUnitId = parsePositiveInt(req.body?.operatingUnitId);
      if (!operatingUnitId) {
        return null;
      }
      return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["email", "name", "operatingUnitId"]);
    const email = normalizeUserEmail(req.body.email);
    const name = normalizeUserName(req.body.name);
    const operatingUnitId = parsePositiveInt(req.body.operatingUnitId);
    if (!operatingUnitId) {
      throw badRequest("operatingUnitId must be a positive integer");
    }

    await assertOperatingUnitBelongsToTenant(tenantId, operatingUnitId, "operatingUnitId");
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");

    const actorUserId = parsePositiveInt(req.user?.userId);
    const operation = await withTransaction(async (tx) => {
      const branchOperatorRole = await getBranchOperatorRoleForTenant(tenantId, tx.query);
      const existingUser = await lookupUserByEmail(email, tx.query);
      const existingUserId = parsePositiveInt(existingUser?.id);

      if (existingUserId && parsePositiveInt(existingUser?.tenant_id) !== tenantId) {
        throw badRequest("email already exists");
      }

      if (existingUserId) {
        // Explicit data scopes override permission-derived scope, so those users
        // stay on the full security-admin workflow instead of this delegated UI.
        await assertUserHasNoExplicitDataScopes(tenantId, existingUserId, tx.query);
      }

      let invite = null;
      let userId = existingUserId;
      if (!existingUserId || String(existingUser?.status || "").toUpperCase() !== "ACTIVE") {
        invite = await createInviteForTenantUser({
          tenantId,
          actorUserId,
          email,
          name,
          runQuery: tx.query,
        });
        userId = parsePositiveInt(invite.userId);
      }

      const userResult = await tx.query(
        `SELECT id, email, name, status
         FROM users
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1`,
        [userId, tenantId]
      );
      const managedUser = userResult.rows[0] || null;
      if (!managedUser) {
        throw new Error("Unable to resolve tenant user after branch operator invite flow");
      }

      const existingAssignmentResult = await tx.query(
        `SELECT id, effect
         FROM user_role_scopes
         WHERE tenant_id = ?
           AND user_id = ?
           AND role_id = ?
           AND scope_type = 'OPERATING_UNIT'
           AND scope_id = ?
         LIMIT 1`,
        [tenantId, userId, parsePositiveInt(branchOperatorRole.id), operatingUnitId]
      );
      const existingAssignment = existingAssignmentResult.rows[0] || null;
      if (String(existingAssignment?.effect || "").toUpperCase() === "DENY") {
        // A delegated entity admin must not silently remove a central deny row.
        throw badRequest("Branch operator deny assignments must be managed by Security Admin");
      }

      if (!existingAssignment) {
        await tx.query(
          `INSERT INTO user_role_scopes (
             tenant_id,
             user_id,
             role_id,
             scope_type,
             scope_id,
             effect
           )
           VALUES (?, ?, ?, 'OPERATING_UNIT', ?, 'ALLOW')`,
          [tenantId, userId, parsePositiveInt(branchOperatorRole.id), operatingUnitId]
        );
      }

      const currentAssignmentResult = await tx.query(
        `SELECT id
         FROM user_role_scopes
         WHERE tenant_id = ?
           AND user_id = ?
           AND role_id = ?
           AND scope_type = 'OPERATING_UNIT'
           AND scope_id = ?
         LIMIT 1`,
        [tenantId, userId, parsePositiveInt(branchOperatorRole.id), operatingUnitId]
      );

      return {
        branchOperatorRole,
        managedUser,
        invite,
        assignmentId:
          parsePositiveInt(currentAssignmentResult.rows[0]?.id) ||
          parsePositiveInt(existingAssignment?.id),
        assignmentCreated: !existingAssignment,
      };
    });

    await invalidateRbacCache(tenantId);

    if (operation.invite) {
      await logRbacAuditEvent(req, {
        tenantId,
        targetUserId: parsePositiveInt(operation.managedUser.id),
        action: "entity_user_admin.branch_operator.invite",
        resourceType: "user_invite",
        resourceId: parsePositiveInt(operation.invite.id),
        scopeType: "OPERATING_UNIT",
        scopeId: operatingUnitId,
        payload: {
          userId: parsePositiveInt(operation.managedUser.id),
          email: operation.managedUser.email,
          expiresAt: operation.invite.expiresAt,
          roleCode: operation.branchOperatorRole.code,
        },
      });
    }

    if (operation.assignmentCreated) {
      await logRbacAuditEvent(req, {
        tenantId,
        targetUserId: parsePositiveInt(operation.managedUser.id),
        action: "entity_user_admin.branch_operator.assignment.create",
        resourceType: "user_role_scope",
        resourceId: operation.assignmentId,
        scopeType: "OPERATING_UNIT",
        scopeId: operatingUnitId,
        payload: {
          userId: parsePositiveInt(operation.managedUser.id),
          roleId: parsePositiveInt(operation.branchOperatorRole.id),
          roleCode: operation.branchOperatorRole.code,
          effect: "ALLOW",
        },
      });
    }

    return res.status(operation.invite || operation.assignmentCreated ? 201 : 200).json({
      ok: true,
      assignmentCreated: operation.assignmentCreated,
      assignmentId: operation.assignmentId,
      role: {
        id: parsePositiveInt(operation.branchOperatorRole.id),
        code: operation.branchOperatorRole.code,
        name: operation.branchOperatorRole.name,
      },
      user: {
        id: parsePositiveInt(operation.managedUser.id),
        email: operation.managedUser.email,
        name: operation.managedUser.name,
        status: operation.managedUser.status,
      },
      invite: operation.invite
        ? {
            id: parsePositiveInt(operation.invite.id),
            userId: parsePositiveInt(operation.invite.userId),
            email: operation.invite.email,
            name: operation.invite.name,
            status: operation.invite.status,
            expiresAt: operation.invite.expiresAt,
            inviteUrl: operation.invite.inviteUrl,
          }
        : null,
    });
  })
);

router.delete(
  "/entity-branch-operators/:assignmentId",
  requirePermission(ENTITY_USER_ADMIN_PERMISSION),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const assignmentId = parsePositiveInt(req.params.assignmentId);
    if (!assignmentId) {
      throw badRequest("assignmentId must be a positive integer");
    }

    const assignmentResult = await query(
      `SELECT
         urs.id,
         urs.user_id,
         urs.scope_type,
         urs.scope_id,
         urs.effect,
         r.id AS role_id,
         r.code AS role_code,
         u.email AS user_email,
         u.name AS user_name
       FROM user_role_scopes urs
       JOIN roles r
         ON r.id = urs.role_id
        AND r.tenant_id = urs.tenant_id
       JOIN users u
         ON u.id = urs.user_id
        AND u.tenant_id = urs.tenant_id
       WHERE urs.id = ?
         AND urs.tenant_id = ?
       LIMIT 1`,
      [assignmentId, tenantId]
    );
    const assignment = assignmentResult.rows[0] || null;
    if (
      !assignment ||
      String(assignment.role_code || "") !== BRANCH_OPERATOR_ROLE_CODE ||
      String(assignment.scope_type || "").toUpperCase() !== "OPERATING_UNIT" ||
      String(assignment.effect || "").toUpperCase() !== "ALLOW"
    ) {
      throw badRequest("Branch operator assignment not found");
    }

    const operatingUnitId = parsePositiveInt(assignment.scope_id);
    assertScopeAccess(req, "operating_unit", operatingUnitId, "assignmentId");

    await query(
      `DELETE FROM user_role_scopes
       WHERE id = ?
         AND tenant_id = ?`,
      [assignmentId, tenantId]
    );
    await invalidateRbacCache(tenantId);

    await logRbacAuditEvent(req, {
      tenantId,
      targetUserId: parsePositiveInt(assignment.user_id),
      action: "entity_user_admin.branch_operator.assignment.delete",
      resourceType: "user_role_scope",
      resourceId: assignmentId,
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
      payload: {
        userId: parsePositiveInt(assignment.user_id),
        roleId: parsePositiveInt(assignment.role_id),
        roleCode: assignment.role_code,
      },
    });

    return res.json({ ok: true });
  })
);

router.get(
  "/roles",
  requirePermission("security.role.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const includeRetiredLegacy =
      parseBoolean(req.query.includeRetiredLegacy) || parseBoolean(req.query.includeLegacy);
    const includePermissions = parseBoolean(req.query.includePermissions);
    const result = await query(
      `SELECT id, tenant_id, code, name, is_system, created_at
       FROM roles
       WHERE tenant_id = ?
       ORDER BY code`,
      [tenantId]
    );

    const rows = result.rows || [];
    const enrichedRows = rows.map((row) => ({
      ...row,
      legacyDisabled: false,
      legacyRetired: isRetiredLegacyRoleCode(row.code),
    }));
    const disabledRoleCodeSet = await loadActiveLegacyDisabledRoleCodeSet(tenantId);
    for (const row of enrichedRows) {
      row.legacyDisabled = disabledRoleCodeSet.has(String(row.code || "").trim());
    }
    const visibleRows = includeRetiredLegacy
      ? enrichedRows
      : enrichedRows.filter((row) => !row.legacyRetired);
    if (!includePermissions || visibleRows.length === 0) {
      return res.json({ tenantId, rows: visibleRows });
    }

    const roleIds = visibleRows.map((row) => row.id);
    const permissionResult = await query(
      `SELECT rp.role_id, p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id IN (${roleIds.map(() => "?").join(", ")})
       ORDER BY rp.role_id, p.code`,
      roleIds
    );

    const codesByRoleId = new Map();
    for (const row of permissionResult.rows) {
      if (!codesByRoleId.has(row.role_id)) {
        codesByRoleId.set(row.role_id, []);
      }
      codesByRoleId.get(row.role_id).push(row.code);
    }

    const enriched = visibleRows.map((row) => ({
      ...row,
      permissionCodes: codesByRoleId.get(row.id) || [],
    }));

    return res.json({
      tenantId,
      rows: enriched,
    });
  })
);

router.post(
  "/roles",
  requirePermission("security.role.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["code", "name"]);
    const code = String(req.body.code).trim();
    const name = String(req.body.name).trim();
    const isSystem = Boolean(req.body.isSystem);
    assertRetiredLegacyRoleNotManaged(code);

    const existingRoleResult = await query(
      `SELECT id
       FROM roles
       WHERE tenant_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, code]
    );
    const existingRoleId = parsePositiveInt(existingRoleResult.rows[0]?.id);

    const result = await query(
      `INSERT INTO roles (tenant_id, code, name, is_system)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_system = VALUES(is_system)`,
      [tenantId, code, name, isSystem]
    );

    const roleId = result.rows.insertId || existingRoleId || null;
    const wasCreated = !existingRoleId && Boolean(result.rows.insertId);

    if (wasCreated) {
      await logRbacAuditEvent(req, {
        tenantId,
        action: "role.create",
        resourceType: "role",
        resourceId: roleId,
        payload: {
          code,
          name,
          isSystem,
        },
      });
    }

    return res.status(201).json({ ok: true, id: roleId });
  })
);

router.get(
  "/roles/:roleId/permissions",
  requirePermission("security.role.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const roleId = parsePositiveInt(req.params.roleId);
    if (!roleId) {
      throw badRequest("roleId must be a positive integer");
    }

    const role = await getRoleForTenant(roleId, tenantId);
    if (!role) {
      throw badRequest("Role not found");
    }

    const permissionResult = await query(
      `SELECT p.id, p.code, p.description
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.code`,
      [roleId]
    );

    return res.json({
      role,
      permissions: permissionResult.rows,
    });
  })
);

router.post(
  "/roles/:roleId/permissions",
  requirePermission("security.role_permissions.assign"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const roleId = parsePositiveInt(req.params.roleId);
    if (!roleId) {
      throw badRequest("roleId must be a positive integer");
    }

    const role = await getRoleForTenant(roleId, tenantId);
    if (!role) {
      throw badRequest("Role not found");
    }
    assertRetiredLegacyRoleNotManaged(role);

    const permissionCodes = Array.isArray(req.body?.permissionCodes)
      ? normalizePermissionCodeList(req.body.permissionCodes)
      : [];

    if (permissionCodes.length === 0) {
      throw badRequest("permissionCodes must be a non-empty array");
    }

    const currentPermissionCodes = await loadRolePermissionCodes(roleId);
    const nextPermissionCodes = normalizePermissionCodeList([
      ...currentPermissionCodes,
      ...permissionCodes,
    ]);
    const validation = validateRolePermissionSetOrThrow(role.code, nextPermissionCodes);

    await withTransaction(async (tx) => {
      for (const permissionCode of permissionCodes) {
        // eslint-disable-next-line no-await-in-loop
        const permissionId = await upsertPermissionAndGetId(permissionCode, tx.query);

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT IGNORE INTO role_permissions (role_id, permission_id)
           VALUES (?, ?)`,
          [roleId, permissionId]
        );
      }
    });
    await invalidateRbacCache(tenantId);

    return res.status(201).json({
      ok: true,
      roleId,
      assignedPermissionCount: permissionCodes.length,
      validationWarnings: validation.warnings,
    });
  })
);

router.put(
  "/roles/:roleId/permissions",
  requirePermission("security.role_permissions.assign"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const roleId = parsePositiveInt(req.params.roleId);
    if (!roleId) {
      throw badRequest("roleId must be a positive integer");
    }

    const role = await getRoleForTenant(roleId, tenantId);
    if (!role) {
      throw badRequest("Role not found");
    }
    assertRetiredLegacyRoleNotManaged(role);

    const permissionCodesRaw = Array.isArray(req.body?.permissionCodes)
      ? req.body.permissionCodes
      : null;
    if (!permissionCodesRaw) {
      throw badRequest("permissionCodes must be an array");
    }

    const normalizedPermissionCodes = Array.from(
      new Set(permissionCodesRaw.map((code) => String(code).trim()).filter(Boolean))
    );
    const validation = validateRolePermissionSetOrThrow(role.code, normalizedPermissionCodes);

    const beforeCodes = await withTransaction(async (tx) => {
      const beforeResult = await tx.query(
        `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?
         ORDER BY p.code`,
        [roleId]
      );
      const beforeCodeRows = beforeResult.rows.map((row) => row.code);

      await tx.query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

      for (const permissionCode of normalizedPermissionCodes) {
        const permissionId = await upsertPermissionAndGetId(permissionCode, tx.query);
        await tx.query(
          `INSERT IGNORE INTO role_permissions (role_id, permission_id)
           VALUES (?, ?)`,
          [roleId, permissionId]
        );
      }

      return beforeCodeRows;
    });
    await invalidateRbacCache(tenantId);

    await logRbacAuditEvent(req, {
      tenantId,
      action: "role.permission.replace",
      resourceType: "role",
      resourceId: roleId,
      scopeType: "TENANT",
      scopeId: tenantId,
      payload: {
        roleCode: role.code,
        beforePermissionCodes: beforeCodes,
        afterPermissionCodes: normalizedPermissionCodes,
      },
    });

    return res.json({
      ok: true,
      roleId,
      permissionCount: normalizedPermissionCodes.length,
      validationWarnings: validation.warnings,
    });
  })
);

router.get(
  "/role-assignments",
  requirePermission("security.role_assignment.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const userId = parsePositiveInt(req.query.userId);
    const roleId = parsePositiveInt(req.query.roleId);
    const scopeId = parsePositiveInt(req.query.scopeId);
    const scopeType = req.query.scopeType
      ? String(req.query.scopeType).toUpperCase()
      : null;

    const conditions = ["urs.tenant_id = ?"];
    const params = [tenantId];

    if (userId) {
      conditions.push("urs.user_id = ?");
      params.push(userId);
    }
    if (roleId) {
      conditions.push("urs.role_id = ?");
      params.push(roleId);
    }
    if (scopeType) {
      conditions.push("urs.scope_type = ?");
      params.push(scopeType);
    }
    if (scopeId) {
      conditions.push("urs.scope_id = ?");
      params.push(scopeId);
    }

    const result = await query(
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
       JOIN users u ON u.id = urs.user_id
       JOIN roles r ON r.id = urs.role_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY urs.id DESC`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.post(
  "/role-assignments",
  requirePermission("security.role_assignment.upsert", {
    resolveScope: (req, tenantId) => {
      const scopeType = String(req.body?.scopeType || "TENANT").toUpperCase();
      const scopeId =
        parsePositiveInt(req.body?.scopeId) || parsePositiveInt(tenantId);
      return { scopeType, scopeId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, [
      "userId",
      "roleId",
      "scopeType",
      "scopeId",
      "effect",
    ]);

    const userId = parsePositiveInt(req.body.userId);
    const roleId = parsePositiveInt(req.body.roleId);
    const scopeId = parsePositiveInt(req.body.scopeId);
    const scopeType = normalizeScopeType(req.body.scopeType);
    const effect = normalizeEffect(req.body.effect);

    if (!userId || !roleId || !scopeId) {
      throw badRequest("userId, roleId and scopeId must be positive integers");
    }

    await assertUserBelongsToTenant(tenantId, userId, "userId");
    const role = await getRoleForTenant(roleId, tenantId);
    if (!role) {
      throw badRequest("Role not found");
    }
    await assertSystemRoleManageAllowed(req, tenantId, role);
    await assertRoleAssignmentUpsertAllowed(tenantId, role);
    await assertScopeTargetExists(tenantId, scopeType, scopeId);

    const existingResult = await query(
      `SELECT id, effect, effective_from, effective_to
       FROM user_role_scopes
       WHERE tenant_id = ?
         AND user_id = ?
         AND role_id = ?
         AND scope_type = ?
         AND scope_id = ?
       LIMIT 1`,
      [tenantId, userId, roleId, scopeType, scopeId]
    );
    const existingAssignment = existingResult.rows[0] || null;
    const existingAssignmentId = parsePositiveInt(existingAssignment?.id);
    const effectiveDates = resolveAssignmentEffectiveDates(req.body, existingAssignment);
    const assignmentWarnings = await buildCombinedRoleAssignmentWarnings({
      tenantId,
      userId,
      scopeType,
      scopeId,
      includeRoleId: roleId,
      effect,
      asOfDate: effectiveDates.effectiveFrom,
    });

    await query(
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
        tenantId,
        userId,
        roleId,
        scopeType,
        scopeId,
        effect,
        effectiveDates.effectiveFrom,
        effectiveDates.effectiveTo,
      ]
    );
    await invalidateRbacCache(tenantId);

    const currentResult = await query(
      `SELECT id
       FROM user_role_scopes
       WHERE tenant_id = ?
         AND user_id = ?
         AND role_id = ?
         AND scope_type = ?
         AND scope_id = ?
       LIMIT 1`,
      [tenantId, userId, roleId, scopeType, scopeId]
    );
    const currentAssignmentId = parsePositiveInt(currentResult.rows[0]?.id);

    if (!existingAssignmentId) {
      await logRbacAuditEvent(req, {
        tenantId,
        targetUserId: userId,
        action: "assignment.create",
        resourceType: "user_role_scope",
        scopeType,
        scopeId,
        payload: {
          userId,
          roleId,
          scopeType,
          scopeId,
          effect,
          effectiveFrom: effectiveDates.effectiveFrom,
          effectiveTo: effectiveDates.effectiveTo,
        },
      });
    }

    return res.status(201).json({
      ok: true,
      created: !existingAssignmentId,
      assignmentId: currentAssignmentId || existingAssignmentId || null,
      effectiveFrom: effectiveDates.effectiveFrom,
      effectiveTo: effectiveDates.effectiveTo,
      assignmentWarnings,
    });
  })
);

router.put(
  "/role-assignments/:assignmentId/scope",
  requirePermission("security.role_assignment.upsert", {
    resolveScope: (req, tenantId) => {
      const scopeType = String(req.body?.scopeType || "TENANT").toUpperCase();
      const scopeId =
        parsePositiveInt(req.body?.scopeId) || parsePositiveInt(tenantId);
      return { scopeType, scopeId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const assignmentId = parsePositiveInt(req.params.assignmentId);
    if (!assignmentId) {
      throw badRequest("assignmentId must be a positive integer");
    }

    assertRequiredFields(req.body, ["scopeType", "scopeId", "effect"]);

    const scopeType = normalizeScopeType(req.body.scopeType);
    const scopeId = parsePositiveInt(req.body.scopeId);
    const effect = normalizeEffect(req.body.effect);

    if (!scopeId) {
      throw badRequest("scopeId must be a positive integer");
    }

    await assertScopeTargetExists(tenantId, scopeType, scopeId);

    const assignmentResult = await query(
      `SELECT
         id,
         user_id,
         role_id,
         scope_type,
         scope_id,
         effect,
         effective_from,
         effective_to
       FROM user_role_scopes
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [assignmentId, tenantId]
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) {
      throw badRequest("Role assignment not found");
    }
    const role = await getRoleForTenant(assignment.role_id, tenantId);
    if (!role) {
      throw badRequest("Role not found");
    }
    await assertSystemRoleManageAllowed(req, tenantId, role);
    await assertRoleAssignmentUpsertAllowed(tenantId, role);
    const effectiveDates = resolveAssignmentEffectiveDates(req.body, assignment);
    const assignmentWarnings = await buildCombinedRoleAssignmentWarnings({
      tenantId,
      userId: assignment.user_id,
      scopeType,
      scopeId,
      includeRoleId: assignment.role_id,
      excludeAssignmentId: assignmentId,
      effect,
      asOfDate: effectiveDates.effectiveFrom,
    });

    const oldScopeType = String(assignment.scope_type || "").toLowerCase();
    const oldScopeId = parsePositiveInt(assignment.scope_id);
    if (oldScopeType && oldScopeType !== "tenant" && oldScopeId) {
      assertScopeAccess(req, oldScopeType, oldScopeId, "existing scope");
    }

    await query(
      `UPDATE user_role_scopes
       SET scope_type = ?,
           scope_id = ?,
           effect = ?,
           effective_from = ?,
           effective_to = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [
        scopeType,
        scopeId,
        effect,
        effectiveDates.effectiveFrom,
        effectiveDates.effectiveTo,
        assignmentId,
        tenantId,
      ]
    );
    await invalidateRbacCache(tenantId);

    await logRbacAuditEvent(req, {
      tenantId,
      targetUserId: parsePositiveInt(assignment.user_id),
      action: "assignment.scope_replace",
      resourceType: "user_role_scope",
      resourceId: assignmentId,
      scopeType,
      scopeId,
      payload: {
        assignmentId,
        userId: parsePositiveInt(assignment.user_id),
        roleId: parsePositiveInt(assignment.role_id),
        before: {
          scopeType: String(assignment.scope_type || "").toUpperCase(),
          scopeId: parsePositiveInt(assignment.scope_id),
          effect: String(assignment.effect || "").toUpperCase(),
          effectiveFrom: toDateOnly(assignment.effective_from),
          effectiveTo: toDateOnly(assignment.effective_to),
        },
        after: {
          scopeType,
          scopeId,
          effect,
          effectiveFrom: effectiveDates.effectiveFrom,
          effectiveTo: effectiveDates.effectiveTo,
        },
      },
    });

    return res.json({
      ok: true,
      assignmentId,
      scopeType,
      scopeId,
      effect,
      effectiveFrom: effectiveDates.effectiveFrom,
      effectiveTo: effectiveDates.effectiveTo,
      assignmentWarnings,
    });
  })
);

router.delete(
  "/role-assignments/:assignmentId",
  requirePermission("security.role_assignment.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const assignmentId = parsePositiveInt(req.params.assignmentId);
    if (!assignmentId) {
      throw badRequest("assignmentId must be a positive integer");
    }

    const assignmentResult = await query(
      `SELECT
         urs.id,
         urs.role_id,
         r.code AS role_code,
         r.is_system
       FROM user_role_scopes urs
       LEFT JOIN roles r
         ON r.id = urs.role_id
        AND r.tenant_id = urs.tenant_id
       WHERE urs.id = ?
         AND urs.tenant_id = ?
       LIMIT 1`,
      [assignmentId, tenantId]
    );
    const assignment = assignmentResult.rows[0] || null;
    if (assignment) {
      await assertSystemRoleManageAllowed(req, tenantId, assignment);
    }

    await query(
      `DELETE FROM user_role_scopes
       WHERE id = ?
         AND tenant_id = ?`,
      [assignmentId, tenantId]
    );
    await invalidateRbacCache(tenantId);

    return res.json({ ok: true });
  })
);

router.get(
  "/admin-ui-state",
  requirePermission("security.role.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const actorUserId = parsePositiveInt(req.user?.userId);
    const canManageSystemRoles = await canManageSecurity(actorUserId, tenantId);
    const roleMigrations = await getRoleMigrationUiState(tenantId);

    return res.json({
      tenantId,
      canManageSecurity: canManageSystemRoles,
      roleMigrations: {
        ...roleMigrations,
        shouldShowInNavigation:
          canManageSystemRoles && Boolean(roleMigrations.shouldShowInNavigation),
      },
    });
  })
);

router.get(
  "/field-visibility-policies",
  requirePermission("security.field_visibility.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const rows = await listFieldVisibilityPoliciesForActor({
      actorUserId: parsePositiveInt(req.user?.userId),
      tenantId,
      includeInactive: parseBoolean(req.query.includeInactive),
      moduleCode: req.query.moduleCode || null,
      objectType: req.query.objectType || null,
      fieldName: req.query.fieldName || null,
    });

    return res.json({
      tenantId,
      rows,
    });
  })
);

router.get(
  "/field-visibility-policies/:policyId",
  requirePermission("security.field_visibility.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const policyId = parsePositiveInt(req.params.policyId);
    if (!policyId) {
      throw badRequest("policyId must be a positive integer");
    }

    const row = await getFieldVisibilityPolicyById({
      tenantId,
      policyId,
    });
    if (!row) {
      throw badRequest("Field visibility policy not found");
    }

    await assertFieldVisibilityPolicyPermission({
      actorUserId: parsePositiveInt(req.user?.userId),
      tenantId,
      permissionCode: "security.field_visibility.read",
      policyOrScope: row,
    });

    return res.json(row);
  })
);

router.post(
  "/field-visibility-policies",
  requirePermission("security.field_visibility.write"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const normalizedScope = await assertFieldVisibilityPolicyScopeBelongsToTenant(
      tenantId,
      req.body?.appliesToScopeType,
      req.body?.appliesToScopeId
    );
    await assertFieldVisibilityPolicyPermission({
      actorUserId: parsePositiveInt(req.user?.userId),
      tenantId,
      permissionCode: "security.field_visibility.write",
      policyOrScope: resolveFieldVisibilityPolicyManagementScope(
        normalizedScope,
        tenantId
      ),
    });

    const row = await createFieldVisibilityPolicy({
      tenantId,
      actorUserId: parsePositiveInt(req.user?.userId),
      input: {
        ...req.body,
        appliesToScopeType: normalizedScope.appliesToScopeType || "GLOBAL",
        appliesToScopeId: normalizedScope.appliesToScopeId,
      },
    });

    await logRbacAuditEvent(req, {
      tenantId,
      action: "field_visibility_policy.create",
      resourceType: "field_visibility_policy",
      resourceId: row?.id,
      scopeType:
        row?.appliesToScopeType ||
        resolveFieldVisibilityPolicyManagementScope(row, tenantId).scopeType,
      scopeId:
        row?.appliesToScopeId ||
        resolveFieldVisibilityPolicyManagementScope(row, tenantId).scopeId,
      payload: row,
    });

    return res.status(201).json(row);
  })
);

router.put(
  "/field-visibility-policies/:policyId",
  requirePermission("security.field_visibility.write"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const policyId = parsePositiveInt(req.params.policyId);
    if (!policyId) {
      throw badRequest("policyId must be a positive integer");
    }

    const existingRow = await getFieldVisibilityPolicyById({
      tenantId,
      policyId,
    });
    if (!existingRow) {
      throw badRequest("Field visibility policy not found");
    }

    await assertFieldVisibilityPolicyPermission({
      actorUserId: parsePositiveInt(req.user?.userId),
      tenantId,
      permissionCode: "security.field_visibility.write",
      policyOrScope: existingRow,
    });

    const normalizedScope = await assertFieldVisibilityPolicyScopeBelongsToTenant(
      tenantId,
      req.body?.appliesToScopeType ?? existingRow.appliesToScopeType ?? "GLOBAL",
      req.body?.appliesToScopeId ?? existingRow.appliesToScopeId
    );
    await assertFieldVisibilityPolicyPermission({
      actorUserId: parsePositiveInt(req.user?.userId),
      tenantId,
      permissionCode: "security.field_visibility.write",
      policyOrScope: resolveFieldVisibilityPolicyManagementScope(
        normalizedScope,
        tenantId
      ),
    });

    const row = await updateFieldVisibilityPolicy({
      tenantId,
      policyId,
      input: {
        ...req.body,
        appliesToScopeType: normalizedScope.appliesToScopeType || "GLOBAL",
        appliesToScopeId: normalizedScope.appliesToScopeId,
      },
    });

    await logRbacAuditEvent(req, {
      tenantId,
      action: "field_visibility_policy.update",
      resourceType: "field_visibility_policy",
      resourceId: row?.id,
      scopeType:
        row?.appliesToScopeType ||
        resolveFieldVisibilityPolicyManagementScope(row, tenantId).scopeType,
      scopeId:
        row?.appliesToScopeId ||
        resolveFieldVisibilityPolicyManagementScope(row, tenantId).scopeId,
      payload: row,
    });

    return res.json(row);
  })
);

router.delete(
  "/field-visibility-policies/:policyId",
  requirePermission("security.field_visibility.write"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const policyId = parsePositiveInt(req.params.policyId);
    if (!policyId) {
      throw badRequest("policyId must be a positive integer");
    }

    const existingRow = await getFieldVisibilityPolicyById({
      tenantId,
      policyId,
    });
    if (!existingRow) {
      throw badRequest("Field visibility policy not found");
    }

    await assertFieldVisibilityPolicyPermission({
      actorUserId: parsePositiveInt(req.user?.userId),
      tenantId,
      permissionCode: "security.field_visibility.write",
      policyOrScope: existingRow,
    });

    const row = await deactivateFieldVisibilityPolicy({
      tenantId,
      policyId,
    });

    await logRbacAuditEvent(req, {
      tenantId,
      action: "field_visibility_policy.deactivate",
      resourceType: "field_visibility_policy",
      resourceId: row?.id,
      scopeType:
        row?.appliesToScopeType ||
        resolveFieldVisibilityPolicyManagementScope(row, tenantId).scopeType,
      scopeId:
        row?.appliesToScopeId ||
        resolveFieldVisibilityPolicyManagementScope(row, tenantId).scopeId,
      payload: row,
    });

    return res.json({
      ok: true,
      row,
    });
  })
);

router.get(
  "/role-migrations",
  requirePermission("security.role.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    await assertSecurityMigrationManageAllowed(req, tenantId);
    const runs = await listRoleMigrationRuns({ tenantId });

    return res.json({
      tenantId,
      rows: runs,
    });
  })
);

router.post(
  "/role-migrations/preview",
  requirePermission("security.role_assignment.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    await assertSecurityMigrationManageAllowed(req, tenantId);
    const run = await createRoleMigrationPreviewRun({
      tenantId,
      actorUserId: parsePositiveInt(req.user?.userId),
      sourceRoleCodes: normalizeRoleCodeList(req.body?.sourceRoleCodes),
    });

    await logRbacAuditEvent(req, {
      tenantId,
      action: "role_migration.preview",
      resourceType: "role_migration_run",
      resourceId: run?.id,
      scopeType: "TENANT",
      scopeId: tenantId,
      payload: {
        runId: run?.id || null,
        mappingVersion: run?.mappingVersion || null,
        previewSummary: run?.previewSummary || null,
      },
    });

    return res.status(201).json(run);
  })
);

router.get(
  "/role-migrations/:runId",
  requirePermission("security.role.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    await assertSecurityMigrationManageAllowed(req, tenantId);
    const run = await getRoleMigrationRunDetail({ tenantId, runId });
    if (!run) {
      throw badRequest("Role migration run not found");
    }

    return res.json(run);
  })
);

router.post(
  "/role-migrations/:runId/execute",
  requirePermission("security.role_assignment.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    await assertSecurityMigrationManageAllowed(req, tenantId);
    const run = await executeRoleMigrationRun({
      tenantId,
      runId,
      actorUserId: parsePositiveInt(req.user?.userId),
      itemIds: normalizePositiveIntList(req.body?.itemIds),
    });

    await logRbacAuditEvent(req, {
      tenantId,
      action: "role_migration.execute",
      resourceType: "role_migration_run",
      resourceId: run?.id,
      scopeType: "TENANT",
      scopeId: tenantId,
      payload: {
        runId: run?.id || null,
        executionSummary: run?.executionSummary || null,
      },
    });

    return res.json(run);
  })
);

router.post(
  "/role-migrations/:runId/rollback",
  requirePermission("security.role_assignment.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    await assertSecurityMigrationManageAllowed(req, tenantId);
    const run = await rollbackRoleMigrationRun({
      tenantId,
      runId,
      actorUserId: parsePositiveInt(req.user?.userId),
    });

    await logRbacAuditEvent(req, {
      tenantId,
      action: "role_migration.rollback",
      resourceType: "role_migration_run",
      resourceId: run?.id,
      scopeType: "TENANT",
      scopeId: tenantId,
      payload: {
        runId: run?.id || null,
        rollbackSummary: run?.rollbackSummary || null,
      },
    });

    return res.json(run);
  })
);

router.get(
  "/data-scopes",
  requirePermission("security.data_scope.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const userId = parsePositiveInt(req.query.userId);
    const scopeType = req.query.scopeType
      ? String(req.query.scopeType).toUpperCase()
      : null;
    const scopeId = parsePositiveInt(req.query.scopeId);

    const conditions = ["ds.tenant_id = ?"];
    const params = [tenantId];

    if (userId) {
      conditions.push("ds.user_id = ?");
      params.push(userId);
    }
    if (scopeType) {
      conditions.push("ds.scope_type = ?");
      params.push(scopeType);
    }
    if (scopeId) {
      conditions.push("ds.scope_id = ?");
      params.push(scopeId);
    }

    const result = await query(
      `SELECT
         ds.id,
         ds.tenant_id,
         ds.user_id,
         u.email AS user_email,
         u.name AS user_name,
         ds.scope_type,
         ds.scope_id,
         ds.effect,
         ds.created_by_user_id,
         ds.created_at,
         ds.updated_at
       FROM data_scopes ds
       JOIN users u ON u.id = ds.user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ds.id DESC`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.post(
  "/data-scopes",
  requirePermission("security.data_scope.upsert", {
    resolveScope: (req, tenantId) => {
      const scopeType = String(req.body?.scopeType || "TENANT").toUpperCase();
      const scopeId =
        parsePositiveInt(req.body?.scopeId) || parsePositiveInt(tenantId);
      return { scopeType, scopeId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["userId", "scopeType", "scopeId"]);
    const userId = parsePositiveInt(req.body.userId);
    const scopeType = normalizeScopeType(req.body.scopeType);
    const scopeId = parsePositiveInt(req.body.scopeId);
    const effect = normalizeEffect(req.body.effect);
    const createdByUserId = parsePositiveInt(req.user?.userId);

    if (!userId || !scopeId) {
      throw badRequest("userId and scopeId must be positive integers");
    }

    await assertUserBelongsToTenant(tenantId, userId, "userId");
    await assertScopeTargetExists(tenantId, scopeType, scopeId);

    await query(
      `INSERT INTO data_scopes (
          tenant_id, user_id, scope_type, scope_id, effect, created_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         effect = VALUES(effect),
         created_by_user_id = VALUES(created_by_user_id)`,
      [tenantId, userId, scopeType, scopeId, effect, createdByUserId]
    );
    await invalidateRbacCache(tenantId);

    return res.status(201).json({ ok: true });
  })
);

router.put(
  "/data-scopes/users/:userId/replace",
  requirePermission("security.data_scope.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const userId = parsePositiveInt(req.params.userId);
    if (!userId) {
      throw badRequest("userId must be a positive integer");
    }
    await assertUserBelongsToTenant(tenantId, userId, "userId");

    const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : null;
    if (!scopes) {
      throw badRequest("scopes must be an array");
    }

    const normalizedScopes = [];
    const seenScopeKeys = new Set();
    for (const scope of scopes) {
      const scopeType = normalizeScopeType(scope?.scopeType);
      const scopeId = parsePositiveInt(scope?.scopeId);
      const effect = normalizeEffect(scope?.effect);
      if (!scopeId) {
        throw badRequest("Each scope item requires a positive scopeId");
      }
      const scopeKey = `${scopeType}:${scopeId}`;
      if (seenScopeKeys.has(scopeKey)) {
        throw badRequest(`Duplicate scope is not allowed: ${scopeKey}`);
      }
      seenScopeKeys.add(scopeKey);
      // Enforce scope target ownership/existence before replacing all scopes.
      // This prevents deleting valid rows when payload contains invalid scope references.
      // Validation runs outside transaction to fail fast.
      // eslint-disable-next-line no-await-in-loop
      await assertScopeTargetExists(tenantId, scopeType, scopeId);
      normalizedScopes.push({ scopeType, scopeId, effect });
    }

    const createdByUserId = parsePositiveInt(req.user?.userId);

    const beforeRows = await withTransaction(async (tx) => {
      const beforeResult = await tx.query(
        `SELECT scope_type, scope_id, effect
         FROM data_scopes
         WHERE tenant_id = ?
           AND user_id = ?
         ORDER BY scope_type, scope_id`,
        [tenantId, userId]
      );

      await tx.query(
        `DELETE FROM data_scopes
         WHERE tenant_id = ?
           AND user_id = ?`,
        [tenantId, userId]
      );

      for (const scope of normalizedScopes) {
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO data_scopes (
              tenant_id, user_id, scope_type, scope_id, effect, created_by_user_id
           )
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            userId,
            scope.scopeType,
            scope.scopeId,
            scope.effect,
            createdByUserId,
          ]
        );
      }

      return beforeResult.rows;
    });
    await invalidateRbacCache(tenantId);

    await logRbacAuditEvent(req, {
      tenantId,
      targetUserId: userId,
      action: "assignment.scope_replace",
      resourceType: "data_scope",
      resourceId: userId,
      scopeType: "TENANT",
      scopeId: tenantId,
      payload: {
        userId,
        beforeScopes: beforeRows,
        afterScopes: normalizedScopes,
      },
    });

    return res.json({
      ok: true,
      userId,
      scopeCount: normalizedScopes.length,
    });
  })
);

router.delete(
  "/data-scopes/:dataScopeId",
  requirePermission("security.data_scope.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const dataScopeId = parsePositiveInt(req.params.dataScopeId);
    if (!dataScopeId) {
      throw badRequest("dataScopeId must be a positive integer");
    }

    await query(
      `DELETE FROM data_scopes
       WHERE id = ?
         AND tenant_id = ?`,
      [dataScopeId, tenantId]
    );
    await invalidateRbacCache(tenantId);

    return res.json({ ok: true });
  })
);

export default router;
