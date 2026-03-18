import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function up(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
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

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(6));
}

function normalizeOwnershipScope(value) {
  const scope = up(value);
  return scope === "CENTRAL" || scope === "OPERATING_UNIT" ? scope : null;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function normalizeHashValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map((item) => normalizeHashValue(item));
  if (typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      out[key] = normalizeHashValue(value[key]);
    }
    return out;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(12));
  }
  return value;
}

function hashRows(rows = []) {
  const hash = crypto.createHash("sha256");
  for (const row of rows || []) {
    hash.update(JSON.stringify(normalizeHashValue(row)));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function summarizeRows(rows = []) {
  const ids = [];
  for (const row of rows || []) {
    const id = parsePositiveInt(row?.id);
    if (id) ids.push(id);
  }
  ids.sort((a, b) => a - b);
  return {
    row_count: rows.length,
    id_min: ids.length ? ids[0] : null,
    id_max: ids.length ? ids[ids.length - 1] : null,
  };
}

function resolveOwnerContext(row, { scopeField = "ownership_scope", operatingUnitField = "operating_unit_id" } = {}) {
  const ownershipScope = normalizeOwnershipScope(row?.[scopeField]);
  const operatingUnitId = parsePositiveInt(row?.[operatingUnitField]) || null;
  const isValid =
    (ownershipScope === "CENTRAL" && operatingUnitId === null) ||
    (ownershipScope === "OPERATING_UNIT" && operatingUnitId !== null);
  const ownerContextKey = isValid
    ? ownershipScope === "CENTRAL"
      ? "CENTRAL"
      : `OPERATING_UNIT:${operatingUnitId}`
    : "INVALID";
  const ownerContextLabel =
    ownershipScope === "CENTRAL"
      ? "CENTRAL"
      : ownershipScope === "OPERATING_UNIT"
        ? `OU#${operatingUnitId || "?"}`
        : "UNRESOLVED";

  return {
    ownership_scope: ownershipScope,
    operating_unit_id: operatingUnitId,
    owner_context_key: ownerContextKey,
    owner_context_label: ownerContextLabel,
    is_valid: isValid,
  };
}

function summarizeValueCounts(rows = [], getValue) {
  const counts = new Map();
  for (const row of rows || []) {
    const value = String(getValue(row) || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    counts.set(value, Number(counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ value, count }));
}

function summarizeOwnerContextRows(
  rows = [],
  {
    scopeField = "ownership_scope",
    operatingUnitField = "operating_unit_id",
    amountField = null,
  } = {}
) {
  const buckets = new Map();
  let invalidRowCount = 0;

  for (const row of rows || []) {
    const context = resolveOwnerContext(row, { scopeField, operatingUnitField });
    if (!context.is_valid) {
      invalidRowCount += 1;
      continue;
    }
    const key = context.owner_context_key;
    if (!buckets.has(key)) {
      buckets.set(key, {
        owner_context_key: key,
        owner_context_label: context.owner_context_label,
        ownership_scope: context.ownership_scope,
        operating_unit_id: context.operating_unit_id,
        row_count: 0,
      });
    }
    const bucket = buckets.get(key);
    bucket.row_count += 1;
    if (amountField) {
      bucket.total_amount = toAmount((bucket.total_amount || 0) + toAmount(row?.[amountField]));
    }
  }

  const bucketRows = Array.from(buckets.values()).sort((left, right) => {
    const leftScopeRank = left.ownership_scope === "CENTRAL" ? 0 : 1;
    const rightScopeRank = right.ownership_scope === "CENTRAL" ? 0 : 1;
    if (leftScopeRank !== rightScopeRank) return leftScopeRank - rightScopeRank;
    return (left.operating_unit_id || 0) - (right.operating_unit_id || 0);
  });

  return {
    context_count: bucketRows.length,
    valid_row_count: rows.length - invalidRowCount,
    invalid_row_count: invalidRowCount,
    buckets: bucketRows,
  };
}

function buildSampleRows(rows = [], mapper, limit = 5) {
  return (rows || []).slice(0, limit).map((row) => mapper(row));
}

function buildRunSnapshotPayload(rows = []) {
  return {
    status_summary: summarizeValueCounts(rows, (row) => row?.status),
    runs_with_ownership_as_of_date_count: (rows || []).filter((row) => Boolean(toDateOnly(row?.ownership_as_of_date)))
      .length,
    sample_rows: buildSampleRows(rows, (row) => ({
      id: parsePositiveInt(row?.id) || null,
      run_no: row?.run_no || null,
      payroll_period: toDateOnly(row?.payroll_period),
      pay_date: toDateOnly(row?.pay_date),
      ownership_as_of_date: toDateOnly(row?.ownership_as_of_date),
      status: up(row?.status) || null,
    })),
  };
}

function buildRunLineSnapshotPayload(rows = []) {
  return {
    owner_context_summary: summarizeOwnerContextRows(rows),
    ownership_resolution_status_summary: summarizeValueCounts(
      rows,
      (row) => row?.ownership_resolution_status
    ),
    sample_rows: buildSampleRows(rows, (row) => {
      const ownerContext = resolveOwnerContext(row);
      return {
        id: parsePositiveInt(row?.id) || null,
        run_id: parsePositiveInt(row?.run_id) || null,
        line_no: parsePositiveInt(row?.line_no) || null,
        employee_code: row?.employee_code || null,
        ownership_scope: ownerContext.ownership_scope,
        operating_unit_id: ownerContext.operating_unit_id,
        owner_context_label: ownerContext.owner_context_label,
        ownership_resolution_status: up(row?.ownership_resolution_status) || null,
      };
    }),
  };
}

function buildLiabilitySnapshotPayload(rows = []) {
  return {
    owner_context_summary: summarizeOwnerContextRows(rows, { amountField: "amount" }),
    status_summary: summarizeValueCounts(rows, (row) => row?.status),
    sample_rows: buildSampleRows(rows, (row) => {
      const ownerContext = resolveOwnerContext(row);
      return {
        id: parsePositiveInt(row?.id) || null,
        run_id: parsePositiveInt(row?.run_id) || null,
        liability_type: row?.liability_type || null,
        employee_code: row?.employee_code || null,
        ownership_scope: ownerContext.ownership_scope,
        operating_unit_id: ownerContext.operating_unit_id,
        owner_context_label: ownerContext.owner_context_label,
        amount: toAmount(row?.amount),
        outstanding_amount: toAmount(row?.outstanding_amount),
        status: up(row?.status) || null,
      };
    }),
  };
}

function buildPaymentLinkSnapshotPayload(rows = []) {
  return {
    liability_owner_context_summary: summarizeOwnerContextRows(rows, {
      scopeField: "liability_ownership_scope",
      operatingUnitField: "liability_operating_unit_id",
      amountField: "allocated_amount",
    }),
    status_summary: summarizeValueCounts(rows, (row) => row?.status),
    sample_rows: buildSampleRows(rows, (row) => {
      const ownerContext = resolveOwnerContext(row, {
        scopeField: "liability_ownership_scope",
        operatingUnitField: "liability_operating_unit_id",
      });
      return {
        id: parsePositiveInt(row?.id) || null,
        payroll_liability_id: parsePositiveInt(row?.payroll_liability_id) || null,
        payment_batch_id: parsePositiveInt(row?.payment_batch_id) || null,
        liability_type: row?.liability_type || null,
        liability_employee_code: row?.liability_employee_code || null,
        liability_ownership_scope: ownerContext.ownership_scope,
        liability_operating_unit_id: ownerContext.operating_unit_id,
        liability_owner_context_label: ownerContext.owner_context_label,
        allocated_amount: toAmount(row?.allocated_amount),
        status: up(row?.status) || null,
      };
    }),
  };
}

const SNAPSHOT_PAYLOAD_BUILDERS = Object.freeze({
  PAYROLL_RUNS: buildRunSnapshotPayload,
  PAYROLL_RUN_LINES: buildRunLineSnapshotPayload,
  PAYROLL_LIABILITIES: buildLiabilitySnapshotPayload,
  PAYROLL_LIABILITY_PAYMENT_LINKS: buildPaymentLinkSnapshotPayload,
});

function buildSnapshotPayload(itemCode, rows, { periodStart, periodEnd } = {}) {
  const normalizedItemCode = String(itemCode || "UNKNOWN").trim().toUpperCase();
  const basePayload = {
    ...summarizeRows(rows || []),
    period_start: periodStart || null,
    period_end: periodEnd || null,
  };
  const builder = SNAPSHOT_PAYLOAD_BUILDERS[normalizedItemCode];
  if (typeof builder !== "function") {
    return basePayload;
  }
  return {
    ...basePayload,
    ...builder(rows || []),
  };
}

function mapSnapshotRow(row) {
  if (!row) return null;
  return {
    ...row,
    snapshot_type: up(row.snapshot_type),
    status: up(row.status),
    period_start: toDateOnly(row.period_start),
    period_end: toDateOnly(row.period_end),
    snapshot_meta_json: parseJsonMaybe(row.snapshot_meta_json),
  };
}

function mapSnapshotItemRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJsonMaybe(row.payload_json),
  };
}

async function findSnapshotRow({ tenantId, snapshotId, runQuery = query, forUpdate = false }) {
  const res = await runQuery(
    `SELECT s.*, le.code AS legal_entity_code, le.name AS legal_entity_name,
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
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, snapshotId]
  );
  return mapSnapshotRow(res.rows?.[0] || null);
}

async function listSnapshotItems({ tenantId, snapshotId, runQuery = query }) {
  const res = await runQuery(
    `SELECT *
     FROM period_export_snapshot_items
     WHERE tenant_id = ? AND period_export_snapshot_id = ?
     ORDER BY item_code ASC, id ASC`,
    [tenantId, snapshotId]
  );
  return (res.rows || []).map(mapSnapshotItemRow);
}

async function findPayrollCloseRow({ tenantId, closeId, runQuery = query, forUpdate = false }) {
  const res = await runQuery(
    `SELECT *
     FROM payroll_period_closes
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, closeId]
  );
  return res.rows?.[0] || null;
}

