const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1061, // ER_DUP_KEYNAME
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

const migration079IdempotencyKeys = {
  key: "m079_idempotency_keys",
  description: "Shared idempotency key store for standardized risky endpoint replay (CORE02)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         scope_code VARCHAR(80) NOT NULL,
         idempotency_key VARCHAR(190) NOT NULL,
         request_fingerprint CHAR(64) NOT NULL,
         response_status SMALLINT UNSIGNED NOT NULL,
         response_json JSON NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_idempotency_scope_key (scope_code, idempotency_key),
         KEY ix_idempotency_scope_created (scope_code, created_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS idempotency_keys`);
  },
};

export default migration079IdempotencyKeys;
