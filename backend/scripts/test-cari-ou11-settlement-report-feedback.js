import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import {
  getCariCounterpartyStatementReport,
  getCariOpenItemsReport,
  getCariSettlementRealizedFxReport,
} from "../src/services/cari.report.service.js";
import { applyCariSettlement } from "../src/services/cari.settlement.service.js";
import { listCariSettlementDrilldownsByBatchIds } from "../src/services/cari.settlement.drilldown.service.js";
import {
  assert,
  assertScopeAccess,
  assertThrowsAsync,
  buildReq,
  setupCariOu09Fixture,
  toNumber,
  uniqueToken,
} from "./cari-ou09-test-helpers.js";

const TEST_DATE = "2026-03-13";

function buildScopeFilter() {
  return "1=1";
}

function normalizeOperatingUnitId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toNumber(value) || null;
}

function hasText(source, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped).test(source);
}

function findById(rows, key, id) {
  return (Array.isArray(rows) ? rows : []).find((row) => toNumber(row?.[key]) === toNumber(id)) || null;
}

function findSettlementLink(rows, documentId, settlementBatchId) {
  const documentRow = findById(rows, "documentId", documentId);
  assert(documentRow, `Missing statement document row for documentId=${documentId}`);
  return (
    (Array.isArray(documentRow.settlementLinks) ? documentRow.settlementLinks : []).find(
      (row) => toNumber(row?.settlementBatchId) === toNumber(settlementBatchId)
    ) || null
  );
}

function assertSettlementContext(
  row,
  {
    ownerOperatingUnitId,
    collectorOperatingUnitId,
    originatingCrossContextSettlementBatchId = null,
    isCrossContext,
    ownerLabelIncludes = null,
    collectorLabelIncludes = null,
  },
  label
) {
  assert(row, `${label}: row is required`);
  assert(
    normalizeOperatingUnitId(row.ownerOperatingUnitId) ===
      normalizeOperatingUnitId(ownerOperatingUnitId),
    `${label}: expected ownerOperatingUnitId=${String(ownerOperatingUnitId)}, got ${String(
      row.ownerOperatingUnitId
    )}`
  );
  assert(
    normalizeOperatingUnitId(row.collectorOperatingUnitId) ===
      normalizeOperatingUnitId(collectorOperatingUnitId),
    `${label}: expected collectorOperatingUnitId=${String(
      collectorOperatingUnitId
    )}, got ${String(row.collectorOperatingUnitId)}`
  );
  assert(
    toNumber(row.originatingCrossContextSettlementBatchId) ===
      toNumber(originatingCrossContextSettlementBatchId),
    `${label}: expected originatingCrossContextSettlementBatchId=${String(
      originatingCrossContextSettlementBatchId
    )}, got ${String(row.originatingCrossContextSettlementBatchId)}`
  );
  assert(
    Boolean(row.isCrossContext) === Boolean(isCrossContext),
    `${label}: expected isCrossContext=${String(isCrossContext)}, got ${String(
      row.isCrossContext
    )}`
  );
  if (ownerLabelIncludes) {
    assert(
      String(row.ownerContextLabel || "").includes(ownerLabelIncludes),
      `${label}: ownerContextLabel should include "${ownerLabelIncludes}", got "${String(
        row.ownerContextLabel || ""
      )}"`
    );
  }
  if (collectorLabelIncludes) {
    assert(
      String(row.collectorContextLabel || "").includes(collectorLabelIncludes),
      `${label}: collectorContextLabel should include "${collectorLabelIncludes}", got "${String(
        row.collectorContextLabel || ""
      )}"`
    );
  }
}

async function applySettlement(fixture, req, payload) {
  return applyCariSettlement({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      counterpartyId: fixture.counterpartyId,
      direction: "AR",
      settlementDate: TEST_DATE,
      currencyCode: fixture.functionalCurrencyCode,
      useUnappliedCash: false,
      userId: fixture.userId,
      ...payload,
    },
  });
}

