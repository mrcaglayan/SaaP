import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import { assertLegalEntityBelongsToTenant } from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const TRACK51_SNAPSHOT_TYPE = "TRACK51_CONSOLIDATED_MEMBER_SUPPORT";
const ALLOWED_ITEM_CODES = new Set([
  "MEMBER_BREAKDOWN",
  "SELECTED_MEMBER_LOCAL_DRILL",
]);
const ALLOWED_RATE_TYPES = new Set(["SPOT", "AVERAGE", "CLOSING"]);
const ALLOWED_SUMMARY_GROUP_BY = new Set(["ACCOUNT", "ENTITY", "ACCOUNT_ENTITY"]);

function up(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseJsonMaybe(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function requireText(value, label, maxLength = 255) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${label} cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function optionalText(value, label, maxLength = 255) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireText(value, label, maxLength);
}

function parseBooleanLike(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw badRequest("Boolean flag must be true or false");
}

function toDateOnly(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) {
    return match[1];
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} must be a valid date`);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeHashValue(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map((entry) => normalizeHashValue(entry));
  if (typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeHashValue(value[key]);
    }
    return normalized;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(12));
  }
  return value;
}

function sha256Hex(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizeHashValue(value)))
    .digest("hex");
}

function parseFingerprintBasis(value, label) {
  if (value === undefined || value === null || value === "") {
    throw badRequest(`${label} is required`);
  }
  const parsed = parseJsonMaybe(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest(`${label} must be a JSON object`);
  }
  return parsed;
}

function parseSnapshotItem(item, index) {
  const itemCode = up(item?.itemCode ?? item?.item_code);
  if (!ALLOWED_ITEM_CODES.has(itemCode)) {
    throw badRequest(
      `items[${index}].itemCode must be one of ${Array.from(ALLOWED_ITEM_CODES).join(", ")}`,
    );
  }

  const exportColumns = Array.isArray(item?.exportColumns ?? item?.export_columns)
    ? item.exportColumns ?? item.export_columns
    : null;
  if (!exportColumns?.length) {
    throw badRequest(`items[${index}].exportColumns must be a non-empty array`);
  }

  const exportRows = Array.isArray(item?.exportRows ?? item?.export_rows)
    ? item.exportRows ?? item.export_rows
    : null;
  if (!exportRows) {
    throw badRequest(`items[${index}].exportRows must be an array`);
  }

  return {
    itemCode,
    reportKey: requireText(
      item?.reportKey ?? item?.report_key ?? itemCode,
      `items[${index}].reportKey`,
      80,
    ),
    label: requireText(item?.label, `items[${index}].label`, 190),
    fileName: requireText(
      item?.fileName ?? item?.file_name,
      `items[${index}].fileName`,
      255,
    ),
    rowCount: exportRows.length,
    exportColumns: exportColumns.map((column, columnIndex) => ({
      key: requireText(
        column?.key ?? column?.field,
        `items[${index}].exportColumns[${columnIndex}].key`,
        80,
      ),
      header: requireText(
        column?.header ?? column?.label ?? column?.key,
        `items[${index}].exportColumns[${columnIndex}].header`,
        160,
      ),
    })),
    exportRows,
    clientFingerprintSha256: requireText(
      item?.clientFingerprintSha256 ??
        item?.client_fingerprint_sha256 ??
        item?.fingerprintSha256 ??
        item?.fingerprint_sha256,
      `items[${index}].clientFingerprintSha256`,
      64,
    ),
    clientFingerprintBasisJson: parseFingerprintBasis(
      item?.clientFingerprintBasisJson ??
        item?.client_fingerprint_basis_json ??
        item?.fingerprintBasisJson ??
        item?.fingerprint_basis_json,
      `items[${index}].clientFingerprintBasisJson`,
    ),
  };
}

function normalizeReportOptions(input = {}) {
  const rateType = optionalText(input.rateType ?? input.rate_type, "reportOptions.rateType", 20);
  if (rateType && !ALLOWED_RATE_TYPES.has(up(rateType))) {
    throw badRequest(
      `reportOptions.rateType must be one of ${Array.from(ALLOWED_RATE_TYPES).join(", ")}`,
    );
  }

  const summaryGroupBy = optionalText(
    input.summaryGroupBy ?? input.summary_group_by,
    "reportOptions.summaryGroupBy",
    40,
  );
  if (summaryGroupBy && !ALLOWED_SUMMARY_GROUP_BY.has(up(summaryGroupBy))) {
    throw badRequest(
      `reportOptions.summaryGroupBy must be one of ${Array.from(ALLOWED_SUMMARY_GROUP_BY).join(", ")}`,
    );
  }

  return {
    includeDraft: parseBooleanLike(input.includeDraft ?? input.include_draft, false),
    includeZero: parseBooleanLike(input.includeZero ?? input.include_zero, false),
    rateType: rateType ? up(rateType) : null,
    summaryGroupBy: summaryGroupBy ? up(summaryGroupBy) : null,
  };
}

async function findRunGroupMember({ tenantId, run, legalEntityId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       cgm.id,
       cgm.consolidation_group_id,
       cgm.legal_entity_id,
       cgm.consolidation_method,
       cgm.ownership_pct
     FROM consolidation_group_members cgm
     WHERE cgm.tenant_id = ?
       AND cgm.consolidation_group_id = ?
       AND cgm.legal_entity_id = ?
     LIMIT 1`,
    [tenantId, parsePositiveInt(run?.consolidation_group_id), legalEntityId],
  );
  return result.rows?.[0] || null;
}

