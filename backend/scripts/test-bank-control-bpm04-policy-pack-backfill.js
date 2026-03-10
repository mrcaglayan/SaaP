import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query, withTransaction } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import { applyPolicyPackTx } from "../src/services/policy-packs.apply.service.js";
import { resolvePolicyPack } from "../src/services/policy-packs.resolve.service.js";
import { getPolicyPack } from "../src/services/policy-packs.service.js";
import { backfillBankControlParentMappings } from "../src/services/bank.control-parent.backfill.service.js";

const FEATURE_SUBACCOUNTS_V1 = "FEATURE_SUBACCOUNTS_V1";
const BANK_CONTROL_PARENT_PURPOSE_CODE = "BANK_CONTROL_PARENT";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function findPurposeRow(rows, purposeCode) {
  const normalizedPurposeCode = toUpper(purposeCode);
  return (rows || []).find((row) => toUpper(row?.purposeCode) === normalizedPurposeCode) || null;
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
  const tenantId = toInt(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to resolve tenant id for ${code}`);
  return tenantId;
}

async function getCountryIdByIso2(iso2) {
  const result = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = ?
     LIMIT 1`,
    [toUpper(iso2)]
  );
  const countryId = toInt(result.rows?.[0]?.id);
  assert(countryId > 0, `Country not found: ${iso2}`);
  return countryId;
}

async function createGroupCompany(tenantId, code, name) {
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
  const groupCompanyId = toInt(result.rows?.[0]?.id);
  assert(groupCompanyId > 0, `Failed to create group company ${code}`);
  return groupCompanyId;
}

async function createLegalEntity({
  tenantId,
  groupCompanyId,
  code,
  name,
  countryId,
}) {
  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      )
      VALUES (?, ?, ?, ?, ?, 'USD')`,
    [tenantId, groupCompanyId, code, name, countryId]
  );
  const result = await query(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const legalEntityId = toInt(result.rows?.[0]?.id);
  assert(legalEntityId > 0, `Failed to create legal entity ${code}`);
  return legalEntityId;
}

async function createCoa({ tenantId, legalEntityId, code, name }) {
  await query(
    `INSERT INTO charts_of_accounts (tenant_id, legal_entity_id, scope, code, name)
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, code, name]
  );
  const result = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const coaId = toInt(result.rows?.[0]?.id);
  assert(coaId > 0, `Failed to create CoA ${code}`);
  return coaId;
}

async function createAccount({
  coaId,
  code,
  name,
  accountType,
  normalSide,
  allowPosting,
  isActive = true,
}) {
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
      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [coaId, code, name, toUpper(accountType), toUpper(normalSide), Boolean(allowPosting)]
  );
  if (!isActive) {
    await query(
      `UPDATE accounts
       SET is_active = FALSE
       WHERE coa_id = ?
         AND code = ?`,
      [coaId, code]
    );
  }
}

async function resolveAccountIdByCode(coaId, code) {
  const result = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, code]
  );
  const accountId = toInt(result.rows?.[0]?.id);
  assert(accountId > 0, `Account not found: ${code}`);
  return accountId;
}

async function createUser(tenantId, email, name) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, '!', ?, 'ACTIVE')`,
    [tenantId, email, name]
  );
  const result = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  const userId = toInt(result.rows?.[0]?.id);
  assert(userId > 0, `Failed to create user ${email}`);
  return userId;
}

async function enableStrictBankMode(tenantId, userId) {
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
}

async function getBankControlParentMapping(tenantId, legalEntityId) {
  const result = await query(
    `SELECT account_id
     FROM journal_purpose_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND purpose_code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, BANK_CONTROL_PARENT_PURPOSE_CODE]
  );
  return result.rows?.[0] || null;
}

