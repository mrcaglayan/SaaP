import { closePool, query, withTransaction } from "../src/db.js";

const COUNTRY_REGIME_SEEDS = Object.freeze({
  TR: Object.freeze({
    regimeCode: "TR_KDV_STD_V1",
    regimeName: "Turkey VAT/KDV Baseline",
    taxCodes: Object.freeze([
      Object.freeze({
        code: "KDV1",
        name: "KDV 1%",
        taxKind: "VAT",
        ratePct: 1,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "KDV10",
        name: "KDV 10%",
        taxKind: "VAT",
        ratePct: 10,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "KDV20",
        name: "KDV 20%",
        taxKind: "VAT",
        ratePct: 20,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "TEVKIFAT10",
        name: "Withholding 10%",
        taxKind: "WITHHOLDING",
        ratePct: 10,
        calculationMode: "EXCLUSIVE",
        recoverability: "NONE",
      }),
    ]),
  }),
  DE: Object.freeze({
    regimeCode: "DE_VAT_STD_V1",
    regimeName: "Germany VAT Baseline",
    taxCodes: Object.freeze([
      Object.freeze({
        code: "VAT0",
        name: "VAT 0%",
        taxKind: "VAT",
        ratePct: 0,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "VAT7",
        name: "VAT 7%",
        taxKind: "VAT",
        ratePct: 7,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "VAT19",
        name: "VAT 19%",
        taxKind: "VAT",
        ratePct: 19,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "WHT10",
        name: "Withholding 10%",
        taxKind: "WITHHOLDING",
        ratePct: 10,
        calculationMode: "EXCLUSIVE",
        recoverability: "NONE",
      }),
    ]),
  }),
  GB: Object.freeze({
    regimeCode: "GB_VAT_STD_V1",
    regimeName: "United Kingdom VAT Baseline",
    taxCodes: Object.freeze([
      Object.freeze({
        code: "VAT0",
        name: "VAT 0%",
        taxKind: "VAT",
        ratePct: 0,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "VAT5",
        name: "VAT 5%",
        taxKind: "VAT",
        ratePct: 5,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "VAT20",
        name: "VAT 20%",
        taxKind: "VAT",
        ratePct: 20,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "WHT10",
        name: "Withholding 10%",
        taxKind: "WITHHOLDING",
        ratePct: 10,
        calculationMode: "EXCLUSIVE",
        recoverability: "NONE",
      }),
    ]),
  }),
  US: Object.freeze({
    regimeCode: "US_SALES_TAX_STD_V1",
    regimeName: "United States Sales Tax Baseline",
    taxCodes: Object.freeze([
      Object.freeze({
        code: "VAT0",
        name: "Sales Tax 0%",
        taxKind: "VAT",
        ratePct: 0,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "VAT8",
        name: "Sales Tax 8.25%",
        taxKind: "VAT",
        ratePct: 8.25,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "WHT10",
        name: "Withholding 10%",
        taxKind: "WITHHOLDING",
        ratePct: 10,
        calculationMode: "EXCLUSIVE",
        recoverability: "NONE",
      }),
    ]),
  }),
  AF: Object.freeze({
    regimeCode: "AF_VAT_STD_V1",
    regimeName: "Afghanistan VAT Baseline",
    taxCodes: Object.freeze([
      Object.freeze({
        code: "VAT0",
        name: "VAT 0%",
        taxKind: "VAT",
        ratePct: 0,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "VAT10",
        name: "VAT 10%",
        taxKind: "VAT",
        ratePct: 10,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      }),
      Object.freeze({
        code: "WHT10",
        name: "Withholding 10%",
        taxKind: "WITHHOLDING",
        ratePct: 10,
        calculationMode: "EXCLUSIVE",
        recoverability: "NONE",
      }),
    ]),
  }),
});

const DEFAULT_REGIME_SEED = Object.freeze({
  regimeCode: "VAT_STD_V1",
  regimeName: "VAT Baseline",
  taxCodes: Object.freeze([
    Object.freeze({
      code: "VAT0",
      name: "VAT 0%",
      taxKind: "VAT",
      ratePct: 0,
      calculationMode: "EXCLUSIVE",
      recoverability: "FULL",
    }),
    Object.freeze({
      code: "VAT20",
      name: "VAT 20%",
      taxKind: "VAT",
      ratePct: 20,
      calculationMode: "EXCLUSIVE",
      recoverability: "FULL",
    }),
    Object.freeze({
      code: "WHT10",
      name: "Withholding 10%",
      taxKind: "WITHHOLDING",
      ratePct: 10,
      calculationMode: "EXCLUSIVE",
      recoverability: "NONE",
    }),
  ]),
});

