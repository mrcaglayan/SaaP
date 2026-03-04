import { closePool } from "../src/db.js";
import { seedMissingCashFxMetadata } from "../src/services/cash.fx.backfill.service.js";

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeIntOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseBooleanOrDefault(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/cash-fx-seed-missing-metadata.js --tenantId <id> [options]",
      "",
      "Required:",
      "  --tenantId <id>             Tenant id.",
      "",
      "Options:",
      "  --legalEntityId <id>        Optional legal entity scope.",
      "  --registerId <id>           Optional register scope.",
      "  --limit <N>                 Max rows to scan (default: 10000).",
      "  --allowPriorRate <bool>     Allow prior-date fallback rates (default: true).",
      "  --priorRateMaxDays <N>      Optional max fallback lookback days (default: 30).",
      "  --apply                     Persist updates (default: dry-run).",
      "  --help                      Show this help text.",
      "",
      "Example (dry-run):",
      "  npm run backfill:cash-fx:seed-metadata -- --tenantId 101 --limit 5000",
      "Example (apply):",
      "  npm run backfill:cash-fx:seed-metadata -- --tenantId 101 --apply",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    legalEntityId: null,
    registerId: null,
    limit: null,
    allowPriorRate: true,
    priorRateMaxDays: null,
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
    if (token.startsWith("--tenantId=")) {
      args.tenantId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--tenantId") {
      args.tenantId = parsePositiveIntOrNull(argv[i + 1]);
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
    if (token.startsWith("--registerId=")) {
      args.registerId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--registerId") {
      args.registerId = parsePositiveIntOrNull(argv[i + 1]);
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
    if (token.startsWith("--allowPriorRate=")) {
      args.allowPriorRate = parseBooleanOrDefault(token.split("=")[1], args.allowPriorRate);
      continue;
    }
    if (token === "--allowPriorRate") {
      args.allowPriorRate = parseBooleanOrDefault(argv[i + 1], args.allowPriorRate);
      i += 1;
      continue;
    }
    if (token.startsWith("--priorRateMaxDays=")) {
      args.priorRateMaxDays = parseNonNegativeIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--priorRateMaxDays") {
      args.priorRateMaxDays = parseNonNegativeIntOrNull(argv[i + 1]);
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
  if (!args.tenantId) {
    throw new Error("--tenantId is required");
  }

  const result = await seedMissingCashFxMetadata({
    tenantId: args.tenantId,
    legalEntityId: args.legalEntityId,
    registerId: args.registerId,
    allowPriorRate: args.allowPriorRate,
    priorRateMaxDays: args.priorRateMaxDays,
    dryRun: !args.apply,
    limit: args.limit ?? undefined,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        action: "cash-fx-seed-missing-metadata",
        input: {
          tenantId: args.tenantId,
          legalEntityId: args.legalEntityId,
          registerId: args.registerId,
          limit: args.limit,
          allowPriorRate: args.allowPriorRate,
          priorRateMaxDays: args.priorRateMaxDays,
        },
        result,
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to persist missing FX metadata.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
