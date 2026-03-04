import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const AMOUNT_EPSILON = 0.000001;

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value) {
  return Number(toNumber(value).toFixed(6));
}

function amountsEqual(left, right, epsilon = AMOUNT_EPSILON) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}

function normalizePositiveAmount(value, label) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a numeric value greater than 0`);
  }
  return roundAmount(parsed);
}

function toOpenClosedStatus(remainingTxn, remainingBase) {
  const txn = Math.max(roundAmount(remainingTxn), 0);
  const base = Math.max(roundAmount(remainingBase), 0);
  if (txn <= AMOUNT_EPSILON || base <= AMOUNT_EPSILON) {
    return {
      remainingTxn: 0,
      remainingBase: 0,
      status: "CLOSED",
    };
  }
  return {
    remainingTxn: txn,
    remainingBase: base,
    status: "OPEN",
  };
}

async function loadBaseCurrencyCodeForLegalEntity({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT base_currency_code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const baseCurrencyCode = asUpper(result.rows?.[0]?.base_currency_code || null);
  if (!baseCurrencyCode || baseCurrencyCode.length !== 3) {
    throw badRequest("Book base currency is not configured for cash transaction legal entity");
  }
  return baseCurrencyCode;
}

async function loadCashTransactionForFxLots({
  tenantId,
  cashTransactionId,
  runQuery = query,
  forUpdate = false,
}) {
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
       ct.id,
       ct.tenant_id,
       ct.cash_register_id,
       ct.book_date,
       ct.txn_type,
       ct.status,
       ct.amount,
       ct.amount_base,
       ct.currency_code,
       ct.posted_journal_entry_id,
       ct.reversal_of_transaction_id,
       ct.source_module,
       ct.source_entity_type,
       ct.source_entity_id,
       cr.legal_entity_id,
       cr.account_id AS register_account_id
     FROM cash_transactions ct
     JOIN cash_registers cr
       ON cr.id = ct.cash_register_id
      AND cr.tenant_id = ct.tenant_id
     WHERE ct.tenant_id = ?
       AND ct.id = ?
     LIMIT 1
     ${lockClause}`,
    [tenantId, cashTransactionId]
  );
  return result.rows?.[0] || null;
}

async function countExistingMovementsForTransaction({
  tenantId,
  cashTransactionId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT COUNT(*) AS total
     FROM cash_fx_lot_movements
     WHERE tenant_id = ?
       AND cash_transaction_id = ?`,
    [tenantId, cashTransactionId]
  );
  return Number(result.rows?.[0]?.total || 0);
}

async function summarizeMovementsForTransaction({
  tenantId,
  cashTransactionId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       COUNT(*) AS movement_count,
       COALESCE(SUM(CASE WHEN movement_direction = 'IN' THEN movement_amount_txn ELSE 0 END), 0) AS total_in_txn,
       COALESCE(SUM(CASE WHEN movement_direction = 'OUT' THEN movement_amount_txn ELSE 0 END), 0) AS total_out_txn,
       COALESCE(SUM(movement_amount_base), 0) AS total_movement_base,
       COALESCE(SUM(carrying_amount_base), 0) AS total_carrying_base,
       COALESCE(SUM(realized_fx_base), 0) AS total_realized_fx_base
     FROM cash_fx_lot_movements
     WHERE tenant_id = ?
       AND cash_transaction_id = ?`,
    [tenantId, cashTransactionId]
  );
  const row = result.rows?.[0] || {};
  return {
    movementCount: Number(row.movement_count || 0),
    totalInTxn: roundAmount(row.total_in_txn),
    totalOutTxn: roundAmount(row.total_out_txn),
    totalMovementBase: roundAmount(row.total_movement_base),
    totalCarryingBase: roundAmount(row.total_carrying_base),
    realizedFxBase: roundAmount(row.total_realized_fx_base),
  };
}

export async function getCashFxLotMovementSummaryByTransaction({
  tenantId,
  cashTransactionId,
  runQuery = query,
}) {
  return summarizeMovementsForTransaction({
    tenantId,
    cashTransactionId,
    runQuery,
  });
}

