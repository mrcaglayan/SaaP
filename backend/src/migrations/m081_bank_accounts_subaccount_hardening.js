const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasForeignKey(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
       AND constraint_type = 'FOREIGN KEY'
     LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasDuplicateIbanRows(connection) {
  const [rows] = await connection.execute(
    `SELECT tenant_id, legal_entity_id, iban, COUNT(*) AS row_count
     FROM bank_accounts
     WHERE iban IS NOT NULL
       AND TRIM(iban) <> ''
     GROUP BY tenant_id, legal_entity_id, iban
     HAVING COUNT(*) > 1
     LIMIT 1`
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function hasDuplicateFallbackAccountNoRows(connection) {
  const [rows] = await connection.execute(
    `SELECT tenant_id, legal_entity_id, account_no, COUNT(*) AS row_count
     FROM bank_accounts
     WHERE (iban IS NULL OR TRIM(iban) = '')
       AND account_no IS NOT NULL
       AND TRIM(account_no) <> ''
     GROUP BY tenant_id, legal_entity_id, account_no
     HAVING COUNT(*) > 1
     LIMIT 1`
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

const migration081BankAccountsSubaccountHardening = {
  key: "m081_bank_accounts_subaccount_hardening",
  description:
    "Add bank account OU ownership and identity uniqueness hardening for subaccounts rollout (F02)",
  async up(connection) {
    if (!(await hasColumn(connection, "bank_accounts", "operating_unit_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE bank_accounts
         ADD COLUMN operating_unit_id BIGINT UNSIGNED NULL
         AFTER legal_entity_id`
      );
    }

    if (!(await hasIndex(connection, "bank_accounts", "ix_bank_accounts_scope_ou_active"))) {
      await safeExecute(
        connection,
        `ALTER TABLE bank_accounts
         ADD KEY ix_bank_accounts_scope_ou_active (
           tenant_id,
           legal_entity_id,
           operating_unit_id,
           is_active
         )`
      );
    }

    if (!(await hasForeignKey(connection, "bank_accounts", "fk_bank_accounts_operating_unit"))) {
      await safeExecute(
        connection,
        `ALTER TABLE bank_accounts
         ADD CONSTRAINT fk_bank_accounts_operating_unit
           FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)`
      );
    }

    const duplicateIban = await hasDuplicateIbanRows(connection);
    if (duplicateIban) {
      throw new Error(
        `m081 cannot add IBAN uniqueness due to duplicate values: tenant_id=${duplicateIban.tenant_id}, legal_entity_id=${duplicateIban.legal_entity_id}, iban=${duplicateIban.iban}`
      );
    }
    const duplicateFallbackAccountNo = await hasDuplicateFallbackAccountNoRows(connection);
    if (duplicateFallbackAccountNo) {
      throw new Error(
        `m081 cannot add fallback account_no uniqueness due to duplicate values: tenant_id=${duplicateFallbackAccountNo.tenant_id}, legal_entity_id=${duplicateFallbackAccountNo.legal_entity_id}, account_no=${duplicateFallbackAccountNo.account_no}`
      );
    }

    if (!(await hasColumn(connection, "bank_accounts", "identity_account_no_fallback"))) {
      await safeExecute(
        connection,
        `ALTER TABLE bank_accounts
         ADD COLUMN identity_account_no_fallback VARCHAR(80)
         GENERATED ALWAYS AS (
           CASE
             WHEN iban IS NULL OR TRIM(iban) = '' THEN account_no
             ELSE NULL
           END
         ) STORED`
      );
    }

    if (!(await hasIndex(connection, "bank_accounts", "uk_bank_accounts_entity_iban"))) {
      await safeExecute(
        connection,
        `ALTER TABLE bank_accounts
         ADD UNIQUE KEY uk_bank_accounts_entity_iban (tenant_id, legal_entity_id, iban)`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "bank_accounts",
        "uk_bank_accounts_entity_account_no_fallback"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE bank_accounts
         ADD UNIQUE KEY uk_bank_accounts_entity_account_no_fallback (
           tenant_id,
           legal_entity_id,
           identity_account_no_fallback
         )`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive hardening.
  },
};

export default migration081BankAccountsSubaccountHardening;
