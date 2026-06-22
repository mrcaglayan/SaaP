import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import { assertScopeAccess, invalidateRbacCache, requirePermission } from "../src/middleware/rbac.js";
import { parsePositiveInt } from "../src/routes/_utils.js";
import { seedCore } from "../src/seedCore.js";
import {
  createTaxAccountMapping,
  createTaxCode,
  createTaxRegime,
  createTaxRule,
  listTaxRules,
  previewTaxComputation,
  resolveTaxCodeScope,
  resolveTaxRegimeScope,
  updateTaxRegime,
} from "../src/services/tax.setup.service.js";

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function assertId(value, label) {
  const parsed = toPositiveInt(value);
  assert(parsed, `${label} should resolve to a positive id`);
  return parsed;
}

function resolveLegalEntityScopeFromInput(raw) {
  const legalEntityId = parsePositiveInt(raw?.legalEntityId ?? raw?.legal_entity_id);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}

async function resolveRegimeScopeFromInput(raw, tenantId) {
  const regimeId = parsePositiveInt(raw?.regimeId ?? raw?.regime_id);
  if (!regimeId) {
    return null;
  }
  return resolveTaxRegimeScope(regimeId, tenantId);
}

async function resolveCodeScopeFromInput(raw, tenantId) {
  const taxCodeId = parsePositiveInt(raw?.taxCodeId ?? raw?.tax_code_id);
  if (!taxCodeId) {
    return null;
  }
  return resolveTaxCodeScope(taxCodeId, tenantId);
}

function makeReq({ tenantId, userId, body = {}, query: queryParams = {}, params = {} }) {
  return {
    user: { tenantId, userId },
    body,
    query: queryParams,
    params,
    headers: {},
  };
}

async function authorize(req, permissionCode, resolveScope) {
  const middleware = requirePermission(
    permissionCode,
    resolveScope ? { resolveScope } : undefined
  );
  await new Promise((resolve, reject) => {
    middleware(req, {}, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
  return req;
}

async function expectForbidden(work, label, expectedMessage = null) {
  let caught = null;
  try {
    await work();
  } catch (err) {
    caught = err;
  }

  assert(caught, `${label} should reject`);
  assert.equal(Number(caught.status), 403, `${label} should reject with HTTP 403`);
  if (expectedMessage) {
    assert(
      String(caught.message || "").includes(expectedMessage),
      `${label} should mention ${expectedMessage}; got ${caught.message}`
    );
  }
  return caught;
}

async function createTenant(tenantCode) {
  await query(
    `INSERT INTO tenants (code, name, status)
     VALUES (?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       status = VALUES(status)`,
    [tenantCode, tenantCode]
  );

  const result = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  return assertId(result.rows?.[0]?.id, `tenant ${tenantCode}`);
}

async function resolveCountry() {
  const result = await query(
    `SELECT id, iso2, default_currency_code
     FROM countries
     ORDER BY CASE WHEN iso2 = 'TR' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`
  );
  const row = result.rows?.[0] || null;
  assert(row, "At least one country must be seeded");
  return {
    id: assertId(row.id, "country"),
    iso2: String(row.iso2 || ""),
    currencyCode: String(row.default_currency_code || ""),
  };
}

async function createLegalEntityFixture({ tenantId, country, suffix }) {
  const groupCode = `PR73G${suffix}`;
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [tenantId, groupCode, `PR73 Group ${suffix}`]
  );
  const groupResult = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, groupCode]
  );
  const groupCompanyId = assertId(groupResult.rows?.[0]?.id, "group company");

  const legalEntityCode = `PR73LE${suffix}`;
  await query(
    `INSERT INTO legal_entities (
       tenant_id,
       group_company_id,
       code,
       name,
       country_id,
       functional_currency_code,
       status
     ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       country_id = VALUES(country_id),
       functional_currency_code = VALUES(functional_currency_code),
       status = VALUES(status)`,
    [
      tenantId,
      groupCompanyId,
      legalEntityCode,
      `PR73 Legal Entity ${suffix}`,
      country.id,
      country.currencyCode,
    ]
  );
  const legalEntityResult = await query(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityCode]
  );
  return {
    groupCompanyId,
    legalEntityId: assertId(legalEntityResult.rows?.[0]?.id, "legal entity"),
  };
}

