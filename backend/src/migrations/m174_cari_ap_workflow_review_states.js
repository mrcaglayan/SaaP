import {
  CARI_DOCUMENT_CLASS_WORKFLOW_DEFAULTS,
} from "../../../shared/cariDocumentWorkflowGovernance.js";

const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
  3819, // ER_CHECK_CONSTRAINT_VIOLATED
  3822, // ER_CHECK_CONSTRAINT_DUP_NAME
]);

const CHECK_CARI_DOCS_POSTED_JOURNAL_STATE =
  "chk_cari_docs_posted_journal_state";
const CHECK_CARI_DOCS_RETURN_REASON_REQUIRED =
  "chk_cari_docs_return_reason_required";
const CHECK_CARI_DOC_CLASS_METADATA_AR_NOT_GOVERNED =
  "chk_cari_doc_class_metadata_ar_not_governed";

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
  return Boolean(rows?.[0]);
}

async function hasCheckConstraint(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND constraint_type = 'CHECK'
        AND constraint_name = ?
      LIMIT 1`,
    [tableName, constraintName]
  );
  return Boolean(rows?.[0]);
}

function readShowCreateTableSql(row) {
  return String(
    row?.["Create Table"] ??
      row?.["CREATE TABLE"] ??
      row?.createTable ??
      row?.create_table ??
      ""
  );
}

function normalizeCheckClause(checkClause) {
  return String(checkClause || "")
    .toUpperCase()
    .replace(/`/g, "")
    .replace(/_UTF8MB4/g, "")
    .replace(/\\'/g, "'")
    .replace(/\s+/g, " ");
}

function isPostedJournalCheckClause(checkClause) {
  const normalized = normalizeCheckClause(checkClause);
  return (
    normalized.includes("STATUS IN") &&
    normalized.includes("POSTED_JOURNAL_ENTRY_ID") &&
    /POSTED_JOURNAL_ENTRY_ID\s+IS\s+NOT\s+NULL/.test(normalized) &&
    normalized.includes("POSTED") &&
    normalized.includes("REVERSED") &&
    normalized.includes("DRAFT") &&
    normalized.includes("CANCELLED")
  );
}

