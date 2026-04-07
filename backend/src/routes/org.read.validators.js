import { badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";

const VALID_ORG_TREE_SHAPES = new Set(["flat", "nested"]);

export function requireOrgTenantId(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return tenantId;
}

/**
 * Parse org-tree read filters while keeping the legacy flat response as the
 * default during the additive nested-tree rollout.
 */
export function parseOrgTreeReadFilters(rawQuery = {}) {
  const shape = String(rawQuery.shape || "flat").trim().toLowerCase() || "flat";
  if (!VALID_ORG_TREE_SHAPES.has(shape)) {
    throw badRequest("shape must be flat or nested");
  }

  return { shape };
}

/**
 * Parse legal-entity list filters, including the optional lifecycle status
 * used by admin setup surfaces.
 */
export function parseLegalEntityReadFilters(rawQuery = {}) {
  const status = rawQuery.status ? String(rawQuery.status).toUpperCase() : null;
  if (status && !["ACTIVE", "INACTIVE"].includes(status)) {
    throw badRequest("status must be ACTIVE or INACTIVE");
  }

  return {
    countryId: parsePositiveInt(rawQuery.countryId),
    groupCompanyId: parsePositiveInt(rawQuery.groupCompanyId),
    status,
  };
}

export function parseOperatingUnitReadFilters(rawQuery = {}) {
  return {
    legalEntityId: parsePositiveInt(rawQuery.legalEntityId),
    operatingUnitId: parsePositiveInt(rawQuery.operatingUnitId),
  };
}

export function parseOperatingUnitCurrentAccountConfigReadFilters(rawQuery = {}) {
  return {
    legalEntityId: parsePositiveInt(rawQuery.legalEntityId),
  };
}

export function parseOperatingUnitPartnerCurrentAccountReadFilters(rawQuery = {}) {
  return {
    legalEntityId: parsePositiveInt(rawQuery.legalEntityId),
    operatingUnitId: parsePositiveInt(rawQuery.operatingUnitId),
    partnerOperatingUnitId: parsePositiveInt(rawQuery.partnerOperatingUnitId),
  };
}

export function parseFiscalCalendarPeriodFilters(rawParams = {}, rawQuery = {}) {
  const calendarId = parsePositiveInt(rawParams.calendarId);
  if (!calendarId) {
    throw badRequest("calendarId must be a positive integer");
  }

  return {
    calendarId,
    fiscalYear: parsePositiveInt(rawQuery.fiscalYear),
  };
}

export function parseShareholderJournalConfigFilters(rawQuery = {}) {
  return {
    legalEntityId: parsePositiveInt(rawQuery.legalEntityId),
  };
}

export function parseShareholderReadFilters(rawQuery = {}) {
  const status = rawQuery.status ? String(rawQuery.status).toUpperCase() : null;
  if (status && !["ACTIVE", "INACTIVE"].includes(status)) {
    throw badRequest("status must be ACTIVE or INACTIVE");
  }

  return {
    legalEntityId: parsePositiveInt(rawQuery.legalEntityId),
    status,
  };
}
