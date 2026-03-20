import bcrypt from "bcrypt";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
} from "../src/services/cari.document.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const TEST_PORT = Number(process.env.FA22_SMOKE_PORT || 3121);
const BASE_URL =
  process.env.FA22_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA22_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const ENV_TENANT_ID = parseOptionalPositiveInt(process.env.FA22_SMOKE_TENANT_ID);
const ENV_LEGAL_ENTITY_ID = parseOptionalPositiveInt(
  process.env.FA22_SMOKE_LEGAL_ENTITY_ID
);
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA22_SMOKE_KEEP_ARTIFACTS,
  true
);
const SOURCE_LINE_DESCRIPTION = "FA22 Smoke Source Valid";

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

function minDate(a, b) {
  return a <= b ? a : b;
}

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "fa22-legacy-onboarding-smoke",
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
  body,
  expectedStatus,
}) {
  const headers = { Accept: "application/json" };
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const { response, payload } = await fetchJson(
    `${BASE_URL}${pathName}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
    process.stdout.write(`[fa22-smoke][server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[fa22-smoke][server] ${chunk}`);
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
  const { response, payload } = await fetchJson(
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

  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(payload)}`);
  }

  const cookie = String(response.headers.get("set-cookie") || "")
    .split(";")[0]
    .trim();
  assert(cookie, `Login cookie missing for ${email}`);
  return cookie;
}

async function resolveTenantAdminRoleId(tenantId) {
  const result = await query(
    `SELECT id
       FROM roles
      WHERE tenant_id = ?
        AND code = 'TenantAdmin'
      LIMIT 1`,
    [tenantId]
  );
  const roleId = Number(result.rows?.[0]?.id || 0);
  assert(roleId > 0, `TenantAdmin role not found for tenant ${tenantId}`);
  return roleId;
}

