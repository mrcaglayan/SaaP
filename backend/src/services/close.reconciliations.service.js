import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { getCariControlReconciliationReport } from "./gl.cari-control-reconciliation.service.js";
import { listPurposeMappings } from "./gl.purpose-mappings.service.js";
import { listCycleItems } from "./close.cycle-items.service.js";

const CLOSE_RECONCILIATION_SET_FAMILIES = Object.freeze([
  "BANK_RECONCILIATION",
  "SUBLEDGER_GL_RECONCILIATION",
  "SUSPENSE_CLEARING_RECONCILIATION",
  "INTERCOMPANY_RECONCILIATION",
]);

const CLOSE_RECONCILIATION_STATUSES = Object.freeze([
  "NOT_STARTED",
  "MATCHED",
  "REVIEW_REQUIRED",
]);

const CLOSE_RECONCILIATION_CONTROL_TYPES = Object.freeze([
  "BANK_ACCOUNT",
  "BOOK",
  "LEGAL_ENTITY",
  "ENTITY_PAIR",
]);

const INTERCOMPANY_QUEUE_STATUSES = Object.freeze([
  "MISMATCHED",
  "UNILATERAL",
  "RESOLVED",
]);

const INTERCOMPANY_TOLERANCE = 0.01;
const BALANCE_EPSILON = 0.000001;

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function roundAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(6));
}

function isNearlyZero(value) {
  return Math.abs(Number(value || 0)) <= BALANCE_EPSILON;
}

function parseJsonValue(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJsonValue(value) {
  return JSON.stringify(value ?? null);
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorUserId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.userId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function normalizeReconciliationSetFamily(value) {
  const normalized = toUpperText(value);
  if (!CLOSE_RECONCILIATION_SET_FAMILIES.includes(normalized)) {
    throw badRequest(`Unsupported close reconciliation set family: ${value}`);
  }
  return normalized;
}

function normalizeReconciliationStatus(value) {
  const normalized = toUpperText(value);
  if (!CLOSE_RECONCILIATION_STATUSES.includes(normalized)) {
    throw badRequest(`Unsupported close reconciliation status: ${value}`);
  }
  return normalized;
}

function normalizeReconciliationControlType(value) {
  const normalized = toUpperText(value);
  if (!CLOSE_RECONCILIATION_CONTROL_TYPES.includes(normalized)) {
    throw badRequest(`Unsupported close reconciliation control type: ${value}`);
  }
  return normalized;
}

function normalizeIntercompanyQueueStatus(value) {
  const normalized = toUpperText(value);
  if (!INTERCOMPANY_QUEUE_STATUSES.includes(normalized)) {
    throw badRequest(`Unsupported intercompany mismatch queue status: ${value}`);
  }
  return normalized;
}

function mapCycleRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenantId ?? row.tenant_id),
    scopeKind: toUpperText(row.scopeKind ?? row.scope_kind),
    fiscalCalendarId: parsePositiveInt(row.fiscalCalendarId ?? row.fiscal_calendar_id),
    fiscalPeriodId: parsePositiveInt(row.fiscalPeriodId ?? row.fiscal_period_id),
    legalEntityId: parsePositiveInt(row.legalEntityId ?? row.legal_entity_id),
    consolidationGroupId: parsePositiveInt(
      row.consolidationGroupId ?? row.consolidation_group_id
    ),
    ownerUserId: parsePositiveInt(row.ownerUserId ?? row.owner_user_id),
    dueAt: row.dueAt ?? row.due_at ?? null,
    status: toUpperText(row.status),
  };
}

function mapReconciliationSetRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    setKey: String(row.set_key || "").trim().toUpperCase() || null,
    setFamily: normalizeReconciliationSetFamily(row.set_family),
    setTitle: String(row.set_title || "").trim() || null,
    ownerUserId: parsePositiveInt(row.owner_user_id),
    dueAt: row.due_at || null,
    metadata: parseJsonValue(row.metadata_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapReconciliationItemRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeReconciliationSetId: parsePositiveInt(row.close_reconciliation_set_id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    closeCycleItemId: parsePositiveInt(row.close_cycle_item_id),
    itemKey: String(row.item_key || "").trim().toUpperCase() || null,
    controlType: normalizeReconciliationControlType(row.control_type),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    bookId: parsePositiveInt(row.book_id),
    bankAccountId: parsePositiveInt(row.bank_account_id),
    accountId: parsePositiveInt(row.account_id),
    counterpartyLegalEntityId: parsePositiveInt(row.counterparty_legal_entity_id),
    ownerUserId: parsePositiveInt(row.owner_user_id),
    dueAt: row.due_at || null,
    metadata: parseJsonValue(row.metadata_json, {}),
    setFamily: row.set_family ? normalizeReconciliationSetFamily(row.set_family) : null,
    setTitle: row.set_title ? String(row.set_title || "").trim() || null : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapIntercompanyMismatchQueueRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    closeReconciliationItemId: parsePositiveInt(row.close_reconciliation_item_id),
    mismatchKey: String(row.mismatch_key || "").trim().toUpperCase() || null,
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    legalEntityAId: parsePositiveInt(row.legal_entity_a_id),
    legalEntityBId: parsePositiveInt(row.legal_entity_b_id),
    status: normalizeIntercompanyQueueStatus(row.status),
    differenceBase: roundAmount(row.difference_base),
    absoluteDifferenceBase: roundAmount(row.absolute_difference_base),
    payload: parseJsonValue(row.payload_json, null),
    firstDetectedAt: row.first_detected_at || null,
    lastDetectedAt: row.last_detected_at || null,
    resolvedAt: row.resolved_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function loadCloseCycleRow({ cycleId, tenantId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       scope_kind,
       fiscal_calendar_id,
       fiscal_period_id,
       legal_entity_id,
       consolidation_group_id,
       owner_user_id,
       due_at,
       status
     FROM close_cycles
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, cycleId]
  );
  return result.rows?.[0] || null;
}

async function loadFiscalPeriodWindow({ fiscalPeriodId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, start_date, end_date
     FROM fiscal_periods
     WHERE id = ?
     LIMIT 1`,
    [fiscalPeriodId]
  );
  return result.rows?.[0] || null;
}

async function loadThroughPeriodIds({
  fiscalCalendarId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND (
         fiscal_year < (SELECT fiscal_year FROM fiscal_periods WHERE id = ?)
         OR (
           fiscal_year = (SELECT fiscal_year FROM fiscal_periods WHERE id = ?)
           AND period_no <= (SELECT period_no FROM fiscal_periods WHERE id = ?)
         )
       )
     ORDER BY fiscal_year ASC, period_no ASC, is_adjustment ASC, id ASC`,
    [fiscalCalendarId, fiscalPeriodId, fiscalPeriodId, fiscalPeriodId]
  );

  return (result.rows || []).map((row) => parsePositiveInt(row.id)).filter(Boolean);
}

async function listPersistedReconciliationSets({
  tenantId,
  closeCycleId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       close_cycle_id,
       set_key,
       set_family,
       set_title,
       owner_user_id,
       due_at,
       metadata_json,
       created_at,
       updated_at
     FROM close_reconciliation_sets
     WHERE tenant_id = ?
       AND close_cycle_id = ?
     ORDER BY id ASC`,
    [tenantId, closeCycleId]
  );

  return (result.rows || []).map(mapReconciliationSetRow).filter(Boolean);
}

async function listPersistedReconciliationItems({
  tenantId,
  closeCycleId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       i.id,
       i.tenant_id,
       i.close_reconciliation_set_id,
       i.close_cycle_id,
       i.close_cycle_item_id,
       i.item_key,
       i.control_type,
       i.legal_entity_id,
       i.book_id,
       i.bank_account_id,
       i.account_id,
       i.counterparty_legal_entity_id,
       i.owner_user_id,
       i.due_at,
       i.metadata_json,
       i.created_at,
       i.updated_at,
       s.set_family,
       s.set_title
     FROM close_reconciliation_items i
     JOIN close_reconciliation_sets s
       ON s.id = i.close_reconciliation_set_id
      AND s.tenant_id = i.tenant_id
     WHERE i.tenant_id = ?
       AND i.close_cycle_id = ?
     ORDER BY s.id ASC, i.id ASC`,
    [tenantId, closeCycleId]
  );

  return (result.rows || []).map(mapReconciliationItemRow).filter(Boolean);
}

async function listPersistedIntercompanyMismatchQueueRows({
  tenantId,
  closeCycleId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       close_cycle_id,
       close_reconciliation_item_id,
       mismatch_key,
       fiscal_period_id,
       legal_entity_a_id,
       legal_entity_b_id,
       status,
       difference_base,
       absolute_difference_base,
       payload_json,
       first_detected_at,
       last_detected_at,
       resolved_at,
       created_at,
       updated_at
     FROM intercompany_mismatch_queue
     WHERE tenant_id = ?
       AND close_cycle_id = ?
     ORDER BY absolute_difference_base DESC, id ASC`,
    [tenantId, closeCycleId]
  );

  return (result.rows || []).map(mapIntercompanyMismatchQueueRow).filter(Boolean);
}

async function listBankAccountsByLegalEntities({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  const ids = Array.from(new Set((legalEntityIds || []).map((value) => parsePositiveInt(value)).filter(Boolean)));
  if (!ids.length) {
    return [];
  }

  const result = await runQuery(
    `SELECT
       ba.id,
       ba.tenant_id,
       ba.legal_entity_id,
       ba.operating_unit_id,
       ba.code,
       ba.name,
       ba.currency_code,
       ba.is_active
     FROM bank_accounts ba
     WHERE ba.tenant_id = ?
       AND ba.legal_entity_id IN (${ids.map(() => "?").join(", ")})
       AND ba.is_active = 1
     ORDER BY ba.legal_entity_id ASC, ba.code ASC, ba.id ASC`,
    [tenantId, ...ids]
  );

  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    code: String(row.code || "").trim() || null,
    name: String(row.name || "").trim() || null,
    currencyCode: String(row.currency_code || "").trim().toUpperCase() || null,
  }));
}

async function listBooksByIds({ bookIds, runQuery = query }) {
  const ids = Array.from(new Set((bookIds || []).map((value) => parsePositiveInt(value)).filter(Boolean)));
  if (!ids.length) {
    return [];
  }

  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       calendar_id,
       code,
       name,
       base_currency_code,
       book_type
     FROM books
     WHERE id IN (${ids.map(() => "?").join(", ")})
     ORDER BY id ASC`,
    ids
  );

  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    calendarId: parsePositiveInt(row.calendar_id),
    code: String(row.code || "").trim() || null,
    name: String(row.name || "").trim() || null,
    baseCurrencyCode: String(row.base_currency_code || "").trim().toUpperCase() || null,
    bookType: toUpperText(row.book_type),
    raw: row,
  }));
}

async function listLegalEntitiesByIds({
  tenantId,
  legalEntityIds,
  runQuery = query,
}) {
  const ids = Array.from(new Set((legalEntityIds || []).map((value) => parsePositiveInt(value)).filter(Boolean)));
  if (!ids.length) {
    return [];
  }

  const result = await runQuery(
    `SELECT id, tenant_id, code, name
     FROM legal_entities
     WHERE tenant_id = ?
       AND id IN (${ids.map(() => "?").join(", ")})
     ORDER BY code ASC, id ASC`,
    [tenantId, ...ids]
  );

  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    code: String(row.code || "").trim() || null,
    name: String(row.name || "").trim() || null,
  }));
}

function indexRowsById(rows = []) {
  return new Map(rows.map((row) => [parsePositiveInt(row?.id), row]).filter(([id]) => id));
}

function collectCycleLegalEntityIds(cycle, cycleItems = []) {
  const ids = new Set(
    (cycleItems || [])
      .map((row) => parsePositiveInt(row?.legalEntityId ?? row?.legal_entity_id))
      .filter(Boolean)
  );
  if (!ids.size && parsePositiveInt(cycle?.legalEntityId)) {
    ids.add(parsePositiveInt(cycle.legalEntityId));
  }
  return Array.from(ids).sort((left, right) => left - right);
}

function collectCycleBookIds(cycleItems = []) {
  const preferredRows = cycleItems.filter(
    (row) => toUpperText(row?.itemType ?? row?.item_type) === "PERIOD_CLOSE_RUN"
  );
  const sourceRows = preferredRows.length ? preferredRows : cycleItems;
  const ids = new Set(
    sourceRows
      .map((row) => parsePositiveInt(row?.bookId ?? row?.book_id))
      .filter(Boolean)
  );
  return Array.from(ids).sort((left, right) => left - right);
}

function buildSetFamilyTitle(setFamily) {
  switch (normalizeReconciliationSetFamily(setFamily)) {
    case "BANK_RECONCILIATION":
      return "Bank Reconciliation";
    case "SUBLEDGER_GL_RECONCILIATION":
      return "Subledger vs GL Reconciliation";
    case "SUSPENSE_CLEARING_RECONCILIATION":
      return "Suspense / Clearing Reconciliation";
    case "INTERCOMPANY_RECONCILIATION":
      return "Intercompany Reconciliation";
    default:
      return setFamily;
  }
}

function buildSetDefinitions(cycle) {
  return CLOSE_RECONCILIATION_SET_FAMILIES.map((setFamily) => ({
    setKey: setFamily,
    setFamily,
    setTitle: buildSetFamilyTitle(setFamily),
    ownerUserId: cycle.ownerUserId || null,
    dueAt: cycle.dueAt || null,
    metadata: {
      preferredSurface: "CLOSE_COCKPIT",
      scopeKind: cycle.scopeKind,
    },
  }));
}

function buildBankItemKey(bankAccountId) {
  return `BANK_RECONCILIATION:BANK_ACCOUNT:${parsePositiveInt(bankAccountId)}`;
}

function buildSubledgerItemKey(bookId) {
  return `SUBLEDGER_GL_RECONCILIATION:BOOK:${parsePositiveInt(bookId)}`;
}

function buildSuspenseItemKey(legalEntityId) {
  return `SUSPENSE_CLEARING_RECONCILIATION:LEGAL_ENTITY:${parsePositiveInt(legalEntityId)}`;
}

