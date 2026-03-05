import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import {
  applyCanonicalMappingCandidates,
  listCanonicalMappingCandidates,
} from "../src/services/consolidation.canonical-mappings.service.js";

const MAX_CANDIDATE_LIMIT = 5000;

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseCsvPositiveInts(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((token) => parsePositiveIntOrNull(token.trim()))
        .filter(Boolean)
    )
  );
}

function sanitizeReason(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 500);
}

function sanitizeSource(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return normalized || "FUP_CM01_BACKFILL_CAMPAIGN";
}

function normalizeOutputPath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/consolidation-canonical-backfill-campaign.js [options]",
      "",
      "Options:",
      "  --tenantIds <id1,id2>     Optional tenant filter (only ACTIVE tenants).",
      "  --tenantId <id>           Optional single tenant filter (repeatable).",
      "  --groupIds <id1,id2>      Optional consolidation group filter (ACTIVE groups only).",
      "  --groupId <id>            Optional single group filter (repeatable).",
      "  --limitGroups <N>         Optional max group count to scan.",
      `  --candidateLimit <N>      Candidate preview limit per group (1..${MAX_CANDIDATE_LIMIT}, default 500).`,
      "  --batchSize <N>           Groups per batch (default 25).",
      "  --pauseMs <N>             Pause in ms between batches (default 0).",
      "  --ownerUserId <id>        Optional preferred owner user id per tenant.",
      "  --reason <text>           Apply reason (required by backend if high-risk SAFE rows exist).",
      "  --source <code>           Apply source tag (default FUP_CM01_BACKFILL_CAMPAIGN).",
      "  --output <path>           Optional JSON file path for full unresolved backlog export.",
      "  --apply                   Apply SAFE deterministic candidates.",
      "  --help                    Show this usage.",
      "",
      "Examples:",
      "  npm run ops:consolidation:canonical-campaign",
      "  npm run ops:consolidation:canonical-campaign -- --tenantIds 1,2 --limitGroups 10",
      "  npm run ops:consolidation:canonical-campaign -- --tenantIds 1,2 --apply --reason \"FUP-CM01 wave1\" --output artifacts/fup-cm01-backlog.json",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantIds: [],
    groupIds: [],
    limitGroups: null,
    candidateLimit: 500,
    batchSize: 25,
    pauseMs: 0,
    ownerUserId: null,
    reason: null,
    source: "FUP_CM01_BACKFILL_CAMPAIGN",
    output: null,
    apply: false,
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
    if (token.startsWith("--tenantIds=")) {
      args.tenantIds.push(...parseCsvPositiveInts(token.split("=")[1]));
      continue;
    }
    if (token === "--tenantIds") {
      args.tenantIds.push(...parseCsvPositiveInts(argv[i + 1]));
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
    if (token.startsWith("--groupIds=")) {
      args.groupIds.push(...parseCsvPositiveInts(token.split("=")[1]));
      continue;
    }
    if (token === "--groupIds") {
      args.groupIds.push(...parseCsvPositiveInts(argv[i + 1]));
      i += 1;
      continue;
    }
    if (token.startsWith("--groupId=")) {
      const parsedGroupId = parsePositiveIntOrNull(token.split("=")[1]);
      if (parsedGroupId) {
        args.groupIds.push(parsedGroupId);
      }
      continue;
    }
    if (token === "--groupId") {
      const parsedGroupId = parsePositiveIntOrNull(argv[i + 1]);
      if (parsedGroupId) {
        args.groupIds.push(parsedGroupId);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--limitGroups=")) {
      args.limitGroups = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--limitGroups") {
      args.limitGroups = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--candidateLimit=")) {
      args.candidateLimit = parsePositiveIntOrNull(token.split("=")[1]) || args.candidateLimit;
      continue;
    }
    if (token === "--candidateLimit") {
      args.candidateLimit = parsePositiveIntOrNull(argv[i + 1]) || args.candidateLimit;
      i += 1;
      continue;
    }
    if (token.startsWith("--batchSize=")) {
      args.batchSize = parsePositiveIntOrNull(token.split("=")[1]) || args.batchSize;
      continue;
    }
    if (token === "--batchSize") {
      args.batchSize = parsePositiveIntOrNull(argv[i + 1]) || args.batchSize;
      i += 1;
      continue;
    }
    if (token.startsWith("--pauseMs=")) {
      args.pauseMs = parsePositiveIntOrNull(token.split("=")[1]) || 0;
      continue;
    }
    if (token === "--pauseMs") {
      args.pauseMs = parsePositiveIntOrNull(argv[i + 1]) || 0;
      i += 1;
      continue;
    }
    if (token.startsWith("--ownerUserId=")) {
      args.ownerUserId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--ownerUserId") {
      args.ownerUserId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--reason=")) {
      args.reason = sanitizeReason(token.split("=")[1]);
      continue;
    }
    if (token === "--reason") {
      args.reason = sanitizeReason(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--source=")) {
      args.source = sanitizeSource(token.split("=")[1]);
      continue;
    }
    if (token === "--source") {
      args.source = sanitizeSource(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--output=")) {
      args.output = normalizeOutputPath(token.split("=")[1]);
      continue;
    }
    if (token === "--output") {
      args.output = normalizeOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  args.tenantIds = Array.from(new Set(args.tenantIds)).sort((left, right) => left - right);
  args.groupIds = Array.from(new Set(args.groupIds)).sort((left, right) => left - right);

  if (!args.candidateLimit || args.candidateLimit > MAX_CANDIDATE_LIMIT) {
    throw new Error(`candidateLimit must be between 1 and ${MAX_CANDIDATE_LIMIT}`);
  }
  if (!args.batchSize) {
    throw new Error("batchSize must be a positive integer");
  }

  return args;
}

function toNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadCampaignGroups({ tenantIds, groupIds, limitGroups }) {
  const where = ["cg.status = 'ACTIVE'", "t.status = 'ACTIVE'"];
  const params = [];

  if (Array.isArray(tenantIds) && tenantIds.length > 0) {
    where.push(`cg.tenant_id IN (${tenantIds.map(() => "?").join(", ")})`);
    params.push(...tenantIds);
  }
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    where.push(`cg.id IN (${groupIds.map(() => "?").join(", ")})`);
    params.push(...groupIds);
  }

  const limitValue = parsePositiveIntOrNull(limitGroups);
  const limitClause = limitValue ? `LIMIT ${limitValue}` : "";

  const result = await query(
    `SELECT
       cg.tenant_id,
       t.code AS tenant_code,
       t.name AS tenant_name,
       cg.id AS consolidation_group_id,
       cg.code AS consolidation_group_code,
       cg.name AS consolidation_group_name,
       cg.group_company_id,
       gc.code AS group_company_code,
       gc.name AS group_company_name
     FROM consolidation_groups cg
     JOIN tenants t ON t.id = cg.tenant_id
     LEFT JOIN group_companies gc
       ON gc.id = cg.group_company_id
      AND gc.tenant_id = cg.tenant_id
     WHERE ${where.join(" AND ")}
     ORDER BY cg.tenant_id ASC, cg.id ASC
     ${limitClause}`,
    params
  );
  return result.rows || [];
}

async function resolveTenantOwner(tenantId, preferredOwnerUserId = null) {
  const parsedTenantId = parsePositiveIntOrNull(tenantId);
  if (!parsedTenantId) {
    return null;
  }

  if (preferredOwnerUserId) {
    const preferred = await query(
      `SELECT id AS user_id, email, name
       FROM users
       WHERE tenant_id = ?
         AND id = ?
         AND status = 'ACTIVE'
       LIMIT 1`,
      [parsedTenantId, preferredOwnerUserId]
    );
    const preferredRow = preferred.rows?.[0] || null;
    if (preferredRow) {
      return {
        userId: parsePositiveIntOrNull(preferredRow.user_id),
        email: preferredRow.email || null,
        name: preferredRow.name || null,
        strategy: "PREFERRED_OWNER_USER_ID",
      };
    }
  }

  const tenantAdmin = await query(
    `SELECT
       u.id AS user_id,
       u.email,
       u.name
     FROM users u
     JOIN user_role_scopes urs
       ON urs.tenant_id = u.tenant_id
      AND urs.user_id = u.id
      AND urs.effect = 'ALLOW'
     JOIN roles r
       ON r.tenant_id = urs.tenant_id
      AND r.id = urs.role_id
      AND r.code = 'TenantAdmin'
     WHERE u.tenant_id = ?
       AND u.status = 'ACTIVE'
     ORDER BY
       CASE
         WHEN urs.scope_type = 'TENANT' AND (urs.scope_id = ? OR urs.scope_id IS NULL) THEN 0
         ELSE 1
       END ASC,
       u.id ASC
     LIMIT 1`,
    [parsedTenantId, parsedTenantId]
  );
  const tenantAdminRow = tenantAdmin.rows?.[0] || null;
  if (tenantAdminRow) {
    return {
      userId: parsePositiveIntOrNull(tenantAdminRow.user_id),
      email: tenantAdminRow.email || null,
      name: tenantAdminRow.name || null,
      strategy: "TENANT_ADMIN_ROLE",
    };
  }

  const fallback = await query(
    `SELECT id AS user_id, email, name
     FROM users
     WHERE tenant_id = ?
       AND status = 'ACTIVE'
     ORDER BY id ASC
     LIMIT 1`,
    [parsedTenantId]
  );
  const fallbackRow = fallback.rows?.[0] || null;
  if (!fallbackRow) {
    return null;
  }
  return {
    userId: parsePositiveIntOrNull(fallbackRow.user_id),
    email: fallbackRow.email || null,
    name: fallbackRow.name || null,
    strategy: "FIRST_ACTIVE_USER",
  };
}

function toClassificationCounts(summary = null) {
  return {
    total: toNumeric(summary?.total),
    safe: toNumeric(summary?.safeCount),
    alreadyMapped: toNumeric(summary?.alreadyMappedCount),
    partialMapping: toNumeric(summary?.partialMappingCount),
    missingGroupMatch: toNumeric(summary?.missingGroupMatchCount),
    ambiguousGroupMatch: toNumeric(summary?.ambiguousGroupMatchCount),
    unresolved: toNumeric(summary?.unresolvedCount),
    semanticWarning: toNumeric(summary?.semanticWarningCount),
    semanticHighRisk: toNumeric(summary?.semanticHighRiskCount),
  };
}

function aggregateByKey(rows, keyField) {
  const out = new Map();
  for (const row of rows) {
    const key = String(row?.[keyField] || "UNASSIGNED");
    const current = out.get(key) || {
      key,
      unresolvedCount: 0,
      byClassification: {},
    };
    current.unresolvedCount += 1;
    const classification = String(row?.classification || "UNKNOWN").toUpperCase();
    current.byClassification[classification] =
      toNumeric(current.byClassification[classification]) + 1;
    out.set(key, current);
  }
  return [...out.values()].sort((left, right) => right.unresolvedCount - left.unresolvedCount);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const groups = await loadCampaignGroups(args);
  if (!groups.length) {
    const emptyPayload = {
      ok: true,
      mode: args.apply ? "apply" : "dry-run",
      message: "No ACTIVE tenant/group rows matched filters.",
      filters: {
        tenantIds: args.tenantIds,
        groupIds: args.groupIds,
        limitGroups: args.limitGroups,
        candidateLimit: args.candidateLimit,
      },
    };
    console.log(JSON.stringify(emptyPayload, null, 2));
    if (args.output) {
      await writeFile(args.output, `${JSON.stringify(emptyPayload, null, 2)}\n`, "utf8");
    }
    return;
  }

  const tenantIds = Array.from(
    new Set(groups.map((row) => parsePositiveIntOrNull(row.tenant_id)).filter(Boolean))
  ).sort((left, right) => left - right);
  const ownerByTenant = new Map();
  for (const tenantId of tenantIds) {
    // eslint-disable-next-line no-await-in-loop
    const owner = await resolveTenantOwner(tenantId, args.ownerUserId);
    ownerByTenant.set(String(tenantId), owner);
  }

  const totals = {
    groupsScanned: groups.length,
    groupsWithSafeCandidates: 0,
    groupsWithUnresolvedCandidates: 0,
    groupsApplied: 0,
    groupsApplyFailed: 0,
    groupsApplySkipped: 0,
    totalCandidates: 0,
    safeCandidateCount: 0,
    unresolvedCandidateCount: 0,
    highRiskSafeCandidateCount: 0,
    appliedCandidateCount: 0,
  };
  const groupResults = [];
  const unresolvedBacklog = [];

  for (let index = 0; index < groups.length; index += 1) {
    if (index > 0 && args.pauseMs > 0 && index % args.batchSize === 0) {
      // Controlled batching for long-running tenant campaigns.
      // eslint-disable-next-line no-await-in-loop
      await sleep(args.pauseMs);
    }

    const group = groups[index];
    const tenantId = parsePositiveIntOrNull(group.tenant_id);
    const groupId = parsePositiveIntOrNull(group.consolidation_group_id);
    const owner = ownerByTenant.get(String(tenantId)) || null;
    if (!tenantId || !groupId) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const preview = await listCanonicalMappingCandidates({
      tenantId,
      consolidationGroupId: groupId,
      limit: args.candidateLimit,
    });

    const counts = toClassificationCounts(preview.summary);
    totals.totalCandidates += counts.total;
    totals.safeCandidateCount += counts.safe;
    totals.unresolvedCandidateCount += counts.unresolved;
    totals.highRiskSafeCandidateCount += counts.semanticHighRisk;
    if (counts.safe > 0) {
      totals.groupsWithSafeCandidates += 1;
    }
    if (counts.unresolved > 0) {
      totals.groupsWithUnresolvedCandidates += 1;
    }

    const unresolvedRows = (preview.rows || []).filter((row) => {
      const classification = String(row?.classification || "").toUpperCase();
      return classification !== "SAFE" && classification !== "ALREADY_MAPPED";
    });
    for (const row of unresolvedRows) {
      unresolvedBacklog.push({
        tenantId,
        tenantCode: group.tenant_code || null,
        consolidationGroupId: groupId,
        consolidationGroupCode: group.consolidation_group_code || null,
        consolidationGroupName: group.consolidation_group_name || null,
        legalEntityId: parsePositiveIntOrNull(row?.legalEntityId),
        legalEntityCode: row?.legalEntityCode || null,
        localAccountId: parsePositiveIntOrNull(row?.localAccountId),
        localAccountCode: row?.localAccountCode || null,
        expectedCanonicalKey: row?.expectedCanonicalKey || null,
        classification: String(row?.classification || "UNKNOWN").toUpperCase(),
        reason: row?.reason || null,
        ownerUserId: owner?.userId || null,
        ownerEmail: owner?.email || null,
        ownerName: owner?.name || null,
        ownerStrategy: owner?.strategy || "UNASSIGNED",
      });
    }

    const highRiskSafeRows = (preview.rows || []).filter(
      (row) =>
        String(row?.classification || "").toUpperCase() === "SAFE" &&
        row?.semanticRisk?.highRisk === true
    );
    const applyResult = {
      attempted: false,
      applied: false,
      skippedReason: null,
      error: null,
      metrics: null,
    };

    if (args.apply) {
      applyResult.attempted = true;
      if (counts.safe <= 0) {
        applyResult.skippedReason = "NO_SAFE_CANDIDATE";
        totals.groupsApplySkipped += 1;
      } else if (highRiskSafeRows.length > 0 && !args.reason) {
        applyResult.skippedReason = "HIGH_RISK_SAFE_REASON_REQUIRED";
        totals.groupsApplySkipped += 1;
      } else {
        try {
          // eslint-disable-next-line no-await-in-loop
          const applied = await applyCanonicalMappingCandidates({
            tenantId,
            consolidationGroupId: groupId,
            limit: args.candidateLimit,
            changeReason: args.reason,
            changeSource: args.source,
            actedByUserId: owner?.userId || null,
            requestMeta: {
              requestId: null,
              ipAddress: null,
              userAgent: "FUP_CM01_BACKFILL_CAMPAIGN_SCRIPT",
            },
          });
          applyResult.applied = true;
          applyResult.metrics = {
            appliedCandidateCount: toNumeric(applied?.appliedCandidateCount),
            safeCandidateCount: toNumeric(applied?.safeCandidateCount),
            highRiskSafeCandidateCount: toNumeric(applied?.highRiskSafeCandidateCount),
            skippedCandidateCount: toNumeric(applied?.skippedCandidateCount),
          };
          totals.groupsApplied += 1;
          totals.appliedCandidateCount += toNumeric(applied?.appliedCandidateCount);
        } catch (err) {
          applyResult.error = {
            message: err?.message || "UNKNOWN_ERROR",
            details: err?.details || null,
          };
          totals.groupsApplyFailed += 1;
        }
      }
    }

    groupResults.push({
      batchNo: Math.floor(index / args.batchSize) + 1,
      tenantId,
      tenantCode: group.tenant_code || null,
      consolidationGroupId: groupId,
      consolidationGroupCode: group.consolidation_group_code || null,
      consolidationGroupName: group.consolidation_group_name || null,
      ownerUserId: owner?.userId || null,
      ownerEmail: owner?.email || null,
      ownerStrategy: owner?.strategy || "UNASSIGNED",
      counts,
      applyResult,
    });
  }

  const unresolvedByTenant = aggregateByKey(unresolvedBacklog, "tenantId");
  const unresolvedByOwner = aggregateByKey(unresolvedBacklog, "ownerUserId");

  const payload = {
    ok: true,
    mode: args.apply ? "apply" : "dry-run",
    filters: {
      tenantIds: args.tenantIds,
      groupIds: args.groupIds,
      limitGroups: args.limitGroups,
      candidateLimit: args.candidateLimit,
      batchSize: args.batchSize,
      pauseMs: args.pauseMs,
    },
    applyPolicy: {
      enabled: args.apply,
      source: args.source,
      reason: args.reason,
    },
    ownerAssignments: tenantIds.map((tenantId) => ({
      tenantId,
      ...(ownerByTenant.get(String(tenantId)) || {
        userId: null,
        email: null,
        name: null,
        strategy: "UNASSIGNED",
      }),
    })),
    totals,
    groupResults,
    unresolvedBacklogSummary: {
      totalRows: unresolvedBacklog.length,
      byTenant: unresolvedByTenant,
      byOwner: unresolvedByOwner,
    },
    unresolvedBacklog,
  };

  if (args.output) {
    await writeFile(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  const consolePayload = {
    ...payload,
    unresolvedBacklog: payload.unresolvedBacklog.slice(0, 100),
    unresolvedBacklogTruncated:
      payload.unresolvedBacklog.length > 100 ? payload.unresolvedBacklog.length - 100 : 0,
  };
  console.log(JSON.stringify(consolePayload, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });

