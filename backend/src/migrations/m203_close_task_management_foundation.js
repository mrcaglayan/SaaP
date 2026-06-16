/**
 * m203 - Close checklist task management foundation.
 *
 * Adds the PR-CTM-01 task template, task instance, task evidence, and task
 * event tables. The tables intentionally separate RBAC scope from close-work
 * scope so checklist work can sit above existing close cycle objects without
 * becoming a second close engine.
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

const createCloseTaskTemplatesTableSql = `
  CREATE TABLE IF NOT EXISTS close_task_templates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NULL,
    tenant_scope_key VARCHAR(80) NOT NULL DEFAULT 'GLOBAL',
    task_code VARCHAR(96) NOT NULL,
    task_name VARCHAR(191) NOT NULL,
    task_description VARCHAR(1000) NULL,
    task_family VARCHAR(64) NOT NULL DEFAULT 'MANUAL',
    cycle_scope_kind ENUM('ANY','LEGAL_ENTITY','CONSOLIDATION_GROUP') NOT NULL DEFAULT 'ANY',
    default_rbac_scope_type ENUM('OPERATING_UNIT','LEGAL_ENTITY','COUNTRY','GROUP') NOT NULL DEFAULT 'LEGAL_ENTITY',
    default_work_scope_type ENUM(
      'CYCLE',
      'BOOK',
      'CENTRAL',
      'OPERATING_UNIT',
      'LOCAL_CLOSE_PACK',
      'PERIOD_CLOSE_RUN',
      'CONSOLIDATION_GROUP'
    ) NOT NULL DEFAULT 'CYCLE',
    anchor_item_type ENUM('ANY','LOCAL_CLOSE_PACK','PERIOD_CLOSE_RUN','CONSOLIDATION_RUN') NOT NULL DEFAULT 'ANY',
    materialization_mode ENUM('CYCLE','ITEM','MANUAL_ONLY') NOT NULL DEFAULT 'CYCLE',
    completion_mode ENUM(
      'MANUAL',
      'MANUAL_WITH_EVIDENCE',
      'SYSTEM_CHECK',
      'SOURCE_STATUS',
      'HYBRID_REVIEW'
    ) NOT NULL,
    source_check_code VARCHAR(96) NULL,
    source_ref_type VARCHAR(80) NULL,
    source_ref_id_strategy VARCHAR(96) NULL,
    auto_complete_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    default_due_offset_days INT NOT NULL DEFAULT 0,
    evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
    required_for_cycle_lock BOOLEAN NOT NULL DEFAULT FALSE,
    default_owner_strategy ENUM(
      'CYCLE_OWNER',
      'ITEM_OWNER',
      'LOCAL_CLOSE_PACK_OWNER',
      'MANUAL'
    ) NOT NULL DEFAULT 'CYCLE_OWNER',
    default_reviewer_strategy ENUM(
      'CYCLE_OWNER',
      'LOCAL_CLOSE_PACK_REVIEWER',
      'MANUAL'
    ) NOT NULL DEFAULT 'CYCLE_OWNER',
    blocker_class VARCHAR(80) NULL,
    sort_order INT NOT NULL DEFAULT 1000,
    status ENUM('ACTIVE','PAUSED','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    config_json JSON NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_task_templates_scope_code (tenant_scope_key, task_code),
    KEY ix_close_task_templates_cycle_anchor (tenant_id, status, cycle_scope_kind, anchor_item_type),
    KEY ix_close_task_templates_rbac_anchor (tenant_id, status, default_rbac_scope_type, anchor_item_type),
    KEY ix_close_task_templates_family_status (tenant_id, task_family, status),
    CONSTRAINT fk_close_task_templates_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_task_templates_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_templates_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const createCloseTaskInstancesTableSql = `
  CREATE TABLE IF NOT EXISTS close_task_instances (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    close_cycle_item_id BIGINT UNSIGNED NULL,
    close_task_template_id BIGINT UNSIGNED NULL,
    fiscal_period_id BIGINT UNSIGNED NOT NULL,
    task_key VARCHAR(191) NOT NULL,
    task_code VARCHAR(96) NOT NULL,
    task_name VARCHAR(191) NOT NULL,
    task_description VARCHAR(1000) NULL,
    task_family VARCHAR(64) NOT NULL DEFAULT 'MANUAL',
    completion_mode ENUM(
      'MANUAL',
      'MANUAL_WITH_EVIDENCE',
      'SYSTEM_CHECK',
      'SOURCE_STATUS',
      'HYBRID_REVIEW'
    ) NOT NULL,
    rbac_scope_type ENUM('OPERATING_UNIT','LEGAL_ENTITY','COUNTRY','GROUP') NOT NULL,
    rbac_scope_id BIGINT UNSIGNED NOT NULL,
    rbac_scope_key VARCHAR(120) NOT NULL,
    work_scope_type ENUM(
      'CYCLE',
      'BOOK',
      'CENTRAL',
      'OPERATING_UNIT',
      'LOCAL_CLOSE_PACK',
      'PERIOD_CLOSE_RUN',
      'CONSOLIDATION_GROUP'
    ) NOT NULL,
    work_scope_id BIGINT UNSIGNED NULL,
    work_scope_key VARCHAR(160) NOT NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    book_id BIGINT UNSIGNED NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    country_id BIGINT UNSIGNED NULL,
    group_company_id BIGINT UNSIGNED NULL,
    consolidation_group_id BIGINT UNSIGNED NULL,
    owner_user_id INT NULL,
    reviewer_user_id INT NULL,
    due_at TIMESTAMP NULL DEFAULT NULL,
    status ENUM(
      'NOT_STARTED',
      'IN_PROGRESS',
      'SUBMITTED',
      'RETURNED',
      'APPROVED',
      'WAIVED',
      'CANCELLED'
    ) NOT NULL DEFAULT 'NOT_STARTED',
    evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
    required_for_cycle_lock BOOLEAN NOT NULL DEFAULT FALSE,
    blocker_class VARCHAR(80) NULL,
    source_check_code VARCHAR(96) NULL,
    source_ref_type VARCHAR(80) NULL,
    source_ref_id BIGINT UNSIGNED NULL,
    source_check_status VARCHAR(60) NULL,
    source_checked_at TIMESTAMP NULL DEFAULT NULL,
    source_check_payload_json JSON NULL,
    submitted_by_user_id INT NULL,
    submitted_at TIMESTAMP NULL DEFAULT NULL,
    reviewed_by_user_id INT NULL,
    reviewed_at TIMESTAMP NULL DEFAULT NULL,
    return_reason VARCHAR(1000) NULL,
    waiver_reason VARCHAR(1000) NULL,
    waived_by_user_id INT NULL,
    waived_at TIMESTAMP NULL DEFAULT NULL,
    cancel_reason VARCHAR(1000) NULL,
    cancelled_by_user_id INT NULL,
    cancelled_at TIMESTAMP NULL DEFAULT NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_task_instances_cycle_key (tenant_id, close_cycle_id, task_key),
    KEY ix_close_task_instances_cycle_status_due (tenant_id, close_cycle_id, status, due_at),
    KEY ix_close_task_instances_owner_status_due (tenant_id, owner_user_id, status, due_at),
    KEY ix_close_task_instances_reviewer_status_due (tenant_id, reviewer_user_id, status, due_at),
    KEY ix_close_task_instances_rbac_period (tenant_id, rbac_scope_type, rbac_scope_id, fiscal_period_id),
    KEY ix_close_task_instances_work_period (tenant_id, work_scope_type, work_scope_id, fiscal_period_id),
    KEY ix_close_task_instances_entity_book_period (tenant_id, legal_entity_id, book_id, fiscal_period_id),
    KEY ix_close_task_instances_source_ref (tenant_id, source_ref_type, source_ref_id),
    KEY ix_close_task_instances_item_status (tenant_id, close_cycle_item_id, status),
    KEY ix_close_task_instances_lock_status (tenant_id, required_for_cycle_lock, status),
    CONSTRAINT fk_close_task_instances_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_task_instances_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_task_instances_cycle_item
      FOREIGN KEY (close_cycle_item_id) REFERENCES close_cycle_items(id),
    CONSTRAINT fk_close_task_instances_template
      FOREIGN KEY (close_task_template_id) REFERENCES close_task_templates(id),
    CONSTRAINT fk_close_task_instances_period
      FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
    CONSTRAINT fk_close_task_instances_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_close_task_instances_book
      FOREIGN KEY (book_id) REFERENCES books(id),
    CONSTRAINT fk_close_task_instances_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_close_task_instances_country
      FOREIGN KEY (country_id) REFERENCES countries(id),
    CONSTRAINT fk_close_task_instances_group_company
      FOREIGN KEY (group_company_id) REFERENCES group_companies(id),
    CONSTRAINT fk_close_task_instances_consolidation_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
    CONSTRAINT fk_close_task_instances_owner_user
      FOREIGN KEY (owner_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_instances_reviewer_user
      FOREIGN KEY (reviewer_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_instances_submitted_by_user
      FOREIGN KEY (submitted_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_instances_reviewed_by_user
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_instances_waived_by_user
      FOREIGN KEY (waived_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_instances_cancelled_by_user
      FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_instances_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_instances_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const createCloseTaskEvidenceTableSql = `
  CREATE TABLE IF NOT EXISTS close_task_evidence (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_task_instance_id BIGINT UNSIGNED NOT NULL,
    evidence_object_id BIGINT UNSIGNED NOT NULL,
    status ENUM('ACTIVE','REMOVED') NOT NULL DEFAULT 'ACTIVE',
    attached_by_user_id INT NULL,
    attached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_by_user_id INT NULL,
    removed_at TIMESTAMP NULL DEFAULT NULL,
    remove_reason VARCHAR(1000) NULL,
    UNIQUE KEY uk_close_task_evidence_task_object (tenant_id, close_task_instance_id, evidence_object_id),
    KEY ix_close_task_evidence_task_status (tenant_id, close_task_instance_id, status),
    KEY ix_close_task_evidence_object (tenant_id, evidence_object_id),
    CONSTRAINT fk_close_task_evidence_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_task_evidence_task
      FOREIGN KEY (close_task_instance_id) REFERENCES close_task_instances(id),
    CONSTRAINT fk_close_task_evidence_object
      FOREIGN KEY (evidence_object_id) REFERENCES evidence_objects(id),
    CONSTRAINT fk_close_task_evidence_attached_by_user
      FOREIGN KEY (attached_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_task_evidence_removed_by_user
      FOREIGN KEY (removed_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const createCloseTaskEventsTableSql = `
  CREATE TABLE IF NOT EXISTS close_task_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_task_instance_id BIGINT UNSIGNED NOT NULL,
    event_type ENUM(
      'CREATED',
      'ASSIGNED',
      'STARTED',
      'SUBMITTED',
      'RETURNED',
      'APPROVED',
      'WAIVED',
      'CANCELLED',
      'REOPENED',
      'EVIDENCE_ATTACHED',
      'EVIDENCE_REMOVED',
      'COMMENT_ADDED'
    ) NOT NULL,
    from_status ENUM(
      'NOT_STARTED',
      'IN_PROGRESS',
      'SUBMITTED',
      'RETURNED',
      'APPROVED',
      'WAIVED',
      'CANCELLED'
    ) NULL,
    to_status ENUM(
      'NOT_STARTED',
      'IN_PROGRESS',
      'SUBMITTED',
      'RETURNED',
      'APPROVED',
      'WAIVED',
      'CANCELLED'
    ) NULL,
    actor_user_id INT NULL,
    note VARCHAR(1000) NULL,
    payload_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_close_task_events_task_created (tenant_id, close_task_instance_id, created_at),
    KEY ix_close_task_events_actor_created (tenant_id, actor_user_id, created_at),
    KEY ix_close_task_events_type_created (tenant_id, event_type, created_at),
    CONSTRAINT fk_close_task_events_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_task_events_task
      FOREIGN KEY (close_task_instance_id) REFERENCES close_task_instances(id),
    CONSTRAINT fk_close_task_events_actor_user
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration203CloseTaskManagementFoundation = {
  key: "m203_close_task_management_foundation",
  description:
    "Add close checklist task template, instance, evidence, and event tables for PR-CTM-01.",
  async up(connection) {
    await safeExecute(connection, createCloseTaskTemplatesTableSql);
    await safeExecute(connection, createCloseTaskInstancesTableSql);
    await safeExecute(connection, createCloseTaskEvidenceTableSql);
    await safeExecute(connection, createCloseTaskEventsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration203CloseTaskManagementFoundation;
