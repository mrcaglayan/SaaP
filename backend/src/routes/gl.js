import express from "express";
import { query, withTransaction } from "../db.js";
import {
  assertScopeAccess,
  buildScopeFilter,
  requirePermission,
} from "../middleware/rbac.js";
import {
  assertAccountBelongsToTenant,
  assertBookBelongsToTenant,
  assertCoaBelongsToTenant,
  assertFiscalCalendarBelongsToTenant,
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

const router = express.Router();
const PERIOD_STATUSES = new Set(["OPEN", "SOFT_CLOSED", "HARD_CLOSED"]);

function toAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function generateJournalNo() {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1000);
  return `JRN-${stamp}-${rand}`;
}

async function resolveScopeFromBookId(bookId, tenantId) {
  const parsedBookId = parsePositiveInt(bookId);
  if (!parsedBookId) {
    return { scopeType: "TENANT", scopeId: tenantId };
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM books
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [parsedBookId, tenantId]
  );

  const legalEntityId = parsePositiveInt(result.rows[0]?.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }

  return { scopeType: "TENANT", scopeId: tenantId };
}

async function resolveScopeFromJournalId(journalId, tenantId) {
  const parsedJournalId = parsePositiveInt(journalId);
  if (!parsedJournalId) {
    return { scopeType: "TENANT", scopeId: tenantId };
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM journal_entries
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [parsedJournalId, tenantId]
  );

  const legalEntityId = parsePositiveInt(result.rows[0]?.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }

  return { scopeType: "TENANT", scopeId: tenantId };
}

async function getEffectivePeriodStatus(bookId, fiscalPeriodId) {
  const result = await query(
    `SELECT status
     FROM period_statuses
     WHERE book_id = ?
       AND fiscal_period_id = ?
     LIMIT 1`,
    [bookId, fiscalPeriodId]
  );

  return String(result.rows[0]?.status || "OPEN").toUpperCase();
}

async function ensurePeriodOpen(bookId, fiscalPeriodId, actionLabel) {
  const status = await getEffectivePeriodStatus(bookId, fiscalPeriodId);
  if (status !== "OPEN") {
    throw badRequest(`Period is ${status}; cannot ${actionLabel}`);
  }
}

async function loadJournal(tenantId, journalId) {
  const result = await query(
    `SELECT id, tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status,
            entry_date, document_date, currency_code, description, reference_no,
            total_debit_base, total_credit_base, created_by_user_id, posted_by_user_id,
            posted_at, reversed_by_user_id, reversed_at, reverse_reason,
            reversal_journal_entry_id, created_at, updated_at
     FROM journal_entries
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [journalId, tenantId]
  );
  return result.rows[0] || null;
}

function parseOptionalPositiveInt(value, fieldLabel) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${fieldLabel} must be a positive integer`);
  }
  return parsed;
}

