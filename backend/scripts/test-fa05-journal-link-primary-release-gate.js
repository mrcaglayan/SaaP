/**
 * STEP-FA05 — Journal-link one-PRIMARY-per-journal release gate
 *
 * Protects the one-owning-link discipline established by STEP-FA03 / STEP-FA04
 * with three layers of defense:
 *
 *   Layer 1 — Static source-code assertions
 *     Scans the writer service files for correct linkRole literals.
 *     Catches regressions before any server starts.
 *
 *   Layer 2 — Runtime posting-flow coverage
 *     Runs existing integration tests that exercise the real writer code paths.
 *     These tests start a server, make API calls, and create real journals with
 *     real journal_source_links rows in the database.
 *
 *   Layer 3 — Live duplicate-PRIMARY preflight
 *     After the posting flows run, queries the database for any journal that
 *     has more than one PRIMARY source link.  Catches runtime violations that
 *     static analysis cannot detect.
 *
 * Writer contract (enforced by this gate):
 *   1. Exactly ONE owning PRIMARY link per journal entry.
 *   2. Secondary links (infrastructure plumbing, cross-references) MUST use a
 *      non-PRIMARY role: SUPPORTING, REVERSAL_OF, RELATED_CASH_TXN, etc.
 *   3. Shared-journal flows where two modules touch the same journal must
 *      coordinate so that only the business-level owner writes PRIMARY.
 *
 * Covered writer flows (FA03 + FA04 scope):
 *   - cash.exchange.service.js      — IN-side links on shared FX journal use SUPPORTING (FA03)
 *   - inventory.service.js          — PRIMARY(INVENTORY_MOVEMENT) + SUPPORTING(CARI_STOCK_LINK)
 *   - inventory.transfer.service.js — one PRIMARY(INVENTORY_TRANSFER) per journal
 *   - payroll.accruals.service.js   — one PRIMARY(PAYROLL_RUN) per journal
 *
 * Runtime coverage (existing integration tests that exercise those writers):
 *   - test-cash-ex03-exchange-workflow.js       — clearing-mode exchange post + reverse
 *   - test-cash-exf06-direct-mode-exchange.js   — direct-mode exchange post
 *   - test-cash-exf07-direct-mode-reversal.js   — direct-mode exchange reversal
 *   - test-inventory-ou06-transfer-reversal-bypass.js — transfer post + reverse + source-link check
 *   - test-payroll-prp05-corrections.js         — payroll finalize + correction reversal
 *
 * Usage:
 *   node scripts/test-fa05-journal-link-primary-release-gate.js
 *   npm run test:fa05:primary-release-gate
 *
 * Exit codes:
 *   0 — all layers pass
 *   1 — regression detected at any layer
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.resolve(ROOT, "backend");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function readService(filename) {
  return readFile(path.resolve(BACKEND, "src", "services", filename), "utf8");
}

/**
 * Count non-overlapping occurrences of a substring in source text.
 */
function countOccurrences(source, substring) {
  let count = 0;
  let pos = 0;
  while ((pos = source.indexOf(substring, pos)) !== -1) {
    count++;
    pos += substring.length;
  }
  return count;
}

/**
 * Run a node script as a subprocess and return its exit code.
 */
