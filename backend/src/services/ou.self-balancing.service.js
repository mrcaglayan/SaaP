import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function describeOperatingUnit(row, fallbackId) {
  const code = String(row?.code || row?.operating_unit_code || "").trim();
  const name = String(row?.name || row?.operating_unit_name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || `#${parsePositiveInt(fallbackId) || "?"}`;
}

function describeOperatingUnitPair(row, sourceOperatingUnitId, targetOperatingUnitId) {
  const source = describeOperatingUnit(
    {
      code: row?.operating_unit_code,
      name: row?.operating_unit_name,
    },
    sourceOperatingUnitId
  );
  const target = describeOperatingUnit(
    {
      code: row?.partner_operating_unit_code,
      name: row?.partner_operating_unit_name,
    },
    targetOperatingUnitId
  );
  return `${source} -> ${target}`;
}

function buildCentralContextError(row, operatingUnitId, detail) {
  const label = describeOperatingUnit(row, operatingUnitId);
  return badRequest(
    `Operating unit ${label} central/OU self-balancing setup is invalid for cross-context posting: ${detail}. Configure all four central <-> OU current-account fields in Organization Management before posting.`
  );
}

function buildPartnerContextError(row, sourceOperatingUnitId, targetOperatingUnitId, detail) {
  const label = describeOperatingUnitPair(row, sourceOperatingUnitId, targetOperatingUnitId);
  return badRequest(
    `Operating unit pair ${label} self-balancing setup is invalid for cross-context posting: ${detail}. Configure both directional partner current-account mappings in Organization Management before posting.`
  );
}

function toAccount(row, prefix) {
  return {
    id: parsePositiveInt(row?.[`${prefix}_id`]),
    code: String(row?.[`${prefix}_code`] || ""),
    name: String(row?.[`${prefix}_name`] || ""),
  };
}

async function assertUniqueOperatingUnitColumnTx(
  tx,
  { tenantId, legalEntityId, operatingUnitId, accountId, columnName, fieldLabel, row }
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    return;
  }

  const duplicateResult = await tx.query(
    `SELECT id, code, name
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND ${columnName} = ?
       AND id <> ?
     LIMIT 1`,
    [tenantId, legalEntityId, normalizedAccountId, operatingUnitId]
  );
  const duplicateRow = duplicateResult.rows?.[0] || null;
  if (!duplicateRow) {
    return;
  }

  throw buildCentralContextError(
    row,
    operatingUnitId,
    `${fieldLabel} is also assigned to operating unit ${describeOperatingUnit(
      duplicateRow,
      duplicateRow.id
    )}; branch-specific current-account mappings must be unique within the legal entity`
  );
}

async function assertUniquePartnerMappingAccountTx(
  tx,
  {
    tenantId,
    legalEntityId,
    sourceOperatingUnitId,
    targetOperatingUnitId,
    accountId,
    columnName,
    fieldLabel,
    row,
  }
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    return;
  }

  const duplicateResult = await tx.query(
    `SELECT
       map.operating_unit_id,
       map.partner_operating_unit_id,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       partner.code AS partner_operating_unit_code,
       partner.name AS partner_operating_unit_name
     FROM operating_unit_partner_current_accounts map
     JOIN operating_units ou
       ON ou.id = map.operating_unit_id
     JOIN operating_units partner
       ON partner.id = map.partner_operating_unit_id
     WHERE map.tenant_id = ?
       AND map.legal_entity_id = ?
       AND map.${columnName} = ?
       AND NOT (
         map.operating_unit_id = ?
         AND map.partner_operating_unit_id = ?
       )
     LIMIT 1`,
    [
      tenantId,
      legalEntityId,
      normalizedAccountId,
      sourceOperatingUnitId,
      targetOperatingUnitId,
    ]
  );
  const duplicateRow = duplicateResult.rows?.[0] || null;
  if (!duplicateRow) {
    return;
  }

  throw buildPartnerContextError(
    row,
    sourceOperatingUnitId,
    targetOperatingUnitId,
    `${fieldLabel} is also assigned to pair ${describeOperatingUnitPair(
      duplicateRow,
      duplicateRow.operating_unit_id,
      duplicateRow.partner_operating_unit_id
    )}; partner current-account mappings must be unique per direction within the legal entity`
  );
}

