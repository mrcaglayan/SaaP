import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import migrations from "../src/migrations/index.js";
import migration204EvidenceCommentsGenericScopeForCloseTasks from "../src/migrations/m204_evidence_comments_generic_scope_for_close_tasks.js";
import migration206EvidenceCommentsNullableLegalEntityScope from "../src/migrations/m206_evidence_comments_nullable_legal_entity_scope.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptsDir, "..");

function readMigration(filename) {
  return fs.readFileSync(path.join(backendRoot, "src", "migrations", filename), "utf8");
}

async function main() {
  assert.equal(
    migration204EvidenceCommentsGenericScopeForCloseTasks.key,
    "m204_evidence_comments_generic_scope_for_close_tasks",
  );
  assert.equal(
    migration206EvidenceCommentsNullableLegalEntityScope.key,
    "m206_evidence_comments_nullable_legal_entity_scope",
  );

  assert.deepEqual(
    migrations.slice(-4).map((migration) => migration.key),
    [
      "m203_close_task_management_foundation",
      "m204_evidence_comments_generic_scope_for_close_tasks",
      "m205_close_alerts_generic_subject",
      "m206_evidence_comments_nullable_legal_entity_scope",
    ],
  );

  const m204Sql = readMigration("m204_evidence_comments_generic_scope_for_close_tasks.js");
  assert(m204Sql.includes("ALTER TABLE evidence_objects"));
  assert(m204Sql.includes("ALTER TABLE internal_comments"));
  assert(m204Sql.includes("scope_type"));
  assert(m204Sql.includes("scope_id"));
  assert(m204Sql.includes("scope_key"));
  assert(m204Sql.includes("CONCAT('LEGAL_ENTITY:', legal_entity_id)"));
  assert(m204Sql.includes("WHERE legal_entity_id IS NOT NULL"));
  assert(
    !/MODIFY\s+COLUMN\s+legal_entity_id\s+BIGINT\s+UNSIGNED\s+NULL/i.test(m204Sql),
    "m204 must remain generic-scope phase 1 and keep legacy legal_entity_id required",
  );

  const m206Sql = readMigration("m206_evidence_comments_nullable_legal_entity_scope.js");
  assert(m206Sql.includes("DROP FOREIGN KEY fk_evidence_objects_legal_entity"));
  assert.match(
    m206Sql,
    /ALTER TABLE evidence_objects[\s\S]*MODIFY COLUMN legal_entity_id BIGINT UNSIGNED NULL/,
  );
  assert.match(
    m206Sql,
    /ALTER TABLE internal_comments[\s\S]*MODIFY COLUMN legal_entity_id BIGINT UNSIGNED NULL/,
  );
  assert(m206Sql.includes("information_schema.columns"));
  assert(m206Sql.includes("isColumnNullable"));

  console.log("test-close-task-generic-scope-backfill passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