async function buildFixture() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant(
    `BANK_BPM04_${stamp}`,
    `Bank BPM04 ${stamp}`
  );
  const countryId = await getCountryIdByIso2("TR");
  const groupCompanyId = await createGroupCompany(
    tenantId,
    `GRP_BPM04_${stamp}`,
    `BPM04 Group ${stamp}`
  );
  const userId = await createUser(
    tenantId,
    `bank_bpm04_${stamp}@example.com`,
    `BPM04 User ${stamp}`
  );
  await enableStrictBankMode(tenantId, userId);

  const previewLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    code: `LE_PREVIEW_${stamp}`,
    name: `Preview LE ${stamp}`,
    countryId,
  });
  const previewCoaId = await createCoa({
    tenantId,
    legalEntityId: previewLegalEntityId,
    code: `COA_PREVIEW_${stamp}`,
    name: `Preview CoA ${stamp}`,
  });
  await createAccount({
    coaId: previewCoaId,
    code: "102",
    name: "Preview Bank Parent",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: false,
  });

  const applyLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    code: `LE_APPLY_${stamp}`,
    name: `Apply LE ${stamp}`,
    countryId,
  });
  const applyCoaId = await createCoa({
    tenantId,
    legalEntityId: applyLegalEntityId,
    code: `COA_APPLY_${stamp}`,
    name: `Apply CoA ${stamp}`,
  });
  await createAccount({
    coaId: applyCoaId,
    code: "102",
    name: "Apply Bank Parent",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: false,
  });
  await createAccount({
    coaId: applyCoaId,
    code: "210",
    name: "Invalid Liability Parent",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    allowPosting: false,
  });

  const backfillEligibleLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    code: `LE_BACKFILL_OK_${stamp}`,
    name: `Backfill OK LE ${stamp}`,
    countryId,
  });
  const backfillEligibleCoaId = await createCoa({
    tenantId,
    legalEntityId: backfillEligibleLegalEntityId,
    code: `COA_BACKFILL_OK_${stamp}`,
    name: `Backfill OK CoA ${stamp}`,
  });
  await createAccount({
    coaId: backfillEligibleCoaId,
    code: "102",
    name: "Backfill Eligible Parent",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: false,
  });

  const backfillAmbiguousLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    code: `LE_BACKFILL_AMBIG_${stamp}`,
    name: `Backfill Ambiguous LE ${stamp}`,
    countryId,
  });
  const backfillAmbiguousCoaAId = await createCoa({
    tenantId,
    legalEntityId: backfillAmbiguousLegalEntityId,
    code: `COA_BACKFILL_AMBIG_A_${stamp}`,
    name: `Backfill Ambig A ${stamp}`,
  });
  const backfillAmbiguousCoaBId = await createCoa({
    tenantId,
    legalEntityId: backfillAmbiguousLegalEntityId,
    code: `COA_BACKFILL_AMBIG_B_${stamp}`,
    name: `Backfill Ambig B ${stamp}`,
  });
  await createAccount({
    coaId: backfillAmbiguousCoaAId,
    code: "102",
    name: "Ambiguous Parent A",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: false,
  });
  await createAccount({
    coaId: backfillAmbiguousCoaBId,
    code: "102",
    name: "Ambiguous Parent B",
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: false,
  });

  return {
    tenantId,
    userId,
    previewLegalEntityId,
    applyLegalEntityId,
    backfillEligibleLegalEntityId,
    backfillAmbiguousLegalEntityId,
    accounts: {
      applyBankParent: await resolveAccountIdByCode(applyCoaId, "102"),
      applyInvalidLiability: await resolveAccountIdByCode(applyCoaId, "210"),
    },
  };
}

