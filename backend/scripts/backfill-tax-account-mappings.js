import { closePool, query, withTransaction } from "../src/db.js";

const PURPOSES_BY_TAX_KIND = Object.freeze({
  VAT: Object.freeze(["VAT_INPUT", "VAT_OUTPUT", "VAT_PAYABLE", "VAT_RECEIVABLE"]),
  WITHHOLDING: Object.freeze(["WITHHOLDING_PAYABLE", "WITHHOLDING_RECEIVABLE"]),
  STAMP: Object.freeze(["ROUNDING"]),
  OTHER: Object.freeze(["ROUNDING"]),
});

const JPA_ALIASES_BY_PURPOSE = Object.freeze({
  VAT_INPUT: Object.freeze([
    "VAT_INPUT",
    "TAX_VAT_INPUT",
    "KDV_INPUT",
    "KDV_INDIRILECEK",
    "VAT_RECEIVABLE",
  ]),
  VAT_OUTPUT: Object.freeze([
    "VAT_OUTPUT",
    "TAX_VAT_OUTPUT",
    "KDV_OUTPUT",
    "HESAPLANAN_KDV",
    "VAT_PAYABLE",
  ]),
  VAT_PAYABLE: Object.freeze([
    "VAT_PAYABLE",
    "TAX_VAT_PAYABLE",
    "KDV_PAYABLE",
    "ODENECEK_KDV",
    "HESAPLANAN_KDV",
  ]),
  VAT_RECEIVABLE: Object.freeze([
    "VAT_RECEIVABLE",
    "TAX_VAT_RECEIVABLE",
    "KDV_RECEIVABLE",
    "DEVREDEN_KDV",
    "KDV_INDIRILECEK",
  ]),
  WITHHOLDING_PAYABLE: Object.freeze([
    "WITHHOLDING_PAYABLE",
    "TAX_WITHHOLDING_PAYABLE",
    "STOPAJ_PAYABLE",
    "MUHTASAR_PAYABLE",
  ]),
  WITHHOLDING_RECEIVABLE: Object.freeze([
    "WITHHOLDING_RECEIVABLE",
    "TAX_WITHHOLDING_RECEIVABLE",
    "STOPAJ_RECEIVABLE",
  ]),
  ROUNDING: Object.freeze(["ROUNDING", "TAX_ROUNDING", "YUVARLAMA"]),
});

