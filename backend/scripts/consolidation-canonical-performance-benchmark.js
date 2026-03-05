import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closePool, query } from "../src/db.js";
import {
  getCanonicalMappingGovernanceReview,
  listCanonicalMappingCandidates,
} from "../src/services/consolidation.canonical-mappings.service.js";

const DEFAULT_ITERATIONS = 5;
const DEFAULT_CANDIDATE_LIMIT = 500;
const DEFAULT_GOVERNANCE_LIMIT = 200;
const DEFAULT_EXECUTE_THRESHOLD_MS = 2000;
const DEFAULT_CANDIDATE_THRESHOLD_MS = 2500;
const DEFAULT_GOVERNANCE_THRESHOLD_MS = 3000;
const GOVERNANCE_ACTIONS = Object.freeze([
  "consolidation.canonical_mapping.local.create",
  "consolidation.canonical_mapping.local.update",
  "consolidation.canonical_mapping.group.create",
  "consolidation.canonical_mapping.group.update",
  "consolidation.canonical_mapping.candidates.apply",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parsePositiveNumberOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
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

function toDateOnly(value, label = "date") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const asString = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}(?:\b|T)/.test(asString)) {
    return asString.slice(0, 10);
  }
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayUtcDateOnly() {
  return toDateOnly(new Date(), "today");
}

function monthStartOf(dateOnly) {
  return `${String(dateOnly).slice(0, 8)}01`;
}

