/**
 * Fixed-assets request validators.
 *
 * Owns parse/validate functions for fixed-assets route inputs.
 * Validator shells are intentionally empty at this skeleton step;
 * later STEP-FA steps land real validators here.
 */

import { resolveTenantId, parsePositiveInt } from "./_utils.js";

/**
 * Shared list-filter parser for fixed-assets endpoints that accept
 * legalEntityId in query. Used by categories, profiles, custodians,
 * and the asset register list.
 */
export function parseFixedAssetsListFilters(req) {
  const tenantId = resolveTenantId(req);
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return { tenantId, legalEntityId };
}
