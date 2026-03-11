import crypto from "node:crypto";
import { closePool, query } from "../src/db.js";
import {
  applyCanonicalMappingRule,
  getCanonicalMappingGovernanceReview,
  previewCanonicalMappingRule,
} from "../src/services/consolidation.canonical-mappings.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildToken(length) {
  return crypto
    .randomBytes(length)
    .toString("base64")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, length);
}

async function insert(sql, params = []) {
  const result = await query(sql, params);
  return Number(result.rows?.insertId || 0);
}

async function cleanup(context) {
  const tenantId = Number(context.tenantId || 0);
  const groupId = Number(context.groupId || 0);
  const calendarId = Number(context.calendarId || 0);
  const groupCompanyId = Number(context.groupCompanyId || 0);
  const legalEntityId = Number(context.legalEntityId || 0);
  const localCoaId = Number(context.localCoaId || 0);
  const groupCoaId = Number(context.groupCoaId || 0);
  const countryId = Number(context.countryId || 0);
  const currencyCode = String(context.currencyCode || "").trim();

  if (tenantId) {
    await query(`DELETE FROM audit_logs WHERE tenant_id = ?`, [tenantId]);
    await query(
      `DELETE jl
       FROM journal_lines jl
       JOIN journal_entries je
         ON je.id = jl.journal_entry_id
      WHERE je.tenant_id = ?`,
      [tenantId]
    );
    await query(`DELETE FROM journal_entries WHERE tenant_id = ?`, [tenantId]);
  }

  if (groupId) {
    await query(`DELETE FROM consolidation_group_members WHERE consolidation_group_id = ?`, [
      groupId,
    ]);
  }

  if (tenantId) {
    await query(`DELETE FROM consolidation_canonical_mapping_rules WHERE tenant_id = ?`, [
      tenantId,
    ]);
    await query(`DELETE FROM consolidation_canonical_local_account_mappings WHERE tenant_id = ?`, [
      tenantId,
    ]);
    await query(`DELETE FROM consolidation_canonical_group_account_mappings WHERE tenant_id = ?`, [
      tenantId,
    ]);
    await query(`DELETE FROM group_coa_mappings WHERE tenant_id = ?`, [tenantId]);
    await query(`DELETE FROM books WHERE tenant_id = ?`, [tenantId]);
  }

  if (localCoaId || groupCoaId) {
    const coaIds = [localCoaId, groupCoaId].filter(Boolean);
    if (coaIds.length > 0) {
      const placeholders = coaIds.map(() => "?").join(", ");
      await query(`DELETE FROM accounts WHERE coa_id IN (${placeholders})`, coaIds);
    }
  }

  if (tenantId) {
    await query(`DELETE FROM consolidation_canonical_keys WHERE tenant_id = ?`, [tenantId]);
  }

  if (calendarId) {
    await query(`DELETE FROM fiscal_periods WHERE calendar_id = ?`, [calendarId]);
  }

  if (tenantId) {
    await query(`DELETE FROM charts_of_accounts WHERE tenant_id = ?`, [tenantId]);
    await query(`DELETE FROM consolidation_groups WHERE tenant_id = ?`, [tenantId]);
    await query(`DELETE FROM legal_entities WHERE tenant_id = ?`, [tenantId]);
    await query(`DELETE FROM fiscal_calendars WHERE tenant_id = ?`, [tenantId]);
    await query(`DELETE FROM group_companies WHERE tenant_id = ?`, [tenantId]);
    await query(`DELETE FROM users WHERE tenant_id = ?`, [tenantId]);
    await query(`DELETE FROM tenants WHERE id = ?`, [tenantId]);
  }

  if (countryId) {
    await query(`DELETE FROM countries WHERE id = ?`, [countryId]);
  }

  if (currencyCode) {
    await query(`DELETE FROM currencies WHERE code = ?`, [currencyCode]);
  }
}

