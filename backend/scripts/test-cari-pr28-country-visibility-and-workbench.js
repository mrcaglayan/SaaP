import { closePool, query } from "../src/db.js";
import { assertScopeAccess } from "../src/middleware/rbac.js";
import { seedCore } from "../src/seedCore.js";
import {
  createCariDraftDocument,
  getCariDocumentByIdForTenant,
  listCariDocuments,
} from "../src/services/cari.document.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function expectThrows(promiseFactory, expectedMessage, expectedStatus = null) {
  try {
    await promiseFactory();
  } catch (error) {
    if (expectedMessage) {
      assert(
        String(error?.message || "").includes(expectedMessage),
        `Expected error message to include "${expectedMessage}", got "${error?.message || ""}"`
      );
    }
    if (expectedStatus !== null) {
      assert(
        Number(error?.status || 0) === Number(expectedStatus),
        `Expected status ${expectedStatus}, got ${error?.status || 0}`
      );
    }
    return;
  }
  throw new Error(`Expected error containing "${expectedMessage}"`);
}

function allowAllScopes() {}

function buildScopeContext({ tenantId, countryId, legalEntityIds = [] }) {
  return {
    tenantId,
    tenantWide: false,
    groups: new Set(),
    countries: new Set([toPositiveInt(countryId)].filter(Boolean)),
    legalEntities: new Set(legalEntityIds.map((item) => toPositiveInt(item)).filter(Boolean)),
    operatingUnits: new Set(),
  };
}

function makeRequestContext({ tenantId, userId, requestSuffix, scopeContext = null }) {
  const request = {
    requestId: `cari-pr28:${requestSuffix}:${Date.now()}`.slice(0, 80),
    headers: {
      "user-agent": "cari-pr28-country-visibility-and-workbench",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
    query: {
      tenantId,
    },
    params: {},
    body: {},
  };
  if (scopeContext) {
    request.rbac = {
      tenantId,
      permissionScopeContext: scopeContext,
      visibilityScopeContext: scopeContext,
    };
  }
  return request;
}

async function createTenant(code, name) {
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [code, name]);
  const result = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [code]
  );
  const tenantId = toPositiveInt(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to create tenant ${code}`);
  return tenantId;
}

async function createUser({ tenantId, email, name, passwordHash = "test-hash" }) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
  );
  const result = await query(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
        AND email = ?
      LIMIT 1`,
    [tenantId, email]
  );
  const userId = toPositiveInt(result.rows?.[0]?.id);
  assert(userId > 0, `Failed to create user ${email}`);
  return userId;
}

async function resolveCountryByIso2(iso2) {
  const result = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = ?
      LIMIT 1`,
    [iso2]
  );
  const countryId = toPositiveInt(result.rows?.[0]?.id);
  const currencyCode = String(
    result.rows?.[0]?.default_currency_code || "USD"
  ).toUpperCase();
  assert(countryId > 0, `Country ${iso2} is required`);
  return {
    countryId,
    currencyCode,
  };
}

async function createGroupCompany({ tenantId, code, name }) {
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, code, name]
  );
  const result = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  const groupId = toPositiveInt(result.rows?.[0]?.id);
  assert(groupId > 0, `Failed to create group company ${code}`);
  return groupId;
}

async function createLegalEntity({
  tenantId,
  groupId,
  countryId,
  currencyCode,
  code,
  name,
}) {
  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, groupId, code, name, countryId, currencyCode]
  );
  const result = await query(
    `SELECT id, code, name
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  const row = result.rows?.[0] || null;
  assert(toPositiveInt(row?.id) > 0, `Failed to create legal entity ${code}`);
  return row;
}

