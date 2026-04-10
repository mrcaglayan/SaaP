import bcrypt from "bcrypt";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import { assignTestFullAccessRoleToUser } from "./ex05-test-helpers.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
} from "../src/services/cari.document.service.js";
import { createAssetDraft } from "../src/services/fixed-assets.service.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const TEST_PORT = Number(process.env.FA24_SMOKE_PORT || 3121);
const BASE_URL =
  process.env.FA24_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA24_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const ENV_TENANT_ID = parseOptionalPositiveInt(process.env.FA24_SMOKE_TENANT_ID);
const ENV_LEGAL_ENTITY_ID = parseOptionalPositiveInt(
  process.env.FA24_SMOKE_LEGAL_ENTITY_ID
);
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA24_SMOKE_KEEP_ARTIFACTS,
  true
);
const VALID_LINE_DESCRIPTION = "FA24 Smoke Source Valid";
const INVALID_QTY_LINE_DESCRIPTION = "FA24 Smoke Source Invalid Qty";

function parseOptionalPositiveInt(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "fa24-eligible-ap-line-smoke",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

function allowAllScopes() {}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function apiRequest({
  cookie,
  method = "GET",
  pathName,
  expectedStatus,
}) {
  const headers = { Accept: "application/json" };
  if (cookie) {
    headers.Cookie = cookie;
  }

  const { response, payload } = await fetchJson(
    `${BASE_URL}${pathName}`,
    {
      method,
      headers,
    },
    30000
  );

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${pathName} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        payload
      )}`
    );
  }

  return { status: response.status, payload, response };
}

async function isApiAlive() {
  try {
    const { response, payload } = await fetchJson(`${BASE_URL}/health`, {}, 2500);
    return (
      response.status >= 200 &&
      response.status < 600 &&
      payload &&
      typeof payload === "object" &&
      payload.checks
    );
  } catch {
    return false;
  }
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[fa24-smoke][server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[fa24-smoke][server] ${chunk}`);
  });

  return child;
}

