import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { listTenantFeatures } from "../src/services/me.features.service.js";
import {
  backfillCashFxPositionLots,
  reconcileCashFxLotsAgainstGl,
  seedMissingCashFxMetadata,
} from "../src/services/cash.fx.backfill.service.js";
import {
  CASH_FX_EXF05_FEATURE_GA,
  CASH_FX_EXF05_FEATURE_PILOT,
  getCashFxRolloutState,
  setCashFxRolloutPhase,
} from "../src/services/cash.fx.rollout.service.js";
import {
  assert,
  bootstrapOrgBookCoa,
  createAccount,
  createAndPostCashTransaction,
  createRegister,
  insertFxRate,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CASH_EXF05_TEST_PORT || 3129);
const BASE_URL =
  process.env.CASH_EXF05_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF05#12345";

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function assertExf05Wiring(repoRoot) {
  const packageJson = JSON.parse(
    await readFile(path.resolve(repoRoot, "backend/package.json"), "utf8")
  );
  const scripts = packageJson?.scripts || {};
  const expectedScripts = {
    "backfill:cash-fx:seed-metadata": "node scripts/cash-fx-seed-missing-metadata.js",
    "backfill:cash-fx:lots": "node scripts/cash-fx-backfill-position-lots.js",
    "reconcile:cash-fx:lots-vs-gl": "node scripts/cash-fx-reconcile-lots-vs-gl.js",
    "rollout:cash-fx:exf05": "node scripts/cash-fx-rollout-exf05.js",
    "test:cash:exf05": "node scripts/test-cash-exf05-backfill-and-rollout.js",
    "test:cash-fx-full-release-gate": "node scripts/test-cash-fx-full-release-gate.js",
  };
  for (const [key, value] of Object.entries(expectedScripts)) {
    assert(scripts[key] === value, `backend/package.json missing script: ${key}`);
  }

  const catalogSource = await readFile(
    path.resolve(repoRoot, "backend/src/services/features.catalog.js"),
    "utf8"
  );
  for (const requiredToken of [
    "FEATURE_CASH_FX_EXF05_PILOT_V1",
    "FEATURE_CASH_FX_EXF05_GA_V1",
  ]) {
    assert(
      catalogSource.includes(requiredToken),
      `features.catalog.js missing required token: ${requiredToken}`
    );
  }

  const runbookSource = await readFile(
    path.resolve(repoRoot, "docs/runbooks/cash-fx-exchange-operations.md"),
    "utf8"
  );
  for (const requiredToken of [
    "## EXF05 Pilot Rollout Checklist",
    "## EXF05 Go/No-Go Criteria",
    "## EXF05 Rollback Actions",
    "rollout:cash-fx:exf05",
    "test:cash-fx-full-release-gate",
  ]) {
    assert(
      runbookSource.includes(requiredToken),
      `cash-fx-exchange-operations.md missing required token: ${requiredToken}`
    );
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(backendRoot, "..");
  await assertExf05Wiring(repoRoot);

  const stamp = Date.now();
  const tenantCode = `EXF05_${stamp}`;
  const tenantName = `EXF05 Tenant ${stamp}`;
  const adminEmail = `exf05_admin_${stamp}@example.com`;

  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode,
    tenantName,
    adminEmail,
    adminPassword: ADMIN_PASSWORD,
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const token = await login({
      baseUrl: BASE_URL,
      email: adminEmail,
      password: ADMIN_PASSWORD,
    });

    const base = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token,
      stamp,
      fiscalYear: 2026,
      baseCurrencyCode: "TRY",
      yearsToGenerate: [2026],
    });

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF05_USD_${String(stamp).slice(-6)}`,
      name: "EXF05 USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF05_CNT_${String(stamp).slice(-6)}`,
      name: "EXF05 Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });

    const usdRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: usdRegisterAccountId,
      code: `EXF05-RUSD-${stamp}`,
      name: "EXF05 USD Register",
      currencyCode: "USD",
    });

    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: "2026-01-10",
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 38,
    });
    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: "2026-01-11",
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 39,
    });

    const tx1 = await createAndPostCashTransaction({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      registerId: usdRegisterId,
      txnType: "RECEIPT",
      txnDatetime: "2026-01-10T09:00:00",
      bookDate: "2026-01-10",
      amount: 100,
      currencyCode: "USD",
      counterAccountId: cashCounterAccountId,
      idempotencyKey: `EXF05-TXN-1-${stamp}`,
      sourceEntityId: `EXF05-TXN-1-${stamp}`,
    });
    const tx2 = await createAndPostCashTransaction({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      registerId: usdRegisterId,
      txnType: "RECEIPT",
      txnDatetime: "2026-01-11T09:00:00",
      bookDate: "2026-01-11",
      amount: 40,
      currencyCode: "USD",
      counterAccountId: cashCounterAccountId,
      idempotencyKey: `EXF05-TXN-2-${stamp}`,
      sourceEntityId: `EXF05-TXN-2-${stamp}`,
    });
    const tx1Id = toNumber(tx1.transactionId);
    const tx2Id = toNumber(tx2.transactionId);
    assert(tx1Id > 0 && tx2Id > 0, "Posted transaction ids are required");

    await query(
      `UPDATE cash_transactions
       SET fx_rate = NULL,
           fx_rate_source = NULL,
           fx_rate_date = NULL
       WHERE tenant_id = ?
         AND id = ?`,
      [identity.tenantId, tx1Id]
    );

    await query(`DELETE FROM cash_fx_lot_movements WHERE tenant_id = ?`, [identity.tenantId]);
    await query(`DELETE FROM cash_fx_position_lots WHERE tenant_id = ?`, [identity.tenantId]);

    const featureSnapshotBefore = await listTenantFeatures({
      tenantId: identity.tenantId,
      includeDisabled: true,
    });
    assert(
      featureSnapshotBefore.flags[CASH_FX_EXF05_FEATURE_PILOT] === false,
      "EXF05 pilot feature should be disabled initially"
    );
    assert(
      featureSnapshotBefore.flags[CASH_FX_EXF05_FEATURE_GA] === false,
      "EXF05 GA feature should be disabled initially"
    );

    const seedDryRun = await seedMissingCashFxMetadata({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      registerId: usdRegisterId,
      dryRun: true,
      limit: 1000,
    });
    assert(seedDryRun.scannedCount >= 1, "Seed dry-run must scan at least one transaction");
    assert(seedDryRun.updatedCount >= 1, "Seed dry-run should propose at least one update");

    const seedApply = await seedMissingCashFxMetadata({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      registerId: usdRegisterId,
      dryRun: false,
      limit: 1000,
    });
    assert(seedApply.updatedCount >= 1, "Seed apply should update at least one transaction");
    assert(seedApply.unresolvedCount === 0, "Seed apply should not leave unresolved rows");

    const seededTx = (
      await query(
        `SELECT amount_base, fx_rate, fx_rate_source, fx_rate_date
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, tx1Id]
      )
    ).rows?.[0];
    assert(toNumber(seededTx?.amount_base) > 0, "amount_base must be present after seed");
    assert(toNumber(seededTx?.fx_rate) > 0, "fx_rate must be present after seed");
    assert(
      String(seededTx?.fx_rate_source || "").trim().length > 0,
      "fx_rate_source must be present after seed"
    );
    assert(
      String(seededTx?.fx_rate_date || "").slice(0, 10).length === 10,
      "fx_rate_date must be present after seed"
    );

    const backfillDryRun = await backfillCashFxPositionLots({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      registerId: usdRegisterId,
      dryRun: true,
      limit: 1000,
    });
    assert(backfillDryRun.scannedCount >= 2, "Backfill dry-run should scan two transactions");
    assert(backfillDryRun.appliedCount >= 2, "Backfill dry-run should plan lot writes");

    const backfillApply = await backfillCashFxPositionLots({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      registerId: usdRegisterId,
      dryRun: false,
      limit: 1000,
    });
    assert(backfillApply.appliedCount >= 2, "Backfill apply should create lot movements");
    assert(backfillApply.failedCount === 0, "Backfill apply should not fail");

    const movementCount = toNumber(
      (
        await query(
          `SELECT COUNT(*) AS total
           FROM cash_fx_lot_movements
           WHERE tenant_id = ?
             AND cash_transaction_id IN (?, ?)`,
          [identity.tenantId, tx1Id, tx2Id]
        )
      ).rows?.[0]?.total
    );
    assert(movementCount >= 2, "Backfill should create movement rows for posted transactions");

    const backfillReplay = await backfillCashFxPositionLots({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      registerId: usdRegisterId,
      dryRun: false,
      limit: 1000,
    });
    assert(
      backfillReplay.idempotentCount >= 2,
      "Second backfill pass should be idempotent for already-applied transactions"
    );
    assert(backfillReplay.failedCount === 0, "Replay backfill should not fail");

    const reconcile = await reconcileCashFxLotsAgainstGl({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      registerId: usdRegisterId,
    });
    assert(reconcile.checkedCount >= 1, "Reconciliation must return at least one row");
    assert(
      reconcile.mismatchCount === 0,
      `Expected zero lot/GL mismatches, got ${reconcile.mismatchCount}`
    );

    const initialRollout = await getCashFxRolloutState({ tenantId: identity.tenantId });
    assert(asUpper(initialRollout.phase) === "ROLLBACK", "Initial rollout phase should be ROLLBACK");

    let blockedGaError = null;
    try {
      await setCashFxRolloutPhase({
        tenantId: identity.tenantId,
        phase: "GA",
        updatedByUserId: identity.userId,
      });
    } catch (error) {
      blockedGaError = error;
    }
    assert(
      blockedGaError &&
        String(blockedGaError.message || "").includes("Cannot enable GA before PILOT phase"),
      "GA should be blocked before PILOT when force=false"
    );

    const pilotApply = await setCashFxRolloutPhase({
      tenantId: identity.tenantId,
      phase: "PILOT",
      updatedByUserId: identity.userId,
      note: "EXF05 pilot enable smoke",
    });
    assert(asUpper(pilotApply.after?.phase) === "PILOT", "Pilot rollout should set phase PILOT");
    assert(pilotApply.after?.pilot?.isEnabled === true, "Pilot flag should be enabled");
    assert(pilotApply.after?.ga?.isEnabled === false, "GA flag should remain disabled on pilot");

    const gaApply = await setCashFxRolloutPhase({
      tenantId: identity.tenantId,
      phase: "GA",
      updatedByUserId: identity.userId,
      note: "EXF05 GA enable smoke",
    });
    assert(asUpper(gaApply.after?.phase) === "GA", "GA rollout should set phase GA");
    assert(gaApply.after?.pilot?.isEnabled === true, "Pilot flag should stay enabled for GA");
    assert(gaApply.after?.ga?.isEnabled === true, "GA flag should be enabled");

    const rollbackApply = await setCashFxRolloutPhase({
      tenantId: identity.tenantId,
      phase: "ROLLBACK",
      updatedByUserId: identity.userId,
      note: "EXF05 rollback smoke",
    });
    assert(asUpper(rollbackApply.after?.phase) === "ROLLBACK", "Rollback should set phase ROLLBACK");
    assert(rollbackApply.after?.pilot?.isEnabled === false, "Pilot flag should be disabled");
    assert(rollbackApply.after?.ga?.isEnabled === false, "GA flag should be disabled");

    const tenantFeatureRows = (
      await query(
        `SELECT feature_code, is_enabled
         FROM tenant_features
         WHERE tenant_id = ?
           AND feature_code IN (?, ?)
         ORDER BY feature_code`,
        [identity.tenantId, CASH_FX_EXF05_FEATURE_PILOT, CASH_FX_EXF05_FEATURE_GA]
      )
    ).rows || [];
    assert(tenantFeatureRows.length === 2, "Tenant feature rows should exist for both EXF05 flags");
    assert(
      tenantFeatureRows.every((row) => Number(row?.is_enabled) === 0),
      "Rollback phase should disable both EXF05 flags"
    );

    const featureSnapshotAfter = await listTenantFeatures({
      tenantId: identity.tenantId,
      includeDisabled: true,
    });
    assert(
      featureSnapshotAfter.flags[CASH_FX_EXF05_FEATURE_PILOT] === false,
      "Pilot flag should report disabled after rollback"
    );
    assert(
      featureSnapshotAfter.flags[CASH_FX_EXF05_FEATURE_GA] === false,
      "GA flag should report disabled after rollback"
    );

    console.log("PR-EXF05 historical backfill and rollout hardening checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          registerId: usdRegisterId,
          txIds: [tx1Id, tx2Id],
          seedApply,
          backfillApply,
          backfillReplay,
          reconcile: {
            checkedCount: reconcile.checkedCount,
            mismatchCount: reconcile.mismatchCount,
          },
          rolloutPhases: {
            initial: initialRollout.phase,
            pilotAfter: pilotApply.after?.phase,
            gaAfter: gaApply.after?.phase,
            rollbackAfter: rollbackApply.after?.phase,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (!serverStopped) {
      server.kill("SIGINT");
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error("PR-EXF05 backfill/rollout test failed.");
  console.error(error);
  process.exitCode = 1;
});
