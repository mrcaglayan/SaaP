import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  getCloseConsolidationWorkflowReadiness,
  getOperatingUnitCurrentAccountReadiness,
  getShareholderCommitmentReadiness,
} from "./module-readiness.service.js";

const ACTIVATION_STAGE = "LEGAL_ENTITY_ACTIVATION";
const BASE_ACCOUNTING_CHECK_KEY = "baseAccountingStructure";
const WORKFLOW_CHECK_KEY = "workflowCloseConsolidation";
const OU_CURRENT_ACCOUNTS_CHECK_KEY = "operatingUnitCurrentAccounts";
const SHAREHOLDER_CHECK_KEY = "shareholderActivation";

function normalizeLegalEntityIds(legalEntityIds) {
  return Array.from(
    new Set(
      (Array.isArray(legalEntityIds) ? legalEntityIds : [])
        .map((value) => parsePositiveInt(value))
        .filter(Boolean),
    ),
  );
}

function getSingleModuleRow(payload, legalEntityId) {
  return (
    (Array.isArray(payload?.byLegalEntity) ? payload.byLegalEntity : []).find(
      (row) => parsePositiveInt(row?.legalEntityId) === parsePositiveInt(legalEntityId),
    ) || null
  );
}

function buildGenericCheck({ key, label, ready, applicable = true, blockerCode = null, details = null }) {
  return {
    key,
    label,
    ready: Boolean(ready),
    applicable: Boolean(applicable),
    blockerCode: String(blockerCode || "").trim() || null,
    details: details || null,
  };
}

function buildBaseAccountingCheck({
  bookCount,
  usableCoaCount,
  openPeriodCount,
}) {
  const blockingReasons = [];
  if (bookCount < 1) {
    blockingReasons.push("MISSING_BOOK");
  }
  if (usableCoaCount < 1) {
    blockingReasons.push("MISSING_USABLE_COA");
  }
  if (openPeriodCount < 1) {
    blockingReasons.push("MISSING_OPEN_BOOK_PERIOD");
  }

  return buildGenericCheck({
    key: BASE_ACCOUNTING_CHECK_KEY,
    label: "Base accounting structure",
    ready: blockingReasons.length === 0,
    blockerCode: blockingReasons[0] || "READY",
    details: {
      bookCount,
      usableCoaCount,
      openPeriodCount,
      blockingReasons,
    },
  });
}

function buildWorkflowCheck(workflowRow) {
  const row = workflowRow || null;
  let blockerCode = "READY";
  if (!row?.ready) {
    if (Array.isArray(row?.missingProcessTypes) && row.missingProcessTypes.length > 0) {
      blockerCode = "MISSING_ASSIGNMENT";
    } else if (Array.isArray(row?.invalidDefinitions) && row.invalidDefinitions.length > 0) {
      blockerCode = "INVALID_DEFINITION";
    } else if (
      Array.isArray(row?.invalidStepPermissions) &&
      row.invalidStepPermissions.length > 0
    ) {
      blockerCode = "INVALID_STEP_PERMISSIONS";
    } else {
      blockerCode = "WORKFLOW_NOT_READY";
    }
  }

  return buildGenericCheck({
    key: WORKFLOW_CHECK_KEY,
    label: "Workflow close/consolidation",
    ready: Boolean(row?.ready),
    blockerCode,
    details: row,
  });
}

function buildOperatingUnitCurrentAccountsCheck(operatingUnitRow) {
  const row = operatingUnitRow || null;
  const applicable = row?.applicable !== false;
  return buildGenericCheck({
    key: OU_CURRENT_ACCOUNTS_CHECK_KEY,
    label: "Operating-unit current accounts",
    ready: Boolean(row?.ready),
    applicable,
    blockerCode: row?.blockerCode || (row?.ready ? "READY" : "NOT_READY"),
    details: row,
  });
}

function buildShareholderActivationCheck({ shareholderCount, shareholderMappingRow }) {
  const mappingRow = shareholderMappingRow || null;
  const shareholderMasterPresent = shareholderCount > 0;
  const shareholderCommitmentMappingReady = Boolean(mappingRow?.ready);

  let blockerCode = "READY";
  if (!shareholderMasterPresent) {
    blockerCode = "MISSING_SHAREHOLDER_MASTER";
  } else if (!shareholderCommitmentMappingReady) {
    blockerCode = "SHAREHOLDER_PARENT_MAPPING_INCOMPLETE";
  }

  return buildGenericCheck({
    key: SHAREHOLDER_CHECK_KEY,
    label: "Shareholder activation",
    ready: shareholderMasterPresent && shareholderCommitmentMappingReady,
    blockerCode,
    details: {
      shareholderMasterPresent,
      shareholderCount,
      shareholderCommitmentMappingReady,
      mappingMissingPurposeCodes: Array.isArray(mappingRow?.missingPurposeCodes)
        ? mappingRow.missingPurposeCodes
        : [],
      mappingInvalidMappings: Array.isArray(mappingRow?.invalidMappings)
        ? mappingRow.invalidMappings
        : [],
    },
  });
}