async function createPostingAccountFixture({ tenantId, legalEntityId, suffix }) {
  const coaCode = `PR73COA${suffix}`;
  await query(
    `INSERT INTO charts_of_accounts (tenant_id, legal_entity_id, scope, code, name)
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)
     ON DUPLICATE KEY UPDATE
       legal_entity_id = VALUES(legal_entity_id),
       scope = VALUES(scope),
       name = VALUES(name)`,
    [tenantId, legalEntityId, coaCode, `PR73 Tax COA ${suffix}`]
  );
  const coaResult = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, coaCode]
  );
  const coaId = assertId(coaResult.rows?.[0]?.id, "chart of accounts");

  const accountCode = `391${suffix.slice(-6)}`;
  await query(
    `INSERT INTO accounts (
       coa_id,
       code,
       name,
       account_type,
       normal_side,
       allow_posting,
       is_active
     ) VALUES (?, ?, ?, 'LIABILITY', 'CREDIT', TRUE, TRUE)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       account_type = VALUES(account_type),
       normal_side = VALUES(normal_side),
       allow_posting = VALUES(allow_posting),
       is_active = VALUES(is_active)`,
    [coaId, accountCode, `PR73 VAT Output ${suffix}`]
  );
  const accountResult = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, accountCode]
  );
  return assertId(accountResult.rows?.[0]?.id, "posting account");
}

async function createUser({ tenantId, email, name }) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, 'test-password-hash', ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       tenant_id = VALUES(tenant_id),
       name = VALUES(name),
       status = VALUES(status)`,
    [tenantId, email, name]
  );
  const result = await query(
    `SELECT id
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );
  return assertId(result.rows?.[0]?.id, `user ${email}`);
}

async function getRoleId(tenantId, code) {
  const result = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  return assertId(result.rows?.[0]?.id, `role ${code}`);
}

async function ensureRoleWithPermissions({ tenantId, code, name, permissionCodes }) {
  await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, ?, ?, FALSE)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       is_system = VALUES(is_system)`,
    [tenantId, code, name]
  );
  const roleId = await getRoleId(tenantId, code);

  const permissionResult = await query(
    `SELECT id, code
     FROM permissions
     WHERE code IN (${permissionCodes.map(() => "?").join(", ")})`,
    permissionCodes
  );
  const permissionIdsByCode = new Map(
    (permissionResult.rows || []).map((row) => [String(row.code || ""), assertId(row.id, row.code)])
  );
  const missing = permissionCodes.filter((permissionCode) => !permissionIdsByCode.has(permissionCode));
  assert.equal(missing.length, 0, `Missing permissions: ${missing.join(", ")}`);

  await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
  for (const permissionCode of permissionCodes) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES (?, ?)`,
      [roleId, permissionIdsByCode.get(permissionCode)]
    );
  }
  return roleId;
}

async function assignRoleScope({ tenantId, userId, roleCode, scopeType = "TENANT", scopeId }) {
  const roleId = await getRoleId(tenantId, roleCode);
  const normalizedScopeType = String(scopeType || "TENANT").toUpperCase();
  const normalizedScopeId = normalizedScopeType === "TENANT" ? tenantId : assertId(scopeId, "scope");

  await query(
    `INSERT INTO user_role_scopes (
       tenant_id,
       user_id,
       role_id,
       scope_type,
       scope_id,
       effect
     ) VALUES (?, ?, ?, ?, ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE effect = VALUES(effect)`,
    [tenantId, userId, roleId, normalizedScopeType, normalizedScopeId]
  );
}

async function createRegimeAs({ tenantId, userId, input }) {
  const req = makeReq({ tenantId, userId, body: input });
  await authorize(req, "tax.setup.upsert", (request) =>
    resolveLegalEntityScopeFromInput(request.body)
  );
  return createTaxRegime({ req, input, assertScopeAccess });
}

async function updateRegimeAs({ tenantId, userId, regimeId, input }) {
  const req = makeReq({ tenantId, userId, body: input, params: { regimeId } });
  await authorize(req, "tax.setup.upsert", (request, requestTenantId) =>
    resolveTaxRegimeScope(request.params?.regimeId, requestTenantId)
  );
  return updateTaxRegime({
    req,
    input: { tenantId, regimeId, ...input },
    assertScopeAccess,
  });
}

async function createCodeAs({ tenantId, userId, input }) {
  const req = makeReq({ tenantId, userId, body: input });
  await authorize(req, "tax.setup.upsert", (request, requestTenantId) =>
    resolveRegimeScopeFromInput(request.body, requestTenantId)
  );
  return createTaxCode({ req, input, assertScopeAccess });
}

async function createRuleAs({ tenantId, userId, input }) {
  const req = makeReq({ tenantId, userId, body: input });
  await authorize(req, "tax.setup.upsert", (request, requestTenantId) =>
    resolveRegimeScopeFromInput(request.body, requestTenantId)
  );
  return createTaxRule({ req, input, assertScopeAccess });
}

