import express from "express";
import { query, withTransaction } from "../db.js";
import {
  assertScopeAccess,
  buildScopeFilter,
  requirePermission,
} from "../middleware/rbac.js";
import {
  assertAccountBelongsToTenant,
  assertCoaBelongsToTenant,
  assertConsolidationGroupBelongsToTenant,
  assertFiscalCalendarBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
  assertGroupCompanyBelongsToTenant,
  assertLegalEntityBelongsToTenant,
  assertUserBelongsToTenant,
} from "../tenantGuards.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { logWarn } from "../observability/logger.js";
import {
  loadConsolidationRunReportAccountBalances,
  normalizeConsolidationBalanceByAccountType,
  summarizeConsolidationRunReportMath,
} from "../services/consolidation.report-math.service.js";
import { createConsolidatedMemberSupportSnapshot } from "../services/consolidation.report-snapshots.service.js";
import { getConsolidationRunReviewGate } from "../services/consolidation.review-gate.service.js";
import {
  applyCanonicalMappingRuleById,
  applyCanonicalMappingRule,
  applyCanonicalMappingCandidates,
  createCanonicalMappingRule,
  deactivateCanonicalMappingRule,
  getCanonicalMappingRuleById,
  getCanonicalMappingGovernanceReview,
  getCanonicalMappingReadiness,
  listCanonicalAccountMappings,
  listCanonicalMappingCandidates,
  listCanonicalMappingRules,
  listCanonicalKeys,
  previewCanonicalMappingRuleById,
  previewCanonicalMappingRule,
  upsertCanonicalKey,
  upsertGroupAccountCanonicalMapping,
  upsertLocalAccountCanonicalMapping,
} from "../services/consolidation.canonical-mappings.service.js";

const router = express.Router();

const VALID_FX_RATE_TYPES = new Set(["SPOT", "AVERAGE", "CLOSING"]);
const BALANCE_EPSILON = 0.0001;
const FEATURE_SUBACCOUNTS_V1 = "FEATURE_SUBACCOUNTS_V1";
const FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1 =
  "FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1";
const FEATURE_TAX_ENGINE_V1 = "FEATURE_TAX_ENGINE_V1";
const CONSOLIDATION_CANONICAL_FAILURE_AUDIT_ACTION =
  "consolidation.execute.failure.canonical_mapping";
const CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES =
  parsePositiveInt(
    process.env.CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES,
  ) || 60;
const CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD =
  parsePositiveInt(
    process.env.CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD,
  ) || 3;

function normalizeRateType(value) {
  const rateType = String(value || "CLOSING").toUpperCase();
  if (!VALID_FX_RATE_TYPES.has(rateType)) {
    throw badRequest("rateType must be one of SPOT, AVERAGE, CLOSING");
  }
  return rateType;
}

function parseBooleanLike(value, fallback = false, fieldLabel = "flag") {
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

  throw badRequest(`${fieldLabel} must be true or false`);
}

/**
 * Normalize local-base support currency metadata for consolidated summary rows.
 * These support amounts can aggregate multiple member functional currencies, so
 * the UI needs an explicit signal before showing any one currency label.
 */
function buildConsolidatedSupportCurrencyContext(row) {
  const distinctCodes = String(row?.source_currency_codes_csv || "")
    .split(",")
    .map((value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  const uniqueCodes = [...new Set(distinctCodes)];
  const parsedCount = Number(row?.source_currency_count);
  const sourceCurrencyCount = Number.isFinite(parsedCount)
    ? Math.max(0, Math.trunc(parsedCount))
    : uniqueCodes.length;
  const hasMixedSourceCurrencies =
    sourceCurrencyCount > 1 || uniqueCodes.length > 1;

  return {
    source_currency_count: sourceCurrencyCount,
    source_currency_codes: uniqueCodes,
    source_currency_code: uniqueCodes.length === 1 ? uniqueCodes[0] : null,
    has_mixed_source_currencies: hasMixedSourceCurrencies,
  };
}

function toIsoDate(value, fieldLabel = "date") {
  const toLocalYyyyMmDd = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;

  if (value === undefined || value === null || value === "") {
    throw badRequest(`${fieldLabel} is required`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${fieldLabel} must be a valid date`);
    }
    return toLocalYyyyMmDd(value);
  }

  const asString = String(value).trim();
  if (!asString) {
    throw badRequest(`${fieldLabel} must be a valid date`);
  }

  const yyyyMmDdMatch = asString.match(/^(\d{4}-\d{2}-\d{2})/);
  if (yyyyMmDdMatch?.[1]) {
    return yyyyMmDdMatch[1];
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldLabel} must be a valid date`);
  }
  return toLocalYyyyMmDd(parsed);
}

function resolveClientIpAddress(req) {
  const forwardedFor = req?.headers?.["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)[0];
  return forwardedIp || req?.ip || req?.socket?.remoteAddress || null;
}

function buildAuditRequestMeta(req) {
  return {
    requestId:
      String(req?.requestId || req?.headers?.["x-request-id"] || "").trim() ||
      null,
    ipAddress: resolveClientIpAddress(req),
    userAgent: String(req?.headers?.["user-agent"] || "").trim() || null,
  };
}

function normalizeDraftPostingStatus(value) {
  const status = String(value || "ALL").toUpperCase();
  if (!["ALL", "DRAFT", "POSTED"].includes(status)) {
    throw badRequest("status must be one of ALL, DRAFT, POSTED");
  }
  return status;
}

function assertRunNotLocked(run) {
  const status = String(run?.status || "").toUpperCase();
  if (status === "LOCKED") {
    throw badRequest(
      "Consolidation run is LOCKED; no further posting is allowed",
    );
  }
}

function ownershipFactor(consolidationMethod, ownershipPct) {
  const normalizedMethod = String(consolidationMethod || "FULL").toUpperCase();
  const pct = Number(ownershipPct);
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(pct, 1)) : 1;

  if (normalizedMethod === "FULL") {
    return 1;
  }
  return safePct;
}

function toDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: "SERIALIZATION_FAILED" });
  }
}

function normalizeCanonicalFailureReasonCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const normalized = {};
  for (const [key, rawCount] of Object.entries(value)) {
    const normalizedKey = String(key || "")
      .trim()
      .toUpperCase();
    if (!normalizedKey) {
      continue;
    }
    normalized[normalizedKey] = Number(rawCount || 0);
  }
  return normalized;
}

function resolveCanonicalFailureSubtype(reasonCounts = {}) {
  const localDateMismatch = Number(
    reasonCounts.LOCAL_MAPPING_DATE_MISMATCH || 0,
  );
  const groupDateMismatch = Number(
    reasonCounts.GROUP_MAPPING_DATE_MISMATCH || 0,
  );
  if (localDateMismatch + groupDateMismatch > 0) {
    return "EFFECTIVE_DATE_MISMATCH";
  }
  return "MISSING_MAPPING";
}

function isCanonicalCoverageFailure(err) {
  const message = String(err?.message || "").toLowerCase();
  if (message.includes("canonical consolidation mapping is missing")) {
    return true;
  }
  const reasonCounts = err?.details?.reasonCounts;
  return Boolean(reasonCounts && typeof reasonCounts === "object");
}

async function recordCanonicalExecuteFailureEvent({
  req,
  tenantId,
  runId,
  executedByUserId = null,
  err,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedRunId = parsePositiveInt(runId);
  if (!parsedTenantId || !parsedRunId) {
    return;
  }

  const details =
    err?.details &&
    typeof err.details === "object" &&
    !Array.isArray(err.details)
      ? err.details
      : {};
  const reasonCounts = normalizeCanonicalFailureReasonCounts(
    details.reasonCounts,
  );
  const subtype = resolveCanonicalFailureSubtype(reasonCounts);
  const legalEntityId = parsePositiveInt(details.legalEntityId) || null;
  const consolidationGroupId =
    parsePositiveInt(details.consolidationGroupId) || null;
  const auditScopeType = consolidationGroupId
    ? "GROUP"
    : legalEntityId
      ? "LEGAL_ENTITY"
      : null;
  const auditScopeId = consolidationGroupId || legalEntityId || null;

  const payload = {
    eventCode: "CONSOLIDATION_CANONICAL_EXECUTE_FAILURE",
    subtype,
    runId: parsedRunId,
    tenantId: parsedTenantId,
    consolidationGroupId,
    legalEntityId,
    uncoveredCount: Number(details.uncoveredCount || 0),
    sampledCount: Number(details.sampledCount || 0),
    sampleTruncated: details.sampleTruncated === true,
    reasonCounts,
    sampleRows: Array.isArray(details.sampleRows)
      ? details.sampleRows.slice(0, 10)
      : [],
    errorMessage: String(err?.message || "Consolidation execute failed").slice(
      0,
      500,
    ),
  };

  await query(
    `INSERT INTO audit_logs (
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
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsedTenantId,
      parsePositiveInt(executedByUserId) || null,
      CONSOLIDATION_CANONICAL_FAILURE_AUDIT_ACTION,
      "consolidation_run",
      String(parsedRunId),
      auditScopeType,
      auditScopeId,
      String(req?.requestId || req?.headers?.["x-request-id"] || "").trim() ||
        null,
      resolveClientIpAddress(req),
      String(req?.headers?.["user-agent"] || "").trim() || null,
      safeJsonStringify(payload),
    ],
  );

  logWarn("Consolidation canonical execute failure observed", {
    eventCode: "CONSOLIDATION_CANONICAL_EXECUTE_FAILURE",
    subtype,
    tenantId: parsedTenantId,
    consolidationGroupId,
    legalEntityId,
    runId: parsedRunId,
    uncoveredCount: payload.uncoveredCount,
    requestId: req?.requestId || null,
  });

  const alertWindowMinutes =
    CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES;
  const alertThreshold = CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD;
  if (alertWindowMinutes <= 0 || alertThreshold <= 0) {
    return;
  }

  const since = new Date(Date.now() - alertWindowMinutes * 60 * 1000);
  const sinceUtc = since.toISOString().slice(0, 19).replace("T", " ");
  const alertResult = await query(
    `SELECT COUNT(*) AS failure_count
     FROM audit_logs
     WHERE tenant_id = ?
       AND action = ?
       AND created_at >= ?`,
    [parsedTenantId, CONSOLIDATION_CANONICAL_FAILURE_AUDIT_ACTION, sinceUtc],
  );
  const failureCount = Number(alertResult.rows?.[0]?.failure_count || 0);
  if (failureCount >= alertThreshold) {
    logWarn("Consolidation canonical execute failure threshold reached", {
      eventCode: "CONSOLIDATION_CANONICAL_EXECUTE_FAILURE_ALERT",
      tenantId: parsedTenantId,
      consolidationGroupId,
      legalEntityId,
      latestRunId: parsedRunId,
      latestSubtype: subtype,
      windowMinutes: alertWindowMinutes,
      threshold: alertThreshold,
      observedFailureCount: failureCount,
      requestId: req?.requestId || null,
    });
  }
}

function normalizeConsolidationStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function assertLegalEntityMatchesGroupCompany(
  legalEntityRow,
  groupCompanyId,
  label = "legalEntityId",
) {
  const expectedGroupCompanyId = parsePositiveInt(groupCompanyId);
  if (!expectedGroupCompanyId) {
    return;
  }

  const legalEntityGroupCompanyId = parsePositiveInt(
    legalEntityRow?.group_company_id,
  );
  if (legalEntityGroupCompanyId !== expectedGroupCompanyId) {
    throw badRequest(
      `${label} must belong to selected consolidation group's group company`,
    );
  }
}

async function isTenantFeatureEnabled({
  tenantId,
  featureCode,
  runQuery = query,
}) {
  try {
    const result = await runQuery(
      `SELECT is_enabled
       FROM tenant_features
       WHERE tenant_id = ?
         AND feature_code = ?
       LIMIT 1`,
      [
        parsePositiveInt(tenantId),
        String(featureCode || "")
          .trim()
          .toUpperCase(),
      ],
    );
    return toDbBoolean(result.rows?.[0]?.is_enabled);
  } catch (err) {
    if (isMissingTableError(err)) {
      return false;
    }
    throw err;
  }
}