function buildActivationStatus(checks) {
  const readyCheckCount = checks.filter((check) => Boolean(check?.ready)).length;
  const totalCheckCount = checks.length;
  const blockingCheckCount = checks.filter(
    (check) => check?.applicable !== false && !check?.ready,
  ).length;

  let status = "READY";
  if (blockingCheckCount > 0 && readyCheckCount === 0) {
    status = "NOT_STARTED";
  } else if (blockingCheckCount > 0) {
    status = "IN_PROGRESS";
  }

  return {
    ready: blockingCheckCount === 0,
    status,
    summary: {
      readyCheckCount,
      totalCheckCount,
      blockingCheckCount,
    },
  };
}

async function loadActivationLegalEntityRows({ tenantId, legalEntityIds, runQuery = query }) {
  if (legalEntityIds.length === 0) {
    return [];
  }
  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT id, code, name
     FROM legal_entities
     WHERE tenant_id = ?
       AND id IN (${placeholders})
     ORDER BY code, id`,
    [tenantId, ...legalEntityIds],
  );
  return result.rows || [];
}

async function loadBookCountsByLegalEntity({ tenantId, legalEntityIds, runQuery = query }) {
  if (legalEntityIds.length === 0) {
    return new Map();
  }
  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT legal_entity_id, COUNT(*) AS count
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id IN (${placeholders})
     GROUP BY legal_entity_id`,
    [tenantId, ...legalEntityIds],
  );
  return new Map(
    (result.rows || []).map((row) => [
      parsePositiveInt(row.legal_entity_id),
      Number(row.count || 0),
    ]),
  );
}

async function loadOpenPeriodCountsByLegalEntity({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  if (legalEntityIds.length === 0) {
    return new Map();
  }
  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       b.legal_entity_id,
       COUNT(DISTINCT CONCAT(b.id, ':', fp.id)) AS count
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
      AND fp.is_adjustment = FALSE
     LEFT JOIN period_statuses ps
       ON ps.book_id = b.id
      AND ps.fiscal_period_id = fp.id
     WHERE b.tenant_id = ?
       AND b.legal_entity_id IN (${placeholders})
       AND COALESCE(ps.status, 'OPEN') = 'OPEN'
     GROUP BY b.legal_entity_id`,
    [tenantId, ...legalEntityIds],
  );
  return new Map(
    (result.rows || []).map((row) => [
      parsePositiveInt(row.legal_entity_id),
      Number(row.count || 0),
    ]),
  );
}

async function loadUsableCoaCountsByLegalEntity({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  if (legalEntityIds.length === 0) {
    return new Map();
  }
  const placeholders = legalEntityIds.map(() => "?").join(", ");

  const groupResult = await runQuery(
    `SELECT COUNT(DISTINCT c.id) AS count
     FROM charts_of_accounts c
     WHERE c.tenant_id = ?
       AND c.scope = 'GROUP'
       AND EXISTS (
         SELECT 1
         FROM accounts a
         WHERE a.coa_id = c.id
           AND a.is_active = TRUE
       )`,
    [tenantId],
  );
  const groupUsableCount = Number(groupResult.rows?.[0]?.count || 0);

  const entityResult = await runQuery(
    `SELECT c.legal_entity_id, COUNT(DISTINCT c.id) AS count
     FROM charts_of_accounts c
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id IN (${placeholders})
       AND EXISTS (
         SELECT 1
         FROM accounts a
         WHERE a.coa_id = c.id
           AND a.is_active = TRUE
       )
     GROUP BY c.legal_entity_id`,
    [tenantId, ...legalEntityIds],
  );

  const counts = new Map();
  for (const legalEntityId of legalEntityIds) {
    counts.set(legalEntityId, groupUsableCount);
  }
  for (const row of entityResult.rows || []) {
    const legalEntityId = parsePositiveInt(row.legal_entity_id);
    if (!legalEntityId) {
      continue;
    }
    counts.set(legalEntityId, groupUsableCount + Number(row.count || 0));
  }
  return counts;
}

async function loadShareholderCountsByLegalEntity({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  if (legalEntityIds.length === 0) {
    return new Map();
  }
  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT legal_entity_id, COUNT(*) AS count
     FROM shareholders
     WHERE tenant_id = ?
       AND legal_entity_id IN (${placeholders})
     GROUP BY legal_entity_id`,
    [tenantId, ...legalEntityIds],
  );
  return new Map(
    (result.rows || []).map((row) => [
      parsePositiveInt(row.legal_entity_id),
      Number(row.count || 0),
    ]),
  );
}

