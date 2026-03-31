import { query } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";
import {
  buildLocalClosePackScopeKey,
  resolveJournalLocalClosePackScope,
} from "./local.close-packs.shared.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function conflict(message, details = null, code = "") {
  const err = new Error(message);
  err.status = 409;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  if (code) {
    err.code = code;
  }
  return err;
}

async function loadPendingReopenRequestRow({
  tenantId,
  packId,
  runQuery = query,
}) {
  try {
    const result = await runQuery(
      `SELECT id, request_status
       FROM local_close_pack_reopen_requests
       WHERE tenant_id = ?
         AND local_close_pack_id = ?
         AND request_status = 'REQUESTED'
       ORDER BY id DESC
       LIMIT 1`,
      [tenantId, packId]
    );
    return result.rows?.[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) {
      return null;
    }
    throw err;
  }
}

function buildLocalClosePackReopenHint({
  packRow,
  actionType,
  pendingRequestRow = null,
}) {
  const packId = parsePositiveInt(packRow?.id);
  const normalizedActionType = toUpperText(actionType);
  const suggestedActionType =
    normalizedActionType === "REVERSE_POSTED_JOURNAL"
      ? "REVERSAL_REQUIRED"
      : "LATE_POSTING_REQUIRED";

  return {
    localClosePackId: packId,
    localClosePackStatus: toUpperText(packRow?.status),
    reopenRequestEndpoint: packId
      ? `/api/v1/gl/local-close-packs/${packId}/reopen-requests`
      : null,
    suggestedActionType,
    requestedScope: {
      legalEntityId: parsePositiveInt(packRow?.legal_entity_id),
      bookId: parsePositiveInt(packRow?.book_id),
      fiscalPeriodId: parsePositiveInt(packRow?.fiscal_period_id),
      closeScopeType: toUpperText(packRow?.close_scope_type),
      operatingUnitId: parsePositiveInt(packRow?.operating_unit_id),
      scopeKey: String(packRow?.scope_key || ""),
    },
    pendingRequestId: parsePositiveInt(pendingRequestRow?.id),
    pendingRequestStatus: pendingRequestRow
      ? toUpperText(pendingRequestRow.request_status)
      : null,
  };
}

async function loadBlockingLocalClosePackRow({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  scopeKey,
  runQuery = query,
}) {
  try {
    const result = await runQuery(
      `SELECT *
       FROM local_close_packs
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND book_id = ?
         AND fiscal_period_id = ?
         AND scope_key = ?
         AND status IN ('APPROVED', 'LOCKED')
       LIMIT 1`,
      [tenantId, legalEntityId, bookId, fiscalPeriodId, scopeKey]
    );
    return result.rows?.[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) {
      return null;
    }
    throw err;
  }
}

