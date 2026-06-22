/**
 * m208 - Tax configuration RBAC cleanup.
 *
 * Adds narrow tax setup permissions and backfills existing tenant roles so tax
 * configuration no longer depends on broad company-onboarding authority.
 */

const TAX_CONFIGURATION_ROLE_CODE = "TaxConfigurationManager";
const TAX_CONFIGURATION_ROLE_NAME = "Tax Configuration Manager";

const REQUIRED_PERMISSION_ROWS = Object.freeze([
  Object.freeze(["org.tree.read", "Read org hierarchy tree"]),
  Object.freeze(["gl.account.read", "Read accounts"]),
  Object.freeze(["tax.setup.read", "Read tax setup configuration"]),
  Object.freeze(["tax.setup.upsert", "Create/update tax setup configuration"]),
  Object.freeze(["onboarding.company.setup", "Run company onboarding bootstrap flow"]),
]);

const TAX_CONFIGURATION_MANAGER_PERMISSION_CODES = Object.freeze([
  "org.tree.read",
  "tax.setup.read",
  "tax.setup.upsert",
  "gl.account.read",
]);

const SYSTEM_ADMIN_PERMISSION_CODES = Object.freeze([
  "org.tree.read",
  "tax.setup.read",
  "tax.setup.upsert",
  "gl.account.read",
]);

const ONBOARDING_COMPAT_PERMISSION_CODES = Object.freeze([
  "org.tree.read",
  "tax.setup.read",
  "tax.setup.upsert",
]);

async function upsertPermissions(connection) {
  for (const [code, description] of REQUIRED_PERMISSION_ROWS) {
    await connection.execute(
      `INSERT INTO permissions (code, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         description = VALUES(description)`,
      [code, description],
    );
  }
}

async function getPermissionIdsByCode(connection, permissionCodes) {
  const normalizedCodes = Array.from(
    new Set(
      (Array.isArray(permissionCodes) ? permissionCodes : [])
        .map((permissionCode) => String(permissionCode || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedCodes.length === 0) {
    return new Map();
  }

  const [rows] = await connection.execute(
    `SELECT id, code
       FROM permissions
      WHERE code IN (${normalizedCodes.map(() => "?").join(", ")})`,
    normalizedCodes,
  );

  const permissionIdByCode = new Map();
  for (const row of rows || []) {
    permissionIdByCode.set(String(row.code || ""), row.id);
  }

  const missingCodes = normalizedCodes.filter(
    (permissionCode) => !permissionIdByCode.has(permissionCode),
  );
  if (missingCodes.length > 0) {
    throw new Error(`Missing permission rows: ${missingCodes.join(", ")}`);
  }

  return permissionIdByCode;
}

async function getTenantIds(connection) {
  const [rows] = await connection.execute("SELECT id FROM tenants ORDER BY id");
  return (rows || []).map((row) => row.id).filter(Boolean);
}

async function getRoleIdsByCode(connection, roleCode) {
  const [rows] = await connection.execute(
    `SELECT id
       FROM roles
      WHERE code = ?
      ORDER BY tenant_id, id`,
    [roleCode],
  );
  return (rows || []).map((row) => row.id).filter(Boolean);
}

async function getOnboardingRoleIds(connection) {
  const [rows] = await connection.execute(
    `SELECT DISTINCT rp.role_id AS role_id
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE p.code = 'onboarding.company.setup'
      ORDER BY rp.role_id`,
  );
  return (rows || []).map((row) => row.role_id).filter(Boolean);
}

async function addPermissionIdsToRoles(connection, roleIds, permissionIds) {
  for (const roleId of roleIds) {
    for (const permissionId of permissionIds) {
      await connection.execute(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         VALUES (?, ?)`,
        [roleId, permissionId],
      );
    }
  }
}

async function replaceRolePermissions(connection, roleId, permissionIds) {
  if (permissionIds.length === 0) {
    await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
    return;
  }

  await connection.execute(
    `DELETE FROM role_permissions
      WHERE role_id = ?
        AND permission_id NOT IN (${permissionIds.map(() => "?").join(", ")})`,
    [roleId, ...permissionIds],
  );
  await addPermissionIdsToRoles(connection, [roleId], permissionIds);
}

async function upsertTaxConfigurationManagerRoles(connection, permissionIdByCode) {
  const tenantIds = await getTenantIds(connection);
  const permissionIds = TAX_CONFIGURATION_MANAGER_PERMISSION_CODES.map((code) =>
    permissionIdByCode.get(code),
  );

  for (const tenantId of tenantIds) {
    const [result] = await connection.execute(
      `INSERT INTO roles (tenant_id, code, name, is_system)
       VALUES (?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_system = VALUES(is_system)`,
      [tenantId, TAX_CONFIGURATION_ROLE_CODE, TAX_CONFIGURATION_ROLE_NAME],
    );

    let roleId = result?.insertId;
    if (!roleId) {
      const [rows] = await connection.execute(
        `SELECT id
           FROM roles
          WHERE tenant_id = ?
            AND code = ?
          LIMIT 1`,
        [tenantId, TAX_CONFIGURATION_ROLE_CODE],
      );
      roleId = rows?.[0]?.id;
    }

    if (!roleId) {
      throw new Error(
        `Failed to resolve ${TAX_CONFIGURATION_ROLE_CODE} for tenant ${tenantId}`,
      );
    }

    await replaceRolePermissions(connection, roleId, permissionIds);
  }
}

const migration208TaxConfigurationRbac = {
  key: "m208_tax_configuration_rbac",
  description: "Add narrow tax setup RBAC permissions and Tax Configuration Manager role.",
  async up(connection) {
    await upsertPermissions(connection);

    const allPermissionCodes = [
      ...TAX_CONFIGURATION_MANAGER_PERMISSION_CODES,
      ...SYSTEM_ADMIN_PERMISSION_CODES,
      ...ONBOARDING_COMPAT_PERMISSION_CODES,
      "onboarding.company.setup",
    ];
    const permissionIdByCode = await getPermissionIdsByCode(connection, allPermissionCodes);

    await upsertTaxConfigurationManagerRoles(connection, permissionIdByCode);

    await addPermissionIdsToRoles(
      connection,
      await getRoleIdsByCode(connection, "SystemAdmin"),
      SYSTEM_ADMIN_PERMISSION_CODES.map((code) => permissionIdByCode.get(code)),
    );

    await addPermissionIdsToRoles(
      connection,
      await getOnboardingRoleIds(connection),
      ONBOARDING_COMPAT_PERMISSION_CODES.map((code) => permissionIdByCode.get(code)),
    );
  },

  async down() {
    // Additive RBAC rollout only.
  },
};

export default migration208TaxConfigurationRbac;
