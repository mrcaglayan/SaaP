import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.BANK_CONTROL_BPM01_TEST_PORT || 3141);
const BASE_URL =
  process.env.BANK_CONTROL_BPM01_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_PASSWORD = "BankControlBpm01#123";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function apiRequest({
  token,
  method = "GET",
  path,
  body,
  expectedStatus,
}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Cookie = token;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  const setCookieHeader = response.headers.get("set-cookie");
  const cookie = setCookieHeader
    ? String(setCookieHeader).split(";")[0].trim()
    : null;

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        json
      )}`
    );
  }

  return { status: response.status, json, cookie };
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  return child;
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // wait for startup
    }
    await sleep(300);
  }
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function stopServerProcess(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3_000),
  ]);
}

async function login(email, password) {
  const response = await apiRequest({
    method: "POST",
    path: "/auth/login",
    body: { email, password },
    expectedStatus: 200,
  });
  assert(Boolean(response.cookie), `Login cookie missing for ${email}`);
  return response.cookie;
}

async function createTenant(code, name) {
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [code, name]
  );
  const result = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [code]
  );
  const tenantId = toNumber(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to resolve tenant id for ${code}`);
  return tenantId;
}

async function resolveRoleId(tenantId, roleCode) {
  const result = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = toNumber(result.rows?.[0]?.id);
  assert(roleId > 0, `Role not found: ${roleCode}`);
  return roleId;
}

async function createUserWithRole({
  tenantId,
  roleCode,
  email,
  passwordHash,
  name,
}) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
  );
  const userResult = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  const userId = toNumber(userResult.rows?.[0]?.id);
  assert(userId > 0, `Failed to resolve user id for ${email}`);

  const roleId = await resolveRoleId(tenantId, roleCode);
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
     )
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE effect = VALUES(effect)`,
    [tenantId, userId, roleId, tenantId]
  );

  return { userId, email };
}

async function getCountryIdByIso2(iso2) {
  const result = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = ?
     LIMIT 1`,
    [toUpper(iso2)]
  );
  const countryId = toNumber(result.rows?.[0]?.id);
  assert(countryId > 0, `Country not found: ${iso2}`);
  return countryId;
}