function buildIntercompanyPairItemKey(legalEntityAId, legalEntityBId) {
  const leftId = Math.min(parsePositiveInt(legalEntityAId), parsePositiveInt(legalEntityBId));
  const rightId = Math.max(parsePositiveInt(legalEntityAId), parsePositiveInt(legalEntityBId));
  return `INTERCOMPANY_RECONCILIATION:ENTITY_PAIR:${leftId}:${rightId}`;
}

function buildIntercompanyMismatchKey(legalEntityAId, legalEntityBId) {
  return buildIntercompanyPairItemKey(legalEntityAId, legalEntityBId);
}

function buildBankReconciliationPath({ legalEntityId, bankAccountId }) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(bankAccountId)) {
    searchParams.set("bankAccountId", String(parsePositiveInt(bankAccountId)));
  }
  const queryString = searchParams.toString();
  return `/app/banka-mutabakat${queryString ? `?${queryString}` : ""}`;
}

function buildCariControlReconciliationPath({
  legalEntityId,
  bookId,
  fiscalPeriodId,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(bookId)) {
    searchParams.set("bookId", String(parsePositiveInt(bookId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  searchParams.set("rowStatus", "EXCEPTIONS_ONLY");
  return `/app/cari-kontrol-mutabakati?${searchParams.toString()}`;
}

function buildJournalWorkbenchPath({ legalEntityId, fiscalPeriodId }) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/mahsup-islemleri${queryString ? `?${queryString}` : ""}`;
}

function buildIntercompanyReconciliationPath({
  fiscalPeriodId,
  legalEntityAId,
  legalEntityBId,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  if (parsePositiveInt(legalEntityAId)) {
    searchParams.set("fromLegalEntityId", String(parsePositiveInt(legalEntityAId)));
  }
  if (parsePositiveInt(legalEntityBId)) {
    searchParams.set("toLegalEntityId", String(parsePositiveInt(legalEntityBId)));
  }
  return `/app/donem-sonu-islemler/aylik/intercompany-mutabakat?${searchParams.toString()}`;
}

function buildControlDefinitions({
  cycle,
  cycleItems,
  bankAccounts,
  books,
  legalEntityRows,
}) {
  const bookById = indexRowsById(books);
  const legalEntityById = indexRowsById(legalEntityRows);
  const periodCloseItemByBookId = new Map(
    (cycleItems || [])
      .filter((row) => toUpperText(row?.itemType ?? row?.item_type) === "PERIOD_CLOSE_RUN")
      .map((row) => [parsePositiveInt(row?.bookId ?? row?.book_id), parsePositiveInt(row?.id)])
      .filter(([bookId]) => bookId)
  );
  const bookIdsByLegalEntityId = new Map();
  for (const book of books || []) {
    const legalEntityId = parsePositiveInt(book?.legalEntityId);
    if (!legalEntityId) {
      continue;
    }
    if (!bookIdsByLegalEntityId.has(legalEntityId)) {
      bookIdsByLegalEntityId.set(legalEntityId, []);
    }
    bookIdsByLegalEntityId.get(legalEntityId).push(parsePositiveInt(book.id));
  }

  const definitions = [];

  for (const bankAccount of bankAccounts || []) {
    const legalEntity = legalEntityById.get(bankAccount.legalEntityId) || null;
    definitions.push({
      setFamily: "BANK_RECONCILIATION",
      itemKey: buildBankItemKey(bankAccount.id),
      controlType: "BANK_ACCOUNT",
      legalEntityId: bankAccount.legalEntityId,
      bankAccountId: bankAccount.id,
      ownerUserId: cycle.ownerUserId || null,
      dueAt: cycle.dueAt || null,
      metadata: {
        label:
          [bankAccount.code, bankAccount.name].filter(Boolean).join(" - ") ||
          `Bank account ${bankAccount.id}`,
        currencyCode: bankAccount.currencyCode,
        legalEntityCode: legalEntity?.code || null,
        legalEntityName: legalEntity?.name || null,
      },
    });
  }

  for (const book of books || []) {
    const legalEntity = legalEntityById.get(book.legalEntityId) || null;
    definitions.push({
      setFamily: "SUBLEDGER_GL_RECONCILIATION",
      itemKey: buildSubledgerItemKey(book.id),
      controlType: "BOOK",
      closeCycleItemId: periodCloseItemByBookId.get(book.id) || null,
      legalEntityId: book.legalEntityId,
      bookId: book.id,
      ownerUserId: cycle.ownerUserId || null,
      dueAt: cycle.dueAt || null,
      metadata: {
        label: [book.code, book.name].filter(Boolean).join(" - ") || `Book ${book.id}`,
        baseCurrencyCode: book.baseCurrencyCode,
        legalEntityCode: legalEntity?.code || null,
        legalEntityName: legalEntity?.name || null,
      },
    });
  }

  for (const legalEntity of legalEntityRows || []) {
    definitions.push({
      setFamily: "SUSPENSE_CLEARING_RECONCILIATION",
      itemKey: buildSuspenseItemKey(legalEntity.id),
      controlType: "LEGAL_ENTITY",
      legalEntityId: legalEntity.id,
      ownerUserId: cycle.ownerUserId || null,
      dueAt: cycle.dueAt || null,
      metadata: {
        label:
          [legalEntity.code, legalEntity.name].filter(Boolean).join(" - ") ||
          `Legal entity ${legalEntity.id}`,
        cycleBookIds: bookIdsByLegalEntityId.get(legalEntity.id) || [],
      },
    });
  }

  if (cycle.scopeKind === "CONSOLIDATION_GROUP") {
    const scopeLegalEntityIds = Array.from(
      new Set(
        (legalEntityRows || [])
          .map((row) => parsePositiveInt(row.id))
          .filter(Boolean)
      )
    ).sort((left, right) => left - right);
    for (let leftIndex = 0; leftIndex < scopeLegalEntityIds.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < scopeLegalEntityIds.length;
        rightIndex += 1
      ) {
        const leftId = scopeLegalEntityIds[leftIndex];
        const rightId = scopeLegalEntityIds[rightIndex];
        const leftEntity = legalEntityById.get(leftId) || null;
        const rightEntity = legalEntityById.get(rightId) || null;
        definitions.push({
          setFamily: "INTERCOMPANY_RECONCILIATION",
          itemKey: buildIntercompanyPairItemKey(leftId, rightId),
          controlType: "ENTITY_PAIR",
          legalEntityId: leftId,
          counterpartyLegalEntityId: rightId,
          ownerUserId: cycle.ownerUserId || null,
          dueAt: cycle.dueAt || null,
          metadata: {
            label:
              [
                leftEntity?.code || `LE-${leftId}`,
                rightEntity?.code || `LE-${rightId}`,
              ].join(" <> "),
            legalEntityCode: leftEntity?.code || null,
            legalEntityName: leftEntity?.name || null,
            counterpartyLegalEntityCode: rightEntity?.code || null,
            counterpartyLegalEntityName: rightEntity?.name || null,
          },
        });
      }
    }
  }

  return definitions;
}

async function upsertReconciliationSet({
  tenantId,
  closeCycleId,
  definition,
  runQuery,
}) {
  await runQuery(
    `INSERT INTO close_reconciliation_sets (
       tenant_id,
       close_cycle_id,
       set_key,
       set_family,
       set_title,
       owner_user_id,
       due_at,
       metadata_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       set_title = VALUES(set_title),
       owner_user_id = VALUES(owner_user_id),
       due_at = VALUES(due_at),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      closeCycleId,
      definition.setKey,
      definition.setFamily,
      definition.setTitle,
      definition.ownerUserId,
      definition.dueAt,
      toJsonValue(definition.metadata),
    ]
  );
}

async function upsertReconciliationItem({
  tenantId,
  closeCycleId,
  closeReconciliationSetId,
  definition,
  runQuery,
}) {
  await runQuery(
    `INSERT INTO close_reconciliation_items (
       tenant_id,
       close_reconciliation_set_id,
       close_cycle_id,
       close_cycle_item_id,
       item_key,
       control_type,
       legal_entity_id,
       book_id,
       bank_account_id,
       account_id,
       counterparty_legal_entity_id,
       owner_user_id,
       due_at,
       metadata_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       close_reconciliation_set_id = VALUES(close_reconciliation_set_id),
       close_cycle_item_id = VALUES(close_cycle_item_id),
       control_type = VALUES(control_type),
       legal_entity_id = VALUES(legal_entity_id),
       book_id = VALUES(book_id),
       bank_account_id = VALUES(bank_account_id),
       account_id = VALUES(account_id),
       counterparty_legal_entity_id = VALUES(counterparty_legal_entity_id),
       owner_user_id = VALUES(owner_user_id),
       due_at = VALUES(due_at),
       metadata_json = VALUES(metadata_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      closeReconciliationSetId,
      closeCycleId,
      definition.closeCycleItemId || null,
      definition.itemKey,
      definition.controlType,
      definition.legalEntityId || null,
      definition.bookId || null,
      definition.bankAccountId || null,
      definition.accountId || null,
      definition.counterpartyLegalEntityId || null,
      definition.ownerUserId || null,
      definition.dueAt || null,
      toJsonValue(definition.metadata),
    ]
  );
}

function buildStatusPayload({
  status,
  issues = [],
  metrics = null,
  drillPath = null,
  pairStatus = null,
}) {
  return {
    status: normalizeReconciliationStatus(status),
    issues: Array.isArray(issues) ? issues.filter(Boolean) : [],
    metrics: metrics || {},
    drillPath: drillPath || null,
    pairStatus: pairStatus || null,
  };
}

async function loadBankReconciliationSignals({
  tenantId,
  cycle,
  bankItems,
  periodWindow,
  runQuery = query,
}) {
  const itemRows = (bankItems || []).filter((row) => parsePositiveInt(row?.bankAccountId));
  if (!itemRows.length) {
    return new Map();
  }

  const bankAccountIds = Array.from(
    new Set(itemRows.map((row) => parsePositiveInt(row.bankAccountId)).filter(Boolean))
  );

  const lineResult = await runQuery(
    `SELECT
       bank_account_id,
       COUNT(*) AS statement_lines_total,
       SUM(CASE WHEN recon_status IN ('UNMATCHED','PARTIAL') THEN 1 ELSE 0 END) AS unmatched_open_total,
       SUM(CASE WHEN recon_status = 'MATCHED' THEN 1 ELSE 0 END) AS matched_total
     FROM bank_statement_lines
     WHERE tenant_id = ?
       AND bank_account_id IN (${bankAccountIds.map(() => "?").join(", ")})
       AND txn_date BETWEEN ? AND ?
     GROUP BY bank_account_id`,
    [tenantId, ...bankAccountIds, periodWindow.startDate, periodWindow.endDate]
  );

  const exceptionResult = await runQuery(
    `SELECT
       bank_account_id,
       SUM(CASE WHEN status IN ('OPEN','ASSIGNED') THEN 1 ELSE 0 END) AS open_exception_total,
       MAX(
         CASE
           WHEN status IN ('OPEN','ASSIGNED')
           THEN TIMESTAMPDIFF(HOUR, first_seen_at, CURRENT_TIMESTAMP)
           ELSE NULL
         END
       ) AS oldest_open_exception_hours
     FROM bank_reconciliation_exceptions
     WHERE tenant_id = ?
       AND bank_account_id IN (${bankAccountIds.map(() => "?").join(", ")})
     GROUP BY bank_account_id`,
    [tenantId, ...bankAccountIds]
  );

  const lineByBankAccountId = new Map(
    (lineResult.rows || []).map((row) => [parsePositiveInt(row.bank_account_id), row])
  );
  const exceptionsByBankAccountId = new Map(
    (exceptionResult.rows || []).map((row) => [parsePositiveInt(row.bank_account_id), row])
  );

  const signals = new Map();
  for (const item of itemRows) {
    const bankAccountId = parsePositiveInt(item.bankAccountId);
    const lineRow = lineByBankAccountId.get(bankAccountId) || null;
    const exceptionRow = exceptionsByBankAccountId.get(bankAccountId) || null;
    const statementLinesTotal = Number(lineRow?.statement_lines_total || 0);
    const unmatchedOpenTotal = Number(lineRow?.unmatched_open_total || 0);
    const matchedTotal = Number(lineRow?.matched_total || 0);
    const openExceptionTotal = Number(exceptionRow?.open_exception_total || 0);
    const oldestOpenExceptionHours =
      exceptionRow?.oldest_open_exception_hours === null ||
      exceptionRow?.oldest_open_exception_hours === undefined
        ? null
        : Number(exceptionRow.oldest_open_exception_hours || 0);

    const issues = [];
    let status = "NOT_STARTED";
    if (unmatchedOpenTotal > 0) {
      issues.push("UNMATCHED_BANK_LINES");
    }
    if (openExceptionTotal > 0) {
      issues.push("OPEN_RECON_EXCEPTIONS");
    }
    if (issues.length > 0) {
      status = "REVIEW_REQUIRED";
    } else if (statementLinesTotal > 0 || matchedTotal > 0) {
      status = "MATCHED";
    }

    signals.set(
      item.itemKey,
      buildStatusPayload({
        status,
        issues,
        metrics: {
          statementLinesTotal,
          unmatchedOpenTotal,
          matchedTotal,
          openExceptionTotal,
          oldestOpenExceptionHours,
          fiscalPeriodId: cycle.fiscalPeriodId,
        },
        drillPath: buildBankReconciliationPath({
          legalEntityId: item.legalEntityId,
          bankAccountId,
        }),
      })
    );
  }

  return signals;
}

async function loadSubledgerGlSignals({
  tenantId,
  cycle,
  bookItems,
  booksById,
  runQuery = query,
}) {
  const itemRows = (bookItems || []).filter((row) => parsePositiveInt(row?.bookId));
  if (!itemRows.length) {
    return new Map();
  }

  const entries = await Promise.all(
    itemRows.map(async (item) => {
      const book = booksById.get(parsePositiveInt(item.bookId));
      if (!book?.raw) {
        return [
          item.itemKey,
          buildStatusPayload({
            status: "REVIEW_REQUIRED",
            issues: ["BOOK_CONTEXT_MISSING"],
            metrics: {},
          }),
        ];
      }

      const report = await getCariControlReconciliationReport({
        tenantId,
        book: book.raw,
        reportQuery: {
          fiscalPeriodId: cycle.fiscalPeriodId,
          operatingUnitScope: "ALL",
          direction: "ALL",
          rowStatus: "ALL",
          limit: 1,
          offset: 0,
        },
        runQuery,
      });

      const summary = report?.summary || {};
      const missingPurposeCodes = Array.isArray(report?.missingPurposeCodes)
        ? report.missingPurposeCodes.filter(Boolean)
        : [];
      const issues = missingPurposeCodes.map(
        (purposeCode) => `MISSING_PURPOSE_MAPPING:${toUpperText(purposeCode)}`
      );
      if (Number(summary.exceptionRowCount || 0) > 0) {
        issues.push("OPEN_SUBLEDGER_GL_DIFFERENCE");
      }

      let status = "NOT_STARTED";
      if (issues.length > 0) {
        status = "REVIEW_REQUIRED";
      } else if (Number(summary.rowCount || 0) > 0) {
        status = "MATCHED";
      }

      return [
        item.itemKey,
        buildStatusPayload({
          status,
          issues,
          metrics: {
            rowCount: Number(summary.rowCount || 0),
            exceptionRowCount: Number(summary.exceptionRowCount || 0),
            matchedRowCount: Number(summary.matchedRowCount || 0),
            absoluteDifferenceBaseTotal: roundAmount(summary.absoluteDifferenceBaseTotal),
            differenceBaseTotal: roundAmount(summary.differenceBaseTotal),
            missingSourceLinkCount: Number(summary.missingSourceLinkCount || 0),
            missingSubledgerRefCount: Number(summary.missingSubledgerRefCount || 0),
          },
          drillPath: buildCariControlReconciliationPath({
            legalEntityId: item.legalEntityId,
            bookId: item.bookId,
            fiscalPeriodId: cycle.fiscalPeriodId,
          }),
        }),
      ];
    })
  );

  return new Map(entries);
}

async function loadSuspenseClearingSignals({
  tenantId,
  cycle,
  legalEntityItems,
  booksByLegalEntityId,
  throughPeriodIds,
  runQuery = query,
}) {
  const itemRows = (legalEntityItems || []).filter((row) => parsePositiveInt(row?.legalEntityId));
  if (!itemRows.length) {
    return new Map();
  }

  const entries = await Promise.all(
    itemRows.map(async (item) => {
      const legalEntityId = parsePositiveInt(item.legalEntityId);
      const purposeMappings = await listPurposeMappings({
        tenantId,
        legalEntityId,
        moduleKey: "CASH",
        runQuery,
      });
      const clearingMapping =
        (purposeMappings || []).find((row) => toUpperText(row?.purposeCode) === "CASH_EXCHANGE_CLEARING") ||
        null;
      const cycleBookIds = (booksByLegalEntityId.get(legalEntityId) || []).filter(Boolean);
      const issues = [];

      if (!cycleBookIds.length) {
        issues.push("NO_CYCLE_BOOKS");
      }

      if (!parsePositiveInt(clearingMapping?.accountId)) {
        issues.push("MISSING_CLEARING_ACCOUNT_MAPPING");
      } else if (!clearingMapping?.validForPurposeMapping) {
        issues.push(
          `INVALID_CLEARING_ACCOUNT_MAPPING:${toUpperText(clearingMapping?.purposeValidationIssue)}`
        );
      }

      let lineCount = 0;
      let journalCount = 0;
      let endingBalanceBase = 0;

      // PR-08 keeps suspense/clearing additive by starting from the repo's
      // explicit CASH_EXCHANGE_CLEARING purpose mapping instead of inventing a
      // new suspense-account classifier ahead of a broader chart taxonomy step.
      if (!issues.length) {
        const balanceResult = await runQuery(
          `SELECT
             COUNT(jl.id) AS line_count,
             COUNT(DISTINCT je.id) AS journal_count,
             SUM(jl.debit_base - jl.credit_base) AS ending_balance_base
           FROM journal_entries je
           JOIN journal_lines jl
             ON jl.journal_entry_id = je.id
           WHERE je.tenant_id = ?
             AND je.legal_entity_id = ?
             AND je.book_id IN (${cycleBookIds.map(() => "?").join(", ")})
             AND je.fiscal_period_id IN (${throughPeriodIds.map(() => "?").join(", ")})
             AND je.status = 'POSTED'
             AND jl.account_id = ?`,
          [
            tenantId,
            legalEntityId,
            ...cycleBookIds,
            ...throughPeriodIds,
            parsePositiveInt(clearingMapping.accountId),
          ]
        );

        const balanceRow = balanceResult.rows?.[0] || null;
        lineCount = Number(balanceRow?.line_count || 0);
        journalCount = Number(balanceRow?.journal_count || 0);
        endingBalanceBase = roundAmount(balanceRow?.ending_balance_base);
        if (!isNearlyZero(endingBalanceBase)) {
          issues.push("NON_ZERO_CLEARING_BALANCE");
        }
      }

      let status = "NOT_STARTED";
      if (issues.length > 0) {
        status = "REVIEW_REQUIRED";
      } else if (lineCount > 0 || journalCount > 0) {
        status = "MATCHED";
      }

      return [
        item.itemKey,
        buildStatusPayload({
          status,
          issues,
          metrics: {
            accountId: parsePositiveInt(clearingMapping?.accountId),
            accountCode: clearingMapping?.accountCode || null,
            accountName: clearingMapping?.accountName || null,
            lineCount,
            journalCount,
            endingBalanceBase,
          },
          drillPath: buildJournalWorkbenchPath({
            legalEntityId,
            fiscalPeriodId: cycle.fiscalPeriodId,
          }),
        }),
      ];
    })
  );

  return new Map(entries);
}

async function loadIntercompanyPairSignals({
  tenantId,
  cycle,
  pairItems,
  runQuery = query,
}) {
  const itemRows = (pairItems || []).filter(
    (row) =>
      parsePositiveInt(row?.legalEntityId) &&
      parsePositiveInt(row?.counterpartyLegalEntityId)
  );
  if (!itemRows.length) {
    return new Map();
  }

  const scopeEntityIds = Array.from(
    new Set(
      itemRows.flatMap((row) => [
        parsePositiveInt(row.legalEntityId),
        parsePositiveInt(row.counterpartyLegalEntityId),
      ])
    )
  ).filter(Boolean);

  const result = await runQuery(
    `SELECT
       je.legal_entity_id AS from_legal_entity_id,
       jl.counterparty_legal_entity_id AS to_legal_entity_id,
       SUM(jl.debit_base) AS debit_total,
       SUM(jl.credit_base) AS credit_total,
       SUM(jl.debit_base - jl.credit_base) AS net_base,
       COUNT(*) AS line_count,
       COUNT(DISTINCT je.id) AS journal_count
     FROM journal_entries je
     JOIN journal_lines jl
       ON jl.journal_entry_id = je.id
     LEFT JOIN intercompany_pairs icp
       ON icp.tenant_id = je.tenant_id
      AND icp.from_legal_entity_id = je.legal_entity_id
      AND icp.to_legal_entity_id = jl.counterparty_legal_entity_id
      AND icp.status = 'ACTIVE'
     WHERE je.tenant_id = ?
       AND je.fiscal_period_id = ?
       AND je.status = 'POSTED'
       AND jl.counterparty_legal_entity_id IS NOT NULL
       AND je.legal_entity_id IN (${scopeEntityIds.map(() => "?").join(", ")})
       AND jl.counterparty_legal_entity_id IN (${scopeEntityIds.map(() => "?").join(", ")})
       AND je.legal_entity_id <> jl.counterparty_legal_entity_id
       AND (
         icp.id IS NULL
         OR jl.account_id = icp.receivable_account_id
         OR jl.account_id = icp.payable_account_id
       )
     GROUP BY je.legal_entity_id, jl.counterparty_legal_entity_id
     ORDER BY je.legal_entity_id ASC, jl.counterparty_legal_entity_id ASC`,
    [tenantId, cycle.fiscalPeriodId, ...scopeEntityIds, ...scopeEntityIds]
  );

  const pairMap = new Map();
  for (const row of result.rows || []) {
    const sourceId = parsePositiveInt(row.from_legal_entity_id);
    const counterpartyId = parsePositiveInt(row.to_legal_entity_id);
    if (!sourceId || !counterpartyId || sourceId === counterpartyId) {
      continue;
    }
    const leftId = Math.min(sourceId, counterpartyId);
    const rightId = Math.max(sourceId, counterpartyId);
    const pairKey = buildIntercompanyPairItemKey(leftId, rightId);
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        leftId,
        rightId,
        directionAB: {
          fromLegalEntityId: leftId,
          toLegalEntityId: rightId,
          netBase: 0,
          lineCount: 0,
          journalCount: 0,
        },
        directionBA: {
          fromLegalEntityId: rightId,
          toLegalEntityId: leftId,
          netBase: 0,
          lineCount: 0,
          journalCount: 0,
        },
      });
    }
    const pair = pairMap.get(pairKey);
    const target = sourceId === leftId ? pair.directionAB : pair.directionBA;
    target.netBase = roundAmount(target.netBase + Number(row.net_base || 0));
    target.lineCount += Number(row.line_count || 0);
    target.journalCount += Number(row.journal_count || 0);
  }

  const signals = new Map();
  for (const item of itemRows) {
    const pairKey = buildIntercompanyPairItemKey(
      item.legalEntityId,
      item.counterpartyLegalEntityId
    );
    const pair = pairMap.get(pairKey) || null;
    const hasAB = Number(pair?.directionAB?.lineCount || 0) > 0;
    const hasBA = Number(pair?.directionBA?.lineCount || 0) > 0;
    const differenceBase = roundAmount(
      Number(pair?.directionAB?.netBase || 0) + Number(pair?.directionBA?.netBase || 0)
    );
    const absoluteDifferenceBase = roundAmount(Math.abs(differenceBase));

    let pairStatus = null;
    const issues = [];
    let status = "NOT_STARTED";
    if (!pair || (!hasAB && !hasBA)) {
      pairStatus = "NOT_STARTED";
    } else if (!hasAB || !hasBA) {
      pairStatus = "UNILATERAL";
      issues.push("UNILATERAL_INTERCOMPANY_ACTIVITY");
      status = "REVIEW_REQUIRED";
    } else if (absoluteDifferenceBase > INTERCOMPANY_TOLERANCE + BALANCE_EPSILON) {
      pairStatus = "MISMATCHED";
      issues.push("INTERCOMPANY_BALANCE_DIFFERENCE");
      status = "REVIEW_REQUIRED";
    } else {
      pairStatus = "MATCHED";
      status = "MATCHED";
    }

    signals.set(
      item.itemKey,
      buildStatusPayload({
        status,
        issues,
        pairStatus,
        metrics: {
          directionABNetBase: roundAmount(pair?.directionAB?.netBase),
          directionBANetBase: roundAmount(pair?.directionBA?.netBase),
          differenceBase,
          absoluteDifferenceBase,
          directionABLineCount: Number(pair?.directionAB?.lineCount || 0),
          directionBALineCount: Number(pair?.directionBA?.lineCount || 0),
          directionABJournalCount: Number(pair?.directionAB?.journalCount || 0),
          directionBAJournalCount: Number(pair?.directionBA?.journalCount || 0),
        },
        drillPath: buildIntercompanyReconciliationPath({
          fiscalPeriodId: cycle.fiscalPeriodId,
          legalEntityAId: item.legalEntityId,
          legalEntityBId: item.counterpartyLegalEntityId,
        }),
      })
    );
  }

  return signals;
}

async function syncIntercompanyMismatchQueueRows({
  tenantId,
  cycle,
  pairItems,
  runQuery,
}) {
  const itemRows = (pairItems || []).filter(
    (row) =>
      parsePositiveInt(row?.id) &&
      parsePositiveInt(row?.legalEntityId) &&
      parsePositiveInt(row?.counterpartyLegalEntityId)
  );
  if (!itemRows.length) {
    return {
      createdCount: 0,
      updatedCount: 0,
      resolvedCount: 0,
      openCount: 0,
    };
  }

  const liveSignals = await loadIntercompanyPairSignals({
    tenantId,
    cycle,
    pairItems: itemRows,
    runQuery,
  });
  const existingRows = await listPersistedIntercompanyMismatchQueueRows({
    tenantId,
    closeCycleId: cycle.id,
    runQuery,
  });
  const existingByMismatchKey = new Map(
    existingRows.map((row) => [toUpperText(row.mismatchKey), row])
  );

  let createdCount = 0;
  let updatedCount = 0;
  let resolvedCount = 0;
  let openCount = 0;

  for (const item of itemRows) {
    const mismatchKey = buildIntercompanyMismatchKey(
      item.legalEntityId,
      item.counterpartyLegalEntityId
    );
    const signal = liveSignals.get(item.itemKey) || null;
    const existingRow = existingByMismatchKey.get(mismatchKey) || null;
    const liveQueueStatus =
      signal?.pairStatus === "UNILATERAL"
        ? "UNILATERAL"
        : signal?.pairStatus === "MISMATCHED"
          ? "MISMATCHED"
          : null;

    if (liveQueueStatus) {
      openCount += 1;
      if (existingRow) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }

      await runQuery(
        `INSERT INTO intercompany_mismatch_queue (
           tenant_id,
           close_cycle_id,
           close_reconciliation_item_id,
           mismatch_key,
           fiscal_period_id,
           legal_entity_a_id,
           legal_entity_b_id,
           status,
           difference_base,
           absolute_difference_base,
           payload_json,
           first_detected_at,
           last_detected_at,
           resolved_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
         ON DUPLICATE KEY UPDATE
           close_reconciliation_item_id = VALUES(close_reconciliation_item_id),
           fiscal_period_id = VALUES(fiscal_period_id),
           status = VALUES(status),
           difference_base = VALUES(difference_base),
           absolute_difference_base = VALUES(absolute_difference_base),
           payload_json = VALUES(payload_json),
           last_detected_at = CURRENT_TIMESTAMP,
           resolved_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [
          tenantId,
          cycle.id,
          item.id,
          mismatchKey,
          cycle.fiscalPeriodId,
          Math.min(item.legalEntityId, item.counterpartyLegalEntityId),
          Math.max(item.legalEntityId, item.counterpartyLegalEntityId),
          liveQueueStatus,
          roundAmount(signal?.metrics?.differenceBase),
          roundAmount(signal?.metrics?.absoluteDifferenceBase),
          toJsonValue({
            itemKey: item.itemKey,
            pairStatus: signal?.pairStatus || null,
            metrics: signal?.metrics || {},
            issues: signal?.issues || [],
          }),
        ]
      );
      continue;
    }

    if (existingRow && existingRow.status !== "RESOLVED") {
      resolvedCount += 1;
      await runQuery(
        `UPDATE intercompany_mismatch_queue
         SET status = 'RESOLVED',
             difference_base = 0,
             absolute_difference_base = 0,
             payload_json = ?,
             last_detected_at = CURRENT_TIMESTAMP,
             resolved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND close_cycle_id = ?
           AND mismatch_key = ?`,
        [
          toJsonValue({
            itemKey: item.itemKey,
            pairStatus: signal?.pairStatus || "MATCHED",
            metrics: signal?.metrics || {},
            issues: signal?.issues || [],
          }),
          tenantId,
          cycle.id,
          mismatchKey,
        ]
      );
    }
  }

  return {
    createdCount,
    updatedCount,
    resolvedCount,
    openCount,
  };
}

function groupItemsBySetId(items = []) {
  const rowsBySetId = new Map();
  for (const item of items) {
    const setId = parsePositiveInt(item?.closeReconciliationSetId);
    if (!setId) {
      continue;
    }
    if (!rowsBySetId.has(setId)) {
      rowsBySetId.set(setId, []);
    }
    rowsBySetId.get(setId).push(item);
  }
  return rowsBySetId;
}

function buildDefaultControlSignal() {
  return buildStatusPayload({
    status: "NOT_STARTED",
    issues: [],
    metrics: {},
  });
}

function buildControlItemSnapshot({
  item,
  signal,
  persistedQueueByItemId,
}) {
  const resolvedSignal = signal || buildDefaultControlSignal();
  return {
    id: item.id,
    itemKey: item.itemKey,
    setFamily: item.setFamily,
    controlType: item.controlType,
    label:
      item.metadata?.label ||
      item.metadata?.templateName ||
      item.itemKey ||
      `Control ${item.id}`,
    legalEntityId: item.legalEntityId,
    bookId: item.bookId,
    bankAccountId: item.bankAccountId,
    accountId: item.accountId,
    counterpartyLegalEntityId: item.counterpartyLegalEntityId,
    ownerUserId: item.ownerUserId,
    dueAt: item.dueAt,
    status: resolvedSignal.status,
    issues: resolvedSignal.issues,
    metrics: resolvedSignal.metrics,
    drillPath: resolvedSignal.drillPath,
    pairStatus: resolvedSignal.pairStatus,
    metadata: item.metadata || {},
    persistedMismatchQueue: persistedQueueByItemId.get(item.id) || null,
  };
}

function summarizeSetFamilyRows(setRows = []) {
  return setRows.map((setRow) => {
    const items = Array.isArray(setRow?.items) ? setRow.items : [];
    return {
      setFamily: setRow.setFamily,
      setTitle: setRow.setTitle,
      totalItems: items.length,
      matchedCount: items.filter((row) => row.status === "MATCHED").length,
      reviewRequiredCount: items.filter((row) => row.status === "REVIEW_REQUIRED").length,
      notStartedCount: items.filter((row) => row.status === "NOT_STARTED").length,
    };
  });
}

/**
 * Materialize PR-08 reconciliation-control structure for an already-provisioned
 * close cycle without changing any of the underlying bank, CARI, or
 * intercompany runtimes.
 */
export async function syncCloseReconciliationControlsForCycle(
  cycleId,
  actorCtx = {}
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }
  const cycleRow = await loadCloseCycleRow({
    cycleId: normalizedCycleId,
    tenantId,
    runQuery,
  });
  if (!cycleRow) {
    throw badRequest("close cycle not found");
  }

  const cycle = mapCycleRow(cycleRow);
  const cycleItemResult = await listCycleItems(cycle.id, {}, { tenantId, userId, runQuery });
  const cycleItems = Array.isArray(cycleItemResult?.rows) ? cycleItemResult.rows : [];
  const legalEntityIds = collectCycleLegalEntityIds(cycle, cycleItems);
  const bookIds = collectCycleBookIds(cycleItems);
  const [bankAccounts, books, legalEntityRows] = await Promise.all([
    listBankAccountsByLegalEntities({
      tenantId,
      legalEntityIds,
      runQuery,
    }),
    listBooksByIds({
      bookIds,
      runQuery,
    }),
    listLegalEntitiesByIds({
      tenantId,
      legalEntityIds,
      runQuery,
    }),
  ]);

  const existingSets = await listPersistedReconciliationSets({
    tenantId,
    closeCycleId: cycle.id,
    runQuery,
  });
  const existingSetKeys = new Set(existingSets.map((row) => row.setKey));
  const setDefinitions = buildSetDefinitions(cycle);
  for (const definition of setDefinitions) {
    await upsertReconciliationSet({
      tenantId,
      closeCycleId: cycle.id,
      definition,
      runQuery,
    });
  }

  const persistedSets = await listPersistedReconciliationSets({
    tenantId,
    closeCycleId: cycle.id,
    runQuery,
  });
  const setsByKey = new Map(
    persistedSets.map((row) => [toUpperText(row.setKey), row]).filter(([, row]) => row)
  );

  const existingItems = await listPersistedReconciliationItems({
    tenantId,
    closeCycleId: cycle.id,
    runQuery,
  });
  const existingItemKeys = new Set(existingItems.map((row) => row.itemKey));
  const controlDefinitions = buildControlDefinitions({
    cycle,
    cycleItems,
    bankAccounts,
    books,
    legalEntityRows,
  });
  for (const definition of controlDefinitions) {
    const setRow = setsByKey.get(toUpperText(definition.setFamily));
    if (!setRow?.id) {
      throw badRequest(`Missing close reconciliation set for family ${definition.setFamily}`);
    }
    await upsertReconciliationItem({
      tenantId,
      closeCycleId: cycle.id,
      closeReconciliationSetId: setRow.id,
      definition,
      runQuery,
    });
  }

  const persistedItems = await listPersistedReconciliationItems({
    tenantId,
    closeCycleId: cycle.id,
    runQuery,
  });
  const intercompanyQueueSummary = await syncIntercompanyMismatchQueueRows({
    tenantId,
    cycle,
    pairItems: persistedItems.filter(
      (row) =>
        row.setFamily === "INTERCOMPANY_RECONCILIATION" &&
        row.controlType === "ENTITY_PAIR"
    ),
    runQuery,
  });

  return {
    setsCreatedCount: setDefinitions.filter((row) => !existingSetKeys.has(row.setKey)).length,
    setsUpdatedCount: setDefinitions.filter((row) => existingSetKeys.has(row.setKey)).length,
    itemsCreatedCount: controlDefinitions.filter((row) => !existingItemKeys.has(row.itemKey))
      .length,
    itemsUpdatedCount: controlDefinitions.filter((row) => existingItemKeys.has(row.itemKey))
      .length,
    mismatchQueueCreatedCount: Number(intercompanyQueueSummary.createdCount || 0),
    mismatchQueueUpdatedCount: Number(intercompanyQueueSummary.updatedCount || 0),
    mismatchQueueResolvedCount: Number(intercompanyQueueSummary.resolvedCount || 0),
    mismatchQueueOpenCount: Number(intercompanyQueueSummary.openCount || 0),
    totalCount: controlDefinitions.length,
  };
}

