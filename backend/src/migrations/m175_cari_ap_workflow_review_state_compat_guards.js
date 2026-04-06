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

async function runSql(connection, sql) {
  await connection.query(sql);
}

async function shouldInstallCompatGuards(connection) {
  const [rows] = await connection.execute(`SELECT VERSION() AS version`);
  const versionText = rows?.[0]?.version || "";
  return !supportsEnforcedChecks(versionText);
}

const DROP_TRIGGER_STATEMENTS = [
  "DROP TRIGGER IF EXISTS trg_cari_docs_bi_review_guard",
  "DROP TRIGGER IF EXISTS trg_cari_docs_bu_review_guard",
  "DROP TRIGGER IF EXISTS trg_cari_doc_class_metadata_bi_guard",
  "DROP TRIGGER IF EXISTS trg_cari_doc_class_metadata_bu_guard",
];

const CREATE_TRIGGER_STATEMENTS = [
  `
  CREATE TRIGGER trg_cari_docs_bi_review_guard
  BEFORE INSERT ON cari_documents
  FOR EACH ROW
  BEGIN
    IF (
      NEW.status IN ('POSTED','PARTIALLY_SETTLED','SETTLED','REVERSED')
      AND NEW.posted_journal_entry_id IS NULL
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'chk_cari_docs_posted_journal_state violated';
    END IF;

    IF (
      NEW.status = 'RETURNED'
      AND (
        NEW.return_reason IS NULL
        OR CHAR_LENGTH(TRIM(NEW.return_reason)) = 0
        OR NEW.returned_at IS NULL
      )
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'chk_cari_docs_return_reason_required violated';
    END IF;
  END
  `,
  `
  CREATE TRIGGER trg_cari_docs_bu_review_guard
  BEFORE UPDATE ON cari_documents
  FOR EACH ROW
  BEGIN
    IF (
      NEW.status IN ('POSTED','PARTIALLY_SETTLED','SETTLED','REVERSED')
      AND NEW.posted_journal_entry_id IS NULL
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'chk_cari_docs_posted_journal_state violated';
    END IF;

    IF (
      NEW.status = 'RETURNED'
      AND (
        NEW.return_reason IS NULL
        OR CHAR_LENGTH(TRIM(NEW.return_reason)) = 0
        OR NEW.returned_at IS NULL
      )
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'chk_cari_docs_return_reason_required violated';
    END IF;
  END
  `,
  `
  CREATE TRIGGER trg_cari_doc_class_metadata_bi_guard
  BEFORE INSERT ON cari_document_class_metadata
  FOR EACH ROW
  BEGIN
    IF (
      NEW.direction = 'AR'
      AND COALESCE(NEW.is_workflow_governed, 0) <> 0
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'chk_cari_doc_class_metadata_ar_not_governed violated';
    END IF;
  END
  `,
  `
  CREATE TRIGGER trg_cari_doc_class_metadata_bu_guard
  BEFORE UPDATE ON cari_document_class_metadata
  FOR EACH ROW
  BEGIN
    IF (
      NEW.direction = 'AR'
      AND COALESCE(NEW.is_workflow_governed, 0) <> 0
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MYSQL_ERRNO = 3819,
            MESSAGE_TEXT = 'chk_cari_doc_class_metadata_ar_not_governed violated';
    END IF;
  END
  `,
];

const migration175CariApWorkflowReviewStateCompatGuards = {
  key: "m175_cari_ap_workflow_review_state_compat_guards",
  description:
    "Install PR-2 CARI workflow-review compat triggers on engines that do not enforce CHECK constraints.",
  async up(connection) {
    const useCompatGuards = await shouldInstallCompatGuards(connection);
    for (const statement of DROP_TRIGGER_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(connection, statement);
    }
    if (!useCompatGuards) {
      return;
    }
    for (const statement of CREATE_TRIGGER_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(connection, statement);
    }
  },
  async down(connection) {
    for (const statement of DROP_TRIGGER_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(connection, statement);
    }
  },
};

export default migration175CariApWorkflowReviewStateCompatGuards;
