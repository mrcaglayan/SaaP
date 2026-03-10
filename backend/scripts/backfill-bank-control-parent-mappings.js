import { closePool } from "../src/db.js";
import { backfillBankControlParentMappings } from "../src/services/bank.control-parent.backfill.service.js";

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/backfill-bank-control-parent-mappings.js --tenantId <id> [options]",
      "",
      "Required:",
      "  --tenantId <id>             Tenant id.",
      "",
      "Options:",
      "  --legalEntityId <id>        Optional legal entity scope.",
      "  --apply                     Persist BANK_CONTROL_PARENT rows (default: dry-run).",
      "  --help                      Show this help text.",
      "",
      "Example (dry-run):",
      "  npm run backfill:bank-control-parent -- --tenantId 101",
      "Example (apply):",
      "  npm run backfill:bank-control-parent -- --tenantId 101 --apply",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {
    tenantId: null,
    legalEntityId: null,
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

  const result = await backfillBankControlParentMappings({
    tenantId: args.tenantId,
    legalEntityId: args.legalEntityId,
    dryRun: !args.apply,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        action: "backfill-bank-control-parent-mappings",
        input: {
          tenantId: args.tenantId,
          legalEntityId: args.legalEntityId,
        },
        result,
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log(
      "Dry-run only. Re-run with --apply to persist BANK_CONTROL_PARENT backfill rows."
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
