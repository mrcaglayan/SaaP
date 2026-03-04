import { closePool, query } from "../src/db.js";
import {
  getCashFxRolloutState,
  setCashFxRolloutPhase,
} from "../src/services/cash.fx.rollout.service.js";

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTenantIdList(value) {
  const ids = [];
  if (value === undefined || value === null) return ids;
  for (const token of String(value).split(",")) {
    const parsed = parsePositiveIntOrNull(token.trim());
    if (parsed) ids.push(parsed);
  }
  return ids;
}

function normalizePhase(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (["PILOT", "GA", "ROLLBACK"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/cash-fx-rollout-exf05.js --tenantIds <id1,id2> [options]",
      "",
      "Required:",
      "  --tenantIds <id1,id2>       Comma-separated tenant ids.",
      "",
      "Options:",
      "  --tenantId <id>             Add single tenant id (repeatable).",
      "  --phase <PILOT|GA|ROLLBACK> Target phase (default: PILOT).",
      "  --updatedByUserId <id>      Preferred actor user id per tenant.",
      "  --note <text>               Optional rollout note (stored in config_json).",
      "  --limit <N>                 Limit resolved tenant count.",
      "  --force                     Allow GA without existing pilot state.",
      "  --apply                     Persist feature toggles (default: dry-run).",
      "  --help                      Show this help text.",
      "",
      "Example (dry-run):",
      "  npm run rollout:cash-fx:exf05 -- --tenantIds 101,102 --phase PILOT",
      "Example (apply):",
      "  npm run rollout:cash-fx:exf05 -- --tenantIds 101,102 --phase GA --apply",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantIds: [],
    phase: "PILOT",
    updatedByUserId: null,
    note: null,
    limit: null,
    force: false,
    apply: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) continue;

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
      const parsed = parsePositiveIntOrNull(token.split("=")[1]);
      if (parsed) args.tenantIds.push(parsed);
      continue;
    }
    if (token === "--tenantId") {
      const parsed = parsePositiveIntOrNull(argv[i + 1]);
      if (parsed) args.tenantIds.push(parsed);
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
    if (token.startsWith("--note=")) {
      args.note = String(token.slice("--note=".length)).trim() || null;
      continue;
    }
    if (token === "--note") {
      args.note = String(argv[i + 1] || "").trim() || null;
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

  args.tenantIds = Array.from(new Set(args.tenantIds)).sort((a, b) => a - b);
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
    if (preferredId) return preferredId;
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

function summarizePlanRows(planRows) {
  return planRows.map((row) => ({
    tenantId: row.tenantId,
    tenantCode: row.tenantCode,
    tenantName: row.tenantName,
    actorUserId: row.actorUserId,
    requestedPhase: row.requestedPhase,
    force: row.force,
    blockedReason: row.blockedReason || null,
    beforePhase: row.before?.phase || null,
    beforePilotEnabled: Boolean(row.before?.pilot?.isEnabled),
    beforeGaEnabled: Boolean(row.before?.ga?.isEnabled),
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.phase) {
    throw new Error("--phase must be one of PILOT, GA, ROLLBACK");
  }

  const tenants = await resolveTenantRows({ tenantIds: args.tenantIds, limit: args.limit });
  const planRows = [];

  for (const tenant of tenants) {
    const tenantId = parsePositiveIntOrNull(tenant.tenant_id);
    if (!tenantId) continue;

    // eslint-disable-next-line no-await-in-loop
    const actorUserId = await resolveActorUserId(tenantId, args.updatedByUserId);
    // eslint-disable-next-line no-await-in-loop
    const before = await getCashFxRolloutState({ tenantId });
    const blockedReason =
      args.phase === "GA" && !args.force && !before.pilot?.isEnabled
        ? "Cannot enable GA before PILOT phase. Enable PILOT first or use --force."
        : null;

    planRows.push({
      tenantId,
      tenantCode: String(tenant.tenant_code || "").trim() || null,
      tenantName: String(tenant.tenant_name || "").trim() || null,
      actorUserId,
      requestedPhase: args.phase,
      force: args.force,
      note: args.note,
      before,
      blockedReason,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        phase: args.phase,
        force: args.force,
        tenantCount: planRows.length,
        tenants: summarizePlanRows(planRows),
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to persist EXF05 rollout feature flags.");
    return;
  }

  const results = [];
  let appliedCount = 0;
  let blockedCount = 0;
  let skippedNoUserCount = 0;

  for (const row of planRows) {
    if (!row.actorUserId) {
      skippedNoUserCount += 1;
      results.push({
        tenantId: row.tenantId,
        status: "SKIPPED_NO_USER",
        reason: "No tenant user found for updated_by_user_id",
      });
      continue;
    }
    if (row.blockedReason) {
      blockedCount += 1;
      results.push({
        tenantId: row.tenantId,
        status: "BLOCKED",
        reason: row.blockedReason,
      });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await setCashFxRolloutPhase({
        tenantId: row.tenantId,
        phase: args.phase,
        updatedByUserId: row.actorUserId,
        force: args.force,
        note: args.note,
      });
      appliedCount += 1;
      results.push({
        tenantId: row.tenantId,
        status: "APPLIED",
        actorUserId: row.actorUserId,
        beforePhase: result.before?.phase || null,
        afterPhase: result.after?.phase || null,
        afterPilotEnabled: Boolean(result.after?.pilot?.isEnabled),
        afterGaEnabled: Boolean(result.after?.ga?.isEnabled),
      });
    } catch (error) {
      results.push({
        tenantId: row.tenantId,
        status: "FAILED",
        reason: String(error?.message || "Unknown rollout error"),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "apply",
        phase: args.phase,
        force: args.force,
        metrics: {
          tenantCount: planRows.length,
          appliedCount,
          blockedCount,
          skippedNoUserCount,
        },
        results,
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