function runNodeScript(scriptFile) {
  return new Promise((resolve) => {
    const scriptPath = path.resolve(__dirname, scriptFile);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: BACKEND,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Run an npm script as a subprocess and return its exit code.
 */
function runNpmScript(scriptName) {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd", ["/c", "npm", "run", scriptName], {
          cwd: BACKEND,
          stdio: "inherit",
        })
      : spawn("npm", ["run", scriptName], {
          cwd: BACKEND,
          stdio: "inherit",
        });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("=== STEP-FA05: journal-link one-PRIMARY-per-journal release gate ===\n");

  // ── Writer contract documentation ──────────────────────────────────
  console.log("── Writer contract ──");
  console.log("  Rule 1: Exactly one owning PRIMARY link per journal entry.");
  console.log("  Rule 2: Secondary links must use non-PRIMARY roles");
  console.log("          (SUPPORTING, REVERSAL_OF, RELATED_CASH_TXN, etc.).");
  console.log("  Rule 3: Shared-journal flows must coordinate PRIMARY ownership.");
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // LAYER 1 — Static source-code assertions
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ Layer 1: Static source-code assertions ═══\n");

  const cashExchangeSource = await readService("cash.exchange.service.js");
  const inventorySource = await readService("inventory.service.js");
  const inventoryTransferSource = await readService("inventory.transfer.service.js");
  const payrollAccrualsSource = await readService("payroll.accruals.service.js");

  // ── 1a. cash.exchange.service.js — STEP-FA03 regression ────────────
  console.log("── cash.exchange.service.js (shared FX journal — FA03 fix) ──");

  const exchangeSupportingCount = countOccurrences(
    cashExchangeSource,
    'linkRole: "SUPPORTING"'
  );
  assert(
    exchangeSupportingCount >= 2,
    `IN-side shared-journal links use SUPPORTING role (found ${exchangeSupportingCount} SUPPORTING upserts, expected ≥2)`
  );

  const exchangeExplicitPrimary = countOccurrences(
    cashExchangeSource,
    'linkRole: "PRIMARY"'
  );
  assert(
    exchangeExplicitPrimary === 0,
    `Exchange service does not write explicit PRIMARY (found ${exchangeExplicitPrimary}, expected 0)`
  );

  assert(
    cashExchangeSource.includes("upsertJournalSourceLinkTx"),
    "Exchange service imports upsertJournalSourceLinkTx"
  );
  console.log();

  // ── 1b. inventory.service.js — FA04 compliance ─────────────────────
  console.log("── inventory.service.js (movement journals — FA04) ──");

  assert(
    inventorySource.includes('sourceRefType: "INVENTORY_MOVEMENT"') &&
      inventorySource.includes('linkRole: "PRIMARY"'),
    "Movement journals write PRIMARY for INVENTORY_MOVEMENT"
  );

  assert(
    inventorySource.includes('linkRole: "SUPPORTING"'),
    "Stock-link cross-references use SUPPORTING role"
  );

  const invPrimaryCount = countOccurrences(inventorySource, 'linkRole: "PRIMARY"');
  assert(
    invPrimaryCount === 2,
    `Inventory movement writes exactly 2 PRIMARY upserts (post + reversal), found ${invPrimaryCount}`
  );

  const invSupportingCount = countOccurrences(inventorySource, 'linkRole: "SUPPORTING"');
  assert(
    invSupportingCount === 2,
    `Inventory movement writes exactly 2 SUPPORTING upserts (post + reversal stock links), found ${invSupportingCount}`
  );
  console.log();

  // ── 1c. inventory.transfer.service.js — FA04 compliance ────────────
  console.log("── inventory.transfer.service.js (transfer journals — FA04) ──");

  assert(
    inventoryTransferSource.includes('sourceRefType: "INVENTORY_TRANSFER"'),
    "Transfer journals write INVENTORY_TRANSFER source links"
  );

  const transferPrimaryCount = countOccurrences(inventoryTransferSource, 'linkRole: "PRIMARY"');
  assert(
    transferPrimaryCount === 3,
    `Transfer writes exactly 3 PRIMARY upserts (reversal + source + destination journals), found ${transferPrimaryCount}`
  );

  const transferSupportingCount = countOccurrences(
    inventoryTransferSource,
    'linkRole: "SUPPORTING"'
  );
  assert(
    transferSupportingCount === 0,
    `Transfer does not write SUPPORTING links (found ${transferSupportingCount}, expected 0)`
  );
  console.log();

  // ── 1d. payroll.accruals.service.js — FA04 compliance ──────────────
  console.log("── payroll.accruals.service.js (accrual journals — FA04) ──");

  assert(
    payrollAccrualsSource.includes('sourceRefType: "PAYROLL_RUN"'),
    "Accrual journals write PAYROLL_RUN source links"
  );

  const accrualUpsertCount = countOccurrences(
    payrollAccrualsSource,
    "upsertJournalSourceLinkTx"
  );
  assert(
    accrualUpsertCount === 4,
    `Payroll accruals has 3 upsert call sites + 1 import (found ${accrualUpsertCount} references)`
  );

  const accrualSupportingCount = countOccurrences(
    payrollAccrualsSource,
    'linkRole: "SUPPORTING"'
  );
  assert(
    accrualSupportingCount === 0,
    `Payroll accruals does not write SUPPORTING links (found ${accrualSupportingCount}, expected 0)`
  );
  console.log();

  // ── Layer 1 summary ────────────────────────────────────────────────
  console.log(`── Layer 1 result: ${passed} passed, ${failed} failed ──\n`);

  if (failed > 0) {
    console.error(
      `FAIL: ${failed} static assertion(s) failed. Writer compliance regression detected.`
    );
    return 1;
  }

  // ═══════════════════════════════════════════════════════════════════
  // LAYER 2 — Runtime posting-flow coverage
  //
  // Exercises the real writer code paths through existing integration
  // tests.  These start a server, make API calls, and create real
  // journals + journal_source_links rows in the database.
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ Layer 2: Runtime posting-flow coverage ═══\n");

  // These scripts exercise the exact code paths cleaned up in FA03/FA04:
  //
  // Cash exchange (FA03 — SUPPORTING fix on shared FX journal):
  //   test-cash-ex03  → clearing-mode exchange: creates OUT+IN txns on shared journal
  //   test-cash-exf06 → direct-mode exchange: creates OUT+IN txns on shared journal
  //   test-cash-exf07 → direct-mode reversal: reverses exchange, exercises reversal SUPPORTING path
  //
  // Inventory transfer (FA04 — one PRIMARY per journal):
  //   test-inventory-ou06 → transfer post + reversal, verifies journal_source_links in DB
  //
  // Payroll (FA04 — one PRIMARY per journal, PRIMARY + REVERSAL_OF on reversals):
  //   test-payroll-prp05 → finalize accrual + correction reversal, creates real journals
  const RUNTIME_SCRIPTS = [
    { file: "test-cash-ex03-exchange-workflow.js", label: "Cash exchange clearing-mode (FA03)" },
    { file: "test-cash-exf06-direct-mode-exchange.js", label: "Cash exchange direct-mode (FA03)" },
    { file: "test-cash-exf07-direct-mode-reversal.js", label: "Cash exchange direct-mode reversal (FA03)" },
    { file: "test-inventory-ou06-transfer-reversal-bypass.js", label: "Inventory transfer post + reversal (FA04)" },
    { file: "test-payroll-prp05-corrections.js", label: "Payroll finalize + correction reversal (FA04)" },
  ];

  for (const { file, label } of RUNTIME_SCRIPTS) {
    console.log(`── Running: ${label} ──`);
    const exitCode = await runNodeScript(file);
    if (exitCode !== 0) {
      console.error(`FAIL: ${label} exited with code ${exitCode}.`);
      console.error("Runtime posting-flow test failed. Cannot proceed to preflight.");
      return 1;
    }
    console.log();
  }

  console.log("── Layer 2 result: all runtime posting-flow tests passed ──\n");

  // ═══════════════════════════════════════════════════════════════════
  // LAYER 3 — Live duplicate-PRIMARY preflight
  //
  // After all posting flows have run and written real journal_source_links
  // rows, query the database for any journal with more than one PRIMARY.
  // This catches runtime violations that static analysis cannot detect.
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ Layer 3: Live duplicate-PRIMARY preflight (post-suite) ═══\n");

  const preflightExit = await runNpmScript("preflight:journal-source-link-primary");

  console.log();
  if (preflightExit !== 0) {
    console.error(
      "FAIL: Duplicate-PRIMARY preflight exited non-zero after posting-flow tests. " +
        "A writer flow is producing duplicate PRIMARY rows at runtime."
    );
    return 1;
  }

  console.log("═══ All three layers passed ═══");
  console.log(
    "FA05 release gate passed (static assertions + runtime posting flows + live duplicate-PRIMARY preflight)."
  );
  return 0;
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((err) => {
    console.error("FA05 release gate failed:", err);
    process.exit(1);
  });