async function listCheckConstraintsFromShowCreateTable(connection, tableName) {
  const [rows] = await connection.execute(`SHOW CREATE TABLE \`${tableName}\``);
  const createTableSql = readShowCreateTableSql(rows?.[0]);
  const matches = [];
  const regex =
    /(?:CONSTRAINT `([^`]+)` )?CHECK \(([\s\S]*?)\)(?=,\n  (?:CONSTRAINT|KEY)|\n\)\s*ENGINE)/g;
  let match = regex.exec(createTableSql);
  while (match) {
    matches.push({
      constraint_name: String(match[1] || "").trim(),
      check_clause: String(match[2] || "").trim(),
    });
    match = regex.exec(createTableSql);
  }
  return matches;
}

async function enumColumnIncludesValue(connection, tableName, columnName, enumValue) {
  const [rows] = await connection.execute(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes(`'${String(enumValue || "").trim().toUpperCase()}'`);
}

async function listCheckConstraints(connection, tableName) {
  try {
    const [rows] = await connection.execute(
      `SELECT tc.constraint_name, cc.check_clause
         FROM information_schema.table_constraints tc
         JOIN information_schema.check_constraints cc
           ON cc.constraint_schema = tc.table_schema
          AND cc.constraint_name = tc.constraint_name
        WHERE tc.table_schema = DATABASE()
          AND tc.table_name = ?
          AND tc.constraint_type = 'CHECK'`,
      [tableName]
    );
    return rows || [];
  } catch (err) {
    if (Number(err?.errno) !== 1109) {
      throw err;
    }
    return listCheckConstraintsFromShowCreateTable(connection, tableName);
  }
}

async function dropCariPostedJournalChecks(connection) {
  const checks = await listCheckConstraints(connection, "cari_documents");
  for (const row of checks) {
    const constraintName = String(row?.constraint_name || "").trim();
    const checkClause = String(row?.check_clause || "");
    if (
      !constraintName ||
      !isPostedJournalCheckClause(checkClause)
    ) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await safeExecute(
      connection,
      `ALTER TABLE cari_documents DROP CHECK ${constraintName}`
    );
  }
}

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await hasColumn(connection, tableName, columnName)) {
    return;
  }
  await safeExecute(
    connection,
    `ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`
  );
}

async function seedCariDocumentClassMetadata(connection) {
  for (const row of CARI_DOCUMENT_CLASS_WORKFLOW_DEFAULTS) {
    // eslint-disable-next-line no-await-in-loop
    await connection.execute(
      `INSERT IGNORE INTO cari_document_class_metadata (
          tenant_id,
          direction,
          document_type,
          is_workflow_governed
        )
        SELECT id, ?, ?, ?
          FROM tenants`,
      [
        row.direction,
        row.documentType,
        row.isWorkflowGoverned ? 1 : 0,
      ]
    );
  }
}

const migration174CariApWorkflowReviewStates = {
  key: "m174_cari_ap_workflow_review_states",
  description:
    "Add governed AP review states, return metadata, and tenant doc-class workflow-governance metadata for CARI documents.",
  async up(connection) {
    if (
      !(
        await enumColumnIncludesValue(
          connection,
          "cari_documents",
          "status",
          "SUBMITTED"
        )
      )
    ) {
      await connection.execute(
        `ALTER TABLE cari_documents
           MODIFY COLUMN status ENUM(
             'DRAFT',
             'SUBMITTED',
             'RETURNED',
             'APPROVED',
             'POSTED',
             'PARTIALLY_SETTLED',
             'SETTLED',
             'CANCELLED',
             'REVERSED'
           ) NOT NULL DEFAULT 'DRAFT'`
      );
    }

    await addColumnIfMissing(
      connection,
      "cari_documents",
      "return_reason",
      `return_reason TEXT NULL AFTER status`
    );
    await addColumnIfMissing(
      connection,
      "cari_documents",
      "returned_at",
      `returned_at TIMESTAMP NULL AFTER return_reason`
    );

    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS cari_document_class_metadata (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         direction ENUM('AR','AP') NOT NULL,
         document_type ENUM(
           'INVOICE',
           'DEBIT_NOTE',
           'CREDIT_NOTE',
           'PAYMENT',
           'ADJUSTMENT',
           'OPENING_BALANCE',
           'OTHER'
         ) NOT NULL,
         is_workflow_governed BOOLEAN NOT NULL DEFAULT FALSE,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_cari_doc_class_metadata_tenant_direction_type (
           tenant_id,
           direction,
           document_type
         ),
         KEY ix_cari_doc_class_metadata_tenant_governed (
           tenant_id,
           is_workflow_governed,
           direction,
           document_type
         ),
         CONSTRAINT fk_cari_doc_class_metadata_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT ${CHECK_CARI_DOC_CLASS_METADATA_AR_NOT_GOVERNED}
           CHECK (direction <> 'AR' OR is_workflow_governed = FALSE)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await seedCariDocumentClassMetadata(connection);

    await dropCariPostedJournalChecks(connection);

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_documents",
        CHECK_CARI_DOCS_POSTED_JOURNAL_STATE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
           ADD CONSTRAINT ${CHECK_CARI_DOCS_POSTED_JOURNAL_STATE}
           CHECK (
             (
               status IN ('POSTED','PARTIALLY_SETTLED','SETTLED','REVERSED')
               AND posted_journal_entry_id IS NOT NULL
             )
             OR status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED','CANCELLED')
           )`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_documents",
        CHECK_CARI_DOCS_RETURN_REASON_REQUIRED
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
           ADD CONSTRAINT ${CHECK_CARI_DOCS_RETURN_REASON_REQUIRED}
           CHECK (
             status <> 'RETURNED'
             OR (
               return_reason IS NOT NULL
               AND CHAR_LENGTH(TRIM(return_reason)) > 0
               AND returned_at IS NOT NULL
             )
           )`
      );
    }
  },

  async down() {
    // Additive migration only.
  },
};

export default migration174CariApWorkflowReviewStates;