async function createPostedJournalEntry(fixture, suffix) {
  const fiscalPeriodResult = await query(
    `SELECT fp.id
     FROM fiscal_periods fp
     JOIN books b
       ON b.calendar_id = fp.calendar_id
     WHERE b.id = ?
       AND ? BETWEEN fp.start_date AND fp.end_date
     ORDER BY fp.start_date ASC
     LIMIT 1`,
    [fixture.bookId, TEST_DATE]
  );
  const fiscalPeriodId = toNumber(fiscalPeriodResult.rows?.[0]?.id);
  assert(fiscalPeriodId > 0, "Expected an open fiscal period for the OU11 fixture date");

  const journalNo = uniqueToken(`OU11-DOC-${suffix}-`).slice(0, 40);
  await query(
    `INSERT INTO journal_entries (
        tenant_id,
        legal_entity_id,
        book_id,
        fiscal_period_id,
        journal_no,
        source_type,
        status,
        entry_date,
        document_date,
        currency_code,
        description,
        total_debit_base,
        total_credit_base,
        created_by_user_id,
        posted_by_user_id,
        posted_at
     ) VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', ?, ?, ?, ?, 0.000000, 0.000000, ?, ?, NOW())`,
    [
      fixture.tenantId,
      fixture.legalEntityId,
      fixture.bookId,
      fiscalPeriodId,
      journalNo,
      TEST_DATE,
      TEST_DATE,
      fixture.functionalCurrencyCode,
      `OU11 reportable document ${suffix}`,
      fixture.userId,
      fixture.userId,
    ]
  );

  const journalResult = await query(
    `SELECT id
     FROM journal_entries
     WHERE tenant_id = ?
       AND book_id = ?
       AND journal_no = ?
     LIMIT 1`,
    [fixture.tenantId, fixture.bookId, journalNo]
  );
  const journalEntryId = toNumber(journalResult.rows?.[0]?.id);
  assert(journalEntryId > 0, `Failed to create posted journal entry for ${suffix}`);
  return journalEntryId;
}

async function markDocumentsReportable(fixture, documentIds) {
  const ids = Array.from(new Set((documentIds || []).map((value) => toNumber(value)).filter(Boolean)));
  for (let index = 0; index < ids.length; index += 1) {
    const documentId = ids[index];
    const postedJournalEntryId = await createPostedJournalEntry(
      fixture,
      `DOC-${documentId}-${index + 1}`
    );
    await query(
      `UPDATE cari_documents
       SET status = 'SETTLED',
           posted_journal_entry_id = ?
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?`,
      [postedJournalEntryId, fixture.tenantId, fixture.legalEntityId, documentId]
    );
  }
}

