/**
 * m161 - Tax setup write permission.
 *
 * Separates legal-entity tax maintenance from tenant bootstrap authority so
 * entity- and country-scoped finance roles can maintain tax setup without
 * receiving broad onboarding power.
 */

const TAX_SETUP_WRITE_PERMISSION = "tax.setup.write";
const ONBOARDING_COMPANY_SETUP_PERMISSION = "onboarding.company.setup";
const DIRECT_ROLE_CODES = Object.freeze(["CountryController", "EntityAccountant"]);

async function ensurePermission(connection) {
  await connection.execute(
    `INSERT INTO permissions (code, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [TAX_SETUP_WRITE_PERMISSION, "Create/update country and legal-entity tax setup"]
  );
}

async function grantPermissionToMatchingRoles(connection) {
  const directRolePlaceholders = DIRECT_ROLE_CODES.map(() => "?").join(", ");
  await connection.execute(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT DISTINCT r.id, target_permission.id
     FROM roles r
     JOIN permissions target_permission
       ON target_permission.code = ?
     LEFT JOIN role_permissions existing_rp
       ON existing_rp.role_id = r.id
      AND existing_rp.permission_id = target_permission.id
     LEFT JOIN role_permissions onboarding_rp
       ON onboarding_rp.role_id = r.id
     LEFT JOIN permissions onboarding_permission
       ON onboarding_permission.id = onboarding_rp.permission_id
      AND onboarding_permission.code = ?
     WHERE existing_rp.role_id IS NULL
       AND (
         r.code IN (${directRolePlaceholders})
         OR onboarding_permission.id IS NOT NULL
       )`,
    [
      TAX_SETUP_WRITE_PERMISSION,
      ONBOARDING_COMPANY_SETUP_PERMISSION,
      ...DIRECT_ROLE_CODES,
    ]
  );
}

const migration161TaxSetupWritePermission = {
  key: "m161_tax_setup_write_permission",
  description:
    "Add tax.setup.write permission and grant it to existing tax-maintenance capable roles.",
  async up(connection) {
    await ensurePermission(connection);
    await grantPermissionToMatchingRoles(connection);
  },
};

export default migration161TaxSetupWritePermission;
