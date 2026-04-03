import bcrypt from "bcrypt";
import { closePool, query } from "./db.js";
import { seedCore } from "./seedCore.js";
import { assignCompatibilityBootstrapRolesToUser } from "./services/systemRoles.service.js";

const email = "test@example.com";
const password = "123456";
const name = "Test User";
const tenantCode = "DEFAULT";
const tenantName = "Default Tenant";

const run = async () => {
  await seedCore({
    defaultTenantCode: tenantCode,
    defaultTenantName: tenantName,
    ensureDefaultTenantIfMissing: true,
  });

  const hash = await bcrypt.hash(password, 10);

  const tenantResult = await query(
    `SELECT id FROM tenants WHERE code = ? LIMIT 1`,
    [tenantCode]
  );
  const tenantId = tenantResult.rows[0]?.id;
  if (!tenantId) {
    throw new Error(`Unable to resolve tenant id for code ${tenantCode}`);
  }

  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
     tenant_id = VALUES(tenant_id),
     password_hash = VALUES(password_hash),
     name = VALUES(name)`,
    [tenantId, email, hash, name]
  );

  const userResult = await query(
    `SELECT id FROM users WHERE tenant_id = ? AND email = ? LIMIT 1`,
    [tenantId, email]
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    throw new Error(`Unable to resolve user id for ${email}`);
  }

  const roleIdsByCode = await assignCompatibilityBootstrapRolesToUser(tenantId, userId);

  console.log("Seeded:", {
    email,
    password,
    tenantCode,
    tenantId,
    userId,
    roleIdsByCode: Object.fromEntries(roleIdsByCode),
  });
  await closePool();
  process.exit(0);
};

run().catch(async (e) => {
  console.error(e);
  await closePool();
  process.exit(1);
});