async function resolveSmokeContext() {
  if (ENV_TENANT_ID && ENV_LEGAL_ENTITY_ID) {
    const explicit = await query(
      `SELECT le.id AS legal_entity_id,
              le.functional_currency_code
         FROM legal_entities le
        WHERE le.tenant_id = ?
          AND le.id = ?
          AND EXISTS (
                SELECT 1
                  FROM roles r
                 WHERE r.tenant_id = le.tenant_id
                   AND r.code = 'TenantAdmin'
              )
          AND EXISTS (
                SELECT 1
                  FROM operating_units ou
                 WHERE ou.tenant_id = le.tenant_id
                   AND ou.legal_entity_id = le.id
                   AND ou.status = 'ACTIVE'
              )
          AND EXISTS (
                SELECT 1
                  FROM books b
                  JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
                  LEFT JOIN period_statuses ps
                    ON ps.book_id = b.id
                   AND ps.fiscal_period_id = fp.id
                 WHERE b.tenant_id = le.tenant_id
                   AND b.legal_entity_id = le.id
                   AND b.book_type = 'LOCAL'
                   AND fp.is_adjustment = 0
                   AND COALESCE(ps.status, 'OPEN') = 'OPEN'
              )
        LIMIT 1`,
      [ENV_TENANT_ID, ENV_LEGAL_ENTITY_ID]
    );
    const row = explicit.rows?.[0];
    assert(
      row,
      `Requested FA22 smoke context tenantId=${ENV_TENANT_ID}, legalEntityId=${ENV_LEGAL_ENTITY_ID} is not smoke-ready`
    );
    return {
      tenantId: ENV_TENANT_ID,
      legalEntityId: ENV_LEGAL_ENTITY_ID,
      currencyCode:
        String(row.functional_currency_code || "").trim().toUpperCase() || "USD",
    };
  }

  const preferred = await query(
    `SELECT le.tenant_id,
            le.id AS legal_entity_id,
            le.functional_currency_code
       FROM legal_entities le
      WHERE le.tenant_id = 1
        AND EXISTS (
              SELECT 1
                FROM roles r
               WHERE r.tenant_id = le.tenant_id
                 AND r.code = 'TenantAdmin'
            )
        AND EXISTS (
              SELECT 1
                FROM operating_units ou
               WHERE ou.tenant_id = le.tenant_id
                 AND ou.legal_entity_id = le.id
                 AND ou.status = 'ACTIVE'
            )
        AND EXISTS (
              SELECT 1
                FROM books b
                JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
                LEFT JOIN period_statuses ps
                  ON ps.book_id = b.id
                 AND ps.fiscal_period_id = fp.id
               WHERE b.tenant_id = le.tenant_id
                 AND b.legal_entity_id = le.id
                 AND b.book_type = 'LOCAL'
                 AND fp.is_adjustment = 0
                 AND COALESCE(ps.status, 'OPEN') = 'OPEN'
            )
      ORDER BY CASE WHEN le.id = 1 THEN 0 ELSE 1 END,
               le.id ASC
      LIMIT 1`
  );
  const preferredRow = preferred.rows?.[0];
  if (preferredRow) {
    return {
      tenantId: Number(preferredRow.tenant_id),
      legalEntityId: Number(preferredRow.legal_entity_id),
      currencyCode:
        String(preferredRow.functional_currency_code || "").trim().toUpperCase() ||
        "USD",
    };
  }

  const fallback = await query(
    `SELECT le.tenant_id,
            le.id AS legal_entity_id,
            le.functional_currency_code
       FROM legal_entities le
      WHERE EXISTS (
              SELECT 1
                FROM roles r
               WHERE r.tenant_id = le.tenant_id
                 AND r.code = 'TenantAdmin'
            )
        AND EXISTS (
              SELECT 1
                FROM operating_units ou
               WHERE ou.tenant_id = le.tenant_id
                 AND ou.legal_entity_id = le.id
                 AND ou.status = 'ACTIVE'
            )
        AND EXISTS (
              SELECT 1
                FROM books b
                JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
                LEFT JOIN period_statuses ps
                  ON ps.book_id = b.id
                 AND ps.fiscal_period_id = fp.id
               WHERE b.tenant_id = le.tenant_id
                 AND b.legal_entity_id = le.id
                 AND b.book_type = 'LOCAL'
                 AND fp.is_adjustment = 0
                 AND COALESCE(ps.status, 'OPEN') = 'OPEN'
            )
      ORDER BY le.tenant_id ASC, le.id ASC
      LIMIT 1`
  );
  const row = fallback.rows?.[0];
  assert(
    row,
    "No smoke-ready legal entity found. Set FA22_SMOKE_TENANT_ID and FA22_SMOKE_LEGAL_ENTITY_ID if needed."
  );
  return {
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    currencyCode: String(row.functional_currency_code || "").trim().toUpperCase() || "USD",
  };
}

async function resolveActiveOperatingUnitIds(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND status = 'ACTIVE'
      ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  const rows = result.rows || [];
  assert(
    rows.length > 0,
    `No ACTIVE operating units found for tenant ${tenantId}, legal entity ${legalEntityId}`
  );
  return {
    ownerOperatingUnitId: Number(rows[0].id),
    locationOperatingUnitId: Number((rows[1] || rows[0]).id),
  };
}

