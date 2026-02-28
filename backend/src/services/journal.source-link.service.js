import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeSourceRefType(value) {
  const normalized = normalizeUpperText(value);
  if (!normalized) {
    throw badRequest("sourceRefType is required");
  }
  return normalized.slice(0, 80);
}

function normalizeLinkRole(value) {
  const normalized = normalizeUpperText(value || "PRIMARY");
  return (normalized || "PRIMARY").slice(0, 40);
}

export async function upsertJournalSourceLinkTx(tx, payload) {
  if (!tx || typeof tx.query !== "function") {
    throw new Error("upsertJournalSourceLinkTx requires a transaction object with query()");
  }

  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const journalEntryId = parsePositiveInt(payload?.journalEntryId);
  const sourceRefId = parsePositiveInt(payload?.sourceRefId);
  const sourceRefType = normalizeSourceRefType(payload?.sourceRefType);
  const linkRole = normalizeLinkRole(payload?.linkRole);

  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!legalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (!journalEntryId) {
    throw badRequest("journalEntryId is required");
  }
  if (!sourceRefId) {
    throw badRequest("sourceRefId is required");
  }

  await tx.query(
    `INSERT INTO journal_source_links (
        tenant_id,
        legal_entity_id,
        journal_entry_id,
        source_ref_type,
        source_ref_id,
        link_role
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        legal_entity_id = VALUES(legal_entity_id),
        source_ref_type = VALUES(source_ref_type),
        source_ref_id = VALUES(source_ref_id)`,
    [tenantId, legalEntityId, journalEntryId, sourceRefType, sourceRefId, linkRole]
  );
}

export async function listJournalSourceLinksByJournalIds({
  tenantId,
  journalEntryIds,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedTenantId) {
    throw badRequest("tenantId is required");
  }

  const ids = Array.from(
    new Set((journalEntryIds || []).map((value) => parsePositiveInt(value)).filter(Boolean))
  );
  if (ids.length === 0) {
    return new Map();
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        journal_entry_id,
        source_ref_type,
        source_ref_id,
        link_role,
        created_at
      FROM journal_source_links
      WHERE tenant_id = ?
        AND journal_entry_id IN (${placeholders})
      ORDER BY journal_entry_id ASC, id ASC`,
    [parsedTenantId, ...ids]
  );

  const rows = result.rows || [];
  const map = new Map();
  for (const row of rows) {
    const journalEntryId = parsePositiveInt(row.journal_entry_id);
    if (!journalEntryId) {
      continue;
    }
    if (!map.has(journalEntryId)) {
      map.set(journalEntryId, []);
    }
    map.get(journalEntryId).push(row);
  }
  return map;
}
