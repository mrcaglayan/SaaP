import express from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, parsePositiveInt } from "./_utils.js";
import { getUserPreferences, saveUserPreferences } from "../services/me.service.js";
import {
  createUserSavedView,
  deleteUserSavedView,
  listUserSavedViews,
  updateUserSavedView,
} from "../services/me.saved-views.service.js";
import {
  listUserInAppNotifications,
  markAllUserInAppNotificationsRead,
  markUserInAppNotificationReadById,
} from "../services/me.notifications.service.js";
import { listTenantFeatures } from "../services/me.features.service.js";

const router = express.Router();

async function loadPermissionCodes(userId, tenantId) {
  if (!userId || !tenantId) {
    return [];
  }

  try {
    const permissionResult = await query(
      `SELECT
         p.code,
         SUM(CASE WHEN urs.effect = 'ALLOW' THEN 1 ELSE 0 END) AS allow_count,
         SUM(
           CASE
             WHEN urs.effect = 'DENY' AND urs.scope_type = 'TENANT' THEN 1
             ELSE 0
           END
         ) AS tenant_deny_count
       FROM user_role_scopes urs
       JOIN roles r ON r.id = urs.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE urs.user_id = ?
         AND urs.tenant_id = ?
       GROUP BY p.code
       HAVING allow_count > 0
          AND tenant_deny_count = 0
       ORDER BY p.code`,
      [userId, tenantId]
    );

    return permissionResult.rows.map((row) => row.code);
  } catch (err) {
    // Keep /me backward-compatible if RBAC tables are not migrated yet.
    if (err?.errno === 1146) {
      return [];
    }
    throw err;
  }
}

async function loadUserById(userId) {
  const { rows } = await query(
    "SELECT id, tenant_id, email, name, status, created_at FROM users WHERE id = ?",
    [userId]
  );
  return rows[0] || null;
}

function requireTenantIdForPreferences(user) {
  const tenantId = Number(user?.tenant_id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw badRequest("tenantId is required for preferences");
  }
  return tenantId;
}

function parsePreferencesPatch(req) {
  const body = req.body || {};
  const nestedPreferences =
    body.preferences && typeof body.preferences === "object"
      ? body.preferences
      : null;

  const rootWorkingContext =
    Object.prototype.hasOwnProperty.call(body, "workingContext")
      ? body.workingContext
      : undefined;
  const nestedWorkingContext =
    nestedPreferences &&
    Object.prototype.hasOwnProperty.call(nestedPreferences, "workingContext")
      ? nestedPreferences.workingContext
      : undefined;

  const workingContext =
    rootWorkingContext !== undefined ? rootWorkingContext : nestedWorkingContext;

  if (workingContext === undefined) {
    throw badRequest("At least one supported preference field is required");
  }

  if (
    workingContext !== null &&
    (typeof workingContext !== "object" || Array.isArray(workingContext))
  ) {
    throw badRequest("workingContext must be an object or null");
  }

  return { workingContext };
}

function parseModuleCode(value, { required = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    if (required) {
      throw badRequest("moduleCode is required");
    }
    return "";
  }
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,79}$/.test(normalized)) {
    throw badRequest(
      "moduleCode must be 2-80 chars and contain only A-Z, 0-9, ., _, :, -"
    );
  }
  return normalized;
}

function parseSavedViewName(value, { required = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    if (required) {
      throw badRequest("name is required");
    }
    return "";
  }
  if (normalized.length > 120) {
    throw badRequest("name cannot exceed 120 characters");
  }
  return normalized;
}

function parseSavedViewDefinition(value, { required = false } = {}) {
  if (value === undefined) {
    if (required) {
      throw badRequest("definition is required");
    }
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("definition must be an object");
  }
  return value;
}

function parseOptionalBoolean(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  throw badRequest(`${fieldName} must be boolean`);
}

function parseNotificationsStatus(value) {
  const normalized = String(value || "UNREAD")
    .trim()
    .toUpperCase();
  if (normalized === "UNREAD" || normalized === "READ" || normalized === "ALL") {
    return normalized;
  }
  throw badRequest("status must be UNREAD, READ, or ALL");
}

function parseNotificationsSourceRefType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "";
  }
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,59}$/.test(normalized)) {
    throw badRequest("sourceRefType is invalid");
  }
  return normalized;
}

function parseNotificationsLimit(value, fallback = 25) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 200);
}

function parseNotificationsOffset(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseCreateSavedViewPayload(req) {
  const body = req.body || {};
  return {
    moduleCode: parseModuleCode(body.moduleCode, { required: true }),
    name: parseSavedViewName(body.name, { required: true }),
    definition: parseSavedViewDefinition(body.definition, { required: true }),
    isDefault: Boolean(parseOptionalBoolean(body.isDefault, "isDefault")),
  };
}

function parseUpdateSavedViewPayload(req) {
  const body = req.body || {};
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDefinition = Object.prototype.hasOwnProperty.call(body, "definition");
  const hasIsDefault = Object.prototype.hasOwnProperty.call(body, "isDefault");
  if (!hasName && !hasDefinition && !hasIsDefault) {
    throw badRequest("At least one saved view field is required");
  }

  return {
    name: hasName ? parseSavedViewName(body.name, { required: true }) : undefined,
    definition: hasDefinition
      ? parseSavedViewDefinition(body.definition, { required: true })
      : undefined,
    isDefault: hasIsDefault
      ? parseOptionalBoolean(body.isDefault, "isDefault")
      : undefined,
  };
}

// GET /me
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const permissionCodes = await loadPermissionCodes(userId, user.tenant_id);

    return res.json({
      ...user,
      permissionCodes,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /me/preferences
router.get("/preferences", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);

    const preferences = await getUserPreferences({
      tenantId,
      userId: user.id,
    });

    return res.json({
      tenantId,
      userId: user.id,
      preferences,
    });
  } catch (err) {
    return next(err);
  }
});

