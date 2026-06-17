/**
 * m206 - Nullable legacy legal-entity scope for generic evidence/comments.
 *
 * Completes the Option A path from PR-CTM-01: `scope_type/scope_id/scope_key`
 * become authoritative for generic close-task evidence and comments, while
 * existing legal-entity routes keep working through their explicit filters.
 */

const IGNORABLE_ERRNOS = new Set([
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

async function getColumnMetadata(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName],
  );
  return rows?.[0] || null;
}

async function isColumnNullable(connection, tableName, columnName) {
  const metadata = await getColumnMetadata(connection, tableName, columnName);
  return String(metadata?.is_nullable || "").toUpperCase() === "YES";
}

const dropEvidenceLegalEntityForeignKeySql = `
  ALTER TABLE evidence_objects
  DROP FOREIGN KEY fk_evidence_objects_legal_entity
`;

const makeEvidenceLegalEntityNullableSql = `
  ALTER TABLE evidence_objects
  MODIFY COLUMN legal_entity_id BIGINT UNSIGNED NULL
`;

const restoreEvidenceLegalEntityForeignKeySql = `
  ALTER TABLE evidence_objects
  ADD CONSTRAINT fk_evidence_objects_legal_entity
    FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id)
`;

const makeInternalCommentsLegalEntityNullableSql = `
  ALTER TABLE internal_comments
  MODIFY COLUMN legal_entity_id BIGINT UNSIGNED NULL
`;

const migration206EvidenceCommentsNullableLegalEntityScope = {
  key: "m206_evidence_comments_nullable_legal_entity_scope",
  description:
    "Make legacy legal_entity_id nullable for generic close task evidence/comment scopes.",
  async up(connection) {
    if (!(await isColumnNullable(connection, "evidence_objects", "legal_entity_id"))) {
      await safeExecute(connection, dropEvidenceLegalEntityForeignKeySql);
      await safeExecute(connection, makeEvidenceLegalEntityNullableSql);
      await safeExecute(connection, restoreEvidenceLegalEntityForeignKeySql);
    }

    if (!(await isColumnNullable(connection, "internal_comments", "legal_entity_id"))) {
      await safeExecute(connection, makeInternalCommentsLegalEntityNullableSql);
    }
  },

  async down() {
    // Additive compatibility relaxation only.
  },
};

export default migration206EvidenceCommentsNullableLegalEntityScope;