function u(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseDateOnly(value, fallbackDate) {
  if (!value) {
    return fallbackDate;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return fallbackDate;
  }
  return normalized;
}

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10);
  const args = {
    tenantId: null,
    countryId: null,
    countryIso2: null,
    createdByUserId: null,
    effectiveFrom: today,
    limit: null,
    apply: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) {
      continue;
    }
    if (token === "--apply") {
      args.apply = true;
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
    if (token.startsWith("--countryId=")) {
      args.countryId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--countryId") {
      args.countryId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--countryIso2=")) {
      args.countryIso2 = u(token.split("=")[1]).slice(0, 2);
      continue;
    }
    if (token === "--countryIso2") {
      args.countryIso2 = u(argv[i + 1]).slice(0, 2);
      i += 1;
      continue;
    }
    if (token.startsWith("--createdByUserId=")) {
      args.createdByUserId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--createdByUserId") {
      args.createdByUserId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--effectiveFrom=")) {
      args.effectiveFrom = parseDateOnly(token.split("=")[1], args.effectiveFrom);
      continue;
    }
    if (token === "--effectiveFrom") {
      args.effectiveFrom = parseDateOnly(argv[i + 1], args.effectiveFrom);
      i += 1;
      continue;
    }
    if (token.startsWith("--limit=")) {
      args.limit = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--limit") {
      args.limit = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function resolveSeedByCountryIso2(countryIso2) {
  const normalizedIso2 = u(countryIso2);
  const base = COUNTRY_REGIME_SEEDS[normalizedIso2] || DEFAULT_REGIME_SEED;
  if (COUNTRY_REGIME_SEEDS[normalizedIso2]) {
    return base;
  }
  return {
    regimeCode: `${normalizedIso2 || "XX"}_${base.regimeCode}`,
    regimeName: `${normalizedIso2 || "XX"} ${base.regimeName}`,
    taxCodes: base.taxCodes,
  };
}

async function resolveTenantCountryRows({
  tenantId,
  countryId,
  countryIso2,
  limit,
}) {
  const where = ["le.status = 'ACTIVE'"];
  const params = [];

  if (tenantId) {
    where.push("le.tenant_id = ?");
    params.push(tenantId);
  }
  if (countryId) {
    where.push("le.country_id = ?");
    params.push(countryId);
  }
  if (countryIso2) {
    where.push("c.iso2 = ?");
    params.push(countryIso2);
  }

  const limitValue = parsePositiveIntOrNull(limit);
  const limitClause = limitValue ? `LIMIT ${limitValue}` : "";

  const result = await query(
    `SELECT
       le.tenant_id,
       le.country_id,
       c.iso2 AS country_iso2,
       c.name AS country_name,
       c.default_currency_code
     FROM legal_entities le
     JOIN countries c ON c.id = le.country_id
     WHERE ${where.join(" AND ")}
     GROUP BY le.tenant_id, le.country_id, c.iso2, c.name, c.default_currency_code
     ORDER BY le.tenant_id ASC, le.country_id ASC
     ${limitClause}`,
    params
  );

  return result.rows || [];
}

async function resolveCreatedByUserId(tenantId, preferredUserId) {
  if (preferredUserId) {
    const preferred = await query(
      `SELECT id
       FROM users
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, preferredUserId]
    );
    if (preferred.rows?.[0]?.id) {
      return parsePositiveIntOrNull(preferred.rows[0].id);
    }
  }

  const fallback = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  return parsePositiveIntOrNull(fallback.rows?.[0]?.id);
}

async function upsertTaxRegimeTx(
  tx,
  {
    tenantId,
    countryId,
    regimeCode,
    regimeName,
    currencyCode,
    createdByUserId,
    effectiveFrom,
  }
) {
  await tx.query(
    `INSERT INTO tax_regimes (
        tenant_id,
        country_id,
        legal_entity_id,
        code,
        name,
        currency_code,
        effective_from,
        effective_to,
        status,
        created_by_user_id
     )
     VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 'ACTIVE', ?)
     ON DUPLICATE KEY UPDATE
       country_id = VALUES(country_id),
       legal_entity_id = VALUES(legal_entity_id),
       name = VALUES(name),
       currency_code = VALUES(currency_code),
       effective_to = NULL,
       status = 'ACTIVE',
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      countryId,
      regimeCode,
      regimeName,
      currencyCode,
      effectiveFrom,
      createdByUserId,
    ]
  );

  const regimeResult = await tx.query(
    `SELECT id
     FROM tax_regimes
     WHERE tenant_id = ?
       AND code = ?
       AND effective_from = ?
     LIMIT 1`,
    [tenantId, regimeCode, effectiveFrom]
  );
  const regimeId = parsePositiveIntOrNull(regimeResult.rows?.[0]?.id);
  if (!regimeId) {
    throw new Error(`Failed to resolve tax regime id for ${regimeCode}`);
  }
  return regimeId;
}

async function upsertTaxCodeTx(tx, { tenantId, regimeId, codeConfig }) {
  await tx.query(
    `INSERT INTO tax_codes (
        tenant_id,
        tax_regime_id,
        code,
        name,
        tax_kind,
        rate_pct,
        calculation_mode,
        recoverability,
        is_reverse_charge,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       tax_kind = VALUES(tax_kind),
       rate_pct = VALUES(rate_pct),
       calculation_mode = VALUES(calculation_mode),
       recoverability = VALUES(recoverability),
       is_reverse_charge = VALUES(is_reverse_charge),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      regimeId,
      codeConfig.code,
      codeConfig.name,
      codeConfig.taxKind,
      Number(codeConfig.ratePct).toFixed(4),
      codeConfig.calculationMode,
      codeConfig.recoverability,
    ]
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidateRows = await resolveTenantCountryRows(args);

  const plan = [];
  const metrics = {
    countryScopeCount: candidateRows.length,
    tenantCount: 0,
    skippedNoUserCount: 0,
    regimeTouchedCount: 0,
    taxCodeTouchedCount: 0,
  };

  const seenTenants = new Set();
  for (const row of candidateRows) {
    const tenantId = parsePositiveIntOrNull(row.tenant_id);
    const countryId = parsePositiveIntOrNull(row.country_id);
    if (!tenantId || !countryId) {
      continue;
    }

    seenTenants.add(tenantId);

    const seed = resolveSeedByCountryIso2(row.country_iso2);
    const createdByUserId = await resolveCreatedByUserId(tenantId, args.createdByUserId);

    if (!createdByUserId) {
      metrics.skippedNoUserCount += 1;
      plan.push({
        tenantId,
        countryId,
        countryIso2: u(row.country_iso2),
        skipped: true,
        reason: "No tenant user found for created_by_user_id",
      });
      continue;
    }

    plan.push({
      tenantId,
      countryId,
      countryIso2: u(row.country_iso2),
      countryName: row.country_name || null,
      currencyCode: u(row.default_currency_code),
      effectiveFrom: args.effectiveFrom,
      createdByUserId,
      regimeCode: seed.regimeCode,
      regimeName: seed.regimeName,
      taxCodes: seed.taxCodes,
    });
  }

  metrics.tenantCount = seenTenants.size;

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        filters: {
          tenantId: args.tenantId,
          countryId: args.countryId,
          countryIso2: args.countryIso2,
          createdByUserId: args.createdByUserId,
          effectiveFrom: args.effectiveFrom,
          limit: args.limit,
        },
        planCount: plan.length,
        sample: plan.slice(0, 8).map((item) => ({
          tenantId: item.tenantId,
          countryId: item.countryId,
          countryIso2: item.countryIso2,
          regimeCode: item.regimeCode,
          taxCodes: (item.taxCodes || []).map((codeRow) => codeRow.code),
          skipped: Boolean(item.skipped),
          reason: item.reason || null,
        })),
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to write tax regimes and codes.");
    return;
  }

  for (const item of plan) {
    if (item.skipped) {
      continue;
    }

    await withTransaction(async (tx) => {
      const regimeId = await upsertTaxRegimeTx(tx, {
        tenantId: item.tenantId,
        countryId: item.countryId,
        regimeCode: item.regimeCode,
        regimeName: item.regimeName,
        currencyCode: item.currencyCode,
        createdByUserId: item.createdByUserId,
        effectiveFrom: item.effectiveFrom,
      });

      metrics.regimeTouchedCount += 1;

      for (const codeConfig of item.taxCodes || []) {
        // eslint-disable-next-line no-await-in-loop
        await upsertTaxCodeTx(tx, {
          tenantId: item.tenantId,
          regimeId,
          codeConfig,
        });
        metrics.taxCodeTouchedCount += 1;
      }
    });
  }

  console.log(JSON.stringify({ ok: true, mode: "apply", ...metrics }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
