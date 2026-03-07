import express from "express";
import { query } from "../db.js";
import { requirePermission } from "../middleware/rbac.js";
import { importTcmbDailyRates } from "../services/fx.tcmb.service.js";
import {
  asyncHandler,
  badRequest,
  resolveTenantId,
} from "./_utils.js";

const router = express.Router();
const AUTO_INVERSE_SOURCE = "AUTO_INVERSE";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDateOnlyInput(value, label = "rateDate") {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:\b|T.*)?$/);
  if (!match?.[1]) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  return match[1];
}

function normalizePositiveRate(value, label = "value") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a positive number`);
  }
  return Number(parsed.toFixed(10));
}

function makeFxRateKey({
  rateDate,
  fromCurrencyCode,
  toCurrencyCode,
  rateType,
}) {
  return [
    rateDate,
    fromCurrencyCode,
    toCurrencyCode,
    rateType,
  ].join("|");
}

function normalizeRateInput(rate, index) {
  const { rateDate, fromCurrencyCode, toCurrencyCode, rateType, value, source } =
    rate || {};
  if (
    !rateDate ||
    !fromCurrencyCode ||
    !toCurrencyCode ||
    !rateType ||
    value === undefined ||
    value === null
  ) {
    throw badRequest(
      `Row ${index + 1}: Each rate item requires rateDate, fromCurrencyCode, toCurrencyCode, rateType, value`
    );
  }

  const normalizedRow = {
    inputRowNumber: index + 1,
    rateDate: normalizeDateOnlyInput(rateDate),
    fromCurrencyCode: normalizeUpperText(fromCurrencyCode),
    toCurrencyCode: normalizeUpperText(toCurrencyCode),
    rateType: normalizeUpperText(rateType),
    value: normalizePositiveRate(value),
    source: source ? String(source).trim() : null,
  };
  if (
    !normalizedRow.fromCurrencyCode ||
    !normalizedRow.toCurrencyCode ||
    !normalizedRow.rateType
  ) {
    throw badRequest(
      `Row ${index + 1}: Each rate item requires rateDate, fromCurrencyCode, toCurrencyCode, rateType, value`
    );
  }
  return normalizedRow;
}

function buildInverseSource(source) {
  return source ? `${source}_${AUTO_INVERSE_SOURCE}` : AUTO_INVERSE_SOURCE;
}

function buildInverseRateRow(row) {
  return {
    rateDate: row.rateDate,
    fromCurrencyCode: row.toCurrencyCode,
    toCurrencyCode: row.fromCurrencyCode,
    rateType: row.rateType,
    value: normalizePositiveRate(1 / Number(row.value)),
    source: buildInverseSource(row.source),
  };
}

function shouldSyncInverseRate(row) {
  return (
    row.rateType === "SPOT" &&
    row.fromCurrencyCode &&
    row.toCurrencyCode &&
    row.fromCurrencyCode !== row.toCurrencyCode
  );
}

function assertNoExplicitSpotReciprocalInputs(rows) {
  const byKey = new Map(rows.map((row) => [makeFxRateKey(row), row]));
  for (const row of rows) {
    if (!shouldSyncInverseRate(row)) {
      continue;
    }
    const reciprocalKey = makeFxRateKey({
      rateDate: row.rateDate,
      fromCurrencyCode: row.toCurrencyCode,
      toCurrencyCode: row.fromCurrencyCode,
      rateType: row.rateType,
    });
    const reciprocalRow = byKey.get(reciprocalKey);
    if (
      reciprocalRow &&
      reciprocalRow.inputRowNumber !== row.inputRowNumber
    ) {
      throw badRequest(
        `Rows ${row.inputRowNumber} and ${reciprocalRow.inputRowNumber}: submit only one SPOT direction for a pair/date. Enter the USD/local quote once; the reciprocal is managed automatically.`
      );
    }
  }
}

async function upsertFxRateRow({ tenantId, row }) {
  await query(
    `INSERT INTO fx_rates (
        tenant_id, rate_date, from_currency_code, to_currency_code, rate_type, rate, source
      )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rate = VALUES(rate),
       source = VALUES(source)`,
    [
      tenantId,
      row.rateDate,
      row.fromCurrencyCode,
      row.toCurrencyCode,
      row.rateType,
      row.value,
      row.source,
    ]
  );
}

router.post(
  "/rates/import/tcmb-daily",
  requirePermission("fx.rate.bulk_upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await importTcmbDailyRates({
      tenantId,
      rateDate: req.body?.rateDate ?? req.body?.date ?? "",
      pricingMode: req.body?.pricingMode ?? "FOREX_MID",
      rateType: req.body?.rateType ?? "SPOT",
      runQuery: query,
    });

    return res.status(201).json({
      ok: true,
      ...result,
    });
  })
);

router.post(
  "/rates/bulk-upsert",
  requirePermission("fx.rate.bulk_upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const rates = Array.isArray(req.body?.rates) ? req.body.rates : [];
    if (rates.length === 0) {
      throw badRequest("rates must be a non-empty array");
    }

    const normalizedRates = rates.map((rate, index) => normalizeRateInput(rate, index));
    assertNoExplicitSpotReciprocalInputs(normalizedRates);
    const upsertMap = new Map();
    for (const row of normalizedRates) {
      upsertMap.set(makeFxRateKey(row), row);
    }

    let inverseRowsUpserted = 0;
    for (const row of normalizedRates) {
      if (!shouldSyncInverseRate(row)) {
        continue;
      }
      const inverseRow = buildInverseRateRow(row);
      const inverseKey = makeFxRateKey(inverseRow);
      if (upsertMap.has(inverseKey)) {
        continue;
      }
      upsertMap.set(inverseKey, inverseRow);
      inverseRowsUpserted += 1;
    }

    for (const row of upsertMap.values()) {
      // Preserve exact reciprocal rows for SPOT so users can maintain the common
      // "1 USD = X local currency" quote while downstream consumers can read either side.
      await upsertFxRateRow({
        tenantId,
        row,
      });
    }

    return res.status(201).json({
      ok: true,
      tenantId,
      upserted: normalizedRates.length,
      inverseRowsUpserted,
      totalRowsUpserted: upsertMap.size,
    });
  })
);

router.get(
  "/rates",
  requirePermission("fx.rate.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const dateFrom = req.query.dateFrom || "1900-01-01";
    const dateTo = req.query.dateTo || "2999-12-31";
    const fromCurrencyCode = req.query.fromCurrencyCode
      ? String(req.query.fromCurrencyCode).toUpperCase()
      : null;
    const toCurrencyCode = req.query.toCurrencyCode
      ? String(req.query.toCurrencyCode).toUpperCase()
      : null;
    const rateType = req.query.rateType
      ? String(req.query.rateType).toUpperCase()
      : null;

    const conditions = ["tenant_id = ?", "rate_date BETWEEN ? AND ?"];
    const params = [tenantId, dateFrom, dateTo];

    if (fromCurrencyCode) {
      conditions.push("from_currency_code = ?");
      params.push(fromCurrencyCode);
    }
    if (toCurrencyCode) {
      conditions.push("to_currency_code = ?");
      params.push(toCurrencyCode);
    }
    if (rateType) {
      conditions.push("rate_type = ?");
      params.push(rateType);
    }

    const result = await query(
      `SELECT id, rate_date, from_currency_code, to_currency_code, rate_type, rate, source, is_locked
       FROM fx_rates
       WHERE ${conditions.join(" AND ")}
       ORDER BY rate_date DESC, from_currency_code, to_currency_code, rate_type`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

export default router;
