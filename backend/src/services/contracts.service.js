import { query, withTransaction } from "../db.js";
import { assertAccountBelongsToTenant } from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const CONTRACT_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
});

const CONTRACT_TYPE = Object.freeze({
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
});

const LINKABLE_CONTRACT_STATUSES = new Set([
  CONTRACT_STATUS.DRAFT,
  CONTRACT_STATUS.ACTIVE,
]);

const LINKABLE_DOCUMENT_STATUSES = new Set([
  "POSTED",
  "PARTIALLY_SETTLED",
  "SETTLED",
]);

const TRANSITIONS = Object.freeze({
  activate: {
    toStatus: CONTRACT_STATUS.ACTIVE,
    fromStatuses: new Set([CONTRACT_STATUS.DRAFT, CONTRACT_STATUS.SUSPENDED]),
  },
  suspend: {
    toStatus: CONTRACT_STATUS.SUSPENDED,
    fromStatuses: new Set([CONTRACT_STATUS.ACTIVE]),
  },
  close: {
    toStatus: CONTRACT_STATUS.CLOSED,
    fromStatuses: new Set([CONTRACT_STATUS.ACTIVE, CONTRACT_STATUS.SUSPENDED]),
  },
  cancel: {
    toStatus: CONTRACT_STATUS.CANCELLED,
    fromStatuses: new Set([CONTRACT_STATUS.DRAFT]),
  },
});

const EPSILON = 0.000001;

function toDecimalNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnlyString(value, label = "date") {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${label} must be a valid date`);
    }
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}(?:\b|T)/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} must be a valid date`);
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  return Number(value) === 1;
}

function toFixedAmount(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return "0.000000";
  }
  return parsed.toFixed(6);
}

function isDuplicateKeyError(err, constraintName = null) {
  const duplicate =
    Number(err?.errno) === 1062 ||
    String(err?.code || "").toUpperCase() === "ER_DUP_ENTRY";
  if (!duplicate) {
    return false;
  }
  if (!constraintName) {
    return true;
  }
  return String(err?.message || "").includes(constraintName);
}

function mapContractSummaryRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    counterpartyId: parsePositiveInt(row.counterparty_id),
    contractNo: row.contract_no,
    contractType: row.contract_type,
    status: row.status,
    currencyCode: row.currency_code,
    startDate: toDateOnlyString(row.start_date, "startDate"),
    endDate: toDateOnlyString(row.end_date, "endDate"),
    totalAmountTxn: toDecimalNumber(row.total_amount_txn),
    totalAmountBase: toDecimalNumber(row.total_amount_base),
    notes: row.notes || null,
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lineCount:
      row.line_count === undefined || row.line_count === null
        ? null
        : Number(row.line_count),
  };
}

