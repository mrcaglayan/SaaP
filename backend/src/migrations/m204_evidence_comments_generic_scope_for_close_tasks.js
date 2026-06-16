/**
 * m204 - Generic evidence/comment scope for close tasks.
 *
 * Adds additive generic scope columns for close task evidence and comments.
 * Existing legal-entity scoped routes remain compatible because
 * `legal_entity_id` stays required in this step.
 */

const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
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

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName],
  );
  return Boolean(rows?.[0]);
}

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await columnExists(connection, tableName, columnName)) {
    return;
  }
  await safeExecute(connection, `ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

const migration204EvidenceCommentsGenericScopeForCloseTasks = {
  key: "m204_evidence_comments_generic_scope_for_close_tasks",
  description:
    "Add generic scope columns to evidence and internal comments for close task source references.",
  async up(connection) {
    await addColumnIfMissing(
      connection,
      "evidence_objects",
      "scope_type",
      "scope_type VARCHAR(40) NULL AFTER legal_entity_id",
    );
    await addColumnIfMissing(
      connection,
      "evidence_objects",
      "scope_id",
      "scope_id BIGINT UNSIGNED NULL AFTER scope_type",
    );
    await addColumnIfMissing(
      connection,
      "evidence_objects",
      "scope_key",
      "scope_key VARCHAR(120) NULL AFTER scope_id",
    );
    await safeExecute(
      connection,
      `UPDATE evidence_objects
          SET scope_type = COALESCE(scope_type, 'LEGAL_ENTITY'),
              scope_id = COALESCE(scope_id, legal_entity_id),
              scope_key = COALESCE(scope_key, CONCAT('LEGAL_ENTITY:', legal_entity_id))
        WHERE legal_entity_id IS NOT NULL
          AND (scope_type IS NULL OR scope_id IS NULL OR scope_key IS NULL)`,
    );
    await safeExecute(
      connection,
      `ALTER TABLE evidence_objects
         ADD KEY ix_evidence_objects_generic_scope_source (
           tenant_id,
           scope_type,
           scope_id,
           source_ref_type,
           source_ref_id,
           status,
           created_at
         )`,
    );

    await addColumnIfMissing(
      connection,
      "internal_comments",
      "scope_type",
      "scope_type VARCHAR(40) NULL AFTER legal_entity_id",
    );
    await addColumnIfMissing(
      connection,
      "internal_comments",
      "scope_id",
      "scope_id BIGINT UNSIGNED NULL AFTER scope_type",
    );
    await addColumnIfMissing(
      connection,
      "internal_comments",
      "scope_key",
      "scope_key VARCHAR(120) NULL AFTER scope_id",
    );
    await safeExecute(
      connection,
      `UPDATE internal_comments
          SET scope_type = COALESCE(scope_type, 'LEGAL_ENTITY'),
              scope_id = COALESCE(scope_id, legal_entity_id),
              scope_key = COALESCE(scope_key, CONCAT('LEGAL_ENTITY:', legal_entity_id))
        WHERE legal_entity_id IS NOT NULL
          AND (scope_type IS NULL OR scope_id IS NULL OR scope_key IS NULL)`,
    );
    await safeExecute(
      connection,
      `ALTER TABLE internal_comments
         ADD KEY ix_internal_comments_generic_scope (
           tenant_id,
           scope_type,
           scope_id,
           source_ref_type,
           source_ref_id,
           status,
           id
         )`,
    );
  },

  async down() {
    // Additive compatibility metadata only.
  },
};

export default migration204EvidenceCommentsGenericScopeForCloseTasks;
