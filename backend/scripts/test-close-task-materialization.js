import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool } from "../src/db.js";
import {
  CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS,
  mergeCloseTaskTemplatesByCode,
} from "../src/services/close.task-templates.service.js";
import { buildCloseTaskMaterializationCandidates } from "../src/services/close.tasks.service.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptsDir, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function byTaskKey(candidates) {
  return new Map(candidates.map((candidate) => [candidate.taskKey, candidate]));
}

async function main() {
  const expectedDefaultCodes = [
    "BANK_RECON_COMPLETED",
    "CASH_RECON_COMPLETED",
    "INVENTORY_NEGATIVE_STOCK_CHECK",
    "AP_UNPOSTED_CLEARED",
    "AR_AGING_REVIEWED",
    "PAYROLL_POSTED",
    "IC_133_333_MATCHED",
    "FX_RATES_ENTERED",
    "DEPRECIATION_POSTED",
    "TRIAL_BALANCE_REVIEWED",
    "ENTITY_CLOSE_CERTIFIED",
  ];

  assert.deepEqual(
    CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS.map((template) => template.taskCode),
    expectedDefaultCodes,
  );
  const defaultTemplateByCode = new Map(
    CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS.map((template) => [template.taskCode, template]),
  );
  const expectedCompletionModes = {
    BANK_RECON_COMPLETED: "HYBRID_REVIEW",
    CASH_RECON_COMPLETED: "HYBRID_REVIEW",
    INVENTORY_NEGATIVE_STOCK_CHECK: "SYSTEM_CHECK",
    AP_UNPOSTED_CLEARED: "SYSTEM_CHECK",
    AR_AGING_REVIEWED: "MANUAL",
    PAYROLL_POSTED: "SOURCE_STATUS",
    IC_133_333_MATCHED: "HYBRID_REVIEW",
    FX_RATES_ENTERED: "SYSTEM_CHECK",
    DEPRECIATION_POSTED: "SOURCE_STATUS",
    TRIAL_BALANCE_REVIEWED: "MANUAL",
    ENTITY_CLOSE_CERTIFIED: "MANUAL_WITH_EVIDENCE",
  };
  for (const [taskCode, completionMode] of Object.entries(expectedCompletionModes)) {
    assert.equal(defaultTemplateByCode.get(taskCode)?.completionMode, completionMode);
  }
  assert.equal(defaultTemplateByCode.get("AR_AGING_REVIEWED")?.sourceCheckCode, null);
  assert.equal(defaultTemplateByCode.get("TRIAL_BALANCE_REVIEWED")?.sourceCheckCode, null);
  assert(
    CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS.every(
      (template) => template.requiredForCycleLock === false,
    ),
    "shipped checklist defaults must not become hard close locks in PR-CTM-04",
  );
  const certificationTemplate = CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS.find(
    (template) => template.taskCode === "ENTITY_CLOSE_CERTIFIED",
  );
  assert.equal(certificationTemplate.evidenceRequired, true);
  assert.equal(certificationTemplate.completionMode, "MANUAL_WITH_EVIDENCE");

  const merged = mergeCloseTaskTemplatesByCode([
    { tenant_id: null, task_code: "BANK_RECON_COMPLETED", status: "ACTIVE" },
    { tenant_id: 10, task_code: "BANK_RECON_COMPLETED", status: "DISABLED" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tenant_id, 10);
  assert.equal(merged[0].status, "DISABLED");

  const legalEntityCycle = {
    id: 200,
    tenant_id: 10,
    scope_kind: "LEGAL_ENTITY",
    fiscal_period_id: 30,
    legal_entity_id: 12,
    group_company_id: null,
    due_at: "2026-04-30 18:00:00",
    owner_user_id: 44,
  };
  const legalEntityContextById = new Map([
    [
      12,
      {
        legalEntityId: 12,
        countryId: 90,
        groupCompanyId: 7,
      },
    ],
  ]);
  const cycleItems = [
    {
      id: 300,
      itemType: "LOCAL_CLOSE_PACK",
      legalEntityId: 12,
      bookId: 8,
      ownerUserId: 55,
      currentSourceTargetType: "LOCAL_CLOSE_PACK",
      currentSourceTargetId: 400,
    },
    {
      id: 301,
      itemType: "LOCAL_CLOSE_PACK",
      legalEntityId: 12,
      bookId: 8,
      operatingUnitId: 66,
      ownerUserId: 56,
      currentSourceTargetType: "LOCAL_CLOSE_PACK",
      currentSourceTargetId: 401,
    },
    {
      id: 302,
      itemType: "PERIOD_CLOSE_RUN",
      legalEntityId: 12,
      bookId: 8,
      ownerUserId: 57,
    },
  ];

  const legalEntityCandidates = buildCloseTaskMaterializationCandidates({
    cycle: legalEntityCycle,
    cycleItems,
    templates: CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS,
    legalEntityContextById,
  });
  const legalEntityByKey = byTaskKey(legalEntityCandidates);

  assert.equal(legalEntityCandidates.length, 12);
  assert.equal(
    legalEntityByKey.get("BANK_RECON_COMPLETED:LOCAL_CLOSE_PACK:400").ownerUserId,
    55,
  );
  assert.equal(
    legalEntityByKey.get("BANK_RECON_COMPLETED:LOCAL_CLOSE_PACK:400").reviewerUserId,
    44,
  );
  assert.equal(
    legalEntityByKey.get("BANK_RECON_COMPLETED:LOCAL_CLOSE_PACK:400").sourceRefId,
    400,
  );
  assert.equal(
    legalEntityByKey.get("INVENTORY_NEGATIVE_STOCK_CHECK:OPERATING_UNIT:66")
      .rbacScopeType,
    "OPERATING_UNIT",
  );
  assert.equal(
    legalEntityByKey.get("AP_UNPOSTED_CLEARED:BOOK:8").workScopeType,
    "BOOK",
  );
  assert.equal(
    legalEntityByKey.get("FX_RATES_ENTERED:CYCLE:200").rbacScopeType,
    "GROUP",
  );
  assert.equal(
    legalEntityByKey.get("FX_RATES_ENTERED:CYCLE:200").rbacScopeId,
    7,
  );
  assert.equal(
    legalEntityByKey.get("ENTITY_CLOSE_CERTIFIED:LEGAL_ENTITY:12").evidenceRequired,
    true,
  );
  assert.equal(
    legalEntityByKey.get("ENTITY_CLOSE_CERTIFIED:LEGAL_ENTITY:12").dueAt,
    "2026-04-30 18:00:00",
  );

  const localReviewerTemplate = {
    ...defaultTemplateByCode.get("BANK_RECON_COMPLETED"),
    taskCode: "BANK_RECON_REVIEWER_TEST",
    defaultReviewerStrategy: "LOCAL_CLOSE_PACK_REVIEWER",
  };
  const reviewerCandidates = buildCloseTaskMaterializationCandidates({
    cycle: legalEntityCycle,
    cycleItems,
    templates: [localReviewerTemplate],
    legalEntityContextById,
    localClosePackReviewerById: new Map([
      [400, 77],
      [401, 78],
    ]),
  });
  const reviewerByKey = byTaskKey(reviewerCandidates);
  assert.equal(reviewerCandidates.length, 2);
  assert.equal(
    reviewerByKey.get("BANK_RECON_REVIEWER_TEST:LOCAL_CLOSE_PACK:400").reviewerUserId,
    77,
  );
  assert.equal(
    reviewerByKey.get("BANK_RECON_REVIEWER_TEST:LOCAL_CLOSE_PACK:401").reviewerUserId,
    78,
  );

  const groupCandidates = buildCloseTaskMaterializationCandidates({
    cycle: {
      id: 201,
      tenant_id: 10,
      scope_kind: "CONSOLIDATION_GROUP",
      fiscal_period_id: 30,
      consolidation_group_id: 9,
      group_company_id: 7,
      due_at: "2026-04-30 18:00:00",
      owner_user_id: 44,
    },
    cycleItems: [],
    templates: CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS,
    legalEntityContextById: new Map(),
  });
  const groupByKey = byTaskKey(groupCandidates);
  assert.equal(groupCandidates.length, 2);
  assert.equal(
    groupByKey.get("IC_133_333_MATCHED:CONSOLIDATION_GROUP:9").rbacScopeType,
    "GROUP",
  );
  assert.equal(
    groupByKey.get("IC_133_333_MATCHED:CONSOLIDATION_GROUP:9").workScopeType,
    "CONSOLIDATION_GROUP",
  );
  assert(groupByKey.has("FX_RATES_ENTERED:CYCLE:201"));

  const packageJson = JSON.parse(readSource("package.json"));
  assert.equal(
    packageJson.scripts["backfill:close-task-defaults"],
    "node scripts/backfill-close-task-defaults.js",
  );
  assert(
    packageJson.scripts["test:close-tasks:materialization"].includes(
      "node scripts/test-close-task-materialization.js",
    ),
  );
  assert(
    packageJson.scripts["test:close-tasks:materialization"].includes(
      "node scripts/test-close-task-template-materialization.js",
    ),
  );
  const closeCyclesSource = readSource("src/services/close.cycles.service.js");
  assert(closeCyclesSource.includes("materializeCloseTasksForCycle(cycle.id"));

  console.log("test-close-task-materialization passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
