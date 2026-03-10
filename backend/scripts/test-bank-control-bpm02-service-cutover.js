import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import { assertScopeAccess } from "../src/middleware/rbac.js";
import {
  createBankAccount,
  provisionBankAccountWithControlParentChild,
} from "../src/services/bank.accounts.service.js";

const FEATURE_SUBACCOUNTS_V1 = "FEATURE_SUBACCOUNTS_V1";

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

async function createFixture({ stamp }) {
  const tenantCode = `BPM02_T_${stamp}`;
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    tenantCode,
    `BPM02 Tenant ${stamp}`,
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
       WHERE iso2 = 'US'
       LIMIT 1`
    )
  ).rows?.[0];
  const countryId = toInt(country?.id);
  const currencyCode = String(country?.default_currency_code || "USD")
    .trim()
    .toUpperCase();
  assert(countryId > 0, "Missing seeded country row for US");

  const groupCode = `BPM02_G_${stamp}`;
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, groupCode, `BPM02 Group ${stamp}`]
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

  const legalEntityCode = `BPM02_LE_${stamp}`;
  await query(
    `INSERT INTO legal_entities (
        tenant_id, group_company_id, code, name, country_id, functional_currency_code, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, groupCompanyId, legalEntityCode, `BPM02 Legal Entity ${stamp}`, countryId, currencyCode]
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

  const passwordHash = await bcrypt.hash("BPM02#Smoke123", 10);
  const email = `bpm02_${stamp}@example.com`;
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `BPM02 User ${stamp}`]
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

  await query(
    `INSERT INTO tenant_features (
        tenant_id,
        feature_code,
        is_enabled,
        updated_by_user_id
      ) VALUES (?, ?, 1, ?)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled),
        updated_by_user_id = VALUES(updated_by_user_id),
        updated_at = CURRENT_TIMESTAMP`,
    [tenantId, FEATURE_SUBACCOUNTS_V1, userId]
  );

  const coaCode = `BPM02_COA_${stamp}`;
  await query(
    `INSERT INTO charts_of_accounts (tenant_id, legal_entity_id, scope, code, name)
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, coaCode, `BPM02 CoA ${stamp}`]
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
      ) VALUES
        (?, '1000', ?, 'ASSET', 'DEBIT', FALSE, NULL, TRUE),
        (?, '1000.001', ?, 'ASSET', 'DEBIT', TRUE, NULL, TRUE),
        (?, '1200', ?, 'ASSET', 'DEBIT', TRUE, NULL, TRUE),
        (?, '1100', ?, 'ASSET', 'DEBIT', TRUE, NULL, TRUE)`,
    [
      coaId,
      `BPM02 Bank Parent ${stamp}`,
      coaId,
      `BPM02 Existing Bank Child ${stamp}`,
      coaId,
      `BPM02 Outside Asset ${stamp}`,
      coaId,
      `BPM02 Postable Parent ${stamp}`,
    ]
  );

  const accountRows = await query(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?
       AND code IN ('1000', '1000.001', '1200', '1100')`,
    [coaId]
  );
  const accountIdByCode = new Map(
    (accountRows.rows || []).map((row) => [String(row.code), toInt(row.id)])
  );
  const mappedParentId = accountIdByCode.get("1000");
  const existingChildId = accountIdByCode.get("1000.001");
  const outsideLeafId = accountIdByCode.get("1200");
  const directParentOnlyId = accountIdByCode.get("1100");
  assert(mappedParentId > 0, "Failed to create mapped parent account");
  assert(existingChildId > 0, "Failed to create mapped child account");
  assert(outsideLeafId > 0, "Failed to create outside leaf account");
  assert(directParentOnlyId > 0, "Failed to create direct parent-only account");

  await query(
    `UPDATE accounts
     SET parent_account_id = ?
     WHERE id = ?`,
    [mappedParentId, existingChildId]
  );

  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
      ) VALUES (?, ?, 'BANK_CONTROL_PARENT', ?)
      ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), updated_at = CURRENT_TIMESTAMP`,
    [tenantId, legalEntityId, mappedParentId]
  );

  return {
    tenantId,
    legalEntityId,
    userId,
    currencyCode,
    coaId,
    mappedParentId,
    existingChildId,
    outsideLeafId,
    directParentOnlyId,
  };
}

