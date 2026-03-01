import { closePool, query, withTransaction } from "../src/db.js";

const FEATURE_SUBACCOUNTS_V1 = "FEATURE_SUBACCOUNTS_V1";
const FEATURE_SETUP_WIZARD_V2 = "FEATURE_SETUP_WIZARD_V2";
const FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1 =
  "FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1";
const FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1 =
  "FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1";
const FEATURE_TAX_ENGINE_V1 = "FEATURE_TAX_ENGINE_V1";

const ALL_FEATURE_CODES = Object.freeze([
  FEATURE_SUBACCOUNTS_V1,
  FEATURE_SETUP_WIZARD_V2,
  FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1,
  FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1,
  FEATURE_TAX_ENGINE_V1,
]);

const PHASE_CONFIG = Object.freeze({
  A: Object.freeze({
    description:
      "Foundation pilot rollout (setup wizard + subaccounts + canonical mapping)",
    targetFlags: Object.freeze({
      [FEATURE_SUBACCOUNTS_V1]: true,
      [FEATURE_SETUP_WIZARD_V2]: true,
      [FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1]: true,
      [FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1]: false,
      [FEATURE_TAX_ENGINE_V1]: false,
    }),
    readinessRequirements: Object.freeze(["canonical"]),
  }),
  B: Object.freeze({
    description: "Approval gate rollout (phase A + workflow close/consolidation)",
    targetFlags: Object.freeze({
      [FEATURE_SUBACCOUNTS_V1]: true,
      [FEATURE_SETUP_WIZARD_V2]: true,
      [FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1]: true,
      [FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1]: true,
      [FEATURE_TAX_ENGINE_V1]: false,
    }),
    readinessRequirements: Object.freeze(["canonical", "workflow"]),
  }),
  C: Object.freeze({
    description: "Tax rollout (phase B + tax engine)",
    targetFlags: Object.freeze({
      [FEATURE_SUBACCOUNTS_V1]: true,
      [FEATURE_SETUP_WIZARD_V2]: true,
      [FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1]: true,
      [FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1]: true,
      [FEATURE_TAX_ENGINE_V1]: true,
    }),
    readinessRequirements: Object.freeze(["canonical", "workflow", "tax"]),
  }),
});

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseDateOnly(value, fallbackDate) {
  if (!value) {
    return fallbackDate;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return fallbackDate;
  }
  return normalized;
}

function normalizePhase(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return normalized || null;
}