async function main() {
  const fixture = await buildFixture();

  try {
    const trPack = getPolicyPack("TR_UNIFORM_V1");
    const afPack = getPolicyPack("AF_STARTER_V1");
    const usPack = getPolicyPack("US_GAAP_STARTER_V1");
    const trBank = findPurposeRow(trPack?.requiredPurposeMappings, BANK_CONTROL_PARENT_PURPOSE_CODE);
    const afBank = findPurposeRow(afPack?.requiredPurposeMappings, BANK_CONTROL_PARENT_PURPOSE_CODE);
    const usBank = findPurposeRow(usPack?.requiredPurposeMappings, BANK_CONTROL_PARENT_PURPOSE_CODE);

    assert(trBank?.required === true, "TR pack must require BANK_CONTROL_PARENT");
    assert(
      String(trBank?.recommendedCode || "") === "102",
      "TR pack BANK_CONTROL_PARENT should recommend 102"
    );
    assert(
      String(afBank?.recommendedCode || "") === "1150",
      "AF pack BANK_CONTROL_PARENT should recommend 1150"
    );
    assert(
      String(usBank?.recommendedCode || "") === "1150",
      "US pack BANK_CONTROL_PARENT should recommend 1150"
    );

    const preview = await resolvePolicyPack({
      tenantId: fixture.tenantId,
      legalEntityId: fixture.previewLegalEntityId,
      packId: "TR_UNIFORM_V1",
    });
    const previewBank = findPurposeRow(preview?.rows, BANK_CONTROL_PARENT_PURPOSE_CODE);
    assert(previewBank?.missing === false, "Policy-pack preview must resolve BANK_CONTROL_PARENT");
    assert(
      String(previewBank?.accountCode || "") === "102",
      "Policy-pack preview should resolve BANK_CONTROL_PARENT to 102"
    );

    let invalidBankError = null;
    try {
      await withTransaction(async (tx) =>
        applyPolicyPackTx({
          tx,
          tenantId: fixture.tenantId,
          userId: fixture.userId,
          legalEntityId: fixture.applyLegalEntityId,
          packId: "TR_UNIFORM_V1",
          mode: "MERGE",
          rows: [
            {
              purposeCode: BANK_CONTROL_PARENT_PURPOSE_CODE,
              accountId: fixture.accounts.applyInvalidLiability,
            },
          ],
        })
      );
    } catch (error) {
      invalidBankError = error;
    }
    assert(invalidBankError, "Invalid BANK_CONTROL_PARENT apply must fail");
    assert(
      String(invalidBankError?.message || "").includes("accountType=ASSET"),
      "Invalid BANK_CONTROL_PARENT apply should enforce ASSET validation"
    );

    await withTransaction(async (tx) =>
      applyPolicyPackTx({
        tx,
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        legalEntityId: fixture.applyLegalEntityId,
        packId: "TR_UNIFORM_V1",
        mode: "MERGE",
        rows: [
          {
            purposeCode: BANK_CONTROL_PARENT_PURPOSE_CODE,
            accountId: fixture.accounts.applyBankParent,
          },
        ],
      })
    );
    const appliedMapping = await getBankControlParentMapping(
      fixture.tenantId,
      fixture.applyLegalEntityId
    );
    assert(
      toInt(appliedMapping?.account_id) === fixture.accounts.applyBankParent,
      "Policy-pack apply must persist BANK_CONTROL_PARENT"
    );

    const dryRun = await backfillBankControlParentMappings({
      tenantId: fixture.tenantId,
      dryRun: true,
    });
    assert(dryRun.strictModeEnabled === true, "Backfill dry-run must detect strict mode");
    assert(dryRun.summary.eligibleCount === 2, "Backfill dry-run must find two eligible rows");
    assert(
      dryRun.summary.alreadyMappedCount === 1,
      "Backfill dry-run must preserve already mapped legal entities"
    );
    assert(
      dryRun.summary.remediationCount === 1,
      "Backfill dry-run must emit one remediation row"
    );
    const ambiguousRow = (dryRun.rows || []).find(
      (row) => row.legalEntityId === fixture.backfillAmbiguousLegalEntityId
    );
    assert(
      ambiguousRow?.status === "remediation_required" &&
        ambiguousRow?.reason === "ambiguous_legacy_102_parent",
      "Ambiguous legacy 102 parent must produce remediation row"
    );

    const applyResult = await backfillBankControlParentMappings({
      tenantId: fixture.tenantId,
      dryRun: false,
    });
    assert(applyResult.summary.appliedCount === 2, "Backfill apply must write two mappings");

    const previewBackfilled = await getBankControlParentMapping(
      fixture.tenantId,
      fixture.previewLegalEntityId
    );
    const eligibleBackfilled = await getBankControlParentMapping(
      fixture.tenantId,
      fixture.backfillEligibleLegalEntityId
    );
    const ambiguousBackfilled = await getBankControlParentMapping(
      fixture.tenantId,
      fixture.backfillAmbiguousLegalEntityId
    );
    assert(
      toInt(previewBackfilled?.account_id) > 0,
      "Backfill apply must write BANK_CONTROL_PARENT for preview legal entity"
    );
    assert(
      toInt(eligibleBackfilled?.account_id) > 0,
      "Backfill apply must write BANK_CONTROL_PARENT for eligible legal entity"
    );
    assert(
      !ambiguousBackfilled,
      "Backfill apply must not guess ambiguous BANK_CONTROL_PARENT mappings"
    );

    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const packageJson = JSON.parse(
      await readFile(path.resolve(root, "backend/package.json"), "utf8")
    );
    assert(
      packageJson?.scripts?.["backfill:bank-control-parent"] ===
        "node scripts/backfill-bank-control-parent-mappings.js",
      "backend/package.json must expose backfill:bank-control-parent"
    );

    const backfillScriptSource = await readFile(
      path.resolve(root, "backend/scripts/backfill-bank-control-parent-mappings.js"),
      "utf8"
    );
    const onboardingSource = await readFile(
      path.resolve(root, "backend/src/routes/onboarding.js"),
      "utf8"
    );
    const seedStarterSource = await readFile(
      path.resolve(root, "backend/src/seedStarter.js"),
      "utf8"
    );
    assert(
      backfillScriptSource.includes("--apply"),
      "Backfill CLI must support --apply"
    );
    assert(
      backfillScriptSource.includes("Dry-run only"),
      "Backfill CLI must include dry-run guidance"
    );
    assert(
      onboardingSource.includes("resolvePolicyPack({") &&
        onboardingSource.includes("applyPolicyPackTx({"),
      "Onboarding bootstrap must still resolve and apply policy packs in one flow"
    );
    assert(
      seedStarterSource.includes("/api/v1/onboarding/company-bootstrap"),
      "Starter seeding must still use company-bootstrap so BANK pack mappings are not skipped"
    );

    console.log("test-bank-control-bpm04-policy-pack-backfill: OK");
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error("test-bank-control-bpm04-policy-pack-backfill: FAILED");
  console.error(error);
  process.exit(1);
});
