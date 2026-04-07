import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterOrgScopeTreeByAllowedScopeTypes,
  getOrgScopeTreeRoot,
  mapOrgScopeTreeNodeToCurrentScopeFields,
  mapOrgScopeTreeNodeToScopeSelection,
  walkOrgScopeTree,
} from "../../frontend/src/shared/orgScopeTree.js";

function findChild(node, scopeType, scopeId) {
  return (node?.children || []).find(
    (child) =>
      String(child?.scopeType || "").toUpperCase() === scopeType &&
      Number(child?.scopeId) === Number(scopeId)
  );
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const orgAdminSource = await readFile(
    path.resolve(rootDir, "frontend/src/api/orgAdmin.js"),
    "utf8"
  );

  assert(
    orgAdminSource.includes("export async function listOrgTree") &&
      orgAdminSource.includes('shape = "nested"') &&
      orgAdminSource.includes('`/api/v1/org/tree${toQueryString({ shape, ...rest })}`'),
    "orgAdmin.js should expose listOrgTree() against the canonical nested tree endpoint"
  );

  const sampleTreeResponse = {
    tenantId: 77,
    shape: "nested",
    root: {
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
              selectable: true,
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
    },
  };

  const root = getOrgScopeTreeRoot(sampleTreeResponse);
  assert.ok(root, "nested org tree helper should resolve the canonical root node");
  assert.equal(getOrgScopeTreeRoot({ tenantId: 77, groups: [] }), null);

  const visitedKeys = [];
  walkOrgScopeTree(root, (node) => {
    visitedKeys.push(node.key);
  });
  assert.deepEqual(visitedKeys, [
    "TENANT:77",
    "GROUP:10",
    "COUNTRY:1:GROUP:10",
    "LEGAL_ENTITY:100",
    "OPERATING_UNIT:1000",
  ]);

  const legalEntityNode = findChild(findChild(findChild(root, "GROUP", 10), "COUNTRY", 1), "LEGAL_ENTITY", 100);
  const operatingUnitNode = findChild(legalEntityNode, "OPERATING_UNIT", 1000);

  assert.deepEqual(mapOrgScopeTreeNodeToScopeSelection(operatingUnitNode), {
    scopeType: "OPERATING_UNIT",
    scopeId: 1000,
  });
  assert.deepEqual(mapOrgScopeTreeNodeToCurrentScopeFields(operatingUnitNode), {
    scopeType: "OPERATING_UNIT",
    scopeId: "1000",
    groupCompanyId: "",
    countryId: "",
    legalEntityId: "",
    operatingUnitId: "1000",
  });

  assert.deepEqual(mapOrgScopeTreeNodeToCurrentScopeFields(legalEntityNode), {
    scopeType: "LEGAL_ENTITY",
    scopeId: "100",
    groupCompanyId: "",
    countryId: "",
    legalEntityId: "100",
    operatingUnitId: "",
  });

  const legalEntityOnlyTree = filterOrgScopeTreeByAllowedScopeTypes(root, [
    "LEGAL_ENTITY",
  ]);
  const filteredGroup = findChild(legalEntityOnlyTree, "GROUP", 10);
  const filteredCountry = findChild(filteredGroup, "COUNTRY", 1);
  const filteredEntity = findChild(filteredCountry, "LEGAL_ENTITY", 100);
  assert.ok(filteredGroup, "group ancestor should remain for navigation");
  assert.ok(filteredCountry, "country ancestor should remain for navigation");
  assert.ok(filteredEntity, "allowed legal entity should remain selectable");
  assert.equal(filteredGroup.selectable, false);
  assert.equal(filteredCountry.selectable, false);
  assert.equal(filteredEntity.selectable, true);
  assert.deepEqual(filteredEntity.children, []);

  const operatingUnitOnlyTree = filterOrgScopeTreeByAllowedScopeTypes(root, [
    "OPERATING_UNIT",
  ]);
  const filteredOu = findChild(
    findChild(
      findChild(
        findChild(operatingUnitOnlyTree, "GROUP", 10),
        "COUNTRY",
        1
      ),
      "LEGAL_ENTITY",
      100
    ),
    "OPERATING_UNIT",
    1000
  );
  assert.ok(filteredOu, "operating-unit filtering should keep the navigable ancestor path");
  assert.equal(filteredOu.selectable, true);

  const invalidFilterTree = filterOrgScopeTreeByAllowedScopeTypes(root, ["INVALID_TYPE"]);
  assert.ok(invalidFilterTree, "root should remain stable when the allowed filter excludes all nodes");
  assert.deepEqual(invalidFilterTree.children, []);
  assert.equal(invalidFilterTree.selectable, false);

  console.log("test-org-wgx09-frontend-tree-utils passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
