/**
 * Shared fixed-assets RBAC scope resolution helpers.
 *
 * All fixed-assets routes that use requirePermission(...) with scoped
 * records or legal-entity-scoped list/create/report/settings entry
 * points must use these shared resolvers instead of route-local SQL.
 *
 * Split into:
 *   - request-scoped resolvers  (list / create / report / settings)
 *   - record-scoped resolvers   (existing row entry points)
 */

import { query } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";

// ═══════════════════════════════════════════════════════════════════
// Request-scoped resolvers
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve scope from query-string filters.
 * Prefers owner-OU when a single authoritative OU input is present;
 * falls back to generic operating-unit query filters used by custodian pages;
 * otherwise falls back to legal-entity scope.
 */
export function resolveLegalEntityScopeFromQuery(req) {
  const ownerOperatingUnitId = parsePositiveInt(req.query?.ownerOperatingUnitId);
  if (ownerOperatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: ownerOperatingUnitId };
  }
  const operatingUnitId = parsePositiveInt(req.query?.operatingUnitId);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return legalEntityId
    ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
    : null;
}

/**
 * Resolve scope from request body.
 * Prefers owner-OU when present; falls back to generic operating-unit body
 * filters used by custodian upserts; otherwise falls back to legal-entity.
 */
export function resolveLegalEntityScopeFromBody(req) {
  const ownerOperatingUnitId = parsePositiveInt(req.body?.ownerOperatingUnitId);
  if (ownerOperatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: ownerOperatingUnitId };
  }
  const operatingUnitId = parsePositiveInt(req.body?.operatingUnitId);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  return legalEntityId
    ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
    : null;
}

// ═══════════════════════════════════════════════════════════════════
// Record-scoped resolvers
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve scope from the fixed-asset row.
 * Prefers owner-OU scope when the asset has one; otherwise legal-entity.
 */
export async function resolveFixedAssetScope(assetId, tenantId) {
  const id = parsePositiveInt(assetId);
  const tid = parsePositiveInt(tenantId);
  if (!id || !tid) return null;

  const result = await query(
    `SELECT legal_entity_id, owner_operating_unit_id
       FROM fixed_assets
      WHERE tenant_id = ? AND id = ?
      LIMIT 1`,
    [tid, id]
  );
  const row = result.rows?.[0];
  if (!row) return null;

  const ouId = parsePositiveInt(row.owner_operating_unit_id);
  if (ouId) {
    return { scopeType: "OPERATING_UNIT", scopeId: ouId };
  }
  const leId = parsePositiveInt(row.legal_entity_id);
  return leId ? { scopeType: "LEGAL_ENTITY", scopeId: leId } : null;
}

/**
 * Resolve scope from a fixed-asset transaction row via its owning asset.
 */
export async function resolveFixedAssetTransactionScope(
  transactionId,
  tenantId
) {
  const id = parsePositiveInt(transactionId);
  const tid = parsePositiveInt(tenantId);
  if (!id || !tid) return null;

  const result = await query(
    `SELECT fa.legal_entity_id, fa.owner_operating_unit_id
       FROM fixed_asset_transactions fat
       JOIN fixed_assets fa ON fa.id = fat.asset_id
      WHERE fat.tenant_id = ? AND fat.id = ?
      LIMIT 1`,
    [tid, id]
  );
  const row = result.rows?.[0];
  if (!row) return null;

  const ouId = parsePositiveInt(row.owner_operating_unit_id);
  if (ouId) {
    return { scopeType: "OPERATING_UNIT", scopeId: ouId };
  }
  const leId = parsePositiveInt(row.legal_entity_id);
  return leId ? { scopeType: "LEGAL_ENTITY", scopeId: leId } : null;
}

/**
 * Resolve scope from a depreciation run row (legal-entity scope in MVP).
 */
export async function resolveFixedAssetRunScope(runId, tenantId) {
  const id = parsePositiveInt(runId);
  const tid = parsePositiveInt(tenantId);
  if (!id || !tid) return null;

  const result = await query(
    `SELECT legal_entity_id
       FROM fixed_asset_depreciation_runs
      WHERE tenant_id = ? AND id = ?
      LIMIT 1`,
    [tid, id]
  );
  const leId = parsePositiveInt(result.rows?.[0]?.legal_entity_id);
  return leId ? { scopeType: "LEGAL_ENTITY", scopeId: leId } : null;
}
