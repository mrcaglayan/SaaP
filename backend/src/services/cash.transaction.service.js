import { withTransaction } from "../db.js";
import { assertAccountBelongsToTenant } from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  cancelCashTransaction,
  countCashTransactions,
  findCashRegisterById,
  findCashTransactionById,
  findCashTransactionByIntegrationEventUid,
  findCashTransactionByIdempotency,
  findCashTransactionByReversalOf,
  findCashTransactionScopeById,
  findOpenCashSessionByRegisterId,
  findCashSessionById,
  generateCashTxnNoForLegalEntityYearTx,
  insertCashTransaction,
  listCashTransactions,
  markCashTransactionAsReversed,
  postCashTransaction,
} from "./cash.queries.js";
import { assertRegisterOperationalConfig } from "./cash.register.service.js";
import { createAndPostCashJournalTx } from "./cash.service.js";

const TRANSFER_TXN_TYPES = new Set(["TRANSFER_OUT", "TRANSFER_IN"]);
const BANK_TXN_TYPES = new Set(["DEPOSIT_TO_BANK", "WITHDRAWAL_FROM_BANK"]);
const NON_BANK_COUNTER_ACCOUNT_REQUIRED_TXN_TYPES = new Set([
  "RECEIPT",
  "PAYOUT",
  "OPENING_FLOAT",
  "CLOSING_ADJUSTMENT",
  "VARIANCE",
]);
const MANUAL_PROHIBITED_TXN_TYPES = new Set(["VARIANCE"]);
const CANCELLABLE_TXN_STATUSES = new Set(["DRAFT", "SUBMITTED"]);
const POSTABLE_TXN_STATUSES = new Set(["DRAFT", "SUBMITTED", "APPROVED"]);
const CARI_LINKED_TXN_TYPES = new Set(["RECEIPT", "PAYOUT"]);
const CARI_COUNTERPARTY_TYPES = new Set(["CUSTOMER", "VENDOR"]);

function nowMysqlDateTime() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function isActive(value) {
  return asUpper(value) === "ACTIVE";
}

function assertStatusAllowed(actual, allowedSet, message) {
  if (!allowedSet.has(asUpper(actual))) {
    throw badRequest(message);
  }
}

function normalizeMoney(value) {
  return Number(value || 0).toFixed(6);
}

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function resolveSessionForCreate({
  tenantId,
  register,
  requestedSessionId,
  runQuery,
}) {
  const sessionMode = asUpper(register.session_mode);

  if (requestedSessionId) {
    const session = await findCashSessionById({
      tenantId,
      sessionId: requestedSessionId,
      runQuery,
    });
    if (!session) {
      throw badRequest("cashSessionId not found for tenant");
    }
    if (parsePositiveInt(session.cash_register_id) !== parsePositiveInt(register.id)) {
      throw badRequest("cashSessionId must belong to registerId");
    }
    if (asUpper(session.status) !== "OPEN") {
      throw badRequest("cashSessionId must be OPEN");
    }
    return session;
  }

  if (sessionMode === "NONE") {
    return null;
  }

  const openSession = await findOpenCashSessionByRegisterId({
    tenantId,
    registerId: register.id,
    runQuery,
  });

  if (sessionMode === "REQUIRED" && !openSession) {
    throw badRequest("An OPEN cash session is required for this register");
  }

  return openSession || null;
}

function validateTxnTypeSpecificRules(payload) {
  if (MANUAL_PROHIBITED_TXN_TYPES.has(payload.txnType)) {
    throw badRequest(`${payload.txnType} can only be system-generated`);
  }

  if (TRANSFER_TXN_TYPES.has(payload.txnType) && !payload.counterCashRegisterId) {
    throw badRequest(`${payload.txnType} requires counterCashRegisterId`);
  }

  if (
    (BANK_TXN_TYPES.has(payload.txnType) ||
      NON_BANK_COUNTER_ACCOUNT_REQUIRED_TXN_TYPES.has(payload.txnType)) &&
    !payload.counterAccountId
  ) {
    throw badRequest(`${payload.txnType} requires counterAccountId`);
  }
}

