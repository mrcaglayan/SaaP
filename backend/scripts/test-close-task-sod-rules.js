import assert from "node:assert/strict";
import { PERMISSION_GROUPS } from "../src/constants/permission-groups.js";
import {
  evaluatePermissionRuleSet,
  PERMISSION_CONFLICTS,
  PERMISSION_DEPENDENCIES,
} from "../src/constants/permission-rules.js";
import { SOD_RULES } from "../src/constants/sod-rules.js";
import { ROLE_CAPABILITY_GROUPS } from "../src/seedCore.js";

async function main() {
  assert.deepEqual(PERMISSION_DEPENDENCIES["close.task.template.write"], [
    "close.task.template.read",
  ]);
  assert.deepEqual(PERMISSION_DEPENDENCIES["close.task.waive"], [
    "close.task.review",
  ]);
  assert.deepEqual(PERMISSION_DEPENDENCIES["close.task.admin"], [
    "close.task.read",
  ]);

  assert(
    PERMISSION_GROUPS["close.task.viewer"]?.permissions.includes("close.task.read"),
    "close.task.viewer should include close.task.read",
  );
  assert(
    PERMISSION_GROUPS["close.task.preparer"]?.permissions.includes("close.task.work"),
    "close.task.preparer should include close.task.work",
  );
  assert(
    PERMISSION_GROUPS["close.task.admin"]?.permissions.includes("close.task.admin"),
    "close.task.admin group should include close.task.admin",
  );
  assert(
    !PERMISSION_GROUPS["close.task.admin"]?.permissions.includes("close.task.work"),
    "close.task.admin should rely on admin override instead of mixing maker/checker permissions",
  );

  const workReviewEvaluation = evaluatePermissionRuleSet({
    permissionCodes: ["close.task.read", "close.task.work", "close.task.review"],
    subjectLabel: "Close task mixed role",
  });
  assert.equal(workReviewEvaluation.errors.length, 0);
  assert(
    workReviewEvaluation.warnings.some(
      (warning) =>
        warning.leftPermissionCode === "close.task.work" &&
        warning.rightPermissionCode === "close.task.review" &&
        String(warning.reason).includes("override risk"),
    ),
    "close task work/review overlap should warn as an override risk",
  );

  const workWaiveEvaluation = evaluatePermissionRuleSet({
    permissionCodes: [
      "close.task.read",
      "close.task.work",
      "close.task.review",
      "close.task.waive",
    ],
    subjectLabel: "Close task waiver mixed role",
  });
  assert.equal(workWaiveEvaluation.errors.length, 0);
  assert(
    workWaiveEvaluation.warnings.some(
      (warning) =>
        warning.leftPermissionCode === "close.task.work" &&
        warning.rightPermissionCode === "close.task.waive" &&
        String(warning.reason).includes("override risk"),
    ),
    "close task work/waive overlap should warn as an override risk",
  );

  assert(
    PERMISSION_CONFLICTS.some(
      (rule) =>
        rule.leftPermissionCode === "close.task.work" &&
        rule.rightPermissionCode === "close.task.review" &&
        rule.severity === "warn",
    ),
    "permission conflicts should include close task work/review warning",
  );
  assert(
    SOD_RULES.some(
      (rule) =>
        rule.recordType === "CLOSE_TASK_INSTANCE" &&
        rule.action_b === "close.task.review" &&
        rule.enforcement === "warn",
    ),
    "runtime SoD rules should include close task review warning",
  );
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.CloseTaskPreparer, [
    "close.task.preparer",
  ]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.CloseTaskWaiverAuthority, [
    "close.task.waiver",
  ]);

  console.log("test-close-task-sod-rules passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
