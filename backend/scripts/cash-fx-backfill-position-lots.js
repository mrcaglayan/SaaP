import { closePool } from "../src/db.js";
import { backfillCashFxPositionLots } from "../src/services/cash.fx.backfill.service.js";

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
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
      "Usage: node scripts/cash-fx-backfill-position-lots.js --tenantId <id> [options]",
      "",
      "Required:",
      "  --tenantId <id>             Tenant id.",
      "",
      "Options:",
      "  --legalEntityId <id>        Optional legal entity scope.",
      "  --registerId <id>           Optional register scope.",
      "  --limit <N>                 Max rows to scan (default: 20000).",
      "  --continueOnError <bool>    Continue on row-level failures (default: false).",
      "  --apply                     Persist lot/movement writes (default: dry-run).",
      "  --help                      Show this help text.",
      "",
      "Example (dry-run):",
      "  npm run backfill:cash-fx:lots -- --tenantId 101 --limit 25000",
      "Example (apply):",
      "  npm run backfill:cash-fx:lots -- --tenantId 101 --apply",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    legalEntityId: null,
    registerId: null,
    limit: null,
    continueOnError: false,
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
    if (token.startsWith("--continueOnError=")) {
      args.continueOnError = parseBooleanOrDefault(token.split("=")[1], args.continueOnError);
      continue;
    }
    if (token === "--continueOnError") {
      args.continueOnError = parseBooleanOrDefault(argv[i + 1], args.continueOnError);
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

  const result = await backfillCashFxPositionLots({
    tenantId: args.tenantId,
    legalEntityId: args.legalEntityId,
    registerId: args.registerId,
    dryRun: !args.apply,
    continueOnError: args.continueOnError,
    limit: args.limit ?? undefined,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        action: "cash-fx-backfill-position-lots",
        input: {
          tenantId: args.tenantId,
          legalEntityId: args.legalEntityId,
          registerId: args.registerId,
          limit: args.limit,
          continueOnError: args.continueOnError,
        },
        result,
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to persist FX lot backfill rows.");
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
