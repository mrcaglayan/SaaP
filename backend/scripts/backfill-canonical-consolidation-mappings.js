import { closePool, query, withTransaction } from "../src/db.js";

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    consolidationGroupId: null,
    apply: false,
    limit: null,
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
    if (token.startsWith("--groupId=")) {
      args.consolidationGroupId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--groupId") {
      args.consolidationGroupId = parsePositiveIntOrNull(argv[i + 1]);
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

function buildCanonicalKeyFromCode(code) {
  return `ACC_CODE:${String(code || "").trim().toUpperCase()}`;
}

async function loadBackfillCandidates({ tenantId, consolidationGroupId, limit }) {
  const where = ["gcm.status = 'ACTIVE'"];
  const params = [];

  if (tenantId) {
    where.push("gcm.tenant_id = ?");
    params.push(tenantId);
  }
  if (consolidationGroupId) {
    where.push("gcm.consolidation_group_id = ?");
    params.push(consolidationGroupId);
  }

  const limitValue = parsePositiveIntOrNull(limit);
  const limitClause = limitValue ? `LIMIT ${limitValue}` : "";

  const result = await query(
    `SELECT
       gcm.tenant_id,
       gcm.consolidation_group_id,
       gcm.legal_entity_id,
       local_acc.id AS local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       group_acc.id AS group_account_id,
       group_acc.code AS group_account_code,
       group_acc.name AS group_account_name
     FROM group_coa_mappings gcm
     JOIN accounts local_acc
       ON local_acc.coa_id = gcm.local_coa_id
      AND local_acc.is_active = TRUE
     JOIN accounts group_acc
       ON group_acc.coa_id = gcm.group_coa_id
      AND group_acc.code = local_acc.code
      AND group_acc.is_active = TRUE
     WHERE ${where.join(" AND ")}
     ORDER BY gcm.tenant_id, gcm.consolidation_group_id, gcm.legal_entity_id, local_acc.code
     ${limitClause}`,
    params
  );

  return result.rows || [];
}

async function upsertCanonicalKeyTx(tx, row) {
  const canonicalKey = buildCanonicalKeyFromCode(row.local_account_code);
  const canonicalName = `Canonical ${row.local_account_code}`;

  await tx.query(
    `INSERT INTO consolidation_canonical_keys (
        tenant_id,
        consolidation_group_id,
        canonical_key,
        canonical_name,
        canonical_type,
        purpose_code,
        status
     )
     VALUES (?, ?, ?, ?, 'ACCOUNT', NULL, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       canonical_name = VALUES(canonical_name),
       canonical_type = VALUES(canonical_type),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [row.tenant_id, row.consolidation_group_id, canonicalKey, canonicalName]
  );

  const keyResult = await tx.query(
    `SELECT id
     FROM consolidation_canonical_keys
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND canonical_key = ?
     LIMIT 1`,
    [row.tenant_id, row.consolidation_group_id, canonicalKey]
  );
  const canonicalKeyId = parsePositiveIntOrNull(keyResult.rows?.[0]?.id);
  if (!canonicalKeyId) {
    throw new Error("Failed to resolve canonical key id during backfill");
  }

  return { canonicalKey, canonicalKeyId };
}

async function applyBackfill(candidates) {
  const metrics = {
    canonicalKeysTouched: 0,
    localMappingsTouched: 0,
    groupMappingsTouched: 0,
  };
  const seenKey = new Set();
  const seenLocal = new Set();
  const seenGroup = new Set();

  await withTransaction(async (tx) => {
    for (const row of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const { canonicalKey, canonicalKeyId } = await upsertCanonicalKeyTx(tx, row);
      const keyScope = `${row.tenant_id}:${row.consolidation_group_id}:${canonicalKey}`;
      if (!seenKey.has(keyScope)) {
        seenKey.add(keyScope);
        metrics.canonicalKeysTouched += 1;
      }

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO consolidation_canonical_local_account_mappings (
            tenant_id,
            consolidation_group_id,
            legal_entity_id,
            local_account_id,
            canonical_key_id,
            status,
            effective_from,
            effective_to
         )
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', CURRENT_DATE, NULL)
         ON DUPLICATE KEY UPDATE
           canonical_key_id = VALUES(canonical_key_id),
           status = VALUES(status),
           effective_to = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [
          row.tenant_id,
          row.consolidation_group_id,
          row.legal_entity_id,
          row.local_account_id,
          canonicalKeyId,
        ]
      );
      const localScope = `${row.tenant_id}:${row.consolidation_group_id}:${row.legal_entity_id}:${row.local_account_id}`;
      if (!seenLocal.has(localScope)) {
        seenLocal.add(localScope);
        metrics.localMappingsTouched += 1;
      }

      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO consolidation_canonical_group_account_mappings (
            tenant_id,
            consolidation_group_id,
            canonical_key_id,
            group_account_id,
            status,
            effective_from,
            effective_to
         )
         VALUES (?, ?, ?, ?, 'ACTIVE', CURRENT_DATE, NULL)
         ON DUPLICATE KEY UPDATE
           group_account_id = VALUES(group_account_id),
           status = VALUES(status),
           effective_to = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [
          row.tenant_id,
          row.consolidation_group_id,
          canonicalKeyId,
          row.group_account_id,
        ]
      );
      const groupScope = `${row.tenant_id}:${row.consolidation_group_id}:${canonicalKeyId}`;
      if (!seenGroup.has(groupScope)) {
        seenGroup.add(groupScope);
        metrics.groupMappingsTouched += 1;
      }
    }
  });

  return metrics;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await loadBackfillCandidates(args);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        filters: {
          tenantId: args.tenantId,
          consolidationGroupId: args.consolidationGroupId,
          limit: args.limit,
        },
        candidateCount: candidates.length,
        sample: candidates.slice(0, 5).map((row) => ({
          tenantId: row.tenant_id,
          consolidationGroupId: row.consolidation_group_id,
          legalEntityId: row.legal_entity_id,
          localAccountId: row.local_account_id,
          localAccountCode: row.local_account_code,
          groupAccountId: row.group_account_id,
          groupAccountCode: row.group_account_code,
          canonicalKey: buildCanonicalKeyFromCode(row.local_account_code),
        })),
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to write canonical mappings.");
    return;
  }

  const metrics = await applyBackfill(candidates);
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
