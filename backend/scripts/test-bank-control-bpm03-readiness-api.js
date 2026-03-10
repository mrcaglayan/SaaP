import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import { seedAndCreateTenantAdmin } from "./ex05-test-helpers.js";

const PORT = Number(process.env.BPM03_TEST_PORT || 3144);
const BASE_URL = process.env.BPM03_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_PASSWORD = "Bpm03#Readiness123";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function apiRequest({
  token,
  method = "GET",
  path: requestPath,
  body,
  expectedStatus,
}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Cookie = token;
  }

  const response = await fetch(`${BASE_URL}${requestPath}`, {
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

  const cookieHeader = response.headers.get("set-cookie");
  const cookie = cookieHeader ? String(cookieHeader).split(";")[0].trim() : null;

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${requestPath} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        json
      )}`
    );
  }

  return {
    status: response.status,
    json,
    cookie,
  };
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: BACKEND_ROOT,
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

async function createLegalEntityFixture({
  tenantId,
  groupCompanyId,
  code,
  name,
  countryId,
  currencyCode,
  assetParentCode,
  liabilityCode,
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
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, groupCompanyId, code, name, countryId, currencyCode]
  );
  const legalEntityId = toNumber(
    (
      await query(
        `SELECT id
         FROM legal_entities
         WHERE tenant_id = ?
           AND code = ?
         LIMIT 1`,
        [tenantId, code]
      )
    ).rows?.[0]?.id
  );
  assert(legalEntityId > 0, `Failed to create legal entity ${code}`);

  await query(
    `INSERT INTO charts_of_accounts (tenant_id, legal_entity_id, scope, code, name)
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `${code}_COA`, `${name} CoA`]
  );
  const coaId = toNumber(
    (
      await query(
        `SELECT id
         FROM charts_of_accounts
         WHERE tenant_id = ?
           AND legal_entity_id = ?
         LIMIT 1`,
        [tenantId, legalEntityId]
      )
    ).rows?.[0]?.id
  );
  assert(coaId > 0, `Failed to create CoA for ${code}`);

  await query(
    `INSERT INTO accounts (
        coa_id,
        code,
        name,
        account_type,
        normal_side,
        allow_posting,
        parent_account_id,
        is_active
      ) VALUES
        (?, ?, ?, 'ASSET', 'DEBIT', FALSE, NULL, TRUE),
        (?, ?, ?, 'LIABILITY', 'CREDIT', FALSE, NULL, TRUE)`,
    [
      coaId,
      assetParentCode,
      `${name} Bank Control Parent`,
      coaId,
      liabilityCode,
      `${name} Liability Parent`,
    ]
  );

  const accountRows = await query(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?
       AND code IN (?, ?)`,
    [coaId, assetParentCode, liabilityCode]
  );
  const accountIdByCode = new Map(
    (accountRows.rows || []).map((row) => [String(row.code || ""), toNumber(row.id)])
  );

  return {
    legalEntityId,
    assetParentId: accountIdByCode.get(assetParentCode),
    liabilityAccountId: accountIdByCode.get(liabilityCode),
  };
}

function findModuleRow(payload, moduleKey, legalEntityId) {
  return (
    payload?.modules?.[moduleKey]?.byLegalEntity?.find(
      (row) => Number(row?.legalEntityId) === Number(legalEntityId)
    ) || null
  );
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `BPM03_T_${stamp}`;
  const adminEmail = `bpm03_admin_${stamp}@example.com`;
  const root = path.resolve(SCRIPT_DIR, "..", "..");

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/bank.accounts.routes.js"),
    "utf8"
  );
  assert(
    routeSource.includes('"/provision-control-parent-child"') &&
      !routeSource.includes('"/provision-102-child"') &&
      routeSource.includes("BANK_PROVISION_CONTROL_PARENT_CHILD"),
    "Bank accounts route must expose only the neutral provisioning path and use neutral idempotency scope naming"
  );

  const openapiSource = await readFile(path.resolve(root, "backend/openapi.yaml"), "utf8");
  assert(
    openapiSource.includes('"/api/v1/bank/accounts/provision-control-parent-child"') &&
      openapiSource.includes(
        '"operationId": "provisionBankAccountControlParentChild"'
      ) &&
      openapiSource.includes(
        "#/components/schemas/BankAccountProvisionControlParentChildResponse"
      ) &&
      !openapiSource.includes('"/api/v1/bank/accounts/provision-102-child"'),
    "OpenAPI must advertise the neutral control-parent provisioning contract only"
  );

  const identity = await seedAndCreateTenantAdmin({
    tenantCode,
    tenantName: `BPM03 Tenant ${stamp}`,
    adminEmail,
    adminPassword: TEST_PASSWORD,
  });

  const tenantId = toNumber(identity.tenantId);
  assert(tenantId > 0, "Failed to create tenant admin identity");

  const countryRow = (
    await query(
      `SELECT id, default_currency_code
       FROM countries
       WHERE iso2 = 'US'
       LIMIT 1`
    )
  ).rows?.[0];
  const countryId = toNumber(countryRow?.id);
  const currencyCode = String(countryRow?.default_currency_code || "USD")
    .trim()
    .toUpperCase();
  assert(countryId > 0, "Missing US country seed");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `BPM03_G_${stamp}`, `BPM03 Group ${stamp}`]
  );
  const groupCompanyId = toNumber(
    (
      await query(
        `SELECT id
         FROM group_companies
         WHERE tenant_id = ?
         LIMIT 1`,
        [tenantId]
      )
    ).rows?.[0]?.id
  );
  assert(groupCompanyId > 0, "Failed to create group company");

  const readyFixture = await createLegalEntityFixture({
    tenantId,
    groupCompanyId,
    code: `BPM03_READY_${stamp}`,
    name: `BPM03 Ready ${stamp}`,
    countryId,
    currencyCode,
    assetParentCode: "1000",
    liabilityCode: "2000",
  });
  const missingFixture = await createLegalEntityFixture({
    tenantId,
    groupCompanyId,
    code: `BPM03_MISSING_${stamp}`,
    name: `BPM03 Missing ${stamp}`,
    countryId,
    currencyCode,
    assetParentCode: "1100",
    liabilityCode: "2100",
  });

  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
      ) VALUES (?, ?, 'BANK_CONTROL_PARENT', ?)
      ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), updated_at = CURRENT_TIMESTAMP`,
    [tenantId, readyFixture.legalEntityId, readyFixture.assetParentId]
  );

  const server = startServerProcess();
  try {
    await waitForServer();
    const token = await login(adminEmail, TEST_PASSWORD);

    const initialGlobal = await apiRequest({
      token,
      method: "GET",
      path: "/api/v1/onboarding/module-readiness",
      expectedStatus: 200,
    });
    const readyRow = findModuleRow(
      initialGlobal.json,
      "bankControlParent",
      readyFixture.legalEntityId
    );
    const missingRow = findModuleRow(
      initialGlobal.json,
      "bankControlParent",
      missingFixture.legalEntityId
    );
    assert(readyRow?.ready === true, "Ready legal entity should report bankControlParent ready");
    assert(
      missingRow?.ready === false,
      "Missing legal entity should report bankControlParent not ready"
    );
    assert(
      Array.isArray(missingRow?.missingPurposeCodes) &&
        missingRow.missingPurposeCodes.includes("BANK_CONTROL_PARENT"),
      "Missing legal entity must list BANK_CONTROL_PARENT as a blocker"
    );

    await query(
      `INSERT INTO journal_purpose_accounts (
          tenant_id,
          legal_entity_id,
          purpose_code,
          account_id
        ) VALUES (?, ?, 'BANK_CONTROL_PARENT', ?)
        ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), updated_at = CURRENT_TIMESTAMP`,
      [tenantId, missingFixture.legalEntityId, missingFixture.liabilityAccountId]
    );

    const invalidReadiness = await apiRequest({
      token,
      method: "GET",
      path: `/api/v1/onboarding/module-readiness?legalEntityId=${missingFixture.legalEntityId}`,
      expectedStatus: 200,
    });
    const invalidRow = findModuleRow(
      invalidReadiness.json,
      "bankControlParent",
      missingFixture.legalEntityId
    );
    assert(
      invalidRow?.ready === false &&
        Array.isArray(invalidRow?.missingPurposeCodes) &&
        invalidRow.missingPurposeCodes.length === 0,
      "Invalid mapping should block readiness without reporting a missing purpose code"
    );
    assert(
      Array.isArray(invalidRow?.invalidMappings) &&
        invalidRow.invalidMappings.some(
          (row) =>
            String(row?.purposeCode || "").toUpperCase() === "BANK_CONTROL_PARENT" &&
            String(row?.reason || "").toUpperCase() === "ACCOUNT_TYPE_MISMATCH"
        ),
      "Invalid mapping should report BANK_CONTROL_PARENT account type mismatch"
    );

    await apiRequest({
      token,
      method: "POST",
      path: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: missingFixture.legalEntityId,
        moduleKey: "BANK",
        purposeCode: "BANK_CONTROL_PARENT",
        accountId: missingFixture.assetParentId,
      },
      expectedStatus: 201,
    });

    const repairedReadiness = await apiRequest({
      token,
      method: "GET",
      path: `/api/v1/onboarding/module-readiness?legalEntityId=${missingFixture.legalEntityId}`,
      expectedStatus: 200,
    });
    const repairedRow = findModuleRow(
      repairedReadiness.json,
      "bankControlParent",
      missingFixture.legalEntityId
    );
    assert(repairedRow?.ready === true, "Valid BANK_CONTROL_PARENT mapping should make readiness pass");
    assert(
      Array.isArray(repairedRow?.invalidMappings) && repairedRow.invalidMappings.length === 0,
      "Valid BANK_CONTROL_PARENT mapping should clear invalid readiness blockers"
    );

    console.log("PR-BPM03 readiness API smoke checks passed.");
  } finally {
    await stopServerProcess(server);
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