function parseTenantIdList(value) {
  const result = [];
  if (value === undefined || value === null) {
    return result;
  }
  for (const part of String(value).split(",")) {
    const parsed = parsePositiveIntOrNull(part.trim());
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}

function normalizeFeatureCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/pilot-rollout-prf13.js --tenantIds <id1,id2> [options]",
      "",
      "Required:",
      "  --tenantIds <id1,id2>   Comma-separated tenant ids for pilot rollout.",
      "",
      "Options:",
      "  --tenantId <id>          Add single tenant id (repeatable).",
      "  --phase <A|B|C>          Rollout phase to apply. Default: A.",
      "  --effectiveOn <YYYY-MM-DD>  Readiness check date. Default: today UTC.",
      "  --updatedByUserId <id>   Preferred actor user id per tenant.",
      "  --limit <N>              Limit resolved tenant count.",
      "  --apply                  Apply feature flag updates.",
      "  --force                  Apply even when phase readiness checks fail.",
      "  --help                   Show this help text.",
      "",
      "Example (dry-run):",
      "  npm run rollout:prf13-pilot -- --tenantIds 101,102 --phase B",
      "Example (apply):",
      "  npm run rollout:prf13-pilot -- --tenantIds 101,102 --phase B --apply",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10);
  const args = {
    tenantIds: [],
    phase: "A",
    effectiveOn: today,
    updatedByUserId: null,
    limit: null,
    apply: false,
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) {
      continue;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--force") {
      args.force = true;
      continue;
    }
    if (token.startsWith("--phase=")) {
      args.phase = normalizePhase(token.split("=")[1]) || args.phase;
      continue;
    }
    if (token === "--phase") {
      args.phase = normalizePhase(argv[i + 1]) || args.phase;
      i += 1;
      continue;
    }
    if (token.startsWith("--tenantIds=")) {
      args.tenantIds.push(...parseTenantIdList(token.split("=")[1]));
      continue;
    }
    if (token === "--tenantIds") {
      args.tenantIds.push(...parseTenantIdList(argv[i + 1]));
      i += 1;
      continue;
    }
    if (token.startsWith("--tenantId=")) {
      const parsedTenantId = parsePositiveIntOrNull(token.split("=")[1]);
      if (parsedTenantId) {
        args.tenantIds.push(parsedTenantId);
      }
      continue;
    }
    if (token === "--tenantId") {
      const parsedTenantId = parsePositiveIntOrNull(argv[i + 1]);
      if (parsedTenantId) {
        args.tenantIds.push(parsedTenantId);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--effectiveOn=")) {
      args.effectiveOn = parseDateOnly(token.split("=")[1], args.effectiveOn);
      continue;
    }
    if (token === "--effectiveOn") {
      args.effectiveOn = parseDateOnly(argv[i + 1], args.effectiveOn);
      i += 1;
      continue;
    }
    if (token.startsWith("--updatedByUserId=")) {
      args.updatedByUserId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--updatedByUserId") {
      args.updatedByUserId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--limit=")) {
      args.limit = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--limit") {
      args.limit = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  args.tenantIds = Array.from(new Set(args.tenantIds)).sort((left, right) => left - right);
  return args;
}

async function resolveTenantRows({ tenantIds, limit }) {
  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    throw new Error("At least one tenant id is required (--tenantIds or --tenantId).");
  }

  const placeholders = tenantIds.map(() => "?").join(", ");
  const params = [...tenantIds];
  const limitClause = parsePositiveIntOrNull(limit) ? `LIMIT ${limit}` : "";
  const result = await query(
    `SELECT id AS tenant_id, code AS tenant_code, name AS tenant_name
     FROM tenants
     WHERE id IN (${placeholders})
     ORDER BY id ASC
     ${limitClause}`,
    params
  );
  const rows = result.rows || [];
  const foundIds = new Set(rows.map((row) => parsePositiveIntOrNull(row.tenant_id)));
  const missingIds = tenantIds.filter((tenantId) => !foundIds.has(tenantId));
  if (missingIds.length > 0) {
    throw new Error(`Tenant ids not found: ${missingIds.join(", ")}`);
  }
  return rows;
}

