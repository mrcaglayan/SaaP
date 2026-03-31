import { badRequest } from "./_utils.js";
import {
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parsePagination,
  requirePositiveInt,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";
import {
  LOCAL_CLOSE_PACK_SCOPE_TYPES,
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

export default {
  parseLocalClosePackIdParam,
  parseLocalClosePackListInput,
  parseLocalClosePackCreateInput,
};
