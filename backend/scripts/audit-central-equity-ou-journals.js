import { closePool, query } from "../src/db.js";

const SHAREHOLDER_PARENT_PURPOSE_CODES = Object.freeze([
  "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
  "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
]);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    legalEntityId: null,
    limit: 200,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (!token) {
      continue;
    }
    if (token === "--tenantId") {
      args.tenantId = parsePositiveInt(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--legalEntityId") {
      args.legalEntityId = parsePositiveInt(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--limit") {
      args.limit = parsePositiveInt(argv[index + 1]) || args.limit;
      index += 1;
      continue;
    }
    if (token === "--json") {
      args.json = true;
    }
  }

  if (!args.tenantId) {
    throw new Error(
      "Usage: node scripts/audit-central-equity-ou-journals.js --tenantId <id> [--legalEntityId <id>] [--limit <n>] [--json]"
    );
  }

  return args;
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    return "0.000000";
  }
  return amount.toFixed(6);
}

function collectDescendantAccountIds(rootIds, accounts) {
  const childrenByParentId = new Map();
  for (const account of accounts) {
    const parentAccountId = parsePositiveInt(account?.parent_account_id);
    const accountId = parsePositiveInt(account?.id);
    if (!parentAccountId || !accountId) {
      continue;
    }
    if (!childrenByParentId.has(parentAccountId)) {
      childrenByParentId.set(parentAccountId, []);
    }
    childrenByParentId.get(parentAccountId).push(accountId);
  }

  const visited = new Set();
  const stack = Array.from(rootIds);
  while (stack.length > 0) {
    const accountId = stack.pop();
    if (!accountId || visited.has(accountId)) {
      continue;
    }
    visited.add(accountId);
    for (const childId of childrenByParentId.get(accountId) || []) {
      stack.push(childId);
    }
  }
  return visited;
}

async function loadLegalEntities({ tenantId, legalEntityId }) {
  const params = [tenantId];
  let sql = `
    SELECT id, code, name
    FROM legal_entities
    WHERE tenant_id = ?
  `;
  if (legalEntityId) {
    sql += " AND id = ?";
    params.push(legalEntityId);
  }
  sql += " ORDER BY id";
  const result = await query(sql, params);
  return result.rows || [];
}

async function loadScopedAccounts({ tenantId, legalEntityIds }) {
  if (legalEntityIds.length === 0) {
    return [];
  }
  const placeholders = legalEntityIds.map(() => "?").join(", ");
  const result = await query(
    `SELECT
       a.id,
       a.parent_account_id,
       a.code,
       a.name,
       c.legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id IN (${placeholders})`,
    [tenantId, ...legalEntityIds]
  );
  return result.rows || [];
}

async function loadMappedShareholderParents({ tenantId, legalEntityIds }) {
  if (legalEntityIds.length === 0) {
    return [];
  }
  const legalEntityPlaceholders = legalEntityIds.map(() => "?").join(", ");
  const purposePlaceholders = SHAREHOLDER_PARENT_PURPOSE_CODES.map(() => "?").join(", ");
  const result = await query(
    `SELECT legal_entity_id, purpose_code, account_id
     FROM journal_purpose_accounts
     WHERE tenant_id = ?
       AND legal_entity_id IN (${legalEntityPlaceholders})
       AND purpose_code IN (${purposePlaceholders})`,
    [tenantId, ...legalEntityIds, ...SHAREHOLDER_PARENT_PURPOSE_CODES]
  );
  return result.rows || [];
}