async function evaluateSubaccountsCompatibility({
  tenantId,
  runId,
  run,
  runQuery = query,
}) {
  const consolidationGroupId = parsePositiveInt(run?.consolidation_group_id);
  const periodStartDate = toIsoDate(run?.period_start_date, "periodStartDate");
  const periodEndDate = toIsoDate(run?.period_end_date, "periodEndDate");
  const runStatus = normalizeConsolidationStatus(run?.status);
  const shouldCheckRunEntryPairs = ["COMPLETED", "LOCKED"].includes(runStatus);
  const featureEnabled = await isTenantFeatureEnabled({
    tenantId,
    featureCode: FEATURE_SUBACCOUNTS_V1,
    runQuery,
  });

  try {
    const totalsResult = await runQuery(
      `SELECT COUNT(DISTINCT ba.id) AS total_bank_account_count
       FROM consolidation_group_members cgm
       JOIN bank_accounts ba
         ON ba.tenant_id = ?
        AND ba.legal_entity_id = cgm.legal_entity_id
        AND ba.is_active = TRUE
       WHERE cgm.consolidation_group_id = ?
         AND cgm.effective_from <= ?
         AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)`,
      [tenantId, consolidationGroupId, periodEndDate, periodStartDate],
    );

    const missingCanonicalResult = await runQuery(
      `SELECT COUNT(DISTINCT ba.id) AS missing_count
       FROM consolidation_group_members cgm
       JOIN bank_accounts ba
         ON ba.tenant_id = ?
        AND ba.legal_entity_id = cgm.legal_entity_id
        AND ba.is_active = TRUE
       LEFT JOIN consolidation_canonical_local_account_mappings clm
         ON clm.tenant_id = ba.tenant_id
        AND clm.consolidation_group_id = cgm.consolidation_group_id
        AND clm.legal_entity_id = ba.legal_entity_id
        AND clm.local_account_id = ba.gl_account_id
        AND clm.status = 'ACTIVE'
        AND clm.effective_from <= ?
        AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
       LEFT JOIN consolidation_canonical_keys cck
         ON cck.id = clm.canonical_key_id
        AND cck.tenant_id = clm.tenant_id
        AND cck.consolidation_group_id = clm.consolidation_group_id
        AND cck.status = 'ACTIVE'
       LEFT JOIN consolidation_canonical_group_account_mappings ccgm
         ON ccgm.tenant_id = clm.tenant_id
        AND ccgm.consolidation_group_id = clm.consolidation_group_id
        AND ccgm.canonical_key_id = clm.canonical_key_id
        AND ccgm.status = 'ACTIVE'
        AND ccgm.effective_from <= ?
        AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
       WHERE cgm.consolidation_group_id = ?
         AND cgm.effective_from <= ?
         AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
         AND (clm.id IS NULL OR cck.id IS NULL OR ccgm.id IS NULL)`,
      [
        tenantId,
        periodEndDate,
        periodStartDate,
        periodEndDate,
        periodStartDate,
        consolidationGroupId,
        periodEndDate,
        periodStartDate,
      ],
    );

    const missingCanonicalSampleResult = await runQuery(
      `SELECT
         ba.id AS bank_account_id,
         ba.code AS bank_account_code,
         ba.name AS bank_account_name,
         ba.legal_entity_id,
         le.code AS legal_entity_code,
         local_acc.id AS local_account_id,
         local_acc.code AS local_account_code,
         local_acc.name AS local_account_name
       FROM consolidation_group_members cgm
       JOIN bank_accounts ba
         ON ba.tenant_id = ?
        AND ba.legal_entity_id = cgm.legal_entity_id
        AND ba.is_active = TRUE
       JOIN accounts local_acc ON local_acc.id = ba.gl_account_id
       LEFT JOIN legal_entities le ON le.id = ba.legal_entity_id
       LEFT JOIN consolidation_canonical_local_account_mappings clm
         ON clm.tenant_id = ba.tenant_id
        AND clm.consolidation_group_id = cgm.consolidation_group_id
        AND clm.legal_entity_id = ba.legal_entity_id
        AND clm.local_account_id = ba.gl_account_id
        AND clm.status = 'ACTIVE'
        AND clm.effective_from <= ?
        AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
       LEFT JOIN consolidation_canonical_keys cck
         ON cck.id = clm.canonical_key_id
        AND cck.tenant_id = clm.tenant_id
        AND cck.consolidation_group_id = clm.consolidation_group_id
        AND cck.status = 'ACTIVE'
       LEFT JOIN consolidation_canonical_group_account_mappings ccgm
         ON ccgm.tenant_id = clm.tenant_id
        AND ccgm.consolidation_group_id = clm.consolidation_group_id
        AND ccgm.canonical_key_id = clm.canonical_key_id
        AND ccgm.status = 'ACTIVE'
        AND ccgm.effective_from <= ?
        AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
       WHERE cgm.consolidation_group_id = ?
         AND cgm.effective_from <= ?
         AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
         AND (clm.id IS NULL OR cck.id IS NULL OR ccgm.id IS NULL)
       ORDER BY ba.code ASC, ba.id ASC
       LIMIT 5`,
      [
        tenantId,
        periodEndDate,
        periodStartDate,
        periodEndDate,
        periodStartDate,
        consolidationGroupId,
        periodEndDate,
        periodStartDate,
      ],
    );

    let missingRunEntryPairCount = null;
    let missingRunEntryPairSamples = [];
    if (shouldCheckRunEntryPairs) {
      const missingPairsResult = await runQuery(
        `SELECT COUNT(*) AS missing_count
         FROM (
           SELECT DISTINCT
             ba.legal_entity_id,
             ccgm.group_account_id
           FROM consolidation_group_members cgm
           JOIN bank_accounts ba
             ON ba.tenant_id = ?
            AND ba.legal_entity_id = cgm.legal_entity_id
            AND ba.is_active = TRUE
           JOIN consolidation_canonical_local_account_mappings clm
             ON clm.tenant_id = ba.tenant_id
            AND clm.consolidation_group_id = cgm.consolidation_group_id
            AND clm.legal_entity_id = ba.legal_entity_id
            AND clm.local_account_id = ba.gl_account_id
            AND clm.status = 'ACTIVE'
            AND clm.effective_from <= ?
            AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
           JOIN consolidation_canonical_keys cck
             ON cck.id = clm.canonical_key_id
            AND cck.tenant_id = clm.tenant_id
            AND cck.consolidation_group_id = clm.consolidation_group_id
            AND cck.status = 'ACTIVE'
           JOIN consolidation_canonical_group_account_mappings ccgm
             ON ccgm.tenant_id = clm.tenant_id
            AND ccgm.consolidation_group_id = clm.consolidation_group_id
            AND ccgm.canonical_key_id = clm.canonical_key_id
            AND ccgm.status = 'ACTIVE'
            AND ccgm.effective_from <= ?
            AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
           WHERE cgm.consolidation_group_id = ?
             AND cgm.effective_from <= ?
             AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
         ) mapped_pairs
         LEFT JOIN consolidation_run_entries cre
           ON cre.consolidation_run_id = ?
          AND cre.legal_entity_id = mapped_pairs.legal_entity_id
          AND cre.group_account_id = mapped_pairs.group_account_id
         WHERE cre.id IS NULL`,
        [
          tenantId,
          periodEndDate,
          periodStartDate,
          periodEndDate,
          periodStartDate,
          consolidationGroupId,
          periodEndDate,
          periodStartDate,
          runId,
        ],
      );
      missingRunEntryPairCount = Number(
        missingPairsResult.rows?.[0]?.missing_count || 0,
      );

      if (missingRunEntryPairCount > 0) {
        const missingPairsSampleResult = await runQuery(
          `SELECT
             mapped_pairs.legal_entity_id,
             le.code AS legal_entity_code,
             mapped_pairs.group_account_id,
             ga.code AS group_account_code
           FROM (
             SELECT DISTINCT
               ba.legal_entity_id,
               ccgm.group_account_id
             FROM consolidation_group_members cgm
             JOIN bank_accounts ba
               ON ba.tenant_id = ?
              AND ba.legal_entity_id = cgm.legal_entity_id
              AND ba.is_active = TRUE
             JOIN consolidation_canonical_local_account_mappings clm
               ON clm.tenant_id = ba.tenant_id
              AND clm.consolidation_group_id = cgm.consolidation_group_id
              AND clm.legal_entity_id = ba.legal_entity_id
              AND clm.local_account_id = ba.gl_account_id
              AND clm.status = 'ACTIVE'
              AND clm.effective_from <= ?
              AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
             JOIN consolidation_canonical_keys cck
               ON cck.id = clm.canonical_key_id
              AND cck.tenant_id = clm.tenant_id
              AND cck.consolidation_group_id = clm.consolidation_group_id
              AND cck.status = 'ACTIVE'
             JOIN consolidation_canonical_group_account_mappings ccgm
               ON ccgm.tenant_id = clm.tenant_id
              AND ccgm.consolidation_group_id = clm.consolidation_group_id
              AND ccgm.canonical_key_id = clm.canonical_key_id
              AND ccgm.status = 'ACTIVE'
              AND ccgm.effective_from <= ?
              AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
             WHERE cgm.consolidation_group_id = ?
               AND cgm.effective_from <= ?
               AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
           ) mapped_pairs
           LEFT JOIN consolidation_run_entries cre
             ON cre.consolidation_run_id = ?
            AND cre.legal_entity_id = mapped_pairs.legal_entity_id
            AND cre.group_account_id = mapped_pairs.group_account_id
           LEFT JOIN legal_entities le ON le.id = mapped_pairs.legal_entity_id
           LEFT JOIN accounts ga ON ga.id = mapped_pairs.group_account_id
           WHERE cre.id IS NULL
           ORDER BY le.code ASC, ga.code ASC
           LIMIT 5`,
          [
            tenantId,
            periodEndDate,
            periodStartDate,
            periodEndDate,
            periodStartDate,
            consolidationGroupId,
            periodEndDate,
            periodStartDate,
            runId,
          ],
        );
        missingRunEntryPairSamples = (missingPairsSampleResult.rows || []).map(
          (row) => ({
            legalEntityId: parsePositiveInt(row.legal_entity_id),
            legalEntityCode: row.legal_entity_code || null,
            groupAccountId: parsePositiveInt(row.group_account_id),
            groupAccountCode: row.group_account_code || null,
          }),
        );
      }
    }

    const totalBankAccounts = Number(
      totalsResult.rows?.[0]?.total_bank_account_count || 0,
    );
    const missingCanonicalMappingCount = Number(
      missingCanonicalResult.rows?.[0]?.missing_count || 0,
    );
    const mappingOk = missingCanonicalMappingCount === 0;
    const runOutputOk =
      missingRunEntryPairCount === null
        ? true
        : Number(missingRunEntryPairCount) === 0;
    const ok = mappingOk && runOutputOk;

    return {
      ok,
      featureEnabled,
      totalActiveBankAccounts: totalBankAccounts,
      missingCanonicalMappingCount,
      missingRunEntryPairCount,
      checks: {
        canonicalMappingCoverage: mappingOk,
        runOutputCoverage: runOutputOk,
      },
      samples: {
        missingCanonicalMappings: (missingCanonicalSampleResult.rows || []).map(
          (row) => ({
            bankAccountId: parsePositiveInt(row.bank_account_id),
            bankAccountCode: row.bank_account_code || null,
            bankAccountName: row.bank_account_name || null,
            legalEntityId: parsePositiveInt(row.legal_entity_id),
            legalEntityCode: row.legal_entity_code || null,
            localAccountId: parsePositiveInt(row.local_account_id),
            localAccountCode: row.local_account_code || null,
            localAccountName: row.local_account_name || null,
          }),
        ),
        missingRunEntryPairs: missingRunEntryPairSamples,
      },
      message: ok
        ? "Subaccounts compatibility check passed for consolidation mappings and run output coverage."
        : "Subaccounts compatibility check found missing canonical mappings and/or missing consolidation run coverage for bank-linked accounts.",
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        ok: true,
        featureEnabled,
        skipped: true,
        message:
          "Subaccounts compatibility check skipped because required tables are not available.",
      };
    }
    throw err;
  }
}

