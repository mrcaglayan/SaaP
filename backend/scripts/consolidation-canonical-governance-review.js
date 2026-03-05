import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closePool } from "../src/db.js";
import { getCanonicalMappingGovernanceReview } from "../src/services/consolidation.canonical-mappings.service.js";

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
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

function printUsage() {
  console.log(
    [
      "Usage: node scripts/consolidation-canonical-governance-review.js [options]",
      "",
      "Required:",
      "  --tenantId <id>          Tenant id.",
      "  --groupId <id>           Consolidation group id.",
      "",
      "Optional:",
      "  --fromDate <YYYY-MM-DD>  Review window start date (default: month start).",
      "  --toDate <YYYY-MM-DD>    Review window end date (default: today UTC).",
      "  --limit <N>              Max rows per section (default: 200, max: 1000).",
      "  --output <path>          Optional JSON output file path.",
      "  --help                   Show this usage.",
      "",
      "Examples:",
      "  npm run ops:consolidation:canonical-governance-review -- --tenantId 1 --groupId 3",
      "  npm run ops:consolidation:canonical-governance-review -- --tenantId 1 --groupId 3 --fromDate 2026-03-01 --toDate 2026-03-31 --output artifacts/fup-cm05-governance.json",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    groupId: null,
    fromDate: null,
    toDate: null,
    limit: null,
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
    if (token.startsWith("--fromDate=")) {
      args.fromDate = String(token.split("=")[1] || "").trim() || null;
      continue;
    }
    if (token === "--fromDate") {
      args.fromDate = String(argv[i + 1] || "").trim() || null;
      i += 1;
      continue;
    }
    if (token.startsWith("--toDate=")) {
      args.toDate = String(token.split("=")[1] || "").trim() || null;
      continue;
    }
    if (token === "--toDate") {
      args.toDate = String(argv[i + 1] || "").trim() || null;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.tenantId || !args.groupId) {
    printUsage();
    throw new Error("--tenantId and --groupId are required");
  }

  const snapshot = await getCanonicalMappingGovernanceReview({
    tenantId: args.tenantId,
    consolidationGroupId: args.groupId,
    fromDate: args.fromDate,
    toDate: args.toDate,
    limit: args.limit,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    tenantId: args.tenantId,
    groupId: args.groupId,
    ...snapshot,
  };

  const serialized = JSON.stringify(payload, null, 2);
  if (args.output) {
    await writeFile(args.output, serialized, "utf8");
    console.log(`Governance review snapshot written to ${args.output}`);
  }
  console.log(serialized);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
