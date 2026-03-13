import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query, withTransaction } from "../src/db.js";
import { resolveOuSelfBalancingAccountsTx } from "../src/services/ou.self-balancing.service.js";
import {
  upsertOperatingUnit,
  upsertOperatingUnitPartnerCurrentAccount,
} from "../src/services/org.write.service.js";
import { assertLegalEntityBelongsToTenant } from "../src/tenantGuards.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertThrowsAsync(fn, expectedMessage) {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `Expected async error containing "${expectedMessage}"`);
  const message = String(thrown?.message || thrown || "");
  assert(
    message.includes(expectedMessage),
    `Expected async error containing "${expectedMessage}", got "${message}"`
  );
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

async function loadSmokeContext() {
  const result = await query(
    `SELECT
        le.tenant_id,
        le.id AS legal_entity_id,
        le.code AS legal_entity_code,
        coa.id AS coa_id
       FROM legal_entities le
       JOIN charts_of_accounts coa
         ON coa.tenant_id = le.tenant_id
        AND coa.legal_entity_id = le.id
        AND coa.scope = 'LEGAL_ENTITY'
      WHERE le.status = 'ACTIVE'
      ORDER BY le.id ASC
      LIMIT 1`
  );
  const row = result.rows?.[0] || null;
  assert(row, "Expected one active legal entity with a legal-entity chart of accounts");
  return {
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    legalEntityCode: String(row.legal_entity_code || ""),
    coaId: Number(row.coa_id),
  };
}

async function createLeafAccount({
  coaId,
  code,
  name,
  accountType,
  normalSide,
}) {
  const result = await query(
    `INSERT INTO accounts (
        coa_id,
        code,
        name,
        account_type,
        normal_side,
        allow_posting,
        parent_account_id,
        is_active
      )
     VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)`,
    [coaId, code, name, accountType, normalSide]
  );
  const id = Number(result.rows?.insertId || 0);
  assert(id > 0, `Expected account insert id for ${code}`);
  return {
    id,
    code,
    name,
  };
}

