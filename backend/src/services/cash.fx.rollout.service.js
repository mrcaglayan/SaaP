import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  FEATURE_CASH_FX_EXF05_GA_V1,
  FEATURE_CASH_FX_EXF05_PILOT_V1,
} from "./features.catalog.js";

export const CASH_FX_EXF05_FEATURE_PILOT = FEATURE_CASH_FX_EXF05_PILOT_V1;
export const CASH_FX_EXF05_FEATURE_GA = FEATURE_CASH_FX_EXF05_GA_V1;

const ROLLOUT_PHASES = Object.freeze(["PILOT", "GA", "ROLLBACK"]);

function normalizePhase(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!ROLLOUT_PHASES.includes(normalized)) {
    throw badRequest(`phase must be one of: ${ROLLOUT_PHASES.join(", ")}`);
  }
  return normalized;
}

function normalizeFeatureCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

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

function toBooleanBit(value) {
  return Number(value) === 1;
}

function ensureTenantId(tenantId) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  return normalizedTenantId;
}

function asNullableActorUserId(userId) {
  return parsePositiveInt(userId) || null;
}

async function loadFeatureRows({
  tenantId,
  featureCodes,
  runQuery = query,
}) {
  const normalizedCodes = Array.from(
    new Set((featureCodes || []).map((item) => normalizeFeatureCode(item)).filter(Boolean))
  );
  if (normalizedCodes.length === 0) {
    return [];
  }
  const placeholders = normalizedCodes.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT feature_code, is_enabled, config_json, updated_at
     FROM tenant_features
     WHERE tenant_id = ?
       AND feature_code IN (${placeholders})`,
    [tenantId, ...normalizedCodes]
  );
  return result.rows || [];
}

function buildFeatureStateMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const featureCode = normalizeFeatureCode(row?.feature_code);
    if (!featureCode) continue;
    map.set(featureCode, {
      featureCode,
      isEnabled: toBooleanBit(row?.is_enabled),
      config: parseFeatureConfig(row?.config_json),
      updatedAt: row?.updated_at || null,
    });
  }
  return map;
}

function ensureDefaultFeatureState(map, featureCode) {
  const normalizedCode = normalizeFeatureCode(featureCode);
  if (!map.has(normalizedCode)) {
    map.set(normalizedCode, {
      featureCode: normalizedCode,
      isEnabled: false,
      config: null,
      updatedAt: null,
    });
  }
  return map.get(normalizedCode);
}

function getRolloutTargetFlags(phase) {
  const normalized = normalizePhase(phase);
  if (normalized === "PILOT") {
    return {
      [CASH_FX_EXF05_FEATURE_PILOT]: true,
      [CASH_FX_EXF05_FEATURE_GA]: false,
    };
  }
  if (normalized === "GA") {
    return {
      [CASH_FX_EXF05_FEATURE_PILOT]: true,
      [CASH_FX_EXF05_FEATURE_GA]: true,
    };
  }
  return {
    [CASH_FX_EXF05_FEATURE_PILOT]: false,
    [CASH_FX_EXF05_FEATURE_GA]: false,
  };
}

async function upsertFeatureFlag({
  tenantId,
  featureCode,
  isEnabled,
  config = null,
  updatedByUserId = null,
  runQuery = query,
}) {
  await runQuery(
    `INSERT INTO tenant_features (
        tenant_id,
        feature_code,
        is_enabled,
        config_json,
        updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled),
        config_json = VALUES(config_json),
        updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      tenantId,
      normalizeFeatureCode(featureCode),
      isEnabled ? 1 : 0,
      JSON.stringify(config ?? null),
      asNullableActorUserId(updatedByUserId),
    ]
  );
}

export async function getCashFxRolloutState({ tenantId }) {
  const normalizedTenantId = ensureTenantId(tenantId);
  const rows = await loadFeatureRows({
    tenantId: normalizedTenantId,
    featureCodes: [CASH_FX_EXF05_FEATURE_PILOT, CASH_FX_EXF05_FEATURE_GA],
  });
  const map = buildFeatureStateMap(rows);
  const pilot = ensureDefaultFeatureState(map, CASH_FX_EXF05_FEATURE_PILOT);
  const ga = ensureDefaultFeatureState(map, CASH_FX_EXF05_FEATURE_GA);

  return {
    tenantId: normalizedTenantId,
    pilot,
    ga,
    phase: ga.isEnabled ? "GA" : pilot.isEnabled ? "PILOT" : "ROLLBACK",
  };
}

export async function setCashFxRolloutPhase({
  tenantId,
  phase,
  updatedByUserId = null,
  force = false,
  note = null,
}) {
  const normalizedTenantId = ensureTenantId(tenantId);
  const normalizedPhase = normalizePhase(phase);
  const normalizedForce = Boolean(force);
  const normalizedNote = String(note || "").trim().slice(0, 500) || null;

  return withTransaction(async (tx) => {
    const before = await getCashFxRolloutState({
      tenantId: normalizedTenantId,
    });
    if (
      normalizedPhase === "GA" &&
      !before.pilot.isEnabled &&
      !normalizedForce
    ) {
      throw badRequest(
        "Cannot enable GA before PILOT phase. Enable PILOT first or use force=true for emergency override."
      );
    }

    const target = getRolloutTargetFlags(normalizedPhase);
    const changedAt = new Date().toISOString();

    for (const [featureCode, isEnabled] of Object.entries(target)) {
      const previous = featureCode === CASH_FX_EXF05_FEATURE_PILOT ? before.pilot : before.ga;
      // eslint-disable-next-line no-await-in-loop
      await upsertFeatureFlag({
        tenantId: normalizedTenantId,
        featureCode,
        isEnabled,
        updatedByUserId,
        config: {
          rolloutPhase: normalizedPhase,
          changedAt,
          forced: normalizedForce,
          note: normalizedNote,
          previousValue: Boolean(previous?.isEnabled),
        },
        runQuery: tx.query,
      });
    }

    const afterRows = await loadFeatureRows({
      tenantId: normalizedTenantId,
      featureCodes: [CASH_FX_EXF05_FEATURE_PILOT, CASH_FX_EXF05_FEATURE_GA],
      runQuery: tx.query,
    });
    const afterMap = buildFeatureStateMap(afterRows);
    const pilot = ensureDefaultFeatureState(afterMap, CASH_FX_EXF05_FEATURE_PILOT);
    const ga = ensureDefaultFeatureState(afterMap, CASH_FX_EXF05_FEATURE_GA);
    const after = {
      tenantId: normalizedTenantId,
      pilot,
      ga,
      phase: ga.isEnabled ? "GA" : pilot.isEnabled ? "PILOT" : "ROLLBACK",
    };

    return {
      tenantId: normalizedTenantId,
      requestedPhase: normalizedPhase,
      force: normalizedForce,
      note: normalizedNote,
      before,
      after,
    };
  });
}

export default {
  CASH_FX_EXF05_FEATURE_PILOT,
  CASH_FX_EXF05_FEATURE_GA,
  getCashFxRolloutState,
  setCashFxRolloutPhase,
};