async function evaluateApprovalGateCompatibility({
  tenantId,
  runId,
  run,
  runQuery = query,
}) {
  const featureEnabled = await isTenantFeatureEnabled({
    tenantId,
    featureCode: FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1,
    runQuery,
  });

  if (!featureEnabled) {
    return {
      ok: true,
      featureEnabled: false,
      required: false,
      approved: true,
      status: "DISABLED",
      code: null,
      assignmentId: null,
      workflowDefinitionId: null,
      instanceId: null,
      currentStepNo: null,
      message: "Workflow approval gate feature is disabled for tenant.",
    };
  }

  const periodEndDate = toIsoDate(run?.period_end_date, "periodEndDate");
  const groupCompanyId = parsePositiveInt(run?.group_company_id) || -1;
  try {
    const assignmentResult = await runQuery(
      `SELECT
         wa.id,
         wa.workflow_definition_id
       FROM workflow_assignments wa
       WHERE wa.tenant_id = ?
         AND wa.process_type = 'CONSOLIDATION_RUN'
         AND wa.status = 'ACTIVE'
         AND wa.effective_from <= ?
         AND (wa.effective_to IS NULL OR wa.effective_to >= ?)
         AND (
           (wa.group_company_id IS NOT NULL AND wa.group_company_id = ?)
           OR (
             wa.group_company_id IS NULL
             AND wa.legal_entity_id IS NULL
             AND wa.operating_unit_id IS NULL
           )
         )
       ORDER BY
         CASE WHEN wa.group_company_id IS NOT NULL THEN 0 ELSE 1 END,
         wa.id DESC
       LIMIT 1`,
      [tenantId, periodEndDate, periodEndDate, groupCompanyId],
    );

    const assignment = assignmentResult.rows?.[0] || null;
    if (!assignment) {
      return {
        ok: false,
        featureEnabled: true,
        required: true,
        approved: false,
        status: "MISSING_ASSIGNMENT",
        code: "WORKFLOW_NOT_ASSIGNED",
        assignmentId: null,
        workflowDefinitionId: null,
        instanceId: null,
        currentStepNo: null,
        message:
          "Workflow gate is enabled but no ACTIVE consolidation workflow assignment was found for scope.",
      };
    }

    const instanceResult = await runQuery(
      `SELECT
         id,
         workflow_definition_id,
         status,
         current_step_no
       FROM workflow_instances
       WHERE tenant_id = ?
         AND process_type = 'CONSOLIDATION_RUN'
         AND target_type = 'CONSOLIDATION_RUN'
         AND target_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [tenantId, runId],
    );

    const instance = instanceResult.rows?.[0] || null;
    if (!instance) {
      return {
        ok: false,
        featureEnabled: true,
        required: true,
        approved: false,
        status: "INSTANCE_MISSING",
        code: "APPROVAL_REQUIRED",
        assignmentId: parsePositiveInt(assignment.id),
        workflowDefinitionId: parsePositiveInt(
          assignment.workflow_definition_id,
        ),
        instanceId: null,
        currentStepNo: null,
        message:
          "Workflow gate is enabled and assigned, but no workflow instance exists for this consolidation run yet.",
      };
    }

    const normalizedStatus = normalizeConsolidationStatus(instance.status);
    const approved = normalizedStatus === "APPROVED";
    const code = approved
      ? null
      : normalizedStatus === "REJECTED"
        ? "APPROVAL_INSTANCE_REJECTED"
        : "APPROVAL_REQUIRED";

    return {
      ok: approved,
      featureEnabled: true,
      required: true,
      approved,
      status: normalizedStatus || "PENDING",
      code,
      assignmentId: parsePositiveInt(assignment.id),
      workflowDefinitionId: parsePositiveInt(instance.workflow_definition_id),
      instanceId: parsePositiveInt(instance.id),
      currentStepNo: parsePositiveInt(instance.current_step_no),
      message: approved
        ? "Workflow gate is approved for consolidation finalization."
        : "Workflow gate is not yet approved for consolidation finalization.",
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        ok: true,
        featureEnabled: true,
        skipped: true,
        required: false,
        approved: true,
        status: "SKIPPED_MISSING_TABLES",
        code: null,
        assignmentId: null,
        workflowDefinitionId: null,
        instanceId: null,
        currentStepNo: null,
        message:
          "Approval gate compatibility check skipped because workflow tables are not available.",
      };
    }
    throw err;
  }
}

async function evaluateTaxPostedLinesCompatibility({
  tenantId,
  runId,
  run,
  runQuery = query,
}) {
  const consolidationGroupId = parsePositiveInt(run?.consolidation_group_id);
  const fiscalPeriodId = parsePositiveInt(run?.fiscal_period_id);
  const periodStartDate = toIsoDate(run?.period_start_date, "periodStartDate");
  const periodEndDate = toIsoDate(run?.period_end_date, "periodEndDate");
  const runStatus = normalizeConsolidationStatus(run?.status);
  const shouldCheckRunEntryPairs = ["COMPLETED", "LOCKED"].includes(runStatus);
  const featureEnabled = await isTenantFeatureEnabled({
    tenantId,
    featureCode: FEATURE_TAX_ENGINE_V1,
    runQuery,
  });

  try {
    const totalsResult = await runQuery(
      `SELECT
         COUNT(*) AS tax_line_count,
         COUNT(DISTINCT jl.account_id) AS tax_account_count,
         SUM(jl.debit_base) AS tax_debit_base_total,
         SUM(jl.credit_base) AS tax_credit_base_total,
         SUM(jl.debit_base - jl.credit_base) AS tax_balance_base_total
       FROM consolidation_group_members cgm
       JOIN journal_entries je
         ON je.tenant_id = ?
        AND je.legal_entity_id = cgm.legal_entity_id
        AND je.status = 'POSTED'
        AND je.fiscal_period_id = ?
       JOIN journal_lines jl
         ON jl.journal_entry_id = je.id
        AND jl.tax_code IS NOT NULL
        AND LENGTH(TRIM(jl.tax_code)) > 0
       WHERE cgm.consolidation_group_id = ?
         AND cgm.effective_from <= ?
         AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)`,
      [
        tenantId,
        fiscalPeriodId,
        consolidationGroupId,
        periodEndDate,
        periodStartDate,
      ],
    );

    const unmappedResult = await runQuery(
      `SELECT COUNT(DISTINCT jl.account_id) AS unmapped_tax_account_count
       FROM consolidation_group_members cgm
       JOIN journal_entries je
         ON je.tenant_id = ?
        AND je.legal_entity_id = cgm.legal_entity_id
        AND je.status = 'POSTED'
        AND je.fiscal_period_id = ?
       JOIN journal_lines jl
         ON jl.journal_entry_id = je.id
        AND jl.tax_code IS NOT NULL
        AND LENGTH(TRIM(jl.tax_code)) > 0
       JOIN accounts local_acc ON local_acc.id = jl.account_id
       WHERE cgm.consolidation_group_id = ?
         AND cgm.effective_from <= ?
         AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
         AND NOT EXISTS (
           SELECT 1
           FROM consolidation_canonical_local_account_mappings clm
           JOIN consolidation_canonical_keys cck
             ON cck.id = clm.canonical_key_id
            AND cck.tenant_id = clm.tenant_id
            AND cck.consolidation_group_id = clm.consolidation_group_id
            AND cck.status = 'ACTIVE'
           JOIN consolidation_canonical_group_account_mappings ccgm
             ON ccgm.tenant_id = clm.tenant_id
            AND ccgm.consolidation_group_id = clm.consolidation_group_id
            AND ccgm.canonical_key_id = clm.canonical_key_id
            AND ccgm.status = 'ACTIVE'
            AND ccgm.effective_from <= ?
            AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
           WHERE clm.tenant_id = je.tenant_id
             AND clm.consolidation_group_id = cgm.consolidation_group_id
             AND clm.legal_entity_id = je.legal_entity_id
             AND clm.local_account_id = local_acc.id
             AND clm.status = 'ACTIVE'
             AND clm.effective_from <= ?
             AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
         )`,
      [
        tenantId,
        fiscalPeriodId,
        consolidationGroupId,
        periodEndDate,
        periodStartDate,
        periodEndDate,
        periodStartDate,
        periodEndDate,
        periodStartDate,
      ],
    );

    const unmappedSampleResult = await runQuery(
      `SELECT
         local_acc.id AS local_account_id,
         local_acc.code AS local_account_code,
         local_acc.name AS local_account_name,
         je.legal_entity_id,
         le.code AS legal_entity_code
       FROM consolidation_group_members cgm
       JOIN journal_entries je
         ON je.tenant_id = ?
        AND je.legal_entity_id = cgm.legal_entity_id
        AND je.status = 'POSTED'
        AND je.fiscal_period_id = ?
       JOIN journal_lines jl
         ON jl.journal_entry_id = je.id
        AND jl.tax_code IS NOT NULL
        AND LENGTH(TRIM(jl.tax_code)) > 0
       JOIN accounts local_acc ON local_acc.id = jl.account_id
       LEFT JOIN legal_entities le ON le.id = je.legal_entity_id
       WHERE cgm.consolidation_group_id = ?
         AND cgm.effective_from <= ?
         AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
         AND NOT EXISTS (
           SELECT 1
           FROM consolidation_canonical_local_account_mappings clm
           JOIN consolidation_canonical_keys cck
             ON cck.id = clm.canonical_key_id
            AND cck.tenant_id = clm.tenant_id
            AND cck.consolidation_group_id = clm.consolidation_group_id
            AND cck.status = 'ACTIVE'
           JOIN consolidation_canonical_group_account_mappings ccgm
             ON ccgm.tenant_id = clm.tenant_id
            AND ccgm.consolidation_group_id = clm.consolidation_group_id
            AND ccgm.canonical_key_id = clm.canonical_key_id
            AND ccgm.status = 'ACTIVE'
            AND ccgm.effective_from <= ?
            AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
           WHERE clm.tenant_id = je.tenant_id
             AND clm.consolidation_group_id = cgm.consolidation_group_id
             AND clm.legal_entity_id = je.legal_entity_id
             AND clm.local_account_id = local_acc.id
             AND clm.status = 'ACTIVE'
             AND clm.effective_from <= ?
             AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
         )
       GROUP BY
         local_acc.id,
         local_acc.code,
         local_acc.name,
         je.legal_entity_id,
         le.code
       ORDER BY local_acc.code ASC
       LIMIT 5`,
      [
        tenantId,
        fiscalPeriodId,
        consolidationGroupId,
        periodEndDate,
        periodStartDate,
        periodEndDate,
        periodStartDate,
        periodEndDate,
        periodStartDate,
      ],
    );

    let missingRunEntryPairCount = null;
    let missingRunEntryPairSamples = [];
    if (shouldCheckRunEntryPairs) {
      const missingPairsResult = await runQuery(
        `SELECT COUNT(*) AS missing_count
         FROM (
           SELECT DISTINCT
             je.legal_entity_id,
             ccgm.group_account_id
           FROM consolidation_group_members cgm
           JOIN journal_entries je
             ON je.tenant_id = ?
            AND je.legal_entity_id = cgm.legal_entity_id
            AND je.status = 'POSTED'
            AND je.fiscal_period_id = ?
           JOIN journal_lines jl
             ON jl.journal_entry_id = je.id
            AND jl.tax_code IS NOT NULL
            AND LENGTH(TRIM(jl.tax_code)) > 0
           JOIN consolidation_canonical_local_account_mappings clm
             ON clm.tenant_id = je.tenant_id
            AND clm.consolidation_group_id = cgm.consolidation_group_id
            AND clm.legal_entity_id = je.legal_entity_id
            AND clm.local_account_id = jl.account_id
            AND clm.status = 'ACTIVE'
            AND clm.effective_from <= ?
            AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
           JOIN consolidation_canonical_keys cck
             ON cck.id = clm.canonical_key_id
            AND cck.tenant_id = clm.tenant_id
            AND cck.consolidation_group_id = clm.consolidation_group_id
            AND cck.status = 'ACTIVE'
           JOIN consolidation_canonical_group_account_mappings ccgm
             ON ccgm.tenant_id = clm.tenant_id
            AND ccgm.consolidation_group_id = clm.consolidation_group_id
            AND ccgm.canonical_key_id = clm.canonical_key_id
            AND ccgm.status = 'ACTIVE'
            AND ccgm.effective_from <= ?
            AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
           WHERE cgm.consolidation_group_id = ?
             AND cgm.effective_from <= ?
             AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
         ) mapped_pairs
         LEFT JOIN consolidation_run_entries cre
           ON cre.consolidation_run_id = ?
          AND cre.legal_entity_id = mapped_pairs.legal_entity_id
          AND cre.group_account_id = mapped_pairs.group_account_id
         WHERE cre.id IS NULL`,
        [
          tenantId,
          fiscalPeriodId,
          periodEndDate,
          periodStartDate,
          periodEndDate,
          periodStartDate,
          consolidationGroupId,
          periodEndDate,
          periodStartDate,
          runId,
        ],
      );
      missingRunEntryPairCount = Number(
        missingPairsResult.rows?.[0]?.missing_count || 0,
      );

      if (missingRunEntryPairCount > 0) {
        const missingPairsSampleResult = await runQuery(
          `SELECT
             mapped_pairs.legal_entity_id,
             le.code AS legal_entity_code,
             mapped_pairs.group_account_id,
             ga.code AS group_account_code
           FROM (
             SELECT DISTINCT
               je.legal_entity_id,
               ccgm.group_account_id
             FROM consolidation_group_members cgm
             JOIN journal_entries je
               ON je.tenant_id = ?
              AND je.legal_entity_id = cgm.legal_entity_id
              AND je.status = 'POSTED'
              AND je.fiscal_period_id = ?
             JOIN journal_lines jl
               ON jl.journal_entry_id = je.id
              AND jl.tax_code IS NOT NULL
              AND LENGTH(TRIM(jl.tax_code)) > 0
             JOIN consolidation_canonical_local_account_mappings clm
               ON clm.tenant_id = je.tenant_id
              AND clm.consolidation_group_id = cgm.consolidation_group_id
              AND clm.legal_entity_id = je.legal_entity_id
              AND clm.local_account_id = jl.account_id
              AND clm.status = 'ACTIVE'
              AND clm.effective_from <= ?
              AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
             JOIN consolidation_canonical_keys cck
               ON cck.id = clm.canonical_key_id
              AND cck.tenant_id = clm.tenant_id
              AND cck.consolidation_group_id = clm.consolidation_group_id
              AND cck.status = 'ACTIVE'
             JOIN consolidation_canonical_group_account_mappings ccgm
               ON ccgm.tenant_id = clm.tenant_id
              AND ccgm.consolidation_group_id = clm.consolidation_group_id
              AND ccgm.canonical_key_id = clm.canonical_key_id
              AND ccgm.status = 'ACTIVE'
              AND ccgm.effective_from <= ?
              AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
             WHERE cgm.consolidation_group_id = ?
               AND cgm.effective_from <= ?
               AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
           ) mapped_pairs
           LEFT JOIN consolidation_run_entries cre
             ON cre.consolidation_run_id = ?
            AND cre.legal_entity_id = mapped_pairs.legal_entity_id
            AND cre.group_account_id = mapped_pairs.group_account_id
           LEFT JOIN legal_entities le ON le.id = mapped_pairs.legal_entity_id
           LEFT JOIN accounts ga ON ga.id = mapped_pairs.group_account_id
           WHERE cre.id IS NULL
           ORDER BY le.code ASC, ga.code ASC
           LIMIT 5`,
          [
            tenantId,
            fiscalPeriodId,
            periodEndDate,
            periodStartDate,
            periodEndDate,
            periodStartDate,
            consolidationGroupId,
            periodEndDate,
            periodStartDate,
            runId,
          ],
        );
        missingRunEntryPairSamples = (missingPairsSampleResult.rows || []).map(
          (row) => ({
            legalEntityId: parsePositiveInt(row.legal_entity_id),
            legalEntityCode: row.legal_entity_code || null,
            groupAccountId: parsePositiveInt(row.group_account_id),
            groupAccountCode: row.group_account_code || null,
          }),
        );
      }
    }

    const taxLineCount = Number(totalsResult.rows?.[0]?.tax_line_count || 0);
    const taxAccountCount = Number(
      totalsResult.rows?.[0]?.tax_account_count || 0,
    );
    const unmappedTaxAccountCount = Number(
      unmappedResult.rows?.[0]?.unmapped_tax_account_count || 0,
    );
    const mappingOk = unmappedTaxAccountCount === 0;
    const runOutputOk =
      missingRunEntryPairCount === null
        ? true
        : Number(missingRunEntryPairCount) === 0;
    const ok = mappingOk && runOutputOk;

    return {
      ok,
      featureEnabled,
      postedTaxLineCount: taxLineCount,
      postedTaxAccountCount: taxAccountCount,
      unmappedTaxAccountCount,
      missingRunEntryPairCount,
      totals: {
        localDebitBaseTotal: Number(
          totalsResult.rows?.[0]?.tax_debit_base_total || 0,
        ),
        localCreditBaseTotal: Number(
          totalsResult.rows?.[0]?.tax_credit_base_total || 0,
        ),
        localBalanceBaseTotal: Number(
          totalsResult.rows?.[0]?.tax_balance_base_total || 0,
        ),
      },
      checks: {
        canonicalMappingCoverage: mappingOk,
        runOutputCoverage: runOutputOk,
      },
      samples: {
        unmappedTaxAccounts: (unmappedSampleResult.rows || []).map((row) => ({
          localAccountId: parsePositiveInt(row.local_account_id),
          localAccountCode: row.local_account_code || null,
          localAccountName: row.local_account_name || null,
          legalEntityId: parsePositiveInt(row.legal_entity_id),
          legalEntityCode: row.legal_entity_code || null,
        })),
        missingRunEntryPairs: missingRunEntryPairSamples,
      },
      message: ok
        ? "Tax-posted lines reconcile through canonical mappings into consolidation output."
        : "Tax-posted lines have unresolved canonical mappings and/or missing consolidation run coverage.",
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        ok: true,
        featureEnabled,
        skipped: true,
        postedTaxLineCount: 0,
        postedTaxAccountCount: 0,
        unmappedTaxAccountCount: 0,
        missingRunEntryPairCount: null,
        totals: {
          localDebitBaseTotal: 0,
          localCreditBaseTotal: 0,
          localBalanceBaseTotal: 0,
        },
        checks: {
          canonicalMappingCoverage: true,
          runOutputCoverage: true,
        },
        samples: {
          unmappedTaxAccounts: [],
          missingRunEntryPairs: [],
        },
        message:
          "Tax compatibility check skipped because required tables are not available.",
      };
    }
    throw err;
  }
}

async function buildCrossTrackCompatibilitySnapshot({
  tenantId,
  runId,
  run,
  runQuery = query,
}) {
  const subaccounts = await evaluateSubaccountsCompatibility({
    tenantId,
    runId,
    run,
    runQuery,
  });
  const approvalGate = await evaluateApprovalGateCompatibility({
    tenantId,
    runId,
    run,
    runQuery,
  });
  const taxPostedLines = await evaluateTaxPostedLinesCompatibility({
    tenantId,
    runId,
    run,
    runQuery,
  });

  return {
    ok:
      Boolean(subaccounts?.ok) &&
      Boolean(approvalGate?.ok) &&
      Boolean(taxPostedLines?.ok),
    generatedAt: new Date().toISOString(),
    subaccounts,
    approvalGate,
    taxPostedLines,
  };
}

async function getRunWithContext(tenantId, runId) {
  const result = await query(
    `SELECT
       cr.id,
       cr.consolidation_group_id,
       cr.fiscal_period_id,
       cr.run_name,
       cr.status,
       cr.presentation_currency_code,
       cr.started_by_user_id,
       cr.started_at,
       cr.finished_at,
       cr.notes,
       cg.tenant_id,
       cg.group_company_id,
       cg.code AS consolidation_group_code,
       cg.name AS consolidation_group_name,
       fp.start_date AS period_start_date,
       fp.end_date AS period_end_date
     FROM consolidation_runs cr
     JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
     JOIN fiscal_periods fp ON fp.id = cr.fiscal_period_id
     WHERE cr.id = ?
       AND cg.tenant_id = ?
     LIMIT 1`,
    [runId, tenantId],
  );

  return result.rows[0] || null;
}

async function requireRun(tenantId, runId) {
  const run = await getRunWithContext(tenantId, runId);
  if (!run) {
    throw badRequest("Consolidation run not found");
  }
  return run;
}

async function resolveRunScope(runId, tenantId) {
  const parsedRunId = parsePositiveInt(runId);
  if (!parsedRunId) {
    return { scopeType: "TENANT", scopeId: tenantId };
  }

  const run = await getRunWithContext(tenantId, parsedRunId);
  const groupCompanyId = parsePositiveInt(run?.group_company_id);
  if (groupCompanyId) {
    return { scopeType: "GROUP", scopeId: groupCompanyId };
  }

  return { scopeType: "TENANT", scopeId: tenantId };
}

async function resolveFxRate({
  tenantId,
  rateDate,
  fromCurrencyCode,
  toCurrencyCode,
  preferredRateType,
  runQuery = query,
}) {
  const fromCode = String(fromCurrencyCode || "").toUpperCase();
  const toCode = String(toCurrencyCode || "").toUpperCase();

  if (!fromCode || !toCode) {
    throw badRequest("Currency codes are required for FX translation");
  }

  if (fromCode === toCode) {
    return {
      rate: 1,
      rateType: "IDENTITY",
      rateDate,
    };
  }

  const fallbackOrder = [
    preferredRateType,
    "CLOSING",
    "SPOT",
    "AVERAGE",
  ].filter(
    (value, index, arr) =>
      VALID_FX_RATE_TYPES.has(value) && arr.indexOf(value) === index,
  );
  if (fallbackOrder.length === 0) {
    fallbackOrder.push("CLOSING", "SPOT", "AVERAGE");
  }

  const result = await runQuery(
    `SELECT rate, rate_type, rate_date
     FROM fx_rates
     WHERE tenant_id = ?
       AND from_currency_code = ?
       AND to_currency_code = ?
       AND rate_type IN (${fallbackOrder.map(() => "?").join(", ")})
       AND rate_date <= ?
     ORDER BY rate_date DESC,
              FIELD(rate_type, ${fallbackOrder.map(() => "?").join(", ")})
     LIMIT 1`,
    [tenantId, fromCode, toCode, ...fallbackOrder, rateDate, ...fallbackOrder],
  );

  const row = result.rows[0];
  if (!row) {
    throw badRequest(
      `FX rate not found for ${fromCode}->${toCode} on or before ${rateDate}`,
    );
  }

  return {
    rate: Number(row.rate),
    rateType: String(row.rate_type),
    rateDate: row.rate_date,
  };
}

async function assertCanonicalMappingCoverage({
  tenantId,
  consolidationGroupId,
  fiscalPeriodId,
  legalEntityId,
  effectiveOn,
  runQuery = query,
}) {
  function isDateCovered(fromValue, toValue, asOfDate) {
    const from = String(fromValue || "").slice(0, 10);
    const to = String(toValue || "").slice(0, 10);
    const asOf = String(asOfDate || "").slice(0, 10);
    if (!from || !asOf) {
      return false;
    }
    if (from > asOf) {
      return false;
    }
    if (to && to < asOf) {
      return false;
    }
    return true;
  }

  function resolveUncoveredReason(row, asOfDate) {
    const localMappingId = parsePositiveInt(row?.local_mapping_id);
    const localStatus = String(row?.local_mapping_status || "").toUpperCase();
    const localCoveredByDate = isDateCovered(
      row?.local_effective_from,
      row?.local_effective_to,
      asOfDate,
    );

    const canonicalKeyId = parsePositiveInt(row?.canonical_key_id);
    const canonicalKeyStatus = String(
      row?.canonical_key_status || "",
    ).toUpperCase();

    const groupMappingId = parsePositiveInt(row?.group_mapping_id);
    const groupMappingStatus = String(
      row?.group_mapping_status || "",
    ).toUpperCase();
    const groupCoveredByDate = isDateCovered(
      row?.group_effective_from,
      row?.group_effective_to,
      asOfDate,
    );

    if (!localMappingId) {
      return "LOCAL_MAPPING_MISSING";
    }
    if (localStatus !== "ACTIVE") {
      return "LOCAL_MAPPING_INACTIVE";
    }
    if (!localCoveredByDate) {
      return "LOCAL_MAPPING_DATE_MISMATCH";
    }
    if (!canonicalKeyId) {
      return "CANONICAL_KEY_MISSING";
    }
    if (canonicalKeyStatus !== "ACTIVE") {
      return "CANONICAL_KEY_INACTIVE";
    }
    if (!groupMappingId) {
      return "GROUP_MAPPING_MISSING";
    }
    if (groupMappingStatus !== "ACTIVE") {
      return "GROUP_MAPPING_INACTIVE";
    }
    if (!groupCoveredByDate) {
      return "GROUP_MAPPING_DATE_MISMATCH";
    }
    return "UNKNOWN";
  }

  const uncoveredResult = await runQuery(
    `SELECT COUNT(DISTINCT local_acc.id) AS uncovered_count
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     JOIN accounts local_acc ON local_acc.id = jl.account_id
     WHERE je.tenant_id = ?
       AND je.status = 'POSTED'
       AND je.fiscal_period_id = ?
       AND je.legal_entity_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM consolidation_canonical_local_account_mappings clm
         JOIN consolidation_canonical_keys cck
           ON cck.id = clm.canonical_key_id
          AND cck.tenant_id = clm.tenant_id
          AND cck.consolidation_group_id = clm.consolidation_group_id
          AND cck.status = 'ACTIVE'
         JOIN consolidation_canonical_group_account_mappings ccgm
           ON ccgm.tenant_id = clm.tenant_id
          AND ccgm.consolidation_group_id = clm.consolidation_group_id
          AND ccgm.canonical_key_id = clm.canonical_key_id
          AND ccgm.status = 'ACTIVE'
          AND ccgm.effective_from <= ?
          AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
         WHERE clm.tenant_id = je.tenant_id
           AND clm.consolidation_group_id = ?
           AND clm.legal_entity_id = je.legal_entity_id
           AND clm.local_account_id = local_acc.id
           AND clm.status = 'ACTIVE'
           AND clm.effective_from <= ?
           AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
       )`,
    [
      tenantId,
      fiscalPeriodId,
      legalEntityId,
      effectiveOn,
      effectiveOn,
      consolidationGroupId,
      effectiveOn,
      effectiveOn,
    ],
  );
  const uncoveredCount = Number(
    uncoveredResult.rows?.[0]?.uncovered_count || 0,
  );
  if (uncoveredCount <= 0) {
    return;
  }

  const sampleResult = await runQuery(
    `SELECT
       local_acc.id AS local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       clm.id AS local_mapping_id,
       clm.status AS local_mapping_status,
       clm.effective_from AS local_effective_from,
       clm.effective_to AS local_effective_to,
       cck.id AS canonical_key_id,
       cck.canonical_key,
       cck.status AS canonical_key_status,
       ccgm.id AS group_mapping_id,
       ccgm.group_account_id,
       ccgm.status AS group_mapping_status,
       ccgm.effective_from AS group_effective_from,
       ccgm.effective_to AS group_effective_to
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     JOIN accounts local_acc ON local_acc.id = jl.account_id
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = je.tenant_id
      AND clm.consolidation_group_id = ?
      AND clm.legal_entity_id = je.legal_entity_id
      AND clm.local_account_id = local_acc.id
     LEFT JOIN consolidation_canonical_keys cck
       ON cck.id = clm.canonical_key_id
      AND cck.tenant_id = clm.tenant_id
      AND cck.consolidation_group_id = clm.consolidation_group_id
     LEFT JOIN consolidation_canonical_group_account_mappings ccgm
       ON ccgm.tenant_id = clm.tenant_id
      AND ccgm.consolidation_group_id = clm.consolidation_group_id
      AND ccgm.canonical_key_id = clm.canonical_key_id
     WHERE je.tenant_id = ?
       AND je.status = 'POSTED'
       AND je.fiscal_period_id = ?
       AND je.legal_entity_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM consolidation_canonical_local_account_mappings clm2
         JOIN consolidation_canonical_keys cck2
           ON cck2.id = clm2.canonical_key_id
          AND cck2.tenant_id = clm2.tenant_id
          AND cck2.consolidation_group_id = clm2.consolidation_group_id
          AND cck2.status = 'ACTIVE'
         JOIN consolidation_canonical_group_account_mappings ccgm2
           ON ccgm2.tenant_id = clm2.tenant_id
          AND ccgm2.consolidation_group_id = clm2.consolidation_group_id
          AND ccgm2.canonical_key_id = clm2.canonical_key_id
          AND ccgm2.status = 'ACTIVE'
          AND ccgm2.effective_from <= ?
          AND (ccgm2.effective_to IS NULL OR ccgm2.effective_to >= ?)
         WHERE clm2.tenant_id = je.tenant_id
           AND clm2.consolidation_group_id = ?
           AND clm2.legal_entity_id = je.legal_entity_id
           AND clm2.local_account_id = local_acc.id
           AND clm2.status = 'ACTIVE'
           AND clm2.effective_from <= ?
           AND (clm2.effective_to IS NULL OR clm2.effective_to >= ?)
       )
     GROUP BY
       local_acc.id,
       local_acc.code,
       local_acc.name,
       clm.id,
       clm.status,
       clm.effective_from,
       clm.effective_to,
       cck.id,
       cck.canonical_key,
       cck.status,
       ccgm.id,
       ccgm.group_account_id,
       ccgm.status,
       ccgm.effective_from,
       ccgm.effective_to
     ORDER BY local_acc.code ASC
     LIMIT 25`,
    [
      consolidationGroupId,
      tenantId,
      fiscalPeriodId,
      legalEntityId,
      effectiveOn,
      effectiveOn,
      consolidationGroupId,
      effectiveOn,
      effectiveOn,
    ],
  );

  const sampleRows = (sampleResult.rows || []).map((row) => {
    const reasonCode = resolveUncoveredReason(row, effectiveOn);
    return {
      localAccountId: parsePositiveInt(row.local_account_id),
      localAccountCode: row.local_account_code || null,
      localAccountName: row.local_account_name || null,
      reasonCode,
      canonicalKey: row.canonical_key || null,
      canonicalKeyStatus: row.canonical_key_status || null,
      localMapping: {
        id: parsePositiveInt(row.local_mapping_id),
        status: row.local_mapping_status || null,
        effectiveFrom: row.local_effective_from || null,
        effectiveTo: row.local_effective_to || null,
      },
      groupMapping: {
        id: parsePositiveInt(row.group_mapping_id),
        groupAccountId: parsePositiveInt(row.group_account_id),
        status: row.group_mapping_status || null,
        effectiveFrom: row.group_effective_from || null,
        effectiveTo: row.group_effective_to || null,
      },
    };
  });

  const reasonCounts = sampleRows.reduce((acc, row) => {
    const key = String(row?.reasonCode || "UNKNOWN").toUpperCase();
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});

  const sampleCodes = sampleRows
    .map((row) => String(row.localAccountCode || "").trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");

  const err = badRequest(
    `Canonical consolidation mapping is missing for ${uncoveredCount} posted local account(s) in legalEntityId=${legalEntityId}. Sample codes: ${sampleCodes || "n/a"}`,
  );
  err.details = {
    legalEntityId,
    consolidationGroupId,
    fiscalPeriodId,
    effectiveOn,
    uncoveredCount,
    sampledCount: sampleRows.length,
    sampleTruncated: uncoveredCount > sampleRows.length,
    reasonCounts,
    sampleRows,
  };
  throw err;
}

async function loadMemberMappedBalances({
  tenantId,
  consolidationGroupId,
  fiscalPeriodId,
  legalEntityId,
  effectiveOn,
  runQuery = query,
}) {
  await assertCanonicalMappingCoverage({
    tenantId,
    consolidationGroupId,
    fiscalPeriodId,
    legalEntityId,
    effectiveOn,
    runQuery,
  });

  const result = await runQuery(
    `SELECT
       je.legal_entity_id,
       ccgm.group_account_id AS group_account_id,
       SUM(jl.debit_base) AS local_debit_base,
       SUM(jl.credit_base) AS local_credit_base,
       SUM(jl.debit_base - jl.credit_base) AS local_balance_base
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     JOIN accounts local_acc ON local_acc.id = jl.account_id
     JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = je.tenant_id
      AND clm.consolidation_group_id = ?
      AND clm.legal_entity_id = je.legal_entity_id
      AND clm.local_account_id = local_acc.id
      AND clm.status = 'ACTIVE'
      AND clm.effective_from <= ?
      AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
     JOIN consolidation_canonical_keys cck
       ON cck.id = clm.canonical_key_id
      AND cck.tenant_id = clm.tenant_id
      AND cck.consolidation_group_id = clm.consolidation_group_id
      AND cck.status = 'ACTIVE'
     JOIN consolidation_canonical_group_account_mappings ccgm
       ON ccgm.tenant_id = clm.tenant_id
      AND ccgm.consolidation_group_id = clm.consolidation_group_id
      AND ccgm.canonical_key_id = clm.canonical_key_id
      AND ccgm.status = 'ACTIVE'
      AND ccgm.effective_from <= ?
      AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
     JOIN accounts group_acc ON group_acc.id = ccgm.group_account_id
       AND group_acc.is_active = TRUE
     WHERE je.tenant_id = ?
       AND je.status = 'POSTED'
       AND je.fiscal_period_id = ?
       AND je.legal_entity_id = ?
     GROUP BY je.legal_entity_id, ccgm.group_account_id`,
    [
      consolidationGroupId,
      effectiveOn,
      effectiveOn,
      effectiveOn,
      effectiveOn,
      tenantId,
      fiscalPeriodId,
      legalEntityId,
    ],
  );

  return result.rows || [];
}

async function executeConsolidationRun({
  tenantId,
  runId,
  preferredRateType,
  executedByUserId,
}) {
  const run = await getRunWithContext(tenantId, runId);
  if (!run) {
    throw badRequest("Consolidation run not found");
  }

  const consolidationGroupId = parsePositiveInt(run.consolidation_group_id);
  const fiscalPeriodId = parsePositiveInt(run.fiscal_period_id);
  const presentationCurrencyCode = String(
    run.presentation_currency_code || "",
  ).toUpperCase();
  const periodStartDate = toIsoDate(run.period_start_date, "periodStartDate");
  const periodEndDate = toIsoDate(run.period_end_date, "periodEndDate");

  const { insertedRowCount, totals } = await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE consolidation_runs
       SET status = 'IN_PROGRESS',
           notes = ?
       WHERE id = ?`,
      [
        `Execution started by user ${executedByUserId}; mapping_mode=CANONICAL`,
        runId,
      ],
    );

    const memberResult = await tx.query(
      `SELECT
         cgm.legal_entity_id,
         cgm.consolidation_method,
         cgm.ownership_pct,
         le.functional_currency_code
       FROM consolidation_group_members cgm
       JOIN legal_entities le ON le.id = cgm.legal_entity_id
       WHERE cgm.consolidation_group_id = ?
         AND cgm.effective_from <= ?
         AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)`,
      [consolidationGroupId, periodEndDate, periodStartDate],
    );

    await tx.query(
      `DELETE FROM consolidation_run_entries
       WHERE consolidation_run_id = ?`,
      [runId],
    );

    let inserted = 0;

    for (const member of memberResult.rows) {
      const legalEntityId = parsePositiveInt(member.legal_entity_id);
      if (!legalEntityId) {
        continue;
      }

      const method = String(
        member.consolidation_method || "FULL",
      ).toUpperCase();
      const ownershipPct = Number(member.ownership_pct || 1);
      const factor = ownershipFactor(method, ownershipPct);
      const sourceCurrencyCode = String(
        member.functional_currency_code || "",
      ).toUpperCase();

      // eslint-disable-next-line no-await-in-loop
      const fx = await resolveFxRate({
        tenantId,
        rateDate: periodEndDate,
        fromCurrencyCode: sourceCurrencyCode,
        toCurrencyCode: presentationCurrencyCode,
        preferredRateType,
        runQuery: tx.query,
      });

      // eslint-disable-next-line no-await-in-loop
      const rows = await loadMemberMappedBalances({
        tenantId,
        consolidationGroupId,
        fiscalPeriodId,
        legalEntityId,
        effectiveOn: periodEndDate,
        runQuery: tx.query,
      });

      for (const row of rows) {
        const localDebitBase = Number(row.local_debit_base || 0);
        const localCreditBase = Number(row.local_credit_base || 0);
        const localBalanceBase = Number(row.local_balance_base || 0);
        const translationRate = Number(fx.rate || 0);

        const translatedDebit = localDebitBase * translationRate * factor;
        const translatedCredit = localCreditBase * translationRate * factor;
        const translatedBalance = localBalanceBase * translationRate * factor;

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO consolidation_run_entries (
              consolidation_run_id,
              tenant_id,
              consolidation_group_id,
              fiscal_period_id,
              legal_entity_id,
              group_account_id,
              source_currency_code,
              presentation_currency_code,
              consolidation_method,
              ownership_pct,
              translation_rate,
              local_debit_base,
              local_credit_base,
              local_balance_base,
              translated_debit,
              translated_credit,
              translated_balance
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             source_currency_code = VALUES(source_currency_code),
             presentation_currency_code = VALUES(presentation_currency_code),
             consolidation_method = VALUES(consolidation_method),
             ownership_pct = VALUES(ownership_pct),
             translation_rate = VALUES(translation_rate),
             local_debit_base = VALUES(local_debit_base),
             local_credit_base = VALUES(local_credit_base),
             local_balance_base = VALUES(local_balance_base),
             translated_debit = VALUES(translated_debit),
             translated_credit = VALUES(translated_credit),
             translated_balance = VALUES(translated_balance)`,
          [
            runId,
            tenantId,
            consolidationGroupId,
            fiscalPeriodId,
            legalEntityId,
            parsePositiveInt(row.group_account_id),
            sourceCurrencyCode,
            presentationCurrencyCode,
            method,
            ownershipPct,
            translationRate,
            localDebitBase,
            localCreditBase,
            localBalanceBase,
            translatedDebit,
            translatedCredit,
            translatedBalance,
          ],
        );
        inserted += 1;
      }
    }

    const totalResult = await tx.query(
      `SELECT
         SUM(translated_debit) AS translated_debit_total,
         SUM(translated_credit) AS translated_credit_total,
         SUM(translated_balance) AS translated_balance_total
       FROM consolidation_run_entries
       WHERE consolidation_run_id = ?`,
      [runId],
    );
    const calculatedTotals = totalResult.rows[0] || {
      translated_debit_total: 0,
      translated_credit_total: 0,
      translated_balance_total: 0,
    };

    await tx.query(
      `UPDATE consolidation_runs
       SET status = 'COMPLETED',
           finished_at = CURRENT_TIMESTAMP,
         notes = ?
       WHERE id = ?`,
      [
        `Execution completed by user ${executedByUserId}; inserted_rows=${inserted}; rate_type=${preferredRateType}; mapping_mode=CANONICAL`,
        runId,
      ],
    );

    return {
      insertedRowCount: inserted,
      totals: calculatedTotals,
    };
  });

  return {
    run,
    insertedRowCount,
    totals: {
      translatedDebitTotal: Number(totals.translated_debit_total || 0),
      translatedCreditTotal: Number(totals.translated_credit_total || 0),
      translatedBalanceTotal: Number(totals.translated_balance_total || 0),
    },
  };
}

router.get(
  "/groups",
  requirePermission("consolidation.group.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const params = [tenantId];
    const groupFilter = buildScopeFilter(
      req,
      "group",
      "group_company_id",
      params,
    );

    const result = await query(
      `SELECT
         id,
         tenant_id,
         group_company_id,
         calendar_id,
         code,
         name,
         presentation_currency_code,
         status,
         created_at
       FROM consolidation_groups
       WHERE tenant_id = ?
         AND ${groupFilter}
       ORDER BY id`,
      params,
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  }),
);

router.post(
  "/groups",
  requirePermission("consolidation.group.upsert", {
    resolveScope: (req, tenantId) => {
      const groupCompanyId = parsePositiveInt(req.body?.groupCompanyId);
      if (groupCompanyId) {
        return { scopeType: "GROUP", scopeId: groupCompanyId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, [
      "groupCompanyId",
      "calendarId",
      "code",
      "name",
      "presentationCurrencyCode",
    ]);

    const groupCompanyId = parsePositiveInt(req.body.groupCompanyId);
    const calendarId = parsePositiveInt(req.body.calendarId);
    if (!groupCompanyId || !calendarId) {
      throw badRequest(
        "groupCompanyId and calendarId must be positive integers",
      );
    }

    await assertGroupCompanyBelongsToTenant(
      tenantId,
      groupCompanyId,
      "groupCompanyId",
    );
    await assertFiscalCalendarBelongsToTenant(
      tenantId,
      calendarId,
      "calendarId",
    );
    assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");

    const result = await query(
      `INSERT INTO consolidation_groups (
          tenant_id, group_company_id, calendar_id, code, name, presentation_currency_code
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         group_company_id = VALUES(group_company_id),
         calendar_id = VALUES(calendar_id),
         name = VALUES(name),
         presentation_currency_code = VALUES(presentation_currency_code)`,
      [
        tenantId,
        groupCompanyId,
        calendarId,
        String(req.body.code).trim(),
        String(req.body.name).trim(),
        String(req.body.presentationCurrencyCode).toUpperCase(),
      ],
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  }),
);

router.post(
  "/groups/:groupId/members",
  requirePermission("consolidation.group_member.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, ["legalEntityId", "effectiveFrom"]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId",
    );
    assertLegalEntityMatchesGroupCompany(
      legalEntity,
      group.group_company_id,
      "legalEntityId",
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const consolidationMethod = String(
      req.body.consolidationMethod || "FULL",
    ).toUpperCase();
    const ownershipPct =
      req.body.ownershipPct === undefined ? 1 : Number(req.body.ownershipPct);

    const result = await query(
      `INSERT INTO consolidation_group_members (
          consolidation_group_id, legal_entity_id, consolidation_method, ownership_pct, effective_from, effective_to
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         consolidation_method = VALUES(consolidation_method),
         ownership_pct = VALUES(ownership_pct),
         effective_to = VALUES(effective_to)`,
      [
        groupId,
        legalEntityId,
        consolidationMethod,
        ownershipPct,
        String(req.body.effectiveFrom),
        req.body.effectiveTo ? String(req.body.effectiveTo) : null,
      ],
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  }),
);

router.get(
  "/groups/:groupId/members",
  requirePermission("consolidation.group.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }

    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      const legalEntity = await assertLegalEntityBelongsToTenant(
        tenantId,
        legalEntityId,
        "legalEntityId",
      );
      assertLegalEntityMatchesGroupCompany(
        legalEntity,
        group.group_company_id,
        "legalEntityId",
      );
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const conditions = ["cgm.consolidation_group_id = ?"];
    const params = [groupId];
    if (legalEntityId) {
      conditions.push("cgm.legal_entity_id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
      `SELECT
         cgm.id,
         cgm.consolidation_group_id,
         cgm.legal_entity_id,
         le.code AS legal_entity_code,
         le.name AS legal_entity_name,
         cgm.consolidation_method,
         cgm.ownership_pct,
         cgm.effective_from,
         cgm.effective_to
       FROM consolidation_group_members cgm
       JOIN legal_entities le ON le.id = cgm.legal_entity_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY cgm.effective_from DESC, cgm.id DESC`,
      params,
    );

    return res.json({
      tenantId,
      groupId,
      rows: result.rows,
    });
  }),
);

router.get(
  "/groups/:groupId/coa-mappings",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      const legalEntity = await assertLegalEntityBelongsToTenant(
        tenantId,
        legalEntityId,
        "legalEntityId",
      );
      assertLegalEntityMatchesGroupCompany(
        legalEntity,
        group.group_company_id,
        "legalEntityId",
      );
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const conditions = ["tenant_id = ?", "consolidation_group_id = ?"];
    const params = [tenantId, groupId];

    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
      `SELECT
         id,
         tenant_id,
         consolidation_group_id,
         legal_entity_id,
         group_coa_id,
         local_coa_id,
         status,
         created_at,
         updated_at
       FROM group_coa_mappings
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params,
    );

    return res.json({
      tenantId,
      groupId,
      rows: result.rows,
    });
  }),
);

router.post(
  "/groups/:groupId/coa-mappings",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, [
      "legalEntityId",
      "groupCoaId",
      "localCoaId",
    ]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    const groupCoaId = parsePositiveInt(req.body.groupCoaId);
    const localCoaId = parsePositiveInt(req.body.localCoaId);
    if (!legalEntityId || !groupCoaId || !localCoaId) {
      throw badRequest(
        "legalEntityId, groupCoaId and localCoaId must be positive integers",
      );
    }

    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId",
    );
    assertLegalEntityMatchesGroupCompany(
      legalEntity,
      group.group_company_id,
      "legalEntityId",
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const groupCoa = await assertCoaBelongsToTenant(
      tenantId,
      groupCoaId,
      "groupCoaId",
    );
    const localCoa = await assertCoaBelongsToTenant(
      tenantId,
      localCoaId,
      "localCoaId",
    );
    if (String(groupCoa.scope || "").toUpperCase() !== "GROUP") {
      throw badRequest(
        "groupCoaId must reference a GROUP scoped chart of accounts",
      );
    }
    if (parsePositiveInt(localCoa.legal_entity_id) !== legalEntityId) {
      throw badRequest("localCoaId must belong to legalEntityId");
    }

    const status = String(req.body.status || "ACTIVE").toUpperCase();

    const result = await query(
      `INSERT INTO group_coa_mappings (
          tenant_id, consolidation_group_id, legal_entity_id, group_coa_id, local_coa_id, status
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         updated_at = CURRENT_TIMESTAMP`,
      [tenantId, groupId, legalEntityId, groupCoaId, localCoaId, status],
    );

    return res.status(201).json({
      ok: true,
      id: result.rows.insertId || null,
    });
  }),
);

