import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  getExceptionWorkbenchById,
  ignoreExceptionWorkbench,
  resolveExceptionWorkbench,
} from "./exceptions.workbench.service.js";
import { requeueJob } from "./jobs.service.js";

const FX_OPS_SOURCE_TYPES = Object.freeze({
  MISSING_RATE: "CASH_FX_MISSING_RATE",
  REVALUATION_JOB: "CASH_FX_REVAL_JOB",
  BALANCE_POLICY: "CASH_FX_BALANCE_POLICY",
  SETTLEMENT_CURRENCY_MISMATCH: "CARI_SETTLEMENT_CURRENCY_MISMATCH",
});

const FX_OPS_STATUS_VALUES = Object.freeze(["OPEN", "IN_REVIEW", "RESOLVED", "IGNORED"]);
const FX_OPS_SEVERITY_VALUES = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const FX_OPS_OPEN_STATUSES = Object.freeze(["OPEN", "IN_REVIEW"]);
const FX_OPS_JOB_ACTIVE_STATUSES = Object.freeze([
  "FAILED_FINAL",
  "FAILED_RETRYABLE",
  "QUEUED",
  "RUNNING",
]);
const FX_OPS_JOB_FAILED_STATUSES = new Set(["FAILED_FINAL", "FAILED_RETRYABLE"]);

const AMOUNT_SCALE = 6;
const AMOUNT_EPSILON = 0.000001;
const DEFAULT_DASHBOARD_DAYS = 45;
const DEFAULT_BALANCE_ABNORMAL_THRESHOLD = 1_000_000;

const SLA_HOURS_BY_SEVERITY = Object.freeze({
  CRITICAL: 4,
  HIGH: 24,
  MEDIUM: 72,
  LOW: 120,
});

