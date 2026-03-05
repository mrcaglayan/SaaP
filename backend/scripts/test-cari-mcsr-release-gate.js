import { runScriptChain } from "./_run-script-chain.js";

async function main() {
  await runScriptChain({
    title: "CARI MCSR rollout/UAT release-gate chain",
    scripts: [
      "test-cari-mcsr01-uat-matrix.js",
      "test-cari-mcsr02-reconcile-gate.js",
      "test-cari-mcsr03-error-playbook-smoke.js",
      "test-cari-mcsr04-pilot-rollout-checklist.js",
      "test-cari-mcsr05-ga-signoff-gate.js",
    ],
  });

  console.log("CARI MCSR rollout/UAT release-gate checks passed.");
}

main().catch((error) => {
  console.error("CARI MCSR rollout/UAT release-gate checks failed.");
  console.error(error);
  process.exitCode = 1;
});