function buildSnapshotItem(itemCode, rows, { periodStart, periodEnd } = {}) {
  const normalizedItemCode = String(itemCode || "UNKNOWN").trim().toUpperCase();
  return {
    item_code: normalizedItemCode,
    item_count: Number(rows?.length || 0),
    item_hash: hashRows(rows || []),
    payload_json: buildSnapshotPayload(normalizedItemCode, rows || [], { periodStart, periodEnd }),
  };
}

function buildSnapshotHash({ tenantId, legalEntityId, closeId, periodStart, periodEnd, items }) {
  const signature = {
    tenant_id: tenantId,
    legal_entity_id: legalEntityId,
    payroll_period_close_id: closeId,
    period_start: periodStart,
    period_end: periodEnd,
    items: (items || []).map((item) => ({
      item_code: item.item_code,
      item_count: item.item_count,
      item_hash: item.item_hash,
    })),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizeHashValue(signature)))
    .digest("hex");
}

async function collectSnapshotDatasets({
  tenantId,
  legalEntityId,
  closeId,
  periodStart,
  periodEnd,
  runQuery,
}) {
  const runsRes = await runQuery(
    `SELECT *
     FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND payroll_period BETWEEN ? AND ?
     ORDER BY id ASC`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );

  const linesRes = await runQuery(
    `SELECT rl.*
     FROM payroll_run_lines rl
     JOIN payroll_runs pr
       ON pr.tenant_id = rl.tenant_id
      AND pr.legal_entity_id = rl.legal_entity_id
      AND pr.id = rl.run_id
     WHERE rl.tenant_id = ?
       AND rl.legal_entity_id = ?
       AND pr.payroll_period BETWEEN ? AND ?
     ORDER BY rl.id ASC`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );

  const liabilitiesRes = await runQuery(
    `SELECT l.*
     FROM payroll_run_liabilities l
     JOIN payroll_runs pr
       ON pr.tenant_id = l.tenant_id
      AND pr.legal_entity_id = l.legal_entity_id
      AND pr.id = l.run_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND pr.payroll_period BETWEEN ? AND ?
     ORDER BY l.id ASC`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );

  const paymentLinksRes = await runQuery(
    `SELECT
        pl.*,
        l.liability_type,
        l.employee_code AS liability_employee_code,
        l.employee_name AS liability_employee_name,
        l.ownership_scope AS liability_ownership_scope,
        l.operating_unit_id AS liability_operating_unit_id
     FROM payroll_liability_payment_links pl
     JOIN payroll_runs pr
       ON pr.tenant_id = pl.tenant_id
      AND pr.legal_entity_id = pl.legal_entity_id
      AND pr.id = pl.run_id
     JOIN payroll_run_liabilities l
       ON l.tenant_id = pl.tenant_id
      AND l.legal_entity_id = pl.legal_entity_id
      AND l.run_id = pl.run_id
      AND l.id = pl.payroll_liability_id
     WHERE pl.tenant_id = ?
       AND pl.legal_entity_id = ?
       AND pr.payroll_period BETWEEN ? AND ?
     ORDER BY pl.id ASC`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );

  const checksRes = await runQuery(
    `SELECT *
     FROM payroll_period_close_checks
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND payroll_period_close_id = ?
     ORDER BY id ASC`,
    [tenantId, legalEntityId, closeId]
  );

  const auditRes = await runQuery(
    `SELECT *
     FROM payroll_period_close_audit
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND payroll_period_close_id = ?
     ORDER BY id ASC`,
    [tenantId, legalEntityId, closeId]
  );

  return {
    PAYROLL_RUNS: runsRes.rows || [],
    PAYROLL_RUN_LINES: linesRes.rows || [],
    PAYROLL_LIABILITIES: liabilitiesRes.rows || [],
    PAYROLL_LIABILITY_PAYMENT_LINKS: paymentLinksRes.rows || [],
    PAYROLL_CLOSE_CHECKS: checksRes.rows || [],
    PAYROLL_CLOSE_AUDIT: auditRes.rows || [],
  };
}
export async function resolvePayrollCloseScopeForSnapshot(closeId, tenantId) {
  const cId = parsePositiveInt(closeId);
  const tId = parsePositiveInt(tenantId);
  if (!cId || !tId) return null;

  const row = await query(
    `SELECT legal_entity_id
     FROM payroll_period_closes
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tId, cId]
  );
  const legalEntityId = parsePositiveInt(row.rows?.[0]?.legal_entity_id);
  if (!legalEntityId) return null;
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  };
}

export async function resolvePeriodExportSnapshotScope(snapshotId, tenantId) {
  const sId = parsePositiveInt(snapshotId);
  const tId = parsePositiveInt(tenantId);
  if (!sId || !tId) return null;

  const row = await query(
    `SELECT legal_entity_id
     FROM period_export_snapshots
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tId, sId]
  );
  const legalEntityId = parsePositiveInt(row.rows?.[0]?.legal_entity_id);
  if (!legalEntityId) return null;
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  };
}