async function loadSignedBaseEffectOnRegister({
  tenantId,
  journalEntryId,
  registerAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       COALESCE(SUM(COALESCE(debit_base, 0) - COALESCE(credit_base, 0)), 0) AS signed_base
     FROM journal_lines
     WHERE journal_entry_id = ?
       AND account_id = ?`,
    [journalEntryId, registerAccountId]
  );
  return roundAmount(result.rows?.[0]?.signed_base);
}

async function insertLot({
  payload,
  runQuery = query,
}) {
  const result = await runQuery(
    `INSERT INTO cash_fx_position_lots (
        tenant_id,
        legal_entity_id,
        cash_register_id,
        account_id,
        currency_code,
        opened_by_cash_transaction_id,
        open_book_date,
        original_amount_txn,
        original_amount_base,
        remaining_amount_txn,
        remaining_amount_base,
        unit_cost_base,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.cashRegisterId,
      payload.accountId,
      payload.currencyCode,
      payload.openedByCashTransactionId,
      payload.openBookDate,
      payload.originalAmountTxn,
      payload.originalAmountBase,
      payload.remainingAmountTxn,
      payload.remainingAmountBase,
      payload.unitCostBase,
      payload.status,
    ]
  );
  return parsePositiveInt(result.rows?.insertId);
}

async function insertMovement({
  payload,
  runQuery = query,
}) {
  await runQuery(
    `INSERT INTO cash_fx_lot_movements (
        tenant_id,
        legal_entity_id,
        cash_register_id,
        currency_code,
        cash_transaction_id,
        lot_id,
        line_no,
        movement_direction,
        movement_amount_txn,
        movement_amount_base,
        carrying_amount_base,
        realized_fx_base,
        posted_journal_entry_id,
        reversal_of_movement_id,
        source_module,
        source_entity_type,
        source_entity_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.cashRegisterId,
      payload.currencyCode,
      payload.cashTransactionId,
      payload.lotId,
      payload.lineNo,
      payload.movementDirection,
      payload.movementAmountTxn,
      payload.movementAmountBase,
      payload.carryingAmountBase,
      payload.realizedFxBase,
      payload.postedJournalEntryId,
      payload.reversalOfMovementId,
      payload.sourceModule,
      payload.sourceEntityType,
      payload.sourceEntityId,
    ]
  );
}

async function loadLotByIdForUpdate({
  tenantId,
  lotId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_position_lots
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, lotId]
  );
  return result.rows?.[0] || null;
}

async function updateLotRemaining({
  tenantId,
  lotId,
  remainingTxn,
  remainingBase,
  status,
  runQuery = query,
}) {
  await runQuery(
    `UPDATE cash_fx_position_lots
     SET
       remaining_amount_txn = ?,
       remaining_amount_base = ?,
       status = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [remainingTxn, remainingBase, status, tenantId, lotId]
  );
}

async function loadOpenLotsForConsumption({
  tenantId,
  cashRegisterId,
  currencyCode,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_position_lots
     WHERE tenant_id = ?
       AND cash_register_id = ?
       AND currency_code = ?
       AND status = 'OPEN'
       AND remaining_amount_txn > ?
     ORDER BY open_book_date ASC, id ASC
     FOR UPDATE`,
    [tenantId, cashRegisterId, currencyCode, AMOUNT_EPSILON]
  );
  return result.rows || [];
}

async function loadMovementsForTransactionForUpdate({
  tenantId,
  cashTransactionId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_lot_movements
     WHERE tenant_id = ?
       AND cash_transaction_id = ?
     ORDER BY line_no ASC
     FOR UPDATE`,
    [tenantId, cashTransactionId]
  );
  return result.rows || [];
}

