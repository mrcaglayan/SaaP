import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOD_RULES } from "../src/constants/sod-rules.js";
import { assertSoD, evaluateSoD } from "../src/services/sod.service.js";

async function expectThrow(asyncFn, expectedCode) {
  let thrown = null;
  try {
    await asyncFn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, "Expected function to throw");
  assert.equal(thrown.code, expectedCode);
  return thrown;
}

async function main() {
  assert(
    SOD_RULES.some(
      (rule) =>
        rule.recordType === "PAYMENT_BATCH" &&
        rule.action_b === "payments.batch.approve" &&
        rule.enforcement === "block"
    ),
    "Expected payment-batch SoD block rule"
  );
  assert(
    SOD_RULES.some(
      (rule) =>
        rule.recordType === "GL_JOURNAL" &&
        rule.action_b === "gl.journal.post" &&
        rule.enforcement === "warn"
    ),
    "Expected GL journal SoD warning rule"
  );

  const journalEvaluation = await evaluateSoD({
    tenantId: 1,
    userId: 41,
    actionCode: "gl.journal.post",
    recordType: "GL_JOURNAL",
    recordId: 9001,
    context: {
      actorUserIds: {
        createdByUserId: 41,
      },
    },
  });
  assert.equal(journalEvaluation.blockingFindings.length, 0);
  assert.equal(journalEvaluation.warningFindings.length, 1);

  const paymentError = await expectThrow(
    () =>
      assertSoD({
        tenantId: 1,
        userId: 7,
        actionCode: "payments.batch.approve",
        recordType: "PAYMENT_BATCH",
        recordId: 120,
        context: {
          actorUserIds: {
            createdByUserId: 7,
          },
        },
      }),
    "SOD_VIOLATION"
  );
  assert(
    String(paymentError.message).includes("payment batch creators"),
    "Payment-batch SoD message should mention maker-checker"
  );

  const payrollError = await expectThrow(
    () =>
      assertSoD({
        tenantId: 1,
        userId: 15,
        actionCode: "payroll.settlement.override.approve",
        recordType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
        recordId: 330,
        context: {
          actorUserIds: {
            requestedByUserId: 15,
          },
        },
      }),
    "SOD_VIOLATION"
  );
  assert(
    String(payrollError.message).includes("manual settlement override requesters"),
    "Payroll override SoD message should mention requester review conflict"
  );

  const workflowPass = await assertSoD({
    tenantId: 1,
    userId: 22,
    actionCode: "workflow.instance.approve",
    recordType: "WORKFLOW_INSTANCE",
    recordId: 12,
    context: {
      actorUserIds: {
        requestedByUserId: 18,
      },
    },
  });
  assert.equal(workflowPass.blockingFindings.length, 0);

  const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const approvalEngineSource = await readFile(
    path.resolve(backendRoot, "src/services/approval.engine.service.js"),
    "utf8"
  );
  const paymentsSource = await readFile(
    path.resolve(backendRoot, "src/services/payments.service.js"),
    "utf8"
  );
  const payrollOverrideSource = await readFile(
    path.resolve(backendRoot, "src/services/payroll.settlementOverrides.service.js"),
    "utf8"
  );
  const workflowSource = await readFile(
    path.resolve(backendRoot, "src/services/workflows.service.js"),
    "utf8"
  );
  const journalRouteSource = await readFile(
    path.resolve(backendRoot, "src/routes/gl.write.journal.routes.js"),
    "utf8"
  );

  assert(
    approvalEngineSource.includes('actionCode: "payments.batch.approve"'),
    "approval.engine.service.js should map payment-batch review SoD"
  );
  assert(
    paymentsSource.includes("assertSoD"),
    "payments.service.js should call assertSoD"
  );
  assert(
    payrollOverrideSource.includes("assertSoD"),
    "payroll.settlementOverrides.service.js should call assertSoD"
  );
  assert(
    workflowSource.includes("recordDecision("),
    "workflows.service.js should route workflow decisions through the unified approval engine"
  );
  assert(
    journalRouteSource.includes('actionCode: "gl.journal.post"'),
    "gl.write.journal.routes.js should call journal-post SoD evaluation"
  );

  console.log("test-security-pr4b-sod-service-integration passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
