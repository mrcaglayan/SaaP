/**
 * m162 - Branch operator counterparty live create/update permission.
 *
 * Grants cari.card.upsert to BranchOperator so branch-scoped users can create
 * and maintain branch-owned live cards directly, while service-layer checks
 * still keep shared and multi-branch cards under entity-level control.
 */

const COUNTERPARTY_UPSERT_PERMISSION = "cari.card.upsert";
const TARGET_ROLE_CODE = "BranchOperator";

async function ensurePermission(connection) {
  await connection.execute(
    `INSERT INTO permissions (code, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [COUNTERPARTY_UPSERT_PERMISSION, "Create/update counterparty (cari) cards"]
  );
}

async function grantPermissionToBranchOperators(connection) {
  await connection.execute(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id
     FROM roles r
     JOIN permissions p
       ON p.code = ?
     LEFT JOIN role_permissions existing_rp
       ON existing_rp.role_id = r.id
      AND existing_rp.permission_id = p.id
     WHERE r.code = ?
       AND existing_rp.role_id IS NULL`,
    [COUNTERPARTY_UPSERT_PERMISSION, TARGET_ROLE_CODE]
  );
}

const migration162BranchOperatorCounterpartyUpsert = {
  key: "m162_branch_operator_counterparty_upsert",
  description:
    "Grant cari.card.upsert to existing BranchOperator roles for OU-owned live counterparty maintenance.",
  async up(connection) {
    await ensurePermission(connection);
    await grantPermissionToBranchOperators(connection);
  },
};

export default migration162BranchOperatorCounterpartyUpsert;
