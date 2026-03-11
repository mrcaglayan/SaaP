import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { logInfo } from "../observability/logger.js";

const CANONICAL_TYPES = new Set(["ACCOUNT", "PURPOSE"]);
const MAPPING_STATUSES = new Set(["ACTIVE", "INACTIVE"]);
const CANDIDATE_CLASSIFICATIONS = Object.freeze([
  "SAFE",
  "ALREADY_MAPPED",
  "PARTIAL_MAPPING",
  "MISSING_GROUP_MATCH",
  "AMBIGUOUS_GROUP_MATCH",
]);
const BULK_RULE_TYPES = new Set(["DESCENDANTS_OF_ACCOUNT", "CODE_PREFIX"]);
const BULK_RULE_PREVIEW_CLASSIFICATIONS = Object.freeze([
  "READY_TO_APPLY",
  "ALREADY_ALIGNED",
  "CONFLICTING_LOCAL_MAPPING",
]);
const MAX_CANDIDATE_LIMIT = 5000;
const MAX_GOVERNANCE_REVIEW_LIMIT = 1000;
const DEFAULT_GOVERNANCE_REVIEW_LIMIT = 200;
const GOVERNANCE_LOCAL_MAPPING_AUDIT_ACTIONS = Object.freeze([
  "consolidation.canonical_mapping.local.create",
  "consolidation.canonical_mapping.local.update",
]);
const GOVERNANCE_GROUP_MAPPING_AUDIT_ACTIONS = Object.freeze([
  "consolidation.canonical_mapping.group.create",
  "consolidation.canonical_mapping.group.update",
]);
const GOVERNANCE_RULE_MAPPING_AUDIT_ACTIONS = Object.freeze([
  "consolidation.canonical_mapping.rule.create",
  "consolidation.canonical_mapping.rule.deactivate",
  "consolidation.canonical_mapping.rules.apply",
]);
const GOVERNANCE_CANDIDATE_APPLY_AUDIT_ACTION =
  "consolidation.canonical_mapping.candidates.apply";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseDbBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function toNullableString(value, maxLength = 255) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function toDateOnlyString(value, label = "date") {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${label} must be a valid date`);
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
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
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStatus(value, fallback = "ACTIVE") {
  const status = normalizeUpperText(value || fallback);
  if (!MAPPING_STATUSES.has(status)) {
    throw badRequest("status must be ACTIVE or INACTIVE");
  }
  return status;
}

function normalizeCanonicalType(value, fallback = "ACCOUNT") {
  const canonicalType = normalizeUpperText(value || fallback);
  if (!CANONICAL_TYPES.has(canonicalType)) {
    throw badRequest("canonicalType must be ACCOUNT or PURPOSE");
  }
  return canonicalType;
}

function normalizeListStatus(value) {
  const normalized = normalizeUpperText(value || "ALL");
  if (!["ALL", ...MAPPING_STATUSES].includes(normalized)) {
    throw badRequest("status must be ALL, ACTIVE, or INACTIVE");
  }
  return normalized;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: "SERIALIZATION_FAILED" });
  }
}

function tokenizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function buildSemanticWarnings({
  localAccountType = null,
  localNormalSide = null,
  localAccountName = null,
  groupAccountType = null,
  groupNormalSide = null,
  groupAccountName = null,
}) {
  const warnings = [];
  const localType = normalizeUpperText(localAccountType || "");
  const groupType = normalizeUpperText(groupAccountType || "");
  if (localType && groupType && localType !== groupType) {
    warnings.push({
      code: "ACCOUNT_TYPE_MISMATCH",
      severity: "HIGH",
      message: `Local account type ${localType} != group account type ${groupType}`,
    });
  }

  const localSide = normalizeUpperText(localNormalSide || "");
  const groupSide = normalizeUpperText(groupNormalSide || "");
  if (localSide && groupSide && localSide !== groupSide) {
    warnings.push({
      code: "NORMAL_SIDE_MISMATCH",
      severity: "HIGH",
      message: `Local normal side ${localSide} != group normal side ${groupSide}`,
    });
  }

  const localTokens = new Set(tokenizeName(localAccountName));
  const groupTokens = new Set(tokenizeName(groupAccountName));
  if (localTokens.size > 0 && groupTokens.size > 0) {
    const overlap = [...localTokens].filter((token) => groupTokens.has(token));
    if (overlap.length === 0) {
      warnings.push({
        code: "SUSPICIOUS_NAME_MISMATCH",
        severity: "MEDIUM",
        message: "Local and group account names have no token overlap",
      });
    }
  }

  const uniqueByCode = new Map();
  for (const warning of warnings) {
    uniqueByCode.set(warning.code, warning);
  }
  return [...uniqueByCode.values()];
}

function summarizeSemanticWarnings(warnings = []) {
  const normalized = (Array.isArray(warnings) ? warnings : []).filter(Boolean);
  return {
    count: normalized.length,
    highRisk: normalized.some(
      (warning) => normalizeUpperText(warning?.severity) === "HIGH"
    ),
    codes: normalized.map((warning) => warning.code).filter(Boolean),
  };
}

function emitSemanticRiskOverrideUsageEvent({
  tenantId,
  consolidationGroupId,
  legalEntityId = null,
  changeSource = null,
  changeReason = null,
  semanticWarnings = [],
  actedByUserId = null,
  overrideContext = null,
  highRiskCandidateCount = null,
}) {
  const summary = summarizeSemanticWarnings(semanticWarnings);
  if (!summary.highRisk) {
    return;
  }

  logInfo("Consolidation canonical semantic override usage observed", {
    eventCode: "CONSOLIDATION_CANONICAL_MAPPING_OVERRIDE_USAGE",
    subtype: "SEMANTIC_RISK_OVERRIDE_USAGE",
    tenantId: parsePositiveInt(tenantId),
    consolidationGroupId: parsePositiveInt(consolidationGroupId),
    legalEntityId: parsePositiveInt(legalEntityId) || null,
    overrideContext: toNullableString(overrideContext, 80),
    source: toNullableString(changeSource, 80),
    reasonProvided: Boolean(toNullableString(changeReason, 500)),
    warningCount: summary.count,
    warningCodes: summary.codes,
    highRiskCandidateCount: Number(highRiskCandidateCount || 0) || null,
    actedByUserId: parsePositiveInt(actedByUserId) || null,
  });
}

function requireHighRiskReasonIfNeeded({
  isRemapChange,
  semanticWarnings,
  changeReason,
  context,
}) {
  const summary = summarizeSemanticWarnings(semanticWarnings);
  if (!isRemapChange || !summary.highRisk) {
    return;
  }
  const normalizedReason = toNullableString(changeReason, 500);
  if (normalizedReason) {
    return;
  }
  const err = badRequest(
    "High-risk remap requires reason. Provide reason in payload.reason"
  );
  err.details = {
    code: "HIGH_RISK_REMAP_REASON_REQUIRED",
    context,
    semanticWarnings: semanticWarnings || [],
  };
  throw err;
}

async function insertCanonicalMappingAuditLog({
  runQuery = query,
  tenantId,
  userId = null,
  action,
  resourceType,
  resourceId = null,
  scopeType = null,
  scopeId = null,
  requestId = null,
  ipAddress = null,
  userAgent = null,
  payload = null,
}) {
  await runQuery(
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
      parsePositiveInt(tenantId),
      parsePositiveInt(userId) || null,
      String(action || "consolidation.canonical_mapping.event").slice(0, 120),
      String(resourceType || "consolidation_canonical_mapping").slice(0, 80),
      toNullableString(resourceId, 80),
      toNullableString(scopeType, 30),
      parsePositiveInt(scopeId) || null,
      toNullableString(requestId, 80),
      toNullableString(ipAddress, 64),
      toNullableString(userAgent, 255),
      safeJson(payload || null),
    ]
  );
}

async function getExistingLocalCanonicalMappingByScope({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, canonical_key_id, status, effective_from, effective_to
     FROM consolidation_canonical_local_account_mappings
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND legal_entity_id = ?
       AND local_account_id = ?
     LIMIT 1`,
    [tenantId, consolidationGroupId, legalEntityId, localAccountId]
  );
  return result.rows?.[0] || null;
}