function resolveCashIntegrationDefaults(payload) {
  const hasLinkedCariRefs = Boolean(
    payload.linkedCariSettlementBatchId || payload.linkedCariUnappliedCashId
  );
  const sourceModule = payload.sourceModule || (hasLinkedCariRefs ? "CARI" : "MANUAL");
  const sourceEntityType =
    payload.sourceEntityType ||
    (payload.linkedCariSettlementBatchId
      ? "cari_settlement_batch"
      : payload.linkedCariUnappliedCashId
        ? "cari_unapplied_cash"
        : null);
  const sourceEntityId =
    payload.sourceEntityId ||
    (payload.linkedCariSettlementBatchId
      ? String(payload.linkedCariSettlementBatchId)
      : payload.linkedCariUnappliedCashId
        ? String(payload.linkedCariUnappliedCashId)
        : null);
  const integrationLinkStatus =
    payload.integrationLinkStatus || (hasLinkedCariRefs ? "LINKED" : "UNLINKED");
  return {
    sourceModule,
    sourceEntityType,
    sourceEntityId,
    integrationLinkStatus,
    hasLinkedCariRefs,
  };
}

async function fetchCariCounterpartyForRegister({
  tenantId,
  legalEntityId,
  counterpartyId,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT id, is_customer, is_vendor
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, counterpartyId]
  );
  return result.rows?.[0] || null;
}

async function fetchCariSettlementBatchForLink({
  tenantId,
  settlementBatchId,
  runQuery,
  forUpdate = false,
}) {
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT id, legal_entity_id, counterparty_id, cash_transaction_id
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1
     ${lockClause}`,
    [tenantId, settlementBatchId]
  );
  return result.rows?.[0] || null;
}

async function fetchCariUnappliedCashForLink({
  tenantId,
  unappliedCashId,
  runQuery,
  forUpdate = false,
}) {
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT id, legal_entity_id, counterparty_id, cash_transaction_id
     FROM cari_unapplied_cash
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1
     ${lockClause}`,
    [tenantId, unappliedCashId]
  );
  return result.rows?.[0] || null;
}

export async function resolveCashTransactionScope(transactionId, tenantId) {
  const parsedTransactionId = parsePositiveInt(transactionId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedTransactionId || !parsedTenantId) {
    return null;
  }

  const row = await findCashTransactionScopeById({
    tenantId: parsedTenantId,
    transactionId: parsedTransactionId,
  });
  if (!row) {
    return null;
  }

  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: Number(row.legal_entity_id),
  };
}