async function validateJournalLineScope(req, tenantId, legalEntityId, line, index) {
  const lineLabel = `lines[${index}]`;
  const accountId = parsePositiveInt(line?.accountId);
  if (!accountId) {
    throw badRequest(`${lineLabel}.accountId must be a positive integer`);
  }

  const accountResult = await query(
    `SELECT a.id, c.legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId]
  );
  const account = accountResult.rows[0];
  if (!account) {
    throw badRequest(`${lineLabel}.accountId not found for tenant`);
  }

  const accountLegalEntityId = parsePositiveInt(account.legal_entity_id);
  if (accountLegalEntityId && accountLegalEntityId !== legalEntityId) {
    throw badRequest(`${lineLabel}.accountId does not belong to legalEntityId`);
  }
  if (accountLegalEntityId) {
    assertScopeAccess(req, "legal_entity", accountLegalEntityId, `${lineLabel}.accountId`);
  }

  const operatingUnitId = parseOptionalPositiveInt(
    line?.operatingUnitId,
    `${lineLabel}.operatingUnitId`
  );
  if (operatingUnitId) {
    const unitResult = await query(
      `SELECT id, legal_entity_id
       FROM operating_units
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [operatingUnitId, tenantId]
    );
    const unit = unitResult.rows[0];
    if (!unit) {
      throw badRequest(`${lineLabel}.operatingUnitId not found for tenant`);
    }
    if (parsePositiveInt(unit.legal_entity_id) !== legalEntityId) {
      throw badRequest(`${lineLabel}.operatingUnitId does not belong to legalEntityId`);
    }
    assertScopeAccess(req, "operating_unit", operatingUnitId, `${lineLabel}.operatingUnitId`);
  }

  const counterpartyLegalEntityId = parseOptionalPositiveInt(
    line?.counterpartyLegalEntityId,
    `${lineLabel}.counterpartyLegalEntityId`
  );
  if (counterpartyLegalEntityId) {
    const counterpartyResult = await query(
      `SELECT id
       FROM legal_entities
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [counterpartyLegalEntityId, tenantId]
    );
    if (!counterpartyResult.rows[0]) {
      throw badRequest(`${lineLabel}.counterpartyLegalEntityId not found for tenant`);
    }
    assertScopeAccess(
      req,
      "legal_entity",
      counterpartyLegalEntityId,
      `${lineLabel}.counterpartyLegalEntityId`
    );
  }

  const debitBase = toAmount(line?.debitBase);
  const creditBase = toAmount(line?.creditBase);
  if (debitBase < 0 || creditBase < 0) {
    throw badRequest(`${lineLabel}.debitBase/creditBase cannot be negative`);
  }
  if ((debitBase === 0 && creditBase === 0) || (debitBase > 0 && creditBase > 0)) {
    throw badRequest(
      `${lineLabel} must have exactly one side > 0 (either debitBase or creditBase)`
    );
  }
}

router.get(
  "/books",
  requirePermission("gl.book.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const conditions = ["tenant_id = ?"];
    const params = [tenantId];
    conditions.push(buildScopeFilter(req, "legal_entity", "legal_entity_id", params));
    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
      `SELECT id, tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code, created_at
       FROM books
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({ tenantId, rows: result.rows });
  })
);

