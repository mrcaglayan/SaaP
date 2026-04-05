import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

// Tenant readiness is intentionally limited to bootstrap structure. Entity
// activation blockers are evaluated in the per-legal-entity activation stage.
export const READINESS_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "groupCompanies", label: "Group companies", minimum: 1 }),
  Object.freeze({ key: "legalEntities", label: "Legal entities", minimum: 1 }),
  Object.freeze({ key: "fiscalCalendars", label: "Fiscal calendars", minimum: 1 }),
  Object.freeze({ key: "fiscalPeriods", label: "Fiscal periods", minimum: 1 }),
  Object.freeze({ key: "books", label: "Books", minimum: 1 }),
  Object.freeze({ key: "openBookPeriods", label: "Open book periods", minimum: 1 }),
  Object.freeze({ key: "chartsOfAccounts", label: "Charts of accounts", minimum: 1 }),
  Object.freeze({ key: "accounts", label: "Accounts", minimum: 1 }),
  Object.freeze({ key: "subaccountsV1", label: "Subaccounts V1 placeholder", minimum: 0 }),
  Object.freeze({ key: "setupWizardV2", label: "Setup Wizard V2 placeholder", minimum: 0 }),
  Object.freeze({
    key: "consolidationCanonicalMappingV1",
    label: "Consolidation canonical mapping placeholder",
    minimum: 0,
  }),
  Object.freeze({
    key: "taxEngineV1",
    label: "Country tax engine setup (optional)",
    minimum: 0,
  }),
]);

async function scalarCount(sql, params = [], runQuery = query) {
  const result = await runQuery(sql, params);
  const count = Number(result.rows[0]?.count || 0);
  return Number.isFinite(count) ? count : 0;
}

/**
 * Build a tenant bootstrap readiness snapshot for the minimum shared tenant
 * structure. Legal-entity activation blockers are intentionally excluded.
 */
export async function getTenantReadinessSnapshot(
  tenantId,
  { runQuery = query } = {}
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const [
    groupCompanies,
    legalEntities,
    fiscalCalendars,
    fiscalPeriods,
    books,
    openBookPeriods,
    chartsOfAccounts,
    accounts,
  ] = await Promise.all([
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM group_companies
       WHERE tenant_id = ?`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM legal_entities
       WHERE tenant_id = ?
         AND status = 'ACTIVE'`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM fiscal_calendars
       WHERE tenant_id = ?`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM fiscal_periods fp
       JOIN fiscal_calendars fc ON fc.id = fp.calendar_id
       WHERE fc.tenant_id = ?`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM books
       WHERE tenant_id = ?`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM books b
       JOIN fiscal_periods fp
         ON fp.calendar_id = b.calendar_id
        AND fp.is_adjustment = FALSE
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id
        AND ps.fiscal_period_id = fp.id
       WHERE b.tenant_id = ?
         AND COALESCE(ps.status, 'OPEN') = 'OPEN'`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM charts_of_accounts
       WHERE tenant_id = ?`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE c.tenant_id = ?`,
      [normalizedTenantId],
      runQuery
    ),
  ]);

  const counts = {
    groupCompanies,
    legalEntities,
    fiscalCalendars,
    fiscalPeriods,
    books,
    openBookPeriods,
    chartsOfAccounts,
    accounts,
  };

  const checks = READINESS_DEFINITIONS.map((definition) => {
    const count = Number(counts[definition.key] || 0);
    return {
      ...definition,
      count,
      minimum: definition.minimum,
      ready: count >= definition.minimum,
      details: null,
    };
  });

  const missing = checks.filter((check) => !check.ready);
  return {
    tenantId: normalizedTenantId,
    ready: missing.length === 0,
    checks,
    counts,
    missingKeys: missing.map((check) => check.key),
    generatedAt: new Date().toISOString(),
  };
}