function mapContractLineRow(row) {
  return {
    id: parsePositiveInt(row.id),
    lineNo: Number(row.line_no || 0),
    description: row.description || "",
    lineAmountTxn: toDecimalNumber(row.line_amount_txn),
    lineAmountBase: toDecimalNumber(row.line_amount_base),
    recognitionMethod: row.recognition_method,
    recognitionStartDate: toDateOnlyString(
      row.recognition_start_date,
      "recognitionStartDate"
    ),
    recognitionEndDate: toDateOnlyString(
      row.recognition_end_date,
      "recognitionEndDate"
    ),
    deferredAccountId: parsePositiveInt(row.deferred_account_id),
    revenueAccountId: parsePositiveInt(row.revenue_account_id),
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapContractDocumentLinkRow(row) {
  return {
    linkType: row.link_type,
    linkedAmountTxn: toDecimalNumber(row.linked_amount_txn),
    linkedAmountBase: toDecimalNumber(row.linked_amount_base),
    createdAt: row.created_at || null,
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    cariDocumentId: parsePositiveInt(row.cari_document_id),
    documentNo: row.document_no || null,
    direction: row.direction || null,
    status: row.status || null,
    documentDate: toDateOnlyString(row.document_date, "documentDate"),
    amountTxn: toDecimalNumber(row.amount_txn),
    amountBase: toDecimalNumber(row.amount_base),
  };
}

function assertCounterpartyRoleCompatibility(contractType, counterpartyRow) {
  if (!counterpartyRow) {
    throw badRequest("counterpartyId must belong to legalEntityId");
  }
  if (asUpper(contractType) === CONTRACT_TYPE.CUSTOMER && !toBoolean(counterpartyRow.is_customer)) {
    throw badRequest(
      "Counterparty role mismatch: CUSTOMER contracts require counterparty.is_customer=true"
    );
  }
  if (asUpper(contractType) === CONTRACT_TYPE.VENDOR && !toBoolean(counterpartyRow.is_vendor)) {
    throw badRequest(
      "Counterparty role mismatch: VENDOR contracts require counterparty.is_vendor=true"
    );
  }
}

function calculateHeaderTotals(lines) {
  let totalTxn = 0;
  let totalBase = 0;
  for (const line of lines || []) {
    if (asUpper(line.status) !== "ACTIVE") {
      continue;
    }
    totalTxn += Number(line.lineAmountTxn || 0);
    totalBase += Number(line.lineAmountBase || 0);
  }
  return {
    totalAmountTxn: toFixedAmount(totalTxn),
    totalAmountBase: toFixedAmount(totalBase),
  };
}

function expectedAccountType(contractType, accountRole) {
  const normalizedContractType = asUpper(contractType);
  const normalizedRole = asUpper(accountRole);

  if (normalizedContractType === CONTRACT_TYPE.CUSTOMER) {
    if (normalizedRole === "DEFERRED") {
      return "LIABILITY";
    }
    return "REVENUE";
  }

  if (normalizedRole === "DEFERRED") {
    return "ASSET";
  }
  return "EXPENSE";
}

function assertAccountCompatibility({
  accountRow,
  legalEntityId,
  contractType,
  accountRole,
  label,
}) {
  if (!accountRow) {
    throw badRequest(`${label} not found for tenant`);
  }
  if (asUpper(accountRow.scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${label} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(accountRow.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${label} must belong to contract legalEntityId`);
  }
  if (!toBoolean(accountRow.is_active)) {
    throw badRequest(`${label} must be active`);
  }
  if (!toBoolean(accountRow.allow_posting)) {
    throw badRequest(`${label} must allow posting`);
  }
  const expected = expectedAccountType(contractType, accountRole);
  if (asUpper(accountRow.account_type) !== expected) {
    throw badRequest(`${label} must have accountType=${expected} for contractType=${contractType}`);
  }
}

async function fetchContractRow({
  tenantId,
  contractId,
  runQuery = query,
  forUpdate = false,
}) {
  const lockSql = forUpdate ? " FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
        c.id,
        c.tenant_id,
        c.legal_entity_id,
        c.counterparty_id,
        c.contract_no,
        c.contract_type,
        c.status,
        c.currency_code,
        c.start_date,
        c.end_date,
        c.total_amount_txn,
        c.total_amount_base,
        c.notes,
        c.created_by_user_id,
        c.created_at,
        c.updated_at,
        (
          SELECT COUNT(*)
          FROM contract_lines cl
          WHERE cl.tenant_id = c.tenant_id
            AND cl.contract_id = c.id
        ) AS line_count
     FROM contracts c
     WHERE c.tenant_id = ?
       AND c.id = ?
     LIMIT 1${lockSql}`,
    [tenantId, contractId]
  );
  return result.rows?.[0] || null;
}

async function fetchCounterpartyRow({
  tenantId,
  legalEntityId,
  counterpartyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        is_customer,
        is_vendor,
        status
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, counterpartyId]
  );
  return result.rows?.[0] || null;
}

async function assertLegalEntityExists({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  if (!result.rows?.[0]) {
    throw badRequest("legalEntityId not found for tenant");
  }
}

async function assertCurrencyExists({
  currencyCode,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT code
     FROM currencies
     WHERE code = ?
     LIMIT 1`,
    [currencyCode]
  );
  if (!result.rows?.[0]) {
    throw badRequest("currencyCode not found");
  }
}

async function fetchAccountRow({
  tenantId,
  accountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        a.id,
        a.account_type,
        a.is_active,
        a.allow_posting,
        c.scope,
        c.legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId]
  );
  return result.rows?.[0] || null;
}

async function validateContractLineAccountsTx({
  tenantId,
  legalEntityId,
  contractType,
  lines,
  runQuery,
}) {
  for (let index = 0; index < (lines || []).length; index += 1) {
    const line = lines[index];
    const linePath = `lines[${index}]`;

    if (line.deferredAccountId) {
      await assertAccountBelongsToTenant(
        tenantId,
        line.deferredAccountId,
        `${linePath}.deferredAccountId`,
        { runQuery }
      );
      const deferredAccount = await fetchAccountRow({
        tenantId,
        accountId: line.deferredAccountId,
        runQuery,
      });
      assertAccountCompatibility({
        accountRow: deferredAccount,
        legalEntityId,
        contractType,
        accountRole: "DEFERRED",
        label: `${linePath}.deferredAccountId`,
      });
    }

    if (line.revenueAccountId) {
      await assertAccountBelongsToTenant(
        tenantId,
        line.revenueAccountId,
        `${linePath}.revenueAccountId`,
        { runQuery }
      );
      const revenueAccount = await fetchAccountRow({
        tenantId,
        accountId: line.revenueAccountId,
        runQuery,
      });
      assertAccountCompatibility({
        accountRow: revenueAccount,
        legalEntityId,
        contractType,
        accountRole: "REVENUE",
        label: `${linePath}.revenueAccountId`,
      });
    }
  }
}

async function replaceContractLinesTx({
  tenantId,
  contractId,
  lines,
  runQuery,
}) {
  await runQuery(
    `DELETE FROM contract_lines
     WHERE tenant_id = ?
       AND contract_id = ?`,
    [tenantId, contractId]
  );

  for (let index = 0; index < (lines || []).length; index += 1) {
    const line = lines[index];
    await runQuery(
      `INSERT INTO contract_lines (
          tenant_id,
          contract_id,
          line_no,
          description,
          line_amount_txn,
          line_amount_base,
          recognition_method,
          recognition_start_date,
          recognition_end_date,
          deferred_account_id,
          revenue_account_id,
          status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        contractId,
        index + 1,
        line.description,
        line.lineAmountTxn,
        line.lineAmountBase,
        line.recognitionMethod,
        line.recognitionStartDate,
        line.recognitionEndDate,
        line.deferredAccountId,
        line.revenueAccountId,
        line.status,
      ]
    );
  }
}

async function fetchContractDocumentLinkRowById({
  tenantId,
  linkId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        l.id,
        l.tenant_id,
        l.legal_entity_id,
        l.contract_id,
        l.cari_document_id,
        l.link_type,
        l.linked_amount_txn,
        l.linked_amount_base,
        l.created_at,
        l.created_by_user_id,
        d.document_no,
        d.direction,
        d.status,
        d.document_date,
        d.amount_txn,
        d.amount_base
     FROM contract_document_links l
     JOIN cari_documents d
       ON d.tenant_id = l.tenant_id
      AND d.legal_entity_id = l.legal_entity_id
      AND d.id = l.cari_document_id
     WHERE l.tenant_id = ?
       AND l.id = ?
     LIMIT 1`,
    [tenantId, linkId]
  );
  return result.rows?.[0] || null;
}

async function validateContractUpsertTx({
  payload,
  runQuery,
}) {
  await assertLegalEntityExists({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    runQuery,
  });
  await assertCurrencyExists({
    currencyCode: payload.currencyCode,
    runQuery,
  });

  const counterparty = await fetchCounterpartyRow({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    counterpartyId: payload.counterpartyId,
    runQuery,
  });
  assertCounterpartyRoleCompatibility(payload.contractType, counterparty);

  await validateContractLineAccountsTx({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    contractType: payload.contractType,
    lines: payload.lines,
    runQuery,
  });
}

function assertLinkDirectionCompatibility(contractType, documentDirection) {
  const normalizedContractType = asUpper(contractType);
  const normalizedDirection = asUpper(documentDirection);
  if (normalizedContractType === CONTRACT_TYPE.CUSTOMER && normalizedDirection !== "AR") {
    throw badRequest("Direction mismatch: CUSTOMER contracts can only link AR documents");
  }
  if (normalizedContractType === CONTRACT_TYPE.VENDOR && normalizedDirection !== "AP") {
    throw badRequest("Direction mismatch: VENDOR contracts can only link AP documents");
  }
}

function assertLifecycleTransition(action, currentStatus) {
  const rule = TRANSITIONS[action];
  if (!rule) {
    throw new Error(`Unsupported contract lifecycle action: ${action}`);
  }
  if (!rule.fromStatuses.has(asUpper(currentStatus))) {
    throw badRequest(`Cannot ${action} contract from status ${currentStatus}`);
  }
  return rule.toStatus;
}

export async function resolveContractScope(contractId, tenantId) {
  const parsedContractId = parsePositiveInt(contractId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedContractId || !parsedTenantId) {
    return null;
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM contracts
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsedTenantId, parsedContractId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }

  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: Number(row.legal_entity_id),
  };
}

export async function listContracts({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["c.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "c.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("c.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.counterpartyId) {
    conditions.push("c.counterparty_id = ?");
    params.push(filters.counterpartyId);
  }
  if (filters.contractType) {
    conditions.push("c.contract_type = ?");
    params.push(filters.contractType);
  }
  if (filters.status) {
    conditions.push("c.status = ?");
    params.push(filters.status);
  }
  if (filters.q) {
    conditions.push("(c.contract_no LIKE ? OR COALESCE(c.notes, '') LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like);
  }

  const whereSql = conditions.join(" AND ");

  const totalResult = await query(
    `SELECT COUNT(*) AS total
     FROM contracts c
     WHERE ${whereSql}`,
    params
  );
  const total = Number(totalResult.rows?.[0]?.total || 0);
  const safeLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;

  const listResult = await query(
    `SELECT
        c.id,
        c.tenant_id,
        c.legal_entity_id,
        c.counterparty_id,
        c.contract_no,
        c.contract_type,
        c.status,
        c.currency_code,
        c.start_date,
        c.end_date,
        c.total_amount_txn,
        c.total_amount_base,
        c.notes,
        c.created_by_user_id,
        c.created_at,
        c.updated_at,
        (
          SELECT COUNT(*)
          FROM contract_lines cl
          WHERE cl.tenant_id = c.tenant_id
            AND cl.contract_id = c.id
        ) AS line_count
     FROM contracts c
     WHERE ${whereSql}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (listResult.rows || []).map((row) => mapContractSummaryRow(row)),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getContractByIdForTenant({
  req,
  tenantId,
  contractId,
  assertScopeAccess,
}) {
  const contract = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!contract) {
    throw badRequest("Contract not found");
  }

  assertScopeAccess(req, "legal_entity", contract.legal_entity_id, "contractId");

  const linesResult = await query(
    `SELECT
        id,
        tenant_id,
        contract_id,
        line_no,
        description,
        line_amount_txn,
        line_amount_base,
        recognition_method,
        recognition_start_date,
        recognition_end_date,
        deferred_account_id,
        revenue_account_id,
        status,
        created_at,
        updated_at
     FROM contract_lines
     WHERE tenant_id = ?
       AND contract_id = ?
     ORDER BY line_no ASC, id ASC`,
    [tenantId, contractId]
  );

  const summary = mapContractSummaryRow(contract);
  return {
    ...summary,
    lines: (linesResult.rows || []).map((lineRow) => mapContractLineRow(lineRow)),
  };
}

export async function createContract({
  req,
  payload,
  assertScopeAccess,
}) {
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");

  try {
    return await withTransaction(async (tx) => {
      await validateContractUpsertTx({
        payload,
        runQuery: tx.query,
      });

      const totals = calculateHeaderTotals(payload.lines);
      const insertResult = await tx.query(
        `INSERT INTO contracts (
            tenant_id,
            legal_entity_id,
            counterparty_id,
            contract_no,
            contract_type,
            status,
            currency_code,
            start_date,
            end_date,
            total_amount_txn,
            total_amount_base,
            notes,
            created_by_user_id
         )
         VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.tenantId,
          payload.legalEntityId,
          payload.counterpartyId,
          payload.contractNo,
          payload.contractType,
          payload.currencyCode,
          payload.startDate,
          payload.endDate,
          totals.totalAmountTxn,
          totals.totalAmountBase,
          payload.notes,
          payload.userId,
        ]
      );

      const contractId = parsePositiveInt(insertResult.rows?.insertId);
      if (!contractId) {
        throw new Error("Failed to create contract");
      }

      await replaceContractLinesTx({
        tenantId: payload.tenantId,
        contractId,
        lines: payload.lines,
        runQuery: tx.query,
      });

      const created = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId,
        runQuery: tx.query,
      });
      if (!created) {
        throw new Error("Contract create readback failed");
      }

      return mapContractSummaryRow(created);
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_contract_no")) {
      throw badRequest("contractNo must be unique in legalEntity scope");
    }
    throw err;
  }
}

export async function updateContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");

  if (asUpper(existing.status) !== CONTRACT_STATUS.DRAFT) {
    throw badRequest("Only DRAFT contracts can be updated");
  }

  try {
    return await withTransaction(async (tx) => {
      const locked = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!locked) {
        throw badRequest("Contract not found");
      }
      if (asUpper(locked.status) !== CONTRACT_STATUS.DRAFT) {
        throw badRequest("Only DRAFT contracts can be updated");
      }

      await validateContractUpsertTx({
        payload,
        runQuery: tx.query,
      });

      const totals = calculateHeaderTotals(payload.lines);
      await tx.query(
        `UPDATE contracts
         SET legal_entity_id = ?,
             counterparty_id = ?,
             contract_no = ?,
             contract_type = ?,
             currency_code = ?,
             start_date = ?,
             end_date = ?,
             total_amount_txn = ?,
             total_amount_base = ?,
             notes = ?
         WHERE tenant_id = ?
           AND id = ?`,
        [
          payload.legalEntityId,
          payload.counterpartyId,
          payload.contractNo,
          payload.contractType,
          payload.currencyCode,
          payload.startDate,
          payload.endDate,
          totals.totalAmountTxn,
          totals.totalAmountBase,
          payload.notes,
          payload.tenantId,
          payload.contractId,
        ]
      );

      await replaceContractLinesTx({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        lines: payload.lines,
        runQuery: tx.query,
      });

      const updated = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
      });
      if (!updated) {
        throw new Error("Contract update readback failed");
      }

      return mapContractSummaryRow(updated);
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_contract_no")) {
      throw badRequest("contractNo must be unique in legalEntity scope");
    }
    throw err;
  }
}

async function transitionContractStatus({
  req,
  tenantId,
  contractId,
  action,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");

  return withTransaction(async (tx) => {
    const locked = await fetchContractRow({
      tenantId,
      contractId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!locked) {
      throw badRequest("Contract not found");
    }
    const nextStatus = assertLifecycleTransition(action, locked.status);

    await tx.query(
      `UPDATE contracts
       SET status = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [nextStatus, tenantId, contractId]
    );

    const updated = await fetchContractRow({
      tenantId,
      contractId,
      runQuery: tx.query,
    });
    if (!updated) {
      throw new Error("Contract lifecycle update readback failed");
    }
    return mapContractSummaryRow(updated);
  });
}

export async function activateContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "activate",
    assertScopeAccess,
  });
}

export async function suspendContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "suspend",
    assertScopeAccess,
  });
}

