import { closePool, query } from "../src/db.js";

const EPSILON = 0.000001;
const ALLOWED_STATUSES = new Set(["ALL", "DRAFT", "POSTED", "REVERSED", "CANCELLED"]);

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseBooleanOrDefault(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseDateOnlyOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeStatusOrDefault(value, fallback = "ALL") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return fallback;
  }
  if (ALLOWED_STATUSES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/reconcile-cari-settlement-dual-currency.js --tenantId <id> [options]",
      "",
      "Required:",
      "  --tenantId <id>                 Tenant id.",
      "",
      "Options:",
      "  --legalEntityId <id>            Optional legal entity scope.",
      "  --status <ALL|POSTED|REVERSED|DRAFT|CANCELLED>  Settlement batch status filter (default: ALL).",
      "  --dateFrom <YYYY-MM-DD>         Optional settlement_date lower bound.",
      "  --dateTo <YYYY-MM-DD>           Optional settlement_date upper bound.",
      "  --sampleLimit <N>               Sample row limit per category (default: 50, max: 500).",
      "  --includeLegacySample <bool>    Include legacy parity-signature sample rows (default: true).",
      "  --failOnSuspicious <bool>       Exit non-zero on missing/suspicious rows (default: false).",
      "  --help                          Show this help text.",
      "",
      "Examples:",
      "  npm run reconcile:cari:mcs01 -- --tenantId 1",
      "  npm run reconcile:cari:mcs01 -- --tenantId 1 --status POSTED --sampleLimit 100 --failOnSuspicious true",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    legalEntityId: null,
    status: "ALL",
    dateFrom: null,
    dateTo: null,
    sampleLimit: 50,
    includeLegacySample: true,
    failOnSuspicious: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) continue;

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token.startsWith("--tenantId=")) {
      args.tenantId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--tenantId") {
      args.tenantId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--legalEntityId=")) {
      args.legalEntityId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--legalEntityId") {
      args.legalEntityId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--status=")) {
      args.status = normalizeStatusOrDefault(token.split("=")[1], args.status);
      continue;
    }
    if (token === "--status") {
      args.status = normalizeStatusOrDefault(argv[i + 1], args.status);
      i += 1;
      continue;
    }
    if (token.startsWith("--dateFrom=")) {
      args.dateFrom = parseDateOnlyOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--dateFrom") {
      args.dateFrom = parseDateOnlyOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--dateTo=")) {
      args.dateTo = parseDateOnlyOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--dateTo") {
      args.dateTo = parseDateOnlyOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--sampleLimit=")) {
      args.sampleLimit = parsePositiveIntOrNull(token.split("=")[1]) || args.sampleLimit;
      continue;
    }
    if (token === "--sampleLimit") {
      args.sampleLimit = parsePositiveIntOrNull(argv[i + 1]) || args.sampleLimit;
      i += 1;
      continue;
    }
    if (token.startsWith("--includeLegacySample=")) {
      args.includeLegacySample = parseBooleanOrDefault(
        token.split("=")[1],
        args.includeLegacySample
      );
      continue;
    }
    if (token === "--includeLegacySample") {
      args.includeLegacySample = parseBooleanOrDefault(
        argv[i + 1],
        args.includeLegacySample
      );
      i += 1;
      continue;
    }
    if (token.startsWith("--failOnSuspicious=")) {
      args.failOnSuspicious = parseBooleanOrDefault(
        token.split("=")[1],
        args.failOnSuspicious
      );
      continue;
    }
    if (token === "--failOnSuspicious") {
      args.failOnSuspicious = parseBooleanOrDefault(argv[i + 1], args.failOnSuspicious);
      i += 1;
      continue;
    }
  }

  if (args.sampleLimit > 500) {
    args.sampleLimit = 500;
  }
  return args;
}