async function createMappingAs({ tenantId, userId, input }) {
  const req = makeReq({ tenantId, userId, body: input });
  await authorize(req, "tax.setup.upsert", (request) =>
    resolveLegalEntityScopeFromInput(request.body)
  );
  return createTaxAccountMapping({ req, input, assertScopeAccess });
}

async function previewAs({ tenantId, userId, input }) {
  const req = makeReq({ tenantId, userId, body: input });
  await authorize(req, "org.tree.read", (request) =>
    resolveLegalEntityScopeFromInput(request.body)
  );
  return previewTaxComputation({ req, input, assertScopeAccess });
}

async function listRulesAs({ tenantId, userId, filters }) {
  const req = makeReq({ tenantId, userId, query: filters });
  await authorize(req, "org.tree.read", async (request, requestTenantId) => {
    return (
      (await resolveRegimeScopeFromInput(request.query, requestTenantId)) ||
      (await resolveCodeScopeFromInput(request.query, requestTenantId))
    );
  });
  return listTaxRules({ req, tenantId, filters, assertScopeAccess });
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const suffix = String(Date.now()).slice(-9);
  const tenantId = await createTenant(`PR73RT${suffix}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const country = await resolveCountry();
  const { legalEntityId } = await createLegalEntityFixture({
    tenantId,
    country,
    suffix,
  });
  const accountId = await createPostingAccountFixture({ tenantId, legalEntityId, suffix });

  const systemAdminUserId = await createUser({
    tenantId,
    email: `pr73rt.system.${suffix}@example.test`,
    name: "PR73 Runtime System Admin",
  });
  const taxManagerUserId = await createUser({
    tenantId,
    email: `pr73rt.tax.${suffix}@example.test`,
    name: "PR73 Runtime Tax Manager",
  });
  const scopedTaxManagerUserId = await createUser({
    tenantId,
    email: `pr73rt.scoped-tax.${suffix}@example.test`,
    name: "PR73 Runtime Scoped Tax Manager",
  });
  const glOnlyUserId = await createUser({
    tenantId,
    email: `pr73rt.gl.${suffix}@example.test`,
    name: "PR73 Runtime GL Only",
  });
  const operationalUserId = await createUser({
    tenantId,
    email: `pr73rt.operational.${suffix}@example.test`,
    name: "PR73 Runtime Operational User",
  });

  await ensureRoleWithPermissions({
    tenantId,
    code: `PR73_GL_${suffix}`,
    name: "PR73 GL Only",
    permissionCodes: ["gl.account.read", "gl.account.upsert"],
  });
  await ensureRoleWithPermissions({
    tenantId,
    code: `PR73_OP_${suffix}`,
    name: "PR73 Operational Tax Lookup",
    permissionCodes: ["org.tree.read"],
  });

  await assignRoleScope({ tenantId, userId: systemAdminUserId, roleCode: "SystemAdmin" });
  await assignRoleScope({
    tenantId,
    userId: taxManagerUserId,
    roleCode: "TaxConfigurationManager",
  });
  await assignRoleScope({
    tenantId,
    userId: scopedTaxManagerUserId,
    roleCode: "TaxConfigurationManager",
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  });
  await assignRoleScope({
    tenantId,
    userId: glOnlyUserId,
    roleCode: `PR73_GL_${suffix}`,
  });
  await assignRoleScope({
    tenantId,
    userId: operationalUserId,
    roleCode: `PR73_OP_${suffix}`,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  });
  await invalidateRbacCache(tenantId);

  const systemRegime = await createRegimeAs({
    tenantId,
    userId: systemAdminUserId,
    input: {
      tenantId,
      userId: systemAdminUserId,
      countryId: country.id,
      code: `PR73SYS${suffix}`,
      name: "PR73 System Admin Tenant Regime",
      currencyCode: country.currencyCode,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  assertId(systemRegime.id, "SystemAdmin-created tax regime");

  const regime = await createRegimeAs({
    tenantId,
    userId: taxManagerUserId,
    input: {
      tenantId,
      userId: taxManagerUserId,
      countryId: country.id,
      legalEntityId,
      code: `PR73LE${suffix}`,
      name: "PR73 Legal Entity Tax Regime",
      currencyCode: country.currencyCode,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  const regimeId = assertId(regime.id, "TaxConfigurationManager-created regime");

  const taxCode = await createCodeAs({
    tenantId,
    userId: taxManagerUserId,
    input: {
      tenantId,
      regimeId,
      code: `VAT${suffix.slice(-6)}`,
      name: "PR73 VAT Output",
      taxKind: "VAT",
      ratePct: 20,
      calculationMode: "EXCLUSIVE",
      recoverability: "FULL",
      isReverseCharge: false,
      status: "ACTIVE",
    },
  });
  const taxCodeId = assertId(taxCode.id, "TaxConfigurationManager-created tax code");

  const taxRule = await createRuleAs({
    tenantId,
    userId: taxManagerUserId,
    input: {
      tenantId,
      regimeId,
      taxCodeId,
      moduleCode: "CARI",
      documentType: "INVOICE",
      counterpartyType: "CUSTOMER",
      applyPriority: 10,
      thresholdAmount: null,
      formulaJson: {
        type: "RATE",
        ratePct: 20,
        calculationMode: "EXCLUSIVE",
        recoverability: "FULL",
      },
      status: "ACTIVE",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    },
  });
  const taxRuleId = assertId(taxRule.id, "TaxConfigurationManager-created tax rule");

  const mapping = await createMappingAs({
    tenantId,
    userId: taxManagerUserId,
    input: {
      tenantId,
      regimeId,
      legalEntityId,
      taxCodeId,
      taxPurposeCode: "VAT_OUTPUT",
      accountId,
      status: "ACTIVE",
    },
  });
  assertId(mapping.id, "TaxConfigurationManager-created tax account mapping");

  await expectForbidden(
    () =>
      createRegimeAs({
        tenantId,
        userId: glOnlyUserId,
        input: {
          tenantId,
          userId: glOnlyUserId,
          countryId: country.id,
          legalEntityId,
          code: `PR73GL${suffix}`,
          name: "PR73 GL Only Blocked Regime",
          currencyCode: country.currencyCode,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          status: "ACTIVE",
        },
      }),
    "GL-only user saving tax setup",
    "Missing permission: tax.setup.upsert"
  );

  const scopedUpdate = await updateRegimeAs({
    tenantId,
    userId: scopedTaxManagerUserId,
    regimeId,
    input: {
      name: "PR73 Legal Entity Tax Regime - scoped update",
    },
  });
  assert.equal(
    scopedUpdate.name,
    "PR73 Legal Entity Tax Regime - scoped update",
    "LEGAL_ENTITY scoped TaxConfigurationManager should update legal-entity tax setup"
  );

  await expectForbidden(
    () =>
      createRegimeAs({
        tenantId,
        userId: scopedTaxManagerUserId,
        input: {
          tenantId,
          userId: scopedTaxManagerUserId,
          countryId: country.id,
          code: `PR73TEN${suffix}`,
          name: "PR73 Scoped Manager Blocked Tenant Regime",
          currencyCode: country.currencyCode,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          status: "ACTIVE",
        },
      }),
    "LEGAL_ENTITY scoped TaxConfigurationManager creating tenant-wide tax setup",
    "Data scope denied"
  );

  await expectForbidden(
    () =>
      updateRegimeAs({
        tenantId,
        userId: scopedTaxManagerUserId,
        regimeId,
        input: {
          legalEntityId: null,
        },
      }),
    "LEGAL_ENTITY scoped TaxConfigurationManager clearing legalEntityId",
    "Data scope denied"
  );

  const preview = await previewAs({
    tenantId,
    userId: operationalUserId,
    input: {
      tenantId,
      legalEntityId,
      countryId: country.id,
      postingDate: "2026-06-22",
      moduleCode: "CARI",
      documentType: "INVOICE",
      counterpartyType: "CUSTOMER",
      taxCodeId,
      taxPurposeCode: "VAT_OUTPUT",
      direction: "SALE",
      currencyCode: country.currencyCode,
      baseAmount: 100,
    },
  });
  assert.equal(assertId(preview.taxCode?.id, "preview tax code"), taxCodeId);
  assert.equal(Number(preview.breakdown?.taxAmount), 20);
  assert.equal(assertId(preview.mapping?.id, "preview mapping"), assertId(mapping.id, "mapping"));

  const rules = await listRulesAs({
    tenantId,
    userId: operationalUserId,
    filters: {
      tenantId,
      regimeId,
      moduleCode: "CARI",
      status: "ACTIVE",
      limit: 100,
      offset: 0,
    },
  });
  assert(
    (rules.rows || []).some((row) => toPositiveInt(row.id) === taxRuleId),
    "Operational org.tree.read users should still load tax rules for inventory tax category options"
  );

  console.log("test-security-pr73-tax-configuration-runtime passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
