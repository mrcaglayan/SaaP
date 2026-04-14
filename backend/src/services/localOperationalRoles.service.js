import { badRequest } from "../routes/_utils.js";

/**
 * Shared bounded local-role catalog used by both PR-7C local user
 * administration and PR-7D temporary operational coverage. Keeping the
 * allow-list in one place prevents the two scoped admin seams from drifting.
 */
export const LOCAL_OPERATIONAL_ROLE_CATALOG = Object.freeze({
  LocalClosePreparer: Object.freeze({
    scopeTypes: Object.freeze(["LEGAL_ENTITY"]),
  }),
  AuditorReadOnly: Object.freeze({
    scopeTypes: Object.freeze(["LEGAL_ENTITY", "OPERATING_UNIT"]),
  }),
  BranchOperator: Object.freeze({
    scopeTypes: Object.freeze(["OPERATING_UNIT"]),
  }),
  OUAPSubmitter: Object.freeze({
    scopeTypes: Object.freeze(["OPERATING_UNIT"]),
  }),
  GLOperator: Object.freeze({
    scopeTypes: Object.freeze(["LEGAL_ENTITY"]),
  }),
  MasterDataSteward: Object.freeze({
    scopeTypes: Object.freeze(["LEGAL_ENTITY"]),
  }),
  OUAccountant: Object.freeze({
    scopeTypes: Object.freeze(["OPERATING_UNIT"]),
  }),
  PayrollOperator: Object.freeze({
    scopeTypes: Object.freeze(["LEGAL_ENTITY"]),
  }),
  ShareholderCapitalOperator: Object.freeze({
    scopeTypes: Object.freeze(["LEGAL_ENTITY"]),
  }),
  TreasuryOperator: Object.freeze({
    scopeTypes: Object.freeze(["LEGAL_ENTITY"]),
  }),
});

export const LOCAL_OPERATIONAL_ROLE_CODES = Object.freeze(
  Object.keys(LOCAL_OPERATIONAL_ROLE_CATALOG),
);

/**
 * Return one bounded local-role config, or `null` when the role is not part of
 * the shipped local operational allow-list.
 */
export function getLocalOperationalRoleConfig(roleCode) {
  const normalizedRoleCode = String(roleCode || "").trim();
  return LOCAL_OPERATIONAL_ROLE_CATALOG[normalizedRoleCode] || null;
}

/**
 * Normalize and validate one bounded local operational role code.
 */
export function normalizeLocalOperationalRoleCode(roleCode) {
  const normalizedRoleCode = String(roleCode || "").trim();
  if (!normalizedRoleCode) {
    throw badRequest("roleCode is required");
  }
  if (!getLocalOperationalRoleConfig(normalizedRoleCode)) {
    throw badRequest(
      `${normalizedRoleCode} is not manageable through local user administration`,
    );
  }
  return normalizedRoleCode;
}

/**
 * Normalize and validate one scope type against the bounded local role's
 * shipped scope allow-list.
 */
export function normalizeLocalOperationalRoleScopeType(roleCode, scopeType) {
  const normalizedRoleCode = normalizeLocalOperationalRoleCode(roleCode);
  const normalizedScopeType = String(scopeType || "")
    .trim()
    .toUpperCase();
  const roleConfig = getLocalOperationalRoleConfig(normalizedRoleCode);
  if (!roleConfig?.scopeTypes?.includes(normalizedScopeType)) {
    throw badRequest(
      `${normalizedRoleCode} can only be assigned at ${roleConfig.scopeTypes.join(", ")} scope`,
    );
  }
  return normalizedScopeType;
}

export default {
  LOCAL_OPERATIONAL_ROLE_CATALOG,
  LOCAL_OPERATIONAL_ROLE_CODES,
  getLocalOperationalRoleConfig,
  normalizeLocalOperationalRoleCode,
  normalizeLocalOperationalRoleScopeType,
};