function buildScope(args) {
  const conditions = ["a.tenant_id = ?"];
  const params = [args.tenantId];

  if (args.legalEntityId) {
    conditions.push("a.legal_entity_id = ?");
    params.push(args.legalEntityId);
  }
  if (args.status && args.status !== "ALL") {
    conditions.push("b.status = ?");
    params.push(args.status);
  }
  if (args.dateFrom) {
    conditions.push("b.settlement_date >= ?");
    params.push(args.dateFrom);
  }
  if (args.dateTo) {
    conditions.push("b.settlement_date <= ?");
    params.push(args.dateTo);
  }

  return { whereSql: conditions.join(" AND "), params };
}

function buildSqlExpressions() {
  const docCurrencyExpr =
    "UPPER(COALESCE(NULLIF(TRIM(a.document_currency_code), ''), oi.currency_code, ''))";
  const settlementCurrencyExpr =
    "UPPER(COALESCE(NULLIF(TRIM(a.settlement_currency_code), ''), b.currency_code, ''))";
  const allocTxnExpr = "COALESCE(a.allocation_amount_txn, 0)";
  const allocDocExpr =
    "COALESCE(a.allocation_amount_doc_txn, COALESCE(a.allocation_amount_txn, 0))";
  const allocSettlementExpr =
    "COALESCE(a.allocation_amount_settlement_txn, COALESCE(a.allocation_amount_txn, 0))";
  const crossRateExpr = "COALESCE(a.applied_cross_rate, 0)";
  const paritySourceExpr =
    "UPPER(COALESCE(NULLIF(TRIM(a.cross_rate_source), ''), '')) = 'PARITY'";

  const missingMetadataExpr = [
    "a.allocation_amount_doc_txn IS NULL",
    "a.allocation_amount_settlement_txn IS NULL",
    "a.document_currency_code IS NULL",
    "TRIM(a.document_currency_code) = ''",
    "a.settlement_currency_code IS NULL",
    "TRIM(a.settlement_currency_code) = ''",
    "a.applied_cross_rate IS NULL",
    "a.cross_rate_source IS NULL",
    "TRIM(a.cross_rate_source) = ''",
    "a.cross_rate_date IS NULL",
  ].join(" OR ");

  const parityDifferentCurrenciesExpr = `(${paritySourceExpr} AND ${docCurrencyExpr} <> ${settlementCurrencyExpr})`;
  const parityNonOneRateExpr = `(${paritySourceExpr} AND ABS(${crossRateExpr} - 1) > ${EPSILON})`;
  const parityAmountMismatchExpr = `(${paritySourceExpr} AND ABS(${allocDocExpr} - ${allocSettlementExpr}) > ${EPSILON})`;
  const legacyParitySignatureExpr = `(${paritySourceExpr} AND ABS(${allocDocExpr} - ${allocTxnExpr}) <= ${EPSILON} AND ABS(${allocSettlementExpr} - ${allocTxnExpr}) <= ${EPSILON} AND ABS(${crossRateExpr} - 1) <= ${EPSILON})`;
  const suspiciousExpr = `(${missingMetadataExpr} OR ${parityDifferentCurrenciesExpr} OR ${parityNonOneRateExpr} OR ${parityAmountMismatchExpr})`;

  return {
    docCurrencyExpr,
    settlementCurrencyExpr,
    allocTxnExpr,
    allocDocExpr,
    allocSettlementExpr,
    crossRateExpr,
    paritySourceExpr,
    missingMetadataExpr,
    parityDifferentCurrenciesExpr,
    parityNonOneRateExpr,
    parityAmountMismatchExpr,
    legacyParitySignatureExpr,
    suspiciousExpr,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.tenantId) {
    throw new Error("--tenantId is required");
  }
  if (args.dateFrom && args.dateTo && args.dateFrom > args.dateTo) {
    throw new Error("--dateFrom must be <= --dateTo");
  }

  const scope = buildScope(args);
  const expr = buildSqlExpressions();

  const aggregateResult = await query(
    `SELECT
       COUNT(*) AS total_rows,
       SUM(CASE WHEN ${expr.missingMetadataExpr} THEN 1 ELSE 0 END) AS missing_metadata_count,
       SUM(CASE WHEN ${expr.parityDifferentCurrenciesExpr} THEN 1 ELSE 0 END) AS parity_different_currencies_count,
       SUM(CASE WHEN ${expr.parityNonOneRateExpr} THEN 1 ELSE 0 END) AS parity_non_one_rate_count,
       SUM(CASE WHEN ${expr.parityAmountMismatchExpr} THEN 1 ELSE 0 END) AS parity_amount_mismatch_count,
       SUM(CASE WHEN ${expr.legacyParitySignatureExpr} THEN 1 ELSE 0 END) AS legacy_parity_signature_count,
       SUM(CASE WHEN ${expr.suspiciousExpr} THEN 1 ELSE 0 END) AS suspicious_count
     FROM cari_settlement_allocations a
     JOIN cari_settlement_batches b
       ON b.tenant_id = a.tenant_id
      AND b.legal_entity_id = a.legal_entity_id
      AND b.id = a.settlement_batch_id
     LEFT JOIN cari_open_items oi
       ON oi.tenant_id = a.tenant_id
      AND oi.legal_entity_id = a.legal_entity_id
      AND oi.id = a.open_item_id
     WHERE ${scope.whereSql}`,
    scope.params
  );
  const summaryRow = aggregateResult.rows?.[0] || {};

  const perEntityResult = await query(
    `SELECT
       a.legal_entity_id,
       COUNT(*) AS total_rows,
       SUM(CASE WHEN ${expr.suspiciousExpr} THEN 1 ELSE 0 END) AS suspicious_count,
       SUM(CASE WHEN ${expr.legacyParitySignatureExpr} THEN 1 ELSE 0 END) AS legacy_parity_signature_count
     FROM cari_settlement_allocations a
     JOIN cari_settlement_batches b
       ON b.tenant_id = a.tenant_id
      AND b.legal_entity_id = a.legal_entity_id
      AND b.id = a.settlement_batch_id
     LEFT JOIN cari_open_items oi
       ON oi.tenant_id = a.tenant_id
      AND oi.legal_entity_id = a.legal_entity_id
      AND oi.id = a.open_item_id
     WHERE ${scope.whereSql}
     GROUP BY a.legal_entity_id
     ORDER BY a.legal_entity_id ASC`,
    scope.params
  );

  const suspiciousRowsResult = await query(
    `SELECT
       a.id AS allocation_id,
       a.tenant_id,
       a.legal_entity_id,
       a.settlement_batch_id,
       b.settlement_no,
       b.status AS settlement_status,
       b.settlement_date,
       a.open_item_id,
       oi.document_id,
       d.document_no,
       ${expr.docCurrencyExpr} AS document_currency_code,
       ${expr.settlementCurrencyExpr} AS settlement_currency_code,
       ${expr.allocTxnExpr} AS allocation_amount_txn,
       ${expr.allocDocExpr} AS allocation_amount_doc_txn,
       ${expr.allocSettlementExpr} AS allocation_amount_settlement_txn,
       ${expr.crossRateExpr} AS applied_cross_rate,
       COALESCE(a.cross_rate_source, '') AS cross_rate_source,
       a.cross_rate_date,
       CASE
         WHEN ${expr.missingMetadataExpr} THEN 'MISSING_METADATA'
         WHEN ${expr.parityDifferentCurrenciesExpr} THEN 'PARITY_WITH_DIFFERENT_CURRENCIES'
         WHEN ${expr.parityNonOneRateExpr} THEN 'PARITY_WITH_NON_ONE_RATE'
         WHEN ${expr.parityAmountMismatchExpr} THEN 'PARITY_WITH_AMOUNT_MISMATCH'
         ELSE 'OTHER'
       END AS issue_type
     FROM cari_settlement_allocations a
     JOIN cari_settlement_batches b
       ON b.tenant_id = a.tenant_id
      AND b.legal_entity_id = a.legal_entity_id
      AND b.id = a.settlement_batch_id
     LEFT JOIN cari_open_items oi
       ON oi.tenant_id = a.tenant_id
      AND oi.legal_entity_id = a.legal_entity_id
      AND oi.id = a.open_item_id
     LEFT JOIN cari_documents d
       ON d.tenant_id = oi.tenant_id
      AND d.legal_entity_id = oi.legal_entity_id
      AND d.id = oi.document_id
     WHERE ${scope.whereSql}
       AND ${expr.suspiciousExpr}
     ORDER BY b.settlement_date DESC, a.id DESC
     LIMIT ${args.sampleLimit}`,
    scope.params
  );

  let legacyRows = [];
  if (args.includeLegacySample) {
    const legacyRowsResult = await query(
      `SELECT
         a.id AS allocation_id,
         a.tenant_id,
         a.legal_entity_id,
         a.settlement_batch_id,
         b.settlement_no,
         b.status AS settlement_status,
         b.settlement_date,
         a.open_item_id,
         oi.document_id,
         d.document_no,
         ${expr.docCurrencyExpr} AS document_currency_code,
         ${expr.settlementCurrencyExpr} AS settlement_currency_code,
         ${expr.allocTxnExpr} AS allocation_amount_txn,
         ${expr.allocDocExpr} AS allocation_amount_doc_txn,
         ${expr.allocSettlementExpr} AS allocation_amount_settlement_txn,
         ${expr.crossRateExpr} AS applied_cross_rate,
         COALESCE(a.cross_rate_source, '') AS cross_rate_source,
         a.cross_rate_date
       FROM cari_settlement_allocations a
       JOIN cari_settlement_batches b
         ON b.tenant_id = a.tenant_id
        AND b.legal_entity_id = a.legal_entity_id
        AND b.id = a.settlement_batch_id
       LEFT JOIN cari_open_items oi
         ON oi.tenant_id = a.tenant_id
        AND oi.legal_entity_id = a.legal_entity_id
        AND oi.id = a.open_item_id
       LEFT JOIN cari_documents d
         ON d.tenant_id = oi.tenant_id
        AND d.legal_entity_id = oi.legal_entity_id
        AND d.id = oi.document_id
       WHERE ${scope.whereSql}
         AND ${expr.legacyParitySignatureExpr}
       ORDER BY b.settlement_date DESC, a.id DESC
       LIMIT ${args.sampleLimit}`,
      scope.params
    );
    legacyRows = legacyRowsResult.rows || [];
  }

  const summary = {
    totalRows: Number(summaryRow.total_rows || 0),
    missingMetadataCount: Number(summaryRow.missing_metadata_count || 0),
    parityDifferentCurrenciesCount: Number(summaryRow.parity_different_currencies_count || 0),
    parityNonOneRateCount: Number(summaryRow.parity_non_one_rate_count || 0),
    parityAmountMismatchCount: Number(summaryRow.parity_amount_mismatch_count || 0),
    suspiciousCount: Number(summaryRow.suspicious_count || 0),
    legacyParitySignatureCount: Number(summaryRow.legacy_parity_signature_count || 0),
  };

  const output = {
    ok: summary.suspiciousCount === 0 && summary.missingMetadataCount === 0,
    action: "reconcile-cari-settlement-dual-currency",
    input: {
      tenantId: args.tenantId,
      legalEntityId: args.legalEntityId,
      status: args.status,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      sampleLimit: args.sampleLimit,
      includeLegacySample: args.includeLegacySample,
      failOnSuspicious: args.failOnSuspicious,
    },
    summary,
    perLegalEntity: (perEntityResult.rows || []).map((row) => ({
      legalEntityId: Number(row.legal_entity_id || 0),
      totalRows: Number(row.total_rows || 0),
      suspiciousCount: Number(row.suspicious_count || 0),
      legacyParitySignatureCount: Number(row.legacy_parity_signature_count || 0),
    })),
    suspiciousRows: suspiciousRowsResult.rows || [],
    legacyParitySampleRows: legacyRows,
  };

  console.log(JSON.stringify(output, null, 2));

  if (args.failOnSuspicious && !output.ok) {
    process.exitCode = 2;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