export async function listPeriodExportSnapshotRows({
  req,
  tenantId,
  filters = {},
  buildScopeFilter,
  assertScopeAccess,
}) {
  const tId = parsePositiveInt(tenantId);
  if (!tId) throw badRequest("tenantId is required");

  const params = [tId];
  const where = ["s.tenant_id = ?"];

  const legalEntityId = parsePositiveInt(filters.legalEntityId);
  if (legalEntityId) {
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }
    where.push("s.legal_entity_id = ?");
    params.push(legalEntityId);
  } else if (typeof buildScopeFilter === "function") {
    where.push(buildScopeFilter(req, "legal_entity", "s.legal_entity_id", params));
  }

  const closeId = parsePositiveInt(filters.payrollPeriodCloseId ?? filters.closeId);
  if (closeId) {
    where.push("s.payroll_period_close_id = ?");
    params.push(closeId);
  }

  const status = up(filters.status);
  if (status) {
    where.push("s.status = ?");
    params.push(status);
  }

  if (filters.periodStart) {
    where.push("s.period_end >= ?");
    params.push(filters.periodStart);
  }
  if (filters.periodEnd) {
    where.push("s.period_start <= ?");
    params.push(filters.periodEnd);
  }

  const safeLimit = Math.min(500, Math.max(1, Number(filters.limit || 100)));
  const safeOffset = Math.max(0, Number(filters.offset || 0));
  const whereSql = where.join(" AND ");

  const countRes = await query(
    `SELECT COUNT(*) AS total
     FROM period_export_snapshots s
     WHERE ${whereSql}`,
    params
  );

  const listRes = await query(
    `SELECT s.*, le.code AS legal_entity_code, le.name AS legal_entity_name,
            u.email AS created_by_user_email
     FROM period_export_snapshots s
     JOIN legal_entities le
       ON le.tenant_id = s.tenant_id
      AND le.id = s.legal_entity_id
     LEFT JOIN users u
       ON u.tenant_id = s.tenant_id
      AND u.id = s.created_by_user_id
     WHERE ${whereSql}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT ${Math.trunc(safeLimit)} OFFSET ${Math.trunc(safeOffset)}`,
    params
  );

  return {
    rows: (listRes.rows || []).map(mapSnapshotRow),
    total: Number(countRes.rows?.[0]?.total || 0),
    limit: Math.trunc(safeLimit),
    offset: Math.trunc(safeOffset),
  };
}