async function main() {
  await seedCore();

  const stamp = Date.now();
  const fixture = await createFixture({ stamp });
  const req = buildScopedReq({ legalEntityIds: [fixture.legalEntityId] });

  const manualOk = await createBankAccount({
    req,
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: null,
      code: `BPM02_BANK_MANUAL_OK_${stamp}`,
      name: `BPM02 Manual OK ${stamp}`,
      currencyCode: fixture.currencyCode,
      glAccountId: fixture.existingChildId,
      bankName: "BPM02 Bank",
      branchName: "Manual",
      iban: null,
      accountNo: `BPM02-MANUAL-OK-${stamp}`,
      isActive: true,
    },
    assertScopeAccess,
  });
  assert(toInt(manualOk?.id) > 0, "Manual bank create should succeed under mapped parent");
  assert(
    toInt(manualOk?.gl_account_id) === fixture.existingChildId,
    "Manual bank create should preserve the mapped child GL account"
  );

  let subtreeFailure = false;
  try {
    await createBankAccount({
      req,
      payload: {
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        legalEntityId: fixture.legalEntityId,
        operatingUnitId: null,
        code: `BPM02_BANK_OUTSIDE_${stamp}`,
        name: `BPM02 Outside ${stamp}`,
        currencyCode: fixture.currencyCode,
        glAccountId: fixture.outsideLeafId,
        bankName: "BPM02 Bank",
        branchName: "Outside",
        iban: null,
        accountNo: `BPM02-OUTSIDE-${stamp}`,
        isActive: true,
      },
      assertScopeAccess,
    });
  } catch (err) {
    subtreeFailure = true;
    assert(
      String(err?.message || "").includes("BANK_CONTROL_PARENT"),
      `Expected BANK_CONTROL_PARENT subtree failure, got: ${String(err?.message || "")}`
    );
  }
  assert(subtreeFailure, "Leaf outside mapped parent should fail strict validation");

  const provisioned = await provisionBankAccountWithControlParentChild({
    req,
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: null,
      code: `BPM02_BANK_PROV_${stamp}`,
      name: `BPM02 Provisioned ${stamp}`,
      currencyCode: fixture.currencyCode,
      bankName: "BPM02 Bank",
      branchName: "Provisioned",
      iban: null,
      accountNo: `BPM02-PROV-${stamp}`,
      isActive: true,
      glAccountName: `BPM02 Provisioned GL ${stamp}`,
    },
    assertScopeAccess,
  });
  assert(toInt(provisioned?.row?.id) > 0, "Provisioning should create bank account row");
  assert(toInt(provisioned?.glAccount?.id) > 0, "Provisioning should create child GL account");
  assert(
    String(provisioned?.glAccount?.code || "").startsWith("1000."),
    `Provisioned GL account must be allocated under mapped parent 1000 (got ${String(
      provisioned?.glAccount?.code || ""
    )})`
  );
  assert(
    String(provisioned?.glAccount?.parentAccountCode || "") === "1000",
    "Provisioning response must expose mapped parent code, not literal 102"
  );

  await query(
    `UPDATE journal_purpose_accounts
     SET account_id = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND purpose_code = 'BANK_CONTROL_PARENT'`,
    [fixture.directParentOnlyId, fixture.tenantId, fixture.legalEntityId]
  );

  let directParentFailure = false;
  try {
    await createBankAccount({
      req,
      payload: {
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        legalEntityId: fixture.legalEntityId,
        operatingUnitId: null,
        code: `BPM02_BANK_PARENT_${stamp}`,
        name: `BPM02 Parent Direct ${stamp}`,
        currencyCode: fixture.currencyCode,
        glAccountId: fixture.directParentOnlyId,
        bankName: "BPM02 Bank",
        branchName: "Parent",
        iban: null,
        accountNo: `BPM02-PARENT-${stamp}`,
        isActive: true,
      },
      assertScopeAccess,
    });
  } catch (err) {
    directParentFailure = true;
    assert(
      String(err?.message || "").includes("postable leaf descendant under BANK_CONTROL_PARENT"),
      `Expected direct parent rejection, got: ${String(err?.message || "")}`
    );
  }
  assert(directParentFailure, "Mapped parent itself must not be linkable as bank GL account");

  await query(
    `DELETE FROM journal_purpose_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND purpose_code = 'BANK_CONTROL_PARENT'`,
    [fixture.tenantId, fixture.legalEntityId]
  );

  let missingMappingFailure = false;
  try {
    await createBankAccount({
      req,
      payload: {
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        legalEntityId: fixture.legalEntityId,
        operatingUnitId: null,
        code: `BPM02_BANK_MISSING_${stamp}`,
        name: `BPM02 Missing Mapping ${stamp}`,
        currencyCode: fixture.currencyCode,
        glAccountId: fixture.existingChildId,
        bankName: "BPM02 Bank",
        branchName: "Missing",
        iban: null,
        accountNo: `BPM02-MISSING-${stamp}`,
        isActive: true,
      },
      assertScopeAccess,
    });
  } catch (err) {
    missingMappingFailure = true;
    assert(
      String(err?.message || "").includes("BANK_CONTROL_PARENT purpose mapping is missing"),
      `Expected missing BANK_CONTROL_PARENT failure, got: ${String(err?.message || "")}`
    );
  }
  assert(missingMappingFailure, "Strict bank setup must fail when BANK_CONTROL_PARENT is missing");

  console.log(
    "test-bank-control-bpm02-service-cutover: OK"
  );
}

main()
  .catch((error) => {
    console.error("test-bank-control-bpm02-service-cutover: FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