async function loadSuspiciousJournalLines({ tenantId, legalEntityIds, accountIds, limit }) {
  if (legalEntityIds.length === 0 || accountIds.length === 0) {
    return [];
  }
  const legalEntityPlaceholders = legalEntityIds.map(() => "?").join(", ");
  const accountPlaceholders = accountIds.map(() => "?").join(", ");
  const result = await query(
    `SELECT
       je.legal_entity_id,
       je.id AS journal_entry_id,
       je.journal_no,
       je.status AS journal_status,
       je.entry_date,
       jl.id AS journal_line_id,
       jl.line_no,
       jl.account_id,
       a.code AS account_code,
       a.name AS account_name,
       jl.operating_unit_id,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       jl.debit_base,
       jl.credit_base
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     JOIN accounts a ON a.id = jl.account_id
     LEFT JOIN operating_units ou ON ou.id = jl.operating_unit_id
     WHERE je.tenant_id = ?
       AND je.legal_entity_id IN (${legalEntityPlaceholders})
       AND jl.operating_unit_id IS NOT NULL
       AND jl.account_id IN (${accountPlaceholders})
     ORDER BY je.legal_entity_id, je.id, jl.line_no
     LIMIT ?`,
    [tenantId, ...legalEntityIds, ...accountIds, limit]
  );
  return result.rows || [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const legalEntities = await loadLegalEntities(options);
  const legalEntityIds = legalEntities.map((row) => parsePositiveInt(row.id)).filter(Boolean);
  const legalEntityById = new Map(
    legalEntities.map((row) => [parsePositiveInt(row.id), row])
  );

  const accounts = await loadScopedAccounts({
    tenantId: options.tenantId,
    legalEntityIds,
  });
  const mappedParents = await loadMappedShareholderParents({
    tenantId: options.tenantId,
    legalEntityIds,
  });

  const accountsByLegalEntityId = new Map();
  for (const account of accounts) {
    const legalEntityId = parsePositiveInt(account?.legal_entity_id);
    if (!legalEntityId) {
      continue;
    }
    if (!accountsByLegalEntityId.has(legalEntityId)) {
      accountsByLegalEntityId.set(legalEntityId, []);
    }
    accountsByLegalEntityId.get(legalEntityId).push(account);
  }

  const rootIdsByLegalEntityId = new Map();
  for (const row of mappedParents) {
    const legalEntityId = parsePositiveInt(row?.legal_entity_id);
    const accountId = parsePositiveInt(row?.account_id);
    if (!legalEntityId || !accountId) {
      continue;
    }
    if (!rootIdsByLegalEntityId.has(legalEntityId)) {
      rootIdsByLegalEntityId.set(legalEntityId, new Set());
    }
    rootIdsByLegalEntityId.get(legalEntityId).add(accountId);
  }

  for (const legalEntityId of legalEntityIds) {
    const accountRows = accountsByLegalEntityId.get(legalEntityId) || [];
    if (!rootIdsByLegalEntityId.has(legalEntityId)) {
      rootIdsByLegalEntityId.set(legalEntityId, new Set());
    }
    for (const account of accountRows) {
      const normalizedCode = String(account?.code || "").trim();
      if (normalizedCode === "500" || normalizedCode === "501") {
        rootIdsByLegalEntityId.get(legalEntityId).add(parsePositiveInt(account.id));
      }
    }
  }

  const descendantAccountIds = new Set();
  const rootsSummary = [];
  for (const legalEntityId of legalEntityIds) {
    const rootIds = rootIdsByLegalEntityId.get(legalEntityId) || new Set();
    const accountRows = accountsByLegalEntityId.get(legalEntityId) || [];
    const descendants = collectDescendantAccountIds(rootIds, accountRows);
    for (const accountId of descendants) {
      descendantAccountIds.add(accountId);
    }
    const roots = accountRows
      .filter((row) => rootIds.has(parsePositiveInt(row.id)))
      .map((row) => ({
        accountId: parsePositiveInt(row.id),
        code: String(row.code || ""),
        name: String(row.name || ""),
      }))
      .sort((left, right) => String(left.code).localeCompare(String(right.code)));
    rootsSummary.push({
      legalEntityId,
      legalEntityCode: legalEntityById.get(legalEntityId)?.code || String(legalEntityId),
      roots,
    });
  }

  const findings = await loadSuspiciousJournalLines({
    tenantId: options.tenantId,
    legalEntityIds,
    accountIds: Array.from(descendantAccountIds),
    limit: options.limit,
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          tenantId: options.tenantId,
          legalEntityId: options.legalEntityId || null,
          rootsSummary,
          findings,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Tenant: ${options.tenantId}`);
  if (options.legalEntityId) {
    console.log(`Legal entity filter: ${options.legalEntityId}`);
  }
  console.log("");
  console.log("Central equity roots by legal entity:");
  for (const row of rootsSummary) {
    const rootLabel =
      row.roots.length > 0
        ? row.roots.map((root) => `${root.code} (#${root.accountId})`).join(", ")
        : "(none found)";
    console.log(`- ${row.legalEntityCode} (#${row.legalEntityId}): ${rootLabel}`);
  }

  console.log("");
  console.log(`Findings: ${findings.length}`);
  for (const row of findings) {
    const legalEntity = legalEntityById.get(parsePositiveInt(row.legal_entity_id));
    const operatingUnitLabel =
      row.operating_unit_code || row.operating_unit_name
        ? `${row.operating_unit_code || row.operating_unit_id} - ${row.operating_unit_name || "-"}`
        : `#${row.operating_unit_id}`;
    console.log(
      [
        `- ${legalEntity?.code || row.legal_entity_id}`,
        `JE ${row.journal_no} (#${row.journal_entry_id})`,
        `Line ${row.line_no}`,
        `${row.account_code} - ${row.account_name}`,
        `OU ${operatingUnitLabel}`,
        `Dr ${formatMoney(row.debit_base)}`,
        `Cr ${formatMoney(row.credit_base)}`,
      ].join(" | ")
    );
  }
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