const ACCOUNT_CODE_FALLBACKS = Object.freeze({
  DEFAULT: Object.freeze({
    VAT_INPUT: Object.freeze(["136", "1800", "1300"]),
    VAT_OUTPUT: Object.freeze(["2200", "2300"]),
    VAT_PAYABLE: Object.freeze(["2200", "2300"]),
    VAT_RECEIVABLE: Object.freeze(["136", "1300"]),
    WITHHOLDING_PAYABLE: Object.freeze(["2210", "2205"]),
    WITHHOLDING_RECEIVABLE: Object.freeze(["1305", "136"]),
    ROUNDING: Object.freeze(["679", "689", "9999"]),
  }),
  TR: Object.freeze({
    VAT_INPUT: Object.freeze(["191", "191.01", "191.18"]),
    VAT_OUTPUT: Object.freeze(["391", "391.01", "391.18"]),
    VAT_PAYABLE: Object.freeze(["360", "360.01", "391"]),
    VAT_RECEIVABLE: Object.freeze(["190", "136", "191"]),
    WITHHOLDING_PAYABLE: Object.freeze(["360", "361"]),
    WITHHOLDING_RECEIVABLE: Object.freeze(["196", "136"]),
    ROUNDING: Object.freeze(["679", "689"]),
  }),
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
    legalEntityId: null,
    regimeId: null,
    effectiveOn: today,
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
    if (token.startsWith("--legalEntityId=")) {
      args.legalEntityId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--legalEntityId") {
      args.legalEntityId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--regimeId=")) {
      args.regimeId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--regimeId") {
      args.regimeId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--effectiveOn=")) {
      args.effectiveOn = parseDateOnly(token.split("=")[1], args.effectiveOn);
      continue;
    }
    if (token === "--effectiveOn") {
      args.effectiveOn = parseDateOnly(argv[i + 1], args.effectiveOn);
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

function makeEntityKey(tenantId, legalEntityId) {
  return `${tenantId}:${legalEntityId}`;
}

function makeExactMappingKey(tenantId, legalEntityId, taxCodeId, taxPurposeCode) {
  return `${tenantId}:${legalEntityId}:${taxCodeId}:${u(taxPurposeCode)}`;
}

function makeReusableMappingKey(tenantId, legalEntityId, regimeId, taxPurposeCode) {
  return `${tenantId}:${legalEntityId}:${regimeId}:${u(taxPurposeCode)}`;
}

function getPurposeCodesByTaxKind(taxKind) {
  return PURPOSES_BY_TAX_KIND[u(taxKind)] || PURPOSES_BY_TAX_KIND.OTHER;
}

function getAccountCodeFallbacks(taxPurposeCode, countryIso2) {
  const byCountry = ACCOUNT_CODE_FALLBACKS[u(countryIso2)] || null;
  const byCountryCandidates = byCountry?.[u(taxPurposeCode)] || [];
  if (byCountryCandidates.length > 0) {
    return byCountryCandidates;
  }
  return ACCOUNT_CODE_FALLBACKS.DEFAULT[u(taxPurposeCode)] || [];
}

async function loadCandidateTaxRows({
  tenantId,
  legalEntityId,
  regimeId,
  effectiveOn,
  limit,
}) {
  const where = [
    "tr.status = 'ACTIVE'",
    "tc.status = 'ACTIVE'",
    "tr.effective_from <= ?",
    "(tr.effective_to IS NULL OR tr.effective_to >= ?)",
  ];
  const params = [effectiveOn, effectiveOn];

  if (tenantId) {
    where.push("tr.tenant_id = ?");
    params.push(tenantId);
  }
  if (legalEntityId) {
    where.push("le.id = ?");
    params.push(legalEntityId);
  }
  if (regimeId) {
    where.push("tr.id = ?");
    params.push(regimeId);
  }

  const limitValue = parsePositiveIntOrNull(limit);
  const limitClause = limitValue ? `LIMIT ${limitValue}` : "";

  const result = await query(
    `SELECT
       tr.tenant_id,
       tr.id AS tax_regime_id,
       tr.code AS tax_regime_code,
       tr.country_id,
       c.iso2 AS country_iso2,
       tr.legal_entity_id AS regime_legal_entity_id,
       tc.id AS tax_code_id,
       tc.code AS tax_code,
       tc.tax_kind,
       le.id AS legal_entity_id,
       le.code AS legal_entity_code
     FROM tax_regimes tr
     JOIN countries c ON c.id = tr.country_id
     JOIN tax_codes tc
       ON tc.tenant_id = tr.tenant_id
      AND tc.tax_regime_id = tr.id
     JOIN legal_entities le
       ON le.tenant_id = tr.tenant_id
      AND le.status = 'ACTIVE'
      AND le.country_id = tr.country_id
      AND (tr.legal_entity_id IS NULL OR tr.legal_entity_id = le.id)
     WHERE ${where.join(" AND ")}
     ORDER BY tr.tenant_id ASC, tr.id ASC, tc.id ASC, le.id ASC
     ${limitClause}`,
    params
  );

  return result.rows || [];
}

async function preloadTaxAccountBackfillContext(candidates) {
  const tenantIdSet = new Set();
  const legalEntityIdSet = new Set();

  for (const row of candidates) {
    const tenantId = parsePositiveIntOrNull(row.tenant_id);
    const legalEntityId = parsePositiveIntOrNull(row.legal_entity_id);
    if (!tenantId || !legalEntityId) {
      continue;
    }
    tenantIdSet.add(tenantId);
    legalEntityIdSet.add(legalEntityId);
  }

  const tenantIds = Array.from(tenantIdSet);
  const legalEntityIds = Array.from(legalEntityIdSet);

  if (tenantIds.length === 0 || legalEntityIds.length === 0) {
    return {
      validAccountIdSet: new Set(),
      accountCodesByEntity: new Map(),
      jpaByEntity: new Map(),
      existingByExact: new Map(),
      reusableByRegimePurpose: new Map(),
    };
  }

  const tenantPlaceholders = tenantIds.map(() => "?").join(", ");
  const legalEntityPlaceholders = legalEntityIds.map(() => "?").join(", ");

  const accountResult = await query(
    `SELECT
       c.tenant_id,
       c.legal_entity_id,
       a.id,
       a.code
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.scope = 'LEGAL_ENTITY'
       AND c.tenant_id IN (${tenantPlaceholders})
       AND c.legal_entity_id IN (${legalEntityPlaceholders})
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE`,
    [...tenantIds, ...legalEntityIds]
  );

  const validAccountIdSet = new Set();
  const accountCodesByEntity = new Map();
  for (const row of accountResult.rows || []) {
    const tenantId = parsePositiveIntOrNull(row.tenant_id);
    const legalEntityId = parsePositiveIntOrNull(row.legal_entity_id);
    const accountId = parsePositiveIntOrNull(row.id);
    if (!tenantId || !legalEntityId || !accountId) {
      continue;
    }
    validAccountIdSet.add(accountId);

    const entityKey = makeEntityKey(tenantId, legalEntityId);
    if (!accountCodesByEntity.has(entityKey)) {
      accountCodesByEntity.set(entityKey, new Map());
    }
    const codeMap = accountCodesByEntity.get(entityKey);
    const accountCode = u(row.code);
    if (accountCode && !codeMap.has(accountCode)) {
      codeMap.set(accountCode, accountId);
    }
  }

  const allJpaAliases = Array.from(
    new Set(
      Object.values(JPA_ALIASES_BY_PURPOSE)
        .flat()
        .map((value) => u(value))
        .filter(Boolean)
    )
  );
  const jpaAliasPlaceholders = allJpaAliases.map(() => "?").join(", ");

  const jpaResult = await query(
    `SELECT
       tenant_id,
       legal_entity_id,
       purpose_code,
       account_id
     FROM journal_purpose_accounts
     WHERE tenant_id IN (${tenantPlaceholders})
       AND legal_entity_id IN (${legalEntityPlaceholders})
       AND purpose_code IN (${jpaAliasPlaceholders})`,
    [...tenantIds, ...legalEntityIds, ...allJpaAliases]
  );

  const jpaByEntity = new Map();
  for (const row of jpaResult.rows || []) {
    const tenantId = parsePositiveIntOrNull(row.tenant_id);
    const legalEntityId = parsePositiveIntOrNull(row.legal_entity_id);
    const accountId = parsePositiveIntOrNull(row.account_id);
    const purposeCode = u(row.purpose_code);
    if (!tenantId || !legalEntityId || !accountId || !purposeCode) {
      continue;
    }

    if (!validAccountIdSet.has(accountId)) {
      continue;
    }

    const entityKey = makeEntityKey(tenantId, legalEntityId);
    if (!jpaByEntity.has(entityKey)) {
      jpaByEntity.set(entityKey, new Map());
    }
    const entityPurposeMap = jpaByEntity.get(entityKey);
    if (!entityPurposeMap.has(purposeCode)) {
      entityPurposeMap.set(purposeCode, accountId);
    }
  }

  const mappingResult = await query(
    `SELECT
       tenant_id,
       tax_regime_id,
       legal_entity_id,
       tax_code_id,
       tax_purpose_code,
       account_id,
       status
     FROM tax_account_mappings
     WHERE tenant_id IN (${tenantPlaceholders})
       AND legal_entity_id IN (${legalEntityPlaceholders})`,
    [...tenantIds, ...legalEntityIds]
  );

  const existingByExact = new Map();
  const reusableByRegimePurpose = new Map();

  for (const row of mappingResult.rows || []) {
    const tenantId = parsePositiveIntOrNull(row.tenant_id);
    const regimeId = parsePositiveIntOrNull(row.tax_regime_id);
    const legalEntityId = parsePositiveIntOrNull(row.legal_entity_id);
    const taxCodeId = parsePositiveIntOrNull(row.tax_code_id);
    const accountId = parsePositiveIntOrNull(row.account_id);
    const taxPurposeCode = u(row.tax_purpose_code);
    const status = u(row.status);

    if (
      !tenantId ||
      !regimeId ||
      !legalEntityId ||
      !taxCodeId ||
      !taxPurposeCode ||
      !accountId
    ) {
      continue;
    }

    const exactKey = makeExactMappingKey(tenantId, legalEntityId, taxCodeId, taxPurposeCode);
    existingByExact.set(exactKey, {
      tenantId,
      regimeId,
      legalEntityId,
      taxCodeId,
      taxPurposeCode,
      accountId,
      status,
    });

    if (status !== "ACTIVE") {
      continue;
    }
    if (!validAccountIdSet.has(accountId)) {
      continue;
    }

    const reusableKey = makeReusableMappingKey(tenantId, legalEntityId, regimeId, taxPurposeCode);
    if (!reusableByRegimePurpose.has(reusableKey)) {
      reusableByRegimePurpose.set(reusableKey, accountId);
    }
  }

  return {
    validAccountIdSet,
    accountCodesByEntity,
    jpaByEntity,
    existingByExact,
    reusableByRegimePurpose,
  };
}

function resolveCandidateAccount({
  tenantId,
  legalEntityId,
  regimeId,
  taxCodeId,
  taxPurposeCode,
  countryIso2,
  resolvedByPurpose,
  context,
}) {
  const normalizedPurpose = u(taxPurposeCode);
  const exactKey = makeExactMappingKey(tenantId, legalEntityId, taxCodeId, normalizedPurpose);
  const existingExact = context.existingByExact.get(exactKey);
  if (existingExact && context.validAccountIdSet.has(existingExact.accountId)) {
    return {
      accountId: existingExact.accountId,
      source: "existing_exact",
      sourceDetail: normalizedPurpose,
      existingExact,
    };
  }

  const entityKey = makeEntityKey(tenantId, legalEntityId);
  const jpaPurposeMap = context.jpaByEntity.get(entityKey) || new Map();
  for (const alias of JPA_ALIASES_BY_PURPOSE[normalizedPurpose] || []) {
    const accountId = parsePositiveIntOrNull(jpaPurposeMap.get(u(alias)));
    if (accountId && context.validAccountIdSet.has(accountId)) {
      return {
        accountId,
        source: "journal_purpose_accounts",
        sourceDetail: u(alias),
        existingExact,
      };
    }
  }

  const reusableKey = makeReusableMappingKey(tenantId, legalEntityId, regimeId, normalizedPurpose);
  const reusableAccountId = parsePositiveIntOrNull(
    context.reusableByRegimePurpose.get(reusableKey)
  );
  if (reusableAccountId && context.validAccountIdSet.has(reusableAccountId)) {
    return {
      accountId: reusableAccountId,
      source: "reuse_regime_purpose",
      sourceDetail: normalizedPurpose,
      existingExact,
    };
  }

  if (normalizedPurpose === "VAT_PAYABLE") {
    const vatOutputAccountId = parsePositiveIntOrNull(resolvedByPurpose.get("VAT_OUTPUT"));
    if (vatOutputAccountId && context.validAccountIdSet.has(vatOutputAccountId)) {
      return {
        accountId: vatOutputAccountId,
        source: "derived_from_purpose",
        sourceDetail: "VAT_OUTPUT",
        existingExact,
      };
    }
  }

  if (normalizedPurpose === "VAT_RECEIVABLE") {
    const vatInputAccountId = parsePositiveIntOrNull(resolvedByPurpose.get("VAT_INPUT"));
    if (vatInputAccountId && context.validAccountIdSet.has(vatInputAccountId)) {
      return {
        accountId: vatInputAccountId,
        source: "derived_from_purpose",
        sourceDetail: "VAT_INPUT",
        existingExact,
      };
    }
  }

  const accountCodeMap = context.accountCodesByEntity.get(entityKey) || new Map();
  for (const fallbackCode of getAccountCodeFallbacks(normalizedPurpose, countryIso2)) {
    const accountId = parsePositiveIntOrNull(accountCodeMap.get(u(fallbackCode)));
    if (accountId && context.validAccountIdSet.has(accountId)) {
      return {
        accountId,
        source: "account_code_fallback",
        sourceDetail: u(fallbackCode),
        existingExact,
      };
    }
  }

  return {
    accountId: null,
    source: "unresolved",
    sourceDetail: null,
    existingExact,
  };
}

function buildPlan(candidates, context) {
  const plan = [];
  const unresolved = [];

  for (const row of candidates) {
    const tenantId = parsePositiveIntOrNull(row.tenant_id);
    const regimeId = parsePositiveIntOrNull(row.tax_regime_id);
    const taxCodeId = parsePositiveIntOrNull(row.tax_code_id);
    const legalEntityId = parsePositiveIntOrNull(row.legal_entity_id);
    const countryIso2 = u(row.country_iso2);
    if (!tenantId || !regimeId || !taxCodeId || !legalEntityId) {
      continue;
    }

    const resolvedByPurpose = new Map();
    const purposes = getPurposeCodesByTaxKind(row.tax_kind);

    for (const purposeCode of purposes) {
      const normalizedPurpose = u(purposeCode);
      const resolution = resolveCandidateAccount({
        tenantId,
        legalEntityId,
        regimeId,
        taxCodeId,
        taxPurposeCode: normalizedPurpose,
        countryIso2,
        resolvedByPurpose,
        context,
      });

      if (!resolution.accountId) {
        unresolved.push({
          tenantId,
          legalEntityId,
          regimeId,
          taxCodeId,
          taxCode: row.tax_code,
          taxKind: u(row.tax_kind),
          taxPurposeCode: normalizedPurpose,
          countryIso2,
        });
        continue;
      }

      resolvedByPurpose.set(normalizedPurpose, resolution.accountId);

      const existingExact = resolution.existingExact || null;
      const normalizedStatus = u(existingExact?.status);
      const action =
        existingExact &&
        parsePositiveIntOrNull(existingExact.accountId) === resolution.accountId &&
        parsePositiveIntOrNull(existingExact.regimeId) === regimeId &&
        normalizedStatus === "ACTIVE"
          ? "unchanged"
          : "upsert";

      const reusableKey = makeReusableMappingKey(
        tenantId,
        legalEntityId,
        regimeId,
        normalizedPurpose
      );
      if (!context.reusableByRegimePurpose.has(reusableKey)) {
        context.reusableByRegimePurpose.set(reusableKey, resolution.accountId);
      }

      plan.push({
        tenantId,
        legalEntityId,
        regimeId,
        taxCodeId,
        taxCode: row.tax_code,
        taxKind: u(row.tax_kind),
        taxPurposeCode: normalizedPurpose,
        accountId: resolution.accountId,
        source: resolution.source,
        sourceDetail: resolution.sourceDetail,
        action,
      });
    }
  }

  return {
    plan,
    unresolved,
  };
}

async function applyPlan(plan) {
  let upsertedCount = 0;

  await withTransaction(async (tx) => {
    for (const item of plan) {
      if (item.action !== "upsert") {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO tax_account_mappings (
            tenant_id,
            tax_regime_id,
            legal_entity_id,
            tax_code_id,
            tax_purpose_code,
            account_id,
            status
         )
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
         ON DUPLICATE KEY UPDATE
           tax_regime_id = VALUES(tax_regime_id),
           account_id = VALUES(account_id),
           status = 'ACTIVE',
           updated_at = CURRENT_TIMESTAMP`,
        [
          item.tenantId,
          item.regimeId,
          item.legalEntityId,
          item.taxCodeId,
          item.taxPurposeCode,
          item.accountId,
        ]
      );

      upsertedCount += 1;
    }
  });

  return {
    upsertedCount,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await loadCandidateTaxRows(args);
  const context = await preloadTaxAccountBackfillContext(candidates);
  const { plan, unresolved } = buildPlan(candidates, context);

  const unchangedCount = plan.filter((row) => row.action === "unchanged").length;
  const upsertCount = plan.filter((row) => row.action === "upsert").length;

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        filters: {
          tenantId: args.tenantId,
          legalEntityId: args.legalEntityId,
          regimeId: args.regimeId,
          effectiveOn: args.effectiveOn,
          limit: args.limit,
        },
        candidateCount: candidates.length,
        resolvedCount: plan.length,
        upsertCount,
        unchangedCount,
        unresolvedCount: unresolved.length,
        sample: plan.slice(0, 12),
        unresolvedSample: unresolved.slice(0, 12),
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to write tax account mappings.");
    return;
  }

  const applyMetrics = await applyPlan(plan);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "apply",
        candidateCount: candidates.length,
        resolvedCount: plan.length,
        unresolvedCount: unresolved.length,
        unchangedCount,
        ...applyMetrics,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