async function getExistingGroupCanonicalMappingByScope({
  tenantId,
  consolidationGroupId,
  canonicalKeyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, group_account_id, status, effective_from, effective_to
     FROM consolidation_canonical_group_account_mappings
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND canonical_key_id = ?
     LIMIT 1`,
    [tenantId, consolidationGroupId, canonicalKeyId]
  );
  return result.rows?.[0] || null;
}

async function assertNoOverlappingActiveLocalMappingWindow({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localAccountId,
  effectiveFrom,
  effectiveTo,
  excludeMappingId = null,
  runQuery = query,
}) {
  const overlapResult = await runQuery(
    `SELECT id, effective_from, effective_to
     FROM consolidation_canonical_local_account_mappings
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND legal_entity_id = ?
       AND local_account_id = ?
       AND status = 'ACTIVE'
       AND (? IS NULL OR id <> ?)
       AND NOT (
         COALESCE(effective_to, '9999-12-31') < ?
         OR effective_from > COALESCE(?, '9999-12-31')
       )
     LIMIT 1`,
    [
      tenantId,
      consolidationGroupId,
      legalEntityId,
      localAccountId,
      excludeMappingId,
      excludeMappingId,
      effectiveFrom,
      effectiveTo,
    ]
  );

  const overlap = overlapResult.rows?.[0] || null;
  if (!overlap) {
    return;
  }

  const err = badRequest(
    "ACTIVE local canonical mapping date window overlaps existing mapping for same scope"
  );
  err.details = {
    scope: "LOCAL_ACCOUNT_MAPPING",
    legalEntityId,
    localAccountId,
    incoming: {
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    },
    existing: {
      mappingId: parsePositiveInt(overlap.id),
      effectiveFrom: overlap.effective_from || null,
      effectiveTo: overlap.effective_to || null,
    },
  };
  throw err;
}

async function assertNoOverlappingActiveGroupMappingWindow({
  tenantId,
  consolidationGroupId,
  canonicalKeyId,
  effectiveFrom,
  effectiveTo,
  excludeMappingId = null,
  runQuery = query,
}) {
  const overlapResult = await runQuery(
    `SELECT id, effective_from, effective_to
     FROM consolidation_canonical_group_account_mappings
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND canonical_key_id = ?
       AND status = 'ACTIVE'
       AND (? IS NULL OR id <> ?)
       AND NOT (
         COALESCE(effective_to, '9999-12-31') < ?
         OR effective_from > COALESCE(?, '9999-12-31')
       )
     LIMIT 1`,
    [
      tenantId,
      consolidationGroupId,
      canonicalKeyId,
      excludeMappingId,
      excludeMappingId,
      effectiveFrom,
      effectiveTo,
    ]
  );

  const overlap = overlapResult.rows?.[0] || null;
  if (!overlap) {
    return;
  }

  const err = badRequest(
    "ACTIVE group canonical mapping date window overlaps existing mapping for same scope"
  );
  err.details = {
    scope: "GROUP_ACCOUNT_MAPPING",
    canonicalKeyId,
    incoming: {
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    },
    existing: {
      mappingId: parsePositiveInt(overlap.id),
      effectiveFrom: overlap.effective_from || null,
      effectiveTo: overlap.effective_to || null,
    },
  };
  throw err;
}

function normalizeCandidateLimit(value, fallback = 500) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest("limit must be a positive integer");
  }
  if (parsed > MAX_CANDIDATE_LIMIT) {
    throw badRequest(`limit must be <= ${MAX_CANDIDATE_LIMIT}`);
  }
  return parsed;
}

function normalizeBulkRuleType(value) {
  const normalized = normalizeUpperText(value);
  if (!BULK_RULE_TYPES.has(normalized)) {
    throw badRequest(
      "ruleType must be DESCENDANTS_OF_ACCOUNT or CODE_PREFIX"
    );
  }
  return normalized;
}

function normalizeCodePrefix(value) {
  const normalized = normalizeUpperText(value);
  if (!normalized) {
    throw badRequest("codePrefix is required for CODE_PREFIX ruleType");
  }
  return normalized;
}

function normalizeGovernanceReviewLimit(
  value,
  fallback = DEFAULT_GOVERNANCE_REVIEW_LIMIT
) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest("limit must be a positive integer");
  }
  if (parsed > MAX_GOVERNANCE_REVIEW_LIMIT) {
    throw badRequest(`limit must be <= ${MAX_GOVERNANCE_REVIEW_LIMIT}`);
  }
  return parsed;
}

function toUtcDateOnly(value) {
  const asDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    throw badRequest("date must be a valid date");
  }
  return `${asDate.getUTCFullYear()}-${String(asDate.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(asDate.getUTCDate()).padStart(2, "0")}`;
}

function addDaysToDateOnly(dateOnly, days = 0) {
  const base = new Date(`${String(dateOnly).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    throw badRequest("date must be a valid date");
  }
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return toUtcDateOnly(base);
}

function resolveGovernanceReviewWindow({ fromDate = null, toDate = null } = {}) {
  const todayUtc = toUtcDateOnly(new Date());
  const normalizedToDate = toDateOnlyString(toDate, "toDate") || todayUtc;

  let normalizedFromDate = toDateOnlyString(fromDate, "fromDate");
  if (!normalizedFromDate) {
    const monthStart = `${normalizedToDate.slice(0, 8)}01`;
    normalizedFromDate = monthStart;
  }

  if (normalizedFromDate > normalizedToDate) {
    throw badRequest("fromDate must be <= toDate");
  }

  return {
    fromDate: normalizedFromDate,
    toDate: normalizedToDate,
  };
}

function parseJsonPayloadObject(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Ignore payload parse failures; return empty object fallback.
  }
  return {};
}

function extractHighRiskSemanticWarningCodes(warnings = []) {
  const rows = Array.isArray(warnings) ? warnings : [];
  const codes = rows
    .filter((warning) => normalizeUpperText(warning?.severity) === "HIGH")
    .map((warning) => normalizeUpperText(warning?.code || ""))
    .filter(Boolean);
  return [...new Set(codes)];
}

function mapGovernanceAuditLogRow(row) {
  const payload = parseJsonPayloadObject(row?.payload_json);
  const semanticWarnings = Array.isArray(payload?.semanticWarnings)
    ? payload.semanticWarnings
    : [];
  const highRiskWarningCodes = extractHighRiskSemanticWarningCodes(semanticWarnings);
  const highRiskSafeCandidateCount = Number(payload?.highRiskSafeCandidateCount || 0);
  const semanticHighRisk =
    highRiskWarningCodes.length > 0 || highRiskSafeCandidateCount > 0;
  const isRemapChange = payload?.isRemapChange === true;
  const requiresChecker = semanticHighRisk || isRemapChange;
  const makerCheckerReason = semanticHighRisk
    ? "HIGH_RISK_REMAP_OR_APPLY"
    : isRemapChange
      ? "REMAP_CHANGE"
      : null;

  return {
    auditLogId: parsePositiveInt(row?.id),
    action: String(row?.action || "").trim(),
    createdAt: row?.created_at || null,
    changedByUserId: parsePositiveInt(row?.user_id) || null,
    scopeType: toNullableString(row?.scope_type, 30),
    scopeId: parsePositiveInt(row?.scope_id) || null,
    requestId: toNullableString(row?.request_id, 80),
    source: toNullableString(payload?.source, 80),
    reason: toNullableString(payload?.reason, 500),
    governance: {
      isRemapChange,
      semanticHighRisk,
      semanticWarningCount: Number(semanticWarnings.length || 0),
      semanticHighRiskCodes:
        highRiskWarningCodes.length > 0
          ? highRiskWarningCodes
          : highRiskSafeCandidateCount > 0
            ? ["HIGH_RISK_SAFE_CANDIDATE"]
            : [],
      highRiskSafeCandidateCount,
      makerChecker: {
        requiresChecker,
        checkerMustDifferFromMaker: true,
        reviewStatus: requiresChecker ? "PENDING_CHECKER_REVIEW" : "NOT_REQUIRED",
        reasonCode: makerCheckerReason,
      },
    },
  };
}

function buildCanonicalKeyFromAccountCode(accountCode) {
  return `ACC_CODE:${normalizeUpperText(accountCode)}`;
}

function parseCsvPositiveInts(value) {
  const tokens = String(value || "")
    .split(",")
    .map((token) => parsePositiveInt(token))
    .filter(Boolean);
  return [...new Set(tokens)];
}

function buildCandidateReason({
  classification,
  groupMatchCount,
  existingLocalCanonicalKey,
  expectedCanonicalKey,
  existingGroupAccountId,
  resolvedGroupAccountId,
  existingLocalMappingStatus,
  existingGroupMappingStatus,
  expectedCanonicalKeyStatus,
  expectedGroupMappingStatus,
}) {
  if (classification === "SAFE") {
    return "Deterministic one-to-one code match; safe for controlled auto-apply.";
  }
  if (classification === "ALREADY_MAPPED") {
    return "Local and group canonical mappings are already active.";
  }
  if (classification === "MISSING_GROUP_MATCH") {
    return "No active group account has the same account code.";
  }
  if (classification === "AMBIGUOUS_GROUP_MATCH") {
    return `Multiple active group accounts match the same local code (${groupMatchCount}).`;
  }
  if (
    existingLocalCanonicalKey &&
    expectedCanonicalKey &&
    existingLocalCanonicalKey !== expectedCanonicalKey
  ) {
    return `Local account already points to a different canonical key (${existingLocalCanonicalKey}).`;
  }
  if (existingLocalMappingStatus && existingLocalMappingStatus !== "ACTIVE") {
    return `Existing local mapping is ${existingLocalMappingStatus}.`;
  }
  if (existingGroupMappingStatus && existingGroupMappingStatus !== "ACTIVE") {
    return `Existing group mapping is ${existingGroupMappingStatus}.`;
  }
  if (
    existingGroupAccountId &&
    resolvedGroupAccountId &&
    existingGroupAccountId !== resolvedGroupAccountId
  ) {
    return "Existing canonical key points to a different group account than code-match candidate.";
  }
  if (expectedCanonicalKeyStatus && expectedCanonicalKeyStatus !== "ACTIVE") {
    return `Expected canonical key exists but is ${expectedCanonicalKeyStatus}.`;
  }
  if (expectedGroupMappingStatus && expectedGroupMappingStatus !== "ACTIVE") {
    return `Expected canonical key group mapping is ${expectedGroupMappingStatus}.`;
  }
  return "Existing mapping state is partial or conflicting; manual review required.";
}

function classifyCanonicalCandidate(row) {
  const expectedCanonicalKey = buildCanonicalKeyFromAccountCode(row.local_account_code);
  const groupMatchCount = Number(row.group_match_count || 0);
  const groupMatchAccountIds = parseCsvPositiveInts(row.group_match_ids);
  const resolvedGroupAccountId =
    groupMatchCount === 1 ? parsePositiveInt(groupMatchAccountIds[0]) : null;

  const existingLocalMappingId = parsePositiveInt(row.existing_local_mapping_id);
  const existingLocalCanonicalKeyId = parsePositiveInt(
    row.existing_local_canonical_key_id
  );
  const existingLocalCanonicalKey = row.existing_local_canonical_key || null;
  const existingLocalMappingStatus = normalizeUpperText(
    row.existing_local_mapping_status || ""
  );
  const existingGroupAccountId = parsePositiveInt(row.existing_group_account_id);
  const existingGroupAccountCode = row.existing_group_account_code || null;
  const existingGroupMappingStatus = normalizeUpperText(
    row.existing_group_mapping_status || ""
  );

  const expectedCanonicalKeyId = parsePositiveInt(row.expected_canonical_key_id);
  const expectedCanonicalKeyStatus = normalizeUpperText(
    row.expected_canonical_key_status || ""
  );
  const expectedGroupAccountId = parsePositiveInt(row.expected_group_account_id);
  const expectedGroupAccountCode = row.expected_group_account_code || null;
  const expectedGroupMappingStatus = normalizeUpperText(
    row.expected_group_mapping_status || ""
  );

  let classification = "SAFE";
  if (existingLocalMappingId) {
    const localActive = existingLocalMappingStatus === "ACTIVE";
    const groupActive = existingGroupMappingStatus === "ACTIVE";
    const hasExistingResolvedGroup = Boolean(existingGroupAccountId);
    const groupAligned =
      hasExistingResolvedGroup &&
      (!resolvedGroupAccountId || existingGroupAccountId === resolvedGroupAccountId);

    classification =
      localActive && groupActive && groupAligned
        ? "ALREADY_MAPPED"
        : "PARTIAL_MAPPING";
  } else if (groupMatchCount <= 0) {
    classification = "MISSING_GROUP_MATCH";
  } else if (groupMatchCount > 1) {
    classification = "AMBIGUOUS_GROUP_MATCH";
  } else if (expectedCanonicalKeyId && expectedCanonicalKeyStatus !== "ACTIVE") {
    classification = "PARTIAL_MAPPING";
  } else if (
    expectedGroupAccountId &&
    resolvedGroupAccountId &&
    expectedGroupAccountId !== resolvedGroupAccountId
  ) {
    classification = "PARTIAL_MAPPING";
  } else if (expectedGroupMappingStatus && expectedGroupMappingStatus !== "ACTIVE") {
    classification = "PARTIAL_MAPPING";
  }

  const reason = buildCandidateReason({
    classification,
    groupMatchCount,
    existingLocalCanonicalKey,
    expectedCanonicalKey,
    existingGroupAccountId,
    resolvedGroupAccountId,
    existingLocalMappingStatus,
    existingGroupMappingStatus,
    expectedCanonicalKeyStatus,
    expectedGroupMappingStatus,
  });
  const semanticWarnings = resolvedGroupAccountId
    ? buildSemanticWarnings({
        localAccountType: row.local_account_type,
        localNormalSide: row.local_normal_side,
        localAccountName: row.local_account_name,
        groupAccountType: row.group_match_account_type,
        groupNormalSide: row.group_match_normal_side,
        groupAccountName: row.group_match_account_name,
      })
    : [];
  const semanticSummary = summarizeSemanticWarnings(semanticWarnings);

  return {
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    localAccountId: parsePositiveInt(row.local_account_id),
    localAccountCode: row.local_account_code || null,
    localAccountName: row.local_account_name || null,
    expectedCanonicalKey,
    groupMatchCount,
    groupMatchAccountIds,
    resolvedGroupAccountId,
    resolvedGroupAccountCode: resolvedGroupAccountId ? row.local_account_code || null : null,
    classification,
    reasonCode: classification,
    reason,
    canAutoApply: classification === "SAFE",
    semanticWarnings,
    semanticRisk: {
      warningCount: semanticSummary.count,
      highRisk: semanticSummary.highRisk,
      requiresReason:
        classification === "SAFE" && semanticSummary.highRisk === true,
      codes: semanticSummary.codes,
    },
    currentMapping: {
      localMappingId: existingLocalMappingId,
      localCanonicalKeyId: existingLocalCanonicalKeyId,
      localCanonicalKey: existingLocalCanonicalKey,
      localStatus: existingLocalMappingStatus || null,
      groupAccountId: existingGroupAccountId,
      groupAccountCode: existingGroupAccountCode,
      groupStatus: existingGroupMappingStatus || null,
    },
    expectedKeyState: {
      canonicalKeyId: expectedCanonicalKeyId,
      canonicalKeyStatus: expectedCanonicalKeyStatus || null,
      groupAccountId: expectedGroupAccountId,
      groupAccountCode: expectedGroupAccountCode,
      groupStatus: expectedGroupMappingStatus || null,
    },
  };
}

function buildCandidateSummary(rows = []) {
  const summary = {
    total: rows.length,
    safeCount: 0,
    alreadyMappedCount: 0,
    partialMappingCount: 0,
    missingGroupMatchCount: 0,
    ambiguousGroupMatchCount: 0,
    applyableCount: 0,
    unresolvedCount: 0,
    semanticWarningCount: 0,
    semanticHighRiskCount: 0,
  };

  for (const row of rows) {
    const warningCount = Number(row?.semanticRisk?.warningCount || 0);
    if (warningCount > 0) {
      summary.semanticWarningCount += 1;
      if (row?.semanticRisk?.highRisk === true) {
        summary.semanticHighRiskCount += 1;
      }
    }

    const classification = String(row?.classification || "").toUpperCase();
    if (!CANDIDATE_CLASSIFICATIONS.includes(classification)) {
      continue;
    }
    if (classification === "SAFE") {
      summary.safeCount += 1;
      continue;
    }
    if (classification === "ALREADY_MAPPED") {
      summary.alreadyMappedCount += 1;
      continue;
    }
    if (classification === "PARTIAL_MAPPING") {
      summary.partialMappingCount += 1;
      continue;
    }
    if (classification === "MISSING_GROUP_MATCH") {
      summary.missingGroupMatchCount += 1;
      continue;
    }
    if (classification === "AMBIGUOUS_GROUP_MATCH") {
      summary.ambiguousGroupMatchCount += 1;
    }
  }

  summary.applyableCount = summary.safeCount;
  summary.unresolvedCount =
    summary.partialMappingCount +
    summary.missingGroupMatchCount +
    summary.ambiguousGroupMatchCount;
  return summary;
}

function mapRuleRootAccountRow(row) {
  if (!row) {
    return null;
  }
  return {
    accountId: parsePositiveInt(row.account_id),
    accountCode: row.account_code || null,
    accountName: row.account_name || null,
    accountType: row.account_type || null,
    normalSide: row.normal_side || null,
    coaId: parsePositiveInt(row.coa_id),
    legalEntityId: parsePositiveInt(row.coa_legal_entity_id),
    allowPosting: parseDbBoolean(row.allow_posting),
    hasActiveChildren: parseDbBoolean(row.has_active_children),
  };
}

function mapRuleSelectedGroupAccountRow(row) {
  if (!row) {
    return null;
  }
  return {
    groupAccountId: parsePositiveInt(row.account_id),
    groupAccountCode: row.account_code || null,
    groupAccountName: row.account_name || null,
    groupAccountType: row.account_type || null,
    groupNormalSide: row.normal_side || null,
    coaId: parsePositiveInt(row.coa_id),
    allowPosting: parseDbBoolean(row.allow_posting),
    hasActiveChildren: parseDbBoolean(row.has_active_children),
  };
}

async function assertLocalRuleRootAccountCompatible({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id AS account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type AS account_type,
       a.normal_side AS normal_side,
       a.allow_posting AS allow_posting,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       ) AS has_active_children,
       a.coa_id,
       c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
      AND c.tenant_id = ?
     JOIN group_coa_mappings gcm
       ON gcm.tenant_id = ?
      AND gcm.consolidation_group_id = ?
      AND gcm.legal_entity_id = ?
      AND gcm.local_coa_id = a.coa_id
      AND gcm.status = 'ACTIVE'
     WHERE a.id = ?
       AND a.is_active = TRUE
     LIMIT 1`,
    [tenantId, tenantId, consolidationGroupId, legalEntityId, localAccountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(
      "parentLocalAccountId must belong to an ACTIVE local CoA mapping for legalEntityId in this consolidation group"
    );
  }
  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest("parentLocalAccountId must belong to legalEntityId");
  }
  return row;
}

async function listActiveAccountsForCoa({
  tenantId,
  coaId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.account_type,
       a.normal_side,
       a.allow_posting,
       a.parent_account_id
     FROM accounts a
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
      AND c.tenant_id = ?
     WHERE a.coa_id = ?
       AND a.is_active = TRUE
     ORDER BY a.parent_account_id ASC, a.code ASC, a.id ASC`,
    [tenantId, coaId]
  );
  return result.rows || [];
}

function resolveDescendantAccountSelection(accounts = [], rootAccountId) {
  const items = Array.isArray(accounts) ? accounts : [];
  const childrenByParentId = new Map();
  for (const row of items) {
    const parentId = parsePositiveInt(row?.parent_account_id) || 0;
    if (!childrenByParentId.has(parentId)) {
      childrenByParentId.set(parentId, []);
    }
    childrenByParentId.get(parentId).push(row);
  }

  const allDescendantAccountIds = [];
  const leafAccountIds = [];
  const stack = [...(childrenByParentId.get(parsePositiveInt(rootAccountId) || 0) || [])];
  while (stack.length > 0) {
    const current = stack.pop();
    const currentId = parsePositiveInt(current?.id);
    if (!currentId) {
      continue;
    }
    allDescendantAccountIds.push(currentId);
    const children = childrenByParentId.get(currentId) || [];
    if (children.length > 0) {
      stack.push(...children);
      continue;
    }
    if (parseDbBoolean(current?.allow_posting)) {
      leafAccountIds.push(currentId);
    }
  }

  return {
    descendantAccountIds: allDescendantAccountIds,
    leafAccountIds,
    descendantCount: allDescendantAccountIds.length,
    leafCount: leafAccountIds.length,
  };
}

async function listBulkRulePreviewLocalLeafRows({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localCoaId = null,
  codePrefix = null,
  runQuery = query,
}) {
  const params = [tenantId, consolidationGroupId, legalEntityId];
  const where = [
    "gcm.tenant_id = ?",
    "gcm.consolidation_group_id = ?",
    "gcm.legal_entity_id = ?",
    "gcm.status = 'ACTIVE'",
  ];

  const parsedLocalCoaId = parsePositiveInt(localCoaId) || null;
  if (parsedLocalCoaId) {
    where.push("gcm.local_coa_id = ?");
    params.push(parsedLocalCoaId);
  }

  const normalizedPrefix = codePrefix ? normalizeCodePrefix(codePrefix) : null;
  if (normalizedPrefix) {
    where.push("UPPER(TRIM(local_acc.code)) LIKE ?");
    params.push(`${normalizedPrefix}%`);
  }

  const result = await runQuery(
    `SELECT DISTINCT
       gcm.tenant_id,
       gcm.consolidation_group_id,
       gcm.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       local_acc.id AS local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       local_acc.account_type AS local_account_type,
       local_acc.normal_side AS local_normal_side,
       local_acc.coa_id AS local_coa_id,
       clm.id AS existing_local_mapping_id,
       clm.canonical_key_id AS existing_local_canonical_key_id,
       clm.status AS existing_local_mapping_status,
       clm.effective_from AS existing_local_effective_from,
       clm.effective_to AS existing_local_effective_to,
       ck_local.canonical_key AS existing_local_canonical_key,
       ck_local.canonical_name AS existing_local_canonical_name,
       ck_local.status AS existing_local_canonical_key_status,
       cgm_local.id AS existing_group_mapping_id,
       cgm_local.group_account_id AS existing_group_account_id,
       cgm_local.status AS existing_group_mapping_status,
       cgm_local.effective_from AS existing_group_effective_from,
       cgm_local.effective_to AS existing_group_effective_to,
       group_acc_existing.code AS existing_group_account_code,
       group_acc_existing.name AS existing_group_account_name,
       group_acc_existing.account_type AS existing_group_account_type,
       group_acc_existing.normal_side AS existing_group_normal_side
     FROM group_coa_mappings gcm
     JOIN legal_entities le
       ON le.id = gcm.legal_entity_id
     JOIN accounts local_acc
       ON local_acc.coa_id = gcm.local_coa_id
      AND local_acc.is_active = TRUE
      AND local_acc.allow_posting = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM accounts local_child
        WHERE local_child.parent_account_id = local_acc.id
          AND local_child.is_active = TRUE
      )
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = gcm.tenant_id
      AND clm.consolidation_group_id = gcm.consolidation_group_id
      AND clm.legal_entity_id = gcm.legal_entity_id
      AND clm.local_account_id = local_acc.id
     LEFT JOIN consolidation_canonical_keys ck_local
       ON ck_local.id = clm.canonical_key_id
      AND ck_local.tenant_id = clm.tenant_id
      AND ck_local.consolidation_group_id = clm.consolidation_group_id
     LEFT JOIN consolidation_canonical_group_account_mappings cgm_local
       ON cgm_local.tenant_id = clm.tenant_id
      AND cgm_local.consolidation_group_id = clm.consolidation_group_id
      AND cgm_local.canonical_key_id = clm.canonical_key_id
     LEFT JOIN accounts group_acc_existing
       ON group_acc_existing.id = cgm_local.group_account_id
     WHERE ${where.join(" AND ")}
     ORDER BY local_acc.code ASC, local_acc.id ASC`,
    params
  );

  return result.rows || [];
}

function buildBulkRulePreviewReason({
  classification,
  existingLocalCanonicalKey,
  requestedCanonicalKey,
  existingLocalMappingStatus,
  requestedCanonicalKeyStatus,
}) {
  if (classification === "READY_TO_APPLY") {
    if (
      existingLocalCanonicalKey &&
      existingLocalCanonicalKey === requestedCanonicalKey &&
      existingLocalMappingStatus &&
      existingLocalMappingStatus !== "ACTIVE"
    ) {
      return `Local account already points to ${requestedCanonicalKey} but mapping is ${existingLocalMappingStatus} and can be reactivated.`;
    }
    if (
      existingLocalCanonicalKey &&
      existingLocalCanonicalKey === requestedCanonicalKey &&
      requestedCanonicalKeyStatus &&
      requestedCanonicalKeyStatus !== "ACTIVE"
    ) {
      return `Requested canonical key ${requestedCanonicalKey} exists but is ${requestedCanonicalKeyStatus}; apply will reactivate it.`;
    }
    return "Leaf account is in scope and currently has no conflicting local canonical mapping.";
  }
  if (classification === "ALREADY_ALIGNED") {
    return "Local account is already mapped to the requested canonical key.";
  }
  if (existingLocalCanonicalKey && existingLocalCanonicalKey !== requestedCanonicalKey) {
    return `Local account already points to a different canonical key (${existingLocalCanonicalKey}).`;
  }
  if (existingLocalMappingStatus && existingLocalMappingStatus !== "ACTIVE") {
    return `Existing local mapping is ${existingLocalMappingStatus}.`;
  }
  if (requestedCanonicalKeyStatus && requestedCanonicalKeyStatus !== "ACTIVE") {
    return `Requested canonical key exists but is ${requestedCanonicalKeyStatus}.`;
  }
  return "Existing local mapping state requires manual review before bulk apply.";
}