async function resolveActorUserId(tenantId, preferredUserId) {
  if (preferredUserId) {
    const preferred = await query(
      `SELECT id
       FROM users
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, preferredUserId]
    );
    const resolvedPreferredId = parsePositiveIntOrNull(preferred.rows?.[0]?.id);
    if (resolvedPreferredId) {
      return resolvedPreferredId;
    }
  }

  const fallback = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  return parsePositiveIntOrNull(fallback.rows?.[0]?.id);
}

async function loadCurrentFeatureMap(tenantId) {
  const map = Object.fromEntries(ALL_FEATURE_CODES.map((featureCode) => [featureCode, false]));
  const placeholders = ALL_FEATURE_CODES.map(() => "?").join(", ");
  try {
    const result = await query(
      `SELECT feature_code, is_enabled
       FROM tenant_features
       WHERE tenant_id = ?
         AND feature_code IN (${placeholders})`,
      [tenantId, ...ALL_FEATURE_CODES]
    );
    for (const row of result.rows || []) {
      const featureCode = normalizeFeatureCode(row?.feature_code);
      if (!Object.prototype.hasOwnProperty.call(map, featureCode)) {
        continue;
      }
      map[featureCode] = Number(row?.is_enabled) === 1;
    }
    return map;
  } catch (err) {
    if (isMissingTableError(err)) {
      return map;
    }
    throw err;
  }
}

function serializeFeatureMap(featureMap) {
  return ALL_FEATURE_CODES.map((featureCode) => ({
    featureCode,
    enabled: Boolean(featureMap[featureCode]),
  }));
}

function buildFeatureChangeSet(currentMap, targetMap) {
  return ALL_FEATURE_CODES.map((featureCode) => ({
    featureCode,
    currentEnabled: Boolean(currentMap[featureCode]),
    targetEnabled: Boolean(targetMap[featureCode]),
    changed: Boolean(currentMap[featureCode]) !== Boolean(targetMap[featureCode]),
  }));
}

function toNumericCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadWorkflowReadiness(tenantId, effectiveOn) {
  try {
    const result = await query(
      `SELECT wa.process_type, COUNT(*) AS assignment_count
       FROM workflow_assignments wa
       JOIN workflow_definitions wd
         ON wd.id = wa.workflow_definition_id
        AND wd.tenant_id = wa.tenant_id
        AND wd.is_active = TRUE
       WHERE wa.tenant_id = ?
         AND wa.status = 'ACTIVE'
         AND wa.effective_from <= ?
         AND (wa.effective_to IS NULL OR wa.effective_to >= ?)
       GROUP BY wa.process_type`,
      [tenantId, effectiveOn, effectiveOn]
    );

    const countByProcessType = {
      PERIOD_CLOSE: 0,
      CONSOLIDATION_RUN: 0,
    };
    for (const row of result.rows || []) {
      const processType = String(row?.process_type || "").trim().toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(countByProcessType, processType)) {
        continue;
      }
      countByProcessType[processType] = toNumericCount(row?.assignment_count);
    }

    const issues = [];
    if (countByProcessType.PERIOD_CLOSE <= 0) {
      issues.push("Missing active PERIOD_CLOSE workflow assignment");
    }
    if (countByProcessType.CONSOLIDATION_RUN <= 0) {
      issues.push("Missing active CONSOLIDATION_RUN workflow assignment");
    }

    return {
      ready: issues.length === 0,
      counts: countByProcessType,
      issues,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        ready: false,
        counts: { PERIOD_CLOSE: 0, CONSOLIDATION_RUN: 0 },
        issues: ["workflow tables are missing (run migrations first)"],
      };
    }
    throw err;
  }
}

async function loadTaxReadiness(tenantId, effectiveOn) {
  try {
    const result = await query(
      `SELECT
         COALESCE((
           SELECT COUNT(*)
           FROM tax_regimes tr
           WHERE tr.tenant_id = ?
             AND tr.status = 'ACTIVE'
             AND tr.effective_from <= ?
             AND (tr.effective_to IS NULL OR tr.effective_to >= ?)
         ), 0) AS regime_count,
         COALESCE((
           SELECT COUNT(*)
           FROM tax_codes tc
           JOIN tax_regimes tr ON tr.id = tc.tax_regime_id
           WHERE tc.tenant_id = ?
             AND tc.status = 'ACTIVE'
             AND tr.status = 'ACTIVE'
             AND tr.effective_from <= ?
             AND (tr.effective_to IS NULL OR tr.effective_to >= ?)
         ), 0) AS code_count,
         COALESCE((
           SELECT COUNT(*)
           FROM tax_rule_sets trs
           JOIN tax_regimes tr ON tr.id = trs.tax_regime_id
           WHERE trs.tenant_id = ?
             AND trs.status = 'ACTIVE'
             AND trs.effective_from <= ?
             AND (trs.effective_to IS NULL OR trs.effective_to >= ?)
             AND tr.status = 'ACTIVE'
             AND tr.effective_from <= ?
             AND (tr.effective_to IS NULL OR tr.effective_to >= ?)
         ), 0) AS rule_count,
         COALESCE((
           SELECT COUNT(*)
           FROM tax_account_mappings tam
           JOIN tax_regimes tr ON tr.id = tam.tax_regime_id
           WHERE tam.tenant_id = ?
             AND tam.status = 'ACTIVE'
             AND tr.status = 'ACTIVE'
             AND tr.effective_from <= ?
             AND (tr.effective_to IS NULL OR tr.effective_to >= ?)
         ), 0) AS mapping_count`,
      [
        tenantId,
        effectiveOn,
        effectiveOn,
        tenantId,
        effectiveOn,
        effectiveOn,
        tenantId,
        effectiveOn,
        effectiveOn,
        effectiveOn,
        effectiveOn,
        tenantId,
        effectiveOn,
        effectiveOn,
      ]
    );

    const row = result.rows?.[0] || {};
    const counts = {
      regimes: toNumericCount(row.regime_count),
      codes: toNumericCount(row.code_count),
      rules: toNumericCount(row.rule_count),
      accountMappings: toNumericCount(row.mapping_count),
    };

    const issues = [];
    if (counts.regimes <= 0) {
      issues.push("Missing active tax regime");
    }
    if (counts.codes <= 0) {
      issues.push("Missing active tax code");
    }
    if (counts.rules <= 0) {
      issues.push("Missing active tax rule set");
    }
    if (counts.accountMappings <= 0) {
      issues.push("Missing active tax account mapping");
    }

    return {
      ready: issues.length === 0,
      counts,
      issues,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        ready: false,
        counts: {
          regimes: 0,
          codes: 0,
          rules: 0,
          accountMappings: 0,
        },
        issues: ["tax tables are missing (run migrations first)"],
      };
    }
    throw err;
  }
}

async function loadCanonicalMappingReadiness(tenantId, effectiveOn) {
  try {
    const result = await query(
      `SELECT
         COALESCE((
           SELECT COUNT(*)
           FROM consolidation_canonical_keys cck
           WHERE cck.tenant_id = ?
             AND cck.status = 'ACTIVE'
         ), 0) AS key_count,
         COALESCE((
           SELECT COUNT(*)
           FROM consolidation_canonical_local_account_mappings cclam
           WHERE cclam.tenant_id = ?
             AND cclam.status = 'ACTIVE'
             AND cclam.effective_from <= ?
             AND (cclam.effective_to IS NULL OR cclam.effective_to >= ?)
         ), 0) AS local_mapping_count,
         COALESCE((
           SELECT COUNT(*)
           FROM consolidation_canonical_group_account_mappings ccgam
           WHERE ccgam.tenant_id = ?
             AND ccgam.status = 'ACTIVE'
             AND ccgam.effective_from <= ?
             AND (ccgam.effective_to IS NULL OR ccgam.effective_to >= ?)
         ), 0) AS group_mapping_count`,
      [tenantId, tenantId, effectiveOn, effectiveOn, tenantId, effectiveOn, effectiveOn]
    );

    const row = result.rows?.[0] || {};
    const counts = {
      keys: toNumericCount(row.key_count),
      localMappings: toNumericCount(row.local_mapping_count),
      groupMappings: toNumericCount(row.group_mapping_count),
    };

    const issues = [];
    if (counts.keys <= 0) {
      issues.push("Missing active canonical keys");
    }
    if (counts.localMappings <= 0) {
      issues.push("Missing active canonical local-account mappings");
    }
    if (counts.groupMappings <= 0) {
      issues.push("Missing active canonical group-account mappings");
    }

    return {
      ready: issues.length === 0,
      counts,
      issues,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        ready: false,
        counts: {
          keys: 0,
          localMappings: 0,
          groupMappings: 0,
        },
        issues: ["canonical mapping tables are missing (run migrations first)"],
      };
    }
    throw err;
  }
}

function evaluatePhaseReadiness(phaseCode, readinessSnapshot) {
  const requirements = PHASE_CONFIG[phaseCode]?.readinessRequirements || [];
  const missingRequirements = [];
  for (const requirement of requirements) {
    if (requirement === "canonical" && !readinessSnapshot.canonical.ready) {
      missingRequirements.push("canonical");
    }
    if (requirement === "workflow" && !readinessSnapshot.workflow.ready) {
      missingRequirements.push("workflow");
    }
    if (requirement === "tax" && !readinessSnapshot.tax.ready) {
      missingRequirements.push("tax");
    }
  }

  return {
    ready: missingRequirements.length === 0,
    missingRequirements,
  };
}

async function buildReadinessSnapshot(tenantId, effectiveOn) {
  const [workflow, tax, canonical] = await Promise.all([
    loadWorkflowReadiness(tenantId, effectiveOn),
    loadTaxReadiness(tenantId, effectiveOn),
    loadCanonicalMappingReadiness(tenantId, effectiveOn),
  ]);

  return { workflow, tax, canonical };
}

async function upsertFeatureFlagsTx(tx, { tenantId, actorUserId, targetFeatureMap }) {
  for (const featureCode of ALL_FEATURE_CODES) {
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO tenant_features (
          tenant_id,
          feature_code,
          is_enabled,
          updated_by_user_id
       )
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_enabled = VALUES(is_enabled),
         updated_by_user_id = VALUES(updated_by_user_id),
         updated_at = CURRENT_TIMESTAMP`,
      [tenantId, featureCode, targetFeatureMap[featureCode] ? 1 : 0, actorUserId]
    );
  }
}

