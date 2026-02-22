import { withTransaction } from "../db.js";
import { assertAccountBelongsToTenant } from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  cancelCashTransaction,
  countCashTransactions,
  findCashRegisterById,
  findCashTransactionById,
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
const MANUAL_PROHIBITED_TXN_TYPES = new Set(["VARIANCE"]);
const CANCELLABLE_TXN_STATUSES = new Set(["DRAFT", "SUBMITTED"]);
const POSTABLE_TXN_STATUSES = new Set(["DRAFT", "SUBMITTED", "APPROVED"]);

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

  if (BANK_TXN_TYPES.has(payload.txnType) && !payload.counterAccountId) {
    throw badRequest(`${payload.txnType} requires counterAccountId`);
  }
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

  try {
    return await withTransaction(async (tx) => {
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
          counterpartyType: payload.counterpartyType,
          counterpartyId: payload.counterpartyId,
          counterAccountId: payload.counterAccountId,
          counterCashRegisterId: payload.counterCashRegisterId,
          reversalOfTransactionId: null,
          overrideCashControl: false,
          overrideReason: null,
          idempotencyKey: payload.idempotencyKey,
          userId: payload.userId,
          postedByUserId: null,
          postedAt: null,
        },
        runQuery: tx.query,
      });

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
          counterpartyType: original.counterparty_type,
          counterpartyId: original.counterparty_id,
          counterAccountId: original.counter_account_id,
          counterCashRegisterId: original.counter_cash_register_id,
          reversalOfTransactionId: original.id,
          overrideCashControl: false,
          overrideReason: null,
          idempotencyKey: `REV-${original.id}`,
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
