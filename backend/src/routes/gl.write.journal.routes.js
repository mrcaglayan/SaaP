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

export function registerGlWriteJournalRoutes(router, deps = {}) {
  const {
    applyShareholderCommitmentSyncForPostedJournalTx,
    buildIntercompanyAutoMirrorDraftSpecs,
    ensurePeriodOpen,
    generateJournalNo,
    insertDraftJournalEntry,
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
      const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
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

      let totalDebit = 0;
      let totalCredit = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        totalDebit += toAmount(line.debitBase);
        totalCredit += toAmount(line.creditBase);
        await validateJournalLineScope(req, tenantId, legalEntityId, line, i);
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

      const lineResult = await query(
        `SELECT
           account_id, operating_unit_id, counterparty_legal_entity_id, description,
           subledger_reference_no, currency_code, amount_txn, debit_base, credit_base, tax_code
         FROM journal_lines
         WHERE journal_entry_id = ?
         ORDER BY line_no`,
        [journalId]
      );
      const lines = lineResult.rows || [];
      if (lines.length === 0) throw badRequest("Journal has no lines to reverse");

      const reversalJournalNo = req.body?.journalNo || `${original.journal_no}-REV`;
      const entryDate = req.body?.entryDate || original.entry_date;
      const documentDate = req.body?.documentDate || original.document_date;

      const { reversalJournalId, originalUpdated } = await withTransaction(async (tx) => {
        const reversalResult = await tx.query(
          `INSERT INTO journal_entries (
              tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no,
              source_type, status, entry_date, document_date, currency_code,
              description, reference_no, total_debit_base, total_credit_base,
              created_by_user_id, posted_by_user_id, posted_at, reverse_reason
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            parsePositiveInt(original.legal_entity_id),
            bookId,
            reversalPeriodId,
            reversalJournalNo,
            String(original.source_type || "MANUAL").toUpperCase(),
            autoPost ? "POSTED" : "DRAFT",
            String(entryDate),
            String(documentDate),
            String(original.currency_code).toUpperCase(),
            `Reversal of ${original.journal_no}`,
            original.reference_no ? String(original.reference_no) : null,
            Number(original.total_credit_base || 0),
            Number(original.total_debit_base || 0),
            userId,
            autoPost ? userId : null,
            autoPost ? new Date() : null,
            reason,
          ]
        );

        const createdReversalJournalId = parsePositiveInt(reversalResult.rows.insertId);
        if (!createdReversalJournalId) {
          throw badRequest("Failed to create reversal journal");
        }

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
              createdReversalJournalId,
              i + 1,
              parsePositiveInt(line.account_id),
              parsePositiveInt(line.operating_unit_id),
              parsePositiveInt(line.counterparty_legal_entity_id),
              line.description ? String(line.description) : null,
              normalizeOptionalShortText(line.subledger_reference_no, "subledger_reference_no", 100),
              String(line.currency_code || original.currency_code).toUpperCase(),
              Number(line.amount_txn || 0) * -1,
              Number(line.credit_base || 0),
              Number(line.debit_base || 0),
              line.tax_code ? String(line.tax_code) : null,
            ]
          );
        }

        let markedReversed = false;
        if (autoPost) {
          const updateResult = await tx.query(
            `UPDATE journal_entries
             SET status = 'REVERSED',
                 reversed_by_user_id = ?,
                 reversed_at = CURRENT_TIMESTAMP,
                 reversal_journal_entry_id = ?,
                 reverse_reason = ?
             WHERE id = ?
               AND tenant_id = ?
               AND status = 'POSTED'`,
            [userId, createdReversalJournalId, reason, journalId, tenantId]
          );
          markedReversed = Number(updateResult.rows.affectedRows || 0) > 0;
        }

        return {
          reversalJournalId: createdReversalJournalId,
          originalUpdated: markedReversed,
        };
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
