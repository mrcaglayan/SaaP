const LEGACY_POSTED_JOURNAL_CHECK = "chk_cari_docs_posted_journal_state";

async function safeExecute(connection, sql) {
  try {
    await connection.execute(sql);
  } catch (error) {
    if (Number(error?.errno) === 1091) {
      return;
    }
    throw error;
  }
}

function readShowCreateTableSql(row) {
  if (!row || typeof row !== "object") {
    return "";
  }
  return (
    String(row["Create Table"] || "") ||
    String(row["Create View"] || "") ||
    ""
  );
}

function normalizeCheckClause(checkClause) {
  return String(checkClause || "")
    .replace(/[`"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

async function listCariDocumentChecks(connection) {
  const [rows] = await connection.execute("SHOW CREATE TABLE `cari_documents`");
  const createTableSql = readShowCreateTableSql(rows?.[0]);
  const matches = [];
  const regex =
    /(?:CONSTRAINT `([^`]+)` )?CHECK \(([\s\S]*?)\)(?=,\n  (?:CONSTRAINT|KEY)|\n\)\s*ENGINE)/g;
  let match = regex.exec(createTableSql);
  while (match) {
    matches.push({
      constraintName: String(match[1] || "").trim(),
      checkClause: String(match[2] || "").trim(),
    });
    match = regex.exec(createTableSql);
  }
  return matches;
}

function isLegacyCariPostedJournalCheck(row) {
  const constraintName = String(row?.constraintName || "").trim();
  const normalizedClause = normalizeCheckClause(row?.checkClause);
  return (
    constraintName &&
    constraintName !== LEGACY_POSTED_JOURNAL_CHECK &&
    normalizedClause.includes("STATUS IN") &&
    normalizedClause.includes("POSTED_JOURNAL_ENTRY_ID") &&
    normalizedClause.includes("DRAFT") &&
    normalizedClause.includes("CANCELLED")
  );
}

const migration177CariReviewStateLegacyCheckCleanup = {
  key: "m177_cari_review_state_legacy_check_cleanup",
  description:
    "Drop legacy cari_documents posted-journal checks that still block SUBMITTED/RETURNED/APPROVED review states.",
  async up(connection) {
    const checks = await listCariDocumentChecks(connection);
    for (const row of checks) {
      if (!isLegacyCariPostedJournalCheck(row)) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents DROP CHECK ${row.constraintName}`
      );
    }
  },
  async down() {
    // Additive cleanup only.
  },
};

export default migration177CariReviewStateLegacyCheckCleanup;
