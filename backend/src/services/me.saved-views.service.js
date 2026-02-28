import { query, withTransaction } from "../db.js";

const MAX_SAVED_VIEWS_PER_MODULE = 30;

function createBadRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseJsonValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function normalizeModuleCode(input, { required = false } = {}) {
  const normalized = String(input || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    if (required) {
      throw createBadRequest("moduleCode is required");
    }
    return "";
  }
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,79}$/.test(normalized)) {
    throw createBadRequest(
      "moduleCode must be 2-80 chars and contain only A-Z, 0-9, ., _, :, -"
    );
  }
  return normalized;
}

function normalizeViewName(input, { required = false } = {}) {
  const normalized = String(input || "").trim();
  if (!normalized) {
    if (required) {
      throw createBadRequest("name is required");
    }
    return "";
  }
  if (normalized.length > 120) {
    throw createBadRequest("name cannot exceed 120 characters");
  }
  return normalized;
}

function normalizeViewPayload(payload, { required = false } = {}) {
  if (payload === undefined) {
    if (required) {
      throw createBadRequest("definition is required");
    }
    return undefined;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createBadRequest("definition must be an object");
  }
  let encoded = "";
  try {
    encoded = JSON.stringify(payload);
  } catch {
    throw createBadRequest("definition must be JSON-serializable");
  }
  if (!encoded || encoded.length > 64000) {
    throw createBadRequest("definition exceeds allowed size");
  }
  return JSON.parse(encoded);
}

function mapSavedViewRow(row) {
  return {
    id: toPositiveInt(row?.id),
    moduleCode: String(row?.module_code || "").trim(),
    name: String(row?.view_name || "").trim(),
    definition: parseJsonValue(row?.view_payload_json) || {},
    isDefault: Boolean(Number(row?.is_default || 0)),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

async function loadSavedViewById(dbClient, { tenantId, userId, savedViewId }) {
  const result = await dbClient.query(
    `SELECT id, module_code, view_name, view_payload_json, is_default, created_at, updated_at
     FROM user_saved_views
     WHERE tenant_id = ?
       AND user_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, userId, savedViewId]
  );
  const row = Array.isArray(result?.rows) ? result.rows[0] : null;
  return row ? mapSavedViewRow(row) : null;
}

export async function listUserSavedViews({ tenantId, userId, moduleCode }) {
  const normalizedModuleCode = normalizeModuleCode(moduleCode, { required: false });
  try {
    const params = [tenantId, userId];
    let whereModuleSql = "";
    if (normalizedModuleCode) {
      whereModuleSql = " AND module_code = ?";
      params.push(normalizedModuleCode);
    }
    const result = await query(
      `SELECT id, module_code, view_name, view_payload_json, is_default, created_at, updated_at
       FROM user_saved_views
       WHERE tenant_id = ?
         AND user_id = ?${whereModuleSql}
       ORDER BY module_code ASC, is_default DESC, updated_at DESC, id DESC`,
      params
    );
    return (result.rows || []).map(mapSavedViewRow);
  } catch (err) {
    if (isMissingTableError(err)) {
      return [];
    }
    throw err;
  }
}

export async function createUserSavedView({
  tenantId,
  userId,
  moduleCode,
  name,
  definition,
  isDefault = false,
}) {
  const normalizedModuleCode = normalizeModuleCode(moduleCode, { required: true });
  const normalizedName = normalizeViewName(name, { required: true });
  const normalizedDefinition = normalizeViewPayload(definition, { required: true });
  try {
    return await withTransaction(async (tx) => {
      const countResult = await tx.query(
        `SELECT COUNT(*) AS total
         FROM user_saved_views
         WHERE tenant_id = ?
           AND user_id = ?
           AND module_code = ?`,
        [tenantId, userId, normalizedModuleCode]
      );
      const moduleTotal = Number(countResult?.rows?.[0]?.total || 0);
      if (moduleTotal >= MAX_SAVED_VIEWS_PER_MODULE) {
        throw createBadRequest(
          `Maximum saved views reached for module (${MAX_SAVED_VIEWS_PER_MODULE})`
        );
      }

      if (isDefault) {
        await tx.query(
          `UPDATE user_saved_views
           SET is_default = 0
           WHERE tenant_id = ?
             AND user_id = ?
             AND module_code = ?`,
          [tenantId, userId, normalizedModuleCode]
        );
      }

      const insertResult = await tx.query(
        `INSERT INTO user_saved_views (
           tenant_id,
           user_id,
           module_code,
           view_name,
           view_payload_json,
           is_default
         ) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
        [
          tenantId,
          userId,
          normalizedModuleCode,
          normalizedName,
          JSON.stringify(normalizedDefinition),
          isDefault ? 1 : 0,
        ]
      );
      const savedViewId = toPositiveInt(insertResult?.rows?.insertId);
      if (!savedViewId) {
        throw new Error("Saved view insert did not return id");
      }
      return loadSavedViewById(tx, { tenantId, userId, savedViewId });
    });
  } catch (err) {
    if (Number(err?.errno) === 1062) {
      throw createBadRequest("Saved view name already exists for this module");
    }
    if (isMissingTableError(err)) {
      throw createBadRequest("Saved views table is not available. Run migrations first.");
    }
    throw err;
  }
}

