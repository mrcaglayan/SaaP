import { readFile } from "node:fs/promises";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readUtf8(relativePathFromBackend) {
  const absolutePath = path.resolve(process.cwd(), relativePathFromBackend);
  return readFile(absolutePath, "utf8");
}

async function main() {
  const settlementServiceSource = await readUtf8("src/services/cari.settlement.service.js");
  const settlementPageSource = await readUtf8(
    "../frontend/src/pages/cari/CariSettlementsPage.jsx"
  );
  const trackerSource = await readUtf8(
    "../PR-STEPS/18-CARI-MULTI-CURRENCY-SETTLEMENTS-ROLLOUT-UAT.md"
  );

  const requiredErrors = [
    "fxRate must match linked cash transaction FX rate for cash-linked settlement",
    "cashTransactionId currency must match settlement currencyCode. Exchange first, then settle.",
    "incomingAmountTxn must equal cashTransactionId amount",
    "linkedCashTransaction cannot be provided together with cashTransactionId when paymentChannel=CASH",
    "Missing cross rate for auto allocation document currency",
  ];
  for (const message of requiredErrors) {
    assert(
      settlementServiceSource.includes(message),
      `Settlement service must include support-diagnostic error: ${message}`
    );
  }

  assert(
    settlementPageSource.includes("Auto-allocation is blocked: missing settlement/document FX rate"),
    "Settlement page must surface missing FX warning for auto-allocation"
  );
  assert(
    settlementPageSource.includes("Cross-currency preview requires permission: `fx.rate.read`"),
    "Settlement page must explain fx.rate.read permission requirement"
  );

  assert(
    trackerSource.includes("PR-MCSR03"),
    "Rollout tracker must include PR-MCSR03 section"
  );
  assert(
    trackerSource.includes("Ops diagnostics and support playbook"),
    "Rollout tracker must mention diagnostics/support playbook"
  );

  console.log("CARI MCSR03 error playbook smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