router.get(
  "/groups/:groupId/canonical-keys",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const rows = await listCanonicalKeys({
      tenantId,
      consolidationGroupId: groupId,
      status: req.query.status,
    });

    return res.json({
      tenantId,
      groupId,
      rows,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-keys",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, ["canonicalKey"]);
    const row = await upsertCanonicalKey({
      tenantId,
      consolidationGroupId: groupId,
      canonicalKey: req.body.canonicalKey,
      canonicalName: req.body.canonicalName,
      canonicalType: req.body.canonicalType,
      purposeCode: req.body.purposeCode,
      status: req.body.status,
    });

    return res.status(201).json({
      ok: true,
      row,
    });
  }),
);

router.get(
  "/groups/:groupId/canonical-mappings",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      const legalEntity = await assertLegalEntityBelongsToTenant(
        tenantId,
        legalEntityId,
        "legalEntityId",
      );
      assertLegalEntityMatchesGroupCompany(
        legalEntity,
        group.group_company_id,
        "legalEntityId",
      );
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const rows = await listCanonicalAccountMappings({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      status: req.query.status,
    });

    return res.json({
      tenantId,
      groupId,
      legalEntityId: legalEntityId || null,
      rows,
    });
  }),
);

router.get(
  "/groups/:groupId/canonical-readiness",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    let limit = undefined;
    if (req.query.limit !== undefined && req.query.limit !== "") {
      limit = parsePositiveInt(req.query.limit);
      if (!limit) {
        throw badRequest("limit must be a positive integer");
      }
    }

    const snapshot = await getCanonicalMappingReadiness({
      tenantId,
      consolidationGroupId: groupId,
      limit,
    });

    return res.json({
      tenantId,
      groupId,
      ...snapshot,
    });
  }),
);