// PUT /me/preferences
router.put("/preferences", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);

    const patch = parsePreferencesPatch(req);
    const preferences = await saveUserPreferences({
      tenantId,
      userId: user.id,
      preferencesPatch: patch,
    });

    return res.json({
      tenantId,
      userId: user.id,
      preferences,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /me/saved-views
router.get("/saved-views", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);
    const moduleCode = parseModuleCode(req.query?.moduleCode, { required: false });

    const rows = await listUserSavedViews({
      tenantId,
      userId: user.id,
      moduleCode: moduleCode || undefined,
    });

    return res.json({
      rows,
      total: rows.length,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /me/saved-views
router.post("/saved-views", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);
    const payload = parseCreateSavedViewPayload(req);

    const row = await createUserSavedView({
      tenantId,
      userId: user.id,
      moduleCode: payload.moduleCode,
      name: payload.name,
      definition: payload.definition,
      isDefault: payload.isDefault,
    });

    return res.status(201).json({ row });
  } catch (err) {
    return next(err);
  }
});

// PUT /me/saved-views/:savedViewId
router.put("/saved-views/:savedViewId", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);
    const savedViewId = parsePositiveInt(req.params.savedViewId);
    if (!savedViewId) {
      throw badRequest("savedViewId is invalid");
    }
    const patch = parseUpdateSavedViewPayload(req);

    const row = await updateUserSavedView({
      tenantId,
      userId: user.id,
      savedViewId,
      name: patch.name,
      definition: patch.definition,
      isDefault: patch.isDefault,
    });

    if (!row) {
      return res.status(404).json({ message: "Saved view not found" });
    }

    return res.json({ row });
  } catch (err) {
    return next(err);
  }
});

// DELETE /me/saved-views/:savedViewId
router.delete("/saved-views/:savedViewId", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);
    const savedViewId = parsePositiveInt(req.params.savedViewId);
    if (!savedViewId) {
      throw badRequest("savedViewId is invalid");
    }

    const deleted = await deleteUserSavedView({
      tenantId,
      userId: user.id,
      savedViewId,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Saved view not found" });
    }

    return res.json({ deleted: true });
  } catch (err) {
    return next(err);
  }
});

// GET /me/notifications
router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);

    const status = parseNotificationsStatus(req.query?.status);
    const sourceRefType = parseNotificationsSourceRefType(req.query?.sourceRefType);
    const sourceRefIdRaw = req.query?.sourceRefId;
    const sourceRefId =
      sourceRefIdRaw === undefined || sourceRefIdRaw === null || sourceRefIdRaw === ""
        ? undefined
        : parsePositiveInt(sourceRefIdRaw);
    if (
      sourceRefIdRaw !== undefined &&
      sourceRefIdRaw !== null &&
      sourceRefIdRaw !== "" &&
      !sourceRefId
    ) {
      throw badRequest("sourceRefId must be a positive integer");
    }

    const result = await listUserInAppNotifications({
      tenantId,
      userId: user.id,
      status,
      sourceRefType: sourceRefType || undefined,
      sourceRefId,
      limit: parseNotificationsLimit(req.query?.limit),
      offset: parseNotificationsOffset(req.query?.offset),
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// GET /me/features
router.get("/features", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);
    const includeDisabled = parseOptionalBoolean(
      req.query?.includeDisabled,
      "includeDisabled"
    );

    const result = await listTenantFeatures({
      tenantId,
      includeDisabled: includeDisabled !== false,
    });

    return res.json({
      tenantId,
      userId: user.id,
      ...result,
    });
  } catch (err) {
    return next(err);
  }
});

// PUT /me/notifications/read-all
router.put("/notifications/read-all", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);

    const updatedCount = await markAllUserInAppNotificationsRead({
      tenantId,
      userId: user.id,
    });

    return res.json({
      updatedCount,
    });
  } catch (err) {
    return next(err);
  }
});

// PUT /me/notifications/:notificationId/read
router.put("/notifications/:notificationId/read", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await loadUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const tenantId = requireTenantIdForPreferences(user);
    const notificationId = parsePositiveInt(req.params.notificationId);
    if (!notificationId) {
      throw badRequest("notificationId is invalid");
    }

    const row = await markUserInAppNotificationReadById({
      tenantId,
      userId: user.id,
      notificationId,
    });
    if (!row) {
      return res.status(404).json({ message: "Notification not found" });
    }

    return res.json({ row });
  } catch (err) {
    return next(err);
  }
});

export default router;