function addDaysToDateOnly(dateOnly, days = 0) {
  const base = new Date(`${String(dateOnly).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    throw new Error("date must be a valid date");
  }
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return toDateOnly(base, "date");
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/consolidation-canonical-performance-benchmark.js [options]",
      "",
      "Required:",
      "  --tenantId <id>                 Tenant id.",
      "  --groupId <id>                  Consolidation group id.",
      "",
      "Optional (execute-path context):",
      "  --legalEntityId <id>            Legal entity id (auto-detected from posted entries if omitted).",
      "  --fiscalPeriodId <id>           Fiscal period id (auto-detected from posted entries if omitted).",
      "  --effectiveOn <YYYY-MM-DD>      Effective date for canonical coverage query (default: period end date).",
      "",
      "Optional (report/governance context):",
      "  --fromDate <YYYY-MM-DD>         Governance review start date (default: month start UTC).",
      "  --toDate <YYYY-MM-DD>           Governance review end date (default: today UTC).",
      "  --candidateLimit <N>            Candidate preview limit (default 500).",
      "  --governanceLimit <N>           Governance review limit (default 200).",
      "",
      "Optional (benchmark controls):",
      "  --iterations <N>                Iterations per benchmark (default 5).",
      "  --executeThresholdMs <N>        Avg execute-coverage threshold (default 2000).",
      "  --candidateThresholdMs <N>      Avg candidate-preview threshold (default 2500).",
      "  --governanceThresholdMs <N>     Avg governance-review threshold (default 3000).",
      "  --output <path>                 Optional JSON output path.",
      "  --help                          Show usage.",
      "",
      "Example:",
      "  npm run ops:consolidation:canonical-performance-benchmark -- --tenantId 1 --groupId 3 --iterations 7 --output artifacts/fup-cm07-benchmark.json",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    groupId: null,
    legalEntityId: null,
    fiscalPeriodId: null,
    effectiveOn: null,
    fromDate: null,
    toDate: null,
    candidateLimit: DEFAULT_CANDIDATE_LIMIT,
    governanceLimit: DEFAULT_GOVERNANCE_LIMIT,
    iterations: DEFAULT_ITERATIONS,
    executeThresholdMs: DEFAULT_EXECUTE_THRESHOLD_MS,
    candidateThresholdMs: DEFAULT_CANDIDATE_THRESHOLD_MS,
    governanceThresholdMs: DEFAULT_GOVERNANCE_THRESHOLD_MS,
    output: null,
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
    if (token.startsWith("--tenantId=")) {
      args.tenantId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--tenantId") {
      args.tenantId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--groupId=")) {
      args.groupId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--groupId") {
      args.groupId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--legalEntityId=")) {
      args.legalEntityId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--legalEntityId") {
      args.legalEntityId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--fiscalPeriodId=")) {
      args.fiscalPeriodId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--fiscalPeriodId") {
      args.fiscalPeriodId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--effectiveOn=")) {
      args.effectiveOn = toDateOnly(token.split("=")[1], "effectiveOn");
      continue;
    }
    if (token === "--effectiveOn") {
      args.effectiveOn = toDateOnly(argv[i + 1], "effectiveOn");
      i += 1;
      continue;
    }
    if (token.startsWith("--fromDate=")) {
      args.fromDate = toDateOnly(token.split("=")[1], "fromDate");
      continue;
    }
    if (token === "--fromDate") {
      args.fromDate = toDateOnly(argv[i + 1], "fromDate");
      i += 1;
      continue;
    }
    if (token.startsWith("--toDate=")) {
      args.toDate = toDateOnly(token.split("=")[1], "toDate");
      continue;
    }
    if (token === "--toDate") {
      args.toDate = toDateOnly(argv[i + 1], "toDate");
      i += 1;
      continue;
    }
    if (token.startsWith("--candidateLimit=")) {
      args.candidateLimit =
        parsePositiveIntOrNull(token.split("=")[1]) || args.candidateLimit;
      continue;
    }
    if (token === "--candidateLimit") {
      args.candidateLimit = parsePositiveIntOrNull(argv[i + 1]) || args.candidateLimit;
      i += 1;
      continue;
    }
    if (token.startsWith("--governanceLimit=")) {
      args.governanceLimit =
        parsePositiveIntOrNull(token.split("=")[1]) || args.governanceLimit;
      continue;
    }
    if (token === "--governanceLimit") {
      args.governanceLimit = parsePositiveIntOrNull(argv[i + 1]) || args.governanceLimit;
      i += 1;
      continue;
    }
    if (token.startsWith("--iterations=")) {
      args.iterations = parsePositiveIntOrNull(token.split("=")[1]) || args.iterations;
      continue;
    }
    if (token === "--iterations") {
      args.iterations = parsePositiveIntOrNull(argv[i + 1]) || args.iterations;
      i += 1;
      continue;
    }
    if (token.startsWith("--executeThresholdMs=")) {
      args.executeThresholdMs =
        parsePositiveNumberOrNull(token.split("=")[1]) || args.executeThresholdMs;
      continue;
    }
    if (token === "--executeThresholdMs") {
      args.executeThresholdMs =
        parsePositiveNumberOrNull(argv[i + 1]) || args.executeThresholdMs;
      i += 1;
      continue;
    }
    if (token.startsWith("--candidateThresholdMs=")) {
      args.candidateThresholdMs =
        parsePositiveNumberOrNull(token.split("=")[1]) || args.candidateThresholdMs;
      continue;
    }
    if (token === "--candidateThresholdMs") {
      args.candidateThresholdMs =
        parsePositiveNumberOrNull(argv[i + 1]) || args.candidateThresholdMs;
      i += 1;
      continue;
    }
    if (token.startsWith("--governanceThresholdMs=")) {
      args.governanceThresholdMs =
        parsePositiveNumberOrNull(token.split("=")[1]) || args.governanceThresholdMs;
      continue;
    }
    if (token === "--governanceThresholdMs") {
      args.governanceThresholdMs =
        parsePositiveNumberOrNull(argv[i + 1]) || args.governanceThresholdMs;
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

  return args;
}

async function explainOne(sql, params = []) {
  const result = await query(`EXPLAIN ${sql}`, params);
  return result.rows || [];
}

function hasExpectedKey(explainRows, expectedPrefixes) {
  return (Array.isArray(explainRows) ? explainRows : []).some((row) => {
    const selectedKey = String(row?.key || "");
    const possibleKeys = String(row?.possible_keys || "");
    return (expectedPrefixes || []).some(
      (prefix) => selectedKey.includes(prefix) || possibleKeys.includes(prefix)
    );
  });
}

function rowsForTableAliases(explainRows, aliases = []) {
  const aliasSet = new Set((aliases || []).map((value) => String(value || "").trim()));
  return (Array.isArray(explainRows) ? explainRows : []).filter((row) =>
    aliasSet.has(String(row?.table || "").trim())
  );
}

function assertExplainTableIndex(explainRows, aliases, expectedPrefixes, label) {
  const scopedRows = rowsForTableAliases(explainRows, aliases);
  assert(scopedRows.length > 0, `${label}: EXPLAIN rows missing for aliases ${aliases.join("/")}`);
  assert(
    hasExpectedKey(scopedRows, expectedPrefixes),
    `${label}: expected key prefix ${expectedPrefixes.join(" or ")} not found`
  );
}

async function resolveExecuteContext({
  tenantId,
  groupId,
  legalEntityId = null,
  fiscalPeriodId = null,
  effectiveOn = null,
}) {
  let resolvedLegalEntityId = parsePositiveIntOrNull(legalEntityId);
  let resolvedFiscalPeriodId = parsePositiveIntOrNull(fiscalPeriodId);
  let resolvedEffectiveOn = toDateOnly(effectiveOn, "effectiveOn");

  if (!resolvedLegalEntityId || !resolvedFiscalPeriodId) {
    const fallbackResult = await query(
      `SELECT
         je.legal_entity_id,
         je.fiscal_period_id
       FROM consolidation_group_members cgm
       JOIN journal_entries je
         ON je.tenant_id = ?
        AND je.legal_entity_id = cgm.legal_entity_id
        AND je.status = 'POSTED'
       WHERE cgm.consolidation_group_id = ?
       ORDER BY je.id DESC
       LIMIT 1`,
      [tenantId, groupId]
    );
    const fallback = fallbackResult.rows?.[0] || null;
    if (!fallback) {
      return null;
    }
    resolvedLegalEntityId = resolvedLegalEntityId || parsePositiveIntOrNull(fallback.legal_entity_id);
    resolvedFiscalPeriodId = resolvedFiscalPeriodId || parsePositiveIntOrNull(fallback.fiscal_period_id);
  }

  if (!resolvedLegalEntityId || !resolvedFiscalPeriodId) {
    return null;
  }

  if (!resolvedEffectiveOn) {
    const periodResult = await query(
      `SELECT end_date
       FROM fiscal_periods
       WHERE id = ?
       LIMIT 1`,
      [resolvedFiscalPeriodId]
    );
    resolvedEffectiveOn = toDateOnly(periodResult.rows?.[0]?.end_date, "effectiveOn");
  }

  return {
    legalEntityId: resolvedLegalEntityId,
    fiscalPeriodId: resolvedFiscalPeriodId,
    effectiveOn: resolvedEffectiveOn || todayUtcDateOnly(),
  };
}

function summarizeLatencySamples(samples = []) {
  const normalized = (samples || []).map((value) => Number(value || 0)).filter((v) => v >= 0);
  if (normalized.length === 0) {
    return {
      iterations: 0,
      minMs: 0,
      maxMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
    };
  }
  const sorted = [...normalized].sort((left, right) => left - right);
  const sum = normalized.reduce((acc, value) => acc + value, 0);
  const at = (p) => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
    return sorted[idx];
  };
  return {
    iterations: normalized.length,
    minMs: Number(sorted[0].toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    avgMs: Number((sum / normalized.length).toFixed(2)),
    p50Ms: Number(at(0.5).toFixed(2)),
    p95Ms: Number(at(0.95).toFixed(2)),
  };
}

async function benchmarkLatency(label, iterations, fn) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const startedNs = process.hrtime.bigint();
    // eslint-disable-next-line no-await-in-loop
    await fn();
    const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
    samples.push(elapsedMs);
  }
  return {
    label,
    ...summarizeLatencySamples(samples),
  };
}

async function runExecuteCoverageCount({
  tenantId,
  groupId,
  legalEntityId,
  fiscalPeriodId,
  effectiveOn,
}) {
  const result = await query(
    `SELECT COUNT(*) AS mapped_row_count
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     JOIN accounts local_acc ON local_acc.id = jl.account_id
     JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = je.tenant_id
      AND clm.consolidation_group_id = ?
      AND clm.legal_entity_id = je.legal_entity_id
      AND clm.local_account_id = local_acc.id
      AND clm.status = 'ACTIVE'
      AND clm.effective_from <= ?
      AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
     JOIN consolidation_canonical_keys cck
       ON cck.id = clm.canonical_key_id
      AND cck.tenant_id = clm.tenant_id
      AND cck.consolidation_group_id = clm.consolidation_group_id
      AND cck.status = 'ACTIVE'
     JOIN consolidation_canonical_group_account_mappings ccgm
       ON ccgm.tenant_id = clm.tenant_id
      AND ccgm.consolidation_group_id = clm.consolidation_group_id
      AND ccgm.canonical_key_id = clm.canonical_key_id
      AND ccgm.status = 'ACTIVE'
      AND ccgm.effective_from <= ?
      AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
     WHERE je.tenant_id = ?
       AND je.status = 'POSTED'
       AND je.fiscal_period_id = ?
       AND je.legal_entity_id = ?`,
    [
      groupId,
      effectiveOn,
      effectiveOn,
      effectiveOn,
      effectiveOn,
      tenantId,
      fiscalPeriodId,
      legalEntityId,
    ]
  );
  return Number(result.rows?.[0]?.mapped_row_count || 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  assert(args.tenantId, "--tenantId is required");
  assert(args.groupId, "--groupId is required");

  const nowDate = todayUtcDateOnly();
  const reviewToDate = args.toDate || nowDate;
  const reviewFromDate = args.fromDate || monthStartOf(reviewToDate);
  assert(
    reviewFromDate <= reviewToDate,
    "--fromDate must be <= --toDate"
  );

  const executeContext = await resolveExecuteContext({
    tenantId: args.tenantId,
    groupId: args.groupId,
    legalEntityId: args.legalEntityId,
    fiscalPeriodId: args.fiscalPeriodId,
    effectiveOn: args.effectiveOn,
  });

  const planChecks = {
    executeCoveragePlan: {
      skipped: false,
      reason: null,
      keyChecks: [],
      explainRows: [],
    },
    candidatePreviewPlan: {
      keyChecks: [],
      explainRows: [],
    },
    governanceAuditPlan: {
      keyChecks: [],
      explainRows: [],
    },
  };

  if (executeContext) {
    const executeExplainRows = await explainOne(
      `SELECT COUNT(*) AS mapped_row_count
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       JOIN accounts local_acc ON local_acc.id = jl.account_id
       JOIN consolidation_canonical_local_account_mappings clm
         ON clm.tenant_id = je.tenant_id
        AND clm.consolidation_group_id = ?
        AND clm.legal_entity_id = je.legal_entity_id
        AND clm.local_account_id = local_acc.id
        AND clm.status = 'ACTIVE'
        AND clm.effective_from <= ?
        AND (clm.effective_to IS NULL OR clm.effective_to >= ?)
       JOIN consolidation_canonical_keys cck
         ON cck.id = clm.canonical_key_id
        AND cck.tenant_id = clm.tenant_id
        AND cck.consolidation_group_id = clm.consolidation_group_id
        AND cck.status = 'ACTIVE'
       JOIN consolidation_canonical_group_account_mappings ccgm
         ON ccgm.tenant_id = clm.tenant_id
        AND ccgm.consolidation_group_id = clm.consolidation_group_id
        AND ccgm.canonical_key_id = clm.canonical_key_id
        AND ccgm.status = 'ACTIVE'
        AND ccgm.effective_from <= ?
        AND (ccgm.effective_to IS NULL OR ccgm.effective_to >= ?)
       WHERE je.tenant_id = ?
         AND je.status = 'POSTED'
         AND je.fiscal_period_id = ?
         AND je.legal_entity_id = ?`,
      [
        args.groupId,
        executeContext.effectiveOn,
        executeContext.effectiveOn,
        executeContext.effectiveOn,
        executeContext.effectiveOn,
        args.tenantId,
        executeContext.fiscalPeriodId,
        executeContext.legalEntityId,
      ]
    );
    planChecks.executeCoveragePlan.explainRows = executeExplainRows;

    assertExplainTableIndex(
      executeExplainRows,
      ["je"],
      ["ix_journal_tenant_entity_period_status_entry", "ix_journal_tenant_entity_period"],
      "Execute coverage"
    );
    planChecks.executeCoveragePlan.keyChecks.push("je");
    assertExplainTableIndex(
      executeExplainRows,
      ["jl"],
      ["ix_journal_lines_entry_account", "uk_journal_line_no"],
      "Execute coverage"
    );
    planChecks.executeCoveragePlan.keyChecks.push("jl");
    assertExplainTableIndex(
      executeExplainRows,
      ["clm"],
      ["ix_cons_local_scope_status_effective", "uk_cons_local_account_map"],
      "Execute coverage"
    );
    planChecks.executeCoveragePlan.keyChecks.push("clm");
    assertExplainTableIndex(
      executeExplainRows,
      ["ccgm"],
      ["ix_cons_group_scope_status_effective", "uk_cons_group_account_map"],
      "Execute coverage"
    );
    planChecks.executeCoveragePlan.keyChecks.push("ccgm");
  } else {
    planChecks.executeCoveragePlan.skipped = true;
    planChecks.executeCoveragePlan.reason =
      "No POSTED journal context found for selected tenant/group. Provide --legalEntityId and --fiscalPeriodId to force execute-path checks.";
  }

  const candidateExplainRows = await explainOne(
    `SELECT
       local_acc.id AS local_account_id
     FROM group_coa_mappings gcm
     JOIN accounts local_acc
       ON local_acc.coa_id = gcm.local_coa_id
      AND local_acc.is_active = TRUE
     LEFT JOIN accounts group_acc_match
       ON group_acc_match.coa_id = gcm.group_coa_id
      AND group_acc_match.code = local_acc.code
      AND group_acc_match.is_active = TRUE
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = gcm.tenant_id
      AND clm.consolidation_group_id = gcm.consolidation_group_id
      AND clm.legal_entity_id = gcm.legal_entity_id
      AND clm.local_account_id = local_acc.id
     WHERE gcm.tenant_id = ?
       AND gcm.consolidation_group_id = ?
       AND gcm.status = 'ACTIVE'
     ORDER BY gcm.legal_entity_id ASC, local_acc.code ASC
     LIMIT ?`,
    [args.tenantId, args.groupId, args.candidateLimit]
  );
  planChecks.candidatePreviewPlan.explainRows = candidateExplainRows;
  assertExplainTableIndex(
    candidateExplainRows,
    ["gcm"],
    ["ix_group_coa_map_scope_status", "uk_group_coa_mapping"],
    "Candidate preview"
  );
  planChecks.candidatePreviewPlan.keyChecks.push("gcm");
  assertExplainTableIndex(
    candidateExplainRows,
    ["local_acc", "group_acc_match"],
    ["ix_accounts_coa_active_code", "coa_id"],
    "Candidate preview"
  );
  planChecks.candidatePreviewPlan.keyChecks.push("accounts");
  assertExplainTableIndex(
    candidateExplainRows,
    ["clm"],
    ["ix_cons_local_scope_status_effective", "uk_cons_local_account_map"],
    "Candidate preview"
  );
  planChecks.candidatePreviewPlan.keyChecks.push("clm");

  const governanceExplainRows = await explainOne(
    `SELECT id
     FROM audit_logs
     WHERE tenant_id = ?
       AND action IN (?, ?, ?, ?, ?)
       AND scope_type = 'GROUP'
       AND scope_id = ?
       AND created_at >= ?
       AND created_at < ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [
      args.tenantId,
      ...GOVERNANCE_ACTIONS,
      args.groupId,
      `${reviewFromDate} 00:00:00`,
      `${addDaysToDateOnly(reviewToDate, 1)} 00:00:00`,
      args.governanceLimit,
    ]
  );
  planChecks.governanceAuditPlan.explainRows = governanceExplainRows;
  assertExplainTableIndex(
    governanceExplainRows,
    ["audit_logs"],
    [
      "ix_audit_tenant_action_scope_time",
      "ix_audit_tenant_action_resource",
      "ix_audit_tenant_time",
    ],
    "Governance audit"
  );
  planChecks.governanceAuditPlan.keyChecks.push("audit_logs");

  const latency = {
    executeCoverage: null,
    candidatePreview: null,
    governanceReview: null,
  };

  if (executeContext) {
    latency.executeCoverage = await benchmarkLatency(
      "executeCoverage",
      args.iterations,
      async () => {
        await runExecuteCoverageCount({
          tenantId: args.tenantId,
          groupId: args.groupId,
          legalEntityId: executeContext.legalEntityId,
          fiscalPeriodId: executeContext.fiscalPeriodId,
          effectiveOn: executeContext.effectiveOn,
        });
      }
    );
  }

  latency.candidatePreview = await benchmarkLatency(
    "candidatePreview",
    args.iterations,
    async () => {
      await listCanonicalMappingCandidates({
        tenantId: args.tenantId,
        consolidationGroupId: args.groupId,
        limit: args.candidateLimit,
      });
    }
  );

  latency.governanceReview = await benchmarkLatency(
    "governanceReview",
    args.iterations,
    async () => {
      await getCanonicalMappingGovernanceReview({
        tenantId: args.tenantId,
        consolidationGroupId: args.groupId,
        fromDate: reviewFromDate,
        toDate: reviewToDate,
        limit: args.governanceLimit,
      });
    }
  );

  const thresholdBreaches = [];
  if (
    latency.executeCoverage &&
    Number(latency.executeCoverage.avgMs || 0) > Number(args.executeThresholdMs)
  ) {
    thresholdBreaches.push(
      `executeCoverage avgMs ${latency.executeCoverage.avgMs} > executeThresholdMs ${args.executeThresholdMs}`
    );
  }
  if (
    Number(latency.candidatePreview?.avgMs || 0) > Number(args.candidateThresholdMs)
  ) {
    thresholdBreaches.push(
      `candidatePreview avgMs ${latency.candidatePreview.avgMs} > candidateThresholdMs ${args.candidateThresholdMs}`
    );
  }
  if (
    Number(latency.governanceReview?.avgMs || 0) > Number(args.governanceThresholdMs)
  ) {
    thresholdBreaches.push(
      `governanceReview avgMs ${latency.governanceReview.avgMs} > governanceThresholdMs ${args.governanceThresholdMs}`
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    tenantId: args.tenantId,
    groupId: args.groupId,
    executeContext: executeContext || null,
    reviewWindow: {
      fromDate: reviewFromDate,
      toDate: reviewToDate,
    },
    limits: {
      candidateLimit: args.candidateLimit,
      governanceLimit: args.governanceLimit,
      iterations: args.iterations,
    },
    thresholds: {
      executeThresholdMs: args.executeThresholdMs,
      candidateThresholdMs: args.candidateThresholdMs,
      governanceThresholdMs: args.governanceThresholdMs,
    },
    planChecks,
    latency,
    thresholdBreaches,
  };

  const serialized = JSON.stringify(report, null, 2);
  if (args.output) {
    await writeFile(args.output, serialized, "utf8");
    console.log(`Canonical performance benchmark report written: ${args.output}`);
  }
  console.log(serialized);

  if (thresholdBreaches.length > 0) {
    throw new Error(
      `Canonical performance threshold breach detected. Indexing follow-up required:\n- ${thresholdBreaches.join(
        "\n- "
      )}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
