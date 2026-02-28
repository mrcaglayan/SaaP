import { query } from "../db.js";

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function resolveDateRange({ dateFrom, dateTo, days = 30 } = {}) {
  const end = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : new Date();
  const start = dateFrom
    ? new Date(`${dateFrom}T00:00:00.000Z`)
    : new Date(end.getTime() - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString().slice(0, 19).replace("T", " "),
    endIso: end.toISOString().slice(0, 19).replace("T", " "),
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(columns, rows) {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(column.value(row))).join(",")
  );
  return [header, ...body].join("\n");
}

async function queryScalar(sql, params = []) {
  try {
    const result = await query(sql, params);
    const row = result.rows?.[0] || {};
    const firstKey = Object.keys(row)[0];
    return Number(row[firstKey] || 0);
  } catch (err) {
    if (isMissingTableError(err)) {
      return 0;
    }
    throw err;
  }
}

export async function buildUsageExportCsv({ tenantId, dateFrom, dateTo, days = 30 }) {
  const range = resolveDateRange({ dateFrom, dateTo, days });
  const [activeUsers, totalUsers, cariDocuments, cashTransactions, payrollRuns, jobsCount, auditCount] =
    await Promise.all([
      queryScalar(
        `SELECT COUNT(*) AS metric_value
         FROM users
         WHERE tenant_id = ?
           AND status = 'ACTIVE'`,
        [tenantId]
      ),
      queryScalar(
        `SELECT COUNT(*) AS metric_value
         FROM users
         WHERE tenant_id = ?`,
        [tenantId]
      ),
      queryScalar(
        `SELECT COUNT(*) AS metric_value
         FROM cari_documents
         WHERE tenant_id = ?`,
        [tenantId]
      ),
      queryScalar(
        `SELECT COUNT(*) AS metric_value
         FROM cash_transactions
         WHERE tenant_id = ?`,
        [tenantId]
      ),
      queryScalar(
        `SELECT COUNT(*) AS metric_value
         FROM payroll_runs
         WHERE tenant_id = ?`,
        [tenantId]
      ),
      queryScalar(
        `SELECT COUNT(*) AS metric_value
         FROM jobs
         WHERE tenant_id = ?`,
        [tenantId]
      ),
      queryScalar(
        `SELECT COUNT(*) AS metric_value
         FROM audit_logs
         WHERE tenant_id = ?
           AND created_at BETWEEN ? AND ?`,
        [tenantId, range.startIso, range.endIso]
      ),
    ]);

  const rows = [
    { metricCode: "USERS_ACTIVE", metricName: "Active users", metricValue: activeUsers },
    { metricCode: "USERS_TOTAL", metricName: "Total users", metricValue: totalUsers },
    { metricCode: "CARI_DOCUMENTS_TOTAL", metricName: "Cari documents", metricValue: cariDocuments },
    { metricCode: "CASH_TRANSACTIONS_TOTAL", metricName: "Cash transactions", metricValue: cashTransactions },
    { metricCode: "PAYROLL_RUNS_TOTAL", metricName: "Payroll runs", metricValue: payrollRuns },
    { metricCode: "JOBS_TOTAL", metricName: "Jobs", metricValue: jobsCount },
    { metricCode: "AUDIT_EVENTS_WINDOW", metricName: "Audit events (window)", metricValue: auditCount },
  ].map((row) => ({
    tenantId,
    windowStart: range.startDate,
    windowEnd: range.endDate,
    ...row,
  }));

  const csv = toCsv(
    [
      { header: "tenant_id", value: (row) => row.tenantId },
      { header: "window_start", value: (row) => row.windowStart },
      { header: "window_end", value: (row) => row.windowEnd },
      { header: "metric_code", value: (row) => row.metricCode },
      { header: "metric_name", value: (row) => row.metricName },
      { header: "metric_value", value: (row) => row.metricValue },
    ],
    rows
  );

  return {
    csv,
    rowCount: rows.length,
    fileName: `ops-usage-export-${range.endDate || "snapshot"}.csv`,
  };
}

export async function buildAuditExportCsv({
  tenantId,
  dateFrom,
  dateTo,
  days = 30,
  limit = 5000,
}) {
  const range = resolveDateRange({ dateFrom, dateTo, days });
  const safeLimit = Math.min(Math.max(1, Number(limit) || 5000), 20000);

  let rows = [];
  try {
    const result = await query(
      `SELECT
         id,
         tenant_id,
         user_id,
         action,
         resource_type,
         resource_id,
         scope_type,
         scope_id,
         request_id,
         ip_address,
         user_agent,
         created_at
       FROM audit_logs
       WHERE tenant_id = ?
         AND created_at BETWEEN ? AND ?
       ORDER BY created_at DESC, id DESC
       LIMIT ${safeLimit}`,
      [tenantId, range.startIso, range.endIso]
    );
    rows = result.rows || [];
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err;
    }
    rows = [];
  }

  const csv = toCsv(
    [
      { header: "id", value: (row) => row.id },
      { header: "tenant_id", value: (row) => row.tenant_id },
      { header: "user_id", value: (row) => row.user_id },
      { header: "action", value: (row) => row.action },
      { header: "resource_type", value: (row) => row.resource_type },
      { header: "resource_id", value: (row) => row.resource_id },
      { header: "scope_type", value: (row) => row.scope_type },
      { header: "scope_id", value: (row) => row.scope_id },
      { header: "request_id", value: (row) => row.request_id },
      { header: "ip_address", value: (row) => row.ip_address },
      { header: "user_agent", value: (row) => row.user_agent },
      { header: "created_at", value: (row) => row.created_at },
    ],
    rows
  );

  return {
    csv,
    rowCount: rows.length,
    fileName: `ops-audit-export-${range.endDate || "snapshot"}.csv`,
  };
}

