import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import { assertScopeAccess } from "../src/middleware/rbac.js";
import { provisionBankAccountWith102Child } from "../src/services/bank.accounts.service.js";
import { executeIdempotentRequest } from "../src/services/idempotency.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function buildScopedReq({ legalEntityIds = [] } = {}) {
  return {
    rbac: {
      scopeContext: {
        tenantWide: false,
        groups: new Set(),
        countries: new Set(),
        legalEntities: new Set((legalEntityIds || []).map((id) => toInt(id)).filter(Boolean)),
        operatingUnits: new Set(),
      },
    },
  };
}

async function createProvisionFixture({ stamp }) {
  const tenantCode = `PRH10_T_${stamp}`;
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    tenantCode,
    `PRH10 Tenant ${stamp}`,
  ]);
  const tenantId = toInt(
    (
      await query(
        `SELECT id
         FROM tenants
         WHERE code = ?
         LIMIT 1`,
        [tenantCode]
      )
    ).rows?.[0]?.id
  );
  assert(tenantId > 0, "Failed to create tenant");

  const country = (
    await query(
      `SELECT id, default_currency_code
       FROM countries
       WHERE iso2 = 'TR'
       LIMIT 1`
    )
  ).rows?.[0];
  const countryId = toInt(country?.id);
  const currencyCode = String(country?.default_currency_code || "TRY");
  assert(countryId > 0, "Missing seeded country row for TR");

  const groupCode = `PRH10_G_${stamp}`;
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, groupCode, `PRH10 Group ${stamp}`]
  );
  const groupCompanyId = toInt(
    (
      await query(
        `SELECT id
         FROM group_companies
         WHERE tenant_id = ?
           AND code = ?
         LIMIT 1`,
        [tenantId, groupCode]
      )
    ).rows?.[0]?.id
  );
  assert(groupCompanyId > 0, "Failed to create group company");

  const legalEntityCode = `PRH10_LE_${stamp}`;
  await query(
    `INSERT INTO legal_entities (
        tenant_id, group_company_id, code, name, country_id, functional_currency_code, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, groupCompanyId, legalEntityCode, `PRH10 Legal Entity ${stamp}`, countryId, currencyCode]
  );
  const legalEntityId = toInt(
    (
      await query(
        `SELECT id
         FROM legal_entities
         WHERE tenant_id = ?
           AND code = ?
         LIMIT 1`,
        [tenantId, legalEntityCode]
      )
    ).rows?.[0]?.id
  );
  assert(legalEntityId > 0, "Failed to create legal entity");

  const passwordHash = await bcrypt.hash("PRH10#Smoke123", 10);
  const email = `prh10_${stamp}@example.com`;
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `PRH10 User ${stamp}`]
  );
  const userId = toInt(
    (
      await query(
        `SELECT id
         FROM users
         WHERE tenant_id = ?
           AND email = ?
         LIMIT 1`,
        [tenantId, email]
      )
    ).rows?.[0]?.id
  );
  assert(userId > 0, "Failed to create user");

  const coaCode = `PRH10_COA_${stamp}`;
  await query(
    `INSERT INTO charts_of_accounts (tenant_id, legal_entity_id, scope, code, name)
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, coaCode, `PRH10 CoA ${stamp}`]
  );
  const coaId = toInt(
    (
      await query(
        `SELECT id
         FROM charts_of_accounts
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND code = ?
         LIMIT 1`,
        [tenantId, legalEntityId, coaCode]
      )
    ).rows?.[0]?.id
  );
  assert(coaId > 0, "Failed to create legal-entity CoA");

  await query(
    `INSERT INTO accounts (
        coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id, is_active
      ) VALUES (?, '102', ?, 'ASSET', 'DEBIT', FALSE, NULL, TRUE)`,
    [coaId, `Bank Control 102 ${stamp}`]
  );
  const control102Id = toInt(
    (
      await query(
        `SELECT id
         FROM accounts
         WHERE coa_id = ?
           AND code = '102'
         LIMIT 1`,
        [coaId]
      )
    ).rows?.[0]?.id
  );
  assert(control102Id > 0, "Failed to create 102 control account");

  return {
    tenantId,
    legalEntityId,
    userId,
    currencyCode,
    coaId,
    control102Id,
  };
}

async function count102Children({ control102Id }) {
  const result = await query(
    `SELECT COUNT(*) AS total
     FROM accounts
     WHERE parent_account_id = ?`,
    [control102Id]
  );
  return toInt(result.rows?.[0]?.total, 0);
}

async function main() {
  await seedCore();

  const stamp = Date.now();
  const fixture = await createProvisionFixture({ stamp });
  const req = buildScopedReq({ legalEntityIds: [fixture.legalEntityId] });

  const first = await provisionBankAccountWith102Child({
    req,
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: null,
      code: `PRH10_BANK_MAIN_${stamp}`,
      name: `PRH10 Main Bank ${stamp}`,
      currencyCode: fixture.currencyCode,
      bankName: "PRH10 Bank",
      branchName: "Main",
      iban: `TR${String(stamp).slice(-16).padStart(16, "0")}`,
      accountNo: `PRH10-MAIN-${stamp}`,
      isActive: true,
      glAccountName: `PRH10 Main GL ${stamp}`,
    },
    assertScopeAccess,
  });
  assert(toInt(first?.row?.id) > 0, "Provision should create bank account row");
  assert(toInt(first?.glAccount?.id) > 0, "Provision should create child GL account");
  assert(
    String(first?.glAccount?.code || "").startsWith("102."),
    "Provisioned GL account code should be under 102 subtree"
  );

  const afterFirstCount = await count102Children({ control102Id: fixture.control102Id });
  assert(afterFirstCount === 1, `Expected 1 child under 102 after first provisioning, got ${afterFirstCount}`);

  const idempotencyPayload = {
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    legalEntityId: fixture.legalEntityId,
    operatingUnitId: null,
    code: `PRH10_BANK_IDEM_${stamp}`,
    name: `PRH10 Idem Bank ${stamp}`,
    currencyCode: fixture.currencyCode,
    bankName: "PRH10 Bank",
    branchName: "Idem",
    iban: `TR${String(stamp + 11).slice(-16).padStart(16, "0")}`,
    accountNo: `PRH10-IDEM-${stamp}`,
    isActive: true,
    glAccountName: `PRH10 Idem GL ${stamp}`,
  };
  const idemScope = `BANK_PROVISION_102_T${fixture.tenantId}_LE${fixture.legalEntityId}`;
  const idemKey = `PRH10-IDEM-${stamp}`;

  const idemFirst = await executeIdempotentRequest({
    scopeCode: idemScope,
    idempotencyKey: idemKey,
    requestFingerprintInput: idempotencyPayload,
    execute: async () => ({
      status: 201,
      payload: await provisionBankAccountWith102Child({
        req,
        payload: idempotencyPayload,
        assertScopeAccess,
      }),
    }),
  });
  assert(!idemFirst.idempotentReplay, "First idempotent call should not be replay");

  const childCountAfterIdemFirst = await count102Children({ control102Id: fixture.control102Id });
  assert(
    childCountAfterIdemFirst === 2,
    `Expected 2 children under 102 after first idempotent execution, got ${childCountAfterIdemFirst}`
  );

  const idemSecond = await executeIdempotentRequest({
    scopeCode: idemScope,
    idempotencyKey: idemKey,
    requestFingerprintInput: idempotencyPayload,
    execute: async () => ({
      status: 201,
      payload: await provisionBankAccountWith102Child({
        req,
        payload: idempotencyPayload,
        assertScopeAccess,
      }),
    }),
  });
  assert(idemSecond.idempotentReplay, "Second idempotent call should be replayed");
  assert(
    toInt(idemSecond.payload?.row?.id) === toInt(idemFirst.payload?.row?.id),
    "Idempotent replay should return the original provisioned bank account"
  );
  const childCountAfterIdemReplay = await count102Children({ control102Id: fixture.control102Id });
  assert(
    childCountAfterIdemReplay === 2,
    `Idempotent replay must not create new children under 102 (got ${childCountAfterIdemReplay})`
  );

  await query(
    `INSERT INTO accounts (
        coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id, is_active
      ) VALUES (?, ?, ?, 'ASSET', 'DEBIT', TRUE, ?, TRUE)`,
    [fixture.coaId, "102.900", `PRH10 Existing Child ${stamp}`, fixture.control102Id]
  );
  const duplicateGl = toInt(
    (
      await query(
        `SELECT id
         FROM accounts
         WHERE coa_id = ?
           AND code = '102.900'
         LIMIT 1`,
        [fixture.coaId]
      )
    ).rows?.[0]?.id
  );
  assert(duplicateGl > 0, "Failed to prepare existing duplicate bank fixture");

  const duplicateBankCode = `PRH10_BANK_DUP_${stamp}`;
  await query(
    `INSERT INTO bank_accounts (
        tenant_id, legal_entity_id, code, name, currency_code, gl_account_id,
        bank_name, branch_name, iban, account_no, is_active, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
    [
      fixture.tenantId,
      fixture.legalEntityId,
      duplicateBankCode,
      `PRH10 Duplicate Seed ${stamp}`,
      fixture.currencyCode,
      duplicateGl,
      "PRH10 Seed Bank",
      "Seed",
      `TR${String(stamp + 22).slice(-16).padStart(16, "0")}`,
      `PRH10-DUP-SEED-${stamp}`,
      fixture.userId,
    ]
  );

  const childCountBeforeRollback = await count102Children({ control102Id: fixture.control102Id });
  let rollbackFailureSeen = false;
  try {
    await provisionBankAccountWith102Child({
      req,
      payload: {
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        legalEntityId: fixture.legalEntityId,
        operatingUnitId: null,
        code: duplicateBankCode,
        name: `PRH10 Duplicate Attempt ${stamp}`,
        currencyCode: fixture.currencyCode,
        bankName: "PRH10 Rollback",
        branchName: "Rollback",
        iban: `TR${String(stamp + 33).slice(-16).padStart(16, "0")}`,
        accountNo: `PRH10-DUP-ATTEMPT-${stamp}`,
        isActive: true,
        glAccountName: `PRH10 Rollback GL ${stamp}`,
      },
      assertScopeAccess,
    });
  } catch (err) {
    rollbackFailureSeen = true;
    assert(
      String(err?.message || "").toLowerCase().includes("unique"),
      `Expected duplicate/unique failure, got: ${String(err?.message || "")}`
    );
  }
  assert(rollbackFailureSeen, "Duplicate bank code should fail provisioning");

  const childCountAfterRollback = await count102Children({ control102Id: fixture.control102Id });
  assert(
    childCountAfterRollback === childCountBeforeRollback,
    "Failed provisioning should roll back and not leave orphan 102 child account"
  );

  console.log(
    "PR-H10 smoke test passed (one-click 102 provisioning + idempotent replay + rollback safety)."
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
