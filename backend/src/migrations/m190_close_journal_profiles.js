/**
 * m190 - Governed close-journal profiles foundation.
 *
 * Adds the PR-06 profile catalog that lets the close operating layer define
 * scoped journal-governance families without replacing the existing journal
 * entry and consolidation-adjustment runtimes.
 */

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

const createCloseJournalProfilesTableSql = `
  CREATE TABLE IF NOT EXISTS close_journal_profiles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NULL,
    tenant_scope_key VARCHAR(32)
      GENERATED ALWAYS AS (IFNULL(CONCAT('TENANT:', CAST(tenant_id AS CHAR)), 'GLOBAL'))
      STORED,
    profile_code VARCHAR(96) NOT NULL,
    profile_name VARCHAR(191) NOT NULL,
    journal_family ENUM(
      'LOCAL_ADJUSTMENT',
      'TOPSIDE',
      'ELIMINATION',
      'CONSOLIDATION_ADJUSTMENT',
      'RECLASS',
      'REVERSING',
      'RECURRING'
    ) NOT NULL,
    scope_kind ENUM('GLOBAL','LEGAL_ENTITY','CONSOLIDATION_GROUP') NOT NULL DEFAULT 'GLOBAL',
    legal_entity_id BIGINT UNSIGNED NULL,
    consolidation_group_id BIGINT UNSIGNED NULL,
    status ENUM('ACTIVE','PAUSED','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    description VARCHAR(500) NULL,
    governance_json JSON NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_journal_profiles_scope_code (tenant_scope_key, profile_code),
    KEY ix_close_journal_profiles_lookup (tenant_id, status, journal_family, scope_kind),
    KEY ix_close_journal_profiles_entity_scope (tenant_id, legal_entity_id, status),
    KEY ix_close_journal_profiles_group_scope (tenant_id, consolidation_group_id, status),
    CONSTRAINT fk_close_journal_profiles_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_journal_profiles_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_close_journal_profiles_consolidation_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
    CONSTRAINT fk_close_journal_profiles_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_journal_profiles_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    CHECK (
      (
        scope_kind = 'GLOBAL'
        AND legal_entity_id IS NULL
        AND consolidation_group_id IS NULL
      )
      OR (
        scope_kind = 'LEGAL_ENTITY'
        AND legal_entity_id IS NOT NULL
        AND consolidation_group_id IS NULL
      )
      OR (
        scope_kind = 'CONSOLIDATION_GROUP'
        AND legal_entity_id IS NULL
        AND consolidation_group_id IS NOT NULL
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const seedDefaultCloseJournalProfilesSql = `
  INSERT INTO close_journal_profiles (
    tenant_id,
    profile_code,
    profile_name,
    journal_family,
    scope_kind,
    status,
    description,
    governance_json
  )
  VALUES
    (
      NULL,
      'LOCAL_ADJUSTMENT_DEFAULT',
      'Local Adjustment Governance',
      'LOCAL_ADJUSTMENT',
      'GLOBAL',
      'ACTIVE',
      'Baseline governance catalog for local close adjustment journals.',
      JSON_OBJECT(
        'requireCycleLink', TRUE,
        'requirePeriodBinding', TRUE,
        'operatingModelStep', 'PR-06'
      )
    ),
    (
      NULL,
      'TOPSIDE_DEFAULT',
      'Topside Governance',
      'TOPSIDE',
      'GLOBAL',
      'ACTIVE',
      'Baseline governance catalog for group-level topside adjustments.',
      JSON_OBJECT(
        'requireCycleLink', TRUE,
        'requirePeriodBinding', TRUE,
        'operatingModelStep', 'PR-06'
      )
    ),
    (
      NULL,
      'ELIMINATION_DEFAULT',
      'Elimination Governance',
      'ELIMINATION',
      'GLOBAL',
      'ACTIVE',
      'Baseline governance catalog for elimination journals.',
      JSON_OBJECT(
        'requireCycleLink', TRUE,
        'requirePeriodBinding', TRUE,
        'operatingModelStep', 'PR-06'
      )
    ),
    (
      NULL,
      'CONSOLIDATION_ADJUSTMENT_DEFAULT',
      'Consolidation Adjustment Governance',
      'CONSOLIDATION_ADJUSTMENT',
      'GLOBAL',
      'ACTIVE',
      'Baseline governance catalog for governed consolidation adjustment families.',
      JSON_OBJECT(
        'requireCycleLink', TRUE,
        'requirePeriodBinding', TRUE,
        'operatingModelStep', 'PR-06'
      )
    ),
    (
      NULL,
      'RECLASS_DEFAULT',
      'Reclass Governance',
      'RECLASS',
      'GLOBAL',
      'ACTIVE',
      'Baseline governance catalog for close reclassification journals.',
      JSON_OBJECT(
        'requireCycleLink', TRUE,
        'requirePeriodBinding', TRUE,
        'operatingModelStep', 'PR-06'
      )
    ),
    (
      NULL,
      'REVERSING_DEFAULT',
      'Reversing Governance',
      'REVERSING',
      'GLOBAL',
      'ACTIVE',
      'Baseline governance catalog for reversing close entries.',
      JSON_OBJECT(
        'requireCycleLink', TRUE,
        'requirePeriodBinding', TRUE,
        'operatingModelStep', 'PR-06'
      )
    ),
    (
      NULL,
      'RECURRING_DEFAULT',
      'Recurring Governance',
      'RECURRING',
      'GLOBAL',
      'ACTIVE',
      'Baseline governance catalog for recurring close journal families.',
      JSON_OBJECT(
        'requireCycleLink', TRUE,
        'requirePeriodBinding', TRUE,
        'operatingModelStep', 'PR-06'
      )
    )
  ON DUPLICATE KEY UPDATE
    profile_name = VALUES(profile_name),
    journal_family = VALUES(journal_family),
    scope_kind = VALUES(scope_kind),
    status = VALUES(status),
    description = VALUES(description),
    governance_json = VALUES(governance_json)
`;

const migration190CloseJournalProfiles = {
  key: "m190_close_journal_profiles",
  description:
    "Add governed close-journal profile catalog so PR-06 can classify journal families without replacing current runtimes.",
  async up(connection) {
    await safeExecute(connection, createCloseJournalProfilesTableSql);
    await safeExecute(connection, seedDefaultCloseJournalProfilesSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration190CloseJournalProfiles;