async function applyInboundLotPosting({
  cashTxn,
  amountTxnAbs,
  amountBaseAbs,
  runQuery,
}) {
  const unitCost = Number((amountBaseAbs / amountTxnAbs).toFixed(10));
  const lotId = await insertLot({
    payload: {
      tenantId: parsePositiveInt(cashTxn.tenant_id),
      legalEntityId: parsePositiveInt(cashTxn.legal_entity_id),
      cashRegisterId: parsePositiveInt(cashTxn.cash_register_id),
      accountId: parsePositiveInt(cashTxn.register_account_id),
      currencyCode: asUpper(cashTxn.currency_code),
      openedByCashTransactionId: parsePositiveInt(cashTxn.id),
      openBookDate: cashTxn.book_date,
      originalAmountTxn: amountTxnAbs,
      originalAmountBase: amountBaseAbs,
      remainingAmountTxn: amountTxnAbs,
      remainingAmountBase: amountBaseAbs,
      unitCostBase: unitCost,
      status: "OPEN",
    },
    runQuery,
  });
  if (!lotId) {
    throw badRequest("Failed to create FX position lot");
  }

  await insertMovement({
    payload: {
      tenantId: parsePositiveInt(cashTxn.tenant_id),
      legalEntityId: parsePositiveInt(cashTxn.legal_entity_id),
      cashRegisterId: parsePositiveInt(cashTxn.cash_register_id),
      currencyCode: asUpper(cashTxn.currency_code),
      cashTransactionId: parsePositiveInt(cashTxn.id),
      lotId,
      lineNo: 1,
      movementDirection: "IN",
      movementAmountTxn: amountTxnAbs,
      movementAmountBase: amountBaseAbs,
      carryingAmountBase: amountBaseAbs,
      realizedFxBase: 0,
      postedJournalEntryId: parsePositiveInt(cashTxn.posted_journal_entry_id) || null,
      reversalOfMovementId: null,
      sourceModule: cashTxn.source_module || null,
      sourceEntityType: cashTxn.source_entity_type || null,
      sourceEntityId: cashTxn.source_entity_id || null,
    },
    runQuery,
  });
}

