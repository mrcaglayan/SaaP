import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  getCloseConsolidationWorkflowReadiness,
  getOperatingUnitCurrentAccountReadiness,
} from "./module-readiness.service.js";

const SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE =
  "SHAREHOLDER_CAPITAL_CREDIT_PARENT";
const SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE =
  "SHAREHOLDER_COMMITMENT_DEBIT_PARENT";

export const READINESS_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "groupCompanies", label: "Group companies", minimum: 1 }),
  Object.freeze({ key: "legalEntities", label: "Legal entities", minimum: 1 }),
  Object.freeze({ key: "fiscalCalendars", label: "Fiscal calendars", minimum: 1 }),
  Object.freeze({ key: "fiscalPeriods", label: "Fiscal periods", minimum: 1 }),
  Object.freeze({ key: "books", label: "Books", minimum: 1 }),
  Object.freeze({ key: "openBookPeriods", label: "Open book periods", minimum: 1 }),
  Object.freeze({ key: "chartsOfAccounts", label: "Charts of accounts", minimum: 1 }),
  Object.freeze({ key: "accounts", label: "Accounts", minimum: 1 }),
  Object.freeze({ key: "shareholders", label: "Shareholders", minimum: 1 }),
  Object.freeze({
    key: "shareholderCommitmentConfigs",
    label: "Shareholder parent account mappings",
    minimum: 1,
  }),
  Object.freeze({ key: "subaccountsV1", label: "Subaccounts V1 placeholder", minimum: 0 }),
  Object.freeze({ key: "setupWizardV2", label: "Setup Wizard V2 placeholder", minimum: 0 }),
  Object.freeze({
    key: "consolidationCanonicalMappingV1",
    label: "Consolidation canonical mapping placeholder",
    minimum: 0,
  }),
  Object.freeze({
    key: "operatingUnitCurrentAccounts",
    label: "Operating-unit current-account readiness",
    minimum: 0,
  }),
  Object.freeze({
    key: "workflowCloseConsolidationV1",
    label: "Workflow close/consolidation readiness",
    minimum: 1,
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

function buildLegalEntityStatusDetails(rows = []) {
  return rows.map((row) => ({
    legalEntityId: parsePositiveInt(row?.legalEntityId),
    legalEntityCode: String(row?.legalEntityCode || "").trim(),
    legalEntityName: String(row?.legalEntityName || "").trim(),
    blockerCode: String(row?.blockerCode || "").trim() || null,
    setupPath: String(row?.setupPath || "").trim() || null,
    effectiveActiveOperatingUnitCount:
      parsePositiveInt(row?.effectiveActiveOperatingUnitCount) || 0,
    missingCentralOperatingUnitCount: Array.isArray(row?.missingCentralOperatingUnits)
      ? row.missingCentralOperatingUnits.length
      : 0,
    missingPartnerDirectionCount: parsePositiveInt(row?.missingPartnerDirectionCount) || 0,
  }));
}

/**
 * Build a tenant readiness snapshot while ignoring inactive legal entities for
 * tenant-wide operational blockers.
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
    shareholders,
    shareholderCommitmentConfigs,
    workflowModuleReadiness,
    operatingUnitCurrentAccountReadiness,
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
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM shareholders
       WHERE tenant_id = ?`,
      [normalizedTenantId],
      runQuery
    ),
    scalarCount(
      `SELECT COUNT(*) AS count
       FROM legal_entities le
       WHERE le.tenant_id = ?
         AND EXISTS (
           SELECT 1
           FROM journal_purpose_accounts cap
           WHERE cap.tenant_id = le.tenant_id
             AND cap.legal_entity_id = le.id
             AND cap.purpose_code = ?
         )
         AND EXISTS (
           SELECT 1
           FROM journal_purpose_accounts deb
           WHERE deb.tenant_id = le.tenant_id
             AND deb.legal_entity_id = le.id
             AND deb.purpose_code = ?
         )`,
      [
        normalizedTenantId,
        SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE,
        SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE,
      ],
      runQuery
    ),
    getCloseConsolidationWorkflowReadiness(normalizedTenantId, null, {
      runQuery,
    }),
    getOperatingUnitCurrentAccountReadiness(normalizedTenantId, null, {
      runQuery,
    }),
  ]);

  const workflowRows = Array.isArray(workflowModuleReadiness?.byLegalEntity)
    ? workflowModuleReadiness.byLegalEntity
    : [];
  const workflowReadyCount = workflowRows.filter((row) => Boolean(row?.ready)).length;
  const workflowMinimum = workflowRows.length;
  const workflowMissingLegalEntityIds = workflowRows
    .filter((row) => !row?.ready)
    .map((row) => parsePositiveInt(row?.legalEntityId))
    .filter(Boolean);

  const operatingUnitRows = Array.isArray(operatingUnitCurrentAccountReadiness?.byLegalEntity)
    ? operatingUnitCurrentAccountReadiness.byLegalEntity
    : [];
  const operatingUnitReadyCount = operatingUnitRows.filter((row) => Boolean(row?.ready)).length;
  const operatingUnitMinimum = operatingUnitRows.length;
  const operatingUnitBlockingRows = operatingUnitRows.filter((row) => !row?.ready);
  const operatingUnitApplicableEntityCount = operatingUnitRows.filter((row) =>
    Boolean(row?.applicable)
  ).length;

  const counts = {
    groupCompanies,
    legalEntities,
    fiscalCalendars,
    fiscalPeriods,
    books,
    openBookPeriods,
    chartsOfAccounts,
    accounts,
    shareholders,
    shareholderCommitmentConfigs,
    operatingUnitCurrentAccounts: operatingUnitReadyCount,
    workflowCloseConsolidationV1: workflowReadyCount,
  };

  const checks = READINESS_DEFINITIONS.map((definition) => {
    if (definition.key === "workflowCloseConsolidationV1") {
      return {
        ...definition,
        count: workflowReadyCount,
        minimum: workflowMinimum,
        ready: workflowReadyCount >= workflowMinimum,
        details: {
          readyEntityCount: workflowReadyCount,
          totalEntityCount: workflowRows.length,
          missingLegalEntityIds: workflowMissingLegalEntityIds,
        },
      };
    }

    if (definition.key === "operatingUnitCurrentAccounts") {
      return {
        ...definition,
        count: operatingUnitReadyCount,
        minimum: operatingUnitMinimum,
        ready: operatingUnitReadyCount >= operatingUnitMinimum,
        details: {
          readyEntityCount: operatingUnitReadyCount,
          totalEntityCount: operatingUnitRows.length,
          applicableEntityCount: operatingUnitApplicableEntityCount,
          blockingRows: buildLegalEntityStatusDetails(operatingUnitBlockingRows),
        },
      };
    }

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
