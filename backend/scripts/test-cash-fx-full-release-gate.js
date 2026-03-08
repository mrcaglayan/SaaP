import { runScriptChain } from "./_run-script-chain.js";

async function main() {
  await runScriptChain({
    title: "Cash FX full release-gate chain (EX + EXF)",
    scripts: [
      "test-cash-ex06-release-gate.js",
      "test-cash-exf01-position-lots-realized-fx.js",
      "test-cash-exf02-revaluation-reversal-automation.js",
      "test-cash-exf02-close-reopen-integrity.js",
      "test-cash-exf03-exchange-fee-and-spread.js",
      "test-cash-exf06-direct-mode-exchange.js",
      "test-cash-exf07-direct-mode-reversal.js",
      "test-cash-exf04-fx-ops-dashboard.js",
      "test-cash-exf04-fx-exception-actions.js",
      "test-cash-exf05-backfill-and-rollout.js",
    ],
  });

  console.log("Cash FX full release-gate checks passed.");
}

main().catch((error) => {
  console.error("Cash FX full release-gate checks failed.");
  console.error(error);
  process.exitCode = 1;
});