async function ensureApiServer() {
  if (await isApiAlive()) {
    return { startedByScript: false, child: null };
  }

  const child = startServerProcess();
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited early with code ${child.exitCode}`);
    }
    if (await isApiAlive()) {
      return { startedByScript: true, child };
    }
    await sleep(400);
  }

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    sleep(5000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function login(email, password) {
  const { response: loginResponse, payload: loginPayload } = await fetchJson(
    `${BASE_URL}/auth/login`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
    30000
  );
  if (loginResponse.status !== 200) {
    throw new Error(
      `Login failed for ${email}: ${JSON.stringify(loginPayload)}`
    );
  }
  const cookie = String(loginResponse.headers.get("set-cookie") || "")
    .split(";")[0]
    .trim();
  assert(cookie, `Login cookie missing for ${email}`);
  return cookie;
}

async function assignFullAccessRoleToUser(tenantId, userId) {
  await assignTestFullAccessRoleToUser(tenantId, userId);
}

async function resolvePermissionId(code) {
  const result = await query(
    `SELECT id
       FROM permissions
      WHERE code = ?
      LIMIT 1`,
    [code]
  );
  const permissionId = Number(result.rows?.[0]?.id || 0);
  assert(permissionId > 0, `Permission ${code} not found`);
  return permissionId;
}

async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "FA24" });
}

async function resolveOpenPostingWindow(tenantId, legalEntityId) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await query(
    `SELECT fp.start_date,
            fp.end_date
       FROM books b
       JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id
        AND ps.fiscal_period_id = fp.id
      WHERE b.tenant_id = ?
        AND b.legal_entity_id = ?
        AND b.book_type = 'LOCAL'
        AND fp.is_adjustment = 0
        AND COALESCE(ps.status, 'OPEN') = 'OPEN'
      ORDER BY CASE WHEN ? BETWEEN fp.start_date AND fp.end_date THEN 0 ELSE 1 END,
               fp.start_date DESC,
               fp.id DESC
      LIMIT 1`,
    [tenantId, legalEntityId, today]
  );
  const row = result.rows?.[0];
  assert(
    row,
    `No OPEN non-adjustment LOCAL fiscal period found for tenant ${tenantId}, legal entity ${legalEntityId}`
  );
  return {
    documentDate: row.start_date,
    dueDate: addDays(row.start_date, 10),
  };
}

async function resolvePostableAccountId(tenantId, legalEntityId, accountType) {
  const result = await query(
    `SELECT a.id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.scope = 'LEGAL_ENTITY'
        AND a.account_type = ?
        AND a.is_active = 1
        AND a.allow_posting = 1
      ORDER BY a.id ASC
      LIMIT 1`,
    [tenantId, legalEntityId, accountType]
  );
  const accountId = Number(result.rows?.[0]?.id || 0);
  assert(
    accountId > 0,
    `No usable ${accountType} account found for tenant ${tenantId}, legal entity ${legalEntityId}`
  );
  return accountId;
}

async function createSmokeUser({ tenantId, uniqueSuffix, state }) {
  const password = "FA24Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa24.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA24 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create FA24 smoke user");
    await assignFullAccessRoleToUser(tenantId, userId);

  state.createdUserIds.push(userId);
  state.createdUserRoleScopeUserIds.push(userId);

  return { userId, email, password };
}

async function createRestrictedUser({ tenantId, uniqueSuffix, state }) {
  const password = "FA24Restricted#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa24.restricted.${uniqueSuffix}@example.test`;

  const userInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA24 Restricted ${uniqueSuffix}`]
  );
  const userId = Number(userInsert.rows?.insertId || 0);
  assert(userId > 0, "Failed to create restricted FA24 smoke user");

  const roleInsert = await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, ?, ?, 0)`,
    [
      tenantId,
      `FA24SMROLE${uniqueSuffix.slice(-8)}`,
      `FA24 Smoke Restricted ${uniqueSuffix.slice(-8)}`,
    ]
  );
  const roleId = Number(roleInsert.rows?.insertId || 0);
  assert(roleId > 0, "Failed to create restricted FA24 smoke role");

  const fixedAssetsPostPermissionId = await resolvePermissionId("fixed_assets.post");
  await query(
    `INSERT INTO role_permissions (role_id, permission_id)
     VALUES (?, ?)`,
    [roleId, fixedAssetsPostPermissionId]
  );

  await query(
    `INSERT INTO user_role_scopes (
        tenant_id, user_id, role_id, scope_type, scope_id, effect
     ) VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')`,
    [tenantId, userId, roleId, tenantId]
  );

  state.createdUserIds.push(userId);
  state.createdRoleIds.push(roleId);
  state.createdUserRoleScopeUserIds.push(userId);
  state.createdRolePermissionRoleIds.push(roleId);

  return { userId, email, password, roleId };
}