function classifyBulkRulePreviewRow({
  row,
  requestedCanonicalKey,
  requestedCanonicalKeyRow = null,
  selectedGroupAccountRow = null,
}) {
  const existingLocalMappingId = parsePositiveInt(row?.existing_local_mapping_id);
  const existingLocalCanonicalKeyId = parsePositiveInt(
    row?.existing_local_canonical_key_id
  );
  const existingLocalCanonicalKey = row?.existing_local_canonical_key || null;
  const existingLocalMappingStatus = normalizeUpperText(
    row?.existing_local_mapping_status || ""
  );
  const requestedCanonicalKeyId = parsePositiveInt(requestedCanonicalKeyRow?.id);
  const requestedCanonicalKeyStatus = normalizeUpperText(
    requestedCanonicalKeyRow?.status || ""
  );

  let classification = "READY_TO_APPLY";
  if (existingLocalMappingId) {
    const keyAligned = existingLocalCanonicalKey === requestedCanonicalKey;
    const localActive = existingLocalMappingStatus === "ACTIVE";
    const requestedKeyActive =
      !requestedCanonicalKeyRow || requestedCanonicalKeyStatus === "ACTIVE";
    classification =
      keyAligned && localActive && requestedKeyActive
        ? "ALREADY_ALIGNED"
        : keyAligned
          ? "READY_TO_APPLY"
          : "CONFLICTING_LOCAL_MAPPING";
  }

  const semanticWarnings = selectedGroupAccountRow
    ? buildSemanticWarnings({
        localAccountType: row?.local_account_type,
        localNormalSide: row?.local_normal_side,
        localAccountName: row?.local_account_name,
        groupAccountType: selectedGroupAccountRow?.groupAccountType,
        groupNormalSide: selectedGroupAccountRow?.groupNormalSide,
        groupAccountName: selectedGroupAccountRow?.groupAccountName,
      })
    : [];
  const semanticSummary = summarizeSemanticWarnings(semanticWarnings);

  return {
    tenantId: parsePositiveInt(row?.tenant_id),
    consolidationGroupId: parsePositiveInt(row?.consolidation_group_id),
    legalEntityId: parsePositiveInt(row?.legal_entity_id),
    legalEntityCode: row?.legal_entity_code || null,
    legalEntityName: row?.legal_entity_name || null,
    localCoaId: parsePositiveInt(row?.local_coa_id),
    localAccountId: parsePositiveInt(row?.local_account_id),
    localAccountCode: row?.local_account_code || null,
    localAccountName: row?.local_account_name || null,
    classification,
    reasonCode: classification,
    reason: buildBulkRulePreviewReason({
      classification,
      existingLocalCanonicalKey,
      requestedCanonicalKey,
      existingLocalMappingStatus,
      requestedCanonicalKeyStatus,
    }),
    canApply: classification === "READY_TO_APPLY",
    semanticWarnings,
    semanticRisk: {
      warningCount: semanticSummary.count,
      highRisk: semanticSummary.highRisk,
      requiresReason: semanticSummary.highRisk === true,
      codes: semanticSummary.codes,
    },
    currentMapping: {
      localMappingId: existingLocalMappingId,
      localCanonicalKeyId: existingLocalCanonicalKeyId,
      localCanonicalKey: existingLocalCanonicalKey,
      localCanonicalName: row?.existing_local_canonical_name || null,
      localCanonicalKeyStatus:
        normalizeUpperText(row?.existing_local_canonical_key_status || "") || null,
      localStatus: existingLocalMappingStatus || null,
      localEffectiveFrom: row?.existing_local_effective_from || null,
      localEffectiveTo: row?.existing_local_effective_to || null,
      groupMappingId: parsePositiveInt(row?.existing_group_mapping_id),
      groupAccountId: parsePositiveInt(row?.existing_group_account_id),
      groupAccountCode: row?.existing_group_account_code || null,
      groupAccountName: row?.existing_group_account_name || null,
      groupStatus:
        normalizeUpperText(row?.existing_group_mapping_status || "") || null,
      groupEffectiveFrom: row?.existing_group_effective_from || null,
      groupEffectiveTo: row?.existing_group_effective_to || null,
    },
    requestedTarget: {
      canonicalKeyId: requestedCanonicalKeyId,
      canonicalKey: requestedCanonicalKey,
      canonicalName:
        toNullableString(requestedCanonicalKeyRow?.canonical_name, 255) ||
        requestedCanonicalKey,
      canonicalKeyStatus: requestedCanonicalKeyStatus || null,
      selectedGroupAccountId: parsePositiveInt(
        selectedGroupAccountRow?.groupAccountId
      ),
      selectedGroupAccountCode:
        selectedGroupAccountRow?.groupAccountCode || null,
      selectedGroupAccountName:
        selectedGroupAccountRow?.groupAccountName || null,
    },
  };
}

function buildBulkRulePreviewSummary(rows = []) {
  const summary = {
    total: rows.length,
    readyToApplyCount: 0,
    alreadyAlignedCount: 0,
    conflictCount: 0,
    applyableCount: 0,
    semanticWarningCount: 0,
    semanticHighRiskCount: 0,
  };

  for (const row of rows) {
    const classification = String(row?.classification || "").toUpperCase();
    if (classification === "READY_TO_APPLY") {
      summary.readyToApplyCount += 1;
    } else if (classification === "ALREADY_ALIGNED") {
      summary.alreadyAlignedCount += 1;
    } else if (classification === "CONFLICTING_LOCAL_MAPPING") {
      summary.conflictCount += 1;
    }

    const warningCount = Number(row?.semanticRisk?.warningCount || 0);
    if (warningCount > 0) {
      summary.semanticWarningCount += 1;
      if (row?.semanticRisk?.highRisk === true) {
        summary.semanticHighRiskCount += 1;
      }
    }
  }

  summary.applyableCount = summary.readyToApplyCount;
  return summary;
}

function buildBulkRulePreviewBuckets(rows = []) {
  const matched = [];
  const alreadyAligned = [];
  const conflicts = [];

  for (const row of rows) {
    const classification = String(row?.classification || "").toUpperCase();
    if (classification === "READY_TO_APPLY") {
      matched.push(row);
      continue;
    }
    if (classification === "ALREADY_ALIGNED") {
      alreadyAligned.push(row);
      continue;
    }
    if (classification === "CONFLICTING_LOCAL_MAPPING") {
      conflicts.push(row);
    }
  }

  return {
    matched,
    alreadyAligned,
    conflicts,
  };
}

function buildBulkRuleGroupMappingPreview({
  requestedCanonicalKey,
  requestedCanonicalName = null,
  requestedCanonicalKeyRow = null,
  existingGroupMapping = null,
  selectedGroupAccountRow = null,
}) {
  const currentGroupAccountId = parsePositiveInt(existingGroupMapping?.group_account_id);
  const currentGroupMappingStatus = normalizeUpperText(existingGroupMapping?.status || "");
  const selectedGroupAccountId = parsePositiveInt(
    selectedGroupAccountRow?.groupAccountId
  );

  let status = "NONE_SELECTED";
  let reason = "No group account selected for bulk-rule preview.";
  if (selectedGroupAccountId) {
    if (!currentGroupAccountId) {
      status = "READY_FOR_GROUP_MAPPING";
      reason =
        "Requested canonical key does not yet have a group mapping for the selected group account.";
    } else if (
      currentGroupAccountId === selectedGroupAccountId &&
      currentGroupMappingStatus === "ACTIVE"
    ) {
      status = "ALREADY_ALIGNED";
      reason =
        "Requested canonical key is already aligned to the selected group account.";
    } else if (currentGroupAccountId === selectedGroupAccountId) {
      status = "INACTIVE_GROUP_MAPPING";
      reason = `Requested canonical key group mapping exists but is ${currentGroupMappingStatus}.`;
    } else {
      status = "CONFLICTING_GROUP_MAPPING";
      reason = `Requested canonical key already points to a different group account (${existingGroupMapping?.group_account_code || "unknown"}).`;
    }
  }

  return {
    canonicalKeyId: parsePositiveInt(requestedCanonicalKeyRow?.id),
    canonicalKey: requestedCanonicalKey,
    canonicalName:
      toNullableString(requestedCanonicalKeyRow?.canonical_name, 255) ||
      toNullableString(requestedCanonicalName, 255) ||
      requestedCanonicalKey,
    canonicalKeyStatus:
      normalizeUpperText(requestedCanonicalKeyRow?.status || "") || null,
    selectedGroupAccount: selectedGroupAccountRow || null,
    currentGroupMapping: existingGroupMapping
      ? {
          groupMappingId: parsePositiveInt(existingGroupMapping?.id),
          groupAccountId: currentGroupAccountId,
          groupAccountCode: existingGroupMapping?.group_account_code || null,
          groupAccountName: existingGroupMapping?.group_account_name || null,
          groupAccountType: existingGroupMapping?.group_account_type || null,
          groupNormalSide: existingGroupMapping?.group_normal_side || null,
          status: currentGroupMappingStatus || null,
          effectiveFrom: existingGroupMapping?.effective_from || null,
          effectiveTo: existingGroupMapping?.effective_to || null,
        }
      : null,
    status,
    reason,
    blocking: status === "CONFLICTING_GROUP_MAPPING",
  };
}

function mapCanonicalKeyRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: normalizeUpperText(row.canonical_type || "ACCOUNT"),
    purposeCode: row.purpose_code || null,
    status: normalizeUpperText(row.status || "ACTIVE"),
    localMappingCount: Number(row.local_mapping_count || 0),
    groupMappingCount: Number(row.group_mapping_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapCanonicalMappingRow(row) {
  return {
    canonicalKeyId: parsePositiveInt(row.canonical_key_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: row.canonical_type || null,
    purposeCode: row.purpose_code || null,
    keyStatus: row.key_status || null,
    localMapping: {
      id: parsePositiveInt(row.local_mapping_id),
      legalEntityId: parsePositiveInt(row.legal_entity_id),
      localAccountId: parsePositiveInt(row.local_account_id),
      localAccountCode: row.local_account_code || null,
      localAccountName: row.local_account_name || null,
      status: row.local_mapping_status || null,
      effectiveFrom: row.local_effective_from || null,
      effectiveTo: row.local_effective_to || null,
    },
    groupMapping: {
      id: parsePositiveInt(row.group_mapping_id),
      groupAccountId: parsePositiveInt(row.group_account_id),
      groupAccountCode: row.group_account_code || null,
      groupAccountName: row.group_account_name || null,
      status: row.group_mapping_status || null,
      effectiveFrom: row.group_effective_from || null,
      effectiveTo: row.group_effective_to || null,
    },
  };
}

async function assertLocalAccountCompatible({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id AS account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type AS account_type,
       a.normal_side AS normal_side,
       a.allow_posting AS allow_posting,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       ) AS has_active_children,
       a.coa_id,
       c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
      AND c.tenant_id = ?
     JOIN group_coa_mappings gcm
       ON gcm.tenant_id = ?
      AND gcm.consolidation_group_id = ?
      AND gcm.legal_entity_id = ?
      AND gcm.local_coa_id = a.coa_id
      AND gcm.status = 'ACTIVE'
     WHERE a.id = ?
       AND a.is_active = TRUE
     LIMIT 1`,
    [tenantId, tenantId, consolidationGroupId, legalEntityId, localAccountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(
      "localAccountId must belong to an ACTIVE local CoA mapping for legalEntityId in this consolidation group"
    );
  }
  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest("localAccountId must belong to legalEntityId");
  }
  if (!parseDbBoolean(row.allow_posting)) {
    throw badRequest("localAccountId must reference a postable account");
  }
  if (parseDbBoolean(row.has_active_children)) {
    throw badRequest("localAccountId must reference a leaf account");
  }
  return row;
}

async function assertGroupAccountCompatible({
  tenantId,
  consolidationGroupId,
  groupAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id AS account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type AS account_type,
       a.normal_side AS normal_side,
       a.allow_posting AS allow_posting,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       ) AS has_active_children,
       a.coa_id,
       c.scope AS coa_scope
     FROM accounts a
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
      AND c.tenant_id = ?
     JOIN group_coa_mappings gcm
       ON gcm.tenant_id = ?
      AND gcm.consolidation_group_id = ?
      AND gcm.group_coa_id = a.coa_id
      AND gcm.status = 'ACTIVE'
     WHERE a.id = ?
       AND a.is_active = TRUE
     LIMIT 1`,
    [tenantId, tenantId, consolidationGroupId, groupAccountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(
      "groupAccountId must belong to an ACTIVE group CoA mapping in this consolidation group"
    );
  }
  if (normalizeUpperText(row.coa_scope) !== "GROUP") {
    throw badRequest("groupAccountId must belong to a GROUP chart of accounts");
  }
  if (!parseDbBoolean(row.allow_posting)) {
    throw badRequest("groupAccountId must reference a postable account");
  }
  if (parseDbBoolean(row.has_active_children)) {
    throw badRequest("groupAccountId must reference a leaf account");
  }
  return row;
}

async function getCanonicalKeyById({
  tenantId,
  consolidationGroupId,
  canonicalKeyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM consolidation_canonical_keys
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, consolidationGroupId, canonicalKeyId]
  );
  return result.rows?.[0] || null;
}

async function getCanonicalKeyByCode({
  tenantId,
  consolidationGroupId,
  canonicalKey,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM consolidation_canonical_keys
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND canonical_key = ?
     LIMIT 1`,
    [tenantId, consolidationGroupId, canonicalKey]
  );
  return result.rows?.[0] || null;
}

async function getGroupMappingForCanonicalKey({
  tenantId,
  consolidationGroupId,
  canonicalKeyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       cgm.id,
       cgm.group_account_id,
       cgm.status,
       cgm.effective_from,
       cgm.effective_to,
       a.code AS group_account_code,
       a.name AS group_account_name,
       a.account_type AS group_account_type,
       a.normal_side AS group_normal_side
     FROM consolidation_canonical_group_account_mappings cgm
     JOIN accounts a ON a.id = cgm.group_account_id
     WHERE cgm.tenant_id = ?
       AND cgm.consolidation_group_id = ?
       AND cgm.canonical_key_id = ?
     LIMIT 1`,
    [tenantId, consolidationGroupId, canonicalKeyId]
  );
  return result.rows?.[0] || null;
}

async function listLocalMappingsForCanonicalKey({
  tenantId,
  consolidationGroupId,
  canonicalKeyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       clm.id,
       clm.legal_entity_id,
       clm.local_account_id,
       clm.status,
       clm.effective_from,
       clm.effective_to,
       a.code AS local_account_code,
       a.name AS local_account_name,
       a.account_type AS local_account_type,
       a.normal_side AS local_normal_side
     FROM consolidation_canonical_local_account_mappings clm
     JOIN accounts a ON a.id = clm.local_account_id
     WHERE clm.tenant_id = ?
       AND clm.consolidation_group_id = ?
       AND clm.canonical_key_id = ?`,
    [tenantId, consolidationGroupId, canonicalKeyId]
  );
  return result.rows || [];
}

async function resolveCanonicalKey({
  tenantId,
  consolidationGroupId,
  canonicalKeyId = null,
  canonicalKey = null,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  runQuery = query,
}) {
  const parsedCanonicalKeyId = parsePositiveInt(canonicalKeyId);
  if (parsedCanonicalKeyId) {
    const row = await getCanonicalKeyById({
      tenantId,
      consolidationGroupId,
      canonicalKeyId: parsedCanonicalKeyId,
      runQuery,
    });
    if (!row) {
      throw badRequest("canonicalKeyId not found in consolidation group");
    }
    return row;
  }

  const normalizedCanonicalKey = normalizeUpperText(canonicalKey);
  if (!normalizedCanonicalKey) {
    throw badRequest("canonicalKeyId or canonicalKey is required");
  }

  await runQuery(
    `INSERT INTO consolidation_canonical_keys (
        tenant_id,
        consolidation_group_id,
        canonical_key,
        canonical_name,
        canonical_type,
        purpose_code,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canonical_name = VALUES(canonical_name),
       canonical_type = VALUES(canonical_type),
       purpose_code = VALUES(purpose_code),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      consolidationGroupId,
      normalizedCanonicalKey,
      toNullableString(canonicalName, 255) || normalizedCanonicalKey,
      normalizeCanonicalType(canonicalType),
      toNullableString(purposeCode, 80),
      normalizeStatus(status),
    ]
  );

  const row = await getCanonicalKeyByCode({
    tenantId,
    consolidationGroupId,
    canonicalKey: normalizedCanonicalKey,
    runQuery,
  });
  if (!row) {
    throw new Error("Canonical key upsert readback failed");
  }
  return row;
}

export async function listCanonicalKeys({
  tenantId,
  consolidationGroupId,
  status = "ALL",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const normalizedStatus = normalizeListStatus(status);
  const params = [parsedTenantId, parsedGroupId];
  const where = ["ck.tenant_id = ?", "ck.consolidation_group_id = ?"];
  if (normalizedStatus !== "ALL") {
    where.push("ck.status = ?");
    params.push(normalizedStatus);
  }

  const result = await runQuery(
    `SELECT
       ck.*,
       COUNT(DISTINCT clm.id) AS local_mapping_count,
       COUNT(DISTINCT cgm.id) AS group_mapping_count
     FROM consolidation_canonical_keys ck
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = ck.tenant_id
      AND clm.consolidation_group_id = ck.consolidation_group_id
      AND clm.canonical_key_id = ck.id
     LEFT JOIN consolidation_canonical_group_account_mappings cgm
       ON cgm.tenant_id = ck.tenant_id
      AND cgm.consolidation_group_id = ck.consolidation_group_id
      AND cgm.canonical_key_id = ck.id
     WHERE ${where.join(" AND ")}
     GROUP BY ck.id
     ORDER BY ck.canonical_key ASC`,
    params
  );

  return (result.rows || []).map(mapCanonicalKeyRow);
}

export async function upsertCanonicalKey({
  tenantId,
  consolidationGroupId,
  canonicalKey,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const row = await resolveCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKey,
    canonicalName,
    canonicalType,
    purposeCode,
    status,
    runQuery,
  });
  return mapCanonicalKeyRow(row);
}

export async function upsertLocalAccountCanonicalMapping({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localAccountId,
  canonicalKeyId = null,
  canonicalKey = null,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  effectiveFrom = null,
  effectiveTo = null,
  changeReason = null,
  changeSource = "MANUAL_UI",
  actedByUserId = null,
  requestMeta = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const parsedLocalAccountId = parsePositiveInt(localAccountId);
  if (!parsedTenantId || !parsedGroupId || !parsedLegalEntityId || !parsedLocalAccountId) {
    throw badRequest(
      "tenantId, consolidationGroupId, legalEntityId, and localAccountId are required"
    );
  }

  const localAccountRow = await assertLocalAccountCompatible({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    legalEntityId: parsedLegalEntityId,
    localAccountId: parsedLocalAccountId,
    runQuery,
  });

  const canonicalKeyRow = await resolveCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId,
    canonicalKey,
    canonicalName,
    canonicalType,
    purposeCode,
    status: "ACTIVE",
    runQuery,
  });
  const parsedCanonicalKeyId = parsePositiveInt(canonicalKeyRow.id);
  if (!parsedCanonicalKeyId) {
    throw new Error("canonicalKeyId resolve failed");
  }

  const normalizedStatus = normalizeStatus(status);
  const normalizedEffectiveFrom =
    toDateOnlyString(effectiveFrom, "effectiveFrom") ||
    toDateOnlyString(new Date(), "effectiveFrom");
  const normalizedEffectiveTo = toDateOnlyString(effectiveTo, "effectiveTo");
  if (normalizedEffectiveTo && normalizedEffectiveTo < normalizedEffectiveFrom) {
    throw badRequest("effectiveTo must be >= effectiveFrom");
  }

  const existingLocalMapping = await getExistingLocalCanonicalMappingByScope({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    legalEntityId: parsedLegalEntityId,
    localAccountId: parsedLocalAccountId,
    runQuery,
  });
  if (normalizedStatus === "ACTIVE") {
    await assertNoOverlappingActiveLocalMappingWindow({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      localAccountId: parsedLocalAccountId,
      effectiveFrom: normalizedEffectiveFrom,
      effectiveTo: normalizedEffectiveTo,
      excludeMappingId: parsePositiveInt(existingLocalMapping?.id),
      runQuery,
    });
  }
  const targetGroupMapping = await getGroupMappingForCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId: parsedCanonicalKeyId,
    runQuery,
  });
  const semanticWarnings = targetGroupMapping
    ? buildSemanticWarnings({
        localAccountType: localAccountRow?.account_type,
        localNormalSide: localAccountRow?.normal_side,
        localAccountName: localAccountRow?.account_name,
        groupAccountType: targetGroupMapping?.group_account_type,
        groupNormalSide: targetGroupMapping?.group_normal_side,
        groupAccountName: targetGroupMapping?.group_account_name,
      })
    : [];
  const isRemapChange =
    Boolean(parsePositiveInt(existingLocalMapping?.id)) &&
    parsePositiveInt(existingLocalMapping?.canonical_key_id) !== parsedCanonicalKeyId;
  const normalizedChangeReason = toNullableString(changeReason, 500);
  const normalizedChangeSource =
    normalizeUpperText(changeSource || "MANUAL_UI") || "MANUAL_UI";
  requireHighRiskReasonIfNeeded({
    isRemapChange,
    semanticWarnings,
    changeReason: normalizedChangeReason,
    context: "LOCAL_MAPPING_REMAP",
  });
  if (isRemapChange) {
    emitSemanticRiskOverrideUsageEvent({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      changeSource: normalizedChangeSource,
      changeReason: normalizedChangeReason,
      semanticWarnings,
      actedByUserId,
      overrideContext: "LOCAL_MAPPING_REMAP",
    });
  }

  await runQuery(
    `INSERT INTO consolidation_canonical_local_account_mappings (
        tenant_id,
        consolidation_group_id,
        legal_entity_id,
        local_account_id,
        canonical_key_id,
        status,
        effective_from,
        effective_to
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canonical_key_id = VALUES(canonical_key_id),
       status = VALUES(status),
       effective_from = VALUES(effective_from),
       effective_to = VALUES(effective_to),
       updated_at = CURRENT_TIMESTAMP`,
    [
      parsedTenantId,
      parsedGroupId,
      parsedLegalEntityId,
      parsedLocalAccountId,
      parsedCanonicalKeyId,
      normalizedStatus,
      normalizedEffectiveFrom,
      normalizedEffectiveTo,
    ]
  );

  const result = await runQuery(
    `SELECT
       clm.id,
       clm.tenant_id,
       clm.consolidation_group_id,
       clm.legal_entity_id,
       clm.local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       clm.canonical_key_id,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.purpose_code,
       clm.status,
       clm.effective_from,
       clm.effective_to,
       clm.created_at,
       clm.updated_at
     FROM consolidation_canonical_local_account_mappings clm
     JOIN consolidation_canonical_keys ck ON ck.id = clm.canonical_key_id
     JOIN accounts local_acc ON local_acc.id = clm.local_account_id
     WHERE clm.tenant_id = ?
       AND clm.consolidation_group_id = ?
       AND clm.legal_entity_id = ?
       AND clm.local_account_id = ?
     LIMIT 1`,
    [parsedTenantId, parsedGroupId, parsedLegalEntityId, parsedLocalAccountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw new Error("local canonical mapping upsert readback failed");
  }
  await insertCanonicalMappingAuditLog({
    runQuery,
    tenantId: parsedTenantId,
    userId: parsePositiveInt(actedByUserId) || null,
    action: `consolidation.canonical_mapping.local.${
      parsePositiveInt(existingLocalMapping?.id) ? "update" : "create"
    }`,
    resourceType: "consolidation_canonical_local_mapping",
    resourceId: String(parsePositiveInt(row.id) || ""),
    scopeType: "LEGAL_ENTITY",
    scopeId: parsedLegalEntityId,
    requestId: requestMeta?.requestId || null,
    ipAddress: requestMeta?.ipAddress || null,
    userAgent: requestMeta?.userAgent || null,
    payload: {
      source: normalizedChangeSource,
      reason: normalizedChangeReason,
      isRemapChange,
      semanticWarnings,
      canonicalKey: row.canonical_key || null,
      canonicalKeyId: parsedCanonicalKeyId,
      localAccountId: parsedLocalAccountId,
      groupAccountId: parsePositiveInt(targetGroupMapping?.group_account_id) || null,
    },
  });
  const semanticSummary = summarizeSemanticWarnings(semanticWarnings);

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    localAccountId: parsePositiveInt(row.local_account_id),
    localAccountCode: row.local_account_code || null,
    localAccountName: row.local_account_name || null,
    canonicalKeyId: parsePositiveInt(row.canonical_key_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: row.canonical_type || null,
    purposeCode: row.purpose_code || null,
    status: row.status || null,
    effectiveFrom: row.effective_from || null,
    effectiveTo: row.effective_to || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    semanticWarnings,
    semanticRisk: {
      warningCount: semanticSummary.count,
      highRisk: semanticSummary.highRisk,
      codes: semanticSummary.codes,
    },
    governance: {
      source: normalizedChangeSource,
      reason: normalizedChangeReason,
      isRemapChange,
    },
  };
}