function summarizePlanRows(rows) {
  return rows.map((row) => ({
    tenantId: row.tenantId,
    tenantCode: row.tenantCode,
    tenantName: row.tenantName,
    actorUserId: row.actorUserId,
    phaseReadiness: row.phaseReadiness,
    readiness: row.readinessSnapshot,
    featureChanges: row.featureChanges.filter((entry) => entry.changed),
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const phaseCode = normalizePhase(args.phase);
  if (!Object.prototype.hasOwnProperty.call(PHASE_CONFIG, phaseCode)) {
    throw new Error(`Invalid --phase value: ${args.phase}. Use A, B, or C.`);
  }

  const tenants = await resolveTenantRows({ tenantIds: args.tenantIds, limit: args.limit });
  const planRows = [];
  for (const tenant of tenants) {
    const tenantId = parsePositiveIntOrNull(tenant.tenant_id);
    if (!tenantId) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const actorUserId = await resolveActorUserId(tenantId, args.updatedByUserId);
    // eslint-disable-next-line no-await-in-loop
    const currentFeatureMap = await loadCurrentFeatureMap(tenantId);
    const targetFeatureMap = PHASE_CONFIG[phaseCode].targetFlags;
    // eslint-disable-next-line no-await-in-loop
    const readinessSnapshot = await buildReadinessSnapshot(tenantId, args.effectiveOn);
    const phaseReadiness = evaluatePhaseReadiness(phaseCode, readinessSnapshot);

    planRows.push({
      tenantId,
      tenantCode: String(tenant.tenant_code || "").trim() || null,
      tenantName: String(tenant.tenant_name || "").trim() || null,
      actorUserId,
      targetFeatureMap,
      featureChanges: buildFeatureChangeSet(currentFeatureMap, targetFeatureMap),
      readinessSnapshot,
      phaseReadiness,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        phase: phaseCode,
        phaseDescription: PHASE_CONFIG[phaseCode].description,
        effectiveOn: args.effectiveOn,
        force: args.force,
        tenantCount: planRows.length,
        tenants: summarizePlanRows(planRows),
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to write pilot feature flags.");
    console.log(
      "After enabling a phase, run: npm run test:followup:prf13-release-gate (and record results in 12-PR-F13-PILOT-GA-SWITCH-PLAN.md)."
    );
    return;
  }

  const applyResults = [];
  let appliedCount = 0;
  let blockedCount = 0;
  let skippedNoUserCount = 0;

  for (const row of planRows) {
    if (!row.actorUserId) {
      skippedNoUserCount += 1;
      applyResults.push({
        tenantId: row.tenantId,
        status: "SKIPPED_NO_USER",
        reason: "No tenant user found for updated_by_user_id",
      });
      continue;
    }

    if (!row.phaseReadiness.ready && !args.force) {
      blockedCount += 1;
      applyResults.push({
        tenantId: row.tenantId,
        status: "BLOCKED_READINESS",
        reason: `Missing readiness for phase ${phaseCode}: ${row.phaseReadiness.missingRequirements.join(
          ", "
        )}`,
      });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await withTransaction(async (tx) => {
      await upsertFeatureFlagsTx(tx, {
        tenantId: row.tenantId,
        actorUserId: row.actorUserId,
        targetFeatureMap: row.targetFeatureMap,
      });
    });

    // eslint-disable-next-line no-await-in-loop
    const verifiedFeatureMap = await loadCurrentFeatureMap(row.tenantId);
    appliedCount += 1;
    applyResults.push({
      tenantId: row.tenantId,
      status: "APPLIED",
      actorUserId: row.actorUserId,
      verifiedFlags: serializeFeatureMap(verifiedFeatureMap),
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "apply",
        phase: phaseCode,
        phaseDescription: PHASE_CONFIG[phaseCode].description,
        effectiveOn: args.effectiveOn,
        force: args.force,
        metrics: {
          tenantCount: planRows.length,
          appliedCount,
          blockedCount,
          skippedNoUserCount,
        },
        results: applyResults,
        nextCommands: [
          "npm run test:followup:prf13-release-gate",
          "$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate",
        ],
        gaSwitchPlanDoc: "12-PR-F13-PILOT-GA-SWITCH-PLAN.md",
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
