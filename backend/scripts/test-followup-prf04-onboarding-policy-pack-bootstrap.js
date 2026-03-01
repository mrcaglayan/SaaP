import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPolicyPack } from "../src/services/policy-packs.service.js";
import { __testOnboardingInternals } from "../src/routes/onboarding.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function main() {
  const normalizeSelection =
    __testOnboardingInternals?.normalizeEntityPolicyPackSelection;
  const buildPlan = __testOnboardingInternals?.buildPolicyPackBootstrapApplyPlan;

  assert(
    typeof normalizeSelection === "function",
    "Missing normalizeEntityPolicyPackSelection test export"
  );
  assert(
    typeof buildPlan === "function",
    "Missing buildPolicyPackBootstrapApplyPlan test export"
  );

  const normalizedSelection = normalizeSelection({
    policy_pack_id: "tr_uniform_v1",
    policyPackMode: "overwrite",
  });
  assert(
    normalizedSelection?.policyPackId === "TR_UNIFORM_V1",
    "policy_pack_id should normalize to uppercase policyPackId"
  );
  assert(
    normalizedSelection?.policyPackMode === "OVERWRITE",
    "policyPackMode should normalize to uppercase"
  );

  const pack = getPolicyPack("TR_UNIFORM_V1");
  assert(Boolean(pack), "TR_UNIFORM_V1 pack must exist");
  const requiredMappings = (pack?.requiredPurposeMappings || []).filter(
    (row) => row?.required === true
  );
  const optionalMappings = (pack?.requiredPurposeMappings || []).filter(
    (row) => row?.required === false
  );
  assert(
    requiredMappings.length > 0,
    "TR_UNIFORM_V1 must expose required purpose mappings"
  );

  const missingRequiredPurposeCode = toUpper(requiredMappings[0]?.purposeCode);
  const resolvedRequiredPurposeCode = toUpper(
    (requiredMappings[1] || requiredMappings[0])?.purposeCode
  );
  const optionalPurposeCode = toUpper(optionalMappings[0]?.purposeCode);

  const previewRows = [
    {
      purposeCode: missingRequiredPurposeCode,
      missing: true,
      reason: "no_match",
    },
    optionalPurposeCode
      ? {
          purposeCode: optionalPurposeCode,
          missing: true,
          reason: "no_match",
        }
      : null,
    {
      purposeCode: resolvedRequiredPurposeCode,
      missing: false,
      accountId: 9001,
    },
    {
      purposeCode: resolvedRequiredPurposeCode,
      missing: false,
      accountId: 9002,
    },
  ].filter(Boolean);

  const plan = buildPlan(pack, previewRows);
  assert(
    plan.requiredPurposeCount === requiredMappings.length,
    "requiredPurposeCount should match requiredPurposeMappings length"
  );
  assert(
    Array.isArray(plan.applyRows) && plan.applyRows.length === 1,
    "Plan must include one resolved apply row (deduplicated by purposeCode)"
  );
  assert(
    toUpper(plan.applyRows[0]?.purposeCode) === resolvedRequiredPurposeCode &&
      Number(plan.applyRows[0]?.accountId) === 9001,
    "Plan should keep first resolved row per purposeCode"
  );
  assert(
    plan.missingRequiredPurposeCodes.includes(missingRequiredPurposeCode),
    "Plan should surface missing required purpose codes"
  );
  if (optionalPurposeCode) {
    assert(
      Number(plan.missingOptionalCount) === 1,
      "Plan should count missing optional purpose rows"
    );
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const onboardingRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/onboarding.js"),
    "utf8"
  );
  assert(
    onboardingRouteSource.includes("entity?.policyPackId ?? entity?.policy_pack_id"),
    "Onboarding bootstrap should parse policyPackId from camelCase/snake_case payloads"
  );
  assert(
    onboardingRouteSource.includes("resolvePolicyPack({"),
    "Onboarding bootstrap should preview selected policy packs"
  );
  assert(
    onboardingRouteSource.includes("applyPolicyPackTx({"),
    "Onboarding bootstrap should apply selected policy packs in transaction"
  );

  console.log("PR-F04 onboarding policy-pack bootstrap test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
