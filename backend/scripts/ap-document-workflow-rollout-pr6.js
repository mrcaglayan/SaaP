import { closePool, query } from "../src/db.js";
import {
  getApWorkflowRolloutState,
  setApWorkflowRolloutPhase,
  AP_WORKFLOW_ROLLOUT_PHASES,
} from "../src/services/ap.document.workflow.rollout.service.js";

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTenantIdList(value) {
  const ids = [];
  if (value === undefined || value === null) {
    return ids;
  }
  for (const token of String(value).split(",")) {
    const parsed = parsePositiveIntOrNull(token.trim());
    if (parsed) {
      ids.push(parsed);
    }
  }
  return ids;
}

function normalizeDateOnly(value, fallbackDate) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallbackDate;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  return fallbackDate;
}

function normalizePhase(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return AP_WORKFLOW_ROLLOUT_PHASES.includes(normalized) ? normalized : null;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/ap-document-workflow-rollout-pr6.js --tenantIds <id1,id2> [options]",
      "",
      "Required:",
      "  --tenantIds <id1,id2>         Comma-separated tenant ids.",
      "",
      "Options:",
      `  --phase <${AP_WORKFLOW_ROLLOUT_PHASES.join("|")}>   Rollout phase (default: PILOT).`,
      "  --tenantId <id>               Add one tenant id (repeatable).",
      "  --updatedByUserId <id>        Preferred actor user id per tenant.",
      "  --effectiveOn <YYYY-MM-DD>    Coverage/readiness date (default: today UTC).",
      "  --note <text>                 Optional rollout note stored on the feature rows.",
      "  --limit <N>                   Limit resolved tenant count.",
      "  --force                       Allow STRICT phase even when uncovered legal entities remain.",
      "  --apply                       Persist flag updates (default: dry-run).",
      "  --help                        Show this help text.",
      "",
      "Phase meanings:",
      "  PILOT     FEATURE on, compat mode on.",
      "  STRICT    FEATURE on, compat mode off.",
      "  ROLLBACK  FEATURE off, compat mode reset to on.",
      "",
      "Examples:",
      "  npm run rollout:ap-workflow:pr6 -- --tenantIds 101 --phase PILOT",
      "  npm run rollout:ap-workflow:pr6 -- --tenantIds 101 --phase STRICT --apply",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10);
  const args = {
    tenantIds: [],
    phase: "PILOT",
    updatedByUserId: null,
    effectiveOn: today,
    note: null,
    limit: null,
    force: false,
    apply: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
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
      args.phase = normalizePhase(argv[index + 1]) || args.phase;
      index += 1;
      continue;
    }
    if (token.startsWith("--tenantIds=")) {
      args.tenantIds.push(...parseTenantIdList(token.split("=")[1]));
      continue;
    }
    if (token === "--tenantIds") {
      args.tenantIds.push(...parseTenantIdList(argv[index + 1]));
      index += 1;
      continue;
    }
    if (token.startsWith("--tenantId=")) {
      const parsed = parsePositiveIntOrNull(token.split("=")[1]);
      if (parsed) {
        args.tenantIds.push(parsed);
      }
      continue;
    }
    if (token === "--tenantId") {
      const parsed = parsePositiveIntOrNull(argv[index + 1]);
      if (parsed) {
        args.tenantIds.push(parsed);
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--updatedByUserId=")) {
      args.updatedByUserId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--updatedByUserId") {
      args.updatedByUserId = parsePositiveIntOrNull(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--effectiveOn=")) {
      args.effectiveOn = normalizeDateOnly(token.split("=")[1], args.effectiveOn);
      continue;
    }
    if (token === "--effectiveOn") {
      args.effectiveOn = normalizeDateOnly(argv[index + 1], args.effectiveOn);
      index += 1;
      continue;
    }
    if (token.startsWith("--note=")) {
      args.note = String(token.slice("--note=".length)).trim() || null;
      continue;
    }
    if (token === "--note") {
      args.note = String(argv[index + 1] || "").trim() || null;
      index += 1;
      continue;
    }
    if (token.startsWith("--limit=")) {
      args.limit = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--limit") {
      args.limit = parsePositiveIntOrNull(argv[index + 1]);
      index += 1;
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
  const limitClause = limit ? `LIMIT ${limit}` : "";
  const result = await query(
    `SELECT id AS tenant_id, code AS tenant_code, name AS tenant_name
     FROM tenants
     WHERE id IN (${placeholders})
     ORDER BY id ASC
     ${limitClause}`,
    params
  );
  const rows = result.rows || [];
  const found = new Set(rows.map((row) => parsePositiveIntOrNull(row.tenant_id)));
  const missing = tenantIds.filter((tenantId) => !found.has(tenantId));
  if (missing.length > 0) {
    throw new Error(`Tenant ids not found: ${missing.join(", ")}`);
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
    const preferredId = parsePositiveIntOrNull(preferred.rows?.[0]?.id);
    if (preferredId) {
      return preferredId;
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

function summarizeState(state) {
  return {
    featureEnabled: Boolean(state?.featureEnabled),
    compatModeEnabled: Boolean(state?.compatModeEnabled),
    defaultDefinitionId: state?.defaultDefinition?.definitionId || null,
    defaultDefinitionCode: state?.defaultDefinition?.code || null,
    uncoveredLegalEntityCodes: (state?.coverage?.rows || [])
      .filter((row) => !row.covered)
      .map((row) => row.legalEntityCode || `LE#${row.legalEntityId}`),
    coveredCount: Number(state?.coverage?.coveredCount || 0),
    uncoveredCount: Number(state?.coverage?.uncoveredCount || 0),
    assignmentScopeCounts: state?.coverage?.scopeCounts || {},
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const tenants = await resolveTenantRows({
    tenantIds: args.tenantIds,
    limit: args.limit,
  });
  const planRows = [];

  for (const tenant of tenants) {
    const tenantId = parsePositiveIntOrNull(tenant.tenant_id);
    if (!tenantId) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const actorUserId = await resolveActorUserId(tenantId, args.updatedByUserId);
    if (!actorUserId) {
      throw new Error(
        `Tenant ${tenantId} has no user to record rollout ownership. Create an admin first.`
      );
    }
    // eslint-disable-next-line no-await-in-loop
    const before = await getApWorkflowRolloutState({
      tenantId,
      effectiveOn: args.effectiveOn,
    });
    planRows.push({
      tenantId,
      tenantCode: String(tenant.tenant_code || "").trim() || null,
      tenantName: String(tenant.tenant_name || "").trim() || null,
      actorUserId,
      requestedPhase: args.phase,
      force: Boolean(args.force),
      before: summarizeState(before),
      blockedReason:
        args.phase === "STRICT" && before.coverage.uncoveredCount > 0 && !args.force
          ? "STRICT phase requires AP workflow coverage for every active legal entity (or --force)."
          : null,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        requestedPhase: args.phase,
        effectiveOn: args.effectiveOn,
        force: Boolean(args.force),
        note: args.note,
        tenants: planRows,
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to update AP workflow rollout flags.");
    return;
  }

  const results = [];
  for (const row of planRows) {
    if (row.blockedReason && !args.force) {
      results.push({
        tenantId: row.tenantId,
        tenantCode: row.tenantCode,
        applied: false,
        blockedReason: row.blockedReason,
      });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const applied = await setApWorkflowRolloutPhase({
        tenantId: row.tenantId,
        updatedByUserId: row.actorUserId,
        phase: args.phase,
        effectiveOn: args.effectiveOn,
        note: args.note,
        force: Boolean(args.force),
      });
      results.push({
        tenantId: row.tenantId,
        tenantCode: row.tenantCode,
        applied: true,
        phase: applied.phase,
        after: summarizeState(applied.after),
      });
    } catch (error) {
      results.push({
        tenantId: row.tenantId,
        tenantCode: row.tenantCode,
        applied: false,
        error: String(error?.message || error),
        status: Number(error?.status || 0) || null,
      });
    }
  }

  console.log(JSON.stringify({ ok: true, mode: "apply", results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