async function applyOutboundLotPosting({
  cashTxn,
  amountTxnAbs,
  amountBaseAbs,
  runQuery,
}) {
  const openLots = await loadOpenLotsForConsumption({
    tenantId: parsePositiveInt(cashTxn.tenant_id),
    cashRegisterId: parsePositiveInt(cashTxn.cash_register_id),
    currencyCode: asUpper(cashTxn.currency_code),
    runQuery,
  });

  let availableTxn = 0;
  for (const lot of openLots) {
    availableTxn += toNumber(lot.remaining_amount_txn);
  }
  availableTxn = roundAmount(availableTxn);
  if (availableTxn + AMOUNT_EPSILON < amountTxnAbs) {
    // Compatibility fallback: legacy posted balances before EXF01 may not have
    // lot rows yet. Bootstrap a synthetic carry lot for the uncovered quantity
    // so existing posting flows stay non-breaking while keeping lots non-negative.
    const deficitTxn = roundAmount(amountTxnAbs - availableTxn);
    const deficitBase = roundAmount((amountBaseAbs * deficitTxn) / amountTxnAbs);
    const unitCostBase = Number((deficitBase / deficitTxn).toFixed(10));
    const bootstrapLotId = await insertLot({
      payload: {
        tenantId: parsePositiveInt(cashTxn.tenant_id),
        legalEntityId: parsePositiveInt(cashTxn.legal_entity_id),
        cashRegisterId: parsePositiveInt(cashTxn.cash_register_id),
        accountId: parsePositiveInt(cashTxn.register_account_id),
        currencyCode: asUpper(cashTxn.currency_code),
        openedByCashTransactionId: parsePositiveInt(cashTxn.id),
        openBookDate: cashTxn.book_date,
        originalAmountTxn: deficitTxn,
        originalAmountBase: deficitBase,
        remainingAmountTxn: deficitTxn,
        remainingAmountBase: deficitBase,
        unitCostBase,
        status: "OPEN",
      },
      runQuery,
    });
    if (!bootstrapLotId) {
      throw badRequest("Failed to bootstrap compatibility FX lot for disposal");
    }
    openLots.push({
      id: bootstrapLotId,
      tenant_id: parsePositiveInt(cashTxn.tenant_id),
      legal_entity_id: parsePositiveInt(cashTxn.legal_entity_id),
      cash_register_id: parsePositiveInt(cashTxn.cash_register_id),
      account_id: parsePositiveInt(cashTxn.register_account_id),
      currency_code: asUpper(cashTxn.currency_code),
      open_book_date: cashTxn.book_date,
      remaining_amount_txn: deficitTxn,
      remaining_amount_base: deficitBase,
      status: "OPEN",
    });
  }

  let remainingTxnToConsume = amountTxnAbs;
  let remainingTxnBaseToAllocate = amountBaseAbs;
  let lineNo = 1;

  for (const lot of openLots) {
    if (remainingTxnToConsume <= AMOUNT_EPSILON) {
      break;
    }

    const lotId = parsePositiveInt(lot.id);
    const lotRemainingTxn = normalizePositiveAmount(
      lot.remaining_amount_txn,
      "lot.remainingAmountTxn"
    );
    const lotRemainingBase = normalizePositiveAmount(
      lot.remaining_amount_base,
      "lot.remainingAmountBase"
    );
    const consumeTxn = roundAmount(Math.min(lotRemainingTxn, remainingTxnToConsume));
    if (consumeTxn <= AMOUNT_EPSILON) {
      continue;
    }

    const isLastMovement = remainingTxnToConsume - consumeTxn <= AMOUNT_EPSILON;
    const movementAmountBase = isLastMovement
      ? roundAmount(remainingTxnBaseToAllocate)
      : roundAmount((amountBaseAbs * consumeTxn) / amountTxnAbs);
    const carryingBase = amountsEqual(consumeTxn, lotRemainingTxn)
      ? lotRemainingBase
      : roundAmount((lotRemainingBase * consumeTxn) / lotRemainingTxn);
    const realizedFxBase = roundAmount(movementAmountBase - carryingBase);

    const nextLot = toOpenClosedStatus(
      roundAmount(lotRemainingTxn - consumeTxn),
      roundAmount(lotRemainingBase - carryingBase)
    );
    await updateLotRemaining({
      tenantId: parsePositiveInt(cashTxn.tenant_id),
      lotId,
      remainingTxn: nextLot.remainingTxn,
      remainingBase: nextLot.remainingBase,
      status: nextLot.status,
      runQuery,
    });

    await insertMovement({
      payload: {
        tenantId: parsePositiveInt(cashTxn.tenant_id),
        legalEntityId: parsePositiveInt(cashTxn.legal_entity_id),
        cashRegisterId: parsePositiveInt(cashTxn.cash_register_id),
        currencyCode: asUpper(cashTxn.currency_code),
        cashTransactionId: parsePositiveInt(cashTxn.id),
        lotId,
        lineNo,
        movementDirection: "OUT",
        movementAmountTxn: consumeTxn,
        movementAmountBase,
        carryingAmountBase: carryingBase,
        realizedFxBase,
        postedJournalEntryId: parsePositiveInt(cashTxn.posted_journal_entry_id) || null,
        reversalOfMovementId: null,
        sourceModule: cashTxn.source_module || null,
        sourceEntityType: cashTxn.source_entity_type || null,
        sourceEntityId: cashTxn.source_entity_id || null,
      },
      runQuery,
    });

    lineNo += 1;
    remainingTxnToConsume = roundAmount(remainingTxnToConsume - consumeTxn);
    remainingTxnBaseToAllocate = roundAmount(remainingTxnBaseToAllocate - movementAmountBase);
  }

  if (remainingTxnToConsume > AMOUNT_EPSILON) {
    throw badRequest(
      `Failed to fully consume FX lots for disposal. residualTxn=${remainingTxnToConsume}`
    );
  }
}