async function resolveAccountFixtures(tenantId, legalEntityId) {
  async function readIds(accountType, limit) {
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
        LIMIT ${limit}`,
      [tenantId, legalEntityId, accountType]
    );
    return (result.rows || []).map((row) => Number(row.id));
  }

  const assetIds = await readIds("ASSET", 2);
  const expenseIds = await readIds("EXPENSE", 2);
  const revenueIds = await readIds("REVENUE", 1);
  const liabilityIds = await readIds("LIABILITY", 1);

  assert(assetIds.length >= 1, "No usable ASSET accounts found");
  assert(expenseIds.length >= 1, "No usable EXPENSE accounts found");
  assert(revenueIds.length >= 1, "No usable REVENUE accounts found");
  assert(liabilityIds.length >= 1, "No usable LIABILITY accounts found");

  return {
    assetAccountId: assetIds[0],
    accumDeprAccountId: assetIds[1] || assetIds[0],
    deprExpenseAccountId: expenseIds[0],
    disposalLossAccountId: expenseIds[1] || expenseIds[0],
    disposalGainAccountId: revenueIds[0],
    liabilityAccountId: liabilityIds[0],
  };
}

async function resolveOpenPostingWindow(tenantId, legalEntityId) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await query(
    `SELECT b.id AS book_id,
            fp.id AS fiscal_period_id,
            fp.period_name,
            fp.start_date,
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

  const acquisitionDate = row.start_date;
  const capitalizationDate = minDate(addDays(acquisitionDate, 1), row.end_date);
  const inServiceDate = minDate(addDays(acquisitionDate, 2), row.end_date);
  const postingDate = minDate(addDays(acquisitionDate, 3), row.end_date);

  return {
    bookId: Number(row.book_id),
    fiscalPeriodId: Number(row.fiscal_period_id),
    periodName: String(row.period_name || ""),
    startDate: row.start_date,
    endDate: row.end_date,
    acquisitionDate,
    capitalizationDate,
    inServiceDate,
    postingDate,
    documentDate: row.start_date,
    dueDate: addDays(row.start_date, 10),
  };
}

async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const password = "FA22Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa22.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA22 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create FA22 smoke user");

  const roleId = await resolveTenantAdminRoleId(tenantId);
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id, user_id, role_id, scope_type, scope_id, effect
     ) VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')`,
    [tenantId, userId, roleId, tenantId]
  );

  return { userId, email, password };
}

async function createSmokeProfile({
  tenantId,
  legalEntityId,
  userId,
  uniqueSuffix,
}) {
  const code = `FA22PF${uniqueSuffix.slice(-6)}`;
  const insertResult = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id, legal_entity_id, code, name, status, method,
        declining_balance_rate_percent, switch_to_straight_line,
        description, created_by_user_id, updated_by_user_id
     ) VALUES (
        ?, ?, ?, ?, 'ACTIVE', 'STRAIGHT_LINE',
        NULL, 0,
        ?, ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      code,
      `FA22 Smoke Profile ${uniqueSuffix}`,
      "Smoke profile for STEP-FA22 legacy onboarding coverage",
      userId,
      userId,
    ]
  );
  const profileId = Number(insertResult.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create FA22 smoke depreciation profile");
  return { profileId, code };
}