async function main() {
  const fixture = await setupCariOu09Fixture({ prefix: "OU11" });
  const req = buildReq(fixture.tenantId, fixture.userId);

  const rootOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.ownerOperatingUnitId,
    amountTxn: 60,
    amountBase: 60,
  });
  const rootBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 60,
  });
  const rootSettlement = await applySettlement(fixture, req, {
    incomingAmountTxn: 60,
    bankStatementLineId: rootBankLine.id,
    idempotencyKey: uniqueToken("OU11-ROOT-"),
    allocations: [{ openItemId: rootOpenItem.openItemId, amountTxn: 60 }],
  });

  const downstreamOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.collectorOperatingUnitId,
    amountTxn: 25,
    amountBase: 25,
  });
  const downstreamBankLine = await fixture.createBankStatementLine({
    contextKey: "COLLECTOR",
    amount: 25,
  });
  const downstreamSettlement = await applySettlement(fixture, req, {
    incomingAmountTxn: 25,
    bankStatementLineId: downstreamBankLine.id,
    idempotencyKey: uniqueToken("OU11-DOWNSTREAM-"),
    sourceModule: "CARI",
    sourceEntityType: "cari_settlement_batch",
    sourceEntityId: String(rootSettlement?.row?.id),
    allocations: [{ openItemId: downstreamOpenItem.openItemId, amountTxn: 25 }],
  });
  await markDocumentsReportable(fixture, [
    rootOpenItem.documentId,
    downstreamOpenItem.documentId,
  ]);

  const openItemsReport = await getCariOpenItemsReport({
    req,
    filters: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      counterpartyId: fixture.counterpartyId,
      asOfDate: TEST_DATE,
      role: null,
      status: "ALL",
      direction: "AR",
      includeDetails: true,
      limit: 200,
      offset: 0,
    },
    buildScopeFilter,
    assertScopeAccess,
  });

  const rootOpenItemsRow = findById(openItemsReport.rows, "openItemId", rootOpenItem.openItemId);
  assert(rootOpenItemsRow, "Open-items report should include the root open item");
  assert(
    normalizeOperatingUnitId(rootOpenItemsRow.operatingUnitId) ===
      normalizeOperatingUnitId(fixture.ownerOperatingUnitId),
    "Open-items report should expose root open-item owner operatingUnitId"
  );
  assert(
    String(rootOpenItemsRow.operatingUnitContextLabel || "").includes("Owner OU"),
    "Open-items report should expose root open-item owner context label"
  );
  const rootReference =
    (rootOpenItemsRow.settlementReferences || []).find(
      (row) => toNumber(row?.settlementBatchId) === toNumber(rootSettlement?.row?.id)
    ) || null;
  assertSettlementContext(
    rootReference,
    {
      ownerOperatingUnitId: fixture.ownerOperatingUnitId,
      collectorOperatingUnitId: null,
      originatingCrossContextSettlementBatchId: null,
      isCrossContext: true,
      ownerLabelIncludes: "Owner OU",
      collectorLabelIncludes: "Central",
    },
    "Open-items root settlement reference"
  );

  const downstreamOpenItemsRow = findById(
    openItemsReport.rows,
    "openItemId",
    downstreamOpenItem.openItemId
  );
  assert(downstreamOpenItemsRow, "Open-items report should include the downstream open item");
  assert(
    normalizeOperatingUnitId(downstreamOpenItemsRow.operatingUnitId) ===
      normalizeOperatingUnitId(fixture.collectorOperatingUnitId),
    "Open-items report should expose downstream open-item owner operatingUnitId"
  );
  assert(
    String(downstreamOpenItemsRow.operatingUnitContextLabel || "").includes("Collector OU"),
    "Open-items report should expose downstream open-item owner context label"
  );
  const downstreamReference =
    (downstreamOpenItemsRow.settlementReferences || []).find(
      (row) => toNumber(row?.settlementBatchId) === toNumber(downstreamSettlement?.row?.id)
    ) || null;
  assertSettlementContext(
    downstreamReference,
    {
      ownerOperatingUnitId: fixture.collectorOperatingUnitId,
      collectorOperatingUnitId: fixture.collectorOperatingUnitId,
      originatingCrossContextSettlementBatchId: rootSettlement?.row?.id,
      isCrossContext: false,
      ownerLabelIncludes: "Collector OU",
      collectorLabelIncludes: "Collector OU",
    },
    "Open-items downstream settlement reference"
  );

  const statementReport = await getCariCounterpartyStatementReport({
    req,
    filters: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      counterpartyId: fixture.counterpartyId,
      asOfDate: TEST_DATE,
      role: null,
      status: "ALL",
      direction: "AR",
      includeDetails: true,
      limit: 1000,
      offset: 0,
    },
    buildScopeFilter,
    assertScopeAccess,
  });

  const rootSettlementRow = findById(
    statementReport.settlements.rows,
    "settlementBatchId",
    rootSettlement?.row?.id
  );
  assertSettlementContext(
    rootSettlementRow,
    {
      ownerOperatingUnitId: fixture.ownerOperatingUnitId,
      collectorOperatingUnitId: null,
      originatingCrossContextSettlementBatchId: null,
      isCrossContext: true,
      ownerLabelIncludes: "Owner OU",
      collectorLabelIncludes: "Central",
    },
    "Statement root settlement row"
  );

  const downstreamSettlementRow = findById(
    statementReport.settlements.rows,
    "settlementBatchId",
    downstreamSettlement?.row?.id
  );
  assertSettlementContext(
    downstreamSettlementRow,
    {
      ownerOperatingUnitId: fixture.collectorOperatingUnitId,
      collectorOperatingUnitId: fixture.collectorOperatingUnitId,
      originatingCrossContextSettlementBatchId: rootSettlement?.row?.id,
      isCrossContext: false,
      ownerLabelIncludes: "Collector OU",
      collectorLabelIncludes: "Collector OU",
    },
    "Statement downstream settlement row"
  );

  assert(
    toNumber(statementReport.summary?.settlements?.crossContextCount) === 1,
    "Statement summary should count one cross-context settlement"
  );
  assert(
    toNumber(statementReport.summary?.settlements?.sameContextCount) === 1,
    "Statement summary should count one same-context settlement"
  );
  assert(
    toNumber(statementReport.summary?.settlements?.activeCrossContextCount) === 1,
    "Statement summary should count one active cross-context settlement"
  );
  assert(
    toNumber(statementReport.summary?.settlements?.activeSameContextCount) === 1,
    "Statement summary should count one active same-context settlement"
  );

  const rootDocumentLink = findSettlementLink(
    statementReport.documents.rows,
    rootOpenItem.documentId,
    rootSettlement?.row?.id
  );
  assertSettlementContext(
    rootDocumentLink,
    {
      ownerOperatingUnitId: fixture.ownerOperatingUnitId,
      collectorOperatingUnitId: null,
      originatingCrossContextSettlementBatchId: null,
      isCrossContext: true,
      ownerLabelIncludes: "Owner OU",
      collectorLabelIncludes: "Central",
    },
    "Statement document settlement link for root settlement"
  );

  const downstreamDocumentLink = findSettlementLink(
    statementReport.documents.rows,
    downstreamOpenItem.documentId,
    downstreamSettlement?.row?.id
  );
  assertSettlementContext(
    downstreamDocumentLink,
    {
      ownerOperatingUnitId: fixture.collectorOperatingUnitId,
      collectorOperatingUnitId: fixture.collectorOperatingUnitId,
      originatingCrossContextSettlementBatchId: rootSettlement?.row?.id,
      isCrossContext: false,
      ownerLabelIncludes: "Collector OU",
      collectorLabelIncludes: "Collector OU",
    },
    "Statement document settlement link for downstream settlement"
  );

  const realizedFxReport = await getCariSettlementRealizedFxReport({
    req,
    filters: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      counterpartyId: fixture.counterpartyId,
      role: null,
      direction: "AR",
      currencyCode: fixture.functionalCurrencyCode,
      periodFrom: TEST_DATE,
      periodTo: TEST_DATE,
      includeDetails: true,
      limit: 200,
      offset: 0,
    },
    buildScopeFilter,
    assertScopeAccess,
  });

  assert(
    toNumber(realizedFxReport.summary?.crossContextSettlementCount) === 1,
    "Realized-FX summary should count one cross-context settlement"
  );
  assert(
    toNumber(realizedFxReport.summary?.sameContextSettlementCount) === 1,
    "Realized-FX summary should count one same-context settlement"
  );
  assert(
    toNumber(realizedFxReport.rows?.[0]?.crossContextSettlementCount) === 1,
    "Realized-FX grouped row should expose cross-context settlement count"
  );
  assert(
    toNumber(realizedFxReport.rows?.[0]?.sameContextSettlementCount) === 1,
    "Realized-FX grouped row should expose same-context settlement count"
  );

  const drilldownRows = await listCariSettlementDrilldownsByBatchIds({
    tenantId: fixture.tenantId,
    settlementBatchIds: [rootSettlement?.row?.id, downstreamSettlement?.row?.id],
  });
  const rootDrilldown = findById(drilldownRows, "settlementBatchId", rootSettlement?.row?.id);
  assertSettlementContext(
    rootDrilldown,
    {
      ownerOperatingUnitId: fixture.ownerOperatingUnitId,
      collectorOperatingUnitId: null,
      originatingCrossContextSettlementBatchId: null,
      isCrossContext: true,
      ownerLabelIncludes: "Owner OU",
      collectorLabelIncludes: "Central",
    },
    "Settlement drilldown root batch"
  );
  const downstreamDrilldown = findById(
    drilldownRows,
    "settlementBatchId",
    downstreamSettlement?.row?.id
  );
  assertSettlementContext(
    downstreamDrilldown,
    {
      ownerOperatingUnitId: fixture.collectorOperatingUnitId,
      collectorOperatingUnitId: fixture.collectorOperatingUnitId,
      originatingCrossContextSettlementBatchId: rootSettlement?.row?.id,
      isCrossContext: false,
      ownerLabelIncludes: "Collector OU",
      collectorLabelIncludes: "Collector OU",
    },
    "Settlement drilldown downstream batch"
  );

  const mixedOwnerOpenItemA = await fixture.createOpenItem({
    operatingUnitId: fixture.ownerOperatingUnitId,
    amountTxn: 10,
    amountBase: 10,
  });
  const mixedOwnerOpenItemB = await fixture.createOpenItem({
    operatingUnitId: fixture.collectorOperatingUnitId,
    amountTxn: 10,
    amountBase: 10,
  });
  const mixedOwnerBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 20,
  });
  await assertThrowsAsync(
    () =>
      applySettlement(fixture, req, {
        incomingAmountTxn: 20,
        bankStatementLineId: mixedOwnerBankLine.id,
        idempotencyKey: uniqueToken("OU11-MIXED-"),
        allocations: [
          { openItemId: mixedOwnerOpenItemA.openItemId, amountTxn: 10 },
          { openItemId: mixedOwnerOpenItemB.openItemId, amountTxn: 10 },
        ],
      }),
    "multiple owner operating units"
  );

  const missingSetupOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.missingCollectorOperatingUnitId,
    amountTxn: 15,
    amountBase: 15,
  });
  const missingSetupBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 15,
  });
  await assertThrowsAsync(
    () =>
      applySettlement(fixture, req, {
        incomingAmountTxn: 15,
        bankStatementLineId: missingSetupBankLine.id,
        idempotencyKey: uniqueToken("OU11-MISSING-"),
        allocations: [{ openItemId: missingSetupOpenItem.openItemId, amountTxn: 15 }],
      }),
    "Configure all four central <-> OU current-account fields"
  );

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const settlementApiSource = await readFile(
    path.resolve(repoRoot, "frontend/src/api/cariSettlements.js"),
    "utf8"
  );
  const settlementPageSource = await readFile(
    path.resolve(repoRoot, "frontend/src/pages/cari/CariSettlementsPage.jsx"),
    "utf8"
  );
  const cashPageSource = await readFile(
    path.resolve(repoRoot, "frontend/src/pages/cash/CashTransactionsPage.jsx"),
    "utf8"
  );

  assert(
    hasText(
      settlementApiSource,
      "Complete the central <-> OU current-account setup in Organization Management before retrying."
    ),
    "Settlement API helper should expose the central <-> OU setup guidance"
  );
  assert(
    hasText(
      settlementApiSource,
      "Complete both directional partner-OU current-account mappings before retrying."
    ),
    "Settlement API helper should expose the partner-OU setup guidance"
  );
  assert(
    hasText(settlementPageSource, "Cross-context self-balancing") &&
      hasText(
        settlementPageSource,
        "Selected rows span multiple owner contexts. V1 requires one owner OU per settlement batch."
      ) &&
      hasText(settlementPageSource, "Originating cross-context batch:"),
    "Settlement page should surface cross-context owner/collector feedback"
  );
  assert(
    hasText(
      settlementPageSource,
      "This settlement will self-balance across contexts. Collector"
    ),
    "Settlement page should warn before cross-context self-balancing"
  );
  assert(
    hasText(
      cashPageSource,
      "This cash-triggered settlement will self-balance across contexts:"
    ) &&
      hasText(
        cashPageSource,
        "Split this cash-triggered settlement by owner OU."
      ) &&
      hasText(cashPageSource, "Cross-context self-balancing posted:"),
    "Cash page should surface cross-context settlement feedback"
  );

  console.log("OU11 settlement report feedback regression passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