function validateAccountField(row, spec, buildError) {
  const accountId = parsePositiveInt(row?.[`${spec.prefix}_id`]);
  if (!accountId) {
    throw buildError(`required ${spec.label} mapping is missing`);
  }
  if (parsePositiveInt(row?.[`${spec.prefix}_legal_entity_id`]) !== parsePositiveInt(spec.legalEntityId)) {
    throw buildError(`${spec.label} must belong to the same legal entity`);
  }
  if (asUpper(row?.[`${spec.prefix}_type`]) !== spec.expectedAccountType) {
    throw buildError(`${spec.label} must be an ${spec.expectedAccountType} account`);
  }
  if (asUpper(row?.[`${spec.prefix}_normal_side`]) !== spec.expectedNormalSide) {
    throw buildError(`${spec.label} must have ${spec.expectedNormalSide} normal side`);
  }
  if (!parseDbBoolean(row?.[`${spec.prefix}_is_active`])) {
    throw buildError(`${spec.label} must be active`);
  }
  if (!parseDbBoolean(row?.[`${spec.prefix}_allow_posting`])) {
    throw buildError(`${spec.label} must be postable`);
  }
  if (parseDbBoolean(row?.[`${spec.prefix}_has_children`])) {
    throw buildError(`${spec.label} must be a leaf account`);
  }
}

async function loadOperatingUnitCentralPairTx(
  tx,
  { tenantId, legalEntityId, operatingUnitId, cache }
) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (!normalizedOperatingUnitId) {
    return null;
  }

  if (cache?.has(normalizedOperatingUnitId)) {
    return cache.get(normalizedOperatingUnitId);
  }

  const result = await tx.query(
    `SELECT
       ou.id,
       ou.legal_entity_id,
       ou.code,
       ou.name,
       ou.status,
       ou.central_due_from_account_id AS central_due_from_id,
       cdfa.code AS central_due_from_code,
       cdfa.name AS central_due_from_name,
       cdfa.account_type AS central_due_from_type,
       cdfa.normal_side AS central_due_from_normal_side,
       cdfa.allow_posting AS central_due_from_allow_posting,
       cdfa.is_active AS central_due_from_is_active,
       cdfc.legal_entity_id AS central_due_from_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = cdfa.id
           AND child.is_active = TRUE
       ) AS central_due_from_has_children,
       ou.central_due_to_account_id AS central_due_to_id,
       cdta.code AS central_due_to_code,
       cdta.name AS central_due_to_name,
       cdta.account_type AS central_due_to_type,
       cdta.normal_side AS central_due_to_normal_side,
       cdta.allow_posting AS central_due_to_allow_posting,
       cdta.is_active AS central_due_to_is_active,
       cdtc.legal_entity_id AS central_due_to_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = cdta.id
           AND child.is_active = TRUE
       ) AS central_due_to_has_children,
       ou.ou_due_from_central_account_id AS ou_due_from_central_id,
       odfa.code AS ou_due_from_central_code,
       odfa.name AS ou_due_from_central_name,
       odfa.account_type AS ou_due_from_central_type,
       odfa.normal_side AS ou_due_from_central_normal_side,
       odfa.allow_posting AS ou_due_from_central_allow_posting,
       odfa.is_active AS ou_due_from_central_is_active,
       odfc.legal_entity_id AS ou_due_from_central_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = odfa.id
           AND child.is_active = TRUE
       ) AS ou_due_from_central_has_children,
       ou.ou_due_to_central_account_id AS ou_due_to_central_id,
       odtq.code AS ou_due_to_central_code,
       odtq.name AS ou_due_to_central_name,
       odtq.account_type AS ou_due_to_central_type,
       odtq.normal_side AS ou_due_to_central_normal_side,
       odtq.allow_posting AS ou_due_to_central_allow_posting,
       odtq.is_active AS ou_due_to_central_is_active,
       odtqc.legal_entity_id AS ou_due_to_central_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = odtq.id
           AND child.is_active = TRUE
       ) AS ou_due_to_central_has_children
     FROM operating_units ou
     LEFT JOIN accounts cdfa
       ON cdfa.id = ou.central_due_from_account_id
     LEFT JOIN charts_of_accounts cdfc
       ON cdfc.id = cdfa.coa_id
     LEFT JOIN accounts cdta
       ON cdta.id = ou.central_due_to_account_id
     LEFT JOIN charts_of_accounts cdtc
       ON cdtc.id = cdta.coa_id
     LEFT JOIN accounts odfa
       ON odfa.id = ou.ou_due_from_central_account_id
     LEFT JOIN charts_of_accounts odfc
       ON odfc.id = odfa.coa_id
     LEFT JOIN accounts odtq
       ON odtq.id = ou.ou_due_to_central_account_id
     LEFT JOIN charts_of_accounts odtqc
       ON odtqc.id = odtq.coa_id
     WHERE ou.id = ?
       AND ou.tenant_id = ?
     LIMIT 1`,
    [normalizedOperatingUnitId, tenantId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("Operating unit mapping context not found for tenant");
  }
  if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw buildCentralContextError(
      row,
      normalizedOperatingUnitId,
      "operating unit does not belong to the requested legal entity"
    );
  }
  if (asUpper(row.status) !== "ACTIVE") {
    throw buildCentralContextError(
      row,
      normalizedOperatingUnitId,
      "operating unit must be ACTIVE"
    );
  }

  const validateForRow = (detail) =>
    buildCentralContextError(row, normalizedOperatingUnitId, detail);
  const fieldSpecs = [
    {
      prefix: "central_due_from",
      label: "Central Due From OU account",
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
      columnName: "central_due_from_account_id",
      legalEntityId,
    },
    {
      prefix: "central_due_to",
      label: "Central Due To OU account",
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
      columnName: "central_due_to_account_id",
      legalEntityId,
    },
    {
      prefix: "ou_due_from_central",
      label: "OU Due From Central account",
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
      columnName: "ou_due_from_central_account_id",
      legalEntityId,
    },
    {
      prefix: "ou_due_to_central",
      label: "OU Due To Central account",
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
      columnName: "ou_due_to_central_account_id",
      legalEntityId,
    },
  ];

  for (const spec of fieldSpecs) {
    validateAccountField(row, spec, validateForRow);
  }
  for (const spec of fieldSpecs) {
    // eslint-disable-next-line no-await-in-loop
    await assertUniqueOperatingUnitColumnTx(tx, {
      tenantId,
      legalEntityId,
      operatingUnitId: normalizedOperatingUnitId,
      accountId: row?.[`${spec.prefix}_id`],
      columnName: spec.columnName,
      fieldLabel: spec.label,
      row,
    });
  }

  const resolved = {
    operatingUnit: {
      id: normalizedOperatingUnitId,
      code: String(row.code || ""),
      name: String(row.name || ""),
    },
    centralDueFromAccount: toAccount(row, "central_due_from"),
    centralDueToAccount: toAccount(row, "central_due_to"),
    ouDueFromCentralAccount: toAccount(row, "ou_due_from_central"),
    ouDueToCentralAccount: toAccount(row, "ou_due_to_central"),
  };
  cache?.set(normalizedOperatingUnitId, resolved);
  return resolved;
}

