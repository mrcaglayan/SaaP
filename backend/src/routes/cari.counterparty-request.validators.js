import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeEnum,
  normalizeText,
  parseBooleanFlag,
  parsePagination,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";
import { parseCounterpartyCreateInput } from "./cari.counterparty.validators.js";

const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
const LIST_ROLE_FILTERS = ["CUSTOMER", "VENDOR", "BOTH"];

function optionalPositiveInt(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeRoleFilter(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return null;
  }
  if (!LIST_ROLE_FILTERS.includes(normalized)) {
    throw badRequest(`role must be one of ${LIST_ROLE_FILTERS.join(", ")}`);
  }
  return normalized;
}

function parseOptionalBoolean(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  try {
    return parseBooleanFlag(value, false);
  } catch {
    throw badRequest(`${label} must be a boolean`);
  }
}

function parseCounterpartyRequestIdParam(req) {
  const requestId = parsePositiveInt(req.params?.requestId ?? req.params?.id);
  if (!requestId) {
    throw badRequest("requestId must be a positive integer");
  }
  return requestId;
}

/**
 * Parse counterparty-request list filters.
 */
export function parseCounterpartyRequestListInput(req) {
  const tenantId = requireTenantId(req);
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const primaryOperatingUnitId = optionalPositiveInt(
    req.query?.primaryOperatingUnitId,
    "primaryOperatingUnitId"
  );
  const statusRaw = String(req.query?.status || "")
    .trim()
    .toUpperCase();
  const status = statusRaw
    ? normalizeEnum(statusRaw, "status", REQUEST_STATUSES)
    : null;
  const role = normalizeRoleFilter(req.query?.role);
  const mineOnly = parseOptionalBoolean(req.query?.mineOnly, "mineOnly");
  const q = normalizeText(req.query?.q, "q", 120);
  const pagination = parsePagination(req.query, { limit: 50, offset: 0, maxLimit: 200 });

  return {
    tenantId,
    legalEntityId,
    primaryOperatingUnitId,
    status,
    role,
    mineOnly,
    q,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

/**
 * Parse one counterparty-request submission.
 */
export function parseCounterpartyRequestCreateInput(req) {
  return parseCounterpartyCreateInput(req);
}

/**
 * Parse approve input for one counterparty request.
 */
export function parseCounterpartyRequestApproveInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    requestId: parseCounterpartyRequestIdParam(req),
    decisionComment: normalizeText(req.body?.decisionComment, "decisionComment", 500),
  };
}

/**
 * Parse reject input for one counterparty request.
 */
export function parseCounterpartyRequestRejectInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    requestId: parseCounterpartyRequestIdParam(req),
    decisionComment: normalizeText(req.body?.decisionComment, "decisionComment", 500),
  };
}
