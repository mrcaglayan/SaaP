import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function u(value) {
  return String(value || "").trim().toUpperCase();
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(6)) : null;
}

function toOptionalPositiveInt(value) {
  return parsePositiveInt(value) || null;
}

function normalizeEscalationTargetScopeMode(value) {
  const normalized = u(value || "");
  return normalized || null;
}

function pickExplicitOrFallback(explicitValue, fallbackValue) {
  return explicitValue === undefined ? fallbackValue : explicitValue;
}

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    module_code: u(row.module_code || "BANK"),
    min_amount: toAmount(row.min_amount),
    max_amount: toAmount(row.max_amount),
    maker_checker_required: parseDbBoolean(row.maker_checker_required),
    auto_execute_on_final_approval: parseDbBoolean(row.auto_execute_on_final_approval),
    required_approvals: Number(row.required_approvals || 1),
    escalation_after_hours: toOptionalPositiveInt(
      row.step_escalation_after_hours ?? row.escalation_after_hours
    ),
    escalation_target_scope_mode: normalizeEscalationTargetScopeMode(
      row.step_escalation_target_scope_mode
    ),
    escalation_max_count: toOptionalPositiveInt(row.step_escalation_max_count),
  };
}

function getAllowedLegalEntityIdsFromReq(req) {
  const ids = Array.from(req?.rbac?.scopeContext?.legalEntities || []);
  return ids.map((id) => parsePositiveInt(id)).filter(Boolean);
}

function buildPolicyScopeWhere(req, alias, params) {
  if (req?.rbac?.scopeContext?.tenantWide) return "1 = 1";
  const ids = getAllowedLegalEntityIdsFromReq(req);
  if (ids.length === 0) {
    return `${alias}.scope_type = 'GLOBAL'`;
  }
  params.push(...ids);
  return `(${alias}.scope_type = 'GLOBAL' OR ${alias}.legal_entity_id IN (${ids.map(() => "?").join(", ")}))`;
}

async function getPolicyByIdRaw({ tenantId, policyId, runQuery = query }) {
  const res = await runQuery(
    `SELECT
        p.*,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ba.code AS bank_account_code,
        ba.name AS bank_account_name,
        aps.escalation_after_hours AS step_escalation_after_hours,
        aps.escalation_target_scope_mode AS step_escalation_target_scope_mode,
        aps.escalation_max_count AS step_escalation_max_count
     FROM bank_approval_policies p
     LEFT JOIN legal_entities le
       ON le.tenant_id = p.tenant_id
      AND le.id = p.legal_entity_id
     LEFT JOIN bank_accounts ba
       ON ba.tenant_id = p.tenant_id
      AND ba.legal_entity_id = p.legal_entity_id
      AND ba.id = p.bank_account_id
     LEFT JOIN approval_policy_steps aps
       ON aps.tenant_id = p.tenant_id
      AND aps.policy_id = p.generic_policy_id
      AND aps.step_no = 1
     WHERE p.tenant_id = ?
       AND p.id = ?
     LIMIT 1`,
    [tenantId, policyId]
  );
  return hydrate(res.rows?.[0] || null);
}

function normalizeGenericPolicyScope(row) {
  const scopeType = u(row?.scope_type || "GLOBAL");
  if (scopeType === "GLOBAL") {
    return {
      scopeType: "TENANT",
      scopeId: parsePositiveInt(row?.tenant_id),
      assignmentScopeType: "TENANT",
      assignmentScopeId: parsePositiveInt(row?.tenant_id),
    };
  }

  if (scopeType === "LEGAL_ENTITY") {
    const legalEntityId = parsePositiveInt(row?.legal_entity_id);
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
      assignmentScopeType: "LEGAL_ENTITY",
      assignmentScopeId: legalEntityId,
    };
  }

  const legalEntityId = parsePositiveInt(row?.legal_entity_id);
  return {
    // BANK_ACCOUNT specificity stays in the legacy selector. The generic engine
    // receives the resolved request at legal-entity scope so it stays module-agnostic.
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
    assignmentScopeType: "LEGAL_ENTITY",
    assignmentScopeId: legalEntityId,
  };
}

function resolveGenericApproverPermissionCode(row) {
  const moduleCode = u(row?.module_code || "BANK");
  const configured = String(row?.approver_permission_code || "").trim();
  if (configured) {
    return configured;
  }
  return moduleCode === "PAYROLL"
    ? "approvals.requests.approve"
    : "bank.approvals.requests.approve";
}

