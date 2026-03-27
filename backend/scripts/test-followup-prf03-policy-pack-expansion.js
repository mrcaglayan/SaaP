import { getPolicyPack, listPolicyPacks } from "../src/services/policy-packs.service.js";

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

function findByCode(rows, code) {
  const normalized = toUpper(code);
  return (rows || []).find((row) => toUpper(row?.code) === normalized) || null;
}

function findByPurposeCode(rows, purposeCode) {
  const normalized = toUpper(purposeCode);
  return (rows || []).find((row) => toUpper(row?.purposeCode) === normalized) || null;
}

const TR_UNIFORM_EXPECTED_POSTABLE_CODES = Object.freeze([
  "153",
  "157",
  "191",
  "255",
  "257",
  "391",
  "621",
  "679",
  "689",
]);

function assertPackExpansion(pack) {
  assert(Array.isArray(pack?.starterAccountTree), `${pack?.packId} starterAccountTree missing`);
  assert(
    pack.starterAccountTree.length > 0,
    `${pack?.packId} starterAccountTree must not be empty`
  );
  assert(
    Array.isArray(pack?.requiredParentAccounts),
    `${pack?.packId} requiredParentAccounts missing`
  );
  assert(
    pack.requiredParentAccounts.length > 0,
    `${pack?.packId} requiredParentAccounts must not be empty`
  );
  assert(
    Array.isArray(pack?.requiredPurposeMappings),
    `${pack?.packId} requiredPurposeMappings missing`
  );
  assert(
    pack.requiredPurposeMappings.length > 0,
    `${pack?.packId} requiredPurposeMappings must not be empty`
  );

  for (const parentRow of pack.requiredParentAccounts) {
    const treeRow = findByCode(pack.starterAccountTree, parentRow.code);
    assert(
      Boolean(treeRow),
      `${pack.packId} required parent code ${parentRow.code} missing from starter tree`
    );
    assert(
      parentRow.allowPosting === false,
      `${pack.packId} required parent ${parentRow.code} must be non-postable`
    );
  }

  const requiredPurposeCodes = new Set();
  for (const module of pack.modules || []) {
    for (const purposeCode of module?.requiredPurposeCodes || []) {
      requiredPurposeCodes.add(toUpper(purposeCode));
    }
  }
  for (const purposeCode of requiredPurposeCodes) {
    const mappingRow = findByPurposeCode(pack.requiredPurposeMappings, purposeCode);
    assert(
      Boolean(mappingRow),
      `${pack.packId} required purpose mapping missing: ${purposeCode}`
    );
    assert(
      mappingRow.required === true,
      `${pack.packId} required purpose ${purposeCode} must be marked required=true`
    );
  }
}

async function main() {
  const rows = listPolicyPacks();
  assert(Array.isArray(rows), "listPolicyPacks must return an array");
  assert(rows.length >= 3, "Expected at least 3 policy packs");

  for (const row of rows) {
    assert(
      Number(row?.starterAccountTreeCount || 0) > 0,
      `${row?.packId} starterAccountTreeCount must be > 0`
    );
    assert(
      Number(row?.requiredParentAccountCount || 0) > 0,
      `${row?.packId} requiredParentAccountCount must be > 0`
    );
    assert(
      Number(row?.requiredPurposeMappingCount || 0) > 0,
      `${row?.packId} requiredPurposeMappingCount must be > 0`
    );

    const pack = getPolicyPack(row.packId);
    assert(Boolean(pack), `Policy pack must exist: ${row.packId}`);
    assertPackExpansion(pack);
  }

  const trPack = getPolicyPack("TR_UNIFORM_V1");
  const afPack = getPolicyPack("AF_STARTER_V1");
  const usPack = getPolicyPack("US_GAAP_STARTER_V1");
  const optionalRows = (trPack?.requiredPurposeMappings || []).filter(
    (row) => row?.required === false
  );
  assert(optionalRows.length > 0, "TR_UNIFORM_V1 should include optional context mappings");

  const trBank = findByPurposeCode(trPack?.requiredPurposeMappings, "BANK_CONTROL_PARENT");
  const afBank = findByPurposeCode(afPack?.requiredPurposeMappings, "BANK_CONTROL_PARENT");
  const usBank = findByPurposeCode(usPack?.requiredPurposeMappings, "BANK_CONTROL_PARENT");
  assert(trBank?.required === true, "TR_UNIFORM_V1 must require BANK_CONTROL_PARENT");
  assert(
    String(trBank?.recommendedCode || "") === "102",
    "TR_UNIFORM_V1 BANK_CONTROL_PARENT should recommend 102"
  );
  assert(
    String(afBank?.recommendedCode || "") === "1150",
    "AF_STARTER_V1 BANK_CONTROL_PARENT should recommend 1150"
  );
  assert(
    String(usBank?.recommendedCode || "") === "1150",
    "US_GAAP_STARTER_V1 BANK_CONTROL_PARENT should recommend 1150"
  );

  for (const code of TR_UNIFORM_EXPECTED_POSTABLE_CODES) {
    const row = findByCode(trPack?.starterAccountTree, code);
    assert(Boolean(row), `TR_UNIFORM_V1 starter tree missing code ${code}`);
    assert(
      row.allowPosting === true,
      `TR_UNIFORM_V1 code ${code} must stay postable by default`
    );
  }

  console.log("PR-F03 policy pack expansion test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
