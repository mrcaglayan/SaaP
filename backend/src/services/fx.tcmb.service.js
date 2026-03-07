import { query } from "../db.js";
import { badRequest } from "../routes/_utils.js";

const TCMB_TODAY_XML_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";
const TRY_CURRENCY_CODE = "TRY";
const SUPPORTED_PRICING_MODES = new Set([
  "FOREX_BUYING",
  "FOREX_SELLING",
  "FOREX_MID",
]);
const SUPPORTED_RATE_TYPES = new Set(["SPOT", "AVERAGE", "CLOSING"]);

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDateInput(value, label = "date") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  return normalized;
}

function toTcmbDatedXmlUrl(rateDate) {
  const normalizedDate = normalizeDateInput(rateDate, "rateDate");
  if (!normalizedDate) {
    return TCMB_TODAY_XML_URL;
  }
  const [year, month, day] = normalizedDate.split("-");
  return `https://www.tcmb.gov.tr/kurlar/${year}${month}/${day}${month}${year}.xml`;
}

function parseXmlAttribute(tagSource, attributeName) {
  const pattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  const match = String(tagSource || "").match(pattern);
  return match?.[1] ? String(match[1]).trim() : "";
}

function extractXmlTagValue(block, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(block || "").match(pattern);
  if (!match?.[1]) {
    return "";
  }
  return String(match[1]).trim();
}

function parsePositiveDecimal(value) {
  const normalized = String(value || "")
    .trim()
    .replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function roundRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(10));
}

function normalizePricingMode(value) {
  const normalized = normalizeUpperText(value) || "FOREX_MID";
  if (!SUPPORTED_PRICING_MODES.has(normalized)) {
    throw badRequest(
      `pricingMode must be one of ${Array.from(SUPPORTED_PRICING_MODES).join(", ")}`
    );
  }
  return normalized;
}

function normalizeRateType(value) {
  const normalized = normalizeUpperText(value) || "SPOT";
  if (!SUPPORTED_RATE_TYPES.has(normalized)) {
    throw badRequest(
      `rateType must be one of ${Array.from(SUPPORTED_RATE_TYPES).join(", ")}`
    );
  }
  return normalized;
}

function resolvePricingValue(block, pricingMode) {
  const forexBuying = parsePositiveDecimal(extractXmlTagValue(block, "ForexBuying"));
  const forexSelling = parsePositiveDecimal(extractXmlTagValue(block, "ForexSelling"));

  if (pricingMode === "FOREX_BUYING") {
    return forexBuying;
  }
  if (pricingMode === "FOREX_SELLING") {
    return forexSelling;
  }
  if (forexBuying && forexSelling) {
    return roundRate((forexBuying + forexSelling) / 2);
  }
  return forexBuying || forexSelling || null;
}