export async function updateUserSavedView({
  tenantId,
  userId,
  savedViewId,
  name,
  definition,
  isDefault,
}) {
  const normalizedSavedViewId = toPositiveInt(savedViewId);
  if (!normalizedSavedViewId) {
    throw createBadRequest("savedViewId is invalid");
  }

  const hasNamePatch = name !== undefined;
  const hasDefinitionPatch = definition !== undefined;
  const hasIsDefaultPatch = isDefault !== undefined;
  const normalizedName = hasNamePatch
    ? normalizeViewName(name, { required: true })
    : "";
  const normalizedDefinition = hasDefinitionPatch
    ? normalizeViewPayload(definition, { required: true })
    : undefined;
  const normalizedIsDefault = hasIsDefaultPatch ? Boolean(isDefault) : undefined;

  try {
    return await withTransaction(async (tx) => {
      const current = await loadSavedViewById(tx, {
        tenantId,
        userId,
        savedViewId: normalizedSavedViewId,
      });
      if (!current) {
        return null;
      }

      const setClauses = [];
      const params = [];
      if (hasNamePatch) {
        setClauses.push("view_name = ?");
        params.push(normalizedName);
      }
      if (hasDefinitionPatch) {
        setClauses.push("view_payload_json = CAST(? AS JSON)");
        params.push(JSON.stringify(normalizedDefinition));
      }
      if (hasIsDefaultPatch) {
        setClauses.push("is_default = ?");
        params.push(normalizedIsDefault ? 1 : 0);
      }

      if (setClauses.length === 0) {
        return current;
      }

      if (hasIsDefaultPatch && normalizedIsDefault) {
        await tx.query(
          `UPDATE user_saved_views
           SET is_default = 0
           WHERE tenant_id = ?
             AND user_id = ?
             AND module_code = ?
             AND id <> ?`,
          [tenantId, userId, current.moduleCode, normalizedSavedViewId]
        );
      }

      params.push(tenantId, userId, normalizedSavedViewId);
      await tx.query(
        `UPDATE user_saved_views
         SET ${setClauses.join(", ")},
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND user_id = ?
           AND id = ?`,
        params
      );

      return loadSavedViewById(tx, {
        tenantId,
        userId,
        savedViewId: normalizedSavedViewId,
      });
    });
  } catch (err) {
    if (Number(err?.errno) === 1062) {
      throw createBadRequest("Saved view name already exists for this module");
    }
    if (isMissingTableError(err)) {
      throw createBadRequest("Saved views table is not available. Run migrations first.");
    }
    throw err;
  }
}

export async function deleteUserSavedView({ tenantId, userId, savedViewId }) {
  const normalizedSavedViewId = toPositiveInt(savedViewId);
  if (!normalizedSavedViewId) {
    throw createBadRequest("savedViewId is invalid");
  }
  try {
    const result = await query(
      `DELETE FROM user_saved_views
       WHERE tenant_id = ?
         AND user_id = ?
         AND id = ?`,
      [tenantId, userId, normalizedSavedViewId]
    );
    return Number(result?.rows?.affectedRows || 0) > 0;
  } catch (err) {
    if (isMissingTableError(err)) {
      throw createBadRequest("Saved views table is not available. Run migrations first.");
    }
    throw err;
  }
}
