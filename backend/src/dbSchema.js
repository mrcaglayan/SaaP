import { query } from "./db.js";

const createUsersTableSql = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
`;

const createRbacAuditLogsTableSql = `
CREATE TABLE IF NOT EXISTS rbac_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  actor_user_id INT NULL,
  target_user_id INT NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(120) NULL,
  scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NULL,
  scope_id BIGINT UNSIGNED NULL,
  request_id VARCHAR(80) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_rbac_audit_tenant_time (tenant_id, created_at),
  KEY ix_rbac_audit_action_time (tenant_id, action, created_at),
  KEY ix_rbac_audit_scope_time (tenant_id, scope_type, scope_id, created_at)
);
`;

export async function ensureUsersTable() {
  await query(createUsersTableSql);
}

export async function ensureRbacAuditLogsTable() {
  await query(createRbacAuditLogsTableSql);
}