async function createFixtureData(tenantId, stamp) {
  const countryId = await getCountryIdByIso2("US");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `GRP_BPM01_${stamp}`, `Group BPM01 ${stamp}`]
  );
  const groupCompanyResult = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `GRP_BPM01_${stamp}`]
  );
  const groupCompanyId = toNumber(groupCompanyResult.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create group company");

  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
     )
     VALUES (?, ?, ?, ?, ?, 'USD'), (?, ?, ?, ?, ?, 'USD')`,
    [
      tenantId,
      groupCompanyId,
      `LE_A_BPM01_${stamp}`,
      `Legal Entity A BPM01 ${stamp}`,
      countryId,
      tenantId,
      groupCompanyId,
      `LE_B_BPM01_${stamp}`,
      `Legal Entity B BPM01 ${stamp}`,
      countryId,
    ]
  );
  const legalEntityRows = await query(
    `SELECT id, code
     FROM legal_entities
     WHERE tenant_id = ?
       AND code IN (?, ?)`,
    [tenantId, `LE_A_BPM01_${stamp}`, `LE_B_BPM01_${stamp}`]
  );
  const legalEntityIdByCode = new Map(
    (legalEntityRows.rows || []).map((row) => [String(row.code), toNumber(row.id)])
  );
  const legalEntityAId = legalEntityIdByCode.get(`LE_A_BPM01_${stamp}`);
  const legalEntityBId = legalEntityIdByCode.get(`LE_B_BPM01_${stamp}`);
  assert(legalEntityAId > 0, "Failed to create legalEntityA");
  assert(legalEntityBId > 0, "Failed to create legalEntityB");

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
     )
     VALUES
       (?, ?, 'LEGAL_ENTITY', ?, ?),
       (?, ?, 'LEGAL_ENTITY', ?, ?),
       (?, NULL, 'GROUP', ?, ?)`,
    [
      tenantId,
      legalEntityAId,
      `COA_A_BPM01_${stamp}`,
      `COA A BPM01 ${stamp}`,
      tenantId,
      legalEntityBId,
      `COA_B_BPM01_${stamp}`,
      `COA B BPM01 ${stamp}`,
      tenantId,
      `COA_G_BPM01_${stamp}`,
      `COA G BPM01 ${stamp}`,
    ]
  );
  const coaRows = await query(
    `SELECT id, code
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code IN (?, ?, ?)`,
    [
      tenantId,
      `COA_A_BPM01_${stamp}`,
      `COA_B_BPM01_${stamp}`,
      `COA_G_BPM01_${stamp}`,
    ]
  );
  const coaIdByCode = new Map(
    (coaRows.rows || []).map((row) => [String(row.code), toNumber(row.id)])
  );
  const coaAId = coaIdByCode.get(`COA_A_BPM01_${stamp}`);
  const coaBId = coaIdByCode.get(`COA_B_BPM01_${stamp}`);
  const coaGroupId = coaIdByCode.get(`COA_G_BPM01_${stamp}`);
  assert(coaAId > 0, "Failed to create coaA");
  assert(coaBId > 0, "Failed to create coaB");
  assert(coaGroupId > 0, "Failed to create group coa");

  await query(
    `INSERT INTO accounts (
        coa_id,
        code,
        name,
        account_type,
        normal_side,
        allow_posting,
        parent_account_id
     )
     VALUES
       (?, ?, ?, 'ASSET', 'DEBIT', FALSE, NULL),
       (?, ?, ?, 'LIABILITY', 'CREDIT', FALSE, NULL),
       (?, ?, ?, 'ASSET', 'DEBIT', FALSE, NULL),
       (?, ?, ?, 'ASSET', 'DEBIT', TRUE, NULL),
       (?, ?, ?, 'ASSET', 'DEBIT', FALSE, NULL),
       (?, ?, ?, 'ASSET', 'DEBIT', FALSE, NULL)`,
    [
      coaAId,
      `1020_${stamp}`,
      `Bank Control Parent ${stamp}`,
      coaAId,
      `3000_${stamp}`,
      `Wrong Type Liability ${stamp}`,
      coaAId,
      `1021_${stamp}`,
      `Inactive Asset Parent ${stamp}`,
      coaAId,
      `1200_${stamp}`,
      `Postable Asset ${stamp}`,
      coaBId,
      `2020_${stamp}`,
      `Other Entity Parent ${stamp}`,
      coaGroupId,
      `9020_${stamp}`,
      `Group Scope Parent ${stamp}`,
    ]
  );
  await query(
    `UPDATE accounts
     SET is_active = FALSE
     WHERE coa_id = ?
       AND code = ?`,
    [coaAId, `1021_${stamp}`]
  );
  const accountRows = await query(
    `SELECT a.id, a.code
     FROM accounts a
     WHERE a.coa_id IN (?, ?, ?)
       AND a.code IN (?, ?, ?, ?, ?, ?)`,
    [
      coaAId,
      coaBId,
      coaGroupId,
      `1020_${stamp}`,
      `3000_${stamp}`,
      `1021_${stamp}`,
      `1200_${stamp}`,
      `2020_${stamp}`,
      `9020_${stamp}`,
    ]
  );
  const accountIdByCode = new Map(
    (accountRows.rows || []).map((row) => [String(row.code), toNumber(row.id)])
  );

  return {
    legalEntityAId,
    bankControlParentAccountId: accountIdByCode.get(`1020_${stamp}`),
    wrongTypeLiabilityAccountId: accountIdByCode.get(`3000_${stamp}`),
    inactiveAssetAccountId: accountIdByCode.get(`1021_${stamp}`),
    validPostableAssetAccountId: accountIdByCode.get(`1200_${stamp}`),
    otherEntityParentAccountId: accountIdByCode.get(`2020_${stamp}`),
    groupScopeParentAccountId: accountIdByCode.get(`9020_${stamp}`),
  };
}

