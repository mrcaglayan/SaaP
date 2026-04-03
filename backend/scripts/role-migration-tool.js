import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRoleMigrationPreviewRun,
  executeRoleMigrationRun,
  getRoleMigrationRunDetail,
  rollbackRoleMigrationRun,
} from "../src/services/roleMigration.service.js";
import { closePool } from "../src/db.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseArgs(argv) {
  const args = {
    command: "",
    tenantId: null,
    runId: null,
    actorUserId: null,
    sourceRoleCodes: [],
    itemIds: [],
  };

  const tokens = Array.isArray(argv) ? argv.slice(2) : [];
  args.command = String(tokens[0] || "").trim().toLowerCase();

  for (let index = 1; index < tokens.length; index += 1) {
    const token = String(tokens[index] || "").trim();
    const nextValue = tokens[index + 1];

    if (token === "--tenantId") {
      args.tenantId = parsePositiveInt(nextValue);
      index += 1;
      continue;
    }
    if (token === "--runId") {
      args.runId = parsePositiveInt(nextValue);
      index += 1;
      continue;
    }
    if (token === "--actorUserId") {
      args.actorUserId = parsePositiveInt(nextValue);
      index += 1;
      continue;
    }
    if (token === "--sourceRoleCodes") {
      args.sourceRoleCodes = String(nextValue || "")
        .split(",")
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (token === "--itemIds") {
      args.itemIds = String(nextValue || "")
        .split(",")
        .map(parsePositiveInt)
        .filter(Boolean);
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/role-migration-tool.js preview --tenantId <id> [--actorUserId <id>] [--sourceRoleCodes code1,code2]
  node scripts/role-migration-tool.js show --tenantId <id> --runId <id>
  node scripts/role-migration-tool.js execute --tenantId <id> --runId <id> [--actorUserId <id>] [--itemIds 1,2,3]
  node scripts/role-migration-tool.js rollback --tenantId <id> --runId <id> [--actorUserId <id>]`);
}

async function run() {
  const args = parseArgs(process.argv);
  if (!args.command || !args.tenantId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let result = null;
  if (args.command === "preview") {
    result = await createRoleMigrationPreviewRun({
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      sourceRoleCodes: args.sourceRoleCodes,
    });
  } else if (args.command === "show") {
    if (!args.runId) {
      throw new Error("runId is required for show");
    }
    result = await getRoleMigrationRunDetail({
      tenantId: args.tenantId,
      runId: args.runId,
    });
  } else if (args.command === "execute") {
    if (!args.runId) {
      throw new Error("runId is required for execute");
    }
    result = await executeRoleMigrationRun({
      tenantId: args.tenantId,
      runId: args.runId,
      actorUserId: args.actorUserId,
      itemIds: args.itemIds,
    });
  } else if (args.command === "rollback") {
    if (!args.runId) {
      throw new Error("runId is required for rollback");
    }
    result = await rollbackRoleMigrationRun({
      tenantId: args.tenantId,
      runId: args.runId,
      actorUserId: args.actorUserId,
    });
  } else {
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  run()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
