import assert from "node:assert/strict";
import {
  buildNestedOrgTreeResponse,
} from "../src/services/org.read.service.js";
import { parseOrgTreeReadFilters } from "../src/routes/org.read.validators.js";

const sampleGroups = [
  { id: 10, code: "NHG", name: "North Hub Group" },
  { id: 20, code: "SHG", name: "South Hub Group" },
];

const sampleCountries = [
  {
    id: 1,
    iso2: "TR",
    iso3: "TUR",
    name: "Turkey",
    default_currency_code: "TRY",
  },
  {
    id: 2,
    iso2: "AE",
    iso3: "ARE",
    name: "United Arab Emirates",
    default_currency_code: "AED",
  },
];

const sampleLegalEntities = [
  {
    id: 100,
    group_company_id: 10,
    country_id: 1,
    code: "TRHQ",
    name: "TR HQ",
    tax_id: "TR-001",
    functional_currency_code: "TRY",
    status: "ACTIVE",
    is_intercompany_enabled: 1,
    intercompany_partner_required: 0,
  },
  {
    id: 200,
    group_company_id: 20,
    country_id: 1,
    code: "TRBR",
    name: "TR Branch",
    tax_id: "TR-002",
    functional_currency_code: "TRY",
    status: "ACTIVE",
    is_intercompany_enabled: 1,
    intercompany_partner_required: 0,
  },
];

const sampleOperatingUnits = [
  {
    id: 1000,
    legal_entity_id: 100,
    code: "IST",
    name: "Istanbul Branch",
    unit_type: "BRANCH",
    has_subledger: 1,
    status: "ACTIVE",
    capital_self_balancing_ready: 1,
    cross_context_self_balancing_ready: 1,
  },
  {
    id: 2000,
    legal_entity_id: 200,
    code: "ANK",
    name: "Ankara Branch",
    unit_type: "BRANCH",
    has_subledger: 1,
    status: "ACTIVE",
    capital_self_balancing_ready: 1,
    cross_context_self_balancing_ready: 1,
  },
];

function findChild(node, scopeType, scopeId) {
  return (node?.children || []).find(
    (child) =>
      String(child?.scopeType || "").toUpperCase() === scopeType &&
      Number(child?.scopeId) === Number(scopeId)
  );
}

function createScopeContext({
  tenantWide = false,
  groups = [],
  countries = [],
  legalEntities = [],
  operatingUnits = [],
} = {}) {
  return {
    tenantId: 77,
    sourceRows: 1,
    tenantWide,
    groups: new Set(groups),
    countries: new Set(countries),
    legalEntities: new Set(legalEntities),
    operatingUnits: new Set(operatingUnits),
  };
}

