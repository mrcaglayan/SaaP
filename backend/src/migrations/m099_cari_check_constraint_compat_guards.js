async function runSql(connection, sql) {
  await connection.query(sql);
}

function parseVersion(versionText) {
  const match = String(versionText || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function supportsEnforcedChecks(versionText) {
  const version = parseVersion(versionText);
  if (!version) {
    return false;
  }
  if (version.major > 8) {
    return true;
  }
  if (version.major < 8) {
    return false;
  }
  if (version.minor > 0) {
    return true;
  }
  return version.patch >= 16;
}

async function shouldInstallCompatGuards(connection) {
  const [rows] = await connection.execute(`SELECT VERSION() AS version`);
  const versionText = rows?.[0]?.version || "";
  return !supportsEnforcedChecks(versionText);
}

const dropStatements = [
  `DROP TRIGGER IF EXISTS trg_cari_open_items_bi_guard`,
  `DROP TRIGGER IF EXISTS trg_cari_open_items_bu_guard`,
  `DROP TRIGGER IF EXISTS trg_cari_allocations_bi_guard`,
  `DROP TRIGGER IF EXISTS trg_cari_allocations_bu_guard`,
];

const createStatements = [
  `
  CREATE TRIGGER trg_cari_open_items_bi_guard
  BEFORE INSERT ON cari_open_items
  FOR EACH ROW
  BEGIN
    IF NEW.item_no <= 0
      OR NEW.original_amount_txn < 0
      OR NEW.original_amount_base < 0
      OR NEW.residual_amount_txn < 0
      OR NEW.residual_amount_base < 0
      OR NEW.settled_amount_txn < 0
      OR NEW.settled_amount_base < 0
      OR NEW.residual_amount_txn > NEW.original_amount_txn
      OR NEW.residual_amount_base > NEW.original_amount_base
      OR NEW.settled_amount_txn > NEW.original_amount_txn
      OR NEW.settled_amount_base > NEW.original_amount_base
      OR NEW.due_date < NEW.document_date
      OR (
        NEW.status = 'SETTLED'
        AND (NEW.residual_amount_txn <> 0 OR NEW.residual_amount_base <> 0)
      )
    THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'cari_open_items check constraint violated';
    END IF;
  END
  `,
  `
  CREATE TRIGGER trg_cari_open_items_bu_guard
  BEFORE UPDATE ON cari_open_items
  FOR EACH ROW
  BEGIN
    IF NEW.item_no <= 0
      OR NEW.original_amount_txn < 0
      OR NEW.original_amount_base < 0
      OR NEW.residual_amount_txn < 0
      OR NEW.residual_amount_base < 0
      OR NEW.settled_amount_txn < 0
      OR NEW.settled_amount_base < 0
      OR NEW.residual_amount_txn > NEW.original_amount_txn
      OR NEW.residual_amount_base > NEW.original_amount_base
      OR NEW.settled_amount_txn > NEW.original_amount_txn
      OR NEW.settled_amount_base > NEW.original_amount_base
      OR NEW.due_date < NEW.document_date
      OR (
        NEW.status = 'SETTLED'
        AND (NEW.residual_amount_txn <> 0 OR NEW.residual_amount_base <> 0)
      )
    THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'cari_open_items check constraint violated';
    END IF;
  END
  `,
  `
  CREATE TRIGGER trg_cari_allocations_bi_guard
  BEFORE INSERT ON cari_settlement_allocations
  FOR EACH ROW
  BEGIN
    IF NEW.allocation_amount_txn <= 0
      OR NEW.allocation_amount_base <= 0
      OR (NEW.apply_idempotency_key IS NOT NULL AND CHAR_LENGTH(NEW.apply_idempotency_key) = 0)
      OR (
        NEW.bank_apply_idempotency_key IS NOT NULL
        AND CHAR_LENGTH(NEW.bank_apply_idempotency_key) = 0
      )
    THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'cari_settlement_allocations check constraint violated';
    END IF;
  END
  `,
  `
  CREATE TRIGGER trg_cari_allocations_bu_guard
  BEFORE UPDATE ON cari_settlement_allocations
  FOR EACH ROW
  BEGIN
    IF NEW.allocation_amount_txn <= 0
      OR NEW.allocation_amount_base <= 0
      OR (NEW.apply_idempotency_key IS NOT NULL AND CHAR_LENGTH(NEW.apply_idempotency_key) = 0)
      OR (
        NEW.bank_apply_idempotency_key IS NOT NULL
        AND CHAR_LENGTH(NEW.bank_apply_idempotency_key) = 0
      )
    THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'cari_settlement_allocations check constraint violated';
    END IF;
  END
  `,
];

const migration099CariCheckConstraintCompatGuards = {
  key: "m099_cari_check_constraint_compat_guards",
  description:
    "Compat guard triggers for Cari amount constraints on MySQL versions that do not enforce CHECK constraints",
  async up(connection) {
    const useCompatGuards = await shouldInstallCompatGuards(connection);
    for (const statement of dropStatements) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(connection, statement);
    }
    if (!useCompatGuards) {
      return;
    }
    for (const statement of createStatements) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(connection, statement);
    }
  },
  async down(connection) {
    for (const statement of dropStatements) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(connection, statement);
    }
  },
};

export default migration099CariCheckConstraintCompatGuards;
