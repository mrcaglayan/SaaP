/**
 * m191 - Governed close-journal templates foundation.
 *
 * Adds the PR-06 template catalog that hangs off close-journal profiles and
 * records whether a governed family already maps to an existing runtime seam
 * or still exists as a catalog-only foundation.
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

const createCloseJournalTemplatesTableSql = `
  CREATE TABLE IF NOT EXISTS close_journal_templates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NULL,
    tenant_scope_key VARCHAR(32)
      GENERATED ALWAYS AS (IFNULL(CONCAT('TENANT:', CAST(tenant_id AS CHAR)), 'GLOBAL'))
      STORED,
    close_journal_profile_id BIGINT UNSIGNED NOT NULL,
    template_code VARCHAR(96) NOT NULL,
    template_name VARCHAR(191) NOT NULL,
    status ENUM('ACTIVE','PAUSED','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    runtime_binding_type ENUM('NONE','GL_SOURCE_TYPE','CONSOLIDATION_ADJUSTMENT_TYPE') NOT NULL DEFAULT 'NONE',
    runtime_binding_code VARCHAR(80) NULL,
    reversal_mode ENUM('NONE','OPTIONAL','REQUIRED') NOT NULL DEFAULT 'NONE',
    requires_cycle_link TINYINT(1) NOT NULL DEFAULT 1,
    requires_period_binding TINYINT(1) NOT NULL DEFAULT 1,
    allow_manual_draft TINYINT(1) NOT NULL DEFAULT 1,
    effective_from DATE NULL,
    effective_to DATE NULL,
    description VARCHAR(500) NULL,
    template_json JSON NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_journal_templates_scope_code (tenant_scope_key, template_code),
    KEY ix_close_journal_templates_profile_status (
      close_journal_profile_id,
      status,
      runtime_binding_type
    ),
    KEY ix_close_journal_templates_binding_lookup (
      tenant_id,
      runtime_binding_type,
      runtime_binding_code,
      status
    ),
    CONSTRAINT fk_close_journal_templates_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_journal_templates_profile
      FOREIGN KEY (close_journal_profile_id) REFERENCES close_journal_profiles(id),
    CONSTRAINT fk_close_journal_templates_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_journal_templates_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    CHECK (
      (
        runtime_binding_type = 'NONE'
        AND runtime_binding_code IS NULL
      )
      OR (
        runtime_binding_type <> 'NONE'
        AND runtime_binding_code IS NOT NULL
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const seedDefaultCloseJournalTemplatesSql = `
  INSERT INTO close_journal_templates (
    tenant_id,
    close_journal_profile_id,
    template_code,
    template_name,
    status,
    runtime_binding_type,
    runtime_binding_code,
    reversal_mode,
    requires_cycle_link,
    requires_period_binding,
    allow_manual_draft,
    description,
    template_json
  )
  SELECT
    NULL,
    p.id,
    seeded.template_code,
    seeded.template_name,
    'ACTIVE',
    seeded.runtime_binding_type,
    seeded.runtime_binding_code,
    seeded.reversal_mode,
    seeded.requires_cycle_link,
    seeded.requires_period_binding,
    seeded.allow_manual_draft,
    seeded.description,
    seeded.template_json
  FROM close_journal_profiles p
  JOIN (
    SELECT
      'LOCAL_ADJUSTMENT_DEFAULT' AS profile_code,
      'LOCAL_ADJUSTMENT_STANDARD' AS template_code,
      'Local Adjustment Standard' AS template_name,
      'GL_SOURCE_TYPE' AS runtime_binding_type,
      'ADJUSTMENT' AS runtime_binding_code,
      'OPTIONAL' AS reversal_mode,
      1 AS requires_cycle_link,
      1 AS requires_period_binding,
      1 AS allow_manual_draft,
      'Standard runtime mapping for local adjustment journals.' AS description,
      JSON_OBJECT('preferredSurface', 'JOURNAL_WORKBENCH') AS template_json
    UNION ALL
    SELECT
      'TOPSIDE_DEFAULT',
      'TOPSIDE_STANDARD',
      'Topside Standard',
      'CONSOLIDATION_ADJUSTMENT_TYPE',
      'TOPSIDE',
      'OPTIONAL',
      1,
      1,
      1,
      'Standard runtime mapping for topside adjustments.',
      JSON_OBJECT('preferredSurface', 'CONSOLIDATION_REPORTS')
    UNION ALL
    SELECT
      'ELIMINATION_DEFAULT',
      'ELIMINATION_STANDARD',
      'Elimination Standard',
      'GL_SOURCE_TYPE',
      'ELIMINATION',
      'OPTIONAL',
      1,
      1,
      0,
      'Standard runtime mapping for elimination journals.',
      JSON_OBJECT('preferredSurface', 'JOURNAL_WORKBENCH')
    UNION ALL
    SELECT
      'CONSOLIDATION_ADJUSTMENT_DEFAULT',
      'CONSOLIDATION_ADJUSTMENT_STANDARD',
      'Consolidation Adjustment Standard',
      'NONE',
      NULL,
      'OPTIONAL',
      1,
      1,
      1,
      'Catalog-only consolidation adjustment governance until a dedicated runtime seam is promoted.',
      JSON_OBJECT('preferredSurface', 'CONSOLIDATION_REPORTS')
    UNION ALL
    SELECT
      'RECLASS_DEFAULT',
      'RECLASS_STANDARD',
      'Reclass Standard',
      'NONE',
      NULL,
      'OPTIONAL',
      1,
      1,
      1,
      'Catalog-only reclass governance until runtime-specific controls are promoted.',
      JSON_OBJECT('preferredSurface', 'JOURNAL_WORKBENCH')
    UNION ALL
    SELECT
      'REVERSING_DEFAULT',
      'REVERSING_STANDARD',
      'Reversing Standard',
      'NONE',
      NULL,
      'REQUIRED',
      1,
      1,
      1,
      'Catalog-only reversing-entry governance foundation.',
      JSON_OBJECT('preferredSurface', 'JOURNAL_WORKBENCH')
    UNION ALL
    SELECT
      'RECURRING_DEFAULT',
      'RECURRING_STANDARD',
      'Recurring Standard',
      'NONE',
      NULL,
      'NONE',
      1,
      1,
      1,
      'Catalog-only recurring-entry governance foundation.',
      JSON_OBJECT('preferredSurface', 'JOURNAL_WORKBENCH')
  ) seeded
    ON seeded.profile_code = p.profile_code
  ON DUPLICATE KEY UPDATE
    close_journal_profile_id = VALUES(close_journal_profile_id),
    template_name = VALUES(template_name),
    status = VALUES(status),
    runtime_binding_type = VALUES(runtime_binding_type),
    runtime_binding_code = VALUES(runtime_binding_code),
    reversal_mode = VALUES(reversal_mode),
    requires_cycle_link = VALUES(requires_cycle_link),
    requires_period_binding = VALUES(requires_period_binding),
    allow_manual_draft = VALUES(allow_manual_draft),
    description = VALUES(description),
    template_json = VALUES(template_json)
`;

const migration191CloseJournalTemplates = {
  key: "m191_close_journal_templates",
  description:
    "Add governed close-journal templates so PR-06 can catalog runtime-mapped and catalog-only journal foundations.",
  async up(connection) {
    await safeExecute(connection, createCloseJournalTemplatesTableSql);
    await safeExecute(connection, seedDefaultCloseJournalTemplatesSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration191CloseJournalTemplates;