async function applyReversalLotPosting({
  cashTxn,
  originalCashTransactionId,
  runQuery,
}) {
  const originalMovements = await loadMovementsForTransactionForUpdate({
    tenantId: parsePositiveInt(cashTxn.tenant_id),
    cashTransactionId: originalCashTransactionId,
    runQuery,
  });

  if (originalMovements.length === 0) {
    return;
  }

  let lineNo = 1;
  for (const originalMovement of originalMovements) {
    const lotId = parsePositiveInt(originalMovement.lot_id);
    if (!lotId) {
      throw badRequest("Invalid lot_id on original movement");
    }
    const lot = await loadLotByIdForUpdate({
      tenantId: parsePositiveInt(cashTxn.tenant_id),
      lotId,
      runQuery,
    });
    if (!lot) {
      throw badRequest(`Lot not found for reversal (lotId=${lotId})`);
    }

    const movementTxn = normalizePositiveAmount(
      originalMovement.movement_amount_txn,
      "originalMovement.movementAmountTxn"
    );
    const movementBase = normalizePositiveAmount(
      originalMovement.movement_amount_base,
      "originalMovement.movementAmountBase"
    );
    const carryingBase = normalizePositiveAmount(
      originalMovement.carrying_amount_base,
      "originalMovement.carryingAmountBase"
    );
    const originalDirection = asUpper(originalMovement.movement_direction);
    const reversalDirection = originalDirection === "IN" ? "OUT" : "IN";
    const realizedFxBase = roundAmount(0 - toNumber(originalMovement.realized_fx_base));

    const lotRemainingTxn = toNumber(lot.remaining_amount_txn);
    const lotRemainingBase = toNumber(lot.remaining_amount_base);
    let nextLotTxn;
    let nextLotBase;
    if (reversalDirection === "OUT") {
      if (lotRemainingTxn + AMOUNT_EPSILON < movementTxn) {
        throw badRequest(
          `Cannot reverse lot inflow because lot quantity is already consumed (lotId=${lotId})`
        );
      }
      if (lotRemainingBase + AMOUNT_EPSILON < carryingBase) {
        throw badRequest(
          `Cannot reverse lot inflow because lot base carrying is already consumed (lotId=${lotId})`
        );
      }
      nextLotTxn = lotRemainingTxn - movementTxn;
      nextLotBase = lotRemainingBase - carryingBase;
    } else {
      nextLotTxn = lotRemainingTxn + movementTxn;
      nextLotBase = lotRemainingBase + carryingBase;
    }

    const normalizedLot = toOpenClosedStatus(nextLotTxn, nextLotBase);
    await updateLotRemaining({
      tenantId: parsePositiveInt(cashTxn.tenant_id),
      lotId,
      remainingTxn: normalizedLot.remainingTxn,
      remainingBase: normalizedLot.remainingBase,
      status: normalizedLot.status,
      runQuery,
    });

    await insertMovement({
      payload: {
        tenantId: parsePositiveInt(cashTxn.tenant_id),
        legalEntityId: parsePositiveInt(cashTxn.legal_entity_id),
        cashRegisterId: parsePositiveInt(cashTxn.cash_register_id),
        currencyCode: asUpper(cashTxn.currency_code),
        cashTransactionId: parsePositiveInt(cashTxn.id),
        lotId,
        lineNo,
        movementDirection: reversalDirection,
        movementAmountTxn: movementTxn,
        movementAmountBase: movementBase,
        carryingAmountBase: carryingBase,
        realizedFxBase,
        postedJournalEntryId: parsePositiveInt(cashTxn.posted_journal_entry_id) || null,
        reversalOfMovementId: parsePositiveInt(originalMovement.id) || null,
        sourceModule: cashTxn.source_module || null,
        sourceEntityType: cashTxn.source_entity_type || null,
        sourceEntityId: cashTxn.source_entity_id || null,
      },
      runQuery,
    });

    lineNo += 1;
  }
}

