import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query, withTransaction } from "../db.js";
import { invalidateRbacCache } from "../middleware/rbac.js";
import { normalizeFeatureCode } from "../services/features.catalog.js";
import {
  assignCompatibilityBootstrapRolesToUser,
  ensureCompatibilitySystemRolesForTenant,
  SECURITY_ADMIN_ROLE_CODE,
  SYSTEM_ADMIN_ROLE_CODE,
} from "../services/systemRoles.service.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
} from "./_utils.js";

const router = express.Router();
const TENANT_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);
const FEATURE_TAX_ENGINE_V1 = normalizeFeatureCode("feature_tax_engine_v1");

function parseBooleanEnv(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseBooleanInput(value, fallback = false, fieldName = "value") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1") {
    return true;
  }
  if (value === 0 || value === "0") {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw badRequest(`${fieldName} must be boolean`);
}

function isProviderPanelEnabled() {
  const raw = process.env.PROVIDER_CONTROL_PANEL_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return String(process.env.NODE_ENV || "").toLowerCase() !== "production";
  }
  return parseBooleanEnv(raw);
}

function requireProviderPanelEnabled() {
  if (isProviderPanelEnabled()) {
    return;
  }

  const err = new Error("Route not found");
  err.status = 404;
  throw err;
}

function requireLegacyBootstrapEnabled() {
  const enabled = parseBooleanEnv(process.env.PROVIDER_BOOTSTRAP_ENABLED);
  if (enabled) {
    return;
  }

  const err = new Error("Route not found");
  err.status = 404;
  throw err;
}

function getProviderJwtSecret() {
  const secret = String(process.env.PROVIDER_JWT_SECRET || "").trim();
  if (!secret) {
    const err = new Error("Provider control panel is not configured");
    err.status = 503;
    throw err;
  }
  return secret;
}

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

function parseBearerToken(req) {
  const header = String(req.headers.authorization || "");
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    const err = new Error("Missing token");
    err.status = 401;
    throw err;
  }
  return token;
}

function requireProviderAuth(req, res, next) {
  try {
    requireProviderPanelEnabled();
    const token = parseBearerToken(req);
    const payload = jwt.verify(token, getProviderJwtSecret());
    const providerAdminId = parsePositiveInt(payload?.providerAdminId);
    if (!providerAdminId) {
      const err = new Error("Invalid token");
      err.status = 401;
      throw err;
    }

    req.providerAdmin = {
      providerAdminId,
      email: String(payload.email || "").trim().toLowerCase(),
    };
    return next();
  } catch (err) {
    if (!err.status) {
      err.status = 401;
      err.message = "Invalid or expired token";
    }
    return next(err);
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

function normalizeTenantStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (!TENANT_STATUSES.has(status)) {
    throw badRequest("status must be ACTIVE or SUSPENDED");
  }
  return status;
}

function normalizeIso2(value, label = "iso2") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw badRequest(`${label} must be exactly 2 letters`);
  }
  return normalized;
}

function normalizeIso3(value, label = "iso3") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw badRequest(`${label} must be exactly 3 letters`);
  }
  return normalized;
}

function normalizeCurrencyCode(value, label = "defaultCurrencyCode") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw badRequest(`${label} must be exactly 3 letters`);
  }
  return normalized;
}