function findPurposeRow(rows, purposeCode) {
  return (rows || []).find(
    (row) => toUpper(row?.purposeCode) === toUpper(purposeCode)
  );
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant(
    `BANK_BPM01_${stamp}`,
    `Bank BPM01 ${stamp}`
  );
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const adminUser = await createUserWithRole({
    tenantId,
    roleCode: "TenantAdmin",
    email: `bank_bpm01_admin_${stamp}@example.com`,
    passwordHash,
    name: "Bank BPM01 Admin",
  });
  const fixture = await createFixtureData(tenantId, stamp);

  let server = null;
  try {
    server = startServerProcess();
    await waitForServer();

    const adminToken = await login(adminUser.email, TEST_PASSWORD);

    const initialBankList = await apiRequest({
      token: adminToken,
      method: "GET",
      path: `/api/v1/gl/journal-purpose-accounts?legalEntityId=${fixture.legalEntityAId}&moduleKey=BANK`,
      expectedStatus: 200,
    });
    assert(
      Array.isArray(initialBankList.json?.rows) &&
        initialBankList.json.rows.length === 1,
      "Initial BANK list must include exactly one purpose row"
    );
    const initialBankRow = findPurposeRow(
      initialBankList.json?.rows,
      "BANK_CONTROL_PARENT"
    );
    assert(Boolean(initialBankRow), "BANK_CONTROL_PARENT row must exist");
    assert(
      initialBankRow?.purposeValidationProfile === "BANK_CONTROL_PARENT",
      "BANK_CONTROL_PARENT must use BANK_CONTROL_PARENT validation profile"
    );
    assert(
      initialBankRow?.accountId === null &&
        initialBankRow?.validForBankControlParent === false &&
        initialBankRow?.validForPurposeMapping === false,
      "Initial BANK_CONTROL_PARENT row must be empty and invalid"
    );

    const bankUpsert = await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: fixture.legalEntityAId,
        moduleKey: "BANK",
        purposeCode: "BANK_CONTROL_PARENT",
        accountId: fixture.bankControlParentAccountId,
      },
      expectedStatus: 201,
    });
    assert(bankUpsert.json?.ok === true, "Valid BANK upsert must return ok=true");
    assert(
      toNumber(bankUpsert.json?.row?.accountId) === fixture.bankControlParentAccountId,
      "BANK_CONTROL_PARENT must map to selected non-postable asset parent"
    );
    assert(
      bankUpsert.json?.row?.validForBankControlParent === true &&
        bankUpsert.json?.row?.validForPurposeMapping === true,
      "Non-postable ASSET parent must be valid for BANK control-parent mapping"
    );
    assert(
      bankUpsert.json?.row?.validForPurposePosting === false,
      "Non-postable ASSET parent must remain invalid for generic postable-purpose posting"
    );

    const afterBankUpsertList = await apiRequest({
      token: adminToken,
      method: "GET",
      path: `/api/v1/gl/journal-purpose-accounts?legalEntityId=${fixture.legalEntityAId}&moduleKey=BANK`,
      expectedStatus: 200,
    });
    const persistedBankRow = findPurposeRow(
      afterBankUpsertList.json?.rows,
      "BANK_CONTROL_PARENT"
    );
    assert(
      toNumber(persistedBankRow?.accountId) === fixture.bankControlParentAccountId,
      "Persisted BANK_CONTROL_PARENT row must return the mapped account"
    );

    await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: fixture.legalEntityAId,
        moduleKey: "BANK",
        purposeCode: "BANK_CONTROL_PARENT",
        accountId: fixture.wrongTypeLiabilityAccountId,
      },
      expectedStatus: 400,
    });
    await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: fixture.legalEntityAId,
        moduleKey: "BANK",
        purposeCode: "BANK_CONTROL_PARENT",
        accountId: fixture.inactiveAssetAccountId,
      },
      expectedStatus: 400,
    });
    await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: fixture.legalEntityAId,
        moduleKey: "BANK",
        purposeCode: "BANK_CONTROL_PARENT",
        accountId: fixture.otherEntityParentAccountId,
      },
      expectedStatus: 400,
    });
    await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: fixture.legalEntityAId,
        moduleKey: "BANK",
        purposeCode: "BANK_CONTROL_PARENT",
        accountId: fixture.groupScopeParentAccountId,
      },
      expectedStatus: 400,
    });

    await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: fixture.legalEntityAId,
        moduleKey: "CARI",
        purposeCode: "CARI_AR_CONTROL",
        accountId: fixture.bankControlParentAccountId,
      },
      expectedStatus: 400,
    });
    const cariUpsert = await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: fixture.legalEntityAId,
        moduleKey: "CARI",
        purposeCode: "CARI_AR_CONTROL",
        accountId: fixture.validPostableAssetAccountId,
      },
      expectedStatus: 201,
    });
    assert(
      cariUpsert.json?.row?.validForPurposePosting === true &&
        cariUpsert.json?.row?.validForCariPosting === true,
      "Legacy postable-purpose validation must remain intact for CARI"
    );

    console.log("test-bank-control-bpm01-purpose-mapping: OK");
  } finally {
    await stopServerProcess(server);
    await closePool();
  }
}

main().catch((error) => {
  console.error("test-bank-control-bpm01-purpose-mapping: FAILED");
  console.error(error);
  process.exit(1);
});