export async function applyCashFxPositionForPostedTransactionTx({
  tenantId,
  cashTransactionId,
  cashTransactionRow = null,
  runQuery = query,
}) {
  const cashTxn =
    cashTransactionRow ||
    (await loadCashTransactionForFxLots({
      tenantId,
      cashTransactionId,
      runQuery,
      forUpdate: true,
    }));
  if (!cashTxn) {
    throw badRequest("Cash transaction not found");
  }

  if (asUpper(cashTxn.status) !== "POSTED") {
    throw badRequest("Cash FX lot processing requires POSTED cash transaction");
  }

  const baseCurrencyCode = await loadBaseCurrencyCodeForLegalEntity({
    tenantId: parsePositiveInt(cashTxn.tenant_id),
    legalEntityId: parsePositiveInt(cashTxn.legal_entity_id),
    runQuery,
  });
  const currencyCode = asUpper(cashTxn.currency_code);
  if (!currencyCode || currencyCode === baseCurrencyCode) {
    return {
      applied: false,
      skippedReason: "BASE_CURRENCY_OR_INVALID",
      idempotentReplay: true,
      summary: {
        movementCount: 0,
        totalInTxn: 0,
        totalOutTxn: 0,
        totalMovementBase: 0,
        totalCarryingBase: 0,
        realizedFxBase: 0,
      },
    };
  }

  const existingMovementCount = await countExistingMovementsForTransaction({
    tenantId: parsePositiveInt(cashTxn.tenant_id),
    cashTransactionId: parsePositiveInt(cashTxn.id),
    runQuery,
  });
  if (existingMovementCount > 0) {
    return {
      applied: true,
      skippedReason: null,
      idempotentReplay: true,
      summary: await summarizeMovementsForTransaction({
        tenantId: parsePositiveInt(cashTxn.tenant_id),
        cashTransactionId: parsePositiveInt(cashTxn.id),
        runQuery,
      }),
    };
  }

  const postedJournalEntryId = parsePositiveInt(cashTxn.posted_journal_entry_id);
  if (!postedJournalEntryId) {
    throw badRequest("Cash FX lot processing requires posted_journal_entry_id");
  }
  const registerAccountId = parsePositiveInt(cashTxn.register_account_id);
  if (!registerAccountId) {
    throw badRequest("Cash FX lot processing requires register account id");
  }

  const reversalOfTransactionId = parsePositiveInt(cashTxn.reversal_of_transaction_id);
  if (reversalOfTransactionId) {
    await applyReversalLotPosting({
      cashTxn,
      originalCashTransactionId: reversalOfTransactionId,
      runQuery,
    });
    return {
      applied: true,
      skippedReason: null,
      idempotentReplay: false,
      summary: await summarizeMovementsForTransaction({
        tenantId: parsePositiveInt(cashTxn.tenant_id),
        cashTransactionId: parsePositiveInt(cashTxn.id),
        runQuery,
      }),
    };
  }

  const signedBaseEffect = await loadSignedBaseEffectOnRegister({
    tenantId: parsePositiveInt(cashTxn.tenant_id),
    journalEntryId: postedJournalEntryId,
    registerAccountId,
    runQuery,
  });
  if (Math.abs(signedBaseEffect) <= AMOUNT_EPSILON) {
    return {
      applied: false,
      skippedReason: "NO_REGISTER_BASE_EFFECT",
      idempotentReplay: true,
      summary: {
        movementCount: 0,
        totalInTxn: 0,
        totalOutTxn: 0,
        totalMovementBase: 0,
        totalCarryingBase: 0,
        realizedFxBase: 0,
      },
    };
  }

  const amountTxnAbs = normalizePositiveAmount(cashTxn.amount, "cashTransaction.amount");
  const amountBaseAbs = normalizePositiveAmount(
    cashTxn.amount_base === null || cashTxn.amount_base === undefined
      ? cashTxn.amount
      : cashTxn.amount_base,
    "cashTransaction.amountBase"
  );

  if (signedBaseEffect > 0) {
    await applyInboundLotPosting({
      cashTxn,
      amountTxnAbs,
      amountBaseAbs,
      runQuery,
    });
  } else {
    await applyOutboundLotPosting({
      cashTxn,
      amountTxnAbs,
      amountBaseAbs,
      runQuery,
    });
  }

  return {
    applied: true,
    skippedReason: null,
    idempotentReplay: false,
    summary: await summarizeMovementsForTransaction({
      tenantId: parsePositiveInt(cashTxn.tenant_id),
      cashTransactionId: parsePositiveInt(cashTxn.id),
      runQuery,
    }),
  };
}

export default {
  applyCashFxPositionForPostedTransactionTx,
  getCashFxLotMovementSummaryByTransaction,
};