function buildReq(tenantId) {
  return {
    user: {
      tenantId,
      userId: 7,
    },
    body: {},
    query: {},
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [
    migrationSource,
    migrationIndexSource,
    validatorSource,
    writeQuerySource,
    readQuerySource,
    writeServiceSource,
    helperSource,
    frontendSource,
  ] = await Promise.all([
    readFile(
      path.resolve(
        root,
        "src/migrations/m125_operating_unit_reverse_internal_current_accounts.js"
      ),
      "utf8"
    ),
    readFile(path.resolve(root, "src/migrations/index.js"), "utf8"),
    readFile(path.resolve(root, "src/routes/org.write.validators.js"), "utf8"),
    readFile(path.resolve(root, "src/services/org.write.queries.js"), "utf8"),
    readFile(path.resolve(root, "src/services/org.read.queries.js"), "utf8"),
    readFile(path.resolve(root, "src/services/org.write.service.js"), "utf8"),
    readFile(path.resolve(root, "src/services/ou.self-balancing.service.js"), "utf8"),
    readFile(
      path.resolve(root, "../frontend/src/pages/settings/OrganizationManagementPage.jsx"),
      "utf8"
    ),
  ]);

  assert(
    migrationSource.includes("central_due_to_account_id") &&
      migrationSource.includes("ou_due_from_central_account_id"),
    "m125 should add reverse-direction central/OU columns"
  );
  assert(
    migrationSource.includes("fk_operating_units_central_due_to_account") &&
      migrationSource.includes("fk_operating_units_ou_due_from_central_account"),
    "m125 should add reverse-direction foreign keys"
  );
  assert(
    migrationIndexSource.includes("m125_operating_unit_reverse_internal_current_accounts") &&
      migrationIndexSource.includes("migration125OperatingUnitReverseInternalCurrentAccounts"),
    "migrations index should register m125"
  );
  assert(
    validatorSource.includes("centralDueToAccountId") &&
      validatorSource.includes("ouDueFromCentralAccountId"),
    "OU write validator should parse reverse-direction account ids"
  );
  assert(
    writeQuerySource.includes("central_due_to_account_id") &&
      writeQuerySource.includes("ou_due_from_central_account_id"),
    "OU write queries should persist reverse-direction account ids"
  );
  assert(
    readQuerySource.includes("central_due_to_account_code") &&
      readQuerySource.includes("ou_due_from_central_account_code") &&
      readQuerySource.includes("cross_context_self_balancing_ready"),
    "OU read queries should expose reverse-direction mapping codes and readiness"
  );
  assert(
    writeServiceSource.includes("centralDueToAccountId") &&
      writeServiceSource.includes("ouDueFromCentralAccountId") &&
      writeServiceSource.includes("Central Due To OU account mapping") &&
      writeServiceSource.includes("OU Due From Central account mapping"),
    "OU write service should validate and persist reverse-direction account ids"
  );
  assert(
    helperSource.includes("resolveOuSelfBalancingAccountsTx") &&
      helperSource.includes("CENTRAL_TO_OU") &&
      helperSource.includes("OU_TO_CENTRAL") &&
      helperSource.includes("OU_TO_OU"),
    "Shared OU self-balancing helper should resolve all route families"
  );
  assert(
    frontendSource.includes("Central Due To OU (optional)") &&
      frontendSource.includes("OU Due From Central (optional)") &&
      frontendSource.includes("cross_context_self_balancing_ready"),
    "OrganizationManagementPage should expose reverse-direction fields and readiness"
  );

  const context = await loadSmokeContext();
  const req = buildReq(context.tenantId);
  const createdUnitIds = [];
  const createdAccountIds = [];
  const createdPartnerMappings = [];

  try {
    const unitAAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03CDA"),
        name: "OU03 Central Due From A",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      centralDueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03CDT"),
        name: "OU03 Central Due To A",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
      ouDueFromCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03ODF"),
        name: "OU03 OU Due From Central A",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03ODT"),
        name: "OU03 OU Due To Central A",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const unitBAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03CDB"),
        name: "OU03 Central Due From B",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      centralDueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03CTB"),
        name: "OU03 Central Due To B",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
      ouDueFromCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03OFB"),
        name: "OU03 OU Due From Central B",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03OTB"),
        name: "OU03 OU Due To Central B",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const partialUnitAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03PCF"),
        name: "OU03 Partial Central Due From",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03POT"),
        name: "OU03 Partial OU Due To Central",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const invalidAssetAccount = await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("OU03INV"),
      name: "OU03 Invalid Asset",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const partnerForwardAccounts = {
      dueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03PDF"),
        name: "OU03 Due From B",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      dueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03PDT"),
        name: "OU03 Due To B",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const partnerReverseAccounts = {
      dueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03RDF"),
        name: "OU03 Due From A",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      dueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU03RDT"),
        name: "OU03 Due To A",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };

    createdAccountIds.push(
      unitAAccounts.centralDueFrom.id,
      unitAAccounts.centralDueTo.id,
      unitAAccounts.ouDueFromCentral.id,
      unitAAccounts.ouDueToCentral.id,
      unitBAccounts.centralDueFrom.id,
      unitBAccounts.centralDueTo.id,
      unitBAccounts.ouDueFromCentral.id,
      unitBAccounts.ouDueToCentral.id,
      partialUnitAccounts.centralDueFrom.id,
      partialUnitAccounts.ouDueToCentral.id,
      invalidAssetAccount.id,
      partnerForwardAccounts.dueFrom.id,
      partnerForwardAccounts.dueTo.id,
      partnerReverseAccounts.dueFrom.id,
      partnerReverseAccounts.dueTo.id
    );

    const unitA = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU03A"),
      name: "OU03 Branch A",
      unitType: "BRANCH",
      hasSubledger: false,
      centralDueFromAccountId: unitAAccounts.centralDueFrom.id,
      centralDueToAccountId: unitAAccounts.centralDueTo.id,
      ouDueFromCentralAccountId: unitAAccounts.ouDueFromCentral.id,
      ouDueToCentralAccountId: unitAAccounts.ouDueToCentral.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    const unitB = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU03B"),
      name: "OU03 Branch B",
      unitType: "BRANCH",
      hasSubledger: false,
      centralDueFromAccountId: unitBAccounts.centralDueFrom.id,
      centralDueToAccountId: unitBAccounts.centralDueTo.id,
      ouDueFromCentralAccountId: unitBAccounts.ouDueFromCentral.id,
      ouDueToCentralAccountId: unitBAccounts.ouDueToCentral.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    const partialUnit = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU03P"),
      name: "OU03 Partial Mapping Branch",
      unitType: "BRANCH",
      hasSubledger: false,
      centralDueFromAccountId: partialUnitAccounts.centralDueFrom.id,
      centralDueToAccountId: null,
      ouDueFromCentralAccountId: null,
      ouDueToCentralAccountId: partialUnitAccounts.ouDueToCentral.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    createdUnitIds.push(unitA.id, unitB.id, partialUnit.id);

    await upsertOperatingUnitPartnerCurrentAccount({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      operatingUnitId: unitA.id,
      partnerOperatingUnitId: unitB.id,
      dueFromAccountId: partnerForwardAccounts.dueFrom.id,
      dueToAccountId: partnerForwardAccounts.dueTo.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    createdPartnerMappings.push([unitA.id, unitB.id]);
    await upsertOperatingUnitPartnerCurrentAccount({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      operatingUnitId: unitB.id,
      partnerOperatingUnitId: unitA.id,
      dueFromAccountId: partnerReverseAccounts.dueFrom.id,
      dueToAccountId: partnerReverseAccounts.dueTo.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    createdPartnerMappings.push([unitB.id, unitA.id]);

    await assertThrowsAsync(
      () =>
        upsertOperatingUnit({
          req,
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          code: uniqueCode("OU03I"),
          name: "OU03 Invalid Branch",
          unitType: "BRANCH",
          hasSubledger: false,
          centralDueFromAccountId: unitAAccounts.centralDueFrom.id,
          centralDueToAccountId: invalidAssetAccount.id,
          ouDueFromCentralAccountId: null,
          ouDueToCentralAccountId: null,
          assertLegalEntityBelongsToTenant,
          assertScopeAccess: () => {},
        }),
      "centralDueToAccountId must reference a LIABILITY account"
    );

    const centralToOu = await withTransaction((tx) =>
      resolveOuSelfBalancingAccountsTx(tx, {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        sourceOperatingUnitId: null,
        targetOperatingUnitId: unitA.id,
      })
    );
    assert(
      centralToOu.routeType === "CENTRAL_TO_OU" &&
        Number(centralToOu.sourceDueFromAccount.id) === unitAAccounts.centralDueFrom.id &&
        Number(centralToOu.sourceDueToAccount.id) === unitAAccounts.centralDueTo.id &&
        Number(centralToOu.targetDueFromAccount.id) === unitAAccounts.ouDueFromCentral.id &&
        Number(centralToOu.targetDueToAccount.id) === unitAAccounts.ouDueToCentral.id,
      "CENTRAL -> OU resolution should return all four mapped accounts"
    );

    const ouToCentral = await withTransaction((tx) =>
      resolveOuSelfBalancingAccountsTx(tx, {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        sourceOperatingUnitId: unitA.id,
        targetOperatingUnitId: null,
      })
    );
    assert(
      ouToCentral.routeType === "OU_TO_CENTRAL" &&
        Number(ouToCentral.sourceDueFromAccount.id) === unitAAccounts.ouDueFromCentral.id &&
        Number(ouToCentral.sourceDueToAccount.id) === unitAAccounts.ouDueToCentral.id &&
        Number(ouToCentral.targetDueFromAccount.id) === unitAAccounts.centralDueFrom.id &&
        Number(ouToCentral.targetDueToAccount.id) === unitAAccounts.centralDueTo.id,
      "OU -> CENTRAL resolution should return reverse-direction mapped accounts"
    );

    const ouToOu = await withTransaction((tx) =>
      resolveOuSelfBalancingAccountsTx(tx, {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        sourceOperatingUnitId: unitA.id,
        targetOperatingUnitId: unitB.id,
      })
    );
    assert(
      ouToOu.routeType === "OU_TO_OU" &&
        Number(ouToOu.sourceDueFromAccount.id) === partnerForwardAccounts.dueFrom.id &&
        Number(ouToOu.sourceDueToAccount.id) === partnerForwardAccounts.dueTo.id &&
        Number(ouToOu.targetDueFromAccount.id) === partnerReverseAccounts.dueFrom.id &&
        Number(ouToOu.targetDueToAccount.id) === partnerReverseAccounts.dueTo.id,
      "OU -> OU resolution should reuse directional partner-pair mappings"
    );

    await assertThrowsAsync(
      () =>
        withTransaction((tx) =>
          resolveOuSelfBalancingAccountsTx(tx, {
            tenantId: context.tenantId,
            legalEntityId: context.legalEntityId,
            sourceOperatingUnitId: null,
            targetOperatingUnitId: partialUnit.id,
          })
        ),
      "Configure all four central <-> OU current-account fields"
    );

    console.log("Inventory OU03 self-balancing foundation smoke passed.");
  } finally {
    if (createdPartnerMappings.length > 0) {
      const conditions = createdPartnerMappings
        .map(() => "(operating_unit_id = ? AND partner_operating_unit_id = ?)")
        .join(" OR ");
      const params = createdPartnerMappings.flatMap(([sourceId, targetId]) => [
        sourceId,
        targetId,
      ]);
      await query(
        `DELETE FROM operating_unit_partner_current_accounts
         WHERE ${conditions}`,
        params
      );
    }
    if (createdUnitIds.length > 0) {
      await query(
        `DELETE FROM operating_units
         WHERE id IN (${createdUnitIds.map(() => "?").join(",")})`,
        createdUnitIds
      );
    }
    if (createdAccountIds.length > 0) {
      await query(
        `DELETE FROM accounts
         WHERE id IN (${createdAccountIds.map(() => "?").join(",")})`,
        createdAccountIds
      );
    }
    await closePool();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await closePool();
  } catch {
    // ignore cleanup failures on exit
  }
  process.exit(1);
});
