import { query, withTransaction } from "../db.js";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import {
  assertBookBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { reverseJournalEntryTx } from "../services/gl.journal-reversal.service.js";

const CASH_CONTROL_MODES = new Set(["OFF", "WARN", "ENFORCE"]);
const JOURNAL_REVERSE_SOURCE_DESTINATIONS = Object.freeze({
  CARI_DOCUMENT: "/app/cari-belgeler",
  CARI_SETTLEMENT_BATCH: "/app/cari-settlements",
  CASH_TRANSACTION: "/app/kasa-islemleri",
  PAYMENT_BATCH: "/app/odeme-batchleri",
  PAYROLL_RUN: "/app/payroll-runs",
});
const JOURNAL_REVERSE_BLOCK_SOURCE_TYPES = new Set(
  Object.keys(JOURNAL_REVERSE_SOURCE_DESTINATIONS)
);

function normalizeCashControlMode(value) {
  const normalized = String(value || "ENFORCE").trim().toUpperCase();
  if (CASH_CONTROL_MODES.has(normalized)) {
    return normalized;
  }
  return "ENFORCE";
}

function collectLineAccountIds(lines) {
  const ids = new Set();
  for (const line of lines || []) {
    const accountId = parsePositiveInt(line?.accountId);
    if (accountId) {
      ids.add(accountId);
    }
  }
  return Array.from(ids);
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function loadJournalSourceLinksForJournalId({
  tenantId,
  journalId,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedJournalId = parsePositiveInt(journalId);
  if (!parsedTenantId || !parsedJournalId) {
    return [];
  }

  const result = await runQuery(
    `SELECT source_ref_type, source_ref_id
     FROM journal_source_links
     WHERE tenant_id = ?
       AND journal_entry_id = ?
     ORDER BY id ASC`,
    [parsedTenantId, parsedJournalId]
  );

  return Array.isArray(result.rows) ? result.rows : [];
}

function buildSubledgerReverseBlockedMessage(links = []) {
  const normalizedLinks = (Array.isArray(links) ? links : [])
    .map((row) => ({
      sourceRefType: normalizeUpperText(row?.source_ref_type || row?.sourceRefType),
      sourceRefId: parsePositiveInt(row?.source_ref_id || row?.sourceRefId),
    }))
    .filter(
      (row) =>
        row.sourceRefType &&
        row.sourceRefId &&
        JOURNAL_REVERSE_BLOCK_SOURCE_TYPES.has(row.sourceRefType)
    );

  if (normalizedLinks.length === 0) {
    return "Journal is linked to a source module. Reverse from source module.";
  }

  const linkTokens = normalizedLinks.map(
    (row) => `${row.sourceRefType}:${row.sourceRefId}`
  );
  const routeHints = Array.from(
    new Set(
      normalizedLinks
        .map((row) => JOURNAL_REVERSE_SOURCE_DESTINATIONS[row.sourceRefType] || null)
        .filter(Boolean)
    )
  );

  const routeHintText =
    routeHints.length > 0
      ? ` Open from: ${routeHints.join(", ")}.`
      : "";
  return `Journal is linked to subledger record(s) [${linkTokens.join(", ")}]. Reverse from source module instead of GL journal reverse.${routeHintText}`;
}

async function loadCashControlledAccounts({
  tenantId,
  accountIds,
  runQuery = query,
}) {
  const uniqueAccountIds = Array.from(
    new Set((Array.isArray(accountIds) ? accountIds : []).map((id) => parsePositiveInt(id)).filter(Boolean))
  );
  if (uniqueAccountIds.length === 0) {
    return [];
  }

  const placeholders = uniqueAccountIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT a.id, a.code, a.name
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND a.id IN (${placeholders})
       AND a.is_cash_controlled = TRUE`,
    [tenantId, ...uniqueAccountIds]
  );

  return Array.isArray(result.rows) ? result.rows : [];
}

async function loadJournalLineAccountIds({
  journalId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT account_id
     FROM journal_lines
     WHERE journal_entry_id = ?`,
    [journalId]
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return Array.from(
    new Set(rows.map((row) => parsePositiveInt(row.account_id)).filter(Boolean))
  );
}

function buildCashControlledAccountsSummary(controlledAccounts) {
  return controlledAccounts
    .map((row) => {
      const code = String(row?.code || "").trim();
      if (code) {
        return code;
      }
      const id = parsePositiveInt(row?.id);
      return id ? `#${id}` : "UNKNOWN";
    })
    .join(", ");
}

function evaluateCashControlDecision({
  mode,
  sourceType,
  controlledAccounts,
  overrideCashControl,
  overrideReason,
}) {
  const normalizedMode = normalizeCashControlMode(mode);
  const normalizedSourceType = String(sourceType || "MANUAL").trim().toUpperCase();
  const matchedAccounts = Array.isArray(controlledAccounts) ? controlledAccounts : [];
  if (matchedAccounts.length === 0) {
    return {
      blocked: false,
      auditAction: null,
      requiresOverridePermission: false,
      controlledAccounts: [],
      mode: normalizedMode,
    };
  }

  if (normalizedSourceType === "CASH" || normalizedMode === "OFF") {
    return {
      blocked: false,
      auditAction: null,
      requiresOverridePermission: false,
      controlledAccounts: matchedAccounts,
      mode: normalizedMode,
    };
  }

  if (normalizedMode === "WARN") {
    return {
      blocked: false,
      auditAction: "WARN",
      requiresOverridePermission: false,
      controlledAccounts: matchedAccounts,
      mode: normalizedMode,
    };
  }

  const accountSummary = buildCashControlledAccountsSummary(matchedAccounts);
  if (!overrideCashControl) {
    return {
      blocked: true,
      message: `Direct GL posting to cash-controlled account(s) [${accountSummary}] is blocked. Use sourceType=CASH via cash transactions, or provide overrideCashControl=true with overrideReason.`,
      auditAction: null,
      requiresOverridePermission: false,
      controlledAccounts: matchedAccounts,
      mode: normalizedMode,
    };
  }

  if (!overrideReason) {
    return {
      blocked: true,
      message:
        "overrideReason is required when overriding cash-controlled account posting",
      auditAction: null,
      requiresOverridePermission: false,
      controlledAccounts: matchedAccounts,
      mode: normalizedMode,
    };
  }

  return {
    blocked: false,
    auditAction: "OVERRIDE",
    requiresOverridePermission: true,
    controlledAccounts: matchedAccounts,
    mode: normalizedMode,
  };
}

function resolveClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)[0];
  return forwardedIp || req.ip || req.socket?.remoteAddress || null;
}

async function writeCashControlAuditLog({
  runQuery,
  req,
  tenantId,
  userId,
  legalEntityId,
  journalId,
  actionType,
  sourceType,
  mode,
  overrideReason,
  controlledAccounts,
  stage,
}) {
  if (!runQuery || typeof runQuery !== "function") {
    return;
  }
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedTenantId || !actionType) {
    return;
  }

  const parsedUserId = parsePositiveInt(userId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const parsedJournalId = parsePositiveInt(journalId);
  const accountDetails = (Array.isArray(controlledAccounts) ? controlledAccounts : []).map(
    (row) => ({
      id: parsePositiveInt(row?.id) || null,
      code: row?.code ? String(row.code) : null,
      name: row?.name ? String(row.name) : null,
    })
  );

  await runQuery(
    `INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        resource_type,
        resource_id,
        scope_type,
        scope_id,
        request_id,
        ip_address,
        user_agent,
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsedTenantId,
      parsedUserId || null,
      actionType === "OVERRIDE" ? "gl.cash_control.override" : "gl.cash_control.warn",
      "journal_entry",
      parsedJournalId ? String(parsedJournalId) : null,
      parsedLegalEntityId ? "LEGAL_ENTITY" : null,
      parsedLegalEntityId || null,
      req.headers["x-request-id"] ? String(req.headers["x-request-id"]) : null,
      resolveClientIp(req),
      req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 255) : null,
      JSON.stringify({
        stage: stage || null,
        mode: normalizeCashControlMode(mode),
        sourceType: String(sourceType || "").toUpperCase(),
        overrideReason: overrideReason || null,
        controlledAccounts: accountDetails,
      }),
    ]
  );
}

async function runPermissionMiddleware(middleware, req, res) {
  await new Promise((resolve, reject) => {
    middleware(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function registerGlWriteJournalRoutes(router, deps = {}) {
  const {
    applyShareholderCommitmentSyncForPostedJournalTx,
    buildIntercompanyAutoMirrorDraftSpecs,
    ensurePeriodOpen,
    generateJournalNo,
    insertDraftJournalEntry,
    loadCentralEquityJournalValidationContext,
    loadIntercompanyJournalCluster,
    loadJournal,
    normalizeJournalSourceType,
    normalizeOptionalShortText,
    parseBooleanFlag,
    resolveScopeFromJournalId,
    toAmount,
    toIsoDate,
    validateIntercompanyJournalPolicy,
    validateJournalLineScope,
  } = deps;

  if (typeof applyShareholderCommitmentSyncForPostedJournalTx !== "function") {
    throw new Error(
      "registerGlWriteJournalRoutes requires applyShareholderCommitmentSyncForPostedJournalTx"
    );
  }
  if (typeof buildIntercompanyAutoMirrorDraftSpecs !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires buildIntercompanyAutoMirrorDraftSpecs");
  }
  if (typeof ensurePeriodOpen !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires ensurePeriodOpen");
  }
  if (typeof generateJournalNo !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires generateJournalNo");
  }
  if (typeof insertDraftJournalEntry !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires insertDraftJournalEntry");
  }
  if (typeof loadCentralEquityJournalValidationContext !== "function") {
    throw new Error(
      "registerGlWriteJournalRoutes requires loadCentralEquityJournalValidationContext"
    );
  }
  if (typeof loadIntercompanyJournalCluster !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires loadIntercompanyJournalCluster");
  }
  if (typeof loadJournal !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires loadJournal");
  }
  if (typeof normalizeJournalSourceType !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires normalizeJournalSourceType");
  }
  if (typeof normalizeOptionalShortText !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires normalizeOptionalShortText");
  }
  if (typeof parseBooleanFlag !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires parseBooleanFlag");
  }
  if (typeof resolveScopeFromJournalId !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires resolveScopeFromJournalId");
  }
  if (typeof toAmount !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires toAmount");
  }
  if (typeof toIsoDate !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires toIsoDate");
  }
  if (typeof validateIntercompanyJournalPolicy !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires validateIntercompanyJournalPolicy");
  }
  if (typeof validateJournalLineScope !== "function") {
    throw new Error("registerGlWriteJournalRoutes requires validateJournalLineScope");
  }

  const cashControlMode = normalizeCashControlMode(process.env.GL_CASH_CONTROL_MODE);
  const requireCashControlOverrideOnCreate = requirePermission("cash.override.post", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      return legalEntityId
        ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
        : { scopeType: "TENANT", scopeId: tenantId };
    },
  });
  const requireCashControlOverrideOnPost = requirePermission("cash.override.post", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromJournalId(req.params?.journalId, tenantId);
    },
  });

  router.post(
    "/journals",
    requirePermission("gl.journal.create", {
      resolveScope: (req, tenantId) => {
        const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
        return legalEntityId
          ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
          : { scopeType: "TENANT", scopeId: tenantId };
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) throw badRequest("tenantId is required");

      assertRequiredFields(req.body, [
        "legalEntityId",
        "bookId",
        "fiscalPeriodId",
        "entryDate",
        "documentDate",
        "currencyCode",
        "lines",
      ]);

      const legalEntityId = parsePositiveInt(req.body.legalEntityId);
      const bookId = parsePositiveInt(req.body.bookId);
      const fiscalPeriodId = parsePositiveInt(req.body.fiscalPeriodId);
      const sourceType = normalizeJournalSourceType(req.body.sourceType);
      const autoMirror = parseBooleanFlag(req.body?.autoMirror, false, "autoMirror");
      const overrideCashControl = parseBooleanFlag(
        req.body?.overrideCashControl,
        false,
        "overrideCashControl"
      );
      const overrideReason = normalizeOptionalShortText(
        req.body?.overrideReason,
        "overrideReason",
        500
      );
      const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
      if (sourceType === "CASH") {
        throw badRequest("sourceType=CASH is reserved; use /api/v1/cash/transactions/:transactionId/post");
      }
      if (!overrideCashControl && overrideReason) {
        throw badRequest("overrideReason requires overrideCashControl=true");
      }
      if (!legalEntityId || !bookId || !fiscalPeriodId) {
        throw badRequest("legalEntityId, bookId and fiscalPeriodId must be positive integers");
      }
      if (lines.length < 2) {
        throw badRequest("At least 2 journal lines are required");
      }
      if (autoMirror && sourceType !== "INTERCOMPANY") {
        throw badRequest("autoMirror is only supported for INTERCOMPANY source journals");
      }

      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

      const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
      if (parsePositiveInt(book.legal_entity_id) !== legalEntityId) {
        throw badRequest("Book does not belong to legalEntityId");
      }

      await assertFiscalPeriodBelongsToCalendar(
        parsePositiveInt(book.calendar_id),
        fiscalPeriodId,
        "fiscalPeriodId"
      );

      await ensurePeriodOpen(bookId, fiscalPeriodId, "create draft journal");

      const centralEquityPolicy = await loadCentralEquityJournalValidationContext({
        tenantId,
        legalEntityId,
      });
      let totalDebit = 0;
      let totalCredit = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        totalDebit += toAmount(line.debitBase);
        totalCredit += toAmount(line.creditBase);
        await validateJournalLineScope(req, tenantId, legalEntityId, line, i, {
          centralEquityPolicy,
        });
      }

      const controlledAccounts = await loadCashControlledAccounts({
        tenantId,
        accountIds: collectLineAccountIds(lines),
      });
      const cashControlDecision = evaluateCashControlDecision({
        mode: cashControlMode,
        sourceType,
        controlledAccounts,
        overrideCashControl,
        overrideReason,
      });
      if (cashControlDecision.blocked) {
        throw badRequest(cashControlDecision.message);
      }
      if (cashControlDecision.requiresOverridePermission) {
        await runPermissionMiddleware(requireCashControlOverrideOnCreate, req, res);
      }

      await validateIntercompanyJournalPolicy(tenantId, legalEntityId, sourceType, lines);

      if (Math.abs(totalDebit - totalCredit) > 0.0001) {
        throw badRequest("Journal is not balanced");
      }

      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) throw badRequest("Authenticated user is required");

      const journalNo = req.body.journalNo || generateJournalNo();
      const entryDate = toIsoDate(req.body.entryDate, "entryDate");
      const documentDate = toIsoDate(req.body.documentDate, "documentDate");
      const description = req.body.description ? String(req.body.description) : null;
      const referenceNo = req.body.referenceNo ? String(req.body.referenceNo) : null;
      const currencyCode = String(req.body.currencyCode).toUpperCase();

      const mirrorDraftSpecs = autoMirror
        ? await buildIntercompanyAutoMirrorDraftSpecs({
            req,
            tenantId,
            sourceLegalEntityId: legalEntityId,
            sourceFiscalPeriodId: fiscalPeriodId,
            sourceJournalNo: journalNo,
            sourceEntryDate: entryDate,
            sourceDocumentDate: documentDate,
            sourceCurrencyCode: currencyCode,
            sourceReferenceNo: referenceNo,
            sourceDescription: description,
            sourceLines: lines,
          })
        : [];

      const { journalEntryId, mirrorJournalEntryIds } = await withTransaction(async (tx) => {
        await ensurePeriodOpen(bookId, fiscalPeriodId, "create draft journal", tx.query.bind(tx));

        const createdJournalEntryId = await insertDraftJournalEntry(tx, {
          tenantId,
          legalEntityId,
          bookId,
          fiscalPeriodId,
          journalNo,
          sourceType,
          entryDate,
          documentDate,
          currencyCode,
          description,
          referenceNo,
          totalDebit,
          totalCredit,
          userId,
          lines,
        });

        const createdMirrorIds = [];
        for (const mirrorSpec of mirrorDraftSpecs) {
          // eslint-disable-next-line no-await-in-loop
          await ensurePeriodOpen(
            parsePositiveInt(mirrorSpec.bookId),
            parsePositiveInt(mirrorSpec.fiscalPeriodId),
            `auto-create mirror draft journal for legalEntityId=${mirrorSpec.legalEntityId}`,
            tx.query.bind(tx)
          );

          // eslint-disable-next-line no-await-in-loop
          const mirrorJournalEntryId = await insertDraftJournalEntry(tx, {
            tenantId,
            legalEntityId: mirrorSpec.legalEntityId,
            bookId: mirrorSpec.bookId,
            fiscalPeriodId: mirrorSpec.fiscalPeriodId,
            journalNo: mirrorSpec.journalNo,
            sourceType: mirrorSpec.sourceType,
            entryDate: mirrorSpec.entryDate,
            documentDate: mirrorSpec.documentDate,
            currencyCode: mirrorSpec.currencyCode,
            description: mirrorSpec.description,
            referenceNo: mirrorSpec.referenceNo,
            totalDebit: mirrorSpec.totalDebit,
            totalCredit: mirrorSpec.totalCredit,
            userId,
            lines: mirrorSpec.lines,
            intercompanySourceJournalEntryId: createdJournalEntryId,
          });

          createdMirrorIds.push(mirrorJournalEntryId);
        }

        if (cashControlDecision.auditAction) {
          await writeCashControlAuditLog({
            runQuery: tx.query,
            req,
            tenantId,
            userId,
            legalEntityId,
            journalId: createdJournalEntryId,
            actionType: cashControlDecision.auditAction,
            sourceType,
            mode: cashControlDecision.mode,
            overrideReason,
            controlledAccounts: cashControlDecision.controlledAccounts,
            stage: "CREATE_DRAFT",
          });
        }

        return {
          journalEntryId: createdJournalEntryId,
          mirrorJournalEntryIds: createdMirrorIds,
        };
      });

      return res.status(201).json({
        ok: true,
        journalEntryId,
        journalNo,
        status: "DRAFT",
        totalDebit,
        totalCredit,
        autoMirrorApplied: autoMirror,
        mirrorJournalEntryIds,
      });
    })
  );

  router.put(
    "/journals/:journalId",
    requirePermission("gl.journal.update", {
      resolveScope: async (req, tenantId) => {
        const scope = await resolveScopeFromJournalId(req.params?.journalId, tenantId);
        if (scope) {
          return scope;
        }
        const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
        return legalEntityId
          ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
          : { scopeType: "TENANT", scopeId: tenantId };
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) throw badRequest("tenantId is required");

      const journalId = parsePositiveInt(req.params.journalId);
      if (!journalId) {
        throw badRequest("journalId must be a positive integer");
      }

      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) throw badRequest("Authenticated user is required");

      const existing = await loadJournal(tenantId, journalId);
      if (!existing) {
        throw badRequest("Journal not found");
      }
      if (String(existing.status).toUpperCase() !== "DRAFT") {
        throw badRequest("Only DRAFT journals can be updated");
      }

      assertRequiredFields(req.body, [
        "legalEntityId",
        "bookId",
        "fiscalPeriodId",
        "entryDate",
        "documentDate",
        "currencyCode",
        "lines",
      ]);

      const legalEntityId = parsePositiveInt(req.body.legalEntityId);
      const bookId = parsePositiveInt(req.body.bookId);
      const fiscalPeriodId = parsePositiveInt(req.body.fiscalPeriodId);
      const sourceType =
        req.body?.sourceType === undefined || req.body?.sourceType === null || req.body?.sourceType === ""
          ? String(existing.source_type || "MANUAL").toUpperCase()
          : normalizeJournalSourceType(req.body.sourceType);
      const overrideCashControl = parseBooleanFlag(
        req.body?.overrideCashControl,
        false,
        "overrideCashControl"
      );
      const overrideReason = normalizeOptionalShortText(
        req.body?.overrideReason,
        "overrideReason",
        500
      );
      const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
      if (sourceType === "CASH") {
        throw badRequest("sourceType=CASH is reserved; use /api/v1/cash/transactions/:transactionId/post");
      }
      if (!overrideCashControl && overrideReason) {
        throw badRequest("overrideReason requires overrideCashControl=true");
      }
      if (!legalEntityId || !bookId || !fiscalPeriodId) {
        throw badRequest("legalEntityId, bookId and fiscalPeriodId must be positive integers");
      }
      if (lines.length < 2) {
        throw badRequest("At least 2 journal lines are required");
      }

      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

      const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
      if (parsePositiveInt(book.legal_entity_id) !== legalEntityId) {
        throw badRequest("Book does not belong to legalEntityId");
      }

      await assertFiscalPeriodBelongsToCalendar(
        parsePositiveInt(book.calendar_id),
        fiscalPeriodId,
        "fiscalPeriodId"
      );

      await ensurePeriodOpen(bookId, fiscalPeriodId, "update draft journal");

      const centralEquityPolicy = await loadCentralEquityJournalValidationContext({
        tenantId,
        legalEntityId,
      });
      let totalDebit = 0;
      let totalCredit = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        totalDebit += toAmount(line.debitBase);
        totalCredit += toAmount(line.creditBase);
        // eslint-disable-next-line no-await-in-loop
        await validateJournalLineScope(req, tenantId, legalEntityId, line, i, {
          centralEquityPolicy,
        });
      }

      const controlledAccounts = await loadCashControlledAccounts({
        tenantId,
        accountIds: collectLineAccountIds(lines),
      });
      const cashControlDecision = evaluateCashControlDecision({
        mode: cashControlMode,
        sourceType,
        controlledAccounts,
        overrideCashControl,
        overrideReason,
      });
      if (cashControlDecision.blocked) {
        throw badRequest(cashControlDecision.message);
      }
      if (cashControlDecision.requiresOverridePermission) {
        await runPermissionMiddleware(requireCashControlOverrideOnCreate, req, res);
      }

      await validateIntercompanyJournalPolicy(tenantId, legalEntityId, sourceType, lines);

      if (Math.abs(totalDebit - totalCredit) > 0.0001) {
        throw badRequest("Journal is not balanced");
      }

      const journalNo = req.body.journalNo
        ? String(req.body.journalNo)
        : String(existing.journal_no || generateJournalNo());
      const entryDate = toIsoDate(req.body.entryDate, "entryDate");
      const documentDate = toIsoDate(req.body.documentDate, "documentDate");
      const description = req.body.description ? String(req.body.description) : null;
      const referenceNo = req.body.referenceNo ? String(req.body.referenceNo) : null;
      const currencyCode = String(req.body.currencyCode).toUpperCase();

      const result = await withTransaction(async (tx) => {
        await ensurePeriodOpen(
          bookId,
          fiscalPeriodId,
          "update draft journal",
          tx.query.bind(tx)
        );

        const updateResult = await tx.query(
          `UPDATE journal_entries
           SET legal_entity_id = ?,
               book_id = ?,
               fiscal_period_id = ?,
               journal_no = ?,
               source_type = ?,
               entry_date = ?,
               document_date = ?,
               currency_code = ?,
               description = ?,
               reference_no = ?,
               total_debit_base = ?,
               total_credit_base = ?
           WHERE id = ?
             AND tenant_id = ?
             AND status = 'DRAFT'`,
          [
            legalEntityId,
            bookId,
            fiscalPeriodId,
            journalNo,
            sourceType,
            entryDate,
            documentDate,
            currencyCode,
            description,
            referenceNo,
            totalDebit,
            totalCredit,
            journalId,
            tenantId,
          ]
        );

        const affectedRows = Number(updateResult?.rows?.affectedRows || 0);
        if (affectedRows <= 0) {
          throw badRequest("Only DRAFT journals can be updated");
        }

        await tx.query(`DELETE FROM journal_lines WHERE journal_entry_id = ?`, [journalId]);

        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          // eslint-disable-next-line no-await-in-loop
          await tx.query(
            `INSERT INTO journal_lines (
                journal_entry_id, line_no, account_id, operating_unit_id,
                counterparty_legal_entity_id, description, subledger_reference_no, currency_code,
                amount_txn, debit_base, credit_base, tax_code
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              journalId,
              i + 1,
              parsePositiveInt(line.accountId),
              parsePositiveInt(line.operatingUnitId),
              parsePositiveInt(line.counterpartyLegalEntityId),
              line.description ? String(line.description) : null,
              normalizeOptionalShortText(
                line.subledgerReferenceNo,
                `lines[${i}].subledgerReferenceNo`,
                100
              ),
              String(line.currencyCode || currencyCode || "USD").toUpperCase(),
              toAmount(line.amountTxn),
              toAmount(line.debitBase),
              toAmount(line.creditBase),
              line.taxCode ? String(line.taxCode) : null,
            ]
          );
        }

        if (cashControlDecision.auditAction) {
          await writeCashControlAuditLog({
            runQuery: tx.query,
            req,
            tenantId,
            userId,
            legalEntityId,
            journalId,
            actionType: cashControlDecision.auditAction,
            sourceType,
            mode: cashControlDecision.mode,
            overrideReason,
            controlledAccounts: cashControlDecision.controlledAccounts,
            stage: "UPDATE_DRAFT",
          });
        }

        return affectedRows;
      });

      return res.json({
        ok: true,
        journalId,
        updated: Number(result || 0) > 0,
        status: "DRAFT",
        totalDebit,
        totalCredit,
      });
    })
  );

  router.post(
    "/journals/:journalId/cancel",
    requirePermission("gl.journal.cancel", {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromJournalId(req.params?.journalId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) throw badRequest("tenantId is required");

      const journalId = parsePositiveInt(req.params.journalId);
      if (!journalId) {
        throw badRequest("journalId must be a positive integer");
      }

      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) throw badRequest("Authenticated user is required");

      const reason = normalizeOptionalShortText(
        req.body?.reason ?? req.body?.cancelReason,
        "reason",
        500
      );
      if (!reason) {
        throw badRequest("reason is required");
      }

      const existing = await loadJournal(tenantId, journalId);
      if (!existing) {
        throw badRequest("Journal not found");
      }
      if (String(existing.status).toUpperCase() !== "DRAFT") {
        throw badRequest("Only DRAFT journals can be cancelled");
      }

      const result = await query(
        `UPDATE journal_entries
         SET status = 'CANCELLED',
             cancel_reason = ?,
             cancelled_by_user_id = ?,
             cancelled_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND tenant_id = ?
           AND status = 'DRAFT'`,
        [reason, userId, journalId, tenantId]
      );

      const cancelled = Number(result?.rows?.affectedRows || 0) > 0;
      if (!cancelled) {
        throw badRequest("Failed to cancel draft journal");
      }

      return res.json({
        ok: true,
        journalId,
        cancelled,
        status: "CANCELLED",
      });
    })
  );

  router.post(
    "/journals/:journalId/post",
    requirePermission("gl.journal.post", {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromJournalId(req.params?.journalId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) throw badRequest("tenantId is required");

      const journalId = parsePositiveInt(req.params.journalId);
      if (!journalId) {
        throw badRequest("journalId must be a positive integer");
      }

      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) throw badRequest("Authenticated user is required");
      const postLinkedMirrors = parseBooleanFlag(
        req.body?.postLinkedMirrors ?? req.body?.postLinkedMirror,
        false,
        "postLinkedMirrors"
      );
      const overrideCashControl = parseBooleanFlag(
        req.body?.overrideCashControl,
        false,
        "overrideCashControl"
      );
      const overrideReason = normalizeOptionalShortText(
        req.body?.overrideReason,
        "overrideReason",
        500
      );
      if (!overrideCashControl && overrideReason) {
        throw badRequest("overrideReason requires overrideCashControl=true");
      }

      const journal = await loadJournal(tenantId, journalId);
      if (!journal) throw badRequest("Journal not found");
      if (String(journal.status).toUpperCase() !== "DRAFT") {
        throw badRequest("Only DRAFT journals can be posted");
      }

      let postedJournalIds = [journalId];
      let linkedSourceJournalId = null;
      let result = null;
      let shareholderCommitmentSync = [];

      if (!postLinkedMirrors) {
        const singleJournalAccountIds = await loadJournalLineAccountIds({ journalId });
        const singleJournalControlledAccounts = await loadCashControlledAccounts({
          tenantId,
          accountIds: singleJournalAccountIds,
        });
        const singleJournalCashControlDecision = evaluateCashControlDecision({
          mode: cashControlMode,
          sourceType: journal.source_type,
          controlledAccounts: singleJournalControlledAccounts,
          overrideCashControl,
          overrideReason,
        });
        if (singleJournalCashControlDecision.blocked) {
          throw badRequest(singleJournalCashControlDecision.message);
        }
        if (singleJournalCashControlDecision.requiresOverridePermission) {
          await runPermissionMiddleware(requireCashControlOverrideOnPost, req, res);
        }

        result = await withTransaction(async (tx) => {
          await ensurePeriodOpen(
            parsePositiveInt(journal.book_id),
            parsePositiveInt(journal.fiscal_period_id),
            "post journal",
            tx.query.bind(tx)
          );

          const updateResult = await tx.query(
            `UPDATE journal_entries
             SET status = 'POSTED',
                 posted_by_user_id = ?,
                 posted_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND tenant_id = ?
               AND status = 'DRAFT'`,
            [userId, journalId, tenantId]
          );

          const affectedRows = Number(updateResult?.rows?.affectedRows || 0);
          const syncRows = [];
          if (affectedRows > 0) {
            syncRows.push(
              await applyShareholderCommitmentSyncForPostedJournalTx(tx, {
                tenantId,
                journalEntryId: journalId,
                createdByUserId: userId,
              })
            );
            if (singleJournalCashControlDecision.auditAction) {
              await writeCashControlAuditLog({
                runQuery: tx.query,
                req,
                tenantId,
                userId,
                legalEntityId: parsePositiveInt(journal.legal_entity_id),
                journalId,
                actionType: singleJournalCashControlDecision.auditAction,
                sourceType: journal.source_type,
                mode: singleJournalCashControlDecision.mode,
                overrideReason,
                controlledAccounts: singleJournalCashControlDecision.controlledAccounts,
                stage: "POST_DRAFT",
              });
            }
          }

          return {
            rows: updateResult.rows,
            shareholderCommitmentSync: syncRows,
          };
        });
        shareholderCommitmentSync = Array.isArray(result?.shareholderCommitmentSync)
          ? result.shareholderCommitmentSync
          : [];
      } else {
        const cluster = await loadIntercompanyJournalCluster(tenantId, journal);
        linkedSourceJournalId = parsePositiveInt(cluster.sourceJournalId);
        const clusterRows = Array.isArray(cluster.rows) ? cluster.rows : [];
        if (clusterRows.length === 0) {
          throw badRequest("Linked intercompany journals not found");
        }

        for (const row of clusterRows) {
          const scopedLegalEntityId = parsePositiveInt(row.legal_entity_id);
          assertScopeAccess(
            req,
            "legal_entity",
            scopedLegalEntityId,
            `linkedJournal.legalEntityId=${scopedLegalEntityId}`
          );
        }

        const draftRows = clusterRows.filter(
          (row) => String(row.status || "").toUpperCase() === "DRAFT"
        );
        const draftJournalIds = draftRows
          .map((row) => parsePositiveInt(row.id))
          .filter(Boolean);

        if (draftJournalIds.length === 0) {
          return res.json({
            ok: true,
            journalId,
            posted: false,
            postedJournalIds: [],
            linkedMirrorPosting: true,
            sourceJournalId: linkedSourceJournalId || journalId,
          });
        }

        const linkedCashControlDecisions = new Map();
        for (const draftJournalId of draftJournalIds) {
          // eslint-disable-next-line no-await-in-loop
          const draftJournal = await loadJournal(tenantId, draftJournalId);
          if (!draftJournal) {
            throw badRequest(`Linked journal not found: ${draftJournalId}`);
          }
          // eslint-disable-next-line no-await-in-loop
          const accountIds = await loadJournalLineAccountIds({ journalId: draftJournalId });
          // eslint-disable-next-line no-await-in-loop
          const controlledAccounts = await loadCashControlledAccounts({
            tenantId,
            accountIds,
          });
          const decision = evaluateCashControlDecision({
            mode: cashControlMode,
            sourceType: draftJournal.source_type,
            controlledAccounts,
            overrideCashControl,
            overrideReason,
          });
          if (decision.blocked) {
            throw badRequest(`Linked journal ${draftJournalId}: ${decision.message}`);
          }
          linkedCashControlDecisions.set(draftJournalId, {
            legalEntityId: parsePositiveInt(draftJournal.legal_entity_id),
            sourceType: draftJournal.source_type,
            decision,
          });
        }

        const linkedRequiresOverride = Array.from(linkedCashControlDecisions.values()).some(
          (value) => value?.decision?.requiresOverridePermission
        );
        if (linkedRequiresOverride) {
          await runPermissionMiddleware(requireCashControlOverrideOnPost, req, res);
        }

        result = await withTransaction(async (tx) => {
          for (const row of draftRows) {
            // eslint-disable-next-line no-await-in-loop
            await ensurePeriodOpen(
              parsePositiveInt(row.book_id),
              parsePositiveInt(row.fiscal_period_id),
              "post linked intercompany journals",
              tx.query.bind(tx)
            );
          }

          const placeholders = draftJournalIds.map(() => "?").join(", ");
          const updateResult = await tx.query(
            `UPDATE journal_entries
             SET status = 'POSTED',
                 posted_by_user_id = ?,
                 posted_at = CURRENT_TIMESTAMP
             WHERE tenant_id = ?
               AND status = 'DRAFT'
                AND id IN (${placeholders})`,
            [userId, tenantId, ...draftJournalIds]
          );

          const affectedRows = Number(updateResult?.rows?.affectedRows || 0);
          const syncRows = [];
          if (affectedRows > 0) {
            for (const postedJournalId of draftJournalIds) {
              // eslint-disable-next-line no-await-in-loop
              const syncResult = await applyShareholderCommitmentSyncForPostedJournalTx(
                tx,
                {
                  tenantId,
                  journalEntryId: postedJournalId,
                  createdByUserId: userId,
                }
              );
              syncRows.push(syncResult);

              const auditEntry = linkedCashControlDecisions.get(postedJournalId);
              if (auditEntry?.decision?.auditAction) {
                // eslint-disable-next-line no-await-in-loop
                await writeCashControlAuditLog({
                  runQuery: tx.query,
                  req,
                  tenantId,
                  userId,
                  legalEntityId: auditEntry.legalEntityId,
                  journalId: postedJournalId,
                  actionType: auditEntry.decision.auditAction,
                  sourceType: auditEntry.sourceType,
                  mode: auditEntry.decision.mode,
                  overrideReason,
                  controlledAccounts: auditEntry.decision.controlledAccounts,
                  stage: "POST_DRAFT_LINKED",
                });
              }
            }
          }

          return {
            rows: updateResult.rows,
            shareholderCommitmentSync: syncRows,
          };
        });

        postedJournalIds = draftJournalIds;
        shareholderCommitmentSync = Array.isArray(result?.shareholderCommitmentSync)
          ? result.shareholderCommitmentSync
          : [];
      }

      const posted = Number(result?.rows?.affectedRows || 0) > 0;
      if (!posted) {
        postedJournalIds = [];
      }

      return res.json({
        ok: true,
        journalId,
        posted,
        postedJournalIds,
        linkedMirrorPosting: postLinkedMirrors,
        sourceJournalId: linkedSourceJournalId || null,
        shareholderCommitmentSync,
      });
    })
  );

  router.post(
    "/journals/:journalId/reverse",
    requirePermission("gl.journal.reverse", {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromJournalId(req.params?.journalId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) throw badRequest("tenantId is required");

      const journalId = parsePositiveInt(req.params.journalId);
      if (!journalId) {
        throw badRequest("journalId must be a positive integer");
      }

      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) throw badRequest("Authenticated user is required");

      const original = await loadJournal(tenantId, journalId);
      if (!original) throw badRequest("Journal not found");
      if (String(original.status).toUpperCase() !== "POSTED") {
        throw badRequest("Only POSTED journals can be reversed");
      }
      if (parsePositiveInt(original.reversal_journal_entry_id)) {
        throw badRequest("Journal is already reversed");
      }
      const sourceLinks = await loadJournalSourceLinksForJournalId({
        tenantId,
        journalId,
      });
      const blockingSourceLinks = sourceLinks.filter((row) =>
        JOURNAL_REVERSE_BLOCK_SOURCE_TYPES.has(
          normalizeUpperText(row?.source_ref_type || row?.sourceRefType)
        )
      );
      if (blockingSourceLinks.length > 0) {
        throw badRequest(buildSubledgerReverseBlockedMessage(blockingSourceLinks));
      }

      const reversalPeriodId =
        parsePositiveInt(req.body?.reversalPeriodId) ||
        parsePositiveInt(original.fiscal_period_id);
      const autoPost = req.body?.autoPost === undefined ? true : Boolean(req.body.autoPost);
      const reason = req.body?.reason ? String(req.body.reason) : "Manual reversal";

      const bookId = parsePositiveInt(original.book_id);
      const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
      await assertFiscalPeriodBelongsToCalendar(
        parsePositiveInt(book.calendar_id),
        reversalPeriodId,
        "reversalPeriodId"
      );

      await ensurePeriodOpen(bookId, reversalPeriodId, "reverse journal");

      const reversalJournalNo = req.body?.journalNo || `${original.journal_no}-REV`;
      const entryDate = toIsoDate(req.body?.entryDate || original.entry_date, "entryDate");
      const documentDate = toIsoDate(
        req.body?.documentDate || original.document_date,
        "documentDate"
      );

      const { reversalJournalId, originalUpdated } = await withTransaction(async (tx) => {
        return reverseJournalEntryTx(tx, {
          tenantId,
          journalId,
          userId,
          reason,
          reversalPeriodId,
          entryDate,
          documentDate,
          journalNo: reversalJournalNo,
          autoPost,
        });
      });

      return res.status(201).json({
        ok: true,
        originalJournalId: journalId,
        reversalJournalId,
        reversalStatus: autoPost ? "POSTED" : "DRAFT",
        originalMarkedReversed: originalUpdated,
      });
    })
  );
}