async function main() {
  const token = buildToken(8);
  const context = {};

  try {
    context.currencyCode = `X${token}`.slice(0, 3);
    const countryIso2 = `X${token}`.slice(0, 2);
    const countryIso3 = `X${token}`.slice(0, 3);

    await query(`INSERT INTO currencies (code, name, minor_units) VALUES (?, ?, ?)`, [
      context.currencyCode,
      `Test Currency ${token}`,
      2,
    ]);
    context.countryId = await insert(
      `INSERT INTO countries (iso2, iso3, name, default_currency_code)
       VALUES (?, ?, ?, ?)`,
      [countryIso2, countryIso3, `Test Country ${token}`, context.currencyCode]
    );
    context.tenantId = await insert(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
      `TEN_${token}`,
      `Canonical Followup Tenant ${token}`,
    ]);
    context.groupCompanyId = await insert(
      `INSERT INTO group_companies (tenant_id, code, name)
       VALUES (?, ?, ?)`,
      [context.tenantId, `GC_${token}`, `Group Company ${token}`]
    );
    context.calendarId = await insert(
      `INSERT INTO fiscal_calendars (tenant_id, code, name, year_start_month, year_start_day)
       VALUES (?, ?, ?, ?, ?)`,
      [context.tenantId, `CAL_${token}`, `Calendar ${token}`, 1, 1]
    );
    context.legalEntityId = await insert(
      `INSERT INTO legal_entities (
          tenant_id,
          group_company_id,
          code,
          name,
          country_id,
          functional_currency_code
        )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        context.tenantId,
        context.groupCompanyId,
        `LE_${token}`,
        `Legal Entity ${token}`,
        context.countryId,
        context.currencyCode,
      ]
    );
    context.groupId = await insert(
      `INSERT INTO consolidation_groups (
          tenant_id,
          group_company_id,
          calendar_id,
          code,
          name,
          presentation_currency_code
        )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        context.tenantId,
        context.groupCompanyId,
        context.calendarId,
        `CG_${token}`,
        `Consolidation Group ${token}`,
        context.currencyCode,
      ]
    );
    await query(
      `INSERT INTO consolidation_group_members (
          consolidation_group_id,
          legal_entity_id,
          consolidation_method,
          ownership_pct,
          effective_from,
          effective_to
        )
       VALUES (?, ?, 'FULL', 1.000000, ?, NULL)`,
      [context.groupId, context.legalEntityId, "2026-01-01"]
    );
    context.userId = await insert(
      `INSERT INTO users (tenant_id, email, password_hash, name)
       VALUES (?, ?, ?, ?)`,
      [
        context.tenantId,
        `canonical-followup-${token.toLowerCase()}@example.com`,
        "test-password-hash",
        `Canonical Followup User ${token}`,
      ]
    );
    context.periodId = await insert(
      `INSERT INTO fiscal_periods (
          calendar_id,
          fiscal_year,
          period_no,
          period_name,
          start_date,
          end_date,
          is_adjustment
        )
       VALUES (?, 2026, 3, 'March 2026', '2026-03-01', '2026-03-31', 0)`,
      [context.calendarId]
    );
    context.bookId = await insert(
      `INSERT INTO books (
          tenant_id,
          legal_entity_id,
          calendar_id,
          code,
          name,
          book_type,
          base_currency_code
        )
       VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
      [
        context.tenantId,
        context.legalEntityId,
        context.calendarId,
        `BK_${token}`,
        `Book ${token}`,
        context.currencyCode,
      ]
    );
    context.localCoaId = await insert(
      `INSERT INTO charts_of_accounts (tenant_id, legal_entity_id, scope, code, name)
       VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
      [context.tenantId, context.legalEntityId, `LCOA_${token}`, `Local CoA ${token}`]
    );
    context.groupCoaId = await insert(
      `INSERT INTO charts_of_accounts (tenant_id, legal_entity_id, scope, code, name)
       VALUES (?, NULL, 'GROUP', ?, ?)`,
      [context.tenantId, `GCOA_${token}`, `Group CoA ${token}`]
    );
    await query(
      `INSERT INTO group_coa_mappings (
          tenant_id,
          consolidation_group_id,
          legal_entity_id,
          group_coa_id,
          local_coa_id,
          status
        )
       VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        context.tenantId,
        context.groupId,
        context.legalEntityId,
        context.groupCoaId,
        context.localCoaId,
      ]
    );

    context.reactivationAccountId = await insert(
      `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id,
          is_active
        )
       VALUES (?, ?, ?, 'REVENUE', 'CREDIT', TRUE, NULL, TRUE)`,
      [context.localCoaId, "410.001", `Reactivation Account ${token}`]
    );
    context.governanceAccountId = await insert(
      `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id,
          is_active
        )
       VALUES (?, ?, ?, 'EXPENSE', 'DEBIT', TRUE, NULL, TRUE)`,
      [context.localCoaId, "420.001", `Governance Account ${token}`]
    );
    context.offsetAccountId = await insert(
      `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id,
          is_active
        )
       VALUES (?, ?, ?, 'LIABILITY', 'CREDIT', TRUE, NULL, TRUE)`,
      [context.localCoaId, "299.999", `Offset Account ${token}`]
    );

    context.reactivationKeyId = await insert(
      `INSERT INTO consolidation_canonical_keys (
          tenant_id,
          consolidation_group_id,
          canonical_key,
          canonical_name,
          canonical_type,
          status
        )
       VALUES (?, ?, ?, ?, 'ACCOUNT', 'INACTIVE')`,
      [
        context.tenantId,
        context.groupId,
        "FOLLOWUP_REACT",
        `Followup React ${token}`,
      ]
    );
    await query(
      `INSERT INTO consolidation_canonical_local_account_mappings (
          tenant_id,
          consolidation_group_id,
          legal_entity_id,
          local_account_id,
          canonical_key_id,
          status,
          effective_from,
          effective_to
        )
       VALUES (?, ?, ?, ?, ?, 'INACTIVE', '2026-01-01', NULL)`,
      [
        context.tenantId,
        context.groupId,
        context.legalEntityId,
        context.reactivationAccountId,
        context.reactivationKeyId,
      ]
    );

    const preview = await previewCanonicalMappingRule({
      tenantId: context.tenantId,
      consolidationGroupId: context.groupId,
      legalEntityId: context.legalEntityId,
      ruleType: "CODE_PREFIX",
      codePrefix: "410.",
      canonicalKey: "FOLLOWUP_REACT",
      canonicalName: `Followup React ${token}`,
      effectiveFrom: "2026-03-01",
    });
    const reactivationPreviewRow = (preview.rows || []).find(
      (row) => Number(row?.localAccountId) === context.reactivationAccountId
    );
    assert(reactivationPreviewRow, "reactivation preview row must be present");
    assert(
      reactivationPreviewRow.classification === "READY_TO_APPLY",
      "inactive same-key local mapping must preview as READY_TO_APPLY"
    );
    assert(
      Number(preview?.summary?.conflictCount || 0) === 0,
      "reactivation preview must not report a conflict"
    );

    const applyResult = await applyCanonicalMappingRule({
      tenantId: context.tenantId,
      consolidationGroupId: context.groupId,
      legalEntityId: context.legalEntityId,
      ruleType: "CODE_PREFIX",
      codePrefix: "410.",
      canonicalKey: "FOLLOWUP_REACT",
      canonicalName: `Followup React ${token}`,
      effectiveFrom: "2026-03-01",
      changeReason: "Regression test local reactivation",
      changeSource: "TEST_CBR06",
    });
    assert(
      Number(applyResult?.updatedLocalMappings || 0) === 1,
      "reactivation apply must update the existing local mapping"
    );
    const reactivatedMapping = await query(
      `SELECT status, effective_from, effective_to
       FROM consolidation_canonical_local_account_mappings
       WHERE tenant_id = ?
         AND consolidation_group_id = ?
         AND legal_entity_id = ?
         AND local_account_id = ?`,
      [
        context.tenantId,
        context.groupId,
        context.legalEntityId,
        context.reactivationAccountId,
      ]
    );
    assert(
      String(reactivatedMapping.rows?.[0]?.status || "") === "ACTIVE",
      "reactivation apply must reactivate the local mapping row"
    );
    const reactivatedKey = await query(
      `SELECT status
       FROM consolidation_canonical_keys
       WHERE id = ?`,
      [context.reactivationKeyId]
    );
    assert(
      String(reactivatedKey.rows?.[0]?.status || "") === "ACTIVE",
      "reactivation apply must reactivate the canonical key row"
    );

    context.savedRuleMatchKeyId = await insert(
      `INSERT INTO consolidation_canonical_keys (
          tenant_id,
          consolidation_group_id,
          canonical_key,
          canonical_name,
          canonical_type,
          status
        )
       VALUES (?, ?, ?, ?, 'ACCOUNT', 'ACTIVE')`,
      [
        context.tenantId,
        context.groupId,
        "FOLLOWUP_RULE_MATCH",
        `Followup Rule Match ${token}`,
      ]
    );
    context.savedRuleNoiseKeyId = await insert(
      `INSERT INTO consolidation_canonical_keys (
          tenant_id,
          consolidation_group_id,
          canonical_key,
          canonical_name,
          canonical_type,
          status
        )
       VALUES (?, ?, ?, ?, 'ACCOUNT', 'ACTIVE')`,
      [
        context.tenantId,
        context.groupId,
        "FOLLOWUP_RULE_NOISE",
        `Followup Rule Noise ${token}`,
      ]
    );
    context.matchingRuleId = await insert(
      `INSERT INTO consolidation_canonical_mapping_rules (
          tenant_id,
          consolidation_group_id,
          legal_entity_id,
          rule_type,
          parent_local_account_id,
          code_prefix,
          canonical_key_id,
          group_account_id,
          status,
          effective_from,
          effective_to,
          reason,
          created_by_user_id
        )
       VALUES (?, ?, ?, 'CODE_PREFIX', NULL, ?, ?, NULL, 'ACTIVE', '2026-01-01', NULL, ?, NULL)`,
      [
        context.tenantId,
        context.groupId,
        context.legalEntityId,
        "420.",
        context.savedRuleMatchKeyId,
        "Match rule created before noise rules",
      ]
    );
    for (let index = 0; index < 50; index += 1) {
      const noisePrefix = `ZZ${String(index + 1).padStart(2, "0")}`;
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO consolidation_canonical_mapping_rules (
            tenant_id,
            consolidation_group_id,
            legal_entity_id,
            rule_type,
            parent_local_account_id,
            code_prefix,
            canonical_key_id,
            group_account_id,
            status,
            effective_from,
            effective_to,
            reason,
            created_by_user_id
          )
         VALUES (?, ?, ?, 'CODE_PREFIX', NULL, ?, ?, NULL, 'ACTIVE', '2026-01-01', NULL, ?, NULL)`,
        [
          context.tenantId,
          context.groupId,
          context.legalEntityId,
          noisePrefix,
          context.savedRuleNoiseKeyId,
          `Noise rule ${index + 1}`,
        ]
      );
    }

    context.journalEntryId = await insert(
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
        )
       VALUES (?, ?, ?, ?, ?, 'MANUAL', 'POSTED', '2026-03-10', '2026-03-10', ?, ?, 100.000000, 100.000000, ?, ?, CURRENT_TIMESTAMP)`,
      [
        context.tenantId,
        context.legalEntityId,
        context.bookId,
        context.periodId,
        `JE_${token}`,
        context.currencyCode,
        "Governance saved-rule coverage regression journal",
        context.userId,
        context.userId,
      ]
    );
    await query(
      `INSERT INTO journal_lines (
          journal_entry_id,
          line_no,
          account_id,
          currency_code,
          amount_txn,
          debit_base,
          credit_base
        )
       VALUES
         (?, 1, ?, ?, 100.000000, 100.000000, 0.000000),
         (?, 2, ?, ?, -100.000000, 0.000000, 100.000000)`,
      [
        context.journalEntryId,
        context.governanceAccountId,
        context.currencyCode,
        context.journalEntryId,
        context.offsetAccountId,
        context.currencyCode,
      ]
    );

    const review = await getCanonicalMappingGovernanceReview({
      tenantId: context.tenantId,
      consolidationGroupId: context.groupId,
      fromDate: "2026-03-01",
      toDate: "2026-03-31",
      limit: 200,
    });
    assert(
      Number(review?.summary?.activeSavedRuleCount || 0) === 51,
      "governance review must report all 51 active saved rules"
    );
    const governanceRow = (review.unmappedPostedAccounts || []).find(
      (row) => Number(row?.localAccountId) === context.governanceAccountId
    );
    assert(governanceRow, "governance review must include the unmapped posted account");
    const matchingSavedRule = (governanceRow.savedRuleMatches || []).find(
      (row) => Number(row?.ruleId) === context.matchingRuleId
    );
    assert(
      matchingSavedRule,
      "governance review must include saved-rule coverage from active rules beyond the old 50-rule cap"
    );
    assert(
      Number(review?.summary?.unmappedPostedAccountSampleCoveredBySavedRulesCount || 0) >= 1,
      "governance summary must count saved-rule-covered unmapped posted accounts"
    );

    console.log("CBR06 follow-up regression checks passed.");
  } finally {
    try {
      await cleanup(context);
    } finally {
      await closePool();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