router.get(
  "/groups/:groupId/canonical-governance-review",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    let limit = undefined;
    if (req.query.limit !== undefined && req.query.limit !== "") {
      limit = parsePositiveInt(req.query.limit);
      if (!limit) {
        throw badRequest("limit must be a positive integer");
      }
    }

    const snapshot = await getCanonicalMappingGovernanceReview({
      tenantId,
      consolidationGroupId: groupId,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      limit,
    });

    return res.json({
      tenantId,
      groupId,
      ...snapshot,
    });
  }),
);

router.get(
  "/groups/:groupId/canonical-mappings/candidates",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    let legalEntityId = null;
    if (
      req.query.legalEntityId !== undefined &&
      req.query.legalEntityId !== ""
    ) {
      legalEntityId = parsePositiveInt(req.query.legalEntityId);
      if (!legalEntityId) {
        throw badRequest("legalEntityId must be a positive integer");
      }
      const legalEntity = await assertLegalEntityBelongsToTenant(
        tenantId,
        legalEntityId,
        "legalEntityId",
      );
      assertLegalEntityMatchesGroupCompany(
        legalEntity,
        group.group_company_id,
        "legalEntityId",
      );
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    let limit = undefined;
    if (req.query.limit !== undefined && req.query.limit !== "") {
      limit = parsePositiveInt(req.query.limit);
      if (!limit) {
        throw badRequest("limit must be a positive integer");
      }
    }

    const result = await listCanonicalMappingCandidates({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      limit,
    });

    return res.json({
      tenantId,
      groupId,
      legalEntityId: legalEntityId || null,
      limit: result.limit,
      summary: result.summary,
      rows: result.rows,
    });
  }),
);