function u(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(Math.trunc(n)) : fallback;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundAmount(value) {
  return Number(toNum(value, 0).toFixed(AMOUNT_SCALE));
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJsonMaybe(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeText(value, maxLength, fallback = null) {
  const text = String(value ?? "")
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function normalizeCurrencyCode(value) {
  const code = u(value);
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function parseIsoDate(value, label = "date") {
  if (!value) return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw badRequest(`${label} is invalid`);
  }
  return d;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function normalizeWindow(filters = {}, defaultDays = DEFAULT_DASHBOARD_DAYS) {
  const rawDays = Number(filters.days);
  const days =
    Number.isInteger(rawDays) && rawDays > 0 ? Math.min(rawDays, 3660) : defaultDays;

  let dateFrom = parseIsoDate(filters.dateFrom, "dateFrom");
  let dateTo = parseIsoDate(filters.dateTo, "dateTo");
  const today = parseIsoDate(formatIsoDate(new Date()), "today");

  if (!dateFrom && !dateTo) {
    dateTo = today;
    dateFrom = addDays(dateTo, -(days - 1));
  } else if (!dateFrom && dateTo) {
    dateFrom = addDays(dateTo, -(days - 1));
  } else if (dateFrom && !dateTo) {
    dateTo = addDays(dateFrom, days - 1);
  }

  if (dateFrom.getTime() > dateTo.getTime()) {
    throw badRequest("dateFrom cannot be after dateTo");
  }

  return {
    days,
    dateFrom: formatIsoDate(dateFrom),
    dateTo: formatIsoDate(dateTo),
    startTs: `${formatIsoDate(dateFrom)} 00:00:00`,
    endExclusiveTs: `${formatIsoDate(addDays(dateTo, 1))} 00:00:00`,
  };
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  throw badRequest("Boolean value is invalid");
}

function normalizeNonNegativeNumber(value, label, fallback) {
  if (value === undefined || value === null || value === "") {
    return Number(fallback);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw badRequest(`${label} must be a non-negative number`);
  }
  return parsed;
}

function computeSlaDueAt({ severity, anchorAt }) {
  const normalizedSeverity = FX_OPS_SEVERITY_VALUES.includes(u(severity))
    ? u(severity)
    : "MEDIUM";
  const hours = SLA_HOURS_BY_SEVERITY[normalizedSeverity] ?? SLA_HOURS_BY_SEVERITY.MEDIUM;
  const anchor = anchorAt ? new Date(anchorAt) : new Date();
  const start = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  const due = new Date(start.getTime() + hours * 60 * 60 * 1000);
  return due.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeExceptionItem(item) {
  if (!item || typeof item !== "object") {
    throw badRequest("Invalid FX ops exception item");
  }
  const tenantId = parsePositiveInt(item.tenant_id ?? item.tenantId);
  if (!tenantId) throw badRequest("tenantId is required for FX ops exception item");

  const sourceType = normalizeText(item.source_type ?? item.sourceType, 80);
  const sourceKey = normalizeText(item.source_key ?? item.sourceKey, 255);
  const exceptionType = normalizeText(item.exception_type ?? item.exceptionType, 80, sourceType);
  if (!sourceType || !sourceKey || !exceptionType) {
    throw badRequest("FX ops exception item requires exceptionType/sourceType/sourceKey");
  }

  const severity = u(item.severity || "MEDIUM");
  const status = u(item.status || "OPEN");
  if (!FX_OPS_SEVERITY_VALUES.includes(severity)) {
    throw badRequest(`Invalid FX ops exception severity: ${severity}`);
  }
  if (!FX_OPS_STATUS_VALUES.includes(status)) {
    throw badRequest(`Invalid FX ops exception status: ${status}`);
  }

  const normalized = {
    tenant_id: tenantId,
    legal_entity_id: parsePositiveInt(item.legal_entity_id ?? item.legalEntityId) || null,
    module_code: "CASH",
    exception_type: exceptionType,
    source_type: sourceType,
    source_key: sourceKey,
    source_ref: normalizeText(item.source_ref ?? item.sourceRef, 190),
    source_ref_id: parsePositiveInt(item.source_ref_id ?? item.sourceRefId) || null,
    source_status_code: normalizeText(item.source_status_code ?? item.sourceStatusCode, 30),
    severity,
    sla_due_at: normalizeText(item.sla_due_at ?? item.slaDueAt, 19) ||
      computeSlaDueAt({
        severity,
        anchorAt: item.anchor_at ?? item.anchorAt ?? item.last_seen_at ?? item.lastSeenAt,
      }),
    status,
    owner_user_id: parsePositiveInt(item.owner_user_id ?? item.ownerUserId) || null,
    title: normalizeText(item.title, 190),
    description: normalizeText(item.description, 500),
    payload_json: item.payload_json ?? item.payload ?? null,
  };

  if (!normalized.title) {
    throw badRequest("FX ops exception item title is required");
  }

  return normalized;
}

async function upsertFxOpsExceptionRow({ runQuery, item }) {
  const normalized = normalizeExceptionItem(item);
  await runQuery(
    `INSERT INTO exception_workbench (
        tenant_id,
        legal_entity_id,
        module_code,
        exception_type,
        source_type,
        source_key,
        source_ref,
        source_ref_id,
        source_status_code,
        severity,
        sla_due_at,
        status,
        owner_user_id,
        title,
        description,
        payload_json,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        legal_entity_id = VALUES(legal_entity_id),
        module_code = VALUES(module_code),
        exception_type = VALUES(exception_type),
        source_type = VALUES(source_type),
        source_ref = VALUES(source_ref),
        source_ref_id = VALUES(source_ref_id),
        source_status_code = VALUES(source_status_code),
        severity = VALUES(severity),
        sla_due_at = COALESCE(VALUES(sla_due_at), exception_workbench.sla_due_at),
        title = VALUES(title),
        description = VALUES(description),
        payload_json = VALUES(payload_json),
        status = CASE
          WHEN VALUES(status) = 'OPEN' THEN
            CASE
              WHEN exception_workbench.status = 'IN_REVIEW' THEN 'IN_REVIEW'
              WHEN exception_workbench.status = 'IGNORED' THEN 'IGNORED'
              ELSE 'OPEN'
            END
          WHEN VALUES(status) = 'IN_REVIEW' THEN
            CASE
              WHEN exception_workbench.status = 'IGNORED' THEN 'IGNORED'
              ELSE 'IN_REVIEW'
            END
          ELSE VALUES(status)
        END,
        owner_user_id = CASE
          WHEN VALUES(status) IN ('OPEN','IN_REVIEW') THEN COALESCE(VALUES(owner_user_id), exception_workbench.owner_user_id)
          ELSE exception_workbench.owner_user_id
        END,
        last_seen_at = CURRENT_TIMESTAMP`,
    [
      normalized.tenant_id,
      normalized.legal_entity_id,
      normalized.module_code,
      normalized.exception_type,
      normalized.source_type,
      normalized.source_key,
      normalized.source_ref,
      normalized.source_ref_id,
      normalized.source_status_code,
      normalized.severity,
      normalized.sla_due_at,
      normalized.status,
      normalized.owner_user_id,
      normalized.title,
      normalized.description,
      safeJson(normalized.payload_json),
    ]
  );
}

function mapExceptionRow(row) {
  if (!row) return null;
  return {
    exceptionId: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    moduleCode: row.module_code || null,
    exceptionType: row.exception_type || null,
    sourceType: row.source_type || null,
    sourceKey: row.source_key || null,
    sourceRef: row.source_ref || null,
    sourceRefId: parsePositiveInt(row.source_ref_id),
    sourceStatusCode: row.source_status_code || null,
    severity: row.severity || null,
    status: row.status || null,
    ownerUserId: parsePositiveInt(row.owner_user_id),
    title: row.title || null,
    description: row.description || null,
    payload: parseJsonMaybe(row.payload_json, null),
    resolutionAction: row.resolution_action || null,
    resolutionNote: row.resolution_note || null,
    resolvedByUserId: parsePositiveInt(row.resolved_by_user_id),
    resolvedAt: row.resolved_at || null,
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function deriveLegalEntityFromJobPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    parsePositiveInt(payload.legal_entity_id) ||
    parsePositiveInt(payload.legalEntityId) ||
    null
  );
}

function deriveBookIdFromJobPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return parsePositiveInt(payload.book_id) || parsePositiveInt(payload.bookId) || null;
}

function deriveFiscalPeriodIdFromJobPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    parsePositiveInt(payload.fiscal_period_id) ||
    parsePositiveInt(payload.fiscalPeriodId) ||
    null
  );
}

function deriveRunTypeFromJobPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const runType = u(payload.run_type || payload.runType || "");
  return runType || null;
}

function extractMissingRateToken(lastErrorMessage) {
  const message = String(lastErrorMessage || "");
  const match = /FX rate is required for ([A-Z]{3})\/([A-Z]{3}) on (\d{4}-\d{2}-\d{2})/i.exec(
    message
  );
  if (!match) return null;
  return {
    fromCurrencyCode: u(match[1]),
    toCurrencyCode: u(match[2]),
    rateDate: match[3],
  };
}

function getScopeExpressionForJobPayload(alias = "j") {
  return `CAST(COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(${alias}.payload_json, '$.legal_entity_id')),
    JSON_UNQUOTE(JSON_EXTRACT(${alias}.payload_json, '$.legalEntityId'))
  ) AS UNSIGNED)`;
}

async function listRelevantFxRevaluationJobs({
  req,
  tenantId,
  filters,
  window,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const where = [`j.tenant_id = ?`, `j.job_type = 'CASH_FX_REVALUATION_RUN'`];

  where.push("j.created_at >= ?");
  params.push(window.startTs);
  where.push("j.created_at < ?");
  params.push(window.endExclusiveTs);
  where.push(`j.status IN (${FX_OPS_JOB_ACTIVE_STATUSES.map(() => "?").join(", ")})`);
  params.push(...FX_OPS_JOB_ACTIVE_STATUSES);

  const legalEntityExpr = getScopeExpressionForJobPayload("j");
  const legalEntityId = parsePositiveInt(filters.legalEntityId);
  if (legalEntityId) {
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }
    where.push(`${legalEntityExpr} = ?`);
    params.push(legalEntityId);
  } else if (typeof buildScopeFilter === "function") {
    const scopeSql = buildScopeFilter(req, "legal_entity", legalEntityExpr, params);
    if (scopeSql && scopeSql !== "1 = 1") {
      where.push(scopeSql);
    }
  }

  const result = await query(
    `SELECT
       j.id,
       j.tenant_id,
       j.status,
       j.queue_name,
       j.module_code,
       j.job_type,
       j.priority,
       j.run_after_at,
       j.attempt_count,
       j.max_attempts,
       j.last_error_code,
       j.last_error_message,
       j.payload_json,
       j.created_at,
       j.updated_at,
       j.started_at,
       j.locked_at
     FROM app_jobs j
     WHERE ${where.join(" AND ")}
     ORDER BY j.id DESC
     LIMIT 1000`,
    params
  );

  return (result.rows || []).map((row) => {
    const payload = parseJsonMaybe(row.payload_json, {});
    return {
      ...row,
      payload_json: payload,
      legal_entity_id: deriveLegalEntityFromJobPayload(payload),
      book_id: deriveBookIdFromJobPayload(payload),
      fiscal_period_id: deriveFiscalPeriodIdFromJobPayload(payload),
      run_type: deriveRunTypeFromJobPayload(payload),
    };
  });
}

function buildMissingRateExceptionItems({ tenantId, jobRows }) {
  const grouped = new Map();
  for (const row of jobRows || []) {
    const status = u(row.status);
    if (!FX_OPS_JOB_FAILED_STATUSES.has(status)) continue;
    const token = extractMissingRateToken(row.last_error_message);
    if (!token) continue;
    const legalEntityId = parsePositiveInt(row.legal_entity_id);
    const groupKey = [
      tenantId,
      legalEntityId || 0,
      token.fromCurrencyCode,
      token.toCurrencyCode,
      token.rateDate,
    ].join("|");
    const existing = grouped.get(groupKey) || {
      tenantId,
      legalEntityId,
      ...token,
      jobIds: [],
      errorCodes: new Set(),
      statuses: new Set(),
      lastErrorMessages: [],
      latestSeenAt: null,
    };
    existing.jobIds.push(parsePositiveInt(row.id));
    if (row.last_error_code) existing.errorCodes.add(String(row.last_error_code));
    existing.statuses.add(status);
    if (row.last_error_message) {
      existing.lastErrorMessages.push(String(row.last_error_message).slice(0, 500));
    }
    const seenAt = row.updated_at || row.created_at || null;
    if (!existing.latestSeenAt || String(seenAt || "") > String(existing.latestSeenAt || "")) {
      existing.latestSeenAt = seenAt;
    }
    grouped.set(groupKey, existing);
  }

  const items = [];
  for (const value of grouped.values()) {
    const fromCurrencyCode = normalizeCurrencyCode(value.fromCurrencyCode);
    const toCurrencyCode = normalizeCurrencyCode(value.toCurrencyCode);
    const rateDate = normalizeText(value.rateDate, 10);
    if (!fromCurrencyCode || !toCurrencyCode || !rateDate) continue;

    const severity = value.jobIds.length >= 3 ? "CRITICAL" : "HIGH";
    const statusCode = "MISSING_RATE";
    const title = `Missing FX rate ${fromCurrencyCode}/${toCurrencyCode} on ${rateDate}`;
    const description = `${value.jobIds.length} FX revaluation job(s) are blocked by missing rate data`;
    items.push({
      tenant_id: tenantId,
      legal_entity_id: value.legalEntityId || null,
      exception_type: FX_OPS_SOURCE_TYPES.MISSING_RATE,
      source_type: FX_OPS_SOURCE_TYPES.MISSING_RATE,
      source_key: `CASH:FX_MISSING_RATE:${value.legalEntityId || 0}:${fromCurrencyCode}:${toCurrencyCode}:${rateDate}`,
      source_ref: `${fromCurrencyCode}/${toCurrencyCode}@${rateDate}`,
      source_ref_id: null,
      source_status_code: statusCode,
      severity,
      status: "OPEN",
      title,
      description,
      anchor_at: value.latestSeenAt,
      payload_json: {
        from_currency_code: fromCurrencyCode,
        to_currency_code: toCurrencyCode,
        rate_date: rateDate,
        blocked_job_ids: value.jobIds.filter(Boolean),
        job_statuses: Array.from(value.statuses),
        error_codes: Array.from(value.errorCodes),
        last_error_messages: value.lastErrorMessages.slice(0, 5),
      },
    });
  }

  return items;
}

function buildRevaluationJobExceptionItems({ tenantId, jobRows, now = new Date() }) {
  const nowTs = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const items = [];
  for (const row of jobRows || []) {
    const jobId = parsePositiveInt(row.id);
    if (!jobId) continue;
    const status = u(row.status);
    if (!FX_OPS_JOB_ACTIVE_STATUSES.includes(status)) continue;

    const runAfterAt = row.run_after_at ? new Date(row.run_after_at) : null;
    const startedAt = row.started_at || row.locked_at ? new Date(row.started_at || row.locked_at) : null;
    const runAfterMinutesOverdue =
      runAfterAt && !Number.isNaN(runAfterAt.getTime())
        ? Math.max(0, Math.trunc((nowTs.getTime() - runAfterAt.getTime()) / 60000))
        : 0;
    const runningMinutes =
      startedAt && !Number.isNaN(startedAt.getTime())
        ? Math.max(0, Math.trunc((nowTs.getTime() - startedAt.getTime()) / 60000))
        : 0;

    let severity = "LOW";
    if (status === "FAILED_FINAL") {
      severity = "HIGH";
    } else if (status === "FAILED_RETRYABLE") {
      severity = "MEDIUM";
    } else if (status === "RUNNING") {
      severity = runningMinutes >= 60 ? "HIGH" : "MEDIUM";
    } else if (status === "QUEUED") {
      severity = runAfterMinutesOverdue >= 60 ? "MEDIUM" : "LOW";
    }

    const descriptionParts = [];
    if (row.last_error_message) {
      descriptionParts.push(String(row.last_error_message).slice(0, 300));
    }
    if (status === "RUNNING") {
      descriptionParts.push(`running_for_minutes=${runningMinutes}`);
    }
    if (status === "QUEUED") {
      descriptionParts.push(`overdue_minutes=${runAfterMinutesOverdue}`);
    }
    const description = descriptionParts.join(" | ") || "FX revaluation job requires ops attention";

    items.push({
      tenant_id: tenantId,
      legal_entity_id: parsePositiveInt(row.legal_entity_id) || null,
      exception_type: FX_OPS_SOURCE_TYPES.REVALUATION_JOB,
      source_type: FX_OPS_SOURCE_TYPES.REVALUATION_JOB,
      source_key: `CASH:FX_REVAL_JOB:${jobId}`,
      source_ref: `JOB:${jobId}`,
      source_ref_id: jobId,
      source_status_code: status,
      severity,
      status: "OPEN",
      title: `FX revaluation job ${jobId} is ${status}`,
      description,
      anchor_at: row.updated_at || row.created_at || null,
      payload_json: {
        job_id: jobId,
        queue_name: row.queue_name || null,
        module_code: row.module_code || null,
        job_type: row.job_type || null,
        status,
        priority: toInt(row.priority, 0),
        run_after_at: row.run_after_at || null,
        attempt_count: toInt(row.attempt_count, 0),
        max_attempts: toInt(row.max_attempts, 0),
        last_error_code: row.last_error_code || null,
        last_error_message: row.last_error_message || null,
        legal_entity_id: parsePositiveInt(row.legal_entity_id) || null,
        book_id: parsePositiveInt(row.book_id) || null,
        fiscal_period_id: parsePositiveInt(row.fiscal_period_id) || null,
        run_type: row.run_type || null,
        overdue_minutes: runAfterMinutesOverdue,
        running_minutes: runningMinutes,
      },
    });
  }
  return items;
}

async function listForeignBalancePolicyRows({
  req,
  tenantId,
  filters,
  asOfDate,
  abnormalBaseThreshold,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const where = [
    "ct.tenant_id = ?",
    "ct.status = 'POSTED'",
    "ct.book_date <= ?",
    "UPPER(cr.currency_code) <> UPPER(le.functional_currency_code)",
  ];
  const params = [tenantId, asOfDate];

  if (parsePositiveInt(filters.legalEntityId)) {
    const legalEntityId = parsePositiveInt(filters.legalEntityId);
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }
    where.push("cr.legal_entity_id = ?");
    params.push(legalEntityId);
  } else if (typeof buildScopeFilter === "function") {
    const scopeSql = buildScopeFilter(req, "legal_entity", "cr.legal_entity_id", params);
    if (scopeSql && scopeSql !== "1 = 1") {
      where.push(scopeSql);
    }
  }

  const signedTxn = `CASE
    WHEN ct.txn_type IN ('RECEIPT','WITHDRAWAL_FROM_BANK','TRANSFER_IN','OPENING_FLOAT') THEN ct.amount
    WHEN ct.txn_type IN ('PAYOUT','DEPOSIT_TO_BANK','TRANSFER_OUT','CLOSING_ADJUSTMENT') THEN -ct.amount
    ELSE 0
  END`;
  const signedBase = `CASE
    WHEN ct.txn_type IN ('RECEIPT','WITHDRAWAL_FROM_BANK','TRANSFER_IN','OPENING_FLOAT') THEN COALESCE(ct.amount_base, ct.amount)
    WHEN ct.txn_type IN ('PAYOUT','DEPOSIT_TO_BANK','TRANSFER_OUT','CLOSING_ADJUSTMENT') THEN -COALESCE(ct.amount_base, ct.amount)
    ELSE 0
  END`;

  const result = await query(
    `SELECT
       cr.id AS register_id,
       cr.code AS register_code,
       cr.name AS register_name,
       cr.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       UPPER(cr.currency_code) AS currency_code,
       UPPER(le.functional_currency_code) AS base_currency_code,
       SUM(${signedTxn}) AS balance_amount_txn,
       SUM(${signedBase}) AS carrying_amount_base
     FROM cash_transactions ct
     JOIN cash_registers cr
       ON cr.id = ct.cash_register_id
      AND cr.tenant_id = ct.tenant_id
     JOIN legal_entities le
       ON le.id = cr.legal_entity_id
      AND le.tenant_id = cr.tenant_id
     WHERE ${where.join(" AND ")}
     GROUP BY
       cr.id,
       cr.code,
       cr.name,
       cr.legal_entity_id,
       le.code,
       le.name,
       UPPER(cr.currency_code),
       UPPER(le.functional_currency_code)
     HAVING SUM(${signedTxn}) < ?
        OR ABS(SUM(${signedBase})) >= ?
     ORDER BY cr.id ASC`,
    [...params, -AMOUNT_EPSILON, Number(abnormalBaseThreshold || 0)]
  );
  return result.rows || [];
}

function buildForeignBalanceExceptionItems({
  tenantId,
  rows,
  asOfDate,
  abnormalBaseThreshold,
}) {
  const items = [];
  for (const row of rows || []) {
    const registerId = parsePositiveInt(row.register_id);
    if (!registerId) continue;
    const balanceAmountTxn = roundAmount(row.balance_amount_txn);
    const carryingAmountBase = roundAmount(row.carrying_amount_base);
    const isNegative = balanceAmountTxn < -AMOUNT_EPSILON;
    const isAbnormal = Math.abs(carryingAmountBase) >= Number(abnormalBaseThreshold || 0);
    const statusCode = isNegative && isAbnormal
      ? "NEGATIVE_AND_ABNORMAL"
      : isNegative
        ? "NEGATIVE_BALANCE"
        : "ABNORMAL_EXPOSURE";
    const severity = isNegative ? "HIGH" : "MEDIUM";
    const registerCode = normalizeText(row.register_code, 60, `REG-${registerId}`);
    const currencyCode = normalizeCurrencyCode(row.currency_code) || "UNK";
    const baseCurrencyCode = normalizeCurrencyCode(row.base_currency_code) || "UNK";

    items.push({
      tenant_id: tenantId,
      legal_entity_id: parsePositiveInt(row.legal_entity_id) || null,
      exception_type: FX_OPS_SOURCE_TYPES.BALANCE_POLICY,
      source_type: FX_OPS_SOURCE_TYPES.BALANCE_POLICY,
      source_key: `CASH:FX_BALANCE_POLICY:${registerId}:${asOfDate}`,
      source_ref: registerCode,
      source_ref_id: registerId,
      source_status_code: statusCode,
      severity,
      status: "OPEN",
      title: `Foreign cash out-of-policy on ${registerCode}`,
      description: `txn=${balanceAmountTxn} ${currencyCode}, carrying=${carryingAmountBase} ${baseCurrencyCode}`,
      payload_json: {
        register_id: registerId,
        register_code: registerCode,
        register_name: row.register_name || null,
        legal_entity_id: parsePositiveInt(row.legal_entity_id) || null,
        legal_entity_code: row.legal_entity_code || null,
        legal_entity_name: row.legal_entity_name || null,
        currency_code: currencyCode,
        base_currency_code: baseCurrencyCode,
        balance_amount_txn: balanceAmountTxn,
        carrying_amount_base: carryingAmountBase,
        as_of_date: asOfDate,
        abnormal_base_threshold: Number(abnormalBaseThreshold || 0),
        policy_flags: {
          negative_balance: isNegative,
          abnormal_exposure: isAbnormal,
        },
      },
    });
  }
  return items;
}

function dedupeExceptionItems(items = []) {
  const byKey = new Map();
  for (const item of items) {
    const key = String(item?.source_key || "").trim();
    if (!key) continue;
    byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function parseActorUserId(req) {
  return parsePositiveInt(req?.user?.userId) || parsePositiveInt(req?.user?.id) || null;
}

function normalizeDashboardFilters(filters = {}) {
  const window = normalizeWindow(filters, DEFAULT_DASHBOARD_DAYS);
  const asOfDate = parseIsoDate(filters.asOfDate || window.dateTo, "asOfDate");
  const asOfDateText = formatIsoDate(asOfDate);
  const abnormalBaseThreshold = normalizeNonNegativeNumber(
    filters.abnormalBaseThreshold,
    "abnormalBaseThreshold",
    DEFAULT_BALANCE_ABNORMAL_THRESHOLD
  );
  const includeResolved = parseBoolean(filters.includeResolved, false);
  const refresh = parseBoolean(filters.refresh, true);
  const limitRaw = Number(filters.limit);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50;

  return {
    ...window,
    legalEntityId: parsePositiveInt(filters.legalEntityId) || null,
    asOfDate: asOfDateText,
    abnormalBaseThreshold,
    includeResolved,
    refresh,
    limit,
  };
}

async function listFxOpsSectionRows({
  req,
  tenantId,
  sourceType,
  sectionLimit,
  filters,
  window,
  includeResolved,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId, sourceType, window.startTs, window.endExclusiveTs];
  const where = [
    "ew.tenant_id = ?",
    "ew.module_code = 'CASH'",
    "ew.source_type = ?",
    "ew.last_seen_at >= ?",
    "ew.last_seen_at < ?",
  ];

  if (!includeResolved) {
    where.push(`ew.status IN (${FX_OPS_OPEN_STATUSES.map(() => "?").join(", ")})`);
    params.push(...FX_OPS_OPEN_STATUSES);
  }

  if (parsePositiveInt(filters.legalEntityId)) {
    const legalEntityId = parsePositiveInt(filters.legalEntityId);
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }
    where.push("ew.legal_entity_id = ?");
    params.push(legalEntityId);
  } else if (typeof buildScopeFilter === "function") {
    const scopeSql = buildScopeFilter(req, "legal_entity", "ew.legal_entity_id", params);
    if (scopeSql && scopeSql !== "1 = 1") {
      where.push(scopeSql);
    }
  }

  const whereSql = where.join(" AND ");
  const countResult = await query(
    `SELECT COUNT(*) AS total
     FROM exception_workbench ew
     WHERE ${whereSql}`,
    params
  );
  const total = toInt(countResult.rows?.[0]?.total, 0);

  const listResult = await query(
    `SELECT
       ew.*,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name
     FROM exception_workbench ew
     LEFT JOIN legal_entities le
       ON le.tenant_id = ew.tenant_id
      AND le.id = ew.legal_entity_id
     WHERE ${whereSql}
     ORDER BY
       CASE ew.severity
         WHEN 'CRITICAL' THEN 0
         WHEN 'HIGH' THEN 1
         WHEN 'MEDIUM' THEN 2
         WHEN 'LOW' THEN 3
         ELSE 4
       END ASC,
       CASE ew.status
         WHEN 'OPEN' THEN 0
         WHEN 'IN_REVIEW' THEN 1
         WHEN 'RESOLVED' THEN 2
         WHEN 'IGNORED' THEN 3
         ELSE 4
       END ASC,
       ew.last_seen_at DESC,
       ew.id DESC
     LIMIT ${Math.trunc(sectionLimit)}`,
    params
  );

  return {
    total,
    rows: (listResult.rows || []).map(mapExceptionRow),
  };
}

export async function refreshCashFxOpsExceptions({
  req,
  tenantId,
  filters = {},
  buildScopeFilter,
  assertScopeAccess,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) throw badRequest("tenantId is required");
  const normalizedFilters = normalizeDashboardFilters(filters);
  const window = normalizeWindow(normalizedFilters, DEFAULT_DASHBOARD_DAYS);

  const jobRows = await listRelevantFxRevaluationJobs({
    req,
    tenantId: normalizedTenantId,
    filters: normalizedFilters,
    window,
    buildScopeFilter,
    assertScopeAccess,
  });

  const missingRateItems = buildMissingRateExceptionItems({
    tenantId: normalizedTenantId,
    jobRows,
  });
  const revaluationJobItems = buildRevaluationJobExceptionItems({
    tenantId: normalizedTenantId,
    jobRows,
  });
  const balanceRows = await listForeignBalancePolicyRows({
    req,
    tenantId: normalizedTenantId,
    filters: normalizedFilters,
    asOfDate: normalizedFilters.asOfDate,
    abnormalBaseThreshold: normalizedFilters.abnormalBaseThreshold,
    buildScopeFilter,
    assertScopeAccess,
  });
  const balanceItems = buildForeignBalanceExceptionItems({
    tenantId: normalizedTenantId,
    rows: balanceRows,
    asOfDate: normalizedFilters.asOfDate,
    abnormalBaseThreshold: normalizedFilters.abnormalBaseThreshold,
  });

  const items = dedupeExceptionItems([
    ...missingRateItems,
    ...revaluationJobItems,
    ...balanceItems,
  ]);

  if (items.length > 0) {
    await withTransaction(async (tx) => {
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop
        await upsertFxOpsExceptionRow({ runQuery: tx.query, item });
      }
    });
  }

  return {
    window,
    asOfDate: normalizedFilters.asOfDate,
    processed: items.length,
    scanned: {
      jobs: jobRows.length,
      balances: balanceRows.length,
    },
    by_source: {
      missing_fx_rates: missingRateItems.length,
      revaluation_jobs: revaluationJobItems.length,
      foreign_balance_policy: balanceItems.length,
    },
  };
}

export async function getCashFxOpsDashboard({
  req,
  tenantId,
  filters = {},
  buildScopeFilter,
  assertScopeAccess,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) throw badRequest("tenantId is required");
  const normalizedFilters = normalizeDashboardFilters(filters);
  const window = normalizeWindow(normalizedFilters, DEFAULT_DASHBOARD_DAYS);

  let refreshSummary = null;
  if (normalizedFilters.refresh) {
    refreshSummary = await refreshCashFxOpsExceptions({
      req,
      tenantId: normalizedTenantId,
      filters: normalizedFilters,
      buildScopeFilter,
      assertScopeAccess,
    });
  }

  const [missingRates, revaluationJobs, outOfPolicyBalances, settlementCurrencyMismatch] =
    await Promise.all([
      listFxOpsSectionRows({
        req,
        tenantId: normalizedTenantId,
        sourceType: FX_OPS_SOURCE_TYPES.MISSING_RATE,
        sectionLimit: normalizedFilters.limit,
        filters: normalizedFilters,
        window,
        includeResolved: normalizedFilters.includeResolved,
        buildScopeFilter,
        assertScopeAccess,
      }),
      listFxOpsSectionRows({
        req,
        tenantId: normalizedTenantId,
        sourceType: FX_OPS_SOURCE_TYPES.REVALUATION_JOB,
        sectionLimit: normalizedFilters.limit,
        filters: normalizedFilters,
        window,
        includeResolved: normalizedFilters.includeResolved,
        buildScopeFilter,
        assertScopeAccess,
      }),
      listFxOpsSectionRows({
        req,
        tenantId: normalizedTenantId,
        sourceType: FX_OPS_SOURCE_TYPES.BALANCE_POLICY,
        sectionLimit: normalizedFilters.limit,
        filters: normalizedFilters,
        window,
        includeResolved: normalizedFilters.includeResolved,
        buildScopeFilter,
        assertScopeAccess,
      }),
      listFxOpsSectionRows({
        req,
        tenantId: normalizedTenantId,
        sourceType: FX_OPS_SOURCE_TYPES.SETTLEMENT_CURRENCY_MISMATCH,
        sectionLimit: normalizedFilters.limit,
        filters: normalizedFilters,
        window,
        includeResolved: normalizedFilters.includeResolved,
        buildScopeFilter,
        assertScopeAccess,
      }),
    ]);

  return {
    window,
    filters: {
      legalEntityId: normalizedFilters.legalEntityId,
      asOfDate: normalizedFilters.asOfDate,
      abnormalBaseThreshold: Number(normalizedFilters.abnormalBaseThreshold),
      includeResolved: Boolean(normalizedFilters.includeResolved),
      refresh: Boolean(normalizedFilters.refresh),
      limit: normalizedFilters.limit,
    },
    summary: {
      total:
        missingRates.total +
        revaluationJobs.total +
        outOfPolicyBalances.total +
        settlementCurrencyMismatch.total,
      missingRates: missingRates.total,
      revaluationJobs: revaluationJobs.total,
      outOfPolicyBalances: outOfPolicyBalances.total,
      settlementCurrencyMismatch: settlementCurrencyMismatch.total,
    },
    sections: {
      missingRates,
      revaluationJobs,
      outOfPolicyBalances,
      settlementCurrencyMismatch,
    },
    refreshed: normalizedFilters.refresh,
    refresh: refreshSummary,
  };
}

function parseJobIdFromExceptionRow(row) {
  const payload = parseJsonMaybe(row?.payload, null);
  return (
    parsePositiveInt(row?.sourceRefId) ||
    parsePositiveInt(payload?.job_id) ||
    parsePositiveInt(payload?.jobId) ||
    null
  );
}

function requireCashModuleExceptionRow(row) {
  if (!row) throw badRequest("Exception not found");
  if (u(row.moduleCode) !== "CASH") {
    throw badRequest("Exception does not belong to CASH module");
  }
}

export async function rerunCashFxOpsExceptionJob({
  req,
  tenantId,
  exceptionId,
  actorUserId,
  delaySeconds = 0,
  maxAttempts = null,
  resolutionNote = null,
  assertScopeAccess,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedExceptionId = parsePositiveInt(exceptionId);
  const normalizedActorUserId = parsePositiveInt(actorUserId || parseActorUserId(req));
  if (!normalizedTenantId || !normalizedExceptionId || !normalizedActorUserId) {
    throw badRequest("tenantId, exceptionId and actorUserId are required");
  }

  const detail = await getExceptionWorkbenchById({
    req,
    tenantId: normalizedTenantId,
    exceptionId: normalizedExceptionId,
    assertScopeAccess,
  });
  const row = mapExceptionRow(detail?.row || null);
  requireCashModuleExceptionRow(row);
  if (u(row.sourceType) !== FX_OPS_SOURCE_TYPES.REVALUATION_JOB) {
    throw badRequest("rerun-job action is only supported for CASH_FX_REVAL_JOB exceptions");
  }

  const jobId = parseJobIdFromExceptionRow(row);
  if (!jobId) {
    throw badRequest("Linked app job id is missing on exception payload");
  }

  const requeueResult = await requeueJob({
    tenantId: normalizedTenantId,
    jobId,
    userId: normalizedActorUserId,
    delaySeconds: normalizeNonNegativeNumber(delaySeconds, "delaySeconds", 0),
    maxAttempts:
      Number.isInteger(Number(maxAttempts)) && Number(maxAttempts) > 0
        ? Number(maxAttempts)
        : null,
  });

  const resolvedRow = await resolveExceptionWorkbench({
    req,
    tenantId: normalizedTenantId,
    exceptionId: normalizedExceptionId,
    actorUserId: normalizedActorUserId,
    resolutionAction: "RERUN_JOB",
    resolutionNote:
      normalizeText(
        resolutionNote,
        500,
        `Job ${jobId} requeued by ops action`
      ) || `Job ${jobId} requeued by ops action`,
    assertScopeAccess,
  });

  return {
    exception: mapExceptionRow(resolvedRow),
    job: requeueResult?.item || null,
    requeuedByUserId: normalizedActorUserId,
  };
}

export async function overrideCashFxOpsException({
  req,
  tenantId,
  exceptionId,
  actorUserId,
  reason,
  assertScopeAccess,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedExceptionId = parsePositiveInt(exceptionId);
  const normalizedActorUserId = parsePositiveInt(actorUserId || parseActorUserId(req));
  const normalizedReason = normalizeText(reason, 500);
  if (!normalizedTenantId || !normalizedExceptionId || !normalizedActorUserId) {
    throw badRequest("tenantId, exceptionId and actorUserId are required");
  }
  if (!normalizedReason) {
    throw badRequest("reason is required");
  }

  const detail = await getExceptionWorkbenchById({
    req,
    tenantId: normalizedTenantId,
    exceptionId: normalizedExceptionId,
    assertScopeAccess,
  });
  const row = mapExceptionRow(detail?.row || null);
  requireCashModuleExceptionRow(row);

  const ignored = await ignoreExceptionWorkbench({
    req,
    tenantId: normalizedTenantId,
    exceptionId: normalizedExceptionId,
    actorUserId: normalizedActorUserId,
    resolutionAction: "MANUAL_OVERRIDE",
    resolutionNote: normalizedReason,
    assertScopeAccess,
  });

  return {
    exception: mapExceptionRow(ignored),
    overriddenByUserId: normalizedActorUserId,
  };
}

export async function recordCariSettlementCurrencyMismatchException({
  tenantId,
  legalEntityId,
  settlementCurrencyCode,
  registerId,
  registerCode = null,
  registerCurrencyCode,
  counterpartyId = null,
  counterpartyType = null,
  settlementIdempotencyKey = null,
  cashTransactionId = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedRegisterId = parsePositiveInt(registerId);
  const expectedCurrencyCode = normalizeCurrencyCode(settlementCurrencyCode);
  const actualCurrencyCode = normalizeCurrencyCode(registerCurrencyCode);

  if (
    !normalizedTenantId ||
    !normalizedLegalEntityId ||
    !normalizedRegisterId ||
    !expectedCurrencyCode ||
    !actualCurrencyCode
  ) {
    return null;
  }

  const idempotencyToken = normalizeText(settlementIdempotencyKey, 100);
  const sourceIdentity = idempotencyToken
    ? `IDEMP:${idempotencyToken}`
    : parsePositiveInt(cashTransactionId)
      ? `CASH_TXN:${parsePositiveInt(cashTransactionId)}`
      : `REG:${normalizedRegisterId}:CUR:${expectedCurrencyCode}`;

  const sourceKey = truncate(
    `CARI:SETTLEMENT_CURRENCY_MISMATCH:${normalizedLegalEntityId}:${sourceIdentity}`,
    255
  );

  const title = `Settlement blocked by register currency mismatch (${actualCurrencyCode} vs ${expectedCurrencyCode})`;
  const description = `Register ${registerCode || normalizedRegisterId} currency ${actualCurrencyCode} does not match settlement currency ${expectedCurrencyCode}. Exchange first, then settle.`;

  await upsertFxOpsExceptionRow({
    runQuery,
    item: {
      tenant_id: normalizedTenantId,
      legal_entity_id: normalizedLegalEntityId,
      exception_type: FX_OPS_SOURCE_TYPES.SETTLEMENT_CURRENCY_MISMATCH,
      source_type: FX_OPS_SOURCE_TYPES.SETTLEMENT_CURRENCY_MISMATCH,
      source_key: sourceKey,
      source_ref: normalizeText(registerCode, 190, `REG-${normalizedRegisterId}`),
      source_ref_id: normalizedRegisterId,
      source_status_code: "CURRENCY_MISMATCH",
      severity: "MEDIUM",
      status: "OPEN",
      title,
      description,
      payload_json: {
        legal_entity_id: normalizedLegalEntityId,
        register_id: normalizedRegisterId,
        register_code: registerCode || null,
        settlement_currency_code: expectedCurrencyCode,
        register_currency_code: actualCurrencyCode,
        counterparty_id: parsePositiveInt(counterpartyId) || null,
        counterparty_type: normalizeText(counterpartyType, 30),
        settlement_idempotency_key: idempotencyToken || null,
        cash_transaction_id: parsePositiveInt(cashTransactionId) || null,
      },
    },
  });

  const saved = await runQuery(
    `SELECT ew.*, le.code AS legal_entity_code, le.name AS legal_entity_name
     FROM exception_workbench ew
     LEFT JOIN legal_entities le
       ON le.tenant_id = ew.tenant_id
      AND le.id = ew.legal_entity_id
     WHERE ew.tenant_id = ?
       AND ew.source_key = ?
     LIMIT 1`,
    [normalizedTenantId, sourceKey]
  );
  return mapExceptionRow(saved.rows?.[0] || null);
}

export default {
  refreshCashFxOpsExceptions,
  getCashFxOpsDashboard,
  rerunCashFxOpsExceptionJob,
  overrideCashFxOpsException,
  recordCariSettlementCurrencyMismatchException,
};