function normalizeMinorUnits(value, label = "minorUnits", defaultValue = null) {
  if (value === undefined || value === null || value === "") {
    if (defaultValue !== null) {
      return defaultValue;
    }
    throw badRequest(`${label} is required`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) {
    throw badRequest(`${label} must be an integer between 0 and 9`);
  }
  return parsed;
}

function mapCurrencyRow(row) {
  return {
    code: String(row?.code || "").toUpperCase() || null,
    name: row?.name || null,
    minorUnits: Number(row?.minor_units || 0),
  };
}

function mapCountryRow(row) {
  return {
    id: parsePositiveInt(row?.id),
    iso2: String(row?.iso2 || "").toUpperCase() || null,
    iso3: String(row?.iso3 || "").toUpperCase() || null,
    name: row?.name || null,
    defaultCurrencyCode:
      String(row?.default_currency_code || "").toUpperCase() || null,
  };
}

function mapTenantRow(row) {
  return {
    id: parsePositiveInt(row?.id),
    code: row?.code || null,
    name: row?.name || null,
    status: String(row?.status || "").toUpperCase(),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    userCount: Number(row?.user_count || 0),
    activeUserCount: Number(row?.active_user_count || 0),
    taxEngineEnabled: Number(row?.tax_engine_enabled || 0) === 1,
  };
}

async function ensureCurrencyExists(currencyCode, label = "defaultCurrencyCode") {
  const result = await query(
    `SELECT code
     FROM currencies
     WHERE code = ?
     LIMIT 1`,
    [currencyCode]
  );
  if (!result.rows[0]) {
    throw badRequest(`${label} not found`);
  }
}

async function getProviderTenantRow(tenantId) {
  const result = await query(
    `SELECT
       t.id,
       t.code,
       t.name,
       t.status,
       t.created_at,
       t.updated_at,
       COUNT(u.id) AS user_count,
       SUM(CASE WHEN u.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_user_count,
       COALESCE(MAX(CASE WHEN tf.is_enabled = 1 THEN 1 ELSE 0 END), 0) AS tax_engine_enabled
     FROM tenants t
     LEFT JOIN users u ON u.tenant_id = t.id
     LEFT JOIN tenant_features tf
       ON tf.tenant_id = t.id
      AND tf.feature_code = ?
     WHERE t.id = ?
     GROUP BY t.id, t.code, t.name, t.status, t.created_at, t.updated_at
     LIMIT 1`,
    [FEATURE_TAX_ENGINE_V1, tenantId]
  );

  return result.rows[0] ? mapTenantRow(result.rows[0]) : null;
}

async function ensureCompatibilityBootstrapRoles(tx, tenantId) {
  try {
    return await ensureCompatibilitySystemRolesForTenant(tenantId, {
      runQuery: (sql, params) => tx.query(sql, params),
    });
  } catch (error) {
    if (
      String(error?.message || "").includes("Permissions catalog is empty")
    ) {
      throw badRequest(
        "Permissions catalog is empty. Run core seed before provider provisioning."
      );
    }
    throw error;
  }
}

async function upsertTenantFeature(tx, { tenantId, featureCode, isEnabled }) {
  await tx.query(
    `INSERT INTO tenant_features (
        tenant_id,
        feature_code,
        is_enabled,
        config_json,
        updated_by_user_id
     )
     VALUES (?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       is_enabled = VALUES(is_enabled),
       config_json = VALUES(config_json),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [tenantId, normalizeFeatureCode(featureCode), isEnabled ? 1 : 0]
  );
}

async function createTenantWithAdmin(tx, input) {
  const tenantCode = normalizeTenantCode(input.tenantCode);
  const tenantName = normalizeName(input.tenantName, "tenantName", 255);
  const adminName = normalizeName(input.adminName, "adminName", 255);
  const adminEmail = normalizeEmail(input.adminEmail);
  const adminPassword = validatePassword(input.adminPassword);
  const enableTaxEngine = parseBooleanInput(
    input.enableTaxEngine,
    false,
    "enableTaxEngine"
  );
  const passwordHash = await bcrypt.hash(adminPassword, 10);

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

  const roleIdsByCode = await ensureCompatibilityBootstrapRoles(tx, tenantId);
  const securityAdminRoleId = roleIdsByCode.get(SECURITY_ADMIN_ROLE_CODE);
  const systemAdminRoleId = roleIdsByCode.get(SYSTEM_ADMIN_ROLE_CODE);
  if (!securityAdminRoleId || !systemAdminRoleId) {
    throw new Error("Failed to initialize compatibility admin roles");
  }

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

  await assignCompatibilityBootstrapRolesToUser(tenantId, userId, {
    runQuery: (sql, params) => tx.query(sql, params),
    roleIdsByCode,
  });

  await upsertTenantFeature(tx, {
    tenantId,
    featureCode: FEATURE_TAX_ENGINE_V1,
    isEnabled: enableTaxEngine,
  });

  return {
    tenantId,
    tenantCode,
    tenantName,
    adminUserId: userId,
    adminEmail,
    adminName,
    adminRoleId: securityAdminRoleId,
    adminRoleIds: {
      [SECURITY_ADMIN_ROLE_CODE]: securityAdminRoleId,
      [SYSTEM_ADMIN_ROLE_CODE]: systemAdminRoleId,
    },
    taxEngineEnabled: enableTaxEngine,
  };
}

async function requireProviderAdminRecord(providerAdminId) {
  const result = await query(
    `SELECT id, email, name, status, created_at, updated_at, last_login_at
     FROM provider_admin_users
     WHERE id = ?
     LIMIT 1`,
    [providerAdminId]
  );
  const row = result.rows[0];
  if (!row) {
    const err = new Error("Provider admin not found");
    err.status = 401;
    throw err;
  }
  if (String(row.status || "").toUpperCase() !== "ACTIVE") {
    const err = new Error("Provider admin is disabled");
    err.status = 403;
    throw err;
  }
  return row;
}

router.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    requireProviderPanelEnabled();
    assertRequiredFields(req.body, ["email", "password"]);

    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) {
      throw badRequest("email and password are required");
    }

    const result = await query(
      `SELECT id, email, password_hash, name, status
       FROM provider_admin_users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );
    const providerAdmin = result.rows[0];
    const ok = providerAdmin
      ? await bcrypt.compare(password, providerAdmin.password_hash)
      : false;
    const isActive =
      String(providerAdmin?.status || "").toUpperCase() === "ACTIVE";
    if (!providerAdmin || !ok || !isActive) {
      const err = new Error("Invalid credentials");
      err.status = 401;
      throw err;
    }

    const providerAdminId = parsePositiveInt(providerAdmin.id);
    if (!providerAdminId) {
      throw new Error("Invalid provider admin record");
    }

    const token = jwt.sign(
      {
        providerAdminId,
        email: String(providerAdmin.email || "").trim().toLowerCase(),
      },
      getProviderJwtSecret(),
      { expiresIn: "12h" }
    );

    await query(
      `UPDATE provider_admin_users
       SET last_login_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [providerAdminId]
    );

    return res.json({ token });
  })
);

router.get(
  "/me",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    const providerAdmin = await requireProviderAdminRecord(
      req.providerAdmin.providerAdminId
    );

    return res.json({
      id: parsePositiveInt(providerAdmin.id),
      email: String(providerAdmin.email || "").trim().toLowerCase(),
      name: providerAdmin.name || null,
      status: String(providerAdmin.status || "").toUpperCase(),
      createdAt: providerAdmin.created_at || null,
      updatedAt: providerAdmin.updated_at || null,
      lastLoginAt: providerAdmin.last_login_at || null,
    });
  })
);

router.get(
  "/tenants",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);

    const q = req.query.q ? String(req.query.q).trim() : null;
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const conditions = [];
    const params = [];
    if (q) {
      conditions.push("(t.code LIKE ? OR t.name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM tenants t
       ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const rowsResult = await query(
      `SELECT
         t.id,
         t.code,
         t.name,
         t.status,
         t.created_at,
         t.updated_at,
         COUNT(u.id) AS user_count,
         SUM(CASE WHEN u.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_user_count,
         COALESCE(MAX(CASE WHEN tf.is_enabled = 1 THEN 1 ELSE 0 END), 0) AS tax_engine_enabled
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id
       LEFT JOIN tenant_features tf
         ON tf.tenant_id = t.id
        AND tf.feature_code = ?
       ${whereClause}
       GROUP BY t.id, t.code, t.name, t.status, t.created_at, t.updated_at
       ORDER BY t.id DESC
       LIMIT ${limit}
       OFFSET ${offset}`,
      [FEATURE_TAX_ENGINE_V1, ...params]
    );

    return res.json({
      rows: rowsResult.rows.map((row) => mapTenantRow(row)),
      total,
      limit,
      offset,
    });
  })
);

router.post(
  "/tenants",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);
    assertRequiredFields(req.body, [
      "tenantCode",
      "tenantName",
      "adminName",
      "adminEmail",
      "adminPassword",
    ]);

    const result = await withTransaction((tx) => createTenantWithAdmin(tx, req.body));
    await invalidateRbacCache(result.tenantId);

    return res.status(201).json({
      ok: true,
      ...result,
      createdByProviderAdminId: req.providerAdmin.providerAdminId,
    });
  })
);

router.patch(
  "/tenants/:tenantId/status",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);
    const tenantId = parsePositiveInt(req.params.tenantId);
    if (!tenantId) {
      throw badRequest("tenantId must be a positive integer");
    }

    const status = normalizeTenantStatus(req.body?.status);
    const updateResult = await query(
      `UPDATE tenants
       SET status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, tenantId]
    );
    if (Number(updateResult.rows.affectedRows || 0) === 0) {
      throw badRequest("tenantId not found");
    }

    const row = await getProviderTenantRow(tenantId);

    return res.json({
      ok: true,
      row,
    });
  })
);