function parseTcmbDateFromXml(xmlSource) {
  const rootMatch = String(xmlSource || "").match(/<Tarih_Date\b([^>]*)>/i);
  const dateAttr = rootMatch?.[1] ? parseXmlAttribute(rootMatch[1], "Tarih") : "";
  if (!dateAttr) {
    throw new Error("Unable to resolve TCMB XML date");
  }
  const parts = dateAttr.split(".");
  if (parts.length !== 3) {
    throw new Error("TCMB XML date format is invalid");
  }
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseTcmbCurrencyRows(xmlSource, pricingMode) {
  const rows = [];
  const pattern = /<Currency\b([^>]*)>([\s\S]*?)<\/Currency>/gi;
  for (const match of String(xmlSource || "").matchAll(pattern)) {
    const attributes = match[1] || "";
    const block = match[2] || "";
    const currencyCode = normalizeUpperText(
      parseXmlAttribute(attributes, "CurrencyCode") || parseXmlAttribute(attributes, "Kod")
    );
    if (!currencyCode || currencyCode === TRY_CURRENCY_CODE) {
      continue;
    }

    const unit = Number.parseInt(extractXmlTagValue(block, "Unit") || "1", 10);
    const normalizedUnit = Number.isInteger(unit) && unit > 0 ? unit : 1;
    const selectedValue = resolvePricingValue(block, pricingMode);
    if (!selectedValue) {
      continue;
    }

    const foreignToTryRate = roundRate(selectedValue / normalizedUnit);
    if (!foreignToTryRate) {
      continue;
    }

    rows.push({
      currencyCode,
      unit: normalizedUnit,
      foreignToTryRate,
      tryToForeignRate: roundRate(1 / foreignToTryRate),
      currencyName: extractXmlTagValue(block, "CurrencyName") || null,
    });
  }
  return rows;
}

async function loadSupportedCurrencyCodes(runQuery = query) {
  const result = await runQuery(`SELECT code FROM currencies`);
  return new Set(
    (result.rows || [])
      .map((row) => normalizeUpperText(row?.code))
      .filter(Boolean)
  );
}

async function upsertFxRateRow({ tenantId, row, runQuery = query }) {
  await runQuery(
    `INSERT INTO fx_rates (
        tenant_id,
        rate_date,
        from_currency_code,
        to_currency_code,
        rate_type,
        rate,
        source
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

export async function importTcmbDailyRates({
  tenantId,
  rateDate = "",
  pricingMode = "FOREX_MID",
  rateType = "SPOT",
  runQuery = query,
  fetchImpl = fetch,
}) {
  const normalizedTenantId = Number(tenantId);
  if (!Number.isInteger(normalizedTenantId) || normalizedTenantId <= 0) {
    throw badRequest("tenantId is required");
  }

  const normalizedPricingMode = normalizePricingMode(pricingMode);
  const normalizedRateType = normalizeRateType(rateType);
  const normalizedRequestedDate = normalizeDateInput(rateDate, "rateDate");
  const sourceUrl = toTcmbDatedXmlUrl(normalizedRequestedDate);
  let response;
  try {
    response = await fetchImpl(sourceUrl);
  } catch (err) {
    throw badRequest(`TCMB XML could not be fetched: ${err?.message || "network error"}`);
  }
  if (!response.ok) {
    throw badRequest(
      normalizedRequestedDate
        ? `TCMB XML could not be fetched for ${normalizedRequestedDate}`
        : "TCMB today.xml could not be fetched"
    );
  }

  const xmlSource = await response.text();
  const resolvedRateDate = parseTcmbDateFromXml(xmlSource);
  const supportedCurrencyCodes = await loadSupportedCurrencyCodes(runQuery);
  const parsedCurrencies = parseTcmbCurrencyRows(xmlSource, normalizedPricingMode);

  const skippedCurrencyCodes = [];
  const importRows = [];
  for (const currency of parsedCurrencies) {
    if (
      !supportedCurrencyCodes.has(currency.currencyCode) ||
      !supportedCurrencyCodes.has(TRY_CURRENCY_CODE)
    ) {
      skippedCurrencyCodes.push(currency.currencyCode);
      continue;
    }

    if (currency.foreignToTryRate) {
      importRows.push({
        rateDate: resolvedRateDate,
        fromCurrencyCode: currency.currencyCode,
        toCurrencyCode: TRY_CURRENCY_CODE,
        rateType: normalizedRateType,
        value: currency.foreignToTryRate,
        source: `TCMB_XML_${normalizedPricingMode}`,
      });
    }
    if (currency.tryToForeignRate) {
      importRows.push({
        rateDate: resolvedRateDate,
        fromCurrencyCode: TRY_CURRENCY_CODE,
        toCurrencyCode: currency.currencyCode,
        rateType: normalizedRateType,
        value: currency.tryToForeignRate,
        source: `TCMB_XML_${normalizedPricingMode}_INVERSE`,
      });
    }
  }

  for (const row of importRows) {
    await upsertFxRateRow({
      tenantId: normalizedTenantId,
      row,
      runQuery,
    });
  }

  return {
    tenantId: normalizedTenantId,
    requestedRateDate: normalizedRequestedDate || null,
    importedRateDate: resolvedRateDate,
    pricingMode: normalizedPricingMode,
    rateType: normalizedRateType,
    sourceUrl,
    currencyCount: importRows.length / 2,
    upserted: importRows.length,
    skippedCurrencyCodes: Array.from(new Set(skippedCurrencyCodes)).sort(),
    samplePairs: importRows.slice(0, 6),
  };
}
