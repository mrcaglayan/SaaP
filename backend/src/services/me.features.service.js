import { query } from "../db.js";

function parseFeatureConfig(value) {
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

function normalizeFeatureCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

export async function listTenantFeatures({ tenantId, includeDisabled = true }) {
  try {
    const whereClauses = ["tenant_id = ?"];
    const params = [tenantId];
    if (!includeDisabled) {
      whereClauses.push("is_enabled = 1");
    }

    const result = await query(
      `SELECT
         feature_code,
         is_enabled,
         config_json,
         updated_at
       FROM tenant_features
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY feature_code`,
      params
    );

    const rows = (result.rows || []).map((row) => {
      const featureCode = normalizeFeatureCode(row?.feature_code);
      return {
        featureCode,
        isEnabled: Number(row?.is_enabled) === 1,
        config: parseFeatureConfig(row?.config_json),
        updatedAt: row?.updated_at || null,
      };
    });

    const enabledFeatureCodes = rows
      .filter((row) => row.isEnabled)
      .map((row) => row.featureCode);

    const flags = {};
    for (const row of rows) {
      flags[row.featureCode] = row.isEnabled;
    }

    return {
      rows,
      total: rows.length,
      enabledFeatureCodes,
      flags,
    };
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err;
    }
    return {
      rows: [],
      total: 0,
      enabledFeatureCodes: [],
      flags: {},
    };
  }
}