router.patch(
  "/tenants/:tenantId/tax-engine",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);
    const tenantId = parsePositiveInt(req.params.tenantId);
    if (!tenantId) {
      throw badRequest("tenantId must be a positive integer");
    }

    assertRequiredFields(req.body, ["enabled"]);
    const enabled = parseBooleanInput(req.body?.enabled, false, "enabled");

    const tenant = await getProviderTenantRow(tenantId);
    if (!tenant) {
      throw badRequest("tenantId not found");
    }

    await withTransaction(async (tx) => {
      await upsertTenantFeature(tx, {
        tenantId,
        featureCode: FEATURE_TAX_ENGINE_V1,
        isEnabled: enabled,
      });
    });

    const row = await getProviderTenantRow(tenantId);

    return res.json({
      ok: true,
      row,
    });
  })
);

router.get(
  "/currencies",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);

    const result = await query(
      `SELECT code, name, minor_units
       FROM currencies
       ORDER BY code`
    );

    return res.json({
      rows: (result.rows || []).map((row) => mapCurrencyRow(row)),
    });
  })
);

router.post(
  "/currencies",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);
    assertRequiredFields(req.body, ["code", "name"]);

    const code = normalizeCurrencyCode(req.body.code, "code");
    const name = normalizeName(req.body.name, "name", 100);
    const minorUnits = normalizeMinorUnits(req.body.minorUnits, "minorUnits", 2);

    const duplicateResult = await query(
      `SELECT code
       FROM currencies
       WHERE code = ?
       LIMIT 1`,
      [code]
    );
    if (duplicateResult.rows[0]) {
      throw badRequest("Currency code already exists");
    }

    await query(
      `INSERT INTO currencies (code, name, minor_units)
       VALUES (?, ?, ?)`,
      [code, name, minorUnits]
    );

    const createdResult = await query(
      `SELECT code, name, minor_units
       FROM currencies
       WHERE code = ?
       LIMIT 1`,
      [code]
    );

    return res.status(201).json({
      ok: true,
      row: mapCurrencyRow(createdResult.rows[0]),
      createdByProviderAdminId: req.providerAdmin.providerAdminId,
    });
  })
);

