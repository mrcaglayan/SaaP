import { closePool } from "../src/db.js";
import { reconcileCashFxLotsAgainstGl } from "../src/services/cash.fx.backfill.service.js";

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
      "Usage: node scripts/cash-fx-reconcile-lots-vs-gl.js --tenantId <id> [options]",
      "",
      "Required:",
      "  --tenantId <id>             Tenant id.",
      "",
      "Options:",
      "  --legalEntityId <id>        Optional legal entity scope.",
      "  --registerId <id>           Optional register scope.",
      "  --failOnMismatch <bool>     Exit non-zero when mismatches exist (default: false).",
      "  --help                      Show this help text.",
      "",
      "Example:",
      "  npm run reconcile:cash-fx:lots-vs-gl -- --tenantId 101 --failOnMismatch true",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    legalEntityId: null,
    registerId: null,
    failOnMismatch: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) continue;

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
    if (token.startsWith("--failOnMismatch=")) {
      args.failOnMismatch = parseBooleanOrDefault(token.split("=")[1], args.failOnMismatch);
      continue;
    }
    if (token === "--failOnMismatch") {
      args.failOnMismatch = parseBooleanOrDefault(argv[i + 1], args.failOnMismatch);
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

  const result = await reconcileCashFxLotsAgainstGl({
    tenantId: args.tenantId,
    legalEntityId: args.legalEntityId,
    registerId: args.registerId,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.mismatchCount === 0,
        action: "cash-fx-reconcile-lots-vs-gl",
        input: {
          tenantId: args.tenantId,
          legalEntityId: args.legalEntityId,
          registerId: args.registerId,
          failOnMismatch: args.failOnMismatch,
        },
        summary: {
          checkedCount: result.checkedCount,
          mismatchCount: result.mismatchCount,
        },
        mismatches:
          result.mismatchCount > 0 ? result.rows.filter((row) => !row.isMatch).slice(0, 200) : [],
      },
      null,
      2
    )
  );

  if (args.failOnMismatch && result.mismatchCount > 0) {
    process.exitCode = 2;
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