async function main() {
  assert.deepEqual(parseOrgTreeReadFilters({}), { shape: "flat" });
  assert.deepEqual(parseOrgTreeReadFilters({ shape: "nested" }), {
    shape: "nested",
  });
  assert.throws(
    () => parseOrgTreeReadFilters({ shape: "matrix" }),
    /shape must be flat or nested/
  );

  const tenantWideTree = buildNestedOrgTreeResponse({
    tenantId: 77,
    scopeContext: createScopeContext({ tenantWide: true }),
    groups: sampleGroups,
    countries: sampleCountries,
    legalEntities: sampleLegalEntities,
    operatingUnits: sampleOperatingUnits,
  });

  assert.equal(tenantWideTree.shape, "nested");
  assert.equal(tenantWideTree.root.selectable, true);
  assert.equal(tenantWideTree.root.key, "TENANT:77");
  assert.deepEqual(tenantWideTree.root.pathLabels, ["Tenant"]);
  assert.equal(tenantWideTree.root.children.length, 3);

  const northGroup = findChild(tenantWideTree.root, "GROUP", 10);
  const southGroup = findChild(tenantWideTree.root, "GROUP", 20);
  const fallbackCountry = findChild(tenantWideTree.root, "COUNTRY", 2);
  assert.ok(northGroup);
  assert.ok(southGroup);
  assert.ok(fallbackCountry);
  assert.equal(northGroup.selectable, true);
  assert.deepEqual(northGroup.pathLabels, ["Tenant", "North Hub Group"]);
  assert.equal(fallbackCountry.key, "COUNTRY:2");
  assert.equal(fallbackCountry.selectable, true);

  const northTurkey = findChild(northGroup, "COUNTRY", 1);
  const southTurkey = findChild(southGroup, "COUNTRY", 1);
  assert.ok(northTurkey);
  assert.ok(southTurkey);
  assert.equal(northTurkey.key, "COUNTRY:1:GROUP:10");
  assert.equal(southTurkey.key, "COUNTRY:1:GROUP:20");
  assert.equal(northTurkey.selectable, true);
  assert.equal(southTurkey.selectable, true);

  const northEntity = findChild(northTurkey, "LEGAL_ENTITY", 100);
  assert.ok(northEntity);
  assert.equal(northEntity.selectable, true);
  assert.deepEqual(northEntity.pathLabels, [
    "Tenant",
    "North Hub Group",
    "Turkey",
    "TR HQ",
  ]);

  const northOu = findChild(northEntity, "OPERATING_UNIT", 1000);
  assert.ok(northOu);
  assert.equal(northOu.selectable, true);
  assert.deepEqual(northOu.pathLabels, [
    "Tenant",
    "North Hub Group",
    "Turkey",
    "TR HQ",
    "Istanbul Branch",
  ]);

  const ouOnlyTree = buildNestedOrgTreeResponse({
    tenantId: 77,
    scopeContext: createScopeContext({ operatingUnits: [1000] }),
    groups: sampleGroups,
    countries: sampleCountries,
    legalEntities: sampleLegalEntities,
    operatingUnits: sampleOperatingUnits,
  });

  assert.equal(ouOnlyTree.root.selectable, false);
  assert.equal(ouOnlyTree.root.children.length, 1);

  const ouOnlyGroup = findChild(ouOnlyTree.root, "GROUP", 10);
  assert.ok(ouOnlyGroup);
  assert.equal(ouOnlyGroup.selectable, false);

  const ouOnlyCountry = findChild(ouOnlyGroup, "COUNTRY", 1);
  assert.ok(ouOnlyCountry);
  assert.equal(ouOnlyCountry.selectable, false);

  const ouOnlyEntity = findChild(ouOnlyCountry, "LEGAL_ENTITY", 100);
  assert.ok(ouOnlyEntity);
  assert.equal(ouOnlyEntity.selectable, false);

  const ouOnlyNode = findChild(ouOnlyEntity, "OPERATING_UNIT", 1000);
  assert.ok(ouOnlyNode);
  assert.equal(ouOnlyNode.selectable, true);
  assert.deepEqual(ouOnlyNode.pathLabels, [
    "Tenant",
    "North Hub Group",
    "Turkey",
    "TR HQ",
    "Istanbul Branch",
  ]);

  const countryOnlyTree = buildNestedOrgTreeResponse({
    tenantId: 77,
    scopeContext: createScopeContext({ countries: [2] }),
    groups: sampleGroups,
    countries: sampleCountries,
    legalEntities: sampleLegalEntities,
    operatingUnits: sampleOperatingUnits,
  });

  assert.equal(countryOnlyTree.root.children.length, 1);
  const directCountryNode = findChild(countryOnlyTree.root, "COUNTRY", 2);
  assert.ok(directCountryNode);
  assert.equal(directCountryNode.key, "COUNTRY:2");
  assert.equal(directCountryNode.selectable, true);
  assert.deepEqual(directCountryNode.pathLabels, [
    "Tenant",
    "United Arab Emirates",
  ]);
  assert.deepEqual(directCountryNode.children, []);

  console.log("test-org-wgx08-nested-tree-contract passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