export async function listCashTransactionRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["ct.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "cr.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("cr.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }

  if (filters.registerId) {
    const register = await findCashRegisterById({
      tenantId,
      registerId: filters.registerId,
    });
    if (!register) {
      throw badRequest("registerId not found for tenant");
    }
    assertScopeAccess(req, "legal_entity", register.legal_entity_id, "registerId");
    if (register.operating_unit_id) {
      assertScopeAccess(req, "operating_unit", register.operating_unit_id, "registerId");
    }

    conditions.push("ct.cash_register_id = ?");
    params.push(filters.registerId);
  }

  if (filters.sessionId) {
    conditions.push("ct.cash_session_id = ?");
    params.push(filters.sessionId);
  }
  if (filters.txnType) {
    conditions.push("ct.txn_type = ?");
    params.push(filters.txnType);
  }
  if (filters.status) {
    conditions.push("ct.status = ?");
    params.push(filters.status);
  }
  if (filters.bookDateFrom) {
    conditions.push("ct.book_date >= ?");
    params.push(filters.bookDateFrom);
  }
  if (filters.bookDateTo) {
    conditions.push("ct.book_date <= ?");
    params.push(filters.bookDateTo);
  }

  const whereSql = conditions.join(" AND ");
  const total = await countCashTransactions({ whereSql, params });
  const rows = await listCashTransactions({
    whereSql,
    params,
    limit: filters.limit,
    offset: filters.offset,
  });

  return {
    rows,
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export async function getCashTransactionByIdForTenant({
  req,
  tenantId,
  transactionId,
  assertScopeAccess,
}) {
  const row = await findCashTransactionById({
    tenantId,
    transactionId,
  });
  if (!row) {
    throw badRequest("Cash transaction not found");
  }

  assertScopeAccess(req, "legal_entity", row.legal_entity_id, "transactionId");
  if (row.operating_unit_id) {
    assertScopeAccess(req, "operating_unit", row.operating_unit_id, "transactionId");
  }

  return row;
}

export async function createCashTransaction({
  req,
  payload,
  assertScopeAccess,
}) {
  validateTxnTypeSpecificRules(payload);
  const integrationDefaults = resolveCashIntegrationDefaults(payload);
  if (
    (integrationDefaults.hasLinkedCariRefs || integrationDefaults.sourceModule === "CARI") &&
    !CARI_LINKED_TXN_TYPES.has(payload.txnType)
  ) {
    throw badRequest("Cari integration links are only supported for RECEIPT and PAYOUT cash transactions");
  }

  const register = await findCashRegisterById({
    tenantId: payload.tenantId,
    registerId: payload.registerId,
  });
  if (!register) {
    throw badRequest("registerId not found for tenant");
  }
  assertRegisterOperationalConfig(register, {
    requireActive: true,
    requireCashControlledAccount: true,
  });

  assertScopeAccess(req, "legal_entity", register.legal_entity_id, "registerId");
  if (register.operating_unit_id) {
    assertScopeAccess(req, "operating_unit", register.operating_unit_id, "registerId");
  }

  if (Number(register.max_txn_amount || 0) > 0) {
    if (Number(payload.amount) > Number(register.max_txn_amount)) {
      throw badRequest("amount exceeds register max_txn_amount");
    }
  }

  if (normalizeCurrency(payload.currencyCode) !== normalizeCurrency(register.currency_code)) {
    throw badRequest("Transaction currency must match register currency");
  }

  if (payload.counterAccountId) {
    await assertAccountBelongsToTenant(payload.tenantId, payload.counterAccountId, "counterAccountId");
  }

  if (payload.counterCashRegisterId) {
    const counterRegister = await findCashRegisterById({
      tenantId: payload.tenantId,
      registerId: payload.counterCashRegisterId,
    });
    if (!counterRegister) {
      throw badRequest("counterCashRegisterId not found for tenant");
    }
  }

  if (payload.integrationEventUid) {
    const replayByEvent = await findCashTransactionByIntegrationEventUid({
      tenantId: payload.tenantId,
      integrationEventUid: payload.integrationEventUid,
    });
    if (replayByEvent) {
      return {
        row: replayByEvent,
        idempotentReplay: true,
      };
    }
  }

  try {
    return await withTransaction(async (tx) => {
      if (payload.integrationEventUid) {
        const existingByEvent = await findCashTransactionByIntegrationEventUid({
          tenantId: payload.tenantId,
          integrationEventUid: payload.integrationEventUid,
          runQuery: tx.query,
        });
        if (existingByEvent) {
          return {
            row: existingByEvent,
            idempotentReplay: true,
          };
        }
      }

      const existing = await findCashTransactionByIdempotency({
        tenantId: payload.tenantId,
        registerId: payload.registerId,
        idempotencyKey: payload.idempotencyKey,
        runQuery: tx.query,
      });
      if (existing) {
        return {
          row: existing,
          idempotentReplay: true,
        };
      }

      if (
        integrationDefaults.sourceModule === "CARI" &&
        payload.counterpartyId &&
        !CARI_COUNTERPARTY_TYPES.has(asUpper(payload.counterpartyType))
      ) {
        throw badRequest("counterpartyType must be CUSTOMER or VENDOR when sourceModule=CARI");
      }
      if (payload.counterpartyId && CARI_COUNTERPARTY_TYPES.has(asUpper(payload.counterpartyType))) {
        const counterpartyRow = await fetchCariCounterpartyForRegister({
          tenantId: payload.tenantId,
          legalEntityId: parsePositiveInt(register.legal_entity_id),
          counterpartyId: payload.counterpartyId,
          runQuery: tx.query,
        });
        if (!counterpartyRow) {
          throw badRequest("counterpartyId must belong to register legalEntityId");
        }
        if (
          asUpper(payload.counterpartyType) === "CUSTOMER" &&
          !(counterpartyRow.is_customer === true || Number(counterpartyRow.is_customer) === 1)
        ) {
          throw badRequest("counterpartyId is not marked as customer");
        }
        if (
          asUpper(payload.counterpartyType) === "VENDOR" &&
          !(counterpartyRow.is_vendor === true || Number(counterpartyRow.is_vendor) === 1)
        ) {
          throw badRequest("counterpartyId is not marked as vendor");
        }
      }

      let linkedSettlement = null;
      if (payload.linkedCariSettlementBatchId) {
        linkedSettlement = await fetchCariSettlementBatchForLink({
          tenantId: payload.tenantId,
          settlementBatchId: payload.linkedCariSettlementBatchId,
          runQuery: tx.query,
          forUpdate: true,
        });
        if (!linkedSettlement) {
          throw badRequest("linkedCariSettlementBatchId not found for tenant");
        }
        if (
          parsePositiveInt(linkedSettlement.legal_entity_id) !==
          parsePositiveInt(register.legal_entity_id)
        ) {
          throw badRequest("linkedCariSettlementBatchId must belong to register legalEntityId");
        }
        const existingLinkedCashId = parsePositiveInt(linkedSettlement.cash_transaction_id);
        if (existingLinkedCashId) {
          throw badRequest("linkedCariSettlementBatchId is already linked to a cash transaction");
        }
        if (
          payload.counterpartyId &&
          parsePositiveInt(linkedSettlement.counterparty_id) &&
          parsePositiveInt(linkedSettlement.counterparty_id) !== payload.counterpartyId
        ) {
          throw badRequest("linkedCariSettlementBatchId counterparty does not match counterpartyId");
        }
      }

      let linkedUnapplied = null;
      if (payload.linkedCariUnappliedCashId) {
        linkedUnapplied = await fetchCariUnappliedCashForLink({
          tenantId: payload.tenantId,
          unappliedCashId: payload.linkedCariUnappliedCashId,
          runQuery: tx.query,
          forUpdate: true,
        });
        if (!linkedUnapplied) {
          throw badRequest("linkedCariUnappliedCashId not found for tenant");
        }
        if (
          parsePositiveInt(linkedUnapplied.legal_entity_id) !==
          parsePositiveInt(register.legal_entity_id)
        ) {
          throw badRequest("linkedCariUnappliedCashId must belong to register legalEntityId");
        }
        const existingLinkedCashId = parsePositiveInt(linkedUnapplied.cash_transaction_id);
        if (existingLinkedCashId) {
          throw badRequest("linkedCariUnappliedCashId is already linked to a cash transaction");
        }
        if (
          payload.counterpartyId &&
          parsePositiveInt(linkedUnapplied.counterparty_id) &&
          parsePositiveInt(linkedUnapplied.counterparty_id) !== payload.counterpartyId
        ) {
          throw badRequest("linkedCariUnappliedCashId counterparty does not match counterpartyId");
        }
      }

      if (
        linkedSettlement &&
        linkedUnapplied &&
        parsePositiveInt(linkedSettlement.counterparty_id) &&
        parsePositiveInt(linkedUnapplied.counterparty_id) &&
        parsePositiveInt(linkedSettlement.counterparty_id) !==
          parsePositiveInt(linkedUnapplied.counterparty_id)
      ) {
        throw badRequest(
          "linkedCariSettlementBatchId and linkedCariUnappliedCashId must target the same counterparty"
        );
      }

      const linkedSession = await resolveSessionForCreate({
        tenantId: payload.tenantId,
        register,
        requestedSessionId: payload.cashSessionId,
        runQuery: tx.query,
      });

      const txnNo = await generateCashTxnNoForLegalEntityYearTx({
        tenantId: payload.tenantId,
        legalEntityId: register.legal_entity_id,
        legalEntityCode: register.legal_entity_code,
        bookDate: payload.bookDate,
        runQuery: tx.query,
      });

      const transactionId = await insertCashTransaction({
        payload: {
          tenantId: payload.tenantId,
          registerId: payload.registerId,
          cashSessionId: linkedSession?.id || null,
          txnNo,
          txnType: payload.txnType,
          status: "DRAFT",
          txnDatetime: payload.txnDatetime,
          bookDate: payload.bookDate,
          amount: normalizeMoney(payload.amount),
          currencyCode: payload.currencyCode,
          description: payload.description,
          referenceNo: payload.referenceNo,
          sourceDocType: payload.sourceDocType,
          sourceDocId: payload.sourceDocId,
          sourceModule: integrationDefaults.sourceModule,
          sourceEntityType: integrationDefaults.sourceEntityType,
          sourceEntityId: integrationDefaults.sourceEntityId,
          integrationLinkStatus: integrationDefaults.integrationLinkStatus,
          counterpartyType: payload.counterpartyType,
          counterpartyId: payload.counterpartyId,
          counterAccountId: payload.counterAccountId,
          counterCashRegisterId: payload.counterCashRegisterId,
          linkedCariSettlementBatchId: payload.linkedCariSettlementBatchId,
          linkedCariUnappliedCashId: payload.linkedCariUnappliedCashId,
          reversalOfTransactionId: null,
          overrideCashControl: false,
          overrideReason: null,
          idempotencyKey: payload.idempotencyKey,
          integrationEventUid: payload.integrationEventUid || null,
          userId: payload.userId,
          postedByUserId: null,
          postedAt: null,
        },
        runQuery: tx.query,
      });

      if (linkedSettlement) {
        const settlementLinkUpdate = await tx.query(
          `UPDATE cari_settlement_batches
           SET cash_transaction_id = ?,
               source_module = COALESCE(source_module, 'CASH'),
               source_entity_type = COALESCE(source_entity_type, 'cash_transaction'),
               source_entity_id = COALESCE(source_entity_id, ?),
               integration_link_status = CASE
                 WHEN integration_link_status = 'UNLINKED' THEN 'LINKED'
                 ELSE integration_link_status
               END,
               integration_event_uid = COALESCE(integration_event_uid, ?)
           WHERE tenant_id = ?
             AND id = ?
             AND (cash_transaction_id IS NULL OR cash_transaction_id = ?)`,
          [
            transactionId,
            String(transactionId),
            payload.integrationEventUid || null,
            payload.tenantId,
            payload.linkedCariSettlementBatchId,
            transactionId,
          ]
        );
        if (Number(settlementLinkUpdate.rows?.affectedRows || 0) === 0) {
          throw badRequest("linkedCariSettlementBatchId is already linked to another cash transaction");
        }
      }

      if (linkedUnapplied) {
        const unappliedLinkUpdate = await tx.query(
          `UPDATE cari_unapplied_cash
           SET cash_transaction_id = ?,
               source_module = COALESCE(source_module, 'CASH'),
               source_entity_type = COALESCE(source_entity_type, 'cash_transaction'),
               source_entity_id = COALESCE(source_entity_id, ?),
               integration_link_status = CASE
                 WHEN integration_link_status = 'UNLINKED' THEN 'LINKED'
                 ELSE integration_link_status
               END,
               integration_event_uid = COALESCE(integration_event_uid, ?)
           WHERE tenant_id = ?
             AND id = ?
             AND (cash_transaction_id IS NULL OR cash_transaction_id = ?)`,
          [
            transactionId,
            String(transactionId),
            payload.integrationEventUid || null,
            payload.tenantId,
            payload.linkedCariUnappliedCashId,
            transactionId,
          ]
        );
        if (Number(unappliedLinkUpdate.rows?.affectedRows || 0) === 0) {
          throw badRequest("linkedCariUnappliedCashId is already linked to another cash transaction");
        }
      }

      const row = await findCashTransactionById({
        tenantId: payload.tenantId,
        transactionId,
        runQuery: tx.query,
      });
      return {
        row,
        idempotentReplay: false,
      };
    });
  } catch (err) {
    const isDuplicateKey =
      Number(err?.errno) === 1062 || String(err?.code || "").toUpperCase() === "ER_DUP_ENTRY";
    if (isDuplicateKey) {
      const duplicateMessage = String(err?.message || "");
      if (
        duplicateMessage.includes("uk_cari_settle_batches_tenant_cash_txn") ||
        duplicateMessage.includes("uk_cari_unap_tenant_cash_txn")
      ) {
        throw badRequest("Linked cari record is already connected to another cash transaction");
      }

      const replayRow = await findCashTransactionByIdempotency({
        tenantId: payload.tenantId,
        registerId: payload.registerId,
        idempotencyKey: payload.idempotencyKey,
      });
      if (replayRow) {
        return {
          row: replayRow,
          idempotentReplay: true,
        };
      }
      if (payload.integrationEventUid) {
        const replayByEvent = await findCashTransactionByIntegrationEventUid({
          tenantId: payload.tenantId,
          integrationEventUid: payload.integrationEventUid,
        });
        if (replayByEvent) {
          return {
            row: replayByEvent,
            idempotentReplay: true,
          };
        }
      }
      if (duplicateMessage.includes("uk_cash_txn_tenant_integration_event_uid")) {
        throw badRequest("Duplicate integrationEventUid");
      }
      throw badRequest("Duplicate transaction idempotency key");
    }
    throw err;
  }
}

export async function cancelCashTransactionById({
  req,
  payload,
  assertScopeAccess,
}) {
  const row = await findCashTransactionById({
    tenantId: payload.tenantId,
    transactionId: payload.transactionId,
  });
  if (!row) {
    throw badRequest("Cash transaction not found");
  }

  assertScopeAccess(req, "legal_entity", row.legal_entity_id, "transactionId");
  if (row.operating_unit_id) {
    assertScopeAccess(req, "operating_unit", row.operating_unit_id, "transactionId");
  }

  assertStatusAllowed(
    row.status,
    CANCELLABLE_TXN_STATUSES,
    "Only DRAFT or SUBMITTED transactions can be cancelled"
  );

  await cancelCashTransaction({
    tenantId: payload.tenantId,
    transactionId: payload.transactionId,
    userId: payload.userId,
    cancelReason: payload.cancelReason,
  });

  return findCashTransactionById({
    tenantId: payload.tenantId,
    transactionId: payload.transactionId,
  });
}

export async function postCashTransactionById({
  req,
  payload,
  assertScopeAccess,
}) {
  const posted = await withTransaction(async (tx) => {
    const row = await findCashTransactionById({
      tenantId: payload.tenantId,
      transactionId: payload.transactionId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!row) {
      throw badRequest("Cash transaction not found");
    }

    assertScopeAccess(req, "legal_entity", row.legal_entity_id, "transactionId");
    if (row.operating_unit_id) {
      assertScopeAccess(req, "operating_unit", row.operating_unit_id, "transactionId");
    }

    if (asUpper(row.status) === "POSTED") {
      return {
        row,
        idempotentReplay: true,
      };
    }

    assertStatusAllowed(
      row.status,
      POSTABLE_TXN_STATUSES,
      "Only DRAFT, SUBMITTED, or APPROVED transactions can be posted"
    );

    if (!isActive(row.register_status)) {
      throw badRequest("Cash register is not ACTIVE");
    }

    const sessionMode = asUpper(row.register_session_mode);
    if (sessionMode === "REQUIRED") {
      if (!row.cash_session_id) {
        throw badRequest("Posting requires an OPEN cash session");
      }
      if (asUpper(row.cash_session_status) !== "OPEN") {
        throw badRequest("Posting requires cash_session_id to be OPEN");
      }
    }

    const posting = await createAndPostCashJournalTx(tx, {
      tenantId: payload.tenantId,
      userId: payload.userId,
      legalEntityId: parsePositiveInt(row.legal_entity_id),
      cashTxn: row,
      req,
    });

    await postCashTransaction({
      tenantId: payload.tenantId,
      transactionId: payload.transactionId,
      userId: payload.userId,
      postedJournalEntryId: posting.journalEntryId,
      overrideCashControl: payload.overrideCashControl,
      overrideReason: payload.overrideCashControl ? payload.overrideReason : null,
      runQuery: tx.query,
    });

    const saved = await findCashTransactionById({
      tenantId: payload.tenantId,
      transactionId: payload.transactionId,
      runQuery: tx.query,
    });

    return {
      row: saved,
      idempotentReplay: false,
    };
  });

  return posted;
}

export async function reverseCashTransactionById({
  req,
  payload,
  assertScopeAccess,
}) {
  const reversed = await withTransaction(async (tx) => {
    const original = await findCashTransactionById({
      tenantId: payload.tenantId,
      transactionId: payload.transactionId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!original) {
      throw badRequest("Cash transaction not found");
    }

    assertScopeAccess(req, "legal_entity", original.legal_entity_id, "transactionId");
    if (original.operating_unit_id) {
      assertScopeAccess(req, "operating_unit", original.operating_unit_id, "transactionId");
    }

    const existingReversal = await findCashTransactionByReversalOf({
      tenantId: payload.tenantId,
      transactionId: payload.transactionId,
      runQuery: tx.query,
    });

    if (asUpper(original.status) === "REVERSED" && existingReversal) {
      return {
        original,
        reversal: existingReversal,
        idempotentReplay: true,
      };
    }

    if (parsePositiveInt(original.reversal_of_transaction_id)) {
      throw badRequest("Reversal transactions cannot be reversed");
    }

    if (asUpper(original.status) !== "POSTED") {
      throw badRequest("Only POSTED transactions can be reversed");
    }

    let reversal = existingReversal;
    if (!reversal) {
      const reversalBookDate = todayIsoDate();
      const reversalTxnNo = await generateCashTxnNoForLegalEntityYearTx({
        tenantId: payload.tenantId,
        legalEntityId: original.legal_entity_id,
        legalEntityCode: original.legal_entity_code,
        bookDate: reversalBookDate,
        runQuery: tx.query,
      });

      const reversalId = await insertCashTransaction({
        payload: {
          tenantId: payload.tenantId,
          registerId: original.cash_register_id,
          cashSessionId: original.cash_session_id,
          txnNo: reversalTxnNo,
          txnType: original.txn_type,
          status: "DRAFT",
          txnDatetime: nowMysqlDateTime(),
          bookDate: reversalBookDate,
          amount: normalizeMoney(original.amount),
          currencyCode: original.currency_code,
          description: `Reversal of ${original.txn_no}: ${payload.reverseReason}`,
          referenceNo: original.reference_no,
          sourceDocType: original.source_doc_type,
          sourceDocId: original.source_doc_id,
          sourceModule: "CASH",
          sourceEntityType: "cash_transaction_reversal",
          sourceEntityId: String(original.id),
          integrationLinkStatus: "UNLINKED",
          counterpartyType: original.counterparty_type,
          counterpartyId: original.counterparty_id,
          counterAccountId: original.counter_account_id,
          counterCashRegisterId: original.counter_cash_register_id,
          linkedCariSettlementBatchId: null,
          linkedCariUnappliedCashId: null,
          reversalOfTransactionId: original.id,
          overrideCashControl: false,
          overrideReason: null,
          idempotencyKey: `REV-${original.id}`,
          integrationEventUid: `REV-${original.id}`,
          userId: payload.userId,
          postedByUserId: null,
          postedAt: null,
        },
        runQuery: tx.query,
      });

      reversal = await findCashTransactionById({
        tenantId: payload.tenantId,
        transactionId: reversalId,
        runQuery: tx.query,
      });
    }

    if (!reversal) {
      throw badRequest("Failed to create reversal cash transaction");
    }
    const reversalPostedJournalEntryId = parsePositiveInt(reversal.posted_journal_entry_id);
    if (asUpper(reversal.status) !== "POSTED" || !reversalPostedJournalEntryId) {
      const reversalPosting = await createAndPostCashJournalTx(tx, {
        tenantId: payload.tenantId,
        userId: payload.userId,
        legalEntityId: parsePositiveInt(reversal.legal_entity_id),
        cashTxn: reversal,
        req,
      });

      await postCashTransaction({
        tenantId: payload.tenantId,
        transactionId: parsePositiveInt(reversal.id),
        userId: payload.userId,
        postedJournalEntryId: reversalPosting.journalEntryId,
        overrideCashControl: false,
        overrideReason: null,
        runQuery: tx.query,
      });

      reversal = await findCashTransactionById({
        tenantId: payload.tenantId,
        transactionId: parsePositiveInt(reversal.id),
        runQuery: tx.query,
      });
    }

    await markCashTransactionAsReversed({
      tenantId: payload.tenantId,
      transactionId: payload.transactionId,
      userId: payload.userId,
      runQuery: tx.query,
    });

    const refreshedOriginal = await findCashTransactionById({
      tenantId: payload.tenantId,
      transactionId: payload.transactionId,
      runQuery: tx.query,
    });

    return {
      original: refreshedOriginal,
      reversal,
      idempotentReplay: false,
    };
  });

  return reversed;
}