router.get(
  "/groups/:groupId/canonical-mappings/rules",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    let legalEntityId = null;
    if (
      req.query.legalEntityId !== undefined &&
      req.query.legalEntityId !== ""
    ) {
      legalEntityId = parsePositiveInt(req.query.legalEntityId);
      if (!legalEntityId) {
        throw badRequest("legalEntityId must be a positive integer");
      }
      const legalEntity = await assertLegalEntityBelongsToTenant(
        tenantId,
        legalEntityId,
        "legalEntityId",
      );
      assertLegalEntityMatchesGroupCompany(
        legalEntity,
        group.group_company_id,
        "legalEntityId",
      );
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const result = await listCanonicalMappingRules({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      status: req.query.status,
    });

    return res.json({
      tenantId,
      groupId,
      legalEntityId: legalEntityId || null,
      summary: result.summary,
      rows: result.rows,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/rules",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, [
      "legalEntityId",
      "ruleType",
      "canonicalKey",
    ]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId",
    );
    assertLegalEntityMatchesGroupCompany(
      legalEntity,
      group.group_company_id,
      "legalEntityId",
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const actedByUserId = parsePositiveInt(req.user?.userId) || null;
    const auditRequestMeta = buildAuditRequestMeta(req);
    const row = await createCanonicalMappingRule({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      ruleType: req.body.ruleType,
      parentLocalAccountId: req.body.parentLocalAccountId,
      codePrefix: req.body.codePrefix,
      canonicalKeyId: req.body.canonicalKeyId,
      canonicalKey: req.body.canonicalKey,
      canonicalName: req.body.canonicalName,
      groupAccountId: req.body.groupAccountId,
      status: req.body.status,
      effectiveFrom: req.body.effectiveFrom,
      effectiveTo: req.body.effectiveTo,
      reason: req.body.reason,
      actedByUserId,
      requestMeta: auditRequestMeta,
    });

    return res.status(201).json({
      ok: true,
      row,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/rules/preview",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, [
      "legalEntityId",
      "ruleType",
      "canonicalKey",
    ]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId",
    );
    assertLegalEntityMatchesGroupCompany(
      legalEntity,
      group.group_company_id,
      "legalEntityId",
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const preview = await previewCanonicalMappingRule({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      ruleType: req.body.ruleType,
      parentLocalAccountId: req.body.parentLocalAccountId,
      codePrefix: req.body.codePrefix,
      canonicalKey: req.body.canonicalKey,
      canonicalName: req.body.canonicalName,
      groupAccountId: req.body.groupAccountId,
      effectiveFrom: req.body.effectiveFrom,
      effectiveTo: req.body.effectiveTo,
    });

    return res.status(200).json({
      tenantId,
      groupId,
      legalEntityId,
      ...preview,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/rules/apply",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, [
      "legalEntityId",
      "ruleType",
      "canonicalKey",
    ]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId",
    );
    assertLegalEntityMatchesGroupCompany(
      legalEntity,
      group.group_company_id,
      "legalEntityId",
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const actedByUserId = parsePositiveInt(req.user?.userId) || null;
    const auditRequestMeta = buildAuditRequestMeta(req);
    const result = await applyCanonicalMappingRule({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      ruleType: req.body.ruleType,
      parentLocalAccountId: req.body.parentLocalAccountId,
      codePrefix: req.body.codePrefix,
      canonicalKey: req.body.canonicalKey,
      canonicalName: req.body.canonicalName,
      groupAccountId: req.body.groupAccountId,
      effectiveFrom: req.body.effectiveFrom,
      effectiveTo: req.body.effectiveTo,
      changeReason: req.body?.reason,
      changeSource: req.body?.source,
      actedByUserId,
      requestMeta: auditRequestMeta,
    });

    return res.status(200).json({
      ok: true,
      tenantId,
      groupId,
      legalEntityId,
      ...result,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/candidates/apply",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    let legalEntityId = null;
    if (
      req.body?.legalEntityId !== undefined &&
      req.body?.legalEntityId !== ""
    ) {
      legalEntityId = parsePositiveInt(req.body.legalEntityId);
      if (!legalEntityId) {
        throw badRequest("legalEntityId must be a positive integer");
      }
      const legalEntity = await assertLegalEntityBelongsToTenant(
        tenantId,
        legalEntityId,
        "legalEntityId",
      );
      assertLegalEntityMatchesGroupCompany(
        legalEntity,
        group.group_company_id,
        "legalEntityId",
      );
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    let limit = undefined;
    if (req.body?.limit !== undefined && req.body?.limit !== "") {
      limit = parsePositiveInt(req.body.limit);
      if (!limit) {
        throw badRequest("limit must be a positive integer");
      }
    }
    const actedByUserId = parsePositiveInt(req.user?.userId) || null;
    const auditRequestMeta = buildAuditRequestMeta(req);

    const result = await applyCanonicalMappingCandidates({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      limit,
      changeReason: req.body?.reason,
      changeSource: req.body?.source,
      actedByUserId,
      requestMeta: auditRequestMeta,
    });

    return res.status(200).json({
      ok: true,
      tenantId,
      groupId,
      legalEntityId: legalEntityId || null,
      ...result,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/rules/:ruleId/preview",
  requirePermission("consolidation.coa_mapping.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    const ruleId = parsePositiveInt(req.params.ruleId);
    if (!groupId || !ruleId) {
      throw badRequest("groupId and ruleId must be positive integers");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const savedRule = await getCanonicalMappingRuleById({
      tenantId,
      consolidationGroupId: groupId,
      ruleId,
    });
    if (!savedRule) {
      throw badRequest("ruleId not found in consolidation group");
    }
    assertScopeAccess(
      req,
      "legal_entity",
      savedRule.legalEntityId,
      "legalEntityId",
    );

    const result = await previewCanonicalMappingRuleById({
      tenantId,
      consolidationGroupId: groupId,
      ruleId,
    });

    return res.status(200).json({
      tenantId,
      groupId,
      ruleId,
      ...result,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/rules/:ruleId/apply",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    const ruleId = parsePositiveInt(req.params.ruleId);
    if (!groupId || !ruleId) {
      throw badRequest("groupId and ruleId must be positive integers");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const savedRule = await getCanonicalMappingRuleById({
      tenantId,
      consolidationGroupId: groupId,
      ruleId,
    });
    if (!savedRule) {
      throw badRequest("ruleId not found in consolidation group");
    }
    assertScopeAccess(
      req,
      "legal_entity",
      savedRule.legalEntityId,
      "legalEntityId",
    );

    const actedByUserId = parsePositiveInt(req.user?.userId) || null;
    const auditRequestMeta = buildAuditRequestMeta(req);
    const result = await applyCanonicalMappingRuleById({
      tenantId,
      consolidationGroupId: groupId,
      ruleId,
      changeReason: req.body?.reason,
      changeSource: req.body?.source,
      actedByUserId,
      requestMeta: auditRequestMeta,
    });

    return res.status(200).json({
      ok: true,
      tenantId,
      groupId,
      ruleId,
      ...result,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/rules/:ruleId/deactivate",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    const ruleId = parsePositiveInt(req.params.ruleId);
    if (!groupId || !ruleId) {
      throw badRequest("groupId and ruleId must be positive integers");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const savedRule = await getCanonicalMappingRuleById({
      tenantId,
      consolidationGroupId: groupId,
      ruleId,
    });
    if (!savedRule) {
      throw badRequest("ruleId not found in consolidation group");
    }
    assertScopeAccess(
      req,
      "legal_entity",
      savedRule.legalEntityId,
      "legalEntityId",
    );

    const actedByUserId = parsePositiveInt(req.user?.userId) || null;
    const auditRequestMeta = buildAuditRequestMeta(req);
    const row = await deactivateCanonicalMappingRule({
      tenantId,
      consolidationGroupId: groupId,
      ruleId,
      reason: req.body?.reason,
      actedByUserId,
      requestMeta: auditRequestMeta,
    });

    return res.status(200).json({
      ok: true,
      row,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/local",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, ["legalEntityId", "localAccountId"]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    const localAccountId = parsePositiveInt(req.body.localAccountId);
    if (!legalEntityId || !localAccountId) {
      throw badRequest(
        "legalEntityId and localAccountId must be positive integers",
      );
    }
    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId",
    );
    assertLegalEntityMatchesGroupCompany(
      legalEntity,
      group.group_company_id,
      "legalEntityId",
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    await assertAccountBelongsToTenant(
      tenantId,
      localAccountId,
      "localAccountId",
    );
    const actedByUserId = parsePositiveInt(req.user?.userId) || null;
    const auditRequestMeta = buildAuditRequestMeta(req);

    const row = await upsertLocalAccountCanonicalMapping({
      tenantId,
      consolidationGroupId: groupId,
      legalEntityId,
      localAccountId,
      canonicalKeyId: req.body.canonicalKeyId,
      canonicalKey: req.body.canonicalKey,
      canonicalName: req.body.canonicalName,
      canonicalType: req.body.canonicalType,
      purposeCode: req.body.purposeCode,
      status: req.body.status,
      effectiveFrom: req.body.effectiveFrom,
      effectiveTo: req.body.effectiveTo,
      changeReason: req.body?.reason,
      changeSource: req.body?.source,
      actedByUserId,
      requestMeta: auditRequestMeta,
    });

    return res.status(201).json({
      ok: true,
      row,
    });
  }),
);

router.post(
  "/groups/:groupId/canonical-mappings/group",
  requirePermission("consolidation.coa_mapping.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, ["groupAccountId"]);
    const groupAccountId = parsePositiveInt(req.body.groupAccountId);
    if (!groupAccountId) {
      throw badRequest("groupAccountId must be a positive integer");
    }
    await assertAccountBelongsToTenant(
      tenantId,
      groupAccountId,
      "groupAccountId",
    );
    const actedByUserId = parsePositiveInt(req.user?.userId) || null;
    const auditRequestMeta = buildAuditRequestMeta(req);

    const row = await upsertGroupAccountCanonicalMapping({
      tenantId,
      consolidationGroupId: groupId,
      groupAccountId,
      canonicalKeyId: req.body.canonicalKeyId,
      canonicalKey: req.body.canonicalKey,
      canonicalName: req.body.canonicalName,
      canonicalType: req.body.canonicalType,
      purposeCode: req.body.purposeCode,
      status: req.body.status,
      effectiveFrom: req.body.effectiveFrom,
      effectiveTo: req.body.effectiveTo,
      changeReason: req.body?.reason,
      changeSource: req.body?.source,
      actedByUserId,
      requestMeta: auditRequestMeta,
    });

    return res.status(201).json({
      ok: true,
      row,
    });
  }),
);

router.get(
  "/groups/:groupId/elimination-placeholders",
  requirePermission("consolidation.elimination_placeholder.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    const result = await query(
      `SELECT
         id,
         tenant_id,
         consolidation_group_id,
         placeholder_code,
         name,
         account_id,
         default_direction,
         description,
         is_active,
         created_at,
         updated_at
       FROM elimination_placeholders
       WHERE tenant_id = ?
         AND consolidation_group_id = ?
       ORDER BY placeholder_code`,
      [tenantId, groupId],
    );

    return res.json({
      tenantId,
      groupId,
      rows: result.rows,
    });
  }),
);

router.post(
  "/groups/:groupId/elimination-placeholders",
  requirePermission("consolidation.elimination_placeholder.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) {
      throw badRequest("groupId must be a positive integer");
    }
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      groupId,
      "groupId",
    );
    assertScopeAccess(req, "group", group.group_company_id, "groupCompanyId");

    assertRequiredFields(req.body, ["placeholderCode", "name"]);
    const accountId = req.body.accountId
      ? parsePositiveInt(req.body.accountId)
      : null;
    if (req.body.accountId && !accountId) {
      throw badRequest("accountId must be a positive integer");
    }
    if (accountId) {
      await assertAccountBelongsToTenant(tenantId, accountId, "accountId");
    }
    const placeholderCode = String(req.body.placeholderCode)
      .trim()
      .toUpperCase();
    const name = String(req.body.name).trim();
    const defaultDirection = String(
      req.body.defaultDirection || "AUTO",
    ).toUpperCase();
    const description = req.body.description
      ? String(req.body.description)
      : null;
    const isActive =
      req.body.isActive === undefined ? true : Boolean(req.body.isActive);

    const result = await query(
      `INSERT INTO elimination_placeholders (
          tenant_id,
          consolidation_group_id,
          placeholder_code,
          name,
          account_id,
          default_direction,
          description,
          is_active
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         account_id = VALUES(account_id),
         default_direction = VALUES(default_direction),
         description = VALUES(description),
         is_active = VALUES(is_active),
         updated_at = CURRENT_TIMESTAMP`,
      [
        tenantId,
        groupId,
        placeholderCode,
        name,
        accountId,
        defaultDirection,
        description,
        isActive,
      ],
    );

    return res.status(201).json({
      ok: true,
      id: result.rows.insertId || null,
    });
  }),
);

router.get(
  "/runs",
  requirePermission("consolidation.run.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const consolidationGroupId = parsePositiveInt(
      req.query.consolidationGroupId,
    );
    const fiscalPeriodId = parsePositiveInt(req.query.fiscalPeriodId);
    const status = req.query.status
      ? String(req.query.status).toUpperCase()
      : null;

    const params = [tenantId];
    const conditions = ["cg.tenant_id = ?"];
    conditions.push(
      buildScopeFilter(req, "group", "cg.group_company_id", params),
    );

    if (consolidationGroupId) {
      conditions.push("cr.consolidation_group_id = ?");
      params.push(consolidationGroupId);
    }
    if (fiscalPeriodId) {
      conditions.push("cr.fiscal_period_id = ?");
      params.push(fiscalPeriodId);
    }
    if (status) {
      conditions.push("cr.status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         cr.id,
         cr.consolidation_group_id,
         cr.fiscal_period_id,
         cr.run_name,
         cr.status,
         cr.presentation_currency_code,
         cr.started_by_user_id,
         cr.started_at,
         cr.finished_at,
         cr.notes,
         cg.group_company_id,
         cg.code AS consolidation_group_code,
         cg.name AS consolidation_group_name,
         fp.fiscal_year,
         fp.period_no,
         fp.period_name
       FROM consolidation_runs cr
       JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
       JOIN fiscal_periods fp ON fp.id = cr.fiscal_period_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY cr.started_at DESC, cr.id DESC`,
      params,
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  }),
);

router.post(
  "/runs",
  requirePermission("consolidation.run.create"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, [
      "consolidationGroupId",
      "fiscalPeriodId",
      "runName",
      "presentationCurrencyCode",
    ]);

    const consolidationGroupId = parsePositiveInt(
      req.body.consolidationGroupId,
    );
    const fiscalPeriodId = parsePositiveInt(req.body.fiscalPeriodId);
    const startedByUserId = parsePositiveInt(req.user?.userId);
    const presentationCurrencyCode = String(
      req.body.presentationCurrencyCode || "",
    ).toUpperCase();

    if (!consolidationGroupId || !fiscalPeriodId || !startedByUserId) {
      throw badRequest(
        "consolidationGroupId, fiscalPeriodId and authenticated user are required",
      );
    }

    await assertUserBelongsToTenant(
      tenantId,
      startedByUserId,
      "startedByUserId",
    );
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      consolidationGroupId,
      "consolidationGroupId",
    );

    const groupCompanyId = parsePositiveInt(group.group_company_id);
    if (groupCompanyId) {
      assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
    }

    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(group.calendar_id),
      fiscalPeriodId,
      "fiscalPeriodId",
    );

    const result = await query(
      `INSERT INTO consolidation_runs (
          consolidation_group_id, fiscal_period_id, run_name, status, presentation_currency_code, started_by_user_id
       )
       VALUES (?, ?, ?, 'DRAFT', ?, ?)`,
      [
        consolidationGroupId,
        fiscalPeriodId,
        String(req.body.runName),
        presentationCurrencyCode,
        startedByUserId,
      ],
    );

    return res.status(201).json({
      ok: true,
      tenantId,
      runId: result.rows.insertId || null,
    });
  }),
);

router.get(
  "/runs/:runId",
  requirePermission("consolidation.run.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    const run = await getRunWithContext(tenantId, runId);
    if (!run) {
      throw badRequest("Consolidation run not found");
    }

    const entryCountResult = await query(
      `SELECT COUNT(*) AS entry_count
       FROM consolidation_run_entries
       WHERE consolidation_run_id = ?`,
      [runId],
    );
    const totalsResult = await query(
      `SELECT
         SUM(translated_debit) AS translated_debit_total,
         SUM(translated_credit) AS translated_credit_total,
         SUM(translated_balance) AS translated_balance_total
       FROM consolidation_run_entries
       WHERE consolidation_run_id = ?`,
      [runId],
    );
    const compatibility = await buildCrossTrackCompatibilitySnapshot({
      tenantId,
      runId,
      run,
    });

    return res.json({
      tenantId,
      run: {
        ...run,
        entryCount: Number(entryCountResult.rows[0]?.entry_count || 0),
        totals: {
          translatedDebitTotal: Number(
            totalsResult.rows[0]?.translated_debit_total || 0,
          ),
          translatedCreditTotal: Number(
            totalsResult.rows[0]?.translated_credit_total || 0,
          ),
          translatedBalanceTotal: Number(
            totalsResult.rows[0]?.translated_balance_total || 0,
          ),
        },
      },
      compatibility,
    });
  }),
);

router.post(
  "/runs/:runId/execute",
  requirePermission("consolidation.run.execute", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    const executedByUserId = parsePositiveInt(req.user?.userId);
    if (!executedByUserId) {
      throw badRequest("Authenticated user is required");
    }

    const preferredRateType = normalizeRateType(req.body?.rateType);

    try {
      const execution = await executeConsolidationRun({
        tenantId,
        runId,
        preferredRateType,
        executedByUserId,
      });

      return res.json({
        ok: true,
        runId,
        status: "COMPLETED",
        preferredRateType,
        insertedRowCount: execution.insertedRowCount,
        totals: execution.totals,
      });
    } catch (err) {
      await query(
        `UPDATE consolidation_runs
         SET status = 'FAILED',
             finished_at = CURRENT_TIMESTAMP,
             notes = ?
         WHERE id = ?`,
        [String(err.message || "Execution failed").slice(0, 500), runId],
      );
      if (isCanonicalCoverageFailure(err)) {
        try {
          await recordCanonicalExecuteFailureEvent({
            req,
            tenantId,
            runId,
            executedByUserId,
            err,
          });
        } catch (monitorErr) {
          logWarn(
            "Failed to record consolidation canonical execute failure event",
            {
              eventCode:
                "CONSOLIDATION_CANONICAL_EXECUTE_FAILURE_MONITORING_ERROR",
              tenantId,
              runId,
              requestId: req.requestId || null,
            },
            monitorErr,
          );
        }
      }
      throw err;
    }
  }),
);

router.get(
  "/runs/:runId/eliminations",
  requirePermission("consolidation.run.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }
    await requireRun(tenantId, runId);

    const status = normalizeDraftPostingStatus(req.query.status);
    const includeLines = parseBooleanLike(
      req.query.includeLines,
      false,
      "includeLines",
    );

    const params = [runId];
    const conditions = ["ee.consolidation_run_id = ?"];
    if (status !== "ALL") {
      conditions.push("ee.status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         ee.id,
         ee.status,
         ee.description,
         ee.reference_no,
         ee.created_by_user_id,
         creator.name AS created_by_user_name,
         ee.posted_by_user_id,
         poster.name AS posted_by_user_name,
         ee.created_at,
         ee.posted_at,
         COALESCE(SUM(el.debit_amount), 0) AS debit_total,
         COALESCE(SUM(el.credit_amount), 0) AS credit_total,
         COUNT(el.id) AS line_count
       FROM elimination_entries ee
       LEFT JOIN elimination_lines el ON el.elimination_entry_id = ee.id
       LEFT JOIN users creator ON creator.id = ee.created_by_user_id
       LEFT JOIN users poster ON poster.id = ee.posted_by_user_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY
         ee.id,
         ee.status,
         ee.description,
         ee.reference_no,
         ee.created_by_user_id,
         creator.name,
         ee.posted_by_user_id,
         poster.name,
         ee.created_at,
         ee.posted_at
       ORDER BY ee.id DESC`,
      params,
    );

    const rows = (result.rows || []).map((row) => ({
      id: parsePositiveInt(row.id),
      status: String(row.status || "").toUpperCase(),
      description: row.description || null,
      referenceNo: row.reference_no || null,
      createdByUserId: parsePositiveInt(row.created_by_user_id),
      createdByUserName: row.created_by_user_name || null,
      postedByUserId: parsePositiveInt(row.posted_by_user_id),
      postedByUserName: row.posted_by_user_name || null,
      createdAt: row.created_at || null,
      postedAt: row.posted_at || null,
      debitTotal: Number(row.debit_total || 0),
      creditTotal: Number(row.credit_total || 0),
      lineCount: Number(row.line_count || 0),
    }));

    if (includeLines && rows.length > 0) {
      const entryIds = rows.map((row) => row.id).filter(Boolean);
      if (entryIds.length > 0) {
        const placeholders = entryIds.map(() => "?").join(", ");
        const lineResult = await query(
          `SELECT
             el.elimination_entry_id,
             el.line_no,
             el.account_id,
             a.code AS account_code,
             a.name AS account_name,
             el.legal_entity_id,
             le.code AS legal_entity_code,
             le.name AS legal_entity_name,
             el.counterparty_legal_entity_id,
             cle.code AS counterparty_legal_entity_code,
             cle.name AS counterparty_legal_entity_name,
             el.debit_amount,
             el.credit_amount,
             el.currency_code,
             el.description
           FROM elimination_lines el
           JOIN accounts a ON a.id = el.account_id
           LEFT JOIN legal_entities le ON le.id = el.legal_entity_id
           LEFT JOIN legal_entities cle ON cle.id = el.counterparty_legal_entity_id
           WHERE el.elimination_entry_id IN (${placeholders})
           ORDER BY el.elimination_entry_id, el.line_no`,
          entryIds,
        );

        const linesByEntryId = new Map();
        for (const line of lineResult.rows || []) {
          const entryId = parsePositiveInt(line.elimination_entry_id);
          if (!entryId) {
            continue;
          }
          if (!linesByEntryId.has(entryId)) {
            linesByEntryId.set(entryId, []);
          }
          linesByEntryId.get(entryId).push({
            lineNo: Number(line.line_no || 0),
            accountId: parsePositiveInt(line.account_id),
            accountCode: line.account_code || null,
            accountName: line.account_name || null,
            legalEntityId: parsePositiveInt(line.legal_entity_id),
            legalEntityCode: line.legal_entity_code || null,
            legalEntityName: line.legal_entity_name || null,
            counterpartyLegalEntityId: parsePositiveInt(
              line.counterparty_legal_entity_id,
            ),
            counterpartyLegalEntityCode:
              line.counterparty_legal_entity_code || null,
            counterpartyLegalEntityName:
              line.counterparty_legal_entity_name || null,
            debitAmount: Number(line.debit_amount || 0),
            creditAmount: Number(line.credit_amount || 0),
            currencyCode: String(line.currency_code || "").toUpperCase(),
            description: line.description || null,
          });
        }

        for (const row of rows) {
          row.lines = linesByEntryId.get(row.id) || [];
        }
      }
    }

    return res.json({
      runId,
      status,
      rows,
    });
  }),
);

router.post(
  "/runs/:runId/eliminations",
  requirePermission("consolidation.elimination.create", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    const userId = parsePositiveInt(req.user?.userId);
    if (!runId || !userId) {
      throw badRequest("runId and authenticated user are required");
    }
    await assertUserBelongsToTenant(tenantId, userId, "userId");
    const run = await requireRun(tenantId, runId);

    assertRequiredFields(req.body, ["description", "lines"]);
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (lines.length === 0) {
      throw badRequest("lines must be a non-empty array");
    }

    const normalizedLines = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const accountId = parsePositiveInt(line.accountId);
      if (!accountId) {
        throw badRequest(`Invalid accountId on elimination line ${i + 1}`);
      }
      await assertAccountBelongsToTenant(
        tenantId,
        accountId,
        `lines[${i}].accountId`,
      );

      const legalEntityId = parsePositiveInt(line.legalEntityId);
      const counterpartyLegalEntityId = parsePositiveInt(
        line.counterpartyLegalEntityId,
      );
      if (legalEntityId) {
        const legalEntity = await assertLegalEntityBelongsToTenant(
          tenantId,
          legalEntityId,
          `lines[${i}].legalEntityId`,
        );
        assertLegalEntityMatchesGroupCompany(
          legalEntity,
          run.group_company_id,
          `lines[${i}].legalEntityId`,
        );
        assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
      }
      if (counterpartyLegalEntityId) {
        const counterpartyLegalEntity = await assertLegalEntityBelongsToTenant(
          tenantId,
          counterpartyLegalEntityId,
          `lines[${i}].counterpartyLegalEntityId`,
        );
        assertLegalEntityMatchesGroupCompany(
          counterpartyLegalEntity,
          run.group_company_id,
          `lines[${i}].counterpartyLegalEntityId`,
        );
        assertScopeAccess(
          req,
          "legal_entity",
          counterpartyLegalEntityId,
          "counterpartyLegalEntityId",
        );
      }

      normalizedLines.push({
        accountId,
        legalEntityId,
        counterpartyLegalEntityId,
        debitAmount: Number(line.debitAmount || 0),
        creditAmount: Number(line.creditAmount || 0),
        currencyCode: String(line.currencyCode || "USD").toUpperCase(),
        description: line.description ? String(line.description) : null,
      });
    }

    const eliminationEntryId = await withTransaction(async (tx) => {
      const entryResult = await tx.query(
        `INSERT INTO elimination_entries (
            consolidation_run_id, status, description, reference_no, created_by_user_id
         )
         VALUES (?, 'DRAFT', ?, ?, ?)`,
        [
          runId,
          String(req.body.description),
          req.body.referenceNo || null,
          userId,
        ],
      );
      const createdEntryId = parsePositiveInt(entryResult.rows.insertId);
      if (!createdEntryId) {
        throw badRequest("Failed to create elimination entry");
      }

      for (let i = 0; i < normalizedLines.length; i += 1) {
        const line = normalizedLines[i];
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO elimination_lines (
              elimination_entry_id, line_no, account_id, legal_entity_id,
              counterparty_legal_entity_id, debit_amount, credit_amount, currency_code, description
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            createdEntryId,
            i + 1,
            line.accountId,
            line.legalEntityId,
            line.counterpartyLegalEntityId,
            line.debitAmount,
            line.creditAmount,
            line.currencyCode,
            line.description,
          ],
        );
      }

      return createdEntryId;
    });

    return res.status(201).json({
      ok: true,
      eliminationEntryId,
      lineCount: lines.length,
    });
  }),
);

router.post(
  "/runs/:runId/eliminations/:eliminationEntryId/post",
  requirePermission("consolidation.elimination.post", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    const eliminationEntryId = parsePositiveInt(req.params.eliminationEntryId);
    const userId = parsePositiveInt(req.user?.userId);
    if (!runId || !eliminationEntryId || !userId) {
      throw badRequest(
        "runId, eliminationEntryId and authenticated user are required",
      );
    }
    await assertUserBelongsToTenant(tenantId, userId, "userId");
    await requireRun(tenantId, runId);

    const postResult = await withTransaction(async (tx) => {
      const entryResult = await tx.query(
        `SELECT
           ee.id,
           ee.status,
           ee.consolidation_run_id,
           cr.status AS run_status,
           ee.posted_by_user_id,
           ee.posted_at
         FROM elimination_entries ee
         JOIN consolidation_runs cr ON cr.id = ee.consolidation_run_id
         JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
         WHERE ee.id = ?
           AND ee.consolidation_run_id = ?
           AND cg.tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [eliminationEntryId, runId, tenantId],
      );
      const entry = entryResult.rows[0];
      if (!entry) {
        throw badRequest("eliminationEntryId not found for runId and tenant");
      }

      assertRunNotLocked({ status: entry.run_status });

      if (String(entry.status || "").toUpperCase() === "POSTED") {
        return {
          idempotent: true,
          eliminationEntryId,
          status: "POSTED",
          postedByUserId: parsePositiveInt(entry.posted_by_user_id),
          postedAt: entry.posted_at || null,
        };
      }

      const lineResult = await tx.query(
        `SELECT id, debit_amount, credit_amount
         FROM elimination_lines
         WHERE elimination_entry_id = ?
         FOR UPDATE`,
        [eliminationEntryId],
      );
      const lines = lineResult.rows || [];
      if (lines.length === 0) {
        throw badRequest("Cannot post elimination entry with no lines");
      }

      let debitTotal = 0;
      let creditTotal = 0;
      for (const line of lines) {
        debitTotal += Number(line.debit_amount || 0);
        creditTotal += Number(line.credit_amount || 0);
      }
      if (Math.abs(debitTotal - creditTotal) > BALANCE_EPSILON) {
        throw badRequest(
          "Elimination entry is not balanced and cannot be posted",
        );
      }

      await tx.query(
        `UPDATE elimination_entries
         SET status = 'POSTED',
             posted_by_user_id = ?,
             posted_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userId, eliminationEntryId],
      );

      const postedResult = await tx.query(
        `SELECT posted_by_user_id, posted_at
         FROM elimination_entries
         WHERE id = ?
         LIMIT 1`,
        [eliminationEntryId],
      );
      const postedRow = postedResult.rows[0] || {};

      return {
        idempotent: false,
        eliminationEntryId,
        status: "POSTED",
        postedByUserId: parsePositiveInt(postedRow.posted_by_user_id),
        postedAt: postedRow.posted_at || null,
      };
    });

    return res.json({
      ok: true,
      ...postResult,
    });
  }),
);

router.get(
  "/runs/:runId/adjustments",
  requirePermission("consolidation.run.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }
    await requireRun(tenantId, runId);

    const status = normalizeDraftPostingStatus(req.query.status);
    const params = [runId];
    const conditions = ["ca.consolidation_run_id = ?"];
    if (status !== "ALL") {
      conditions.push("ca.status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         ca.id,
         ca.adjustment_type,
         ca.status,
         ca.legal_entity_id,
         le.code AS legal_entity_code,
         le.name AS legal_entity_name,
         ca.account_id,
         a.code AS account_code,
         a.name AS account_name,
         a.account_type,
         ca.debit_amount,
         ca.credit_amount,
         ca.currency_code,
         ca.description,
         ca.created_by_user_id,
         creator.name AS created_by_user_name,
         ca.posted_by_user_id,
         poster.name AS posted_by_user_name,
         ca.created_at,
         ca.posted_at
       FROM consolidation_adjustments ca
       JOIN accounts a ON a.id = ca.account_id
       LEFT JOIN legal_entities le ON le.id = ca.legal_entity_id
       LEFT JOIN users creator ON creator.id = ca.created_by_user_id
       LEFT JOIN users poster ON poster.id = ca.posted_by_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ca.id DESC`,
      params,
    );

    return res.json({
      runId,
      status,
      rows: (result.rows || []).map((row) => ({
        id: parsePositiveInt(row.id),
        adjustmentType: String(row.adjustment_type || "").toUpperCase(),
        status: String(row.status || "").toUpperCase(),
        legalEntityId: parsePositiveInt(row.legal_entity_id),
        legalEntityCode: row.legal_entity_code || null,
        legalEntityName: row.legal_entity_name || null,
        accountId: parsePositiveInt(row.account_id),
        accountCode: row.account_code || null,
        accountName: row.account_name || null,
        accountType: String(row.account_type || "").toUpperCase(),
        debitAmount: Number(row.debit_amount || 0),
        creditAmount: Number(row.credit_amount || 0),
        currencyCode: String(row.currency_code || "").toUpperCase(),
        description: row.description || null,
        createdByUserId: parsePositiveInt(row.created_by_user_id),
        createdByUserName: row.created_by_user_name || null,
        postedByUserId: parsePositiveInt(row.posted_by_user_id),
        postedByUserName: row.posted_by_user_name || null,
        createdAt: row.created_at || null,
        postedAt: row.posted_at || null,
      })),
    });
  }),
);

router.post(
  "/runs/:runId/adjustments",
  requirePermission("consolidation.adjustment.create", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    const userId = parsePositiveInt(req.user?.userId);
    if (!runId || !userId) {
      throw badRequest("runId and authenticated user are required");
    }
    await assertUserBelongsToTenant(tenantId, userId, "userId");
    const run = await requireRun(tenantId, runId);

    assertRequiredFields(req.body, [
      "accountId",
      "currencyCode",
      "description",
      "debitAmount",
      "creditAmount",
    ]);

    const accountId = parsePositiveInt(req.body.accountId);
    if (!accountId) {
      throw badRequest("accountId must be a positive integer");
    }
    await assertAccountBelongsToTenant(tenantId, accountId, "accountId");
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (legalEntityId) {
      const legalEntity = await assertLegalEntityBelongsToTenant(
        tenantId,
        legalEntityId,
        "legalEntityId",
      );
      assertLegalEntityMatchesGroupCompany(
        legalEntity,
        run.group_company_id,
        "legalEntityId",
      );
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const result = await query(
      `INSERT INTO consolidation_adjustments (
          consolidation_run_id, adjustment_type, status, legal_entity_id, account_id,
          debit_amount, credit_amount, currency_code, description, created_by_user_id
       )
       VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        String(req.body.adjustmentType || "TOPSIDE").toUpperCase(),
        legalEntityId,
        accountId,
        Number(req.body.debitAmount || 0),
        Number(req.body.creditAmount || 0),
        String(req.body.currencyCode).toUpperCase(),
        String(req.body.description),
        userId,
      ],
    );

    return res.status(201).json({
      ok: true,
      adjustmentId: result.rows.insertId || null,
    });
  }),
);

router.post(
  "/runs/:runId/adjustments/:adjustmentId/post",
  requirePermission("consolidation.adjustment.post", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    const adjustmentId = parsePositiveInt(req.params.adjustmentId);
    const userId = parsePositiveInt(req.user?.userId);
    if (!runId || !adjustmentId || !userId) {
      throw badRequest(
        "runId, adjustmentId and authenticated user are required",
      );
    }
    await assertUserBelongsToTenant(tenantId, userId, "userId");
    await requireRun(tenantId, runId);

    const postResult = await withTransaction(async (tx) => {
      const adjustmentResult = await tx.query(
        `SELECT
           ca.id,
           ca.status,
           ca.debit_amount,
           ca.credit_amount,
           ca.posted_by_user_id,
           ca.posted_at,
           cr.status AS run_status
         FROM consolidation_adjustments ca
         JOIN consolidation_runs cr ON cr.id = ca.consolidation_run_id
         JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
         WHERE ca.id = ?
           AND ca.consolidation_run_id = ?
           AND cg.tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [adjustmentId, runId, tenantId],
      );
      const adjustment = adjustmentResult.rows[0];
      if (!adjustment) {
        throw badRequest("adjustmentId not found for runId and tenant");
      }

      assertRunNotLocked({ status: adjustment.run_status });

      if (String(adjustment.status || "").toUpperCase() === "POSTED") {
        return {
          idempotent: true,
          adjustmentId,
          status: "POSTED",
          postedByUserId: parsePositiveInt(adjustment.posted_by_user_id),
          postedAt: adjustment.posted_at || null,
        };
      }

      const debitAmount = Number(adjustment.debit_amount || 0);
      const creditAmount = Number(adjustment.credit_amount || 0);
      const validOneSided =
        (debitAmount > 0 && Math.abs(creditAmount) < BALANCE_EPSILON) ||
        (creditAmount > 0 && Math.abs(debitAmount) < BALANCE_EPSILON);
      if (!validOneSided) {
        throw badRequest("Adjustment must be one-sided and cannot be posted");
      }

      await tx.query(
        `UPDATE consolidation_adjustments
         SET status = 'POSTED',
             posted_by_user_id = ?,
             posted_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userId, adjustmentId],
      );

      const postedResult = await tx.query(
        `SELECT posted_by_user_id, posted_at
         FROM consolidation_adjustments
         WHERE id = ?
         LIMIT 1`,
        [adjustmentId],
      );
      const postedRow = postedResult.rows[0] || {};

      return {
        idempotent: false,
        adjustmentId,
        status: "POSTED",
        postedByUserId: parsePositiveInt(postedRow.posted_by_user_id),
        postedAt: postedRow.posted_at || null,
      };
    });

    return res.json({
      ok: true,
      ...postResult,
    });
  }),
);

router.post(
  "/runs/:runId/finalize",
  requirePermission("consolidation.run.finalize", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    const userId = parsePositiveInt(req.user?.userId);
    if (!runId || !userId) {
      throw badRequest("runId and authenticated user are required");
    }
    const run = await requireRun(tenantId, runId);
    if (String(run?.status || "").toUpperCase() === "LOCKED") {
      return res.json({ ok: true, runId, status: "LOCKED", idempotent: true });
    }

    const reviewGate = await getConsolidationRunReviewGate({
      tenantId,
      runId,
      requestedByUserId: userId,
    });
    if (!reviewGate.canFinalize) {
      const firstBlocker = reviewGate.blockers?.[0] || null;
      return res.status(409).json(
        {
          message:
            firstBlocker?.message ||
            "Consolidation finalize is blocked by review gate checks",
          code: firstBlocker?.code || "CONSOLIDATION_REVIEW_BLOCKED",
          details: {
            reviewGate,
          },
          requestId: req.requestId || null,
        }
      );
    }

    await query(
      `UPDATE consolidation_runs
       SET status = 'LOCKED', finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [runId],
    );

    return res.json({ ok: true, runId, status: "LOCKED" });
  }),
);

router.get(
  "/runs/:runId/review-gate",
  requirePermission("consolidation.run.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    const userId = parsePositiveInt(req.user?.userId);
    if (!runId || !userId) {
      throw badRequest("runId and authenticated user are required");
    }

    const reviewGate = await getConsolidationRunReviewGate({
      tenantId,
      runId,
      requestedByUserId: userId,
    });
    return res.json({
      ok: true,
      runId,
      ...reviewGate,
    });
  }),
);

router.post(
  "/runs/:runId/report-snapshots/member-support",
  requirePermission("ops.export_snapshot.create", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const runId = parsePositiveInt(req.params.runId);
    const userId = parsePositiveInt(req.user?.userId);

    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!runId || !userId) {
      throw badRequest("runId and authenticated user are required");
    }

    const run = await requireRun(tenantId, runId);
    const result = await createConsolidatedMemberSupportSnapshot({
      tenantId,
      userId,
      run,
      input: req.body || {},
      requestMeta: buildAuditRequestMeta(req),
    });

    return res.status(201).json({
      ok: true,
      runId,
      ...result,
    });
  }),
);

router.get(
  "/runs/:runId/reports/trial-balance",
  requirePermission("consolidation.report.trial_balance.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }
    const run = await requireRun(tenantId, runId);

    const result = await query(
      `SELECT
         cre.group_account_id AS account_id,
         a.code AS account_code,
         a.name AS account_name,
         SUM(cre.translated_debit) AS debit_total,
         SUM(cre.translated_credit) AS credit_total,
         SUM(cre.translated_balance) AS balance
       FROM consolidation_run_entries cre
       JOIN accounts a ON a.id = cre.group_account_id
       WHERE cre.consolidation_run_id = ?
       GROUP BY cre.group_account_id, a.code, a.name
       ORDER BY a.code`,
      [runId],
    );
    const compatibility = await buildCrossTrackCompatibilitySnapshot({
      tenantId,
      runId,
      run,
    });

    return res.json({
      runId,
      compatibility,
      rows: result.rows,
    });
  }),
);

router.get(
  "/runs/:runId/reports/summary",
  requirePermission("consolidation.report.summary.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    const run = await getRunWithContext(tenantId, runId);
    if (!run) {
      throw badRequest("Consolidation run not found");
    }

    const groupBy = String(req.query.groupBy || "account_entity").toLowerCase();
    if (!["account", "entity", "account_entity"].includes(groupBy)) {
      throw badRequest(
        "groupBy must be one of account, entity, account_entity",
      );
    }

    let selectClause = "";
    let groupClause = "";
    let orderClause = "";

    if (groupBy === "account") {
      selectClause = `
        cre.group_account_id AS account_id,
        a.code AS account_code,
        a.name AS account_name,
        NULL AS legal_entity_id,
        NULL AS legal_entity_code,
        NULL AS legal_entity_name
      `;
      groupClause = "cre.group_account_id, a.code, a.name";
      orderClause = "a.code";
    } else if (groupBy === "entity") {
      selectClause = `
        NULL AS account_id,
        NULL AS account_code,
        NULL AS account_name,
        cre.legal_entity_id AS legal_entity_id,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name
      `;
      groupClause = "cre.legal_entity_id, le.code, le.name";
      orderClause = "le.code";
    } else {
      selectClause = `
        cre.group_account_id AS account_id,
        a.code AS account_code,
        a.name AS account_name,
        cre.legal_entity_id AS legal_entity_id,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name
      `;
      groupClause =
        "cre.group_account_id, a.code, a.name, cre.legal_entity_id, le.code, le.name";
      orderClause = "a.code, le.code";
    }

    const rowsResult = await query(
      `SELECT
         ${selectClause},
         COUNT(DISTINCT cre.source_currency_code) AS source_currency_count,
         GROUP_CONCAT(
           DISTINCT cre.source_currency_code
           ORDER BY cre.source_currency_code
           SEPARATOR ','
         ) AS source_currency_codes_csv,
         SUM(cre.local_debit_base) AS local_debit_total,
         SUM(cre.local_credit_base) AS local_credit_total,
         SUM(cre.local_balance_base) AS local_balance_total,
         SUM(cre.translated_debit) AS translated_debit_total,
         SUM(cre.translated_credit) AS translated_credit_total,
         SUM(cre.translated_balance) AS translated_balance_total
       FROM consolidation_run_entries cre
       JOIN accounts a ON a.id = cre.group_account_id
       JOIN legal_entities le ON le.id = cre.legal_entity_id
       WHERE cre.consolidation_run_id = ?
       GROUP BY ${groupClause}
       ORDER BY ${orderClause}`,
      [runId],
    );

    const totalsResult = await query(
      `SELECT
         COUNT(DISTINCT source_currency_code) AS source_currency_count,
         GROUP_CONCAT(
           DISTINCT source_currency_code
           ORDER BY source_currency_code
           SEPARATOR ','
         ) AS source_currency_codes_csv,
         SUM(local_debit_base) AS local_debit_total,
         SUM(local_credit_base) AS local_credit_total,
         SUM(local_balance_base) AS local_balance_total,
         SUM(translated_debit) AS translated_debit_total,
         SUM(translated_credit) AS translated_credit_total,
         SUM(translated_balance) AS translated_balance_total
       FROM consolidation_run_entries
       WHERE consolidation_run_id = ?`,
      [runId],
    );
    const compatibility = await buildCrossTrackCompatibilitySnapshot({
      tenantId,
      runId,
      run,
    });
    const totalsRow = totalsResult.rows[0] || {};
    const rows = (rowsResult.rows || []).map((row) => ({
      ...row,
      ...buildConsolidatedSupportCurrencyContext(row),
    }));

    return res.json({
      runId,
      groupBy,
      run: {
        id: run.id,
        consolidationGroupId: run.consolidation_group_id,
        consolidationGroupCode: run.consolidation_group_code,
        consolidationGroupName: run.consolidation_group_name,
        fiscalPeriodId: run.fiscal_period_id,
        periodStartDate: run.period_start_date,
        periodEndDate: run.period_end_date,
        presentationCurrencyCode: run.presentation_currency_code,
        status: run.status,
      },
      totals: {
        localDebitTotal: Number(totalsRow.local_debit_total || 0),
        localCreditTotal: Number(totalsRow.local_credit_total || 0),
        localBalanceTotal: Number(totalsRow.local_balance_total || 0),
        translatedDebitTotal: Number(totalsRow.translated_debit_total || 0),
        translatedCreditTotal: Number(totalsRow.translated_credit_total || 0),
        translatedBalanceTotal: Number(totalsRow.translated_balance_total || 0),
        ...buildConsolidatedSupportCurrencyContext(totalsRow),
      },
      compatibility,
      rows,
    });
  }),
);

router.get(
  "/runs/:runId/reports/balance-sheet",
  requirePermission("consolidation.report.balance_sheet.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    const run = await requireRun(tenantId, runId);
    const includeDraft = parseBooleanLike(
      req.query.includeDraft,
      false,
      "includeDraft",
    );
    const includeZero = parseBooleanLike(
      req.query.includeZero,
      false,
      "includeZero",
    );
    const preferredRateType = normalizeRateType(req.query.rateType);

    const reportData = await loadConsolidationRunReportAccountBalances({
      tenantId,
      run,
      includeDraft,
      preferredRateType,
    });
    const reportMath = summarizeConsolidationRunReportMath({
      rows: reportData.rows,
      balanceEpsilon: BALANCE_EPSILON,
    });

    const mappedRows = reportData.rows
      .filter((row) =>
        ["ASSET", "LIABILITY", "EQUITY"].includes(row.accountType),
      )
      .map((row) => {
        const normalizedBaseBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.baseBalance,
        );
        const normalizedAdjustmentBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.adjustmentBalance,
        );
        const normalizedEliminationBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.eliminationBalance,
        );
        const normalizedFinalBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.finalBalance,
        );

        return {
          accountId: row.accountId,
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          baseBalance: row.baseBalance,
          adjustmentBalance: row.adjustmentBalance,
          eliminationBalance: row.eliminationBalance,
          finalBalance: row.finalBalance,
          normalizedBaseBalance,
          normalizedAdjustmentBalance,
          normalizedEliminationBalance,
          normalizedFinalBalance,
        };
      })
      .filter(
        (row) =>
          includeZero ||
          Math.abs(Number(row.normalizedFinalBalance || 0)) >= BALANCE_EPSILON,
      )
      .sort((a, b) =>
        String(a.accountCode).localeCompare(String(b.accountCode)),
      );

    const compatibility = await buildCrossTrackCompatibilitySnapshot({
      tenantId,
      runId,
      run,
    });

    return res.json({
      runId,
      run: {
        id: parsePositiveInt(run.id),
        consolidationGroupId: parsePositiveInt(run.consolidation_group_id),
        consolidationGroupCode: run.consolidation_group_code || null,
        consolidationGroupName: run.consolidation_group_name || null,
        fiscalPeriodId: parsePositiveInt(run.fiscal_period_id),
        periodStartDate: run.period_start_date || null,
        periodEndDate: run.period_end_date || null,
        status: String(run.status || "").toUpperCase(),
        presentationCurrencyCode: String(
          run.presentation_currency_code || "",
        ).toUpperCase(),
      },
      options: {
        includeDraft,
        includeZero,
        rateType: preferredRateType,
        includedStatuses: reportData.statusFilter,
      },
      totals: {
        assetsTotal: reportMath.assetsTotal,
        liabilitiesTotal: reportMath.liabilitiesTotal,
        equityTotal: reportMath.equityTotal,
        currentPeriodEarnings: reportMath.currentPeriodEarnings,
        equationDelta: reportMath.equationDelta,
      },
      compatibility,
      rows: mappedRows,
    });
  }),
);

router.get(
  "/runs/:runId/reports/income-statement",
  requirePermission("consolidation.report.income_statement.read", {
    resolveScope: async (req, tenantId) => {
      return resolveRunScope(req.params?.runId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const runId = parsePositiveInt(req.params.runId);
    if (!runId) {
      throw badRequest("runId must be a positive integer");
    }

    const run = await requireRun(tenantId, runId);
    const includeDraft = parseBooleanLike(
      req.query.includeDraft,
      false,
      "includeDraft",
    );
    const includeZero = parseBooleanLike(
      req.query.includeZero,
      false,
      "includeZero",
    );
    const preferredRateType = normalizeRateType(req.query.rateType);

    const reportData = await loadConsolidationRunReportAccountBalances({
      tenantId,
      run,
      includeDraft,
      preferredRateType,
    });
    const reportMath = summarizeConsolidationRunReportMath({
      rows: reportData.rows,
      balanceEpsilon: BALANCE_EPSILON,
    });

    const mappedRows = reportData.rows
      .filter((row) => ["REVENUE", "EXPENSE"].includes(row.accountType))
      .map((row) => {
        const normalizedBaseBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.baseBalance,
        );
        const normalizedAdjustmentBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.adjustmentBalance,
        );
        const normalizedEliminationBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.eliminationBalance,
        );
        const normalizedFinalBalance =
          normalizeConsolidationBalanceByAccountType(
          row.accountType,
          row.finalBalance,
        );

        return {
          accountId: row.accountId,
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          baseBalance: row.baseBalance,
          adjustmentBalance: row.adjustmentBalance,
          eliminationBalance: row.eliminationBalance,
          finalBalance: row.finalBalance,
          normalizedBaseBalance,
          normalizedAdjustmentBalance,
          normalizedEliminationBalance,
          normalizedFinalBalance,
        };
      })
      .filter(
        (row) =>
          includeZero ||
          Math.abs(Number(row.normalizedFinalBalance || 0)) >= BALANCE_EPSILON,
      )
      .sort((a, b) =>
        String(a.accountCode).localeCompare(String(b.accountCode)),
      );

    const compatibility = await buildCrossTrackCompatibilitySnapshot({
      tenantId,
      runId,
      run,
    });

    return res.json({
      runId,
      run: {
        id: parsePositiveInt(run.id),
        consolidationGroupId: parsePositiveInt(run.consolidation_group_id),
        consolidationGroupCode: run.consolidation_group_code || null,
        consolidationGroupName: run.consolidation_group_name || null,
        fiscalPeriodId: parsePositiveInt(run.fiscal_period_id),
        periodStartDate: run.period_start_date || null,
        periodEndDate: run.period_end_date || null,
        status: String(run.status || "").toUpperCase(),
        presentationCurrencyCode: String(
          run.presentation_currency_code || "",
        ).toUpperCase(),
      },
      options: {
        includeDraft,
        includeZero,
        rateType: preferredRateType,
        includedStatuses: reportData.statusFilter,
      },
      totals: {
        revenueTotal: reportMath.revenueTotal,
        expenseTotal: reportMath.expenseTotal,
        netIncome: reportMath.currentPeriodEarnings,
      },
      compatibility,
      rows: mappedRows,
    });
  }),
);

export default router;