router.patch(
  "/currencies/:currencyCode",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);

    const currencyCode = normalizeCurrencyCode(req.params.currencyCode, "currencyCode");
    const hasName = req.body?.name !== undefined;
    const hasMinorUnits = req.body?.minorUnits !== undefined;
    if (!hasName && !hasMinorUnits) {
      throw badRequest("At least one of name or minorUnits is required");
    }

    const updates = [];
    const params = [];
    if (hasName) {
      updates.push("name = ?");
      params.push(normalizeName(req.body.name, "name", 100));
    }
    if (hasMinorUnits) {
      updates.push("minor_units = ?");
      params.push(normalizeMinorUnits(req.body.minorUnits, "minorUnits"));
    }

    params.push(currencyCode);
    const updateResult = await query(
      `UPDATE currencies
       SET ${updates.join(", ")}
       WHERE code = ?`,
      params
    );
    if (Number(updateResult.rows.affectedRows || 0) === 0) {
      throw badRequest("currencyCode not found");
    }

    const rowResult = await query(
      `SELECT code, name, minor_units
       FROM currencies
       WHERE code = ?
       LIMIT 1`,
      [currencyCode]
    );

    return res.json({
      ok: true,
      row: mapCurrencyRow(rowResult.rows[0]),
      updatedByProviderAdminId: req.providerAdmin.providerAdminId,
    });
  })
);