async function createPaymentTerm({ tenantId, legalEntityId, code, name }) {
  await query(
    `INSERT INTO payment_terms (
        tenant_id,
        legal_entity_id,
        code,
        name,
        due_days,
        grace_days,
        status
     )
     VALUES (?, ?, ?, ?, 30, 0, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name]
  );
  const result = await query(
    `SELECT id
       FROM payment_terms
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const paymentTermId = toPositiveInt(result.rows?.[0]?.id);
  assert(paymentTermId > 0, `Failed to create payment term ${code}`);
  return paymentTermId;
}

async function createVendor({
  tenantId,
  legalEntityId,
  paymentTermId,
  currencyCode,
  code,
  name,
}) {
  await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        default_payment_term_id,
        status
     )
     VALUES (?, ?, ?, ?, FALSE, TRUE, ?, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name, currencyCode, paymentTermId]
  );
  const result = await query(
    `SELECT id
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const vendorId = toPositiveInt(result.rows?.[0]?.id);
  assert(vendorId > 0, `Failed to create vendor ${code}`);
  return vendorId;
}

async function createApDraft({
  req,
  tenantId,
  userId,
  legalEntityId,
  counterpartyId,
  paymentTermId,
  currencyCode,
  documentDate,
  amountTxn,
}) {
  return createCariDraftDocument({
    req,
    payload: {
      tenantId,
      userId,
      legalEntityId,
      direction: "AP",
      documentType: "INVOICE",
      documentDate,
      dueDate: "2026-03-31",
      counterpartyId,
      paymentTermId,
      currencyCode,
      amountTxn,
      amountBase: amountTxn,
      fxRate: 1,
    },
    assertScopeAccess: allowAllScopes,
  });
}

async function main() {
  await seedCore();

  const stamp = Date.now();
  const tenantId = await createTenant(
    `PR28_T_${stamp}`,
    `PR-28 Country Visibility ${stamp}`
  );
  const userId = await createUser({
    tenantId,
    email: `pr28-${stamp}@example.com`,
    name: "PR-28 Country Reviewer",
  });

  const us = await resolveCountryByIso2("US");
  const de = await resolveCountryByIso2("DE");
  const groupId = await createGroupCompany({
    tenantId,
    code: `PR28GC${stamp}`,
    name: `PR-28 Group ${stamp}`,
  });

  const entityUsA = await createLegalEntity({
    tenantId,
    groupId,
    countryId: us.countryId,
    currencyCode: us.currencyCode,
    code: `PR28USA${stamp}`,
    name: `PR-28 US Entity A ${stamp}`,
  });
  const entityUsB = await createLegalEntity({
    tenantId,
    groupId,
    countryId: us.countryId,
    currencyCode: us.currencyCode,
    code: `PR28USB${stamp}`,
    name: `PR-28 US Entity B ${stamp}`,
  });
  const entityDe = await createLegalEntity({
    tenantId,
    groupId,
    countryId: de.countryId,
    currencyCode: de.currencyCode,
    code: `PR28DE${stamp}`,
    name: `PR-28 DE Entity ${stamp}`,
  });

  const termUsA = await createPaymentTerm({
    tenantId,
    legalEntityId: toPositiveInt(entityUsA.id),
    code: `PR28TERMUSA${stamp}`,
    name: `PR-28 Term USA ${stamp}`,
  });
  const termUsB = await createPaymentTerm({
    tenantId,
    legalEntityId: toPositiveInt(entityUsB.id),
    code: `PR28TERMUSB${stamp}`,
    name: `PR-28 Term USB ${stamp}`,
  });
  const termDe = await createPaymentTerm({
    tenantId,
    legalEntityId: toPositiveInt(entityDe.id),
    code: `PR28TERMDE${stamp}`,
    name: `PR-28 Term DE ${stamp}`,
  });

  const vendorUsA = await createVendor({
    tenantId,
    legalEntityId: toPositiveInt(entityUsA.id),
    paymentTermId: termUsA,
    currencyCode: us.currencyCode,
    code: `PR28VUSA${stamp}`,
    name: `PR-28 Vendor USA ${stamp}`,
  });
  const vendorUsB = await createVendor({
    tenantId,
    legalEntityId: toPositiveInt(entityUsB.id),
    paymentTermId: termUsB,
    currencyCode: us.currencyCode,
    code: `PR28VUSB${stamp}`,
    name: `PR-28 Vendor USB ${stamp}`,
  });
  const vendorDe = await createVendor({
    tenantId,
    legalEntityId: toPositiveInt(entityDe.id),
    paymentTermId: termDe,
    currencyCode: de.currencyCode,
    code: `PR28VDE${stamp}`,
    name: `PR-28 Vendor DE ${stamp}`,
  });

  const createReq = makeRequestContext({
    tenantId,
    userId,
    requestSuffix: "seed",
  });

  const docUsA = await createApDraft({
    req: createReq,
    tenantId,
    userId,
    legalEntityId: toPositiveInt(entityUsA.id),
    counterpartyId: vendorUsA,
    paymentTermId: termUsA,
    currencyCode: us.currencyCode,
    documentDate: "2026-03-01",
    amountTxn: 110,
  });
  const docUsB = await createApDraft({
    req: createReq,
    tenantId,
    userId,
    legalEntityId: toPositiveInt(entityUsB.id),
    counterpartyId: vendorUsB,
    paymentTermId: termUsB,
    currencyCode: us.currencyCode,
    documentDate: "2026-03-02",
    amountTxn: 220,
  });
  const docDe = await createApDraft({
    req: createReq,
    tenantId,
    userId,
    legalEntityId: toPositiveInt(entityDe.id),
    counterpartyId: vendorDe,
    paymentTermId: termDe,
    currencyCode: de.currencyCode,
    documentDate: "2026-03-03",
    amountTxn: 330,
  });

  const usCountryScope = buildScopeContext({
    tenantId,
    countryId: us.countryId,
    legalEntityIds: [entityUsA.id, entityUsB.id],
  });
  const countryReviewerReq = makeRequestContext({
    tenantId,
    userId,
    requestSuffix: "country-us-reviewer",
    scopeContext: usCountryScope,
  });

  const listResult = await listCariDocuments({
    req: countryReviewerReq,
    tenantId,
    filters: {
      direction: "AP",
      limit: 100,
      offset: 0,
    },
  });
  const listedIds = new Set((listResult.rows || []).map((row) => toPositiveInt(row?.id)));
  assert(
    listedIds.has(docUsA.id) && listedIds.has(docUsB.id) && !listedIds.has(docDe.id),
    "Country-scoped reviewer should list AP docs across both same-country entities without leaking other countries"
  );
  assert(
    (listResult.rows || []).every(
      (row) =>
        typeof row?.workflowGate === "object" &&
        row?.legalEntityCode &&
        row?.legalEntityName
    ),
    "Country-scoped list rows should include workflow gate and legal-entity context for the workbench"
  );

  const visibleReadback = await getCariDocumentByIdForTenant({
    req: countryReviewerReq,
    tenantId,
    documentId: docUsB.id,
    assertScopeAccess,
  });
  assert(
    visibleReadback.id === docUsB.id &&
      visibleReadback.legalEntityCode === entityUsB.code,
    "Country-scoped reviewer should read a same-country document from another legal entity"
  );

  await expectThrows(
    () =>
      getCariDocumentByIdForTenant({
        req: countryReviewerReq,
        tenantId,
        documentId: docDe.id,
        assertScopeAccess,
      }),
    "Access denied for documentId",
    403
  );

  console.log(
    "PR-28 smoke test passed (country-scoped AP reviewer visibility spans same-country entities only)."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
