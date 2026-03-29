import { runScriptChain } from "./_run-script-chain.js";

async function main() {
  await runScriptChain({
    title: "Fixed-asset ops dashboard release gate",
    scripts: [
      "test-fa21-manual-activation-smoke.js",
      "test-fa45-late-activation-catchup-smoke.js",
      "test-fa46-fa47-improvement-release-gate.js",
      "test-fa50-retro-correction-release-gate.js",
    ],
    envOverrides: {
      FA21_SMOKE_KEEP_ARTIFACTS: "0",
      FA45_SMOKE_KEEP_ARTIFACTS: "0",
      FA46_SMOKE_KEEP_ARTIFACTS: "0",
      FA47_SMOKE_KEEP_ARTIFACTS: "0",
      FA48_SMOKE_KEEP_ARTIFACTS: "0",
      FA49_SMOKE_KEEP_ARTIFACTS: "0",
      FA50_SMOKE_KEEP_ARTIFACTS: "0",
    },
  });
}

main().catch((error) => {
  console.error("Fixed-asset ops dashboard release gate failed.");
  console.error(error?.stack || error);
  process.exit(1);
});
