import { runScriptChain } from "./_run-script-chain.js";

async function main() {
  await runScriptChain({
    title: "FA46-FA47 improvement regression gate",
    scripts: [
      "test-fa46-retro-multi-improvement-smoke.js",
      "test-fa47-lifecycle-blocker-and-disposal-preview-smoke.js",
    ],
    envOverrides: {
      FA46_SMOKE_KEEP_ARTIFACTS: "0",
      FA47_SMOKE_KEEP_ARTIFACTS: "0",
    },
  });
}

main().catch((error) => {
  console.error("FA46-FA47 improvement regression gate failed.");
  console.error(error?.stack || error);
  process.exit(1);
});