export async function upsertGroupAccountCanonicalMapping({
  tenantId,
  consolidationGroupId,
  groupAccountId,
  canonicalKeyId = null,
  canonicalKey = null,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  effectiveFrom = null,
  effectiveTo = null,
  changeReason = null,
  changeSource = "MANUAL_UI",
  actedByUserId = null,
  requestMeta = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedGroupAccountId = parsePositiveInt(groupAccountId);
  if (!parsedTenantId || !parsedGroupId || !parsedGroupAccountId) {
    throw badRequest("tenantId, consolidationGroupId, and groupAccountId are required");
  }

  const groupAccountRow = await assertGroupAccountCompatible({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    groupAccountId: parsedGroupAccountId,
    runQuery,
  });

  const canonicalKeyRow = await resolveCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId,
    canonicalKey,
    canonicalName,
    canonicalType,
    purposeCode,
    status: "ACTIVE",
    runQuery,
  });
  const parsedCanonicalKeyId = parsePositiveInt(canonicalKeyRow.id);
  if (!parsedCanonicalKeyId) {
    throw new Error("canonicalKeyId resolve failed");
  }

  const normalizedStatus = normalizeStatus(status);
  const normalizedEffectiveFrom =
    toDateOnlyString(effectiveFrom, "effectiveFrom") ||
    toDateOnlyString(new Date(), "effectiveFrom");
  const normalizedEffectiveTo = toDateOnlyString(effectiveTo, "effectiveTo");
  if (normalizedEffectiveTo && normalizedEffectiveTo < normalizedEffectiveFrom) {
    throw badRequest("effectiveTo must be >= effectiveFrom");
  }

  const existingGroupMapping = await getExistingGroupCanonicalMappingByScope({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId: parsedCanonicalKeyId,
    runQuery,
  });
  if (normalizedStatus === "ACTIVE") {
    await assertNoOverlappingActiveGroupMappingWindow({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      canonicalKeyId: parsedCanonicalKeyId,
      effectiveFrom: normalizedEffectiveFrom,
      effectiveTo: normalizedEffectiveTo,
      excludeMappingId: parsePositiveInt(existingGroupMapping?.id),
      runQuery,
    });
  }
  const localMappingsForKey = await listLocalMappingsForCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId: parsedCanonicalKeyId,
    runQuery,
  });
  const semanticAssessments = localMappingsForKey.map((localRow) => {
    const warnings = buildSemanticWarnings({
      localAccountType: localRow?.local_account_type,
      localNormalSide: localRow?.local_normal_side,
      localAccountName: localRow?.local_account_name,
      groupAccountType: groupAccountRow?.account_type,
      groupNormalSide: groupAccountRow?.normal_side,
      groupAccountName: groupAccountRow?.account_name,
    });
    return {
      legalEntityId: parsePositiveInt(localRow?.legal_entity_id),
      localAccountId: parsePositiveInt(localRow?.local_account_id),
      localAccountCode: localRow?.local_account_code || null,
      warnings,
    };
  });
  const flattenedWarnings = semanticAssessments.flatMap((assessment) =>
    (assessment.warnings || []).map((warning) => ({
      ...warning,
      legalEntityId: assessment.legalEntityId,
      localAccountId: assessment.localAccountId,
      localAccountCode: assessment.localAccountCode,
    }))
  );
  const isRemapChange =
    Boolean(parsePositiveInt(existingGroupMapping?.id)) &&
    parsePositiveInt(existingGroupMapping?.group_account_id) !== parsedGroupAccountId;
  const normalizedChangeReason = toNullableString(changeReason, 500);
  const normalizedChangeSource =
    normalizeUpperText(changeSource || "MANUAL_UI") || "MANUAL_UI";
  requireHighRiskReasonIfNeeded({
    isRemapChange,
    semanticWarnings: flattenedWarnings,
    changeReason: normalizedChangeReason,
    context: "GROUP_MAPPING_REMAP",
  });
  if (isRemapChange) {
    emitSemanticRiskOverrideUsageEvent({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: null,
      changeSource: normalizedChangeSource,
      changeReason: normalizedChangeReason,
      semanticWarnings: flattenedWarnings,
      actedByUserId,
      overrideContext: "GROUP_MAPPING_REMAP",
    });
  }

  await runQuery(
    `INSERT INTO consolidation_canonical_group_account_mappings (
        tenant_id,
        consolidation_group_id,
        canonical_key_id,
        group_account_id,
        status,
        effective_from,
        effective_to
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       group_account_id = VALUES(group_account_id),
       status = VALUES(status),
       effective_from = VALUES(effective_from),
       effective_to = VALUES(effective_to),
       updated_at = CURRENT_TIMESTAMP`,
    [
      parsedTenantId,
      parsedGroupId,
      parsedCanonicalKeyId,
      parsedGroupAccountId,
      normalizedStatus,
      normalizedEffectiveFrom,
      normalizedEffectiveTo,
    ]
  );

  const result = await runQuery(
    `SELECT
       cgm.id,
       cgm.tenant_id,
       cgm.consolidation_group_id,
       cgm.canonical_key_id,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.purpose_code,
       cgm.group_account_id,
       group_acc.code AS group_account_code,
       group_acc.name AS group_account_name,
       cgm.status,
       cgm.effective_from,
       cgm.effective_to,
       cgm.created_at,
       cgm.updated_at
     FROM consolidation_canonical_group_account_mappings cgm
     JOIN consolidation_canonical_keys ck ON ck.id = cgm.canonical_key_id
     JOIN accounts group_acc ON group_acc.id = cgm.group_account_id
     WHERE cgm.tenant_id = ?
       AND cgm.consolidation_group_id = ?
       AND cgm.canonical_key_id = ?
     LIMIT 1`,
    [parsedTenantId, parsedGroupId, parsedCanonicalKeyId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw new Error("group canonical mapping upsert readback failed");
  }
  await insertCanonicalMappingAuditLog({
    runQuery,
    tenantId: parsedTenantId,
    userId: parsePositiveInt(actedByUserId) || null,
    action: `consolidation.canonical_mapping.group.${
      parsePositiveInt(existingGroupMapping?.id) ? "update" : "create"
    }`,
    resourceType: "consolidation_canonical_group_mapping",
    resourceId: String(parsePositiveInt(row.id) || ""),
    scopeType: "GROUP",
    scopeId: parsedGroupId,
    requestId: requestMeta?.requestId || null,
    ipAddress: requestMeta?.ipAddress || null,
    userAgent: requestMeta?.userAgent || null,
    payload: {
      source: normalizedChangeSource,
      reason: normalizedChangeReason,
      isRemapChange,
      semanticWarnings: flattenedWarnings,
      canonicalKey: row.canonical_key || null,
      canonicalKeyId: parsedCanonicalKeyId,
      groupAccountId: parsedGroupAccountId,
      impactedLocalMappings: semanticAssessments.length,
    },
  });
  const semanticSummary = summarizeSemanticWarnings(flattenedWarnings);

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    canonicalKeyId: parsePositiveInt(row.canonical_key_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: row.canonical_type || null,
    purposeCode: row.purpose_code || null,
    groupAccountId: parsePositiveInt(row.group_account_id),
    groupAccountCode: row.group_account_code || null,
    groupAccountName: row.group_account_name || null,
    status: row.status || null,
    effectiveFrom: row.effective_from || null,
    effectiveTo: row.effective_to || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    semanticWarnings: flattenedWarnings,
    semanticRisk: {
      warningCount: semanticSummary.count,
      highRisk: semanticSummary.highRisk,
      codes: semanticSummary.codes,
    },
    governance: {
      source: normalizedChangeSource,
      reason: normalizedChangeReason,
      isRemapChange,
    },
  };
}

