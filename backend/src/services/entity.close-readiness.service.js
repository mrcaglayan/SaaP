import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildLocalClosePackScopeKey,
  LOCAL_CLOSE_PACK_ENTITY_READINESS_STATE_VALUES,
} from "./local.close-packs.shared.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function mapMandatoryScope(row) {
  const closeScopeType = toUpperText(row?.closeScopeType ?? row?.close_scope_type);
  const operatingUnitId = parsePositiveInt(row?.operatingUnitId ?? row?.operating_unit_id);
  const scopeKey = buildLocalClosePackScopeKey({
    closeScopeType,
    operatingUnitId,
  });
  return {
    closeScopeType,
    operatingUnitId: operatingUnitId || null,
    operatingUnitCode: row?.operatingUnitCode ?? row?.operating_unit_code ?? null,
    operatingUnitName: row?.operatingUnitName ?? row?.operating_unit_name ?? null,
    scopeKey,
  };
}

function mapPackStatusRow(row) {
  return {
    id: parsePositiveInt(row?.id),
    scopeKey: String(row?.scope_key || ""),
    closeScopeType: toUpperText(row?.close_scope_type),
    operatingUnitId: parsePositiveInt(row?.operating_unit_id),
    operatingUnitCode: row?.operating_unit_code || null,
    operatingUnitName: row?.operating_unit_name || null,
    status: toUpperText(row?.status),
  };
}

function buildScopeReadinessRow(scopeRow, packRow = null) {
  return {
    closeScopeType: scopeRow.closeScopeType,
    operatingUnitId: scopeRow.operatingUnitId,
    operatingUnitCode: scopeRow.operatingUnitCode,
    operatingUnitName: scopeRow.operatingUnitName,
    scopeKey: scopeRow.scopeKey,
    localClosePackId: parsePositiveInt(packRow?.id),
    status: packRow?.status || "NOT_OPENED",
  };
}

function deriveEntityReadinessState(scopeRows) {
  const rows = Array.isArray(scopeRows) ? scopeRows : [];
  const everyApprovedOrLocked =
    rows.length > 0 &&
    rows.every((row) => ["APPROVED", "LOCKED"].includes(toUpperText(row?.status)));
  if (rows.some((row) => toUpperText(row?.status) === "REOPENED")) {
    return "ENTITY_REOPENED";
  }
  if (everyApprovedOrLocked) {
    return "READY_FOR_ENTITY_REVIEW";
  }
  if (
    rows.some((row) =>
      ["OPEN", "IN_PROGRESS", "READY_FOR_REVIEW", "RETURNED", "APPROVED", "LOCKED"].includes(
        toUpperText(row?.status)
      )
    )
  ) {
    return "PARTIALLY_READY";
  }
  return "NOT_READY";
}

/**
 * Derive entity close readiness from mandatory active OU scopes plus the
 * mandatory CENTRAL pack for one entity/book/period.
 *
 * RP09 keeps this as a derived read model so readiness invalidates immediately
 * when pack status changes without introducing a premature second state table.
 */
export async function getEntityCloseReadiness({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedBookId = parsePositiveInt(bookId);
  const normalizedFiscalPeriodId = parsePositiveInt(fiscalPeriodId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedLegalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (!normalizedBookId) {
    throw badRequest("bookId is required");
  }
  if (!normalizedFiscalPeriodId) {
    throw badRequest("fiscalPeriodId is required");
  }

  const [activeOperatingUnitsResult, packRowsResult] = await Promise.all([
    runQuery(
      `SELECT id, code, name
       FROM operating_units
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND status = 'ACTIVE'
       ORDER BY code ASC, id ASC`,
      [normalizedTenantId, normalizedLegalEntityId]
    ),
    runQuery(
      `SELECT
         lcp.id,
         lcp.scope_key,
         lcp.close_scope_type,
         lcp.operating_unit_id,
         lcp.status,
         ou.code AS operating_unit_code,
         ou.name AS operating_unit_name
       FROM local_close_packs lcp
       LEFT JOIN operating_units ou ON ou.id = lcp.operating_unit_id
       WHERE lcp.tenant_id = ?
         AND lcp.legal_entity_id = ?
         AND lcp.book_id = ?
         AND lcp.fiscal_period_id = ?`,
      [
        normalizedTenantId,
        normalizedLegalEntityId,
        normalizedBookId,
        normalizedFiscalPeriodId,
      ]
    ),
  ]);

  const mandatoryScopes = [
    mapMandatoryScope({
      closeScopeType: "CENTRAL",
      operatingUnitId: null,
      operatingUnitCode: null,
      operatingUnitName: "CENTRAL",
    }),
    ...(activeOperatingUnitsResult.rows || []).map((row) =>
      mapMandatoryScope({
        closeScopeType: "OPERATING_UNIT",
        operatingUnitId: row.id,
        operatingUnitCode: row.code,
        operatingUnitName: row.name,
      })
    ),
  ];

  const packRowByScopeKey = new Map(
    (packRowsResult.rows || []).map((row) => {
      const mappedRow = mapPackStatusRow(row);
      return [mappedRow.scopeKey, mappedRow];
    })
  );

  const mandatoryPackRows = mandatoryScopes.map((scopeRow) =>
    buildScopeReadinessRow(scopeRow, packRowByScopeKey.get(scopeRow.scopeKey) || null)
  );
  const missingMandatoryScopes = mandatoryPackRows.filter((row) => row.status === "NOT_OPENED");
  const invalidatingScopes = mandatoryPackRows.filter((row) =>
    ["RETURNED", "REOPENED"].includes(toUpperText(row.status))
  );
  const approvedOrLockedMandatoryScopeCount = mandatoryPackRows.filter((row) =>
    ["APPROVED", "LOCKED"].includes(toUpperText(row.status))
  ).length;

  const state = deriveEntityReadinessState(mandatoryPackRows);
  if (!LOCAL_CLOSE_PACK_ENTITY_READINESS_STATE_VALUES.includes(state)) {
    throw new Error(`Unsupported entity readiness state: ${state}`);
  }

  return {
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedFiscalPeriodId,
    state,
    mandatoryScopeCount: mandatoryPackRows.length,
    approvedOrLockedMandatoryScopeCount,
    reopenedMandatoryScopeCount: mandatoryPackRows.filter(
      (row) => toUpperText(row.status) === "REOPENED"
    ).length,
    returnedMandatoryScopeCount: mandatoryPackRows.filter(
      (row) => toUpperText(row.status) === "RETURNED"
    ).length,
    mandatoryScopes: mandatoryPackRows,
    missingMandatoryScopes,
    invalidatingScopes,
  };
}

export default {
  getEntityCloseReadiness,
};