async function ensureSmokeVendor({
  tenantId,
  legalEntityId,
  currencyCode,
  liabilityAccountId,
  uniqueSuffix,
  state,
}) {
  const existing = await query(
    `SELECT id
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `FA24VND${uniqueSuffix.slice(-8)}`]
  );
  const existingId = Number(existing.rows?.[0]?.id || 0);
  if (existingId > 0) {
    return { counterpartyId: existingId, created: false };
  }

  const reusable = await query(
    `SELECT id
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND is_vendor = 1
        AND status = 'ACTIVE'
        AND ap_account_id IS NOT NULL
      ORDER BY id ASC
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const reusableId = Number(reusable.rows?.[0]?.id || 0);
  if (reusableId > 0) {
    return { counterpartyId: reusableId, created: false };
  }

  const insertResult = await query(
    `INSERT INTO counterparties (
        tenant_id, legal_entity_id, primary_operating_unit_id,
        code, name, is_customer, is_vendor,
        default_currency_code, ar_account_id, ap_account_id,
        status, notes
     ) VALUES (
        ?, ?, NULL,
        ?, ?, 0, 1,
        ?, NULL, ?,
        'ACTIVE', ?
     )`,
    [
      tenantId,
      legalEntityId,
      `FA24VND${uniqueSuffix.slice(-8)}`,
      `FA24 Smoke Vendor ${uniqueSuffix.slice(-8)}`,
      currencyCode,
      liabilityAccountId,
      "Reusable vendor for STEP-FA24 smoke coverage",
    ]
  );
  const counterpartyId = Number(insertResult.rows?.insertId || 0);
  assert(counterpartyId > 0, "Failed to create FA24 smoke vendor");
  state.createdCounterpartyIds.push(counterpartyId);
  return { counterpartyId, created: true };
}

async function createSmokeCategory({
  tenantId,
  legalEntityId,
  userId,
  uniqueSuffix,
  state,
}) {
  const insertResult = await query(
    `INSERT INTO fixed_asset_categories (
        tenant_id, legal_entity_id, code, name, status,
        description, default_salvage_rule_type,
        created_by_user_id, updated_by_user_id
     ) VALUES (
        ?, ?, ?, ?, 'ACTIVE',
        ?, 'NONE',
        ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      `FA24CT${uniqueSuffix.slice(-8)}`,
      `FA24 Smoke Category ${uniqueSuffix.slice(-8)}`,
      "Temporary category for STEP-FA24 smoke coverage",
      userId,
      userId,
    ]
  );
  const categoryId = Number(insertResult.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create FA24 smoke category");
  state.createdCategoryIds.push(categoryId);
  return categoryId;
}

function findLineByDescription(document, description) {
  return (document?.lines || []).find(
    (line) => String(line?.description || "").trim() === description
  );
}

function unwrapPostedDocumentRow(result) {
  return result?.row || result;
}

async function resolveReusableFixtureDocument({ tenantId, legalEntityId }) {
  const result = await query(
    `SELECT d.id,
            MAX(CASE WHEN l.description = ? THEN l.id END) AS valid_line_id,
            MAX(CASE WHEN l.description = ? THEN l.id END) AS invalid_line_id
       FROM cari_documents d
       JOIN cari_document_lines l
         ON l.cari_document_id = d.id
        AND l.tenant_id = d.tenant_id
      WHERE d.tenant_id = ?
        AND d.legal_entity_id = ?
        AND d.direction = 'AP'
        AND d.status = 'POSTED'
      GROUP BY d.id
     HAVING valid_line_id IS NOT NULL
        AND invalid_line_id IS NOT NULL
      ORDER BY d.id DESC
      LIMIT 1`,
    [
      VALID_LINE_DESCRIPTION,
      INVALID_QTY_LINE_DESCRIPTION,
      tenantId,
      legalEntityId,
    ]
  );
  const row = result.rows?.[0];
  if (!row) {
    return null;
  }
  return {
    documentId: Number(row.id),
    validLineId: Number(row.valid_line_id),
    invalidLineId: Number(row.invalid_line_id),
    createdFixture: false,
  };
}

async function ensurePostedApFixture({
  tenantId,
  legalEntityId,
  userId,
  counterpartyId,
  currencyCode,
  documentDate,
  dueDate,
  postingAccountId,
}) {
  const existing = await resolveReusableFixtureDocument({ tenantId, legalEntityId });
  if (existing) {
    return existing;
  }

  const stamp = `${Date.now()}`;
  const draft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId,
      userId,
      stamp,
      suffix: "fa24-ap-create",
    }),
    payload: {
      tenantId,
      userId,
      legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate,
      dueDate,
      currencyCode,
      lines: [
        {
          description: VALID_LINE_DESCRIPTION,
          quantity: 2,
          postingAccountId,
          lineNetAmountTxn: 200,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 200,
        },
        {
          description: INVALID_QTY_LINE_DESCRIPTION,
          quantity: 1.5,
          postingAccountId,
          lineNetAmountTxn: 150,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 150,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });

  const posted = await postCariDocumentById({
    req: makeRequestContext({
      tenantId,
      userId,
      stamp,
      suffix: "fa24-ap-post",
    }),
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  const postedRow = unwrapPostedDocumentRow(posted);

  const validLine = findLineByDescription(postedRow, VALID_LINE_DESCRIPTION);
  const invalidLine = findLineByDescription(postedRow, INVALID_QTY_LINE_DESCRIPTION);
  assert(validLine?.id, "Posted FA24 smoke document missing valid source line");
  assert(invalidLine?.id, "Posted FA24 smoke document missing invalid-quantity source line");

  return {
    documentId: Number(postedRow?.id || draft.id),
    validLineId: Number(validLine.id),
    invalidLineId: Number(invalidLine.id),
    createdFixture: true,
  };
}

async function createDraftReservationAsset({
  tenantId,
  legalEntityId,
  userId,
  categoryId,
  currencyCode,
  acquisitionDate,
  uniqueSuffix,
  state,
}) {
  const asset = await createAssetDraft({
    tenantId,
    legalEntityId,
    userId,
    name: `FA24 Smoke Reservation ${uniqueSuffix.slice(-8)}`,
    categoryId,
    acquisitionDate,
    currencyCode,
    description: "Temporary FA24 draft reservation asset",
    assetTag: `FA24-${uniqueSuffix.slice(-8)}`,
    serialNo: null,
    ownerOperatingUnitId: null,
    locationOperatingUnitId: null,
    departmentCode: null,
    costCenterCode: null,
    custodianEmployeeId: null,
    counterpartyId: null,
    originalCostTxn: 100,
    originalCostBase: 100,
  });
  const assetId = Number(asset?.id || 0);
  assert(assetId > 0, "Failed to create FA24 draft reservation asset");
  state.createdAssetIds.push(assetId);
  return assetId;
}

async function linkAssetToSourceUnit({
  tenantId,
  assetId,
  documentId,
  lineId,
  unitNo,
}) {
  await query(
    `UPDATE fixed_assets
        SET source_cari_document_id = ?,
            source_cari_document_line_id = ?,
            source_cari_document_line_unit_no = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [documentId, lineId, unitNo, tenantId, assetId]
  );
}

async function clearAssetSourceLinkage({ tenantId, assetId }) {
  await query(
    `UPDATE fixed_assets
        SET source_cari_document_id = NULL,
            source_cari_document_line_id = NULL,
            source_cari_document_line_unit_no = NULL
      WHERE tenant_id = ?
        AND id = ?`,
    [tenantId, assetId]
  );
}

function findApiLine(payload, lineId) {
  return (payload?.rows || []).find((row) => Number(row?.lineId) === Number(lineId));
}

async function readEligibleApLines({ cookie, documentId, unitCount }) {
  const queryText = new URLSearchParams({
    sourceCariDocumentId: String(documentId),
    unitCount: String(unitCount),
  }).toString();
  const { payload } = await apiRequest({
    cookie,
    method: "GET",
    pathName: `/api/v1/fixed-assets/from-cari-document-line?${queryText}`,
    expectedStatus: 200,
  });
  return payload;
}

async function expectSecondaryPermissionFailure({ cookie, documentId }) {
  const queryText = new URLSearchParams({
    sourceCariDocumentId: String(documentId),
    unitCount: "1",
  }).toString();
  const { payload } = await apiRequest({
    cookie,
    method: "GET",
    pathName: `/api/v1/fixed-assets/from-cari-document-line?${queryText}`,
    expectedStatus: 403,
  });
  const message = String(payload?.message || payload?.code || "");
  assert(
    message.includes("Missing secondary permission") ||
      message.includes("cari.doc.read"),
    `Expected secondary permission failure, got ${JSON.stringify(payload)}`
  );
}

async function cleanupState(state) {
  for (const assetId of state.createdAssetIds.slice().reverse()) {
    await query(`DELETE FROM fixed_assets WHERE id = ?`, [assetId]);
  }
  for (const categoryId of state.createdCategoryIds.slice().reverse()) {
    await query(`DELETE FROM fixed_asset_categories WHERE id = ?`, [categoryId]);
  }
  const preservedCounterpartyIds = new Set(state.preservedCounterpartyIds || []);
  for (const counterpartyId of state.createdCounterpartyIds.slice().reverse()) {
    if (preservedCounterpartyIds.has(counterpartyId)) {
      continue;
    }
    await query(`DELETE FROM counterparties WHERE id = ?`, [counterpartyId]);
  }
  for (const userId of Array.from(new Set(state.createdUserRoleScopeUserIds)).reverse()) {
    await query(`DELETE FROM user_role_scopes WHERE user_id = ?`, [userId]);
  }
  for (const roleId of Array.from(new Set(state.createdRolePermissionRoleIds)).reverse()) {
    await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
  }
  for (const roleId of state.createdRoleIds.slice().reverse()) {
    await query(`DELETE FROM roles WHERE id = ?`, [roleId]);
  }
  for (const userId of state.createdUserIds.slice().reverse()) {
    await query(`DELETE FROM users WHERE id = ?`, [userId]);
  }
}

async function main() {
  const state = {
    createdUserIds: [],
    createdRoleIds: [],
    createdUserRoleScopeUserIds: [],
    createdRolePermissionRoleIds: [],
    createdCounterpartyIds: [],
    preservedCounterpartyIds: [],
    createdCategoryIds: [],
    createdAssetIds: [],
  };
  const uniqueSuffix = `${Date.now()}`;
  let server = null;

  try {
    const context = await resolveSmokeContext();
    const postingWindow = await resolveOpenPostingWindow(
      context.tenantId,
      context.legalEntityId
    );
    const assetPostingAccountId = await resolvePostableAccountId(
      context.tenantId,
      context.legalEntityId,
      "ASSET"
    );
    const liabilityAccountId = await resolvePostableAccountId(
      context.tenantId,
      context.legalEntityId,
      "LIABILITY"
    );

    const smokeUser = await createSmokeUser({
      tenantId: context.tenantId,
      uniqueSuffix,
      state,
    });
    const restrictedUser = await createRestrictedUser({
      tenantId: context.tenantId,
      uniqueSuffix,
      state,
    });
    const vendor = await ensureSmokeVendor({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      currencyCode: context.currencyCode,
      liabilityAccountId,
      uniqueSuffix,
      state,
    });
    const categoryId = await createSmokeCategory({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      userId: smokeUser.userId,
      uniqueSuffix,
      state,
    });

    const sourceFixture = await ensurePostedApFixture({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      userId: smokeUser.userId,
      counterpartyId: vendor.counterpartyId,
      currencyCode: context.currencyCode,
      documentDate: postingWindow.documentDate,
      dueDate: postingWindow.dueDate,
      postingAccountId: assetPostingAccountId,
    });
    if (sourceFixture.createdFixture && vendor.created) {
      state.preservedCounterpartyIds.push(vendor.counterpartyId);
    }

    server = await ensureApiServer();
    const smokeCookie = await login(smokeUser.email, smokeUser.password);
    const restrictedCookie = await login(
      restrictedUser.email,
      restrictedUser.password
    );

    const initial = await readEligibleApLines({
      cookie: smokeCookie,
      documentId: sourceFixture.documentId,
      unitCount: 1,
    });
    const initialValidRow = findApiLine(initial, sourceFixture.validLineId);
    const initialInvalidQtyRow = findApiLine(initial, sourceFixture.invalidLineId);

    assert(initial?.document?.status === "POSTED", "FA24 read must surface document status");
    assert(initial?.document?.direction === "AP", "FA24 read must surface AP direction");
    assert(initialValidRow, "FA24 read must include the valid AP source line");
    assert(initialInvalidQtyRow, "FA24 read must include the invalid-quantity source line");
    assert(
      Number(initialValidRow.currentRemainingUnits) === 2,
      `Expected valid line remaining units to start at 2, got ${initialValidRow.currentRemainingUnits}`
    );
    assert(
      initialValidRow.eligibleForFa06 === true,
      "Valid FA24 source line must be eligible before reservation"
    );
    assert(
      initialValidRow.equalSplitValidForMvp === true,
      "Valid FA24 source line must satisfy equal split assumption"
    );
    assert(
      initialInvalidQtyRow.eligibleForFa06 === false &&
        (initialInvalidQtyRow.ineligibleReasons || []).includes(
          "QUANTITY_MUST_BE_POSITIVE_WHOLE_UNITS"
        ),
      "Invalid quantity FA24 source line must be surfaced as ineligible"
    );

    const assetId = await createDraftReservationAsset({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      userId: smokeUser.userId,
      categoryId,
      currencyCode: context.currencyCode,
      acquisitionDate: postingWindow.documentDate,
      uniqueSuffix,
      state,
    });
    await linkAssetToSourceUnit({
      tenantId: context.tenantId,
      assetId,
      documentId: sourceFixture.documentId,
      lineId: sourceFixture.validLineId,
      unitNo: 1,
    });

    const reserved = await readEligibleApLines({
      cookie: smokeCookie,
      documentId: sourceFixture.documentId,
      unitCount: 1,
    });
    const reservedValidRow = findApiLine(reserved, sourceFixture.validLineId);
    assert(reservedValidRow, "Reserved FA24 read must include the valid source line");
    assert(
      Number(reservedValidRow.currentRemainingUnits) === 1,
      `Expected remaining units to drop to 1 after reservation, got ${reservedValidRow.currentRemainingUnits}`
    );
    assert(
      Number(reservedValidRow.consumedUnitCount) === 1,
      `Expected consumed unit count to become 1, got ${reservedValidRow.consumedUnitCount}`
    );

    const previewTooHigh = await readEligibleApLines({
      cookie: smokeCookie,
      documentId: sourceFixture.documentId,
      unitCount: 3,
    });
    const previewTooHighRow = findApiLine(previewTooHigh, sourceFixture.validLineId);
    assert(
      previewTooHighRow &&
        previewTooHighRow.requestedUnitCountValid === false &&
        (previewTooHighRow.ineligibleReasons || []).includes(
          "REQUESTED_UNIT_COUNT_EXCEEDS_REMAINING_UNITS"
        ),
      "FA24 read must preview requested unitCount overflow"
    );

    await clearAssetSourceLinkage({
      tenantId: context.tenantId,
      assetId,
    });

    const released = await readEligibleApLines({
      cookie: smokeCookie,
      documentId: sourceFixture.documentId,
      unitCount: 1,
    });
    const releasedValidRow = findApiLine(released, sourceFixture.validLineId);
    assert(releasedValidRow, "Released FA24 read must include the valid source line");
    assert(
      Number(releasedValidRow.currentRemainingUnits) === 2,
      `Expected remaining units to restore to 2 after release, got ${releasedValidRow.currentRemainingUnits}`
    );
    assert(
      Number(releasedValidRow.consumedUnitCount) === 0,
      `Expected consumed unit count to restore to 0, got ${releasedValidRow.consumedUnitCount}`
    );

    await expectSecondaryPermissionFailure({
      cookie: restrictedCookie,
      documentId: sourceFixture.documentId,
    });

    console.log(
      JSON.stringify(
        {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          sourceFixture,
          summary: {
            initialRemainingUnits: initialValidRow.currentRemainingUnits,
            reservedRemainingUnits: reservedValidRow.currentRemainingUnits,
            releasedRemainingUnits: releasedValidRow.currentRemainingUnits,
            invalidQuantityReasons: initialInvalidQtyRow.ineligibleReasons,
            restrictedUserBlocked: true,
          },
          cleanup: KEEP_ARTIFACTS ? "skipped" : "completed",
        },
        null,
        2
      )
    );
  } finally {
    try {
      if (!KEEP_ARTIFACTS) {
        await cleanupState(state);
      }
    } finally {
      await stopServer(server?.child || null);
      await closePool();
    }
  }
}

main().catch((error) => {
  console.error("[fa24-smoke] failed");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
