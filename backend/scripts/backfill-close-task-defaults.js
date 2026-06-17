import { closePool } from "../src/db.js";
import { upsertDefaultCloseTaskTemplates } from "../src/services/close.task-templates.service.js";

async function main() {
  const result = await upsertDefaultCloseTaskTemplates();
  console.log(
    `[backfill-close-task-defaults] upserted ${result.upsertedCount} global templates`,
  );
  console.log(`[backfill-close-task-defaults] task codes: ${result.taskCodes.join(", ")}`);
}

main()
  .catch((err) => {
    console.error("[backfill-close-task-defaults] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
