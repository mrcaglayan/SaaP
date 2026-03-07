import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDecimalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(6)) : null;
}

function toDateOnlyString(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const directMatch = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (directMatch?.[0]) {
    return directMatch[0];
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export async function listCariSettlementDrilldownsByBatchIds({
  tenantId,
  settlementBatchIds,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedTenantId) {
    throw badRequest("tenantId is required");
  }

  const batchIds = Array.from(
    new Set((settlementBatchIds || []).map((value) => parsePositiveInt(value)).filter(Boolean))
  );
  if (batchIds.length === 0) {
    return [];
  }

  const placeholders = batchIds.map(() => "?").join(", ");
  const batchResult = await runQuery(
    `SELECT
       b.id,
       b.tenant_id,
       b.legal_entity_id,
       b.counterparty_id,
       b.cash_transaction_id,
       b.settlement_no,
       b.direction,
       b.settlement_date,
       b.status,
       b.total_allocated_txn,
       b.total_allocated_base,
       b.currency_code,
       b.posted_journal_entry_id,
       b.reversal_of_settlement_batch_id,
       b.created_at,
       b.updated_at,
       cp.code AS counterparty_code,
       cp.name AS counterparty_name
     FROM cari_settlement_batches b
     LEFT JOIN counterparties cp
       ON cp.tenant_id = b.tenant_id
      AND cp.legal_entity_id = b.legal_entity_id
      AND cp.id = b.counterparty_id
     WHERE b.tenant_id = ?
       AND b.id IN (${placeholders})
     ORDER BY b.settlement_date ASC, b.id ASC`,
    [parsedTenantId, ...batchIds]
  );

  const allocationResult = await runQuery(
    `SELECT
       a.settlement_batch_id,
       a.id AS allocation_id,
       a.open_item_id,
       a.allocation_date,
       a.allocation_amount_txn,
       a.allocation_amount_doc_txn,
       a.allocation_amount_settlement_txn,
       a.allocation_amount_base,
       a.document_currency_code,
       a.settlement_currency_code,
       a.applied_cross_rate,
       a.cross_rate_source,
       a.cross_rate_date,
       oi.item_no,
       oi.status AS open_item_status,
       oi.currency_code AS open_item_currency_code,
       d.id AS document_id,
       d.document_no,
       d.document_date,
       d.document_type,
       d.direction AS document_direction,
       d.status AS document_status,
       d.counterparty_code_snapshot,
       d.counterparty_name_snapshot,
       d.currency_code_snapshot,
       d.posted_journal_entry_id AS document_posted_journal_entry_id
     FROM cari_settlement_allocations a
     LEFT JOIN cari_open_items oi
       ON oi.tenant_id = a.tenant_id
      AND oi.legal_entity_id = a.legal_entity_id
      AND oi.id = a.open_item_id
     LEFT JOIN cari_documents d
       ON d.tenant_id = oi.tenant_id
      AND d.legal_entity_id = oi.legal_entity_id
      AND d.id = oi.document_id
     WHERE a.tenant_id = ?
       AND a.settlement_batch_id IN (${placeholders})
     ORDER BY a.settlement_batch_id ASC, a.id ASC`,
    [parsedTenantId, ...batchIds]
  );

  const drilldownByBatchId = new Map();
  for (const row of batchResult.rows || []) {
    const settlementBatchId = parsePositiveInt(row.id);
    if (!settlementBatchId) {
      continue;
    }
    drilldownByBatchId.set(settlementBatchId, {
      settlementBatchId,
      legalEntityId: parsePositiveInt(row.legal_entity_id),
      counterpartyId: parsePositiveInt(row.counterparty_id),
      counterpartyCode: row.counterparty_code || null,
      counterpartyName: row.counterparty_name || null,
      cashTransactionId: parsePositiveInt(row.cash_transaction_id),
      settlementNo: row.settlement_no || null,
      direction: normalizeUpperText(row.direction) || null,
      settlementDate: toDateOnlyString(row.settlement_date),
      status: row.status || null,
      totalAllocatedTxn: toDecimalNumber(row.total_allocated_txn),
      totalAllocatedBase: toDecimalNumber(row.total_allocated_base),
      currencyCode: normalizeUpperText(row.currency_code) || null,
      postedJournalEntryId: parsePositiveInt(row.posted_journal_entry_id),
      reversalOfSettlementBatchId: parsePositiveInt(row.reversal_of_settlement_batch_id),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      appliedDocuments: [],
    });
  }

  for (const row of allocationResult.rows || []) {
    const settlementBatchId = parsePositiveInt(row.settlement_batch_id);
    const drilldown = drilldownByBatchId.get(settlementBatchId);
    if (!drilldown) {
      continue;
    }
    drilldown.appliedDocuments.push({
      allocationId: parsePositiveInt(row.allocation_id),
      openItemId: parsePositiveInt(row.open_item_id),
      itemNo:
        row.item_no === null || row.item_no === undefined ? null : Number(row.item_no),
      openItemStatus: row.open_item_status || null,
      allocationDate: toDateOnlyString(row.allocation_date),
      allocationAmountTxn: toDecimalNumber(row.allocation_amount_txn),
      allocationAmountDocTxn: toDecimalNumber(
        row.allocation_amount_doc_txn === null || row.allocation_amount_doc_txn === undefined
          ? row.allocation_amount_txn
          : row.allocation_amount_doc_txn
      ),
      allocationAmountSettlementTxn: toDecimalNumber(
        row.allocation_amount_settlement_txn === null ||
          row.allocation_amount_settlement_txn === undefined
          ? row.allocation_amount_txn
          : row.allocation_amount_settlement_txn
      ),
      allocationAmountBase: toDecimalNumber(row.allocation_amount_base),
      documentId: parsePositiveInt(row.document_id),
      documentNo: row.document_no || null,
      documentDate: toDateOnlyString(row.document_date),
      documentType: row.document_type || null,
      documentDirection: normalizeUpperText(row.document_direction) || null,
      documentStatus: row.document_status || null,
      documentCurrencyCode:
        normalizeUpperText(row.document_currency_code) ||
        normalizeUpperText(row.currency_code_snapshot) ||
        normalizeUpperText(row.open_item_currency_code) ||
        null,
      appliedCrossRate: toDecimalNumber(row.applied_cross_rate),
      crossRateSource: row.cross_rate_source || null,
      crossRateDate: toDateOnlyString(row.cross_rate_date),
      counterpartyCodeSnapshot: row.counterparty_code_snapshot || null,
      counterpartyNameSnapshot: row.counterparty_name_snapshot || null,
      postedJournalEntryId: parsePositiveInt(row.document_posted_journal_entry_id),
    });
  }

  return batchIds.map((batchId) => drilldownByBatchId.get(batchId)).filter(Boolean);
}
