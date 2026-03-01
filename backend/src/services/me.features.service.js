import { query } from "../db.js";
import {
  KNOWN_TENANT_FEATURE_CODES,
  normalizeFeatureCode,
} from "./features.catalog.js";

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

    if (includeDisabled) {
      const seen = new Set(rows.map((row) => row.featureCode));
      for (const featureCode of KNOWN_TENANT_FEATURE_CODES) {
        if (seen.has(featureCode)) {
          continue;
        }
        rows.push({
          featureCode,
          isEnabled: false,
          config: null,
          updatedAt: null,
        });
      }
      rows.sort((a, b) => a.featureCode.localeCompare(b.featureCode));
    }

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
      total: includeDisabled ? KNOWN_TENANT_FEATURE_CODES.length : 0,
      enabledFeatureCodes: [],
      flags: includeDisabled
        ? Object.fromEntries(KNOWN_TENANT_FEATURE_CODES.map((code) => [code, false]))
        : {},
    };
  }
}