export async function closeContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "close",
    assertScopeAccess,
  });
}

export async function cancelContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "cancel",
    assertScopeAccess,
  });
}

export async function linkDocumentToContract({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");

  try {
    return await withTransaction(async (tx) => {
      const contract = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!contract) {
        throw badRequest("Contract not found");
      }
      if (!LINKABLE_CONTRACT_STATUSES.has(asUpper(contract.status))) {
        throw badRequest(
          `Contract status ${contract.status} is not eligible for linking`
        );
      }

      const documentResult = await tx.query(
        `SELECT
            id,
            tenant_id,
            legal_entity_id,
            direction,
            status,
            document_no,
            document_date,
            amount_txn,
            amount_base,
            currency_code
         FROM cari_documents
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND id = ?
         LIMIT 1
         FOR UPDATE`,
        [payload.tenantId, contract.legal_entity_id, payload.cariDocumentId]
      );
      const documentRow = documentResult.rows?.[0] || null;
      if (!documentRow) {
        throw badRequest("cariDocumentId must belong to contract legalEntityId");
      }
      if (!LINKABLE_DOCUMENT_STATUSES.has(asUpper(documentRow.status))) {
        throw badRequest(`Document status ${documentRow.status} is not linkable`);
      }

      assertLinkDirectionCompatibility(contract.contract_type, documentRow.direction);

      if (asUpper(contract.currency_code) !== asUpper(documentRow.currency_code)) {
        throw badRequest(
          "Currency mismatch: contract.currencyCode must equal cari_document.currency_code"
        );
      }

      const existingLinksResult = await tx.query(
        `SELECT
            id,
            contract_id,
            link_type,
            linked_amount_txn,
            linked_amount_base
         FROM contract_document_links
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND cari_document_id = ?
         FOR UPDATE`,
        [payload.tenantId, contract.legal_entity_id, payload.cariDocumentId]
      );
      const existingLinks = existingLinksResult.rows || [];

      const alreadyLinkedSameTuple = existingLinks.some(
        (row) =>
          parsePositiveInt(row.contract_id) === parsePositiveInt(payload.contractId) &&
          asUpper(row.link_type) === asUpper(payload.linkType)
      );
      if (alreadyLinkedSameTuple) {
        throw badRequest(
          "A link already exists for this (contractId, cariDocumentId, linkType) tuple"
        );
      }

      const currentLinkedTxn = existingLinks.reduce(
        (sum, row) => sum + Number(row.linked_amount_txn || 0),
        0
      );
      const currentLinkedBase = existingLinks.reduce(
        (sum, row) => sum + Number(row.linked_amount_base || 0),
        0
      );

      const nextTxn = currentLinkedTxn + Number(payload.linkedAmountTxn || 0);
      const nextBase = currentLinkedBase + Number(payload.linkedAmountBase || 0);
      const documentAmountTxn = Number(documentRow.amount_txn || 0);
      const documentAmountBase = Number(documentRow.amount_base || 0);

      if (nextTxn - documentAmountTxn > EPSILON) {
        throw badRequest("linkedAmountTxn exceeds source document amount cap");
      }
      if (nextBase - documentAmountBase > EPSILON) {
        throw badRequest("linkedAmountBase exceeds source document amount cap");
      }

      const insertResult = await tx.query(
        `INSERT INTO contract_document_links (
            tenant_id,
            legal_entity_id,
            contract_id,
            cari_document_id,
            link_type,
            linked_amount_txn,
            linked_amount_base,
            created_by_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.tenantId,
          contract.legal_entity_id,
          payload.contractId,
          payload.cariDocumentId,
          payload.linkType,
          payload.linkedAmountTxn,
          payload.linkedAmountBase,
          payload.userId,
        ]
      );

      const linkId = parsePositiveInt(insertResult.rows?.insertId);
      if (!linkId) {
        throw new Error("Failed to create contract-document link");
      }

      const createdLink = await fetchContractDocumentLinkRowById({
        tenantId: payload.tenantId,
        linkId,
        runQuery: tx.query,
      });
      if (!createdLink) {
        throw new Error("Contract-document link readback failed");
      }

      return mapContractDocumentLinkRow(createdLink);
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_contract_doc_link")) {
      throw badRequest(
        "A link already exists for this (contractId, cariDocumentId, linkType) tuple"
      );
    }
    throw err;
  }
}

export async function listContractDocumentLinks({
  req,
  tenantId,
  contractId,
  assertScopeAccess,
}) {
  const contract = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!contract) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", contract.legal_entity_id, "contractId");

  const result = await query(
    `SELECT
        l.id,
        l.tenant_id,
        l.legal_entity_id,
        l.contract_id,
        l.cari_document_id,
        l.link_type,
        l.linked_amount_txn,
        l.linked_amount_base,
        l.created_at,
        l.created_by_user_id,
        d.document_no,
        d.direction,
        d.status,
        d.document_date,
        d.amount_txn,
        d.amount_base
     FROM contract_document_links l
     JOIN cari_documents d
       ON d.tenant_id = l.tenant_id
      AND d.legal_entity_id = l.legal_entity_id
      AND d.id = l.cari_document_id
     WHERE l.tenant_id = ?
       AND l.contract_id = ?
     ORDER BY l.created_at DESC, l.id DESC`,
    [tenantId, contractId]
  );

  return (result.rows || []).map((row) => mapContractDocumentLinkRow(row));
}