async function loadJournalLineScopeRows({
  journalId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT operating_unit_id
     FROM journal_lines
     WHERE journal_entry_id = ?`,
    [journalId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

function normalizeScopeLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    operating_unit_id: parsePositiveInt(
      line?.operating_unit_id ?? line?.operatingUnitId ?? line?.operatingUnitID
    ),
  }));
}

async function findBlockingLocalClosePackByScope({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  actionType,
  resolvedJournalScope,
  runQuery = query,
}) {
  if (!resolvedJournalScope?.scopeKey) {
    return null;
  }

  const packRow = await loadBlockingLocalClosePackRow({
    tenantId,
    legalEntityId,
    bookId,
    fiscalPeriodId,
    scopeKey: String(resolvedJournalScope.scopeKey),
    runQuery,
  });
  if (!packRow) {
    return null;
  }

  const pendingRequestRow = await loadPendingReopenRequestRow({
    tenantId,
    packId: parsePositiveInt(packRow.id),
    runQuery,
  });

  return {
    packRow,
    actionType: toUpperText(actionType),
    reopenHint: buildLocalClosePackReopenHint({
      packRow,
      actionType,
      pendingRequestRow,
    }),
  };
}

/**
 * Resolve the blocking approved/locked local close pack, if any, for a journal
 * action against an existing journal entry.
 */
export async function findBlockingLocalClosePackForJournalAction({
  tenantId,
  journalId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  actionType,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedJournalId = parsePositiveInt(journalId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedBookId = parsePositiveInt(bookId);
  const normalizedFiscalPeriodId = parsePositiveInt(fiscalPeriodId);
  if (
    !normalizedTenantId ||
    !normalizedJournalId ||
    !normalizedLegalEntityId ||
    !normalizedBookId ||
    !normalizedFiscalPeriodId
  ) {
    return null;
  }

  const lineRows = await loadJournalLineScopeRows({
    journalId: normalizedJournalId,
    runQuery,
  });
  const resolvedJournalScope = resolveJournalLocalClosePackScope(lineRows);
  if (!resolvedJournalScope) {
    return null;
  }

  return findBlockingLocalClosePackByScope({
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedFiscalPeriodId,
    actionType,
    resolvedJournalScope,
    runQuery,
  });
}

/**
 * Resolve the blocking approved/locked local close pack, if any, for a direct
 * posting attempt before a journal header exists.
 */
export async function findBlockingLocalClosePackForPostingLines({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  lines,
  actionType,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedBookId = parsePositiveInt(bookId);
  const normalizedFiscalPeriodId = parsePositiveInt(fiscalPeriodId);
  if (
    !normalizedTenantId ||
    !normalizedLegalEntityId ||
    !normalizedBookId ||
    !normalizedFiscalPeriodId
  ) {
    return null;
  }

  const resolvedJournalScope = resolveJournalLocalClosePackScope(
    normalizeScopeLines(lines)
  );
  if (!resolvedJournalScope) {
    return null;
  }

  return findBlockingLocalClosePackByScope({
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedFiscalPeriodId,
    actionType,
    resolvedJournalScope,
    runQuery,
  });
}

/**
 * Block journal actions when an approved or locked local close pack already
 * controls the underlying journal scope.
 */
export async function assertLocalClosePackJournalActionAllowed({
  tenantId,
  journalId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  actionType,
  runQuery = query,
}) {
  const block = await findBlockingLocalClosePackForJournalAction({
    tenantId,
    journalId,
    legalEntityId,
    bookId,
    fiscalPeriodId,
    actionType,
    runQuery,
  });
  if (!block?.packRow) {
    return { allowed: true, blockedByPack: null };
  }

  throw conflict(
    `Local close pack is ${toUpperText(block.packRow.status)} for this journal scope; request governed reopen before ${String(
      actionType || ""
    )
      .trim()
      .toLowerCase()
      .replaceAll("_", " ")}`,
    {
      code: "LOCAL_CLOSE_PACK_REOPEN_REQUIRED",
      journalId: parsePositiveInt(journalId),
      blockedActionType: toUpperText(actionType),
      ...block.reopenHint,
    },
    "LOCAL_CLOSE_PACK_REOPEN_REQUIRED"
  );
}

/**
 * Block direct posting attempts when an approved or locked local close pack
 * already controls the target line scope.
 */
export async function assertLocalClosePackPostingAllowedForLines({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  lines,
  actionType,
  runQuery = query,
}) {
  const block = await findBlockingLocalClosePackForPostingLines({
    tenantId,
    legalEntityId,
    bookId,
    fiscalPeriodId,
    lines,
    actionType,
    runQuery,
  });
  if (!block?.packRow) {
    return { allowed: true, blockedByPack: null };
  }

  throw conflict(
    `Local close pack is ${toUpperText(block.packRow.status)} for this posting scope; request governed reopen before ${String(
      actionType || ""
    )
      .trim()
      .toLowerCase()
      .replaceAll("_", " ")}`,
    {
      code: "LOCAL_CLOSE_PACK_REOPEN_REQUIRED",
      blockedActionType: toUpperText(actionType),
      ...block.reopenHint,
    },
    "LOCAL_CLOSE_PACK_REOPEN_REQUIRED"
  );
}

export default {
  findBlockingLocalClosePackForJournalAction,
  findBlockingLocalClosePackForPostingLines,
  assertLocalClosePackJournalActionAllowed,
  assertLocalClosePackPostingAllowedForLines,
  buildLocalClosePackScopeKey,
};
