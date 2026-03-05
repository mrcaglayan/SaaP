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

const triggerDropStatements = [
  "DROP TRIGGER IF EXISTS trg_cari_open_items_bi_guard",
  "DROP TRIGGER IF EXISTS trg_cari_open_items_bu_guard",
  "DROP TRIGGER IF EXISTS trg_cari_allocations_bi_guard",
  "DROP TRIGGER IF EXISTS trg_cari_allocations_bu_guard",
];

const migration100CariCheckConstraintCompatGuardCleanup = {
  key: "m100_cari_check_constraint_compat_guard_cleanup",
  description:
    "Drop legacy Cari CHECK-compat triggers when server natively enforces CHECK constraints",
  async up(connection) {
    const [rows] = await connection.execute(`SELECT VERSION() AS version`);
    const versionText = rows?.[0]?.version || "";
    if (!supportsEnforcedChecks(versionText)) {
      return;
    }
    for (const statement of triggerDropStatements) {
      // eslint-disable-next-line no-await-in-loop
      await runSql(connection, statement);
    }
  },
  async down(_connection) {
    // No-op rollback; compat triggers are managed by m099 for older engines.
  },
};

export default migration100CariCheckConstraintCompatGuardCleanup;
