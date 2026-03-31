import { badRequest } from "./_utils.js";
import {
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parsePagination,
  parseBooleanFlag,
  requirePositiveInt,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";
import {
  LOCAL_CLOSE_PACK_SCOPE_TYPES,
  LOCAL_CLOSE_PACK_REPORT_LAUNCH_MODES,
  LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS,
  LOCAL_CLOSE_PACK_STATUS_VALUES,
} from "../services/local.close-packs.shared.js";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeOptionalEnum(value, label, allowedValues) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeEnum(value, label, allowedValues);
}

/**
 * Parse the `packId` route param for local close-pack reads.
 */
export function parseLocalClosePackIdParam(req) {
  return requirePositiveInt(req.params?.packId ?? req.params?.id, "packId");
}

/**
 * Parse list filters for the local close-pack header domain.
 */
export function parseLocalClosePackListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });

  return {
    tenantId,
    ...pagination,
    legalEntityId: optionalPositiveInt(
      req.query?.legalEntityId ?? req.query?.legal_entity_id,
      "legalEntityId"
    ),
    bookId: optionalPositiveInt(req.query?.bookId ?? req.query?.book_id, "bookId"),
    fiscalPeriodId: optionalPositiveInt(
      req.query?.fiscalPeriodId ?? req.query?.fiscal_period_id,
      "fiscalPeriodId"
    ),
    operatingUnitId: optionalPositiveInt(
      req.query?.operatingUnitId ?? req.query?.operating_unit_id,
      "operatingUnitId"
    ),
    closeScopeType: normalizeOptionalEnum(
      req.query?.closeScopeType ?? req.query?.close_scope_type,
      "closeScopeType",
      LOCAL_CLOSE_PACK_SCOPE_TYPES
    ),
    status: normalizeOptionalEnum(
      req.query?.status,
      "status",
      LOCAL_CLOSE_PACK_STATUS_VALUES
    ),
    q: normalizeText(req.query?.q, "q", 120),
  };
}

/**
 * Parse create input for the local close-pack header domain.
 */
export function parseLocalClosePackCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const body = req.body || {};

  const closeScopeType = normalizeEnum(
    body.closeScopeType ?? body.close_scope_type,
    "closeScopeType",
    LOCAL_CLOSE_PACK_SCOPE_TYPES
  );
  const operatingUnitId = optionalPositiveInt(
    body.operatingUnitId ?? body.operating_unit_id,
    "operatingUnitId"
  );

  if (closeScopeType === "OPERATING_UNIT" && !operatingUnitId) {
    throw badRequest("operatingUnitId is required when closeScopeType is OPERATING_UNIT");
  }
  if (
    closeScopeType === "CENTRAL" &&
    (hasOwn(body, "operatingUnitId") || hasOwn(body, "operating_unit_id"))
  ) {
    if (operatingUnitId) {
      throw badRequest("operatingUnitId must be omitted for CENTRAL close packs");
    }
  }

  return {
    tenantId,
    userId,
    legalEntityId: requirePositiveInt(
      body.legalEntityId ?? body.legal_entity_id,
      "legalEntityId"
    ),
    bookId: requirePositiveInt(body.bookId ?? body.book_id, "bookId"),
    fiscalPeriodId: requirePositiveInt(
      body.fiscalPeriodId ?? body.fiscal_period_id,
      "fiscalPeriodId"
    ),
    closeScopeType,
    operatingUnitId: closeScopeType === "OPERATING_UNIT" ? operatingUnitId : null,
    status: normalizeOptionalEnum(
      body.status,
      "status",
      LOCAL_CLOSE_PACK_STATUS_VALUES
    ) || "NOT_OPENED",
    note: normalizeText(body.note, "note", 1000),
  };
}

/**
 * Parse one local close-pack workflow action payload.
 */
export function parseLocalClosePackActionInput(
  req,
  { requireDecisionNote = false } = {}
) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const packId = parseLocalClosePackIdParam(req);
  const body = req.body || {};

  const decisionNote = normalizeText(
    body.decisionNote ?? body.decision_note ?? body.note ?? body.reason,
    "decisionNote",
    500,
    { required: requireDecisionNote }
  );

  return {
    tenantId,
    userId,
    packId,
    decisionNote,
  };
}

/**
 * Parse the `evidenceId` route param for local close-pack evidence routes.
 */
export function parseLocalClosePackEvidenceIdParam(req) {
  return requirePositiveInt(req.params?.evidenceId, "evidenceId");
}

/**
 * Parse the first-pass local close-pack comment create payload.
 */
export function parseLocalClosePackCommentCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const packId = parseLocalClosePackIdParam(req);
  return {
    tenantId,
    userId,
    packId,
    body: normalizeText(
      req.body?.body ?? req.body?.comment ?? req.body?.commentBody,
      "body",
      2000,
      { required: true }
    ),
  };
}

/**
 * Parse list filters for the first-pass local close-pack audit surface.
 */
export function parseLocalClosePackAuditListInput(req) {
  const tenantId = requireTenantId(req);
  const packId = parseLocalClosePackIdParam(req);
  const pagination = parsePagination(req.query, {
    limit: 50,
    offset: 0,
    maxLimit: 200,
  });

  return {
    tenantId,
    packId,
    ...pagination,
    includePayload: parseBooleanFlag(req.query?.includePayload, false),
  };
}

/**
 * Parse the first-pass local close-pack report review fingerprint payload.
 */
export function parseLocalClosePackReportReviewInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const packId = parseLocalClosePackIdParam(req);
  const body = req.body || {};
  const reportKey = String(body.reportKey ?? body.report_key ?? "").trim();
  if (!LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.includes(reportKey)) {
    throw badRequest(
      `reportKey must be one of ${LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.join(", ")}`
    );
  }

  return {
    tenantId,
    userId,
    packId,
    reportKey,
    routePath: normalizeText(
      body.routePath ?? body.route_path,
      "routePath",
      255,
      { required: true }
    ),
    launchMode: normalizeEnum(
      body.launchMode ?? body.launch_mode,
      "launchMode",
      LOCAL_CLOSE_PACK_REPORT_LAUNCH_MODES
    ),
    reviewNote: normalizeText(
      body.reviewNote ?? body.review_note ?? body.note,
      "reviewNote",
      500
    ),
    query:
      body.query && typeof body.query === "object" && !Array.isArray(body.query)
        ? body.query
        : (() => {
            throw badRequest("query must be an object");
          })(),
    responseSnapshot:
      body.responseSnapshot &&
      typeof body.responseSnapshot === "object" &&
      !Array.isArray(body.responseSnapshot)
        ? body.responseSnapshot
        : (() => {
            throw badRequest("responseSnapshot must be an object");
          })(),
  };
}

export default {
  parseLocalClosePackIdParam,
  parseLocalClosePackListInput,
  parseLocalClosePackCreateInput,
  parseLocalClosePackActionInput,
  parseLocalClosePackEvidenceIdParam,
  parseLocalClosePackCommentCreateInput,
  parseLocalClosePackAuditListInput,
  parseLocalClosePackReportReviewInput,
};
