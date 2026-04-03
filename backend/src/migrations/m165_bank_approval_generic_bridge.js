const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

function normalizeUpper(value, fallback = "") {
  return String(value || fallback).trim().toUpperCase();
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toAmount(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(6)) : null;
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function mapLegacyPolicyScope(row) {
  const scopeType = normalizeUpper(row.scope_type, "GLOBAL");
  if (scopeType === "GLOBAL") {
    return {
      genericScopeType: "TENANT",
      genericScopeId: parsePositiveInt(row.tenant_id),
      assignmentScopeType: "TENANT",
      assignmentScopeId: parsePositiveInt(row.tenant_id),
    };
  }

  if (scopeType === "LEGAL_ENTITY") {
    const legalEntityId = parsePositiveInt(row.legal_entity_id);
    return {
      genericScopeType: "LEGAL_ENTITY",
      genericScopeId: legalEntityId,
      assignmentScopeType: "LEGAL_ENTITY",
      assignmentScopeId: legalEntityId,
    };
  }

  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  return {
    // Generic approval scope stays hierarchy-shaped. BANK_ACCOUNT specificity
    // remains a legacy-bank policy selection concern during the migration.
    genericScopeType: "LEGAL_ENTITY",
    genericScopeId: legalEntityId,
    assignmentScopeType: "LEGAL_ENTITY",
    assignmentScopeId: legalEntityId,
  };
}

async function upsertGenericMirrorForLegacyPolicy(connection, row) {
  const tenantId = parsePositiveInt(row.tenant_id);
  const legacyPolicyId = parsePositiveInt(row.id);
  if (!tenantId || !legacyPolicyId) {
    return null;
  }

  const mappedScope = mapLegacyPolicyScope(row);
  const moduleCode = normalizeUpper(row.module_code, "BANK");
  const approverPermissionCode =
    String(row.approver_permission_code || "").trim() ||
    (moduleCode === "PAYROLL"
      ? "approvals.requests.approve"
      : "bank.approvals.requests.approve");

  const [upsertResult] = await connection.execute(
    `INSERT INTO approval_policies (
       tenant_id,
       module_code,
       policy_code,
       policy_name,
       target_type,
       action_type,
       version_no,
       scope_type,
       scope_id,
       effective_from,
       effective_to,
       step_count,
       min_approvals,
       maker_checker_required,
       allow_self_approve,
       auto_execute_on_final_approval,
       escalation_after_hours,
       min_amount,
       max_amount,
       currency_code,
       approver_permission_code,
       is_active,
       created_by_user_id,
       updated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       policy_name = VALUES(policy_name),
       scope_type = VALUES(scope_type),
       scope_id = VALUES(scope_id),
       effective_from = VALUES(effective_from),
       effective_to = VALUES(effective_to),
       step_count = VALUES(step_count),
       min_approvals = VALUES(min_approvals),
       maker_checker_required = VALUES(maker_checker_required),
       allow_self_approve = VALUES(allow_self_approve),
       auto_execute_on_final_approval = VALUES(auto_execute_on_final_approval),
       min_amount = VALUES(min_amount),
       max_amount = VALUES(max_amount),
       currency_code = VALUES(currency_code),
       approver_permission_code = VALUES(approver_permission_code),
       is_active = VALUES(is_active),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      tenantId,
      moduleCode,
      String(row.policy_code || "").trim().toUpperCase(),
      String(row.policy_name || "").trim() || String(row.policy_code || "").trim().toUpperCase(),
      normalizeUpper(row.target_type),
      normalizeUpper(row.action_type),
      mappedScope.genericScopeType,
      mappedScope.genericScopeId,
      row.effective_from || null,
      row.effective_to || null,
      Math.max(1, Number(row.required_approvals || 1)),
      parseDbBoolean(row.maker_checker_required) ? 1 : 0,
      parseDbBoolean(row.maker_checker_required) ? 0 : 1,
      parseDbBoolean(row.auto_execute_on_final_approval) ? 1 : 0,
      toAmount(row.min_amount),
      toAmount(row.max_amount),
      normalizeUpper(row.currency_code || "") || null,
      approverPermissionCode,
      normalizeUpper(row.status, "ACTIVE") === "ACTIVE" ? 1 : 0,
      parsePositiveInt(row.created_by_user_id),
      parsePositiveInt(row.updated_by_user_id),
    ]
  );

  const genericPolicyId = parsePositiveInt(upsertResult?.insertId);
  if (!genericPolicyId) {
    return null;
  }

  await connection.execute(
    `UPDATE bank_approval_policies
     SET generic_policy_id = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [genericPolicyId, tenantId, legacyPolicyId]
  );

  await connection.execute(
    `DELETE FROM approval_policy_assignments
     WHERE tenant_id = ?
       AND policy_id = ?`,
    [tenantId, genericPolicyId]
  );
  await connection.execute(
    `INSERT INTO approval_policy_assignments (
       tenant_id,
       policy_id,
       scope_type,
       scope_id,
       effective_from,
       effective_to,
       is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      genericPolicyId,
      mappedScope.assignmentScopeType,
      mappedScope.assignmentScopeId,
      row.effective_from || null,
      row.effective_to || null,
      normalizeUpper(row.status, "ACTIVE") === "ACTIVE" ? 1 : 0,
    ]
  );

  await connection.execute(
    `DELETE FROM approval_policy_steps
     WHERE tenant_id = ?
       AND policy_id = ?`,
    [tenantId, genericPolicyId]
  );
  await connection.execute(
    `INSERT INTO approval_policy_steps (
       tenant_id,
       policy_id,
       step_no,
       required_permission_code,
       scope_resolution_mode,
       custom_scope_resolver_key,
       min_approvals,
       allow_self_approve,
       escalation_after_hours
     ) VALUES (?, ?, 1, ?, 'REQUEST_SCOPE', NULL, ?, ?, NULL)`,
    [
      tenantId,
      genericPolicyId,
      approverPermissionCode,
      Math.max(1, Number(row.required_approvals || 1)),
      parseDbBoolean(row.maker_checker_required) ? 0 : 1,
    ]
  );

  return genericPolicyId;
}

const migration165BankApprovalGenericBridge = {
  key: "m165_bank_approval_generic_bridge",
  description:
    "Bridge legacy bank approval policies and requests to the generic approval engine while preserving legacy audit tables.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE bank_approval_policies
         ADD COLUMN generic_policy_id BIGINT UNSIGNED NULL AFTER updated_by_user_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE bank_approval_policies
         ADD UNIQUE KEY uk_bap_generic_policy (tenant_id, generic_policy_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE bank_approval_policies
         ADD CONSTRAINT fk_bap_generic_policy
           FOREIGN KEY (tenant_id, generic_policy_id)
           REFERENCES approval_policies(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );

    await safeExecute(
      connection,
      `ALTER TABLE bank_approval_requests
         ADD COLUMN generic_request_id BIGINT UNSIGNED NULL AFTER policy_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE bank_approval_requests
         ADD UNIQUE KEY uk_bar_generic_request (tenant_id, generic_request_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE bank_approval_requests
         ADD CONSTRAINT fk_bar_generic_request
           FOREIGN KEY (tenant_id, generic_request_id)
           REFERENCES approval_requests(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );

    const [policyRows] = await connection.execute(
      `SELECT *
       FROM bank_approval_policies
       ORDER BY tenant_id ASC, id ASC`
    );
    for (const row of policyRows || []) {
      await upsertGenericMirrorForLegacyPolicy(connection, row);
    }
  },

  async down() {
    // Additive compatibility bridge only.
  },
};

export default migration165BankApprovalGenericBridge;
