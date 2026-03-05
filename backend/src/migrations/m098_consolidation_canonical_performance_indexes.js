const ignorableErrnos = new Set([
  1061, // ER_DUP_KEYNAME
]);

async function safeExecute(connection, sql) {
  try {
    await connection.execute(sql);
  } catch (err) {
    if (ignorableErrnos.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const statements = [
  `
  ALTER TABLE journal_entries
  ADD KEY ix_journal_tenant_entity_period_status_entry (
    tenant_id,
    legal_entity_id,
    fiscal_period_id,
    status,
    entry_date,
    id
  )
  `,
  `
  ALTER TABLE journal_lines
  ADD KEY ix_journal_lines_entry_account (
    journal_entry_id,
    account_id
  )
  `,
  `
  ALTER TABLE group_coa_mappings
  ADD KEY ix_group_coa_map_scope_status (
    tenant_id,
    consolidation_group_id,
    status,
    legal_entity_id,
    group_coa_id,
    local_coa_id
  )
  `,
  `
  ALTER TABLE accounts
  ADD KEY ix_accounts_coa_active_code (
    coa_id,
    is_active,
    code,
    id
  )
  `,
  `
  ALTER TABLE consolidation_canonical_local_account_mappings
  ADD KEY ix_cons_local_scope_status_effective (
    tenant_id,
    consolidation_group_id,
    legal_entity_id,
    local_account_id,
    status,
    effective_from,
    effective_to,
    canonical_key_id
  )
  `,
  `
  ALTER TABLE consolidation_canonical_group_account_mappings
  ADD KEY ix_cons_group_scope_status_effective (
    tenant_id,
    consolidation_group_id,
    canonical_key_id,
    status,
    effective_from,
    effective_to,
    group_account_id
  )
  `,
  `
  ALTER TABLE audit_logs
  ADD KEY ix_audit_tenant_action_scope_time (
    tenant_id,
    action,
    scope_type,
    scope_id,
    created_at,
    id
  )
  `,
];

const migration098ConsolidationCanonicalPerformanceIndexes = {
  key: "m098_consolidation_canonical_performance_indexes",
  description:
    "Performance index coverage for consolidation canonical execute/report/governance hot paths (FUP-CM07)",
  async up(connection) {
    for (const statement of statements) {
      // eslint-disable-next-line no-await-in-loop
      await safeExecute(connection, statement);
    }
  },
  async down(_connection) {
    // Additive index hardening; keep no-op rollback for safety.
  },
};

export default migration098ConsolidationCanonicalPerformanceIndexes;