/**
 * Build the PR-08 close-control snapshot by reading the materialized control
 * rows and evaluating live bank/CARI/clearing/intercompany signals against the
 * current period state.
 */
export async function buildCloseCycleReconciliationSnapshot(
  { cycle } = {},
  actorCtx = {}
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const normalizedCycle = mapCycleRow(cycle);
  if (!normalizedCycle?.id) {
    throw badRequest("cycle is required");
  }

  const [persistedSets, persistedItems, periodWindow] = await Promise.all([
    listPersistedReconciliationSets({
      tenantId,
      closeCycleId: normalizedCycle.id,
      runQuery,
    }),
    listPersistedReconciliationItems({
      tenantId,
      closeCycleId: normalizedCycle.id,
      runQuery,
    }),
    loadFiscalPeriodWindow({
      fiscalPeriodId: normalizedCycle.fiscalPeriodId,
      runQuery,
    }),
  ]);

  if (!periodWindow) {
    throw badRequest("cycle fiscal period could not be resolved");
  }

  const persistedQueueRows = await listPersistedIntercompanyMismatchQueueRows({
    tenantId,
    closeCycleId: normalizedCycle.id,
    runQuery,
  });
  const persistedQueueByItemId = new Map(
    persistedQueueRows
      .filter((row) => parsePositiveInt(row.closeReconciliationItemId))
      .map((row) => [parsePositiveInt(row.closeReconciliationItemId), row])
  );

  const booksById = indexRowsById(
    await listBooksByIds({
      bookIds: persistedItems.map((row) => row.bookId),
      runQuery,
    })
  );
  const booksByLegalEntityId = new Map();
  for (const item of persistedItems) {
    if (
      item.setFamily !== "SUBLEDGER_GL_RECONCILIATION" ||
      !parsePositiveInt(item.legalEntityId) ||
      !parsePositiveInt(item.bookId)
    ) {
      continue;
    }
    if (!booksByLegalEntityId.has(item.legalEntityId)) {
      booksByLegalEntityId.set(item.legalEntityId, []);
    }
    booksByLegalEntityId.get(item.legalEntityId).push(parsePositiveInt(item.bookId));
  }

  const throughPeriodIds = await loadThroughPeriodIds({
    fiscalCalendarId: normalizedCycle.fiscalCalendarId,
    fiscalPeriodId: normalizedCycle.fiscalPeriodId,
    runQuery,
  });
  const effectiveThroughPeriodIds = throughPeriodIds.length
    ? throughPeriodIds
    : [normalizedCycle.fiscalPeriodId];

  const bankSignals = await loadBankReconciliationSignals({
    tenantId,
    cycle: normalizedCycle,
    bankItems: persistedItems.filter(
      (row) =>
        row.setFamily === "BANK_RECONCILIATION" && row.controlType === "BANK_ACCOUNT"
    ),
    periodWindow,
    runQuery,
  });
  const subledgerSignals = await loadSubledgerGlSignals({
    tenantId,
    cycle: normalizedCycle,
    bookItems: persistedItems.filter(
      (row) =>
        row.setFamily === "SUBLEDGER_GL_RECONCILIATION" && row.controlType === "BOOK"
    ),
    booksById,
    runQuery,
  });
  const suspenseSignals = await loadSuspenseClearingSignals({
    tenantId,
    cycle: normalizedCycle,
    legalEntityItems: persistedItems.filter(
      (row) =>
        row.setFamily === "SUSPENSE_CLEARING_RECONCILIATION" &&
        row.controlType === "LEGAL_ENTITY"
    ),
    booksByLegalEntityId,
    throughPeriodIds: effectiveThroughPeriodIds,
    runQuery,
  });
  const intercompanySignals = await loadIntercompanyPairSignals({
    tenantId,
    cycle: normalizedCycle,
    pairItems: persistedItems.filter(
      (row) =>
        row.setFamily === "INTERCOMPANY_RECONCILIATION" &&
        row.controlType === "ENTITY_PAIR"
    ),
    runQuery,
  });

  const rowsBySetId = groupItemsBySetId(
    persistedItems.map((item) => {
      let signal = null;
      if (item.setFamily === "BANK_RECONCILIATION") {
        signal = bankSignals.get(item.itemKey) || null;
      } else if (item.setFamily === "SUBLEDGER_GL_RECONCILIATION") {
        signal = subledgerSignals.get(item.itemKey) || null;
      } else if (item.setFamily === "SUSPENSE_CLEARING_RECONCILIATION") {
        signal = suspenseSignals.get(item.itemKey) || null;
      } else if (item.setFamily === "INTERCOMPANY_RECONCILIATION") {
        signal = intercompanySignals.get(item.itemKey) || null;
      }

      return buildControlItemSnapshot({
        item,
        signal,
        persistedQueueByItemId,
      });
    })
  );

  const setRows = persistedSets.map((setRow) => ({
    ...setRow,
    items: rowsBySetId.get(setRow.id) || [],
  }));
  const familyRows = summarizeSetFamilyRows(setRows);
  const flatRows = setRows.flatMap((row) => row.items || []);
  const byStatusMap = new Map();
  for (const row of flatRows) {
    const status = normalizeReconciliationStatus(row.status);
    byStatusMap.set(status, Number(byStatusMap.get(status) || 0) + 1);
  }

  return {
    totalSets: persistedSets.length,
    totalItems: flatRows.length,
    counts: {
      reviewRequired: flatRows.filter((row) => row.status === "REVIEW_REQUIRED").length,
      matched: flatRows.filter((row) => row.status === "MATCHED").length,
      notStarted: flatRows.filter((row) => row.status === "NOT_STARTED").length,
      openMismatchQueue: persistedQueueRows.filter((row) => row.status !== "RESOLVED").length,
    },
    byStatus: Array.from(byStatusMap.entries()).map(([status, count]) => ({
      status,
      count,
    })),
    byFamily: familyRows,
    queue: {
      total: persistedQueueRows.length,
      open: persistedQueueRows.filter((row) => row.status !== "RESOLVED").length,
      rows: persistedQueueRows,
    },
    sets: setRows,
  };
}

export default {
  syncCloseReconciliationControlsForCycle,
  buildCloseCycleReconciliationSnapshot,
};