async function getCurrentGenericPolicyStepConfig({
  tenantId,
  policyId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPolicyId = parsePositiveInt(policyId);
  if (!normalizedTenantId || !normalizedPolicyId) {
    return {
      escalationAfterHours: null,
      escalationTargetScopeMode: null,
      escalationMaxCount: null,
    };
  }
  const result = await runQuery(
    `SELECT
        escalation_after_hours,
        escalation_target_scope_mode,
        escalation_max_count
     FROM approval_policy_steps
     WHERE tenant_id = ?
       AND policy_id = ?
       AND step_no = 1
     LIMIT 1`,
    [normalizedTenantId, normalizedPolicyId]
  );
  const row = result.rows?.[0] || null;
  return {
    escalationAfterHours: toOptionalPositiveInt(row?.escalation_after_hours),
    escalationTargetScopeMode: normalizeEscalationTargetScopeMode(
      row?.escalation_target_scope_mode
    ),
    escalationMaxCount: toOptionalPositiveInt(row?.escalation_max_count),
  };
}

function resolveEffectiveEscalationStepConfig({
  legacyPolicyRow,
  currentStepConfig = null,
  stepConfigOverrides = null,
}) {
  const legacyEscalationAfterHours = toOptionalPositiveInt(
    legacyPolicyRow?.escalation_after_hours
  );
  return {
    escalationAfterHours: pickExplicitOrFallback(
      stepConfigOverrides?.escalationAfterHours,
      currentStepConfig?.escalationAfterHours ?? legacyEscalationAfterHours
    ),
    escalationTargetScopeMode: pickExplicitOrFallback(
      stepConfigOverrides?.escalationTargetScopeMode,
      currentStepConfig?.escalationTargetScopeMode ?? null
    ),
    escalationMaxCount: pickExplicitOrFallback(
      stepConfigOverrides?.escalationMaxCount,
      currentStepConfig?.escalationMaxCount ?? null
    ),
  };
}

async function upsertGenericPolicyMirrorTx({
  legacyPolicyRow,
  runQuery,
  stepConfigOverrides = null,
}) {
  const tenantId = parsePositiveInt(legacyPolicyRow?.tenant_id);
  const legacyPolicyId = parsePositiveInt(legacyPolicyRow?.id);
  if (!tenantId || !legacyPolicyId) {
    throw badRequest("Legacy bank approval policy row is invalid");
  }

  const mappedScope = normalizeGenericPolicyScope(legacyPolicyRow);
  const approverPermissionCode = resolveGenericApproverPermissionCode(legacyPolicyRow);
  const requestedEscalationAfterHours = pickExplicitOrFallback(
    stepConfigOverrides?.escalationAfterHours,
    toOptionalPositiveInt(legacyPolicyRow?.escalation_after_hours)
  );
  const insertRes = await runQuery(
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
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       escalation_after_hours = VALUES(escalation_after_hours),
       min_amount = VALUES(min_amount),
       max_amount = VALUES(max_amount),
       currency_code = VALUES(currency_code),
       approver_permission_code = VALUES(approver_permission_code),
       is_active = VALUES(is_active),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      tenantId,
      u(legacyPolicyRow.module_code || "BANK"),
      String(legacyPolicyRow.policy_code || "").trim().toUpperCase(),
      String(legacyPolicyRow.policy_name || "").trim() ||
        String(legacyPolicyRow.policy_code || "").trim().toUpperCase(),
      u(legacyPolicyRow.target_type),
      u(legacyPolicyRow.action_type),
      mappedScope.scopeType,
      mappedScope.scopeId,
      legacyPolicyRow.effective_from || null,
      legacyPolicyRow.effective_to || null,
      Math.max(1, Number(legacyPolicyRow.required_approvals || 1)),
      parseDbBoolean(legacyPolicyRow.maker_checker_required) ? 1 : 0,
      parseDbBoolean(legacyPolicyRow.maker_checker_required) ? 0 : 1,
      parseDbBoolean(legacyPolicyRow.auto_execute_on_final_approval) ? 1 : 0,
      requestedEscalationAfterHours,
      toAmount(legacyPolicyRow.min_amount),
      toAmount(legacyPolicyRow.max_amount),
      u(legacyPolicyRow.currency_code || "") || null,
      approverPermissionCode,
      u(legacyPolicyRow.status || "ACTIVE") === "ACTIVE" ? 1 : 0,
      parsePositiveInt(legacyPolicyRow.created_by_user_id),
      parsePositiveInt(legacyPolicyRow.updated_by_user_id),
    ]
  );
  const genericPolicyId = parsePositiveInt(insertRes.rows?.insertId);
  if (!genericPolicyId) {
    throw badRequest("Failed to mirror bank approval policy into generic approval_policies");
  }

  await runQuery(
    `UPDATE bank_approval_policies
     SET generic_policy_id = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [genericPolicyId, tenantId, legacyPolicyId]
  );
  const currentStepConfig = await getCurrentGenericPolicyStepConfig({
    tenantId,
    policyId: genericPolicyId,
    runQuery,
  });
  const effectiveStepConfig = resolveEffectiveEscalationStepConfig({
    legacyPolicyRow,
    currentStepConfig,
    stepConfigOverrides,
  });
  await runQuery(
    `DELETE FROM approval_policy_assignments
     WHERE tenant_id = ?
       AND policy_id = ?`,
    [tenantId, genericPolicyId]
  );
  await runQuery(
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
      legacyPolicyRow.effective_from || null,
      legacyPolicyRow.effective_to || null,
      u(legacyPolicyRow.status || "ACTIVE") === "ACTIVE" ? 1 : 0,
    ]
  );
  await runQuery(
    `DELETE FROM approval_policy_steps
     WHERE tenant_id = ?
       AND policy_id = ?`,
    [tenantId, genericPolicyId]
  );
  await runQuery(
    `INSERT INTO approval_policy_steps (
       tenant_id,
       policy_id,
       step_no,
       required_permission_code,
       scope_resolution_mode,
       custom_scope_resolver_key,
       min_approvals,
       allow_self_approve,
       escalation_after_hours,
       escalation_target_scope_mode,
       escalation_max_count
     ) VALUES (?, ?, 1, ?, 'REQUEST_SCOPE', NULL, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      genericPolicyId,
      approverPermissionCode,
      Math.max(1, Number(legacyPolicyRow.required_approvals || 1)),
      parseDbBoolean(legacyPolicyRow.maker_checker_required) ? 0 : 1,
      effectiveStepConfig.escalationAfterHours,
      effectiveStepConfig.escalationTargetScopeMode,
      effectiveStepConfig.escalationMaxCount,
    ]
  );

  return genericPolicyId;
}

