/**
 * Fixed-assets reporting service.
 *
 * Owns report SQL for register, depreciation schedule, additions,
 * disposals, transfers, by-owner-OU, by-location-OU, by-custodian,
 * depreciation-by-owner-OU, rollforward, and paired /export endpoints.
 *
 * Each report returns { rows, totals } for on-screen display.
 * Each paired export returns { csv, fileName, rowCount } for CSV download.
 */

import { query } from "../db.js";
import { badRequest } from "../routes/_utils.js";

// ── CSV helpers ──────────────────────────────────────────────────

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers, rows) {
  const headerLine = headers.map(escapeCsvValue).join(",");
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsvValue(row[h])).join(",")
  );
  return [headerLine, ...dataLines].join("\n");
}

// ── Shared filter builder ────────────────────────────────────────

function buildRegisterConditions(filters) {
  const conditions = ["fa.tenant_id = ?"];
  const params = [filters.tenantId];

  if (filters.legalEntityId) {
    conditions.push("fa.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.ownerOperatingUnitId) {
    conditions.push("fa.owner_operating_unit_id = ?");
    params.push(filters.ownerOperatingUnitId);
  }
  if (filters.locationOperatingUnitId) {
    conditions.push("fa.location_operating_unit_id = ?");
    params.push(filters.locationOperatingUnitId);
  }
  if (filters.categoryId) {
    conditions.push("fa.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.custodianId) {
    conditions.push("fa.custodian_employee_id = ?");
    params.push(filters.custodianId);
  }
  if (filters.status) {
    conditions.push("fa.status = ?");
    params.push(filters.status);
  }
  if (filters.departmentCode) {
    conditions.push("fa.department_code = ?");
    params.push(filters.departmentCode);
  }
  if (filters.costCenterCode) {
    conditions.push("fa.cost_center_code = ?");
    params.push(filters.costCenterCode);
  }
  if (filters.disposed === true) {
    conditions.push("fa.status = 'DISPOSED'");
  } else if (filters.disposed === false) {
    conditions.push("fa.status != 'DISPOSED'");
  }

  return { conditions, params };
}

// ── Transaction filter builder ───────────────────────────────────

function buildTransactionConditions(filters, alias = "txn") {
  const conditions = [`${alias}.tenant_id = ?`];
  const params = [filters.tenantId];

  if (filters.legalEntityId) {
    conditions.push(`${alias}.legal_entity_id = ?`);
    params.push(filters.legalEntityId);
  }
  if (filters.dateFrom) {
    conditions.push(`${alias}.effective_date >= ?`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`${alias}.effective_date <= ?`);
    params.push(filters.dateTo);
  }

  // Only POSTED (non-reversed) transactions
  conditions.push(`${alias}.status = 'POSTED'`);

  return { conditions, params };
}

// ── Number coercion ──────────────────────────────────────────────

function num(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

// ═══════════════════════════════════════════════════════════════════
// 1. Register report
// ═══════════════════════════════════════════════════════════════════

export async function reportRegister(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const { conditions, params } = buildRegisterConditions(filters);

  const result = await query(
    `SELECT fa.id, fa.asset_no, fa.name, fa.status,
            fa.acquisition_date, fa.in_service_date, fa.disposal_date,
            fa.currency_code,
            fa.original_cost_txn, fa.original_cost_base,
            fa.salvage_value_base,
            fa.useful_life_months, fa.remaining_useful_life_months,
            fa.depreciation_method, fa.last_depreciation_period,
            fa.department_code, fa.cost_center_code,
            cat.code AS category_code, cat.name AS category_name,
            cust.display_name AS custodian_display_name,
            ownerOU.code AS owner_ou_code, ownerOU.name AS owner_ou_name,
            locOU.code AS location_ou_code, locOU.name AS location_ou_name
       FROM fixed_assets fa
       LEFT JOIN fixed_asset_categories cat ON cat.id = fa.category_id
       LEFT JOIN fixed_asset_custodian_employees cust ON cust.id = fa.custodian_employee_id
       LEFT JOIN operating_units ownerOU ON ownerOU.id = fa.owner_operating_unit_id
       LEFT JOIN operating_units locOU ON locOU.id = fa.location_operating_unit_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY fa.asset_no ASC`,
    params
  );

  const rows = result.rows || [];

  const totals = {
    count: rows.length,
    totalOriginalCostBase: rows.reduce((s, r) => s + num(r.original_cost_base), 0),
  };

  return { rows: rows.map(mapRegisterRow), totals };
}

function mapRegisterRow(r) {
  return {
    id: r.id,
    assetNo: r.asset_no,
    name: r.name,
    status: r.status,
    categoryCode: r.category_code || null,
    categoryName: r.category_name || null,
    ownerOuCode: r.owner_ou_code || null,
    ownerOuName: r.owner_ou_name || null,
    locationOuCode: r.location_ou_code || null,
    locationOuName: r.location_ou_name || null,
    custodianDisplayName: r.custodian_display_name || null,
    departmentCode: r.department_code || null,
    costCenterCode: r.cost_center_code || null,
    acquisitionDate: r.acquisition_date,
    inServiceDate: r.in_service_date || null,
    disposalDate: r.disposal_date || null,
    currencyCode: r.currency_code,
    originalCostTxn: num(r.original_cost_txn),
    originalCostBase: num(r.original_cost_base),
    salvageValueBase: num(r.salvage_value_base),
    usefulLifeMonths: r.useful_life_months != null ? Number(r.useful_life_months) : null,
    depreciationMethod: r.depreciation_method || null,
    lastDepreciationPeriod: r.last_depreciation_period || null,
  };
}

const REGISTER_HEADERS = [
  "assetNo", "name", "status", "categoryCode", "categoryName",
  "ownerOuCode", "locationOuCode", "custodianDisplayName",
  "departmentCode", "costCenterCode", "acquisitionDate", "inServiceDate",
  "disposalDate", "currencyCode", "originalCostTxn", "originalCostBase",
  "salvageValueBase", "usefulLifeMonths", "depreciationMethod",
];

export async function exportRegister(filters) {
  const { rows } = await reportRegister(filters);
  return {
    csv: buildCsv(REGISTER_HEADERS, rows),
    fileName: "fa-register.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Depreciation schedule report
// ═══════════════════════════════════════════════════════════════════

export async function reportDepreciationSchedule(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const conditions = ["sl.tenant_id = ?"];
  const params = [filters.tenantId];

  if (filters.legalEntityId) {
    conditions.push("sl.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.assetId) {
    conditions.push("sl.asset_id = ?");
    params.push(filters.assetId);
  }

  const result = await query(
    `SELECT sl.id, sl.asset_id, sl.period_key, sl.line_no,
            sl.planned_amount_txn, sl.planned_amount_base,
            sl.opening_nbv_txn, sl.opening_nbv_base,
            sl.closing_nbv_txn, sl.closing_nbv_base,
            sl.status AS schedule_status,
            fa.asset_no, fa.name AS asset_name, fa.currency_code
       FROM fixed_asset_depreciation_schedule_lines sl
       JOIN fixed_assets fa ON fa.id = sl.asset_id AND fa.tenant_id = sl.tenant_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY fa.asset_no ASC, sl.period_key ASC, sl.line_no ASC`,
    params
  );

  const rows = (result.rows || []).map((r) => ({
    assetNo: r.asset_no,
    assetName: r.asset_name,
    currencyCode: r.currency_code,
    periodKey: r.period_key,
    lineNo: r.line_no != null ? Number(r.line_no) : null,
    plannedAmountTxn: num(r.planned_amount_txn),
    plannedAmountBase: num(r.planned_amount_base),
    openingNbvTxn: num(r.opening_nbv_txn),
    openingNbvBase: num(r.opening_nbv_base),
    closingNbvTxn: num(r.closing_nbv_txn),
    closingNbvBase: num(r.closing_nbv_base),
    scheduleStatus: r.schedule_status,
  }));

  const totals = {
    count: rows.length,
    totalPlannedBase: rows.reduce((s, r) => s + r.plannedAmountBase, 0),
  };

  return { rows, totals };
}

const SCHEDULE_HEADERS = [
  "assetNo", "assetName", "currencyCode", "periodKey", "lineNo",
  "plannedAmountTxn", "plannedAmountBase", "openingNbvTxn", "openingNbvBase",
  "closingNbvTxn", "closingNbvBase", "scheduleStatus",
];

export async function exportDepreciationSchedule(filters) {
  const { rows } = await reportDepreciationSchedule(filters);
  return {
    csv: buildCsv(SCHEDULE_HEADERS, rows),
    fileName: "fa-depreciation-schedule.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Additions report (ACQUISITION vs CAPITALIZATION)
// ═══════════════════════════════════════════════════════════════════

export async function reportAdditions(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const { conditions, params } = buildTransactionConditions(filters);
  conditions.push("txn.transaction_type IN ('ACQUISITION','CAPITALIZATION')");

  if (filters.categoryId) {
    conditions.push("fa.category_id = ?");
    params.push(filters.categoryId);
  }

  const result = await query(
    `SELECT txn.id AS transaction_id,
            txn.transaction_type, txn.effective_date, txn.posting_date,
            txn.depreciation_kind,
            txn.currency_code,
            txn.gross_amount_txn, txn.gross_amount_base,
            fa.id AS asset_id, fa.asset_no, fa.name AS asset_name, fa.status AS asset_status,
            cat.code AS category_code, cat.name AS category_name,
            cat.capitalization_threshold_base,
            ownerOU.code AS owner_ou_code
       FROM fixed_asset_transactions txn
       JOIN fixed_assets fa ON fa.id = txn.asset_id AND fa.tenant_id = txn.tenant_id
       LEFT JOIN fixed_asset_categories cat ON cat.id = fa.category_id
       LEFT JOIN operating_units ownerOU ON ownerOU.id = fa.owner_operating_unit_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY txn.effective_date ASC, fa.asset_no ASC`,
    params
  );

  const rows = (result.rows || []).map((r) => {
    const grossBase = num(r.gross_amount_base);
    const threshold = num(r.capitalization_threshold_base);
    const isBelowThreshold = threshold > 0 && grossBase < threshold;
    const isLowValueFullExpense = r.depreciation_kind === "LOW_VALUE_FULL_EXPENSE";

    return {
      transactionId: r.transaction_id,
      transactionType: r.transaction_type,
      assetNo: r.asset_no,
      assetName: r.asset_name,
      assetStatus: r.asset_status,
      categoryCode: r.category_code || null,
      categoryName: r.category_name || null,
      ownerOuCode: r.owner_ou_code || null,
      effectiveDate: r.effective_date,
      postingDate: r.posting_date,
      currencyCode: r.currency_code,
      grossAmountTxn: num(r.gross_amount_txn),
      grossAmountBase: grossBase,
      depreciationKind: r.depreciation_kind || null,
      isBelowThreshold,
      isLowValueFullExpense,
    };
  });

  const acquisitions = rows.filter((r) => r.transactionType === "ACQUISITION");
  const capitalizations = rows.filter((r) => r.transactionType === "CAPITALIZATION");

  const totals = {
    count: rows.length,
    acquisitionCount: acquisitions.length,
    acquisitionTotalBase: acquisitions.reduce((s, r) => s + r.grossAmountBase, 0),
    capitalizationCount: capitalizations.length,
    capitalizationTotalBase: capitalizations.reduce((s, r) => s + r.grossAmountBase, 0),
    belowThresholdCount: rows.filter((r) => r.isBelowThreshold).length,
    lowValueFullExpenseCount: rows.filter((r) => r.isLowValueFullExpense).length,
  };

  return { rows, totals };
}

const ADDITIONS_HEADERS = [
  "assetNo", "assetName", "transactionType", "categoryCode",
  "ownerOuCode", "effectiveDate", "postingDate",
  "currencyCode", "grossAmountTxn", "grossAmountBase",
  "depreciationKind", "isBelowThreshold", "isLowValueFullExpense",
];

export async function exportAdditions(filters) {
  const { rows } = await reportAdditions(filters);
  return {
    csv: buildCsv(ADDITIONS_HEADERS, rows),
    fileName: "fa-additions.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Disposals report (WRITEOFF vs SALE)
// ═══════════════════════════════════════════════════════════════════

export async function reportDisposals(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const { conditions, params } = buildTransactionConditions(filters);
  conditions.push("txn.transaction_type IN ('WRITEOFF','SALE')");

  const result = await query(
    `SELECT txn.id AS transaction_id,
            txn.transaction_type, txn.effective_date, txn.posting_date,
            txn.currency_code,
            txn.gross_amount_txn, txn.gross_amount_base,
            txn.accum_depr_amount_txn, txn.accum_depr_amount_base,
            txn.nbv_amount_txn, txn.nbv_amount_base,
            txn.proceeds_amount_txn, txn.proceeds_amount_base,
            fa.id AS asset_id, fa.asset_no, fa.name AS asset_name,
            cat.code AS category_code,
            ownerOU.code AS owner_ou_code
       FROM fixed_asset_transactions txn
       JOIN fixed_assets fa ON fa.id = txn.asset_id AND fa.tenant_id = txn.tenant_id
       LEFT JOIN fixed_asset_categories cat ON cat.id = fa.category_id
       LEFT JOIN operating_units ownerOU ON ownerOU.id = fa.owner_operating_unit_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY txn.effective_date ASC, fa.asset_no ASC`,
    params
  );

  const rows = (result.rows || []).map((r) => ({
    transactionId: r.transaction_id,
    transactionType: r.transaction_type,
    assetNo: r.asset_no,
    assetName: r.asset_name,
    categoryCode: r.category_code || null,
    ownerOuCode: r.owner_ou_code || null,
    effectiveDate: r.effective_date,
    postingDate: r.posting_date,
    currencyCode: r.currency_code,
    grossAmountTxn: num(r.gross_amount_txn),
    grossAmountBase: num(r.gross_amount_base),
    accumDeprAmountTxn: num(r.accum_depr_amount_txn),
    accumDeprAmountBase: num(r.accum_depr_amount_base),
    nbvAmountTxn: num(r.nbv_amount_txn),
    nbvAmountBase: num(r.nbv_amount_base),
    proceedsAmountTxn: num(r.proceeds_amount_txn),
    proceedsAmountBase: num(r.proceeds_amount_base),
  }));

  const writeoffs = rows.filter((r) => r.transactionType === "WRITEOFF");
  const sales = rows.filter((r) => r.transactionType === "SALE");

  const totals = {
    count: rows.length,
    writeoffCount: writeoffs.length,
    writeoffTotalNbvBase: writeoffs.reduce((s, r) => s + r.nbvAmountBase, 0),
    saleCount: sales.length,
    saleTotalNbvBase: sales.reduce((s, r) => s + r.nbvAmountBase, 0),
    saleTotalProceedsBase: sales.reduce((s, r) => s + r.proceedsAmountBase, 0),
  };

  return { rows, totals };
}

const DISPOSALS_HEADERS = [
  "assetNo", "assetName", "transactionType", "categoryCode",
  "ownerOuCode", "effectiveDate", "postingDate",
  "currencyCode", "grossAmountTxn", "grossAmountBase",
  "accumDeprAmountBase", "nbvAmountBase",
  "proceedsAmountTxn", "proceedsAmountBase",
];

export async function exportDisposals(filters) {
  const { rows } = await reportDisposals(filters);
  return {
    csv: buildCsv(DISPOSALS_HEADERS, rows),
    fileName: "fa-disposals.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Transfers report
//    Reads from fixed_asset_ownership_transfer_details for
//    DAILY_PRORATA effective-date splits and cutoffs.
// ═══════════════════════════════════════════════════════════════════

export async function reportTransfers(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const { conditions, params } = buildTransactionConditions(filters);
  conditions.push("txn.transaction_type = 'OWNERSHIP_TRANSFER'");

  const result = await query(
    `SELECT txn.id AS transaction_id,
            txn.effective_date, txn.posting_date, txn.currency_code,
            txn.gross_amount_txn, txn.gross_amount_base,
            txn.accum_depr_amount_txn, txn.accum_depr_amount_base,
            txn.nbv_amount_txn, txn.nbv_amount_base,
            fa.asset_no, fa.name AS asset_name,
            cat.code AS category_code,
            otd.from_owner_operating_unit_id, otd.to_owner_operating_unit_id,
            otd.from_location_operating_unit_id, otd.to_location_operating_unit_id,
            fromOU.code AS from_owner_ou_code, fromOU.name AS from_owner_ou_name,
            toOU.code AS to_owner_ou_code, toOU.name AS to_owner_ou_name
       FROM fixed_asset_transactions txn
       JOIN fixed_assets fa ON fa.id = txn.asset_id AND fa.tenant_id = txn.tenant_id
       LEFT JOIN fixed_asset_categories cat ON cat.id = fa.category_id
       LEFT JOIN fixed_asset_ownership_transfer_details otd
         ON otd.transaction_id = txn.id AND otd.tenant_id = txn.tenant_id
       LEFT JOIN operating_units fromOU ON fromOU.id = otd.from_owner_operating_unit_id
       LEFT JOIN operating_units toOU ON toOU.id = otd.to_owner_operating_unit_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY txn.effective_date ASC, fa.asset_no ASC`,
    params
  );

  const rows = (result.rows || []).map((r) => ({
    transactionId: r.transaction_id,
    assetNo: r.asset_no,
    assetName: r.asset_name,
    categoryCode: r.category_code || null,
    effectiveDate: r.effective_date,
    postingDate: r.posting_date,
    currencyCode: r.currency_code,
    grossAmountBase: num(r.gross_amount_base),
    accumDeprAmountBase: num(r.accum_depr_amount_base),
    nbvAmountBase: num(r.nbv_amount_base),
    fromOwnerOuCode: r.from_owner_ou_code || null,
    fromOwnerOuName: r.from_owner_ou_name || null,
    toOwnerOuCode: r.to_owner_ou_code || null,
    toOwnerOuName: r.to_owner_ou_name || null,
  }));

  const totals = {
    count: rows.length,
    totalGrossBase: rows.reduce((s, r) => s + r.grossAmountBase, 0),
    totalNbvBase: rows.reduce((s, r) => s + r.nbvAmountBase, 0),
  };

  return { rows, totals };
}

const TRANSFERS_HEADERS = [
  "assetNo", "assetName", "categoryCode", "effectiveDate", "postingDate",
  "currencyCode", "grossAmountBase", "accumDeprAmountBase", "nbvAmountBase",
  "fromOwnerOuCode", "toOwnerOuCode",
];

export async function exportTransfers(filters) {
  const { rows } = await reportTransfers(filters);
  return {
    csv: buildCsv(TRANSFERS_HEADERS, rows),
    fileName: "fa-transfers.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. By-owner-OU report
//    Current-position / register-style grouping by owner OU.
//    NOT period depreciation — that is depreciation-by-owner-ou.
// ═══════════════════════════════════════════════════════════════════

export async function reportByOwnerOu(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const { conditions, params } = buildRegisterConditions(filters);
  // Exclude DRAFT for meaningful register grouping
  if (!filters.status) {
    conditions.push("fa.status != 'DRAFT'");
  }

  const result = await query(
    `SELECT fa.owner_operating_unit_id,
            ownerOU.code AS owner_ou_code, ownerOU.name AS owner_ou_name,
            COUNT(*) AS asset_count,
            SUM(fa.original_cost_base) AS total_original_cost_base,
            SUM(fa.salvage_value_base) AS total_salvage_value_base
       FROM fixed_assets fa
       LEFT JOIN operating_units ownerOU ON ownerOU.id = fa.owner_operating_unit_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY fa.owner_operating_unit_id, ownerOU.code, ownerOU.name
      ORDER BY ownerOU.code ASC`,
    params
  );

  const rows = (result.rows || []).map((r) => ({
    ownerOperatingUnitId: r.owner_operating_unit_id != null
      ? Number(r.owner_operating_unit_id) : null,
    ownerOuCode: r.owner_ou_code || null,
    ownerOuName: r.owner_ou_name || null,
    assetCount: Number(r.asset_count),
    totalOriginalCostBase: num(r.total_original_cost_base),
    totalSalvageValueBase: num(r.total_salvage_value_base),
  }));

  const totals = {
    groupCount: rows.length,
    totalAssets: rows.reduce((s, r) => s + r.assetCount, 0),
    totalOriginalCostBase: rows.reduce((s, r) => s + r.totalOriginalCostBase, 0),
  };

  return { rows, totals };
}

const BY_OWNER_OU_HEADERS = [
  "ownerOuCode", "ownerOuName", "assetCount",
  "totalOriginalCostBase", "totalSalvageValueBase",
];

export async function exportByOwnerOu(filters) {
  const { rows } = await reportByOwnerOu(filters);
  return {
    csv: buildCsv(BY_OWNER_OU_HEADERS, rows),
    fileName: "fa-by-owner-ou.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 7. By-location-OU report
//    Current-position / register-style grouping by location OU.
// ═══════════════════════════════════════════════════════════════════

export async function reportByLocationOu(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const { conditions, params } = buildRegisterConditions(filters);
  if (!filters.status) {
    conditions.push("fa.status != 'DRAFT'");
  }

  const result = await query(
    `SELECT fa.location_operating_unit_id,
            locOU.code AS location_ou_code, locOU.name AS location_ou_name,
            COUNT(*) AS asset_count,
            SUM(fa.original_cost_base) AS total_original_cost_base
       FROM fixed_assets fa
       LEFT JOIN operating_units locOU ON locOU.id = fa.location_operating_unit_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY fa.location_operating_unit_id, locOU.code, locOU.name
      ORDER BY locOU.code ASC`,
    params
  );

  const rows = (result.rows || []).map((r) => ({
    locationOperatingUnitId: r.location_operating_unit_id != null
      ? Number(r.location_operating_unit_id) : null,
    locationOuCode: r.location_ou_code || null,
    locationOuName: r.location_ou_name || null,
    assetCount: Number(r.asset_count),
    totalOriginalCostBase: num(r.total_original_cost_base),
  }));

  const totals = {
    groupCount: rows.length,
    totalAssets: rows.reduce((s, r) => s + r.assetCount, 0),
    totalOriginalCostBase: rows.reduce((s, r) => s + r.totalOriginalCostBase, 0),
  };

  return { rows, totals };
}

const BY_LOCATION_OU_HEADERS = [
  "locationOuCode", "locationOuName", "assetCount", "totalOriginalCostBase",
];

export async function exportByLocationOu(filters) {
  const { rows } = await reportByLocationOu(filters);
  return {
    csv: buildCsv(BY_LOCATION_OU_HEADERS, rows),
    fileName: "fa-by-location-ou.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 8. By-custodian report
//    Current-position / register-style grouping by custodian.
// ═══════════════════════════════════════════════════════════════════

export async function reportByCustodian(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const { conditions, params } = buildRegisterConditions(filters);
  if (!filters.status) {
    conditions.push("fa.status != 'DRAFT'");
  }

  const result = await query(
    `SELECT fa.custodian_employee_id,
            cust.employee_code AS custodian_code,
            cust.display_name AS custodian_display_name,
            COUNT(*) AS asset_count,
            SUM(fa.original_cost_base) AS total_original_cost_base
       FROM fixed_assets fa
       LEFT JOIN fixed_asset_custodian_employees cust ON cust.id = fa.custodian_employee_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY fa.custodian_employee_id, cust.employee_code, cust.display_name
      ORDER BY cust.employee_code ASC`,
    params
  );

  const rows = (result.rows || []).map((r) => ({
    custodianEmployeeId: r.custodian_employee_id != null
      ? Number(r.custodian_employee_id) : null,
    custodianCode: r.custodian_code || null,
    custodianDisplayName: r.custodian_display_name || null,
    assetCount: Number(r.asset_count),
    totalOriginalCostBase: num(r.total_original_cost_base),
  }));

  const totals = {
    groupCount: rows.length,
    totalAssets: rows.reduce((s, r) => s + r.assetCount, 0),
    totalOriginalCostBase: rows.reduce((s, r) => s + r.totalOriginalCostBase, 0),
  };

  return { rows, totals };
}

const BY_CUSTODIAN_HEADERS = [
  "custodianCode", "custodianDisplayName", "assetCount", "totalOriginalCostBase",
];

export async function exportByCustodian(filters) {
  const { rows } = await reportByCustodian(filters);
  return {
    csv: buildCsv(BY_CUSTODIAN_HEADERS, rows),
    fileName: "fa-by-custodian.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 9. Depreciation-by-owner-OU report
//    Period depreciation expense/allocation grouped by owner OU.
//    Uses persisted fixed_asset_depreciation_run_line_allocations
//    where available (OWNER_OU allocation_type), falling back to
//    the run line asset's current owner OU for non-allocated lines.
//    This is a DIFFERENT report from by-owner-ou (which is register-style).
// ═══════════════════════════════════════════════════════════════════

export async function reportDepreciationByOwnerOu(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const conditions = ["run.tenant_id = ?", "run.status = 'POSTED'"];
  const params = [filters.tenantId];

  if (filters.legalEntityId) {
    conditions.push("run.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.fiscalPeriodId) {
    conditions.push("run.fiscal_period_id = ?");
    params.push(filters.fiscalPeriodId);
  }
  if (filters.periodKey) {
    conditions.push("rl.period_key = ?");
    params.push(filters.periodKey);
  }

  // First: get allocated lines (DAILY_PRORATA OU splits from persisted allocations)
  const allocResult = await query(
    `SELECT alloc.operating_unit_id,
            ouTbl.code AS owner_ou_code, ouTbl.name AS owner_ou_name,
            SUM(alloc.planned_amount_base) AS total_depr_base,
            SUM(alloc.eligible_days) AS total_eligible_days,
            COUNT(DISTINCT alloc.asset_id) AS asset_count
       FROM fixed_asset_depreciation_run_line_allocations alloc
       JOIN fixed_asset_depreciation_run_lines rl ON rl.id = alloc.run_line_id
       JOIN fixed_asset_depreciation_runs run ON run.id = rl.run_id
       LEFT JOIN operating_units ouTbl ON ouTbl.id = alloc.operating_unit_id
      WHERE ${conditions.join(" AND ")}
        AND alloc.allocation_type = 'OWNER_OU'
      GROUP BY alloc.operating_unit_id, ouTbl.code, ouTbl.name
      ORDER BY ouTbl.code ASC`,
    params
  );

  // Second: get non-allocated run lines (fallback to asset's current owner OU)
  const nonAllocConditions = [...conditions];
  const nonAllocParams = [...params];

  const fallbackResult = await query(
    `SELECT fa.owner_operating_unit_id AS operating_unit_id,
            ouTbl.code AS owner_ou_code, ouTbl.name AS owner_ou_name,
            SUM(rl.planned_amount_base) AS total_depr_base,
            SUM(rl.eligible_days) AS total_eligible_days,
            COUNT(DISTINCT rl.asset_id) AS asset_count
       FROM fixed_asset_depreciation_run_lines rl
       JOIN fixed_asset_depreciation_runs run ON run.id = rl.run_id
       JOIN fixed_assets fa ON fa.id = rl.asset_id AND fa.tenant_id = rl.tenant_id
       LEFT JOIN operating_units ouTbl ON ouTbl.id = fa.owner_operating_unit_id
      WHERE ${nonAllocConditions.join(" AND ")}
        AND rl.status = 'POSTED'
        AND NOT EXISTS (
          SELECT 1 FROM fixed_asset_depreciation_run_line_allocations sub
           WHERE sub.run_line_id = rl.id
        )
      GROUP BY fa.owner_operating_unit_id, ouTbl.code, ouTbl.name
      ORDER BY ouTbl.code ASC`,
    nonAllocParams
  );

  // Merge allocated and non-allocated results by OU
  const ouMap = new Map();
  for (const r of [...(allocResult.rows || []), ...(fallbackResult.rows || [])]) {
    const key = r.operating_unit_id != null ? Number(r.operating_unit_id) : "NULL";
    const existing = ouMap.get(key) || {
      operatingUnitId: r.operating_unit_id != null ? Number(r.operating_unit_id) : null,
      ownerOuCode: r.owner_ou_code || null,
      ownerOuName: r.owner_ou_name || null,
      totalDeprBase: 0,
      totalEligibleDays: 0,
      assetCount: 0,
    };
    existing.totalDeprBase += num(r.total_depr_base);
    existing.totalEligibleDays += Number(r.total_eligible_days || 0);
    existing.assetCount += Number(r.asset_count || 0);
    ouMap.set(key, existing);
  }

  const rows = [...ouMap.values()].sort((a, b) =>
    (a.ownerOuCode || "").localeCompare(b.ownerOuCode || "")
  );

  const totals = {
    groupCount: rows.length,
    totalAssets: rows.reduce((s, r) => s + r.assetCount, 0),
    totalDeprBase: rows.reduce((s, r) => s + r.totalDeprBase, 0),
  };

  return { rows, totals };
}

const DEPR_BY_OWNER_OU_HEADERS = [
  "ownerOuCode", "ownerOuName", "assetCount",
  "totalDeprBase", "totalEligibleDays",
];

export async function exportDepreciationByOwnerOu(filters) {
  const { rows } = await reportDepreciationByOwnerOu(filters);
  return {
    csv: buildCsv(DEPR_BY_OWNER_OU_HEADERS, rows),
    fileName: "fa-depreciation-by-owner-ou.csv",
    rowCount: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 10. Rollforward report
//     Opening balance + movements (additions, depreciation, disposals,
//     transfers) → closing balance for a date range.
//     Respects DAILY_PRORATA effective-date splits/cutoffs via
//     transaction effective_date filtering.
// ═══════════════════════════════════════════════════════════════════

export async function reportRollforward(filters) {
  if (!filters.tenantId) throw badRequest("tenantId is required");

  const tenantId = filters.tenantId;
  const legalEntityId = filters.legalEntityId || null;
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;

  // ── Base asset conditions ──────────────────────────────────────
  const assetConds = ["fa.tenant_id = ?"];
  const assetParams = [tenantId];
  if (legalEntityId) {
    assetConds.push("fa.legal_entity_id = ?");
    assetParams.push(legalEntityId);
  }
  // Include non-draft assets
  assetConds.push("fa.status != 'DRAFT'");

  // ── Opening balance: sum of gross cost for assets acquired before dateFrom
  let openingCostBase = 0;
  let openingAccumDeprBase = 0;

  if (dateFrom) {
    const openingResult = await query(
      `SELECT COALESCE(SUM(fa.original_cost_base), 0) AS total_cost,
              COALESCE(SUM(fa.legacy_accum_depr_base), 0) AS total_legacy_accum
         FROM fixed_assets fa
        WHERE ${assetConds.join(" AND ")}
          AND fa.acquisition_date < ?`,
      [...assetParams, dateFrom]
    );
    openingCostBase = num(openingResult.rows?.[0]?.total_cost);
    openingAccumDeprBase = num(openingResult.rows?.[0]?.total_legacy_accum);

    // Add posted depreciation before dateFrom
    const preDeprResult = await query(
      `SELECT COALESCE(SUM(txn.gross_amount_base), 0) AS total_depr
         FROM fixed_asset_transactions txn
         JOIN fixed_assets fa ON fa.id = txn.asset_id AND fa.tenant_id = txn.tenant_id
        WHERE ${assetConds.map((c) => c.replace("fa.", "fa.")).join(" AND ")}
          AND txn.tenant_id = ?
          AND txn.transaction_type = 'DEPRECIATION'
          AND txn.status = 'POSTED'
          AND txn.effective_date < ?`,
      [...assetParams, tenantId, dateFrom]
    );
    openingAccumDeprBase += num(preDeprResult.rows?.[0]?.total_depr);
  }

  // ── Period movements: transactions within [dateFrom, dateTo]
  const movConds = ["txn.tenant_id = ?", "txn.status = 'POSTED'"];
  const movParams = [tenantId];
  if (legalEntityId) {
    movConds.push("txn.legal_entity_id = ?");
    movParams.push(legalEntityId);
  }
  if (dateFrom) {
    movConds.push("txn.effective_date >= ?");
    movParams.push(dateFrom);
  }
  if (dateTo) {
    movConds.push("txn.effective_date <= ?");
    movParams.push(dateTo);
  }

  const movResult = await query(
    `SELECT txn.transaction_type, txn.depreciation_kind,
            COALESCE(SUM(txn.gross_amount_base), 0) AS total_gross,
            COALESCE(SUM(txn.accum_depr_amount_base), 0) AS total_accum_depr,
            COALESCE(SUM(txn.nbv_amount_base), 0) AS total_nbv,
            COALESCE(SUM(txn.proceeds_amount_base), 0) AS total_proceeds,
            COUNT(*) AS txn_count
       FROM fixed_asset_transactions txn
      WHERE ${movConds.join(" AND ")}
      GROUP BY txn.transaction_type, txn.depreciation_kind
      ORDER BY txn.transaction_type ASC`,
    movParams
  );

  const movements = {};
  for (const r of movResult.rows || []) {
    const type = r.transaction_type;
    const kind = r.depreciation_kind || null;
    const key = kind ? `${type}:${kind}` : type;
    movements[key] = {
      transactionType: type,
      depreciationKind: kind,
      totalGrossBase: num(r.total_gross),
      totalAccumDeprBase: num(r.total_accum_depr),
      totalNbvBase: num(r.total_nbv),
      totalProceedsBase: num(r.total_proceeds),
      count: Number(r.txn_count),
    };
  }

  // Compute summary
  const additionsBase =
    num(movements["ACQUISITION"]?.totalGrossBase) +
    num(movements["CAPITALIZATION"]?.totalGrossBase);
  const deprRunBase = num(movements["DEPRECIATION:RUN"]?.totalGrossBase);
  const deprLowValueBase = num(movements["DEPRECIATION:LOW_VALUE_FULL_EXPENSE"]?.totalGrossBase);
  const totalDeprBase = deprRunBase + deprLowValueBase;
  const disposalsBase =
    num(movements["WRITEOFF"]?.totalNbvBase) +
    num(movements["SALE"]?.totalNbvBase);

  const openingNbvBase = openingCostBase - openingAccumDeprBase;
  const closingNbvBase = openingNbvBase + additionsBase - totalDeprBase - disposalsBase;

  const rows = Object.values(movements);

  const totals = {
    openingCostBase,
    openingAccumDeprBase,
    openingNbvBase,
    additionsBase,
    depreciationRunBase: deprRunBase,
    depreciationLowValueBase: deprLowValueBase,
    totalDepreciationBase: totalDeprBase,
    disposalsBase,
    closingNbvBase,
    movementLineCount: rows.length,
  };

  return { rows, totals };
}

const ROLLFORWARD_HEADERS = [
  "transactionType", "depreciationKind",
  "totalGrossBase", "totalAccumDeprBase", "totalNbvBase",
  "totalProceedsBase", "count",
];

export async function exportRollforward(filters) {
  const { rows, totals } = await reportRollforward(filters);
  // Include totals as a summary row
  const allRows = [
    ...rows,
    {
      transactionType: "TOTALS",
      depreciationKind: null,
      totalGrossBase: totals.additionsBase,
      totalAccumDeprBase: totals.totalDepreciationBase,
      totalNbvBase: totals.closingNbvBase,
      totalProceedsBase: 0,
      count: totals.movementLineCount,
    },
  ];
  return {
    csv: buildCsv(ROLLFORWARD_HEADERS, allRows),
    fileName: "fa-rollforward.csv",
    rowCount: allRows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Report dispatcher
// ═══════════════════════════════════════════════════════════════════

const REPORT_HANDLERS = {
  register:                   { report: reportRegister,               export: exportRegister },
  "depreciation-schedule":    { report: reportDepreciationSchedule,   export: exportDepreciationSchedule },
  additions:                  { report: reportAdditions,              export: exportAdditions },
  disposals:                  { report: reportDisposals,              export: exportDisposals },
  transfers:                  { report: reportTransfers,              export: exportTransfers },
  "by-owner-ou":              { report: reportByOwnerOu,              export: exportByOwnerOu },
  "by-location-ou":           { report: reportByLocationOu,           export: exportByLocationOu },
  "by-custodian":             { report: reportByCustodian,            export: exportByCustodian },
  "depreciation-by-owner-ou": { report: reportDepreciationByOwnerOu,  export: exportDepreciationByOwnerOu },
  rollforward:                { report: reportRollforward,            export: exportRollforward },
};

export const VALID_REPORT_NAMES = new Set(Object.keys(REPORT_HANDLERS));

export function getReportHandler(reportName) {
  const handler = REPORT_HANDLERS[reportName];
  if (!handler) {
    throw badRequest(
      `Unknown report: ${reportName}. Valid reports: ${[...VALID_REPORT_NAMES].join(", ")}`
    );
  }
  return handler;
}