router.get(
  "/countries",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);

    const q = req.query.q ? String(req.query.q).trim() : null;
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
    const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const conditions = [];
    const params = [];
    if (q) {
      conditions.push(
        "(c.iso2 LIKE ? OR c.iso3 LIKE ? OR c.name LIKE ? OR c.default_currency_code LIKE ?)"
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM countries c
       ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const rowsResult = await query(
      `SELECT c.id, c.iso2, c.iso3, c.name, c.default_currency_code
       FROM countries c
       ${whereClause}
       ORDER BY c.name, c.id
       LIMIT ${limit}
       OFFSET ${offset}`,
      params
    );

    return res.json({
      rows: (rowsResult.rows || []).map((row) => mapCountryRow(row)),
      total,
      limit,
      offset,
    });
  })
);

router.post(
  "/countries",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);
    assertRequiredFields(req.body, ["iso2", "iso3", "name", "defaultCurrencyCode"]);

    const iso2 = normalizeIso2(req.body.iso2);
    const iso3 = normalizeIso3(req.body.iso3);
    const name = normalizeName(req.body.name, "name", 120);
    const defaultCurrencyCode = normalizeCurrencyCode(req.body.defaultCurrencyCode);

    const duplicateResult = await query(
      `SELECT id
       FROM countries
       WHERE iso2 = ?
          OR iso3 = ?
       LIMIT 1`,
      [iso2, iso3]
    );
    if (duplicateResult.rows[0]) {
      throw badRequest("Country with same iso2 or iso3 already exists");
    }

    await ensureCurrencyExists(defaultCurrencyCode);

    const insertResult = await query(
      `INSERT INTO countries (iso2, iso3, name, default_currency_code)
       VALUES (?, ?, ?, ?)`,
      [iso2, iso3, name, defaultCurrencyCode]
    );
    const countryId = parsePositiveInt(insertResult.rows.insertId);
    if (!countryId) {
      throw new Error("Failed to create country");
    }

    const createdResult = await query(
      `SELECT id, iso2, iso3, name, default_currency_code
       FROM countries
       WHERE id = ?
       LIMIT 1`,
      [countryId]
    );

    return res.status(201).json({
      ok: true,
      row: mapCountryRow(createdResult.rows[0]),
      createdByProviderAdminId: req.providerAdmin.providerAdminId,
    });
  })
);

router.patch(
  "/countries/:countryId",
  requireProviderAuth,
  asyncHandler(async (req, res) => {
    await requireProviderAdminRecord(req.providerAdmin.providerAdminId);

    const countryId = parsePositiveInt(req.params.countryId);
    if (!countryId) {
      throw badRequest("countryId must be a positive integer");
    }

    const hasName = req.body?.name !== undefined;
    const hasDefaultCurrencyCode = req.body?.defaultCurrencyCode !== undefined;
    if (!hasName && !hasDefaultCurrencyCode) {
      throw badRequest("At least one of name or defaultCurrencyCode is required");
    }

    const updates = [];
    const params = [];
    if (hasName) {
      updates.push("name = ?");
      params.push(normalizeName(req.body.name, "name", 120));
    }

    if (hasDefaultCurrencyCode) {
      const code = normalizeCurrencyCode(req.body.defaultCurrencyCode);
      await ensureCurrencyExists(code);
      updates.push("default_currency_code = ?");
      params.push(code);
    }

    params.push(countryId);
    const updateResult = await query(
      `UPDATE countries
       SET ${updates.join(", ")}
       WHERE id = ?`,
      params
    );
    if (Number(updateResult.rows.affectedRows || 0) === 0) {
      throw badRequest("countryId not found");
    }

    const rowResult = await query(
      `SELECT id, iso2, iso3, name, default_currency_code
       FROM countries
       WHERE id = ?
       LIMIT 1`,
      [countryId]
    );

    return res.json({
      ok: true,
      row: mapCountryRow(rowResult.rows[0]),
      updatedByProviderAdminId: req.providerAdmin.providerAdminId,
    });
  })
);

router.post(
  "/tenants/bootstrap",
  asyncHandler(async (req, res) => {
    requireLegacyBootstrapEnabled();
    requireProviderKey(req);
    assertRequiredFields(req.body, [
      "tenantCode",
      "tenantName",
      "adminName",
      "adminEmail",
      "adminPassword",
    ]);

    const result = await withTransaction((tx) => createTenantWithAdmin(tx, req.body));
    await invalidateRbacCache(result.tenantId);

    return res.status(201).json({
      ok: true,
      ...result,
    });
  })
);

export default router;