async function getLegalEntityRow({ tenantId, legalEntityId }) {
  if (!parsePositiveInt(legalEntityId)) return null;
  const res = await query(
    `SELECT id, tenant_id, code, name
     FROM legal_entities
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  return res.rows?.[0] || null;
}

async function getBankAccountRow({ tenantId, bankAccountId }) {
  if (!parsePositiveInt(bankAccountId)) return null;
  const res = await query(
    `SELECT id, tenant_id, legal_entity_id, code, name, is_active
     FROM bank_accounts
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, bankAccountId]
  );
  return res.rows?.[0] || null;
}

function normalizePolicyScopeForWrite(input, current = null) {
  const next = {
    scopeType: u(input.scopeType ?? current?.scope_type ?? "GLOBAL"),
    legalEntityId:
      input.legalEntityId !== undefined ? parsePositiveInt(input.legalEntityId) : parsePositiveInt(current?.legal_entity_id),
    bankAccountId:
      input.bankAccountId !== undefined ? parsePositiveInt(input.bankAccountId) : parsePositiveInt(current?.bank_account_id),
  };

  if (!["GLOBAL", "LEGAL_ENTITY", "BANK_ACCOUNT"].includes(next.scopeType)) {
    throw badRequest("scopeType is invalid");
  }

  if (next.scopeType === "GLOBAL") {
    next.legalEntityId = null;
    next.bankAccountId = null;
  } else if (next.scopeType === "LEGAL_ENTITY") {
    if (!next.legalEntityId) throw badRequest("legalEntityId is required for LEGAL_ENTITY scope");
    next.bankAccountId = null;
  } else if (next.scopeType === "BANK_ACCOUNT") {
    if (!next.bankAccountId) throw badRequest("bankAccountId is required for BANK_ACCOUNT scope");
  }

  return next;
}

