import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOrgScopeTreeInitialExpandedKeys,
  collectOrgScopeTreeExpandableKeys,
  doesOrgScopeTreeNodeMatchSearch,
  filterOrgScopeTreeBySearchTerm,
  resolveOrgScopeTreeNodeState,
  toggleOrgScopeTreeExpandedKey,
} from "../../frontend/src/components/org/useOrgScopeTree.js";

function findChild(node, scopeType, scopeId) {
  return (node?.children || []).find(
    (child) =>
      String(child?.scopeType || "").toUpperCase() === scopeType &&
      Number(child?.scopeId) === Number(scopeId)
  );
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pickerSource = await readFile(
    path.resolve(rootDir, "frontend/src/components/org/OrgScopeTreePicker.jsx"),
    "utf8"
  );

  const sampleRoot = {
    key: "TENANT:77",
    scopeType: "TENANT",
    scopeId: 77,
    label: "Tenant",
    code: null,
    selectable: true,
    pathLabels: ["Tenant"],
    meta: {},
    children: [
      {
        key: "GROUP:10",
        scopeType: "GROUP",
        scopeId: 10,
        label: "North Hub Group",
        code: "NHG",
        selectable: true,
        pathLabels: ["Tenant", "North Hub Group"],
        meta: {},
        children: [
          {
            key: "COUNTRY:1:GROUP:10",
            scopeType: "COUNTRY",
            scopeId: 1,
            label: "Turkey",
            code: "TR",
            selectable: false,
            pathLabels: ["Tenant", "North Hub Group", "Turkey"],
            meta: { iso2: "TR" },
            children: [
              {
                key: "LEGAL_ENTITY:100",
                scopeType: "LEGAL_ENTITY",
                scopeId: 100,
                label: "TR HQ",
                code: "TRHQ",
                selectable: true,
                pathLabels: ["Tenant", "North Hub Group", "Turkey", "TR HQ"],
                meta: {},
                children: [
                  {
                    key: "OPERATING_UNIT:1000",
                    scopeType: "OPERATING_UNIT",
                    scopeId: 1000,
                    label: "Istanbul Branch",
                    code: "IST",
                    selectable: true,
                    pathLabels: [
                      "Tenant",
                      "North Hub Group",
                      "Turkey",
                      "TR HQ",
                      "Istanbul Branch",
                    ],
                    meta: { unitType: "BRANCH" },
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(buildOrgScopeTreeInitialExpandedKeys(sampleRoot), ["TENANT:77"]);
  assert.deepEqual(
    buildOrgScopeTreeInitialExpandedKeys(sampleRoot, ["GROUP:10"]),
    ["GROUP:10"]
  );

  assert.deepEqual(collectOrgScopeTreeExpandableKeys(sampleRoot), [
    "TENANT:77",
    "GROUP:10",
    "COUNTRY:1:GROUP:10",
    "LEGAL_ENTITY:100",
  ]);

  const expandedOnce = toggleOrgScopeTreeExpandedKey(new Set(["TENANT:77"]), "GROUP:10");
  assert.deepEqual(Array.from(expandedOnce).sort(), ["GROUP:10", "TENANT:77"]);
  const collapsedAgain = toggleOrgScopeTreeExpandedKey(expandedOnce, "GROUP:10");
  assert.deepEqual(Array.from(collapsedAgain), ["TENANT:77"]);

  assert.equal(doesOrgScopeTreeNodeMatchSearch(sampleRoot, "tenant"), true);
  assert.equal(
    doesOrgScopeTreeNodeMatchSearch(findChild(sampleRoot, "GROUP", 10), "nhg"),
    true
  );
  assert.equal(
    doesOrgScopeTreeNodeMatchSearch(
      findChild(findChild(sampleRoot, "GROUP", 10), "COUNTRY", 1),
      "tr"
    ),
    true
  );
  assert.equal(doesOrgScopeTreeNodeMatchSearch(sampleRoot, "mexico"), false);

  const filteredRoot = filterOrgScopeTreeBySearchTerm(sampleRoot, "istanbul");
  const filteredGroup = findChild(filteredRoot, "GROUP", 10);
  const filteredCountry = findChild(filteredGroup, "COUNTRY", 1);
  const filteredEntity = findChild(filteredCountry, "LEGAL_ENTITY", 100);
  const filteredOu = findChild(filteredEntity, "OPERATING_UNIT", 1000);
  assert.ok(filteredGroup, "group ancestor should stay visible during search");
  assert.ok(filteredCountry, "country ancestor should stay visible during search");
  assert.ok(filteredEntity, "entity ancestor should stay visible during search");
  assert.ok(filteredOu, "matching operating unit should stay visible during search");

  const navigationOnlyState = resolveOrgScopeTreeNodeState(filteredCountry);
  assert.equal(navigationOnlyState.isDisabled, true);
  assert.equal(navigationOnlyState.disabledReason, "Visible for navigation only.");

  const customDisabledState = resolveOrgScopeTreeNodeState(filteredOu, {
    selectedScope: { scopeType: "OPERATING_UNIT", scopeId: 1000 },
    getNodeDisabledReason: (node) =>
      node.scopeType === "OPERATING_UNIT" ? "Operating units are blocked here." : "",
  });
  assert.equal(customDisabledState.isSelected, true);
  assert.equal(customDisabledState.isDisabled, true);
  assert.equal(customDisabledState.disabledReason, "Operating units are blocked here.");

  assert(
    pickerSource.includes('import { useOrgScopeTree } from "./useOrgScopeTree.js"') &&
      pickerSource.includes("Expand all") &&
      pickerSource.includes("Collapse all") &&
      pickerSource.includes("Selected path") &&
      pickerSource.includes("Search expands matching branches automatically.") &&
      pickerSource.includes("nodeState.disabledReason"),
    "OrgScopeTreePicker should wire the shared hook, expand/collapse controls, breadcrumb display, and disabled reasons"
  );

  console.log("test-org-wgx10-tree-picker passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