async function loadPartnerCurrentMappingTx(
  tx,
  {
    tenantId,
    legalEntityId,
    sourceOperatingUnitId,
    targetOperatingUnitId,
    cache,
  }
) {
  const normalizedSourceOperatingUnitId = parsePositiveInt(sourceOperatingUnitId);
  const normalizedTargetOperatingUnitId = parsePositiveInt(targetOperatingUnitId);
  if (!normalizedSourceOperatingUnitId || !normalizedTargetOperatingUnitId) {
    return null;
  }
  if (normalizedSourceOperatingUnitId === normalizedTargetOperatingUnitId) {
    throw badRequest("sourceOperatingUnitId and targetOperatingUnitId must differ");
  }

  const cacheKey = `${normalizedSourceOperatingUnitId}:${normalizedTargetOperatingUnitId}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const result = await tx.query(
    `SELECT
       map.id,
       map.legal_entity_id,
       map.operating_unit_id,
       map.partner_operating_unit_id,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       ou.status AS operating_unit_status,
       ou.legal_entity_id AS operating_unit_legal_entity_id,
       partner.code AS partner_operating_unit_code,
       partner.name AS partner_operating_unit_name,
       partner.status AS partner_operating_unit_status,
       partner.legal_entity_id AS partner_operating_unit_legal_entity_id,
       map.due_from_account_id AS due_from_id,
       dfa.code AS due_from_code,
       dfa.name AS due_from_name,
       dfa.account_type AS due_from_type,
       dfa.normal_side AS due_from_normal_side,
       dfa.allow_posting AS due_from_allow_posting,
       dfa.is_active AS due_from_is_active,
       dfac.legal_entity_id AS due_from_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = dfa.id
           AND child.is_active = TRUE
       ) AS due_from_has_children,
       map.due_to_account_id AS due_to_id,
       dta.code AS due_to_code,
       dta.name AS due_to_name,
       dta.account_type AS due_to_type,
       dta.normal_side AS due_to_normal_side,
       dta.allow_posting AS due_to_allow_posting,
       dta.is_active AS due_to_is_active,
       dtac.legal_entity_id AS due_to_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = dta.id
           AND child.is_active = TRUE
       ) AS due_to_has_children
     FROM operating_unit_partner_current_accounts map
     JOIN operating_units ou
       ON ou.id = map.operating_unit_id
     JOIN operating_units partner
       ON partner.id = map.partner_operating_unit_id
     LEFT JOIN accounts dfa
       ON dfa.id = map.due_from_account_id
     LEFT JOIN charts_of_accounts dfac
       ON dfac.id = dfa.coa_id
     LEFT JOIN accounts dta
       ON dta.id = map.due_to_account_id
     LEFT JOIN charts_of_accounts dtac
       ON dtac.id = dta.coa_id
     WHERE map.tenant_id = ?
       AND map.operating_unit_id = ?
       AND map.partner_operating_unit_id = ?
     LIMIT 1`,
    [tenantId, normalizedSourceOperatingUnitId, normalizedTargetOperatingUnitId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw buildPartnerContextError(
      null,
      normalizedSourceOperatingUnitId,
      normalizedTargetOperatingUnitId,
      "required partner-specific current-account mappings are missing"
    );
  }
  if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw buildPartnerContextError(
      row,
      normalizedSourceOperatingUnitId,
      normalizedTargetOperatingUnitId,
      "mapping does not belong to the requested legal entity"
    );
  }
  if (
    parsePositiveInt(row.operating_unit_legal_entity_id) !== parsePositiveInt(legalEntityId) ||
    parsePositiveInt(row.partner_operating_unit_legal_entity_id) !== parsePositiveInt(legalEntityId)
  ) {
    throw buildPartnerContextError(
      row,
      normalizedSourceOperatingUnitId,
      normalizedTargetOperatingUnitId,
      "operating unit pair must belong to the requested legal entity"
    );
  }
  if (asUpper(row.operating_unit_status) !== "ACTIVE") {
    throw buildPartnerContextError(
      row,
      normalizedSourceOperatingUnitId,
      normalizedTargetOperatingUnitId,
      "source operating unit must be ACTIVE"
    );
  }
  if (asUpper(row.partner_operating_unit_status) !== "ACTIVE") {
    throw buildPartnerContextError(
      row,
      normalizedSourceOperatingUnitId,
      normalizedTargetOperatingUnitId,
      "target operating unit must be ACTIVE"
    );
  }

  const validateForRow = (detail) =>
    buildPartnerContextError(
      row,
      normalizedSourceOperatingUnitId,
      normalizedTargetOperatingUnitId,
      detail
    );
  validateAccountField(
    row,
    {
      prefix: "due_from",
      label: "Due From Partner OU account",
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
      legalEntityId,
    },
    validateForRow
  );
  validateAccountField(
    row,
    {
      prefix: "due_to",
      label: "Due To Partner OU account",
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
      legalEntityId,
    },
    validateForRow
  );

  await assertUniquePartnerMappingAccountTx(tx, {
    tenantId,
    legalEntityId,
    sourceOperatingUnitId: normalizedSourceOperatingUnitId,
    targetOperatingUnitId: normalizedTargetOperatingUnitId,
    accountId: row.due_from_id,
    columnName: "due_from_account_id",
    fieldLabel: "Due From Partner OU account",
    row,
  });
  await assertUniquePartnerMappingAccountTx(tx, {
    tenantId,
    legalEntityId,
    sourceOperatingUnitId: normalizedSourceOperatingUnitId,
    targetOperatingUnitId: normalizedTargetOperatingUnitId,
    accountId: row.due_to_id,
    columnName: "due_to_account_id",
    fieldLabel: "Due To Partner OU account",
    row,
  });

  const resolved = {
    mappingId: parsePositiveInt(row.id),
    sourceOperatingUnit: {
      id: normalizedSourceOperatingUnitId,
      code: String(row.operating_unit_code || ""),
      name: String(row.operating_unit_name || ""),
    },
    targetOperatingUnit: {
      id: normalizedTargetOperatingUnitId,
      code: String(row.partner_operating_unit_code || ""),
      name: String(row.partner_operating_unit_name || ""),
    },
    dueFromAccount: toAccount(row, "due_from"),
    dueToAccount: toAccount(row, "due_to"),
  };
  cache?.set(cacheKey, resolved);
  return resolved;
}

export async function resolveOuSelfBalancingAccountsTx(
  tx,
  { tenantId, legalEntityId, sourceOperatingUnitId = null, targetOperatingUnitId = null, cache }
) {
  if (!tx?.query || typeof tx.query !== "function") {
    throw badRequest("Transaction context is required");
  }

  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedSourceOperatingUnitId = parsePositiveInt(sourceOperatingUnitId);
  const normalizedTargetOperatingUnitId = parsePositiveInt(targetOperatingUnitId);
  if (!normalizedTenantId || !normalizedLegalEntityId) {
    throw badRequest("tenantId and legalEntityId must be positive integers");
  }
  if (!normalizedSourceOperatingUnitId && !normalizedTargetOperatingUnitId) {
    throw badRequest(
      "Cross-context self-balancing requires at least one operating unit context"
    );
  }
  if (
    normalizedSourceOperatingUnitId &&
    normalizedTargetOperatingUnitId &&
    normalizedSourceOperatingUnitId === normalizedTargetOperatingUnitId
  ) {
    throw badRequest(
      "sourceOperatingUnitId and targetOperatingUnitId must differ for cross-context self-balancing"
    );
  }

  const operatingUnitCache = cache?.operatingUnitById;
  const partnerMappingCache = cache?.partnerPairById;

  if (!normalizedSourceOperatingUnitId) {
    const targetConfig = await loadOperatingUnitCentralPairTx(tx, {
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
      operatingUnitId: normalizedTargetOperatingUnitId,
      cache: operatingUnitCache,
    });
    return {
      routeType: "CENTRAL_TO_OU",
      sourceContext: {
        type: "CENTRAL",
        operatingUnitId: null,
        code: "CENTRAL",
        name: "Central",
      },
      targetContext: {
        type: "OPERATING_UNIT",
        operatingUnitId: targetConfig.operatingUnit.id,
        code: targetConfig.operatingUnit.code,
        name: targetConfig.operatingUnit.name,
      },
      sourceDueFromAccount: targetConfig.centralDueFromAccount,
      sourceDueToAccount: targetConfig.centralDueToAccount,
      targetDueFromAccount: targetConfig.ouDueFromCentralAccount,
      targetDueToAccount: targetConfig.ouDueToCentralAccount,
    };
  }

  if (!normalizedTargetOperatingUnitId) {
    const sourceConfig = await loadOperatingUnitCentralPairTx(tx, {
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
      operatingUnitId: normalizedSourceOperatingUnitId,
      cache: operatingUnitCache,
    });
    return {
      routeType: "OU_TO_CENTRAL",
      sourceContext: {
        type: "OPERATING_UNIT",
        operatingUnitId: sourceConfig.operatingUnit.id,
        code: sourceConfig.operatingUnit.code,
        name: sourceConfig.operatingUnit.name,
      },
      targetContext: {
        type: "CENTRAL",
        operatingUnitId: null,
        code: "CENTRAL",
        name: "Central",
      },
      sourceDueFromAccount: sourceConfig.ouDueFromCentralAccount,
      sourceDueToAccount: sourceConfig.ouDueToCentralAccount,
      targetDueFromAccount: sourceConfig.centralDueFromAccount,
      targetDueToAccount: sourceConfig.centralDueToAccount,
    };
  }

  const sourceMapping = await loadPartnerCurrentMappingTx(tx, {
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    sourceOperatingUnitId: normalizedSourceOperatingUnitId,
    targetOperatingUnitId: normalizedTargetOperatingUnitId,
    cache: partnerMappingCache,
  });
  const targetMapping = await loadPartnerCurrentMappingTx(tx, {
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    sourceOperatingUnitId: normalizedTargetOperatingUnitId,
    targetOperatingUnitId: normalizedSourceOperatingUnitId,
    cache: partnerMappingCache,
  });

  return {
    routeType: "OU_TO_OU",
    sourceContext: {
      type: "OPERATING_UNIT",
      operatingUnitId: sourceMapping.sourceOperatingUnit.id,
      code: sourceMapping.sourceOperatingUnit.code,
      name: sourceMapping.sourceOperatingUnit.name,
    },
    targetContext: {
      type: "OPERATING_UNIT",
      operatingUnitId: sourceMapping.targetOperatingUnit.id,
      code: sourceMapping.targetOperatingUnit.code,
      name: sourceMapping.targetOperatingUnit.name,
    },
    sourceDueFromAccount: sourceMapping.dueFromAccount,
    sourceDueToAccount: sourceMapping.dueToAccount,
    targetDueFromAccount: targetMapping.dueFromAccount,
    targetDueToAccount: targetMapping.dueToAccount,
    sourcePartnerMappingId: sourceMapping.mappingId,
    targetPartnerMappingId: targetMapping.mappingId,
  };
}