async function validatePolicyWriteContext({ req, tenantId, input, current = null, assertScopeAccess }) {
  const scope = normalizePolicyScopeForWrite(input, current);
  let legalEntityId = scope.legalEntityId;
  let bankAccountId = scope.bankAccountId;

  if (scope.scopeType === "BANK_ACCOUNT") {
    const ba = await getBankAccountRow({ tenantId, bankAccountId });
    if (!ba) throw badRequest("bankAccountId not found");
    if (!parseDbBoolean(ba.is_active)) throw badRequest("bankAccountId is inactive");
    legalEntityId = parsePositiveInt(ba.legal_entity_id);
  }

  if (legalEntityId) {
    const le = await getLegalEntityRow({ tenantId, legalEntityId });
    if (!le) throw badRequest("legalEntityId not found");
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", legalEntityId, bankAccountId ? "bankAccountId" : "legalEntityId");
    }
  }

  if (input.minAmount !== undefined && input.maxAmount !== undefined) {
    if (input.minAmount !== null && input.maxAmount !== null && Number(input.minAmount) > Number(input.maxAmount)) {
      throw badRequest("minAmount cannot exceed maxAmount");
    }
  }

  if (parsePositiveInt(input.requiredApprovals) && Number(input.requiredApprovals) < 1) {
    throw badRequest("requiredApprovals must be >= 1");
  }

  return {
    scopeType: scope.scopeType,
    legalEntityId: legalEntityId || null,
    bankAccountId: bankAccountId || null,
  };
}

export async function resolveBankApprovalPolicyScope(policyId, tenantId) {
  const parsedPolicyId = parsePositiveInt(policyId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedPolicyId || !parsedTenantId) return null;
  const row = await getPolicyByIdRaw({ tenantId: parsedTenantId, policyId: parsedPolicyId });
  if (!row) return null;
  if (parsePositiveInt(row.legal_entity_id)) {
    return { scopeType: "LEGAL_ENTITY", scopeId: parsePositiveInt(row.legal_entity_id) };
  }
  return null;
}