router.get(
  "/coas",
  requirePermission("gl.coa.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const scope = req.query.scope ? String(req.query.scope).toUpperCase() : null;
    const conditions = ["tenant_id = ?"];
    const params = [tenantId];
    const legalScopeFilter = buildScopeFilter(req, "legal_entity", "legal_entity_id", params);
    conditions.push(`(legal_entity_id IS NULL OR ${legalScopeFilter})`);
    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (scope) {
      conditions.push("scope = ?");
      params.push(scope);
    }

    const result = await query(
      `SELECT id, tenant_id, legal_entity_id, scope, code, name, created_at
       FROM charts_of_accounts
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({ tenantId, rows: result.rows });
  })
);

router.get(
  "/accounts",
  requirePermission("gl.account.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const coaId = parsePositiveInt(req.query.coaId);
    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";

    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const conditions = ["c.tenant_id = ?"];
    const params = [tenantId];
    const legalScopeFilter = buildScopeFilter(req, "legal_entity", "c.legal_entity_id", params);
    conditions.push(`(c.legal_entity_id IS NULL OR ${legalScopeFilter})`);
    if (coaId) {
      conditions.push("a.coa_id = ?");
      params.push(coaId);
    }
    if (legalEntityId) {
      conditions.push("c.legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (!includeInactive) {
      conditions.push("a.is_active = TRUE");
    }

    const result = await query(
      `SELECT
         a.id, a.coa_id, a.code, a.name, a.account_type, a.normal_side, a.allow_posting,
         a.parent_account_id, a.is_active, c.legal_entity_id, c.scope
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY c.id, a.code`,
      params
    );

    return res.json({ tenantId, rows: result.rows });
  })
);

router.post(
  "/books",
  requirePermission("gl.book.upsert", {
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
      "calendarId",
      "code",
      "name",
      "baseCurrencyCode",
    ]);

    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    const calendarId = parsePositiveInt(req.body.calendarId);
    if (!legalEntityId || !calendarId) {
      throw badRequest("legalEntityId and calendarId must be positive integers");
    }

    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    await assertFiscalCalendarBelongsToTenant(tenantId, calendarId, "calendarId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const { code, name, bookType = "LOCAL", baseCurrencyCode } = req.body;
    const result = await query(
      `INSERT INTO books (
          tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code
        )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         book_type = VALUES(book_type),
         base_currency_code = VALUES(base_currency_code),
         calendar_id = VALUES(calendar_id)`,
      [
        tenantId,
        legalEntityId,
        calendarId,
        String(code).trim(),
        String(name).trim(),
        String(bookType).toUpperCase(),
        String(baseCurrencyCode).trim().toUpperCase(),
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/coas",
  requirePermission("gl.coa.upsert", {
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

    assertRequiredFields(req.body, ["scope", "code", "name"]);
    const scope = String(req.body.scope || "").toUpperCase();
    if (!["LEGAL_ENTITY", "GROUP"].includes(scope)) {
      throw badRequest("scope must be LEGAL_ENTITY or GROUP");
    }

    const legalEntityId = req.body.legalEntityId
      ? parsePositiveInt(req.body.legalEntityId)
      : null;
    if (scope === "LEGAL_ENTITY" && !legalEntityId) {
      throw badRequest("legalEntityId is required for LEGAL_ENTITY scope");
    }
    if (scope === "GROUP" && legalEntityId) {
      throw badRequest("legalEntityId must be omitted for GROUP scope");
    }
    if (legalEntityId) {
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const { code, name } = req.body;
    const result = await query(
      `INSERT INTO charts_of_accounts (
          tenant_id, legal_entity_id, scope, code, name
        )
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         legal_entity_id = VALUES(legal_entity_id),
         scope = VALUES(scope)`,
      [
        tenantId,
        legalEntityId,
        scope,
        String(code).trim(),
        String(name).trim(),
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/accounts",
  requirePermission("gl.account.upsert", {
    resolveScope: async (req, tenantId) => {
      const coaId = parsePositiveInt(req.body?.coaId);
      if (!coaId) {
        return { scopeType: "TENANT", scopeId: tenantId };
      }

      const coaResult = await query(
        `SELECT legal_entity_id
         FROM charts_of_accounts
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1`,
        [coaId, tenantId]
      );
      const legalEntityId = parsePositiveInt(coaResult.rows[0]?.legal_entity_id);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    assertRequiredFields(req.body, [
      "coaId",
      "code",
      "name",
      "accountType",
      "normalSide",
    ]);
    const coaId = parsePositiveInt(req.body.coaId);
    if (!coaId) {
      throw badRequest("coaId must be a positive integer");
    }

    const coa = await assertCoaBelongsToTenant(tenantId, coaId, "coaId");
    const coaLegalEntityId = parsePositiveInt(coa.legal_entity_id);
    if (coaLegalEntityId) {
      assertScopeAccess(req, "legal_entity", coaLegalEntityId, "coa.legalEntityId");
    }

    const parentAccountId = req.body.parentAccountId
      ? parsePositiveInt(req.body.parentAccountId)
      : null;
    if (req.body.parentAccountId && !parentAccountId) {
      throw badRequest("parentAccountId must be a positive integer");
    }
    if (parentAccountId) {
      const parent = await assertAccountBelongsToTenant(
        tenantId,
        parentAccountId,
        "parentAccountId"
      );
      if (parsePositiveInt(parent.coa_id) !== coaId) {
        throw badRequest("parentAccountId must belong to the same coaId");
      }
    }

    const { code, name, accountType, normalSide, allowPosting = true } = req.body;

    const result = await query(
      `INSERT INTO accounts (
          coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id
        )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         account_type = VALUES(account_type),
         normal_side = VALUES(normal_side),
         allow_posting = VALUES(allow_posting),
         parent_account_id = VALUES(parent_account_id)`,
      [
        coaId,
        String(code).trim(),
        String(name).trim(),
        String(accountType).toUpperCase(),
        String(normalSide).toUpperCase(),
        Boolean(allowPosting),
        parentAccountId,
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/account-mappings",
  requirePermission("gl.account_mapping.upsert", {
    resolveScope: async (req, tenantId) => {
      const sourceAccountId = parsePositiveInt(req.body?.sourceAccountId);
      if (!sourceAccountId) {
        return { scopeType: "TENANT", scopeId: tenantId };
      }

      const sourceResult = await query(
        `SELECT c.legal_entity_id
         FROM accounts a
         JOIN charts_of_accounts c ON c.id = a.coa_id
         WHERE a.id = ?
           AND c.tenant_id = ?
         LIMIT 1`,
        [sourceAccountId, tenantId]
      );

      const legalEntityId = parsePositiveInt(sourceResult.rows[0]?.legal_entity_id);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    assertRequiredFields(req.body, ["sourceAccountId", "targetAccountId"]);
    const sourceAccountId = parsePositiveInt(req.body.sourceAccountId);
    const targetAccountId = parsePositiveInt(req.body.targetAccountId);
    if (!sourceAccountId || !targetAccountId) {
      throw badRequest("sourceAccountId and targetAccountId must be positive integers");
    }

    const sourceAccount = await assertAccountBelongsToTenant(
      tenantId,
      sourceAccountId,
      "sourceAccountId"
    );
    const targetAccount = await assertAccountBelongsToTenant(
      tenantId,
      targetAccountId,
      "targetAccountId"
    );

    const sourceEntityId = parsePositiveInt(sourceAccount.legal_entity_id);
    const targetEntityId = parsePositiveInt(targetAccount.legal_entity_id);
    if (sourceEntityId) {
      assertScopeAccess(req, "legal_entity", sourceEntityId, "sourceAccount.legalEntityId");
    }
    if (targetEntityId) {
      assertScopeAccess(req, "legal_entity", targetEntityId, "targetAccount.legalEntityId");
    }

    const mappingType = String(req.body.mappingType || "LOCAL_TO_GROUP").toUpperCase();
    const result = await query(
      `INSERT INTO account_mappings (
          tenant_id, source_account_id, target_account_id, mapping_type
        )
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         mapping_type = VALUES(mapping_type)`,
      [tenantId, sourceAccountId, targetAccountId, mappingType]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.get(
  "/journals",
  requirePermission("gl.journal.read", {
    resolveScope: async (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }

      const bookId = parsePositiveInt(req.query?.bookId);
      if (bookId) {
        return resolveScopeFromBookId(bookId, tenantId);
      }

      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    const bookId = parsePositiveInt(req.query.bookId);
    const fiscalPeriodId = parsePositiveInt(req.query.fiscalPeriodId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const includeLines = String(req.query.includeLines || "").toLowerCase() === "true";

    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }
    if (status && !["DRAFT", "POSTED", "REVERSED"].includes(status)) {
      throw badRequest("status must be one of DRAFT, POSTED, REVERSED");
    }

    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const offsetRaw = Number(req.query.offset);
    const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const conditions = ["je.tenant_id = ?"];
    const params = [tenantId];
    conditions.push(buildScopeFilter(req, "legal_entity", "je.legal_entity_id", params));

    if (legalEntityId) {
      conditions.push("je.legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (bookId) {
      conditions.push("je.book_id = ?");
      params.push(bookId);
    }
    if (fiscalPeriodId) {
      conditions.push("je.fiscal_period_id = ?");
      params.push(fiscalPeriodId);
    }
    if (status) {
      conditions.push("je.status = ?");
      params.push(status);
    }

    const whereSql = conditions.join(" AND ");
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM journal_entries je
       WHERE ${whereSql}`,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const rowsResult = await query(
      `SELECT
         je.id, je.tenant_id, je.legal_entity_id, je.book_id, je.fiscal_period_id,
         je.journal_no, je.source_type, je.status, je.entry_date, je.document_date,
         je.currency_code, je.description, je.reference_no,
         je.total_debit_base, je.total_credit_base,
         je.created_by_user_id, je.posted_by_user_id, je.posted_at,
         je.reversed_by_user_id, je.reversed_at, je.reverse_reason,
         je.reversal_journal_entry_id, je.created_at, je.updated_at,
         le.code AS legal_entity_code, le.name AS legal_entity_name,
         b.code AS book_code, b.name AS book_name,
         fp.fiscal_year, fp.period_no, fp.period_name,
         (
           SELECT COUNT(*)
           FROM journal_lines jl
           WHERE jl.journal_entry_id = je.id
         ) AS line_count
       FROM journal_entries je
       JOIN legal_entities le ON le.id = je.legal_entity_id
       JOIN books b ON b.id = je.book_id
       JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
       WHERE ${whereSql}
       ORDER BY je.id DESC
       LIMIT ?
       OFFSET ?`,
      [...params, limit, offset]
    );

    const rows = rowsResult.rows || [];

    if (includeLines && rows.length > 0) {
      const journalIds = rows
        .map((row) => parsePositiveInt(row.id))
        .filter((value) => Boolean(value));

      if (journalIds.length > 0) {
        const placeholders = journalIds.map(() => "?").join(", ");
        const lineResult = await query(
          `SELECT
             jl.id, jl.journal_entry_id, jl.line_no, jl.account_id,
             jl.operating_unit_id, jl.counterparty_legal_entity_id,
             jl.description, jl.currency_code, jl.amount_txn, jl.debit_base,
             jl.credit_base, jl.tax_code, jl.created_at,
             a.code AS account_code, a.name AS account_name,
             ou.code AS operating_unit_code, ou.name AS operating_unit_name,
             cle.code AS counterparty_legal_entity_code,
             cle.name AS counterparty_legal_entity_name
           FROM journal_lines jl
           JOIN accounts a ON a.id = jl.account_id
           LEFT JOIN operating_units ou ON ou.id = jl.operating_unit_id
           LEFT JOIN legal_entities cle ON cle.id = jl.counterparty_legal_entity_id
           WHERE jl.journal_entry_id IN (${placeholders})
           ORDER BY jl.journal_entry_id, jl.line_no`,
          journalIds
        );

        const linesByJournalId = new Map();
        for (const line of lineResult.rows || []) {
          const journalEntryId = parsePositiveInt(line.journal_entry_id);
          if (!journalEntryId) continue;
          if (!linesByJournalId.has(journalEntryId)) {
            linesByJournalId.set(journalEntryId, []);
          }
          linesByJournalId.get(journalEntryId).push(line);
        }

        for (const row of rows) {
          row.lines = linesByJournalId.get(parsePositiveInt(row.id)) || [];
        }
      }
    }

    return res.json({
      tenantId,
      rows,
      total,
      limit,
      offset,
    });
  })
);

