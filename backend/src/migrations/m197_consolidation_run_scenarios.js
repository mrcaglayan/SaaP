/**
 * m197 - Consolidation run scenarios / versions.
 *
 * Adds additive PR-09 scenario distinction on top of the existing
 * consolidation run-name identity so OFFICIAL close-cycle governance remains
 * anchored to `run_name = OFFICIAL`.
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

const addScenarioCodeColumnSql = `
  ALTER TABLE consolidation_runs
  ADD COLUMN scenario_code ENUM(
    'TRIAL',
    'OFFICIAL',
    'RESTATED',
    'SIMULATION'
  ) NOT NULL DEFAULT 'OFFICIAL' AFTER run_name
`;

const addVersionNoColumnSql = `
  ALTER TABLE consolidation_runs
  ADD COLUMN version_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER scenario_code
`;

const addScenarioIndexSql = `
  ALTER TABLE consolidation_runs
  ADD KEY ix_cons_run_scenario (
    consolidation_group_id,
    fiscal_period_id,
    scenario_code,
    version_no
  )
`;

const backfillScenarioCodeSql = `
  UPDATE consolidation_runs
  SET scenario_code = CASE
    WHEN UPPER(TRIM(run_name)) = 'OFFICIAL' THEN 'OFFICIAL'
    WHEN UPPER(TRIM(run_name)) LIKE '%RESTAT%' THEN 'RESTATED'
    WHEN UPPER(TRIM(run_name)) LIKE '%SIMULAT%' THEN 'SIMULATION'
    ELSE 'TRIAL'
  END,
  version_no = CASE
    WHEN version_no IS NULL OR version_no < 1 THEN 1
    ELSE version_no
  END
`;

const migration197ConsolidationRunScenarios = {
  key: "m197_consolidation_run_scenarios",
  description:
    "Add additive consolidation run scenario and version metadata for PR-09 dashboards.",
  async up(connection) {
    await safeExecute(connection, addScenarioCodeColumnSql);
    await safeExecute(connection, addVersionNoColumnSql);
    await safeExecute(connection, addScenarioIndexSql);
    await connection.execute(backfillScenarioCodeSql);
  },

  async down() {
    // Additive metadata only.
  },
};

export default migration197ConsolidationRunScenarios;