async function findTenantAccount({ tenantId, accountId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       a.id,
       a.code,
       a.name,
       c.legal_entity_id,
       c.scope
     FROM accounts a
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId],
  );
  return result.rows?.[0] || null;
}

async function findTenantBook({ tenantId, bookId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       id,
       legal_entity_id,
       code,
       name,
       base_currency_code
     FROM books
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [bookId, tenantId],
  );
  return result.rows?.[0] || null;
}

function mapSnapshotRow(row) {
  if (!row) return null;
  return {
    ...row,
    snapshot_type: up(row.snapshot_type),
    status: up(row.status),
    snapshot_meta_json: parseJsonMaybe(row.snapshot_meta_json),
    period_start: toDateOnly(row.period_start, "period_start"),
    period_end: toDateOnly(row.period_end, "period_end"),
  };
}

function mapSnapshotItemRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJsonMaybe(row.payload_json),
  };
}

async function findSnapshotRow({ tenantId, snapshotId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       s.*,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       u.email AS created_by_user_email
     FROM period_export_snapshots s
     JOIN legal_entities le
       ON le.tenant_id = s.tenant_id
      AND le.id = s.legal_entity_id
     LEFT JOIN users u
       ON u.tenant_id = s.tenant_id
      AND u.id = s.created_by_user_id
     WHERE s.tenant_id = ?
       AND s.id = ?
     LIMIT 1`,
    [tenantId, snapshotId],
  );
  return mapSnapshotRow(result.rows?.[0] || null);
}

async function listSnapshotItems({ tenantId, snapshotId, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM period_export_snapshot_items
     WHERE tenant_id = ?
       AND period_export_snapshot_id = ?
     ORDER BY item_code ASC, id ASC`,
    [tenantId, snapshotId],
  );
  return (result.rows || []).map(mapSnapshotItemRow);
}

function buildSnapshotItemPayload({
  item,
  routePath,
  reportOptions,
  run,
  memberEntity,
  groupMember,
  supportAccount,
  selectedBook,
}) {
  return {
    snapshot_type: TRACK51_SNAPSHOT_TYPE,
    report_key: item.reportKey,
    label: item.label,
    file_name: item.fileName,
    route_path: routePath,
    report_options: reportOptions,
    consolidation_run: {
      id: parsePositiveInt(run?.id),
      consolidation_group_id: parsePositiveInt(run?.consolidation_group_id),
      consolidation_group_code: run?.consolidation_group_code || null,
      consolidation_group_name: run?.consolidation_group_name || null,
      fiscal_period_id: parsePositiveInt(run?.fiscal_period_id),
      period_start_date: run?.period_start_date || null,
      period_end_date: run?.period_end_date || null,
      status: up(run?.status) || null,
      presentation_currency_code: up(run?.presentation_currency_code) || null,
    },
    selected_support_account: {
      id: parsePositiveInt(supportAccount?.id),
      code: supportAccount?.code || null,
      name: supportAccount?.name || null,
      scope: up(supportAccount?.scope) || null,
    },
    selected_member: {
      legal_entity_id: parsePositiveInt(memberEntity?.id),
      code: memberEntity?.code || null,
      name: memberEntity?.name || null,
      functional_currency_code: up(memberEntity?.functional_currency_code) || null,
      consolidation_method: up(groupMember?.consolidation_method) || null,
      ownership_pct: Number(groupMember?.ownership_pct || 0),
    },
    selected_book: selectedBook
      ? {
          id: parsePositiveInt(selectedBook?.id),
          code: selectedBook?.code || null,
          name: selectedBook?.name || null,
          base_currency_code: up(selectedBook?.base_currency_code) || null,
        }
      : null,
    // Local-base support remains explicit evidence only; translated balances stay
    // the canonical reporting-currency numbers for consolidation review.
    support_currency_contract: {
      local_base_support_is_not_reporting_currency: true,
      translated_reporting_currency_code: up(run?.presentation_currency_code) || null,
    },
    row_count: Number(item.rowCount || item.exportRows.length || 0),
    export_columns: item.exportColumns,
    export_rows: item.exportRows,
    client_fingerprint: {
      sha256: item.clientFingerprintSha256,
      basis_json: item.clientFingerprintBasisJson,
    },
  };
}

