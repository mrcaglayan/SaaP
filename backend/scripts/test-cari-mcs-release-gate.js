import { runScriptChain } from "./_run-script-chain.js";

async function main() {
  await runScriptChain({
    title: "CARI MCS release-gate chain",
    scripts: [
      "test-cari-mcs01-schema-allocation-dual-currency.js",
      "test-cari-mcs02-fx-cross-rate-resolution.js",
      "test-cari-mcs03-apply-reverse-multi-currency.js",
      "test-cari-mcs04-cash-linked-base-and-status.js",
      "test-cari-mcs05-reporting-reconcile-multi-currency.js",
    ],
  });

  console.log("CARI MCS release-gate checks passed.");
}

main().catch((error) => {
  console.error("CARI MCS release-gate checks failed.");
  console.error(error);
  process.exitCode = 1;
});