async function createSmokeCategory({
  tenantId,
  legalEntityId,
  userId,
  profileId,
  uniqueSuffix,
  accounts,
}) {
  const code = `FA22CT${uniqueSuffix.slice(-6)}`;
  const insertResult = await query(
    `INSERT INTO fixed_asset_categories (
        tenant_id, legal_entity_id, code, name, status, description,
        capitalization_threshold_base, default_useful_life_months,
        default_salvage_rule_type, default_salvage_amount_base,
        default_depreciation_profile_id,
        default_asset_account_id, default_accum_depr_account_id,
        default_depr_expense_account_id, default_disposal_gain_account_id,
        default_disposal_loss_account_id,
        created_by_user_id, updated_by_user_id
     ) VALUES (
        ?, ?, ?, ?, 'ACTIVE', ?,
        ?, ?,
        'NONE', NULL,
        ?,
        ?, ?, ?, ?, ?,
        ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      code,
      `FA22 Smoke Category ${uniqueSuffix}`,
      "Smoke category for STEP-FA22 legacy onboarding coverage",
      1000,
      24,
      profileId,
      accounts.assetAccountId,
      accounts.accumDeprAccountId,
      accounts.deprExpenseAccountId,
      accounts.disposalGainAccountId,
      accounts.disposalLossAccountId,
      userId,
      userId,
    ]
  );
  const categoryId = Number(insertResult.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create FA22 smoke category");
  return { categoryId, code };
}

async function ensureSmokeVendor({
  tenantId,
  legalEntityId,
  currencyCode,
  liabilityAccountId,
  uniqueSuffix,
}) {
  const existing = await query(
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
  const existingId = Number(existing.rows?.[0]?.id || 0);
  if (existingId > 0) {
    return { counterpartyId: existingId, created: false };
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
      `FA22VND${uniqueSuffix.slice(-8)}`,
      `FA22 Smoke Vendor ${uniqueSuffix.slice(-8)}`,
      currencyCode,
      liabilityAccountId,
      "Reusable vendor for STEP-FA22 smoke coverage",
    ]
  );
  const counterpartyId = Number(insertResult.rows?.insertId || 0);
  assert(counterpartyId > 0, "Failed to create FA22 smoke vendor");
  return { counterpartyId, created: true };
}

function findLineByDescription(document, description) {
  return (document?.lines || []).find(
    (line) => String(line?.description || "").trim() === description
  );
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
  const reusable = await query(
    `SELECT d.id,
            MAX(CASE WHEN l.description = ? THEN l.id END) AS line_id
       FROM cari_documents d
       JOIN cari_document_lines l
         ON l.cari_document_id = d.id
        AND l.tenant_id = d.tenant_id
      WHERE d.tenant_id = ?
        AND d.legal_entity_id = ?
        AND d.direction = 'AP'
        AND d.status = 'POSTED'
      GROUP BY d.id
     HAVING line_id IS NOT NULL
      ORDER BY d.id DESC
      LIMIT 1`,
    [SOURCE_LINE_DESCRIPTION, tenantId, legalEntityId]
  );
  const existing = reusable.rows?.[0];
  if (existing) {
    return {
      documentId: Number(existing.id),
      lineId: Number(existing.line_id),
      createdFixture: false,
    };
  }

  const stamp = `${Date.now()}`;
  const draft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId,
      userId,
      stamp,
      suffix: "fa22-ap-create",
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
          description: SOURCE_LINE_DESCRIPTION,
          quantity: 1,
          postingAccountId,
          lineNetAmountTxn: 500,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 500,
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
      suffix: "fa22-ap-post",
    }),
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });

  const line =
    findLineByDescription(posted, SOURCE_LINE_DESCRIPTION) ||
    (
      await query(
        `SELECT id
           FROM cari_document_lines
          WHERE tenant_id = ?
            AND cari_document_id = ?
            AND description = ?
          ORDER BY id ASC
          LIMIT 1`,
        [tenantId, Number(posted.id), SOURCE_LINE_DESCRIPTION]
      )
    ).rows?.[0];
  assert(line?.id, "Posted FA22 smoke document missing source line");

  return {
    documentId: Number(posted.id),
    lineId: Number(line.id),
    createdFixture: true,
  };
}

async function createLegacyDraftAsset({
  cookie,
  legalEntityId,
  categoryId,
  profileId,
  currencyCode,
  ownerOperatingUnitId,
  locationOperatingUnitId,
  acquisitionDate,
  uniqueSuffix,
  nameSuffix,
  originalCostBase,
  legacyAccumDeprBase,
  legacyNbvBase,
  remainingUsefulLifeMonths,
}) {
  const originalCostTxn = Number(originalCostBase);
  const legacyAccumDeprTxn = Number(legacyAccumDeprBase);
  const legacyNbvTxn = Number(legacyNbvBase);
  const remainingLife = remainingUsefulLifeMonths ?? null;

  const { payload } = await apiRequest({
    cookie,
    method: "POST",
    pathName: "/api/v1/fixed-assets",
    expectedStatus: 201,
    body: {
      legalEntityId,
      name: `FA22 Smoke ${nameSuffix} ${uniqueSuffix}`,
      categoryId,
      acquisitionDate,
      currencyCode,
      ownerOperatingUnitId,
      locationOperatingUnitId,
      originalCostTxn,
      originalCostBase,
      depreciationProfileId: profileId,
      usefulLifeMonths: 24,
      remainingUsefulLifeMonths: remainingLife,
      legacyAccumDeprTxn,
      legacyAccumDeprBase,
      legacyNbvTxn,
      legacyNbvBase,
      description: `STEP-FA22 smoke ${nameSuffix}`,
      assetTag: `FA22-${nameSuffix}-${uniqueSuffix}`.slice(0, 40),
    },
  });

  const assetId = Number(payload?.id || 0);
  assert(assetId > 0, `Failed to create legacy draft asset for ${nameSuffix}`);
  return payload;
}

async function activateAsset({
  cookie,
  assetId,
  postingDate,
  capitalizationDate,
  inServiceDate,
  expectedStatus = 200,
}) {
  return apiRequest({
    cookie,
    method: "POST",
    pathName: `/api/v1/fixed-assets/${assetId}/activate`,
    expectedStatus,
    body: {
      postingDate,
      capitalizationDate,
      inServiceDate,
    },
  });
}

async function setAssetSourceLinkage({
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

async function getAssetDbState({ tenantId, assetId }) {
  const assetResult = await query(
    `SELECT id,
            status,
            remaining_useful_life_months,
            source_cari_document_id,
            source_cari_document_line_id,
            source_cari_document_line_unit_no
       FROM fixed_assets
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, assetId]
  );
  const txnCounts = await query(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN transaction_type = 'ACQUISITION' THEN 1 ELSE 0 END) AS acquisition_count,
            SUM(CASE WHEN transaction_type = 'CAPITALIZATION' THEN 1 ELSE 0 END) AS capitalization_count,
            SUM(CASE WHEN transaction_type = 'DEPRECIATION' THEN 1 ELSE 0 END) AS depreciation_count
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?`,
    [tenantId, assetId]
  );
  const acquisition = await query(
    `SELECT transaction_type,
            status,
            journal_entry_id,
            gross_amount_base,
            accum_depr_amount_base,
            nbv_amount_base
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
        AND transaction_type = 'ACQUISITION'
      LIMIT 1`,
    [tenantId, assetId]
  );

  return {
    asset: assetResult.rows?.[0] || null,
    txnCounts: txnCounts.rows?.[0] || null,
    acquisition: acquisition.rows?.[0] || null,
  };
}

async function expectActivationFailure({
  tenantId,
  cookie,
  assetId,
  postingDate,
  capitalizationDate,
  inServiceDate,
  expectedMessagePart,
}) {
  const { payload } = await activateAsset({
    cookie,
    assetId,
    postingDate,
    capitalizationDate,
    inServiceDate,
    expectedStatus: 400,
  });

  const message = String(payload?.message || "");
  assert(
    message.includes(expectedMessagePart),
    `Expected activation failure for asset ${assetId} to include "${expectedMessagePart}", got "${message}"`
  );

  const dbState = await getAssetDbState({ tenantId, assetId });
  assert(
    dbState.asset?.status === "DRAFT",
    `Asset ${assetId} should remain DRAFT after failed activation`
  );
  assert(
    Number(dbState.txnCounts?.total_count || 0) === 0,
    `Asset ${assetId} should not create transactions on failed activation`
  );

  return { message };
}

async function main() {
  const context = await resolveSmokeContext();
  const uniqueSuffix = `${Date.now()}`;
  const summary = {
    baseUrl: BASE_URL,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    keepArtifacts: KEEP_ARTIFACTS,
    serverStartedByScript: false,
    fixtureIds: {},
    period: null,
    validRemainingActivation: null,
    validZeroRemainingActivation: null,
    invalidActivations: [],
    cleanup: "skipped",
  };

  let server = null;

  try {
    const accounts = await resolveAccountFixtures(
      context.tenantId,
      context.legalEntityId
    );
    const operatingUnits = await resolveActiveOperatingUnitIds(
      context.tenantId,
      context.legalEntityId
    );
    const postingWindow = await resolveOpenPostingWindow(
      context.tenantId,
      context.legalEntityId
    );

    const smokeUser = await createSmokeUser({
      tenantId: context.tenantId,
      uniqueSuffix,
    });
    const profile = await createSmokeProfile({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      userId: smokeUser.userId,
      uniqueSuffix,
    });
    const category = await createSmokeCategory({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      userId: smokeUser.userId,
      profileId: profile.profileId,
      uniqueSuffix,
      accounts,
    });
    const vendor = await ensureSmokeVendor({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      currencyCode: context.currencyCode,
      liabilityAccountId: accounts.liabilityAccountId,
      uniqueSuffix,
    });
    const sourceFixture = await ensurePostedApFixture({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      userId: smokeUser.userId,
      counterpartyId: vendor.counterpartyId,
      currencyCode: context.currencyCode,
      documentDate: postingWindow.documentDate,
      dueDate: postingWindow.dueDate,
      postingAccountId: accounts.assetAccountId,
    });

    server = await ensureApiServer();
    summary.serverStartedByScript = Boolean(server.startedByScript);

    const cookie = await login(smokeUser.email, smokeUser.password);

    summary.fixtureIds = {
      userId: smokeUser.userId,
      profileId: profile.profileId,
      categoryId: category.categoryId,
      sourceCariDocumentId: sourceFixture.documentId,
      sourceCariDocumentLineId: sourceFixture.lineId,
      smokeVendorId: vendor.counterpartyId,
    };
    summary.period = {
      periodName: postingWindow.periodName,
      startDate: postingWindow.startDate,
      endDate: postingWindow.endDate,
      bookId: postingWindow.bookId,
      fiscalPeriodId: postingWindow.fiscalPeriodId,
      acquisitionDate: postingWindow.acquisitionDate,
      capitalizationDate: postingWindow.capitalizationDate,
      inServiceDate: postingWindow.inServiceDate,
      postingDate: postingWindow.postingDate,
    };

    const activeDraft = await createLegacyDraftAsset({
      cookie,
      legalEntityId: context.legalEntityId,
      categoryId: category.categoryId,
      profileId: profile.profileId,
      currencyCode: context.currencyCode,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "legacy-active",
      originalCostBase: 500,
      legacyAccumDeprBase: 200,
      legacyNbvBase: 300,
      remainingUsefulLifeMonths: 12,
    });

    const { payload: activeAsset } = await activateAsset({
      cookie,
      assetId: Number(activeDraft.id),
      postingDate: postingWindow.postingDate,
      capitalizationDate: postingWindow.capitalizationDate,
      inServiceDate: postingWindow.inServiceDate,
    });
    const activeDbState = await getAssetDbState({
      tenantId: context.tenantId,
      assetId: Number(activeDraft.id),
    });

    assert(activeAsset.status === "ACTIVE", "Legacy asset with remaining depreciation must activate to ACTIVE");
    assert(
      Number(activeDbState.txnCounts?.acquisition_count || 0) === 1,
      "Legacy ACTIVE asset must create exactly one ACQUISITION transaction"
    );
    assert(
      Number(activeDbState.txnCounts?.depreciation_count || 0) === 0,
      "Legacy ACTIVE asset must not create inline DEPRECIATION"
    );
    assert(
      Number(activeDbState.txnCounts?.capitalization_count || 0) === 0,
      "Legacy ACTIVE asset must not create CAPITALIZATION"
    );
    assert(
      activeDbState.acquisition?.journal_entry_id == null,
      "Legacy onboarding ACQUISITION must keep journal_entry_id null"
    );
    assert(
      Number(activeDbState.acquisition?.gross_amount_base || 0) === 500,
      "Legacy ACTIVE acquisition gross amount must equal original cost"
    );
    assert(
      Number(activeDbState.acquisition?.accum_depr_amount_base || 0) === 200,
      "Legacy ACTIVE acquisition accumulated depreciation must equal imported value"
    );
    assert(
      Number(activeDbState.acquisition?.nbv_amount_base || 0) === 300,
      "Legacy ACTIVE acquisition NBV must equal imported NBV"
    );

    summary.validRemainingActivation = {
      assetId: Number(activeDraft.id),
      status: activeAsset.status,
      acquisitionTransactionCount: Number(
        activeDbState.txnCounts?.acquisition_count || 0
      ),
      depreciationTransactionCount: Number(
        activeDbState.txnCounts?.depreciation_count || 0
      ),
      acquisitionJournalEntryId: activeDbState.acquisition?.journal_entry_id ?? null,
    };

    const fullyDraft = await createLegacyDraftAsset({
      cookie,
      legalEntityId: context.legalEntityId,
      categoryId: category.categoryId,
      profileId: profile.profileId,
      currencyCode: context.currencyCode,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "legacy-fully-depr",
      originalCostBase: 500,
      legacyAccumDeprBase: 500,
      legacyNbvBase: 0,
      remainingUsefulLifeMonths: 0,
    });

    const { payload: fullyAsset } = await activateAsset({
      cookie,
      assetId: Number(fullyDraft.id),
      postingDate: postingWindow.postingDate,
      capitalizationDate: postingWindow.capitalizationDate,
      inServiceDate: postingWindow.inServiceDate,
    });
    const fullyDbState = await getAssetDbState({
      tenantId: context.tenantId,
      assetId: Number(fullyDraft.id),
    });

    assert(
      fullyAsset.status === "FULLY_DEPRECIATED",
      "Zero-remaining legacy asset must activate to FULLY_DEPRECIATED"
    );
    assert(
      Number(fullyDbState.asset?.remaining_useful_life_months || 0) === 0,
      "Zero-remaining legacy asset must freeze remaining useful life to 0"
    );
    assert(
      Number(fullyDbState.txnCounts?.acquisition_count || 0) === 1,
      "Zero-remaining legacy asset must create exactly one ACQUISITION transaction"
    );
    assert(
      Number(fullyDbState.txnCounts?.depreciation_count || 0) === 0,
      "Zero-remaining legacy asset must not create low-value DEPRECIATION"
    );
    assert(
      fullyDbState.acquisition?.journal_entry_id == null,
      "Zero-remaining legacy ACQUISITION must keep journal_entry_id null"
    );

    summary.validZeroRemainingActivation = {
      assetId: Number(fullyDraft.id),
      status: fullyAsset.status,
      remainingUsefulLifeMonths: Number(
        fullyDbState.asset?.remaining_useful_life_months || 0
      ),
      acquisitionTransactionCount: Number(
        fullyDbState.txnCounts?.acquisition_count || 0
      ),
      depreciationTransactionCount: Number(
        fullyDbState.txnCounts?.depreciation_count || 0
      ),
      acquisitionJournalEntryId: fullyDbState.acquisition?.journal_entry_id ?? null,
    };

    const invalidMathDraft = await createLegacyDraftAsset({
      cookie,
      legalEntityId: context.legalEntityId,
      categoryId: category.categoryId,
      profileId: profile.profileId,
      currencyCode: context.currencyCode,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "legacy-invalid-math",
      originalCostBase: 500,
      legacyAccumDeprBase: 200,
      legacyNbvBase: 299,
      remainingUsefulLifeMonths: 12,
    });

    summary.invalidActivations.push({
      assetId: Number(invalidMathDraft.id),
      case: "invalid legacy NBV math",
      ...(await expectActivationFailure({
        tenantId: context.tenantId,
        cookie,
        assetId: Number(invalidMathDraft.id),
        postingDate: postingWindow.postingDate,
        capitalizationDate: postingWindow.capitalizationDate,
        inServiceDate: postingWindow.inServiceDate,
        expectedMessagePart:
          "legacyNbvTxn must equal originalCostTxn - legacyAccumDeprTxn",
      })),
    });

    const sourceLinkedDraft = await createLegacyDraftAsset({
      cookie,
      legalEntityId: context.legalEntityId,
      categoryId: category.categoryId,
      profileId: profile.profileId,
      currencyCode: context.currencyCode,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "legacy-source-linked",
      originalCostBase: 500,
      legacyAccumDeprBase: 200,
      legacyNbvBase: 300,
      remainingUsefulLifeMonths: 12,
    });

    await setAssetSourceLinkage({
      tenantId: context.tenantId,
      assetId: Number(sourceLinkedDraft.id),
      documentId: sourceFixture.documentId,
      lineId: sourceFixture.lineId,
      unitNo: 1,
    });

    summary.invalidActivations.push({
      assetId: Number(sourceLinkedDraft.id),
      case: "legacy source-linked/CARI rejection",
      ...(await expectActivationFailure({
        tenantId: context.tenantId,
        cookie,
        assetId: Number(sourceLinkedDraft.id),
        postingDate: postingWindow.postingDate,
        capitalizationDate: postingWindow.capitalizationDate,
        inServiceDate: postingWindow.inServiceDate,
        expectedMessagePart:
          "Legacy onboarding activation does not support source-linked/CARI assets",
      })),
    });

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await stopServer(server?.child);
  }
}

main()
  .catch((error) => {
    console.error(
      `[fa22-smoke] ${error?.stack || error?.message || String(error)}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