export async function listBankApprovalPolicies({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const where = ["p.tenant_id = ?"];
  where.push(buildPolicyScopeWhere(req, "p", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    where.push("(p.legal_entity_id = ? OR p.scope_type = 'GLOBAL')");
    params.push(filters.legalEntityId);
  }
  if (filters.bankAccountId) {
    const ba = await getBankAccountRow({ tenantId, bankAccountId: filters.bankAccountId });
    if (!ba) throw badRequest("bankAccountId not found");
    assertScopeAccess(req, "legal_entity", ba.legal_entity_id, "bankAccountId");
    where.push("(p.bank_account_id = ? OR p.scope_type = 'GLOBAL')");
    params.push(filters.bankAccountId);
  }
  if (filters.status) {
    where.push("p.status = ?");
    params.push(filters.status);
  }
  if (filters.moduleCode) {
    where.push("COALESCE(p.module_code, 'BANK') = ?");
    params.push(u(filters.moduleCode));
  }
  if (filters.targetType) {
    where.push("p.target_type = ?");
    params.push(filters.targetType);
  }
  if (filters.actionType) {
    where.push("p.action_type = ?");
    params.push(filters.actionType);
  }
  if (filters.scopeType) {
    where.push("p.scope_type = ?");
    params.push(filters.scopeType);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    where.push("(p.policy_code LIKE ? OR p.policy_name LIKE ?)");
    params.push(like, like);
  }

  const whereSql = where.join(" AND ");
  const countRes = await query(
    `SELECT COUNT(*) AS total
     FROM bank_approval_policies p
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countRes.rows?.[0]?.total || 0);

  const safeLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset = Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
  const listRes = await query(
    `SELECT
        p.*,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ba.code AS bank_account_code,
        ba.name AS bank_account_name
     FROM bank_approval_policies p
     LEFT JOIN legal_entities le
       ON le.tenant_id = p.tenant_id
      AND le.id = p.legal_entity_id
     LEFT JOIN bank_accounts ba
       ON ba.tenant_id = p.tenant_id
      AND ba.legal_entity_id = p.legal_entity_id
      AND ba.id = p.bank_account_id
     LEFT JOIN approval_policy_steps aps
       ON aps.tenant_id = p.tenant_id
      AND aps.policy_id = p.generic_policy_id
      AND aps.step_no = 1
     WHERE ${whereSql}
     ORDER BY
       CASE p.status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END,
       p.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (listRes.rows || []).map(hydrate),
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/**
 * Read one legacy bank/payroll approval policy row from the compatibility store.
 */
export async function getBankApprovalPolicyById({
  req,
  tenantId,
  policyId,
  assertScopeAccess,
}) {
  const row = await getPolicyByIdRaw({ tenantId, policyId });
  if (!row) throw badRequest("Approval policy not found");
  if (parsePositiveInt(row.legal_entity_id)) {
    assertScopeAccess(req, "legal_entity", row.legal_entity_id, "policyId");
  }
  return row;
}

/**
 * Ensure one legacy bank/payroll approval policy row has a current generic mirror.
 */
export async function ensureGenericPolicyForBankApprovalPolicy({
  tenantId,
  policyId,
  runQuery = query,
  stepConfigOverrides = null,
}) {
  const row = await getPolicyByIdRaw({ tenantId, policyId, runQuery });
  if (!row) {
    throw badRequest("Approval policy not found");
  }
  const genericPolicyId = await upsertGenericPolicyMirrorTx({
    legacyPolicyRow: row,
    runQuery,
    stepConfigOverrides,
  });
  return {
    genericPolicyId,
    row: await getPolicyByIdRaw({ tenantId, policyId, runQuery }),
  };
}

/**
 * Create one legacy bank/payroll approval policy and mirror it into the generic engine.
 */
export async function createBankApprovalPolicy({
  req,
  input,
  assertScopeAccess,
}) {
  const ctx = await validatePolicyWriteContext({
    req,
    tenantId: input.tenantId,
    input,
    current: null,
    assertScopeAccess,
  });

  return withTransaction(async (tx) => {
    const res = await tx.query(
      `INSERT INTO bank_approval_policies (
          tenant_id,
          policy_code,
          policy_name,
          module_code,
          status,
          target_type,
          action_type,
          scope_type,
          legal_entity_id,
          bank_account_id,
          currency_code,
          min_amount,
          max_amount,
          required_approvals,
          maker_checker_required,
          approver_permission_code,
          auto_execute_on_final_approval,
          effective_from,
          effective_to,
          created_by_user_id,
          updated_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        input.tenantId,
        input.policyCode,
        input.policyName,
        u(input.moduleCode || "BANK"),
        input.status,
        input.targetType,
        input.actionType,
        ctx.scopeType,
        ctx.legalEntityId,
        ctx.bankAccountId,
        input.currencyCode || null,
        input.minAmount === null ? null : toAmount(input.minAmount),
        input.maxAmount === null ? null : toAmount(input.maxAmount),
        input.requiredApprovals || 1,
        input.makerCheckerRequired ? 1 : 0,
        resolveGenericApproverPermissionCode({
          module_code: input.moduleCode || "BANK",
          approver_permission_code: input.approverPermissionCode,
        }),
        input.autoExecuteOnFinalApproval ? 1 : 0,
        input.effectiveFrom || null,
        input.effectiveTo || null,
        input.userId || null,
        input.userId || null,
      ]
    );
    const policyId = parsePositiveInt(res.rows?.insertId);
    await ensureGenericPolicyForBankApprovalPolicy({
      tenantId: input.tenantId,
      policyId,
      runQuery: tx.query,
      stepConfigOverrides: {
        escalationAfterHours: input.escalationAfterHours || null,
        escalationTargetScopeMode: input.escalationTargetScopeMode || null,
        escalationMaxCount: input.escalationMaxCount || null,
      },
    });
    return getPolicyByIdRaw({
      tenantId: input.tenantId,
      policyId,
      runQuery: tx.query,
    });
  });
}

/**
 * Update one legacy bank/payroll approval policy and refresh its generic mirror.
 */
export async function updateBankApprovalPolicy({
  req,
  input,
  assertScopeAccess,
}) {
  const current = await getPolicyByIdRaw({
    tenantId: input.tenantId,
    policyId: input.policyId,
  });
  if (!current) throw badRequest("Approval policy not found");
  if (parsePositiveInt(current.legal_entity_id)) {
    assertScopeAccess(req, "legal_entity", current.legal_entity_id, "policyId");
  }

  const merged = {
    ...current,
    ...input,
    moduleCode: input.moduleCode !== undefined ? input.moduleCode : current.module_code,
    scopeType: input.scopeType ?? current.scope_type,
    legalEntityId:
      input.legalEntityId !== undefined ? input.legalEntityId : current.legal_entity_id,
    bankAccountId:
      input.bankAccountId !== undefined ? input.bankAccountId : current.bank_account_id,
    minAmount: input.minAmount !== undefined ? input.minAmount : current.min_amount,
    maxAmount: input.maxAmount !== undefined ? input.maxAmount : current.max_amount,
    requiredApprovals:
      input.requiredApprovals !== undefined ? input.requiredApprovals : current.required_approvals,
    makerCheckerRequired:
      input.makerCheckerRequired !== undefined
        ? input.makerCheckerRequired
        : parseDbBoolean(current.maker_checker_required),
    autoExecuteOnFinalApproval:
      input.autoExecuteOnFinalApproval !== undefined
        ? input.autoExecuteOnFinalApproval
        : parseDbBoolean(current.auto_execute_on_final_approval),
    escalationAfterHours:
      input.escalationAfterHours !== undefined
        ? input.escalationAfterHours
        : toOptionalPositiveInt(current.escalation_after_hours),
    escalationTargetScopeMode:
      input.escalationTargetScopeMode !== undefined
        ? input.escalationTargetScopeMode
        : normalizeEscalationTargetScopeMode(current.escalation_target_scope_mode),
    escalationMaxCount:
      input.escalationMaxCount !== undefined
        ? input.escalationMaxCount
        : toOptionalPositiveInt(current.escalation_max_count),
  };
  const ctx = await validatePolicyWriteContext({
    req,
    tenantId: input.tenantId,
    input: merged,
    current,
    assertScopeAccess,
  });

  const nextMin = input.minAmount !== undefined ? input.minAmount : current.min_amount;
  const nextMax = input.maxAmount !== undefined ? input.maxAmount : current.max_amount;
  if (nextMin !== null && nextMin !== undefined && nextMax !== null && nextMax !== undefined) {
    if (Number(nextMin) > Number(nextMax)) throw badRequest("minAmount cannot exceed maxAmount");
  }

  return withTransaction(async (tx) => {
    await tx.query(
      `UPDATE bank_approval_policies
       SET policy_name = ?,
           module_code = ?,
           status = ?,
           scope_type = ?,
           legal_entity_id = ?,
           bank_account_id = ?,
           currency_code = ?,
           min_amount = ?,
           max_amount = ?,
           required_approvals = ?,
           maker_checker_required = ?,
           approver_permission_code = ?,
           auto_execute_on_final_approval = ?,
           effective_from = ?,
           effective_to = ?,
           updated_by_user_id = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        input.policyName !== undefined ? input.policyName : current.policy_name,
        input.moduleCode !== undefined
          ? u(input.moduleCode || "BANK")
          : u(current.module_code || "BANK"),
        input.status !== undefined ? input.status : current.status,
        ctx.scopeType,
        ctx.legalEntityId,
        ctx.bankAccountId,
        input.currencyCode !== undefined ? input.currencyCode : current.currency_code,
        nextMin === null ? null : toAmount(nextMin),
        nextMax === null ? null : toAmount(nextMax),
        input.requiredApprovals !== undefined ? input.requiredApprovals : current.required_approvals,
        input.makerCheckerRequired !== undefined
          ? (input.makerCheckerRequired ? 1 : 0)
          : Number(current.maker_checker_required ? 1 : 0),
        input.approverPermissionCode !== undefined
          ? resolveGenericApproverPermissionCode({
              module_code: input.moduleCode || current.module_code || "BANK",
              approver_permission_code: input.approverPermissionCode,
            })
          : resolveGenericApproverPermissionCode(current),
        input.autoExecuteOnFinalApproval !== undefined
          ? (input.autoExecuteOnFinalApproval ? 1 : 0)
          : Number(current.auto_execute_on_final_approval ? 1 : 0),
        input.effectiveFrom !== undefined ? input.effectiveFrom || null : current.effective_from || null,
        input.effectiveTo !== undefined ? input.effectiveTo || null : current.effective_to || null,
        input.userId || null,
        input.tenantId,
        input.policyId,
      ]
    );
    await ensureGenericPolicyForBankApprovalPolicy({
      tenantId: input.tenantId,
      policyId: input.policyId,
      runQuery: tx.query,
      stepConfigOverrides: {
        escalationAfterHours: merged.escalationAfterHours,
        escalationTargetScopeMode: merged.escalationTargetScopeMode,
        escalationMaxCount: merged.escalationMaxCount,
      },
    });
    return getPolicyByIdRaw({
      tenantId: input.tenantId,
      policyId: input.policyId,
      runQuery: tx.query,
    });
  });
}

export default {
  resolveBankApprovalPolicyScope,
  listBankApprovalPolicies,
  getBankApprovalPolicyById,
  ensureGenericPolicyForBankApprovalPolicy,
  createBankApprovalPolicy,
  updateBankApprovalPolicy,
};