async function loadModuleRowsByLegalEntity({ tenantId, legalEntityIds, runQuery = query }) {
  const workflowByLegalEntityId = new Map();
  const operatingUnitCurrentAccountsByLegalEntityId = new Map();
  const shareholderCommitmentByLegalEntityId = new Map();

  await Promise.all(
    legalEntityIds.map(async (legalEntityId) => {
      const [workflow, operatingUnitCurrentAccounts, shareholderCommitment] =
        await Promise.all([
          getCloseConsolidationWorkflowReadiness(tenantId, legalEntityId, { runQuery }),
          getOperatingUnitCurrentAccountReadiness(tenantId, legalEntityId, { runQuery }),
          getShareholderCommitmentReadiness(tenantId, legalEntityId, { runQuery }),
        ]);

      workflowByLegalEntityId.set(
        legalEntityId,
        getSingleModuleRow(workflow, legalEntityId),
      );
      operatingUnitCurrentAccountsByLegalEntityId.set(
        legalEntityId,
        getSingleModuleRow(operatingUnitCurrentAccounts, legalEntityId),
      );
      shareholderCommitmentByLegalEntityId.set(
        legalEntityId,
        getSingleModuleRow(shareholderCommitment, legalEntityId),
      );
    }),
  );

  return {
    workflowByLegalEntityId,
    operatingUnitCurrentAccountsByLegalEntityId,
    shareholderCommitmentByLegalEntityId,
  };
}

/**
 * Build the scoped legal-entity activation readiness payload. The caller must
 * pass the already-filtered `legalEntityIds` set; this service never expands
 * visibility beyond that explicit input.
 */
export async function getLegalEntityActivationReadiness(
  tenantId,
  { legalEntityIds, runQuery = query } = {},
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const normalizedLegalEntityIds = normalizeLegalEntityIds(legalEntityIds);
  if (normalizedLegalEntityIds.length === 0) {
    return {
      tenantId: normalizedTenantId,
      stage: ACTIVATION_STAGE,
      byLegalEntity: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const [
    legalEntityRows,
    bookCountsByLegalEntityId,
    usableCoaCountsByLegalEntityId,
    openPeriodCountsByLegalEntityId,
    shareholderCountsByLegalEntityId,
    moduleRowsByLegalEntity,
  ] = await Promise.all([
    loadActivationLegalEntityRows({
      tenantId: normalizedTenantId,
      legalEntityIds: normalizedLegalEntityIds,
      runQuery,
    }),
    loadBookCountsByLegalEntity({
      tenantId: normalizedTenantId,
      legalEntityIds: normalizedLegalEntityIds,
      runQuery,
    }),
    loadUsableCoaCountsByLegalEntity({
      tenantId: normalizedTenantId,
      legalEntityIds: normalizedLegalEntityIds,
      runQuery,
    }),
    loadOpenPeriodCountsByLegalEntity({
      tenantId: normalizedTenantId,
      legalEntityIds: normalizedLegalEntityIds,
      runQuery,
    }),
    loadShareholderCountsByLegalEntity({
      tenantId: normalizedTenantId,
      legalEntityIds: normalizedLegalEntityIds,
      runQuery,
    }),
    loadModuleRowsByLegalEntity({
      tenantId: normalizedTenantId,
      legalEntityIds: normalizedLegalEntityIds,
      runQuery,
    }),
  ]);

  const byLegalEntity = legalEntityRows.map((legalEntityRow) => {
    const legalEntityId = parsePositiveInt(legalEntityRow.id);
    const checks = [
      buildBaseAccountingCheck({
        bookCount: Number(bookCountsByLegalEntityId.get(legalEntityId) || 0),
        usableCoaCount: Number(usableCoaCountsByLegalEntityId.get(legalEntityId) || 0),
        openPeriodCount: Number(openPeriodCountsByLegalEntityId.get(legalEntityId) || 0),
      }),
      buildWorkflowCheck(moduleRowsByLegalEntity.workflowByLegalEntityId.get(legalEntityId)),
      buildOperatingUnitCurrentAccountsCheck(
        moduleRowsByLegalEntity.operatingUnitCurrentAccountsByLegalEntityId.get(legalEntityId),
      ),
      buildShareholderActivationCheck({
        shareholderCount: Number(shareholderCountsByLegalEntityId.get(legalEntityId) || 0),
        shareholderMappingRow:
          moduleRowsByLegalEntity.shareholderCommitmentByLegalEntityId.get(legalEntityId),
      }),
    ];

    const activationStatus = buildActivationStatus(checks);
    return {
      legalEntityId,
      legalEntityCode: String(legalEntityRow.code || "").trim(),
      legalEntityName: String(legalEntityRow.name || "").trim(),
      status: activationStatus.status,
      ready: activationStatus.ready,
      summary: activationStatus.summary,
      checks,
    };
  });

  return {
    tenantId: normalizedTenantId,
    stage: ACTIVATION_STAGE,
    byLegalEntity,
    generatedAt: new Date().toISOString(),
  };
}