export async function getPeriodExportSnapshotDetail({
  req,
  tenantId,
  snapshotId,
  assertScopeAccess,
}) {
  const tId = parsePositiveInt(tenantId);
  const sId = parsePositiveInt(snapshotId);
  if (!tId) throw badRequest("tenantId is required");
  if (!sId) throw badRequest("snapshotId is required");

  const snapshot = await findSnapshotRow({ tenantId: tId, snapshotId: sId });
  if (!snapshot) throw notFound("Export snapshot not found");

  const legalEntityId = parsePositiveInt(snapshot.legal_entity_id);
  if (legalEntityId && typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, "snapshotId");
  }

  const items = await listSnapshotItems({ tenantId: tId, snapshotId: sId });

  return {
    snapshot,
    items,
  };
}

export async function createPayrollPeriodExportSnapshot({
  req,
  tenantId,
  userId,
  input = {},
  assertScopeAccess,
}) {
  const tId = parsePositiveInt(tenantId);
  const actorId = parsePositiveInt(userId);
  const closeId = parsePositiveInt(input.payrollPeriodCloseId ?? input.payroll_period_close_id ?? input.closeId);
  if (!tId) throw badRequest("tenantId is required");
  if (!actorId) throw badRequest("userId is required");
  if (!closeId) throw badRequest("payrollPeriodCloseId is required");

  const snapshotType = up((input.snapshotType ?? input.snapshot_type) || "PAYROLL_CLOSE_PERIOD");
  if (snapshotType !== "PAYROLL_CLOSE_PERIOD") {
    throw badRequest("snapshotType must be PAYROLL_CLOSE_PERIOD");
  }

  const idempotencyKey = String((input.idempotencyKey ?? input.idempotency_key) || "").trim();
  const finalIdempotencyKey = idempotencyKey ? idempotencyKey.slice(0, 190) : null;

  return withTransaction(async (tx) => {
    const close = await findPayrollCloseRow({
      tenantId: tId,
      closeId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!close) throw notFound("Payroll close period not found");

    const legalEntityId = parsePositiveInt(close.legal_entity_id);
    if (!legalEntityId) throw badRequest("Payroll close period is missing legal_entity_id");
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", legalEntityId, "payrollPeriodCloseId");
    }

    if (up(close.status) !== "CLOSED") {
      throw conflict("Payroll close period must be CLOSED before snapshot export");
    }

    const periodStart = toDateOnly(close.period_start);
    const periodEnd = toDateOnly(close.period_end);

    if (finalIdempotencyKey) {
      const existingRes = await tx.query(
        `SELECT id
         FROM period_export_snapshots
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND idempotency_key = ?
         LIMIT 1`,
        [tId, legalEntityId, finalIdempotencyKey]
      );
      const existingId = parsePositiveInt(existingRes.rows?.[0]?.id);
      if (existingId) {
        const snapshot = await findSnapshotRow({
          tenantId: tId,
          snapshotId: existingId,
          runQuery: tx.query,
        });
        const items = await listSnapshotItems({
          tenantId: tId,
          snapshotId: existingId,
          runQuery: tx.query,
        });
        return {
          snapshot,
          items,
          idempotent: true,
        };
      }
    }

    const datasets = await collectSnapshotDatasets({
      tenantId: tId,
      legalEntityId,
      closeId,
      periodStart,
      periodEnd,
      runQuery: tx.query,
    });

    const items = Object.entries(datasets).map(([itemCode, rows]) =>
      buildSnapshotItem(itemCode, rows, { periodStart, periodEnd })
    );

    const snapshotHash = buildSnapshotHash({
      tenantId: tId,
      legalEntityId,
      closeId,
      periodStart,
      periodEnd,
      items,
    });

    const snapshotMeta = {
      generated_at: new Date().toISOString(),
      payroll_period_close_status: up(close.status),
      lock_run_changes: Boolean(close.lock_run_changes),
      lock_manual_settlements: Boolean(close.lock_manual_settlements),
      lock_payment_prep: Boolean(close.lock_payment_prep),
      item_count_total: items.length,
      row_count_total: items.reduce((sum, item) => sum + Number(item.item_count || 0), 0),
    };

    const ins = await tx.query(
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
       ) VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        tId,
        legalEntityId,
        snapshotType,
        periodStart,
        periodEnd,
        closeId,
        snapshotHash,
        safeJson(snapshotMeta),
        finalIdempotencyKey,
        actorId,
      ]
    );

    const snapshotId = parsePositiveInt(ins.rows?.insertId);
    if (!snapshotId) {
      throw new Error("Period export snapshot could not be created");
    }

    for (const item of items) {
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
          Number(item.item_count || 0),
          item.item_hash,
          safeJson(item.payload_json),
        ]
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
  resolvePayrollCloseScopeForSnapshot,
  resolvePeriodExportSnapshotScope,
  listPeriodExportSnapshotRows,
  getPeriodExportSnapshotDetail,
  createPayrollPeriodExportSnapshot,
};
