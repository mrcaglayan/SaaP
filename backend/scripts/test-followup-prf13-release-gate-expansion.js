import { runScriptChain } from "./_run-script-chain.js";

async function main() {
  await runScriptChain({
    title: "follow-up PR-F13 regression/release-gate expansion",
    scripts: [
      "test-followup-prf02-onboarding-defaultaccounts-backward.js",
      "test-followup-prf03-policy-pack-expansion.js",
      "test-followup-prf04-onboarding-policy-pack-bootstrap.js",
      "test-followup-prf13-setup-wizard-regression.js",
      "test-followup-prf05-workflows-definitions-assignments-api.js",
      "test-followup-prf06-workflow-decisions-runtime.js",
      "test-followup-prf07-workflow-close-consolidation-gates.js",
      "test-followup-prf13-tax-engine-regression.js",
      "test-followup-prf12-canonical-mapping-foundation.js",
      "test-followup-prf12-cross-track-wiring.js",
      "test-ux-prcore02-idempotency-standardization.js",
      "test-followup-prf13-cross-track-idempotency.js",
      "test-followup-prf13-backfill-scripts.js",
    ],
  });
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