export async function listCanonicalAccountMappings({
  tenantId,
  consolidationGroupId,
  legalEntityId = null,
  status = "ALL",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const parsedLegalEntityId = parsePositiveInt(legalEntityId) || null;
  const normalizedStatus = normalizeListStatus(status);
  const params = [parsedTenantId, parsedGroupId];
  const where = ["ck.tenant_id = ?", "ck.consolidation_group_id = ?"];

  if (parsedLegalEntityId) {
    where.push("clm.legal_entity_id = ?");
    params.push(parsedLegalEntityId);
  }
  if (normalizedStatus !== "ALL") {
    where.push("(clm.status = ? OR cgm.status = ? OR ck.status = ?)");
    params.push(normalizedStatus, normalizedStatus, normalizedStatus);
  }

  const result = await runQuery(
    `SELECT
       ck.id AS canonical_key_id,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.purpose_code,
       ck.status AS key_status,
       clm.id AS local_mapping_id,
       clm.legal_entity_id,
       clm.local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       clm.status AS local_mapping_status,
       clm.effective_from AS local_effective_from,
       clm.effective_to AS local_effective_to,
       cgm.id AS group_mapping_id,
       cgm.group_account_id,
       group_acc.code AS group_account_code,
       group_acc.name AS group_account_name,
       cgm.status AS group_mapping_status,
       cgm.effective_from AS group_effective_from,
       cgm.effective_to AS group_effective_to
     FROM consolidation_canonical_keys ck
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = ck.tenant_id
      AND clm.consolidation_group_id = ck.consolidation_group_id
      AND clm.canonical_key_id = ck.id
     LEFT JOIN accounts local_acc ON local_acc.id = clm.local_account_id
     LEFT JOIN consolidation_canonical_group_account_mappings cgm
       ON cgm.tenant_id = ck.tenant_id
      AND cgm.consolidation_group_id = ck.consolidation_group_id
      AND cgm.canonical_key_id = ck.id
     LEFT JOIN accounts group_acc ON group_acc.id = cgm.group_account_id
     WHERE ${where.join(" AND ")}
     ORDER BY ck.canonical_key ASC, clm.legal_entity_id ASC, local_acc.code ASC`,
    params
  );

  return (result.rows || []).map(mapCanonicalMappingRow);
}

export async function listCanonicalMappingCandidates({
  tenantId,
  consolidationGroupId,
  legalEntityId = null,
  limit = 500,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const parsedLegalEntityId = parsePositiveInt(legalEntityId) || null;
  const normalizedLimit = normalizeCandidateLimit(limit);

  const params = [parsedTenantId, parsedGroupId];
  const where = [
    "gcm.tenant_id = ?",
    "gcm.consolidation_group_id = ?",
    "gcm.status = 'ACTIVE'",
  ];
  if (parsedLegalEntityId) {
    where.push("gcm.legal_entity_id = ?");
    params.push(parsedLegalEntityId);
  }

  const result = await runQuery(
    `SELECT
       gcm.tenant_id,
       gcm.consolidation_group_id,
       gcm.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       local_acc.id AS local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       local_acc.account_type AS local_account_type,
       local_acc.normal_side AS local_normal_side,
       clm.id AS existing_local_mapping_id,
       clm.canonical_key_id AS existing_local_canonical_key_id,
       clm.status AS existing_local_mapping_status,
       ck_local.canonical_key AS existing_local_canonical_key,
       cgm_local.group_account_id AS existing_group_account_id,
       group_acc_existing.code AS existing_group_account_code,
       group_acc_existing.name AS existing_group_account_name,
       group_acc_existing.account_type AS existing_group_account_type,
       group_acc_existing.normal_side AS existing_group_normal_side,
       cgm_local.status AS existing_group_mapping_status,
       ck_expected.id AS expected_canonical_key_id,
       ck_expected.status AS expected_canonical_key_status,
       cgm_expected.group_account_id AS expected_group_account_id,
       group_acc_expected.code AS expected_group_account_code,
       group_acc_expected.name AS expected_group_account_name,
       group_acc_expected.account_type AS expected_group_account_type,
       group_acc_expected.normal_side AS expected_group_normal_side,
       cgm_expected.status AS expected_group_mapping_status,
       COUNT(DISTINCT group_acc_match.id) AS group_match_count,
       GROUP_CONCAT(
         DISTINCT group_acc_match.id
         ORDER BY group_acc_match.id
         SEPARATOR ','
       ) AS group_match_ids,
       MIN(group_acc_match.name) AS group_match_account_name,
       MIN(group_acc_match.account_type) AS group_match_account_type,
       MIN(group_acc_match.normal_side) AS group_match_normal_side
     FROM group_coa_mappings gcm
     JOIN legal_entities le
       ON le.id = gcm.legal_entity_id
     JOIN accounts local_acc
       ON local_acc.coa_id = gcm.local_coa_id
      AND local_acc.is_active = TRUE
      AND local_acc.allow_posting = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM accounts local_child
        WHERE local_child.parent_account_id = local_acc.id
          AND local_child.is_active = TRUE
      )
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = gcm.tenant_id
      AND clm.consolidation_group_id = gcm.consolidation_group_id
      AND clm.legal_entity_id = gcm.legal_entity_id
      AND clm.local_account_id = local_acc.id
     LEFT JOIN consolidation_canonical_keys ck_local
       ON ck_local.id = clm.canonical_key_id
      AND ck_local.tenant_id = clm.tenant_id
      AND ck_local.consolidation_group_id = clm.consolidation_group_id
     LEFT JOIN consolidation_canonical_group_account_mappings cgm_local
       ON cgm_local.tenant_id = clm.tenant_id
      AND cgm_local.consolidation_group_id = clm.consolidation_group_id
      AND cgm_local.canonical_key_id = clm.canonical_key_id
     LEFT JOIN accounts group_acc_existing
       ON group_acc_existing.id = cgm_local.group_account_id
     LEFT JOIN consolidation_canonical_keys ck_expected
       ON ck_expected.tenant_id = gcm.tenant_id
      AND ck_expected.consolidation_group_id = gcm.consolidation_group_id
      AND ck_expected.canonical_key = CONCAT('ACC_CODE:', UPPER(TRIM(local_acc.code)))
     LEFT JOIN consolidation_canonical_group_account_mappings cgm_expected
       ON cgm_expected.tenant_id = ck_expected.tenant_id
      AND cgm_expected.consolidation_group_id = ck_expected.consolidation_group_id
      AND cgm_expected.canonical_key_id = ck_expected.id
     LEFT JOIN accounts group_acc_expected
       ON group_acc_expected.id = cgm_expected.group_account_id
     LEFT JOIN accounts group_acc_match
       ON group_acc_match.coa_id = gcm.group_coa_id
      AND group_acc_match.code = local_acc.code
      AND group_acc_match.is_active = TRUE
      AND group_acc_match.allow_posting = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM accounts group_child
        WHERE group_child.parent_account_id = group_acc_match.id
          AND group_child.is_active = TRUE
      )
     WHERE ${where.join(" AND ")}
     GROUP BY
       gcm.tenant_id,
       gcm.consolidation_group_id,
       gcm.legal_entity_id,
       le.code,
       le.name,
       local_acc.id,
       local_acc.code,
       local_acc.name,
       local_acc.account_type,
       local_acc.normal_side,
       clm.id,
       clm.canonical_key_id,
       clm.status,
       ck_local.canonical_key,
       cgm_local.group_account_id,
       group_acc_existing.code,
       group_acc_existing.name,
       group_acc_existing.account_type,
       group_acc_existing.normal_side,
       cgm_local.status,
       ck_expected.id,
       ck_expected.status,
       cgm_expected.group_account_id,
       group_acc_expected.code,
       group_acc_expected.name,
       group_acc_expected.account_type,
       group_acc_expected.normal_side,
       cgm_expected.status
     ORDER BY gcm.legal_entity_id ASC, local_acc.code ASC, local_acc.id ASC
     LIMIT ${normalizedLimit}`,
    params
  );

  const rows = (result.rows || []).map(classifyCanonicalCandidate);
  return {
    limit: normalizedLimit,
    legalEntityId: parsedLegalEntityId,
    summary: buildCandidateSummary(rows),
    rows,
  };
}

function mapCanonicalMappingRuleRow(row) {
  return {
    id: parsePositiveInt(row?.id),
    tenantId: parsePositiveInt(row?.tenant_id),
    consolidationGroupId: parsePositiveInt(row?.consolidation_group_id),
    legalEntityId: parsePositiveInt(row?.legal_entity_id),
    legalEntityCode: row?.legal_entity_code || null,
    legalEntityName: row?.legal_entity_name || null,
    ruleType: row?.rule_type || null,
    parentLocalAccountId: parsePositiveInt(row?.parent_local_account_id),
    parentLocalAccountCode: row?.parent_local_account_code || null,
    parentLocalAccountName: row?.parent_local_account_name || null,
    codePrefix: row?.code_prefix || null,
    canonicalKeyId: parsePositiveInt(row?.canonical_key_id),
    canonicalKey: row?.canonical_key || null,
    canonicalName: row?.canonical_name || null,
    canonicalType: row?.canonical_type || null,
    canonicalKeyStatus: row?.canonical_key_status || null,
    groupAccountId: parsePositiveInt(row?.group_account_id),
    groupAccountCode: row?.group_account_code || null,
    groupAccountName: row?.group_account_name || null,
    status: row?.status || null,
    effectiveFrom: row?.effective_from || null,
    effectiveTo: row?.effective_to || null,
    reason: row?.reason || null,
    createdByUserId: parsePositiveInt(row?.created_by_user_id),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

export async function previewCanonicalMappingRule({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  ruleType,
  parentLocalAccountId = null,
  codePrefix = null,
  canonicalKey,
  canonicalName = null,
  groupAccountId = null,
  effectiveFrom = null,
  effectiveTo = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!parsedTenantId || !parsedGroupId || !parsedLegalEntityId) {
    throw badRequest(
      "tenantId, consolidationGroupId, and legalEntityId are required"
    );
  }

  const normalizedRuleType = normalizeBulkRuleType(ruleType);
  const normalizedCanonicalKey = normalizeUpperText(canonicalKey);
  if (!normalizedCanonicalKey) {
    throw badRequest("canonicalKey is required");
  }

  const normalizedCanonicalName =
    toNullableString(canonicalName, 255) || normalizedCanonicalKey;
  const normalizedEffectiveFrom = toDateOnlyString(
    effectiveFrom,
    "effectiveFrom"
  );
  const normalizedEffectiveTo = toDateOnlyString(effectiveTo, "effectiveTo");
  if (
    normalizedEffectiveFrom &&
    normalizedEffectiveTo &&
    normalizedEffectiveTo < normalizedEffectiveFrom
  ) {
    throw badRequest("effectiveTo must be >= effectiveFrom");
  }

  const parsedGroupAccountId = parsePositiveInt(groupAccountId) || null;
  const selectedGroupAccountRow = parsedGroupAccountId
    ? mapRuleSelectedGroupAccountRow(
        await assertGroupAccountCompatible({
          tenantId: parsedTenantId,
          consolidationGroupId: parsedGroupId,
          groupAccountId: parsedGroupAccountId,
          runQuery,
        })
      )
    : null;

  let resolvedRows = [];
  let context = {
    selectedRootAccount: null,
    codePrefix:
      normalizedRuleType === "CODE_PREFIX" ? normalizeCodePrefix(codePrefix) : null,
    descendantAccountCount: 0,
    descendantLeafCount: 0,
  };

  if (normalizedRuleType === "DESCENDANTS_OF_ACCOUNT") {
    const parsedParentLocalAccountId = parsePositiveInt(parentLocalAccountId);
    if (!parsedParentLocalAccountId) {
      throw badRequest(
        "parentLocalAccountId is required for DESCENDANTS_OF_ACCOUNT ruleType"
      );
    }

    const rootAccountRow = await assertLocalRuleRootAccountCompatible({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      localAccountId: parsedParentLocalAccountId,
      runQuery,
    });
    const rootAccount = mapRuleRootAccountRow(rootAccountRow);
    const allActiveAccounts = await listActiveAccountsForCoa({
      tenantId: parsedTenantId,
      coaId: rootAccount.coaId,
      runQuery,
    });
    const descendantSelection = resolveDescendantAccountSelection(
      allActiveAccounts,
      rootAccount.accountId
    );
    const leafRowsInCoa = await listBulkRulePreviewLocalLeafRows({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      localCoaId: rootAccount.coaId,
      runQuery,
    });
    const allowedLeafIds = new Set(descendantSelection.leafAccountIds);
    resolvedRows = leafRowsInCoa.filter((row) =>
      allowedLeafIds.has(parsePositiveInt(row?.local_account_id))
    );
    context = {
      selectedRootAccount: rootAccount,
      codePrefix: null,
      descendantAccountCount: descendantSelection.descendantCount,
      descendantLeafCount: descendantSelection.leafCount,
    };
  } else {
    resolvedRows = await listBulkRulePreviewLocalLeafRows({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      codePrefix,
      runQuery,
    });
  }

  const requestedCanonicalKeyRow = await getCanonicalKeyByCode({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKey: normalizedCanonicalKey,
    runQuery,
  });
  const requestedGroupMapping = parsePositiveInt(requestedCanonicalKeyRow?.id)
    ? await getGroupMappingForCanonicalKey({
        tenantId: parsedTenantId,
        consolidationGroupId: parsedGroupId,
        canonicalKeyId: requestedCanonicalKeyRow.id,
        runQuery,
      })
    : null;

  const rows = resolvedRows.map((row) =>
    classifyBulkRulePreviewRow({
      row,
      requestedCanonicalKey: normalizedCanonicalKey,
      requestedCanonicalKeyRow,
      selectedGroupAccountRow,
    })
  );
  const summary = buildBulkRulePreviewSummary(rows);

  return {
    rule: {
      ruleType: normalizedRuleType,
      legalEntityId: parsedLegalEntityId,
      parentLocalAccountId:
        normalizedRuleType === "DESCENDANTS_OF_ACCOUNT"
          ? parsePositiveInt(parentLocalAccountId)
          : null,
      codePrefix: context.codePrefix,
      canonicalKey: normalizedCanonicalKey,
      canonicalName: normalizedCanonicalName,
      groupAccountId: parsedGroupAccountId,
      effectiveFrom: normalizedEffectiveFrom,
      effectiveTo: normalizedEffectiveTo,
    },
    context,
    groupMappingPreview: buildBulkRuleGroupMappingPreview({
      requestedCanonicalKey: normalizedCanonicalKey,
      requestedCanonicalName: normalizedCanonicalName,
      requestedCanonicalKeyRow,
      existingGroupMapping: requestedGroupMapping,
      selectedGroupAccountRow,
    }),
    summary,
    buckets: buildBulkRulePreviewBuckets(rows),
    rows,
  };
}

export async function applyCanonicalMappingRule({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  ruleType,
  parentLocalAccountId = null,
  codePrefix = null,
  canonicalKey,
  canonicalName = null,
  groupAccountId = null,
  effectiveFrom = null,
  effectiveTo = null,
  changeReason = null,
  changeSource = "BULK_RULE_APPLY",
  actedByUserId = null,
  requestMeta = null,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!parsedTenantId || !parsedGroupId || !parsedLegalEntityId) {
    throw badRequest(
      "tenantId, consolidationGroupId, and legalEntityId are required"
    );
  }

  const normalizedEffectiveFrom =
    toDateOnlyString(effectiveFrom, "effectiveFrom") ||
    toDateOnlyString(new Date(), "effectiveFrom");
  const normalizedEffectiveTo = toDateOnlyString(effectiveTo, "effectiveTo");
  if (
    normalizedEffectiveTo &&
    normalizedEffectiveTo < normalizedEffectiveFrom
  ) {
    throw badRequest("effectiveTo must be >= effectiveFrom");
  }

  const normalizedChangeReason = toNullableString(changeReason, 500);
  const normalizedChangeSource =
    normalizeUpperText(changeSource || "BULK_RULE_APPLY") || "BULK_RULE_APPLY";

  const buildConflictError = (preview) => {
    const localConflicts = Array.isArray(preview?.buckets?.conflicts)
      ? preview.buckets.conflicts
      : [];
    const groupConflict =
      preview?.groupMappingPreview?.blocking === true
        ? preview.groupMappingPreview
        : null;
    const conflictCount = localConflicts.length + (groupConflict ? 1 : 0);
    const err = badRequest(
      "Bulk canonical rule apply blocked by conflicts. Resolve preview conflicts before apply."
    );
    err.details = {
      code: "BULK_RULE_APPLY_CONFLICTS",
      conflictCount,
      groupMappingConflict: groupConflict,
      localConflicts: localConflicts.slice(0, 50).map((row) => ({
        legalEntityId: row.legalEntityId,
        localAccountId: row.localAccountId,
        localAccountCode: row.localAccountCode,
        currentMapping: row.currentMapping,
        requestedTarget: row.requestedTarget,
        reason: row.reason || null,
      })),
    };
    return err;
  };

  const buildHighRiskError = (rows = []) => {
    const err = badRequest(
      "High-risk bulk rule mappings require reason. Provide reason in payload.reason before apply."
    );
    err.details = {
      code: "HIGH_RISK_BULK_RULE_APPLY_REASON_REQUIRED",
      highRiskRowCount: rows.length,
      sample: rows.slice(0, 20).map((row) => ({
        legalEntityId: row.legalEntityId,
        localAccountId: row.localAccountId,
        localAccountCode: row.localAccountCode,
        semanticRiskCodes: row?.semanticRisk?.codes || [],
      })),
    };
    return err;
  };

  const previewRequest = {
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    legalEntityId: parsedLegalEntityId,
    ruleType,
    parentLocalAccountId,
    codePrefix,
    canonicalKey,
    canonicalName,
    groupAccountId,
    effectiveFrom: normalizedEffectiveFrom,
    effectiveTo: normalizedEffectiveTo,
  };

  const initialPreview = await previewCanonicalMappingRule(previewRequest);
  if (
    Number(initialPreview?.summary?.total || 0) <= 0 &&
    Number(initialPreview?.summary?.alreadyAlignedCount || 0) <= 0
  ) {
    await insertCanonicalMappingAuditLog({
      tenantId: parsedTenantId,
      userId: parsePositiveInt(actedByUserId) || null,
      action: "consolidation.canonical_mapping.rules.apply",
      resourceType: "consolidation_canonical_rule_apply",
      resourceId: `${parsedGroupId}:${parsedLegalEntityId}:${initialPreview?.rule?.ruleType || "RULE"}`,
      scopeType: "GROUP",
      scopeId: parsedGroupId,
      requestId: requestMeta?.requestId || null,
      ipAddress: requestMeta?.ipAddress || null,
      userAgent: requestMeta?.userAgent || null,
      payload: {
        source: normalizedChangeSource,
        reason: normalizedChangeReason,
        rule: initialPreview?.rule || null,
        appliedLocalMappings: 0,
        createdLocalMappings: 0,
        updatedLocalMappings: 0,
        skippedAlreadyAligned: 0,
        conflictCount: 0,
        groupMappingAction: {
          status: "SKIPPED_NO_MATCHES",
        },
      },
    });
    return {
      rule: initialPreview.rule,
      summary: initialPreview.summary,
      createdLocalMappings: 0,
      updatedLocalMappings: 0,
      appliedLocalMappings: 0,
      skippedAlreadyAligned: 0,
      conflictCount: 0,
      highRiskApplyCount: 0,
      groupMappingAction: {
        status: "SKIPPED_NO_MATCHES",
      },
      appliedSample: [],
    };
  }

  if (
    (initialPreview?.buckets?.conflicts || []).length > 0 ||
    initialPreview?.groupMappingPreview?.blocking === true
  ) {
    throw buildConflictError(initialPreview);
  }

  const initialMatchedRows = Array.isArray(initialPreview?.buckets?.matched)
    ? initialPreview.buckets.matched
    : [];
  const initialHighRiskRows = initialMatchedRows.filter(
    (row) => row?.semanticRisk?.highRisk === true
  );
  if (initialHighRiskRows.length > 0 && !normalizedChangeReason) {
    throw buildHighRiskError(initialHighRiskRows);
  }
  if (initialHighRiskRows.length > 0) {
    const highRiskWarnings = initialHighRiskRows.flatMap((row) => {
      const rowWarnings = Array.isArray(row?.semanticWarnings) ? row.semanticWarnings : [];
      return rowWarnings.map((warning) => ({
        ...warning,
        legalEntityId: parsePositiveInt(row?.legalEntityId) || null,
        localAccountId: parsePositiveInt(row?.localAccountId) || null,
        localAccountCode: row?.localAccountCode || null,
      }));
    });
    emitSemanticRiskOverrideUsageEvent({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      changeSource: normalizedChangeSource,
      changeReason: normalizedChangeReason,
      semanticWarnings:
        highRiskWarnings.length > 0
          ? highRiskWarnings
          : [{ code: "HIGH_RISK_BULK_RULE_ROW", severity: "HIGH" }],
      actedByUserId,
      overrideContext: "BULK_RULE_APPLY",
      highRiskCandidateCount: initialHighRiskRows.length,
    });
  }

  const metrics = {
    createdLocalMappings: 0,
    updatedLocalMappings: 0,
    appliedLocalMappings: 0,
    skippedAlreadyAligned: Number(
      initialPreview?.summary?.alreadyAlignedCount || 0
    ),
    conflictCount: 0,
    highRiskApplyCount: initialHighRiskRows.length,
  };
  let finalPreview = initialPreview;
  let groupMappingAction = {
    status: "NOT_REQUESTED",
  };
  const appliedSample = [];

  await withTransaction(async (tx) => {
    finalPreview = await previewCanonicalMappingRule({
      ...previewRequest,
      runQuery: tx.query,
    });

    if (
      (finalPreview?.buckets?.conflicts || []).length > 0 ||
      finalPreview?.groupMappingPreview?.blocking === true
    ) {
      throw buildConflictError(finalPreview);
    }

    const matchedRows = Array.isArray(finalPreview?.buckets?.matched)
      ? finalPreview.buckets.matched
      : [];
    const highRiskRows = matchedRows.filter(
      (row) => row?.semanticRisk?.highRisk === true
    );
    if (highRiskRows.length > 0 && !normalizedChangeReason) {
      throw buildHighRiskError(highRiskRows);
    }

    const previewGroupAction = finalPreview?.groupMappingPreview || null;
    if (parsePositiveInt(finalPreview?.rule?.groupAccountId)) {
      if (
        previewGroupAction?.status === "READY_FOR_GROUP_MAPPING" ||
        previewGroupAction?.status === "INACTIVE_GROUP_MAPPING"
      ) {
        const existingGroupMappingId = parsePositiveInt(
          previewGroupAction?.currentGroupMapping?.groupMappingId
        );
        const groupResult = await upsertGroupAccountCanonicalMapping({
          tenantId: parsedTenantId,
          consolidationGroupId: parsedGroupId,
          groupAccountId: finalPreview.rule.groupAccountId,
          canonicalKey: finalPreview.rule.canonicalKey,
          canonicalName: finalPreview.rule.canonicalName,
          canonicalType: "ACCOUNT",
          status: "ACTIVE",
          effectiveFrom: normalizedEffectiveFrom,
          effectiveTo: normalizedEffectiveTo,
          changeReason: normalizedChangeReason,
          changeSource: normalizedChangeSource,
          actedByUserId,
          requestMeta,
          runQuery: tx.query,
        });
        groupMappingAction = {
          status: existingGroupMappingId ? "UPDATED_EXISTING" : "CREATED",
          groupMappingId: parsePositiveInt(groupResult?.id),
          groupAccountId: parsePositiveInt(groupResult?.groupAccountId),
          groupAccountCode: groupResult?.groupAccountCode || null,
          groupAccountName: groupResult?.groupAccountName || null,
        };
      } else if (previewGroupAction?.status === "ALREADY_ALIGNED") {
        groupMappingAction = {
          status: "SKIPPED_ALREADY_ALIGNED",
          groupMappingId: parsePositiveInt(
            previewGroupAction?.currentGroupMapping?.groupMappingId
          ),
          groupAccountId: parsePositiveInt(
            previewGroupAction?.currentGroupMapping?.groupAccountId
          ),
          groupAccountCode:
            previewGroupAction?.currentGroupMapping?.groupAccountCode || null,
          groupAccountName:
            previewGroupAction?.currentGroupMapping?.groupAccountName || null,
        };
      } else {
        groupMappingAction = {
          status: previewGroupAction?.status || "NOT_REQUESTED",
        };
      }
    }

    for (const row of matchedRows) {
      const localResult = await upsertLocalAccountCanonicalMapping({
        tenantId: parsedTenantId,
        consolidationGroupId: parsedGroupId,
        legalEntityId: parsedLegalEntityId,
        localAccountId: row.localAccountId,
        canonicalKey: finalPreview.rule.canonicalKey,
        canonicalName: finalPreview.rule.canonicalName,
        canonicalType: "ACCOUNT",
        status: "ACTIVE",
        effectiveFrom: normalizedEffectiveFrom,
        effectiveTo: normalizedEffectiveTo,
        changeReason: normalizedChangeReason,
        changeSource: normalizedChangeSource,
        actedByUserId,
        requestMeta,
        runQuery: tx.query,
      });

      if (parsePositiveInt(row?.currentMapping?.localMappingId)) {
        metrics.updatedLocalMappings += 1;
      } else {
        metrics.createdLocalMappings += 1;
      }
      metrics.appliedLocalMappings += 1;
      if (appliedSample.length < 20) {
        appliedSample.push({
          legalEntityId: parsedLegalEntityId,
          localAccountId: row.localAccountId,
          localAccountCode: row.localAccountCode,
          localAccountName: row.localAccountName,
          canonicalKey: localResult?.canonicalKey || finalPreview.rule.canonicalKey,
        });
      }
    }
  });

  await insertCanonicalMappingAuditLog({
    tenantId: parsedTenantId,
    userId: parsePositiveInt(actedByUserId) || null,
    action: "consolidation.canonical_mapping.rules.apply",
    resourceType: "consolidation_canonical_rule_apply",
    resourceId: `${parsedGroupId}:${parsedLegalEntityId}:${finalPreview?.rule?.ruleType || "RULE"}`,
    scopeType: "GROUP",
    scopeId: parsedGroupId,
    requestId: requestMeta?.requestId || null,
    ipAddress: requestMeta?.ipAddress || null,
    userAgent: requestMeta?.userAgent || null,
    payload: {
      source: normalizedChangeSource,
      reason: normalizedChangeReason,
      rule: finalPreview?.rule || null,
      appliedLocalMappings: metrics.appliedLocalMappings,
      createdLocalMappings: metrics.createdLocalMappings,
      updatedLocalMappings: metrics.updatedLocalMappings,
      skippedAlreadyAligned: metrics.skippedAlreadyAligned,
      conflictCount: metrics.conflictCount,
      highRiskApplyCount: metrics.highRiskApplyCount,
      groupMappingAction,
    },
  });

  return {
    rule: finalPreview.rule,
    summary: finalPreview.summary,
    createdLocalMappings: metrics.createdLocalMappings,
    updatedLocalMappings: metrics.updatedLocalMappings,
    appliedLocalMappings: metrics.appliedLocalMappings,
    skippedAlreadyAligned: metrics.skippedAlreadyAligned,
    conflictCount: metrics.conflictCount,
    highRiskApplyCount: metrics.highRiskApplyCount,
    groupMappingAction,
    appliedSample,
  };
}

export async function getCanonicalMappingRuleById({
  tenantId,
  consolidationGroupId,
  ruleId,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedRuleId = parsePositiveInt(ruleId);
  if (!parsedTenantId || !parsedGroupId || !parsedRuleId) {
    throw badRequest("tenantId, consolidationGroupId, and ruleId are required");
  }

  const result = await runQuery(
    `SELECT
       rule.*,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       parent_acc.code AS parent_local_account_code,
       parent_acc.name AS parent_local_account_name,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.status AS canonical_key_status,
       group_acc.code AS group_account_code,
       group_acc.name AS group_account_name
     FROM consolidation_canonical_mapping_rules rule
     JOIN legal_entities le
       ON le.id = rule.legal_entity_id
     JOIN consolidation_canonical_keys ck
       ON ck.id = rule.canonical_key_id
      AND ck.tenant_id = rule.tenant_id
      AND ck.consolidation_group_id = rule.consolidation_group_id
     LEFT JOIN accounts parent_acc
       ON parent_acc.id = rule.parent_local_account_id
     LEFT JOIN accounts group_acc
       ON group_acc.id = rule.group_account_id
     WHERE rule.tenant_id = ?
       AND rule.consolidation_group_id = ?
       AND rule.id = ?
     LIMIT 1`,
    [parsedTenantId, parsedGroupId, parsedRuleId]
  );
  const row = result.rows?.[0] || null;
  return row ? mapCanonicalMappingRuleRow(row) : null;
}

export async function listCanonicalMappingRules({
  tenantId,
  consolidationGroupId,
  legalEntityId = null,
  status = "ALL",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const parsedLegalEntityId = parsePositiveInt(legalEntityId) || null;
  const normalizedStatus = normalizeListStatus(status);
  const params = [parsedTenantId, parsedGroupId];
  const where = ["rule.tenant_id = ?", "rule.consolidation_group_id = ?"];
  if (parsedLegalEntityId) {
    where.push("rule.legal_entity_id = ?");
    params.push(parsedLegalEntityId);
  }
  if (normalizedStatus !== "ALL") {
    where.push("rule.status = ?");
    params.push(normalizedStatus);
  }

  const result = await runQuery(
    `SELECT
       rule.*,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       parent_acc.code AS parent_local_account_code,
       parent_acc.name AS parent_local_account_name,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.status AS canonical_key_status,
       group_acc.code AS group_account_code,
       group_acc.name AS group_account_name
     FROM consolidation_canonical_mapping_rules rule
     JOIN legal_entities le
       ON le.id = rule.legal_entity_id
     JOIN consolidation_canonical_keys ck
       ON ck.id = rule.canonical_key_id
      AND ck.tenant_id = rule.tenant_id
      AND ck.consolidation_group_id = rule.consolidation_group_id
     LEFT JOIN accounts parent_acc
       ON parent_acc.id = rule.parent_local_account_id
     LEFT JOIN accounts group_acc
       ON group_acc.id = rule.group_account_id
     WHERE ${where.join(" AND ")}
     ORDER BY rule.updated_at DESC, rule.id DESC`,
    params
  );

  const rows = (result.rows || []).map(mapCanonicalMappingRuleRow);
  const summary = {
    total: rows.length,
    activeCount: rows.filter((row) => normalizeUpperText(row?.status) === "ACTIVE").length,
    inactiveCount: rows.filter((row) => normalizeUpperText(row?.status) === "INACTIVE").length,
  };
  return {
    summary,
    rows,
  };
}

export async function createCanonicalMappingRule({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  ruleType,
  parentLocalAccountId = null,
  codePrefix = null,
  canonicalKeyId = null,
  canonicalKey = null,
  canonicalName = null,
  groupAccountId = null,
  status = "ACTIVE",
  effectiveFrom = null,
  effectiveTo = null,
  reason = null,
  actedByUserId = null,
  requestMeta = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!parsedTenantId || !parsedGroupId || !parsedLegalEntityId) {
    throw badRequest(
      "tenantId, consolidationGroupId, and legalEntityId are required"
    );
  }

  const normalizedRuleType = normalizeBulkRuleType(ruleType);
  let normalizedParentLocalAccountId = null;
  let normalizedCodePrefix = null;
  if (normalizedRuleType === "DESCENDANTS_OF_ACCOUNT") {
    normalizedParentLocalAccountId = parsePositiveInt(parentLocalAccountId);
    if (!normalizedParentLocalAccountId) {
      throw badRequest(
        "parentLocalAccountId is required for DESCENDANTS_OF_ACCOUNT ruleType"
      );
    }
    await assertLocalRuleRootAccountCompatible({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      localAccountId: normalizedParentLocalAccountId,
      runQuery,
    });
  } else {
    normalizedCodePrefix = normalizeCodePrefix(codePrefix);
  }

  const parsedGroupAccountId = parsePositiveInt(groupAccountId) || null;
  if (parsedGroupAccountId) {
    await assertGroupAccountCompatible({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      groupAccountId: parsedGroupAccountId,
      runQuery,
    });
  }

  const canonicalKeyRow = await resolveCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId,
    canonicalKey,
    canonicalName,
    canonicalType: "ACCOUNT",
    status: "ACTIVE",
    runQuery,
  });
  const normalizedStatus = normalizeStatus(status);
  const normalizedEffectiveFrom =
    toDateOnlyString(effectiveFrom, "effectiveFrom") ||
    toDateOnlyString(new Date(), "effectiveFrom");
  const normalizedEffectiveTo = toDateOnlyString(effectiveTo, "effectiveTo");
  if (normalizedEffectiveTo && normalizedEffectiveTo < normalizedEffectiveFrom) {
    throw badRequest("effectiveTo must be >= effectiveFrom");
  }
  const normalizedReason = toNullableString(reason, 500);

  await runQuery(
    `INSERT INTO consolidation_canonical_mapping_rules (
        tenant_id,
        consolidation_group_id,
        legal_entity_id,
        rule_type,
        parent_local_account_id,
        code_prefix,
        canonical_key_id,
        group_account_id,
        status,
        effective_from,
        effective_to,
        reason,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsedTenantId,
      parsedGroupId,
      parsedLegalEntityId,
      normalizedRuleType,
      normalizedParentLocalAccountId,
      normalizedCodePrefix,
      parsePositiveInt(canonicalKeyRow?.id),
      parsedGroupAccountId,
      normalizedStatus,
      normalizedEffectiveFrom,
      normalizedEffectiveTo,
      normalizedReason,
      parsePositiveInt(actedByUserId) || null,
    ]
  );

  const createdIdResult = await runQuery("SELECT LAST_INSERT_ID() AS id");
  const createdRuleId = parsePositiveInt(createdIdResult.rows?.[0]?.id);
  const row = await getCanonicalMappingRuleById({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    ruleId: createdRuleId,
    runQuery,
  });
  if (!row) {
    throw new Error("Saved canonical mapping rule readback failed");
  }

  await insertCanonicalMappingAuditLog({
    runQuery,
    tenantId: parsedTenantId,
    userId: parsePositiveInt(actedByUserId) || null,
    action: "consolidation.canonical_mapping.rule.create",
    resourceType: "consolidation_canonical_mapping_rule",
    resourceId: String(createdRuleId || ""),
    scopeType: "GROUP",
    scopeId: parsedGroupId,
    requestId: requestMeta?.requestId || null,
    ipAddress: requestMeta?.ipAddress || null,
    userAgent: requestMeta?.userAgent || null,
    payload: {
      legalEntityId: parsedLegalEntityId,
      ruleType: normalizedRuleType,
      parentLocalAccountId: normalizedParentLocalAccountId,
      codePrefix: normalizedCodePrefix,
      canonicalKey: row.canonicalKey,
      canonicalName: row.canonicalName,
      groupAccountId: parsedGroupAccountId,
      reason: normalizedReason,
      status: normalizedStatus,
      effectiveFrom: normalizedEffectiveFrom,
      effectiveTo: normalizedEffectiveTo,
    },
  });

  return row;
}

export async function deactivateCanonicalMappingRule({
  tenantId,
  consolidationGroupId,
  ruleId,
  reason = null,
  actedByUserId = null,
  requestMeta = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedRuleId = parsePositiveInt(ruleId);
  if (!parsedTenantId || !parsedGroupId || !parsedRuleId) {
    throw badRequest("tenantId, consolidationGroupId, and ruleId are required");
  }

  const existing = await getCanonicalMappingRuleById({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    ruleId: parsedRuleId,
    runQuery,
  });
  if (!existing) {
    throw badRequest("ruleId not found in consolidation group");
  }

  if (normalizeUpperText(existing.status) !== "INACTIVE") {
    await runQuery(
      `UPDATE consolidation_canonical_mapping_rules
       SET status = 'INACTIVE',
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND consolidation_group_id = ?
         AND id = ?`,
      [parsedTenantId, parsedGroupId, parsedRuleId]
    );
  }

  const row = await getCanonicalMappingRuleById({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    ruleId: parsedRuleId,
    runQuery,
  });

  await insertCanonicalMappingAuditLog({
    runQuery,
    tenantId: parsedTenantId,
    userId: parsePositiveInt(actedByUserId) || null,
    action: "consolidation.canonical_mapping.rule.deactivate",
    resourceType: "consolidation_canonical_mapping_rule",
    resourceId: String(parsedRuleId),
    scopeType: "GROUP",
    scopeId: parsedGroupId,
    requestId: requestMeta?.requestId || null,
    ipAddress: requestMeta?.ipAddress || null,
    userAgent: requestMeta?.userAgent || null,
    payload: {
      legalEntityId: row?.legalEntityId || null,
      ruleType: row?.ruleType || null,
      canonicalKey: row?.canonicalKey || null,
      reason: toNullableString(reason, 500),
      previousStatus: existing.status || null,
      currentStatus: row?.status || null,
    },
  });

  return row;
}

export async function previewCanonicalMappingRuleById({
  tenantId,
  consolidationGroupId,
  ruleId,
  runQuery = query,
}) {
  const row = await getCanonicalMappingRuleById({
    tenantId,
    consolidationGroupId,
    ruleId,
    runQuery,
  });
  if (!row) {
    throw badRequest("ruleId not found in consolidation group");
  }

  const preview = await previewCanonicalMappingRule({
    tenantId,
    consolidationGroupId,
    legalEntityId: row.legalEntityId,
    ruleType: row.ruleType,
    parentLocalAccountId: row.parentLocalAccountId,
    codePrefix: row.codePrefix,
    canonicalKey: row.canonicalKey,
    canonicalName: row.canonicalName,
    groupAccountId: row.groupAccountId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    runQuery,
  });

  return {
    savedRule: row,
    ...preview,
  };
}

export async function applyCanonicalMappingRuleById({
  tenantId,
  consolidationGroupId,
  ruleId,
  changeReason = null,
  changeSource = "SAVED_RULE_APPLY",
  actedByUserId = null,
  requestMeta = null,
}) {
  const row = await getCanonicalMappingRuleById({
    tenantId,
    consolidationGroupId,
    ruleId,
  });
  if (!row) {
    throw badRequest("ruleId not found in consolidation group");
  }
  if (normalizeUpperText(row.status) !== "ACTIVE") {
    throw badRequest("Saved canonical rule must be ACTIVE before apply");
  }

  const result = await applyCanonicalMappingRule({
    tenantId,
    consolidationGroupId,
    legalEntityId: row.legalEntityId,
    ruleType: row.ruleType,
    parentLocalAccountId: row.parentLocalAccountId,
    codePrefix: row.codePrefix,
    canonicalKey: row.canonicalKey,
    canonicalName: row.canonicalName,
    groupAccountId: row.groupAccountId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    changeReason: toNullableString(changeReason, 500) || row.reason || null,
    changeSource,
    actedByUserId,
    requestMeta,
  });

  return {
    savedRule: row,
    ...result,
  };
}

function buildCanonicalReadinessBucket(seed = null) {
  return {
    legalEntityId: parsePositiveInt(seed?.legalEntityId) || null,
    legalEntityCode: seed?.legalEntityCode || null,
    legalEntityName: seed?.legalEntityName || null,
    total: 0,
    safeCount: 0,
    alreadyMappedCount: 0,
    partialMappingCount: 0,
    missingGroupMatchCount: 0,
    ambiguousGroupMatchCount: 0,
    unresolvedCount: 0,
    semanticWarningCount: 0,
    semanticHighRiskCount: 0,
    ready: false,
    readinessState: "UNASSESSED",
  };
}

function mergeCandidateIntoReadinessBucket(bucket, row) {
  const target = bucket || buildCanonicalReadinessBucket(row);
  target.total += 1;
  const classification = String(row?.classification || "").toUpperCase();
  if (classification === "SAFE") {
    target.safeCount += 1;
  } else if (classification === "ALREADY_MAPPED") {
    target.alreadyMappedCount += 1;
  } else if (classification === "PARTIAL_MAPPING") {
    target.partialMappingCount += 1;
    target.unresolvedCount += 1;
  } else if (classification === "MISSING_GROUP_MATCH") {
    target.missingGroupMatchCount += 1;
    target.unresolvedCount += 1;
  } else if (classification === "AMBIGUOUS_GROUP_MATCH") {
    target.ambiguousGroupMatchCount += 1;
    target.unresolvedCount += 1;
  }

  if (Number(row?.semanticRisk?.warningCount || 0) > 0) {
    target.semanticWarningCount += 1;
    if (row?.semanticRisk?.highRisk === true) {
      target.semanticHighRiskCount += 1;
    }
  }
  return target;
}

function finalizeReadinessBucket(bucket) {
  const target = bucket || buildCanonicalReadinessBucket();
  const hasCoverage = Number(target.total || 0) > 0;
  target.ready = hasCoverage && Number(target.unresolvedCount || 0) <= 0;
  target.readinessState = !hasCoverage
    ? "NO_ACTIVE_COA_SCOPE"
    : target.ready
      ? "READY"
      : "UNRESOLVED_CANDIDATE_MAPPINGS";
  return target;
}

function buildCanonicalReadinessUnresolvedSample(rows = [], sampleSize = 25) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const classification = String(row?.classification || "").toUpperCase();
      return classification !== "SAFE" && classification !== "ALREADY_MAPPED";
    })
    .slice(0, sampleSize)
    .map((row) => ({
      legalEntityId: parsePositiveInt(row?.legalEntityId),
      legalEntityCode: row?.legalEntityCode || null,
      localAccountId: parsePositiveInt(row?.localAccountId),
      localAccountCode: row?.localAccountCode || null,
      expectedCanonicalKey: row?.expectedCanonicalKey || null,
      classification: String(row?.classification || "UNKNOWN").toUpperCase(),
      reason: row?.reason || null,
      semanticRisk: {
        warningCount: Number(row?.semanticRisk?.warningCount || 0),
        highRisk: row?.semanticRisk?.highRisk === true,
        codes: Array.isArray(row?.semanticRisk?.codes) ? row.semanticRisk.codes : [],
      },
    }));
}

export async function getCanonicalMappingReadiness({
  tenantId,
  consolidationGroupId,
  limit = MAX_CANDIDATE_LIMIT,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const normalizedLimit = normalizeCandidateLimit(limit, MAX_CANDIDATE_LIMIT);
  const preview = await listCanonicalMappingCandidates({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    legalEntityId: null,
    limit: normalizedLimit,
    runQuery,
  });

  const byLegalEntity = new Map();
  for (const row of preview.rows || []) {
    const legalEntityId = parsePositiveInt(row?.legalEntityId) || 0;
    const existing = byLegalEntity.get(legalEntityId) || buildCanonicalReadinessBucket(row);
    byLegalEntity.set(
      legalEntityId,
      mergeCandidateIntoReadinessBucket(existing, row)
    );
  }

  const byLegalEntityRows = [...byLegalEntity.values()]
    .map(finalizeReadinessBucket)
    .sort((left, right) => {
      const unresolvedDelta =
        Number(right?.unresolvedCount || 0) - Number(left?.unresolvedCount || 0);
      if (unresolvedDelta !== 0) {
        return unresolvedDelta;
      }
      return Number(left?.legalEntityId || 0) - Number(right?.legalEntityId || 0);
    });

  const summary = preview.summary || buildCandidateSummary([]);
  const coverageDetected = Number(summary.total || 0) > 0;
  const ready = coverageDetected && Number(summary.unresolvedCount || 0) <= 0;
  const blockedReason = !coverageDetected
    ? "NO_ACTIVE_COA_SCOPE"
    : ready
      ? null
      : "UNRESOLVED_CANDIDATE_MAPPINGS";

  return {
    limit: normalizedLimit,
    ready,
    coverageDetected,
    readinessState: blockedReason || "READY",
    blockedReason,
    summary,
    byLegalEntity: byLegalEntityRows,
    unresolvedSample: buildCanonicalReadinessUnresolvedSample(preview.rows || []),
  };
}

export async function getCanonicalMappingGovernanceReview({
  tenantId,
  consolidationGroupId,
  fromDate = null,
  toDate = null,
  limit = DEFAULT_GOVERNANCE_REVIEW_LIMIT,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const normalizedLimit = normalizeGovernanceReviewLimit(limit);
  const reviewWindow = resolveGovernanceReviewWindow({
    fromDate,
    toDate,
  });
  const auditWindowStart = `${reviewWindow.fromDate} 00:00:00`;
  const auditWindowEndExclusive = `${addDaysToDateOnly(reviewWindow.toDate, 1)} 00:00:00`;

  const memberResult = await runQuery(
    `SELECT DISTINCT
       cgm.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name
     FROM consolidation_group_members cgm
     JOIN legal_entities le ON le.id = cgm.legal_entity_id
     WHERE cgm.consolidation_group_id = ?
       AND cgm.effective_from <= ?
       AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
     ORDER BY cgm.legal_entity_id ASC`,
    [parsedGroupId, reviewWindow.toDate, reviewWindow.fromDate]
  );
  const legalEntities = (memberResult.rows || []).map((row) => ({
    legalEntityId: parsePositiveInt(row?.legal_entity_id),
    legalEntityCode: row?.legal_entity_code || null,
    legalEntityName: row?.legal_entity_name || null,
  }));
  const memberLegalEntityIds = legalEntities
    .map((row) => parsePositiveInt(row?.legalEntityId))
    .filter(Boolean);

  const unmappedCountResult = await runQuery(
    `SELECT COUNT(*) AS unmapped_count
     FROM (
       SELECT DISTINCT je.legal_entity_id, local_acc.id AS local_account_id
       FROM consolidation_group_members cgm
       JOIN journal_entries je
         ON je.tenant_id = ?
        AND je.legal_entity_id = cgm.legal_entity_id
        AND je.status = 'POSTED'
        AND je.entry_date BETWEEN ? AND ?
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
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
            WHERE clm.tenant_id = je.tenant_id
              AND clm.consolidation_group_id = cgm.consolidation_group_id
              AND clm.legal_entity_id = je.legal_entity_id
              AND clm.local_account_id = local_acc.id
              AND clm.status = 'ACTIVE'
              AND clm.effective_from <= je.entry_date
              AND (clm.effective_to IS NULL OR clm.effective_to >= je.entry_date)
              AND ccgm.effective_from <= je.entry_date
              AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= je.entry_date)
          )
     ) uncovered_accounts`,
    [
      parsedTenantId,
      reviewWindow.fromDate,
      reviewWindow.toDate,
      parsedGroupId,
      reviewWindow.toDate,
      reviewWindow.fromDate,
    ]
  );
  const unmappedPostedAccountCount = Number(
    unmappedCountResult.rows?.[0]?.unmapped_count || 0
  );

  const unmappedRowsResult = await runQuery(
    `SELECT
       je.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       local_acc.id AS local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       local_acc.account_type AS local_account_type,
       local_acc.normal_side AS local_normal_side,
       COUNT(DISTINCT je.id) AS posted_entry_count,
       MIN(je.entry_date) AS first_posted_date,
       MAX(je.entry_date) AS last_posted_date
     FROM consolidation_group_members cgm
     JOIN journal_entries je
       ON je.tenant_id = ?
      AND je.legal_entity_id = cgm.legal_entity_id
      AND je.status = 'POSTED'
      AND je.entry_date BETWEEN ? AND ?
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
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
          WHERE clm.tenant_id = je.tenant_id
            AND clm.consolidation_group_id = cgm.consolidation_group_id
            AND clm.legal_entity_id = je.legal_entity_id
            AND clm.local_account_id = local_acc.id
            AND clm.status = 'ACTIVE'
            AND clm.effective_from <= je.entry_date
            AND (clm.effective_to IS NULL OR clm.effective_to >= je.entry_date)
            AND ccgm.effective_from <= je.entry_date
            AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= je.entry_date)
        )
     GROUP BY
       je.legal_entity_id,
       le.code,
       le.name,
       local_acc.id,
       local_acc.code,
       local_acc.name,
       local_acc.account_type,
       local_acc.normal_side
     ORDER BY posted_entry_count DESC, legal_entity_code ASC, local_account_code ASC
     LIMIT ${normalizedLimit}`,
    [
      parsedTenantId,
      reviewWindow.fromDate,
      reviewWindow.toDate,
      parsedGroupId,
      reviewWindow.toDate,
      reviewWindow.fromDate,
    ]
  );
  const unmappedPostedAccounts = (unmappedRowsResult.rows || []).map((row) => ({
    legalEntityId: parsePositiveInt(row?.legal_entity_id),
    legalEntityCode: row?.legal_entity_code || null,
    legalEntityName: row?.legal_entity_name || null,
    localAccountId: parsePositiveInt(row?.local_account_id),
    localAccountCode: row?.local_account_code || null,
    localAccountName: row?.local_account_name || null,
    localAccountType: normalizeUpperText(row?.local_account_type || ""),
    localNormalSide: normalizeUpperText(row?.local_normal_side || ""),
    postedEntryCount: Number(row?.posted_entry_count || 0),
    firstPostedDate: row?.first_posted_date || null,
    lastPostedDate: row?.last_posted_date || null,
  }));

  const candidatePreview = await listCanonicalMappingCandidates({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    limit: Math.min(normalizedLimit, MAX_CANDIDATE_LIMIT),
    runQuery,
  });
  const ambiguousCandidateCount = Number(
    candidatePreview?.summary?.ambiguousGroupMatchCount || 0
  );
  const ambiguousCandidates = (candidatePreview.rows || [])
    .filter((row) => String(row?.classification || "").toUpperCase() === "AMBIGUOUS_GROUP_MATCH")
    .slice(0, normalizedLimit)
    .map((row) => ({
      legalEntityId: parsePositiveInt(row?.legalEntityId),
      legalEntityCode: row?.legalEntityCode || null,
      legalEntityName: row?.legalEntityName || null,
      localAccountId: parsePositiveInt(row?.localAccountId),
      localAccountCode: row?.localAccountCode || null,
      localAccountName: row?.localAccountName || null,
      expectedCanonicalKey: row?.expectedCanonicalKey || null,
      groupMatchCount: Number(row?.groupMatchCount || 0),
      groupMatchAccountIds: Array.isArray(row?.groupMatchAccountIds)
        ? row.groupMatchAccountIds
        : [],
      reason: row?.reason || null,
      makerChecker: {
        requiresChecker: true,
        checkerMustDifferFromMaker: true,
        reviewStatus: "PENDING_CHECKER_REVIEW",
        reasonCode: "AMBIGUOUS_CANDIDATE_SELECTION",
      },
    }));

  const savedRuleList = await listCanonicalMappingRules({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    status: "ALL",
    runQuery,
  });
  const activeSavedRuleRows = (savedRuleList?.rows || []).filter(
    (row) => normalizeUpperText(row?.status) === "ACTIVE"
  );
  const savedRuleMatchesByLocalAccount = new Map();
  const invalidSavedRulePreviews = [];
  for (const rule of activeSavedRuleRows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const preview = await previewCanonicalMappingRule({
        tenantId: parsedTenantId,
        consolidationGroupId: parsedGroupId,
        legalEntityId: rule.legalEntityId,
        ruleType: rule.ruleType,
        parentLocalAccountId: rule.parentLocalAccountId,
        codePrefix: rule.codePrefix,
        canonicalKey: rule.canonicalKey,
        canonicalName: rule.canonicalName,
        groupAccountId: rule.groupAccountId,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        runQuery,
      });
      for (const previewRow of preview?.rows || []) {
        const coverageKey = `${parsePositiveInt(previewRow?.legalEntityId)}:${parsePositiveInt(
          previewRow?.localAccountId
        )}`;
        if (!savedRuleMatchesByLocalAccount.has(coverageKey)) {
          savedRuleMatchesByLocalAccount.set(coverageKey, []);
        }
        savedRuleMatchesByLocalAccount.get(coverageKey).push({
          ruleId: rule.id,
          ruleType: rule.ruleType,
          canonicalKey: rule.canonicalKey,
          classification: previewRow?.classification || "UNKNOWN",
        });
      }
    } catch (error) {
      invalidSavedRulePreviews.push({
        ruleId: rule.id,
        legalEntityId: rule.legalEntityId,
        canonicalKey: rule.canonicalKey,
        message: String(error?.message || "Saved rule preview failed"),
      });
    }
  }
  const unmappedPostedAccountsWithSavedRuleContext = unmappedPostedAccounts.map((row) => {
    const coverageKey = `${parsePositiveInt(row?.legalEntityId)}:${parsePositiveInt(
      row?.localAccountId
    )}`;
    return {
      ...row,
      savedRuleMatches: savedRuleMatchesByLocalAccount.get(coverageKey) || [],
    };
  });
  const unmappedPostedAccountsCoveredBySavedRulesCount =
    unmappedPostedAccountsWithSavedRuleContext.filter(
      (row) => (row?.savedRuleMatches || []).length > 0
    ).length;

  let localChangeCount = 0;
  let localChangeRows = [];
  if (memberLegalEntityIds.length > 0) {
    const localActionPlaceholders = GOVERNANCE_LOCAL_MAPPING_AUDIT_ACTIONS.map(
      () => "?"
    ).join(", ");
    const memberEntityPlaceholders = memberLegalEntityIds.map(() => "?").join(", ");

    const localCountResult = await runQuery(
      `SELECT COUNT(*) AS total_count
       FROM audit_logs
       WHERE tenant_id = ?
         AND action IN (${localActionPlaceholders})
         AND created_at >= ?
         AND created_at < ?
         AND scope_type = 'LEGAL_ENTITY'
         AND scope_id IN (${memberEntityPlaceholders})`,
      [
        parsedTenantId,
        ...GOVERNANCE_LOCAL_MAPPING_AUDIT_ACTIONS,
        auditWindowStart,
        auditWindowEndExclusive,
        ...memberLegalEntityIds,
      ]
    );
    localChangeCount = Number(localCountResult.rows?.[0]?.total_count || 0);

    const localRowsResult = await runQuery(
      `SELECT
         id,
         user_id,
         action,
         scope_type,
         scope_id,
         request_id,
         payload_json,
         created_at
       FROM audit_logs
       WHERE tenant_id = ?
         AND action IN (${localActionPlaceholders})
         AND created_at >= ?
         AND created_at < ?
         AND scope_type = 'LEGAL_ENTITY'
         AND scope_id IN (${memberEntityPlaceholders})
       ORDER BY created_at DESC, id DESC
       LIMIT ${normalizedLimit}`,
      [
        parsedTenantId,
        ...GOVERNANCE_LOCAL_MAPPING_AUDIT_ACTIONS,
        auditWindowStart,
        auditWindowEndExclusive,
        ...memberLegalEntityIds,
      ]
    );
    localChangeRows = localRowsResult.rows || [];
  }

  const governanceGroupActions = [
    ...GOVERNANCE_GROUP_MAPPING_AUDIT_ACTIONS,
    ...GOVERNANCE_RULE_MAPPING_AUDIT_ACTIONS,
    GOVERNANCE_CANDIDATE_APPLY_AUDIT_ACTION,
  ];
  const groupActionPlaceholders = governanceGroupActions.map(() => "?").join(", ");

  const groupCountResult = await runQuery(
    `SELECT COUNT(*) AS total_count
     FROM audit_logs
     WHERE tenant_id = ?
       AND action IN (${groupActionPlaceholders})
       AND created_at >= ?
       AND created_at < ?
       AND scope_type = 'GROUP'
       AND scope_id = ?`,
    [
      parsedTenantId,
      ...governanceGroupActions,
      auditWindowStart,
      auditWindowEndExclusive,
      parsedGroupId,
    ]
  );
  const groupChangeCount = Number(groupCountResult.rows?.[0]?.total_count || 0);

  const groupRowsResult = await runQuery(
    `SELECT
       id,
       user_id,
       action,
       scope_type,
       scope_id,
       request_id,
       payload_json,
       created_at
     FROM audit_logs
     WHERE tenant_id = ?
       AND action IN (${groupActionPlaceholders})
       AND created_at >= ?
       AND created_at < ?
       AND scope_type = 'GROUP'
       AND scope_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${normalizedLimit}`,
    [
      parsedTenantId,
      ...governanceGroupActions,
      auditWindowStart,
      auditWindowEndExclusive,
      parsedGroupId,
    ]
  );
  const groupChangeRows = groupRowsResult.rows || [];

  const recentMappingChangeCount = localChangeCount + groupChangeCount;
  const toSortTimestamp = (value) => {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const recentMappingChanges = [...localChangeRows, ...groupChangeRows]
    .map(mapGovernanceAuditLogRow)
    .sort((left, right) => toSortTimestamp(right?.createdAt) - toSortTimestamp(left?.createdAt))
    .slice(0, normalizedLimit);

  const highRiskOverrides = recentMappingChanges.filter(
    (row) => row?.governance?.semanticHighRisk === true
  );

  const pendingCheckerReview = [
    ...ambiguousCandidates.map((row) => ({
      sourceType: "AMBIGUOUS_CANDIDATE",
      createdAt: null,
      changedByUserId: null,
      reviewStatus: "PENDING_CHECKER_REVIEW",
      reasonCode: "AMBIGUOUS_CANDIDATE_SELECTION",
      legalEntityId: row.legalEntityId,
      legalEntityCode: row.legalEntityCode,
      localAccountId: row.localAccountId,
      localAccountCode: row.localAccountCode,
      details: {
        expectedCanonicalKey: row.expectedCanonicalKey,
        groupMatchCount: row.groupMatchCount,
        groupMatchAccountIds: row.groupMatchAccountIds,
      },
    })),
    ...recentMappingChanges
      .filter((row) => row?.governance?.makerChecker?.requiresChecker === true)
      .map((row) => ({
        sourceType: "MAPPING_CHANGE",
        createdAt: row.createdAt || null,
        changedByUserId: row.changedByUserId || null,
        reviewStatus: row?.governance?.makerChecker?.reviewStatus || "PENDING_CHECKER_REVIEW",
        reasonCode: row?.governance?.makerChecker?.reasonCode || "REMAP_CHANGE",
        auditLogId: row.auditLogId,
        action: row.action,
        details: {
          semanticHighRiskCodes: row?.governance?.semanticHighRiskCodes || [],
          reason: row.reason || null,
          source: row.source || null,
        },
      })),
  ]
    .sort((left, right) => toSortTimestamp(right?.createdAt) - toSortTimestamp(left?.createdAt))
    .slice(0, normalizedLimit);

  return {
    limit: normalizedLimit,
    reviewWindow,
    cadence: {
      code: "MONTH_END",
      description:
        "Run this governance review at month-end before consolidation execute/finalize windows.",
    },
    makerCheckerPolicy: {
      checkerMustDifferFromMaker: true,
      requiredForReasonCodes: [
        "AMBIGUOUS_CANDIDATE_SELECTION",
        "HIGH_RISK_REMAP_OR_APPLY",
      ],
      defaultReviewStatus: "PENDING_CHECKER_REVIEW",
    },
    summary: {
      unmappedPostedAccountCount,
      unmappedPostedAccountSampleCount: unmappedPostedAccountsWithSavedRuleContext.length,
      unmappedPostedAccountSampleTruncated:
        unmappedPostedAccountCount > unmappedPostedAccountsWithSavedRuleContext.length,
      unmappedPostedAccountSampleCoveredBySavedRulesCount:
        unmappedPostedAccountsCoveredBySavedRulesCount,
      unmappedPostedAccountSampleOutsideSavedRuleCoverageCount: Math.max(
        0,
        unmappedPostedAccountsWithSavedRuleContext.length -
          unmappedPostedAccountsCoveredBySavedRulesCount
      ),
      ambiguousCandidateCount,
      ambiguousCandidateSampleCount: ambiguousCandidates.length,
      ambiguousCandidateSampleTruncated:
        ambiguousCandidateCount > ambiguousCandidates.length,
      savedRuleCount: Number(savedRuleList?.summary?.total || 0),
      activeSavedRuleCount: Number(savedRuleList?.summary?.activeCount || 0),
      inactiveSavedRuleCount: Number(savedRuleList?.summary?.inactiveCount || 0),
      invalidSavedRulePreviewCount: invalidSavedRulePreviews.length,
      recentMappingChangeCount,
      recentMappingChangeSampleCount: recentMappingChanges.length,
      recentMappingChangeSampleTruncated:
        recentMappingChangeCount > recentMappingChanges.length,
      highRiskOverrideSampleCount: highRiskOverrides.length,
      pendingCheckerReviewSampleCount: pendingCheckerReview.length,
    },
    legalEntities,
    unmappedPostedAccounts: unmappedPostedAccountsWithSavedRuleContext,
    ambiguousCandidates,
    savedRules: {
      summary: {
        ...savedRuleList.summary,
        invalidPreviewCount: invalidSavedRulePreviews.length,
      },
      rows: savedRuleList.rows.slice(0, normalizedLimit),
      invalidPreviewRules: invalidSavedRulePreviews.slice(0, normalizedLimit),
    },
    recentMappingChanges,
    highRiskOverrides,
    pendingCheckerReview,
  };
}

export async function applyCanonicalMappingCandidates({
  tenantId,
  consolidationGroupId,
  legalEntityId = null,
  limit = 500,
  changeReason = null,
  changeSource = "CANDIDATE_AUTO_APPLY",
  actedByUserId = null,
  requestMeta = null,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }
  const parsedLegalEntityId = parsePositiveInt(legalEntityId) || null;
  const normalizedLimit = normalizeCandidateLimit(limit);
  const effectiveFrom = toDateOnlyString(new Date(), "effectiveFrom");
  const normalizedChangeReason = toNullableString(changeReason, 500);
  const normalizedChangeSource =
    normalizeUpperText(changeSource || "CANDIDATE_AUTO_APPLY") ||
    "CANDIDATE_AUTO_APPLY";

  const preview = await listCanonicalMappingCandidates({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    legalEntityId: parsedLegalEntityId,
    limit: normalizedLimit,
  });
  const safeRows = (preview.rows || []).filter(
    (row) => row?.classification === "SAFE" && row?.canAutoApply === true
  );
  const highRiskSafeRows = safeRows.filter(
    (row) => row?.semanticRisk?.highRisk === true
  );

  const metrics = {
    safeCandidateCount: preview.summary.safeCount,
    highRiskSafeCandidateCount: highRiskSafeRows.length,
    appliedCandidateCount: 0,
    skippedCandidateCount: preview.summary.total,
    canonicalKeysTouched: 0,
    localMappingsTouched: 0,
    groupMappingsTouched: 0,
  };
  if (highRiskSafeRows.length > 0 && !normalizedChangeReason) {
    const err = badRequest(
      "High-risk safe candidates require reason. Provide reason in payload.reason before apply."
    );
    err.details = {
      code: "HIGH_RISK_SAFE_APPLY_REASON_REQUIRED",
      highRiskSafeCandidateCount: highRiskSafeRows.length,
      sample: highRiskSafeRows.slice(0, 10).map((row) => ({
        legalEntityId: row.legalEntityId,
        localAccountId: row.localAccountId,
        localAccountCode: row.localAccountCode,
        semanticRiskCodes: row?.semanticRisk?.codes || [],
      })),
    };
    throw err;
  }
  if (highRiskSafeRows.length > 0) {
    const highRiskWarnings = highRiskSafeRows.flatMap((row) => {
      const rowWarnings = Array.isArray(row?.semanticWarnings) ? row.semanticWarnings : [];
      return rowWarnings.map((warning) => ({
        ...warning,
        legalEntityId: parsePositiveInt(row?.legalEntityId) || null,
        localAccountId: parsePositiveInt(row?.localAccountId) || null,
        localAccountCode: row?.localAccountCode || null,
      }));
    });
    emitSemanticRiskOverrideUsageEvent({
      tenantId: parsedTenantId,
      consolidationGroupId: parsedGroupId,
      legalEntityId: parsedLegalEntityId,
      changeSource: normalizedChangeSource,
      changeReason: normalizedChangeReason,
      semanticWarnings:
        highRiskWarnings.length > 0
          ? highRiskWarnings
          : [{ code: "HIGH_RISK_SAFE_CANDIDATE", severity: "HIGH" }],
      actedByUserId,
      overrideContext: "SAFE_CANDIDATE_AUTO_APPLY",
      highRiskCandidateCount: highRiskSafeRows.length,
    });
  }

  if (!safeRows.length) {
    await insertCanonicalMappingAuditLog({
      tenantId: parsedTenantId,
      userId: parsePositiveInt(actedByUserId) || null,
      action: "consolidation.canonical_mapping.candidates.apply",
      resourceType: "consolidation_canonical_candidates_apply",
      resourceId: `${parsedGroupId}:${parsedLegalEntityId || "ALL"}`,
      scopeType: "GROUP",
      scopeId: parsedGroupId,
      requestId: requestMeta?.requestId || null,
      ipAddress: requestMeta?.ipAddress || null,
      userAgent: requestMeta?.userAgent || null,
      payload: {
        source: normalizedChangeSource,
        reason: normalizedChangeReason,
        appliedCandidateCount: 0,
        safeCandidateCount: metrics.safeCandidateCount,
        highRiskSafeCandidateCount: metrics.highRiskSafeCandidateCount,
      },
    });
    return {
      limit: normalizedLimit,
      legalEntityId: parsedLegalEntityId,
      summary: preview.summary,
      ...metrics,
      appliedSample: [],
    };
  }

  const seenCanonicalKeys = new Set();
  const seenLocalMappings = new Set();
  const seenGroupMappings = new Set();

  await withTransaction(async (tx) => {
    for (const row of safeRows) {
      const resolvedGroupAccountId = parsePositiveInt(row?.resolvedGroupAccountId);
      const legalEntityForRow = parsePositiveInt(row?.legalEntityId);
      const localAccountForRow = parsePositiveInt(row?.localAccountId);
      const localCode = String(row?.localAccountCode || "").trim();
      if (!resolvedGroupAccountId || !legalEntityForRow || !localAccountForRow || !localCode) {
        throw new Error("Safe candidate row is missing required identifiers");
      }

      // eslint-disable-next-line no-await-in-loop
      const localResult = await upsertLocalAccountCanonicalMapping({
        tenantId: parsedTenantId,
        consolidationGroupId: parsedGroupId,
        legalEntityId: legalEntityForRow,
        localAccountId: localAccountForRow,
        canonicalKey: buildCanonicalKeyFromAccountCode(localCode),
        canonicalName: `Canonical ${localCode}`,
        canonicalType: "ACCOUNT",
        status: "ACTIVE",
        effectiveFrom,
        effectiveTo: null,
        changeReason: normalizedChangeReason,
        changeSource: normalizedChangeSource,
        actedByUserId,
        requestMeta,
        runQuery: tx.query,
      });

      const keyScope = `${parsedTenantId}:${parsedGroupId}:${localResult.canonicalKey}`;
      if (!seenCanonicalKeys.has(keyScope)) {
        seenCanonicalKeys.add(keyScope);
        metrics.canonicalKeysTouched += 1;
      }

      const localScope = `${parsedTenantId}:${parsedGroupId}:${legalEntityForRow}:${localAccountForRow}`;
      if (!seenLocalMappings.has(localScope)) {
        seenLocalMappings.add(localScope);
        metrics.localMappingsTouched += 1;
      }

      // eslint-disable-next-line no-await-in-loop
      await upsertGroupAccountCanonicalMapping({
        tenantId: parsedTenantId,
        consolidationGroupId: parsedGroupId,
        groupAccountId: resolvedGroupAccountId,
        canonicalKey: buildCanonicalKeyFromAccountCode(localCode),
        canonicalName: `Canonical ${localCode}`,
        canonicalType: "ACCOUNT",
        status: "ACTIVE",
        effectiveFrom,
        effectiveTo: null,
        changeReason: normalizedChangeReason,
        changeSource: normalizedChangeSource,
        actedByUserId,
        requestMeta,
        runQuery: tx.query,
      });

      const groupScope = `${parsedTenantId}:${parsedGroupId}:${localResult.canonicalKeyId}`;
      if (!seenGroupMappings.has(groupScope)) {
        seenGroupMappings.add(groupScope);
        metrics.groupMappingsTouched += 1;
      }
    }
  });

  metrics.appliedCandidateCount = safeRows.length;
  metrics.skippedCandidateCount = Math.max(
    0,
    Number(preview.summary.total || 0) - metrics.appliedCandidateCount
  );
  await insertCanonicalMappingAuditLog({
    tenantId: parsedTenantId,
    userId: parsePositiveInt(actedByUserId) || null,
    action: "consolidation.canonical_mapping.candidates.apply",
    resourceType: "consolidation_canonical_candidates_apply",
    resourceId: `${parsedGroupId}:${parsedLegalEntityId || "ALL"}`,
    scopeType: "GROUP",
    scopeId: parsedGroupId,
    requestId: requestMeta?.requestId || null,
    ipAddress: requestMeta?.ipAddress || null,
    userAgent: requestMeta?.userAgent || null,
    payload: {
      source: normalizedChangeSource,
      reason: normalizedChangeReason,
      appliedCandidateCount: metrics.appliedCandidateCount,
      safeCandidateCount: metrics.safeCandidateCount,
      highRiskSafeCandidateCount: metrics.highRiskSafeCandidateCount,
      canonicalKeysTouched: metrics.canonicalKeysTouched,
      localMappingsTouched: metrics.localMappingsTouched,
      groupMappingsTouched: metrics.groupMappingsTouched,
    },
  });

  return {
    limit: normalizedLimit,
    legalEntityId: parsedLegalEntityId,
    summary: preview.summary,
    ...metrics,
    appliedSample: safeRows.slice(0, 20).map((row) => ({
      legalEntityId: row.legalEntityId,
      localAccountId: row.localAccountId,
      localAccountCode: row.localAccountCode,
      expectedCanonicalKey: row.expectedCanonicalKey,
      resolvedGroupAccountId: row.resolvedGroupAccountId,
      resolvedGroupAccountCode: row.resolvedGroupAccountCode,
    })),
  };
}

export default {
  listCanonicalKeys,
  upsertCanonicalKey,
  upsertLocalAccountCanonicalMapping,
  upsertGroupAccountCanonicalMapping,
  listCanonicalAccountMappings,
  listCanonicalMappingCandidates,
  previewCanonicalMappingRule,
  applyCanonicalMappingRule,
  getCanonicalMappingRuleById,
  listCanonicalMappingRules,
  createCanonicalMappingRule,
  deactivateCanonicalMappingRule,
  previewCanonicalMappingRuleById,
  applyCanonicalMappingRuleById,
  applyCanonicalMappingCandidates,
  getCanonicalMappingReadiness,
  getCanonicalMappingGovernanceReview,
};