function buildSnapshotHash({
  tenantId,
  runId,
  legalEntityId,
  supportAccountId,
  selectedBookId,
  routePath,
  items,
}) {
  return sha256Hex({
    tenant_id: tenantId,
    snapshot_type: TRACK51_SNAPSHOT_TYPE,
    consolidation_run_id: runId,
    legal_entity_id: legalEntityId,
    support_account_id: supportAccountId,
    selected_book_id: selectedBookId,
    route_path: routePath,
    items: (items || []).map((item) => ({
      item_code: item.item_code,
      item_count: item.item_count,
      item_hash: item.item_hash,
    })),
  });
}

/**
 * Persist one immutable RP13 server-side snapshot for the current
 * consolidation member-support drill chain. The shared retention tables stay
 * the storage seam; the selected member entity anchors the legal-entity scope
 * while the payload preserves the broader consolidation-run context.
 */
export async function createConsolidatedMemberSupportSnapshot({
  tenantId,
  userId,
  run,
  input = {},
  requestMeta = {},
}) {
  const tId = parsePositiveInt(tenantId);
  const actorId = parsePositiveInt(userId);
  const runId = parsePositiveInt(run?.id ?? input.runId ?? input.run_id);
  const legalEntityId = parsePositiveInt(
    input.selectedMemberLegalEntityId ?? input.selected_member_legal_entity_id,
  );
  const supportAccountId = parsePositiveInt(
    input.supportAccountId ?? input.support_account_id,
  );
  const selectedBookId = parsePositiveInt(
    input.selectedMemberBookId ?? input.selected_member_book_id,
  );

  if (!tId) throw badRequest("tenantId is required");
  if (!actorId) throw badRequest("userId is required");
  if (!runId) throw badRequest("runId is required");
  if (!legalEntityId) {
    throw badRequest("selectedMemberLegalEntityId is required");
  }
  if (!supportAccountId) {
    throw badRequest("supportAccountId is required");
  }

  const routePath = requireText(
    input.routePath ?? input.route_path,
    "routePath",
    255,
  );
  if (!routePath.startsWith("/app/")) {
    throw badRequest("routePath must be an application route");
  }

  const reportOptions = normalizeReportOptions(
    input.reportOptions ?? input.report_options ?? {},
  );
  const rawItems = Array.isArray(input.items) ? input.items : null;
  if (!rawItems?.length) {
    throw badRequest("items must be a non-empty array");
  }

  const items = rawItems.map((item, index) => parseSnapshotItem(item, index));
  const uniqueItemCodes = new Set(items.map((item) => item.itemCode));
  if (uniqueItemCodes.size !== items.length) {
    throw badRequest("items must not repeat the same itemCode");
  }

  const memberEntity = await assertLegalEntityBelongsToTenant(
    tId,
    legalEntityId,
    "selectedMemberLegalEntityId",
  );
  const groupMember = await findRunGroupMember({
    tenantId: tId,
    run,
    legalEntityId,
  });
  if (!groupMember) {
    throw badRequest(
      "selectedMemberLegalEntityId must belong to the selected consolidation run",
    );
  }

  const supportAccount = await findTenantAccount({
    tenantId: tId,
    accountId: supportAccountId,
  });
  if (!supportAccount) {
    throw badRequest("supportAccountId not found for tenant");
  }

  const selectedBook = selectedBookId
    ? await findTenantBook({
        tenantId: tId,
        bookId: selectedBookId,
      })
    : null;
  if (selectedBookId && !selectedBook) {
    throw badRequest("selectedMemberBookId not found for tenant");
  }
  if (
    selectedBook &&
    parsePositiveInt(selectedBook.legal_entity_id) !== legalEntityId
  ) {
    throw badRequest(
      "selectedMemberBookId must belong to the selected member legal entity",
    );
  }

  const periodStart = toDateOnly(run?.period_start_date, "periodStartDate");
  const periodEnd = toDateOnly(run?.period_end_date, "periodEndDate");
  const providedIdempotencyKey = optionalText(
    input.idempotencyKey ?? input.idempotency_key,
    "idempotencyKey",
    190,
  );

  const builtItems = items.map((item) => {
    const payloadJson = buildSnapshotItemPayload({
      item,
      routePath,
      reportOptions,
      run,
      memberEntity,
      groupMember,
      supportAccount,
      selectedBook,
    });
    return {
      item_code: item.itemCode,
      item_count: Number(item.exportRows.length || 0),
      item_hash: sha256Hex(payloadJson),
      payload_json: payloadJson,
    };
  });

  const snapshotHash = buildSnapshotHash({
    tenantId: tId,
    runId,
    legalEntityId,
    supportAccountId,
    selectedBookId,
    routePath,
    items: builtItems,
  });
  const finalIdempotencyKey =
    providedIdempotencyKey ||
    `TRACK51:${sha256Hex({
      snapshot_hash: snapshotHash,
      run_id: runId,
      legal_entity_id: legalEntityId,
      route_path: routePath,
    })}`.slice(0, 190);

  return withTransaction(async (tx) => {
    const existingResult = await tx.query(
      `SELECT id
       FROM period_export_snapshots
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND idempotency_key = ?
       LIMIT 1`,
      [tId, legalEntityId, finalIdempotencyKey],
    );
    const existingId = parsePositiveInt(existingResult.rows?.[0]?.id);
    if (existingId) {
      const snapshot = await findSnapshotRow({
        tenantId: tId,
        snapshotId: existingId,
        runQuery: tx.query,
      });
      const snapshotItems = await listSnapshotItems({
        tenantId: tId,
        snapshotId: existingId,
        runQuery: tx.query,
      });
      return {
        snapshot,
        items: snapshotItems,
        idempotent: true,
      };
    }

    const snapshotMeta = {
      generated_at: new Date().toISOString(),
      source: "TRACK51_RP13_7B",
      route_path: routePath,
      consolidation_run_id: runId,
      consolidation_group_id: parsePositiveInt(run?.consolidation_group_id),
      consolidation_group_code: run?.consolidation_group_code || null,
      consolidation_group_name: run?.consolidation_group_name || null,
      fiscal_period_id: parsePositiveInt(run?.fiscal_period_id),
      report_options: reportOptions,
      selected_support_account: {
        id: parsePositiveInt(supportAccount.id),
        code: supportAccount.code || null,
        name: supportAccount.name || null,
      },
      selected_member: {
        legal_entity_id: legalEntityId,
        code: memberEntity.code || null,
        name: memberEntity.name || null,
        functional_currency_code: up(memberEntity.functional_currency_code) || null,
        consolidation_method: up(groupMember.consolidation_method) || null,
        ownership_pct: Number(groupMember.ownership_pct || 0),
      },
      selected_book: selectedBook
        ? {
            id: parsePositiveInt(selectedBook.id),
            code: selectedBook.code || null,
            name: selectedBook.name || null,
            base_currency_code: up(selectedBook.base_currency_code) || null,
          }
        : null,
      item_count_total: builtItems.length,
      row_count_total: builtItems.reduce(
        (sum, item) => sum + Number(item.item_count || 0),
        0,
      ),
      request_meta: {
        request_id: requestMeta?.requestId || null,
        ip_address: requestMeta?.ipAddress || null,
        user_agent: requestMeta?.userAgent || null,
      },
    };

    const insertResult = await tx.query(
      `INSERT INTO period_export_snapshots (
         tenant_id,
         legal_entity_id,
         snapshot_type,
         period_start,
         period_end,
         payroll_period_close_id,
         status,
         snapshot_hash,
         snapshot_meta_json,
         idempotency_key,
         created_by_user_id,
         created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, 'READY', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        tId,
        legalEntityId,
        TRACK51_SNAPSHOT_TYPE,
        periodStart,
        periodEnd,
        snapshotHash,
        safeJson(snapshotMeta),
        finalIdempotencyKey,
        actorId,
      ],
    );

    const snapshotId = parsePositiveInt(insertResult.rows?.insertId);
    if (!snapshotId) {
      throw new Error("Consolidation member-support snapshot could not be created");
    }

    for (const item of builtItems) {
      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO period_export_snapshot_items (
           tenant_id,
           legal_entity_id,
           period_export_snapshot_id,
           item_code,
           item_count,
           item_hash,
           payload_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          tId,
          legalEntityId,
          snapshotId,
          item.item_code,
          item.item_count,
          item.item_hash,
          safeJson(item.payload_json),
        ],
      );
    }

    const snapshot = await findSnapshotRow({
      tenantId: tId,
      snapshotId,
      runQuery: tx.query,
    });
    const snapshotItems = await listSnapshotItems({
      tenantId: tId,
      snapshotId,
      runQuery: tx.query,
    });

    return {
      snapshot,
      items: snapshotItems,
      idempotent: false,
    };
  });
}

export default {
  createConsolidatedMemberSupportSnapshot,
};
