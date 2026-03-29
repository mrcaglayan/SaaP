import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScriptChain } from "./_run-script-chain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readBackendFile(relativePath) {
  return fs.readFileSync(path.resolve(BACKEND_ROOT, relativePath), "utf8");
}

function assertTrack43OpenApiCoverage() {
  const openApiSource = readBackendFile("openapi.yaml");
  const generatorSource = readBackendFile("scripts/generate-openapi.js");

  const requiredOpenApiSnippets = [
    "/api/v1/fixed-assets/{assetId}/retro-ownership-transfer-correction/preview",
    "/api/v1/fixed-assets/{assetId}/retro-ownership-transfer-correction",
    "reportBasis",
    "INCLUDE_RETRO_CORRECTIONS",
    "OPERATIONALLY_CORRECTED",
  ];
  for (const snippet of requiredOpenApiSnippets) {
    assert(
      openApiSource.includes(snippet),
      `backend/openapi.yaml is missing Track 43 contract snippet: ${snippet}`
    );
  }

  const requiredGeneratorSnippets = [
    "retro-ownership-transfer-correction/preview",
    "reportBasisParameter",
    "INCLUDE_RETRO_CORRECTIONS",
  ];
  for (const snippet of requiredGeneratorSnippets) {
    assert(
      generatorSource.includes(snippet),
      `scripts/generate-openapi.js is missing Track 43 generator snippet: ${snippet}`
    );
  }
}

function assertReleaseGateWiring() {
  const packageJson = JSON.parse(readBackendFile("package.json"));
  const packageScripts = packageJson?.scripts || {};

  assert(
    packageScripts["test:fa48:retro-correction-focused"]
      === "node scripts/test-fa48-retro-correction-focused-smoke.js",
    "backend/package.json must expose test:fa48:retro-correction-focused"
  );
  assert(
    packageScripts["test:fa49:retro-correction-replacement"]
      === "node scripts/test-fa49-retro-correction-replacement-smoke.js",
    "backend/package.json must expose test:fa49:retro-correction-replacement"
  );
  assert(
    packageScripts["test:fa50:retro-correction-release-gate"]
      === "node scripts/test-fa50-retro-correction-release-gate.js",
    "backend/package.json must expose test:fa50:retro-correction-release-gate"
  );

  const opsDashboardGate = readBackendFile("scripts/test-fa-ops-dashboard-release-gate.js");
  assert(
    opsDashboardGate.includes("test-fa50-retro-correction-release-gate.js"),
    "Fixed-asset ops dashboard release gate must include Track 43 release-gate coverage"
  );
}

async function main() {
  await runScriptChain({
    title: "FA50 retro correction release gate",
    scripts: [
      "test-fa48-retro-correction-focused-smoke.js",
      "test-fa49-retro-correction-replacement-smoke.js",
      "test-fa37-ownership-transfer-smoke.js",
    ],
    envOverrides: {
      FA48_SMOKE_KEEP_ARTIFACTS: "0",
      FA49_SMOKE_KEEP_ARTIFACTS: "0",
      FA37_SMOKE_KEEP_ARTIFACTS: "0",
    },
  });

  assertTrack43OpenApiCoverage();
  assertReleaseGateWiring();
  console.log("FA50 retro correction release gate passed.");
}

main().catch((error) => {
  console.error("FA50 retro correction release gate failed.");
  console.error(error?.stack || error);
  process.exit(1);
});
