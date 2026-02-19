import express from "express";
import bcrypt from "bcrypt";
import { withTransaction } from "../db.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
} from "./_utils.js";

const router = express.Router();

function requireProviderKey(req) {
  const configuredKey = String(process.env.PROVIDER_API_KEY || "").trim();
  if (!configuredKey) {
    const err = new Error("Provider provisioning is not configured");
    err.status = 503;
    throw err;
  }

  const providedKey = String(req.headers["x-provider-key"] || "").trim();
  if (!providedKey || providedKey !== configuredKey) {
    const err = new Error("Invalid provider key");
    err.status = 401;
    throw err;
  }
}

function normalizeTenantCode(rawValue) {
  const code = String(rawValue || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!code) {
    throw badRequest("tenantCode is required");
  }
  if (code.length > 50) {
    throw badRequest("tenantCode cannot exceed 50 characters");
  }

  return code;
}

function normalizeName(value, label, maxLength = 255) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${label} cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) {
    throw badRequest("adminEmail is required");
  }
  if (email.length > 255) {
    throw badRequest("adminEmail cannot exceed 255 characters");
  }
  // Keep this lightweight. Detailed validation should happen outside API.
  if (!email.includes("@") || !email.includes(".")) {
    throw badRequest("adminEmail is invalid");
  }
  return email;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8) {
    throw badRequest("adminPassword must be at least 8 characters");
  }
  if (password.length > 128) {
    throw badRequest("adminPassword cannot exceed 128 characters");
  }
  return password;
}

async function ensureTenantAdminRole(tx, tenantId) {
  const roleResult = await tx.query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = 'TenantAdmin'
     LIMIT 1`,
    [tenantId]
  );
  let roleId = parsePositiveInt(roleResult.rows[0]?.id);

  if (!roleId) {
    const insertRoleResult = await tx.query(
      `INSERT INTO roles (tenant_id, code, name, is_system)
       VALUES (?, 'TenantAdmin', 'Tenant Administrator', TRUE)`,
      [tenantId]
    );
    roleId = parsePositiveInt(insertRoleResult.rows.insertId);
  }

  if (!roleId) {
    throw new Error("Failed to initialize TenantAdmin role");
  }

  const permissionResult = await tx.query(`SELECT id FROM permissions ORDER BY id`);
  const permissionIds = (permissionResult.rows || [])
    .map((row) => parsePositiveInt(row.id))
    .filter(Boolean);

  if (permissionIds.length === 0) {
    throw badRequest(
      "Permissions catalog is empty. Run core seed before provider provisioning."
    );
  }

  for (const permissionId of permissionIds) {
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       VALUES (?, ?)`,
      [roleId, permissionId]
    );
  }

  return roleId;
}

router.post(
  "/tenants/bootstrap",
  asyncHandler(async (req, res) => {
    requireProviderKey(req);
    assertRequiredFields(req.body, [
      "tenantCode",
      "tenantName",
      "adminName",
      "adminEmail",
      "adminPassword",
    ]);

    const tenantCode = normalizeTenantCode(req.body.tenantCode);
    const tenantName = normalizeName(req.body.tenantName, "tenantName", 255);
    const adminName = normalizeName(req.body.adminName, "adminName", 255);
    const adminEmail = normalizeEmail(req.body.adminEmail);
    const adminPassword = validatePassword(req.body.adminPassword);
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const result = await withTransaction(async (tx) => {
      const existingTenantResult = await tx.query(
        `SELECT id
         FROM tenants
         WHERE code = ?
         LIMIT 1`,
        [tenantCode]
      );
      if (existingTenantResult.rows[0]) {
        throw badRequest("tenantCode already exists");
      }

      const existingEmailResult = await tx.query(
        `SELECT id
         FROM users
         WHERE email = ?
         LIMIT 1`,
        [adminEmail]
      );
      if (existingEmailResult.rows[0]) {
        throw badRequest("adminEmail already exists");
      }

      const tenantInsertResult = await tx.query(
        `INSERT INTO tenants (code, name, status)
         VALUES (?, ?, 'ACTIVE')`,
        [tenantCode, tenantName]
      );
      const tenantId = parsePositiveInt(tenantInsertResult.rows.insertId);
      if (!tenantId) {
        throw new Error("Failed to create tenant");
      }

      const roleId = await ensureTenantAdminRole(tx, tenantId);

      const userInsertResult = await tx.query(
        `INSERT INTO users (
            tenant_id,
            email,
            password_hash,
            name,
            status
         )
         VALUES (?, ?, ?, ?, 'ACTIVE')`,
        [tenantId, adminEmail, passwordHash, adminName]
      );
      const userId = parsePositiveInt(userInsertResult.rows.insertId);
      if (!userId) {
        throw new Error("Failed to create admin user");
      }

      await tx.query(
        `INSERT INTO user_role_scopes (
            tenant_id,
            user_id,
            role_id,
            scope_type,
            scope_id,
            effect
         )
         VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
         ON DUPLICATE KEY UPDATE
           effect = VALUES(effect)`,
        [tenantId, userId, roleId, tenantId]
      );

      return {
        tenantId,
        tenantCode,
        tenantName,
        adminUserId: userId,
        adminEmail,
        adminName,
        adminRoleId: roleId,
      };
    });

    return res.status(201).json({
      ok: true,
      ...result,
    });
  })
);

export default router;