router.get(
  "/journals/:journalId",
  requirePermission("gl.journal.read", {
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

    const rowResult = await query(
      `SELECT
         je.id, je.tenant_id, je.legal_entity_id, je.book_id, je.fiscal_period_id,
         je.journal_no, je.source_type, je.status, je.entry_date, je.document_date,
         je.currency_code, je.description, je.reference_no,
         je.total_debit_base, je.total_credit_base,
         je.created_by_user_id, je.posted_by_user_id, je.posted_at,
         je.reversed_by_user_id, je.reversed_at, je.reverse_reason,
         je.reversal_journal_entry_id, je.created_at, je.updated_at,
         le.code AS legal_entity_code, le.name AS legal_entity_name,
         b.code AS book_code, b.name AS book_name,
         fp.fiscal_year, fp.period_no, fp.period_name
       FROM journal_entries je
       JOIN legal_entities le ON le.id = je.legal_entity_id
       JOIN books b ON b.id = je.book_id
       JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
       WHERE je.id = ?
         AND je.tenant_id = ?
       LIMIT 1`,
      [journalId, tenantId]
    );
    const journal = rowResult.rows[0];
    if (!journal) {
      throw badRequest("Journal not found");
    }

    assertScopeAccess(req, "legal_entity", journal.legal_entity_id, "journal.legalEntityId");

    const lineResult = await query(
      `SELECT
         jl.id, jl.journal_entry_id, jl.line_no, jl.account_id,
         jl.operating_unit_id, jl.counterparty_legal_entity_id,
         jl.description, jl.currency_code, jl.amount_txn, jl.debit_base,
         jl.credit_base, jl.tax_code, jl.created_at,
         a.code AS account_code, a.name AS account_name,
         ou.code AS operating_unit_code, ou.name AS operating_unit_name,
         cle.code AS counterparty_legal_entity_code,
         cle.name AS counterparty_legal_entity_name
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       LEFT JOIN operating_units ou ON ou.id = jl.operating_unit_id
       LEFT JOIN legal_entities cle ON cle.id = jl.counterparty_legal_entity_id
       WHERE jl.journal_entry_id = ?
       ORDER BY jl.line_no`,
      [journalId]
    );

    return res.json({
      tenantId,
      row: {
        ...journal,
        lines: lineResult.rows || [],
      },
    });
  })
);

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
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
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

    await ensurePeriodOpen(bookId, fiscalPeriodId, "create draft journal");

    let totalDebit = 0;
    let totalCredit = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      totalDebit += toAmount(line.debitBase);
      totalCredit += toAmount(line.creditBase);
      await validateJournalLineScope(req, tenantId, legalEntityId, line, i);
    }

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw badRequest("Journal is not balanced");
    }

    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) throw badRequest("Authenticated user is required");

    const journalNo = req.body.journalNo || generateJournalNo();
    const sourceType = String(req.body.sourceType || "MANUAL").toUpperCase();
    const description = req.body.description ? String(req.body.description) : null;
    const referenceNo = req.body.referenceNo ? String(req.body.referenceNo) : null;
    const currencyCode = String(req.body.currencyCode).toUpperCase();

    const journalEntryId = await withTransaction(async (tx) => {
      const entryResult = await tx.query(
        `INSERT INTO journal_entries (
            tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no,
            source_type, status, entry_date, document_date, currency_code,
            description, reference_no, total_debit_base, total_credit_base, created_by_user_id
          )
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          bookId,
          fiscalPeriodId,
          journalNo,
          sourceType,
          req.body.entryDate,
          req.body.documentDate,
          currencyCode,
          description,
          referenceNo,
          totalDebit,
          totalCredit,
          userId,
        ]
      );

      const createdJournalEntryId = parsePositiveInt(entryResult.rows.insertId);
      if (!createdJournalEntryId) {
        throw badRequest("Failed to create journal entry");
      }

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO journal_lines (
              journal_entry_id, line_no, account_id, operating_unit_id,
              counterparty_legal_entity_id, description, currency_code,
              amount_txn, debit_base, credit_base, tax_code
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            createdJournalEntryId,
            i + 1,
            parsePositiveInt(line.accountId),
            parsePositiveInt(line.operatingUnitId),
            parsePositiveInt(line.counterpartyLegalEntityId),
            line.description ? String(line.description) : null,
            String(line.currencyCode || currencyCode).toUpperCase(),
            toAmount(line.amountTxn),
            toAmount(line.debitBase),
            toAmount(line.creditBase),
            line.taxCode ? String(line.taxCode) : null,
          ]
        );
      }

      return createdJournalEntryId;
    });

    return res.status(201).json({
      ok: true,
      journalEntryId,
      journalNo,
      status: "DRAFT",
      totalDebit,
      totalCredit,
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

    const journal = await loadJournal(tenantId, journalId);
    if (!journal) throw badRequest("Journal not found");
    if (String(journal.status).toUpperCase() !== "DRAFT") {
      throw badRequest("Only DRAFT journals can be posted");
    }

    await ensurePeriodOpen(
      parsePositiveInt(journal.book_id),
      parsePositiveInt(journal.fiscal_period_id),
      "post journal"
    );

    const result = await query(
      `UPDATE journal_entries
       SET status = 'POSTED',
           posted_by_user_id = ?,
           posted_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND tenant_id = ?
         AND status = 'DRAFT'`,
      [userId, journalId, tenantId]
    );

    return res.json({
      ok: true,
      journalId,
      posted: Number(result.rows.affectedRows || 0) > 0,
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
         currency_code, amount_txn, debit_base, credit_base, tax_code
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
              counterparty_legal_entity_id, description, currency_code,
              amount_txn, debit_base, credit_base, tax_code
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            createdReversalJournalId,
            i + 1,
            parsePositiveInt(line.account_id),
            parsePositiveInt(line.operating_unit_id),
            parsePositiveInt(line.counterparty_legal_entity_id),
            line.description ? String(line.description) : null,
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

router.get(
  "/trial-balance",
  requirePermission("gl.trial_balance.read", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromBookId(req.query?.bookId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const bookId = parsePositiveInt(req.query.bookId);
    const fiscalPeriodId = parsePositiveInt(req.query.fiscalPeriodId);
    if (!bookId || !fiscalPeriodId) {
      throw badRequest("bookId and fiscalPeriodId query params are required");
    }

    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      fiscalPeriodId,
      "fiscalPeriodId"
    );

    const result = await query(
      `SELECT
         a.id AS account_id,
         a.code AS account_code,
         a.name AS account_name,
         SUM(jl.debit_base) AS debit_total,
         SUM(jl.credit_base) AS credit_total,
         SUM(jl.debit_base - jl.credit_base) AS balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
       WHERE je.tenant_id = ?
         AND je.book_id = ?
         AND je.fiscal_period_id = ?
         AND je.status = 'POSTED'
       GROUP BY a.id, a.code, a.name
       ORDER BY a.code`,
      [tenantId, bookId, fiscalPeriodId]
    );

    return res.json({
      bookId,
      fiscalPeriodId,
      rows: result.rows,
    });
  })
);

router.post(
  "/period-statuses/:bookId/:periodId/close",
  requirePermission("gl.period.close", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromBookId(req.params?.bookId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const bookId = parsePositiveInt(req.params.bookId);
    const fiscalPeriodId = parsePositiveInt(req.params.periodId);
    if (!bookId || !fiscalPeriodId) {
      throw badRequest("bookId and periodId must be positive integers");
    }

    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      fiscalPeriodId,
      "periodId"
    );

    const status = String(req.body.status || "SOFT_CLOSED").toUpperCase();
    if (!PERIOD_STATUSES.has(status)) {
      throw badRequest("status must be one of OPEN, SOFT_CLOSED, HARD_CLOSED");
    }

    const note = req.body.note ? String(req.body.note) : null;
    const userId = parsePositiveInt(req.user?.userId);
    const currentStatus = await getEffectivePeriodStatus(bookId, fiscalPeriodId);

    if (currentStatus === "HARD_CLOSED" && status !== "HARD_CLOSED") {
      throw badRequest("HARD_CLOSED periods cannot be re-opened or softened");
    }

    await query(
      `INSERT INTO period_statuses (
          book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
        )
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         closed_by_user_id = VALUES(closed_by_user_id),
         closed_at = VALUES(closed_at),
         note = VALUES(note)`,
      [bookId, fiscalPeriodId, status, userId, note]
    );

    return res.status(201).json({
      ok: true,
      bookId,
      fiscalPeriodId,
      status,
      previousStatus: currentStatus,
    });
  })
);

export default router;
