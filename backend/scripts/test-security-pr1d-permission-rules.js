import assert from "node:assert/strict";
import {
  assertValidPermissionRuleSet,
  evaluatePermissionRuleSet,
  PERMISSION_CONFLICTS,
  PERMISSION_DEPENDENCIES,
} from "../src/constants/permission-rules.js";
import { ROLE_CAPABILITY_GROUPS } from "../src/seedCore.js";
import "../src/routes/security.js";

function expectThrow(fn, expectedCode) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, "Expected function to throw");
  assert.equal(thrown.code, expectedCode);
  return thrown;
}

async function main() {
  assert.deepEqual(PERMISSION_DEPENDENCIES["gl.journal.post"], ["gl.journal.read"]);
  assert.equal(Array.isArray(PERMISSION_CONFLICTS), true);
  assert.equal(Array.isArray(ROLE_CAPABILITY_GROUPS.GLOperator), true);

  const missingDependencyError = expectThrow(
    () =>
      assertValidPermissionRuleSet({
        permissionCodes: ["gl.journal.post"],
        subjectLabel: "Role Example",
      }),
    "INVALID_PERMISSION_RULE_SET"
  );
  assert(
    String(missingDependencyError.message).includes("gl.journal.read"),
    "missing dependency error should mention gl.journal.read"
  );

  const glPostingGuardrailError = expectThrow(
    () =>
      assertValidPermissionRuleSet({
        permissionCodes: ["gl.journal.post", "gl.journal.read"],
        capabilityGroups: ["gl.posting"],
        subjectLabel: "Role GLPostingAuthority Companion",
      }),
    "INVALID_PERMISSION_RULE_SET"
  );
  assert(
    String(glPostingGuardrailError.message).includes("GLPostingAuthority-style"),
    "guardrail error should mention GLPostingAuthority-style wording"
  );

  const conflictEvaluation = evaluatePermissionRuleSet({
    permissionCodes: ["payments.batch.read", "payments.batch.create", "payments.batch.approve"],
    subjectLabel: "Role Treasury Example",
  });
  assert.equal(conflictEvaluation.errors.length, 0);
  assert.equal(conflictEvaluation.warnings.length > 0, true);
  assert(
    conflictEvaluation.warnings.some(
      (warning) =>
        warning.leftPermissionCode === "payments.batch.create" &&
        warning.rightPermissionCode === "payments.batch.approve"
    ),
    "expected payment maker-checker conflict warning"
  );

  const validEvaluation = assertValidPermissionRuleSet({
    permissionCodes: [
      "gl.journal.read",
      "gl.trial_balance.read",
      "gl.journal.post",
      "gl.period.close.execute",
    ],
    capabilityGroups: ["gl.posting"],
    subjectLabel: "Role CountryController",
  });
  assert.equal(validEvaluation.errors.length, 0);

  console.log("test-security-pr1d-permission-rules passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
